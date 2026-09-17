//! Connected components.

use super::traversal::{SearchTree, bfs_into};
use crate::graph::{Graph, Vertex};
use std::io::{self, Write};

/// The connected components of a graph, numbered `1..=count` from largest to
/// smallest. Ties are broken by the smallest vertex in the component, so the
/// numbering is deterministic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Components {
    /// Component id of every vertex (index 0 unused).
    label: Vec<u32>,
    /// `members[offsets[c-1]..offsets[c]]` are the vertices of component `c`, ascending.
    members: Vec<Vertex>,
    offsets: Vec<usize>,
}

impl Components {
    /// Finds the components with one BFS per component (`O(n + m)` total).
    pub fn compute<G: Graph>(graph: &G) -> Self {
        let n = graph.vertex_count();
        let mut label = vec![0u32; n + 1];
        let mut sizes: Vec<(usize, Vertex)> = Vec::new(); // (size, smallest vertex)
        let mut tree = SearchTree::new(n);
        for v in graph.vertices() {
            if label[v as usize] != 0 {
                continue;
            }
            bfs_into(graph, v, &mut tree, &mut ());
            let id = sizes.len() as u32 + 1;
            for &w in tree.order() {
                label[w as usize] = id;
            }
            sizes.push((tree.reached_count(), v));
        }

        // Rank components: largest first, then smallest vertex.
        let mut ranked: Vec<u32> = (0..sizes.len() as u32).collect();
        ranked.sort_by_key(|&c| (core::cmp::Reverse(sizes[c as usize].0), sizes[c as usize].1));
        let mut new_id = vec![0u32; sizes.len()];
        for (rank, &old) in ranked.iter().enumerate() {
            new_id[old as usize] = rank as u32 + 1;
        }
        for l in label.iter_mut().skip(1) {
            *l = new_id[(*l - 1) as usize];
        }

        // Counting sort of vertices by component.
        let mut offsets = vec![0usize; sizes.len() + 1];
        for &old in &ranked {
            let id = new_id[old as usize] as usize;
            offsets[id] = sizes[old as usize].0;
        }
        for c in 1..offsets.len() {
            offsets[c] += offsets[c - 1];
        }
        let mut cursor = offsets.clone();
        let mut members = vec![0 as Vertex; n];
        for v in graph.vertices() {
            let c = label[v as usize] as usize - 1;
            members[cursor[c]] = v;
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

    /// Size of component `id`.
    pub fn size(&self, id: u32) -> usize {
        self.members(id).len()
    }

    /// Size of the largest component.
    pub fn largest_size(&self) -> usize {
        self.size(1)
    }

    /// Size of the smallest component.
    pub fn smallest_size(&self) -> usize {
        self.size(self.count() as u32)
    }

    /// Components from largest to smallest, each as its ascending vertex slice.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &[Vertex]> + '_ {
        (1..self.count() as u32 + 1).map(move |id| self.members(id))
    }

    /// Sizes from largest to smallest.
    pub fn sizes(&self) -> impl ExactSizeIterator<Item = usize> + '_ {
        self.iter().map(<[Vertex]>::len)
    }

    /// Writes `count`, then one line per component: `id size vertices...`.
    pub fn write_to<W: Write>(&self, w: W) -> io::Result<()> {
        let mut w = io::BufWriter::new(w);
        writeln!(w, "components {}", self.count())?;
        writeln!(w, "# component size vertices...")?;
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
