//! Breadth-first and depth-first search.
//!
//! Both traversals share one output type, [`SearchTree`], and one extension
//! point, [`Visitor`]. The traversal is the *template*; the tree records
//! parents and levels; visitors add behaviour (early exit, frame capture)
//! without the traversal knowing about them.

use crate::graph::{Graph, NO_VERTEX, Vertex};
use std::io::{self, Write};

/// Level value of a vertex that the traversal never reached.
pub const UNREACHED: u32 = u32::MAX;

/// Tells a traversal whether to carry on after a visitor callback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    /// Keep going.
    Continue,
    /// Stop the traversal now; the tree holds everything discovered so far.
    Break,
}

/// Observer of a traversal. Every method has a no-op default.
pub trait Visitor {
    /// `v` was discovered from `parent` at `level` (the root has `parent == NO_VERTEX`, `level == 0`).
    #[inline]
    fn discover(&mut self, v: Vertex, parent: Vertex, level: u32) -> Control {
        let _ = (v, parent, level);
        Control::Continue
    }

    /// BFS only: every vertex of `level` has been expanded. `frontier` is the
    /// set of vertices at that level, in discovery order.
    #[inline]
    fn level_complete(&mut self, level: u32, frontier: &[Vertex]) {
        let _ = (level, frontier);
    }

    /// DFS only: all descendants of `v` have been explored.
    #[inline]
    fn finish(&mut self, v: Vertex) {
        let _ = v;
    }
}

/// The silent visitor.
impl Visitor for () {}

/// The tree produced by a traversal: parent and level of every reached vertex.
///
/// A tree is reusable: [`reset`](Self::reset) only touches the vertices the
/// previous traversal reached, so running thousands of searches (as the
/// diameter algorithms do) costs no allocations and no `O(n)` clears.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchTree {
    root: Vertex,
    parent: Vec<Vertex>,
    level: Vec<u32>,
    order: Vec<Vertex>,
}

impl SearchTree {
    /// An empty tree for a graph with `vertex_count` vertices.
    pub fn new(vertex_count: usize) -> Self {
        Self {
            root: NO_VERTEX,
            parent: vec![NO_VERTEX; vertex_count + 1],
            level: vec![UNREACHED; vertex_count + 1],
            order: Vec::with_capacity(vertex_count),
        }
    }

    /// Number of vertices of the underlying graph.
    pub fn vertex_count(&self) -> usize {
        self.level.len() - 1
    }

    /// The start vertex of the last traversal (`NO_VERTEX` if none).
    pub fn root(&self) -> Vertex {
        self.root
    }

    /// Parent of `v` in the tree; `None` for the root and for unreached vertices.
    #[inline]
    pub fn parent(&self, v: Vertex) -> Option<Vertex> {
        match self.parent[v as usize] {
            NO_VERTEX => None,
            p => Some(p),
        }
    }

    /// Level (depth) of `v`; `None` if unreached. The root is at level 0.
    #[inline]
    pub fn level(&self, v: Vertex) -> Option<u32> {
        match self.level[v as usize] {
            UNREACHED => None,
            l => Some(l),
        }
    }

    /// Whether the traversal reached `v`.
    #[inline]
    pub fn is_reached(&self, v: Vertex) -> bool {
        self.level[v as usize] != UNREACHED
    }

    /// Reached vertices in discovery order (for BFS this is also by level).
    pub fn order(&self) -> &[Vertex] {
        &self.order
    }

    /// Number of reached vertices.
    pub fn reached_count(&self) -> usize {
        self.order.len()
    }

    /// The last discovered vertex and its level. After a BFS this is a vertex
    /// at maximum distance from the root, i.e. the root's eccentricity.
    pub fn last_discovered(&self) -> (Vertex, u32) {
        let v = *self.order.last().expect("a tree always contains its root");
        (v, self.level[v as usize])
    }

    /// Maximum level in the tree.
    pub fn depth(&self) -> u32 {
        self.order
            .iter()
            .map(|&v| self.level[v as usize])
            .max()
            .unwrap_or(0)
    }

    /// Raw parent array indexed by vertex (`NO_VERTEX` = none).
    pub fn parents_raw(&self) -> &[Vertex] {
        &self.parent
    }

    /// Raw level array indexed by vertex (`UNREACHED` = none).
    pub fn levels_raw(&self) -> &[u32] {
        &self.level
    }

    /// Forgets the previous traversal in `O(reached)` time.
    pub fn reset(&mut self) {
        for &v in &self.order {
            self.level[v as usize] = UNREACHED;
            self.parent[v as usize] = NO_VERTEX;
        }
        self.order.clear();
        self.root = NO_VERTEX;
    }

    fn begin(&mut self, root: Vertex) {
        assert!(
            root >= 1 && (root as usize) < self.level.len(),
            "vertex {root} is outside 1..={}",
            self.vertex_count()
        );
        self.reset();
        self.root = root;
        self.level[root as usize] = 0;
        self.order.push(root);
    }

    /// Writes `vertex parent level` per line, as the assignment requires.
    /// The root's parent is `0`; unreached vertices get `- -`.
    pub fn write_to<W: Write>(&self, w: W) -> io::Result<()> {
        let mut w = io::BufWriter::new(w);
        writeln!(w, "# root {}", self.root)?;
        writeln!(w, "# vertex parent level")?;
        for v in 1..self.level.len() {
            match self.level[v] {
                UNREACHED => writeln!(w, "{v} - -")?,
                level => writeln!(w, "{v} {} {level}", self.parent[v])?,
            }
        }
        w.flush()
    }
}

/// Breadth-first search from `root`.
pub fn bfs<G: Graph>(graph: &G, root: Vertex) -> SearchTree {
    bfs_with(graph, root, &mut ())
}

/// Breadth-first search from `root`, reporting to `visitor`.
pub fn bfs_with<G: Graph, V: Visitor>(graph: &G, root: Vertex, visitor: &mut V) -> SearchTree {
    let mut tree = SearchTree::new(graph.vertex_count());
    bfs_into(graph, root, &mut tree, visitor);
    tree
}

/// Breadth-first search into a reusable tree.
///
/// The search is level-synchronous: `tree.order()` doubles as the queue, and
/// the slice of the current level is expanded before the next one starts.
pub fn bfs_into<G: Graph, V: Visitor>(
    graph: &G,
    root: Vertex,
    tree: &mut SearchTree,
    visitor: &mut V,
) {
    tree.begin(root);
    if visitor.discover(root, NO_VERTEX, 0) == Control::Break {
        return;
    }
    let mut level_start = 0usize;
    let mut level = 0u32;
    while level_start < tree.order.len() {
        let level_end = tree.order.len();
        let next = level + 1;
        for head in level_start..level_end {
            let v = tree.order[head];
            for w in graph.neighbors(v) {
                let slot = &mut tree.level[w as usize];
                if *slot == UNREACHED {
                    *slot = next;
                    tree.parent[w as usize] = v;
                    tree.order.push(w);
                    if visitor.discover(w, v, next) == Control::Break {
                        return;
                    }
                }
            }
        }
        visitor.level_complete(level, &tree.order[level_start..level_end]);
        level_start = level_end;
        level = next;
    }
}

/// Depth-first search from `root`.
pub fn dfs<G: Graph>(graph: &G, root: Vertex) -> SearchTree {
    dfs_with(graph, root, &mut ())
}

/// Depth-first search from `root`, reporting to `visitor`.
pub fn dfs_with<G: Graph, V: Visitor>(graph: &G, root: Vertex, visitor: &mut V) -> SearchTree {
    let mut tree = SearchTree::new(graph.vertex_count());
    dfs_into(graph, root, &mut tree, visitor);
    tree
}

/// Depth-first search into a reusable tree.
///
/// Iterative, with an explicit stack of *neighbour iterators* rather than of
/// vertices: this yields exactly the tree a recursive DFS would (neighbours
/// explored in ascending order) while using `O(depth)` memory and no recursion.
pub fn dfs_into<'g, G: Graph, V: Visitor>(
    graph: &'g G,
    root: Vertex,
    tree: &mut SearchTree,
    visitor: &mut V,
) {
    tree.begin(root);
    if visitor.discover(root, NO_VERTEX, 0) == Control::Break {
        return;
    }
    let mut stack: Vec<(Vertex, u32, G::Neighbors<'g>)> = vec![(root, 0, graph.neighbors(root))];
    while let Some((v, depth, neighbors)) = stack.last_mut() {
        let (v, depth) = (*v, *depth);
        match neighbors.next() {
            Some(w) if tree.level[w as usize] == UNREACHED => {
                tree.level[w as usize] = depth + 1;
                tree.parent[w as usize] = v;
                tree.order.push(w);
                if visitor.discover(w, v, depth + 1) == Control::Break {
                    return;
                }
                stack.push((w, depth + 1, graph.neighbors(w)));
            }
            Some(_) => {}
            None => {
                stack.pop();
                visitor.finish(v);
            }
        }
    }
}
