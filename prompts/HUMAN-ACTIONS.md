# HUMAN-ACTIONS — Operator Runbook to Close Epics 3 & 4

> **Rewritten 2026-08-19.** This file was referenced from issues #4/#5 but was
> never committed from the previous machine; recreated from the issue comments,
> `contracts/DEPLOY.md`, and the live fork-test run. Every step below is an
> **operator action**: outward-facing, irreversible, or requiring funded keys —
> deliberately not automated.
>
> **Code status:** everything automatable is done and verified —
> forge 29 passed / fork test **run green on a live Base mainnet fork** (PR #52),
> vitest green, Stripe onramp + webhook + KV session store shipped (PR #25).

## What's left, in order

```
1. Deploy router → Base Sepolia          (needs funded Sepolia key + Basescan key)
2. Allowlist orgs on the router          (owner account; donations revert until done)
3. Wire env into Vercel + local          (both server + NEXT_PUBLIC vars)
4. Register Stripe onramp webhook        (Stripe dashboard)
5. Live sandbox card payment             (closes Epic 3 acceptance)
6. Mainnet deploy (repeat 1–3 on Base)   (multisig owner; closes Epic 4)
```

---

## 0. Prerequisites (confirmed 2026-05-23, re-check before use)

- **Foundry** — installed on this Mac via `brew install foundry` (forge 1.7.1).
  Deps live in gitignored `contracts/lib` (OZ v5.4.0, forge-std v1.14.0); if
  missing, re-clone:
  ```sh
  cd contracts
  git clone --depth 1 --branch v5.4.0 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
  git clone --depth 1 --branch v1.14.0 https://github.com/foundry-rs/forge-std.git lib/forge-std
  ```
- **Funded deployer key** — Base Sepolia ETH (faucet) for step 1; real ETH on
  Base for step 6.
- **Basescan API key** — for `--verify`.
- **Treasury address** — same EOA on Sepolia + mainnet (decision on #5).
- **Owner address** — hot EOA on Sepolia; **deploy a Safe multisig before the
  mainnet step** (decision on #5; review finding M4).
- **Stripe** — test-mode keys with Crypto Onramp enabled.

## 1. Deploy to Base Sepolia

```sh
cd contracts
export USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Base Sepolia USDC
export TREASURY_ADDRESS=<treasury>
export OWNER_ADDRESS=<allowlist owner>
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BASESCAN_API_KEY=<key>

forge script script/Deploy.s.sol:Deploy \
  --rpc-url base_sepolia \
  --account <keystore-account> \
  --broadcast --verify
```

Record the logged `TransparentDonationRouter deployed at: 0x…`.

## 2. Allowlist the orgs (donations revert with `OrgNotAllowed` until done)

From the `OWNER_ADDRESS` account, per org:

```sh
cast send <router> "setOrgAllowed(address,bool)" <org> true \
  --rpc-url $BASE_SEPOLIA_RPC_URL --account <owner-keystore>
```

Base **Sepolia** org entities were wired in PR #38 (fetched from the dev API
via `scripts/fetch-endaoment-orgs.mjs`) — cross-check the values in the repo
before sending, and verify each org's `baseToken()` equals the network's
canonical USDC first:

```sh
cast call <org> "baseToken()(address)" --rpc-url <rpc>
```

Base **mainnet** (for step 6): PCRF Entity = `0xf0e88395c5dbb2b89de58a94e36d71495ac3637b`
(verified live 2026-08-19: EIP-1167 clone, `baseToken()` == `0x8335…2913`,
registry fee 150 zoc = 1.5%). Resolve WCK / Direct Relief mainnet entities from
`api.endaoment.org` the same way before allowlisting.

## 3. Wire the address into the app env (BOTH vars — runbook bug fixed 2026-05-23)

The frontend reads `NEXT_PUBLIC_…`; the **server-side onramp builder reads the
non-public var** (`src/lib/onramp/createSession.ts` via Zod-validated env). Set
both, in Vercel (all envs that apply) and `.env.local`:

```
ROUTER_ADDRESS_BASE_SEPOLIA=0x<deployed>
NEXT_PUBLIC_ROUTER_ADDRESS_BASE_SEPOLIA=0x<deployed>
# after mainnet deploy:
ROUTER_ADDRESS_BASE=0x<deployed>
NEXT_PUBLIC_ROUTER_ADDRESS_BASE=0x<deployed>
```

## 4. Register the Stripe webhook (missing prerequisite added 2026-05-23)

In the Stripe dashboard (test mode), add a webhook endpoint for
`crypto.onramp_session.updated` pointing at
`https://<deployment>/api/onramp/webhook`, and copy the signing secret into
`STRIPE_ONRAMP_WEBHOOK_SECRET` (Vercel + local). Without this, signature
verification 400s every event.

## 5. Epic 3 acceptance — live sandbox payment

1. `npm run dev` (or the Vercel preview) with all env above set.
2. Visit `/donate/pcrf`, donate $50 with a Stripe test card.
3. Confirm: redirect to Stripe-hosted onramp → USDC arrives at the **router**
   on Base Sepolia → webhook flips the session to `settled` →
   `/api/onramp/status/<sessionId>` returns the tx hash → receipt page renders
   the stages.
4. Check the 1/99 split on Sepolia Basescan (treasury delta = 1%).

→ Close **#4**.

## 6. Base mainnet (closes Epic 4)

Repeat steps 1–3 with `--rpc-url base`, `USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
the **Safe multisig as OWNER_ADDRESS**, and triple-check `TREASURY_ADDRESS` —
it is immutable. Allowlist the mainnet org entities (step 2 list). Then set the
two mainnet env vars (step 3).

Optional final proof: re-run the fork suite pinned at the deployed state —
`BASE_RPC_URL=<rpc> ENDAOMENT_ORG=0xf0e8…637b forge test --match-path 'test/fork/*'`
(green as of 2026-08-19).

→ Close **#5**.

## Known on-chain facts (verified live, 2026-08-19)

| Fact | Value |
|---|---|
| Endaoment donation fee | 150 zoc = **1.5%**, read from `entity.registry().getDonationFeeWithOverrides()` |
| Endaoment registry (Base) | `0x237b53BCFBd3a114b549dFEc96a9856808f45c94` |
| Endaoment treasury (Base) | `0x5E8e5DA3197cef1e50Baf41B550b1cd2cEa93B14` |
| Effect on receipt math | org receives `net − 1.5%` → Epic 5 `amountAfterFee` confirmed |
