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

/// An undirected edge `{u, v}` and its weight.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct WeightedEdge {
    /// The smaller endpoint.
    pub u: Vertex,
    /// The larger endpoint.
    pub v: Vertex,
    /// The weight of the edge.
    pub weight: Weight,
}

/// Read-only view of an undirected graph.
///
/// The trait is deliberately tiny: a handful of accessors are enough to write
/// every algorithm in [`crate::algo`], and being generic (rather than
/// trait-object based) lets the compiler specialise each algorithm for each
/// storage strategy at zero runtime cost.
pub trait Graph {
    /// Iterator over the neighbours of a vertex, in ascending order.
    type Neighbors<'a>: Iterator<Item = Vertex>
    where
        Self: 'a;

    /// Number of vertices `n`.
    fn vertex_count(&self) -> usize;

    /// Number of (unique, loop-free) undirected edges `m`.
    fn edge_count(&self) -> usize;

    /// Degree of `v`.
    fn degree(&self, v: Vertex) -> usize;

    /// Neighbours of `v` in ascending order.
    fn neighbors(&self, v: Vertex) -> Self::Neighbors<'_>;

    /// Whether the edge `{u, v}` exists.
    fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        self.neighbors(u).any(|w| w == v)
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

    /// The first edge (in `[min, max]` order) with a negative weight, found
    /// once when the graph was parsed. Algorithms that need non-negative
    /// weights (Dijkstra) check it in `O(1)` and refuse the graph.
    fn negative_edge(&self) -> Option<WeightedEdge>;
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

    /// Heap bytes this representation needs for a graph with `vertex_count`
    /// vertices and `edge_count` edges, with or without a weight per edge,
    /// before building anything.
    pub fn required_bytes(self, vertex_count: usize, edge_count: usize, weighted: bool) -> usize {
        match self {
            Representation::AdjacencyList => {
                AdjacencyList::required_bytes(vertex_count, edge_count, weighted)
            }
            Representation::AdjacencyMatrix => {
                AdjacencyMatrix::required_bytes(vertex_count, edge_count, weighted)
            }
            Representation::Csr => Csr::required_bytes(vertex_count, edge_count, weighted),
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

/// A representation that can be built from an [`EdgeList`], weighted or not.
pub trait Build: Weighted + Sized {
    /// The strategy implemented by this type.
    const REPRESENTATION: Representation;

    /// Heap bytes needed for a graph of this size, with or without weights.
    fn required_bytes(vertex_count: usize, edge_count: usize, weighted: bool) -> usize;

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
        let required_bytes =
            Self::required_bytes(vertex_count, edges.edge_count(), edges.is_weighted());
        if let Some(limit_bytes) = budget.limit_bytes()
            && required_bytes > limit_bytes
        {
            return Err(BuildError::OverBudget {
                representation: Self::REPRESENTATION,
                vertex_count,
                required_bytes,
                limit_bytes,
            });
        }
        Self::build_unchecked(edges)
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

    /// Whether the edge `{u, v}` exists.
    pub fn has_edge(&self, u: Vertex, v: Vertex) -> bool {
        dispatch!(self, g => g.has_edge(u, v))
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

    /// Accounted heap bytes.
    pub fn heap_bytes(&self) -> usize {
        dispatch!(self, g => g.heap_bytes())
    }

    /// The representation in use.
    pub fn representation(&self) -> Representation {
        dispatch!(self, g => g.representation())
    }
}
