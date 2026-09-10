/**
 * Tests for buildReceiptBundle (Epic 6, Task 3) — TDD RED phase.
 *
 * All assertions run against the canonical MOCK_SEPOLIA_RECEIPT fixture from
 * Task 0. The function is pure (no I/O); the caller (Task 5 hook) fetches
 * charity/orgMetadata/block and passes them in.
 *
 * Decisions tested:
 *   D1 — Stage 1 = "Donated (USDC in)"; Stage 2 = off-chain informational.
 *   D2 — Both fees populated from decoded on-chain values.
 *   D5 — Single block timestamp; all relative labels = "same block".
 */

import { describe, expect, it } from "vitest";
import type { Charity, EndaomentOrgMetadata } from "@/types/charity";
import {
  MOCK_SEPOLIA_RECEIPT,
  ROUTER_ADDRESS,
  ORG_ENTITY,
  FIXTURE_BLOCK_NUMBER,
  FIXTURE_BLOCK_TIMESTAMP,
  FIXTURE_CONFIRMATIONS,
  FIXTURE_CHAIN_ID,
  FIXTURE_EUDAIMONIA_FEE_ACTIVE,
} from "./fixtures";
import { buildReceiptBundle, DecodeReceiptError } from "./buildReceiptBundle";

// ---------------------------------------------------------------------------
// Stub inputs — caller-fetched values that buildReceiptBundle does NOT fetch
// ---------------------------------------------------------------------------

const STUB_CHARITY: Charity = {
  id: "direct-relief",
  name: "Direct Relief",
  ein: "95-1831116",
  endaomentOrgAddress: ORG_ENTITY,
  baseScanUrl:
    "https://sepolia.basescan.org/address/0x4444444444444444444444444444444444444444",
};

const STUB_ORG_METADATA: EndaomentOrgMetadata = {
  name: "Direct Relief",
  ein: "95-1831116",
  mission:
    "Improve the health and lives of people affected by poverty or emergencies.",
  logoUrl: null,
  mainnetAddress: null,
  capturedAt: "2026-05-22",
};

const STUB_BLOCK = {
  number: FIXTURE_BLOCK_NUMBER,
  timestamp: FIXTURE_BLOCK_TIMESTAMP,
};

// ---------------------------------------------------------------------------
// Helper: build a valid bundle (reused across multiple tests)
// ---------------------------------------------------------------------------

function buildValid() {
  return buildReceiptBundle({
    receipt: MOCK_SEPOLIA_RECEIPT,
    routerAddress: ROUTER_ADDRESS,
    orgAddress: ORG_ENTITY,
    chainId: FIXTURE_CHAIN_ID,
    txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
    charity: STUB_CHARITY,
    orgMetadata: STUB_ORG_METADATA,
    block: STUB_BLOCK,
    confirmations: FIXTURE_CONFIRMATIONS,
  });
}

// ---------------------------------------------------------------------------
// Top-level shape
// ---------------------------------------------------------------------------

describe("buildReceiptBundle", () => {
  it("returns a ReceiptBundle with data + stages", () => {
    const bundle = buildValid();
    expect(bundle).toHaveProperty("data");
    expect(bundle).toHaveProperty("stages");
    expect(bundle.stages).toHaveLength(5);
    expect(bundle.stages.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });

  // -------------------------------------------------------------------------
  // D1 — Stage 1: USDC in; Stage 2: off-chain informational
  // -------------------------------------------------------------------------

  describe("D1 — Stage 1 (Donated, USDC in)", () => {
    it("stage 1 has unit USDC and amount equal to gross (1.0 USDC)", () => {
      const stage1 = buildValid().stages[0];
      expect(stage1.n).toBe(1);
      expect(stage1.title).toBe("Donated");
      expect(stage1.unit).toBe("USDC");
      // formatUnits(1_000_000n, 6) = "1" — padded to 6 dp in implementation
      expect(stage1.amount).toBe("1.000000");
    });

    it("stage 1 address is the donor address (truncated)", () => {
      const stage1 = buildValid().stages[0];
      // DONOR = 0x5555555555555555555555555555555555555555
      expect(stage1.address).toMatch(/^0x5555/);
      expect(stage1.address).toContain("…");
      expect(stage1.addressLabel).toBe("From");
    });

    it("stage 1 contract label is Wallet · EOA", () => {
      expect(buildValid().stages[0].contract).toBe("Wallet · EOA");
    });
  });

  describe("D1 — Stage 2 (Converted, off-chain informational)", () => {
    it("stage 2 is marked inactive (off-chain, no on-chain execution)", () => {
      const stage2 = buildValid().stages[1];
      expect(stage2.n).toBe(2);
      expect(stage2.title).toBe("Converted");
      expect(stage2.inactive).toBe(true);
    });

    it("stage 2 does not contain fabricated ETH amount or Uniswap references", () => {
      const stage2 = buildValid().stages[1];
      // No ETH unit — off-chain fiat-to-USDC provenance
      expect(stage2.unit).not.toBe("ETH");
      // No Uniswap pool label
      expect(stage2.address).not.toMatch(/[Uu]niswap/);
      expect(stage2.contract).not.toMatch(/[Uu]niswap/);
      // No fabricated ETH amount
      expect(stage2.amount).toBe("—");
    });
  });

  // -------------------------------------------------------------------------
  // D2 — Both fees from decoded on-chain values
  // -------------------------------------------------------------------------

  describe("D2 — Fee fields from on-chain values", () => {
    it("ReceiptData.platformFee is the Eudaimonia 1% fee (0.010000 USDC)", () => {
      // EUDAIMONIA_FEE = 10_000n → formatUnits → "0.01", padded = "0.010000"
      expect(buildValid().data.platformFee).toBe("0.010000");
    });

    it("ReceiptData.endaomentFee is the Endaoment protocol fee (0.014850 USDC)", () => {
      // ENDAOMENT_FEE = 14_850n → formatUnits → "0.01485", padded = "0.014850"
      expect(buildValid().data.endaomentFee).toBe("0.014850");
    });

    it("stage 4 (Eudaimonia fee) is ACTIVE for a router tx", () => {
      const stage4 = buildValid().stages[3];
      expect(stage4.n).toBe(4);
      expect(stage4.title).toBe("Eudaimonia fee");
      expect(stage4.inactive).toBeFalsy();
      expect(FIXTURE_EUDAIMONIA_FEE_ACTIVE).toBe(true); // sanity: fixture flag
    });

    it("stage 4 amount matches the decoded eudaimoniaFee", () => {
      expect(buildValid().stages[3].amount).toBe("0.010000");
    });

    it("stage 3 (Routed) feeOnHover carries the Endaoment fee", () => {
      const stage3 = buildValid().stages[2];
      expect(stage3.feeOnHover).toBeDefined();
      expect(stage3.feeOnHover?.amount).toBe("0.014850");
    });
  });

  // -------------------------------------------------------------------------
  // D5 — Single block timestamp; relative = "same block"
  // -------------------------------------------------------------------------

  describe("D5 — Single block; relative = 'same block'", () => {
    it("all active stages share the same timestamp (block timestamp)", () => {
      const { stages } = buildValid();
      const ts = stages[0].timestamp;
      expect(ts).toBe("17:34:01 UTC");
      // Stage 2 is off-chain informational — its timestamp is "—"
      expect(stages[1].timestamp).toBe("—");
      // Stages 3, 4, 5 share the block timestamp
      for (const idx of [2, 3, 4]) {
        expect(stages[idx].timestamp).toBe(ts);
      }
    });

    it("stage 1 relative is the block date (May 30, 2025)", () => {
      expect(buildValid().stages[0].relative).toBe("May 30, 2025");
    });

    it("stages 3, 4, 5 have relative = 'same block'", () => {
      const { stages } = buildValid();
      for (const idx of [2, 3, 4]) {
        expect(stages[idx].relative).toBe("same block");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Block / confirmations formatting
  // -------------------------------------------------------------------------

  describe("ReceiptData block and confirmations formatting", () => {
    it("block is formatted with thousands separators", () => {
      expect(buildValid().data.block).toBe("30,918,548");
    });

    it("confirmations is formatted with thousands separators", () => {
      expect(buildValid().data.confirmations).toBe("12,500");
    });
  });

  // -------------------------------------------------------------------------
  // Charity / metadata field mapping
  // -------------------------------------------------------------------------

  describe("ReceiptData charity fields", () => {
    it("charity name comes from orgMetadata", () => {
      expect(buildValid().data.charity).toBe(STUB_ORG_METADATA.name);
    });

    it("mission comes from orgMetadata", () => {
      expect(buildValid().data.mission).toBe(STUB_ORG_METADATA.mission);
    });

    it("ein comes from charity", () => {
      expect(buildValid().data.ein).toBe(STUB_CHARITY.ein);
    });

    it("charityAddr is the decoded on-chain org address", () => {
      // Decoded `org` from the receipt, not from the sparse registry
      expect((buildValid().data.charityAddr as string).toLowerCase()).toBe(
        ORG_ENTITY.toLowerCase(),
      );
    });

    it("donorShort is a truncated version of the donor address", () => {
      const { donorShort } = buildValid().data;
      expect(donorShort).toMatch(/^0x5555/);
      expect(donorShort).toContain("…");
    });
  });

  // -------------------------------------------------------------------------
  // Date / time formatting
  // -------------------------------------------------------------------------

  describe("ReceiptData date and time from block timestamp", () => {
    it("date is May 30, 2025 (en-US, UTC)", () => {
      expect(buildValid().data.date).toBe("May 30, 2025");
    });

    it("time is 17:34:01 UTC (24-hour, UTC)", () => {
      expect(buildValid().data.time).toBe("17:34:01 UTC");
    });
  });

  // -------------------------------------------------------------------------
  // amountUsdc in ReceiptData
  // -------------------------------------------------------------------------

  describe("ReceiptData amountUsdc", () => {
    it("amountUsdc is the gross formatted to 6 dp", () => {
      expect(buildValid().data.amountUsdc).toBe("1.000000");
    });
  });

  // -------------------------------------------------------------------------
  // Stage 5 terminal flag
  // -------------------------------------------------------------------------

  describe("Stage 5 (Settled) terminal", () => {
    it("stage 5 is marked terminal and carries the netToEntity amount", () => {
      const stage5 = buildValid().stages[4];
      expect(stage5.n).toBe(5);
      expect(stage5.terminal).toBe(true);
      // NET_TO_ENTITY = 975_150n → "0.97515" → padded "0.975150"
      expect(stage5.amount).toBe("0.975150");
      expect(stage5.unit).toBe("USDC");
    });

    it("stage 5 address is the org entity address (truncated)", () => {
      const stage5 = buildValid().stages[4];
      expect(stage5.address).toMatch(/^0x4444/);
      expect(stage5.address).toContain("…");
      expect(stage5.addressLabel).toBe("Charity");
    });
  });

  // -------------------------------------------------------------------------
  // Decode failure → typed error
  // -------------------------------------------------------------------------

  describe("decode failure surfacing", () => {
    it("throws DecodeReceiptError with reason 'wrong-router' when routerAddress is foreign", () => {
      expect(() =>
        buildReceiptBundle({
          receipt: MOCK_SEPOLIA_RECEIPT,
          routerAddress: "0x0000000000000000000000000000000000000001",
          orgAddress: ORG_ENTITY,
          chainId: FIXTURE_CHAIN_ID,
          txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
          charity: STUB_CHARITY,
          orgMetadata: STUB_ORG_METADATA,
          block: STUB_BLOCK,
          confirmations: FIXTURE_CONFIRMATIONS,
        }),
      ).toThrow(DecodeReceiptError);
    });

    it("thrown DecodeReceiptError carries the reason from the decoder", () => {
      try {
        buildReceiptBundle({
          receipt: MOCK_SEPOLIA_RECEIPT,
          routerAddress: "0x0000000000000000000000000000000000000001",
          orgAddress: ORG_ENTITY,
          chainId: FIXTURE_CHAIN_ID,
          txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
          charity: STUB_CHARITY,
          orgMetadata: STUB_ORG_METADATA,
          block: STUB_BLOCK,
          confirmations: FIXTURE_CONFIRMATIONS,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DecodeReceiptError);
        expect((err as DecodeReceiptError).reason).toBe("wrong-router");
      }
    });

    it("throws DecodeReceiptError with reason 'missing-legs' when orgAddress is wrong", () => {
      expect(() =>
        buildReceiptBundle({
          receipt: MOCK_SEPOLIA_RECEIPT,
          routerAddress: ROUTER_ADDRESS,
          orgAddress: "0x0000000000000000000000000000000000000002",
          chainId: FIXTURE_CHAIN_ID,
          txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
          charity: STUB_CHARITY,
          orgMetadata: STUB_ORG_METADATA,
          block: STUB_BLOCK,
          confirmations: FIXTURE_CONFIRMATIONS,
        }),
      ).toThrow(DecodeReceiptError);
    });
  });

  // -------------------------------------------------------------------------
  // E6.2 — network label uses explicit chain id constants, not magic numbers
  // -------------------------------------------------------------------------

  describe("E6.2 — data.network label", () => {
    it("labels Base mainnet (8453) as 'Base'", () => {
      const bundle = buildReceiptBundle({
        receipt: MOCK_SEPOLIA_RECEIPT,
        routerAddress: ROUTER_ADDRESS,
        orgAddress: ORG_ENTITY,
        chainId: 8453,
        txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
        charity: STUB_CHARITY,
        orgMetadata: STUB_ORG_METADATA,
        block: STUB_BLOCK,
        confirmations: FIXTURE_CONFIRMATIONS,
      });
      expect(bundle.data.network).toBe("Base");
    });

    it("labels Base Sepolia (84532) as 'Base Sepolia'", () => {
      const bundle = buildReceiptBundle({
        receipt: MOCK_SEPOLIA_RECEIPT,
        routerAddress: ROUTER_ADDRESS,
        orgAddress: ORG_ENTITY,
        chainId: 84532,
        txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
        charity: STUB_CHARITY,
        orgMetadata: STUB_ORG_METADATA,
        block: STUB_BLOCK,
        confirmations: FIXTURE_CONFIRMATIONS,
      });
      expect(bundle.data.network).toBe("Base Sepolia");
    });

    it("labels any other chain id as 'Unknown' instead of mislabeling as 'Base Sepolia'", () => {
      const bundle = buildReceiptBundle({
        receipt: MOCK_SEPOLIA_RECEIPT,
        routerAddress: ROUTER_ADDRESS,
        orgAddress: ORG_ENTITY,
        chainId: 1, // Ethereum mainnet — neither Base nor Base Sepolia
        txid: MOCK_SEPOLIA_RECEIPT.transactionHash,
        charity: STUB_CHARITY,
        orgMetadata: STUB_ORG_METADATA,
        block: STUB_BLOCK,
        confirmations: FIXTURE_CONFIRMATIONS,
      });
      expect(bundle.data.network).toBe("Unknown");
    });
  });

  // -------------------------------------------------------------------------
  // txid field mapping
  // -------------------------------------------------------------------------

  describe("ReceiptData txid fields", () => {
    it("txid is the full transaction hash", () => {
      expect(buildValid().data.txid).toBe(MOCK_SEPOLIA_RECEIPT.transactionHash);
    });

    it("txidShort is a truncated version with leading 0x chars and ellipsis", () => {
      const { txidShort } = buildValid().data;
      expect(txidShort).toMatch(/^0xdc67/);
      expect(txidShort).toContain("…");
    });
  });
});
