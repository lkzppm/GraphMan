//! Adjacency list: one heap-allocated `Vec<Vertex>` per vertex.

use super::{
    Build, BuildError, Graph, Representation, UNIT_WEIGHT, Vertex, Weight, Weighted, WeightedEdge,
    WeightedRow, allocation_failed,
};
use crate::io::EdgeList;
use core::mem::size_of;

/// The textbook adjacency list.
///
/// `adj[v]` holds the neighbours of `v` in ascending order. Row `0` is unused
/// so that vertices can index the table directly. A weighted graph keeps a
/// second table of the same shape, `weights[v][i]` being the weight of the
/// edge to `adj[v][i]`, so the neighbour rows read by BFS stay as compact as
/// in an unweighted graph.
#[derive(Debug, Clone)]
pub struct AdjacencyList {
    adj: Vec<Vec<Vertex>>,
    /// Empty when the graph is unweighted.
    weights: Vec<Vec<Weight>>,
    edge_count: usize,
    negative_edge: Option<WeightedEdge>,
}

impl AdjacencyList {
    /// The neighbour row of `v` as a slice.
    #[inline]
    pub fn row(&self, v: Vertex) -> &[Vertex] {
        &self.adj[v as usize]
    }

    /// The weights of the edges in [`row`](Self::row)`(v)`; empty when unweighted.
    #[inline]
    pub fn row_weights(&self, v: Vertex) -> &[Weight] {
        self.weights.get(v as usize).map_or(&[], Vec::as_slice)
    }
}

impl Build for AdjacencyList {
    const REPRESENTATION: Representation = Representation::AdjacencyList;

    fn required_bytes(vertex_count: usize, edge_count: usize, weighted: bool) -> usize {
        // Saturating: on 32-bit targets (the browser) a product that does not
        // fit is "more than any budget", never a small wrapped number.
        let entries = edge_count.saturating_mul(2);
        let rows = vertex_count
            .saturating_add(1)
            .saturating_mul(size_of::<Vec<Vertex>>());
        let targets = entries.saturating_mul(size_of::<Vertex>());
        match weighted {
            false => rows.saturating_add(targets),
            true => rows
                .saturating_mul(2)
                .saturating_add(targets)
                .saturating_add(entries.saturating_mul(size_of::<Weight>())),
        }
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let n = edges.vertex_count();
        let required = Self::required_bytes(n, edges.edge_count(), edges.is_weighted());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let degrees = edges.degrees();
        let mut adj: Vec<Vec<Vertex>> = Vec::new();
        adj.try_reserve_exact(n + 1).map_err(fail())?;
        for &degree in &degrees {
            let mut row = Vec::new();
            row.try_reserve_exact(degree as usize).map_err(fail())?;
            adj.push(row);
        }
        let mut weights: Vec<Vec<Weight>> = Vec::new();
        if edges.is_weighted() {
            weights.try_reserve_exact(n + 1).map_err(fail())?;
            for &degree in &degrees {
                let mut row = Vec::new();
                row.try_reserve_exact(degree as usize).map_err(fail())?;
                weights.push(row);
            }
        }
        // `edges` is sorted by (min, max), which makes every row ascending:
        // all smaller neighbours of `v` are pushed (in order) while the outer
        // endpoint is < v, and all larger ones while it is == v.
        for &[u, v] in edges.edges() {
            adj[u as usize].push(v);
            adj[v as usize].push(u);
        }
        if let Some(edge_weights) = edges.weights() {
            for (&[u, v], &weight) in edges.edges().iter().zip(edge_weights) {
                weights[u as usize].push(weight);
                weights[v as usize].push(weight);
            }
        }
        Ok(Self {
            adj,
            weights,
            edge_count: edges.edge_count(),
            negative_edge: edges.negative_edge(),
        })
    }
}

impl Graph for AdjacencyList {
    type Neighbors<'a>
        = core::iter::Copied<core::slice::Iter<'a, Vertex>>
    where
        Self: 'a;

    #[inline]
    fn vertex_count(&self) -> usize {
        self.adj.len() - 1
    }

    #[inline]
    fn edge_count(&self) -> usize {
        self.edge_count
    }

    #[inline]
    fn degree(&self, v: Vertex) -> usize {
        self.adj[v as usize].len()
    }

    #[inline]
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_> {
        self.adj[v as usize].iter().copied()
    }

    #[inline]
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        self.adj[u as usize].binary_search(&v).is_ok()
    }

    fn heap_bytes(&self) -> usize {
        self.adj.capacity() * size_of::<Vec<Vertex>>()
            + self
                .adj
                .iter()
                .map(|row| row.capacity() * size_of::<Vertex>())
                .sum::<usize>()
            + self.weights.capacity() * size_of::<Vec<Weight>>()
            + self
                .weights
                .iter()
                .map(|row| row.capacity() * size_of::<Weight>())
                .sum::<usize>()
    }

    fn representation(&self) -> Representation {
        Representation::AdjacencyList
    }
}

impl Weighted for AdjacencyList {
    type WeightedNeighbors<'a>
        = WeightedRow<'a>
    where
        Self: 'a;

    #[inline]
    fn weighted_neighbors(&self, v: Vertex) -> Self::WeightedNeighbors<'_> {
        WeightedRow::new(self.row(v), self.row_weights(v))
    }

    fn is_weighted(&self) -> bool {
        !self.weights.is_empty()
    }

    fn weight(&self, u: Vertex, v: Vertex) -> Option<Weight> {
        let index = self.row(u).binary_search(&v).ok()?;
        Some(
            self.row_weights(u)
                .get(index)
                .copied()
                .unwrap_or(UNIT_WEIGHT),
        )
    }

    fn negative_edge(&self) -> Option<WeightedEdge> {
        self.negative_edge
    }
}
