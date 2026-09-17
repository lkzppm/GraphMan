const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en-US');

/** 4 843 750 → "4.8M"; 10 000 → "10K". */
export const formatCompact = (n: number): string => compact.format(n);

/** 4843750 → "4,843,750". */
export const formatInt = (n: number): string => plain.format(Math.round(n));

/** Bytes with SI units, as the study reports them. */
export function formatBytes(bytes: number, digits = 1): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(digits)} ${units[unit]}`;
}

/** Milliseconds with a sensible unit. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
