// Types of studies/results.json (crates/graphman-cli/src/report.rs), synced
// into src/data by scripts/sync-data.mjs.
import results from '@/data/results.json';
import weightedResults from '@/data/weighted.json';
import directedResults from '@/data/directed.json';

export type Representation = 'adjacency_list' | 'adjacency_matrix' | 'csr';
export type DiameterMethod = 'exact' | 'i_fub' | 'bounds' | 'sweep';

export interface DegreeStats {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface Timing {
  runs: number;
  mean_ms: number;
  median_ms: number;
  min_ms: number;
  max_ms: number;
  stddev_ms: number;
  total_ms: number;
}

export interface MemoryReport {
  representation: Representation;
  feasible: boolean;
  required_bytes: number;
  accounted_bytes: number | null;
  baseline_resident_bytes: number | null;
  resident_bytes: number | null;
  footprint_bytes: number | null;
  peak_resident_bytes: number | null;
  build_ms: number | null;
  error: string | null;
}

export interface RepresentationStudy {
  representation: Representation;
  memory: MemoryReport;
  bfs: Timing | null;
  /** The iterative DFS. */
  dfs: Timing | null;
  /** The recursive DFS; absent in studies made before it was timed. */
  dfs_recursive?: Timing | null;
}

export interface ParentAnswer {
  algorithm: 'bfs' | 'dfs';
  root: number;
  vertex: number;
  parent: number | null;
  level: number | null;
}

export interface DistanceAnswer {
  from: number;
  to: number;
  distance: number | null;
}

export interface ComponentsAnswer {
  count: number;
  largest: number;
  smallest: number;
}

export interface DiameterAnswer {
  method: DiameterMethod;
  value: number;
  is_exact: boolean;
  cancelled?: boolean;
  bfs_count: number;
  elapsed_ms: number;
}

export interface Machine {
  os: string;
  arch: string;
  cpu: string;
  total_memory_bytes: number;
  threads: number;
}

export interface GraphStudy {
  name: string;
  file: string;
  vertices: number;
  edges: number;
  self_loops_dropped: number;
  duplicates_dropped: number;
  parse_ms: number;
  degree: DegreeStats;
  representations: RepresentationStudy[];
  parents: ParentAnswer[];
  /** Whether the recursive DFS built the iterative DFS's tree from every root. */
  dfs_recursive_identical?: boolean | null;
  distances: DistanceAnswer[];
  components: ComponentsAnswer;
  diameters: DiameterAnswer[];
  machine?: Machine;
}

export const studies: GraphStudy[] = (results as GraphStudy[])
  .slice()
  .sort((a, b) => a.vertices - b.vertices || a.edges - b.edges);

// Types of studies/weighted/results.json (the Part 2 study, `WeightedStudy`
// in crates/graphman-cli/src/report.rs), synced into src/data as weighted.json.

export type FrontierKind = 'vector' | 'heap' | 'lazy_heap' | 'quad_heap' | 'pairing' | 'radix';

export interface WeightStats {
  min: number;
  max: number;
  mean: number;
  negative: number;
}

export interface PathAnswer {
  from: number;
  to: number;
  /** `null` when `to` is in another component. */
  distance: number | null;
  /** From `from` to `to`, both included; empty when unreached. */
  path: number[];
  /** The distance from `from` to each vertex of `path`, in order. */
  distances?: number[];
  from_name?: string;
  to_name?: string;
  /** With a names file, the path's vertices by name. */
  names?: string[];
}

export interface PartialRun {
  root: number;
  settled: number;
  reachable: number;
  elapsed_ms: number;
  /** The cut run's time scaled to its root's whole component. */
  estimated_ms: number;
}

export interface FrontierStudy {
  frontier: FrontierKind;
  requested_runs: number;
  budget_s: number;
  /** The runs that finished; `null` when none did. */
  timing: Timing | null;
  budget_exhausted: boolean;
  partial: PartialRun | null;
}

/** One untimed Dijkstra of a frontier, counted entry by entry. */
export interface MemoryRun {
  root: number;
  settled: number;
  /** Estimates handed to the frontier: the root's, then one per relaxation
      that lowered one. The same for every frontier. */
  decreases: number;
  /** The most entries the frontier held at once, stale ones included. */
  peak_entries: number;
}

/** What one frontier costs in memory during a Dijkstra. */
export interface FrontierMemory {
  frontier: FrontierKind;
  /** Its arrays indexed by vertex, sized before any run. */
  base_bytes: number;
  /** Those arrays plus the entry storage the largest run needed, as allocated. */
  allocated_bytes: number;
  /** One stored entry; 0 when the entries are the arrays indexed by vertex. */
  entry_bytes: number;
  /** Empty for the vector, which is sized, not run. */
  runs: MemoryRun[];
}

export interface MemoryStudy {
  /** The graph Dijkstra runs on, for scale. */
  graph_bytes: number;
  /** The shortest-path tree, which every frontier fills alike. */
  tree_bytes: number;
  frontiers: FrontierMemory[];
}

export interface WeightedStudy {
  name: string;
  file: string;
  /** The vertex-name file, for the collaboration network. */
  names_file: string | null;
  vertices: number;
  edges: number;
  /** What normalising the file dropped. */
  self_loops_dropped: number;
  duplicates_dropped: number;
  parse_ms: number;
  weights: WeightStats | null;
  representation: Representation;
  /** The library's refusal when an edge is negative. */
  refusal: string | null;
  paths: PathAnswer[];
  frontiers: FrontierStudy[];
  /** Absent until the `frontier-memory` section has run. */
  memory?: MemoryStudy | null;
  machine?: Machine;
}

/** The most entries a frontier held in any of its measured runs, `null`
    when it was not run (the vector). */
export function peakEntries(memory: FrontierMemory): number | null {
  return memory.runs.length > 0 ? Math.max(...memory.runs.map((run) => run.peak_entries)) : null;
}

/** The weighted course graphs, smallest first, then the named network. */
export const weightedStudies: WeightedStudy[] = (weightedResults as WeightedStudy[])
  .slice()
  .sort(
    (a, b) =>
      Number(a.names_file !== null) - Number(b.names_file !== null) ||
      a.vertices - b.vertices ||
      a.edges - b.edges,
  );

// Types of studies/directed/results.json (the Part 3 study, `DirectedStudy`
// in crates/graphman-cli/src/report.rs), synced into src/data as directed.json.

/** The Bellman-Ford schedules, as the study labels them. */
export type ScheduleKind = 'rounds' | 'early-stop' | 'queue' | 'yen' | 'random-yen' | 'slf';
/** The Floyd-Warshall sweeps, as the study labels them. */
export type SweepKind = 'plain' | 'pruned' | 'parallel' | 'blocked';

/** Bellman-Ford's work in one run. */
export interface ScheduleCounts {
  /** Vertices whose arcs were relaxed. */
  scans: number;
  /** Relaxations that lowered an estimate. */
  lowered: number;
  /** Passes completed. */
  passes: number;
}

/** A negative cycle, returned as the certificate it is. */
export interface NegativeCycle {
  /** The vertices in arc order, smallest first. */
  cycle: number[];
  /** The sum of its arcs' weights (negative). */
  weight: number;
}

/** One cell of a Part 3 timing table. */
export interface AlgorithmTiming {
  /** `bellman-ford`, `floyd-warshall`, `bfs`, `dfs`, `dijkstra`; for all
      pairs `bellman-ford-all`, `dijkstra-all`, `johnson`. */
  algorithm: string;
  /** The schedule, sweep or frontier (`queue`, `blocked`, `heap`...). */
  variant: string;
  requested_runs: number;
  budget_s: number;
  /** The runs that finished; `null` when none did. */
  timing: Timing | null;
  budget_exhausted: boolean;
  /** When no run finished: a whole run at the pace of the one cut short. */
  estimated_ms: number | null;
  /** Why the cell was not measured (the table does not fit, a negative arc). */
  refusal: string | null;
  counts?: ScheduleCounts;
  /** Set when the run stopped at a negative cycle instead of answering. */
  note?: string;
}

/** Question 2: the distances between the pairs of a few vertices. */
export interface PairsAnswer {
  vertices: number[];
  /** `distances[a][b]` from `vertices[a]` to `vertices[b]`; `null` when unreachable. */
  distances: (number | null)[][];
  /** `floyd-warshall`, or `bellman-ford` (one run per row) when the table does not fit. */
  method: string;
  /** Bytes Floyd-Warshall's tables need for this graph. */
  table_bytes: number;
  refusal: string | null;
  negative_cycle: NegativeCycle | null;
}

export interface DirectedStudy {
  name: string;
  file: string;
  directed: boolean;
  vertices: number;
  /** Arcs when directed. */
  edges: number;
  self_loops_dropped: number;
  duplicates_dropped: number;
  negative_loops: number;
  parse_ms: number;
  weights: WeightStats | null;
  representation: Representation;
  /** Question 1: the target, and the path to it from each source. On these
      paths `distances` is each vertex's distance to the target. */
  target: number;
  paths: PathAnswer[];
  counts: ScheduleCounts | null;
  /** A negative cycle that reaches the target: question 1 has no answer then. */
  cycle_to_target: NegativeCycle | null;
  /** A negative cycle anywhere in the graph, if there is one. */
  cycle_anywhere: NegativeCycle | null;
  /** Question 2. */
  pairs: PairsAnswer | null;
  /** Question 3. */
  timings: AlgorithmTiming[];
  /** Question 4. */
  all_pairs: AlgorithmTiming[];
  machine?: Machine;
}

/** A cell's mean, or its estimate when no run finished; `null` when refused. */
export function cellTime(cell: AlgorithmTiming | undefined) {
  if (!cell) return null;
  if (cell.timing) return { ms: cell.timing.mean_ms, estimated: false, cell };
  if (cell.estimated_ms !== null && cell.estimated_ms !== undefined)
    return { ms: cell.estimated_ms, estimated: true, cell };
  return null;
}

/** Whether a cell's run stopped at a negative cycle instead of answering.
    Its note says so; a refused Floyd-Warshall's note names its stand-in
    instead, and that is no cycle. */
export function stoppedAtCycle(cell: AlgorithmTiming | undefined): boolean {
  return Boolean(cell?.note) && !cell?.refusal && /negative cycle/i.test(cell?.note ?? '');
}

/** One cell of a study's table, by algorithm and variant. */
export function findCell(
  cells: AlgorithmTiming[],
  algorithm: string,
  variant?: string,
): AlgorithmTiming | undefined {
  return cells.find(
    (c) => c.algorithm === algorithm && (variant === undefined || c.variant === variant),
  );
}

/** The Floyd-Warshall cell the all-pairs comparison reads: the pruned sweep,
    unless it is only an estimate and another sweep was measured. */
export function floydCell(cells: AlgorithmTiming[]): AlgorithmTiming | undefined {
  const pruned = findCell(cells, 'floyd-warshall', 'pruned');
  if (pruned?.timing) return pruned;
  return cells.find((c) => c.algorithm === 'floyd-warshall' && c.timing) ?? pruned;
}

/** The Part 3 graphs, smallest first. */
export const directedStudies: DirectedStudy[] = (directedResults as DirectedStudy[])
  .slice()
  .sort((a, b) => a.vertices - b.vertices || a.edges - b.edges || a.name.localeCompare(b.name));
