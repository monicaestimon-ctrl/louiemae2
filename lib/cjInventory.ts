export type CjInventoryStatus = "unknown" | "in_stock" | "low_stock" | "out_of_stock" | "partial" | "error";

export type CjInventorySourceRow = {
  vid?: string;
  sku?: string;
  totalInventoryNum?: number;
  storageNum?: number;
  cjInventoryNum?: number;
  factoryInventoryNum?: number;
  stock?: Array<{
    inventory?: number;
    factoryInventory?: number;
  }> | null;
};

export type CjInventorySnapshot = {
  vid?: string;
  sku?: string;
  totalInventoryNum?: number;
  cjInventoryNum?: number;
  factoryInventoryNum?: number;
  status: CjInventoryStatus;
  lowStockThreshold: number;
  lastCheckedAt: string;
  error?: string;
};

const DEFAULT_LOW_STOCK_THRESHOLD = 3;

const toFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sumNumbers = (values: Array<number | undefined>): number | undefined => {
  const finiteValues = values.filter((value): value is number => value !== undefined);
  return finiteValues.length > 0 ? finiteValues.reduce((total, value) => total + value, 0) : undefined;
};

export const classifyCjInventory = (
  totalInventoryNum: number | undefined,
  lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD,
): CjInventoryStatus => {
  if (totalInventoryNum === undefined) return "unknown";
  if (totalInventoryNum <= 0) return "out_of_stock";
  if (totalInventoryNum <= lowStockThreshold) return "low_stock";
  return "in_stock";
};

export const getCjInventoryRowTotal = (row: CjInventorySourceRow): number | undefined => {
  const totalInventoryNum = toFiniteNumber(row.totalInventoryNum);
  if (totalInventoryNum !== undefined) return totalInventoryNum;

  const cjInventoryNum = toFiniteNumber(row.cjInventoryNum);
  const factoryInventoryNum = toFiniteNumber(row.factoryInventoryNum);
  const combinedInventory = sumNumbers([cjInventoryNum, factoryInventoryNum]);
  if (combinedInventory !== undefined) return combinedInventory;

  const stockRows = Array.isArray(row.stock) ? row.stock : [];
  const stockInventory = sumNumbers(
    stockRows.flatMap((stock) => [
      toFiniteNumber(stock.inventory),
      toFiniteNumber(stock.factoryInventory),
    ]),
  );
  if (stockInventory !== undefined) return stockInventory;

  return toFiniteNumber(row.storageNum);
};

export const summarizeCjInventoryRows = (
  rows: CjInventorySourceRow[],
  options: {
    vid?: string;
    sku?: string;
    lastCheckedAt: string;
    lowStockThreshold?: number;
  },
): CjInventorySnapshot => {
  const lowStockThreshold = options.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const totalInventoryNum = sumNumbers(rows.map(getCjInventoryRowTotal));
  const cjInventoryNum = sumNumbers(rows.map((row) => toFiniteNumber(row.cjInventoryNum)));
  const factoryInventoryNum = sumNumbers(rows.map((row) => toFiniteNumber(row.factoryInventoryNum)));

  return {
    vid: options.vid,
    sku: options.sku,
    totalInventoryNum,
    cjInventoryNum,
    factoryInventoryNum,
    status: classifyCjInventory(totalInventoryNum, lowStockThreshold),
    lowStockThreshold,
    lastCheckedAt: options.lastCheckedAt,
  };
};

export const createCjInventoryErrorSnapshot = (
  options: {
    vid?: string;
    sku?: string;
    lastCheckedAt: string;
    lowStockThreshold?: number;
    error: string;
  },
): CjInventorySnapshot => ({
  vid: options.vid,
  sku: options.sku,
  status: "error",
  lowStockThreshold: options.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  lastCheckedAt: options.lastCheckedAt,
  error: options.error,
});

export const mergeCjInventoryStatuses = (snapshots: CjInventorySnapshot[]): CjInventoryStatus => {
  if (snapshots.length === 0) return "unknown";
  if (snapshots.every((snapshot) => snapshot.status === "error")) return "error";
  if (snapshots.some((snapshot) => snapshot.status === "error")) return "partial";
  if (snapshots.every((snapshot) => snapshot.status === "unknown")) return "unknown";
  if (snapshots.every((snapshot) => snapshot.status === "out_of_stock")) return "out_of_stock";
  if (snapshots.some((snapshot) => snapshot.status === "out_of_stock")) return "partial";
  if (snapshots.some((snapshot) => snapshot.status === "unknown")) return "partial";
  if (snapshots.some((snapshot) => snapshot.status === "low_stock")) return "low_stock";
  if (snapshots.some((snapshot) => snapshot.status === "in_stock")) return "in_stock";
  return "unknown";
};
