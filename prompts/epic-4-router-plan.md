# Epic 4 — TransparentDonationRouter Smart Contract — TDD Plan

> **GitHub issue:** [#5 — Epic 4 — TransparentDonationRouter smart contract](https://github.com/mnkprs/donate/issues/5)
> **Status (2026-08-19):** Tasks 0–7 COMPLETE (code) **+ Task 5 fork test now RUN GREEN on a live Base mainnet fork** (`BASE_RPC_URL=https://mainnet.base.org`, `ENDAOMENT_ORG=0xf0e88395c5dbb2b89de58a94e36d71495ac3637b` — PCRF Entity, `baseToken()`==Base USDC, verified live). The run surfaced the one fact mocks couldn't: **Endaoment's `Entity.donate(net)` skims its own registry donation fee on-chain** (150 zoc = 1.5% today, sent to Endaoment's registry treasury `0x5E8e5DA3197cef1e50Baf41B550b1cd2cEa93B14`) before crediting the org. The test now reads `entity.registry().getDonationFeeWithOverrides()` live (never hardcoded) and asserts org credit = net − endaomentFee, Endaoment-treasury delta = endaomentFee, and conservation `orgΔ + endaomentFee == net`. This confirms the Epic 5 receipt math (`amountAfterFee = net − 1.5%`). Toolchain migrated to macOS: `brew install foundry` (forge 1.7.1), deps shallow-cloned (OZ v5.4.0, forge-std v1.14.0) into gitignored `contracts/lib`. **Remaining: operator-only** — Sepolia deploy + verify, org allowlisting, env wiring, mainnet deploy (runbook `contracts/DEPLOY.md`; needs funded deployer key + Basescan key). Prior status follows. Tasks 0–7 COMPLETE (code). Task 7 (receipt-decoder handshake) added `decodeDonationRoutedLog` in `src/lib/contracts.ts` (raw `{topics,data}` → typed `DonationRoutedArgs`; viem `decodeEventLog` strict-bound to `DONATION_ROUTED_EVENT`; foreign logs throw) + 4 tests (round-trip, `fee+net===gross` conservation, checksummed addresses, foreign-event reject); re-exported from `wagmi.ts`. Verified: `tsc` clean, vitest **489 passed**. The full display/stage composition is Epic 5's (event lacks off-chain swap/settlement data). The live broadcast in Task 6 is the only remaining step and is an **operator action** (needs funded keys + Basescan key; outward-facing/irreversible) — runbook at `contracts/DEPLOY.md`. Task 6 added, TDD: `script/Deploy.s.sol` (thin `run()` reads `USDC_ADDRESS`/`TREASURY_ADDRESS` + broadcasts; internal `_deploy` is the test seam) with `test/Deploy.t.sol` (4 tests: wires immutables, fresh deploy each call, propagates both zero-address reverts); `src/lib/contracts.ts` (frontend) exporting the `DonationRouted` event ABI **hash-bound to the Solidity event signature** via `toEventHash == keccak256(canonical)`, `ROUTER_SUPPORTED_CHAIN_IDS`, and env-driven `getRouterAddress(chainId)` — returns `undefined` until deployed, ignores malformed env (lazy per-chain static `process.env.NEXT_PUBLIC_ROUTER_ADDRESS_*` reads preserve both Next.js inlining and vitest stubbing) — re-exported from `src/lib/wagmi.ts`; `.env.local.example` documents the two `NEXT_PUBLIC_ROUTER_ADDRESS_*` vars. Verified: forge **21 passed, 1 skipped** (fork gate); vitest **485 passed** (8 new in `contracts.test.ts`); `tsc --noEmit` clean. Resume at **Task 7** — receipt-decoder handshake (Epic 5 seam; the event is already exported for it).
> **Task 5 recap:** GREEN-as-scaffold: `test/fork/RouterFork.t.sol` asserts the 1/99 split as treasury/org balance deltas on a Base fork, **Epic-5 gated** (`setUp` reads `BASE_RPC_URL` + `ENDAOMENT_ORG` before any fork, `vm.skip` when unset → clean `[SKIP]`, not fail). Uses `deal()` and hardcoded Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Router still 100% coverage.
> **Fork run note:** Once Epic 5 supplies the real org, run with `forge test --match-path test/fork/* --fork-url $BASE_RPC_URL` (and `ENDAOMENT_ORG` set).
> **Run note:** Run forge from inside `contracts/` (`Set-Location contracts; forge test`). The `--root contracts` form hit a stale-cache "Nothing to compile"; `forge clean` then in-dir runs work.
> **Toolchain note:** `forge` lives at `C:\Users\Manos\.foundry\bin\forge.exe` (v1.7.1) — not on PATH; prepend `$env:USERPROFILE\.foundry\bin` to PATH per session. Deps are shallow-cloned into `contracts/lib` (gitignored), not submodules. Run forge with `--root contracts`.
> **Branch (suggested):** `epic-4-router`

## Context

Epic 4 (GitHub issue #5) builds the on-chain heart of Eudaimonia: a Solidity
contract on Base L2 that receives USDC, skims a hardcoded 1% platform fee to the
treasury, and forwards the remaining 99% to the targeted Endaoment org Entity.
This is the contract Epic 3's on-ramp settles into and that Epic 5's receipt
decoder reads events from.

This is the project's **first Solidity work** — no `contracts/` directory or
Foundry toolchain exists yet. Per `CLAUDE.md`, smart contracts are written
**TDD-first**: Foundry tests precede contract logic, and real network conditions
are simulated via Base mainnet forking.

The pattern mirrors prior epics: granular testable units, RED tests before
GREEN implementation, pure/where-possible logic, deterministic local mocks for
fast unit tests, and a forked-network suite for real integration.

## Decisions Locked In

| Question | Decision | Source |
|---|---|---|
| Endaoment forward mechanism | **Approve net USDC to the org Entity, then call `Entity.donate(net)`** — so Endaoment's own 1.5% fee + accounting run on-chain, matching the receipt UI's "Routed" stage | This session (user) |
| Fork-test dependency on Epic 5 | **Mock now, gate fork on Epic 5** — full logic coverage against `MockEndaomentOrg` + `MockUSDC`; fork tests written but skipped when the real org address env var is unset | This session (user) |
| `txHash` in event args | **Dropped** — a contract cannot reference its own tx hash; the hash already rides on every emitted log (`receipt.transactionHash`). Off-chain decoder reads it for free. | Correction to issue spec |
| Token support | **USDC only** (6 decimals), immutable reference | Issue #5 non-goals |
| Upgradeability | **None** — immutable contract, no proxy | Issue #5 non-goals |
| Fee | **Hardcoded `FEE_BPS = 100` (1%) + immutable treasury**, no admin-mutable fee | Issue #5 |
| Rounding | **Integer floor**: `fee = amount * FEE_BPS / 10_000`, `net = amount - fee`; conservation `fee + net == amount` always holds | This plan |

## Target Architecture

```
contracts/
├── foundry.toml                       solc, optimizer, remappings, fork RPC, fuzz runs
├── remappings.txt                     @openzeppelin/ → lib/openzeppelin-contracts/
├── lib/openzeppelin-contracts/        forge install (SafeERC20, ReentrancyGuard, IERC20)
├── src/
│   ├── TransparentDonationRouter.sol  the contract
│   └── interfaces/
│       └── IEndaomentEntity.sol       { function donate(uint256 amount) external; }
├── test/
│   ├── TransparentDonationRouter.t.sol  unit suite (Tasks 1–4)
│   ├── fork/
│   │   └── RouterFork.t.sol             forked Base suite (Task 5, Epic-5 gated)
│   └── mocks/
│       ├── MockERC20.sol                mint-able 6-decimal USDC stand-in
│       ├── MockEndaomentOrg.sol         implements IEndaomentEntity.donate (transferFrom + record)
│       └── MockReentrantOrg.sol         re-enters router.donate() to prove the guard
└── script/
    └── Deploy.s.sol                     reads USDC + treasury from env, broadcasts, logs address
```

Off-chain integration touchpoint:
- `src/lib/contracts.ts` (new) — `ROUTER_ADDRESS` per chain + exported `DonationRouted` event ABI for the receipt decoder. (`src/lib/wagmi.ts` currently holds no contract address.)

## Contract Surface (target GREEN state)

```solidity
contract TransparentDonationRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20  public immutable usdc;
    address public immutable treasury;
    uint256 public constant FEE_BPS = 100;          // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event DonationRouted(
        address indexed donor,
        address indexed org,
        uint256 gross,
        uint256 fee,
        uint256 net
    );

    constructor(address _usdc, address _treasury);  // zero-address checks
    function previewSplit(uint256 amount) public pure returns (uint256 fee, uint256 net);
    function donate(address endaomentOrg, uint256 amount) external nonReentrant;
}
```

`donate` follows checks-effects-interactions:
1. **Checks** — `endaomentOrg != address(0)`, `amount > 0`.
2. **Effects** — compute `(fee, net)` via `previewSplit`.
3. **Interactions** — `usdc.safeTransferFrom(donor, this, amount)`; `usdc.safeTransfer(treasury, fee)`; `usdc.forceApprove(org, net)`; `IEndaomentEntity(org).donate(net)`.
4. **Emit** `DonationRouted(donor, org, amount, fee, net)`.

---

## Granular TDD Task List

### Task 0 — Toolchain + Foundry scaffold *(prerequisite, not TDD)*
**Blocker:** Foundry is **not installed** (`forge`/`foundryup` absent on PATH).
- Install: `foundryup` (Windows: via Git Bash / WSL, then ensure `forge` on PATH).
- `forge init contracts/ --no-git` (or manual `foundry.toml` to keep it inside the existing repo).
- `forge install OpenZeppelin/openzeppelin-contracts --no-commit`.
- Write `foundry.toml`: `solc = "0.8.24"`, `optimizer = true`, `optimizer_runs = 200`, `[rpc_endpoints] base = "${BASE_RPC_URL}"`, `[fuzz] runs = 256`, remappings.
- Smoke: `forge build` compiles an empty project.

### Task 1 — Constructor & immutables *(RED → GREEN)* ⬅ **START HERE**
RED tests in `test/TransparentDonationRouter.t.sol`:
- `test_Constructor_SetsUsdcAndTreasury` — getters return the constructor args.
- `test_Constructor_RevertsOnZeroUsdc` — `vm.expectRevert`.
- `test_Constructor_RevertsOnZeroTreasury` — `vm.expectRevert`.
- `test_FeeConstants` — `FEE_BPS == 100`, `BPS_DENOMINATOR == 10_000`.

GREEN: implement constructor with zero-address checks; promote storage to `immutable`; declare constants.

### Task 2 — Fee split math *(RED → GREEN)*
- `test_PreviewSplit_OnePercent` — `100e6 → (1e6, 99e6)`.
- `test_PreviewSplit_RoundsDown` — `99 → (0, 99)` (sub-100-unit dust).
- `testFuzz_PreviewSplit_Conservation` — `fee + net == amount` and `fee == amount * 100 / 10_000` for all inputs.

GREEN: implement `previewSplit` pure function.

### Task 3 — Happy-path donate *(RED → GREEN)*
Setup: deploy `MockERC20` (USDC), `MockEndaomentOrg`, router; mint USDC to donor; `vm.prank(donor)` approve router.
- `test_Donate_PullsGrossFromDonor` — donor balance drops by `amount`.
- `test_Donate_SendsFeeToTreasury` — treasury balance `== fee`.
- `test_Donate_ForwardsNetToOrg_ViaDonate` — mock org records `net` received through its `donate()`.
- `test_Donate_LeavesNoLeftoverAllowance` — `usdc.allowance(router, org) == 0` after.
- `test_Donate_EmitsDonationRouted` — `vm.expectEmit(true,true,false,true)` with `(donor, org, amount, fee, net)`.

GREEN: implement `donate` (CEI as above).

### Task 4 — Guards & reverts *(RED → GREEN)*
- `test_Donate_RevertsOnZeroOrg`.
- `test_Donate_RevertsOnZeroAmount`.
- `test_Donate_RevertsWhenNoAllowance` — SafeERC20 revert.
- `test_Donate_RevertsWhenInsufficientBalance`.
- `test_Donate_NonReentrant` — `MockReentrantOrg.donate()` re-enters `router.donate()`; expect `ReentrancyGuardReentrantCall`.

GREEN: ordering already satisfies most; add `MockReentrantOrg`; confirm `nonReentrant`.

### Task 5 — Forked Base mainnet integration *(RED → GREEN, Epic-5 gated)*
`test/fork/RouterFork.t.sol`:
- `setUp` — `vm.createSelectFork(vm.envOr("BASE_RPC_URL", ""))`; `vm.skip(true)` when unset.
- Real USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Real org from `vm.envOr("ENDAOMENT_ORG", address(0))`; skip until Epic 5 supplies it.
- `testFork_Donate_RealUsdc_RealOrg` — `deal` USDC to donor, approve, donate, assert treasury fee delta + org balance delta.

### Task 6 — Deploy + verify + config wiring
- `script/Deploy.s.sol` — reads `USDC_ADDRESS`, `TREASURY_ADDRESS` from env; broadcasts; logs deployed address.
- Deploy + verify on **Base Sepolia**, then **Base mainnet** (`forge script --rpc-url --broadcast --verify` with Basescan key).
- Record address + export `DonationRouted` ABI in `src/lib/contracts.ts`; reference from `src/lib/wagmi.ts`.

### Task 7 — Receipt-decoder handshake *(follow-up / Epic 5 seam)* — **COMPLETE (handshake)**
- Confirm `DonationRouted(gross, fee, net)` maps onto `buildStages` input (`gross→routing`, `fee→eudaimonia`, `net→settlement`). Export the typed event so Epic 5 can decode a real log. Likely lands in Epic 5; noted here so the event shape stays stable.
- **Done (TDD):** `decodeDonationRoutedLog(log)` in `src/lib/contracts.ts` turns a raw `{ topics, data }` log into typed `DonationRoutedArgs` (`donor`/`org` as checksummed `Address`, `gross`/`fee`/`net` as `bigint` USDC base units) via viem `decodeEventLog({ strict: true })` — strictly bound to `DONATION_ROUTED_EVENT`, so a foreign-event log throws rather than mis-decoding. Re-exported (with `DonationRoutedArgs`/`RawEventLog` types) from `src/lib/wagmi.ts`.
- **Tests (4, in `contracts.test.ts`):** round-trip `encodeEventTopics`+`encodeAbiParameters` → decode → `toEqual` original args (catches ABI/topic drift the hash test can't); `fee + net === gross` conservation (mirrors the Foundry Task-2 fuzz invariant off-chain); indexed args come back as valid checksummed addresses; a `Transfer`-signature log throws.
- **Scope note:** The decoder is intentionally value-faithful — raw `bigint`s only. Display formatting and the precise stage composition (incl. the loose `gross→routing`: stage 3's `amountAfterFee` is `net − Endaoment 1.5%`, taken *downstream* of this event) belong to Epic 5, which also supplies the off-chain swap/settlement data the event does not carry. Verified: `tsc --noEmit` clean; vitest **489 passed** (4 new).

## Risks
- **HIGH (env):** Foundry not installed — Task 0 blocks everything.
- **HIGH (dep):** Endaoment Entity `donate(uint256)` signature assumed; confirm against the real ABI when Epic 5 lands. `IEndaomentEntity` is the single seam to adjust.
- **MED:** USDC `forceApprove` used for approval resets (safe default).
- **MED:** Basescan verification flakiness / API key config.
- **LOW:** Fee rounding dust on sub-$0.01 donations (acceptable; conservation holds).

## Test Plan (acceptance, from issue #5)
- [x] `forge test` green (unit + fuzz) against mocks. *(21 passed, 1 skipped fork gate; incl. 4 Deploy-script tests.)*
- [x] `forge test --match-path test/fork/*` green once `BASE_RPC_URL` + real org set. *(Run green 2026-08-19 against Base mainnet + PCRF Entity; assertions corrected to model Endaoment's live registry donation fee.)*
- [ ] Deployed + verified on Base Sepolia; sample tx splits 1/99 correctly. *(Operator step — runbook: `contracts/DEPLOY.md`.)*
- [x] `DonationRouted` ABI exported + hash-bound to the on-chain event signature, ready for `buildStages`. *(Task 7: `decodeDonationRoutedLog` now decodes a real log into typed args; display/stage composition lands in Epic 5.)*
- [x] Router address wiring in frontend config (`src/lib/contracts.ts` `getRouterAddress`, env-driven; address filled in post-deploy, no code change).
