//! Strongly connected components, the condensation, and shortest paths on
//! a directed acyclic graph.
//!
//! Two vertices are strongly connected when each reaches the other. Tarjan's
//! algorithm finds every such class in one depth-first search, `O(n + m)`;
//! here it runs with an explicit stack, like the iterative DFS, so a path of
//! millions of vertices needs no deep call stack. Shrinking each component
//! to one vertex gives the **condensation**, always acyclic; when every
//! component is a single vertex the graph itself is acyclic and the
//! components come out in a topological order. On such a graph the shortest
//! paths from a root need no Dijkstra and no Bellman-Ford: relaxing the arcs
//! in topological order settles each vertex once, negative arcs included
//! ([`dag_shortest_path`]).

use super::shortest_path::ShortestPathTree;
use crate::graph::{Graph, Orientation, Vertex, Weight, Weighted};
use crate::io::EdgeList;
use std::io::{self, Write};

/// The strongly connected components of a graph, numbered `1..=count` in a
/// topological order of the condensation: every arc between two components
/// goes from a smaller id to a larger one. Members are listed ascending.
///
/// On an undirected graph every edge reads both ways, so these are the
/// connected components (in another numbering than [`Components`](super::Components)).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrongComponents {
    label: Vec<u32>,
    members: Vec<Vertex>,
    offsets: Vec<usize>,
}

impl StrongComponents {
    /// Tarjan's algorithm with an explicit stack, `O(n + m)`.
    pub fn compute<G: Graph>(graph: &G) -> Self {
        let n = graph.vertex_count();
        // Discovery index (0 = not yet), low-link, and the open vertices.
        let mut index = vec![0u32; n + 1];
        let mut low = vec![0u32; n + 1];
        let mut on_stack = vec![false; n + 1];
        let mut open: Vec<Vertex> = Vec::new();
        let mut calls: Vec<(Vertex, G::Neighbors<'_>)> = Vec::new();
        // Components in the order Tarjan closes them: sinks first.
        let mut found = 0u32;
        let mut raw = vec![0u32; n + 1];
        let mut next_index = 1u32;
        for root in graph.vertices() {
            if index[root as usize] != 0 {
                continue;
            }
            // Discovers `v`: numbers it, opens it, and starts on its arcs.
            macro_rules! enter {
                ($v:expr) => {{
                    let v: Vertex = $v;
                    index[v as usize] = next_index;
                    low[v as usize] = next_index;
                    next_index += 1;
                    on_stack[v as usize] = true;
                    open.push(v);
                    calls.push((v, graph.neighbors(v)));
                }};
            }
            enter!(root);
            while let Some((v, neighbours)) = calls.last_mut() {
                let v = *v;
                match neighbours.next() {
                    Some(w) if index[w as usize] == 0 => enter!(w),
                    Some(w) => {
                        if on_stack[w as usize] {
                            low[v as usize] = low[v as usize].min(index[w as usize]);
                        }
                    }
                    None => {
                        calls.pop();
                        if let Some(&(parent, _)) = calls.last() {
                            low[parent as usize] = low[parent as usize].min(low[v as usize]);
                        }
                        if low[v as usize] == index[v as usize] {
                            found += 1;
                            loop {
                                let w = open.pop().expect("v is still open");
                                on_stack[w as usize] = false;
                                raw[w as usize] = found;
                                if w == v {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        // Tarjan closes a component after every component it reaches: the
        // last closed comes first in a topological order.
        let label: Vec<u32> = raw
            .iter()
            .map(|&r| if r == 0 { 0 } else { found - r + 1 })
            .collect();
        let mut offsets = vec![0usize; found as usize + 1];
        for &c in &label[1..] {
            offsets[c as usize] += 1;
        }
        for c in 1..offsets.len() {
            offsets[c] += offsets[c - 1];
        }
        let mut cursor = offsets.clone();
        let mut members = vec![0 as Vertex; n];
        for (v, &c) in label.iter().enumerate().skip(1) {
            let c = c as usize - 1;
            members[cursor[c]] = v as Vertex;
            cursor[c] += 1;
        }
        Self {
            label,
            members,
            offsets,
        }
    }

    /// Number of components.
    pub fn count(&self) -> usize {
        self.offsets.len() - 1
    }

    /// Component id (`1..=count`) of `v`.
    pub fn component_of(&self, v: Vertex) -> u32 {
        self.label[v as usize]
    }

    /// Vertices of component `id`, ascending.
    pub fn members(&self, id: u32) -> &[Vertex] {
        let id = id as usize;
        &self.members[self.offsets[id - 1]..self.offsets[id]]
    }

    /// Components in topological order, each as its ascending vertex slice.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &[Vertex]> + '_ {
        (1..self.count() as u32 + 1).map(move |id| self.members(id))
    }

    /// Size of the largest component.
    pub fn largest_size(&self) -> usize {
        self.iter().map(<[Vertex]>::len).max().unwrap_or(0)
    }

    /// Whether every component is a single vertex: the graph has no cycle
    /// (loops are not part of the adjacency).
    pub fn is_acyclic(&self) -> bool {
        self.count() == self.label.len() - 1
    }

    /// The vertices in a topological order (every arc forward), when the
    /// graph is acyclic.
    pub fn topological_order(&self) -> Option<Vec<Vertex>> {
        self.is_acyclic().then(|| self.members.clone())
    }

    /// The condensation: one vertex per component (its id), one arc per
    /// pair of components joined by at least one arc. Always acyclic.
    pub fn condensation<G: Graph>(&self, graph: &G) -> EdgeList {
        let arcs = graph.vertices().flat_map(|u| {
            let cu = self.component_of(u);
            graph
                .neighbors(u)
                .map(move |v| (cu, self.component_of(v)))
                .filter(|&(cu, cv)| cu != cv)
        });
        EdgeList::from_edges_with(self.count(), arcs, Orientation::Directed)
            .expect("component ids are within 1..=count")
    }

    /// Writes `count`, then one line per component: `id size vertices...`.
    pub fn write_to<W: Write>(&self, w: W) -> io::Result<()> {
        let mut w = io::BufWriter::new(w);
        writeln!(w, "strong_components {}", self.count())?;
        writeln!(w, "# component size vertices... (in topological order)")?;
        for (index, members) in self.iter().enumerate() {
            write!(w, "{} {}", index + 1, members.len())?;
            for v in members {
                write!(w, " {v}")?;
            }
            writeln!(w)?;
        }
        w.flush()
    }
}

/// The graph has a cycle, so it has no topological order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the graph has a cycle: a strongly connected component of {size} vertices")]
pub struct NotAcyclic {
    /// The size of its largest strongly connected component.
    pub size: usize,
}

/// Shortest paths from `root` on a directed acyclic graph: the arcs relaxed
/// in a topological order, `O(n + m)`, negative weights included (no cycle,
/// so no negative cycle). A graph with a cycle is refused.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, Orientation, algo};
/// let edges = EdgeList::parse_with(b"4\n1 2 3\n1 3 1\n3 2 -4\n2 4 1\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let tree = algo::dag_shortest_path(&graph, 1).unwrap();
/// assert_eq!(tree.distance(4), Some(-2.0));
/// assert_eq!(tree.path_to(4), Some(vec![1, 3, 2, 4]));
/// ```
pub fn dag_shortest_path<G: Weighted>(
    graph: &G,
    root: Vertex,
) -> Result<ShortestPathTree, NotAcyclic> {
    let components = StrongComponents::compute(graph);
    let order = components.topological_order().ok_or(NotAcyclic {
        size: components.largest_size(),
    })?;
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    tree.begin(root);
    let start = order.iter().position(|&v| v == root).expect("a vertex");
    for &u in &order[start..] {
        let distance = tree.distance[u as usize];
        if distance == Weight::INFINITY {
            continue;
        }
        for (v, weight) in graph.weighted_neighbors(u) {
            let through = distance + weight;
            if through < tree.distance[v as usize] {
                if tree.distance[v as usize] == Weight::INFINITY {
                    tree.touched.push(v);
                }
                tree.distance[v as usize] = through;
                tree.parent[v as usize] = u;
            }
        }
    }
    tree.settle_touched();
    Ok(tree)
}
