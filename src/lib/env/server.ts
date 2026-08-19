import { z } from "zod";

/**
 * Server-only environment schema.
 *
 * Validated at first request time, never at module-import time, so
 * Next.js build does not require real secrets. The pure `loadServerEnv()`
 * factory accepts an arbitrary object so tests can pass synthetic input;
 * production code uses the memoised `serverEnv()` accessor over `process.env`.
 */

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export const serverEnvSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_ONRAMP_WEBHOOK_SECRET: z
    .string()
    .min(1, "STRIPE_ONRAMP_WEBHOOK_SECRET is required"),
  KV_REST_API_URL: z.string().url("KV_REST_API_URL must be a valid URL"),
  KV_REST_API_TOKEN: z.string().min(1, "KV_REST_API_TOKEN is required"),
  ROUTER_ADDRESS_BASE_SEPOLIA: z
    .string()
    .regex(
      EVM_ADDRESS,
      "ROUTER_ADDRESS_BASE_SEPOLIA must match 0x[a-fA-F0-9]{40}",
    ),
  /**
   * Base MAINNET router address. Optional until the mainnet deployment ships
   * (runbook step 6): while absent, mainnet session creation refuses rather
   * than routing to a non-existent contract.
   */
  ROUTER_ADDRESS_BASE: z
    .string()
    .regex(EVM_ADDRESS, "ROUTER_ADDRESS_BASE must match 0x[a-fA-F0-9]{40}")
    .optional(),
  USDC_CONTRACT_BASE_SEPOLIA: z
    .string()
    .regex(
      EVM_ADDRESS,
      "USDC_CONTRACT_BASE_SEPOLIA must match 0x[a-fA-F0-9]{40}",
    ),
  NEXT_PUBLIC_CHAIN: z.enum(["base", "base-sepolia"]),
  /**
   * Endaoment REST API base URL. Defaults to the production endpoint so
   * development and CI work without explicit configuration. Override in
   * `.env.local` when you need to point at a staging instance.
   */
  ENDAOMENT_API_URL: z
    .string()
    .url("ENDAOMENT_API_URL must be a valid URL")
    .default("https://api.endaoment.org"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ServerEnvError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid server env:\n  - ${issues.join("\n  - ")}`);
    this.name = "ServerEnvError";
  }
}

export function loadServerEnv(source: Record<string, unknown>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
  throw new ServerEnvError(issues);
}

let cached: ServerEnv | null = null;

/**
 * Memoised accessor for production code. Pays the Zod cost once per process.
 * Tests should call `loadServerEnv(synthetic)` directly to avoid touching
 * `process.env`.
 */
export function serverEnv(): ServerEnv {
  if (cached === null) {
    cached = loadServerEnv(process.env);
  }
  return cached;
}
