//! # GraphMan
//!
//! A fast, representation-agnostic graph library written for the
//! *Teoria dos Grafos* course (COS 242, UFRJ).
//!
//! The library is organised around a few ideas:
//!
//! * **Storage is a strategy.** Every algorithm is written once against the
//!   [`Graph`] trait and monomorphised for each concrete representation:
//!   [`AdjacencyList`], [`AdjacencyMatrix`] (a packed bitset) and [`Csr`]
//!   (compressed sparse row). Swapping the representation never changes a
//!   result, only the memory footprint and the running time.
//! * **Weights are a column.** A file with a third column is a weighted
//!   graph; every representation keeps the weights beside its adjacency, not
//!   inside it, and answers them through [`Weighted`]. BFS never reads them,
//!   and a graph without weights answers `1` for every edge, so hop counts
//!   are just the unit-weight case.
//! * **The frontier is a strategy too.** [`dijkstra`] is written once; how
//!   the distance estimates are stored and the closest one found is a
//!   [`Frontier`](algo::Frontier): a vector scanned for the minimum, a binary
//!   heap with decrease-key, or a heap without it. Every frontier builds the
//!   same [`ShortestPathTree`]. A graph with a negative weight is refused with
//!   a [`NegativeWeight`] error rather than answered wrongly.
//! * **Traversals are observable.** [`bfs`], [`dfs`] and [`dijkstra`]
//!   report to a [`Visitor`]; everything from early termination
//!   (`distance`, `shortest_path`) to animation frames is a listener on the
//!   traversal.
//! * **Nothing is allocated twice.** A [`SearchTree`] (or a
//!   [`ShortestPathTree`]) is reusable across runs and only resets what the
//!   previous run touched, which is what makes the eccentricity-heavy
//!   diameter algorithms and the `k`-source Dijkstra studies affordable on
//!   graphs with millions of vertices.
//!
//! ```
//! use graphman::{AdjacencyList, Build, EdgeList, FrontierKind, Graph, algo};
//!
//! // The graph from Figure 1 of the assignment (Part 1).
//! let edges = EdgeList::parse(b"5\n1 2\n2 5\n5 3\n4 5\n1 5\n").unwrap();
//! let graph = AdjacencyList::build(&edges).unwrap();
//! assert_eq!(graph.vertex_count(), 5);
//! assert_eq!(graph.edge_count(), 5);
//!
//! let tree = algo::bfs(&graph, 1);
//! assert_eq!(tree.parent(3), Some(5));
//! assert_eq!(tree.level(3), Some(2));
//!
//! let diameter = algo::diameter(&graph, algo::DiameterMethod::Exact);
//! assert_eq!(diameter.value, 2);
//!
//! // The same shape with weights (Part 2), one Dijkstra, any frontier.
//! let edges = EdgeList::parse(b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 9.5\n4 5 2.3\n1 5 1\n").unwrap();
//! let graph = AdjacencyList::build(&edges).unwrap();
//! let heap = algo::dijkstra(&graph, 1, FrontierKind::Heap).unwrap();
//! let vector = algo::dijkstra(&graph, 1, FrontierKind::Vector).unwrap();
//! assert_eq!(heap, vector);
//! assert_eq!(heap.path_to(3), Some(vec![1, 2, 5, 3]));
//! ```
//!
//! Vertices are numbered `1..=n`, exactly as in the input files; `0` is
//! reserved as [`NO_VERTEX`].

#![warn(missing_docs, clippy::all)]
#![deny(unsafe_op_in_unsafe_fn)]

pub mod algo;
pub mod graph;
pub mod io;
pub mod metrics;

pub use algo::{
    Components, Control, DegreeStats, Diameter, DiameterMethod, FrontierKind, NegativeWeight,
    SearchTree, ShortestPathTree, Visitor, bfs, dfs, dijkstra,
};
pub use graph::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, BuildError, Csr, Graph, MemoryBudget,
    NO_VERTEX, Representation, UNIT_WEIGHT, Vertex, Weight, Weighted, WeightedEdge,
};
pub use io::{EdgeList, ParseError, VertexNames};
