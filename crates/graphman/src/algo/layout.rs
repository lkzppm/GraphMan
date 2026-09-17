//! A layout that costs nothing: the search tree *is* the layout.
//!
//! Force-directed layouts of a 4.8-million-vertex graph are out of reach, but
//! a BFS tree gives every vertex a natural radius (its level) and an angle
//! (its slot inside its parent's wedge). Computing that is a single pass over
//! the discovery order, so the observatory can draw graphs of any size.

use super::traversal::SearchTree;
use crate::graph::NO_VERTEX;
use core::f64::consts::TAU;

/// Polar coordinates of every reached vertex of a search tree.
#[derive(Debug, Clone)]
pub struct RadialLayout {
    /// Angle in radians, indexed by vertex (`0.0` for unreached vertices).
    pub angle: Vec<f32>,
    /// Vertices in the subtree rooted at each vertex, itself included.
    pub subtree_size: Vec<u32>,
}

/// Assigns each vertex a wedge proportional to its subtree size, nested
/// inside its parent's wedge, in discovery order.
pub fn radial_layout(tree: &SearchTree) -> RadialLayout {
    let n = tree.vertex_count();
    let parents = tree.parents_raw();
    let order = tree.order();

    let mut subtree_size = vec![0u32; n + 1];
    for &v in order {
        subtree_size[v as usize] = 1;
    }
    for &v in order.iter().rev() {
        let p = parents[v as usize];
        if p != NO_VERTEX {
            subtree_size[p as usize] += subtree_size[v as usize];
        }
    }

    // `cursor[p]` is where the next child of `p` starts; `span[v]` is the
    // width of `v`'s wedge.
    let mut cursor = vec![0f64; n + 1];
    let mut span = vec![0f64; n + 1];
    let mut angle = vec![0f32; n + 1];
    if let Some(&root) = order.first() {
        span[root as usize] = TAU;
    }
    for &v in order {
        let p = parents[v as usize];
        if p != NO_VERTEX {
            let children = (subtree_size[p as usize] - 1) as f64;
            let width = span[p as usize] * subtree_size[v as usize] as f64 / children;
            let start = cursor[p as usize];
            cursor[p as usize] = start + width;
            cursor[v as usize] = start;
            span[v as usize] = width;
        }
        angle[v as usize] = (cursor[v as usize] + span[v as usize] / 2.0) as f32;
    }
    RadialLayout {
        angle,
        subtree_size,
    }
}
