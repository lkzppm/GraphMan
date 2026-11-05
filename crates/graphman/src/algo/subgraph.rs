//! Cutting a graph down to size: which vertices to keep, and the graph they
//! induce, renumbered from 1 and written in the course format. This is what
//! the observatory's DBLP workbench builds out of a year's whole
//! collaboration network: a ball around one researcher, the most connected
//! ones, or the earliest.

use crate::algo::{Control, SearchTree, Visitor, bfs_into};
use crate::graph::{Graph, Vertex, Weight, Weighted};
use crate::io::collaboration::Fifteen;
use crate::io::{EdgeList, ParseError, VertexNames};
use std::cmp::Reverse;
use std::io::{self, BufWriter, Write};
use std::ops::Range;

/// Which vertices a cut keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubgraphRule {
    /// A BFS from the seed, stopped once `max` vertices are discovered: one
    /// connected piece (or the seed's whole component when it is smaller),
    /// the seed first.
    Ball,
    /// The `max` vertices of highest degree, ties by id, the highest first.
    MostConnected,
    /// Vertices `1..=max` as numbered (in a collaboration network, the
    /// earliest to co-author a paper).
    Earliest,
}

/// The vertices `rule` keeps, in the order that will number them. A `seed`
/// outside the graph means vertex 1; `max` past the graph means all of it.
pub fn select<G: Graph>(graph: &G, rule: SubgraphRule, seed: Vertex, max: usize) -> Vec<Vertex> {
    let n = graph.vertex_count();
    let max = max.min(n);
    if max == 0 {
        return Vec::new();
    }
    match rule {
        SubgraphRule::Ball => {
            let seed = if (1..=n as Vertex).contains(&seed) {
                seed
            } else {
                1
            };
            let mut tree = SearchTree::new(n);
            let mut cap = Cap { left: max };
            bfs_into(graph, seed, &mut tree, &mut cap);
            let order = tree.order();
            order[..max.min(order.len())].to_vec()
        }
        SubgraphRule::MostConnected => {
            let mut ids: Vec<Vertex> = (1..=n as Vertex).collect();
            let key = |v: &Vertex| (Reverse(graph.degree(*v)), *v);
            if max < n {
                ids.select_nth_unstable_by_key(max, key);
                ids.truncate(max);
            }
            ids.sort_unstable_by_key(key);
            ids
        }
        SubgraphRule::Earliest => (1..=max as Vertex).collect(),
    }
}

/// Stops a BFS once it has discovered as many vertices as wanted.
struct Cap {
    left: usize,
}

impl Visitor for Cap {
    fn discover(&mut self, _v: Vertex, _parent: Vertex, _level: u32) -> Control {
        self.left -= 1;
        if self.left == 0 {
            Control::Break
        } else {
            Control::Continue
        }
    }
}

/// A cut: the kept vertices and the edges among them, renumbered so that
/// `kept[i]` is vertex `i + 1`.
#[derive(Debug, Clone)]
pub struct Induced {
    kept: Vec<Vertex>,
    /// `(u, v, weight)` in the new numbering, `u < v`, sorted.
    edges: Vec<(Vertex, Vertex, Weight)>,
    weighted: bool,
}

/// The subgraph `kept` induces in `graph`, numbered in `kept`'s order.
pub fn induce<G: Weighted>(graph: &G, kept: Vec<Vertex>) -> Induced {
    let mut new_id = vec![0u32; graph.vertex_count() + 1];
    for (index, &v) in kept.iter().enumerate() {
        new_id[v as usize] = index as u32 + 1;
    }
    let mut edges = Vec::new();
    for &old in &kept {
        let u = new_id[old as usize];
        for (neighbour, weight) in graph.weighted_neighbors(old) {
            let v = new_id[neighbour as usize];
            if v > u {
                edges.push((u, v, weight));
            }
        }
    }
    edges.sort_unstable_by_key(|&(u, v, _)| (u, v));
    Induced {
        kept,
        edges,
        weighted: graph.is_weighted(),
    }
}

impl Induced {
    /// The source's vertices in the new order: `kept()[i]` is vertex `i + 1`.
    pub fn kept(&self) -> &[Vertex] {
        &self.kept
    }

    /// How many vertices the cut keeps.
    pub fn vertex_count(&self) -> usize {
        self.kept.len()
    }

    /// How many edges run among them.
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// The edges in the new numbering, `u < v`, sorted.
    pub fn edges(&self) -> &[(Vertex, Vertex, Weight)] {
        &self.edges
    }

    /// The cut as an edge list, ready to build.
    pub fn edge_list(&self) -> Result<EdgeList, ParseError> {
        if self.weighted {
            EdgeList::from_weighted_edges(self.kept.len(), self.edges.iter().copied())
        } else {
            EdgeList::from_edges(self.kept.len(), self.edges.iter().map(|&(u, v, _)| (u, v)))
        }
    }

    /// Writes the edge file in the course format: the vertex count, then
    /// `u v` or `u v weight` per line (weights with fifteen significant
    /// digits, as the collaboration network's).
    pub fn write_edges<W: Write>(&self, out: W) -> io::Result<()> {
        self.write_edge_lines(0..self.edge_lines(), out)
    }

    /// How many lines the edge file has: the vertex count, then one per edge.
    pub fn edge_lines(&self) -> usize {
        self.edges.len() + 1
    }

    /// Writes only these lines of the edge file (line 0 is the vertex
    /// count), so a file too large to hold whole can be written in pieces.
    pub fn write_edge_lines<W: Write>(&self, lines: Range<usize>, out: W) -> io::Result<()> {
        let mut out = BufWriter::new(out);
        if lines.start == 0 && lines.end > 0 {
            writeln!(out, "{}", self.kept.len())?;
        }
        let edges = lines.start.saturating_sub(1)..lines.end.saturating_sub(1);
        for &(u, v, weight) in &self.edges[edges] {
            if self.weighted {
                writeln!(out, "{u} {v} {}", Fifteen(weight))?;
            } else {
                writeln!(out, "{u} {v}")?;
            }
        }
        out.flush()
    }

    /// The edge file's size in bytes: exact for a small cut, otherwise an
    /// estimate from a sample of its lines (a preview must stay instant).
    pub fn file_bytes(&self) -> u64 {
        const EXACT_UP_TO: usize = 200_000;
        const SAMPLE: usize = 10_000;
        let header = self.kept.len().to_string().len() as u64 + 1;
        let line = |&(u, v, weight): &(Vertex, Vertex, Weight)| -> u64 {
            let ids = digits(u) + 1 + digits(v) + 1;
            if self.weighted {
                ids + Fifteen(weight).to_string().len() as u64 + 1
            } else {
                ids
            }
        };
        let m = self.edges.len();
        if m <= EXACT_UP_TO {
            return header + self.edges.iter().map(line).sum::<u64>();
        }
        let step = m / SAMPLE;
        let sampled: u64 = self.edges.iter().step_by(step).map(line).sum();
        let count = m.div_ceil(step) as u64;
        header + sampled * m as u64 / count
    }

    /// Writes the names file (`vertex,name` per line) for the kept vertices
    /// that have a name, and returns how many that is.
    pub fn write_names<W: Write>(&self, names: &VertexNames, out: W) -> io::Result<usize> {
        self.write_name_lines(names, 0..self.kept.len(), out)
    }

    /// Writes the names of only these kept vertices (by their place in
    /// [`kept`](Self::kept)), and returns how many had one.
    pub fn write_name_lines<W: Write>(
        &self,
        names: &VertexNames,
        kept: Range<usize>,
        out: W,
    ) -> io::Result<usize> {
        let mut out = BufWriter::new(out);
        let mut count = 0;
        let start = kept.start;
        for (index, &old) in self.kept[kept].iter().enumerate() {
            if let Some(name) = names.name(old) {
                writeln!(out, "{},{name}", start + index + 1)?;
                count += 1;
            }
        }
        out.flush()?;
        Ok(count)
    }
}

fn digits(v: Vertex) -> u64 {
    if v == 0 { 1 } else { v.ilog10() as u64 + 1 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::Build;
    use crate::{Csr, EdgeList};

    /// Two triangles joined by one edge, plus an isolated vertex 7:
    /// 1-2-3 (triangle), 3-4, 4-5-6 (triangle), and 2 has an extra edge to 5.
    fn graph() -> Csr {
        let edges = EdgeList::from_weighted_edges(
            7,
            [
                (1, 2, 0.5),
                (2, 3, 1.0),
                (1, 3, 2.0),
                (3, 4, 1.5),
                (4, 5, 1.0),
                (5, 6, 1.0),
                (4, 6, 3.0),
                (2, 5, 0.25),
            ],
        )
        .unwrap();
        Csr::build(&edges).unwrap()
    }

    #[test]
    fn rules_pick_their_vertices() {
        let g = graph();
        assert_eq!(select(&g, SubgraphRule::Ball, 1, 3), [1, 2, 3]);
        assert_eq!(select(&g, SubgraphRule::Ball, 1, 4), [1, 2, 3, 5]);
        // A seed outside the graph means 1; a max past the graph is all of it.
        assert_eq!(select(&g, SubgraphRule::Ball, 99, 2), [1, 2]);
        assert_eq!(select(&g, SubgraphRule::Ball, 1, 100), [1, 2, 3, 5, 4, 6]);
        assert_eq!(select(&g, SubgraphRule::Ball, 7, 3), [7]);
        // Degrees: 1:2, 2:3, 3:3, 4:3, 5:3, 6:2, 7:0.
        assert_eq!(select(&g, SubgraphRule::MostConnected, 0, 3), [2, 3, 4]);
        assert_eq!(
            select(&g, SubgraphRule::MostConnected, 0, 7),
            [2, 3, 4, 5, 1, 6, 7]
        );
        assert_eq!(select(&g, SubgraphRule::Earliest, 0, 2), [1, 2]);
        assert!(select(&g, SubgraphRule::Earliest, 0, 0).is_empty());
    }

    #[test]
    fn induces_and_renumbers() {
        let g = graph();
        let cut = induce(&g, select(&g, SubgraphRule::Ball, 4, 3));
        // BFS from 4: 4, then 3, 5 (ascending), so 4 -> 1, 3 -> 2, 5 -> 3.
        assert_eq!(cut.kept(), [4, 3, 5]);
        assert_eq!(cut.edges(), [(1, 2, 1.5), (1, 3, 1.0)]);
        let mut text = Vec::new();
        cut.write_edges(&mut text).unwrap();
        let text = String::from_utf8(text).unwrap();
        assert_eq!(text, "3\n1 2 1.5\n1 3 1\n");
        assert_eq!(cut.file_bytes(), text.len() as u64);
        let names = VertexNames::from_pairs([(3, "Three"), (4, "Four"), (7, "Seven")]).unwrap();
        let mut out = Vec::new();
        assert_eq!(cut.write_names(&names, &mut out).unwrap(), 2);
        assert_eq!(String::from_utf8(out).unwrap(), "1,Four\n2,Three\n");
        let list = cut.edge_list().unwrap();
        assert_eq!((list.vertex_count(), list.edge_count()), (3, 2));
    }

    #[test]
    fn files_written_in_pieces_match_the_whole() {
        let g = graph();
        let cut = induce(&g, select(&g, SubgraphRule::Ball, 4, 3));
        let mut whole = Vec::new();
        cut.write_edges(&mut whole).unwrap();
        for step in 1..=cut.edge_lines() {
            let mut pieces = Vec::new();
            let mut line = 0;
            while line < cut.edge_lines() {
                let end = (line + step).min(cut.edge_lines());
                cut.write_edge_lines(line..end, &mut pieces).unwrap();
                line = end;
            }
            assert_eq!(pieces, whole, "edge file in pieces of {step} lines");
        }
        let names = VertexNames::from_pairs([(3, "Three"), (4, "Four"), (5, "Five")]).unwrap();
        let mut whole = Vec::new();
        assert_eq!(cut.write_names(&names, &mut whole).unwrap(), 3);
        let mut pieces = Vec::new();
        for place in 0..cut.vertex_count() {
            let wrote = cut
                .write_name_lines(&names, place..place + 1, &mut pieces)
                .unwrap();
            assert_eq!(wrote, 1);
        }
        assert_eq!(pieces, whole);
    }

    #[test]
    fn unweighted_cuts_write_two_columns() {
        let edges = EdgeList::from_edges(4, [(1, 2), (2, 3), (3, 4)]).unwrap();
        let g = Csr::build(&edges).unwrap();
        let cut = induce(&g, select(&g, SubgraphRule::Earliest, 0, 3));
        let mut text = Vec::new();
        cut.write_edges(&mut text).unwrap();
        assert_eq!(String::from_utf8(text).unwrap(), "3\n1 2\n2 3\n");
        assert_eq!(cut.file_bytes(), 10);
        assert!(!cut.edge_list().unwrap().is_weighted());
    }
}
