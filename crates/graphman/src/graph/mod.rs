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

mod adjacency_list;
mod adjacency_matrix;
mod csr;

pub use adjacency_list::AdjacencyList;
pub use adjacency_matrix::AdjacencyMatrix;
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
    /// vertices and `edge_count` edges, before building anything.
    pub fn required_bytes(self, vertex_count: usize, edge_count: usize) -> usize {
        match self {
            Representation::AdjacencyList => {
                AdjacencyList::required_bytes(vertex_count, edge_count)
            }
            Representation::AdjacencyMatrix => {
                AdjacencyMatrix::required_bytes(vertex_count, edge_count)
            }
            Representation::Csr => Csr::required_bytes(vertex_count, edge_count),
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

/// A representation that can be built from an [`EdgeList`].
pub trait Build: Graph + Sized {
    /// The strategy implemented by this type.
    const REPRESENTATION: Representation;

    /// Heap bytes needed for a graph of this size.
    fn required_bytes(vertex_count: usize, edge_count: usize) -> usize;

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
        let required_bytes = Self::required_bytes(vertex_count, edges.edge_count());
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

    /// Accounted heap bytes.
    pub fn heap_bytes(&self) -> usize {
        dispatch!(self, g => g.heap_bytes())
    }

    /// The representation in use.
    pub fn representation(&self) -> Representation {
        dispatch!(self, g => g.representation())
    }
}
