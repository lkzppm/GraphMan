//! The Part 3 case study: Bellman-Ford and Floyd-Warshall on a directed
//! weighted graph.
//!
//! Four questions per graph:
//!
//! 1. the distance from 10, 20 and 30 to 100 (Bellman-Ford to the target,
//!    on the transpose), with the paths and the negative-cycle verdicts;
//! 2. the distances between the pairs of {10, 20, 30, 40, 50}
//!    (Floyd-Warshall, or one Bellman-Ford per row when its `n × n` table
//!    does not fit, and the table says which);
//! 3. the mean time of each algorithm over 10 runs, in seconds: every
//!    Bellman-Ford schedule, every Floyd-Warshall sweep, and BFS, DFS and
//!    Dijkstra on the same digraph for scale;
//! 4. all pairs by `n` Bellman-Fords (one per target) against
//!    Floyd-Warshall, Johnson (one Bellman-Ford and `n` Dijkstras), and
//!    `n` plain Dijkstras when no arc is negative.
//!
//! Timings exclude parsing, building the representation and its transpose
//! (built once, like the representation) and writing. Every cell has a
//! wall-clock budget; a run the budget cuts short is scaled to a whole run
//! when its pace says what one costs (Floyd-Warshall's rounds, the textbook
//! Bellman-Ford's passes, the targets done of an all-pairs run).

use super::{Args, Input, Section};
use crate::commands::bench::{Search, time_searches};
use crate::load::GraphArgs;
use crate::report::*;
use crate::rng::SplitMix64;
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{
    AllPairs, Control, DfsKind, FloydError, FrontierKind, HeapFrontier, MeasuredSchedule,
    Reweighted, Schedule, ScheduleCounts, ScheduleKind, ShortestPathTree, Start, SweepKind,
    bellman_ford, bellman_ford_to_into, dijkstra_into, floyd_warshall,
    floyd_warshall_with_progress, negative_cycle, potentials, weight_stats,
};
use graphman::{AnyGraph, Build, MemoryBudget, Vertex, Weight, dispatch};
use std::fmt::Write as _;
use std::hint::black_box;
use std::time::{Duration, Instant};

/// Runs the Part 3 questions in `sections`; the ones left out keep the
/// answers of `previous`.
pub fn study(
    input: &Input,
    args: &Args,
    sections: &[Section],
    previous: Option<DirectedStudy>,
    ui: &Ui,
) -> Result<DirectedStudy> {
    let load = GraphArgs {
        graph: input.path.clone(),
        repr: args.dijkstra_repr,
        force: false,
        directed: args.directed,
    };
    let edges = &input.edges;
    let graph = load.build(edges, ui)?;
    let n = graph.vertex_count();
    let start = Instant::now();
    let transpose = match graph.is_directed() {
        true => Some(
            graph
                .transpose_within(MemoryBudget::Machine)
                .context("building the transpose")?,
        ),
        false => None,
    };
    let reverse = transpose.as_ref().unwrap_or(&graph);
    if transpose.is_some() {
        ui.step(&format!(
            "transposed in {} (not timed)",
            ui::duration(start.elapsed())
        ));
    }
    let target = args.target;
    anyhow::ensure!(
        (1..=n as Vertex).contains(&target),
        "target {target} is outside 1..={n}"
    );

    let mut study = previous.unwrap_or_else(|| DirectedStudy {
        name: input.name.clone(),
        file: input.path.display().to_string(),
        directed: graph.is_directed(),
        vertices: n,
        edges: graph.edge_count(),
        self_loops_dropped: edges.self_loops_dropped(),
        duplicates_dropped: edges.duplicates_dropped(),
        negative_loops: edges.negative_loops().len(),
        parse_ms: input.parse_ms,
        weights: None,
        representation: args.dijkstra_repr,
        target,
        paths: Vec::new(),
        counts: None,
        cycle_to_target: None,
        cycle_anywhere: None,
        pairs: None,
        timings: Vec::new(),
        all_pairs: Vec::new(),
        machine: MachineInfo::detect(),
        generated_at_unix: 0,
    });
    study.weights = dispatch!(&graph, g => weight_stats(g));
    study.machine = MachineInfo::detect();
    study.generated_at_unix = super::now_unix();

    if sections.contains(&Section::BellmanFord) {
        question_one(&graph, reverse, args, &mut study, ui);
    }
    if sections.contains(&Section::FloydWarshall) {
        study.pairs = Some(question_two(&graph, &args.pairs_of, ui));
    }
    let budget = Duration::from_secs_f64(args.part3_budget);
    if sections.contains(&Section::Timings) {
        study.timings = question_three(&graph, reverse, args, budget, ui);
    }
    if sections.contains(&Section::AllPairs) {
        study.all_pairs = question_four(&graph, reverse, args, &study.timings, ui);
    }
    Ok(study)
}

/// Question 1: one Bellman-Ford to the target, then the path from each source.
fn question_one(
    graph: &AnyGraph,
    reverse: &AnyGraph,
    args: &Args,
    study: &mut DirectedStudy,
    ui: &Ui,
) {
    let n = graph.vertex_count();
    let target = args.target;
    let mut tree = ShortestPathTree::new(n);
    let mut schedule = MeasuredSchedule::new(ScheduleKind::Queue.schedule());
    let result =
        dispatch!(reverse, g => bellman_ford_to_into(g, target, &mut schedule, &mut tree, &mut ()));
    study.counts = Some(schedule.counts());
    study.target = target;
    study.paths.clear();
    study.cycle_to_target = None;
    match result {
        Err(cycle) => {
            ui.warn(&format!(
                "a {cycle} reaches {target}: no distance to it is defined"
            ));
            study.cycle_to_target = Some(cycle);
        }
        Ok(()) => {
            for &from in &args.sources {
                if !(1..=n as Vertex).contains(&from) {
                    ui.warn(&format!("source {from} is outside 1..={n}"));
                    continue;
                }
                let path = tree.path_from(from).unwrap_or_default();
                // The distance from each vertex of the path to the target.
                let distances = path.iter().filter_map(|&v| tree.distance(v)).collect();
                let answer = PathAnswer {
                    from,
                    to: target,
                    distance: tree.distance(from),
                    path,
                    distances,
                    from_name: None,
                    to_name: None,
                    names: None,
                };
                ui.kv(
                    &format!("d({from}, {target})"),
                    match answer.distance {
                        Some(d) => format!("{} in {} arcs", ui::weight(d), answer.path.len() - 1),
                        None => "∞ (no path)".into(),
                    },
                );
                study.paths.push(answer);
            }
        }
    }
    study.cycle_anywhere = dispatch!(graph, g => negative_cycle(g, ScheduleKind::Queue));
    ui.kv(
        "negative cycle",
        match &study.cycle_anywhere {
            Some(cycle) => format!(
                "yes, {} arcs of weight {}",
                cycle.len(),
                ui::weight(cycle.weight)
            ),
            None => "none".into(),
        },
    );
}

/// Question 2: the table of the pairs, by Floyd-Warshall when it fits.
fn question_two(graph: &AnyGraph, vertices: &[Vertex], ui: &Ui) -> PairsAnswer {
    let n = graph.vertex_count();
    let vertices: Vec<Vertex> = vertices
        .iter()
        .copied()
        .filter(|v| (1..=n as Vertex).contains(v))
        .collect();
    let table_bytes = AllPairs::required_bytes(n);
    let mut answer = PairsAnswer {
        vertices: vertices.clone(),
        distances: Vec::new(),
        method: "floyd-warshall".into(),
        table_bytes,
        refusal: None,
        negative_cycle: None,
    };
    let start = Instant::now();
    match dispatch!(graph, g => floyd_warshall(g, SweepKind::Parallel, MemoryBudget::Machine)) {
        Ok(all) => {
            answer.distances = vertices
                .iter()
                .map(|&i| vertices.iter().map(|&j| all.distance(i, j)).collect())
                .collect();
            ui.step(&format!(
                "floyd-warshall (parallel) in {}",
                ui::duration(start.elapsed())
            ));
        }
        Err(FloydError::NegativeCycle(cycle)) => {
            ui.warn(&format!("floyd-warshall: {cycle}"));
            answer.negative_cycle = Some(cycle);
        }
        Err(refusal) => {
            ui.warn(&format!("floyd-warshall refused: {refusal}"));
            answer.refusal = Some(refusal.to_string());
            answer.method = "bellman-ford".into();
            // One Bellman-Ford from each row's vertex gives the same row.
            for &i in &vertices {
                match dispatch!(graph, g => bellman_ford(g, i, ScheduleKind::Queue)) {
                    Ok(tree) => answer
                        .distances
                        .push(vertices.iter().map(|&j| tree.distance(j)).collect()),
                    Err(cycle) => {
                        answer.negative_cycle = Some(cycle);
                        answer.distances.clear();
                        break;
                    }
                }
            }
        }
    }
    for (&i, row) in vertices.iter().zip(&answer.distances) {
        let shown: Vec<String> = row
            .iter()
            .map(|d| d.map_or("∞".into(), ui::weight))
            .collect();
        ui.kv(&format!("from {i}"), shown.join("  "));
    }
    answer
}

/// Question 3: the mean of `--repeats` runs of each algorithm.
fn question_three(
    graph: &AnyGraph,
    reverse: &AnyGraph,
    args: &Args,
    budget: Duration,
    ui: &Ui,
) -> Vec<AlgorithmTiming> {
    let n = graph.vertex_count();
    let runs = args.repeats;
    let mut timings = Vec::new();
    for &kind in &args.schedules {
        let timing = time_bellman_ford(reverse, args.target, kind, runs, budget);
        show(ui, &timing);
        timings.push(timing);
    }
    for &sweep in &args.sweeps {
        let timing = time_floyd_warshall(graph, sweep, runs, budget, ui);
        show(ui, &timing);
        timings.push(timing);
    }
    // The searches of Parts 1 and 2 on the same digraph, for scale.
    let roots = SplitMix64::new(args.seed).distinct_vertices(n, runs);
    for search in [
        Search::Bfs,
        Search::Dfs(DfsKind::Iterative),
        Search::Dijkstra(FrontierKind::Heap),
    ] {
        let (algorithm, variant) = match search {
            Search::Bfs => ("bfs", "queue"),
            Search::Dfs(_) => ("dfs", "iterative"),
            Search::Dijkstra(_) => ("dijkstra", "heap"),
        };
        let mut timing = cell(algorithm, variant, runs, budget.as_secs_f64());
        match (search, graph.negative_edge()) {
            (Search::Dijkstra(_), Some(edge)) => {
                timing.refusal = Some(graphman::NegativeWeight { edge }.to_string());
            }
            _ => timing.timing = Some(time_searches(graph, &roots, search, ui)),
        }
        show(ui, &timing);
        timings.push(timing);
    }
    timings
}

/// Question 4: every pair, three ways.
fn question_four(
    graph: &AnyGraph,
    reverse: &AnyGraph,
    args: &Args,
    timings: &[AlgorithmTiming],
    ui: &Ui,
) -> Vec<AlgorithmTiming> {
    let budget = Duration::from_secs_f64(args.apsp_budget);
    let runs = args.repeats;
    let mut all = Vec::new();
    let bar = ui.progress(None, "bellman-ford to every target");
    let timing = time_all_sources(reverse, runs, budget, AllPairsKind::BellmanFord, &|| {
        bar.inc(1)
    });
    bar.finish_and_clear();
    show(ui, &timing);
    all.push(timing);
    // Floyd-Warshall answers all pairs in one run: question 3's timing of the
    // sequential sweeps is its cell, measured again only if missing.
    for sweep in [SweepKind::Pruned, SweepKind::Parallel] {
        let found = timings
            .iter()
            .find(|t| t.algorithm == "floyd-warshall" && t.variant == sweep.label());
        let timing = match found {
            Some(t) => t.clone(),
            None => time_floyd_warshall(graph, sweep, runs, budget, ui),
        };
        show(ui, &timing);
        all.push(timing);
    }
    let mut dijkstra = cell("dijkstra-all", "heap", runs, budget.as_secs_f64());
    match graph.negative_edge() {
        Some(edge) => dijkstra.refusal = Some(graphman::NegativeWeight { edge }.to_string()),
        None => {
            let bar = ui.progress(None, "dijkstra from every source");
            dijkstra =
                time_all_sources(graph, runs, budget, AllPairsKind::Dijkstra, &|| bar.inc(1));
            bar.finish_and_clear();
        }
    }
    show(ui, &dijkstra);
    all.push(dijkstra);
    let bar = ui.progress(None, "johnson: potentials, then dijkstra from every source");
    let johnson = time_all_sources(graph, runs, budget, AllPairsKind::Johnson, &|| bar.inc(1));
    bar.finish_and_clear();
    show(ui, &johnson);
    all.push(johnson);
    all
}

/// An empty timing cell.
fn cell(algorithm: &str, variant: &str, runs: usize, budget_s: f64) -> AlgorithmTiming {
    AlgorithmTiming {
        algorithm: algorithm.into(),
        variant: variant.into(),
        requested_runs: runs,
        budget_s,
        timing: None,
        budget_exhausted: false,
        estimated_ms: None,
        refusal: None,
        counts: None,
        note: None,
    }
}

/// Prints a cell as it is measured.
fn show(ui: &Ui, t: &AlgorithmTiming) {
    let value = match (&t.timing, t.estimated_ms, &t.refusal) {
        (_, Some(estimate), Some(refusal)) => {
            format!("≈ {} (estimated; refused: {refusal})", seconds(estimate))
        }
        (_, _, Some(refusal)) => format!("refused: {refusal}"),
        (Some(timing), _, _) => format!(
            "{} over {} of {} runs{}",
            seconds(timing.mean_ms),
            timing.runs,
            t.requested_runs,
            if t.budget_exhausted { " (budget)" } else { "" }
        ),
        (None, Some(estimate), _) => format!(
            "≈ {} (estimated, no run within the budget)",
            seconds(estimate)
        ),
        (None, None, _) => format!("over {} s, no estimate", t.budget_s),
    };
    ui.kv(&format!("{} {}", t.algorithm, t.variant), value);
}

/// A time in seconds, as the handout asks.
pub fn seconds(ms: f64) -> String {
    let s = ms / 1000.0;
    match s {
        s if s < 0.001 => format!("{s:.6} s"),
        s if s < 10.0 => format!("{s:.4} s"),
        s if s < 3600.0 => format!("{s:.1} s"),
        s if s < 86_400.0 => format!("{:.1} h", s / 3600.0),
        s => format!("{:.1} days", s / 86_400.0),
    }
}

/// Ends a schedule's run when a deadline passes (checked every 1024 scans),
/// so a textbook Bellman-Ford on a large graph cannot outlive its budget.
struct Deadline<S> {
    inner: S,
    at: Instant,
    calls: u32,
    expired: bool,
}

impl<S: Schedule> Schedule for Deadline<S> {
    fn reset(&mut self, vertex_count: usize, start: Start) {
        self.calls = 0;
        self.inner.reset(vertex_count, start);
    }

    fn next(&mut self) -> Option<Vertex> {
        self.calls = self.calls.wrapping_add(1);
        if self.calls % 1024 == 0 && Instant::now() >= self.at {
            self.expired = true;
            return None;
        }
        self.inner.next()
    }

    fn lowered(&mut self, v: Vertex, distance: &[Weight]) {
        self.inner.lowered(v, distance);
    }

    fn passes(&self) -> usize {
        self.inner.passes()
    }

    fn kind(&self) -> ScheduleKind {
        self.inner.kind()
    }

    fn heap_bytes(&self) -> usize {
        self.inner.heap_bytes()
    }
}

/// Bellman-Ford to `target` with one schedule, `runs` times (the transpose
/// and the tree built once).
fn time_bellman_ford(
    reverse: &AnyGraph,
    target: Vertex,
    kind: ScheduleKind,
    runs: usize,
    budget: Duration,
) -> AlgorithmTiming {
    let n = reverse.vertex_count();
    let mut timing = cell("bellman-ford", kind.label(), runs, budget.as_secs_f64());
    let mut tree = ShortestPathTree::new(n);
    let deadline = Instant::now() + budget;
    let mut samples = Vec::new();
    for _ in 0..runs {
        let mut schedule = Deadline {
            inner: MeasuredSchedule::new(kind.schedule()),
            at: deadline,
            calls: 0,
            expired: false,
        };
        let start = Instant::now();
        let result = dispatch!(reverse, g => bellman_ford_to_into(g, target, &mut schedule, &mut tree, &mut ()));
        let elapsed = start.elapsed();
        black_box(tree.reached_count());
        if schedule.expired {
            timing.budget_exhausted = true;
            // The textbook does n passes without a negative cycle: its pace
            // says what a run costs. The others' passes vary.
            let passes = schedule.inner.counts().passes;
            if samples.is_empty() && kind == ScheduleKind::Rounds && passes > 0 {
                timing.estimated_ms =
                    Some(elapsed.as_secs_f64() * 1000.0 * n as f64 / passes as f64);
            }
            timing.counts = Some(schedule.inner.counts());
            break;
        }
        if let Err(cycle) = result {
            timing.note = Some(format!("stops at a {cycle}"));
        }
        timing.counts = Some(schedule.inner.counts());
        samples.push(elapsed.as_secs_f64() * 1000.0);
    }
    if !samples.is_empty() {
        timing.timing = Some(Timing::from_samples(samples));
    }
    timing
}

/// Floyd-Warshall with one sweep, `runs` times, within the memory budget
/// and the time budget.
fn time_floyd_warshall(
    graph: &AnyGraph,
    sweep: SweepKind,
    runs: usize,
    budget: Duration,
    ui: &Ui,
) -> AlgorithmTiming {
    let n = graph.vertex_count();
    let mut timing = cell("floyd-warshall", sweep.label(), runs, budget.as_secs_f64());
    let deadline = Instant::now() + budget;
    let mut samples = Vec::new();
    let bar = ui.progress(Some((runs * n) as u64), &format!("floyd-warshall {sweep}"));
    for run in 0..runs {
        let progress = |rounds: usize| {
            bar.set_position((run * n + rounds) as u64);
            match Instant::now() >= deadline {
                true => Control::Break,
                false => Control::Continue,
            }
        };
        let start = Instant::now();
        let result = dispatch!(graph, g => floyd_warshall_with_progress(g, sweep, MemoryBudget::Machine, &progress));
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        match result {
            Ok(all) => {
                black_box(all.heap_bytes());
                samples.push(elapsed);
            }
            Err(FloydError::NegativeCycle(cycle)) => {
                timing.note = Some(format!("stops at a {cycle}"));
                samples.push(elapsed);
            }
            Err(FloydError::Cancelled { rounds, of }) => {
                timing.budget_exhausted = true;
                if samples.is_empty() && rounds > 0 {
                    // Every round costs the same n² updates.
                    timing.estimated_ms = Some(elapsed * of as f64 / rounds as f64);
                }
                break;
            }
            Err(refusal) => {
                timing.refusal = Some(refusal.to_string());
                bar.finish_and_clear();
                estimate_floyd_warshall(graph, sweep, &mut timing, ui);
                return timing;
            }
        }
    }
    bar.finish_and_clear();
    if !samples.is_empty() {
        timing.timing = Some(Timing::from_samples(samples));
    }
    timing
}

/// Vertices of the stand-in digraph a refused Floyd-Warshall is timed on.
const STAND_IN: usize = 1024;

/// When the table does not fit, what one run would take: one run of the
/// same sweep on a random digraph of [`STAND_IN`] vertices with the graph's
/// mean out-degree and weights in its range (made non-negative, so no
/// negative cycle ends the run early), scaled by `(n / STAND_IN)³`. Every
/// round of the plain and blocked sweeps updates all `n²` cells whatever the
/// arcs; a random digraph of the same degree reaches about as much as the
/// graph, so the pruned sweep skips about as many rows.
fn estimate_floyd_warshall(
    graph: &AnyGraph,
    sweep: SweepKind,
    timing: &mut AlgorithmTiming,
    ui: &Ui,
) {
    let n = graph.vertex_count();
    if n <= STAND_IN {
        return;
    }
    let degree = graph.edge_count() / n.max(1);
    let high = dispatch!(graph, g => weight_stats(g)).map_or(1.0, |w| w.max.abs().max(w.min.abs()));
    let mut rng = SplitMix64::new(0x5EED);
    let arcs: Vec<(Vertex, Vertex, Weight)> = (1..=STAND_IN as Vertex)
        .flat_map(|u| (0..degree).map(move |_| u))
        .map(|u| {
            let v = (rng.next_u64() % STAND_IN as u64) as Vertex + 1;
            let w = (rng.next_u64() >> 11) as Weight / (1u64 << 53) as Weight * high;
            (u, v, w)
        })
        .collect();
    let Ok(edges) = graphman::EdgeList::from_weighted_edges_with(
        STAND_IN,
        arcs,
        graphman::Orientation::Directed,
    ) else {
        return;
    };
    let Ok(stand_in) = graphman::Csr::build(&edges) else {
        return;
    };
    let start = Instant::now();
    let result = floyd_warshall(&stand_in, sweep, MemoryBudget::Machine);
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    if result.is_ok() {
        let scale = (n as f64 / STAND_IN as f64).powi(3);
        timing.estimated_ms = Some(elapsed * scale);
        timing.note = Some(format!(
            "estimated from one run on a random digraph of {STAND_IN} vertices and the same mean out-degree, scaled by (n / {STAND_IN})³"
        ));
        ui.step(&format!(
            "floyd-warshall {sweep} on a {STAND_IN}-vertex stand-in: {}, ≈ {} at {n}",
            ui::duration(Duration::from_secs_f64(elapsed / 1000.0)),
            seconds(elapsed * scale)
        ));
    }
}

#[derive(Clone, Copy, PartialEq)]
enum AllPairsKind {
    /// One Bellman-Ford (queue) to each target, on the transpose.
    BellmanFord,
    /// One Dijkstra (heap) from each source.
    Dijkstra,
    /// Johnson: the potentials (one Bellman-Ford from everywhere), then one
    /// Dijkstra (heap) from each source on the reweighted view.
    Johnson,
}

/// All pairs by one single-source run per vertex, `runs` times. When the
/// budget runs out before the first full pass over the vertices ends, the
/// vertices done (each costs about the same on a random graph) are scaled to
/// all `n`, and the cell says it is an estimate.
fn time_all_sources(
    graph: &AnyGraph,
    runs: usize,
    budget: Duration,
    kind: AllPairsKind,
    tick: &dyn Fn(),
) -> AlgorithmTiming {
    let n = graph.vertex_count();
    let (algorithm, variant) = match kind {
        AllPairsKind::BellmanFord => ("bellman-ford-all", "queue"),
        AllPairsKind::Dijkstra => ("dijkstra-all", "heap"),
        AllPairsKind::Johnson => ("johnson", "heap"),
    };
    let mut timing = cell(algorithm, variant, runs, budget.as_secs_f64());
    let deadline = Instant::now() + budget;
    let mut tree = ShortestPathTree::new(n);
    let mut schedule = MeasuredSchedule::new(ScheduleKind::Queue.schedule());
    let mut frontier = HeapFrontier::new(n);
    let mut samples = Vec::new();
    let mut cycles = 0usize;
    let (mut scans, mut lowered, mut targets) = (0usize, 0usize, 0usize);
    'runs: for _ in 0..runs {
        let start = Instant::now();
        // Johnson's potentials are part of its time.
        let h = match kind {
            AllPairsKind::Johnson => {
                match dispatch!(graph, g => potentials(g, ScheduleKind::Queue)) {
                    Ok(h) => h,
                    Err(cycle) => {
                        timing.note = Some(format!("stops at a {cycle}"));
                        samples.push(start.elapsed().as_secs_f64() * 1000.0);
                        continue;
                    }
                }
            }
            _ => Vec::new(),
        };
        for v in 1..=n as Vertex {
            match kind {
                AllPairsKind::Johnson => {
                    dispatch!(graph, g => dijkstra_into(&Reweighted::new(g, &h), v, &mut frontier, &mut tree, &mut ()))
                        .expect("reweighted arcs are non-negative");
                }
                AllPairsKind::BellmanFord => {
                    let result = dispatch!(graph, g => bellman_ford_to_into(g, v, &mut schedule, &mut tree, &mut ()));
                    cycles += usize::from(result.is_err());
                    scans += schedule.counts().scans;
                    lowered += schedule.counts().lowered;
                    targets += 1;
                }
                AllPairsKind::Dijkstra => {
                    dispatch!(graph, g => dijkstra_into(g, v, &mut frontier, &mut tree, &mut ()))
                        .expect("negative arcs are refused before timing");
                }
            }
            black_box(tree.reached_count());
            if v % 64 == 0 {
                tick();
            }
            if Instant::now() >= deadline && (v as usize) < n {
                timing.budget_exhausted = true;
                if samples.is_empty() {
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                    timing.estimated_ms = Some(elapsed * n as f64 / v as f64);
                }
                break 'runs;
            }
        }
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    if kind == AllPairsKind::BellmanFord {
        // The mean work of one target's run.
        timing.counts = Some(ScheduleCounts {
            scans: scans / targets.max(1),
            lowered: lowered / targets.max(1),
            passes: 0,
        });
        if cycles > 0 {
            timing.note = Some(format!("{cycles} target runs stopped at a negative cycle"));
        }
    }
    if !samples.is_empty() {
        timing.timing = Some(Timing::from_samples(samples));
    }
    timing
}

/// The Part 3 tables.
pub fn markdown(md: &mut String, studies: &[DirectedStudy]) {
    let _ = writeln!(
        md,
        "\n# Part 3: directed graphs, Bellman-Ford and Floyd-Warshall\n"
    );
    let _ = writeln!(
        md,
        "Every algorithm runs on the {} representation; distances to a target come from Bellman-Ford from it on the transpose, built once and not timed.",
        studies.first().map_or("compressed sparse row".into(), |s| s
            .representation
            .to_string())
    );

    let _ = writeln!(md, "\n## 1. Bellman-Ford: distance to the target\n");
    for s in studies {
        let kind = if s.directed { "directed" } else { "undirected" };
        let _ = writeln!(
            md,
            "### {} ({kind}, {} vertices, {} arcs)\n",
            s.name, s.vertices, s.edges
        );
        if let Some(cycle) = &s.cycle_to_target {
            let _ = writeln!(md, "No answer: a {cycle} reaches {}.\n", s.target);
        } else if s.paths.is_empty() {
            let _ = writeln!(md, "Not studied.\n");
        } else {
            let _ = writeln!(md, "| From | To | Distance | Arcs | Shortest path |");
            let _ = writeln!(md, "|---:|---:|---:|---:|---|");
            for p in &s.paths {
                match p.distance {
                    Some(d) => {
                        let path: Vec<String> = p.path.iter().map(Vertex::to_string).collect();
                        let _ = writeln!(
                            md,
                            "| {} | {} | {} | {} | {} |",
                            p.from,
                            p.to,
                            ui::weight(d),
                            p.path.len() - 1,
                            shorten(&path)
                        );
                    }
                    None => {
                        let _ = writeln!(md, "| {} | {} | ∞ | | no path |", p.from, p.to);
                    }
                }
            }
            let _ = writeln!(md);
        }
        let verdict = match &s.cycle_anywhere {
            Some(cycle) => format!("yes: {cycle}"),
            None => "no".into(),
        };
        let _ = writeln!(md, "Negative cycle in the graph: {verdict}.\n");
    }

    let _ = writeln!(md, "## 2. Floyd-Warshall: distances between the pairs\n");
    for s in studies {
        let Some(pairs) = &s.pairs else { continue };
        let _ = writeln!(md, "### {}\n", s.name);
        if let Some(refusal) = &pairs.refusal {
            let _ = writeln!(
                md,
                "Floyd-Warshall refused ({}): {refusal}. The table comes from one Bellman-Ford per row.\n",
                ui::bytes(pairs.table_bytes)
            );
        }
        if let Some(cycle) = &pairs.negative_cycle {
            let _ = writeln!(md, "No answer: {cycle}.\n");
            continue;
        }
        let _ = write!(md, "| from \\ to |");
        for v in &pairs.vertices {
            let _ = write!(md, " {v} |");
        }
        let _ = writeln!(md, "\n|---:|{}", "---:|".repeat(pairs.vertices.len()));
        for (i, row) in pairs.vertices.iter().zip(&pairs.distances) {
            let _ = write!(md, "| **{i}** |");
            for d in row {
                let _ = write!(md, " {} |", d.map_or("∞".into(), ui::weight));
            }
            let _ = writeln!(md);
        }
        let _ = writeln!(md);
    }

    let _ = writeln!(md, "## 3. Mean running time (seconds)\n");
    let timed = columns(studies.iter().flat_map(|s| &s.timings));
    if !timed.is_empty() {
        let runs = studies
            .iter()
            .flat_map(|s| &s.timings)
            .map(|t| t.requested_runs)
            .max()
            .unwrap_or(0);
        let _ = writeln!(
            md,
            "Mean over {runs} runs, the algorithm alone. Bellman-Ford runs to the target of question 1; BFS, DFS and Dijkstra from random roots. `≈` marks an estimate: from the run the budget cut short, or, for a Floyd-Warshall whose table does not fit, from one run on a random digraph of {STAND_IN} vertices with the same mean out-degree, scaled by `(n / {STAND_IN})³`.\n"
        );
        table(md, studies, &timed, |s| &s.timings);
    }

    let _ = writeln!(
        md,
        "\n## 4. All pairs: Bellman-Ford from every vertex against Floyd-Warshall\n"
    );
    let paired = columns(studies.iter().flat_map(|s| &s.all_pairs));
    if paired.is_empty() {
        return;
    }
    table(md, studies, &paired, |s| &s.all_pairs);
    let _ = writeln!(md);
    for s in studies {
        let find = |a: &str, v: &str| {
            s.all_pairs
                .iter()
                .find(|t| t.algorithm == a && t.variant == v)
                .and_then(AlgorithmTiming::mean_or_estimate_ms)
        };
        let (Some(bf), Some(fw)) = (
            find("bellman-ford-all", "queue"),
            find("floyd-warshall", "pruned"),
        ) else {
            continue;
        };
        // Each scan relaxes all of a vertex's arcs: a run examines about
        // `c · m` arcs, `c` the scans per vertex.
        let per_vertex = s
            .all_pairs
            .iter()
            .find(|t| t.algorithm == "bellman-ford-all")
            .and_then(|t| t.counts)
            .map(|c| c.scans as f64 / s.vertices.max(1) as f64);
        let (winner, ratio) = match bf < fw {
            true => ("Bellman-Ford from every vertex", fw / bf),
            false => ("Floyd-Warshall", bf / fw),
        };
        let _ = writeln!(
            md,
            "- **{}**: {winner} is {ratio:.1}× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ {} scans per vertex and run, `m` = {}), Floyd-Warshall makes `n³` = {:.2e} updates in a cache-friendly loop.",
            s.name,
            per_vertex.map_or("?".into(), |c| format!("{c:.3}")),
            s.edges,
            (s.vertices as f64).powi(3)
        );
    }
}

/// The `(algorithm, variant)` columns present, in a stable order.
fn columns<'a>(timings: impl Iterator<Item = &'a AlgorithmTiming>) -> Vec<(String, String)> {
    let mut columns: Vec<(String, String)> = Vec::new();
    for t in timings {
        let key = (t.algorithm.clone(), t.variant.clone());
        if !columns.contains(&key) {
            columns.push(key);
        }
    }
    columns
}

/// One row per graph, one column per `(algorithm, variant)`.
fn table(
    md: &mut String,
    studies: &[DirectedStudy],
    columns: &[(String, String)],
    cells: impl Fn(&DirectedStudy) -> &Vec<AlgorithmTiming>,
) {
    let _ = write!(md, "| Graph | Vertices | Arcs |");
    for (algorithm, variant) in columns {
        let _ = write!(md, " {algorithm} ({variant}) |");
    }
    let _ = writeln!(md, "\n|---|---:|---:|{}", "---:|".repeat(columns.len()));
    for s in studies {
        let _ = write!(md, "| {} | {} | {} |", s.name, s.vertices, s.edges);
        for (algorithm, variant) in columns {
            let found = cells(s)
                .iter()
                .find(|t| &t.algorithm == algorithm && &t.variant == variant);
            let _ = write!(md, " {} |", found.map_or(String::new(), shown));
        }
        let _ = writeln!(md);
    }
}

/// A timing cell for the Markdown tables.
fn shown(t: &AlgorithmTiming) -> String {
    match (&t.timing, t.estimated_ms, &t.refusal) {
        (_, Some(estimate), Some(_)) => format!("≈ {} (does not fit)", seconds(estimate)),
        (_, _, Some(_)) => "refused".into(),
        (Some(timing), _, _) if t.budget_exhausted => format!(
            "{} ({} of {} runs)",
            seconds(timing.mean_ms),
            timing.runs,
            t.requested_runs
        ),
        (Some(timing), _, _) => seconds(timing.mean_ms),
        (None, Some(estimate), _) => format!("≈ {}", seconds(estimate)),
        (None, None, _) => format!("> {} s", t.budget_s),
    }
}

/// A long path as its first and last few vertices.
fn shorten(path: &[String]) -> String {
    match path.len() {
        0..=12 => path.join(" → "),
        k => format!(
            "{} → … → {}",
            path[..5].join(" → "),
            path[k - 5..].join(" → ")
        ),
    }
}
