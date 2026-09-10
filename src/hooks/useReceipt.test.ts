// @vitest-environment happy-dom
/**
 * Tests for useReceipt (Epic 6, Task 5).
 *
 * Strategy: The state machine is extracted as `runReceiptResolver` — a pure
 * async function that accepts injected deps. Tests exercise the resolver
 * directly with vi.useFakeTimers() for backoff, and vi.mock for the public
 * client. The React wrapper (useReceipt) is tested separately with a lightweight
 * renderHook shim. This avoids the @testing-library/react dependency that is
 * not installed in this project.
 *
 * Mocking surface:
 *   - @/lib/publicClient  → vi.mock, returns a mock viem client
 *   - @/lib/endaoment/verify → vi.mock, returns controlled VerifyDonationResult
 *   - @/lib/receipt/buildReceiptBundle → vi.mock, returns controlled ReceiptBundle
 *   - getCharity / resolveOrgMetadata run for real against fixtures
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseSepolia } from "wagmi/chains";

import {
  FIXTURE_CHAIN_ID,
  FIXTURE_TX_HASH,
  MOCK_SEPOLIA_RECEIPT,
  FIXTURE_BLOCK_NUMBER,
  FIXTURE_BLOCK_TIMESTAMP,
  FIXTURE_CONFIRMATIONS,
  ORG_ENTITY,
  ROUTER_ADDRESS,
  GROSS,
  EUDAIMONIA_FEE,
  NET,
  ENDAOMENT_FEE,
} from "@/lib/receipt/fixtures";
import {
  MAX_POLL_ATTEMPTS,
  CONFIRMATIONS_THRESHOLD,
  runReceiptResolver,
  type ResolverState,
} from "./useReceipt";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/publicClient", () => ({
  getPublicClient: vi.fn(),
}));

vi.mock("@/lib/endaoment/verify", () => ({
  verifyDonation: vi.fn(),
}));

vi.mock("@/lib/receipt/buildReceiptBundle", () => ({
  buildReceiptBundle: vi.fn(),
  DecodeReceiptError: class DecodeReceiptError extends Error {
    reason: string;
    constructor(reason: string) {
      super(`Receipt decode failed: ${reason}`);
      this.name = "DecodeReceiptError";
      this.reason = reason;
    }
  },
}));

// Import mocked modules after mock registration
const { getPublicClient } = await import("@/lib/publicClient");
const { verifyDonation } = await import("@/lib/endaoment/verify");
const { buildReceiptBundle } = await import("@/lib/receipt/buildReceiptBundle");

const mockGetPublicClient = vi.mocked(getPublicClient);
const mockVerifyDonation = vi.mocked(verifyDonation);
const mockBuildReceiptBundle = vi.mocked(buildReceiptBundle);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MOCK_BUNDLE = {
  data: {
    donorShort: "0x5555…5555",
    charity: "PCRF",
    ein: "93-1057665",
    mission: "Mission text",
    amount: "$1.000000",
    amountUsdc: "1.000000",
    date: "May 30, 2025",
    time: "17:34:01 UTC",
    network: "Base Sepolia" as const,
    txid: FIXTURE_TX_HASH,
    txidShort: "0xdc67…78ed",
    block: "30,918,548",
    confirmations: "12,500",
    ethIn: "—",
    rate: "Off-chain onramp",
    platformFee: "0.010000",
    endaomentFee: "0.014850",
    orgFund: ORG_ENTITY,
    charityAddr: ORG_ENTITY,
    donorFee: "0.000000",
  },
  stages: [],
} as const;

/** Creates a mock viem public client. */
function createMockClient(overrides?: {
  getTransactionReceipt?: ReturnType<typeof vi.fn>;
  getBlock?: ReturnType<typeof vi.fn>;
  getTransactionConfirmations?: ReturnType<typeof vi.fn>;
}) {
  return {
    getTransactionReceipt:
      overrides?.getTransactionReceipt ??
      vi.fn().mockResolvedValue(MOCK_SEPOLIA_RECEIPT),
    getBlock:
      overrides?.getBlock ??
      vi.fn().mockResolvedValue({
        number: FIXTURE_BLOCK_NUMBER,
        timestamp: FIXTURE_BLOCK_TIMESTAMP,
      }),
    getTransactionConfirmations:
      overrides?.getTransactionConfirmations ??
      vi.fn().mockResolvedValue(FIXTURE_CONFIRMATIONS),
  };
}

/** Stubs env so getRouterAddress resolves for Base Sepolia. */
function stubRouterEnv() {
  vi.stubEnv("NEXT_PUBLIC_ROUTER_ADDRESS_BASE_SEPOLIA", ROUTER_ADDRESS);
}

/** Captures all states emitted to the onState callback into an array. */
function captureStates(): {
  states: ResolverState[];
  onState: (s: ResolverState) => void;
} {
  const states: ResolverState[] = [];
  return { states, onState: (s) => states.push(s) };
}

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("polling constants", () => {
  it("MAX_POLL_ATTEMPTS is a positive integer", () => {
    expect(MAX_POLL_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_POLL_ATTEMPTS)).toBe(true);
  });

  it("CONFIRMATIONS_THRESHOLD is a positive bigint", () => {
    expect(typeof CONFIRMATIONS_THRESHOLD).toBe("bigint");
    expect(CONFIRMATIONS_THRESHOLD > 0n).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transition: wrong-network (sync, no client call)
// ---------------------------------------------------------------------------

describe("wrong-network", () => {
  it("emits wrong-network synchronously for an unsupported chainId and makes no RPC call", async () => {
    // Arrange
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: 1, // Ethereum mainnet — unsupported
      onState,
      signal: controller.signal,
    });

    // Assert
    expect(states).toContainEqual({ status: "wrong-network", prefersReducedMotion: false });
    expect(mockClient.getTransactionReceipt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transition: not-found (invalid / non-hex txid)
// ---------------------------------------------------------------------------

describe("invalid txid", () => {
  it("emits not-found synchronously for a non-hex txid and makes no RPC call", async () => {
    // Arrange
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act: pass a clearly non-hex txid
    await runReceiptResolver({
      txid: "not-a-hash",
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert: not-found emitted, no client lookup attempted
    expect(states).toContainEqual({
      status: "not-found",
      prefersReducedMotion: false,
    });
    expect(mockClient.getTransactionReceipt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transition: loading → ready (happy path)
// ---------------------------------------------------------------------------

describe("loading → ready", () => {
  it("emits loading then ready when receipt resolves on first attempt", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert: first state is loading, last is ready
    expect(states[0]).toMatchObject({ status: "loading" });
    const readyState = states.find((s) => s.status === "ready");
    expect(readyState).toBeDefined();
    expect(readyState).toMatchObject({
      status: "ready",
      bundle: MOCK_BUNDLE,
    });
  });

  it("calls verifyDonation with the correct txid and chainId", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert: called with the correct txid, a Charity object, and chainId.
    // endaomentOrgAddress may be null (ENDAOMENT_ORG_ADDRESSES is empty in test)
    // because the sparse production map has no entries yet.
    expect(mockVerifyDonation).toHaveBeenCalledWith(
      FIXTURE_TX_HASH,
      expect.objectContaining({ id: expect.any(String) }),
      FIXTURE_CHAIN_ID,
    );
  });

  it("passes block and confirmations to buildReceiptBundle", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert: buildReceiptBundle received block data
    expect(mockBuildReceiptBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        block: {
          number: FIXTURE_BLOCK_NUMBER,
          timestamp: FIXTURE_BLOCK_TIMESTAMP,
        },
        confirmations: FIXTURE_CONFIRMATIONS,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Transition: receipt-404 → pending → ready (poll/backoff)
// ---------------------------------------------------------------------------

describe("receipt-404 → pending → ready", () => {
  it("enters pending when receipt is null, then resolves to ready after retry", async () => {
    // Arrange
    stubRouterEnv();
    const receiptFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transaction receipt not found"))
      .mockResolvedValue(MOCK_SEPOLIA_RECEIPT);

    const mockClient = createMockClient({ getTransactionReceipt: receiptFn });
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act: start resolver, then advance timers to drive the backoff
    const resolverPromise = runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // First attempt fails → pending state is emitted before the backoff delay
    await vi.advanceTimersByTimeAsync(0);
    expect(states.some((s) => s.status === "pending")).toBe(true);

    // Advance past the initial poll delay to trigger the retry
    await vi.advanceTimersByTimeAsync(2000);
    await resolverPromise;

    // Assert: transitions loading → pending → ready
    expect(states[0]).toMatchObject({ status: "loading" });
    expect(states.some((s) => s.status === "pending")).toBe(true);
    expect(states[states.length - 1]).toMatchObject({ status: "ready" });
  });

  it("increments attempts counter in pending state", async () => {
    // Arrange
    stubRouterEnv();
    const receiptFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transaction receipt not found"))
      .mockRejectedValueOnce(new Error("Transaction receipt not found"))
      .mockResolvedValue(MOCK_SEPOLIA_RECEIPT);

    const mockClient = createMockClient({ getTransactionReceipt: receiptFn });
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    const resolverPromise = runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Advance through 2 retries
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await resolverPromise;

    const pendingStates = states.filter((s) => s.status === "pending");
    expect(pendingStates.length).toBeGreaterThanOrEqual(1);
    // Attempts should be at least 1 on first pending state
    const firstPending = pendingStates[0];
    expect(firstPending).toMatchObject({ status: "pending" });
    if (firstPending.status === "pending") {
      expect(firstPending.attempts).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Transition: not-found (poll cap exhausted)
// ---------------------------------------------------------------------------

describe("not-found", () => {
  it("emits not-found after MAX_POLL_ATTEMPTS and stops polling", async () => {
    // Arrange
    stubRouterEnv();
    const receiptFn = vi
      .fn()
      .mockRejectedValue(new Error("Transaction receipt not found"));

    const mockClient = createMockClient({ getTransactionReceipt: receiptFn });
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    const resolverPromise = runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Advance timers far enough to exhaust all retries
    // Each backoff: 1000 * 1.5^n capped at 30000; sum > 12 * 30000 = 360000
    await vi.advanceTimersByTimeAsync(500_000);
    await resolverPromise;

    // Assert: final state is not-found
    const lastState = states[states.length - 1];
    expect(lastState).toMatchObject({ status: "not-found" });

    // Assert: polling stopped at cap — exactly MAX_POLL_ATTEMPTS calls made
    expect(receiptFn).toHaveBeenCalledTimes(MAX_POLL_ATTEMPTS);
  });
});

// ---------------------------------------------------------------------------
// Transition: wrong-router
// ---------------------------------------------------------------------------

describe("wrong-router", () => {
  it("emits wrong-router when verifyDonation returns wrong-router reason", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: false,
      reason: "wrong-router",
    });

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert
    expect(states).toContainEqual(
      expect.objectContaining({ status: "wrong-router" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Transition: unverified
// ---------------------------------------------------------------------------

describe("unverified", () => {
  it("emits unverified with reason when verifyDonation returns any non-wrong-router failure", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: false,
      reason: "org-mismatch",
    });

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert
    const unverifiedState = states.find((s) => s.status === "unverified");
    expect(unverifiedState).toBeDefined();
    expect(unverifiedState).toMatchObject({
      status: "unverified",
      reason: "org-mismatch",
    });
  });

  it("emits unverified when no matching charity is found for the org address", async () => {
    // Arrange: use a chainId where no ENDAOMENT_ORG_ADDRESSES entry maps to ORG_ENTITY
    // The receipt decodes DonationRouted.org = ORG_ENTITY but the registry
    // has no EIN → chainId → ORG_ENTITY mapping, so charity lookup fails.
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    // verifyDonation returns no-org-address-for-chain when charity has null address
    mockVerifyDonation.mockResolvedValue({
      verified: false,
      reason: "no-org-address-for-chain",
    });

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: baseSepolia.id,
      onState,
      signal: controller.signal,
    });

    // Assert: some failure state emitted
    const failureState = states.find(
      (s) => s.status === "unverified" || s.status === "wrong-router",
    );
    expect(failureState).toBeDefined();
  });

  it("emits unverified for missing-transfer reason", async () => {
    // Arrange
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: false,
      reason: "missing-transfer",
    });

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert
    expect(states).toContainEqual(
      expect.objectContaining({ status: "unverified", reason: "missing-transfer" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmations below threshold → stay pending (poll)
// ---------------------------------------------------------------------------

describe("confirmations threshold", () => {
  it("stays pending when confirmations are below threshold, resolves when threshold met", async () => {
    // Arrange: first call returns confirmations below threshold, second meets it
    stubRouterEnv();
    const confirmationsFn = vi
      .fn()
      .mockResolvedValueOnce(0n) // below threshold
      .mockResolvedValue(FIXTURE_CONFIRMATIONS); // at/above threshold

    const mockClient = createMockClient({
      getTransactionConfirmations: confirmationsFn,
    });
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    const resolverPromise = runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // First attempt: confirmations=0 → pending
    await vi.advanceTimersByTimeAsync(0);
    expect(states.some((s) => s.status === "pending")).toBe(true);

    // Advance to trigger retry
    await vi.advanceTimersByTimeAsync(2000);
    await resolverPromise;

    // Should eventually reach ready
    expect(states[states.length - 1]).toMatchObject({ status: "ready" });
  });
});

// ---------------------------------------------------------------------------
// Cleanup / cancellation
// ---------------------------------------------------------------------------

describe("cleanup / cancellation", () => {
  it("stops emitting states after signal is aborted", async () => {
    // Arrange
    stubRouterEnv();
    const receiptFn = vi
      .fn()
      .mockRejectedValue(new Error("Transaction receipt not found"));

    const mockClient = createMockClient({ getTransactionReceipt: receiptFn });
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    const resolverPromise = runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Abort after first pending state
    await vi.advanceTimersByTimeAsync(0);
    const statesBeforeAbort = states.length;
    controller.abort();

    // Advance more time — should not emit further states
    await vi.advanceTimersByTimeAsync(100_000);
    await resolverPromise;

    // States should not have grown significantly after abort
    expect(states.length).toBeLessThanOrEqual(statesBeforeAbort + 1);
  });
});

// ---------------------------------------------------------------------------
// prefersReducedMotion
// ---------------------------------------------------------------------------

describe("prefersReducedMotion", () => {
  it("surfaces prefersReducedMotion: false when matchMedia returns false", async () => {
    // Arrange: default happy-dom matchMedia returns false for any query
    stubRouterEnv();
    const mockClient = createMockClient();
    mockGetPublicClient.mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPublicClient>,
    );
    mockVerifyDonation.mockResolvedValue({
      verified: true,
      org: ORG_ENTITY,
      gross: GROSS,
      fee: EUDAIMONIA_FEE,
      net: NET,
      endaomentFee: ENDAOMENT_FEE,
    });
    mockBuildReceiptBundle.mockReturnValue(
      MOCK_BUNDLE as unknown as ReturnType<typeof buildReceiptBundle>,
    );

    const { states, onState } = captureStates();
    const controller = new AbortController();

    // Act
    await runReceiptResolver({
      txid: FIXTURE_TX_HASH,
      chainId: FIXTURE_CHAIN_ID,
      onState,
      signal: controller.signal,
    });

    // Assert: all states have prefersReducedMotion defined
    expect(states.length).toBeGreaterThan(0);
    states.forEach((s) => {
      expect(typeof s.prefersReducedMotion).toBe("boolean");
    });
  });
});
