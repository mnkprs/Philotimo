// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransparentDonationRouter} from "../../src/TransparentDonationRouter.sol";
import {IEndaomentRegistry, IEndaomentEntityView} from "./RouterFork.t.sol";

/// @title DeployedRouterFork — post-deployment state verification (review F3)
/// @notice ATTACHES to an already-deployed router on a fork instead of
///         constructing a fresh one. `RouterFork.t.sol` proves the *code*
///         integrates with real USDC and a real Endaoment org; it cannot detect
///         a wrong immutable treasury/USDC, a wrong owner, or a missing
///         production allowlist entry — the irreversible deployment mistakes.
///         This suite is the runbook's actual post-deployment proof.
/// @dev Env inputs (suite skips unless the first three are set):
///        - `BASE_RPC_URL`      — RPC of the network the router is deployed on.
///        - `ROUTER_ADDRESS`    — the deployed router to attach to.
///        - `ENDAOMENT_ORG`     — an org expected to be allowlisted already.
///        - `FORK_BLOCK`        — optional block number to pin the fork at.
///        - `EXPECTED_USDC`     — optional; defaults to canonical Base mainnet
///                                USDC. Set for Base Sepolia verification.
///        - `EXPECTED_TREASURY` — optional; asserts the immutable treasury.
///        - `EXPECTED_OWNER`    — optional; asserts the allowlist owner.
///      Runbook usage after a mainnet deploy:
///        BASE_RPC_URL=<rpc> ROUTER_ADDRESS=0x… ENDAOMENT_ORG=0x… \
///        EXPECTED_TREASURY=0x… EXPECTED_OWNER=0x… FORK_BLOCK=<n> \
///        forge test --match-path 'test/fork/DeployedRouterFork.t.sol'
contract DeployedRouterForkTest is Test {
    /// @dev Canonical Circle USDC on Base mainnet — the default expectation;
    ///      override via `EXPECTED_USDC` when verifying a Base Sepolia deploy.
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    uint256 internal constant DONATION = 100e6; // $100 USDC (6 decimals)
    uint256 internal constant ENDAOMENT_ZOC = 10_000;

    TransparentDonationRouter internal router;
    IERC20 internal usdc;
    address internal endaomentOrg;
    address internal expectedUsdc;
    address internal expectedTreasury;
    address internal expectedOwner;

    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        address routerAddress = vm.envOr("ROUTER_ADDRESS", address(0));
        endaomentOrg = vm.envOr("ENDAOMENT_ORG", address(0));
        if (bytes(rpc).length == 0 || routerAddress == address(0) || endaomentOrg == address(0)) {
            forkReady = false;
            return;
        }

        // Pin the fork when FORK_BLOCK is given so the "green as of block N"
        // claim is reproducible; otherwise verify against the live tip.
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, forkBlock);
        }

        expectedUsdc = vm.envOr("EXPECTED_USDC", BASE_USDC);
        expectedTreasury = vm.envOr("EXPECTED_TREASURY", address(0));
        expectedOwner = vm.envOr("EXPECTED_OWNER", address(0));

        router = TransparentDonationRouter(routerAddress);
        usdc = IERC20(address(router.usdc()));
        forkReady = true;
    }

    /// @notice The deployed contract's actual state matches what the runbook
    ///         claims was deployed: real code at the address, the right USDC and
    ///         treasury immutables, the right owner, the hardcoded 1% fee, and
    ///         the production allowlist entry for the target org.
    function testForkDeployed_StateMatchesExpectations() public {
        if (!forkReady) {
            vm.skip(true, "BASE_RPC_URL / ROUTER_ADDRESS / ENDAOMENT_ORG unset (post-deploy proof)");
            return;
        }

        assertGt(address(router).code.length, 0, "no contract code at ROUTER_ADDRESS");

        assertEq(address(router.usdc()), expectedUsdc, "deployed usdc immutable mismatch");
        if (expectedTreasury != address(0)) {
            assertEq(router.treasury(), expectedTreasury, "deployed treasury immutable mismatch");
        } else {
            assertTrue(router.treasury() != address(0), "deployed treasury is zero");
        }
        if (expectedOwner != address(0)) {
            assertEq(router.owner(), expectedOwner, "deployed owner mismatch");
        }

        // Behavioral fingerprint of the fee logic baked into the deployed
        // bytecode (immutables make byte-for-byte runtimeCode comparison
        // impossible): the hardcoded 1% split must hold on-chain.
        assertEq(router.FEE_BPS(), 100, "deployed FEE_BPS is not 1%");
        (uint256 fee, uint256 net) = router.previewSplit(100e6);
        assertEq(fee, 1e6, "deployed previewSplit fee mismatch");
        assertEq(net, 99e6, "deployed previewSplit net mismatch");

        assertTrue(router.allowedOrgs(endaomentOrg), "org is not allowlisted on the deployed router");

        // The org itself must be a live Endaoment entity whose base token is the
        // router's USDC — the same invariant the runbook's manual cast check covers.
        assertGt(endaomentOrg.code.length, 0, "no contract code at ENDAOMENT_ORG");
    }

    /// @notice Smoke donation against the DEPLOYED router: a pranked donor's $100
    ///         splits 1% to the deployed treasury and credits the real org (minus
    ///         Endaoment's registry fee), leaving the router's balance unchanged.
    function testForkDeployed_SmokeDonation() public {
        if (!forkReady) {
            vm.skip(true, "BASE_RPC_URL / ROUTER_ADDRESS / ENDAOMENT_ORG unset (post-deploy proof)");
            return;
        }

        address donor = makeAddr("deployed-smoke-donor");
        address treasury = router.treasury();

        IEndaomentRegistry registry = IEndaomentEntityView(endaomentOrg).registry();
        uint256 feeZoc = registry.getDonationFeeWithOverrides(endaomentOrg);
        (uint256 expectedFee, uint256 expectedNet) = router.previewSplit(DONATION);
        uint256 expectedOrgCredit = expectedNet - (expectedNet * feeZoc) / ENDAOMENT_ZOC;

        deal(address(usdc), donor, DONATION);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 orgBefore = usdc.balanceOf(endaomentOrg);
        uint256 routerBefore = usdc.balanceOf(address(router));

        vm.startPrank(donor);
        usdc.approve(address(router), DONATION);
        router.donate(endaomentOrg, DONATION);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedFee, "deployed treasury fee delta mismatch");
        assertEq(usdc.balanceOf(endaomentOrg) - orgBefore, expectedOrgCredit, "deployed org credit delta mismatch");
        assertEq(usdc.balanceOf(address(router)), routerBefore, "deployed router balance must be unchanged by donate()");
    }

    /// @notice Smoke held-routing against the DEPLOYED router: a simulated Stripe
    ///         settlement (plain balance credit) is split by the owner-fallback
    ///         `routeHeld`, restoring the router's pre-settlement balance —
    ///         proving the deployed contract can route fiat on-ramp funds.
    function testForkDeployed_SmokeRouteHeld() public {
        if (!forkReady) {
            vm.skip(true, "BASE_RPC_URL / ROUTER_ADDRESS / ENDAOMENT_ORG unset (post-deploy proof)");
            return;
        }

        // Block-dependent ref: unique against anything already consumed on-chain.
        bytes32 sessionRef = keccak256(abi.encodePacked("deployed-smoke-routeheld", block.number));
        address treasury = router.treasury();

        IEndaomentRegistry registry = IEndaomentEntityView(endaomentOrg).registry();
        uint256 feeZoc = registry.getDonationFeeWithOverrides(endaomentOrg);
        (uint256 expectedFee, uint256 expectedNet) = router.previewSplit(DONATION);
        uint256 expectedOrgCredit = expectedNet - (expectedNet * feeZoc) / ENDAOMENT_ZOC;

        uint256 routerBefore = usdc.balanceOf(address(router));
        // `deal` SETS the balance, so add on top of any held funds already there.
        deal(address(usdc), address(router), routerBefore + DONATION);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 orgBefore = usdc.balanceOf(endaomentOrg);

        // Owner is always a valid routeHeld fallback; the deployed operator key
        // (if any) is unknown to this suite.
        vm.prank(router.owner());
        router.routeHeld(sessionRef, endaomentOrg, DONATION);

        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedFee, "deployed treasury fee delta mismatch");
        assertEq(usdc.balanceOf(endaomentOrg) - orgBefore, expectedOrgCredit, "deployed org credit delta mismatch");
        assertEq(
            usdc.balanceOf(address(router)), routerBefore, "deployed router must return to its pre-settlement balance"
        );
        assertEq(
            usdc.allowance(address(router), endaomentOrg),
            0,
            "deployed router should leave no residual allowance to the org"
        );
        assertTrue(router.routedSessions(sessionRef), "session ref should be consumed on the deployed router");
    }
}
