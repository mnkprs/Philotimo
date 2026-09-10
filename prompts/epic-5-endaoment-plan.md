# Epic 5 — Endaoment Integration — TDD Plan

> **GitHub issue:** [#6 — Epic 5 — Endaoment integration](https://github.com/mnkprs/Philotimo/issues/6)
> **Status:** COMPLETE — Tasks 1–6 merged in #16; Base Sepolia org addresses wired in #38; issue #6 closed. Remaining follow-ups live in `prompts/post-epic-actions.md` (E5.x).
> **Branch:** `epic-5-endaoment` (created off `epic-5-receipt-flow` after committing the in-flight-processing scaffolding per Branch Hygiene below).
> **Open item:** Real Base / Base Sepolia org Entity addresses for PCRF/WCK/Direct Relief are NOT yet confirmed — `ENDAOMENT_ORG_ADDRESSES` ships intentionally empty (no fabricated/zero placeholders). `getCharity` returns `endaomentOrgAddress: null` until verified addresses land (sourced via Task 2/3). The receipt route renders an unverified state for null addresses.
> **Decisions locked (this session):** (1) Sepolia resolves full Endaoment metadata via a **mainnet snapshot keyed by EIN** + a per-chain org **address** map; (2) this issue **includes** the `/receipt/[txid]` route to satisfy acceptance end-to-end.

## Context

Epic 5 turns the receipt from design-fixture data into **live, verifiable Endaoment
data**. Today the receipt components (`CharityCard`, `VerificationCard`,
`EudaimoniaReceipt`) render off `RECEIPT_FIXTURE`; the `Campaign` registry carries
`endaomentOrgId: "TODO-pcrf"` placeholders; and the only on-chain primitive that
exists is `decodeDonationRoutedLog` (Epic 4, `src/lib/contracts.ts`).

This epic adds the data + verification layer that the curated charities need:
real Base org addresses, vetted metadata (name, EIN, mission, logo) fetched from
Endaoment's REST API with an offline snapshot fallback, an on-chain verification
helper, a "Verified by Endaoment" badge, and a `/receipt/[txid]` route that wires
it all together.

The pattern mirrors prior epics: small testable units, RED tests before GREEN,
pure logic where possible, dependency-injected env, deterministic HTTP mocks
(MSW) for the API client, and viem for chain reads.

## Decisions Locked In

| Question | Decision | Source |
|---|---|---|
| Charity registry shape | **One source of truth.** `Campaign` keeps presentation + EIN. Org addresses move to a dedicated **per-chain map** in the endaoment module. `getCharity(id, chain)` joins them into the issue's `Charity` view `{ id, name, endaomentOrgAddress, baseScanUrl }`. No parallel registry. | Advisor + this plan |
| Sepolia metadata | **Mainnet snapshot keyed by EIN.** Metadata (name/EIN/mission/logo) is chain-agnostic; only the org *address* differs per chain. Full badge resolves on Sepolia. | User (this session) |
| Verification semantics | **Two reads.** Decode `DonationRouted` and assert `org === charity.endaomentOrgAddress`; **and** confirm an ERC20 `Transfer(router → org, net)` log exists in the same receipt. | Advisor (acceptance: "the final transfer hit the org contract") |
| Fallback resilience | **Committed JSON snapshot** is the floor (survives outage/cold start). API is preferred when reachable. Optional KV warm layer is out of scope for this issue. | Issue ("use cached snapshot") |
| `/receipt/[txid]` route | **In scope.** Server-component loader composes verification + metadata + registry, renders existing receipt components. | User (this session) |
| RPC client | **Reuse** existing `NEXT_PUBLIC_BASE*_RPC_URL` env (already wired in `wagmi.ts`). Add one viem `createPublicClient` factory. No new RPC env vars. | Codebase audit |

## Target Architecture

```
src/lib/endaoment/
├── orgs.ts            per-chain ENDAOMENT_ORG_ADDRESSES map (Base + Base Sepolia)
├── orgs.test.ts
├── snapshot.json      committed mainnet metadata, keyed by EIN (name, ein, mission, logoUrl, mainnetAddress, capturedAt)
├── api.ts             thin REST client (mirrors stripe.ts): fetchOrgByEin(ein, env) — Zod-validated, timeout, injected base URL
├── api.test.ts        MSW-mocked success + error + timeout
├── metadata.ts        resolveOrgMetadata(ein): API → snapshot fallback (the business-logic decision point)
├── metadata.test.ts   API hit, API-down → snapshot, neither → typed error
├── verify.ts          verifyDonation(txid, charity, chain): receipt → DonationRouted + ERC20 Transfer assertions
├── verify.test.ts     verified, org-mismatch, missing-transfer, no-routed-log
└── registry.ts        getCharity(id, chain) → Charity view; deriveBaseScanUrl(address, chain)
src/lib/
└── publicClient.ts    createPublicClient factory keyed by chain (reuses RPC env)
src/types/
└── charity.ts         Charity, EndaomentOrgMetadata, VerificationResult
src/components/brand/
├── EndaomentBadge.tsx        "Verified by Endaoment" badge
└── EndaomentBadge.test.tsx
src/app/receipt/[txid]/
├── page.tsx           server component: loader + render
└── page.test.tsx
```

Changes to existing files:
- `src/types/campaign.ts` — drop stub `endaomentOrgId`; addresses move to `orgs.ts`.
- `src/lib/campaigns.ts` — remove `TODO-*` org-id literals.
- `src/lib/env/server.ts` — add `ENDAOMENT_API_URL` (defaulted).
- `src/components/receipt/VerificationCard.tsx` + `CharityCard.tsx` — render `EndaomentBadge`; wire real `baseScanUrl` into `VerifyLink`/`href`.
- `src/components/landing/CampaignCard.tsx` — show Endaoment attribution badge.
- `.env.local.example` — document `ENDAOMENT_API_URL`.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| HTTP client | `src/lib/onramp/stripe.ts` | Thin `fetch`, Zod-validated response, injected env (never `process.env` inside), `AbortSignal.timeout`, truncated error body, MSW-testable |
| Registry | `src/lib/campaigns.ts:10-65` | `readonly` const + copy-returning accessors (no caller mutation of source) |
| Env validation | `src/lib/env/server.ts` | Zod schema, `loadServerEnv(source)` pure factory, memoised accessor |
| On-chain decode | `src/lib/contracts.ts:121` | `decodeDonationRoutedLog` strict-bound to event; reuse, don't reimplement |
| Cache fallback | `src/lib/kv/kv-store.ts` | Interface-first; here the floor is a committed snapshot rather than KV |
| Tests | `*.test.ts` colocated, vitest, MSW (`src/lib/msw.test.ts`) | RED-before-GREEN, AAA, descriptive names |

## Tasks (TDD: RED → GREEN → refactor)

### Task 1: Types + Charity view
- **Action**: Add `src/types/charity.ts` (`Charity`, `EndaomentOrgMetadata`, `VerificationResult`). Add `src/lib/endaoment/orgs.ts` per-chain address map + `registry.ts` (`getCharity`, `deriveBaseScanUrl`). Remove `endaomentOrgId` from `Campaign`.
- **Mirror**: `campaigns.ts` accessor style; `tokens.test.ts` for derived-value tests.
- **Validate**: `pnpm vitest run src/lib/endaoment/orgs.test.ts src/lib/endaoment/registry.test.ts && pnpm tsc --noEmit`

### Task 2: Endaoment REST client
- **Action**: `api.ts` — `fetchOrgByEin(ein, env)`; Zod schema for the subset we use (name, ein, mission/description, logoUrl, contract address). Timeout + truncated error.
- **Mirror**: `stripe.ts` exactly (injected env, MSW interception).
- **Validate**: `pnpm vitest run src/lib/endaoment/api.test.ts` (success, non-200, malformed body, timeout)

### Task 3: Metadata resolution with snapshot fallback ← **learning-mode contribution point**
- **Action**: Commit `snapshot.json` (mainnet metadata for PCRF/WCK/Direct Relief, keyed by EIN, date-stamped). Implement `resolveOrgMetadata(ein)`: prefer API, fall back to snapshot on any fetch failure, throw typed error if neither resolves. **The fallback decision logic (what counts as "API unreachable", whether a partial/stale snapshot is acceptable, log-vs-throw) is the meaningful choice we'll request from you at GREEN.**
- **Mirror**: error-handling rules in `coding-style.md` (never silently swallow; user-friendly UI message, detailed server log).
- **Validate**: `pnpm vitest run src/lib/endaoment/metadata.test.ts`

### Task 4: On-chain verification helper
- **Action**: `src/lib/publicClient.ts` factory (reuse RPC env). `verify.ts` — fetch receipt, locate + decode `DonationRouted` (reuse `decodeDonationRoutedLog`), assert `org === charity.endaomentOrgAddress`, **and** assert an ERC20 `Transfer(_, org, net)` log present. Return `VerificationResult`.
- **Mirror**: `contracts.ts` strict decode + "never attribute a foreign transfer".
- **Validate**: `pnpm vitest run src/lib/endaoment/verify.test.ts` (verified, org-mismatch, missing-transfer, no-routed-log → mock public client)

### Task 5: Endaoment badge + attribution
- **Action**: `EndaomentBadge.tsx`. Render in `VerificationCard`, `CharityCard`, `CampaignCard`. Wire real `baseScanUrl`.
- **Mirror**: existing brand components (`CharityAvatar.tsx`), `colors` tokens; design adherence per `DESIGN.md` (no "crypto/hacker" elements).
- **Validate**: `pnpm vitest run src/components/brand/EndaomentBadge.test.tsx` + affected card tests

### Task 6: `/receipt/[txid]` route
- **Action**: Server component loader composing `getCharity` + `resolveOrgMetadata` + `verifyDonation` into a `ReceiptBundle`, rendering existing receipt components. On verification failure, render an explicit unverified state (not a crash). **Known gap:** off-chain swap/settlement stage fields the `DonationRouted` event does not carry are out of this issue's scope — the route resolves charity name + verification badge + on-chain gross/fee/net per acceptance; richer stage composition is a follow-up.
- **Mirror**: `src/app/donate/[campaignId]/page.tsx` route + loader shape; `page.test.tsx` style.
- **Validate**: `pnpm vitest run src/app/receipt`

## Validation

```bash
pnpm vitest run        # full unit/integration suite green
pnpm tsc --noEmit      # type-clean
pnpm lint              # (note: known eslint backlog set to continue-on-error in CI)
pnpm build             # production build
# Acceptance (manual, Base Sepolia): load /receipt/<real-tx> → charity name + "Verified by Endaoment" badge resolve.
# Offline fallback: mock the Endaoment API to fail → snapshot still resolves name/mission.
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Endaoment org has no Base **Sepolia** entity for a curated charity | High | Per-chain address map allows leaving a Sepolia address unset → `getCharity` returns metadata but `verified:false` with a clear reason; mainnet path unaffected |
| Endaoment REST API shape/version drift | Medium | Zod-validate only the subset we use; snapshot is the resilient floor; pin/record `capturedAt` |
| Real org addresses still unconfirmed | Medium | Issue says initial research done (project memory); Task 1 blocks on confirming the 3 addresses before they leave placeholder. Surface explicitly if any is unverifiable |
| Receipt loader expected to fully populate all 5 stages | Medium | Scope note in Task 6: event lacks off-chain swap/settlement data; richer composition deferred to a follow-up issue |
| Mixing in-flight-processing scaffolding into this diff | Medium | Branch hygiene step below — commit/split first |

## Branch Hygiene (do first)

The working tree on `epic-5-receipt-flow` carries uncommitted **in-flight-processing**
work from the prior session (`BaseMark.tsx`, `CharityAvatar.tsx`,
`inflight-marks.test.tsx`, `live-stages.ts/.test.ts`, `tokens.ts/.test.ts`,
`globals.css`). That is a different Epic 5 sub-scope than issue #6. Recommended:
commit that scaffolding on its own (its tests pass), then branch `epic-5-endaoment`
so the Endaoment diff stays reviewable and independently revertible.

## Acceptance

- [ ] Charity registry exposes `{ id, name, endaomentOrgAddress, baseScanUrl }` per chain — one source of truth, no stubs
- [ ] Metadata fetched from Endaoment REST API; offline snapshot fallback verified with API mocked down
- [ ] `verifyDonation(txid, …)` confirms the `DonationRouted` org **and** the ERC20 transfer to it
- [ ] "Verified by Endaoment" badge + attribution render in receipt and campaign card
- [ ] `/receipt/[txid]` resolves a real Base Sepolia tx → charity name + verification badge
- [ ] `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm build` all green; ≥80% coverage on new units
- [ ] Patterns mirrored (stripe client, registry accessors, strict decode), not reinvented
