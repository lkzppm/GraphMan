//! Adjacency list: one heap-allocated `Vec<Vertex>` per vertex.

use super::{Build, BuildError, Graph, Representation, Vertex, allocation_failed};
use crate::io::EdgeList;
use core::mem::size_of;

/// The textbook adjacency list.
///
/// `adj[v]` holds the neighbours of `v` in ascending order. Row `0` is unused
/// so that vertices can index the table directly.
#[derive(Debug, Clone)]
pub struct AdjacencyList {
    adj: Vec<Vec<Vertex>>,
    edge_count: usize,
}

impl AdjacencyList {
    /// The neighbour row of `v` as a slice.
    #[inline]
    pub fn row(&self, v: Vertex) -> &[Vertex] {
        &self.adj[v as usize]
    }
}

impl Build for AdjacencyList {
    const REPRESENTATION: Representation = Representation::AdjacencyList;

    fn required_bytes(vertex_count: usize, edge_count: usize) -> usize {
        (vertex_count + 1) * size_of::<Vec<Vertex>>() + 2 * edge_count * size_of::<Vertex>()
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let n = edges.vertex_count();
        let required = Self::required_bytes(n, edges.edge_count());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let degrees = edges.degrees();
        let mut adj: Vec<Vec<Vertex>> = Vec::new();
        adj.try_reserve_exact(n + 1).map_err(fail())?;
        for &degree in &degrees {
            let mut row = Vec::new();
            row.try_reserve_exact(degree as usize).map_err(fail())?;
            adj.push(row);
        }
        // `edges` is sorted by (min, max), which makes every row ascending:
        // all smaller neighbours of `v` are pushed (in order) while the outer
        // endpoint is < v, and all larger ones while it is == v.
        for &[u, v] in edges.edges() {
            adj[u as usize].push(v);
            adj[v as usize].push(u);
        }
        Ok(Self {
            adj,
            edge_count: edges.edge_count(),
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
    }

    fn representation(&self) -> Representation {
        Representation::AdjacencyList
    }
}
