//! Graph algorithms, generic over any [`Graph`](crate::graph::Graph).
//!
//! * [`bfs`] / [`dfs`] — traversals that build a [`SearchTree`] and report to a [`Visitor`].
//! * [`distance`] / [`eccentricity`] — shortest-path queries built on BFS.
//! * [`Components`] — connected components, largest first.
//! * [`diameter`] — exact (brute force or iFUB) and approximate (4-sweep) diameter.
//! * [`degree_stats`] — min, max, mean and median degree.
//! * [`radial_layout`] — a free `O(n)` layout derived from a search tree, used by the observatory.

mod components;
mod diameter;
mod distance;
mod layout;
mod stats;
mod traversal;

pub use components::Components;
pub use diameter::{Diameter, DiameterMethod, diameter, diameter_with_progress};
pub use distance::{distance, distance_into, eccentricity, eccentricity_into};
pub use layout::{RadialLayout, radial_layout};
pub use stats::{DegreeStats, degree_stats};
pub use traversal::{
    Control, SearchTree, UNREACHED, Visitor, bfs, bfs_into, bfs_with, dfs, dfs_into, dfs_with,
};
