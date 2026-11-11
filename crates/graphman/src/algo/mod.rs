//! Graph algorithms, generic over any [`Graph`](crate::graph::Graph).
//!
//! * [`bfs`] / [`dfs`] — traversals that build a [`SearchTree`] and report to a [`Visitor`];
//!   DFS written both ways, iterative and recursive ([`DfsKind`], [`dfs_recursive`]).
//! * [`distance`] / [`eccentricity`] — shortest-path queries built on BFS.
//! * [`dijkstra`] / [`shortest_path`] — shortest paths on weighted graphs, one
//!   algorithm over six interchangeable [`Frontier`]s (vector, heap, lazy heap,
//!   4-ary heap, pairing heap, radix heap).
//! * [`bellman_ford`] / [`bellman_ford_to`] — shortest paths with negative weights, one
//!   algorithm over six interchangeable [`Schedule`]s, and the [`NegativeCycle`] when
//!   there is one ([`negative_cycle`] asks the whole graph).
//! * [`floyd_warshall`] — shortest paths between all pairs in one `n × n` table updated in
//!   place ([`AllPairs`]), over four [`SweepKind`]s, refused past the memory budget.
//! * [`Components`] — connected components, largest first (weakly connected when directed).
//! * [`diameter`] — exact (brute force or iFUB) and approximate (4-sweep) diameter.
//! * [`degree_stats`] / [`weight_stats`] — min, max, mean (and median) degree and weight.
//! * [`radial_layout`], [`tree_layout`] — free `O(n)` layouts derived from a search tree, used by the observatory.
//! * [`select`] / [`induce`] — a graph cut down to size by a [`SubgraphRule`], renumbered and written back out.
//! * [`egonet`] — the cut of everything within `k` edges of a vertex, collected during one BFS.

mod bellman_ford;
mod components;
mod diameter;
mod distance;
mod floyd_warshall;
mod frontier;
mod layout;
mod schedule;
mod shortest_path;
mod stats;
mod subgraph;
mod traversal;

pub use bellman_ford::{
    BellmanFordError, NegativeCycle, bellman_ford, bellman_ford_into, bellman_ford_to,
    bellman_ford_to_into, bellman_ford_with, negative_cycle,
};
pub use components::Components;
pub use diameter::{Diameter, DiameterError, DiameterMethod, diameter, diameter_with_progress};
pub use distance::{distance, distance_into, eccentricity, eccentricity_into};
pub use floyd_warshall::{
    AllPairs, FloydError, SweepKind, floyd_warshall, floyd_warshall_with_progress,
};
pub use frontier::{
    DaryHeapFrontier, Frontier, FrontierCounts, FrontierEntry, FrontierKind, HeapFrontier,
    LazyHeapFrontier, Measured, PairingHeapFrontier, QuadHeapFrontier, RadixHeapFrontier,
    VectorFrontier,
};
pub use layout::{RadialLayout, TreeLayout, radial_layout, tree_layout};
pub use schedule::{
    AnySchedule, MeasuredSchedule, QueueSchedule, Schedule, ScheduleCounts, ScheduleKind, Start,
    SweepSchedule, YenSchedule,
};
pub use shortest_path::{
    NegativeWeight, Path, ShortestPathTree, dijkstra, dijkstra_into, dijkstra_with, shortest_path,
    shortest_path_into,
};
pub use stats::{DegreeStats, WeightStats, degree_stats, in_degree_stats, weight_stats};
pub use subgraph::{Induced, SubgraphRule, egonet, induce, select};
pub use traversal::{
    Control, DfsKind, RecursionLimit, SearchTree, UNREACHED, Visitor, bfs, bfs_into, bfs_with, dfs,
    dfs_into, dfs_recursive, dfs_recursive_into, dfs_recursive_with, dfs_with,
};
