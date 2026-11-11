//! Adjacency list: one heap-allocated `Vec<Vertex>` per vertex.

use super::{
    Build, BuildError, Graph, Orientation, Representation, UNIT_WEIGHT, Vertex, Weight, Weighted,
    WeightedEdge, WeightedRow, allocation_failed, csr::first_negative,
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
///
/// A directed graph keeps each arc once, in its tail's row.
#[derive(Debug, Clone)]
pub struct AdjacencyList {
    adj: Vec<Vec<Vertex>>,
    /// Empty when the graph is unweighted.
    weights: Vec<Vec<Weight>>,
    directed: bool,
    edge_count: usize,
    negative_edge: Option<WeightedEdge>,
    negative_loops: Vec<WeightedEdge>,
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

    fn required_bytes_oriented(
        vertex_count: usize,
        edge_count: usize,
        weighted: bool,
        orientation: Orientation,
    ) -> usize {
        // Saturating: on 32-bit targets (the browser) a product that does not
        // fit is "more than any budget", never a small wrapped number.
        let entries = match orientation {
            Orientation::Directed => edge_count,
            Orientation::Undirected => edge_count.saturating_mul(2),
        };
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
        let directed = edges.is_directed();
        let required = Self::required_bytes_oriented(
            n,
            edges.edge_count(),
            edges.is_weighted(),
            edges.orientation(),
        );
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
        // endpoint is < v, and all larger ones while it is == v. A directed
        // list is sorted by (tail, head): each row is pushed in order.
        for &[u, v] in edges.edges() {
            adj[u as usize].push(v);
            if !directed {
                adj[v as usize].push(u);
            }
        }
        if let Some(edge_weights) = edges.weights() {
            for (&[u, v], &weight) in edges.edges().iter().zip(edge_weights) {
                weights[u as usize].push(weight);
                if !directed {
                    weights[v as usize].push(weight);
                }
            }
        }
        Ok(Self {
            adj,
            weights,
            directed,
            edge_count: edges.edge_count(),
            negative_edge: edges.negative_edge(),
            negative_loops: edges.negative_loops().to_vec(),
        })
    }

    /// Rows sized by in-degree, then filled scanning the tails in ascending
    /// order, so every row of the transpose comes out ascending.
    fn transpose_unchecked(&self) -> Result<Self, BuildError> {
        if !self.directed {
            return Ok(self.clone());
        }
        let n = self.vertex_count();
        let weighted = self.is_weighted();
        let required =
            Self::required_bytes_oriented(n, self.edge_count, weighted, self.orientation());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let mut in_degrees = vec![0usize; n + 1];
        for row in &self.adj {
            for &v in row {
                in_degrees[v as usize] += 1;
            }
        }
        let mut adj: Vec<Vec<Vertex>> = Vec::new();
        adj.try_reserve_exact(n + 1).map_err(fail())?;
        let mut weights: Vec<Vec<Weight>> = Vec::new();
        if weighted {
            weights.try_reserve_exact(n + 1).map_err(fail())?;
        }
        for &degree in &in_degrees {
            let mut row = Vec::new();
            row.try_reserve_exact(degree).map_err(fail())?;
            adj.push(row);
            if weighted {
                let mut row = Vec::new();
                row.try_reserve_exact(degree).map_err(fail())?;
                weights.push(row);
            }
        }
        for u in 1..=n as Vertex {
            for (i, &v) in self.row(u).iter().enumerate() {
                adj[v as usize].push(u);
                if weighted {
                    weights[v as usize].push(self.weights[u as usize][i]);
                }
            }
        }
        let mut transpose = Self {
            adj,
            weights,
            directed: true,
            edge_count: self.edge_count,
            negative_edge: None,
            negative_loops: self.negative_loops.clone(),
        };
        if self.negative_edge.is_some() {
            transpose.negative_edge = first_negative(&transpose);
        }
        Ok(transpose)
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

    #[inline]
    fn is_directed(&self) -> bool {
        self.directed
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

    fn negative_loops(&self) -> &[WeightedEdge] {
        &self.negative_loops
    }
}
