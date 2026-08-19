import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./server";

const VALID_ENV = Object.freeze({
  STRIPE_SECRET_KEY: "sk_test_abcdef1234567890",
  STRIPE_ONRAMP_WEBHOOK_SECRET: "whsec_abcdef1234567890",
  KV_REST_API_URL: "https://example-kv.upstash.io",
  KV_REST_API_TOKEN: "kv_token_abcdef1234567890",
  ROUTER_ADDRESS_BASE_SEPOLIA: "0x1234567890aBcDeF1234567890AbCdEf12345678",
  USDC_CONTRACT_BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  NEXT_PUBLIC_CHAIN: "base-sepolia",
});

describe("loadServerEnv()", () => {
  it("parses a valid env object and returns typed values", () => {
    const env = loadServerEnv(VALID_ENV);

    expect(env.STRIPE_SECRET_KEY).toBe(VALID_ENV.STRIPE_SECRET_KEY);
    expect(env.STRIPE_ONRAMP_WEBHOOK_SECRET).toBe(
      VALID_ENV.STRIPE_ONRAMP_WEBHOOK_SECRET,
    );
    expect(env.KV_REST_API_URL).toBe(VALID_ENV.KV_REST_API_URL);
    expect(env.KV_REST_API_TOKEN).toBe(VALID_ENV.KV_REST_API_TOKEN);
    expect(env.ROUTER_ADDRESS_BASE_SEPOLIA).toBe(
      VALID_ENV.ROUTER_ADDRESS_BASE_SEPOLIA,
    );
    expect(env.USDC_CONTRACT_BASE_SEPOLIA).toBe(
      VALID_ENV.USDC_CONTRACT_BASE_SEPOLIA,
    );
    expect(env.NEXT_PUBLIC_CHAIN).toBe("base-sepolia");
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    const { STRIPE_SECRET_KEY: _omit, ...incomplete } = VALID_ENV;
    void _omit;
    expect(() => loadServerEnv(incomplete)).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("throws when STRIPE_ONRAMP_WEBHOOK_SECRET is missing", () => {
    const { STRIPE_ONRAMP_WEBHOOK_SECRET: _omit, ...incomplete } = VALID_ENV;
    void _omit;
    expect(() => loadServerEnv(incomplete)).toThrow(
      /STRIPE_ONRAMP_WEBHOOK_SECRET/,
    );
  });

  it("throws when KV_REST_API_URL is missing", () => {
    const { KV_REST_API_URL: _omit, ...incomplete } = VALID_ENV;
    void _omit;
    expect(() => loadServerEnv(incomplete)).toThrow(/KV_REST_API_URL/);
  });

  it("throws when KV_REST_API_TOKEN is missing", () => {
    const { KV_REST_API_TOKEN: _omit, ...incomplete } = VALID_ENV;
    void _omit;
    expect(() => loadServerEnv(incomplete)).toThrow(/KV_REST_API_TOKEN/);
  });

  it("rejects ROUTER_ADDRESS_BASE_SEPOLIA that is not a 0x-prefixed 40-hex address", () => {
    expect(() =>
      loadServerEnv({ ...VALID_ENV, ROUTER_ADDRESS_BASE_SEPOLIA: "not-an-addr" }),
    ).toThrow(/ROUTER_ADDRESS_BASE_SEPOLIA/);

    expect(() =>
      loadServerEnv({
        ...VALID_ENV,
        ROUTER_ADDRESS_BASE_SEPOLIA: "0x123",
      }),
    ).toThrow(/ROUTER_ADDRESS_BASE_SEPOLIA/);
  });

  it("rejects USDC_CONTRACT_BASE_SEPOLIA that is not a 0x-prefixed 40-hex address", () => {
    expect(() =>
      loadServerEnv({ ...VALID_ENV, USDC_CONTRACT_BASE_SEPOLIA: "0xZZZ" }),
    ).toThrow(/USDC_CONTRACT_BASE_SEPOLIA/);
  });

  it("rejects NEXT_PUBLIC_CHAIN values outside the literal union", () => {
    expect(() =>
      loadServerEnv({ ...VALID_ENV, NEXT_PUBLIC_CHAIN: "mainnet" }),
    ).toThrow(/NEXT_PUBLIC_CHAIN/);
  });

  it("accepts NEXT_PUBLIC_CHAIN=base for production parity", () => {
    const env = loadServerEnv({ ...VALID_ENV, NEXT_PUBLIC_CHAIN: "base" });
    expect(env.NEXT_PUBLIC_CHAIN).toBe("base");
  });

  it("accepts an absent ROUTER_ADDRESS_BASE (mainnet router not deployed yet)", () => {
    const env = loadServerEnv(VALID_ENV);
    expect(env.ROUTER_ADDRESS_BASE).toBeUndefined();
  });

  it("parses a valid ROUTER_ADDRESS_BASE when provided", () => {
    const env = loadServerEnv({
      ...VALID_ENV,
      ROUTER_ADDRESS_BASE: "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12",
    });
    expect(env.ROUTER_ADDRESS_BASE).toBe(
      "0xAbCdEf1234567890aBcDeF1234567890AbCdEf12",
    );
  });

  it("rejects ROUTER_ADDRESS_BASE that is not a 0x-prefixed 40-hex address", () => {
    expect(() =>
      loadServerEnv({ ...VALID_ENV, ROUTER_ADDRESS_BASE: "not-an-addr" }),
    ).toThrow(/ROUTER_ADDRESS_BASE/);

    expect(() =>
      loadServerEnv({ ...VALID_ENV, ROUTER_ADDRESS_BASE: "0x123" }),
    ).toThrow(/ROUTER_ADDRESS_BASE/);
  });
});
