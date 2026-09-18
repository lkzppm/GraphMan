// Types of studies/results.json (crates/graphman-cli/src/report.rs), synced
// into src/data by scripts/sync-data.mjs.
import results from '@/data/results.json';

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
  dfs: Timing | null;
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
  distances: DistanceAnswer[];
  components: ComponentsAnswer;
  diameters: DiameterAnswer[];
}

export const REPRESENTATION_LABEL: Record<Representation, string> = {
  adjacency_list: 'Adjacency list',
  adjacency_matrix: 'Adjacency matrix',
  csr: 'CSR',
};

export const DIAMETER_LABEL: Record<DiameterMethod, string> = {
  exact: 'Brute force',
  i_fub: 'iFUB',
  bounds: 'Takes–Kosters',
  sweep: '4-sweep',
};

export const studies: GraphStudy[] = (results as GraphStudy[])
  .slice()
  .sort((a, b) => a.vertices - b.vertices || a.edges - b.edges);
