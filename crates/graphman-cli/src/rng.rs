//! A tiny deterministic PRNG (SplitMix64), so benchmarks are reproducible
//! without pulling in a random-number crate.

use graphman::Vertex;
use std::collections::HashSet;

pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// `count` distinct vertices of a graph with `vertex_count` vertices
    /// (all of them, in random order, if `count >= vertex_count`).
    pub fn distinct_vertices(&mut self, vertex_count: usize, count: usize) -> Vec<Vertex> {
        let count = count.min(vertex_count);
        let mut chosen = Vec::with_capacity(count);
        let mut seen = HashSet::with_capacity(count * 2);
        while chosen.len() < count {
            let v = (self.next_u64() % vertex_count as u64) as Vertex + 1;
            if seen.insert(v) {
                chosen.push(v);
            }
        }
        chosen
    }
}
