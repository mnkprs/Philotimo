// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransparentDonationRouter} from "../../src/TransparentDonationRouter.sol";

/// @dev Minimal view surface of Endaoment's Registry needed to predict what
///      their `donate()` does with our forwarded net: it skims a donation fee
///      (expressed in zoc, parts per 10,000) to the registry's treasury before
///      crediting the org Entity's balance.
interface IEndaomentRegistry {
    function getDonationFeeWithOverrides(address entity) external view returns (uint32);
    function treasury() external view returns (address);
}

/// @dev Minimal view surface of an Endaoment Entity: every entity exposes the
///      registry that governs its fees.
interface IEndaomentEntityView {
    function registry() external view returns (IEndaomentRegistry);
}

/// @title RouterFork — forked Base mainnet integration (Task 5, Epic-5 gated)
/// @notice Validates the full donate() flow against *real* USDC and a *real*
///         Endaoment org Entity on a Base mainnet fork — the one thing the
///         mock-based unit suite cannot prove: that Endaoment's actual
///         `donate(uint256)` signature and accounting accept our forwarded net.
/// @dev Gated on two env inputs because neither exists in CI yet:
///        - `BASE_RPC_URL`   — a Base mainnet RPC to fork from.
///        - `ENDAOMENT_ORG`  — a real org Entity address (Epic 5 supplies this).
///      `vm.createSelectFork("")` reverts on an empty URL and would error the
///      whole `forge test` run, so `setUp` reads the env *first*, forks only
///      when both inputs are present, and records `forkReady`. Each test calls
///      `vm.skip(true)` early when `!forkReady`, so the suite reports `[SKIP]`
///      (not pass/fail) until Epic 5 wires the env. Run it then with:
///        `forge test --match-path test/fork/* --fork-url $BASE_RPC_URL`
contract RouterForkTest is Test {
    /// @dev Canonical circle USDC on Base mainnet (6 decimals). Not env-driven —
    ///      this is the fixed token the production router targets on Base.
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    uint256 internal constant DONATION = 100e6; // $100 USDC (6 decimals)

    /// @dev Endaoment expresses fees in "zoc" — parts per 10,000 (their
    ///      contracts' Math.ZOC). `getDonationFeeWithOverrides` returns zoc.
    uint256 internal constant ENDAOMENT_ZOC = 10_000;

    IERC20 internal usdc;
    TransparentDonationRouter internal router;
    address internal endaomentOrg;
    address internal treasury;
    address internal donor;

    /// @dev True only when both env inputs are present and the fork is live.
    ///      Tests short-circuit to `vm.skip` otherwise.
    bool internal forkReady;

    function setUp() public {
        // Read env BEFORE any fork attempt: an empty URL makes createSelectFork
        // revert, which would error the suite instead of skipping it.
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        endaomentOrg = vm.envOr("ENDAOMENT_ORG", address(0));
        if (bytes(rpc).length == 0 || endaomentOrg == address(0)) {
            forkReady = false;
            return;
        }

        vm.createSelectFork(rpc);

        usdc = IERC20(BASE_USDC);
        treasury = makeAddr("treasury");
        donor = makeAddr("donor");
        // This test contract is the allowlist owner (H1); allowlist the real org
        // so the gated donate() forwards on the fork instead of reverting.
        router = new TransparentDonationRouter(BASE_USDC, treasury, address(this));
        router.setOrgAllowed(endaomentOrg, true);
        forkReady = true;
    }

    /// @notice On a real Base fork, a $100 donation skims $1 to our treasury and
    ///         forwards $99 into the real org via its own `donate()` — where
    ///         Endaoment's Registry then takes *its* donation fee (1.5% today,
    ///         read live from the registry, never hardcoded) to Endaoment's
    ///         treasury before crediting the org. Asserted as balance *deltas*
    ///         so pre-existing balances don't matter, with a conservation check
    ///         that the forwarded net splits exactly org + Endaoment fee.
    function testFork_Donate_RealUsdc_RealOrg() public {
        if (!forkReady) {
            vm.skip(true, "BASE_RPC_URL / ENDAOMENT_ORG unset (Epic-5 gated)");
            return;
        }

        (uint256 expectedFee, uint256 expectedNet) = router.previewSplit(DONATION);

        // Endaoment's own fee accounting, read from the live registry: their
        // Entity.donate(net) credits the org `net - net*feeZoc/ZOC` and sends
        // the difference to the registry treasury.
        IEndaomentRegistry registry = IEndaomentEntityView(endaomentOrg).registry();
        uint256 feeZoc = registry.getDonationFeeWithOverrides(endaomentOrg);
        address endaomentTreasury = registry.treasury();
        uint256 expectedEndaomentFee = (expectedNet * feeZoc) / ENDAOMENT_ZOC;
        uint256 expectedOrgCredit = expectedNet - expectedEndaomentFee;

        // Real USDC has no public mint; `deal` overrides the donor's balance slot.
        deal(BASE_USDC, donor, DONATION);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 orgBefore = usdc.balanceOf(endaomentOrg);
        uint256 endaomentTreasuryBefore = usdc.balanceOf(endaomentTreasury);

        vm.startPrank(donor);
        usdc.approve(address(router), DONATION);
        router.donate(endaomentOrg, DONATION);
        vm.stopPrank();

        assertEq(
            usdc.balanceOf(treasury) - treasuryBefore, expectedFee, "treasury should receive the 1% fee in real USDC"
        );
        uint256 orgDelta = usdc.balanceOf(endaomentOrg) - orgBefore;
        assertEq(
            orgDelta,
            expectedOrgCredit,
            "org should be credited the forwarded net minus Endaoment's registry donation fee"
        );
        assertEq(
            usdc.balanceOf(endaomentTreasury) - endaomentTreasuryBefore,
            expectedEndaomentFee,
            "Endaoment's treasury should receive its registry donation fee"
        );
        assertEq(
            orgDelta + expectedEndaomentFee,
            expectedNet,
            "forwarded net must be fully conserved across org credit + Endaoment fee"
        );
        assertEq(usdc.balanceOf(donor), 0, "donor should be fully debited the gross");
        assertEq(usdc.balanceOf(address(router)), 0, "router should retain no USDC after routing");
        assertEq(
            usdc.allowance(address(router), endaomentOrg), 0, "router should leave no residual allowance to the org"
        );
    }
}
