//! Compressed sparse row: the cache-friendly adjacency list.

use super::{Build, BuildError, Graph, Representation, Vertex, allocation_failed};
use crate::io::EdgeList;
use core::mem::size_of;

/// Compressed sparse row storage.
///
/// The neighbours of every vertex live back to back in one `targets` array;
/// `offsets[v]..offsets[v + 1]` is the slice belonging to `v`. Compared with
/// [`AdjacencyList`](super::AdjacencyList) this removes one pointer chase and
/// one heap block per vertex, which is what makes traversals of graphs with
/// millions of vertices bandwidth-bound rather than latency-bound.
#[derive(Debug, Clone)]
pub struct Csr {
    offsets: Vec<u32>,
    targets: Vec<Vertex>,
    edge_count: usize,
}

impl Csr {
    /// The row offsets: `offsets[v]..offsets[v + 1]` indexes the neighbours
    /// of `v` in [`targets`](Self::targets). Length `n + 2` (index 0 unused).
    pub fn offsets(&self) -> &[u32] {
        &self.offsets
    }

    /// Every neighbour row back to back, `2m` entries.
    pub fn targets(&self) -> &[Vertex] {
        &self.targets
    }

    /// The neighbour row of `v` as a slice.
    #[inline]
    pub fn row(&self, v: Vertex) -> &[Vertex] {
        let v = v as usize;
        &self.targets[self.offsets[v] as usize..self.offsets[v + 1] as usize]
    }
}

impl Build for Csr {
    const REPRESENTATION: Representation = Representation::Csr;

    fn required_bytes(vertex_count: usize, edge_count: usize) -> usize {
        (vertex_count + 2) * size_of::<u32>() + 2 * edge_count * size_of::<Vertex>()
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let n = edges.vertex_count();
        let m = edges.edge_count();
        assert!(
            2 * m < u32::MAX as usize,
            "CSR offsets are 32-bit: at most 2^31 edges"
        );
        let required = Self::required_bytes(n, m);
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
        targets.try_reserve_exact(2 * m).map_err(fail())?;
        targets.resize(2 * m, 0);

        // Same ordering argument as the adjacency list: a sorted edge list
        // fills every row in ascending order.
        let mut cursor: Vec<u32> = offsets[..=n].to_vec();
        for &[u, v] in edges.edges() {
            targets[cursor[u as usize] as usize] = v;
            cursor[u as usize] += 1;
            targets[cursor[v as usize] as usize] = u;
            cursor[v as usize] += 1;
        }
        Ok(Self {
            offsets,
            targets,
            edge_count: m,
        })
    }
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

    fn heap_bytes(&self) -> usize {
        self.offsets.capacity() * size_of::<u32>() + self.targets.capacity() * size_of::<Vertex>()
    }

    fn representation(&self) -> Representation {
        Representation::Csr
    }
}
