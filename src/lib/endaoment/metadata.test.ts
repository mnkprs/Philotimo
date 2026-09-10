/**
 * Tests for resolveOrgMetadata — metadata resolution with snapshot fallback.
 *
 * Covers exactly three cases per the Task 3 spec:
 *   (a) API succeeds → returns live metadata (capturedAt stamped to now)
 *   (b) API fails for any reason → returns snapshot metadata + logs
 *   (c) API fails AND EIN not in snapshot → throws typed OrgNotFoundError
 *
 * `fetchOrgByEin` is vi.mock'd — no real network, no MSW needed here.
 * The logger is spied on to verify fallback logging.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { resolveOrgMetadata, OrgNotFoundError } from "./metadata";
import type { EndaomentLiveOrg } from "./api";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("./api", () => ({
  fetchOrgByEin: vi.fn(),
}));

// Spy on the project logger to assert fallback logging without console.log.
vi.mock("@/lib/log/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Import after mocking so vitest hoisting applies.
import { fetchOrgByEin } from "./api";
import { logger } from "@/lib/log/logger";

const mockedFetchOrgByEin = fetchOrgByEin as MockedFunction<
  typeof fetchOrgByEin
>;
const mockedLogger = logger as unknown as {
  warn: MockedFunction<typeof logger.warn>;
  error: MockedFunction<typeof logger.error>;
  info: MockedFunction<typeof logger.info>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_ENV = { ENDAOMENT_API_URL: "https://api.endaoment.org" };

/** EIN that IS present in snapshot.json (PCRF). */
const SNAPSHOT_EIN = "93-1057665";

/** EIN that is NOT in snapshot.json and not in the live API. */
const UNKNOWN_EIN = "00-0000000";

/** Live API response shape for PCRF (snapshot EIN) — non-null address required. */
const LIVE_ORG: EndaomentLiveOrg = {
  name: "Palestine Children's Relief Fund",
  ein: SNAPSHOT_EIN,
  mission: "Medical aid, trauma care, and surgical missions for injured children.",
  logoUrl: "https://cdn.endaoment.org/pcrf-logo.png",
  mainnetAddress: "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("resolveOrgMetadata()", () => {
  // -------------------------------------------------------------------------
  // (a) API hit → returns live metadata
  // -------------------------------------------------------------------------
  describe("(a) when the live API succeeds", () => {
    it("returns typed metadata from the live API response", async () => {
      // Arrange
      mockedFetchOrgByEin.mockResolvedValueOnce(LIVE_ORG);

      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert: live fields are returned verbatim
      expect(result.name).toBe(LIVE_ORG.name);
      expect(result.ein).toBe(LIVE_ORG.ein);
      expect(result.mission).toBe(LIVE_ORG.mission);
      expect(result.logoUrl).toBe(LIVE_ORG.logoUrl);
      expect(result.mainnetAddress).toBe(LIVE_ORG.mainnetAddress);
    });

    it("stamps capturedAt as an ISO-8601 date string when using live data", async () => {
      // Arrange
      mockedFetchOrgByEin.mockResolvedValueOnce(LIVE_ORG);
      const beforeCall = new Date().toISOString();

      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      const afterCall = new Date().toISOString();

      // Assert: capturedAt is a valid ISO-8601 string in the [before, after] window
      expect(result.capturedAt).toBeTruthy();
      expect(result.capturedAt >= beforeCall).toBe(true);
      expect(result.capturedAt <= afterCall).toBe(true);
    });

    it("does NOT fall back to the snapshot when the API succeeds", async () => {
      // Arrange
      mockedFetchOrgByEin.mockResolvedValueOnce(LIVE_ORG);

      // Act
      await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert: no warn/error logged (fallback was not activated)
      expect(mockedLogger.warn).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    it("passes the EIN and env through to fetchOrgByEin", async () => {
      // Arrange
      mockedFetchOrgByEin.mockResolvedValueOnce(LIVE_ORG);

      // Act
      await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert
      expect(mockedFetchOrgByEin).toHaveBeenCalledOnce();
      expect(mockedFetchOrgByEin).toHaveBeenCalledWith(SNAPSHOT_EIN, TEST_ENV);
    });
  });

  // -------------------------------------------------------------------------
  // (b) API down/failing → returns snapshot metadata + logs
  // -------------------------------------------------------------------------
  describe("(b) when the live API fails", () => {
    it("returns snapshot metadata when the API throws a network error", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(
        new Error("fetch failed: ECONNREFUSED"),
      );

      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert: snapshot data is returned (PCRF)
      expect(result.ein).toBe(SNAPSHOT_EIN);
      expect(result.name).toBeTruthy();
      expect(result.mission).toBeTruthy();
      // capturedAt from snapshot is the fixed commit date
      expect(result.capturedAt).toBe("2026-05-22");
    });

    it("returns snapshot metadata when the API returns a non-200 status", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(
        new Error("Endaoment org fetch failed: 503 - Service Unavailable"),
      );

      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert
      expect(result.ein).toBe(SNAPSHOT_EIN);
    });

    it("returns snapshot metadata when the API times out", async () => {
      // Arrange
      const abortError = new DOMException("The operation was aborted", "AbortError");
      mockedFetchOrgByEin.mockRejectedValueOnce(abortError);

      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert
      expect(result.ein).toBe(SNAPSHOT_EIN);
    });

    it("logs a server-side warning with the failure reason on fallback", async () => {
      // Arrange
      const apiError = new Error("Endaoment org fetch failed: 500 - Internal Server Error");
      mockedFetchOrgByEin.mockRejectedValueOnce(apiError);

      // Act
      await resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV);

      // Assert: logger.warn was called (not console.warn) with enough context
      expect(mockedLogger.warn).toHaveBeenCalledOnce();
      const [loggedObject] = mockedLogger.warn.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
      expect(loggedObject).toMatchObject({
        ein: SNAPSHOT_EIN,
        source: "snapshot",
      });
    });

    it("does NOT throw when the API fails but snapshot covers the EIN", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(new Error("API down"));

      // Act + Assert: should resolve cleanly
      await expect(
        resolveOrgMetadata(SNAPSHOT_EIN, TEST_ENV),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // (c) neither resolves (unknown EIN + API fails) → throws typed error
  // -------------------------------------------------------------------------
  describe("(c) when neither API nor snapshot resolves the EIN", () => {
    it("throws OrgNotFoundError when API fails and EIN is absent from snapshot", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(new Error("404 - Not Found"));

      // Act + Assert
      await expect(
        resolveOrgMetadata(UNKNOWN_EIN, TEST_ENV),
      ).rejects.toThrow(OrgNotFoundError);
    });

    it("includes the EIN in the thrown OrgNotFoundError message", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(new Error("404 - Not Found"));

      // Act + Assert
      await expect(
        resolveOrgMetadata(UNKNOWN_EIN, TEST_ENV),
      ).rejects.toThrow(UNKNOWN_EIN);
    });

    it("includes a user-safe message in the thrown error", async () => {
      // Arrange
      mockedFetchOrgByEin.mockRejectedValueOnce(new Error("404 - Not Found"));

      // Act
      let thrownError: unknown;
      try {
        await resolveOrgMetadata(UNKNOWN_EIN, TEST_ENV);
      } catch (err) {
        thrownError = err;
      }

      // Assert: user-safe message (no internal stack/server detail)
      expect(thrownError).toBeInstanceOf(OrgNotFoundError);
      const msg = (thrownError as OrgNotFoundError).message;
      expect(msg).not.toContain("ENDAOMENT_API_URL");
      expect(msg).not.toContain("fetch failed");
      expect(msg.length).toBeGreaterThan(10);
    });

    it("throws OrgNotFoundError even when env is omitted (no API call possible)", async () => {
      // Act + Assert: no env → no live call → unknown EIN must throw
      await expect(
        resolveOrgMetadata(UNKNOWN_EIN),
      ).rejects.toThrow(OrgNotFoundError);

      // fetchOrgByEin should NOT be called when env is absent
      expect(mockedFetchOrgByEin).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // env omitted → snapshot-only path
  // -------------------------------------------------------------------------
  describe("when env is omitted", () => {
    it("resolves from snapshot without calling the API when env is absent", async () => {
      // Act
      const result = await resolveOrgMetadata(SNAPSHOT_EIN);

      // Assert: snapshot data returned, live API never hit
      expect(result.ein).toBe(SNAPSHOT_EIN);
      expect(mockedFetchOrgByEin).not.toHaveBeenCalled();
    });
  });
});
