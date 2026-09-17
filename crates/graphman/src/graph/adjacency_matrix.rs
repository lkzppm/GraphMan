//! Adjacency matrix packed as a bitset: one bit per vertex pair.

use super::{Build, BuildError, Graph, Representation, Vertex, allocation_failed};
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
#[derive(Debug, Clone)]
pub struct AdjacencyMatrix {
    vertex_count: usize,
    words_per_row: usize,
    bits: Vec<u64>,
    degrees: Vec<u32>,
    edge_count: usize,
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

    #[inline]
    fn set(&mut self, u: Vertex, v: Vertex) {
        let index = u as usize * self.words_per_row + v as usize / Self::WORD_BITS;
        self.bits[index] |= 1u64 << (v as usize % Self::WORD_BITS);
    }
}

impl Build for AdjacencyMatrix {
    const REPRESENTATION: Representation = Representation::AdjacencyMatrix;

    fn required_bytes(vertex_count: usize, _edge_count: usize) -> usize {
        (vertex_count + 1) * Self::words_per_row(vertex_count) * size_of::<u64>()
            + (vertex_count + 1) * size_of::<u32>()
    }

    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError> {
        let n = edges.vertex_count();
        let required = Self::required_bytes(n, edges.edge_count());
        let fail = || allocation_failed(Self::REPRESENTATION, required);

        let words_per_row = Self::words_per_row(n);
        let total_words = (n + 1) * words_per_row;
        let mut bits: Vec<u64> = Vec::new();
        bits.try_reserve_exact(total_words).map_err(fail())?;
        bits.resize(total_words, 0);

        let mut matrix = Self {
            vertex_count: n,
            words_per_row,
            bits,
            degrees: edges.degrees(),
            edge_count: edges.edge_count(),
        };
        for &[u, v] in edges.edges() {
            matrix.set(u, v);
            matrix.set(v, u);
        }
        Ok(matrix)
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

    fn heap_bytes(&self) -> usize {
        self.bits.capacity() * size_of::<u64>() + self.degrees.capacity() * size_of::<u32>()
    }

    fn representation(&self) -> Representation {
        Representation::AdjacencyMatrix
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
