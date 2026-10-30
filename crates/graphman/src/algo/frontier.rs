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
//! | [`QuadHeapFrontier`] | `O(log₄ n)` sift up | `O(4 log₄ n)` | `O((n + m) log n)` |
//! | [`PairingHeapFrontier`] | cut and meld, amortised `O(log n)` | `O(log n)` amortised | `O((n + m) log n)` |
//! | [`RadixHeapFrontier`] | `O(1)` push | amortised `O(log C)`, `C = 2⁶⁴` | `O(m log C)` |
//!
//! The first three are the course's; the last three are the usual ways to
//! go faster in practice: a wider heap (shallower, cache-friendlier), a
//! pointer heap whose decrease-key is a cut and a meld, and a *monotone*
//! queue that never compares keys at all, it files them by their bits.
//!
//! All of them break ties on the smaller vertex id, so the same graph and
//! root give the same settle order and the same tree whichever is used.
//!
//! [`Frontier::entries`] reads a frontier as it is stored (the heap's array,
//! the vector's slots), for drawing it; the algorithm never calls it.

use crate::graph::{NO_VERTEX, Vertex, Weight};
use core::cmp::Ordering;
use core::fmt;
use core::mem::size_of;
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

    /// How many entries the frontier holds right now. For the vector, the
    /// indexed heaps and the pairing heap, the vertices with an estimate;
    /// for the lazy and the radix heaps, every estimate pushed and not yet
    /// popped or skipped, stale ones included.
    fn len(&self) -> usize;

    /// Whether the frontier holds no entry.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Bytes the frontier owns on the heap: its arrays indexed by vertex
    /// plus the capacity of its entry storage, which keeps the largest size
    /// any run needed (the memory a strategy costs, as opposed to the
    /// process RSS).
    fn heap_bytes(&self) -> usize;

    /// Which strategy this is.
    fn kind(&self) -> FrontierKind;

    /// The entries as they are stored: the vector's finite slots by vertex,
    /// a binary heap's array in heap order (index 0 is the next to leave,
    /// the children of `i` are `2i + 1` and `2i + 2`; `4i + 1..=4i + 4` in
    /// the 4-ary heap), the pairing heap's tree level by level (each
    /// entry's parent before it), the radix heap's buckets from the smallest. For showing a frontier, not for
    /// running one: it allocates and copies.
    fn entries(&self) -> Vec<FrontierEntry>;
}

/// One entry of a frontier, as [`Frontier::entries`] reads it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrontierEntry {
    /// The vertex the estimate belongs to.
    pub vertex: Vertex,
    /// Its tentative distance.
    pub estimate: Weight,
    /// [`LazyHeapFrontier`] and [`RadixHeapFrontier`] only: an older
    /// estimate of a vertex whose estimate has since dropped, left in the
    /// queue to be skipped.
    pub stale: bool,
    /// [`PairingHeapFrontier`] only: the index of this entry's parent in
    /// the list, `None` for the root (an array heap's parent is implicit).
    pub parent: Option<u32>,
    /// [`RadixHeapFrontier`] only: the bucket the entry is filed in, `0`
    /// for the keys equal to the last one popped.
    pub bucket: Option<u8>,
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

    fn len(&self) -> usize {
        self.len
    }

    fn heap_bytes(&self) -> usize {
        self.estimate.capacity() * size_of::<Weight>()
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::Vector
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        (1..self.estimate.len())
            .filter(|&v| self.estimate[v] < Weight::INFINITY)
            .map(|v| FrontierEntry {
                vertex: v as Vertex,
                estimate: self.estimate[v],
                stale: false,
                parent: None,
                bucket: None,
            })
            .collect()
    }
}

/// An indexed `D`-ary min-heap with decrease-key: [`HeapFrontier`] (`D = 2`)
/// and [`QuadHeapFrontier`] (`D = 4`).
///
/// `heap` holds `(estimate, vertex)` pairs in heap order; `position[v]` is
/// the index of `v` in `heap` (`ABSENT` outside the frontier), which is what
/// lets [`decrease`](Frontier::decrease) find a vertex and sift it up in
/// `O(log n)` instead of inserting a duplicate. A wider heap is shallower,
/// so a sift up (every `decrease`) climbs fewer levels, and a sift down
/// reads `D` children that sit side by side in memory.
#[derive(Debug, Clone, Default)]
pub struct DaryHeapFrontier<const D: usize> {
    heap: Vec<(Weight, Vertex)>,
    position: Vec<u32>,
}

/// The indexed binary heap with decrease-key the course asks for.
pub type HeapFrontier = DaryHeapFrontier<2>;

/// The same indexed heap with four children per entry.
pub type QuadHeapFrontier = DaryHeapFrontier<4>;

impl<const D: usize> DaryHeapFrontier<D> {
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
            let parent = (index - 1) / D;
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

    /// Moves the entry at `index` down until all its children come after it.
    #[inline]
    fn sift_down(&mut self, mut index: usize) {
        let entry = self.heap[index];
        let len = self.heap.len();
        loop {
            let first = D * index + 1;
            if first >= len {
                break;
            }
            let mut child = first;
            for other in first + 1..(first + D).min(len) {
                if before(self.heap[other], self.heap[child]) {
                    child = other;
                }
            }
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

impl<const D: usize> Frontier for DaryHeapFrontier<D> {
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

    fn len(&self) -> usize {
        self.heap.len()
    }

    fn heap_bytes(&self) -> usize {
        self.heap.capacity() * size_of::<(Weight, Vertex)>()
            + self.position.capacity() * size_of::<u32>()
    }

    fn kind(&self) -> FrontierKind {
        match D {
            2 => FrontierKind::Heap,
            4 => FrontierKind::QuadHeap,
            _ => unimplemented!("only the binary and the 4-ary heaps are offered"),
        }
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        self.heap
            .iter()
            .map(|&(estimate, vertex)| FrontierEntry {
                vertex,
                estimate,
                stale: false,
                parent: None,
                bucket: None,
            })
            .collect()
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

    fn len(&self) -> usize {
        self.heap.len()
    }

    fn heap_bytes(&self) -> usize {
        self.heap.capacity() * size_of::<Entry>() + self.latest.capacity() * size_of::<Weight>()
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::LazyHeap
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        // `as_slice` is the heap's own array, in heap order.
        self.heap
            .as_slice()
            .iter()
            .map(|&Entry(estimate, vertex)| FrontierEntry {
                vertex,
                estimate,
                stale: estimate != self.latest[vertex as usize],
                parent: None,
                bucket: None,
            })
            .collect()
    }
}

/// A pairing heap with decrease-key (Fredman, Sedgewick, Sleator and
/// Tarjan, 1986): a tree where every parent comes before its children, kept
/// as arrays indexed by vertex, so a vertex is its own node.
///
/// Inserting is a *meld*: compare with the root, the loser becomes the
/// winner's first child. Lowering a key cuts the vertex's subtree from its
/// parent and melds it with the root. Popping removes the root and melds
/// its children in two passes (pairs left to right, then the pairs right to
/// left), which is where all the work is, amortised `O(log n)`. Fibonacci
/// heaps have better bounds on paper; pairing heaps are what wins on real
/// machines among heaps that have a decrease-key.
#[derive(Debug, Clone, Default)]
pub struct PairingHeapFrontier {
    /// The estimate of each vertex in the heap, `+∞` outside it.
    key: Vec<Weight>,
    /// The first child, the next sibling, and the previous node: the left
    /// sibling, or the parent for a first child. `NIL` when none.
    child: Vec<Vertex>,
    next: Vec<Vertex>,
    prev: Vec<Vertex>,
    root: Vertex,
    len: usize,
    /// The children of a popped root, reused between pops.
    scratch: Vec<Vertex>,
}

impl PairingHeapFrontier {
    const NIL: Vertex = NO_VERTEX;

    /// An empty frontier for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        let mut frontier = Self::default();
        frontier.reset(vertex_count);
        frontier
    }

    #[inline(always)]
    fn first(&self, a: Vertex, b: Vertex) -> bool {
        before((self.key[a as usize], a), (self.key[b as usize], b))
    }

    /// Melds two roots and returns the new root: the later one becomes the
    /// earlier one's first child.
    #[inline]
    fn meld(&mut self, a: Vertex, b: Vertex) -> Vertex {
        let (winner, loser) = if self.first(a, b) { (a, b) } else { (b, a) };
        let old = self.child[winner as usize];
        self.next[loser as usize] = old;
        if old != Self::NIL {
            self.prev[old as usize] = loser;
        }
        self.prev[loser as usize] = winner;
        self.child[winner as usize] = loser;
        winner
    }

    /// Detaches `v` (with its subtree) from its parent or siblings.
    #[inline]
    fn cut(&mut self, v: Vertex) {
        let (prev, next) = (self.prev[v as usize], self.next[v as usize]);
        if self.child[prev as usize] == v {
            self.child[prev as usize] = next;
        } else {
            self.next[prev as usize] = next;
        }
        if next != Self::NIL {
            self.prev[next as usize] = prev;
        }
        self.prev[v as usize] = Self::NIL;
        self.next[v as usize] = Self::NIL;
    }
}

impl Frontier for PairingHeapFrontier {
    fn reset(&mut self, vertex_count: usize) {
        if self.len > 0 || self.key.len() != vertex_count + 1 {
            self.key.clear();
            self.key.resize(vertex_count + 1, Weight::INFINITY);
            for links in [&mut self.child, &mut self.next, &mut self.prev] {
                links.clear();
                links.resize(vertex_count + 1, Self::NIL);
            }
        }
        self.root = Self::NIL;
        self.len = 0;
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        let i = v as usize;
        if self.key[i] == Weight::INFINITY {
            self.key[i] = distance;
            self.len += 1;
            self.root = if self.root == Self::NIL {
                v
            } else {
                self.meld(self.root, v)
            };
            return;
        }
        debug_assert!(distance <= self.key[i], "estimates only decrease");
        self.key[i] = distance;
        if v != self.root {
            self.cut(v);
            self.root = self.meld(self.root, v);
        }
    }

    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        let top = self.root;
        if top == Self::NIL {
            return None;
        }
        let distance = self.key[top as usize];
        // The children, detached, then melded in two passes.
        let mut children = core::mem::take(&mut self.scratch);
        children.clear();
        let mut c = self.child[top as usize];
        while c != Self::NIL {
            let next = self.next[c as usize];
            self.prev[c as usize] = Self::NIL;
            self.next[c as usize] = Self::NIL;
            children.push(c);
            c = next;
        }
        let mut pairs = 0;
        let mut k = 0;
        while k + 1 < children.len() {
            children[pairs] = self.meld(children[k], children[k + 1]);
            pairs += 1;
            k += 2;
        }
        if k < children.len() {
            children[pairs] = children[k];
            pairs += 1;
        }
        let mut root = Self::NIL;
        for &tree in children[..pairs].iter().rev() {
            root = if root == Self::NIL {
                tree
            } else {
                self.meld(tree, root)
            };
        }
        self.scratch = children;
        self.root = root;
        self.child[top as usize] = Self::NIL;
        self.key[top as usize] = Weight::INFINITY;
        self.len -= 1;
        Some((top, distance))
    }

    fn len(&self) -> usize {
        self.len
    }

    fn heap_bytes(&self) -> usize {
        self.key.capacity() * size_of::<Weight>()
            + [&self.child, &self.next, &self.prev, &self.scratch]
                .iter()
                .map(|links| links.capacity() * size_of::<Vertex>())
                .sum::<usize>()
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::Pairing
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        let mut out = Vec::with_capacity(self.len);
        if self.root != Self::NIL {
            out.push(FrontierEntry {
                vertex: self.root,
                estimate: self.key[self.root as usize],
                stale: false,
                parent: None,
                bucket: None,
            });
        }
        // Level by level: each entry's children follow every entry of its
        // level, so a list cut short keeps the top of the tree.
        let mut at = 0;
        while at < out.len() {
            let mut c = self.child[out[at].vertex as usize];
            while c != Self::NIL {
                out.push(FrontierEntry {
                    vertex: c,
                    estimate: self.key[c as usize],
                    stale: false,
                    parent: Some(at as u32),
                    bucket: None,
                });
                c = self.next[c as usize];
            }
            at += 1;
        }
        out
    }
}

/// A radix heap (Ahuja, Mehlhorn, Orlin and Tarjan, 1990): a *monotone*
/// queue, one that only works because Dijkstra never asks for a key smaller
/// than the last one it popped, and that never compares two keys to order
/// them. It files them by their bits instead.
///
/// A non-negative `f64` orders exactly like its bit pattern read as a
/// `u64`, so the distances themselves are the integer keys: no rounding.
/// An entry sits in bucket `b`, the position of the highest bit where its
/// key differs from `last` (the last key popped), `0` when equal. Popping
/// empties the first non-empty bucket into lower ones around its smallest
/// key, which becomes `last`; an entry only ever moves down, so across a
/// run it moves at most 64 times. Without decrease-key, a lowered estimate
/// is pushed again and the old entry is skipped, as in the lazy heap.
///
/// Bucket 0 holds every entry whose key equals `last` (vertices at the same
/// distance), as a small heap of vertex ids so the smaller one leaves first.
#[derive(Debug, Clone, Default)]
pub struct RadixHeapFrontier {
    /// Buckets 1..=64; index 0 is unused (bucket 0 is `equal`).
    buckets: Vec<Vec<(u64, Vertex)>>,
    equal: BinaryHeap<core::cmp::Reverse<Vertex>>,
    last: u64,
    /// The latest key given to each vertex, `SETTLED` once popped.
    latest: Vec<u64>,
}

impl RadixHeapFrontier {
    const SETTLED: u64 = u64::MAX;

    /// An empty frontier for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        let mut frontier = Self::default();
        frontier.reset(vertex_count);
        frontier
    }

    /// The key of a distance: its bits, `-0.0` taken as `0.0`.
    #[inline(always)]
    fn key(distance: Weight) -> u64 {
        (distance + 0.0).to_bits()
    }

    /// The bucket of `key` against `last`: 0 when equal, else 1 + the
    /// highest differing bit.
    #[inline(always)]
    fn bucket(&self, key: u64) -> usize {
        (u64::BITS - (key ^ self.last).leading_zeros()) as usize
    }

    #[inline(always)]
    fn file(&mut self, key: u64, v: Vertex) {
        match self.bucket(key) {
            0 => self.equal.push(core::cmp::Reverse(v)),
            b => self.buckets[b].push((key, v)),
        }
    }

    /// Refills bucket 0: empties the first non-empty bucket into lower
    /// ones around its smallest live key. `false` when nothing is left.
    fn refill(&mut self) -> bool {
        for b in 1..self.buckets.len() {
            if self.buckets[b].is_empty() {
                continue;
            }
            let mut bucket = core::mem::take(&mut self.buckets[b]);
            bucket.retain(|&(key, v)| self.latest[v as usize] == key);
            if let Some(&(min, _)) = bucket.iter().min_by_key(|&&(key, _)| key) {
                self.last = min;
                for &(key, v) in &bucket {
                    self.file(key, v);
                }
            }
            bucket.clear();
            self.buckets[b] = bucket;
            if !self.equal.is_empty() {
                return true;
            }
        }
        false
    }
}

impl Frontier for RadixHeapFrontier {
    fn reset(&mut self, vertex_count: usize) {
        self.buckets.resize_with(u64::BITS as usize + 1, Vec::new);
        for bucket in &mut self.buckets {
            bucket.clear();
        }
        self.equal.clear();
        self.last = 0;
        // As in the lazy heap, `latest` is only read for a vertex pushed in
        // this run, after the push wrote it.
        self.latest.resize(vertex_count + 1, Self::SETTLED);
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        let key = Self::key(distance);
        debug_assert!(key >= self.last, "a radix heap is monotone");
        self.latest[v as usize] = key;
        self.file(key, v);
    }

    #[inline]
    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        loop {
            while let Some(core::cmp::Reverse(v)) = self.equal.pop() {
                let latest = &mut self.latest[v as usize];
                if *latest == self.last {
                    *latest = Self::SETTLED;
                    return Some((v, Weight::from_bits(self.last)));
                }
            }
            if !self.refill() {
                return None;
            }
        }
    }

    fn len(&self) -> usize {
        self.equal.len() + self.buckets.iter().map(Vec::len).sum::<usize>()
    }

    fn heap_bytes(&self) -> usize {
        self.buckets.capacity() * size_of::<Vec<(u64, Vertex)>>()
            + self
                .buckets
                .iter()
                .map(|bucket| bucket.capacity() * size_of::<(u64, Vertex)>())
                .sum::<usize>()
            + self.equal.capacity() * size_of::<core::cmp::Reverse<Vertex>>()
            + self.latest.capacity() * size_of::<u64>()
    }

    fn kind(&self) -> FrontierKind {
        FrontierKind::Radix
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        let mut equal: Vec<Vertex> = self.equal.iter().map(|r| r.0).collect();
        equal.sort_unstable();
        let filed = self
            .buckets
            .iter()
            .enumerate()
            .flat_map(|(b, bucket)| bucket.iter().map(move |&(key, v)| (b as u8, key, v)));
        equal
            .into_iter()
            .map(|v| (0, self.last, v))
            .chain(filed)
            .map(|(bucket, key, vertex)| FrontierEntry {
                vertex,
                estimate: Weight::from_bits(key),
                stale: self.latest[vertex as usize] != key,
                parent: None,
                bucket: Some(bucket),
            })
            .collect()
    }
}

/// What a [`Measured`] frontier saw during one run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrontierCounts {
    /// Calls to `decrease`: one per estimate that dropped, the first
    /// estimate of a vertex included. The same for every frontier, since
    /// they all settle in the same order.
    pub decreases: usize,
    /// Vertices popped, which are the vertices settled.
    pub pops: usize,
    /// The most entries the frontier held at once, stale ones included.
    pub peak_len: usize,
}

/// A frontier that counts what goes through another: the estimates it
/// receives, the vertices it gives back and the most entries it holds at
/// once. For measuring a strategy's memory, not for timing it, since every
/// pop reads [`len`](Frontier::len) first. [`reset`](Frontier::reset)
/// starts the counts again, so they describe the last run.
#[derive(Debug, Clone, Default)]
pub struct Measured<F> {
    inner: F,
    counts: FrontierCounts,
}

impl<F: Frontier> Measured<F> {
    /// Wraps `inner`, with every count at zero.
    pub fn new(inner: F) -> Self {
        Self {
            inner,
            counts: FrontierCounts::default(),
        }
    }

    /// The counts since the last [`reset`](Frontier::reset).
    pub fn counts(&self) -> FrontierCounts {
        self.counts
    }
}

impl<F: Frontier> Frontier for Measured<F> {
    fn reset(&mut self, vertex_count: usize) {
        self.inner.reset(vertex_count);
        self.counts = FrontierCounts::default();
    }

    #[inline]
    fn decrease(&mut self, v: Vertex, distance: Weight) {
        self.counts.decreases += 1;
        self.inner.decrease(v, distance);
    }

    #[inline]
    fn pop_min(&mut self) -> Option<(Vertex, Weight)> {
        // Entries only pile up between pops, so the largest size is the
        // one seen just before some pop.
        self.counts.peak_len = self.counts.peak_len.max(self.inner.len());
        let popped = self.inner.pop_min();
        self.counts.pops += usize::from(popped.is_some());
        popped
    }

    fn len(&self) -> usize {
        self.inner.len()
    }

    fn heap_bytes(&self) -> usize {
        self.inner.heap_bytes()
    }

    fn kind(&self) -> FrontierKind {
        self.inner.kind()
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        self.inner.entries()
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
    /// [`QuadHeapFrontier`]: an indexed 4-ary heap with decrease-key.
    QuadHeap,
    /// [`PairingHeapFrontier`]: a pairing heap with decrease-key.
    Pairing,
    /// [`RadixHeapFrontier`]: a monotone radix heap on the distances' bits.
    Radix,
}

impl FrontierKind {
    /// Every frontier, in the order they are usually reported.
    pub const ALL: [FrontierKind; 6] = [
        FrontierKind::Vector,
        FrontierKind::Heap,
        FrontierKind::LazyHeap,
        FrontierKind::QuadHeap,
        FrontierKind::Pairing,
        FrontierKind::Radix,
    ];

    /// Short identifier used on the command line (`vector`, `heap`,
    /// `lazy-heap`, `quad-heap`, `pairing`, `radix`).
    pub fn label(self) -> &'static str {
        match self {
            FrontierKind::Vector => "vector",
            FrontierKind::Heap => "heap",
            FrontierKind::LazyHeap => "lazy-heap",
            FrontierKind::QuadHeap => "quad-heap",
            FrontierKind::Pairing => "pairing",
            FrontierKind::Radix => "radix",
        }
    }

    /// Human readable name.
    pub fn name(self) -> &'static str {
        match self {
            FrontierKind::Vector => "vector of estimates",
            FrontierKind::Heap => "binary heap with decrease-key",
            FrontierKind::LazyHeap => "binary heap without decrease-key",
            FrontierKind::QuadHeap => "4-ary heap with decrease-key",
            FrontierKind::Pairing => "pairing heap with decrease-key",
            FrontierKind::Radix => "radix heap (monotone, by bits)",
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
            "quad-heap" | "quad_heap" | "quad" | "4-ary" => Ok(FrontierKind::QuadHeap),
            "pairing" | "pairing-heap" | "pairing_heap" => Ok(FrontierKind::Pairing),
            "radix" | "radix-heap" | "radix_heap" => Ok(FrontierKind::Radix),
            other => Err(format!(
                "unknown frontier {other:?} (expected vector, heap, lazy-heap, quad-heap, pairing or radix)"
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
        assert_eq!(drain(QuadHeapFrontier::default()), expected);
        assert_eq!(drain(PairingHeapFrontier::default()), expected);
        assert_eq!(drain(RadixHeapFrontier::default()), expected);
    }

    #[test]
    fn ties_go_to_the_smaller_vertex() {
        fn ties<F: Frontier>(mut frontier: F) {
            frontier.reset(10);
            for v in [9, 4, 6, 1, 10] {
                frontier.decrease(v, 2.5);
            }
            for expected in [1, 4, 6, 9, 10] {
                assert_eq!(
                    frontier.pop_min(),
                    Some((expected, 2.5)),
                    "{}",
                    frontier.kind()
                );
            }
        }
        ties(VectorFrontier::default());
        ties(HeapFrontier::default());
        ties(LazyHeapFrontier::default());
        ties(QuadHeapFrontier::default());
        ties(PairingHeapFrontier::default());
        ties(RadixHeapFrontier::default());
    }

    /// A long random Dijkstra-like sequence (pops never go below the last
    /// one, estimates only drop): every frontier pops what the binary heap
    /// pops.
    #[test]
    fn random_monotone_sequences_agree() {
        fn run<F: Frontier>(mut frontier: F, seed: u64) -> Vec<(Vertex, Weight)> {
            let n = 300;
            frontier.reset(n);
            let mut state = seed;
            let mut next = move || {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state
            };
            let mut best = vec![Weight::INFINITY; n + 1];
            let mut settled = vec![false; n + 1];
            let mut out = Vec::new();
            frontier.decrease(1, 0.0);
            best[1] = 0.0;
            while let Some((u, d)) = frontier.pop_min() {
                settled[u as usize] = true;
                out.push((u, d));
                for _ in 0..(next() % 6) {
                    let v = (next() % n as u64) as usize + 1;
                    // Weights from {0, 0.5, ..., 4}: zeros and ties on purpose.
                    let w = (next() % 9) as Weight / 2.0;
                    if !settled[v] && d + w < best[v] {
                        best[v] = d + w;
                        frontier.decrease(v as Vertex, d + w);
                    }
                }
            }
            out
        }
        for seed in 1..40 {
            let reference = run(HeapFrontier::default(), seed);
            assert_eq!(run(VectorFrontier::default(), seed), reference);
            assert_eq!(run(LazyHeapFrontier::default(), seed), reference);
            assert_eq!(run(QuadHeapFrontier::default(), seed), reference);
            assert_eq!(run(PairingHeapFrontier::default(), seed), reference);
            assert_eq!(run(RadixHeapFrontier::default(), seed), reference);
        }
    }

    #[test]
    fn entries_read_the_structure() {
        let ops = [
            (5, 4.0),
            (2, 9.0),
            (7, 4.0),
            (3, 1.5),
            (2, 3.0),
            (8, 0.5),
            (6, 6.0),
        ];
        let mut pairing = PairingHeapFrontier::new(8);
        let mut radix = RadixHeapFrontier::new(8);
        for (v, d) in ops {
            pairing.decrease(v, d);
            radix.decrease(v, d);
        }
        pairing.pop_min();
        radix.pop_min();
        // The pairing tree: every parent listed earlier, and no later.
        let tree = pairing.entries();
        assert_eq!(tree.len(), 5);
        assert_eq!(tree[0].parent, None);
        for (i, e) in tree.iter().enumerate().skip(1) {
            let p = e.parent.expect("only the root has no parent") as usize;
            assert!(p < i && !before((e.estimate, e.vertex), (tree[p].estimate, tree[p].vertex)));
        }
        // The radix buckets: ascending, the stale 9.0 of vertex 2 kept and flagged.
        let filed = radix.entries();
        assert!(filed.windows(2).all(|w| w[0].bucket <= w[1].bucket));
        assert!(
            filed
                .iter()
                .any(|e| e.vertex == 2 && e.estimate == 9.0 && e.stale)
        );
        assert_eq!(filed.iter().filter(|e| !e.stale).count(), 5);
    }

    #[test]
    fn measured_counts_what_goes_through() {
        fn run<F: Frontier>(frontier: F) -> Measured<F> {
            let mut measured = Measured::new(frontier);
            measured.reset(4);
            for (v, d) in [(1, 5.0), (2, 4.0), (1, 3.0), (3, 6.0)] {
                measured.decrease(v, d);
            }
            assert_eq!(measured.pop_min(), Some((1, 3.0)));
            measured.decrease(2, 3.5);
            while measured.pop_min().is_some() {}
            assert!(measured.is_empty(), "{}", measured.kind());
            measured
        }
        // Three vertices at most for a decrease-key frontier; four entries
        // for the two that push a lowered estimate again.
        for (measured, peak) in [
            (run(VectorFrontier::default()).counts(), 3),
            (run(HeapFrontier::default()).counts(), 3),
            (run(QuadHeapFrontier::default()).counts(), 3),
            (run(PairingHeapFrontier::default()).counts(), 3),
            (run(LazyHeapFrontier::default()).counts(), 4),
            (run(RadixHeapFrontier::default()).counts(), 4),
        ] {
            let expected = FrontierCounts {
                decreases: 5,
                pops: 3,
                peak_len: peak,
            };
            assert_eq!(measured, expected);
        }
        // One estimate per vertex slot, 0 to 4.
        assert_eq!(run(VectorFrontier::default()).heap_bytes(), 5 * 8);
        // At least three 16-byte entries, and the 4-byte index of each slot.
        assert!(run(HeapFrontier::default()).heap_bytes() >= 3 * 16 + 5 * 4);
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
