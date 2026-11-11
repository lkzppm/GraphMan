//! Serialisable results of benchmarks and case studies.

use graphman::algo::{
    DegreeStats, DiameterMethod, FrontierKind, NegativeCycle, ScheduleCounts, WeightStats,
};
use graphman::{Representation, Vertex, Weight, WeightedEdge};
use serde::{Deserialize, Serialize};

/// Summary statistics of repeated timings, in milliseconds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timing {
    pub runs: usize,
    pub mean_ms: f64,
    pub median_ms: f64,
    pub min_ms: f64,
    pub max_ms: f64,
    pub stddev_ms: f64,
    pub total_ms: f64,
}

impl Timing {
    pub fn from_samples(mut samples_ms: Vec<f64>) -> Self {
        let runs = samples_ms.len();
        samples_ms.sort_by(f64::total_cmp);
        let total_ms: f64 = samples_ms.iter().sum();
        let mean_ms = if runs == 0 {
            0.0
        } else {
            total_ms / runs as f64
        };
        let median_ms = match runs {
            0 => 0.0,
            r if r % 2 == 1 => samples_ms[r / 2],
            r => (samples_ms[r / 2 - 1] + samples_ms[r / 2]) / 2.0,
        };
        let variance = if runs < 2 {
            0.0
        } else {
            samples_ms
                .iter()
                .map(|s| (s - mean_ms).powi(2))
                .sum::<f64>()
                / (runs - 1) as f64
        };
        Self {
            runs,
            mean_ms,
            median_ms,
            min_ms: samples_ms.first().copied().unwrap_or(0.0),
            max_ms: samples_ms.last().copied().unwrap_or(0.0),
            stddev_ms: variance.sqrt(),
            total_ms,
        }
    }
}

/// What `graphman memory` measures for one representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryReport {
    pub representation: Representation,
    /// Whether the representation could be built on this machine.
    pub feasible: bool,
    /// Bytes the representation needs, computed before building.
    pub required_bytes: usize,
    /// Bytes actually owned by the structure after building.
    pub accounted_bytes: Option<usize>,
    /// Process RSS before parsing anything.
    pub baseline_resident_bytes: Option<usize>,
    /// Process RSS after building the graph and dropping the edge list.
    pub resident_bytes: Option<usize>,
    /// Process physical footprint at the same moment (macOS: what Activity Monitor shows).
    pub footprint_bytes: Option<usize>,
    /// Peak process RSS (includes the transient edge list and file mapping).
    pub peak_resident_bytes: Option<usize>,
    pub build_ms: Option<f64>,
    pub error: Option<String>,
}

impl MemoryReport {
    /// A representation whose memory was not measured in this run: only
    /// its computed size is known.
    pub fn unmeasured(representation: Representation, required_bytes: usize) -> Self {
        Self {
            representation,
            feasible: true,
            required_bytes,
            accounted_bytes: None,
            baseline_resident_bytes: None,
            resident_bytes: None,
            footprint_bytes: None,
            peak_resident_bytes: None,
            build_ms: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepresentationStudy {
    pub representation: Representation,
    pub memory: MemoryReport,
    pub bfs: Option<Timing>,
    /// The iterative DFS.
    pub dfs: Option<Timing>,
    /// The recursive DFS (absent in studies made before it was timed).
    #[serde(default)]
    pub dfs_recursive: Option<Timing>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentAnswer {
    pub algorithm: String,
    pub root: Vertex,
    pub vertex: Vertex,
    pub parent: Option<Vertex>,
    pub level: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistanceAnswer {
    pub from: Vertex,
    pub to: Vertex,
    pub distance: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComponentsAnswer {
    pub count: usize,
    pub largest: usize,
    pub smallest: usize,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiameterAnswer {
    pub method: DiameterMethod,
    pub value: u32,
    pub is_exact: bool,
    pub cancelled: bool,
    pub bfs_count: usize,
    pub endpoints: (Vertex, Vertex),
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineInfo {
    pub os: String,
    pub arch: String,
    pub cpu: Option<String>,
    pub total_memory_bytes: Option<usize>,
    pub threads: usize,
}

impl MachineInfo {
    pub fn detect() -> Self {
        let cpu = std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
        Self {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            cpu,
            total_memory_bytes: graphman::metrics::memory::total_bytes(),
            threads: rayon::current_num_threads(),
        }
    }
}

/// Everything the case study measures for one graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStudy {
    pub name: String,
    pub file: String,
    pub vertices: usize,
    pub edges: usize,
    pub self_loops_dropped: usize,
    pub duplicates_dropped: usize,
    pub parse_ms: f64,
    pub degree: DegreeStats,
    pub representations: Vec<RepresentationStudy>,
    pub parents: Vec<ParentAnswer>,
    /// Whether the recursive DFS built exactly the iterative DFS's tree from
    /// every root of `parents` (absent in studies made before it was checked).
    #[serde(default)]
    pub dfs_recursive_identical: Option<bool>,
    pub distances: Vec<DistanceAnswer>,
    pub components: ComponentsAnswer,
    pub diameters: Vec<DiameterAnswer>,
    pub machine: MachineInfo,
    pub generated_at_unix: u64,
}

/// One answer of the Part 2 path question: the distance from the source to
/// a target and the shortest path between them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathAnswer {
    pub from: Vertex,
    pub to: Vertex,
    /// `None` when `to` is in another component.
    pub distance: Option<Weight>,
    /// The vertices from `from` to `to`, both included; empty when unreached.
    pub path: Vec<Vertex>,
    /// The distance from `from` to each vertex of `path`, in order (so the
    /// last one is `distance`); the web draws the path to scale with it.
    #[serde(default)]
    pub distances: Vec<Weight>,
    /// With a names file: the names of `from` and `to`, and of the path's vertices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub names: Option<Vec<String>>,
}

/// The only run of a frontier that the budget cut short, kept when no run
/// finished, so the cost of one run can still be estimated.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialRun {
    pub root: Vertex,
    /// Vertices settled before the budget ran out.
    pub settled: usize,
    /// Vertices the run would have settled (the root's component).
    pub reachable: usize,
    pub elapsed_ms: f64,
    /// `elapsed_ms` scaled to the whole component. Every settle of the
    /// vector frontier scans all `n` estimates, so its cost per settle is
    /// flat and the scaling is close to exact.
    pub estimated_ms: f64,
}

/// The mean time of one single-source Dijkstra with one frontier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontierStudy {
    pub frontier: FrontierKind,
    /// The runs asked for (`--runs`), each from a distinct random source.
    pub requested_runs: usize,
    /// Wall-clock budget for all the runs, in seconds.
    pub budget_s: f64,
    /// The runs that finished; `None` when none did.
    pub timing: Option<Timing>,
    /// Whether the budget ran out before every requested run finished.
    pub budget_exhausted: bool,
    pub partial: Option<PartialRun>,
}

/// One untimed Dijkstra of a frontier, counted by `Measured`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRun {
    pub root: Vertex,
    /// Vertices settled, one pop each.
    pub settled: usize,
    /// Estimates handed to the frontier: the root's, then one per
    /// relaxation that lowered an estimate. The same for every frontier.
    pub decreases: usize,
    /// The most entries the frontier held at once, stale ones included.
    pub peak_entries: usize,
}

/// What one frontier costs in memory during a Dijkstra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontierMemory {
    pub frontier: FrontierKind,
    /// Bytes of the frontier sized for the graph, before any run: its
    /// arrays indexed by vertex.
    pub base_bytes: usize,
    /// Bytes it owns after the runs: those arrays plus the entry storage
    /// the largest run needed (as allocated, so with the growth slack).
    pub allocated_bytes: usize,
    /// The bytes of one stored entry (`0` when the entries are the arrays
    /// indexed by vertex: the vector and the pairing heap).
    pub entry_bytes: usize,
    /// The measured runs. None for the vector: its one array of estimates
    /// is sized up front and never grows, and its runs are `O(n²)`.
    pub runs: Vec<MemoryRun>,
}

/// Part 2's memory question: what each frontier holds during a Dijkstra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStudy {
    /// Bytes of the graph Dijkstra runs on, for scale.
    pub graph_bytes: usize,
    /// Bytes of the shortest-path tree, which every frontier fills alike.
    pub tree_bytes: usize,
    pub frontiers: Vec<FrontierMemory>,
}

/// Everything the Part 2 case study measures for one weighted graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightedStudy {
    pub name: String,
    pub file: String,
    /// The vertex-name file, for the collaboration network.
    pub names_file: Option<String>,
    pub vertices: usize,
    pub edges: usize,
    pub self_loops_dropped: usize,
    pub duplicates_dropped: usize,
    pub parse_ms: f64,
    /// `None` for a file without weights (every edge then weighs 1).
    pub weights: Option<WeightStats>,
    /// The representation Dijkstra ran on.
    pub representation: Representation,
    /// The library's refusal when an edge is negative; nothing else is measured then.
    pub refusal: Option<String>,
    pub negative_edge: Option<WeightedEdge>,
    pub paths: Vec<PathAnswer>,
    pub frontiers: Vec<FrontierStudy>,
    /// `None` until the `frontier-memory` section has run.
    #[serde(default)]
    pub memory: Option<MemoryStudy>,
    pub machine: MachineInfo,
    pub generated_at_unix: u64,
}

/// One cell of a Part 3 timing table: the mean of the runs that finished
/// within the budget, or why there is none (a refusal, or an estimate from
/// the run the budget cut short).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlgorithmTiming {
    /// `bellman-ford`, `floyd-warshall`, `bfs`, `dfs`, `dijkstra`, or for
    /// all pairs `bellman-ford-all`, `dijkstra-all`.
    pub algorithm: String,
    /// The schedule, sweep or frontier (`queue`, `blocked`, `heap`...).
    pub variant: String,
    pub requested_runs: usize,
    pub budget_s: f64,
    /// The runs that finished; `None` when none did.
    pub timing: Option<Timing>,
    pub budget_exhausted: bool,
    /// When no run finished: the time a whole run would take at the pace of
    /// the one cut short (rounds done, or targets done, scaled to all).
    pub estimated_ms: Option<f64>,
    /// Why the cell was not measured (the table does not fit, Dijkstra
    /// refuses a negative arc).
    pub refusal: Option<String>,
    /// Bellman-Ford's work in its last finished run (for all pairs, the mean
    /// of one target's run).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counts: Option<ScheduleCounts>,
    /// Set when the run stopped at a negative cycle instead of answering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl AlgorithmTiming {
    /// The mean of the finished runs, or the estimate when none finished.
    pub fn mean_or_estimate_ms(&self) -> Option<f64> {
        self.timing
            .as_ref()
            .map(|t| t.mean_ms)
            .or(self.estimated_ms)
    }
}

/// Part 3, question 2: the distances between the pairs of a few vertices.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairsAnswer {
    pub vertices: Vec<Vertex>,
    /// `distances[a][b]` from `vertices[a]` to `vertices[b]`; `None` when unreachable.
    pub distances: Vec<Vec<Option<Weight>>>,
    /// The algorithm that produced the table: `floyd-warshall`, or
    /// `bellman-ford` (one run per row) when the all-pairs table does not fit.
    pub method: String,
    /// Bytes Floyd-Warshall's tables need for this graph.
    pub table_bytes: usize,
    /// Why Floyd-Warshall did not run, when it did not.
    pub refusal: Option<String>,
    /// The negative cycle that leaves the distances undefined, if any.
    pub negative_cycle: Option<NegativeCycle>,
}

/// Everything the Part 3 case study measures for one graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectedStudy {
    pub name: String,
    pub file: String,
    pub directed: bool,
    pub vertices: usize,
    /// Arcs when directed, edges otherwise.
    pub edges: usize,
    pub self_loops_dropped: usize,
    pub duplicates_dropped: usize,
    pub negative_loops: usize,
    pub parse_ms: f64,
    pub weights: Option<WeightStats>,
    pub representation: Representation,
    /// Question 1: the target and the paths to it.
    pub target: Vertex,
    pub paths: Vec<PathAnswer>,
    /// Bellman-Ford's work for question 1 (queue schedule).
    pub counts: Option<ScheduleCounts>,
    /// A negative cycle from which the target is reached (question 1 has no answer then).
    pub cycle_to_target: Option<NegativeCycle>,
    /// Whether the whole graph has a negative cycle, and one if so.
    pub cycle_anywhere: Option<NegativeCycle>,
    /// Question 2.
    pub pairs: Option<PairsAnswer>,
    /// Question 3: mean times per algorithm and variant.
    pub timings: Vec<AlgorithmTiming>,
    /// Question 4: all pairs by `n` Bellman-Fords, Floyd-Warshall and `n` Dijkstras.
    pub all_pairs: Vec<AlgorithmTiming>,
    pub machine: MachineInfo,
    pub generated_at_unix: u64,
}
