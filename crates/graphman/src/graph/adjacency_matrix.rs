//! Adjacency matrix packed as a bitset: one bit per vertex pair.

use super::{
    Build, BuildError, Graph, Orientation, Representation, UNIT_WEIGHT, Vertex, Weight, Weighted,
    WeightedEdge, allocation_failed, csr::first_negative,
};
use crate::io::EdgeList;
use core::mem::size_of;

/// The `n × n` adjacency matrix, stored as a bitset.
///
/// Row `v` is `words_per_row` machine words; bit `w` of the row is set when
/// `{v, w}` is an edge. Storing bits instead of bytes or booleans makes the
/// matrix 8× smaller, and lets [`neighbors`](Graph::neighbors) skip 64
/// absent neighbours per word with a single `trailing_zeros`.
///
/// It is still `Θ(n²)`: 12.5 MB for 10 000 vertices, 312 MB for 50 000 and
/// 17.6 GB for 375 000, which is why builders check a
/// [`MemoryBudget`](super::MemoryBudget) first.
///
/// A weighted graph adds the textbook weight matrix beside the bits: an
/// `(n + 1) × (n + 1)` table of [`Weight`]s, 64 times the size of the
/// bitset (800 MB for 10 000 vertices). The bits still answer every
/// adjacency question; the table is read only for weights, in `O(1)`.
///
/// A directed graph sets bit `(u, v)` for the arc `u → v` only, so the
/// matrix is no longer symmetric; its size does not change.
#[derive(Debug, Clone)]
pub struct AdjacencyMatrix {
    vertex_count: usize,
    words_per_row: usize,
    bits: Vec<u64>,
    /// `(n + 1)²` weights, row-major; empty when the graph is unweighted.
    weights: Vec<Weight>,
    /// Row lengths: out-degrees when directed.
    degrees: Vec<u32>,
    directed: bool,
    edge_count: usize,
    negative_edge: Option<WeightedEdge>,
    negative_loops: Vec<WeightedEdge>,
}

impl AdjacencyMatrix {
    const WORD_BITS: usize = u64::BITS as usize;

    /// Words needed to hold bits `0..=n`.
    fn words_per_row(vertex_count: usize) -> usize {
        (vertex_count + 1).div_ceil(Self::WORD_BITS)
    }

    #[inline]
    fn row(&self, v: Vertex) -> &[u64] {
        let start = v as usize * self.words_per_row;
        &self.bits[start..start + self.words_per_row]
    }

    /// The weights of row `v`, indexed by vertex; empty when unweighted.
    #[inline]
    fn weight_row(&self, v: Vertex) -> &[Weight] {
        if self.weights.is_empty() {
            return &[];
        }
        let stride = self.vertex_count + 1;
        &self.weights[v as usize * stride..][..stride]
    }

    #[inline]
    fn set(&mut self, u: Vertex, v: Vertex) {
        let index = u as usize * self.words_per_row + v as usize / Self::WORD_BITS;
        self.bits[index] |= 1u64 << (v as usize % Self::WORD_BITS);
    }
}

impl Build for AdjacencyMatrix {
    const REPRESENTATION: Representation = Representation::AdjacencyMatrix;

    fn required_bytes_oriented(
        vertex_count: usize,
        _edge_count: usize,
        weighted: bool,
        _orientation: Orientation,
    ) -> usize {
        // Saturating: in the browser `usize` is 32 bits, and a wrapped product
        // would let a matrix nobody can allocate through the budget check.
        let side = vertex_count.saturating_add(1);
        let weights = if weighted {
            side.saturating_mul(side)
        } else {
            0
        };
        side.saturating_mul(Self::words_per_row(vertex_count))
            .saturating_mul(size_of::<u64>())
            .saturating_add(side.saturating_mul(size_of::<u32>()))
            .saturating_add(weights.saturating_mul(size_of::<Weight>()))
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let directed = edges.is_directed();
        let mut matrix = Self::empty(
            edges.vertex_count(),
            edges.is_weighted(),
            directed,
            edges.degrees(),
        )?;
        matrix.edge_count = edges.edge_count();
        matrix.negative_edge = edges.negative_edge();
        matrix.negative_loops = edges.negative_loops().to_vec();
        for &[u, v] in edges.edges() {
            matrix.set(u, v);
            if !directed {
                matrix.set(v, u);
            }
        }
        if let Some(edge_weights) = edges.weights() {
            let stride = matrix.vertex_count + 1;
            for (&[u, v], &weight) in edges.edges().iter().zip(edge_weights) {
                let (u, v) = (u as usize, v as usize);
                matrix.weights[u * stride + v] = weight;
                if !directed {
                    matrix.weights[v * stride + u] = weight;
                }
            }
        }
        Ok(matrix)
    }

    /// Every set bit `(u, v)` sets `(v, u)` in a fresh matrix: `O(n² / 64 +
    /// m)`, plus the weight table's `n²` copy when weighted.
    fn transpose_unchecked(&self) -> Result<Self, BuildError> {
        if !self.directed {
            return Ok(self.clone());
        }
        let n = self.vertex_count;
        let mut in_degrees = vec![0u32; n + 1];
        for u in 1..=n as Vertex {
            for v in self.neighbors(u) {
                in_degrees[v as usize] += 1;
            }
        }
        let weighted = self.is_weighted();
        let mut transpose = Self::empty(n, weighted, true, in_degrees)?;
        transpose.edge_count = self.edge_count;
        transpose.negative_loops = self.negative_loops.clone();
        let stride = n + 1;
        for u in 1..=n as Vertex {
            for v in self.neighbors(u) {
                transpose.set(v, u);
                if weighted {
                    let (u, v) = (u as usize, v as usize);
                    transpose.weights[v * stride + u] = self.weights[u * stride + v];
                }
            }
        }
        if self.negative_edge.is_some() {
            transpose.negative_edge = first_negative(&transpose);
        }
        Ok(transpose)
    }
}

impl AdjacencyMatrix {
    /// A matrix with no bit set, its tables allocated and zeroed.
    fn empty(
        n: usize,
        weighted: bool,
        directed: bool,
        degrees: Vec<u32>,
    ) -> Result<Self, BuildError> {
        let required = Self::required_bytes(n, 0, weighted);
        let fail = || allocation_failed(Self::REPRESENTATION, required);
        // Checked: an unrepresentable size is an allocation failure, not a
        // wrapped (small) table indexed past its end.
        let too_large = || BuildError::AllocationFailed {
            representation: Self::REPRESENTATION,
            required_bytes: required,
        };
        let words_per_row = Self::words_per_row(n);
        let total_words = (n + 1).checked_mul(words_per_row).ok_or_else(too_large)?;
        let mut bits: Vec<u64> = Vec::new();
        bits.try_reserve_exact(total_words).map_err(fail())?;
        bits.resize(total_words, 0);
        let mut weights: Vec<Weight> = Vec::new();
        if weighted {
            let cells = (n + 1).checked_mul(n + 1).ok_or_else(too_large)?;
            weights.try_reserve_exact(cells).map_err(fail())?;
            weights.resize(cells, 0.0);
        }
        Ok(Self {
            vertex_count: n,
            words_per_row,
            bits,
            weights,
            degrees,
            directed,
            edge_count: 0,
            negative_edge: None,
            negative_loops: Vec::new(),
        })
    }
}

impl Graph for AdjacencyMatrix {
    type Neighbors<'a>
        = BitRow<'a>
    where
        Self: 'a;

    #[inline]
    fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    #[inline]
    fn edge_count(&self) -> usize {
        self.edge_count
    }

    #[inline]
    fn degree(&self, v: Vertex) -> usize {
        self.degrees[v as usize] as usize
    }

    #[inline]
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_> {
        BitRow::new(self.row(v))
    }

    #[inline]
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        let word = self.row(u)[v as usize / Self::WORD_BITS];
        word & (1u64 << (v as usize % Self::WORD_BITS)) != 0
    }

    #[inline]
    fn is_directed(&self) -> bool {
        self.directed
    }

    fn heap_bytes(&self) -> usize {
        self.bits.capacity() * size_of::<u64>()
            + self.weights.capacity() * size_of::<Weight>()
            + self.degrees.capacity() * size_of::<u32>()
    }

    fn representation(&self) -> Representation {
        Representation::AdjacencyMatrix
    }
}

impl Weighted for AdjacencyMatrix {
    type WeightedNeighbors<'a>
        = WeightedBitRow<'a>
    where
        Self: 'a;

    #[inline]
    fn weighted_neighbors(&self, v: Vertex) -> Self::WeightedNeighbors<'_> {
        WeightedBitRow {
            bits: BitRow::new(self.row(v)),
            weights: self.weight_row(v),
        }
    }

    fn is_weighted(&self) -> bool {
        !self.weights.is_empty()
    }

    #[inline]
    fn weight(&self, u: Vertex, v: Vertex) -> Option<Weight> {
        if !self.has_edge(u, v) {
            return None;
        }
        Some(
            self.weight_row(u)
                .get(v as usize)
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

/// Iterates a matrix row's set bits with the weights of those edges.
#[derive(Debug, Clone)]
pub struct WeightedBitRow<'a> {
    bits: BitRow<'a>,
    /// The row of the weight matrix; empty when unweighted.
    weights: &'a [Weight],
}

impl Iterator for WeightedBitRow<'_> {
    type Item = (Vertex, Weight);

    #[inline]
    fn next(&mut self) -> Option<(Vertex, Weight)> {
        let v = self.bits.next()?;
        Some((
            v,
            self.weights.get(v as usize).copied().unwrap_or(UNIT_WEIGHT),
        ))
    }
}

/// Iterates the set bits of a matrix row, yielding them as vertices.
#[derive(Debug, Clone)]
pub struct BitRow<'a> {
    words: &'a [u64],
    next_word: usize,
    current: u64,
    base: Vertex,
}

impl<'a> BitRow<'a> {
    fn new(words: &'a [u64]) -> Self {
        Self {
            words,
            next_word: 0,
            current: 0,
            base: 0,
        }
    }
}

impl Iterator for BitRow<'_> {
    type Item = Vertex;

    #[inline]
    fn next(&mut self) -> Option<Vertex> {
        while self.current == 0 {
            let word = *self.words.get(self.next_word)?;
            self.current = word;
            self.base = (self.next_word * AdjacencyMatrix::WORD_BITS) as Vertex;
            self.next_word += 1;
        }
        let bit = self.current.trailing_zeros();
        self.current &= self.current - 1;
        Some(self.base + bit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bit_row_yields_set_bits_in_order() {
        let words = [0b1010u64, 0, 1 << 63, 0b1];
        let bits: Vec<Vertex> = BitRow::new(&words).collect();
        assert_eq!(bits, vec![1, 3, 191, 192]);
    }

    #[test]
    fn empty_row_yields_nothing() {
        assert_eq!(BitRow::new(&[0, 0]).count(), 0);
        assert_eq!(BitRow::new(&[]).count(), 0);
    }
}
