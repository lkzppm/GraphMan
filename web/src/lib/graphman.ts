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
