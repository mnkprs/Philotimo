# ADR 0002 — Fee Collection Point: On-Chain via Router Contract

- **Status:** Accepted
- **Date:** 2026-05-19
- **Epic:** [#4 — Epic 3 Fiat-to-crypto on-ramp integration](https://github.com/<org>/donate/issues/4)
- **Resolves:** Open Question #2 in `ARCHITECTURE.md` — "Should the platform fee be pulled as fiat directly during the payment processing stage, or pulled strictly on-chain via the Solidity routing contract?"
- **Depends on:** [ADR 0001 — Stripe Crypto Onramp](./0001-stripe-crypto-onramp.md)

---

## Context

Eudaimonia deducts a 1% "eudaimonia" platform fee on top of Endaoment's own 1.5% infrastructure fee and the card processor's ~2.9% + $0.30. The donor sees the breakdown in the order summary (`src/lib/checkout/fees.ts`). The question is *where* the 1% Eudaimonia fee is physically separated from the donation.

Two viable points:

1. **At the processor (fiat side)** — Stripe Crypto Onramp mints USDC for `grossCents − eudaimoniaFee` into the router, and the fiat fee is settled to Eudaimonia's bank via a separate Stripe payout / application fee.
2. **On-chain (router contract)** — Stripe mints USDC for the full `grossCents` into the router, and the router splits the funds: 1% → Eudaimonia treasury wallet, 99% → Endaoment charity contract.

## Decision

**Take the 1% Eudaimonia fee on-chain inside `TransparentDonationRouter.sol`.** Stripe Crypto Onramp is configured with `destination_amount` corresponding to the full donor-paid `grossCents` (minus only Stripe's own card fee, which Stripe deducts implicitly). The router contract then performs the 1%/99% split atomically before forwarding to the Endaoment charity contract.

```
Donor pays grossCents (USD)
      │
      ▼  (Stripe processes card, takes its ~2.9% + $0.30)
Stripe mints USDC ≈ (grossCents − Stripe card fee) into router on Base
      │
      ▼  (router.split() — single tx, atomic)
      ├── 1% → Eudaimonia treasury wallet
      └── 99% → Endaoment charity contract → vetted charity node
```

## Rationale

- **Auditability beats convenience.** The product's central promise is *transparency*. A donor (or a journalist, or a regulator) can verify the 1%/99% split by reading a single on-chain transaction on Base — no Stripe dashboard access required, no trust in our reconciliation pipeline. This is the differentiator vs. "Donate $X via card and trust us."
- **Single source of truth for fee math.** With one split point in the router, `src/lib/checkout/fees.ts` (display) and the smart-contract code (enforcement) can be unit-tested against the same numbers. Splitting the fee across fiat + chain introduces two ledgers that must agree.
- **Stripe-side complexity stays low.** No application-fee plumbing, no separate connected-account routing, no per-charity destination accounts. Stripe sees a single donation amount and a single destination address (the router). This matches Stripe Crypto Onramp's flat happy path.
- **Refunds and edge cases are simpler on-chain.** Failed/expired sessions don't move USDC at all, so there's nothing for the router to split. Partial refunds are not in scope for MVP; if they ever are, refunds are a router-contract concern only.
- **Endaoment compatibility.** Endaoment expects to receive donations at the charity address, not at a fee-split application account. Pulling the fee off-chain first would require either (a) marking the donation amount differently in Endaoment's records (off-mission for an MVP) or (b) reconciling two ledgers monthly.
- **Tax/receipting story.** The donor's tax-deductible amount is exactly what the Endaoment contract receives (99% of gross). Receipts can show the on-chain tx as evidence, and the deductible amount is unambiguous. With a fiat-side fee split, the deductible amount has to be reconstructed from two systems.

## Consequences

- **Positive:**
  - One immutable on-chain record per donation. Easy to embed in the receipt page (Epic 5/6).
  - The router contract is the only place that needs to know fee percentages — easier to harden and audit.
  - Treasury accumulates fees as USDC on Base; we can convert to USD on our cadence, not Stripe's.
- **Negative:**
  - The router contract is now load-bearing for revenue. A bug that routes 0% to treasury (or 100%) is a real risk. Mitigation: comprehensive Foundry tests with forked Base state, plus a third-party contract audit before mainnet — both in scope for Epic 4.
  - Treasury wallet management (key custody, rotation, multisig) is now a backend operational concern, not just Stripe banking. Mitigation: standard Safe / Gnosis multisig pattern. Out of scope for Epic 3.
  - Gas costs are paid on every donation (router split = one extra internal tx vs. a direct Endaoment send). Negligible on Base (sub-cent) but should be measured.
- **Operational:**
  - The Eudaimonia fee constant **must be hardcoded in the router** (per `CLAUDE.md`: "Maintain a strict, hardcoded platform fee deduction (e.g., 1%) in the routing contract before passing funds to Endaoment."). No admin function to change it post-deploy without a governed upgrade path.

## Alternatives considered

- **Fiat-side fee via Stripe application fees** — rejected on transparency and reconciliation grounds described above.
- **Hybrid: take Stripe's card-processing fee at the processor (already implicit) AND take the Eudaimonia fee at the processor as a separate line** — adds Stripe application-fee plumbing without buying the transparency we'd lose. No reason to do this.
- **Take the fee in fiat *and* mirror it on-chain for transparency** — pure overhead. Two ledgers to reconcile, no donor-facing benefit.

## Follow-ups

- Epic 4 owns the router implementation. Phase 3 tests in that epic must include: 1%/99% split exact-rounding, zero-amount donation reverts, treasury address change requires governance, and re-entrancy guards on the Endaoment forwarding call.
- The on-chain fee constant lives in `TransparentDonationRouter.sol` only. `src/lib/checkout/fees.ts` must derive its display number from the same constant once the contract is wired (Epic 4 will add a `src/lib/contracts/router.ts` that exposes it).
- Reconfirm at Epic 5/6 (receipts) that the on-chain split tx is the single artifact we cite on the receipt page.

## Amendment (2026-08-19) — how the split is actually triggered

The diagram above says "`router.split()` — single tx, atomic", but Stripe
Crypto Onramp settles with a **plain ERC-20 transfer** to
`destination_wallet_address`: it cannot call a contract function or attach
calldata. The originally implemented router only exposed a pull-based
`donate(org, amount)` (`safeTransferFrom` the caller), so a Stripe settlement
would have landed as an unroutable balance — flagged as the critical finding of
the 2026-08-19 adversarial review.

Resolution (implemented pre-deployment, so no migration was needed):

- The router now also exposes `routeHeld(sessionRef, org, amount)`, callable
  by an owner-appointed **operator** (or the owner as fallback), which splits
  USDC **already held** by the contract 1%/99% and forwards the net via the
  org's `donate()`. Each `sessionRef` (`keccak256` of the Stripe session id)
  is consumed exactly once on-chain, making webhook double-fires harmless.
- The settlement tx (Stripe → router) and the split tx (`routeHeld`) are now
  **two on-chain transactions**. The transparency promise holds: the split is
  still a single atomic on-chain tx, emitting
  `HeldDonationRouted(sessionRef, org, gross, fee, net)`, and receipts should
  cite the `routeHeld` tx (settlement tx proves arrival, `routeHeld` tx proves
  the split).
- The wallet-donor path (`donate`) is unchanged and remains single-tx.
- Follow-up: automate the settled-webhook → `routeHeld` trigger with a backend
  relayer job holding the operator key (which never custodies funds). Until it
  ships, routing is a manual operator action documented in
  `prompts/HUMAN-ACTIONS.md`.
- Follow-up (review 2026-08-19, security HIGH / code-review MEDIUM — must land
  WITH or BEFORE the relayer automation): `routeHeld`'s `(sessionRef, org,
  amount)` triple is caller-supplied and bounded only by the router's POOLED
  balance, not per session — the contract cannot observe plain ERC-20
  settlements. With multiple unrouted settlements in flight, a mis-keyed or
  compromised-operator call can consume other sessions' held funds (only
  toward allowlisted orgs) and permanently consume a `sessionRef`. Planned
  hardening for the relayer epic: a per-session commitment step (register the
  expected `(sessionRef, org, amount)` when the webhook confirms settlement;
  `routeHeld` executes only registered commitments), plus receipt-decoder
  cross-verification of `HeldDonationRouted` against the Stripe session
  record. Interim operational controls: route sessions one at a time,
  verifying org + 6-decimal amount against the Stripe dashboard before each
  send (runbook step 5.4).
