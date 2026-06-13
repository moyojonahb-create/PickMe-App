export function decimalToMinor(value: number | string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

export function minorToDecimal(value: number | string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return 0;
  return numeric / 100;
}

export function formatMoneyMinor(value: number | string, currency = "USD"): string {
  const amount = minorToDecimal(value);
  const symbol = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;
  return `${symbol}${amount.toFixed(2)}`;
}
