/** `1234567` → `1.23M`, `12345` → `12.3K`, `999` → `999`. */
export function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

/** Thousands separators, no abbreviation. */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** Milliseconds with a unit that keeps three significant digits. */
export function formatMs(ms: number): string {
  if (ms <= 0) return '0';
  if (ms * 1e6 < 1000) return `${(ms * 1e6).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(ms < 0.01 ? 1 : 0)} µs`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** Bytes in MB or GB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** `grafo_1` → `Graph 1`. */
export function prettyName(name: string): string {
  const match = /^grafo_(\d+)$/.exec(name);
  return match ? `Graph ${match[1]}` : name;
}
