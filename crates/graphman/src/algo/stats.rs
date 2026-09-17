//! Degree statistics.

use crate::graph::Graph;

/// Minimum, maximum, mean and median degree.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DegreeStats {
    /// Smallest degree.
    pub min: usize,
    /// Largest degree.
    pub max: usize,
    /// Average degree, `2m / n`.
    pub mean: f64,
    /// Median degree (mean of the two middle values when `n` is even).
    pub median: f64,
}

/// Computes [`DegreeStats`] in `O(n + max degree)` with a counting sort.
pub fn degree_stats<G: Graph>(graph: &G) -> DegreeStats {
    let n = graph.vertex_count();
    let max = graph.vertices().map(|v| graph.degree(v)).max().unwrap_or(0);
    let mut histogram = vec![0usize; max + 1];
    for v in graph.vertices() {
        histogram[graph.degree(v)] += 1;
    }
    let min = histogram.iter().position(|&count| count > 0).unwrap_or(0);
    let mean = if n == 0 {
        0.0
    } else {
        2.0 * graph.edge_count() as f64 / n as f64
    };

    // The k-th smallest degree (0-based) from the histogram.
    let kth = |k: usize| -> usize {
        let mut seen = 0;
        for (degree, &count) in histogram.iter().enumerate() {
            seen += count;
            if seen > k {
                return degree;
            }
        }
        max
    };
    let median = if n == 0 {
        0.0
    } else if n % 2 == 1 {
        kth(n / 2) as f64
    } else {
        (kth(n / 2 - 1) + kth(n / 2)) as f64 / 2.0
    };
    DegreeStats {
        min,
        max,
        mean,
        median,
    }
}
