//! Graph representations and the [`Graph`] trait every algorithm is written against.
//!
//! | Representation | Memory | `neighbors(v)` | `has_edge(u, v)` |
//! |---|---|---|---|
//! | [`AdjacencyList`] | `O(n + m)` words, one heap block per vertex | `O(deg v)` | `O(log deg u)` |
//! | [`Csr`] | `O(n + m)` words, two contiguous blocks | `O(deg v)` | `O(log deg u)` |
//! | [`AdjacencyMatrix`] | `O(n²)` **bits** | `O(n / 64)` words | `O(1)` |
//!
//! All three keep neighbours in ascending order, so every algorithm produces
//! bit-for-bit identical results regardless of the representation chosen.
//!
//! Direction is data, not a type: a graph built from an [`EdgeList`] parsed
//! as [`Orientation::Directed`] stores each line `u v` as the arc `u → v`
//! only, [`Graph::neighbors`] yields out-neighbours and
//! [`Graph::is_directed`] says which kind it is, so every algorithm written
//! against [`Graph`] runs on both. [`Build::transpose`] gives the same
//! representation with every arc reversed, for the algorithms that need
//! in-arcs (Bellman-Ford to a target).
//!
//! Weights are a column beside the adjacency, never inside it: a weighted
//! [`Csr`] or [`AdjacencyList`] keeps one [`Weight`] per neighbour in a
//! parallel array, a weighted [`AdjacencyMatrix`] keeps an `n × n` table
//! beside its bitset. [`Graph`] never reads that column, so BFS and DFS run
//! on a weighted graph exactly as fast as on the same graph without weights,
//! and [`Weighted`] reads it, answering `1` for every edge of an unweighted
//! graph: hop counts are the special case where every weight is one.

mod adjacency_list;
mod adjacency_matrix;
mod csr;

pub use adjacency_list::AdjacencyList;
pub use adjacency_matrix::{AdjacencyMatrix, BitRow, WeightedBitRow};
pub use csr::Csr;

use crate::io::EdgeList;
use crate::metrics::memory;
use core::fmt;
use core::str::FromStr;

/// A vertex identifier. Vertices are numbered `1..=n` exactly as in the input
/// file; `0` is never a vertex and is used as [`NO_VERTEX`].
pub type Vertex = u32;

/// Sentinel meaning "no vertex" (e.g. the parent of a search-tree root).
pub const NO_VERTEX: Vertex = 0;

/// An edge weight: any finite real number, as in the course's weighted files.
pub type Weight = f64;

/// The weight every edge of an unweighted graph has.
pub const UNIT_WEIGHT: Weight = 1.0;

/// An edge `{u, v}` and its weight, or on a directed graph the arc `u → v`.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WeightedEdge {
    /// The smaller endpoint of an edge, the tail of an arc.
    pub u: Vertex,
    /// The larger endpoint of an edge, the head of an arc.
    pub v: Vertex,
    /// The weight of the edge.
    pub weight: Weight,
}

/// Whether each line `u v` of a file is the edge `{u, v}` or the arc `u → v`.
///
/// The file format does not say: the user does (the course's Part 3 asks
/// for "a parameter, given by the user, that says whether the graph is
/// directed"). Parts 1 and 2 are undirected, the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum Orientation {
    /// Each line is an edge, readable both ways.
    #[default]
    Undirected,
    /// Each line is an arc from its first vertex to its second.
    Directed,
}

impl Orientation {
    /// `Directed` when `directed` is true.
    pub fn from_directed(directed: bool) -> Self {
        match directed {
            true => Orientation::Directed,
            false => Orientation::Undirected,
        }
    }

    /// Whether this is [`Orientation::Directed`].
    pub fn is_directed(self) -> bool {
        self == Orientation::Directed
    }

    /// `undirected` or `directed`.
    pub fn label(self) -> &'static str {
        match self {
            Orientation::Undirected => "undirected",
            Orientation::Directed => "directed",
        }
    }
}

impl fmt::Display for Orientation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// Read-only view of a graph, undirected or directed.
///
/// The trait is deliberately tiny: a handful of accessors are enough to write
/// every algorithm in [`crate::algo`], and being generic (rather than
/// trait-object based) lets the compiler specialise each algorithm for each
/// storage strategy at zero runtime cost.
///
/// On a directed graph every accessor reads the arcs leaving a vertex:
/// [`neighbors`](Self::neighbors) are the out-neighbours,
/// [`degree`](Self::degree) is the out-degree and
/// [`edge_count`](Self::edge_count) counts arcs. A search written against
/// the trait therefore follows the arcs, with no change to its code.
pub trait Graph {
    /// Iterator over the neighbours of a vertex, in ascending order.
    type Neighbors<'a>: Iterator<Item = Vertex>
    where
        Self: 'a;

    /// Number of vertices `n`.
    fn vertex_count(&self) -> usize;

    /// Number of (unique, loop-free) edges `m`; arcs on a directed graph.
    fn edge_count(&self) -> usize;

    /// Degree of `v`; its out-degree on a directed graph.
    fn degree(&self, v: Vertex) -> usize;

    /// Neighbours of `v` in ascending order; its out-neighbours (the heads
    /// of the arcs leaving it) on a directed graph.
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_>;

    /// Whether the edge `{u, v}` (the arc `u → v` when directed) exists.
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        self.neighbors(u).any(|w| w == v)
    }

    /// Whether the graph was built from arcs ([`Orientation::Directed`]).
    fn is_directed(&self) -> bool;

    /// The orientation the graph was built with.
    fn orientation(&self) -> Orientation {
        Orientation::from_directed(self.is_directed())
    }

    /// All vertices, `1..=n`.
    fn vertices(&self) -> core::ops::RangeInclusive<Vertex> {
        1..=self.vertex_count() as Vertex
    }

    /// Bytes owned on the heap by this representation (the "accounted"
    /// memory, as opposed to the process RSS measured by [`memory`]).
    fn heap_bytes(&self) -> usize;

    /// Which storage strategy this is.
    fn representation(&self) -> Representation;
}

/// Edge weights, read beside the adjacency.
///
/// Every representation implements it. A graph built from a file without a
/// weight column answers [`UNIT_WEIGHT`] for every edge, so a weighted
/// algorithm (Dijkstra) run on it computes hop counts, the same distances
/// as BFS.
pub trait Weighted: Graph {
    /// Iterator over `(neighbour, weight)` pairs, neighbours ascending.
    type WeightedNeighbors<'a>: Iterator<Item = (Vertex, Weight)>
    where
        Self: 'a;

    /// The neighbours of `v` with the weights of the edges to them, in the
    /// same ascending order as [`Graph::neighbors`].
    fn weighted_neighbors(&self, v: Vertex) -> Self::WeightedNeighbors<'_>;

    /// Whether the weights came from the input (`false`: every edge weighs 1).
    fn is_weighted(&self) -> bool;

    /// The weight of the edge `{u, v}`, if it exists.
    fn weight(&self, u: Vertex, v: Vertex) -> Option<Weight> {
        self.weighted_neighbors(u)
            .find(|&(w, _)| w == v)
            .map(|(_, weight)| weight)
    }

    /// The first edge (in sorted order: `[min, max]`, or `(tail, head)` when
    /// directed) with a negative weight, found once when the graph was
    /// parsed. Algorithms that need non-negative weights (Dijkstra) check it
    /// in `O(1)` and refuse the graph.
    fn negative_edge(&self) -> Option<WeightedEdge>;

    /// The self-loops with a negative weight, one per vertex (its smallest),
    /// by vertex, each as `u == v`. Loops are not part of the adjacency (a
    /// loop of weight `≥ 0` never shortens a walk), but a negative one is a
    /// negative cycle of one arc, which Bellman-Ford and Floyd-Warshall
    /// report.
    fn negative_loops(&self) -> &[WeightedEdge];
}

/// Iterator over a row of targets and the parallel row of weights (empty
/// when the graph is unweighted, in which case every weight is one).
#[derive(Debug, Clone)]
pub struct WeightedRow<'a> {
    targets: core::slice::Iter<'a, Vertex>,
    weights: core::slice::Iter<'a, Weight>,
}

impl<'a> WeightedRow<'a> {
    pub(crate) fn new(targets: &'a [Vertex], weights: &'a [Weight]) -> Self {
        debug_assert!(weights.is_empty() || weights.len() == targets.len());
        Self {
            targets: targets.iter(),
            weights: weights.iter(),
        }
    }
}

impl Iterator for WeightedRow<'_> {
    type Item = (Vertex, Weight);

    #[inline]
    fn next(&mut self) -> Option<(Vertex, Weight)> {
        let target = *self.targets.next()?;
        let weight = self.weights.next().copied().unwrap_or(UNIT_WEIGHT);
        Some((target, weight))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.targets.size_hint()
    }
}

impl ExactSizeIterator for WeightedRow<'_> {}

/// The storage strategies offered by the library.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum Representation {
    /// One `Vec<Vertex>` per vertex.
    AdjacencyList,
    /// A packed `n × n` bitset.
    AdjacencyMatrix,
    /// Compressed sparse row: one offsets array and one targets array.
    Csr,
}

impl Representation {
    /// Every representation, in the order they are usually reported.
    pub const ALL: [Representation; 3] = [
        Representation::AdjacencyList,
        Representation::AdjacencyMatrix,
        Representation::Csr,
    ];

    /// Short identifier used on the command line (`list`, `matrix`, `csr`).
    pub fn label(self) -> &'static str {
        match self {
            Representation::AdjacencyList => "list",
            Representation::AdjacencyMatrix => "matrix",
            Representation::Csr => "csr",
        }
    }

    /// Human readable name.
    pub fn name(self) -> &'static str {
        match self {
            Representation::AdjacencyList => "adjacency list",
            Representation::AdjacencyMatrix => "adjacency matrix",
            Representation::Csr => "compressed sparse row",
        }
    }

    /// Heap bytes this representation needs for an undirected graph with
    /// `vertex_count` vertices and `edge_count` edges, with or without a
    /// weight per edge, before building anything.
    pub fn required_bytes(self, vertex_count: usize, edge_count: usize, weighted: bool) -> usize {
        self.required_bytes_oriented(vertex_count, edge_count, weighted, Orientation::Undirected)
    }

    /// [`required_bytes`](Self::required_bytes) for either orientation: a
    /// directed graph stores each arc once, an undirected one each edge in
    /// both rows.
    pub fn required_bytes_oriented(
        self,
        vertex_count: usize,
        edge_count: usize,
        weighted: bool,
        orientation: Orientation,
    ) -> usize {
        match self {
            Representation::AdjacencyList => AdjacencyList::required_bytes_oriented(
                vertex_count,
                edge_count,
                weighted,
                orientation,
            ),
            Representation::AdjacencyMatrix => AdjacencyMatrix::required_bytes_oriented(
                vertex_count,
                edge_count,
                weighted,
                orientation,
            ),
            Representation::Csr => {
                Csr::required_bytes_oriented(vertex_count, edge_count, weighted, orientation)
            }
        }
    }

    /// Build this representation within the machine's memory budget.
    pub fn build(self, edges: &EdgeList) -> Result<AnyGraph, BuildError> {
        self.build_within(edges, MemoryBudget::default())
    }

    /// Build this representation within an explicit memory budget.
    pub fn build_within(
        self,
        edges: &EdgeList,
        budget: MemoryBudget,
    ) -> Result<AnyGraph, BuildError> {
        Ok(match self {
            Representation::AdjacencyList => {
                AnyGraph::List(AdjacencyList::build_within(edges, budget)?)
            }
            Representation::AdjacencyMatrix => {
                AnyGraph::Matrix(AdjacencyMatrix::build_within(edges, budget)?)
            }
            Representation::Csr => AnyGraph::Csr(Csr::build_within(edges, budget)?),
        })
    }
}

impl fmt::Display for Representation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Representation {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "list" | "adjacency-list" | "adjacency_list" => Ok(Representation::AdjacencyList),
            "matrix" | "adjacency-matrix" | "adjacency_matrix" => {
                Ok(Representation::AdjacencyMatrix)
            }
            "csr" => Ok(Representation::Csr),
            other => Err(format!(
                "unknown representation {other:?} (expected list, matrix or csr)"
            )),
        }
    }
}

/// How much memory a builder is allowed to claim.
///
/// The adjacency matrix of a 375 000-vertex graph is 17.6 GB; trying to
/// allocate it on a 16 GB laptop ends in swap death, not in a clean error.
/// Builders therefore check [`Build::required_bytes`] against a budget first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MemoryBudget {
    /// The physical memory of this machine (unlimited if it cannot be read).
    #[default]
    Machine,
    /// Do not check; just try to allocate.
    Unlimited,
    /// An explicit limit in bytes.
    Bytes(usize),
}

impl MemoryBudget {
    /// The limit in bytes, if any.
    pub fn limit_bytes(self) -> Option<usize> {
        match self {
            MemoryBudget::Machine => memory::total_bytes(),
            MemoryBudget::Unlimited => None,
            MemoryBudget::Bytes(bytes) => Some(bytes),
        }
    }
}

/// Why a representation could not be built.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BuildError {
    /// The representation would need more memory than the budget allows.
    #[error(
        "the {representation} of a graph with {vertex_count} vertices needs {required_bytes} bytes, \
         over the budget of {limit_bytes} bytes"
    )]
    OverBudget {
        /// Representation that was requested.
        representation: Representation,
        /// Number of vertices.
        vertex_count: usize,
        /// Bytes the representation would need.
        required_bytes: usize,
        /// The budget that was exceeded.
        limit_bytes: usize,
    },
    /// The allocator refused the request.
    #[error("allocating {required_bytes} bytes for the {representation} failed")]
    AllocationFailed {
        /// Representation that was requested.
        representation: Representation,
        /// Bytes that were requested.
        required_bytes: usize,
    },
}

/// A representation that can be built from an [`EdgeList`], weighted or
/// not, undirected or directed.
pub trait Build: Weighted + Sized {
    /// The strategy implemented by this type.
    const REPRESENTATION: Representation;

    /// Heap bytes needed for an undirected graph of this size, with or
    /// without weights.
    fn required_bytes(vertex_count: usize, edge_count: usize, weighted: bool) -> usize {
        Self::required_bytes_oriented(vertex_count, edge_count, weighted, Orientation::Undirected)
    }

    /// Heap bytes needed for a graph of this size and orientation.
    fn required_bytes_oriented(
        vertex_count: usize,
        edge_count: usize,
        weighted: bool,
        orientation: Orientation,
    ) -> usize;

    /// Build without checking any memory budget. Allocation failures are
    /// still reported as [`BuildError::AllocationFailed`] instead of aborting.
    fn build_unchecked(edges: &EdgeList) -> Result<Self, BuildError>;

    /// Build within the machine's memory ([`MemoryBudget::Machine`]).
    fn build(edges: &EdgeList) -> Result<Self, BuildError> {
        Self::build_within(edges, MemoryBudget::default())
    }

    /// Build within an explicit budget.
    fn build_within(edges: &EdgeList, budget: MemoryBudget) -> Result<Self, BuildError> {
        let vertex_count = edges.vertex_count();
        let required_bytes = Self::required_bytes_oriented(
            vertex_count,
            edges.edge_count(),
            edges.is_weighted(),
            edges.orientation(),
        );
        check_budget::<Self>(vertex_count, required_bytes, budget)?;
        Self::build_unchecked(edges)
    }

    /// The same representation with every arc reversed, without checking
    /// any budget: row `v` of the transpose lists the tails of the arcs into
    /// `v`, ascending, with their weights. An undirected graph is its own
    /// transpose (this returns a copy; callers that only need in-arcs check
    /// [`Graph::is_directed`] and skip it).
    fn transpose_unchecked(&self) -> Result<Self, BuildError>;

    /// [`transpose_unchecked`](Self::transpose_unchecked) within an explicit
    /// budget. The transpose is built while the graph is still held, so it
    /// is refused when both together exceed the budget.
    fn transpose_within(&self, budget: MemoryBudget) -> Result<Self, BuildError> {
        let required_bytes = Self::required_bytes_oriented(
            self.vertex_count(),
            self.edge_count(),
            self.is_weighted(),
            self.orientation(),
        )
        .saturating_add(self.heap_bytes());
        check_budget::<Self>(self.vertex_count(), required_bytes, budget)?;
        self.transpose_unchecked()
    }

    /// The transpose within the machine's memory ([`MemoryBudget::Machine`]).
    fn transpose(&self) -> Result<Self, BuildError> {
        self.transpose_within(MemoryBudget::default())
    }
}

/// Refuses `required_bytes` when it is over the budget.
fn check_budget<B: Build>(
    vertex_count: usize,
    required_bytes: usize,
    budget: MemoryBudget,
) -> Result<(), BuildError> {
    match budget.limit_bytes() {
        Some(limit_bytes) if required_bytes > limit_bytes => Err(BuildError::OverBudget {
            representation: B::REPRESENTATION,
            vertex_count,
            required_bytes,
            limit_bytes,
        }),
        _ => Ok(()),
    }
}

/// Maps a `TryReserveError` to a [`BuildError`].
pub(crate) fn allocation_failed(
    representation: Representation,
    required_bytes: usize,
) -> impl FnOnce(alloc::collections::TryReserveError) -> BuildError {
    move |_| BuildError::AllocationFailed {
        representation,
        required_bytes,
    }
}

extern crate alloc;

/// A graph whose representation is chosen at runtime.
///
/// Use [`dispatch!`](crate::dispatch) to run a generic algorithm on it; the
/// algorithm is still monomorphised per representation, the only dynamic
/// decision is the single `match` at the call site.
#[derive(Debug, Clone)]
pub enum AnyGraph {
    /// See [`AdjacencyList`].
    List(AdjacencyList),
    /// See [`AdjacencyMatrix`].
    Matrix(AdjacencyMatrix),
    /// See [`Csr`].
    Csr(Csr),
}

/// Runs an expression generic over [`Graph`] on an [`AnyGraph`].
///
/// ```
/// use graphman::{EdgeList, Representation, algo, dispatch};
/// let edges = EdgeList::parse(b"3\n1 2\n2 3\n").unwrap();
/// let graph = Representation::Csr.build(&edges).unwrap();
/// let tree = dispatch!(&graph, g => algo::bfs(g, 1));
/// assert_eq!(tree.level(3), Some(2));
/// ```
#[macro_export]
macro_rules! dispatch {
    ($graph:expr, $g:ident => $body:expr) => {
        match $graph {
            $crate::graph::AnyGraph::List($g) => $body,
            $crate::graph::AnyGraph::Matrix($g) => $body,
            $crate::graph::AnyGraph::Csr($g) => $body,
        }
    };
}

impl AnyGraph {
    /// Number of vertices.
    pub fn vertex_count(&self) -> usize {
        dispatch!(self, g => g.vertex_count())
    }

    /// Number of edges.
    pub fn edge_count(&self) -> usize {
        dispatch!(self, g => g.edge_count())
    }

    /// Degree of `v`.
    pub fn degree(&self, v: Vertex) -> usize {
        dispatch!(self, g => g.degree(v))
    }

    /// Whether the edge `{u, v}` (the arc `u → v` when directed) exists.
    pub fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        dispatch!(self, g => g.has_edge(u, v))
    }

    /// Whether the graph was built from arcs.
    pub fn is_directed(&self) -> bool {
        dispatch!(self, g => g.is_directed())
    }

    /// The orientation the graph was built with.
    pub fn orientation(&self) -> Orientation {
        dispatch!(self, g => g.orientation())
    }

    /// The same representation with every arc reversed (a copy when
    /// undirected), within `budget`; see [`Build::transpose_within`].
    pub fn transpose_within(&self, budget: MemoryBudget) -> Result<AnyGraph, BuildError> {
        Ok(match self {
            AnyGraph::List(g) => AnyGraph::List(g.transpose_within(budget)?),
            AnyGraph::Matrix(g) => AnyGraph::Matrix(g.transpose_within(budget)?),
            AnyGraph::Csr(g) => AnyGraph::Csr(g.transpose_within(budget)?),
        })
    }

    /// Whether the edges carry weights from the input.
    pub fn is_weighted(&self) -> bool {
        dispatch!(self, g => g.is_weighted())
    }

    /// The weight of the edge `{u, v}`, if it exists (`1` when unweighted).
    pub fn weight(&self, u: Vertex, v: Vertex) -> Option<Weight> {
        dispatch!(self, g => g.weight(u, v))
    }

    /// The first edge with a negative weight, if any.
    pub fn negative_edge(&self) -> Option<WeightedEdge> {
        dispatch!(self, g => g.negative_edge())
    }

    /// The negative self-loops, one per vertex.
    pub fn negative_loops(&self) -> &[WeightedEdge] {
        dispatch!(self, g => g.negative_loops())
    }

    /// Accounted heap bytes.
    pub fn heap_bytes(&self) -> usize {
        dispatch!(self, g => g.heap_bytes())
    }

    /// The representation in use.
    pub fn representation(&self) -> Representation {
        dispatch!(self, g => g.representation())
    }
}
