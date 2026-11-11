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
    /// Average degree, `2m / n` (`m / n` for the out- or in-degree of a
    /// directed graph).
    pub mean: f64,
    /// Median degree (mean of the two middle values when `n` is even).
    pub median: f64,
}

/// Computes [`DegreeStats`] in `O(n + max degree)` with a counting sort: of
/// the degree, or of the out-degree on a directed graph.
pub fn degree_stats<G: Graph>(graph: &G) -> DegreeStats {
    let degrees: Vec<usize> = graph.vertices().map(|v| graph.degree(v)).collect();
    stats_of(&degrees, graph.edge_count(), graph.is_directed())
}

/// [`DegreeStats`] of the in-degree (the arcs into each vertex), in
/// `O(n + m)`; the same as [`degree_stats`] on an undirected graph.
pub fn in_degree_stats<G: Graph>(graph: &G) -> DegreeStats {
    if !graph.is_directed() {
        return degree_stats(graph);
    }
    let mut degrees = vec![0usize; graph.vertex_count() + 1];
    for u in graph.vertices() {
        for v in graph.neighbors(u) {
            degrees[v as usize] += 1;
        }
    }
    stats_of(&degrees[1..], graph.edge_count(), true)
}

/// The statistics of `degrees` (one per vertex) for a graph with
/// `edge_count` edges, each counted at both ends unless `directed`.
fn stats_of(degrees: &[usize], edge_count: usize, directed: bool) -> DegreeStats {
    let n = degrees.len();
    let max = degrees.iter().copied().max().unwrap_or(0);
    let mut histogram = vec![0usize; max + 1];
    for &degree in degrees {
        histogram[degree] += 1;
    }
    let min = histogram.iter().position(|&count| count > 0).unwrap_or(0);
    let ends = if directed { 1.0 } else { 2.0 };
    let mean = if n == 0 {
        0.0
    } else {
        ends * edge_count as f64 / n as f64
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

/// Minimum, maximum and mean edge weight, and how many edges (arcs) are
/// negative.
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
    let directed = graph.is_directed();
    for u in graph.vertices() {
        // Each edge once, from its smaller endpoint (each arc from its tail).
        for (_, weight) in graph
            .weighted_neighbors(u)
            .filter(|&(v, _)| directed || v > u)
        {
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
