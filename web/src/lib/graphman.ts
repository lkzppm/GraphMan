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

/** The weighted sample: the library page's graph with a weight per edge
    (`crates/graphman/tests/wiki.rs`, the `weights` example). All weights are
    positive, and the lightest path from 1 to 5 (1, 2, 3, 5) is not the
    shortest in edges (1, 3, 5), so Dijkstra and BFS disagree visibly. */
export const WEIGHTED_SAMPLE = '5\n1 2 0.5\n1 3 2\n2 3 1\n2 4 2.5\n3 5 1\n4 5 0.75\n';
