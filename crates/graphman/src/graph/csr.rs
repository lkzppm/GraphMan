//! Compressed sparse row: the cache-friendly adjacency list.

use super::{
    Build, BuildError, Graph, Orientation, Representation, UNIT_WEIGHT, Vertex, Weight, Weighted,
    WeightedEdge, WeightedRow, allocation_failed,
};
use crate::io::EdgeList;
use core::mem::size_of;

/// Compressed sparse row storage.
///
/// The neighbours of every vertex live back to back in one `targets` array;
/// `offsets[v]..offsets[v + 1]` is the slice belonging to `v`. Compared with
/// [`AdjacencyList`](super::AdjacencyList) this removes one pointer chase and
/// one heap block per vertex, which is what makes traversals of graphs with
/// millions of vertices bandwidth-bound rather than latency-bound.
///
/// A weighted graph adds one more array, `weights`, parallel to `targets`:
/// `weights[i]` is the weight of the edge to `targets[i]`. Traversals that
/// ignore weights never touch it.
///
/// A directed graph stores each arc once, in its tail's row: `m` targets
/// instead of `2m`.
#[derive(Debug, Clone)]
pub struct Csr {
    offsets: Vec<u32>,
    targets: Vec<Vertex>,
    /// Empty when the graph is unweighted.
    weights: Vec<Weight>,
    weighted: bool,
    directed: bool,
    edge_count: usize,
    negative_edge: Option<WeightedEdge>,
    negative_loops: Vec<WeightedEdge>,
}

impl Csr {
    /// The row offsets: `offsets[v]..offsets[v + 1]` indexes the neighbours
    /// of `v` in [`targets`](Self::targets). Length `n + 2` (index 0 unused).
    pub fn offsets(&self) -> &[u32] {
        &self.offsets
    }

    /// Every neighbour row back to back, `2m` entries (`m` when directed).
    pub fn targets(&self) -> &[Vertex] {
        &self.targets
    }

    /// Every weight, parallel to [`targets`](Self::targets); empty when the
    /// graph is unweighted.
    pub fn weights(&self) -> &[Weight] {
        &self.weights
    }

    /// The neighbour row of `v` as a slice.
    #[inline]
    pub fn row(&self, v: Vertex) -> &[Vertex] {
        &self.targets[self.span(v)]
    }

    /// The weights of the edges in [`row`](Self::row)`(v)`; empty when unweighted.
    #[inline]
    pub fn row_weights(&self, v: Vertex) -> &[Weight] {
        match self.weights.is_empty() {
            true => &[],
            false => &self.weights[self.span(v)],
        }
    }

    #[inline]
    fn span(&self, v: Vertex) -> core::ops::Range<usize> {
        let v = v as usize;
        self.offsets[v] as usize..self.offsets[v + 1] as usize
    }
}

impl Build for Csr {
    const REPRESENTATION: Representation = Representation::Csr;

    fn required_bytes_oriented(
        vertex_count: usize,
        edge_count: usize,
        weighted: bool,
        orientation: Orientation,
    ) -> usize {
        // Saturating, so a size that does not fit 32 bits exceeds every budget.
        let weights = if weighted { size_of::<Weight>() } else { 0 };
        let offsets = vertex_count
            .saturating_add(2)
            .saturating_mul(size_of::<u32>());
        let entries = entries(edge_count, orientation.is_directed());
        offsets.saturating_add(entries.saturating_mul(size_of::<Vertex>() + weights))
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let n = edges.vertex_count();
        let m = edges.edge_count();
        let directed = edges.is_directed();
        let entries = entries(m, directed);
        assert!(
            entries < u32::MAX as usize,
            "CSR offsets are 32-bit: at most 2^32 - 1 row entries"
        );
        let required =
            Self::required_bytes_oriented(n, m, edges.is_weighted(), edges.orientation());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let degrees = edges.degrees();
        let mut offsets: Vec<u32> = Vec::new();
        offsets.try_reserve_exact(n + 2).map_err(fail())?;
        offsets.push(0);
        for &degree in &degrees {
            let last = *offsets.last().expect("offsets is never empty");
            offsets.push(last + degree);
        }

        let mut targets: Vec<Vertex> = Vec::new();
        targets.try_reserve_exact(entries).map_err(fail())?;
        targets.resize(entries, 0);

        // Same ordering argument as the adjacency list: a sorted edge list
        // fills every row in ascending order (and a directed list sorted by
        // tail is exactly the out-rows).
        let mut cursor: Vec<u32> = offsets[..=n].to_vec();
        let mut weights: Vec<Weight> = Vec::new();
        match edges.weights() {
            None => {
                for &[u, v] in edges.edges() {
                    targets[cursor[u as usize] as usize] = v;
                    cursor[u as usize] += 1;
                    if !directed {
                        targets[cursor[v as usize] as usize] = u;
                        cursor[v as usize] += 1;
                    }
                }
            }
            Some(edge_weights) => {
                weights.try_reserve_exact(entries).map_err(fail())?;
                weights.resize(entries, 0.0);
                for (&[u, v], &weight) in edges.edges().iter().zip(edge_weights) {
                    let slot = cursor[u as usize] as usize;
                    (targets[slot], weights[slot]) = (v, weight);
                    cursor[u as usize] += 1;
                    if !directed {
                        let slot = cursor[v as usize] as usize;
                        (targets[slot], weights[slot]) = (u, weight);
                        cursor[v as usize] += 1;
                    }
                }
            }
        }
        Ok(Self {
            offsets,
            targets,
            weights,
            weighted: edges.is_weighted(),
            directed,
            edge_count: m,
            negative_edge: edges.negative_edge(),
            negative_loops: edges.negative_loops().to_vec(),
        })
    }

    /// A counting sort of the targets by head, `O(n + m)` in one pass:
    /// scanning the tails in ascending order fills every row of the
    /// transpose in ascending order.
    fn transpose_unchecked(&self) -> Result<Self, BuildError> {
        if !self.directed {
            return Ok(self.clone());
        }
        let n = self.vertex_count();
        let required =
            Self::required_bytes_oriented(n, self.edge_count, self.weighted, self.orientation());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let mut offsets: Vec<u32> = Vec::new();
        offsets.try_reserve_exact(n + 2).map_err(fail())?;
        offsets.resize(n + 2, 0);
        for &v in &self.targets {
            offsets[v as usize + 1] += 1;
        }
        for v in 1..offsets.len() {
            offsets[v] += offsets[v - 1];
        }
        let entries = self.targets.len();
        let mut targets: Vec<Vertex> = Vec::new();
        targets.try_reserve_exact(entries).map_err(fail())?;
        targets.resize(entries, 0);
        let mut weights: Vec<Weight> = Vec::new();
        if self.weighted {
            weights.try_reserve_exact(entries).map_err(fail())?;
            weights.resize(entries, 0.0);
        }
        let mut cursor: Vec<u32> = offsets[..=n].to_vec();
        for u in 1..=n as Vertex {
            for i in self.span(u) {
                let v = self.targets[i] as usize;
                let slot = cursor[v] as usize;
                targets[slot] = u;
                if self.weighted {
                    weights[slot] = self.weights[i];
                }
                cursor[v] += 1;
            }
        }
        let mut transpose = Self {
            offsets,
            targets,
            weights,
            weighted: self.weighted,
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

/// Row entries of a graph with `edge_count` edges: each edge sits in both
/// rows, each arc in its tail's only.
fn entries(edge_count: usize, directed: bool) -> usize {
    match directed {
        true => edge_count,
        false => edge_count.saturating_mul(2),
    }
}

/// The first arc with a negative weight, by tail then head.
pub(super) fn first_negative<G: Weighted>(graph: &G) -> Option<WeightedEdge> {
    graph.vertices().find_map(|u| {
        graph
            .weighted_neighbors(u)
            .find(|&(_, weight)| weight < 0.0)
            .map(|(v, weight)| WeightedEdge { u, v, weight })
    })
}

impl Graph for Csr {
    type Neighbors<'a>
        = core::iter::Copied<core::slice::Iter<'a, Vertex>>
    where
        Self: 'a;

    #[inline]
    fn vertex_count(&self) -> usize {
        self.offsets.len() - 2
    }

    #[inline]
    fn edge_count(&self) -> usize {
        self.edge_count
    }

    #[inline]
    fn degree(&self, v: Vertex) -> usize {
        let v = v as usize;
        (self.offsets[v + 1] - self.offsets[v]) as usize
    }

    #[inline]
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_> {
        self.row(v).iter().copied()
    }

    #[inline]
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        self.row(u).binary_search(&v).is_ok()
    }

    #[inline]
    fn is_directed(&self) -> bool {
        self.directed
    }

    fn heap_bytes(&self) -> usize {
        self.offsets.capacity() * size_of::<u32>()
            + self.targets.capacity() * size_of::<Vertex>()
            + self.weights.capacity() * size_of::<Weight>()
    }

    fn representation(&self) -> Representation {
        Representation::Csr
    }
}

impl Weighted for Csr {
    type WeightedNeighbors<'a>
        = WeightedRow<'a>
    where
        Self: 'a;

    #[inline]
    fn weighted_neighbors(&self, v: Vertex) -> Self::WeightedNeighbors<'_> {
        WeightedRow::new(self.row(v), self.row_weights(v))
    }

    fn is_weighted(&self) -> bool {
        self.weighted
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
