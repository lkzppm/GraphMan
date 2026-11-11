//! Floyd-Warshall: shortest paths between all pairs, in one table updated
//! in place, with the way the table is walked as a strategy.
//!
//! The recurrence `D_k[i][j] = min(D_{k-1}[i][j], D_{k-1}[i][k] + D_{k-1}[k][j])`
//! reads as `n + 1` tables (`n³` cells). Round `k` never changes row `k` or
//! column `k` (`D[k][k] = 0` unless a negative cycle runs through `k`, which
//! ends the run), so it can be done **in place in one table**: `n²` cells.
//! That is the memory optimisation the course asks for. Predecessors follow
//! the same rule (on an improvement `parent[i][j] = parent[k][j]`), so row
//! `i` of the predecessor table *is* the shortest-path tree from `i`, with no
//! extra memory and no rebuild.
//!
//! How the triple loop walks memory is a [`SweepKind`]: on `10¹²` updates
//! it is the whole running time.
//!
//! | Sweep | What changes |
//! |---|---|
//! | `plain` | `for k, for i, for j` on the flat table, row `k` hoisted: the textbook with the memory optimisation |
//! | `pruned` | rows with `D[i][k] = ∞` skipped: on a sparse digraph most early rounds touch few rows |
//! | `parallel` | the rows of a round on every core (they are independent once row `k` is read) |
//! | `blocked` | Venkataraman, Sahni and Mukhopadhyaya's tiling: the diagonal tile, then its row and column, then the rest, each tile in cache |
//!
//! The table costs 12 bytes a cell (an `f64` distance and a `u32`
//! predecessor), priced up front and refused past the memory budget, like
//! the adjacency matrix: 1.2 GB at 10,000 vertices, 120 GB at 100,000.
//!
//! **Zero-weight cycles.** Every predecessor the rule sets is tight
//! (`D[i][p] + w(p, j) = D[i][j]` once the run is over), but a row's
//! predecessors may still close a loop, through a cycle of weight exactly 0:
//! each pointer is a shortest step, and they go round. Bellman-Ford's parent
//! graph cannot loop (its relaxations are strict along real arcs), so a row
//! whose predecessors loop is regrown by one Bellman-Ford from its vertex.
//! Finding those rows is `O(n)` a row, `O(n²)` in all; a graph without
//! zero-weight cycles never pays more. In practice the loops come from the
//! blocked sweep, whose tiles read values out of the plain order (most
//! random graphs with zero-weight arcs and two tiles or more); the plain
//! order did not loop on any graph tried.

use super::bellman_ford::{NegativeCycle, bellman_ford_into, negative_cycle};
use super::schedule::{ScheduleKind, Start};
use super::shortest_path::ShortestPathTree;
use super::traversal::Control;
use crate::graph::{MemoryBudget, NO_VERTEX, Vertex, Weight, Weighted};
use core::fmt;
use core::mem::size_of;
use core::str::FromStr;
use std::io::{self, Write};

/// How Floyd-Warshall walks its table. Every sweep gives the same distances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "kebab-case"))]
pub enum SweepKind {
    /// The textbook triple loop on one table, row `k` hoisted.
    Plain,
    /// Skips the rows that cannot reach `k` yet.
    Pruned,
    /// The rows of each round in parallel (sequential without the
    /// `parallel` feature, as in the browser).
    Parallel,
    /// Cache-sized tiles, in the order that keeps the recurrence.
    Blocked,
}

impl SweepKind {
    /// Every sweep, in the order they are usually reported.
    pub const ALL: [SweepKind; 4] = [
        SweepKind::Plain,
        SweepKind::Pruned,
        SweepKind::Parallel,
        SweepKind::Blocked,
    ];

    /// Command-line identifier.
    pub fn label(self) -> &'static str {
        match self {
            SweepKind::Plain => "plain",
            SweepKind::Pruned => "pruned",
            SweepKind::Parallel => "parallel",
            SweepKind::Blocked => "blocked",
        }
    }
}

impl fmt::Display for SweepKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

impl FromStr for SweepKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim().to_ascii_lowercase();
        SweepKind::ALL
            .into_iter()
            .find(|kind| kind.label() == s)
            .ok_or_else(|| {
                format!("unknown sweep {s:?} (expected plain, pruned, parallel or blocked)")
            })
    }
}

/// Why Floyd-Warshall has no answer.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum FloydError {
    /// The graph has a negative cycle (it shows on the diagonal).
    #[error(transparent)]
    NegativeCycle(#[from] NegativeCycle),
    /// The table does not fit in the memory budget.
    #[error(
        "the all-pairs table of {vertex_count} vertices needs {required_bytes} bytes, \
         over the budget of {limit_bytes} bytes"
    )]
    TooLarge {
        /// Number of vertices.
        vertex_count: usize,
        /// Bytes the table needs.
        required_bytes: usize,
        /// The budget.
        limit_bytes: usize,
    },
    /// The allocator refused the table.
    #[error("allocating {required_bytes} bytes for the all-pairs table failed")]
    AllocationFailed {
        /// Bytes that were requested.
        required_bytes: usize,
    },
    /// The progress callback stopped the run after `rounds` of `of` rounds.
    #[error("stopped after {rounds} of {of} rounds")]
    Cancelled {
        /// Rounds (values of `k`) completed.
        rounds: usize,
        /// Rounds a complete run takes (`n`).
        of: usize,
    },
}

/// The answer of Floyd-Warshall: the distance between every ordered pair
/// and the shortest-path tree from every vertex.
#[derive(Debug, Clone, PartialEq)]
pub struct AllPairs {
    vertex_count: usize,
    /// `n × n`, row-major, vertex `v` at index `v - 1`; `+∞` when unreachable.
    distance: Vec<Weight>,
    /// `parent[i][j]`: the vertex before `j` on the shortest path from `i`
    /// (`NO_VERTEX` for `i` itself and the vertices `i` does not reach).
    parent: Vec<Vertex>,
}

impl AllPairs {
    /// Heap bytes the tables of a graph with `vertex_count` vertices take:
    /// 12 per cell, plus a copy of one row.
    pub fn required_bytes(vertex_count: usize) -> usize {
        let cell = size_of::<Weight>() + size_of::<Vertex>();
        vertex_count
            .saturating_mul(vertex_count)
            .saturating_add(vertex_count)
            .saturating_mul(cell)
    }

    /// Number of vertices.
    pub fn vertex_count(&self) -> usize {
        self.vertex_count
    }

    #[inline]
    fn index(&self, i: Vertex, j: Vertex) -> usize {
        (i as usize - 1) * self.vertex_count + (j as usize - 1)
    }

    /// The distance from `i` to `j`; `None` if `j` cannot be reached from `i`.
    pub fn distance(&self, i: Vertex, j: Vertex) -> Option<Weight> {
        let d = self.distance[self.index(i, j)];
        (d != Weight::INFINITY).then_some(d)
    }

    /// The vertex before `j` on the shortest path from `i`; `None` when
    /// `j == i` or `j` is not reached.
    pub fn parent(&self, i: Vertex, j: Vertex) -> Option<Vertex> {
        match self.parent[self.index(i, j)] {
            NO_VERTEX => None,
            p => Some(p),
        }
    }

    /// The shortest path from `i` to `j` (both included), or `None` if there
    /// is none.
    pub fn path(&self, i: Vertex, j: Vertex) -> Option<Vec<Vertex>> {
        self.distance(i, j)?;
        let mut path = vec![j];
        let mut at = j;
        while let Some(p) = self.parent(i, at) {
            path.push(p);
            at = p;
            debug_assert!(path.len() <= self.vertex_count, "row {i} is a tree");
        }
        path.reverse();
        Some(path)
    }

    /// The distances from `i`, indexed by `j - 1` (`+∞` when unreachable).
    pub fn row(&self, i: Vertex) -> &[Weight] {
        let start = self.index(i, 1);
        &self.distance[start..start + self.vertex_count]
    }

    /// The shortest-path tree from `i`, read off row `i` of the tables: the
    /// same type Dijkstra and Bellman-Ford build, so it writes the same file.
    pub fn tree(&self, i: Vertex) -> ShortestPathTree {
        let n = self.vertex_count;
        let mut tree = ShortestPathTree::new(n);
        tree.root = i;
        let row = self.index(i, 1);
        for j in 1..=n as Vertex {
            let d = self.distance[row + j as usize - 1];
            if d != Weight::INFINITY {
                tree.distance[j as usize] = d;
                tree.parent[j as usize] = self.parent[row + j as usize - 1];
                tree.touched.push(j);
            }
        }
        tree.settle_touched();
        tree
    }

    /// Writes the tree from `i` as `vertex parent distance` lines.
    pub fn write_tree_to<W: Write>(&self, i: Vertex, w: W) -> io::Result<()> {
        self.tree(i).write_to(w)
    }

    /// Bytes the tables own on the heap.
    pub fn heap_bytes(&self) -> usize {
        self.distance.capacity() * size_of::<Weight>()
            + self.parent.capacity() * size_of::<Vertex>()
    }

    /// A negative cycle through `i`, read off row `i` once `D[i][i] < 0`:
    /// the predecessors of row `i` from `i` close a walk; its first repeated
    /// vertex closes a cycle.
    fn cycle_through<G: Weighted>(&self, graph: &G, i: Vertex) -> Option<NegativeCycle> {
        let n = self.vertex_count;
        let mut chain = Vec::new();
        let mut seen = vec![false; n + 1];
        let mut at = i;
        while !seen[at as usize] {
            seen[at as usize] = true;
            chain.push(at);
            at = self.parent[self.index(i, at)];
            if at == NO_VERTEX {
                return None;
            }
        }
        // The chain runs backwards along arcs: `chain[t + 1] → chain[t]`.
        let start = chain.iter().position(|&v| v == at).expect("seen");
        let mut cycle = chain.split_off(start);
        cycle.reverse();
        let k = cycle.len();
        let weight: Weight = (0..k)
            .map(|t| graph.weight(cycle[t], cycle[(t + 1) % k]))
            .sum::<Option<Weight>>()?;
        (weight < 0.0).then(|| NegativeCycle::new(cycle, weight))
    }
}

/// Floyd-Warshall with the given sweep, within `budget`.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, MemoryBudget, Orientation};
/// use graphman::algo::{self, SweepKind};
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n2 1 1\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let all = algo::floyd_warshall(&graph, SweepKind::Plain, MemoryBudget::Machine).unwrap();
/// assert_eq!(all.distance(1, 2), Some(1.0));
/// assert_eq!(all.distance(3, 1), Some(-1.0));
/// assert_eq!(all.path(3, 1), Some(vec![3, 2, 1]));
/// assert_eq!(all.tree(1).path_to(2), Some(vec![1, 3, 2]));
/// ```
pub fn floyd_warshall<G: Weighted>(
    graph: &G,
    sweep: SweepKind,
    budget: MemoryBudget,
) -> Result<AllPairs, FloydError> {
    floyd_warshall_with_progress(graph, sweep, budget, &|_| Control::Continue)
}

/// [`floyd_warshall`] with a callback that receives the number of rounds
/// done (a round per `k`; the blocked sweep reports a tile's worth at once)
/// and may stop the run, which then ends with [`FloydError::Cancelled`].
pub fn floyd_warshall_with_progress<G: Weighted>(
    graph: &G,
    sweep: SweepKind,
    budget: MemoryBudget,
    progress: &(dyn Fn(usize) -> Control + Sync),
) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    let required_bytes = AllPairs::required_bytes(n);
    if let Some(limit_bytes) = budget.limit_bytes()
        && required_bytes > limit_bytes
    {
        return Err(FloydError::TooLarge {
            vertex_count: n,
            required_bytes,
            limit_bytes,
        });
    }
    if let Some(edge) = graph.negative_loops().first() {
        return Err(NegativeCycle::new(vec![edge.u], edge.weight).into());
    }
    let mut all = initial(graph, required_bytes)?;
    let mut table = Table {
        n,
        distance: &mut all.distance,
        parent: &mut all.parent,
    };
    let negative = match sweep {
        SweepKind::Plain => table.rounds(false, false, progress),
        SweepKind::Pruned => table.rounds(true, false, progress),
        SweepKind::Parallel => table.rounds(true, true, progress),
        SweepKind::Blocked => table.blocked(progress),
    }?;
    if let Some(i) = negative {
        let cycle = all
            .cycle_through(graph, i)
            .or_else(|| negative_cycle(graph, ScheduleKind::Queue))
            .expect("a negative diagonal is a closed walk of negative weight");
        return Err(cycle.into());
    }
    all.regrow_looping_rows(graph);
    Ok(all)
}

impl AllPairs {
    /// Regrows, by Bellman-Ford, every row whose predecessors go round a
    /// zero-weight cycle instead of back to the row's vertex.
    fn regrow_looping_rows<G: Weighted>(&mut self, graph: &G) {
        let n = self.vertex_count;
        // Per vertex of the row being checked: 0 unseen, `2 i` reaches `i`,
        // `2 i + 1` on the walk being followed.
        let mut state = vec![0usize; n + 1];
        let mut walk = Vec::new();
        let mut tree = ShortestPathTree::new(n);
        let mut schedule = ScheduleKind::Queue.schedule();
        for i in 1..=n as Vertex {
            let (done, open) = (2 * i as usize, 2 * i as usize + 1);
            state[i as usize] = done;
            let row = self.index(i, 1);
            let mut loops = false;
            'row: for j in 1..=n as Vertex {
                let mut at = j;
                while state[at as usize] != done {
                    if state[at as usize] == open {
                        loops = true;
                        break 'row;
                    }
                    state[at as usize] = open;
                    walk.push(at);
                    at = self.parent[row + at as usize - 1];
                    if at == NO_VERTEX {
                        break;
                    }
                }
                for v in walk.drain(..) {
                    state[v as usize] = done;
                }
            }
            walk.clear();
            if !loops {
                continue;
            }
            bellman_ford_into(graph, Start::Vertex(i), &mut schedule, &mut tree, &mut ())
                .expect("Floyd-Warshall found no negative cycle");
            for j in 1..=n as Vertex {
                let cell = row + j as usize - 1;
                self.distance[cell] = tree.distance(j).unwrap_or(Weight::INFINITY);
                self.parent[cell] = tree.parent(j).unwrap_or(NO_VERTEX);
            }
        }
    }
}

/// The tables before the first round: 0 on the diagonal, the arcs, `+∞`.
fn initial<G: Weighted>(graph: &G, required_bytes: usize) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    let failed = |_| FloydError::AllocationFailed { required_bytes };
    let cells = n
        .checked_mul(n)
        .ok_or(FloydError::AllocationFailed { required_bytes })?;
    let mut distance: Vec<Weight> = Vec::new();
    distance.try_reserve_exact(cells).map_err(failed)?;
    distance.resize(cells, Weight::INFINITY);
    let mut parent: Vec<Vertex> = Vec::new();
    parent.try_reserve_exact(cells).map_err(failed)?;
    parent.resize(cells, NO_VERTEX);
    for i in graph.vertices() {
        let row = (i as usize - 1) * n;
        distance[row + i as usize - 1] = 0.0;
        for (j, weight) in graph.weighted_neighbors(i) {
            distance[row + j as usize - 1] = weight;
            parent[row + j as usize - 1] = i;
        }
    }
    Ok(AllPairs {
        vertex_count: n,
        distance,
        parent,
    })
}

/// The two tables while a sweep runs.
struct Table<'a> {
    n: usize,
    distance: &'a mut [Weight],
    parent: &'a mut [Vertex],
}

/// One round's update of a stretch of row `i`: `D[i][j] = min(D[i][j],
/// D[i][k] + D[k][j])` for the `j` of the stretch, the predecessor following.
/// Written as compare-then-select so the compiler can vectorise it.
#[inline(always)]
fn relax(
    row: &mut [Weight],
    parents: &mut [Vertex],
    through: Weight,
    row_k: &[Weight],
    parents_k: &[Vertex],
) {
    for (((d, p), &dk), &pk) in row
        .iter_mut()
        .zip(parents.iter_mut())
        .zip(row_k)
        .zip(parents_k)
    {
        let candidate = through + dk;
        let better = candidate < *d;
        *d = if better { candidate } else { *d };
        *p = if better { pk } else { *p };
    }
}

impl Table<'_> {
    /// The first vertex (0-based) with a negative diagonal, if any.
    fn negative_diagonal(&self) -> Option<usize> {
        (0..self.n).find(|&i| self.distance[i * self.n + i] < 0.0)
    }

    /// Round after round, `k` in order. Row `k` is copied out (`n` cells a
    /// round, `n²` in all, against `n³` updates) so the other rows can be
    /// updated while it is read, one after another or all at once.
    fn rounds(
        &mut self,
        pruned: bool,
        parallel: bool,
        progress: &(dyn Fn(usize) -> Control + Sync),
    ) -> Result<Option<Vertex>, FloydError> {
        let n = self.n;
        let mut row_k = vec![0.0; n];
        let mut parents_k = vec![NO_VERTEX; n];
        for k in 0..n {
            row_k.copy_from_slice(&self.distance[k * n..(k + 1) * n]);
            parents_k.copy_from_slice(&self.parent[k * n..(k + 1) * n]);
            let update = |i: usize, row: &mut [Weight], parents: &mut [Vertex]| {
                let through = row[k];
                if i == k || (pruned && through == Weight::INFINITY) {
                    return;
                }
                relax(row, parents, through, &row_k, &parents_k);
            };
            match parallel {
                #[cfg(feature = "parallel")]
                true => {
                    use rayon::prelude::*;
                    self.distance
                        .par_chunks_mut(n)
                        .zip(self.parent.par_chunks_mut(n))
                        .enumerate()
                        .for_each(|(i, (row, parents))| update(i, row, parents));
                }
                _ => {
                    for (i, (row, parents)) in self
                        .distance
                        .chunks_mut(n)
                        .zip(self.parent.chunks_mut(n))
                        .enumerate()
                    {
                        update(i, row, parents);
                    }
                }
            }
            if let Some(i) = self.negative_diagonal() {
                return Ok(Some(i as Vertex + 1));
            }
            if progress(k + 1) == Control::Break {
                return Err(FloydError::Cancelled {
                    rounds: k + 1,
                    of: n,
                });
            }
        }
        Ok(None)
    }

    /// Venkataraman-Sahni-Mukhopadhyaya: for each tile `K` of the diagonal,
    /// run the rounds `k ∈ K` on the diagonal tile, then on the tiles of its
    /// row and its column (which read the diagonal tile), then on every
    /// other tile (which reads one tile of each). Each update reads values
    /// the plain order would have produced by then, so the distances are the
    /// same; each tile fits in cache, so the rounds of a tile cost cache
    /// hits instead of memory bandwidth.
    fn blocked(
        &mut self,
        progress: &(dyn Fn(usize) -> Control + Sync),
    ) -> Result<Option<Vertex>, FloydError> {
        const TILE: usize = 64;
        let n = self.n;
        let tiles = n.div_ceil(TILE);
        let span = |t: usize| t * TILE..((t + 1) * TILE).min(n);
        for kt in 0..tiles {
            let ks = span(kt);
            self.tile(ks.clone(), ks.clone(), ks.clone());
            for t in (0..tiles).filter(|&t| t != kt) {
                self.tile(ks.clone(), span(t), ks.clone());
                self.tile(span(t), ks.clone(), ks.clone());
            }
            for it in (0..tiles).filter(|&t| t != kt) {
                for jt in (0..tiles).filter(|&t| t != kt) {
                    self.tile(span(it), span(jt), ks.clone());
                }
            }
            if let Some(i) = self.negative_diagonal() {
                return Ok(Some(i as Vertex + 1));
            }
            if progress(ks.end) == Control::Break {
                return Err(FloydError::Cancelled {
                    rounds: ks.end,
                    of: n,
                });
            }
        }
        Ok(None)
    }

    /// The rounds `k ∈ ks` on the tile of rows `is` and columns `js`.
    fn tile(
        &mut self,
        is: core::ops::Range<usize>,
        js: core::ops::Range<usize>,
        ks: core::ops::Range<usize>,
    ) {
        let n = self.n;
        for k in ks {
            for i in is.clone() {
                let through = self.distance[i * n + k];
                if i == k || through == Weight::INFINITY {
                    continue;
                }
                // Rows `i` and `k` are distinct: split the tables between them.
                let (row, row_k) = two_rows(self.distance, n, i, k);
                let (parents, parents_k) = two_rows(self.parent, n, i, k);
                relax(
                    &mut row[js.clone()],
                    &mut parents[js.clone()],
                    through,
                    &row_k[js.clone()],
                    &parents_k[js.clone()],
                );
            }
        }
    }
}

/// Row `i` mutably and row `k` immutably out of one `n`-wide table (`i ≠ k`).
#[inline(always)]
fn two_rows<T>(table: &mut [T], n: usize, i: usize, k: usize) -> (&mut [T], &[T]) {
    if i < k {
        let (low, high) = table.split_at_mut(k * n);
        (&mut low[i * n..(i + 1) * n], &high[..n])
    } else {
        let (low, high) = table.split_at_mut(i * n);
        (&mut high[..n], &low[k * n..(k + 1) * n])
    }
}
