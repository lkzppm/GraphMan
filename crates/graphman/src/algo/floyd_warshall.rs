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
//! How the triple loop walks memory is a [`Sweep`]: on `10¹²` updates it
//! is the whole running time. [`floyd_warshall`] is written once over it,
//! the way Bellman-Ford is over a [`Schedule`](super::Schedule): the
//! library owns the table, the update and the negative cycle, and a sweep
//! only decides the order of the updates, through a [`SweepTable`]. The
//! library's sweeps are the [`SweepKind`]s; a sweep of one's own is a type
//! implementing [`Sweep`], checked against the plain one by [`check_sweep`].
//!
//! | [`SweepKind`] | What changes |
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
use core::ops::{ControlFlow, Range};
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

/// Floyd-Warshall with the given sweep (a [`SweepKind`], or a [`Sweep`] of
/// one's own), within `budget`.
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
pub fn floyd_warshall<G: Weighted, S: Sweep>(
    graph: &G,
    sweep: S,
    budget: MemoryBudget,
) -> Result<AllPairs, FloydError> {
    floyd_warshall_with_progress(graph, sweep, budget, &|_| Control::Continue)
}

/// [`floyd_warshall`] with a callback that receives the number of rounds
/// done (as the sweep reports them: a round per `k`, a tile's worth at once
/// for the blocked sweep) and may stop the run, which then ends with
/// [`FloydError::Cancelled`].
///
/// # Panics
///
/// When the sweep returns before reporting all `n` rounds and without
/// being stopped: it broke the [`Sweep`] contract.
pub fn floyd_warshall_with_progress<G: Weighted, S: Sweep>(
    graph: &G,
    mut sweep: S,
    budget: MemoryBudget,
    progress: &(dyn Fn(usize) -> Control + Sync),
) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    AllPairs::check_budget(n, budget)?;
    if let Some(edge) = graph.negative_loops().first() {
        return Err(NegativeCycle::new(vec![edge.u], edge.weight).into());
    }
    let mut all = initial(graph, budget)?;
    let stop = {
        let mut table = SweepTable::new(n, &mut all.distance, &mut all.parent, progress);
        let _ = sweep.run(&mut table);
        if table.stop.is_none() {
            assert_eq!(
                table.done,
                n,
                "the sweep {:?} returned after {} of {n} rounds",
                sweep.name(),
                table.done,
            );
        }
        table.stop
    };
    match stop {
        Some(Stop::Cycle(i)) => {
            let i = i as Vertex + 1;
            let cycle = all
                .cycle_through(graph, i)
                .or_else(|| negative_cycle(graph, ScheduleKind::Queue))
                .expect("a negative diagonal is a closed walk of negative weight");
            return Err(cycle.into());
        }
        Some(Stop::Cancelled(rounds)) => return Err(FloydError::Cancelled { rounds, of: n }),
        None => {}
    }
    all.regrow_looping_rows(graph);
    Ok(all)
}

/// How Floyd-Warshall walks its table: the **order** of the updates, never
/// the updates themselves.
///
/// The library prices and fills the table, owns the update
/// `D[i][j] = min(D[i][j], D[i][k] + D[k][j])` (vectorised, the predecessor
/// following), finds the negative cycle and reports progress; a sweep only
/// says which rows or tiles go through which rounds, in what order and on
/// how many cores, through the [`SweepTable`] it is handed. A new way of
/// walking the table is a new `Sweep`, never a second Floyd-Warshall.
///
/// # The contract
///
/// Unlike a [`Schedule`](super::Schedule), a sweep can be wrong: round `k`
/// must read row `k` and column `k` as round `k` found them, or the
/// distances come out wrong with no error. So a sweep
///
/// * runs the rounds `k = 0..n` on every row in order, or in an order that
///   reads the same values (as the blocked sweep's tiles do);
/// * skips a row of round `k` only when the round cannot change it (a row
///   with `D[i][k] = ∞`, which [`SweepTable::round`]'s filter sees);
/// * reports rounds as they complete with [`SweepTable::rounds_done`], up to
///   `n`, and returns as soon as it answers [`ControlFlow::Break`] (a
///   negative cycle, or the progress callback stopped the run).
///
/// A run panics when a sweep returns early without being stopped, and
/// [`check_sweep`] compares a sweep with the plain one on any graph.
///
/// ```
/// use core::ops::ControlFlow;
/// use graphman::{Build, Csr, EdgeList, MemoryBudget, Orientation};
/// use graphman::algo::{self, Sweep, SweepTable};
///
/// /// Each round from the last row up.
/// struct Backwards;
///
/// impl Sweep for Backwards {
///     fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()> {
///         for k in 0..table.n() {
///             table.round_rows(k, (0..table.n()).rev());
///             table.rounds_done(k + 1)?;
///         }
///         ControlFlow::Continue(())
///     }
///
///     fn name(&self) -> &str {
///         "backwards"
///     }
/// }
///
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n2 1 1\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let all = algo::floyd_warshall(&graph, Backwards, MemoryBudget::Machine).unwrap();
/// assert_eq!(all.distance(3, 1), Some(-1.0));
/// assert_eq!(algo::check_sweep(&graph, Backwards), Ok(()));
/// ```
pub trait Sweep {
    /// Runs every round on `table`, in an order that keeps the recurrence.
    fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()>;

    /// What the sweep is called, in reports and panics.
    fn name(&self) -> &str;
}

impl<S: Sweep + ?Sized> Sweep for &mut S {
    fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()> {
        (**self).run(table)
    }

    fn name(&self) -> &str {
        (**self).name()
    }
}

impl<S: Sweep + ?Sized> Sweep for Box<S> {
    fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()> {
        (**self).run(table)
    }

    fn name(&self) -> &str {
        (**self).name()
    }
}

/// The library's four sweeps.
impl Sweep for SweepKind {
    fn run(&mut self, table: &mut SweepTable<'_>) -> ControlFlow<()> {
        match self {
            // The textbook: every row, branch-free.
            SweepKind::Plain => {
                for k in 0..table.n() {
                    table.round(k, |_, _| true);
                    table.rounds_done(k + 1)?;
                }
            }
            // A row that cannot reach `k` yet cannot improve through it.
            SweepKind::Pruned => {
                for k in 0..table.n() {
                    table.round(k, |_, through| through != Weight::INFINITY);
                    table.rounds_done(k + 1)?;
                }
            }
            SweepKind::Parallel => {
                for k in 0..table.n() {
                    table.par_round(k, |_, through| through != Weight::INFINITY);
                    table.rounds_done(k + 1)?;
                }
            }
            // Venkataraman-Sahni-Mukhopadhyaya: for each tile `K` of the
            // diagonal, run the rounds `k ∈ K` on the diagonal tile, then on
            // the tiles of its row and its column (which read the diagonal
            // tile), then on every other tile (which reads one tile of each).
            // Each update reads values the plain order would have produced
            // by then, so the distances are the same; each tile fits in
            // cache, so its rounds cost cache hits instead of memory
            // bandwidth.
            SweepKind::Blocked => {
                const TILE: usize = 64;
                let n = table.n();
                let tiles = n.div_ceil(TILE);
                let span = |t: usize| t * TILE..((t + 1) * TILE).min(n);
                for kt in 0..tiles {
                    let ks = span(kt);
                    table.tile(ks.clone(), ks.clone(), ks.clone());
                    for t in (0..tiles).filter(|&t| t != kt) {
                        table.tile(ks.clone(), span(t), ks.clone());
                        table.tile(span(t), ks.clone(), ks.clone());
                    }
                    for it in (0..tiles).filter(|&t| t != kt) {
                        for jt in (0..tiles).filter(|&t| t != kt) {
                            table.tile(span(it), span(jt), ks.clone());
                        }
                    }
                    table.rounds_done(ks.end)?;
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn name(&self) -> &str {
        self.label()
    }
}

/// Why a run ended before its last round.
#[derive(Debug, Clone, Copy)]
enum Stop {
    /// A negative diagonal at this vertex (0-based).
    Cycle(usize),
    /// The progress callback stopped the run after this many rounds.
    Cancelled(usize),
}

/// The tables a [`Sweep`] walks, and the only ways it may change them.
/// Rows, columns and rounds are 0-based here: vertex `v` is index `v - 1`.
pub struct SweepTable<'a> {
    n: usize,
    distance: &'a mut [Weight],
    parent: &'a mut [Vertex],
    /// Row `k` of each table, copied out so the other rows can be updated
    /// while it is read, one after another or all at once.
    row_k: Vec<Weight>,
    parents_k: Vec<Vertex>,
    progress: &'a (dyn Fn(usize) -> Control + Sync),
    /// Rounds reported done.
    done: usize,
    stop: Option<Stop>,
}

impl<'a> SweepTable<'a> {
    fn new(
        n: usize,
        distance: &'a mut [Weight],
        parent: &'a mut [Vertex],
        progress: &'a (dyn Fn(usize) -> Control + Sync),
    ) -> Self {
        Self {
            n,
            distance,
            parent,
            row_k: vec![0.0; n],
            parents_k: vec![NO_VERTEX; n],
            progress,
            done: 0,
            stop: None,
        }
    }

    /// The number of vertices: rounds, rows and columns are `0..n`.
    pub fn n(&self) -> usize {
        self.n
    }

    /// `D[i][j]` as the table holds it now.
    pub fn distance(&self, i: usize, j: usize) -> Weight {
        self.distance[i * self.n + j]
    }

    /// Rounds reported done so far.
    pub fn rounds(&self) -> usize {
        self.done
    }

    /// Copies row `k` out (`n` cells, against the `n²` updates of a round).
    fn copy_row(&mut self, k: usize) {
        let n = self.n;
        self.row_k
            .copy_from_slice(&self.distance[k * n..(k + 1) * n]);
        self.parents_k
            .copy_from_slice(&self.parent[k * n..(k + 1) * n]);
    }

    /// Round `k` on every row `i` for which `keep(i, D[i][k])`, in order.
    /// Row `k` is never updated (round `k` cannot change it).
    pub fn round(&mut self, k: usize, keep: impl Fn(usize, Weight) -> bool) {
        self.copy_row(k);
        let n = self.n;
        for (i, (row, parents)) in self
            .distance
            .chunks_mut(n)
            .zip(self.parent.chunks_mut(n))
            .enumerate()
        {
            let through = row[k];
            if i != k && keep(i, through) {
                relax(row, parents, through, &self.row_k, &self.parents_k);
            }
        }
    }

    /// Round `k` on the given rows, in the given order.
    pub fn round_rows(&mut self, k: usize, rows: impl IntoIterator<Item = usize>) {
        self.copy_row(k);
        let n = self.n;
        for i in rows {
            if i == k {
                continue;
            }
            let through = self.distance[i * n + k];
            let row = &mut self.distance[i * n..(i + 1) * n];
            let parents = &mut self.parent[i * n..(i + 1) * n];
            relax(row, parents, through, &self.row_k, &self.parents_k);
        }
    }

    /// [`round`](Self::round) with the rows shared out over every core
    /// (they are independent once row `k` is read); one after another
    /// without the `parallel` feature, as in the browser.
    pub fn par_round(&mut self, k: usize, keep: impl Fn(usize, Weight) -> bool + Sync) {
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            self.copy_row(k);
            let n = self.n;
            let (row_k, parents_k) = (&self.row_k, &self.parents_k);
            self.distance
                .par_chunks_mut(n)
                .zip(self.parent.par_chunks_mut(n))
                .enumerate()
                .for_each(|(i, (row, parents))| {
                    let through = row[k];
                    if i != k && keep(i, through) {
                        relax(row, parents, through, row_k, parents_k);
                    }
                });
        }
        #[cfg(not(feature = "parallel"))]
        self.round(k, keep);
    }

    /// The rounds `ks`, in order, on the tile of rows `is` and columns `js`
    /// (rows that cannot improve skipped). A tile reads the cells of row
    /// `k` and column `k` as the table holds them, so the order of the
    /// tiles is the sweep's to get right.
    pub fn tile(&mut self, is: Range<usize>, js: Range<usize>, ks: Range<usize>) {
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

    /// Reports the rounds `0..rounds` complete. [`ControlFlow::Break`]
    /// when the run must end (a negative cycle on the diagonal, or the
    /// progress callback said so): the sweep returns then.
    ///
    /// # Panics
    ///
    /// When `rounds` is not past the rounds already reported, or past `n`.
    pub fn rounds_done(&mut self, rounds: usize) -> ControlFlow<()> {
        assert!(
            rounds > self.done && rounds <= self.n,
            "rounds reported out of order: {rounds} after {} of {}",
            self.done,
            self.n,
        );
        self.done = rounds;
        if let Some(i) = negative_diagonal(self.distance, self.n) {
            self.stop = Some(Stop::Cycle(i));
            return ControlFlow::Break(());
        }
        if (self.progress)(rounds) == Control::Break {
            self.stop = Some(Stop::Cancelled(rounds));
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

/// How a sweep's answer differs from the plain sweep's.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum SweepMismatch {
    /// One found a negative cycle and the other did not.
    #[error("the plain sweep {} a negative cycle, the sweep {}", if *.plain { "found" } else { "did not find" }, if *.plain { "did not" } else { "did" })]
    Cycle {
        /// Whether the plain sweep found it.
        plain: bool,
    },
    /// The first cell (in row order) where the distances differ.
    #[error("d({from}, {to}) is {sweep:?}, the plain sweep says {plain:?}")]
    Distance {
        /// The cell's row vertex.
        from: Vertex,
        /// The cell's column vertex.
        to: Vertex,
        /// The plain sweep's distance.
        plain: Option<Weight>,
        /// The sweep's distance.
        sweep: Option<Weight>,
    },
    /// A run failed for another reason (the table did not fit...).
    #[error(transparent)]
    Failed(FloydError),
}

/// Runs `sweep` and the plain sweep on `graph` and compares their answers:
/// `Ok` when every distance agrees (to rounding) or both find a negative
/// cycle. The test a [`Sweep`] of one's own should pass on many graphs.
pub fn check_sweep<G: Weighted, S: Sweep>(graph: &G, sweep: S) -> Result<(), SweepMismatch> {
    let budget = MemoryBudget::Machine;
    let plain = floyd_warshall(graph, SweepKind::Plain, budget);
    let other = floyd_warshall(graph, sweep, budget);
    match (plain, other) {
        (Ok(plain), Ok(other)) => {
            let n = plain.vertex_count() as Vertex;
            for from in 1..=n {
                for to in 1..=n {
                    let (a, b) = (plain.distance(from, to), other.distance(from, to));
                    let same = match (a, b) {
                        (None, None) => true,
                        (Some(x), Some(y)) => (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0),
                        _ => false,
                    };
                    if !same {
                        return Err(SweepMismatch::Distance {
                            from,
                            to,
                            plain: a,
                            sweep: b,
                        });
                    }
                }
            }
            Ok(())
        }
        (Err(FloydError::NegativeCycle(_)), Err(FloydError::NegativeCycle(_))) => Ok(()),
        (Err(FloydError::NegativeCycle(_)), Ok(_)) => Err(SweepMismatch::Cycle { plain: true }),
        (Ok(_), Err(FloydError::NegativeCycle(_))) => Err(SweepMismatch::Cycle { plain: false }),
        (Err(error), _) | (_, Err(error)) => Err(SweepMismatch::Failed(error)),
    }
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

impl AllPairs {
    /// The bytes the tables need, or the refusal when over `budget`.
    fn check_budget(n: usize, budget: MemoryBudget) -> Result<usize, FloydError> {
        let required_bytes = AllPairs::required_bytes(n);
        match budget.limit_bytes() {
            Some(limit_bytes) if required_bytes > limit_bytes => Err(FloydError::TooLarge {
                vertex_count: n,
                required_bytes,
                limit_bytes,
            }),
            _ => Ok(required_bytes),
        }
    }

    /// Tables of `n × n` cells, every distance `+∞` and no predecessor,
    /// within `budget`.
    pub(super) fn empty(n: usize, budget: MemoryBudget) -> Result<Self, FloydError> {
        let required_bytes = Self::check_budget(n, budget)?;
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
        Ok(Self {
            vertex_count: n,
            distance,
            parent,
        })
    }

    /// Row `i` of both tables, indexed by `j - 1`.
    pub(super) fn row_mut(&mut self, i: Vertex) -> (&mut [Weight], &mut [Vertex]) {
        let n = self.vertex_count;
        let start = (i as usize - 1) * n;
        (
            &mut self.distance[start..start + n],
            &mut self.parent[start..start + n],
        )
    }
}

/// The tables before the first round: 0 on the diagonal, the arcs, `+∞`.
fn initial<G: Weighted>(graph: &G, budget: MemoryBudget) -> Result<AllPairs, FloydError> {
    let n = graph.vertex_count();
    let mut all = AllPairs::empty(n, budget)?;
    let (distance, parent) = (&mut all.distance, &mut all.parent);
    for i in graph.vertices() {
        let row = (i as usize - 1) * n;
        distance[row + i as usize - 1] = 0.0;
        for (j, weight) in graph.weighted_neighbors(i) {
            distance[row + j as usize - 1] = weight;
            parent[row + j as usize - 1] = i;
        }
    }
    Ok(all)
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

/// The first vertex (0-based) with a negative diagonal, if any.
fn negative_diagonal(distance: &[Weight], n: usize) -> Option<usize> {
    (0..n).find(|&i| distance[i * n + i] < 0.0)
}

/// Floyd-Warshall one round at a time, for a replay: the plain sweep's
/// rounds in order, each reporting the cells it improved, so the table can
/// be shown as it stood after any round `k` (the dynamic programme's
/// `D_k`). The tables are the same as [`floyd_warshall`]'s; the improved
/// cells are found by comparing, so a round costs a little more than the
/// plain sweep's vectorised one. Meant for graphs small enough to watch.
///
/// ```
/// use graphman::{Build, Csr, EdgeList, MemoryBudget, Orientation};
/// use graphman::algo::FloydRounds;
/// let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n2 1 1\n", Orientation::Directed).unwrap();
/// let graph = Csr::build(&edges).unwrap();
/// let mut rounds = FloydRounds::new(&graph, MemoryBudget::Machine).unwrap();
/// assert_eq!(rounds.table().distance(1, 2), Some(4.0));
/// let mut improved = Vec::new();
/// while rounds.step(&mut improved).unwrap() {}
/// assert_eq!(rounds.rounds_done(), 3);
/// assert_eq!(rounds.table().distance(1, 2), Some(1.0));
/// ```
pub struct FloydRounds<'g, G> {
    graph: &'g G,
    all: AllPairs,
    /// Rounds done: the next round takes vertex `k + 1` as the intermediate.
    k: usize,
    row_k: Vec<Weight>,
    parents_k: Vec<Vertex>,
}

impl<'g, G: Weighted> FloydRounds<'g, G> {
    /// The tables before the first round (`D_0`: 0 on the diagonal, the
    /// arcs, `+∞`), within `budget`. A negative loop is already a negative
    /// cycle.
    pub fn new(graph: &'g G, budget: MemoryBudget) -> Result<Self, FloydError> {
        if let Some(edge) = graph.negative_loops().first() {
            return Err(NegativeCycle::new(vec![edge.u], edge.weight).into());
        }
        let all = initial(graph, budget)?;
        let n = all.vertex_count;
        Ok(Self {
            graph,
            all,
            k: 0,
            row_k: vec![0.0; n],
            parents_k: vec![NO_VERTEX; n],
        })
    }

    /// The tables after [`rounds_done`](Self::rounds_done) rounds.
    pub fn table(&self) -> &AllPairs {
        &self.all
    }

    /// Rounds done so far (`n` when the run is over).
    pub fn rounds_done(&self) -> usize {
        self.k
    }

    /// Runs the next round, pushing to `improved` the cell `(i, j)` of every
    /// distance it lowered, row by row. `Ok(false)` once every round is
    /// done (nothing ran); the negative cycle when the round put one on the
    /// diagonal.
    pub fn step(&mut self, improved: &mut Vec<(Vertex, Vertex)>) -> Result<bool, NegativeCycle> {
        let n = self.all.vertex_count;
        let k = self.k;
        if k == n {
            return Ok(false);
        }
        self.row_k
            .copy_from_slice(&self.all.distance[k * n..(k + 1) * n]);
        self.parents_k
            .copy_from_slice(&self.all.parent[k * n..(k + 1) * n]);
        for i in 0..n {
            let through = self.all.distance[i * n + k];
            if i == k || through == Weight::INFINITY {
                continue;
            }
            let row = &mut self.all.distance[i * n..(i + 1) * n];
            let parents = &mut self.all.parent[i * n..(i + 1) * n];
            for j in 0..n {
                let candidate = through + self.row_k[j];
                if candidate < row[j] {
                    row[j] = candidate;
                    parents[j] = self.parents_k[j];
                    improved.push((i as Vertex + 1, j as Vertex + 1));
                }
            }
        }
        self.k += 1;
        if let Some(i) = negative_diagonal(&self.all.distance, n) {
            let i = i as Vertex + 1;
            return Err(self
                .all
                .cycle_through(self.graph, i)
                .or_else(|| negative_cycle(self.graph, ScheduleKind::Queue))
                .expect("a negative diagonal is a closed walk of negative weight"));
        }
        Ok(true)
    }

    /// Runs the rounds left and returns the tables, as [`floyd_warshall`]
    /// would (rows looping through a zero-weight cycle regrown).
    pub fn finish(mut self) -> Result<AllPairs, NegativeCycle> {
        let mut improved = Vec::new();
        while self.step(&mut improved)? {
            improved.clear();
        }
        self.all.regrow_looping_rows(self.graph);
        Ok(self.all)
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
