//! Shortest paths on weighted graphs: Dijkstra's algorithm, written once.
//!
//! [`dijkstra_into`] is the whole algorithm. How the tentative distances
//! are stored, lowered and the closest one found is a [`Frontier`], chosen
//! by the caller; the answer is a [`ShortestPathTree`], the weighted twin of
//! the BFS [`SearchTree`](super::SearchTree), and the progress is reported
//! to the same [`Visitor`] the traversals use.

use super::frontier::{Frontier, FrontierKind, HeapFrontier, LazyHeapFrontier, VectorFrontier};
use super::traversal::{Control, Visitor};
use crate::graph::{NO_VERTEX, Vertex, Weight, Weighted, WeightedEdge};
use std::io::{self, Write};

/// Dijkstra was asked to run on a graph with a negative edge.
///
/// In an undirected graph one negative edge `{u, v}` already makes the walk
/// `u v u v ...` as short as one likes, so there is no shortest path to
/// report; the library says so instead of returning a wrong answer.
#[derive(Debug, Clone, Copy, PartialEq, thiserror::Error)]
#[error(
    "edge {}-{} has the negative weight {}: shortest paths with negative weights are not implemented yet",
    .edge.u, .edge.v, .edge.weight
)]
pub struct NegativeWeight {
    /// The first negative edge of the graph, in `[min, max]` order.
    pub edge: WeightedEdge,
}

/// The tree a Dijkstra run produces: the distance from the root to every
/// settled vertex, the parent on a shortest path, and the settle order.
///
/// Like [`SearchTree`](super::SearchTree) it is reusable: [`reset`](Self::reset)
/// only touches the vertices the previous run reached, so `k` runs from
/// different roots on a graph with millions of vertices allocate nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortestPathTree {
    root: Vertex,
    parent: Vec<Vertex>,
    /// Tentative while a run is in progress, final once settled; `+∞` when unreached.
    distance: Vec<Weight>,
    /// Settled vertices, in the order they left the frontier.
    order: Vec<Vertex>,
    /// Every vertex that received an estimate, settled or not.
    touched: Vec<Vertex>,
    /// One bit per vertex, set when settled.
    settled: Vec<u64>,
}

impl ShortestPathTree {
    /// An empty tree for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        Self {
            root: NO_VERTEX,
            parent: vec![NO_VERTEX; vertex_count + 1],
            distance: vec![Weight::INFINITY; vertex_count + 1],
            order: Vec::with_capacity(vertex_count),
            touched: Vec::with_capacity(vertex_count),
            settled: vec![0u64; (vertex_count + 1).div_ceil(64)],
        }
    }

    #[inline(always)]
    fn is_settled(&self, v: Vertex) -> bool {
        self.settled[(v >> 6) as usize] & (1u64 << (v & 63)) != 0
    }

    /// Number of vertices of the underlying graph.
    pub fn vertex_count(&self) -> usize {
        self.distance.len() - 1
    }

    /// The source of the last run (`NO_VERTEX` if none).
    pub fn root(&self) -> Vertex {
        self.root
    }

    /// Distance from the root to `v`; `None` if `v` was not reached.
    #[inline]
    pub fn distance(&self, v: Vertex) -> Option<Weight> {
        self.is_settled(v).then(|| self.distance[v as usize])
    }

    /// Parent of `v` on its shortest path; `None` for the root and for
    /// unreached vertices.
    #[inline]
    pub fn parent(&self, v: Vertex) -> Option<Vertex> {
        match self.parent[v as usize] {
            p if p != NO_VERTEX && self.is_settled(v) => Some(p),
            _ => None,
        }
    }

    /// Whether the run reached (settled) `v`.
    #[inline]
    pub fn is_reached(&self, v: Vertex) -> bool {
        self.is_settled(v)
    }

    /// Settled vertices in settle order: by non-decreasing distance.
    pub fn order(&self) -> &[Vertex] {
        &self.order
    }

    /// Number of settled vertices.
    pub fn reached_count(&self) -> usize {
        self.order.len()
    }

    /// The last settled vertex and its distance: after a complete run, a
    /// vertex farthest from the root (the root's weighted eccentricity).
    pub fn last_settled(&self) -> (Vertex, Weight) {
        let v = *self.order.last().expect("a run always settles its root");
        (v, self.distance[v as usize])
    }

    /// The shortest path from the root to `v` (both included), or `None` if
    /// `v` was not reached.
    pub fn path_to(&self, v: Vertex) -> Option<Vec<Vertex>> {
        if !self.is_settled(v) {
            return None;
        }
        let mut path = vec![v];
        let mut at = v;
        while let Some(p) = self.parent(at) {
            path.push(p);
            at = p;
        }
        path.reverse();
        Some(path)
    }

    /// Raw parent array indexed by vertex (`NO_VERTEX` = none). Only settled
    /// vertices have entries once a run is over.
    pub fn parents_raw(&self) -> &[Vertex] {
        &self.parent
    }

    /// Raw distance array indexed by vertex (`+∞` = unreached). Only settled
    /// vertices have finite entries once a run is over.
    pub fn distances_raw(&self) -> &[Weight] {
        &self.distance
    }

    /// Forgets the previous run in `O(reached)` time.
    pub fn reset(&mut self) {
        for &v in &self.touched {
            self.distance[v as usize] = Weight::INFINITY;
            self.parent[v as usize] = NO_VERTEX;
            self.settled[(v >> 6) as usize] = 0;
        }
        self.touched.clear();
        self.order.clear();
        self.root = NO_VERTEX;
    }

    fn begin(&mut self, root: Vertex) {
        assert!(
            root >= 1 && (root as usize) < self.distance.len(),
            "vertex {root} is outside 1..={}",
            self.vertex_count()
        );
        self.reset();
        self.root = root;
        self.distance[root as usize] = 0.0;
        self.touched.push(root);
    }

    /// Drops the estimates of vertices that were reached but not settled
    /// when a run stopped early, so that the raw arrays only hold answers.
    fn discard_tentative(&mut self) {
        for i in 0..self.touched.len() {
            let v = self.touched[i];
            if !self.is_settled(v) {
                self.distance[v as usize] = Weight::INFINITY;
                self.parent[v as usize] = NO_VERTEX;
            }
        }
    }

    /// Writes `vertex parent distance` per line, like the search trees: the
    /// root's parent is `0`; unreached vertices get `- -`.
    pub fn write_to<W: Write>(&self, w: W) -> io::Result<()> {
        let mut w = io::BufWriter::new(w);
        writeln!(w, "# root {}", self.root)?;
        writeln!(w, "# vertex parent distance")?;
        for v in 1..self.distance.len() as Vertex {
            match self.distance(v) {
                None => writeln!(w, "{v} - -")?,
                Some(d) => writeln!(w, "{v} {} {d}", self.parent[v as usize])?,
            }
        }
        w.flush()
    }
}

/// Dijkstra from `root` with the frontier of the given kind.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, algo::{self, FrontierKind}};
/// let edges = EdgeList::parse(b"3\n1 2 0.5\n2 3 0.25\n1 3 1\n").unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let tree = algo::dijkstra(&graph, 1, FrontierKind::Heap).unwrap();
/// assert_eq!(tree.distance(3), Some(0.75));
/// assert_eq!(tree.path_to(3), Some(vec![1, 2, 3]));
/// ```
pub fn dijkstra<G: Weighted>(
    graph: &G,
    root: Vertex,
    frontier: FrontierKind,
) -> Result<ShortestPathTree, NegativeWeight> {
    let n = graph.vertex_count();
    match frontier {
        FrontierKind::Vector => dijkstra_with(graph, root, &mut VectorFrontier::new(n), &mut ()),
        FrontierKind::Heap => dijkstra_with(graph, root, &mut HeapFrontier::new(n), &mut ()),
        FrontierKind::LazyHeap => {
            dijkstra_with(graph, root, &mut LazyHeapFrontier::new(n), &mut ())
        }
    }
}

/// Dijkstra from `root` with a caller-supplied frontier, reporting every
/// settled vertex to `visitor` ([`Visitor::settle`]).
pub fn dijkstra_with<G: Weighted, F: Frontier, V: Visitor>(
    graph: &G,
    root: Vertex,
    frontier: &mut F,
    visitor: &mut V,
) -> Result<ShortestPathTree, NegativeWeight> {
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    dijkstra_into(graph, root, frontier, &mut tree, visitor)?;
    Ok(tree)
}

/// Dijkstra's algorithm into a reusable tree: the one implementation every
/// frontier runs.
///
/// Settles the frontier's closest vertex, then relaxes its edges: a
/// neighbour whose distance through it is strictly smaller gets the new
/// estimate and parent. Weights are non-negative (the graph is refused
/// otherwise), so a settled vertex can never be improved and needs no check;
/// the strict comparison keeps the first parent found, and together with the
/// frontiers' tie-breaking makes the tree identical for every frontier.
///
/// A visitor that returns [`Control::Break`] from `settle` stops the run;
/// the tree then holds exactly the vertices settled so far.
pub fn dijkstra_into<G: Weighted, F: Frontier, V: Visitor>(
    graph: &G,
    root: Vertex,
    frontier: &mut F,
    tree: &mut ShortestPathTree,
    visitor: &mut V,
) -> Result<(), NegativeWeight> {
    if let Some(edge) = graph.negative_edge() {
        return Err(NegativeWeight { edge });
    }
    tree.begin(root);
    frontier.reset(graph.vertex_count());
    frontier.decrease(root, 0.0);
    while let Some((v, distance)) = frontier.pop_min() {
        tree.settled[(v >> 6) as usize] |= 1u64 << (v & 63);
        tree.order.push(v);
        if visitor.settle(v, tree.parent[v as usize], distance) == Control::Break {
            tree.discard_tentative();
            return Ok(());
        }
        for (w, weight) in graph.weighted_neighbors(v) {
            let through_v = distance + weight;
            let estimate = &mut tree.distance[w as usize];
            if through_v < *estimate {
                if *estimate == Weight::INFINITY {
                    tree.touched.push(w);
                }
                *estimate = through_v;
                tree.parent[w as usize] = v;
                frontier.decrease(w, through_v);
            }
        }
    }
    Ok(())
}

/// A shortest path between two vertices.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Path {
    /// Sum of the weights along the path.
    pub distance: Weight,
    /// The vertices from the source to the target, both included.
    pub vertices: Vec<Vertex>,
}

impl Path {
    /// Number of edges on the path.
    pub fn hops(&self) -> usize {
        self.vertices.len().saturating_sub(1)
    }
}

/// Stops a Dijkstra run once `target` is settled.
struct SettleUntil(Vertex);

impl Visitor for SettleUntil {
    #[inline]
    fn settle(&mut self, v: Vertex, _parent: Vertex, _distance: Weight) -> Control {
        match v == self.0 {
            true => Control::Break,
            false => Control::Continue,
        }
    }
}

/// The shortest path from `source` to `target` (heap frontier, stopping as
/// soon as `target` is settled); `None` if they are in different components.
pub fn shortest_path<G: Weighted>(
    graph: &G,
    source: Vertex,
    target: Vertex,
) -> Result<Option<Path>, NegativeWeight> {
    let n = graph.vertex_count();
    let mut tree = ShortestPathTree::new(n);
    shortest_path_into(graph, source, target, &mut HeapFrontier::new(n), &mut tree)
}

/// [`shortest_path`] with a reusable frontier and tree.
pub fn shortest_path_into<G: Weighted, F: Frontier>(
    graph: &G,
    source: Vertex,
    target: Vertex,
    frontier: &mut F,
    tree: &mut ShortestPathTree,
) -> Result<Option<Path>, NegativeWeight> {
    dijkstra_into(graph, source, frontier, tree, &mut SettleUntil(target))?;
    Ok(tree.path_to(target).map(|vertices| Path {
        distance: tree.distance[target as usize],
        vertices,
    }))
}
