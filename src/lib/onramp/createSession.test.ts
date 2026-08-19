import { describe, expect, it } from "vitest";
import { buildSessionRequest } from "./createSession";
import { TEST_ENV, VALID_INPUT } from "./test-fixtures";

describe("buildSessionRequest()", () => {
  it("targets USDC on the network from NEXT_PUBLIC_CHAIN", () => {
    const req = buildSessionRequest(VALID_INPUT, TEST_ENV);
    expect(req.destinationCurrency).toBe("usdc");
    expect(req.destinationNetwork).toBe("base-sepolia");
  });

  it("throws on mainnet base while ROUTER_ADDRESS_BASE is not configured", () => {
    expect(() =>
      buildSessionRequest(VALID_INPUT, {
        ...TEST_ENV,
        NEXT_PUBLIC_CHAIN: "base",
      }),
    ).toThrow(/ROUTER_ADDRESS_BASE/);
  });

  it("targets the mainnet router on base once ROUTER_ADDRESS_BASE is configured", () => {
    const mainnetRouter = "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12";
    const req = buildSessionRequest(VALID_INPUT, {
      ...TEST_ENV,
      NEXT_PUBLIC_CHAIN: "base",
      ROUTER_ADDRESS_BASE: mainnetRouter,
    });
    expect(req.destinationNetwork).toBe("base");
    expect(req.destinationWalletAddress).toBe(mainnetRouter);
  });

  it("never routes a base-sepolia session to the mainnet router (chain selects the address)", () => {
    const req = buildSessionRequest(VALID_INPUT, {
      ...TEST_ENV,
      ROUTER_ADDRESS_BASE: "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12",
    });
    expect(req.destinationNetwork).toBe("base-sepolia");
    expect(req.destinationWalletAddress).toBe(
      TEST_ENV.ROUTER_ADDRESS_BASE_SEPOLIA,
    );
  });

  it("routes settlement to the router contract address (full gross, fee taken on-chain)", () => {
    const req = buildSessionRequest(VALID_INPUT, TEST_ENV);
    expect(req.destinationWalletAddress).toBe(
      TEST_ENV.ROUTER_ADDRESS_BASE_SEPOLIA,
    );
  });

  it("converts gross cents to a USDC decimal string at 1:1 ($50.00 -> 50.00)", () => {
    const req = buildSessionRequest(VALID_INPUT, TEST_ENV);
    expect(req.destinationAmount).toBe("50.00");
  });

  it("preserves sub-dollar precision (333 cents -> 3.33)", () => {
    const req = buildSessionRequest({ ...VALID_INPUT, grossCents: 333 }, TEST_ENV);
    expect(req.destinationAmount).toBe("3.33");
  });

  it("formats large amounts without separators (1,000,000 cents -> 10000.00)", () => {
    const req = buildSessionRequest(
      { ...VALID_INPUT, grossCents: 1_000_000 },
      TEST_ENV,
    );
    expect(req.destinationAmount).toBe("10000.00");
  });

  it("carries the donor email and campaign id for reconciliation", () => {
    const req = buildSessionRequest(VALID_INPUT, TEST_ENV);
    expect(req.customerEmail).toBe("donor@example.com");
    expect(req.metadata.campaign_id).toBe("pcrf");
  });

  it("trims surrounding whitespace from email before forwarding", () => {
    const req = buildSessionRequest(
      { ...VALID_INPUT, email: "  donor@example.com  " },
      TEST_ENV,
    );
    expect(req.customerEmail).toBe("donor@example.com");
  });

  it("trims surrounding whitespace from campaignId", () => {
    const req = buildSessionRequest(
      { ...VALID_INPUT, campaignId: "  pcrf  " },
      TEST_ENV,
    );
    expect(req.metadata.campaign_id).toBe("pcrf");
  });

  it("throws when grossCents is zero", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, grossCents: 0 }, TEST_ENV),
    ).toThrow(/grossCents/);
  });

  it("throws when grossCents is negative", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, grossCents: -100 }, TEST_ENV),
    ).toThrow(/grossCents/);
  });

  it("throws when grossCents is not an integer (cents must be whole)", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, grossCents: 50.5 }, TEST_ENV),
    ).toThrow(/grossCents/);
  });

  it("throws when email is missing or blank", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, email: "" }, TEST_ENV),
    ).toThrow(/email/);
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, email: "   " }, TEST_ENV),
    ).toThrow(/email/);
  });

  it("throws when email is structurally malformed", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, email: "notanemail" }, TEST_ENV),
    ).toThrow(/email/);
  });

  it("throws when campaignId is missing or blank", () => {
    expect(() =>
      buildSessionRequest({ ...VALID_INPUT, campaignId: "" }, TEST_ENV),
    ).toThrow(/campaign/i);
  });
});
