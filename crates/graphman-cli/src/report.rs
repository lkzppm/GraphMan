//! Serialisable results of benchmarks and case studies.

use graphman::algo::{DegreeStats, DiameterMethod};
use graphman::{Representation, Vertex};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepresentationStudy {
    pub representation: Representation,
    pub memory: MemoryReport,
    pub bfs: Option<Timing>,
    pub dfs: Option<Timing>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub distances: Vec<DistanceAnswer>,
    pub components: ComponentsAnswer,
    pub diameters: Vec<DiameterAnswer>,
    pub machine: MachineInfo,
    pub generated_at_unix: u64,
}
