//! A layout that costs nothing: the search tree *is* the layout.
//!
//! Force-directed layouts of a 4.8-million-vertex graph are out of reach, but
//! a BFS tree gives every vertex a natural radius (its level) and an angle
//! (its slot inside its parent's wedge). Computing that is a single pass over
//! the discovery order, so the observatory can draw graphs of any size.

use super::traversal::SearchTree;
use crate::graph::{NO_VERTEX, Vertex};
use core::f64::consts::TAU;

/// Polar coordinates of every reached vertex of a search tree.
#[derive(Debug, Clone)]
pub struct RadialLayout {
    /// Angle in radians, indexed by vertex (`0.0` for unreached vertices).
    pub angle: Vec<f32>,
    /// Vertices in the subtree rooted at each vertex, itself included.
    pub subtree_size: Vec<u32>,
    /// Where the next child of each vertex starts.
    cursor: Vec<f64>,
    /// The width of each vertex's wedge.
    span: Vec<f64>,
}

impl RadialLayout {
    /// A blank layout for a graph of `n` vertices, to [`fill`](Self::fill).
    pub fn new(n: usize) -> Self {
        Self {
            angle: vec![0.0; n + 1],
            subtree_size: vec![0; n + 1],
            cursor: vec![0.0; n + 1],
            span: vec![0.0; n + 1],
        }
    }

    /// Assigns each vertex of `tree` a wedge proportional to its subtree
    /// size, nested inside its parent's wedge, in discovery order. Costs
    /// `O(reached)` and leaves every other vertex as it was, so one layout
    /// serves all the trees of a forest: a network of DBLP's size has tens of
    /// thousands of components, and arrays of `n` for each would dwarf the
    /// layout itself.
    pub fn fill(&mut self, tree: &SearchTree) {
        self.fill_tree(tree.parents_raw(), tree.order());
    }

    /// [`fill`](Self::fill) for any rooted tree: `parents` indexed by
    /// vertex (`NO_VERTEX` for the root), `order` its vertices with every
    /// parent before its children and the root first (a DFS's discovery
    /// order, a shortest-path tree's settle order).
    pub fn fill_tree(&mut self, parents: &[Vertex], order: &[Vertex]) {
        for &v in order {
            let v = v as usize;
            self.subtree_size[v] = 1;
            self.cursor[v] = 0.0;
            self.span[v] = 0.0;
        }
        for &v in order.iter().rev() {
            let p = parents[v as usize];
            if p != NO_VERTEX {
                self.subtree_size[p as usize] += self.subtree_size[v as usize];
            }
        }
        if let Some(&root) = order.first() {
            self.span[root as usize] = TAU;
        }
        for &v in order {
            let p = parents[v as usize];
            if p != NO_VERTEX {
                let children = (self.subtree_size[p as usize] - 1) as f64;
                let width = self.span[p as usize] * self.subtree_size[v as usize] as f64 / children;
                let start = self.cursor[p as usize];
                self.cursor[p as usize] = start + width;
                self.cursor[v as usize] = start;
                self.span[v as usize] = width;
            }
            self.angle[v as usize] = (self.cursor[v as usize] + self.span[v as usize] / 2.0) as f32;
        }
    }
}

/// The layout of one search tree; see [`RadialLayout::fill`].
pub fn radial_layout(tree: &SearchTree) -> RadialLayout {
    let mut layout = RadialLayout::new(tree.vertex_count());
    layout.fill(tree);
    layout
}

/// A layered drawing of a rooted forest: how far each vertex is from its root
/// and where it sits across the levels.
#[derive(Debug, Clone)]
pub struct TreeLayout {
    /// Position across the levels, in leaf widths, indexed by vertex: a leaf
    /// is centred on its own slot and a parent midway over its first and last
    /// child. `0.0` for vertices outside the forest.
    pub slot: Vec<f64>,
    /// Edges from the vertex to its root, indexed by vertex.
    pub depth: Vec<u32>,
    /// Leaves in the forest: the width the slots span.
    pub leaves: u32,
}

/// Lays out any forest given by parent pointers, whichever search grew it: a
/// BFS tree, a shortest-path tree. `order` lists the vertices with every parent
/// before its children and one tree after another; the trees stand side by side
/// in that order and each vertex's children keep their order, so every subtree
/// is a contiguous block and no two vertices of a level share a slot. `O(n)`.
pub fn tree_layout(parents: &[Vertex], order: &[Vertex]) -> TreeLayout {
    let n = parents.len();
    let mut leaves_under = vec![0u32; n];
    for &v in order.iter().rev() {
        let v = v as usize;
        leaves_under[v] = leaves_under[v].max(1);
        if parents[v] != NO_VERTEX {
            leaves_under[parents[v] as usize] += leaves_under[v];
        }
    }

    // `next[p]` is where the next child of `p` starts, which for a leaf stays
    // its own slot.
    let mut next = vec![0u32; n];
    let mut depth = vec![0u32; n];
    let mut leaves = 0u32;
    for &v in order {
        let v = v as usize;
        let start = match parents[v] {
            NO_VERTEX => &mut leaves,
            p => {
                depth[v] = depth[p as usize] + 1;
                &mut next[p as usize]
            }
        };
        let first = *start;
        *start += leaves_under[v];
        next[v] = first;
    }

    // Children before parents: the span of the placed children of each vertex.
    let mut slot = vec![0f64; n];
    let mut span = vec![(f64::INFINITY, f64::NEG_INFINITY); n];
    for &v in order.iter().rev() {
        let v = v as usize;
        let (first, last) = span[v];
        slot[v] = if first <= last {
            (first + last) / 2.0
        } else {
            next[v] as f64 + 0.5
        };
        if parents[v] != NO_VERTEX {
            let parent = &mut span[parents[v] as usize];
            *parent = (parent.0.min(slot[v]), parent.1.max(slot[v]));
        }
    }
    TreeLayout {
        slot,
        depth,
        leaves,
    }
}
