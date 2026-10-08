//! The course's edge-list text format, with or without weights.
//!
//! ```text
//! 5        <- number of vertices
//! 1 2      <- one edge per line: `u v` (Part 1)
//! 2 5
//! 5 3
//! 4 5
//! 1 5
//! ```
//!
//! ```text
//! 5
//! 1 2 0.1  <- or `u v weight` on every line (Part 2): any finite real number
//! 2 5 0.2
//! 5 3 5
//! 3 4 -9.5
//! 4 5 2.3
//! 1 5 1
//! ```
//!
//! The first edge line decides which of the two a file is; every other line
//! must have the same columns.

use crate::graph::{Vertex, Weight, WeightedEdge};
#[cfg(feature = "mmap")]
use core::mem::size_of;
use memchr::memchr_iter;

/// A normalised edge list: the intermediate every representation is built from.
///
/// Normalisation happens once, here, so that every representation agrees on
/// what the graph is: self-loops are dropped, each undirected edge is stored
/// once as `[min, max]`, duplicates are removed and the list is sorted. The
/// sorted order is what lets the builders produce ascending neighbour rows
/// without sorting anything themselves.
///
/// A weighted list keeps its weights in a second array parallel to the
/// edges. A duplicated edge keeps its smallest weight, the only one a
/// shortest path could use, and the first edge with a negative weight is
/// recorded so that algorithms needing non-negative weights can refuse the
/// graph without looking at it again.
#[derive(Debug)]
pub struct EdgeList {
    vertex_count: usize,
    edges: EdgeStore<[Vertex; 2]>,
    /// `None` for a file without a weight column.
    weights: Option<EdgeStore<Weight>>,
    self_loops_dropped: usize,
    duplicates_dropped: usize,
    negative_edge: Option<WeightedEdge>,
}

impl PartialEq for EdgeList {
    fn eq(&self, other: &Self) -> bool {
        self.vertex_count == other.vertex_count
            && self.edges() == other.edges()
            && self.weights() == other.weights()
    }
}

impl Eq for EdgeList {}

/// One parsed line of a weighted file, before normalisation.
#[derive(Debug, Clone, Copy)]
#[repr(C)]
struct WeightedRecord {
    u: Vertex,
    v: Vertex,
    weight: Weight,
}

/// Plain data an [`EdgeStore`] may hold in a raw memory mapping.
///
/// # Safety
///
/// Implementors are `Copy`, have no drop glue, need an alignment of at
/// most a page, and every value is only ever read back after being written
/// whole by [`EdgeStore::push`].
unsafe trait Plain: Copy {}

// SAFETY: arrays of `u32`, `f64` and a `repr(C)` struct of both are plain.
unsafe impl Plain for [Vertex; 2] {}
// SAFETY: as above.
unsafe impl Plain for Weight {}
// SAFETY: as above.
unsafe impl Plain for WeightedRecord {}

/// Where an edge (or weight) array lives.
///
/// Heap allocators keep freed blocks around (macOS even defers reclaiming
/// them until memory pressure), so a heap-allocated edge list would inflate
/// every memory measurement by its own size long after it was dropped. With
/// the `mmap` feature large edge lists live in an anonymous mapping instead,
/// which the kernel takes back the moment it is unmapped.
enum EdgeStore<T: Plain> {
    Heap(Vec<T>),
    #[cfg(feature = "mmap")]
    Mapped {
        map: memmap2::MmapMut,
        len: usize,
    },
}

impl<T: Plain> EdgeStore<T> {
    /// Edge lists below this size are not worth a mapping of their own.
    #[cfg(feature = "mmap")]
    const MAPPED_THRESHOLD: usize = 1 << 16;

    fn with_capacity(capacity: usize) -> Self {
        #[cfg(feature = "mmap")]
        if capacity >= Self::MAPPED_THRESHOLD
            && let Ok(map) = memmap2::MmapMut::map_anon(capacity * size_of::<T>())
        {
            return EdgeStore::Mapped { map, len: 0 };
        }
        EdgeStore::Heap(Vec::with_capacity(capacity))
    }

    fn push(&mut self, item: T) {
        match self {
            EdgeStore::Heap(vec) => vec.push(item),
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                let capacity = map.len() / size_of::<T>();
                assert!(*len < capacity, "edge store capacity exceeded");
                // SAFETY: `len < capacity` keeps the write inside the mapping,
                // which is page aligned and therefore aligned for `T: Plain`.
                unsafe { map.as_mut_ptr().cast::<T>().add(*len).write(item) };
                *len += 1;
            }
        }
    }

    fn as_slice(&self) -> &[T] {
        match self {
            EdgeStore::Heap(vec) => vec,
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                // SAFETY: the mapping is page aligned (so aligned for `T`), its
                // first `len` items were written by `push`, `T` is plain data,
                // and the slice borrows `map` immutably.
                unsafe { core::slice::from_raw_parts(map.as_ptr().cast::<T>(), *len) }
            }
        }
    }

    fn as_mut_slice(&mut self) -> &mut [T] {
        match self {
            EdgeStore::Heap(vec) => vec,
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { map, len } => {
                // SAFETY: as in `as_slice`, with a unique borrow of `map`.
                unsafe { core::slice::from_raw_parts_mut(map.as_mut_ptr().cast::<T>(), *len) }
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

    fn shrink_to_fit(&mut self) {
        match self {
            EdgeStore::Heap(vec) => vec.shrink_to_fit(),
            #[cfg(feature = "mmap")]
            EdgeStore::Mapped { .. } => {}
        }
    }
}

impl<T: Plain> core::fmt::Debug for EdgeStore<T> {
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
    /// An edge line is not `u v` or `u v weight`.
    #[error("line {line}: expected `u v` or `u v weight` separated by whitespace, found {found:?}")]
    InvalidEdge {
        /// 1-based line number.
        line: usize,
        /// What was there instead.
        found: String,
    },
    /// The weight column is not a finite number.
    #[error("line {line}: expected a finite real weight, found {found:?}")]
    InvalidWeight {
        /// 1-based line number.
        line: usize,
        /// What was there instead.
        found: String,
    },
    /// An edge line has a weight when the first one did not, or the reverse.
    #[error(
        "line {line}: the first edge line has {expected} columns and every edge must too \
         (`u v` for an unweighted graph, `u v weight` for a weighted one)"
    )]
    InconsistentColumns {
        /// 1-based line number.
        line: usize,
        /// Columns of the first edge line (2 or 3).
        expected: usize,
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
    /// Parses the text format from memory, with or without a weight column.
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

        let capacity = lines.remaining_lines();
        let mut edge_lines = lines.filter(|(_, line)| !line.is_empty()).peekable();
        let weighted = edge_lines
            .peek()
            .is_some_and(|(_, line)| tokens(line).count() == 3);
        if !weighted {
            let mut raw = EdgeStore::with_capacity(capacity);
            for (line_no, line) in edge_lines {
                let (u, v, weight) = parse_edge(line_no, line, vertex_count)?;
                if weight.is_some() {
                    return Err(ParseError::InconsistentColumns {
                        line: line_no,
                        expected: 2,
                    });
                }
                raw.push([u, v]);
            }
            return Ok(Self::normalise(vertex_count, raw));
        }
        let mut raw = EdgeStore::with_capacity(capacity);
        for (line_no, line) in edge_lines {
            let (u, v, weight) = parse_edge(line_no, line, vertex_count)?;
            let weight = weight.ok_or(ParseError::InconsistentColumns {
                line: line_no,
                expected: 3,
            })?;
            let weight = parse_weight(weight).ok_or_else(|| ParseError::InvalidWeight {
                line: line_no,
                found: String::from_utf8_lossy(weight).into_owned(),
            })?;
            raw.push(WeightedRecord { u, v, weight });
        }
        Ok(Self::normalise_weighted(vertex_count, raw))
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

    /// Builds an unweighted edge list from in-memory edges (mainly for tests
    /// and generators).
    pub fn from_edges(
        vertex_count: usize,
        edges: impl IntoIterator<Item = (Vertex, Vertex)>,
    ) -> Result<Self, ParseError> {
        let mut raw = EdgeStore::Heap(Vec::new());
        for (index, (u, v)) in edges.into_iter().enumerate() {
            check_vertices(index + 2, [u as u64, v as u64], vertex_count)?;
            raw.push([u, v]);
        }
        Ok(Self::normalise(vertex_count, raw))
    }

    /// Builds a weighted edge list from in-memory `(u, v, weight)` triples.
    pub fn from_weighted_edges(
        vertex_count: usize,
        edges: impl IntoIterator<Item = (Vertex, Vertex, Weight)>,
    ) -> Result<Self, ParseError> {
        let mut raw = EdgeStore::Heap(Vec::new());
        for (index, (u, v, weight)) in edges.into_iter().enumerate() {
            let line = index + 2;
            check_vertices(line, [u as u64, v as u64], vertex_count)?;
            if !weight.is_finite() {
                return Err(ParseError::InvalidWeight {
                    line,
                    found: weight.to_string(),
                });
            }
            raw.push(WeightedRecord { u, v, weight });
        }
        Ok(Self::normalise_weighted(vertex_count, raw))
    }

    fn normalise(vertex_count: usize, mut raw: EdgeStore<[Vertex; 2]>) -> Self {
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
        raw.shrink_to_fit();
        Self {
            vertex_count,
            edges: raw,
            weights: None,
            self_loops_dropped,
            duplicates_dropped,
            negative_edge: None,
        }
    }

    /// The weighted twin of [`normalise`](Self::normalise): the same steps on
    /// `(u, v, weight)` records, then the records are split into the edge
    /// array and the parallel weight array.
    fn normalise_weighted(vertex_count: usize, mut raw: EdgeStore<WeightedRecord>) -> Self {
        let records = raw.as_mut_slice();
        let before = records.len();
        let mut kept = 0;
        for i in 0..before {
            let WeightedRecord { u, v, weight } = records[i];
            if u != v {
                let (u, v) = if u < v { (u, v) } else { (v, u) };
                records[kept] = WeightedRecord { u, v, weight };
                kept += 1;
            }
        }
        let self_loops_dropped = before - kept;
        raw.truncate(kept);

        // Sorting by weight within an edge puts the smallest copy of a
        // duplicated edge first, so keeping the first copy keeps the minimum.
        let records = raw.as_mut_slice();
        records.sort_unstable_by(|a, b| {
            (a.u, a.v)
                .cmp(&(b.u, b.v))
                .then(a.weight.total_cmp(&b.weight))
        });
        let before = records.len();
        let mut kept = 0;
        for i in 0..before {
            let record = records[i];
            if kept == 0 || (record.u, record.v) != (records[kept - 1].u, records[kept - 1].v) {
                records[kept] = record;
                kept += 1;
            }
        }
        let duplicates_dropped = before - kept;
        raw.truncate(kept);

        let records = raw.as_slice();
        let mut edges = EdgeStore::with_capacity(records.len());
        let mut weights = EdgeStore::with_capacity(records.len());
        let mut negative_edge = None;
        for &WeightedRecord { u, v, weight } in records {
            edges.push([u, v]);
            weights.push(weight);
            if weight < 0.0 && negative_edge.is_none() {
                negative_edge = Some(WeightedEdge { u, v, weight });
            }
        }
        Self {
            vertex_count,
            edges,
            weights: Some(weights),
            self_loops_dropped,
            duplicates_dropped,
            negative_edge,
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

    /// Whether the input had a weight column.
    pub fn is_weighted(&self) -> bool {
        self.weights.is_some()
    }

    /// The weights, parallel to [`edges`](Self::edges); `None` when unweighted.
    pub fn weights(&self) -> Option<&[Weight]> {
        self.weights.as_ref().map(EdgeStore::as_slice)
    }

    /// Every edge with its weight (`1` for each edge of an unweighted list).
    pub fn weighted_edges(&self) -> impl ExactSizeIterator<Item = WeightedEdge> + '_ {
        let weights = self.weights().unwrap_or(&[]);
        self.edges()
            .iter()
            .enumerate()
            .map(move |(i, &[u, v])| WeightedEdge {
                u,
                v,
                weight: weights.get(i).copied().unwrap_or(crate::graph::UNIT_WEIGHT),
            })
    }

    /// The first edge, in sorted order, whose weight is negative.
    pub fn negative_edge(&self) -> Option<WeightedEdge> {
        self.negative_edge
    }

    /// Self-loops (`u u`) that were discarded.
    pub fn self_loops_dropped(&self) -> usize {
        self.self_loops_dropped
    }

    /// Repeated edges that were discarded (a weighted duplicate keeps its
    /// smallest weight).
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

    /// Writes the list back in the course's text format (with the weight
    /// column when the list has one).
    pub fn write_to<W: std::io::Write>(&self, w: W) -> std::io::Result<()> {
        use std::io::Write as _;
        let mut w = std::io::BufWriter::new(w);
        writeln!(w, "{}", self.vertex_count)?;
        match self.weights() {
            None => {
                for &[u, v] in self.edges() {
                    writeln!(w, "{u} {v}")?;
                }
            }
            Some(weights) => {
                for (&[u, v], weight) in self.edges().iter().zip(weights) {
                    writeln!(w, "{u} {v} {weight}")?;
                }
            }
        }
        w.flush()
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

/// The whitespace-separated tokens of a line.
fn tokens(line: &[u8]) -> impl Iterator<Item = &[u8]> {
    line.split(|b| b.is_ascii_whitespace())
        .filter(|t| !t.is_empty())
}

/// Parses `u v` or `u v weight`, checking the vertex ids against `1..=n`.
/// The weight comes back unparsed, so the caller decides what a missing or
/// extra column means.
fn parse_edge(
    line_no: usize,
    line: &[u8],
    vertex_count: usize,
) -> Result<(Vertex, Vertex, Option<&[u8]>), ParseError> {
    let invalid = || ParseError::InvalidEdge {
        line: line_no,
        found: String::from_utf8_lossy(line).into_owned(),
    };
    let mut tokens = tokens(line);
    let u = tokens.next().and_then(parse_u64).ok_or_else(invalid)?;
    let v = tokens.next().and_then(parse_u64).ok_or_else(invalid)?;
    let weight = tokens.next();
    if tokens.next().is_some() {
        return Err(invalid());
    }
    check_vertices(line_no, [u, v], vertex_count)?;
    Ok((u as Vertex, v as Vertex, weight))
}

/// Checks that both endpoints are within `1..=n`.
fn check_vertices(line: usize, ends: [u64; 2], vertex_count: usize) -> Result<(), ParseError> {
    for vertex in ends {
        if vertex < 1 || vertex > vertex_count as u64 {
            return Err(ParseError::VertexOutOfRange {
                line,
                vertex,
                vertex_count,
            });
        }
    }
    Ok(())
}

/// Parses a finite real number (`5`, `-9.5`, `0.1`, `1e-3`); NaN and
/// infinities are refused.
fn parse_weight(token: &[u8]) -> Option<Weight> {
    core::str::from_utf8(token)
        .ok()?
        .parse::<Weight>()
        .ok()
        .filter(|w| w.is_finite())
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
            EdgeList::parse(b"3\n1 2 3 4\n"),
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

    /// Figure 1 of the Part 2 handout.
    const WEIGHTED: &[u8] = b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n";

    #[test]
    fn parses_the_weighted_figure() {
        let edges = EdgeList::parse(WEIGHTED).unwrap();
        assert!(edges.is_weighted());
        assert_eq!(
            edges.edges(),
            &[[1, 2], [1, 5], [2, 5], [3, 4], [3, 5], [4, 5]]
        );
        assert_eq!(edges.weights().unwrap(), &[0.1, 1.0, 0.2, -9.5, 5.0, 2.3]);
        assert_eq!(
            edges.negative_edge(),
            Some(WeightedEdge {
                u: 3,
                v: 4,
                weight: -9.5
            })
        );
        assert!(!EdgeList::parse(b"2\n1 2\n").unwrap().is_weighted());
    }

    #[test]
    fn weighted_duplicates_keep_the_smallest_weight() {
        let edges = EdgeList::parse(b"3\n2 1 4\n1 2 0.5\n3 3 -1\n1 2 7\n2 3 1e-3\n").unwrap();
        assert_eq!(edges.edges(), &[[1, 2], [2, 3]]);
        assert_eq!(edges.weights().unwrap(), &[0.5, 0.001]);
        assert_eq!(edges.duplicates_dropped(), 2);
        assert_eq!(edges.self_loops_dropped(), 1);
        // The negative self-loop is not part of the graph.
        assert_eq!(edges.negative_edge(), None);
    }

    #[test]
    fn rejects_bad_weights_and_mixed_columns() {
        assert!(matches!(
            EdgeList::parse(b"3\n1 2 0.5\n2 3\n"),
            Err(ParseError::InconsistentColumns {
                line: 3,
                expected: 3
            })
        ));
        assert!(matches!(
            EdgeList::parse(b"3\n1 2\n2 3 1\n"),
            Err(ParseError::InconsistentColumns {
                line: 3,
                expected: 2
            })
        ));
        for bad in ["abc", "NaN", "inf", "1,5"] {
            let text = format!("3\n1 2 {bad}\n");
            assert!(
                matches!(
                    EdgeList::parse(text.as_bytes()),
                    Err(ParseError::InvalidWeight { line: 2, .. })
                ),
                "{bad}"
            );
        }
        assert!(matches!(
            EdgeList::from_weighted_edges(2, [(1, 2, f64::NAN)]),
            Err(ParseError::InvalidWeight { .. })
        ));
    }

    #[test]
    fn weighted_lists_round_trip() {
        let edges = EdgeList::parse(WEIGHTED).unwrap();
        let mut text = Vec::new();
        edges.write_to(&mut text).unwrap();
        assert_eq!(EdgeList::parse(&text).unwrap(), edges);
        let triples = [
            (1, 2, 0.1),
            (2, 5, 0.2),
            (5, 3, 5.0),
            (3, 4, -9.5),
            (4, 5, 2.3),
            (1, 5, 1.0),
        ];
        assert_eq!(EdgeList::from_weighted_edges(5, triples).unwrap(), edges);
        assert_ne!(
            EdgeList::parse(b"5\n1 2\n2 5\n5 3\n3 4\n4 5\n1 5\n").unwrap(),
            edges
        );
    }
}
