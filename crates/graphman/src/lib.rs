//! # GraphMan
//!
//! A fast, representation-agnostic graph library written for the
//! *Teoria dos Grafos* course (COS 242, UFRJ).
//!
//! The library is organised around three ideas:
//!
//! * **Storage is a strategy.** Every algorithm is written once against the
//!   [`Graph`] trait and monomorphised for each concrete representation:
//!   [`AdjacencyList`], [`AdjacencyMatrix`] (a packed bitset) and [`Csr`]
//!   (compressed sparse row). Swapping the representation never changes a
//!   result, only the memory footprint and the running time.
//! * **Traversals are observable.** [`bfs`](algo::bfs) and [`dfs`](algo::dfs)
//!   accept a [`Visitor`](algo::Visitor); everything from early termination
//!   (`distance`) to animation frames is a listener on the traversal.
//! * **Nothing is allocated twice.** A [`SearchTree`](algo::SearchTree) is
//!   reusable across traversals and only resets what the previous traversal
//!   touched, which is what makes the eccentricity-heavy diameter algorithms
//!   affordable on graphs with millions of vertices.
//!
//! ```
//! use graphman::{AdjacencyList, Build, EdgeList, Graph, algo};
//!
//! // The graph from Figure 1 of the assignment.
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
    Components, Control, DegreeStats, Diameter, DiameterMethod, SearchTree, Visitor, bfs, dfs,
};
pub use graph::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, BuildError, Csr, Graph, MemoryBudget,
    NO_VERTEX, Representation, Vertex,
};
pub use io::{EdgeList, ParseError};
