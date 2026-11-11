//! Johnson's algorithm: all pairs as one Bellman-Ford and `n` Dijkstras.
//!
//! One Bellman-Ford from every vertex at once ([`Start::Everywhere`]) gives
//! potentials `h` with `w(u, v) + h(u) − h(v) ≥ 0` on every arc. A
//! [`Reweighted`] view reads the graph with those weights (no copy of it), so
//! Dijkstra runs on it unchanged, over **any** Part 2 frontier, and
//! `d(u, v) = d'(u, v) − h(u) + h(v)`. Every path between two vertices
//! changes by the same `h(u) − h(v)`, so the shortest ones stay shortest.
//!
//! `O(nm log n)` with a heap against Floyd-Warshall's `n³`: on a sparse
//! graph, the honest third column of the course's question 4. It ties the
//! three parts together: Part 1's representations, Part 2's frontiers and
//! Part 3's Bellman-Ford.

use super::bellman_ford::{NegativeCycle, bellman_ford_into};
use super::floyd_warshall::{AllPairs, FloydError};
use super::frontier::{
    Frontier, FrontierKind, HeapFrontier, LazyHeapFrontier, PairingHeapFrontier, QuadHeapFrontier,
    RadixHeapFrontier, VectorFrontier,
};
use super::schedule::{ScheduleKind, Start};
use super::shortest_path::{ShortestPathTree, dijkstra_into};
use crate::graph::{
    Graph, MemoryBudget, NO_VERTEX, Representation, Vertex, Weight, Weighted, WeightedEdge,
};

/// Johnson's potentials: `h(v) = min(0, min over u of d(u, v))`, indexed by
/// vertex (index 0 unused), from one Bellman-Ford from every vertex at once;
/// the negative cycle instead, when there is one.
pub fn potentials<G: Weighted>(
    graph: &G,
    kind: ScheduleKind,
) -> Result<Vec<Weight>, NegativeCycle> {
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    bellman_ford_into(
        graph,
        Start::Everywhere,
        &mut kind.schedule(),
        &mut tree,
        &mut (),
    )?;
    let mut h = tree.distances_raw().to_vec();
    h[0] = 0.0;
    Ok(h)
}

/// A graph read with every arc reweighted by potentials:
/// `w'(u, v) = w(u, v) + h(u) − h(v)`, clamped at 0 against rounding.
///
/// With Johnson's potentials every `w'` is non-negative, so Dijkstra (which
/// refuses a negative arc) runs on the view as it is.
#[derive(Debug, Clone, Copy)]
pub struct Reweighted<'a, G> {
    graph: &'a G,
    potential: &'a [Weight],
}

impl<'a, G: Weighted> Reweighted<'a, G> {
    /// The view of `graph` under `potential` (indexed by vertex, `n + 1` long).
    pub fn new(graph: &'a G, potential: &'a [Weight]) -> Self {
        assert_eq!(potential.len(), graph.vertex_count() + 1);
        Self { graph, potential }
    }

    /// The original distance from `u` to `v` given the reweighted one.
    #[inline]
    pub fn original(&self, u: Vertex, v: Vertex, reweighted: Weight) -> Weight {
        reweighted - self.potential[u as usize] + self.potential[v as usize]
    }
}

impl<G: Weighted> Graph for Reweighted<'_, G> {
    type Neighbors<'b>
        = G::Neighbors<'b>
    where
        Self: 'b;

    fn vertex_count(&self) -> usize {
        self.graph.vertex_count()
    }

    fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }

    fn degree(&self, v: Vertex) -> usize {
        self.graph.degree(v)
    }

    #[inline]
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_> {
        self.graph.neighbors(v)
    }

    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        self.graph.has_edge(u, v)
    }

    fn is_directed(&self) -> bool {
        self.graph.is_directed()
    }

    /// The view owns nothing.
    fn heap_bytes(&self) -> usize {
        0
    }

    fn representation(&self) -> Representation {
        self.graph.representation()
    }
}

impl<G: Weighted> Weighted for Reweighted<'_, G> {
    type WeightedNeighbors<'b>
        = ReweightedRow<'b, G::WeightedNeighbors<'b>>
    where
        Self: 'b;

    #[inline]
    fn weighted_neighbors(&self, v: Vertex) -> Self::WeightedNeighbors<'_> {
        ReweightedRow {
            inner: self.graph.weighted_neighbors(v),
            from: self.potential[v as usize],
            potential: self.potential,
        }
    }

    fn is_weighted(&self) -> bool {
        true
    }

    /// None: the reweighted arcs are non-negative by construction.
    fn negative_edge(&self) -> Option<WeightedEdge> {
        None
    }

    /// None: a negative loop is a negative cycle, which leaves no potentials.
    fn negative_loops(&self) -> &[WeightedEdge] {
        &[]
    }
}

/// A row of a [`Reweighted`] graph.
#[derive(Debug, Clone)]
pub struct ReweightedRow<'a, I> {
    inner: I,
    from: Weight,
    potential: &'a [Weight],
}

impl<I: Iterator<Item = (Vertex, Weight)>> Iterator for ReweightedRow<'_, I> {
    type Item = (Vertex, Weight);

    #[inline]
    fn next(&mut self) -> Option<(Vertex, Weight)> {
        let (v, w) = self.inner.next()?;
        Some((v, (w + self.from - self.potential[v as usize]).max(0.0)))
    }
}

/// Johnson's algorithm with Dijkstra over the given frontier, into the
/// same [`AllPairs`] tables Floyd-Warshall fills (and within the same
/// memory budget, since they are `n²`).
///
/// ```
/// use graphman::{Build, Csr, EdgeList, FrontierKind, MemoryBudget, Orientation, algo};
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n2 1 1\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let all = algo::johnson(&graph, FrontierKind::Heap, MemoryBudget::Machine).unwrap();
/// assert_eq!(all.distance(3, 1), Some(-1.0));
/// assert_eq!(all.path(1, 2), Some(vec![1, 3, 2]));
/// ```
pub fn johnson<G: Weighted>(
    graph: &G,
    frontier: FrontierKind,
    budget: MemoryBudget,
) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    match frontier {
        FrontierKind::Vector => johnson_with(graph, &mut VectorFrontier::new(n), budget),
        FrontierKind::Heap => johnson_with(graph, &mut HeapFrontier::new(n), budget),
        FrontierKind::LazyHeap => johnson_with(graph, &mut LazyHeapFrontier::new(n), budget),
        FrontierKind::QuadHeap => johnson_with(graph, &mut QuadHeapFrontier::new(n), budget),
        FrontierKind::Pairing => johnson_with(graph, &mut PairingHeapFrontier::new(n), budget),
        FrontierKind::Radix => johnson_with(graph, &mut RadixHeapFrontier::new(n), budget),
    }
}

/// [`johnson`] with a caller-supplied frontier.
pub fn johnson_with<G: Weighted, F: Frontier>(
    graph: &G,
    frontier: &mut F,
    budget: MemoryBudget,
) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    let mut all = AllPairs::empty(n, budget)?;
    let h = potentials(graph, ScheduleKind::Queue)?;
    let view = Reweighted::new(graph, &h);
    let mut tree = ShortestPathTree::new(n);
    for u in 1..=n as Vertex {
        dijkstra_into(&view, u, frontier, &mut tree, &mut ())
            .expect("reweighted arcs are non-negative");
        let (distance, parent) = all.row_mut(u);
        for &v in tree.order() {
            let d = tree.distance(v).expect("settled");
            distance[v as usize - 1] = view.original(u, v, d);
            parent[v as usize - 1] = tree.parent(v).unwrap_or(NO_VERTEX);
        }
    }
    Ok(all)
}
