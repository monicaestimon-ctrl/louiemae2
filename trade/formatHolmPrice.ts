/** Display catalog-provided amounts without inferring a purchasing discount. */
export function formatHolmPrice(value: number, decimals = false): string {
  return Number.isFinite(value)
    ? '$' +
        value.toLocaleString('en-US', {
          minimumFractionDigits: decimals ? 2 : 0,
          maximumFractionDigits: decimals ? 2 : 0,
        })
    : 'Review unavailable items';
}
