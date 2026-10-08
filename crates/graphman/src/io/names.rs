//! Vertex names, read beside a graph.
//!
//! Graphs stay `u32` ids (labels live beside the graph, never in it); a
//! network whose vertices are people, like the course's collaboration
//! network, ships a second file mapping each index to a name:
//!
//! ```text
//! 1,Edsger W. Dijkstra
//! 2,Alan M. Turing
//! 3,Éva Tardos
//! ```
//!
//! The separator after the index may be a comma, a semicolon, a tab or
//! spaces; the name is the rest of the line. A first line that is only a
//! count, or a header without a leading index, is skipped. The file should
//! be UTF-8; one that is not is read as Latin-1, so `Éva` survives either way.

use crate::graph::Vertex;

/// Why a names file could not be read.
#[derive(Debug, thiserror::Error)]
pub enum NamesError {
    /// A line does not start with a vertex index.
    #[error("line {line}: expected `<vertex> <name>`, found {found:?}")]
    InvalidLine {
        /// 1-based line number.
        line: usize,
        /// What was there instead.
        found: String,
    },
    /// The same index appears twice.
    #[error("line {line}: vertex {vertex} already has a name")]
    DuplicateVertex {
        /// 1-based line number.
        line: usize,
        /// The repeated index.
        vertex: Vertex,
    },
    /// The file could not be read.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

/// The names of a graph's vertices: `name(v)` and its inverse, `vertex(name)`.
///
/// All names live in one string; one entry per named vertex, sorted by
/// vertex, holds the span of its name, and a second list of the entries
/// sorted by name answers exact lookups by binary search. A network of
/// hundreds of thousands of people costs its text plus twenty bytes per
/// name, no hashing, and nothing for the indices nobody named (a stray huge
/// index costs one entry, not a table that long).
#[derive(Debug, Clone, Default)]
pub struct VertexNames {
    text: String,
    /// One per named vertex, sorted by vertex once parsing is done.
    entries: Vec<Entry>,
    /// Indices into `entries`, sorted by (name, vertex).
    by_name: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
struct Entry {
    vertex: Vertex,
    start: u32,
    end: u32,
    /// Where it was read, for error messages.
    line: u32,
}

impl VertexNames {
    /// Parses a names file from memory.
    pub fn parse(bytes: &[u8]) -> Result<Self, NamesError> {
        let decoded: String = match core::str::from_utf8(bytes) {
            Ok(text) => text.to_owned(),
            // Not UTF-8: every byte is a Latin-1 code point.
            Err(_) => bytes.iter().map(|&b| b as char).collect(),
        };
        let mut names = Self::default();
        let mut seen_entry = false;
        for (index, raw) in decoded.lines().enumerate() {
            let line = raw.trim_start_matches('\u{feff}').trim();
            if line.is_empty() {
                continue;
            }
            let digits = line.bytes().take_while(u8::is_ascii_digit).count();
            let rest = line[digits..].trim_start_matches([',', ';', '\t', ' ']);
            if !seen_entry && (digits == 0 || rest.is_empty()) {
                // A header: a bare count, or column titles.
                seen_entry = true;
                continue;
            }
            seen_entry = true;
            let vertex = line[..digits]
                .parse::<Vertex>()
                .ok()
                .filter(|&v| v >= 1 && !rest.is_empty())
                .ok_or_else(|| NamesError::InvalidLine {
                    line: index + 1,
                    found: line.to_owned(),
                })?;
            names.insert(index + 1, vertex, rest.trim_end())?;
        }
        names.index()?;
        Ok(names)
    }

    /// Reads and parses a names file.
    pub fn from_path(path: impl AsRef<std::path::Path>) -> Result<Self, NamesError> {
        Self::parse(&std::fs::read(path)?)
    }

    /// Builds names from `(vertex, name)` pairs.
    pub fn from_pairs<'a>(
        pairs: impl IntoIterator<Item = (Vertex, &'a str)>,
    ) -> Result<Self, NamesError> {
        let mut names = Self::default();
        for (index, (vertex, name)) in pairs.into_iter().enumerate() {
            names.insert(index + 1, vertex, name)?;
        }
        names.index()?;
        Ok(names)
    }

    fn insert(&mut self, line: usize, vertex: Vertex, name: &str) -> Result<(), NamesError> {
        if vertex == 0 || name.is_empty() {
            return Err(NamesError::InvalidLine {
                line,
                found: format!("{vertex} {name:?}"),
            });
        }
        let start = self.text.len() as u32;
        self.text.push_str(name);
        self.entries.push(Entry {
            vertex,
            start,
            end: self.text.len() as u32,
            line: line as u32,
        });
        Ok(())
    }

    /// Sorts the entries by vertex (refusing a vertex named twice) and builds
    /// the by-name index.
    fn index(&mut self) -> Result<(), NamesError> {
        self.entries.sort_by_key(|e| (e.vertex, e.line));
        if let Some(pair) = self.entries.windows(2).find(|w| w[0].vertex == w[1].vertex) {
            return Err(NamesError::DuplicateVertex {
                line: pair[1].line as usize,
                vertex: pair[1].vertex,
            });
        }
        let mut by_name: Vec<u32> = (0..self.entries.len() as u32).collect();
        by_name.sort_by(|&a, &b| self.entry_name(a).cmp(self.entry_name(b)).then(a.cmp(&b)));
        self.by_name = by_name;
        Ok(())
    }

    fn entry_name(&self, index: u32) -> &str {
        let entry = self.entries[index as usize];
        &self.text[entry.start as usize..entry.end as usize]
    }

    /// Number of named vertices.
    pub fn len(&self) -> usize {
        self.by_name.len()
    }

    /// Whether no vertex has a name.
    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    /// The largest named vertex (`0` when there is none).
    pub fn max_vertex(&self) -> Vertex {
        self.entries.last().map_or(0, |e| e.vertex)
    }

    /// The name of `v`, if it has one.
    pub fn name(&self, v: Vertex) -> Option<&str> {
        let index = self.entries.binary_search_by_key(&v, |e| e.vertex).ok()?;
        Some(self.entry_name(index as u32))
    }

    /// The vertex with exactly this name (the smallest id if several share it).
    pub fn vertex(&self, name: &str) -> Option<Vertex> {
        let first = self.by_name.partition_point(|&i| self.entry_name(i) < name);
        self.by_name
            .get(first)
            .copied()
            .filter(|&i| self.entry_name(i) == name)
            .map(|i| self.entries[i as usize].vertex)
    }

    /// Up to `limit` vertices whose names contain every word of `query`,
    /// ignoring case and accents: the suggestions for a near miss.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Vertex> {
        let words: Vec<String> = query.split_whitespace().map(fold).collect();
        if words.is_empty() {
            return Vec::new();
        }
        self.by_name
            .iter()
            .copied()
            .filter(|&i| {
                let name = fold(self.entry_name(i));
                words.iter().all(|word| name.contains(word.as_str()))
            })
            .take(limit)
            .map(|i| self.entries[i as usize].vertex)
            .collect()
    }
}

/// Lower case without the accents of Latin letters, for forgiving search.
fn fold(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ý' | 'ÿ' => 'y',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_indices_and_names_with_any_separator() {
        let names = VertexNames::parse(
            "3\n1,Edsger W. Dijkstra\n2;Alan M. Turing\n3\tÉva Tardos\n\n5 J. B. Kruskal \n"
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(names.len(), 4);
        assert_eq!(names.max_vertex(), 5);
        assert_eq!(names.name(1), Some("Edsger W. Dijkstra"));
        assert_eq!(names.name(3), Some("Éva Tardos"));
        assert_eq!(names.name(4), None);
        assert_eq!(names.name(99), None);
        assert_eq!(names.vertex("J. B. Kruskal"), Some(5));
        assert_eq!(names.vertex("Éva Tardos"), Some(3));
        assert_eq!(names.vertex("Eva Tardos"), None);
        assert_eq!(names.search("eva tardos", 5), vec![3]);
        assert_eq!(names.search("TURING", 5), vec![2]);
    }

    #[test]
    fn reads_latin_1_and_skips_headers() {
        let latin1 = b"id,name\n7,\xc9va Tardos\n";
        let names = VertexNames::parse(latin1).unwrap();
        assert_eq!(names.vertex("Éva Tardos"), Some(7));
    }

    #[test]
    fn rejects_bad_lines_and_duplicates() {
        assert!(matches!(
            VertexNames::parse(b"1,Ada\nBabbage\n"),
            Err(NamesError::InvalidLine { line: 2, .. })
        ));
        assert!(matches!(
            VertexNames::parse(b"1,Ada\n1,Babbage\n"),
            Err(NamesError::DuplicateVertex { line: 2, vertex: 1 })
        ));
        assert!(matches!(
            VertexNames::parse(b"1,Ada\n0,Nobody\n"),
            Err(NamesError::InvalidLine { line: 2, .. })
        ));
    }

    #[test]
    fn a_huge_index_costs_one_entry() {
        let names = VertexNames::parse(b"4000000000,Far Away\n2,Near\n").unwrap();
        assert_eq!(names.max_vertex(), 4_000_000_000);
        assert_eq!(names.name(4_000_000_000), Some("Far Away"));
        assert_eq!(names.name(3), None);
        assert_eq!(names.vertex("Near"), Some(2));
    }

    #[test]
    fn shared_names_resolve_to_the_smallest_id() {
        let names =
            VertexNames::from_pairs([(4, "Wei Wang"), (2, "Wei Wang"), (3, "Ada")]).unwrap();
        assert_eq!(names.vertex("Wei Wang"), Some(2));
        assert_eq!(names.search("wang", 10), vec![2, 4]);
    }
}
