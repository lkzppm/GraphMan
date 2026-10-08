//! Degree and weight statistics.

use crate::graph::{Graph, Weight, Weighted};

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

/// Minimum, maximum and mean edge weight, and how many edges are negative.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WeightStats {
    /// Smallest weight.
    pub min: Weight,
    /// Largest weight.
    pub max: Weight,
    /// Average weight over the `m` edges.
    pub mean: Weight,
    /// Number of edges with a negative weight.
    pub negative: usize,
}

/// Computes [`WeightStats`] in `O(n + m)`; `None` for a graph without a
/// weight column or without edges.
pub fn weight_stats<G: Weighted>(graph: &G) -> Option<WeightStats> {
    if !graph.is_weighted() || graph.edge_count() == 0 {
        return None;
    }
    let (mut min, mut max, mut sum, mut negative) =
        (Weight::INFINITY, Weight::NEG_INFINITY, 0.0, 0);
    for u in graph.vertices() {
        // Each edge once, from its smaller endpoint.
        for (_, weight) in graph.weighted_neighbors(u).filter(|&(v, _)| v > u) {
            min = min.min(weight);
            max = max.max(weight);
            sum += weight;
            negative += usize::from(weight < 0.0);
        }
    }
    Some(WeightStats {
        min,
        max,
        mean: sum / graph.edge_count() as Weight,
        negative,
    })
}
