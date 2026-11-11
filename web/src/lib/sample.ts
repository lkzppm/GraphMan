// The sample graph the site draws everywhere: a pentagon 1-2-4-5-3-1 with
// the chord 2-3 (the home page's three-representations figure, the library
// page's examples). The searches here mirror the library's semantics
// (ascending neighbours, DFS over neighbour iterators) so the drawings
// agree with the Rust examples, which `cargo test` checks.

export type Edge = [number, number];

/** Edges as [min, max], sorted: what the parser hands the builders. */
export const SAMPLE_EDGES: Edge[] = [
  [1, 2],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 5],
  [4, 5],
];

/** The sample in the course's text format. */
export const SAMPLE_TEXT = '5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n';

/** Where each vertex sits in a drawing (index 0 unused; a 200 × 176 box). */
export const SAMPLE_POSITIONS: [number, number][] = [
  [0, 0],
  [100, 26],
  [30, 78],
  [170, 78],
  [58, 152],
  [142, 152],
];

/** The sample plus a second component, {6, 7}, drawn to its right. */
export const TWO_COMPONENT_EDGES: Edge[] = [...SAMPLE_EDGES, [6, 7]];
export const TWO_COMPONENT_POSITIONS: [number, number][] = [
  ...SAMPLE_POSITIONS,
  [250, 60],
  [292, 128],
];

/** Neighbour rows, ascending, indexed by vertex (index 0 unused). */
export function neighbours(n: number, edges: Edge[]): number[][] {
  const rows: number[][] = Array.from({ length: n + 1 }, () => []);
  for (const [u, v] of edges) {
    rows[u].push(v);
    rows[v].push(u);
  }
  for (const row of rows) row.sort((a, b) => a - b);
  return rows;
}

export interface Tree {
  order: number[];
  parents: number[];
  levels: number[];
}

/** Level of a vertex the search never reached. */
export const UNREACHED = -1;

export function bfs(n: number, edges: Edge[], root: number): Tree {
  const rows = neighbours(n, edges);
  const parents = new Array<number>(n + 1).fill(0);
  const levels = new Array<number>(n + 1).fill(UNREACHED);
  const order = [root];
  levels[root] = 0;
  for (let head = 0; head < order.length; head++) {
    const v = order[head];
    for (const w of rows[v]) {
      if (levels[w] !== UNREACHED) continue;
      levels[w] = levels[v] + 1;
      parents[w] = v;
      order.push(w);
    }
  }
  return { order, parents, levels };
}

export function dfs(n: number, edges: Edge[], root: number): Tree {
  const rows = neighbours(n, edges);
  const parents = new Array<number>(n + 1).fill(0);
  const levels = new Array<number>(n + 1).fill(UNREACHED);
  const order = [root];
  levels[root] = 0;
  // A stack of (vertex, next neighbour index): the recursive tree, iteratively.
  const stack: [number, number][] = [[root, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const [v, i] = top;
    if (i >= rows[v].length) {
      stack.pop();
      continue;
    }
    top[1] = i + 1;
    const w = rows[v][i];
    if (levels[w] !== UNREACHED) continue;
    levels[w] = levels[v] + 1;
    parents[w] = v;
    order.push(w);
    stack.push([w, 0]);
  }
  return { order, parents, levels };
}

/** Component id per vertex, numbered from the largest, ties by smallest vertex. */
export function components(n: number, edges: Edge[]): number[] {
  const found: number[][] = [];
  const seen = new Array<boolean>(n + 1).fill(false);
  for (let v = 1; v <= n; v++) {
    if (seen[v]) continue;
    const members = bfs(n, edges, v).order.sort((a, b) => a - b);
    for (const m of members) seen[m] = true;
    found.push(members);
  }
  found.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const labels = new Array<number>(n + 1).fill(0);
  found.forEach((members, k) => members.forEach((v) => (labels[v] = k + 1)));
  return labels;
}

/** The vertices of a shortest path from `a` to `b`, or nothing when apart. */
export function shortestPath(n: number, edges: Edge[], a: number, b: number): number[] {
  const { parents, levels } = bfs(n, edges, a);
  if (levels[b] === UNREACHED) return [];
  const path = [b];
  for (let v = b; v !== a;) {
    v = parents[v];
    path.push(v);
  }
  return path.reverse();
}

/** The sample's weights, one per edge of SAMPLE_EDGES (the Rust examples'
    `1 2 0.5`, `1 3 2`...): light enough around 2 that Dijkstra's path from
    1 to 5 takes three edges where BFS takes two. */
export const SAMPLE_WEIGHTS = [0.5, 2, 1, 2.5, 1, 0.75];

/** The weighted sample in the course's text format. */
export const SAMPLE_WEIGHTED_TEXT = `5\n${SAMPLE_EDGES.map(([u, v], i) => `${u} ${v} ${SAMPLE_WEIGHTS[i]}`).join('\n')}\n`;

export interface ShortestPaths {
  /** Vertices in the order they were settled, by distance. */
  order: number[];
  parents: number[];
  /** Distance per vertex, Infinity when unreached. */
  distances: number[];
}

/** Dijkstra as the library runs it: strict relaxation, and the smaller
    vertex first among equal estimates, so the tree is the library's. */
export function dijkstra(n: number, edges: Edge[], weights: number[], root: number): ShortestPaths {
  const rows: [number, number][][] = Array.from({ length: n + 1 }, () => []);
  edges.forEach(([u, v], i) => {
    rows[u].push([v, weights[i]]);
    rows[v].push([u, weights[i]]);
  });
  for (const row of rows) row.sort((a, b) => a[0] - b[0]);
  const distances = new Array<number>(n + 1).fill(Infinity);
  const parents = new Array<number>(n + 1).fill(0);
  const settled = new Array<boolean>(n + 1).fill(false);
  const order: number[] = [];
  distances[root] = 0;
  for (;;) {
    let v = 0;
    for (let w = 1; w <= n; w++) {
      if (!settled[w] && distances[w] < Infinity && (v === 0 || distances[w] < distances[v])) v = w;
    }
    if (v === 0) break;
    settled[v] = true;
    order.push(v);
    for (const [w, weight] of rows[v]) {
      if (distances[v] + weight < distances[w]) {
        distances[w] = distances[v] + weight;
        parents[w] = v;
      }
    }
  }
  return { order, parents, distances };
}

/** The path to `v` in a tree of parents, from its root. */
export function pathTo(parents: number[], root: number, v: number): number[] {
  const path = [v];
  while (path[path.length - 1] !== root) path.push(parents[path[path.length - 1]]);
  return path.reverse();
}

// ---- Part 3: the directed sample --------------------------------------------
//
// The sample's six edges read as arcs ([tail, head], in the sample's order),
// two of them negative, around one cycle 2 → 4 → 5 → 3 → 2 of weight 1: the
// graph of the library page's Part 3 chapters (tests/wiki.rs runs the same).

export const DIRECTED_ARCS: Edge[] = [
  [1, 2],
  [1, 3],
  [3, 2],
  [2, 4],
  [5, 3],
  [4, 5],
];
export const DIRECTED_WEIGHTS = [4, 2, -1, 2, 2, -2];
/** The same arcs with 5 → 3 at -1: the cycle 2 → 4 → 5 → 3 → 2 weighs -2. */
export const NEGATIVE_CYCLE_WEIGHTS = [4, 2, -1, 2, -1, -2];
export const NEGATIVE_CYCLE: number[] = [2, 4, 5, 3, 2];

/** Bellman-Ford's answer: distances and parents (passes until nothing
    changes; the order does not change the answer, only the work). */
export function bellmanFord(
  n: number,
  arcs: Edge[],
  weights: number[],
  root: number,
): ShortestPaths {
  const distances = new Array<number>(n + 1).fill(Infinity);
  const parents = new Array<number>(n + 1).fill(0);
  distances[root] = 0;
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    arcs.forEach(([u, v], i) => {
      if (distances[u] + weights[i] < distances[v]) {
        distances[v] = distances[u] + weights[i];
        parents[v] = u;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const order = Array.from({ length: n }, (_, i) => i + 1)
    .filter((v) => distances[v] < Infinity)
    .sort((a, b) => distances[a] - distances[b] || a - b);
  return { order, parents, distances };
}

/** Floyd-Warshall's table, D[i][j] (1-based, row and column 0 unused). */
export function floydWarshall(n: number, arcs: Edge[], weights: number[]): number[][] {
  const d = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === j ? 0 : Infinity)),
  );
  arcs.forEach(([u, v], i) => {
    d[u][v] = Math.min(d[u][v], weights[i]);
  });
  for (let k = 1; k <= n; k++) {
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= n; j++) {
        if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
      }
    }
  }
  return d;
}

/** Strongly connected components, numbered 1.. in a topological order of
    the condensation (as the library's iterative Tarjan numbers them). */
export function strongComponents(n: number, arcs: Edge[]): number[] {
  const out: number[][] = Array.from({ length: n + 1 }, () => []);
  for (const [u, v] of arcs) out[u].push(v);
  const index = new Array<number>(n + 1).fill(0);
  const low = new Array<number>(n + 1).fill(0);
  const onStack = new Array<boolean>(n + 1).fill(false);
  const stack: number[] = [];
  const found: number[][] = [];
  let next = 1;
  const visit = (v: number) => {
    index[v] = low[v] = next++;
    stack.push(v);
    onStack[v] = true;
    for (const w of out[v]) {
      if (!index[w]) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      const members: number[] = [];
      let w = 0;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        members.push(w);
      } while (w !== v);
      found.push(members);
    }
  };
  for (let v = 1; v <= n; v++) if (!index[v]) visit(v);
  // Tarjan finishes sinks first: reversed, the ids run along the arcs.
  const label = new Array<number>(n + 1).fill(0);
  found.reverse().forEach((members, i) => members.forEach((v) => (label[v] = i + 1)));
  return label;
}
