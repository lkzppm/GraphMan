// Types of the JSON the Rust side produces (crates/graphman-cli/src/report.rs
// and commands/export.rs), plus fetch helpers.

export interface DegreeStats {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface TreeMeta {
  file: string;
  max_level: number;
  reached: number;
  bytes: number;
}

export interface GraphMeta {
  name: string;
  vertices: number;
  edges: number;
  root: number;
  degree: DegreeStats;
  components: number;
  largest_component: number;
  bfs: TreeMeta;
  dfs: TreeMeta;
}

export interface Manifest {
  graphs: GraphMeta[];
}

export type Representation = 'adjacency_list' | 'adjacency_matrix' | 'csr';
export type DiameterMethod = 'exact' | 'i_fub' | 'bounds' | 'sweep';

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
  elapsed_ms: number;
}

export interface DiameterAnswer {
  method: DiameterMethod;
  value: number;
  is_exact: boolean;
  cancelled: boolean;
  bfs_count: number;
  endpoints: [number, number];
  elapsed_ms: number;
}

export interface MachineInfo {
  os: string;
  arch: string;
  cpu: string | null;
  total_memory_bytes: number | null;
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
  distances: DistanceAnswer[];
  components: ComponentsAnswer;
  diameters: DiameterAnswer[];
  machine: MachineInfo;
  generated_at_unix: number;
}

export const REPRESENTATION_LABEL: Record<Representation, string> = {
  adjacency_list: 'Adjacency list',
  adjacency_matrix: 'Adjacency matrix',
  csr: 'CSR',
};

export const METHOD_LABEL: Record<DiameterMethod, string> = {
  sweep: '4-sweep',
  i_fub: 'iFUB',
  bounds: 'Bounding',
  exact: 'Brute force',
};

/** "grafo_3" → "Graph 3". */
export function prettyName(name: string): string {
  const m = /^grafo_(\d+)$/.exec(name);
  return m ? `Graph ${m[1]}` : name;
}

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(`${base}/data/manifest.json`);
  if (!res.ok) return { graphs: [] };
  return (await res.json()) as Manifest;
}

export async function fetchStudies(): Promise<GraphStudy[]> {
  const res = await fetch(`${base}/data/results.json`);
  if (!res.ok) return [];
  return (await res.json()) as GraphStudy[];
}

export const dataUrl = (file: string): string => `${base}/data/${file}`;
