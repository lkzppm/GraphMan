/** Where a value lands on a log scale from `floor` to `top`, 0..1. Shared by
    the case studies and the presentation so a bar means the same on both. */
export function logScale(floor: number, top: number) {
  const lo = Math.log10(floor);
  const hi = Math.log10(top);
  return (value: number) => Math.min(1, Math.max(0, (Math.log10(value) - lo) / (hi - lo)));
}

/** How a sheet of frontier times is drawn: on a log scale; linear, as
    shares of the vector's time; or linear without the vector, as shares of
    the slowest of the others. */
export type TimeScale = 'log' | 'vector' | 'heaps';
export const TIME_SCALES: TimeScale[] = ['log', 'vector', 'heaps'];
