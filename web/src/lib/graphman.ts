// Loads the wasm-bindgen glue generated into src/wasm by scripts/build-wasm.mjs
// exactly once. The binary is served from /wasm under a content-hashed name.
import type * as Graphman from '@/wasm/graphman';
import { WASM_URL } from '@/wasm/manifest';

export type {
  DegreeSummary,
  DiameterResult,
  Graph,
  MemoryReport,
  Parsed,
  SearchResult,
  ShortestPathResult,
} from '@/wasm/graphman';
export type GraphmanModule = typeof Graphman;

let ready: Promise<GraphmanModule> | null = null;

export function loadGraphman(): Promise<GraphmanModule> {
  if (!ready) {
    ready = (async () => {
      const mod = await import('@/wasm/graphman');
      await mod.default({ module_or_path: WASM_URL });
      return mod;
    })();
  }
  return ready;
}

/** Level/rank sentinel of an unreached vertex (`graphman::algo::UNREACHED`). */
export const UNREACHED = 0xffffffff;

/** The observatory's example: ten vertices, fifteen edges, as `[u, v, w]`.
    All weights are positive. The lightest path from 1 to 10 (1, 2, 5, 6,
    7, 10, weight 4.75) is not the shortest in edges (1, 3, 10, weight 10),
    and even the direct edge 1 to 3 (4) loses to a detour (3.75), so BFS on
    the unweighted copy and Dijkstra on the weighted one disagree visibly. */
const EXAMPLE_EDGES: readonly (readonly [number, number, number])[] = [
  [1, 2, 0.5],
  [1, 3, 4],
  [1, 4, 1.5],
  [2, 5, 1],
  [2, 6, 3],
  [3, 7, 0.5],
  [3, 10, 6],
  [4, 6, 2],
  [4, 8, 2.5],
  [5, 6, 0.75],
  [5, 9, 1.25],
  [6, 7, 1],
  [7, 10, 1.5],
  [8, 9, 0.5],
  [9, 10, 2.5],
];

const exampleFile = (weighted: boolean) =>
  ['10', ...EXAMPLE_EDGES.map(([u, v, w]) => (weighted ? `${u} ${v} ${w}` : `${u} ${v}`))].join(
    '\n',
  ) + '\n';

/** The example without its weights, in the course's Part 1 format. */
export const UNWEIGHTED_SAMPLE = exampleFile(false);

/** The example with a weight per edge (the optional third column). */
export const WEIGHTED_SAMPLE = exampleFile(true);
