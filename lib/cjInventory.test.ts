import { describe, expect, it } from "vitest";
import {
  classifyCjInventory,
  createCjInventoryErrorSnapshot,
  getCjInventoryRowTotal,
  mergeCjInventoryStatuses,
  summarizeCjInventoryRows,
} from "./cjInventory";

describe("CJ inventory normalization", () => {
  it("uses totalInventoryNum when CJ provides it", () => {
    expect(getCjInventoryRowTotal({
      totalInventoryNum: 8,
      cjInventoryNum: 2,
      factoryInventoryNum: 3,
    })).toBe(8);
  });

  it("falls back to CJ and factory inventory counts", () => {
    expect(getCjInventoryRowTotal({
      cjInventoryNum: 2,
      factoryInventoryNum: 3,
    })).toBe(5);
  });

  it("reads CJ documented inventory field names", () => {
    expect(getCjInventoryRowTotal({
      totalInventory: 7,
      cjInventory: 2,
      factoryInventory: 3,
    })).toBe(7);

    expect(getCjInventoryRowTotal({
      cjInventory: 2,
      factoryInventory: 3,
    })).toBe(5);
  });

  it("uses client available quantity before storage fallback", () => {
    expect(getCjInventoryRowTotal({
      clientAvailableQuantity: 4,
      storageNum: 99,
    })).toBe(4);
  });

  it("falls back to stock rows before deprecated storageNum", () => {
    expect(getCjInventoryRowTotal({
      storageNum: 99,
      stock: [
        { inventory: 2, factoryInventory: 1 },
        { inventory: 3 },
      ],
    })).toBe(6);
  });

  it("classifies unknown, out, low, and healthy stock", () => {
    expect(classifyCjInventory(undefined)).toBe("unknown");
    expect(classifyCjInventory(0)).toBe("out_of_stock");
    expect(classifyCjInventory(3, 3)).toBe("low_stock");
    expect(classifyCjInventory(4, 3)).toBe("in_stock");
  });

  it("summarizes warehouse rows for one variant", () => {
    expect(summarizeCjInventoryRows(
      [
        { totalInventoryNum: 2, cjInventoryNum: 1 },
        { totalInventory: 4, cjInventory: 2, factoryInventory: 1 },
      ],
      { vid: "vid-1", sku: "sku-1", lastCheckedAt: "2026-06-25T00:00:00.000Z", lowStockThreshold: 3 },
    )).toMatchObject({
      vid: "vid-1",
      sku: "sku-1",
      totalInventoryNum: 6,
      cjInventoryNum: 3,
      factoryInventoryNum: 1,
      status: "in_stock",
    });
  });

  it("merges variant inventory statuses into product-level status", () => {
    const lastCheckedAt = "2026-06-25T00:00:00.000Z";
    expect(mergeCjInventoryStatuses([
      summarizeCjInventoryRows([{ totalInventoryNum: 0 }], { lastCheckedAt }),
      summarizeCjInventoryRows([{ totalInventoryNum: 6 }], { lastCheckedAt }),
    ])).toBe("partial");

    expect(mergeCjInventoryStatuses([
      summarizeCjInventoryRows([{ totalInventoryNum: 2 }], { lastCheckedAt }),
      summarizeCjInventoryRows([{ totalInventoryNum: 6 }], { lastCheckedAt }),
    ])).toBe("low_stock");

    expect(mergeCjInventoryStatuses([
      summarizeCjInventoryRows([], { lastCheckedAt }),
      summarizeCjInventoryRows([{ totalInventoryNum: 6 }], { lastCheckedAt }),
    ])).toBe("partial");

    expect(mergeCjInventoryStatuses([
      createCjInventoryErrorSnapshot({ lastCheckedAt, error: "CJ timeout" }),
      summarizeCjInventoryRows([{ totalInventoryNum: 6 }], { lastCheckedAt }),
    ])).toBe("partial");

    expect(mergeCjInventoryStatuses([
      createCjInventoryErrorSnapshot({ lastCheckedAt, error: "CJ timeout" }),
    ])).toBe("error");
  });
});
