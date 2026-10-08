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

/** The sample graph (Figure 1 of the assignment), for the empty state. */
export const FIGURE_ONE = '5\n1 2\n2 5\n5 3\n4 5\n1 5\n';

/** The weighted sample: ten vertices, fifteen edges, all weights positive.
    The lightest path from 1 to 10 (1, 2, 5, 6, 7, 10, weight 4.75) is not
    the shortest in edges (1, 3, 10, weight 10), and even the direct edge
    1 to 3 (4) loses to a detour (3.75), so Dijkstra and BFS disagree
    visibly. */
export const WEIGHTED_SAMPLE =
  '10\n1 2 0.5\n1 3 4\n1 4 1.5\n2 5 1\n2 6 3\n3 7 0.5\n3 10 6\n4 6 2\n4 8 2.5\n' +
  '5 6 0.75\n5 9 1.25\n6 7 1\n7 10 1.5\n8 9 0.5\n9 10 2.5\n';
