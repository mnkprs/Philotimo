// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {TransparentDonationRouter} from "../src/TransparentDonationRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEndaomentOrg} from "./mocks/MockEndaomentOrg.sol";
import {MockReentrantOrg} from "./mocks/MockReentrantOrg.sol";

/// @title TransparentDonationRouter unit suite
/// @notice Tasks 1–3 — constructor & immutables, fee math, donate happy-path.
///         Later tasks (guards/reverts, fork) append here.
contract TransparentDonationRouterTest is Test {
    // Constructor tests (Task 1) only need a non-zero address for `usdc`/
    // `treasury`. Task 3 needs a *real* ERC20 the router can move, so `setUp`
    // deploys a MockERC20 and feeds its address in as the USDC immutable.
    MockERC20 internal token;
    MockEndaomentOrg internal org;
    address internal usdc;
    address internal treasury;
    address internal donor;

    TransparentDonationRouter internal router;

    /// @dev Mirrors the contract's own event so `vm.expectEmit` has a typed
    ///      reference. Must stay byte-identical to the contract declaration.
    event DonationRouted(address indexed donor, address indexed org, uint256 gross, uint256 fee, uint256 net);

    function setUp() public {
        token = new MockERC20();
        usdc = address(token);
        treasury = makeAddr("treasury");
        donor = makeAddr("donor");
        // This test contract is the router owner, so it can curate the allowlist
        // directly. Happy-path donate tests target `org`, which the allowlist
        // gate (H1) now requires to be explicitly allowed first.
        router = new TransparentDonationRouter(usdc, treasury, address(this));
        org = new MockEndaomentOrg(token);
        router.setOrgAllowed(address(org), true);
    }

    // --- Task 1: constructor stores immutables --------------------------------

    function test_Constructor_SetsUsdcAndTreasury() public view {
        // address(...) cast lets this assertion survive the GREEN promotion of
        // `usdc` from `address` to `IERC20` without a test edit.
        assertEq(address(router.usdc()), usdc, "usdc not stored");
        assertEq(router.treasury(), treasury, "treasury not stored");
    }

    // --- Task 1: zero-address rejection ---------------------------------------

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(TransparentDonationRouter.ZeroAddress.selector);
        new TransparentDonationRouter(address(0), treasury, address(this));
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(TransparentDonationRouter.ZeroAddress.selector);
        new TransparentDonationRouter(usdc, address(0), address(this));
    }

    // --- H1: constructor wires the allowlist owner -----------------------------

    function test_Constructor_SetsOwner() public view {
        assertEq(router.owner(), address(this), "constructor should set the allowlist owner");
    }

    /// @notice A zero owner is rejected by OZ Ownable's own constructor guard
    ///         (`OwnableInvalidOwner`), so we never deploy an unownable router
    ///         whose allowlist could never be curated.
    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new TransparentDonationRouter(usdc, treasury, address(0));
    }

    // --- Task 1: fee constants ------------------------------------------------

    function test_FeeConstants() public view {
        assertEq(router.FEE_BPS(), 100, "FEE_BPS must be 1%");
        assertEq(router.BPS_DENOMINATOR(), 10_000, "BPS_DENOMINATOR must be 100%");
    }

    // --- Task 2: fee split math (previewSplit) --------------------------------

    /// @notice Canonical case: $100 USDC (6 decimals) splits into $1 fee / $99 net.
    function test_PreviewSplit_OnePercent() public view {
        (uint256 fee, uint256 net) = router.previewSplit(100e6);
        assertEq(fee, 1e6, "fee should be 1% of 100 USDC");
        assertEq(net, 99e6, "net should be remaining 99 USDC");
    }

    /// @notice Integer floor: amounts below 100 base units yield zero fee, so the
    ///         donor's full amount forwards as net (sub-$0.0001 dust keeps 1/99
    ///         conservation: 0 + 99 == 99).
    function test_PreviewSplit_RoundsDown() public view {
        (uint256 fee, uint256 net) = router.previewSplit(99);
        assertEq(fee, 0, "fee floors to zero below 100 units");
        assertEq(net, 99, "net keeps the full amount when fee floors out");
    }

    /// @notice Invariant over the full overflow-safe range: the split is lossless
    ///         (fee + net == amount) and fee matches the exact floor formula.
    /// @dev Upper bound = type(uint256).max / FEE_BPS so `amount * FEE_BPS` cannot
    ///      overflow; beyond that the 0.8.x checked multiply would revert on
    ///      inputs no real USDC supply could reach.
    function testFuzz_PreviewSplit_Conservation(uint256 amount) public view {
        amount = bound(amount, 0, type(uint256).max / router.FEE_BPS());

        (uint256 fee, uint256 net) = router.previewSplit(amount);

        assertEq(fee + net, amount, "split must be lossless");
        assertEq(fee, (amount * 100) / 10_000, "fee must equal exact floor formula");
    }

    // --- Task 3: happy-path donate --------------------------------------------

    uint256 internal constant DONATION = 100e6; // $100 USDC
    uint256 internal constant EXPECTED_FEE = 1e6; // 1% → $1
    uint256 internal constant EXPECTED_NET = 99e6; // 99% → $99

    /// @dev Funds the donor and pre-approves the router for `amount`. The CEI
    ///      flow pulls gross from the donor, so without this the transferFrom
    ///      leg reverts — every happy-path test starts from here.
    function _fundAndApprove(uint256 amount) internal {
        token.mint(donor, amount);
        vm.prank(donor);
        token.approve(address(router), amount);
    }

    function test_Donate_PullsGrossFromDonor() public {
        _fundAndApprove(DONATION);

        vm.prank(donor);
        router.donate(address(org), DONATION);

        assertEq(token.balanceOf(donor), 0, "donor should be debited the full gross");
    }

    function test_Donate_SendsFeeToTreasury() public {
        _fundAndApprove(DONATION);

        vm.prank(donor);
        router.donate(address(org), DONATION);

        assertEq(token.balanceOf(treasury), EXPECTED_FEE, "treasury should receive the 1% fee");
    }

    function test_Donate_ForwardsNetToOrg_ViaDonate() public {
        _fundAndApprove(DONATION);

        vm.prank(donor);
        router.donate(address(org), DONATION);

        // The org records what it pulled through its own donate() — proving the
        // forward ran via the Endaoment seam, not a raw transfer.
        assertEq(org.totalReceived(), EXPECTED_NET, "org should record the net via donate()");
        assertEq(token.balanceOf(address(org)), EXPECTED_NET, "org should hold the net");
    }

    function test_Donate_LeavesNoLeftoverAllowance() public {
        _fundAndApprove(DONATION);

        vm.prank(donor);
        router.donate(address(org), DONATION);

        // Combined invariant: the router approves exactly `net` and the honest
        // mock org pulls exactly `net`, draining the allowance to zero. (A
        // malicious org pulling less would leave dust — a Task 4 concern.)
        assertEq(token.allowance(address(router), address(org)), 0, "no residual approval to org");
        assertEq(token.balanceOf(address(router)), 0, "router should hold no USDC after routing");
    }

    function test_Donate_EmitsDonationRouted() public {
        _fundAndApprove(DONATION);

        // Match both indexed topics (donor, org) and the full data payload
        // (gross, fee, net): expectEmit(checkTopic1, checkTopic2, checkTopic3, checkData).
        vm.expectEmit(true, true, false, true, address(router));
        emit DonationRouted(donor, address(org), DONATION, EXPECTED_FEE, EXPECTED_NET);

        vm.prank(donor);
        router.donate(address(org), DONATION);
    }

    // --- Task 4: guards & reverts ---------------------------------------------

    /// @notice A zero org address is rejected by the `endaomentOrg != 0` check
    ///         before any token movement.
    function test_Donate_RevertsOnZeroOrg() public {
        _fundAndApprove(DONATION);

        vm.expectRevert(TransparentDonationRouter.ZeroAddress.selector);
        vm.prank(donor);
        router.donate(address(0), DONATION);
    }

    /// @notice A zero gross amount is rejected by the `amount > 0` check.
    function test_Donate_RevertsOnZeroAmount() public {
        _fundAndApprove(DONATION);

        vm.expectRevert(TransparentDonationRouter.ZeroAmount.selector);
        vm.prank(donor);
        router.donate(address(org), 0);
    }

    /// @notice With funds but no approval, the `safeTransferFrom` pull reverts.
    ///         OZ surfaces `ERC20InsufficientAllowance(spender, allowance, needed)`
    ///         where the spender is the router pulling on the donor's behalf. The
    ///         full error is encoded because `expectRevert(bytes4)` only matches a
    ///         bare 4-byte revert, not a parameterized custom error.
    function test_Donate_RevertsWhenNoAllowance() public {
        token.mint(donor, DONATION); // funded but NOT approved

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, DONATION)
        );
        vm.prank(donor);
        router.donate(address(org), DONATION);
    }

    /// @notice With approval but no balance, the pull reverts on
    ///         `ERC20InsufficientBalance(sender, balance, needed)` — the donor
    ///         holds zero USDC.
    function test_Donate_RevertsWhenInsufficientBalance() public {
        vm.prank(donor); // approved the router, but donor holds zero USDC
        token.approve(address(router), DONATION);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, donor, 0, DONATION));
        vm.prank(donor);
        router.donate(address(org), DONATION);
    }

    /// @notice A malicious org that re-enters `router.donate()` during its own
    ///         `donate()` callback is stopped by `nonReentrant`. The reentrant
    ///         call hits the guard at function entry (before any checks), so the
    ///         whole outer tx reverts with `ReentrancyGuardReentrantCall`.
    function test_Donate_NonReentrant() public {
        MockReentrantOrg attacker = new MockReentrantOrg(router);
        // Allowlist the attacker so donate() passes the H1 gate and actually
        // reaches the external call where reentrancy is attempted — otherwise
        // OrgNotAllowed short-circuits before the guard is ever exercised.
        router.setOrgAllowed(address(attacker), true);
        _fundAndApprove(DONATION);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(donor);
        router.donate(address(attacker), DONATION);
    }

    // --- H1: owner-curated org allowlist --------------------------------------
    //
    // Closes the spoofable-DonationRouted finding at the router level: donate()
    // only forwards to orgs the owner has explicitly vetted, so a legitimate
    // DonationRouted log can no longer be emitted for an attacker-controlled org.
    // (Tradeoff accepted: this reintroduces an owner key the original immutable
    // design omitted — see review finding M4. The owner must be a multisig.)

    /// @dev Mirrors the contract's allowlist event for typed `vm.expectEmit`.
    event OrgAllowanceUpdated(address indexed org, bool allowed);

    /// @notice The core H1 gate: an org the owner has NOT allowlisted is rejected
    ///         before any token movement, even with funds and approval in place.
    function test_Donate_RevertsWhenOrgNotAllowed() public {
        MockEndaomentOrg strangerOrg = new MockEndaomentOrg(token); // never allowlisted
        _fundAndApprove(DONATION);

        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.OrgNotAllowed.selector, address(strangerOrg)));
        vm.prank(donor);
        router.donate(address(strangerOrg), DONATION);
    }

    /// @notice Only the owner may curate the allowlist; OZ Ownable surfaces
    ///         `OwnableUnauthorizedAccount(caller)` for everyone else.
    function test_SetOrgAllowed_RevertsForNonOwner() public {
        address stranger = makeAddr("stranger");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        router.setOrgAllowed(address(org), true);
    }

    /// @notice Allowlisting an org flips its flag and emits the audit event.
    function test_SetOrgAllowed_AllowsAndEmits() public {
        MockEndaomentOrg fresh = new MockEndaomentOrg(token);

        vm.expectEmit(true, false, false, true, address(router));
        emit OrgAllowanceUpdated(address(fresh), true);
        router.setOrgAllowed(address(fresh), true);

        assertTrue(router.allowedOrgs(address(fresh)), "org should be allowlisted");
    }

    /// @notice Allowlisting is reversible: the owner can revoke a previously
    ///         vetted org, after which donate() to it reverts again.
    function test_SetOrgAllowed_CanRevoke() public {
        // `org` was allowlisted in setUp.
        router.setOrgAllowed(address(org), false);

        assertFalse(router.allowedOrgs(address(org)), "org should be revoked");

        _fundAndApprove(DONATION);
        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.OrgNotAllowed.selector, address(org)));
        vm.prank(donor);
        router.donate(address(org), DONATION);
    }

    /// @notice The zero address can never be allowlisted — guarded explicitly so
    ///         the curated set never contains a meaningless entry.
    function test_SetOrgAllowed_RevertsOnZeroOrg() public {
        vm.expectRevert(TransparentDonationRouter.ZeroAddress.selector);
        router.setOrgAllowed(address(0), true);
    }

    // --- C1: operator-triggered routing of held (on-ramp settled) USDC ---------
    //
    // Stripe Crypto Onramp settles USDC to the router with a PLAIN ERC-20
    // transfer — it cannot attach donate() calldata. Without a way to route a
    // balance the contract already holds, every fiat settlement would be
    // permanently stranded (adversarial review, critical finding C1). routeHeld
    // closes that gap: an owner-appointed operator (or the owner itself) splits
    // an already-held gross 1%/99% keyed by a unique session ref, so a
    // double-fired webhook can never route the same settlement twice.

    /// @dev Mirrors the contract's events for typed `vm.expectEmit`.
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event HeldDonationRouted(bytes32 indexed sessionRef, address indexed org, uint256 gross, uint256 fee, uint256 net);

    bytes32 internal constant SESSION_REF = keccak256("cos_test_123");

    address internal operator;

    /// @dev Simulates a Stripe settlement: USDC lands in the router's balance
    ///      via a plain mint/transfer, with no calldata and no approvals.
    function _settleToRouter(uint256 amount) internal {
        token.mint(address(router), amount);
    }

    /// @dev Appoints `operator` (lazily created) and returns it, mirroring the
    ///      runbook's post-deploy `setOperator` step.
    function _appointOperator() internal returns (address) {
        operator = makeAddr("operator");
        router.setOperator(operator);
        return operator;
    }

    // --- C1: operator appointment ----------------------------------------------

    function test_SetOperator_RevertsForNonOwner() public {
        address stranger = makeAddr("stranger");

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        router.setOperator(stranger);
    }

    function test_SetOperator_SetsAndEmits() public {
        address next = makeAddr("operator");

        vm.expectEmit(true, true, false, true, address(router));
        emit OperatorUpdated(address(0), next);
        router.setOperator(next);

        assertEq(router.operator(), next, "operator should be stored");
    }

    /// @notice Clearing the operator (zero address) is a deliberate kill switch:
    ///         held routing halts until the owner appoints a new operator, while
    ///         the owner itself can still route as fallback.
    function test_SetOperator_CanClear() public {
        address appointed = _appointOperator();

        vm.expectEmit(true, true, false, true, address(router));
        emit OperatorUpdated(appointed, address(0));
        router.setOperator(address(0));

        assertEq(router.operator(), address(0), "operator should be cleared");

        _settleToRouter(DONATION);
        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.NotOperator.selector, appointed));
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);
    }

    // --- C1: routeHeld happy path -----------------------------------------------

    function test_RouteHeld_SplitsHeldBalance() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);

        assertEq(token.balanceOf(treasury), EXPECTED_FEE, "treasury should receive the 1% fee");
        assertEq(org.totalReceived(), EXPECTED_NET, "org should record the net via donate()");
        assertEq(token.balanceOf(address(org)), EXPECTED_NET, "org should hold the net");
        assertEq(token.balanceOf(address(router)), 0, "router should hold no USDC after routing");
        assertEq(token.allowance(address(router), address(org)), 0, "no residual approval to org");
    }

    function test_RouteHeld_EmitsHeldDonationRouted() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.expectEmit(true, true, false, true, address(router));
        emit HeldDonationRouted(SESSION_REF, address(org), DONATION, EXPECTED_FEE, EXPECTED_NET);

        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);
    }

    /// @notice The owner is always a valid routing fallback — if the operator key
    ///         is lost, held settlements are delayed, never stranded.
    function test_RouteHeld_OwnerCanRoute() public {
        _settleToRouter(DONATION);

        // No operator appointed; this test contract is the owner.
        router.routeHeld(SESSION_REF, address(org), DONATION);

        assertEq(token.balanceOf(treasury), EXPECTED_FEE, "owner-routed fee should reach treasury");
        assertEq(org.totalReceived(), EXPECTED_NET, "owner-routed net should reach org");
    }

    /// @notice Routing one session's gross must not touch USDC held for other,
    ///         not-yet-routed settlements sharing the same contract balance.
    function test_RouteHeld_LeavesOtherHeldFundsUntouched() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION); // session A
        _settleToRouter(50e6); // session B, settled but not yet routed

        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);

        assertEq(token.balanceOf(address(router)), 50e6, "unrouted session's funds must remain held");
    }

    // --- C1: routeHeld guards ----------------------------------------------------

    function test_RouteHeld_RevertsForUnauthorizedCaller() public {
        _appointOperator();
        _settleToRouter(DONATION);
        address stranger = makeAddr("stranger");

        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.NotOperator.selector, stranger));
        vm.prank(stranger);
        router.routeHeld(SESSION_REF, address(org), DONATION);
    }

    /// @notice A zero session ref can never mark the idempotency map — every
    ///         routed settlement must be attributable to a real session.
    function test_RouteHeld_RevertsOnZeroSessionRef() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.expectRevert(TransparentDonationRouter.ZeroSessionRef.selector);
        vm.prank(appointed);
        router.routeHeld(bytes32(0), address(org), DONATION);
    }

    function test_RouteHeld_RevertsOnZeroOrg() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.expectRevert(TransparentDonationRouter.ZeroAddress.selector);
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(0), DONATION);
    }

    function test_RouteHeld_RevertsWhenOrgNotAllowed() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);
        MockEndaomentOrg strangerOrg = new MockEndaomentOrg(token); // never allowlisted

        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.OrgNotAllowed.selector, address(strangerOrg)));
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(strangerOrg), DONATION);
    }

    function test_RouteHeld_RevertsOnZeroAmount() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.expectRevert(TransparentDonationRouter.ZeroAmount.selector);
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), 0);
    }

    /// @notice Routing more than the contract holds must revert BEFORE any token
    ///         movement — a mis-keyed amount cannot spend other sessions' funds
    ///         past the held balance.
    function test_RouteHeld_RevertsWhenAmountExceedsHeld() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.expectRevert(
            abi.encodeWithSelector(TransparentDonationRouter.InsufficientHeldBalance.selector, DONATION + 1, DONATION)
        );
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION + 1);
    }

    /// @notice Idempotency at the contract layer: even if the off-chain webhook
    ///         dedup fails, the same session ref can never be routed twice.
    function test_RouteHeld_RevertsOnReplayedSessionRef() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION * 2);

        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);

        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.SessionAlreadyRouted.selector, SESSION_REF));
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);

        assertTrue(router.routedSessions(SESSION_REF), "session ref should be marked routed");
    }

    /// @notice A replayed session ref must surface `SessionAlreadyRouted` even
    ///         when its amount ALSO exceeds the (now-reduced) held balance —
    ///         otherwise a webhook double-fire reads as a funding problem
    ///         instead of the replay it actually is (review L2).
    function test_RouteHeld_ReplayBeatsInsufficientBalanceInRevertPriority() public {
        address appointed = _appointOperator();
        _settleToRouter(DONATION);

        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);
        // Held balance is now zero, so DONATION also fails the balance check.

        vm.expectRevert(abi.encodeWithSelector(TransparentDonationRouter.SessionAlreadyRouted.selector, SESSION_REF));
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(org), DONATION);
    }

    /// @notice The reentrancy guard is shared across donate() and routeHeld(): a
    ///         malicious org re-entering `router.donate()` from inside the
    ///         routeHeld forwarding call reverts the whole routing tx.
    function test_RouteHeld_NonReentrant() public {
        address appointed = _appointOperator();
        MockReentrantOrg attacker = new MockReentrantOrg(router);
        router.setOrgAllowed(address(attacker), true);
        _settleToRouter(DONATION);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(appointed);
        router.routeHeld(SESSION_REF, address(attacker), DONATION);
    }
}
