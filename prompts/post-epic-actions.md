# Post-Epic Action Backlog

> **Purpose:** Single home for (1) the **human-only go-live checklist** — external accounts, credentials, funded keys, on-chain actions, and legal/compliance work that an agent *cannot* do for you — and (2) deferred engineering follow-ups and open decisions accumulated across Epics 1–6. Per project decision, these are **not actioned mid-epic** — they are revisited **after all planned epics are shipped**.
> **Status:** OPEN backlog — last updated 2026-09-10 (engineering rows reconciled against `main` @ `08e02f7`; resolved rows moved into each section's "Resolved" note). Operator steps for Epics 3/4 live in [HUMAN-ACTIONS.md](HUMAN-ACTIONS.md). **Next engineering epic:** the settled-webhook → `routeHeld` relayer + per-session commitment (ADR 0002 amendment) — not yet planned.
> **Convention:** Each item links its origin (epic plan, env line, or runbook) and a one-line trigger/condition for when it becomes actionable. `VERIFY` = needs a quick confirmation it isn't already resolved.

---

## 🔑 Human-Only Go-Live Checklist (an agent cannot do these)

> Everything below requires a real account, a funded wallet, a signed legal document, or an irreversible on-chain broadcast. None of it can be completed from inside the codebase — it needs **you**, with credentials and judgment. Work top-to-bottom; later groups depend on earlier ones (accounts → keys → deploy → wire-up → launch).

### A. Accounts & API keys to register

| ✓ | Service | What to do | Lands in |
|---|---|---|---|
| ☐ | **Stripe Crypto Onramp** | Create/verify a Stripe account and **apply for Crypto Onramp access** (gated — needs business/KYB approval, not instant). Grab the **live** secret key, then create a webhook endpoint subscribed to `crypto.onramp_session.*` and copy its signing secret. | `STRIPE_SECRET_KEY`, `STRIPE_ONRAMP_WEBHOOK_SECRET` (`.env` 18–22) |
| ☐ | **RPC provider** (Alchemy / QuickNode) | Public `*.base.org` endpoints are dev-only and will rate-limit under real load. Register and create authenticated Base **mainnet** + **Sepolia** app URLs. | `NEXT_PUBLIC_BASE_RPC_URL`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` (`.env` 9–12) |
| ☐ | **Vercel KV / Upstash Redis** | Provision a KV store (replaces the MVP in-memory session store — see E3.1) and run `vercel env pull` to populate credentials. | `KV_REST_API_URL`, `KV_REST_API_TOKEN` (`.env` 24–27) |
| ☐ | **Basescan API key** | Register at basescan.org/myapikey for contract source verification during deploy. | `BASESCAN_API_KEY` (`DEPLOY.md` §Environment) |
| ☐ | **Sentry project + DSN** | Create a Sentry project (Next.js platform). Copy the DSN for both server and client; optionally generate a `SENTRY_AUTH_TOKEN` for prod source-map upload. After deploy, hit `GET /api/debug/sentry` (gate via `SENTRY_DEBUG_ROUTE_ENABLED=true` in non-prod) and confirm the event lands in Sentry — this is the Epic 7 acceptance check. | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, optional `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` (Epic 7 / 1B) |

### B. Wallets, keys & on-chain identities (funds + judgment required)

| ✓ | Item | What to do |
|---|---|---|
| ☐ | **Funded deployer key** | Fund a deployer account: testnet ETH for Base Sepolia, **real ETH** for Base mainnet. Use a keystore/Ledger, never a pasted plaintext key for mainnet. (`DEPLOY.md` §Prerequisites) |
| ☐ | **Treasury address** | Decide the address that receives the 1% platform fee. **Immutable once the router is deployed** — choose deliberately, ideally a multisig you control. (`DEPLOY.md` §2) |
| ☐ | **Owner / allowlist multisig** | Stand up a Safe multisig on Base mainnet to be `OWNER_ADDRESS`. The owner curates which Endaoment orgs can receive funds; review M4 mandates a **multisig in production**, not an EOA. (`DEPLOY.md` §Environment, H1/M4) |

### C. Endaoment data & relationship

| ✓ | Item | What to do |
|---|---|---|
| ☐ | **Real org Entity addresses** | Source and confirm the on-chain Entity address for each charity (PCRF / WCK / Direct Relief) on Base **and** Base Sepolia via Endaoment's `OrgFundFactory` / integration API, and confirm each one's `baseToken()` is canonical Base USDC. **Blocks acceptance** — see E5.1. Until done, `verifyDonation` returns `verified:false` and the "Verified by Endaoment" badge cannot pass. |
| ☐ | **Endaoment integration access** | Confirm whether production REST API use needs an account/partner key or any rate-limit allowance from Endaoment, and that the orgs you intend to route to are live on their platform. (`ENDAOMENT_API_URL`, `.env` 49–55) |

### D. Irreversible deploy & on-chain config (operator runbook: `contracts/DEPLOY.md`)

| ✓ | Step | What to do |
|---|---|---|
| ☐ | **Deploy to Base Sepolia first** | Run `forge script Deploy.s.sol --verify`, send a sample donation, confirm the 1/99 split on Basescan. (`DEPLOY.md` §1) |
| ☐ | **Deploy to Base mainnet** | Same command, mainnet USDC + RPC. **Double-check `TREASURY_ADDRESS` before broadcasting — immutable.** (`DEPLOY.md` §2) |
| ☐ | **Allowlist each org** | From the owner multisig, call `setOrgAllowed(<org>, true)` per charity. A fresh router has an **empty allowlist — every donation reverts with `OrgNotAllowed` until you do this.** (`DEPLOY.md` §3) |
| ☐ | **Wire deployed addresses into prod env** | Set `NEXT_PUBLIC_ROUTER_ADDRESS_BASE` / `_BASE_SEPOLIA` to the deployed addresses. (`DEPLOY.md` §4; un-gates E4.1 fork test) |

### E. Hosting & domain

| ✓ | Item | What to do |
|---|---|---|
| ☐ | **Production environment** | Set every server secret in the host (Vercel) project settings — secrets stay **server-only**, never `NEXT_PUBLIC_*`. Set `NEXT_PUBLIC_CHAIN=base` for production. |
| ☐ | **Custom domain + DNS** | Attach the production domain and configure DNS / TLS at the host. |
| ☐ | **CSP verification via securityheaders.com** | After the first prod deploy, run the production URL through https://securityheaders.com/ and confirm the page scores A or A+ with the Epic 7 / 1D nonce-based CSP applied. Cross-check the headers tab against the directive list in `src/lib/security/headers.ts` (`buildCsp`). Final Epic 7 acceptance criterion. |

### F. Legal, compliance & trust (founder / counsel — not engineering)

| ✓ | Item | What to do |
|---|---|---|
| ☐ | **Charitable-solicitation / fundraising registration** | A platform soliciting donations may need state/jurisdiction fundraising registration. Confirm with counsel which apply. |
| ☐ | **Money-transmission / MSB analysis** | Routing fiat → stablecoin → charity may trigger money-transmitter / MSB obligations. Get a legal read **before** taking live payments. |
| ☐ | **Terms of Service + Privacy Policy** | Publish both; cover data handling for Stripe/onramp PII and the on-chain nature of donations (irreversible, public). |
| ☐ | **Tax-receipt responsibility** | Endaoment is the 501(c)(3) of record — confirm in writing **who issues the donor's tax receipt** and that the UI represents it accurately. |
| ☐ | **Fee-disclosure sign-off** | Product/legal sign-off that the donor-facing fee breakdown (Eudaimonia 1% + processor + Endaoment overhead) is accurate and consistent end-to-end. Ties to X2 / E2.1. |

---

## Cross-cutting

| # | Item | Origin | Trigger / Notes |
|---|---|---|---|
| X1 | ESLint backlog set to `continue-on-error` in CI | Epic 5 validation note | Clear the lint backlog and flip CI to fail-on-error once the noise is triaged. |
| X2 | Confirm fee math is consistent end-to-end | Epic 2 (HIGH risk) | Epic 2 row labels (Eudaimonia 1%, Endaoment overhead, card processing) were illustrative. Now that Epic 3 (processor fee) and Epic 4 (router hardcoded 1%) have shipped, lock the exact percentages in `fees.ts` constants and reconcile all three against product. |

---

## Epic 1 — Landing ([plan](prompts/epic-1-landing-plan.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
> Resolved (no action): E1.1 `LiveReceiptStrip` wired with a mainnet-only mount (#37); `CreamBand`, `HowItWorks`, `ClosingCTA`, `AuthorityStrip` shipped in follow-ups; Endaoment Org ID `TODO-*` stubs removed in Epic 5 Task 1.

---

## Epic 2 — Checkout ([plan](prompts/epic-2-checkout-plan.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E2.1 | Fee percentages locked by product | OPEN | See X2 — single named-constants block in `fees.ts`, reviewed by Epic 3/4 owners. |
| E2.2 | 4-stage `ProcessingStrip` / richer receipt stage composition | OPEN | Originally deferred Epic 2→3→5. Epic 5 built the live processing screen + receipt route, but **off-chain swap/settlement stages** the `DonationRouted` event does not carry remain a follow-up (see E5.4). |

> Resolved (no action): `stubSubmit` handoff replaced by `realSubmit` in Epic 3.

---

## Epic 3 — On-ramp ([plan](prompts/epic-3-onramp-plan.md) · [remediation](prompts/epic-3-onramp-remediation-plan.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E3.4 | Automate settled-webhook → `routeHeld` (relayer) + per-session commitment | OPEN — **next epic** | Settled on-ramp USDC sits held in the router until an operator runs `routeHeld` by hand (HUMAN-ACTIONS §5.4). `routeHeld` can only bound `amount` at the pooled balance (review S1); the per-session commitment design ships with the relayer. See `docs/adr/0002-fees-on-chain.md`. |

> Resolved (no action): E3.1 Vercel KV session store (`src/lib/kv/vercel-kv-store.ts`, PR #25); E3.2 server-side rate limiting on `/api/onramp/session` (`src/lib/ratelimit/`); E3.3 webhook-handler comment now states the route acks with 200 (confirmed 2026-09-10); L2 dead `stubSubmit.ts` deleted.

---

## Epic 4 — TransparentDonationRouter ([#5](https://github.com/mnkprs/donate/issues/5) · [plan](prompts/epic-4-router-plan.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E4.1 | Run the fork suite in CI | OPEN (optional) | `RouterFork.t.sol` ran green on a live Base mainnet fork 2026-08-19 (#52), but still `vm.skip`s in CI because `BASE_RPC_URL` / `ENDAOMENT_ORG` aren't set there. Add them as CI secrets (pinned `FORK_BLOCK`) if you want it gated on every PR. |

> Resolved (no action): Task 7 receipt-decoder handshake (`DonationRouted` event shape) complete; consumed by Epic 5.

---

## Epic 5 — Endaoment Integration ([#6](https://github.com/mnkprs/Philotimo/issues/6) · [plan](prompts/epic-5-endaoment-plan.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E5.1 | **Commit Base mainnet org Entity addresses** (PCRF / WCK / Direct Relief) | OPEN — before mainnet | Base **Sepolia** addresses are wired (#38). **Mainnet** addresses were resolved and verified live 2026-08-19 (table in [HUMAN-ACTIONS.md §2](HUMAN-ACTIONS.md)) but are **not yet in `src/`** — commit them to `snapshot.json` / `orgs.ts` so mainnet `verifyDonation` can pass. |
| E5.2 | Fallback-policy granularity in `metadata.ts` | OPEN (decision) | Current policy: **any** API error → snapshot fallback; throw only when neither source has the EIN. Decide whether to distinguish retryable (503 → retry) from terminal (404 → skip fallback, throw). One-spot change in the catch block; case (a)/(b)/(c) tests unaffected. |
| E5.3 | Narrow `EndaomentOrgMetadata.mainnetAddress` back to `Address` | OPTIONAL | Widened to `Address \| null` to support the no-address state (E5.1). Narrow once real addresses are sourced, if a non-null guarantee is wanted. tsc currently clean either way. |
| E5.4 | Richer 5-stage receipt composition | OPEN (follow-up) | `/receipt/[txid]` resolves charity name + verification badge + on-chain gross/fee/net. Off-chain swap/settlement stage fields the `DonationRouted` event does not carry are out of Epic 5 scope. Ties to E2.2. |

> Implemented & green this session (no action): REST client, metadata + snapshot fallback, on-chain verification helper, Endaoment badge + attribution, `/receipt/[txid]` route. Full suite 623/623, `tsc --noEmit` clean.

---

## Epic 6 — Live Transparency Receipt Page ([#7](https://github.com/mnkprs/Philotimo/issues/7) · [plan](prompts/epic-6-receipt-page-plan.md) · [review](.claude/reviews/epic-6-receipt-review.md))

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E6.1 | **Thread an explicit `chainId` into server-side OG metadata** | RESOLVED (#26) | `loadReceiptForMetadata` now requires `chainId` and throws on a non-finite value. Original note — review H4. `loadReceiptForMetadata` defaults `chainId` to `baseSepolia.id`, and both callsites — `generateMetadata` (`app/receipt/[txid]/page.tsx`) and the OG image route (`opengraph-image.tsx`) — omit it. On Base **mainnet** this silently reads against Sepolia (`getRouterAddress` returns the Sepolia router; verification fails for real donations → generic fallback card). Latent today (whole app runs on Sepolia). Fix: source `chainId` from env (`NEXT_PUBLIC_CHAIN`) / route / searchParam and pass it explicitly; make the function default fail loudly instead of falling back to testnet. Ties to the `NEXT_PUBLIC_CHAIN=base` go-live step (§E). |
| E6.2 | Harden the network label in `buildReceiptBundle` | RESOLVED (#26) | Unknown chain ids now render `"Unknown"`. Original note — review M2. `input.chainId === 8453 ? "Base" : "Base Sepolia"` labels **any** non-mainnet id as "Base Sepolia" — misleading on a transparency receipt for a misconfigured/unknown chain. Fix: match `base.id` / `baseSepolia.id` explicitly from `wagmi/chains` and surface "Unknown" for anything else. Cheap and unambiguous; bundled here only because it shares the mainnet-readiness theme with E6.1. |

> Fixed & green this session (no action): review H1 (ESLint `set-state-in-effect` error in `useReceipt`), H2 (`PizzaTracker` keyboard/touch a11y for fee detail), H3 (`ReceiptSkeleton` `role="status"`/`aria-live`), M4 (gross-side fee-split invariant guard in `verify.ts` + `decodeReceipt.ts`) and M1 (`verifyDonation` throw-surface JSDoc). Full suite 755/755, `tsc --noEmit` + ESLint clean, `next build` passing. Remaining review MEDIUM/LOW items (M3 `formatUnits` precision, M5 server `notFound()` for malformed txid, M6 `React.cache()` dedup, function-length, magic-number LOWs) left as optional polish in the [review doc](.claude/reviews/epic-6-receipt-review.md).

---

## Epic 7 — Production Readiness ([#8](https://github.com/mnkprs/Philotimo/issues/8) · [plan](prompts/epic-7-production-readiness-plan.md))

Code-side hardening has shipped on `epic-7-production-readiness` (waves 1–4: CI build gate, legal pages, runbook, deploy docs, Sentry, Vercel Analytics, Lighthouse perf budget, nonce-based CSP). The remaining items are either **human-gated** (see Sections A / E / F above) or **engineering follow-ups** tracked as GitHub issues — none can be closed from inside the repo without the corresponding external action.

| # | Item | Status | Trigger / Notes |
|---|---|---|---|
| E7.1 | Provision real Sentry DSN + verify `/api/debug/sentry` end-to-end | OPEN — **acceptance** | Code path is in place (`@sentry/nextjs` v10 init in `src/instrumentation.ts` / `src/instrumentation-client.ts`, capture wired into `webhook-handler.ts` and `loadReceiptForMetadata.ts`, safe no-op without DSN). Closes when section A "Sentry project + DSN" is done **and** a manual GET of `/api/debug/sentry` (or `SENTRY_DEBUG_ROUTE_ENABLED=true` non-prod) appears in Sentry. |
| E7.2 | First production deploy + securityheaders.com check | OPEN — **acceptance** | Deploy + URL via section E. Run https://securityheaders.com/ on the prod URL and confirm A/A+ score. |
| E7.3 | Scrub PII (Stripe session id) from captured webhook errors via Sentry `beforeSend` | RESOLVED (#35, closes #29) | The webhook handler's hash-less-settlement error message contains the Stripe session id; it would surface in Sentry event titles once a real DSN lands. Add a `beforeSend` hook in `src/instrumentation.ts`/`*.config.ts` that strips known PII fragments. Tracked as a GitHub issue (Epic 7 / 1B follow-up). |
| E7.4 | Validate Lighthouse `perf ≥ 0.90` on `/`, `/donate/<slug>`, `/receipt/<txid>` after `force-dynamic` on landing | RESOLVED (#30 closed; Lighthouse gate green on PRs) | `lighthouse.yml` will run on the next PR. Force-dynamic on landing (required for nonce-CSP) may regress LCP/TBT — plan risk R2. If the gate fails, address with image/font/JS-budget fixes in a separate PR. Tracked as a GitHub issue. |
| E7.5 | Security-reviewer pass on `epic-7-production-readiness` before merge | RESOLVED (#31 closed) | Per project rules, security-sensitive slices need a `security-reviewer` agent pass: commit `3f6a163` (Sentry capture surfaces + PII surface) and commit `3dce7f6` (CSP host coverage + nonce middleware). Tracked as a GitHub issue. |
| E7.6 | Fix or remove the footer `/fee-policy` link | RESOLVED (#34, closes #32) | `src/components/landing/Footer.tsx` links to `/fee-policy`, but no route exists. Either create the page (likely sourcing from `FeeDisclosure`) or remove the link. Pre-existing — surfaced by Epic 7 / 2B. Tracked as a GitHub issue. |
| E7.7 | Phase 0 — tick E6.1, E6.2, and "CI green on main with build step" boxes on issue #8 | RESOLVED (#8 closed) | Code is shipped + tested (PR #26 for E6.1/E6.2; this branch's wave 1 for the CI build step). Run `npm test` to confirm, then update the issue checkboxes with commit-link evidence. |
| E7.8 | Legal counsel sign-off on `/terms`, `/privacy`, fee disclosure | OPEN | Draft copy shipped (`src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `src/components/legal/FeeDisclosure.tsx`). Closes via Section F rows (Terms/Privacy + Fee-disclosure sign-off). |

> Resolved: `scripts/fetch-endaoment-orgs.mjs` was accepted and committed with #38 (used to fetch the Sepolia org entities).

> `style-src 'unsafe-inline'` is a deliberate CSP concession (Tailwind / Next inject inline styles); documented in `src/lib/security/headers.ts`. Not tracked as an action — accept-and-document.
