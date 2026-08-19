/**
 * Pure builder: donor input + server env -> typed Stripe Crypto Onramp request.
 *
 * No I/O, no SDK, no env reads of its own — the caller injects a validated
 * `ServerEnv`. This keeps the request shape fully testable and makes the
 * `stripe.ts` wrapper a thin serialize-and-POST layer.
 *
 * Fee model (ADR 0002 + its 2026-08-19 amendment): the on-ramp settles the
 * FULL gross USDC to the router contract as a plain transfer; the 1% platform
 * fee is deducted on-chain downstream when `routeHeld` splits the held gross.
 * That is why the destination amount is derived straight from `grossCents`
 * with no fee math.
 */

import type { ServerEnv } from "@/lib/env/server";
import type { CreateSessionInput, StripeOnrampRequest } from "@/types/onramp";

const CENTS_PER_DOLLAR = 100;

/** Pragmatic email shape check; the Phase 4 route applies the authoritative Zod gate. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** USDC is pegged 1:1 to USD here; cents map directly to a 2-dp dollar string. */
function centsToUsdcAmount(grossCents: number): string {
  return (grossCents / CENTS_PER_DOLLAR).toFixed(2);
}

/**
 * The router deployed on the ACTIVE chain — never a cross-network address.
 * Mainnet's router is optional in the env schema until it is deployed
 * (runbook step 6), so refuse mainnet sessions while it is absent rather
 * than settling donor funds to a non-existent contract.
 */
function routerAddressForChain(env: ServerEnv): string {
  if (env.NEXT_PUBLIC_CHAIN === "base") {
    if (!env.ROUTER_ADDRESS_BASE) {
      throw new Error(
        "Mainnet base is not configured: set ROUTER_ADDRESS_BASE to the deployed router address (or use NEXT_PUBLIC_CHAIN=base-sepolia)",
      );
    }
    return env.ROUTER_ADDRESS_BASE;
  }
  return env.ROUTER_ADDRESS_BASE_SEPOLIA;
}

export function buildSessionRequest(
  input: CreateSessionInput,
  env: ServerEnv,
): StripeOnrampRequest {
  const { grossCents } = input;
  const email = input.email.trim();
  const campaignId = input.campaignId.trim();

  if (!Number.isInteger(grossCents) || grossCents <= 0) {
    throw new Error(
      `Invalid onramp input: grossCents must be a positive integer, received ${grossCents}`,
    );
  }
  if (email.length === 0) {
    throw new Error("Invalid onramp input: email is required");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Invalid onramp input: email must be a valid email address");
  }
  if (campaignId.length === 0) {
    throw new Error("Invalid onramp input: campaignId is required");
  }

  return {
    destinationCurrency: "usdc",
    destinationNetwork: env.NEXT_PUBLIC_CHAIN,
    destinationAmount: centsToUsdcAmount(grossCents),
    destinationWalletAddress: routerAddressForChain(env),
    customerEmail: email,
    metadata: { campaign_id: campaignId },
  };
}
