# Epic 1 — Curated Campaigns Landing Page: TDD Plan

> Status: **COMPLETE** — Phases 5–6 locked in `3ce141d`; follow-up sections (CreamBand, HowItWorks, ClosingCTA, AuthorityStrip, LiveReceiptStrip #37) shipped. Issue closed.
> GitHub: [mnkprs/Philotimo#2](https://github.com/mnkprs/Philotimo/issues/2)
> Source design: `designs/landing.jsx` (1,121 lines, Babel-rendered prototype, inline styles)
> Target: `src/app/page.tsx` + modular Tailwind components

---

## Requirements Restatement

Port `designs/landing.jsx` into the Next.js App Router at `src/app/page.tsx`, broken into modular Tailwind-class components and driven by a typed campaign registry. Must satisfy Epic 1 acceptance:

- Cards render at `/`
- CTAs deep-link to `/donate/[campaignId]`
- Lighthouse a11y ≥ 95
- Responsive at 320 / 768 / 1024 / 1440

---

## Scope Discipline (IN vs. OUT)

`landing.jsx` ships 9 sections. Epic 1 requires 4. The other 5 are deferred to follow-up issues to keep the PR reviewable and matched to Epic 1 acceptance.

| Section | Epic 1? | Decision |
|---|---|---|
| `NavBar` | implicit (semantic `<header>`) | **IN** |
| `Hero` + `HeroMesh` | ✓ value-prop | **IN** (drop `HeroReceiptMockup` & `MiniTracker` — they preview Epic 6) |
| `CausesSection` + `CampaignCard` | ✓ core | **IN** |
| `Footer` | implicit (landmark + legal) | **IN** |
| `AuthorityStrip` | trust-adjacent | **STRETCH** (cheap, add if time) |
| `CreamBand` | post-MVP | **OUT** — follow-up issue |
| `HowItWorks` | post-MVP | **OUT** — follow-up issue |
| `ClosingCTA` | post-MVP | **OUT** — follow-up issue |
| `LiveReceiptStrip` | needs Epic 6 data | **OUT** — follow-up issue |

This trims the port from ~1,100 → ~400 LoC and avoids leaking Epic 6 visuals (live receipts, mini tracker) before the on-chain plumbing exists.

---

## Phase 0 — Branching & Atom Reuse ✅ DONE

PR #1 (`feat/receipt-ui-components`) merged to `main`. Atoms now available on `main`:
- `src/components/brand/`: `PhiMark`, `Wordmark`
- `src/components/ui/`: `CopyButton`, `EyebrowLabel`, `Mono`, `Num`, `VerifyLink`
- `src/lib/tokens.ts`, `src/lib/fixtures.ts`

Missing atoms from `landing.jsx` that still need extraction in Phase 4:
- `PillButton` (primary / secondary / dark / ghost variants)
- `StripedPlaceholder` (decorative image placeholder for cards)
- `ArrowRight` (inline SVG icon — or reuse `lucide-react`)

---

## Phase 1 — Test Infrastructure ✅ DONE (minimal pivot)

**Pivoted scope.** Attempted to install `@testing-library/react` + `vitest-axe` + `happy-dom` env; npm install crashed twice with an internal `Cannot read properties of null (reading 'name')` error (likely React 19 peer-graph + npm cache issue).

**What was done:**
- `vitest.config.ts` coverage scope expanded:
  - `include`: added `src/components/**/*.tsx`, `src/app/**/*.tsx`
  - `exclude`: added `src/app/layout.tsx`, `src/app/providers.tsx`
- All 23 existing tests still green.

**What was deferred:**
- `@testing-library/react`, jsdom/happy-dom env switch, `src/test/setup.ts`.
- Real-DOM interaction, axe a11y checks, Lighthouse → moved to Phase 6 (Playwright).

**Rationale:** Existing tests use `renderToString` from `react-dom/server` (see `src/components/atoms.test.tsx`). This works in node env and is sufficient for contract assertions (href values, EIN format, landmarks present in markup, skeleton elements present, empty-state copy). Real-DOM testing and a11y validation get more value from Playwright at the integration level than from per-component unit tests.

**To revisit later if you want real-DOM unit tests:**
```bash
npm cache clean --force
npm install --save-dev --legacy-peer-deps \
  @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event vitest-axe
# Then switch vitest.config.ts environment to "happy-dom" (already in devDeps)
# Add src/test/setup.ts: import '@testing-library/jest-dom/vitest'
```

---

## Phase 2 — Typed Campaign Registry (`src/lib/campaigns.ts`) ✅ DONE

**Shipped:**
- `src/types/campaign.ts` — `Campaign` interface (no fake live stats)
- `src/lib/campaigns.ts` — `CAMPAIGNS`, `getCampaigns()`, `getCampaignById()`, `campaignHref()`
- `src/lib/campaigns.test.ts` — 17 tests (contract + lookup + immutability + EIN pattern + no-stats guard)
- Endaoment Org IDs stubbed as `TODO-{id}` per decision; real IDs slot in at Epic 4

**Verification:** 17 new tests pass, tsc clean, no regressions in committed code (tokens.test.ts pre-existing untracked RED for Phase 3).

---

## Phase 2 (original spec) — Typed Campaign Registry

Foundation that everything downstream consumes. TDD order:

### RED — `src/lib/campaigns.test.ts`
- `getCampaigns()` returns the hardcoded list in declared order
- `getCampaignById('pcrf')` returns the PCRF entry
- `getCampaignById('unknown')` returns `undefined`
- Every campaign has a valid EIN format (`/^\d{2}-\d{7}$/`)
- Every campaign has a non-empty `mission`, `name`, `endaomentOrgId`
- `campaignHref(campaign)` returns `/donate/${campaign.id}`

### GREEN
- Add `Campaign` interface to `src/types/campaign.ts`:
  ```ts
  interface Campaign {
    id: string;              // URL slug, e.g. "pcrf"
    name: string;
    ein: string;             // "95-4374418"
    endaomentOrgId: string;
    tag: string;             // "Urgent · Gaza"
    mission: string;
    swatch: string;          // primary accent for placeholder
    swatch2: string;         // tint for placeholder
    photoCaption: string;
  }
  ```
- **Keep `raised` / `donors` / `receipts` OUT of `Campaign`** — those are live data from Epic 6, not registry data. Expose via separate `CampaignStatsPreview` type or omit until live.
- `src/lib/campaigns.ts` exports `CAMPAIGNS`, `getCampaigns()`, `getCampaignById()`, `campaignHref()`.

> **Insight:** Splitting registry data (immutable, build-time) from live stats (on-chain, request-time) protects you when Epic 6 lands. Otherwise every campaign edit drags fake stats along, and you discover the shape was wrong only when wiring real wagmi reads.

### Seed data (from `designs/landing.jsx` lines 5–45)
- `pcrf` — Palestine Children's Relief Fund — EIN 95-4374418
- `wck` — World Central Kitchen — EIN 27-1273172
- `directrelief` — Direct Relief — EIN 95-1831116

> **Endaoment Org IDs** — `landing.jsx` doesn't include these (the design mocks only have EINs). Look these up from Endaoment's directory before Phase 2 GREEN can pass, or stub with TODO + test marker.

---

## Phase 3 — Design Tokens (Tailwind v4 CSS-first)

`landing.jsx` hardcodes ~15 colors. `src/lib/tokens.ts` already exports a `colors` object from receipt work — check what's there first and extend rather than duplicate.

**Centralize in `src/app/globals.css`** under `@theme` so Tailwind classes (`bg-ink`, `text-iris`) work everywhere:

```css
@theme {
  --color-ink: #0d253d;         /* primary text */
  --color-iris: #533afd;        /* primary CTA */
  --color-iris-hover: #4434d4;
  --color-slate: #273951;       /* body text */
  --color-mute: #64748d;        /* secondary */
  --color-rule: #e3e8ee;        /* borders */
  --color-rule-soft: #eef2f6;
  --color-tint: #f6f9fc;        /* surfaces */
  --color-cream: #f5e9d4;
  --font-feature-settings: "ss01";
}
```

No test needed (visual/declarative). Reuse what's already in `src/lib/tokens.ts`.

---

## Phase 4 — Modular Component Port ✅ DONE

**Shipped (TDD: RED → GREEN for each unit):**
- Atoms: `src/components/ui/PillButton.tsx`, `StripedPlaceholder.tsx`, `ArrowRight.tsx` (+ tests)
- Landing components: `src/components/landing/{NavBar,Hero,CampaignCard,CausesGrid,Footer}.tsx` (+ tests)
- Page composition: `src/app/page.tsx` rewritten to `<NavBar /> <main><Hero /><CausesGrid /></main> <Footer />`, plus `src/app/page.test.tsx` (4 structural tests)
- `CampaignCard` stats prop modeled as discriminated union: `{loading:true} | {error:true} | {raised, donors, receipts}`. `stats={undefined}` renders idle skeletons (no `$0` lie); loading adds `aria-busy="true"`; error renders `"Stats unavailable"`.

**Verification:** 87/87 vitest tests green (was 45 before phase). `tsc --noEmit` clean. PCRF's apostrophe-in-name forced test refactors to assert HTML-encoded fragments rather than raw concatenated strings — captured in inline comments next to each affected assertion.

---

## Phase 4 (original spec) — Modular Component Port (TDD, one component at a time)

Each component gets a `.test.tsx` written first. Tests assert **contract & a11y semantics**, not pixel-perfect markup (visual regression is Playwright in Phase 6).

### 4.1 `<NavBar />` → `src/components/landing/NavBar.tsx`
**RED:**
- renders `<nav aria-label="Primary">`
- wordmark links to `/`
- renders 4 nav links
- "Donate" CTA links to `/donate` (or the first campaign)

**GREEN:**
- Convert inline styles → Tailwind classes
- Replace `<a href="#" onClick={preventDefault}>` with real `next/link`
- Mark mobile-hidden links with `hidden md:flex`

### 4.2 `<Hero />` → `src/components/landing/Hero.tsx`
**RED:**
- renders `<h1>` (landmark contract)
- description paragraph
- two CTAs: primary "Choose a cause" anchors to `#causes`, secondary "Example receipt" is `aria-disabled` (Epic 6 not done)
- trust micro-row visible

**GREEN:**
- Port copy + Tailwind classes
- `HeroMesh` becomes an `aria-hidden` div with Tailwind gradient utilities OR a single `bg-[radial-gradient(...)]` arbitrary value (Tailwind v4 supports this cleanly)
- **Drop** `HeroReceiptMockup` / `MiniTracker` (Epic 6 territory)

### 4.3 `<CampaignCard campaign={...} />` → `src/components/landing/CampaignCard.tsx`
Epic 1's named deliverable.

**RED:**
- renders campaign name as `<h3>`
- displays formatted EIN
- "Donate" CTA is an `<a>` whose `href` === `/donate/${campaign.id}`
- placeholder image has `role="img"` and accessible name from `photoCaption`
- given `stats={undefined}` → stat row renders skeletons (NOT "$0")
- given `stats={loading: true}` → stat row renders `aria-busy="true"` skeletons
- given `stats={error: true}` → stat row renders a single "Stats unavailable" message (no $0 lie)

**GREEN:**
- Port markup
- Swap inline `<a onClick={prevent}>` → `next/link`
- Lift hover styling into Tailwind `group-hover:` + `transition` (no `useState` for hover — convert from client to server component)

> **Insight:** The original uses `useState` for hover. In Tailwind, `hover:shadow-xl transition-shadow` is the same effect with zero JS — converts a client component to a server component, which matters for hero LCP and bundle budget.

### 4.4 `<CausesGrid />` → `src/components/landing/CausesGrid.tsx`
(formerly `CausesSection` in the design)

**RED:**
- renders `<section id="causes" aria-labelledby="causes-heading">`
- contains `<h2 id="causes-heading">`
- renders `CAMPAIGNS.length` cards
- supports `campaigns=[]` empty state: "No campaigns this week — check back soon"

**GREEN:**
- Map registry → cards
- Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`

### 4.5 `<Footer />` → `src/components/landing/Footer.tsx`
**RED:**
- renders as `<footer>` landmark
- contains EIN disclosure copy
- year is current year (not hardcoded "2026")

**GREEN:**
- Port markup
- `new Date().getFullYear()` on server

### 4.6 Compose in `src/app/page.tsx`
**RED — `src/app/page.test.tsx`:**
- renders `<main>`
- contains exactly one `<h1>`, one `<nav>`, one `<footer>`
- `CAMPAIGNS.length` `CampaignCard` instances (query by role + name)

**GREEN:**
```tsx
<NavBar />
<main>
  <Hero />
  <CausesGrid campaigns={getCampaigns()} />
</main>
<Footer />
```

### Atoms needed during Phase 4 (not yet ported from `designs/landing.jsx`)
- `PillButton` → `src/components/ui/PillButton.tsx` (4 variants: primary, secondary, dark, ghost; 3 sizes: sm, md, lg)
- `StripedPlaceholder` → `src/components/ui/StripedPlaceholder.tsx`
- `ArrowRight` → `src/components/ui/ArrowRight.tsx` (or use `lucide-react` `ArrowUpRight` — already a dependency)

---

## Phase 5 — Responsive Pass

Manual: open dev server, check 320 / 768 / 1024 / 1440. Most padding in `landing.jsx` is `px-16` (64px) — breaks on 320. Change to `px-4 sm:px-6 lg:px-16`. Test grid collapses correctly.

---

## Phase 6 — Playwright + a11y (lock the acceptance criteria)

### Install (deferred from Phase 1)
```bash
npm install --save-dev --legacy-peer-deps @playwright/test @axe-core/playwright @lhci/cli
npx playwright install --with-deps
```

### `e2e/landing.spec.ts`
- Visit `/`, assert `<h1>` visible
- Each campaign card has a "Donate" link whose `href` matches `/donate/${campaign.id}`
- Click each → URL updates

### `e2e/landing.a11y.spec.ts`
- `@axe-core/playwright` run, zero serious/critical violations
- Screenshot diff at 320 / 768 / 1440

### Lighthouse
- `lhci autorun` against built `/`
- **Acceptance gate: a11y ≥ 95**

---

## Phase 7 — Code Review & Commit

- `code-reviewer` agent on the diff
- Conventional commit: `feat(landing): port designs/landing.jsx into modular Tailwind components`
- PR description references Epic #2; checks off the In-scope items it actually covers (Hero ✓, CampaignCard ✓, registry ✓, responsive ✓, CTAs ✓, empty/loading/error ✓, a11y ✓)
- Opens follow-up issues for the four deferred sections (`CreamBand`, `HowItWorks`, `ClosingCTA`, `LiveReceiptStrip`)

---

## Dependencies

- **External:** none (no smart contract, no API)
- **Internal blocker:** ~~Atom reuse decision~~ ✅ resolved (PR #1 merged)
- **Tooling adds (Phase 6):** `@playwright/test`, `@axe-core/playwright`, `@lhci/cli`

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Atoms re-implemented divergently from receipt page | ~~HIGH~~ ✅ resolved | PR #1 merged to main |
| Live stats (raised/donors/receipts) shown as fake hardcoded values reads as dishonest given brand's transparency thesis | **HIGH** | Render skeletons in stat slots until Epic 6 wires real reads. Do not ship fake stats. |
| Tailwind v4 token migration footgun: `@theme` syntax differs from v3 | MEDIUM | Pin to v4 docs; verify one token round-trips before bulk extraction |
| Hero gradient mesh as a single arbitrary-value class hurts LCP | MEDIUM | If LCP regresses, swap to a static `<svg>` background |
| Lighthouse a11y ≥ 95 fails on color contrast (`#64748d` on `#f6f9fc` is borderline ~4.4:1) | MEDIUM | Bump `--color-mute` darker by ~5% if axe flags it |
| Inline `<a href="#" onClick={preventDefault}>` pattern in `landing.jsx` hides routing — easy to miss when porting | MEDIUM | Test asserts real `href` values; code review flags any `href="#"` |
| Endaoment Org IDs not in design data — must look up before Phase 2 GREEN | MEDIUM | Fetch from Endaoment directory or stub with TODO + test marker |

---

## Complexity & Time Estimate

| Phase | Estimate |
|---|---|
| ~~Phase 0 (branching)~~ | ✅ done |
| ~~Phase 1 (test infra, minimal)~~ | ✅ done |
| Phase 2 (registry + tests) | 1h |
| Phase 3 (tokens) | 30min |
| Phase 4 (5 components + 3 atoms TDD) | 3–4h |
| Phase 5 (responsive) | 1h |
| Phase 6 (Playwright + a11y + Lighthouse) | 1.5–2h |
| Phase 7 (review + PR) | 30min |
| **Remaining total** | **7.5–9h** |

---

## Resume Commands

```bash
# Confirm state
git status && git log --oneline -5
npm test  # should be 23 passing
gh issue view 2 --repo mnkprs/Eudaimonia

# Start Phase 2
# Write src/lib/campaigns.test.ts (RED)
# Run: npm test -- campaigns
# Implement src/lib/campaigns.ts + src/types/campaign.ts (GREEN)
```
