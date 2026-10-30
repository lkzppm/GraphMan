//! The Part 2 case study: Dijkstra on a weighted graph.
//!
//! Two questions per graph: the distance and the shortest path from one
//! source to a few targets (10 to 20, 30, 40, 50 and 60 on the course
//! graphs; Edsger W. Dijkstra to five researchers, by name, on the
//! collaboration network), and the mean time of one single-source Dijkstra
//! per frontier over `k` random sources. The vector frontier is `O(n²)` per
//! source, so each frontier gets a wall-clock budget: when it runs out the
//! cell records the runs that finished, and when none did, how far the one
//! cut short got and what a whole run would take at that pace.
//!
//! A third measure goes with the second: the memory each frontier holds,
//! counted on a few untimed runs from the same sources. A decrease-key
//! frontier never holds more than one entry per vertex; one that pushes a
//! lowered estimate again holds up to one per improving relaxation.

use super::{Args, Input, Section};
use crate::load::{GraphArgs, display_vertex, resolve_vertex};
use crate::report::*;
use crate::rng::SplitMix64;
use crate::ui::{self, Ui};
use anyhow::Result;
use graphman::algo::{
    Components, Control, Frontier, FrontierKind, HeapFrontier, LazyHeapFrontier, Measured,
    PairingHeapFrontier, QuadHeapFrontier, RadixHeapFrontier, ShortestPathTree, VectorFrontier,
    dijkstra, dijkstra_into, weight_stats,
};
use graphman::{
    AnyGraph, NegativeWeight, Vertex, VertexNames, Visitor, Weight, Weighted, dispatch,
};
use std::fmt::Write as _;
use std::hint::black_box;
use std::mem::size_of;
use std::time::{Duration, Instant};

/// Runs the Part 2 questions in `sections` on one weighted graph; the
/// questions left out keep the answers of `previous`.
pub fn study(
    input: &Input,
    args: &Args,
    sections: &[Section],
    previous: Option<WeightedStudy>,
    ui: &Ui,
) -> Result<WeightedStudy> {
    let names = args.names.load(ui)?;
    let load = GraphArgs {
        graph: input.path.clone(),
        repr: args.dijkstra_repr,
        force: false,
    };
    let edges = &input.edges;
    let graph = load.build(edges, ui)?;
    let n = graph.vertex_count();
    if !graph.is_weighted() {
        ui.warn("the graph has no weights: every edge weighs 1, so distances are hop counts");
    }
    let weights = dispatch!(&graph, g => weight_stats(g));
    let negative_edge = graph.negative_edge();
    let refusal = negative_edge.map(|edge| NegativeWeight { edge }.to_string());
    if let Some(refusal) = &refusal {
        ui.warn(refusal);
    }
    let (mut paths, mut frontiers, mut memory) = previous
        .map(|p| (p.paths, p.frontiers, p.memory))
        .unwrap_or_default();

    if refusal.is_some() {
        (paths, frontiers, memory) = (Vec::new(), Vec::new(), None);
    } else {
        if sections.contains(&Section::Paths) {
            paths = shortest_paths(&graph, args, names.as_ref(), ui)?;
        }
        let roots =
            SplitMix64::new(args.seed).distinct_vertices(n, args.runs.max(args.memory_runs));
        if sections.contains(&Section::Frontiers) {
            let roots = &roots[..args.runs.min(roots.len())];
            let budget = Duration::from_secs_f64(args.dijkstra_budget);
            let mut components = None;
            for &kind in &args.frontiers {
                let result = time_frontier(&graph, kind, roots, budget, &mut components, ui);
                frontiers.retain(|f| f.frontier != kind);
                frontiers.push(result);
            }
            frontiers.sort_by_key(|f| FrontierKind::ALL.iter().position(|&k| k == f.frontier));
        }
        if sections.contains(&Section::FrontierMemory) {
            let roots = &roots[..args.memory_runs.min(roots.len())];
            memory = Some(measure_memory(&graph, &args.frontiers, roots, memory, ui));
        }
    }

    Ok(WeightedStudy {
        name: input.name.clone(),
        file: input.path.display().to_string(),
        names_file: args.names.names.as_ref().map(|p| p.display().to_string()),
        vertices: n,
        edges: graph.edge_count(),
        self_loops_dropped: edges.self_loops_dropped(),
        duplicates_dropped: edges.duplicates_dropped(),
        parse_ms: input.parse_ms,
        weights,
        representation: args.dijkstra_repr,
        refusal,
        negative_edge,
        paths,
        frontiers,
        memory,
        machine: MachineInfo::detect(),
        generated_at_unix: super::now_unix(),
    })
}

/// Question 1: one Dijkstra from the source, then the path to each target.
/// Every frontier builds the same tree, so the fastest one answers it.
fn shortest_paths(
    graph: &AnyGraph,
    args: &Args,
    names: Option<&VertexNames>,
    ui: &Ui,
) -> Result<Vec<PathAnswer>> {
    let n = graph.vertex_count();
    let from = resolve_vertex(&args.from, names, n)?;
    let targets = args
        .to
        .iter()
        .map(|t| resolve_vertex(t, names, n))
        .collect::<Result<Vec<_>>>()?;
    let tree = dispatch!(graph, g => dijkstra(g, from, FrontierKind::Heap))?;
    let answers: Vec<PathAnswer> = targets
        .into_iter()
        .map(|to| {
            let path = tree.path_to(to).unwrap_or_default();
            let name = |v: Vertex| names.and_then(|names| names.name(v)).map(str::to_owned);
            PathAnswer {
                from,
                to,
                from_name: name(from),
                to_name: name(to),
                distance: tree.distance(to),
                distances: path.iter().filter_map(|&v| tree.distance(v)).collect(),
                names: names.map(|names| {
                    path.iter()
                        .map(|&v| names.name(v).unwrap_or("?").to_owned())
                        .collect()
                }),
                path,
            }
        })
        .collect();
    for a in &answers {
        ui.kv(
            &format!(
                "d({}, {})",
                display_vertex(a.from, names),
                display_vertex(a.to, names)
            ),
            match a.distance {
                Some(d) => format!("{} over {}", ui::weight(d), edges(a.path.len() - 1)),
                None => "∞ (another component)".into(),
            },
        );
    }
    Ok(answers)
}

/// Question 2 for one frontier: one Dijkstra per root until the roots or
/// the budget run out. Only the algorithm is timed; the frontier and the
/// tree are allocated once and reset by each run.
fn time_frontier(
    graph: &AnyGraph,
    kind: FrontierKind,
    roots: &[Vertex],
    budget: Duration,
    components: &mut Option<Components>,
    ui: &Ui,
) -> FrontierStudy {
    let n = graph.vertex_count();
    let bar = ui.progress(
        Some(roots.len() as u64),
        &format!("Dijkstra ({}) × {}", kind.label(), roots.len()),
    );
    let tick = || bar.inc(1);
    let (samples, cut) = match kind {
        FrontierKind::Vector => {
            dispatch!(graph, g => time_runs(g, VectorFrontier::new(n), roots, budget, tick))
        }
        FrontierKind::Heap => {
            dispatch!(graph, g => time_runs(g, HeapFrontier::new(n), roots, budget, tick))
        }
        FrontierKind::LazyHeap => {
            dispatch!(graph, g => time_runs(g, LazyHeapFrontier::new(n), roots, budget, tick))
        }
        FrontierKind::QuadHeap => {
            dispatch!(graph, g => time_runs(g, QuadHeapFrontier::new(n), roots, budget, tick))
        }
        FrontierKind::Pairing => {
            dispatch!(graph, g => time_runs(g, PairingHeapFrontier::new(n), roots, budget, tick))
        }
        FrontierKind::Radix => {
            dispatch!(graph, g => time_runs(g, RadixHeapFrontier::new(n), roots, budget, tick))
        }
    };
    bar.finish_and_clear();

    let budget_exhausted = cut.is_some();
    let timing = (!samples.is_empty()).then(|| Timing::from_samples(samples));
    // With no finished run, the one cut short still says what a run costs.
    let partial = match (&timing, cut) {
        (None, Some((root, settled, elapsed))) => {
            let components = components.get_or_insert_with(|| {
                ui.step("components, to size the run the budget cut short");
                dispatch!(graph, g => Components::compute(g))
            });
            let reachable = components.size(components.component_of(root));
            let elapsed_ms = elapsed.as_secs_f64() * 1000.0;
            Some(PartialRun {
                root,
                settled,
                reachable,
                elapsed_ms,
                estimated_ms: elapsed_ms * reachable as f64 / settled.max(1) as f64,
            })
        }
        _ => None,
    };
    let shown = match (&timing, &partial) {
        (Some(t), _) => format!(
            "{:.3} ms over {} of {} runs{}",
            t.mean_ms,
            t.runs,
            roots.len(),
            if budget_exhausted { " (budget)" } else { "" }
        ),
        (None, Some(p)) => format!(
            "no run finished in {}; one settled {} of {} vertices, ≈ {} per run",
            ui::duration(budget),
            p.settled,
            p.reachable,
            long_duration(p.estimated_ms)
        ),
        (None, None) => "no runs".into(),
    };
    ui.kv(&format!("Dijkstra {} mean", kind.label()), shown);
    FrontierStudy {
        frontier: kind,
        requested_runs: roots.len(),
        budget_s: budget.as_secs_f64(),
        timing,
        budget_exhausted,
        partial,
    }
}

/// Times one Dijkstra per root with `frontier`. Returns the finished runs'
/// times in milliseconds and, if the budget ran out, the run it cut short:
/// its root, how many vertices it had settled and for how long it ran.
fn time_runs<G: Weighted, F: Frontier>(
    graph: &G,
    mut frontier: F,
    roots: &[Vertex],
    budget: Duration,
    tick: impl Fn(),
) -> (Vec<f64>, Option<(Vertex, usize, Duration)>) {
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    let mut samples = Vec::with_capacity(roots.len());
    let mut watch = Deadline::new(Instant::now() + budget);
    for &root in roots {
        let start = Instant::now();
        dijkstra_into(graph, root, &mut frontier, &mut tree, &mut watch)
            .expect("negative weights are refused before timing");
        let elapsed = start.elapsed();
        if watch.expired {
            return (samples, Some((root, tree.reached_count(), elapsed)));
        }
        black_box(tree.reached_count());
        samples.push(elapsed.as_secs_f64() * 1000.0);
        tick();
    }
    (samples, None)
}

/// The memory question: one untimed Dijkstra per root with each frontier
/// counted by [`Measured`]. The frontiers left out keep `previous`'s answers.
fn measure_memory(
    graph: &AnyGraph,
    kinds: &[FrontierKind],
    roots: &[Vertex],
    previous: Option<MemoryStudy>,
    ui: &Ui,
) -> MemoryStudy {
    let n = graph.vertex_count();
    let mut tree = ShortestPathTree::new(n);
    let mut frontiers = previous.map(|p| p.frontiers).unwrap_or_default();
    for &kind in kinds {
        // The vector is sized, not run: its one array of estimates never
        // grows, and a run on the large graphs takes hours.
        let roots = match kind {
            FrontierKind::Vector => &[][..],
            _ => roots,
        };
        let bar = ui.progress(
            Some(roots.len() as u64),
            &format!("memory ({}) × {}", kind.label(), roots.len()),
        );
        let tick = || bar.inc(1);
        let t = &mut tree;
        let result = match kind {
            FrontierKind::Vector => {
                dispatch!(graph, g => count_runs(g, VectorFrontier::new(n), roots, t, tick))
            }
            FrontierKind::Heap => {
                dispatch!(graph, g => count_runs(g, HeapFrontier::new(n), roots, t, tick))
            }
            FrontierKind::LazyHeap => {
                dispatch!(graph, g => count_runs(g, LazyHeapFrontier::new(n), roots, t, tick))
            }
            FrontierKind::QuadHeap => {
                dispatch!(graph, g => count_runs(g, QuadHeapFrontier::new(n), roots, t, tick))
            }
            FrontierKind::Pairing => {
                dispatch!(graph, g => count_runs(g, PairingHeapFrontier::new(n), roots, t, tick))
            }
            FrontierKind::Radix => {
                dispatch!(graph, g => count_runs(g, RadixHeapFrontier::new(n), roots, t, tick))
            }
        };
        bar.finish_and_clear();
        let peak = result.runs.iter().map(|r| r.peak_entries).max();
        ui.kv(
            &format!("{} memory", kind.label()),
            match peak {
                Some(peak) => format!(
                    "{} (at most {peak} entries)",
                    ui::bytes(result.allocated_bytes)
                ),
                None => ui::bytes(result.allocated_bytes),
            },
        );
        frontiers.retain(|f| f.frontier != kind);
        frontiers.push(result);
    }
    frontiers.sort_by_key(|f| FrontierKind::ALL.iter().position(|&k| k == f.frontier));
    MemoryStudy {
        graph_bytes: graph.heap_bytes(),
        tree_bytes: tree.heap_bytes(),
        frontiers,
    }
}

/// One counted Dijkstra per root with `frontier`, reused across the runs
/// as in the timing, so its storage ends at the largest run's size.
fn count_runs<G: Weighted, F: Frontier>(
    graph: &G,
    frontier: F,
    roots: &[Vertex],
    tree: &mut ShortestPathTree,
    tick: impl Fn(),
) -> FrontierMemory {
    let kind = frontier.kind();
    let base_bytes = frontier.heap_bytes();
    let mut frontier = Measured::new(frontier);
    let runs = roots
        .iter()
        .map(|&root| {
            dijkstra_into(graph, root, &mut frontier, tree, &mut ())
                .expect("negative weights are refused before measuring");
            let counts = frontier.counts();
            tick();
            MemoryRun {
                root,
                settled: counts.pops,
                decreases: counts.decreases,
                peak_entries: counts.peak_len,
            }
        })
        .collect();
    FrontierMemory {
        frontier: kind,
        base_bytes,
        allocated_bytes: frontier.heap_bytes(),
        // An estimate and a vertex, padded to 16 bytes; the vector and the
        // pairing heap keep theirs in the arrays indexed by vertex.
        entry_bytes: match kind {
            FrontierKind::Vector | FrontierKind::Pairing => 0,
            _ => size_of::<(Weight, Vertex)>(),
        },
        runs,
    }
}

/// Stops a run once the budget's deadline has passed. The clock is read
/// every 256 settles, so the check costs every frontier the same few
/// nanoseconds and a vector run on millions of vertices still stops within
/// a fraction of a second of the deadline.
struct Deadline {
    at: Instant,
    settled: u32,
    expired: bool,
}

impl Deadline {
    fn new(at: Instant) -> Self {
        Self {
            at,
            settled: 0,
            expired: false,
        }
    }
}

impl Visitor for Deadline {
    fn settle(&mut self, _v: Vertex, _parent: Vertex, _distance: Weight) -> Control {
        self.settled = self.settled.wrapping_add(1);
        if self.settled % 256 == 0 && Instant::now() >= self.at {
            self.expired = true;
            return Control::Break;
        }
        Control::Continue
    }
}

/// `1 edge`, `4 edges`.
fn edges(count: usize) -> String {
    match count {
        1 => "1 edge".into(),
        c => format!("{c} edges"),
    }
}

/// A duration that may run to hours or days (an extrapolated vector run).
fn long_duration(ms: f64) -> String {
    let s = ms / 1000.0;
    match s {
        s if s < 3600.0 => ui::duration(Duration::from_secs_f64(s)),
        s if s < 86_400.0 => format!("{:.1} h", s / 3600.0),
        s => format!("{:.1} days", s / 86_400.0),
    }
}

/// A mean run time: milliseconds like the Part 1 tables, seconds from one up.
fn mean(ms: f64) -> String {
    match ms < 1000.0 {
        true => format!("{ms:.3} ms"),
        false => format!("{:.2} s", ms / 1000.0),
    }
}

/// A frontier's cell in the timing table.
fn cell(f: Option<&FrontierStudy>) -> String {
    let Some(f) = f else {
        return "—".into();
    };
    match (&f.timing, &f.partial) {
        (Some(t), _) if f.budget_exhausted => format!(
            "{} ({} of {} runs in {:.0} s)",
            mean(t.mean_ms),
            t.runs,
            f.requested_runs,
            f.budget_s
        ),
        (Some(t), _) => mean(t.mean_ms),
        (None, Some(p)) => format!(
            "≈ {} (no run in {:.0} s; one settled {:.1}% of its component)",
            long_duration(p.estimated_ms),
            f.budget_s,
            100.0 * p.settled as f64 / p.reachable.max(1) as f64
        ),
        (None, None) => "—".into(),
    }
}

/// The mean of a frontier's finished runs, or the estimate when none finished.
fn mean_or_estimate(f: Option<&FrontierStudy>) -> Option<f64> {
    let f = f?;
    f.timing
        .as_ref()
        .map(|t| t.mean_ms)
        .or(f.partial.as_ref().map(|p| p.estimated_ms))
}

/// The Part 2 tables: the paths of each graph, then the timings.
pub fn markdown(md: &mut String, studies: &[WeightedStudy]) {
    let _ = writeln!(md, "\n# Part 2: weighted graphs\n");
    let _ = writeln!(
        md,
        "Dijkstra runs on the {} representation. Every frontier builds the same tree, so the paths come from one run with the heap.",
        studies.first().map_or("compressed sparse row".into(), |s| s
            .representation
            .to_string())
    );

    let _ = writeln!(md, "\n## 1. Distance and shortest path\n");
    for s in studies {
        let _ = writeln!(md, "### {}\n", s.name);
        if let Some(refusal) = &s.refusal {
            let _ = writeln!(md, "Refused: {refusal}.\n");
            continue;
        }
        let Some(first) = s.paths.first() else {
            let _ = writeln!(md, "Not studied.\n");
            continue;
        };
        let source = match &first.from_name {
            Some(name) => format!("{name} ({})", first.from),
            None => first.from.to_string(),
        };
        let _ = writeln!(md, "From {source}.\n");
        let _ = writeln!(md, "| To | Distance | Edges | Shortest path |");
        let _ = writeln!(md, "|---|---:|---:|---|");
        for p in &s.paths {
            let to = match &p.to_name {
                Some(name) => format!("{name} ({})", p.to),
                None => p.to.to_string(),
            };
            match p.distance {
                Some(d) => {
                    let path = match &p.names {
                        Some(names) => names.join(" → "),
                        None => p
                            .path
                            .iter()
                            .map(Vertex::to_string)
                            .collect::<Vec<_>>()
                            .join(" → "),
                    };
                    let _ = writeln!(
                        md,
                        "| {to} | {} | {} | {path} |",
                        ui::weight(d),
                        p.path.len() - 1
                    );
                }
                None => {
                    let _ = writeln!(md, "| {to} | ∞ | — | not reachable (another component) |");
                }
            }
        }
        let _ = writeln!(md);
    }

    let _ = writeln!(md, "## 2. Mean time of one single-source Dijkstra\n");
    let runs = studies
        .iter()
        .flat_map(|s| &s.frontiers)
        .map(|f| f.requested_runs)
        .max()
        .unwrap_or(0);
    let _ = writeln!(
        md,
        "Mean over {runs} distinct random sources (the Part 1 seed); a frontier that runs out of its budget reports the runs that finished, or an estimate from the run it cut short.\n"
    );
    let kinds: Vec<FrontierKind> = FrontierKind::ALL
        .into_iter()
        .filter(|&k| {
            studies
                .iter()
                .any(|s| s.frontiers.iter().any(|f| f.frontier == k))
        })
        .collect();
    let _ = write!(md, "| Graph | Vertices | Edges |");
    for k in &kinds {
        let _ = write!(md, " {} |", k.label());
    }
    let _ = writeln!(md, " vector / heap |");
    let _ = writeln!(md, "|---|---:|---:|{}---:|", "---:|".repeat(kinds.len()));
    for s in studies.iter().filter(|s| s.refusal.is_none()) {
        let find = |k: FrontierKind| s.frontiers.iter().find(|f| f.frontier == k);
        let _ = write!(md, "| {} | {} | {} |", s.name, s.vertices, s.edges);
        for &k in &kinds {
            let _ = write!(md, " {} |", cell(find(k)));
        }
        let ratio = match (
            mean_or_estimate(find(FrontierKind::Vector)),
            mean_or_estimate(find(FrontierKind::Heap)),
        ) {
            (Some(v), Some(h)) if h > 0.0 => format!("{:.0}×", v / h),
            _ => "—".into(),
        };
        let _ = writeln!(md, " {ratio} |");
    }

    let measured: Vec<&WeightedStudy> = studies.iter().filter(|s| s.memory.is_some()).collect();
    if measured.is_empty() {
        return;
    }
    let _ = writeln!(md, "\n## 3. Memory of each frontier\n");
    let _ = writeln!(
        md,
        "Bytes each frontier owns after a few untimed runs from the first sources: its arrays indexed by vertex, plus the entry storage the largest run needed (as allocated). In brackets, the most entries it held at once. The vector is sized, not run: one estimate per vertex, never grown. Decreases are the estimates handed in, one per relaxation that lowered one (the root's included): the ceiling for a frontier that pushes again instead of lowering a key.\n"
    );
    let kinds: Vec<FrontierKind> = FrontierKind::ALL
        .into_iter()
        .filter(|&k| {
            measured.iter().any(|s| {
                s.memory
                    .as_ref()
                    .is_some_and(|m| m.frontiers.iter().any(|f| f.frontier == k))
            })
        })
        .collect();
    let _ = write!(
        md,
        "| Graph | Vertices | Edges | Graph bytes | Tree bytes | Decreases |"
    );
    for k in &kinds {
        let _ = write!(md, " {} |", k.label());
    }
    let _ = writeln!(
        md,
        "\n|---|---:|---:|---:|---:|---:|{}",
        "---:|".repeat(kinds.len())
    );
    for s in measured {
        let Some(memory) = &s.memory else { continue };
        let decreases = memory
            .frontiers
            .iter()
            .flat_map(|f| &f.runs)
            .map(|r| r.decreases)
            .max()
            .map_or("—".into(), |d| d.to_string());
        let _ = write!(
            md,
            "| {} | {} | {} | {} | {} | {decreases} |",
            s.name,
            s.vertices,
            s.edges,
            ui::bytes(memory.graph_bytes),
            ui::bytes(memory.tree_bytes)
        );
        for &k in &kinds {
            let cell = match memory.frontiers.iter().find(|f| f.frontier == k) {
                None => "—".into(),
                Some(f) => match f.runs.iter().map(|r| r.peak_entries).max() {
                    Some(peak) => format!("{} ({peak})", ui::bytes(f.allocated_bytes)),
                    None => ui::bytes(f.allocated_bytes),
                },
            };
            let _ = write!(md, " {cell} |");
        }
        let _ = writeln!(md);
    }
}
