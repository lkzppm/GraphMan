//! Diameter: the longest shortest path in the graph.
//!
//! Four strategies share one driver. The driver walks the connected
//! components from largest to smallest, skips every component that is too
//! small to beat the best value found so far (a component with `s` vertices
//! has diameter at most `s - 1`) and hands that value to the exact methods
//! as a floor, so a dense giant component whose sweep already shows it cannot
//! beat a sparser small one costs five BFS runs instead of thousands.
//!
//! * [`DiameterMethod::Exact`] — one BFS per vertex; the textbook `O(n·m)`.
//! * [`DiameterMethod::IFub`] — the iFUB algorithm of Crescenzi, Grossi,
//!   Habib, Lanzi and Marino (*Theoretical Computer Science*, 2013). Exact,
//!   with the same worst case, but on real-world graphs it stops after a
//!   handful of BFS runs instead of `n`.
//! * [`DiameterMethod::Bounds`] — the bounding algorithm of Takes and Kosters
//!   (*CIKM 2011*, *Algorithms 2013*). Keeps a lower and an upper bound on the
//!   eccentricity of every vertex, tightens them after each BFS and prunes
//!   every vertex that can no longer beat the best distance seen. Where iFUB
//!   struggles (random graphs, where most vertices share the last BFS level)
//!   this needs several times fewer BFS runs.
//! * [`DiameterMethod::Sweep`] — the 4-sweep lower bound iFUB starts from
//!   (four BFS runs). Cheap and usually tight, but not certified.
//!
//! Every method can be cancelled through the progress callback; the result
//! is then the best lower bound found so far, flagged as not exact.

use super::components::Components;
use super::distance::eccentricity_into;
use super::traversal::{Control, SearchTree};
use crate::graph::{Graph, NO_VERTEX, Vertex};
use core::fmt;
use core::str::FromStr;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Components with at most this many vertices are always brute-forced.
const SMALL_COMPONENT: usize = 32;

/// Which diameter strategy to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum DiameterMethod {
    /// One BFS per vertex.
    Exact,
    /// iFUB: exact with far fewer BFS runs in practice.
    IFub,
    /// Takes–Kosters eccentricity bounding: exact, prunes vertex by vertex.
    Bounds,
    /// 4-sweep lower bound: four BFS runs, not certified exact.
    Sweep,
}

impl DiameterMethod {
    /// Every method, in the order they are usually reported.
    pub const ALL: [DiameterMethod; 4] = [
        DiameterMethod::Sweep,
        DiameterMethod::IFub,
        DiameterMethod::Bounds,
        DiameterMethod::Exact,
    ];

    /// Command-line identifier (`exact`, `ifub`, `bounds`, `sweep`).
    pub fn label(self) -> &'static str {
        match self {
            DiameterMethod::Exact => "exact",
            DiameterMethod::IFub => "ifub",
            DiameterMethod::Bounds => "bounds",
            DiameterMethod::Sweep => "sweep",
        }
    }

    /// Whether the method certifies its answer when it runs to completion.
    pub fn is_exact(self) -> bool {
        self != DiameterMethod::Sweep
    }
}

impl fmt::Display for DiameterMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

impl FromStr for DiameterMethod {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "exact" | "brute" | "brute-force" => Ok(DiameterMethod::Exact),
            "ifub" => Ok(DiameterMethod::IFub),
            "bounds" | "tk" | "takes-kosters" => Ok(DiameterMethod::Bounds),
            "sweep" | "approx" | "4-sweep" => Ok(DiameterMethod::Sweep),
            other => Err(format!(
                "unknown diameter method {other:?} (expected exact, ifub, bounds or sweep)"
            )),
        }
    }
}

/// The result of a diameter computation.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Diameter {
    /// The diameter (a lower bound when `is_exact` is false).
    pub value: u32,
    /// Two vertices at distance `value`.
    pub endpoints: (Vertex, Vertex),
    /// The method that produced it.
    pub method: DiameterMethod,
    /// How many BFS runs it took.
    pub bfs_count: usize,
    /// Whether `value` is certified to be the diameter.
    pub is_exact: bool,
    /// Whether the computation was cancelled through the progress callback.
    pub cancelled: bool,
}

/// Progress callback: receives the running BFS count and may stop the run.
pub type Progress<'a> = &'a (dyn Fn(usize) -> Control + Sync);

/// Computes the diameter with the given method.
///
/// On a disconnected graph this is the largest diameter over all components
/// (distances between components are infinite and ignored).
pub fn diameter<G: Graph + Sync>(graph: &G, method: DiameterMethod) -> Diameter {
    diameter_with_progress(graph, method, &|_| Control::Continue)
}

/// [`diameter`] with a callback that receives the running BFS count after
/// every search and may return [`Control::Break`] to stop early.
pub fn diameter_with_progress<G: Graph + Sync>(
    graph: &G,
    method: DiameterMethod,
    progress: Progress<'_>,
) -> Diameter {
    let components = Components::compute(graph);
    let mut ctx = Context {
        graph,
        tree: SearchTree::new(graph.vertex_count()),
        bfs_count: AtomicUsize::new(0),
        cancelled: AtomicBool::new(false),
        progress,
    };
    let mut value = 0u32;
    let mut endpoints = (1 as Vertex, 1 as Vertex);

    // Exact methods start with a 4-sweep of every component large enough to
    // matter. Four BFS runs per component are cheap, and a good lower bound
    // up front lets the exact methods prune far more aggressively: it is not
    // unusual for the diameter to live in a small tree-like component rather
    // than in the giant one.
    if method.is_exact() {
        for members in components.iter() {
            if members.len().saturating_sub(1) <= value as usize || ctx.is_cancelled() {
                break;
            }
            let (candidate, ends) = if members.len() == 2 {
                (1, (members[0], members[1]))
            } else if members.len() <= SMALL_COMPONENT {
                ctx.brute_force(members)
            } else {
                let (lb, ends, _) = ctx.sweep(members);
                (lb, ends)
            };
            if candidate > value {
                value = candidate;
                endpoints = ends;
            }
        }
    }

    for members in components.iter() {
        // Components are sorted by size; once one cannot beat `value`, none can.
        if members.len().saturating_sub(1) <= value as usize || ctx.is_cancelled() {
            break;
        }
        let (candidate, ends) = if members.len() == 2 {
            (1, (members[0], members[1]))
        } else {
            match method {
                DiameterMethod::Exact => ctx.brute_force(members),
                _ if members.len() <= SMALL_COMPONENT => ctx.brute_force(members),
                DiameterMethod::IFub => ctx.ifub(members, value),
                DiameterMethod::Bounds => ctx.bounding(members, value),
                DiameterMethod::Sweep => {
                    let (lb, ends, _) = ctx.sweep(members);
                    (lb, ends)
                }
            }
        };
        if candidate > value {
            value = candidate;
            endpoints = ends;
        }
    }
    let cancelled = ctx.is_cancelled();
    Diameter {
        value,
        endpoints,
        method,
        bfs_count: ctx.bfs_count.into_inner(),
        is_exact: method.is_exact() && !cancelled,
        cancelled,
    }
}

/// Shared state of one diameter run.
struct Context<'a, G> {
    graph: &'a G,
    tree: SearchTree,
    bfs_count: AtomicUsize,
    cancelled: AtomicBool,
    progress: Progress<'a>,
}

/// `(eccentricity, from, to)`; larger eccentricity wins, then smaller `from`.
type Candidate = (u32, Vertex, Vertex);

const NO_CANDIDATE: Candidate = (0, Vertex::MAX, NO_VERTEX);

fn better(a: Candidate, b: Candidate) -> bool {
    a.0 > b.0 || (a.0 == b.0 && a.1 < b.1)
}

/// Counts one BFS and asks the callback whether to go on.
fn tick(bfs_count: &AtomicUsize, cancelled: &AtomicBool, progress: Progress<'_>) {
    let done = bfs_count.fetch_add(1, Ordering::Relaxed) + 1;
    if progress(done) == Control::Break {
        cancelled.store(true, Ordering::Relaxed);
    }
}

impl<G: Graph + Sync> Context<'_, G> {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// How many independent BFS runs to launch at once.
    fn batch_size(&self) -> usize {
        #[cfg(feature = "parallel")]
        {
            rayon::current_num_threads().max(1)
        }
        #[cfg(not(feature = "parallel"))]
        {
            1
        }
    }

    /// Eccentricity of `v`, leaving the BFS in `self.tree`.
    fn ecc(&mut self, v: Vertex) -> (u32, Vertex) {
        let result = eccentricity_into(self.graph, v, &mut self.tree);
        tick(&self.bfs_count, &self.cancelled, self.progress);
        result
    }

    /// The vertex `steps` levels above `v` in `self.tree`.
    fn ancestor(&self, mut v: Vertex, steps: u32) -> Vertex {
        for _ in 0..steps {
            match self.tree.parent(v) {
                Some(p) => v = p,
                None => break,
            }
        }
        v
    }

    /// Runs one BFS per source, in parallel when available, returning each
    /// source's eccentricity, farthest vertex and full search tree.
    fn eccentricities(&self, sources: &[Vertex]) -> Vec<(Vertex, u32, Vertex, SearchTree)> {
        let n = self.graph.vertex_count();
        let graph = self.graph;
        let (bfs_count, cancelled, progress) = (&self.bfs_count, &self.cancelled, self.progress);
        let run = |&v: &Vertex| {
            let mut tree = SearchTree::new(n);
            let (ecc, far) = eccentricity_into(graph, v, &mut tree);
            tick(bfs_count, cancelled, progress);
            (v, ecc, far, tree)
        };
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            sources.par_iter().map(run).collect()
        }
        #[cfg(not(feature = "parallel"))]
        {
            sources.iter().map(run).collect()
        }
    }

    /// Largest eccentricity over `vertices`, in parallel when available.
    fn max_eccentricity(&mut self, vertices: &[Vertex]) -> Candidate {
        #[cfg(feature = "parallel")]
        {
            use rayon::prelude::*;
            let threads = self.batch_size();
            if vertices.len() >= 2 * threads {
                let n = self.graph.vertex_count();
                let graph = self.graph;
                let (bfs_count, cancelled, progress) =
                    (&self.bfs_count, &self.cancelled, self.progress);
                let chunk = vertices.len().div_ceil(threads * 4).max(1);
                return vertices
                    .par_chunks(chunk)
                    .map(|chunk| {
                        let mut tree = SearchTree::new(n);
                        let mut best = NO_CANDIDATE;
                        for &v in chunk {
                            if cancelled.load(Ordering::Relaxed) {
                                break;
                            }
                            let (ecc, far) = eccentricity_into(graph, v, &mut tree);
                            tick(bfs_count, cancelled, progress);
                            if better((ecc, v, far), best) {
                                best = (ecc, v, far);
                            }
                        }
                        best
                    })
                    .reduce(|| NO_CANDIDATE, |a, b| if better(b, a) { b } else { a });
            }
        }
        let mut best = NO_CANDIDATE;
        for &v in vertices {
            if self.is_cancelled() {
                break;
            }
            let (ecc, far) = self.ecc(v);
            if better((ecc, v, far), best) {
                best = (ecc, v, far);
            }
        }
        best
    }

    /// Textbook exact diameter of one component.
    fn brute_force(&mut self, members: &[Vertex]) -> (u32, (Vertex, Vertex)) {
        let (ecc, from, to) = self.max_eccentricity(members);
        (ecc, (from, to))
    }

    /// The vertex of highest degree (smallest id on ties): a good first source.
    fn hub(&self, members: &[Vertex]) -> Vertex {
        members
            .iter()
            .copied()
            .max_by_key(|&v| (self.graph.degree(v), core::cmp::Reverse(v)))
            .expect("components are never empty")
    }

    /// The 4-sweep heuristic: returns a lower bound, its endpoints and the
    /// midpoint of the last sweep (iFUB's starting vertex).
    fn sweep(&mut self, members: &[Vertex]) -> (u32, (Vertex, Vertex), Vertex) {
        let (_, a1) = self.ecc(self.hub(members));
        let (e1, b1) = self.ecc(a1);
        let m1 = self.ancestor(b1, e1 / 2);
        let (_, a2) = self.ecc(m1);
        let (e2, b2) = self.ecc(a2);
        let m2 = self.ancestor(b2, e2 / 2);
        if e2 > e1 {
            (e2, (a2, b2), m2)
        } else {
            (e1, (a1, b1), m2)
        }
    }

    /// iFUB: exact diameter of one component.
    ///
    /// `floor` is the best value found in other components. The component
    /// only matters if it can beat it, so pruning starts from the larger of
    /// the floor and the component's own sweep; when nothing beats the floor
    /// the returned endpoints are meaningless and the caller ignores them.
    fn ifub(&mut self, members: &[Vertex], floor: u32) -> (u32, (Vertex, Vertex)) {
        let (mut lb, mut endpoints, u) = self.sweep(members);
        lb = lb.max(floor);
        let (ecc_u, _) = self.ecc(u);

        // Snapshot the BFS from `u`, bucketed by level (the order is already
        // sorted by level, so buckets are contiguous slices).
        let order: Vec<Vertex> = self.tree.order().to_vec();
        let mut starts = vec![0usize; ecc_u as usize + 2];
        for &v in &order {
            starts[self.tree.level(v).expect("in order") as usize + 1] += 1;
        }
        for l in 1..starts.len() {
            starts[l] += starts[l - 1];
        }

        let mut i = ecc_u as usize;
        let mut ub = 2 * ecc_u;
        while ub > lb && i >= 1 && !self.is_cancelled() {
            let fringe = &order[starts[i]..starts[i + 1]];
            let (b_i, from, to) = self.max_eccentricity(fringe);
            if b_i > lb {
                lb = b_i;
                endpoints = (from, to);
            }
            let bound = 2 * (i as u32 - 1);
            if lb > bound {
                break;
            }
            ub = bound;
            i -= 1;
        }
        (lb, endpoints)
    }

    /// Takes–Kosters bounding: exact diameter of one component.
    ///
    /// After a BFS from `v` with eccentricity `e`, every vertex `w` at
    /// distance `d` satisfies `max(e - d, d) <= ecc(w) <= e + d`. Vertices
    /// whose upper bound cannot exceed the best eccentricity seen are dropped.
    /// Sources are chosen alternately as the candidate with the largest upper
    /// bound (a diameter candidate) and the one with the smallest lower bound
    /// (a good centre, which tightens everyone's upper bound); one batch of
    /// sources per round is searched in parallel. `floor` is the best value
    /// found in other components, as in [`ifub`](Self::ifub).
    fn bounding(&mut self, members: &[Vertex], floor: u32) -> (u32, (Vertex, Vertex)) {
        let mut candidates: Vec<Vertex> = members.to_vec();
        let mut lower = vec![0u32; candidates.len()];
        let mut upper = vec![u32::MAX; candidates.len()];
        // Seed with the 4-sweep so that the running lower bound is good from
        // the start; its vertices also make an excellent first batch.
        let (mut best, mut endpoints, midpoint) = self.sweep(members);
        best = best.max(floor);
        let batch = self.batch_size();
        let mut round = 0usize;

        while !candidates.is_empty() && !self.is_cancelled() {
            // Pick this round's sources.
            let mut chosen: Vec<usize> = Vec::with_capacity(batch);
            if round == 0 {
                for v in [self.hub(members), endpoints.0, endpoints.1, midpoint] {
                    let i = candidates.iter().position(|&w| w == v).expect("a member");
                    if !chosen.contains(&i) && chosen.len() < batch {
                        chosen.push(i);
                    }
                }
            }
            let mut pick_high = true;
            while chosen.len() < batch.min(candidates.len()) {
                let free = (0..candidates.len()).filter(|i| !chosen.contains(i));
                let pick = if pick_high {
                    free.max_by_key(|&i| (upper[i], lower[i], core::cmp::Reverse(candidates[i])))
                } else {
                    free.min_by_key(|&i| (lower[i], upper[i], candidates[i]))
                };
                chosen.push(pick.expect("at least one free candidate"));
                pick_high = !pick_high;
            }
            let sources: Vec<Vertex> = chosen.iter().map(|&i| candidates[i]).collect();
            let results = self.eccentricities(&sources);
            for &(v, ecc, far, _) in &results {
                if ecc > best {
                    best = ecc;
                    endpoints = (v, far);
                }
            }

            // Tighten every candidate's bounds with every new BFS.
            let update = |(i, &w): (usize, &Vertex)| {
                let (mut lo, mut up) = (lower[i], upper[i]);
                for (_, ecc, _, tree) in &results {
                    let d = tree.levels_raw()[w as usize];
                    lo = lo.max((ecc - d).max(d));
                    up = up.min(ecc + d);
                }
                (lo, up)
            };
            let bounds: Vec<(u32, u32)> = {
                #[cfg(feature = "parallel")]
                {
                    use rayon::prelude::*;
                    candidates.par_iter().enumerate().map(update).collect()
                }
                #[cfg(not(feature = "parallel"))]
                {
                    candidates.iter().enumerate().map(update).collect()
                }
            };

            // Prune: settled vertices and vertices that cannot beat `best`.
            let mut kept = 0usize;
            for i in 0..candidates.len() {
                let (lo, up) = bounds[i];
                let w = candidates[i];
                if lo == up {
                    if lo > best {
                        // Settled by bounds alone: one BFS recovers the partner.
                        let (ecc, far) = self.ecc(w);
                        best = ecc;
                        endpoints = (w, far);
                    }
                    continue;
                }
                if up <= best {
                    continue;
                }
                candidates[kept] = w;
                lower[kept] = lo;
                upper[kept] = up;
                kept += 1;
            }
            candidates.truncate(kept);
            lower.truncate(kept);
            upper.truncate(kept);
            round += 1;
        }
        (best, endpoints)
    }
}
