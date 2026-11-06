//! Collaboration networks: a weighted graph built from who wrote with whom.
//!
//! The course's `rede_colaboracao.txt` is DBLP's co-authorship graph: a
//! vertex per researcher who ever wrote with someone, an edge between two
//! researchers who share a paper, and on the edge a distance that shrinks
//! as they write more together. This module builds such a graph from a
//! stream of papers (a year and the authors' names, from any source: the
//! CLI's `dblp` command reads the DBLP XML dump) and writes it in the
//! course format, whole or as it stood at the end of any year.
//!
//! # Weights
//!
//! An edge weighs `1 / p`, where `p` is how many papers the two researchers
//! share, as the course's professor defines it: one paper is distance 1,
//! four papers are distance 0.25, so no weight passes 1 and frequent
//! co-authors end up close. A paper counts the same for all of its pairs,
//! however many authors it has. The course's 2009 file follows an older
//! rule (weights from 0.0037 to 113), so a network built here has that
//! file's vertices and edges but not its weights.
//!
//! # Numbering
//!
//! Vertices are numbered by the year of their first co-authored paper,
//! then by name, so the network as it stood at the end of year `y` is the
//! prefix `1..=n_y` of the full numbering: a year's names file is the first
//! `n_y` lines of the full one, and only its edge file differs (its weights
//! count the papers up to that year). Papers without a year belong to the
//! full network only.
//!
//! # One file per year
//!
//! [`Network::strengths`] gives every pair's strength year by year (the
//! papers it shared that year), so a network can be published as one small
//! file per year and any year's weights recovered by summing the files up
//! to it and inverting the sums: exactly what [`Network::edges`] gives.
//!
//! ```
//! use graphman::io::Papers;
//!
//! let mut papers = Papers::new();
//! papers.paper(Some(1984), ["Éva Tardos", "András Frank"]);
//! papers.paper(Some(1990), ["Éva Tardos", "Andrew V. Goldberg", "Robert E. Tarjan"]);
//! papers.paper(Some(1991), ["Éva Tardos", "Andrew V. Goldberg"]);
//! papers.paper(None, ["Alone"]); // a single author collaborates with no one
//! let network = papers.finish();
//!
//! assert_eq!(network.vertex_count(None), 4);
//! assert_eq!(network.vertex_count(Some(1984)), 2); // Frank and Tardos, by name
//! assert_eq!(network.name(1), Some("András Frank"));
//! // Tardos and Goldberg share two papers, so they are at distance 1/2.
//! let edges: Vec<_> = network.edges(None).collect();
//! assert!(edges.contains(&(2, 3, 0.5)));
//! // Up to 1990 they share only the first, so they are at distance 1.
//! assert!(network.edges(Some(1990)).any(|e| e == (2, 3, 1.0)));
//! ```

use crate::{EdgeList, ParseError, Vertex, Weight};
use std::collections::HashMap;
use std::fmt;
use std::io::{self, BufWriter, Write};

/// The year of a paper that has none. Such papers count in the whole
/// network and in no year's; an author known only through them is numbered
/// after everyone else.
pub const YEAR_UNKNOWN: u16 = u16::MAX;

/// One paper of one pair, and the year it counts from.
#[derive(Clone, Copy, Debug)]
struct Term {
    u: u32,
    v: u32,
    year: u16,
}

/// Papers being collected; `finish` turns them into a [`Network`].
///
/// Authors are identified by their exact name, as DBLP does (it already
/// tells namesakes apart with a numeric suffix). An author who never wrote
/// with anyone is not a vertex.
#[derive(Default)]
pub struct Papers {
    /// Each name's provisional id, in order of first appearance.
    by_name: HashMap<String, u32>,
    /// Per provisional id, the earliest year of a co-authored paper.
    first_year: Vec<u16>,
    terms: Vec<Term>,
    papers: usize,
    largest: usize,
}

impl Papers {
    /// No papers yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a paper. Blank names are ignored and a name listed twice counts
    /// once; a paper with fewer than two distinct authors adds nothing.
    /// Returns whether the paper counted.
    pub fn paper<'a>(
        &mut self,
        year: Option<u16>,
        authors: impl IntoIterator<Item = &'a str>,
    ) -> bool {
        let mut names: Vec<&str> = authors
            .into_iter()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .collect();
        names.sort_unstable();
        names.dedup();
        if names.len() < 2 {
            return false;
        }
        let year = year.unwrap_or(YEAR_UNKNOWN);
        let ids: Vec<u32> = names.iter().map(|name| self.intern(name, year)).collect();
        for (i, &a) in ids.iter().enumerate() {
            for &b in &ids[i + 1..] {
                let (u, v) = if a < b { (a, b) } else { (b, a) };
                self.terms.push(Term { u, v, year });
            }
        }
        self.papers += 1;
        self.largest = self.largest.max(names.len());
        true
    }

    fn intern(&mut self, name: &str, year: u16) -> u32 {
        if let Some(&id) = self.by_name.get(name) {
            let first = &mut self.first_year[id as usize];
            *first = (*first).min(year);
            return id;
        }
        let id = self.first_year.len() as u32;
        self.by_name.insert(name.to_owned(), id);
        self.first_year.push(year);
        id
    }

    /// Papers that counted (two or more distinct authors).
    pub fn paper_count(&self) -> usize {
        self.papers
    }

    /// Distinct authors seen on those papers: the network's vertices.
    pub fn author_count(&self) -> usize {
        self.first_year.len()
    }

    /// The most authors one paper had.
    pub fn largest_paper(&self) -> usize {
        self.largest
    }

    /// Numbers the authors and sorts the contributions by pair, so that any
    /// year's network can be read off in one pass.
    pub fn finish(self) -> Network {
        let Papers {
            by_name,
            first_year,
            mut terms,
            ..
        } = self;
        let n = first_year.len();
        let mut names = vec![String::new(); n];
        for (name, id) in by_name {
            names[id as usize] = name;
        }
        let mut order: Vec<u32> = (0..n as u32).collect();
        order.sort_unstable_by(|&a, &b| {
            let (a, b) = (a as usize, b as usize);
            first_year[a]
                .cmp(&first_year[b])
                .then_with(|| names[a].cmp(&names[b]))
        });
        // Provisional id -> final 1-based vertex.
        let mut rank = vec![0u32; n];
        for (position, &old) in order.iter().enumerate() {
            rank[old as usize] = position as u32 + 1;
        }
        let mut ordered_names = Vec::with_capacity(n);
        let mut ordered_years = Vec::with_capacity(n);
        for &old in &order {
            ordered_names.push(std::mem::take(&mut names[old as usize]));
            ordered_years.push(first_year[old as usize]);
        }
        for term in &mut terms {
            let (u, v) = (rank[term.u as usize], rank[term.v as usize]);
            (term.u, term.v) = if u < v { (u, v) } else { (v, u) };
        }
        terms.sort_unstable_by_key(|t| (t.u, t.v, t.year));
        Network {
            names: ordered_names,
            first_year: ordered_years,
            terms,
        }
    }
}

/// A finished collaboration network, readable whole (`None`) or as it stood
/// at the end of a year (`Some(year)`).
pub struct Network {
    /// Vertex `v` is `names[v - 1]`.
    names: Vec<String>,
    /// Non-decreasing, by construction.
    first_year: Vec<u16>,
    /// Sorted by `(u, v, year)`, `u < v`.
    terms: Vec<Term>,
}

impl Network {
    /// Vertices of the network up to `until`: a prefix of the numbering.
    pub fn vertex_count(&self, until: Option<u16>) -> usize {
        match until {
            None => self.names.len(),
            Some(year) => self.first_year.partition_point(|&first| first <= year),
        }
    }

    /// The name of vertex `v` (`1..=n`).
    pub fn name(&self, v: Vertex) -> Option<&str> {
        v.checked_sub(1)
            .and_then(|i| self.names.get(i as usize))
            .map(String::as_str)
    }

    /// `(vertex, name)` for every vertex up to `until`, by vertex.
    pub fn names(&self, until: Option<u16>) -> impl Iterator<Item = (Vertex, &str)> + '_ {
        self.names[..self.vertex_count(until)]
            .iter()
            .enumerate()
            .map(|(i, name)| (i as Vertex + 1, name.as_str()))
    }

    /// The edges up to `until` as `(u, v, weight)`, `u < v`, sorted.
    pub fn edges(&self, until: Option<u16>) -> Edges<'_> {
        Edges {
            terms: &self.terms,
            at: 0,
            until: until.unwrap_or(YEAR_UNKNOWN),
        }
    }

    /// How many edges the network up to `until` has.
    pub fn edge_count(&self, until: Option<u16>) -> usize {
        self.edges(until).count()
    }

    /// Every pair's strength in every year it collaborated, sorted by
    /// `(u, v, year)`: how many papers the pair shared that year. Added up,
    /// the strengths of the years up to `until` invert to exactly the weight
    /// [`edges`] gives, which is how a network is rebuilt from one file per
    /// year.
    ///
    /// [`edges`]: Self::edges
    pub fn strengths(&self) -> Strengths<'_> {
        Strengths {
            terms: &self.terms,
            at: 0,
        }
    }

    /// The earliest and latest known publication years, if any paper had one.
    pub fn years(&self) -> Option<(u16, u16)> {
        self.terms
            .iter()
            .filter(|t| t.year != YEAR_UNKNOWN)
            .fold(None, |span, t| match span {
                None => Some((t.year, t.year)),
                Some((lo, hi)) => Some((lo.min(t.year), hi.max(t.year))),
            })
    }

    /// The network up to `until` as an edge list, ready to build.
    pub fn edge_list(&self, until: Option<u16>) -> Result<EdgeList, ParseError> {
        EdgeList::from_weighted_edges(self.vertex_count(until), self.edges(until))
    }

    /// Writes the edge file in the course format (the vertex count, then
    /// `u v weight` per line) and returns how many edges it wrote. Weights
    /// are printed with fifteen significant digits, as the course's file.
    pub fn write_edges<W: Write>(&self, until: Option<u16>, out: W) -> io::Result<usize> {
        let mut out = BufWriter::new(out);
        writeln!(out, "{}", self.vertex_count(until))?;
        let mut count = 0;
        for (u, v, weight) in self.edges(until) {
            writeln!(out, "{u} {v} {}", Fifteen(weight))?;
            count += 1;
        }
        out.flush()?;
        Ok(count)
    }

    /// Writes the names file (`vertex,name` per line, no header) and returns
    /// how many names it wrote.
    pub fn write_names<W: Write>(&self, until: Option<u16>, out: W) -> io::Result<usize> {
        let mut out = BufWriter::new(out);
        let mut count = 0;
        for (v, name) in self.names(until) {
            writeln!(out, "{v},{name}")?;
            count += 1;
        }
        out.flush()?;
        Ok(count)
    }
}

/// The edges of a [`Network`] up to a year: one per pair with at least one
/// paper by then, weighing the inverse of how many papers they share.
pub struct Edges<'a> {
    terms: &'a [Term],
    at: usize,
    until: u16,
}

impl Iterator for Edges<'_> {
    type Item = (Vertex, Vertex, Weight);

    fn next(&mut self) -> Option<Self::Item> {
        while let Some(&first) = self.terms.get(self.at) {
            let mut shared = 0u32;
            while let Some(term) = self.terms.get(self.at) {
                if (term.u, term.v) != (first.u, first.v) {
                    break;
                }
                shared += u32::from(term.year <= self.until);
                self.at += 1;
            }
            if shared > 0 {
                return Some((first.u, first.v, 1.0 / f64::from(shared)));
            }
        }
        None
    }
}

/// Every pair's strength in every year it collaborated, from
/// [`Network::strengths`]: `(u, v, year, papers)` sorted by `(u, v, year)`,
/// the year being [`YEAR_UNKNOWN`] for undated papers.
pub struct Strengths<'a> {
    terms: &'a [Term],
    at: usize,
}

impl Iterator for Strengths<'_> {
    type Item = (Vertex, Vertex, u16, u32);

    fn next(&mut self) -> Option<Self::Item> {
        let first = *self.terms.get(self.at)?;
        let mut papers = 0;
        while let Some(term) = self.terms.get(self.at) {
            if (term.u, term.v, term.year) != (first.u, first.v, first.year) {
                break;
            }
            papers += 1;
            self.at += 1;
        }
        Some((first.u, first.v, first.year, papers))
    }
}

/// A weight with fifteen significant digits and no trailing zeros, which is
/// how the course's collaboration file prints them (`3`, `0.5`,
/// `0.666666666666667`).
pub(crate) struct Fifteen(pub(crate) Weight);

impl fmt::Display for Fifteen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let weight = self.0;
        if weight.fract() == 0.0 && weight.abs() < 1e15 {
            return write!(f, "{}", weight as i64);
        }
        let magnitude = weight.abs().log10().floor() as i32;
        let decimals = (14 - magnitude).max(0) as usize;
        let text = format!("{weight:.decimals$}");
        f.write_str(text.trim_end_matches('0').trim_end_matches('.'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network() -> Network {
        let mut papers = Papers::new();
        papers.paper(Some(2000), ["Bia", "Ana"]);
        // Four authors: one paper for each of the six pairs, Ana and Bia's second.
        papers.paper(Some(2005), ["Ana", "Bia", "Caio", "Dora"]);
        // A name twice and a blank one: still two authors.
        papers.paper(Some(2010), ["Caio", "  ", "Eli", "Caio"]);
        // No year: in the full network only.
        papers.paper(None, ["Eli", "Fe"]);
        // Alone: not a vertex.
        papers.paper(Some(1990), ["Gil"]);
        assert_eq!(papers.paper_count(), 4);
        assert_eq!(papers.author_count(), 6);
        assert_eq!(papers.largest_paper(), 4);
        papers.finish()
    }

    #[test]
    fn numbers_by_first_year_then_name() {
        let network = network();
        let names: Vec<_> = network.names(None).collect();
        assert_eq!(
            names,
            [
                (1, "Ana"),
                (2, "Bia"),
                (3, "Caio"),
                (4, "Dora"),
                (5, "Eli"),
                (6, "Fe")
            ]
        );
        assert_eq!(network.vertex_count(Some(1999)), 0);
        assert_eq!(network.vertex_count(Some(2000)), 2);
        assert_eq!(network.vertex_count(Some(2005)), 4);
        assert_eq!(network.vertex_count(Some(2010)), 5);
        assert_eq!(network.vertex_count(None), 6);
        assert_eq!(network.name(6), Some("Fe"));
        assert_eq!(network.name(7), None);
        assert_eq!(network.name(0), None);
        assert_eq!(network.years(), Some((2000, 2010)));
    }

    #[test]
    fn weights_sum_the_papers_up_to_the_year() {
        let network = network();
        let full: Vec<_> = network.edges(None).collect();
        assert_eq!(
            full,
            [
                (1, 2, 0.5),
                (1, 3, 1.0),
                (1, 4, 1.0),
                (2, 3, 1.0),
                (2, 4, 1.0),
                (3, 4, 1.0),
                (3, 5, 1.0),
                (5, 6, 1.0),
            ]
        );
        assert!(full.iter().all(|&(_, _, weight)| weight <= 1.0));
        let early: Vec<_> = network.edges(Some(2000)).collect();
        assert_eq!(early, [(1, 2, 1.0)]);
        assert_eq!(network.edge_count(Some(2005)), 6);
        assert_eq!(network.edge_count(Some(2010)), 7);
        assert_eq!(network.edge_count(None), 8);
    }

    #[test]
    fn strengths_rebuild_every_year_exactly() {
        let mut papers = Papers::new();
        // A pair with two papers in one year and more in others.
        papers.paper(Some(2001), ["A", "B", "C"]);
        papers.paper(Some(2001), ["A", "B", "C", "D", "E", "F", "G"]);
        papers.paper(Some(2003), ["A", "B", "C", "D"]);
        papers.paper(
            Some(2007),
            ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
        );
        papers.paper(None, ["A", "B", "K"]);
        let network = papers.finish();
        let strengths: Vec<_> = network.strengths().collect();
        assert!(
            strengths
                .windows(2)
                .all(|w| (w[0].0, w[0].1, w[0].2) < (w[1].0, w[1].1, w[1].2))
        );
        assert_eq!(strengths[0], (1, 2, 2001, 2));
        for until in [Some(2000), Some(2001), Some(2003), Some(2007), None] {
            let mut rebuilt = std::collections::BTreeMap::new();
            for &(u, v, year, strength) in &strengths {
                if until.is_none_or(|limit| year <= limit) {
                    *rebuilt.entry((u, v)).or_insert(0) += strength;
                }
            }
            let expected: Vec<_> = network.edges(until).collect();
            let got: Vec<_> = rebuilt
                .into_iter()
                .map(|((u, v), s)| (u, v, 1.0 / f64::from(s)))
                .collect();
            assert_eq!(got, expected, "up to {until:?}");
        }
    }

    #[test]
    fn writes_the_course_format() {
        let network = network();
        let mut edges = Vec::new();
        assert_eq!(network.write_edges(Some(2005), &mut edges).unwrap(), 6);
        assert_eq!(
            String::from_utf8(edges).unwrap(),
            "4\n1 2 0.5\n1 3 1\n1 4 1\n2 3 1\n2 4 1\n3 4 1\n"
        );
        let mut names = Vec::new();
        assert_eq!(network.write_names(Some(2000), &mut names).unwrap(), 2);
        assert_eq!(String::from_utf8(names).unwrap(), "1,Ana\n2,Bia\n");
        let list = network.edge_list(None).unwrap();
        assert_eq!(list.vertex_count(), 6);
        assert_eq!(list.edge_count(), 8);
        assert!(list.is_weighted());
    }

    #[test]
    fn fifteen_significant_digits() {
        assert_eq!(Fifteen(3.0).to_string(), "3");
        assert_eq!(Fifteen(113.0).to_string(), "113");
        assert_eq!(Fifteen(0.5).to_string(), "0.5");
        assert_eq!(Fifteen(1.5).to_string(), "1.5");
        assert_eq!(Fifteen(2.0 / 3.0).to_string(), "0.666666666666667");
        assert_eq!(Fifteen(1.0 / 7.0 * 6.0).to_string(), "0.857142857142857");
        assert_eq!(
            Fifteen(0.00373459479646458).to_string(),
            "0.00373459479646458"
        );
    }
}
