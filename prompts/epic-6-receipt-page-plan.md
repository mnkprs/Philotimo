# Epic 6 — Live Transparency Receipt Page (Pizza Tracker) — TDD Plan

> **GitHub issue:** [#7 — Epic 6 — Live transparency receipt page (Pizza Tracker)](https://github.com/mnkprs/Philotimo/issues/7)
> **Status:** IMPLEMENTED (Tasks 0–8) on `epic-6-receipt-page` via parallel TDD waves — 745 tests green, `tsc` clean. Task 0 uses a **mock two-transfer fixture** (`src/lib/receipt/fixtures.ts`); live Base Sepolia broadcast + verification remain **deferred** (R2). Task 9 (Playwright responsive/a11y sweep) **skipped** — verify manually. **Merged in #24** (mainnet-correctness fixes #26); issue #7 closed. Remaining follow-ups live in `prompts/post-epic-actions.md` (E6.x).
> **Branch:** `epic-6-receipt-page`, to be created off `epic-5-endaoment` (Epic 6 consumes the `src/lib/endaoment/*` layer that has not yet merged to `main`).
> **Depends on:** Epic 4 (router + `DonationRouted`), Epic 5 (charity registry, metadata, `verifyDonation`, `EndaomentBadge`).
> **Open / load-bearing items:**
> 1. **Real org Entity addresses (E5.1)** are still unconfirmed — verification returns `no-org-address-for-chain` until they land. Task 0 deploys a router to Base Sepolia against a real (or mock) Endaoment Entity and records a canonical donation txid to drive acceptance + tests.
> 2. **`verify.ts` settlement assertion is wrong for a real Entity.** It asserts a single `Transfer(_, org, net)`; the real Endaoment Entity skims its own fee, so the entity receives `net − endaomentFee` and the assertion fails. Epic 6 reconciles this (Task 2) — it currently passes only because the test mock forwards the full `net`.

## Context

Epic 6 turns the `/receipt/[txid]` scaffold (built during Epic 5 to satisfy that
epic's acceptance) into the **live, shareable "Pizza Tracker"** the issue
describes. Today the route is a server component that renders a bare
`CharityCard` with mostly `—` placeholders plus a raw `<dl>` of gross/fee/net.
The full receipt composition — `EudaimoniaReceipt` (Hero + `PizzaTracker` +
`CharityCard` + `VerificationCard` + `ShareRow` + `Footer`) — already exists but
**is mounted on no route**. Epic 6 wires it to live on-chain data.

### What the on-chain reality actually is (verified against the contracts)

The router's `donate(address endaomentOrg, uint256 amount)`
(`contracts/src/TransparentDonationRouter.sol:117`) is **USDC-only, single-block,
atomic**:

```
usdc.safeTransferFrom(donor → router, amount)   // gross in
usdc.safeTransfer(treasury, fee)                // Eudaimonia 1% (router `fee`)
usdc.forceApprove(org, net)
IEndaomentEntity(org).donate(net)               // Endaoment fee + accounting on-chain
emit DonationRouted(donor, org, amount, fee, net)
```

`IEndaomentEntity(org).donate(net)` uses Endaoment's **two-transfer pull model**
(verified: `endaoment-contracts-v2@02c7557 Entity.sol:156-166`): the entity pulls
twice from the router's single allowance — `router → Endaoment treasury` (its
fee) and `router → entity` (the remainder) — summing to `net`.

So a real receipt contains these ERC20 `Transfer` logs:

| # | from → to | value | maps to |
|---|---|---|---|
| 1 | donor → router | `gross` | Stage 1 "Donated" (USDC in) |
| 2 | router → Eudaimonia treasury | `fee` | Stage 4 "Eudaimonia fee" (**active**) |
| 3 | router → Endaoment treasury | `endaomentFee` | Stage 3 "Routed" — Endaoment's cut |
| 4 | router → entity | `net − endaomentFee` | Stage 5 "Settled" (final to charity) |

Consequences that drive every decision below:

- **Stage 2 ("Converted", ETH→USDC) and the fiat origin of Stage 1 are
  off-chain** (Epic 3 onramp). There is no ETH leg, swap pool, or rate in the
  tx. Per decision **D1**, Stage 1 is recast as "Donated (USDC in)" from
  `msg.sender` + `gross`; Stage 2 is rendered as informational off-chain
  provenance. **No fabricated ETH/rate values.**
- **All stages settle in one block** → one block timestamp. The fixtures'
  `+1s/+2s` offsets are design fiction. Per decision **D5**, stages are ordered
  by **log index**; relative labels become `"same block"` (the active/pending
  stage during polling still shows a live counter).
- The router `fee` is the **Eudaimonia 1%**, so Stage 4 is **active** for a real
  router tx (`eudaimoniaFeeActive: true`) — not the inactive "future" copy.
- Endaoment's fee is **decodable on-chain** (transfer #3), satisfying decision
  **D2**.

## Decisions Locked In

| # | Question | Decision | Source |
|---|---|---|---|
| D1 | Off-chain legs (stages 1–2) | **Recast as USDC provenance.** Stage 1 = "Donated (USDC in)" from `gross` + donor; Stage 2 = off-chain onramp shown as informational (no fabricated ETH/rate). Stages 3–5 fully live. | User |
| D2 | Fee semantics | **Decode Endaoment's 1.5% on-chain** from the `router → Endaoment-treasury` transfer; Stage 4 (Eudaimonia 1%) from router `fee`. Both asserted, not estimated. | User |
| D3 | Acceptance | **Task 0: deploy router to Base Sepolia + execute one fixture donation;** record that txid as the canonical acceptance + test fixture. | User |
| D4 | Rendering | **Full client wagmi + per-stage skeletons.** Page body is a client component reading via wagmi; five stages resolve as reads complete. `generateMetadata` + `opengraph-image` stay server-side (App Router runs them independently of a client page body). | User |
| D5 | Stage timing | **Single block.** Order by log index; relative = `"same block"`. No fabricated per-stage timestamps. | Advisor + contract reality |
| D6 | `/` demo | The issue's "replace fixtures-driven `/` demo" line is **stale** — `/` is the landing page; `EudaimoniaReceipt` is mounted nowhere. Reinterpreted as "mount the live receipt at `/receipt/[txid]`; keep `RECEIPT_FIXTURE` for tests." | Advisor + codebase audit |

## Target Architecture

```
src/lib/receipt/
├── decodeReceipt.ts        decodeRouterReceipt(receipt, routerAddr, orgAddr):
│                           classifies the 4 Transfer logs by (from,to) into
│                           { gross, eudaimoniaFee, endaomentFee, netToEntity },
│                           cross-checks against DonationRouted. Pure(ish): takes
│                           a viem receipt + addresses, no I/O.
├── decodeReceipt.test.ts   4-transfer happy path; fee-skim entity; legacy
│                           single-transfer mock; wrong-router; missing legs.
├── buildReceiptBundle.ts   composes decodeRouterReceipt + getCharity +
│                           resolveOrgMetadata + getBlock(ts/confirmations) into
│                           the existing ReceiptBundle (ReceiptData + Stage[] via
│                           buildStages). Maps D1/D2/D5 → field values.
├── buildReceiptBundle.test.ts
└── fixtures.ts             recorded Sepolia receipt JSON (Task 0 output) +
                            expected ReceiptBundle for deterministic tests.

src/lib/endaoment/
└── verify.ts               EXTEND: (a) assert routedLog.address ===
                            getRouterAddress(chainId) → new reason "wrong-router";
                            (b) replace single-transfer assertion with
                            "sum of router→{Endaoment-treasury, entity} === net"
                            so a real fee-skimming Entity verifies. Add
                            endaomentFee to the verified result.

src/hooks/
├── useReceipt.ts           'use client' wagmi/viem hook: reads tx + receipt +
│                           block, builds bundle, POLLS while receipt is not yet
│                           indexed (404 → backoff) until terminal. Returns
│                           discriminated state: loading | pending | not-found |
│                           wrong-network | wrong-router | unverified | ready.
└── useReceipt.test.ts

src/components/receipt/
├── ReceiptView.tsx         'use client' presentation: maps useReceipt state →
│                           EudaimoniaReceipt (ready) or per-stage skeletons
│                           (loading/pending) or an ErrorCard (the failure
│                           states). Per-stage skeleton = PizzaTracker stages in
│                           a "queued/active" shimmer.
├── ReceiptView.test.tsx
├── ReceiptSkeleton.tsx     5 shimmer stage cards (no raw spinner) + skeleton
│                           CharityCard/VerificationCard.
├── ErrorCard.tsx           tx-not-found / wrong-network / wrong-router /
│                           unverified messaging with a BaseScan fallback link.
└── ErrorCard.test.tsx

src/lib/explorer.ts          deriveTxUrl(txid, chainId) + deriveLogUrl(...) for
                             real BaseScan deep links per stage (extends the
                             existing deriveBaseScanUrl in the endaoment registry).

src/app/receipt/[txid]/
├── page.tsx                SERVER shell: parse params, render <ReceiptView/>.
├── page.test.tsx           EXTEND existing.
├── opengraph-image.tsx     server OG image (charity name + amount + "Verified").
└── (generateMetadata)      Twitter/X + Open Graph share tags in page.tsx.
```

Reused as-is: `EudaimoniaReceipt`, `PizzaTracker`, `CharityCard`,
`VerificationCard`, `ShareRow`, `Hero`, `Footer`, `buildStages`,
`getPublicClient`, `getCharity`, `resolveOrgMetadata`, `EndaomentBadge`.

## Tasks (TDD — RED → GREEN → REFACTOR per task)

**Task 0 — Seed a real Sepolia donation (D3).** Deploy `TransparentDonationRouter`
to Base Sepolia (Foundry script), owner-allowlist a test Endaoment org Entity,
approve + `donate()` a small USDC amount. Record the txid, the full
`getTransactionReceipt` JSON, and the resolved org address into
`src/lib/receipt/fixtures.ts` and the plan's status line. _Acceptance + every
downstream test asserts against this recorded receipt._ If a live Sepolia Entity
is unavailable, fall back to a mock Entity that reproduces the two-transfer pull
model, and flag live verification as deferred.

**Task 1 — `decodeRouterReceipt` (pure).** RED: tests for the 4-transfer happy
path, the fee-skimming entity, the legacy single-transfer mock, a foreign router
address, and missing legs. GREEN: classify logs by `(from,to)` against router +
treasury + org addresses; cross-check totals against `DonationRouted`.

**Task 2 — Harden `verify.ts`.** RED: add `wrong-router` (routed log not from
`getRouterAddress(chainId)`) and a real-Entity case where the entity receives
`net − endaomentFee`. GREEN: add the router-address assertion; relax the transfer
check to "router-out transfers to {Endaoment treasury, entity} sum to `net`";
surface `endaomentFee` on the verified result. Keep existing mock tests green.

**Task 3 — `buildReceiptBundle`.** RED: given the Task 0 receipt + a charity,
expect a `ReceiptBundle` with D1 (USDC-in stage 1, off-chain stage 2), D2 (both
fees populated), D5 (one block ts, `"same block"` relatives), `eudaimoniaFeeActive:
true`, real block/confirmations. GREEN: compose decode + registry + metadata +
`getBlock`; map into `ReceiptData` + `buildStages`.

**Task 4 — `explorer.ts` deep links.** RED: `deriveTxUrl`/`deriveLogUrl` for Base
+ Base Sepolia. GREEN: implement; wire per-stage "Verify ↗" hrefs through
`PizzaTracker`/`VerifyLink` (currently hrefless).

**Task 5 — `useReceipt` hook (client).** RED: loading→ready, receipt-404→pending
→ready (poll/backoff), wrong-network, wrong-router, unverified, not-found.
GREEN: wagmi/viem reads + bounded polling until terminal (confirmations ≥
threshold or non-retryable error). Cap attempts; honor `prefers-reduced-motion`.

**Task 6 — `ReceiptSkeleton` + `ErrorCard`.** RED: skeleton renders 5 shimmer
stages (no raw spinner); ErrorCard renders each failure with a BaseScan fallback.
GREEN: implement using existing tokens/components.

**Task 7 — `ReceiptView` + route wiring.** RED: state → correct render
(skeleton / EudaimoniaReceipt / ErrorCard). GREEN: assemble; replace the bare
`page.tsx` scaffold with `<ReceiptView/>`. Keep `RECEIPT_FIXTURE` for tests (D6).

**Task 8 — `generateMetadata` + `opengraph-image`.** RED: metadata includes OG +
`twitter:card` with charity/amount; OG route returns an image response. GREEN:
implement server-side (independent of the client page body, D4).

**Task 9 — Responsive + a11y sweep.** Playwright screenshots at 320/375/768/1024/
1440 (issue requirement); verify no overflow, keyboard nav, reduced-motion. Reuse
the breakpoint discipline already documented in `LiveTracker`.

## Risks

- **R1 (HIGH) — `verify.ts` real-Entity mismatch.** Already-shipped assertion
  fails against a fee-skimming Entity. Task 2 must land before Task 3 or live
  verification is impossible. _Mitigation: Task 2 ordered early; Task 0 fixture
  exercises the real two-transfer shape._
- **R2 (HIGH) — E5.1 org addresses.** Without real Base/Sepolia org addresses,
  verification is `no-org-address-for-chain`. Task 0 sources at least one Sepolia
  address; Base remains gated on E5.1.
- **R3 (MED) — D4 vs OG/SEO.** A fully client page body can't be crawled for
  share previews. _Mitigation: `generateMetadata` + `opengraph-image` are
  server-side and txid-derived (Task 8), independent of the client body._
- **R4 (MED) — polling cost / RPC limits.** Unbounded polling hammers the RPC.
  _Mitigation: bounded attempts + backoff, stop at terminal (Task 5)._
- **R5 (LOW) — Endaoment fee-multiplier = 0.** Some Entities take no fee →
  transfer #3 absent. _Mitigation: decode treats `endaomentFee` as `0` when the
  treasury transfer is absent; Stage 3 renders "no Endaoment fee on this tx."_

## Acceptance Mapping (issue → task)

| Acceptance / in-scope item | Task |
|---|---|
| `/receipt/[txid]` dynamic route | 7 |
| wagmi reads decoded via stage builder | 1, 3, 5 |
| Loading skeletons per stage (no spinner) | 6, 7 |
| Real BaseScan deep links per stage | 4 |
| Polling until final delivery confirmed | 5 |
| OG image + share metadata | 8 |
| Error states: not-found / wrong-network / wrong-router | 2, 6, 7 |
| Replace `/` demo; keep fixtures for tests | 7 (reinterpreted per D6) |
| Mobile sweep 320/375/768/1024/1440 | 9 |
| "Real Base tx renders all 5 stages correctly" | 0, 3, 9 |

## Branch Hygiene

Create `epic-6-receipt-page` off `epic-5-endaoment` (Epic 6 imports the
unmerged `src/lib/endaoment/*` layer). PR Epic 6 after — or stacked on — Epic 5.
Per `CLAUDE.md`: this plan persists at `prompts/epic-6-receipt-page-plan.md`;
update the status line as tasks complete.
