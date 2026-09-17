//! The course's edge-list text format.
//!
//! ```text
//! 5        <- number of vertices
//! 1 2      <- one edge per line
//! 2 5
//! 5 3
//! 4 5
//! 1 5
//! ```

use crate::graph::Vertex;
use core::mem::size_of;
use memchr::memchr_iter;

/// A normalised edge list: the intermediate every representation is built from.
///
/// Normalisation happens once, here, so that every representation agrees on
/// what the graph is: self-loops are dropped, each undirected edge is stored
/// once as `[min, max]`, duplicates are removed and the list is sorted. The
/// sorted order is what lets the builders produce ascending neighbour rows
/// without sorting anything themselves.
#[derive(Debug)]
pub struct EdgeList {
    vertex_count: usize,
    edges: EdgeStore,
    self_loops_dropped: usize,
    duplicates_dropped: usize,
}

impl PartialEq for EdgeList {
    fn eq(&self, other: &Self) -> bool {
        self.vertex_count == other.vertex_count && self.edges() == other.edges()
    }
}

impl Eq for EdgeList {}

/// Where the edge array lives.
///
/// Heap allocators keep freed blocks around (macOS even defers reclaiming
/// them until memory pressure), so a heap-allocated edge list would inflate
/// every memory measurement by its own size long after it was dropped. With
/// the `mmap` feature large edge lists live in an anonymous mapping instead,
/// which the kernel takes back the moment it is unmapped.
enum EdgeStore {
    Heap(Vec<[Vertex; 2]>),
    #[cfg(feature = "mmap")]
    Mapped {
        map: memmap2::MmapMut,
        len: usize,
    },
}

impl EdgeStore {
    /// Edge lists below this size are not worth a mapping of their own.
    #[cfg(feature = "mmap")]
    const MAPPED_THRESHOLD: usize = 1 << 16;

    fn with_capacity(capacity: usize) -> Self {
        #[cfg(feature = "mmap")]
        if capacity >= Self::MAPPED_THRESHOLD
            && let Ok(map) = memmap2::MmapMut::map_anon(capacity * size_of::<[Vertex; 2]>())
        {
            return EdgeStore::Mapped { map, len: 0 };
        }
        EdgeStore::Heap(Vec::with_capacity(capacity))
    }

    fn push(&mut self, edge: [Vertex; 2]) {
        match self {
            EdgeStore::Heap(vec) => vec.push(edge),
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                let capacity = map.len() / size_of::<[Vertex; 2]>();
                assert!(*len < capacity, "edge store capacity exceeded");
                let bytes = &mut map[*len * size_of::<[Vertex; 2]>()..][..size_of::<[Vertex; 2]>()];
                bytes[..4].copy_from_slice(&edge[0].to_ne_bytes());
                bytes[4..].copy_from_slice(&edge[1].to_ne_bytes());
                *len += 1;
            }
        }
    }

    fn as_slice(&self) -> &[[Vertex; 2]] {
        match self {
            EdgeStore::Heap(vec) => vec,
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                // SAFETY: the mapping is page aligned (so aligned for u32), its
                // first `len` edges were written by `push`, every bit pattern
                // is a valid `u32`, and the slice borrows `map` immutably.
                unsafe { core::slice::from_raw_parts(map.as_ptr().cast::<[Vertex; 2]>(), *len) }
            }
        }
    }

    fn as_mut_slice(&mut self) -> &mut [[Vertex; 2]] {
        match self {
            EdgeStore::Heap(vec) => vec,
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                // SAFETY: as in `as_slice`, with a unique borrow of `map`.
                unsafe {
                    core::slice::from_raw_parts_mut(map.as_mut_ptr().cast::<[Vertex; 2]>(), *len)
                }
            }
        }
    }

    fn truncate(&mut self, new_len: usize) {
        match self {
            EdgeStore::Heap(vec) => vec.truncate(new_len),
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { len, .. } => *len = (*len).min(new_len),
        }
    }
}

impl core::fmt::Debug for EdgeStore {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("EdgeStore")
            .field("len", &self.as_slice().len())
            .finish()
    }
}

/// Why a file could not be parsed.
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// The input has no vertex count.
    #[error("the input is empty")]
    Empty,
    /// The first line is not a positive integer.
    #[error("line {line}: expected the number of vertices, found {found:?}")]
    InvalidVertexCount {
        /// 1-based line number.
        line: usize,
        /// What was there instead.
        found: String,
    },
    /// An edge line is not two integers.
    #[error("line {line}: expected two vertex ids separated by whitespace, found {found:?}")]
    InvalidEdge {
        /// 1-based line number.
        line: usize,
        /// What was there instead.
        found: String,
    },
    /// A vertex id is not within `1..=n`.
    #[error("line {line}: vertex {vertex} is outside 1..={vertex_count}")]
    VertexOutOfRange {
        /// 1-based line number.
        line: usize,
        /// The offending id.
        vertex: u64,
        /// The declared vertex count.
        vertex_count: usize,
    },
    /// The file could not be read.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

impl EdgeList {
    /// Parses the text format from memory.
    pub fn parse(bytes: &[u8]) -> Result<Self, ParseError> {
        let mut lines = Lines::new(bytes);
        let (line_no, header) = loop {
            match lines.next() {
                Some((_, [])) => continue,
                Some(found) => break found,
                None => return Err(ParseError::Empty),
            }
        };
        let vertex_count =
            parse_u64(header)
                .filter(|&n| n >= 1)
                .ok_or_else(|| ParseError::InvalidVertexCount {
                    line: line_no,
                    found: String::from_utf8_lossy(header).into_owned(),
                })? as usize;

        let mut raw = EdgeStore::with_capacity(lines.remaining_lines());
        for (line_no, line) in lines {
            if line.is_empty() {
                continue;
            }
            let (a, b) = parse_pair(line).ok_or_else(|| ParseError::InvalidEdge {
                line: line_no,
                found: String::from_utf8_lossy(line).into_owned(),
            })?;
            for vertex in [a, b] {
                if vertex < 1 || vertex > vertex_count as u64 {
                    return Err(ParseError::VertexOutOfRange {
                        line: line_no,
                        vertex,
                        vertex_count,
                    });
                }
            }
            raw.push([a as Vertex, b as Vertex]);
        }
        Ok(Self::normalise(vertex_count, raw))
    }

    /// Reads and parses a file. With the `mmap` feature the file is memory
    /// mapped and parsed in place; otherwise it is read into memory first.
    pub fn from_path(path: impl AsRef<std::path::Path>) -> Result<Self, ParseError> {
        let file = std::fs::File::open(path)?;
        #[cfg(feature = "mmap")]
        {
            // SAFETY: the mapping is read-only and lives only for the duration
            // of the parse; the course graphs are never modified concurrently.
            let map = unsafe { memmap2::Mmap::map(&file)? };
            #[cfg(unix)]
            let _ = map.advise(memmap2::Advice::Sequential);
            Self::parse(&map)
        }
        #[cfg(not(feature = "mmap"))]
        {
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut &file, &mut bytes)?;
            Self::parse(&bytes)
        }
    }

    /// Builds an edge list from in-memory edges (mainly for tests and generators).
    pub fn from_edges(
        vertex_count: usize,
        edges: impl IntoIterator<Item = (Vertex, Vertex)>,
    ) -> Result<Self, ParseError> {
        let mut raw = EdgeStore::Heap(Vec::new());
        for (line, (a, b)) in edges.into_iter().enumerate() {
            for vertex in [a, b] {
                if vertex < 1 || vertex as usize > vertex_count {
                    return Err(ParseError::VertexOutOfRange {
                        line: line + 2,
                        vertex: vertex as u64,
                        vertex_count,
                    });
                }
            }
            raw.push([a, b]);
        }
        Ok(Self::normalise(vertex_count, raw))
    }

    fn normalise(vertex_count: usize, mut raw: EdgeStore) -> Self {
        // Drop self-loops and orient every edge as [min, max], compacting in place.
        let edges = raw.as_mut_slice();
        let before = edges.len();
        let mut kept = 0;
        for i in 0..before {
            let [a, b] = edges[i];
            if a != b {
                edges[kept] = if a < b { [a, b] } else { [b, a] };
                kept += 1;
            }
        }
        let self_loops_dropped = before - kept;
        raw.truncate(kept);

        // Sort, then remove duplicates, again compacting in place.
        let edges = raw.as_mut_slice();
        edges.sort_unstable();
        let before = edges.len();
        let mut kept = 0;
        for i in 0..before {
            if kept == 0 || edges[i] != edges[kept - 1] {
                edges[kept] = edges[i];
                kept += 1;
            }
        }
        let duplicates_dropped = before - kept;
        raw.truncate(kept);
        if let EdgeStore::Heap(vec) = &mut raw {
            vec.shrink_to_fit();
        }
        Self {
            vertex_count,
            edges: raw,
            self_loops_dropped,
            duplicates_dropped,
        }
    }

    /// Number of vertices declared in the file.
    pub fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    /// Number of unique, loop-free undirected edges.
    pub fn edge_count(&self) -> usize {
        self.edges().len()
    }

    /// The edges as sorted `[min, max]` pairs.
    pub fn edges(&self) -> &[[Vertex; 2]] {
        self.edges.as_slice()
    }

    /// Self-loops (`u u`) that were discarded.
    pub fn self_loops_dropped(&self) -> usize {
        self.self_loops_dropped
    }

    /// Repeated edges that were discarded.
    pub fn duplicates_dropped(&self) -> usize {
        self.duplicates_dropped
    }

    /// Degree of every vertex, indexed by vertex (index `0` is unused).
    pub fn degrees(&self) -> Vec<u32> {
        let mut degrees = vec![0u32; self.vertex_count + 1];
        for &[u, v] in self.edges() {
            degrees[u as usize] += 1;
            degrees[v as usize] += 1;
        }
        degrees
    }

    /// Writes the list back in the course's text format.
    pub fn write_to<W: std::io::Write>(&self, mut w: W) -> std::io::Result<()> {
        writeln!(w, "{}", self.vertex_count)?;
        for &[u, v] in self.edges() {
            writeln!(w, "{u} {v}")?;
        }
        Ok(())
    }
}

/// Splits input into trimmed lines with 1-based numbers, fast (SIMD `memchr`).
struct Lines<'a> {
    bytes: &'a [u8],
    breaks: memchr::Memchr<'a>,
    start: usize,
    line: usize,
    done: bool,
}

impl<'a> Lines<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            breaks: memchr_iter(b'\n', bytes),
            start: 0,
            line: 0,
            done: false,
        }
    }

    /// Exact number of line breaks left (SIMD-counted), an upper bound on
    /// the number of edges still to come.
    fn remaining_lines(&self) -> usize {
        memchr::memchr_iter(b'\n', &self.bytes[self.start..]).count() + 1
    }
}

impl<'a> Iterator for Lines<'a> {
    type Item = (usize, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let (line, end) = match self.breaks.next() {
            Some(end) => (&self.bytes[self.start..end], end + 1),
            None => {
                self.done = true;
                (&self.bytes[self.start..], self.bytes.len())
            }
        };
        self.start = end;
        self.line += 1;
        let line = line.trim_ascii();
        if self.done && line.is_empty() {
            return None;
        }
        Some((self.line, line))
    }
}

/// Parses an unsigned decimal integer occupying the whole slice.
fn parse_u64(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() || bytes.len() > 19 {
        return None;
    }
    let mut value = 0u64;
    for &b in bytes {
        if !b.is_ascii_digit() {
            return None;
        }
        value = value * 10 + (b - b'0') as u64;
    }
    Some(value)
}

/// Parses `"<int> <int>"` with any amount of whitespace between and around.
fn parse_pair(line: &[u8]) -> Option<(u64, u64)> {
    let mut tokens = line
        .split(|b| b.is_ascii_whitespace())
        .filter(|t| !t.is_empty());
    let a = parse_u64(tokens.next()?)?;
    let b = parse_u64(tokens.next()?)?;
    if tokens.next().is_some() {
        return None;
    }
    Some((a, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_figure_one() {
        let edges = EdgeList::parse(b"5\n1 2\n2 5\n5 3\n4 5\n1 5\n").unwrap();
        assert_eq!(edges.vertex_count(), 5);
        assert_eq!(edges.edges(), &[[1, 2], [1, 5], [2, 5], [3, 5], [4, 5]]);
        assert_eq!(edges.degrees(), vec![0, 2, 2, 1, 1, 4]);
    }

    #[test]
    fn normalises_loops_duplicates_and_orientation() {
        let edges = EdgeList::parse(b"3\r\n2 1\r\n1 2\r\n3 3\r\n\r\n 1   3 \r\n").unwrap();
        assert_eq!(edges.edges(), &[[1, 2], [1, 3]]);
        assert_eq!(edges.self_loops_dropped(), 1);
        assert_eq!(edges.duplicates_dropped(), 1);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(matches!(EdgeList::parse(b""), Err(ParseError::Empty)));
        assert!(matches!(
            EdgeList::parse(b"x\n"),
            Err(ParseError::InvalidVertexCount { line: 1, .. })
        ));
        assert!(matches!(
            EdgeList::parse(b"0\n"),
            Err(ParseError::InvalidVertexCount { .. })
        ));
        assert!(matches!(
            EdgeList::parse(b"3\n1\n"),
            Err(ParseError::InvalidEdge { line: 2, .. })
        ));
        assert!(matches!(
            EdgeList::parse(b"3\n1 2 3\n"),
            Err(ParseError::InvalidEdge { line: 2, .. })
        ));
        assert!(matches!(
            EdgeList::parse(b"3\n1 4\n"),
            Err(ParseError::VertexOutOfRange {
                line: 2,
                vertex: 4,
                vertex_count: 3
            })
        ));
        assert!(matches!(
            EdgeList::parse(b"3\n0 1\n"),
            Err(ParseError::VertexOutOfRange { .. })
        ));
    }

    #[test]
    fn last_line_without_newline_is_parsed() {
        let edges = EdgeList::parse(b"2\n1 2").unwrap();
        assert_eq!(edges.edge_count(), 1);
    }
}
