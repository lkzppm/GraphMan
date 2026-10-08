//! Frontiers: where Dijkstra keeps its distance estimates.
//!
//! Dijkstra's algorithm is one loop: take the reached vertex with the
//! smallest estimate, settle it, relax its edges. Everything that changes
//! between textbook versions is *how the estimates are stored, lowered and
//! the minimum found*. That is the [`Frontier`] trait, and the algorithm in
//! [`dijkstra_into`](super::dijkstra_into) is written once against it, the
//! way every traversal is written once against [`Graph`](crate::Graph).
//!
//! | Frontier | `decrease` | `pop_min` | one run |
//! |---|---|---|---|
//! | [`VectorFrontier`] | `O(1)` | `O(n)` scan | `O(n² + m)` |
//! | [`HeapFrontier`] | `O(log n)` sift up | `O(log n)` | `O((n + m) log n)` |
//! | [`LazyHeapFrontier`] | `O(log m)` push | `O(log m)` amortised | `O(m log m)` |
//!
//! All three break ties on the smaller vertex id, so the same graph and root
//! give the same settle order and the same tree whichever is used.

use crate::graph::{NO_VERTEX, Vertex, Weight};
use core::cmp::Ordering;
use core::fmt;
use core::str::FromStr;
use std::collections::BinaryHeap;

/// Storage for the tentative distances of reached, unsettled vertices.
///
/// The contract with the algorithm: [`decrease`](Self::decrease) is only
/// called with an estimate strictly smaller than the vertex's previous one
/// (or for a vertex not in the frontier yet), and a vertex returned by
/// [`pop_min`](Self::pop_min) is never inserted again.
pub trait Frontier {
    /// Empties the frontier and sizes it for a graph with `vertex_count`
    /// vertices. Cheap when the previous run emptied it.
    fn reset(&mut self, vertex_count: usize);

    /// Inserts `v` with the estimate `distance`, or lowers its estimate.
    fn decrease(&mut self, v: Vertex, distance: Weight);

    /// Removes and returns the vertex with the smallest estimate (the
    /// smaller id on a tie), or `None` when the frontier is empty.
    fn pop_min(&mut self) -> Option<(Vertex, Weight)>;

    /// Which strategy this is.
    fn kind(&self) -> FrontierKind;
}

/// `true` when `(a_distance, a)` comes before `(b_distance, b)`.
#[inline(always)]
fn before(a: (Weight, Vertex), b: (Weight, Vertex)) -> bool {
    a.0 < b.0 || (a.0 == b.0 && a.1 < b.1)
}

/// The course's vector: one estimate per vertex, the minimum found by a
/// linear scan.
///
/// `estimate[v]` is `+∞` for every vertex outside the frontier, so a scan
/// reads one contiguous array of `n` floats and keeps the first smallest,
/// which is the smallest id on a tie.
#[derive(Debug, Clone, Default)]
pub struct VectorFrontier {
    estimate: Vec<Weight>,
    len: usize,
}

impl VectorFrontier {
    /// An empty frontier for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        let mut frontier = Self::default();
        frontier.reset(vertex_count);
        frontier
    }
}

impl Frontier for VectorFrontier {
    fn reset(&mut self, vertex_count: usize) {
        if self.len > 0 || self.estimate.len() != vertex_count + 1 {
            self.estimate.clear();
            self.estimate.resize(vertex_count + 1, Weight::INFINITY);
            self.len = 0;
        }
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        let slot = &mut self.estimate[v as usize];
        self.len += usize::from(*slot == Weight::INFINITY);
        *slot = distance;
    }

    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        if self.len == 0 {
            return None;
        }
        // Still one pass over all `n` estimates, but as eight independent
        // running minima (one per lane) that the compiler turns into SIMD
        // compares, instead of one long chain of dependent comparisons.
        // Each lane keeps its first minimum and the lanes are merged on
        // (distance, vertex), so ties still go to the smallest vertex.
        const LANES: usize = 8;
        let mut lane_distance = [Weight::INFINITY; LANES];
        let mut lane_vertex = [NO_VERTEX as usize; LANES];
        let chunks = self.estimate.chunks_exact(LANES);
        let tail = chunks.remainder();
        for (index, chunk) in chunks.enumerate() {
            for lane in 0..LANES {
                if chunk[lane] < lane_distance[lane] {
                    lane_distance[lane] = chunk[lane];
                    lane_vertex[lane] = index * LANES + lane;
                }
            }
        }
        let (mut best, mut best_distance) = (NO_VERTEX as usize, Weight::INFINITY);
        let offset = self.estimate.len() - tail.len();
        for (v, &distance) in (offset..).zip(tail) {
            if distance < best_distance {
                (best, best_distance) = (v, distance);
            }
        }
        for lane in 0..LANES {
            let candidate = (lane_distance[lane], lane_vertex[lane] as Vertex);
            if before(candidate, (best_distance, best as Vertex)) {
                (best_distance, best) = (candidate.0, candidate.1 as usize);
            }
        }
        self.estimate[best] = Weight::INFINITY;
        self.len -= 1;
        Some((best as Vertex, best_distance))
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::Vector
    }
}

/// An indexed binary min-heap with decrease-key.
///
/// `heap` holds `(estimate, vertex)` pairs in heap order; `position[v]` is
/// the index of `v` in `heap` (`ABSENT` outside the frontier), which is what
/// lets [`decrease`](Frontier::decrease) find a vertex and sift it up in
/// `O(log n)` instead of inserting a duplicate.
#[derive(Debug, Clone, Default)]
pub struct HeapFrontier {
    heap: Vec<(Weight, Vertex)>,
    position: Vec<u32>,
}

impl HeapFrontier {
    const ABSENT: u32 = u32::MAX;

    /// An empty frontier for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        let mut frontier = Self::default();
        frontier.reset(vertex_count);
        frontier
    }

    /// Moves the entry at `index` up until its parent comes before it.
    #[inline]
    fn sift_up(&mut self, mut index: usize) {
        let entry = self.heap[index];
        while index > 0 {
            let parent = (index - 1) / 2;
            if !before(entry, self.heap[parent]) {
                break;
            }
            self.heap[index] = self.heap[parent];
            self.position[self.heap[index].1 as usize] = index as u32;
            index = parent;
        }
        self.heap[index] = entry;
        self.position[entry.1 as usize] = index as u32;
    }

    /// Moves the entry at `index` down until both children come after it.
    #[inline]
    fn sift_down(&mut self, mut index: usize) {
        let entry = self.heap[index];
        let len = self.heap.len();
        loop {
            let left = 2 * index + 1;
            if left >= len {
                break;
            }
            let right = left + 1;
            let child = if right < len && before(self.heap[right], self.heap[left]) {
                right
            } else {
                left
            };
            if !before(self.heap[child], entry) {
                break;
            }
            self.heap[index] = self.heap[child];
            self.position[self.heap[index].1 as usize] = index as u32;
            index = child;
        }
        self.heap[index] = entry;
        self.position[entry.1 as usize] = index as u32;
    }
}

impl Frontier for HeapFrontier {
    fn reset(&mut self, vertex_count: usize) {
        if self.position.len() != vertex_count + 1 {
            self.position.clear();
            self.position.resize(vertex_count + 1, Self::ABSENT);
            self.heap.clear();
        }
        for &(_, v) in &self.heap {
            self.position[v as usize] = Self::ABSENT;
        }
        self.heap.clear();
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        match self.position[v as usize] {
            Self::ABSENT => {
                self.heap.push((distance, v));
                self.sift_up(self.heap.len() - 1);
            }
            index => {
                let index = index as usize;
                debug_assert!(distance <= self.heap[index].0, "estimates only decrease");
                self.heap[index].0 = distance;
                self.sift_up(index);
            }
        }
    }

    #[inline]
    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        let last = self.heap.pop()?;
        let top = match self.heap.first_mut() {
            None => last,
            Some(first) => {
                let top = core::mem::replace(first, last);
                self.sift_down(0);
                top
            }
        };
        self.position[top.1 as usize] = Self::ABSENT;
        Some((top.1, top.0))
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::Heap
    }
}

/// A heap entry ordered so that `BinaryHeap` (a max-heap) pops the smallest
/// estimate first, the smaller vertex on a tie.
#[derive(Debug, Clone, Copy)]
struct Entry(Weight, Vertex);

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Entry {}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .0
            .total_cmp(&self.0)
            .then_with(|| other.1.cmp(&self.1))
    }
}

/// The standard library's [`BinaryHeap`] without decrease-key: lowering an
/// estimate pushes a second entry, and stale entries are skipped when they
/// surface.
///
/// This is what most Dijkstra implementations do (`petgraph`'s among them).
/// It is here as the yardstick for [`HeapFrontier`]: the handout asks for a
/// heap whose keys can be modified efficiently, and this is the price of a
/// heap whose keys cannot. `latest[v]` is the last estimate given to `v`;
/// an entry is stale when its estimate is no longer that one.
#[derive(Debug, Clone, Default)]
pub struct LazyHeapFrontier {
    heap: BinaryHeap<Entry>,
    latest: Vec<Weight>,
}

impl LazyHeapFrontier {
    /// An empty frontier for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        let mut frontier = Self::default();
        frontier.reset(vertex_count);
        frontier
    }
}

impl Frontier for LazyHeapFrontier {
    fn reset(&mut self, vertex_count: usize) {
        self.heap.clear();
        // No need to clear `latest`: an entry is only ever compared with the
        // estimate written when it was pushed in the same run.
        self.latest.resize(vertex_count + 1, Weight::INFINITY);
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        // Any older entry for `v` now carries a larger estimate than
        // `latest[v]` and will be skipped when it surfaces.
        self.latest[v as usize] = distance;
        self.heap.push(Entry(distance, v));
    }

    #[inline]
    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        while let Some(Entry(distance, v)) = self.heap.pop() {
            let latest = &mut self.latest[v as usize];
            if distance == *latest {
                // Settled: no entry left for `v` can match any more.
                *latest = Weight::NEG_INFINITY;
                return Some((v, distance));
            }
        }
        None
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::LazyHeap
    }
}

/// The frontiers offered by the library, for choosing one at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum FrontierKind {
    /// [`VectorFrontier`]: a vector of estimates scanned for the minimum.
    Vector,
    /// [`HeapFrontier`]: an indexed binary heap with decrease-key.
    Heap,
    /// [`LazyHeapFrontier`]: a binary heap without decrease-key.
    LazyHeap,
}

impl FrontierKind {
    /// Every frontier, in the order they are usually reported.
    pub const ALL: [FrontierKind; 3] = [
        FrontierKind::Vector,
        FrontierKind::Heap,
        FrontierKind::LazyHeap,
    ];

    /// Short identifier used on the command line (`vector`, `heap`, `lazy-heap`).
    pub fn label(self) -> &'static str {
        match self {
            FrontierKind::Vector => "vector",
            FrontierKind::Heap => "heap",
            FrontierKind::LazyHeap => "lazy-heap",
        }
    }

    /// Human readable name.
    pub fn name(self) -> &'static str {
        match self {
            FrontierKind::Vector => "vector of estimates",
            FrontierKind::Heap => "binary heap with decrease-key",
            FrontierKind::LazyHeap => "binary heap without decrease-key",
        }
    }
}

impl fmt::Display for FrontierKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for FrontierKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "vector" | "vec" | "array" => Ok(FrontierKind::Vector),
            "heap" => Ok(FrontierKind::Heap),
            "lazy-heap" | "lazy_heap" | "lazy" => Ok(FrontierKind::LazyHeap),
            other => Err(format!(
                "unknown frontier {other:?} (expected vector, heap or lazy-heap)"
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds the same operations to a frontier and returns what it pops.
    fn drain<F: Frontier>(mut frontier: F) -> Vec<(Vertex, Weight)> {
        frontier.reset(8);
        for (v, d) in [(5, 4.0), (2, 9.0), (7, 4.0), (3, 1.5), (2, 3.0), (8, 0.0)] {
            frontier.decrease(v, d);
        }
        assert_eq!(frontier.pop_min(), Some((8, 0.0)));
        frontier.decrease(6, 2.0);
        frontier.decrease(7, 1.0);
        let mut popped = vec![(8, 0.0)];
        while let Some(entry) = frontier.pop_min() {
            popped.push(entry);
        }
        popped
    }

    #[test]
    fn every_frontier_pops_in_the_same_order() {
        let expected = vec![(8, 0.0), (7, 1.0), (3, 1.5), (6, 2.0), (2, 3.0), (5, 4.0)];
        assert_eq!(drain(VectorFrontier::default()), expected);
        assert_eq!(drain(HeapFrontier::default()), expected);
        assert_eq!(drain(LazyHeapFrontier::default()), expected);
    }

    #[test]
    fn ties_go_to_the_smaller_vertex() {
        let mut heap = HeapFrontier::new(10);
        let mut vector = VectorFrontier::new(10);
        for v in [9, 4, 6, 1, 10] {
            heap.decrease(v, 2.5);
            vector.decrease(v, 2.5);
        }
        for expected in [1, 4, 6, 9, 10] {
            assert_eq!(heap.pop_min(), Some((expected, 2.5)));
            assert_eq!(vector.pop_min(), Some((expected, 2.5)));
        }
    }

    #[test]
    fn reset_forgets_leftovers() {
        let mut heap = HeapFrontier::new(4);
        let mut vector = VectorFrontier::new(4);
        heap.decrease(3, 1.0);
        vector.decrease(3, 1.0);
        heap.reset(4);
        vector.reset(4);
        heap.decrease(3, 5.0);
        assert_eq!(heap.pop_min(), Some((3, 5.0)));
        assert_eq!(vector.pop_min(), None);
    }

    #[test]
    fn kinds_parse_and_print() {
        for kind in FrontierKind::ALL {
            assert_eq!(kind.label().parse::<FrontierKind>(), Ok(kind));
        }
        assert!("fibonacci".parse::<FrontierKind>().is_err());
    }
}
