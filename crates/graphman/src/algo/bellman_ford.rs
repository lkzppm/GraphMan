//! Bellman-Ford: shortest paths with negative weights, written once over a
//! [`Schedule`], and the negative cycle as a certificate.
//!
//! [`bellman_ford_into`] is the whole algorithm. A [`Schedule`] says which
//! vertex to scan next; the driver relaxes its out-arcs, tells the schedule
//! which neighbours went down, and watches for negative cycles. The answer
//! is the [`ShortestPathTree`] Dijkstra builds, so everything that reads one
//! (paths, the tree file, the observatory) reads this too.
//!
//! **Negative cycles, one rule for every schedule.** Each estimate carries
//! the number of arcs of the walk behind it (`hops[w] = hops[v] + 1` when
//! `v` lowers `w`). Relaxations are strict, and a vertex's estimates only
//! ever go down, so if that walk repeats a vertex `x`, the stretch between
//! the two visits took `x` below an estimate it already had: it is a cycle
//! of negative weight. Without one every walk is a simple path and `hops`
//! stays below `n`; the first time it reaches `n`, a negative cycle reaches
//! the start. The cycle is then read off the parent pointers (every cycle of
//! the parent graph has negative weight, Cherkassky and Goldberg 1999) and
//! returned, not just flagged: a [`NegativeCycle`] the caller can check.
//!
//! **Distances to a target.** The course asks for the distance from every
//! vertex *to* one vertex. That is Bellman-Ford *from* it on the transpose,
//! where each arc is reversed: [`bellman_ford_to`]. The tree's parents are
//! then successors toward the target, and [`ShortestPathTree::path_from`]
//! reads a path forward.

use super::schedule::{Schedule, ScheduleKind, Start};
use super::shortest_path::ShortestPathTree;
use super::traversal::Visitor;
use crate::graph::{Build, BuildError, NO_VERTEX, Vertex, Weight, Weighted};
use core::fmt;

/// A cycle of negative total weight: the reason there is no shortest path.
///
/// `cycle` lists its vertices in arc order, starting at its smallest vertex:
/// `cycle[0] → cycle[1] → … → cycle[k - 1] → cycle[0]`. A negative
/// self-loop is the cycle `[v]`; on an undirected graph a negative edge
/// `{u, v}` is the cycle `[u, v]`, the edge walked there and back.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NegativeCycle {
    /// The vertices, in arc order, smallest first.
    pub cycle: Vec<Vertex>,
    /// The sum of the weights of its arcs (negative).
    pub weight: Weight,
}

impl NegativeCycle {
    /// A cycle from vertices in arc order, rotated to start at its smallest.
    pub fn new(mut cycle: Vec<Vertex>, weight: Weight) -> Self {
        if let Some(smallest) = (0..cycle.len()).min_by_key(|&i| cycle[i]) {
            cycle.rotate_left(smallest);
        }
        Self { cycle, weight }
    }

    /// Its arcs `(u, v)` in order, the last one closing the cycle.
    pub fn arcs(&self) -> impl Iterator<Item = (Vertex, Vertex)> + '_ {
        let k = self.cycle.len();
        (0..k).map(move |i| (self.cycle[i], self.cycle[(i + 1) % k]))
    }

    /// The same cycle with every arc reversed: a cycle of the transpose read
    /// in the original graph.
    pub fn reversed(mut self) -> Self {
        self.cycle.reverse();
        Self::new(self.cycle, self.weight)
    }

    /// Number of arcs.
    pub fn len(&self) -> usize {
        self.cycle.len()
    }

    /// Never true: a cycle has at least one arc.
    pub fn is_empty(&self) -> bool {
        self.cycle.is_empty()
    }
}

impl fmt::Display for NegativeCycle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "negative cycle ")?;
        for v in &self.cycle {
            write!(f, "{v} -> ")?;
        }
        match self.cycle.first() {
            Some(first) => write!(f, "{first} of weight {}", self.weight),
            None => write!(f, "of weight {}", self.weight),
        }
    }
}

/// Why [`bellman_ford_to`] has no answer.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum BellmanFordError {
    /// A negative cycle reaches the target (or the start).
    #[error(transparent)]
    NegativeCycle(#[from] NegativeCycle),
    /// The transpose did not fit in memory.
    #[error("building the transpose: {0}")]
    Transpose(#[from] BuildError),
}

/// Bellman-Ford from `root` with a schedule of the given kind.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, Orientation, algo::{self, ScheduleKind}};
/// // 1 → 2 costs 4, but 1 → 3 → 2 costs 3 - 2 = 1: a negative arc, no cycle.
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let tree = algo::bellman_ford(&graph, 1, ScheduleKind::Queue).unwrap();
/// assert_eq!(tree.distance(2), Some(1.0));
/// assert_eq!(tree.path_to(2), Some(vec![1, 3, 2]));
/// ```
pub fn bellman_ford<G: Weighted>(
    graph: &G,
    root: Vertex,
    kind: ScheduleKind,
) -> Result<ShortestPathTree, NegativeCycle> {
    bellman_ford_with(graph, root, &mut kind.schedule(), &mut ())
}

/// Bellman-Ford from `root` with a caller-supplied schedule, reporting to
/// `visitor`.
pub fn bellman_ford_with<G: Weighted, S: Schedule, V: Visitor>(
    graph: &G,
    root: Vertex,
    schedule: &mut S,
    visitor: &mut V,
) -> Result<ShortestPathTree, NegativeCycle> {
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    bellman_ford_into(graph, Start::Vertex(root), schedule, &mut tree, visitor)?;
    Ok(tree)
}

/// The distance from every vertex to `target`, and the tree of shortest
/// paths toward it: Bellman-Ford from `target` on the transpose (on the
/// graph itself when it is undirected).
///
/// The tree's root is `target`, `distance(v)` is `d(v, target)`, `parent(v)`
/// is the vertex after `v` on its shortest path, and
/// [`path_from`](ShortestPathTree::path_from)`(v)` is the path. A negative
/// cycle from which `target` can be reached comes back in the graph's own
/// orientation.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, Orientation, algo::{self, ScheduleKind}};
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let toward_2 = algo::bellman_ford_to(&graph, 2, ScheduleKind::Queue).unwrap();
/// assert_eq!(toward_2.distance(1), Some(1.0));
/// assert_eq!(toward_2.path_from(1), Some(vec![1, 3, 2]));
/// assert_eq!(toward_2.distance(3), Some(-2.0));
/// ```
pub fn bellman_ford_to<G: Build>(
    graph: &G,
    target: Vertex,
    kind: ScheduleKind,
) -> Result<ShortestPathTree, BellmanFordError> {
    let transpose;
    let reverse = match graph.is_directed() {
        true => {
            transpose = graph.transpose()?;
            &transpose
        }
        false => graph,
    };
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    bellman_ford_to_into(reverse, target, &mut kind.schedule(), &mut tree, &mut ())?;
    Ok(tree)
}

/// [`bellman_ford_to`] on a transpose built once by the caller (`reverse`:
/// the transpose of the graph, or the graph itself when undirected), into a
/// reusable tree. The 10-run timings and the all-pairs study use this, so
/// the transpose is built once, like the representation.
pub fn bellman_ford_to_into<G: Weighted, S: Schedule, V: Visitor>(
    reverse: &G,
    target: Vertex,
    schedule: &mut S,
    tree: &mut ShortestPathTree,
    visitor: &mut V,
) -> Result<(), NegativeCycle> {
    bellman_ford_into(reverse, Start::Vertex(target), schedule, tree, visitor).map_err(|cycle| {
        match reverse.is_directed() {
            true => cycle.reversed(),
            false => cycle,
        }
    })
}

/// A negative cycle anywhere in the graph, or `None`: Bellman-Ford from
/// every vertex at once ([`Start::Everywhere`]).
pub fn negative_cycle<G: Weighted>(graph: &G, kind: ScheduleKind) -> Option<NegativeCycle> {
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    bellman_ford_into(
        graph,
        Start::Everywhere,
        &mut kind.schedule(),
        &mut tree,
        &mut (),
    )
    .err()
}

/// Bellman-Ford into a reusable tree: the one implementation every schedule
/// runs.
///
/// The schedule hands out vertices; each reached one has its out-arcs
/// relaxed, and every strictly better estimate is recorded (estimate,
/// parent, hops), reported to `visitor` ([`Visitor::relax`]) and to the
/// schedule ([`Schedule::lowered`]). The run ends when the schedule has
/// nothing left, with every reached vertex final, or as soon as a negative
/// cycle reachable from the start is found, which is returned (the tree is
/// then left empty, like a refused Dijkstra's).
///
/// With [`Start::Everywhere`] the tree has no root and its distances are
/// `min(0, min over u of d(u, v))`, Johnson's potentials.
pub fn bellman_ford_into<G: Weighted, S: Schedule, V: Visitor>(
    graph: &G,
    start: Start,
    schedule: &mut S,
    tree: &mut ShortestPathTree,
    visitor: &mut V,
) -> Result<(), NegativeCycle> {
    let n = graph.vertex_count();
    if tree.hops.len() != n + 1 {
        tree.hops = vec![0; n + 1];
    }
    match start {
        Start::Vertex(root) => tree.begin(root),
        Start::Everywhere => tree.begin_everywhere(),
    }
    schedule.reset(n, start);
    let directed = graph.is_directed();
    let mut cycles = CycleFinder::default();
    let mut passes = schedule.passes();
    while let Some(v) = schedule.next() {
        report_passes(schedule, &mut passes, visitor);
        let distance = tree.distance[v as usize];
        if distance == Weight::INFINITY {
            continue;
        }
        visitor.scan(v, distance);
        let hops = tree.hops[v as usize] + 1;
        for (w, weight) in graph.weighted_neighbors(v) {
            if weight < 0.0 && !directed {
                // An edge reads both ways: walking it there and back is a
                // negative cycle of two arcs, and `v` is reached.
                tree.reset();
                return Err(NegativeCycle::new(vec![v, w], 2.0 * weight));
            }
            let through = distance + weight;
            let estimate = tree.distance[w as usize];
            if through < estimate {
                if estimate == Weight::INFINITY {
                    tree.touched.push(w);
                }
                tree.distance[w as usize] = through;
                tree.parent[w as usize] = v;
                tree.hops[w as usize] = hops;
                visitor.relax(w, v, estimate, through);
                if hops as usize >= n
                    && let Some(cycle) = cycles.find(graph, tree, w)
                {
                    tree.reset();
                    return Err(cycle);
                }
                // Every `n` improvements, look for a cycle anywhere in the
                // parent graph: a short negative cycle shows up there long
                // before any walk around it reaches `n` arcs.
                if cycles.lowered(n)
                    && let Some(cycle) = cycles.sweep(graph, tree)
                {
                    tree.reset();
                    return Err(cycle);
                }
                schedule.lowered(w, &tree.distance);
            }
        }
    }
    report_passes(schedule, &mut passes, visitor);
    // A negative loop is a cycle of one arc, kept beside the adjacency.
    if let Some(edge) = graph
        .negative_loops()
        .iter()
        .find(|edge| tree.distance[edge.u as usize] != Weight::INFINITY)
    {
        let cycle = NegativeCycle::new(vec![edge.u], edge.weight);
        tree.reset();
        return Err(cycle);
    }
    tree.settle_touched();
    Ok(())
}

/// Tells the visitor about every pass the schedule finished since the last call.
fn report_passes<S: Schedule, V: Visitor>(schedule: &S, seen: &mut usize, visitor: &mut V) {
    while *seen < schedule.passes() {
        *seen += 1;
        visitor.pass_complete(*seen);
    }
}

/// Reads a negative cycle off the parent pointers: once a walk of `n` arcs
/// shows there is one (`find`), and every `n` improvements anywhere in the
/// parent graph (`sweep`, Cherkassky and Goldberg's amortised search), so a
/// short cycle is caught after `O(n)` improvements instead of waiting for a
/// walk around it to reach `n` arcs. A sweep costs `O(n)` once every `n`
/// improvements: `O(1)` each, so the bound stays `O(nm)`.
#[derive(Default)]
struct CycleFinder {
    /// The walk that last visited each vertex; walks are numbered from 1 and
    /// never reused, so one sweep tells its own walks from older ones.
    stamp: Vec<u64>,
    attempt: u64,
    /// Improvements to wait before the next `find`.
    wait: usize,
    /// Improvements since the last sweep.
    since_sweep: usize,
}

impl CycleFinder {
    /// Follows parents from `w`. A repeated vertex closes a cycle of the
    /// parent graph, which has negative weight. The parents may still lead
    /// back to the start when the walk that reached `n` arcs has since been
    /// cut by a better estimate; then the run goes on (the estimates around
    /// the cycle keep falling, so the parent graph closes it eventually) and
    /// the next `n` calls return at once, which keeps the walks at `O(1)`
    /// per call.
    fn find<G: Weighted>(
        &mut self,
        graph: &G,
        tree: &ShortestPathTree,
        w: Vertex,
    ) -> Option<NegativeCycle> {
        let n = graph.vertex_count();
        if self.wait > 0 {
            self.wait -= 1;
            return None;
        }
        if self.stamp.is_empty() {
            self.stamp = vec![0; n + 1];
        }
        self.attempt += 1;
        let mut at = w;
        while at != NO_VERTEX && self.stamp[at as usize] != self.attempt {
            self.stamp[at as usize] = self.attempt;
            at = tree.parent[at as usize];
        }
        if at == NO_VERTEX {
            self.wait = n;
            return None;
        }
        let cycle = read_cycle(graph, tree, at);
        if cycle.is_none() {
            self.wait = n;
        }
        cycle
    }

    /// Counts an improvement; true when a sweep is due (every `n`).
    fn lowered(&mut self, n: usize) -> bool {
        self.since_sweep += 1;
        if self.since_sweep < n.max(1) {
            return false;
        }
        self.since_sweep = 0;
        true
    }

    /// Looks for a cycle anywhere in the parent graph, `O(n)`: a walk up the
    /// parents from each vertex stops at a root, at a vertex an earlier walk
    /// of this sweep already cleared, or at one of its own vertices, which
    /// closes a cycle (negative, as every cycle of the parent graph is).
    fn sweep<G: Weighted>(&mut self, graph: &G, tree: &ShortestPathTree) -> Option<NegativeCycle> {
        let n = graph.vertex_count();
        if self.stamp.is_empty() {
            self.stamp = vec![0; n + 1];
        }
        let first = self.attempt + 1;
        for v in 1..=n as Vertex {
            if self.stamp[v as usize] >= first || tree.parent[v as usize] == NO_VERTEX {
                continue;
            }
            self.attempt += 1;
            let mut at = v;
            while at != NO_VERTEX && self.stamp[at as usize] < first {
                self.stamp[at as usize] = self.attempt;
                at = tree.parent[at as usize];
            }
            if at != NO_VERTEX
                && self.stamp[at as usize] == self.attempt
                && let Some(cycle) = read_cycle(graph, tree, at)
            {
                return Some(cycle);
            }
        }
        None
    }
}

/// The cycle of the parent graph through `at`, in arc order, with its
/// weight; `None` if rounding left it at zero or above, which no exact sum
/// would (the run then goes on, and a real cycle keeps falling).
fn read_cycle<G: Weighted>(
    graph: &G,
    tree: &ShortestPathTree,
    at: Vertex,
) -> Option<NegativeCycle> {
    // `at` is on the cycle; its parents go round it backwards.
    let mut cycle = vec![at];
    let mut previous = tree.parent[at as usize];
    while previous != at {
        cycle.push(previous);
        previous = tree.parent[previous as usize];
    }
    cycle.reverse();
    let k = cycle.len();
    let weight = (0..k)
        .map(|i| {
            graph
                .weight(cycle[i], cycle[(i + 1) % k])
                .expect("a parent is joined to its child by an arc")
        })
        .sum();
    (weight < 0.0).then(|| NegativeCycle::new(cycle, weight))
}
