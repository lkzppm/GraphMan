// Loader for the `.gmo` layout files written by `graphman export`
// (see spec/ARCHITECTURE.md for the byte layout).

export const UNREACHED = 0xffffffff;

export interface TreeLayout {
  vertexCount: number;
  root: number;
  maxLevel: number;
  reached: number;
  kind: 'bfs' | 'dfs';
  /** Polar angle per vertex (index = vertex - 1). */
  angle: Float32Array;
  /** Level per vertex; UNREACHED when the search never got there. */
  level: Uint32Array;
  /** Parent per vertex; 0 for the root and for unreached vertices. */
  parent: Uint32Array;
  /** Number of vertices at each level, for the wave profile and readouts. */
  levelSizes: Uint32Array;
}

const HEADER_BYTES = 4 + 5 * 4;

export async function loadTree(
  url: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
): Promise<TreeLayout> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`could not load ${url}: ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseTree(bytes.buffer);
}

export function parseTree(buffer: ArrayBuffer): TreeLayout {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'GMO1') throw new Error(`not a GraphMan layout file (magic ${magic})`);
  const vertexCount = view.getUint32(4, true);
  const root = view.getUint32(8, true);
  const maxLevel = view.getUint32(12, true);
  const reached = view.getUint32(16, true);
  const kind = view.getUint32(20, true) === 0 ? 'bfs' : 'dfs';
  const angle = new Float32Array(buffer, HEADER_BYTES, vertexCount);
  const level = new Uint32Array(buffer, HEADER_BYTES + 4 * vertexCount, vertexCount);
  const parent = new Uint32Array(buffer, HEADER_BYTES + 8 * vertexCount, vertexCount);
  const levelSizes = new Uint32Array(maxLevel + 1);
  for (let i = 0; i < vertexCount; i++) {
    const l = level[i]!;
    if (l !== UNREACHED) levelSizes[l]!++;
  }
  return { vertexCount, root, maxLevel, reached, kind, angle, level, parent, levelSizes };
}
