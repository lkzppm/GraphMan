//! Shortest-path distances, using BFS as the primitive.

use super::traversal::{Control, SearchTree, Visitor, bfs_into};
use crate::graph::{Graph, Vertex};

/// Stops a BFS as soon as `target` is discovered.
struct StopAt {
    target: Vertex,
    level: Option<u32>,
}

impl Visitor for StopAt {
    #[inline]
    fn discover(&mut self, v: Vertex, _parent: Vertex, level: u32) -> Control {
        if v == self.target {
            self.level = Some(level);
            Control::Break
        } else {
            Control::Continue
        }
    }
}

/// Distance (number of edges) between `source` and `target`; `None` if they
/// are in different components.
pub fn distance<G: Graph>(graph: &G, source: Vertex, target: Vertex) -> Option<u32> {
    let mut tree = SearchTree::new(graph.vertex_count());
    distance_into(graph, source, target, &mut tree)
}

/// [`distance`] with a reusable tree. The BFS stops as soon as `target` is found.
pub fn distance_into<G: Graph>(
    graph: &G,
    source: Vertex,
    target: Vertex,
    tree: &mut SearchTree,
) -> Option<u32> {
    let mut stop = StopAt {
        target,
        level: None,
    };
    bfs_into(graph, source, tree, &mut stop);
    stop.level
}

/// Eccentricity of `v` within its component: the largest distance from `v`,
/// together with a vertex that attains it.
pub fn eccentricity<G: Graph>(graph: &G, v: Vertex) -> (u32, Vertex) {
    let mut tree = SearchTree::new(graph.vertex_count());
    eccentricity_into(graph, v, &mut tree)
}

/// [`eccentricity`] with a reusable tree. The tree is left holding the full BFS.
pub fn eccentricity_into<G: Graph>(graph: &G, v: Vertex, tree: &mut SearchTree) -> (u32, Vertex) {
    bfs_into(graph, v, tree, &mut ());
    let (farthest, level) = tree.last_discovered();
    (level, farthest)
}
