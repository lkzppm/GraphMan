//! `graphman bench`: mean running time of BFS, DFS or Dijkstra over many
//! start vertices.

use crate::deep::with_stack_for;
use crate::load::GraphArgs;
use crate::report::Timing;
use crate::rng::SplitMix64;
use crate::ui::Ui;
use anyhow::Result;
use graphman::algo::{DfsKind, FrontierKind, bfs, dfs, dfs_recursive, dijkstra};
use graphman::{AnyGraph, Vertex, Weighted, dispatch};
use std::hint::black_box;
use std::time::{Duration, Instant};

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Algorithm to time: bfs, dfs or dijkstra.
    #[arg(short, long, default_value = "bfs")]
    algo: String,

    /// Dijkstra's frontier: vector, heap, lazy-heap, quad-heap, pairing or radix.
    #[arg(short, long, default_value = "heap")]
    frontier: FrontierKind,

    /// DFS only: time the recursive DFS instead of the iterative one.
    #[arg(long)]
    recursive: bool,

    /// Number of searches, each from a distinct random start vertex.
    #[arg(short = 'n', long, default_value_t = 100)]
    runs: usize,

    /// Seed for choosing the start vertices.
    #[arg(long, default_value_t = 42)]
    seed: u64,

    /// Print the timing summary as JSON on stdout.
    #[arg(long)]
    json: bool,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("bench");
    let graph = args.graph.load(ui)?;
    let roots = SplitMix64::new(args.seed).distinct_vertices(graph.vertex_count(), args.runs);
    let search = match args.algo.as_str() {
        "bfs" => Search::Bfs,
        "dfs" => Search::Dfs(if args.recursive {
            DfsKind::Recursive
        } else {
            DfsKind::Iterative
        }),
        "dijkstra" => Search::Dijkstra(args.frontier),
        other => anyhow::bail!("unknown algorithm {other:?} (expected bfs, dfs or dijkstra)"),
    };
    anyhow::ensure!(
        !args.recursive || matches!(search, Search::Dfs(_)),
        "--recursive applies to dfs only"
    );
    if let (Search::Dijkstra(_), Some(edge)) = (search, graph.negative_edge()) {
        return Err(graphman::NegativeWeight { edge }.into());
    }
    let timing = time_searches(&graph, &roots, search, ui);
    ui.kv("runs", timing.runs);
    ui.kv("mean", format!("{:.3} ms", timing.mean_ms));
    ui.kv("median", format!("{:.3} ms", timing.median_ms));
    ui.kv(
        "min / max",
        format!("{:.3} / {:.3} ms", timing.min_ms, timing.max_ms),
    );
    if args.json {
        println!("{}", serde_json::to_string_pretty(&timing)?);
    } else {
        println!(
            "{} {} runs {} mean_ms {:.4} median_ms {:.4} min_ms {:.4} max_ms {:.4}",
            search.id(),
            args.graph.repr.label(),
            timing.runs,
            timing.mean_ms,
            timing.median_ms,
            timing.min_ms,
            timing.max_ms
        );
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub enum Search {
    Bfs,
    Dfs(DfsKind),
    Dijkstra(FrontierKind),
}

impl Search {
    pub fn label(self) -> String {
        match self {
            Search::Bfs => "BFS".into(),
            Search::Dfs(DfsKind::Iterative) => "DFS".into(),
            Search::Dfs(DfsKind::Recursive) => "DFS (recursive)".into(),
            Search::Dijkstra(frontier) => format!("Dijkstra ({})", frontier.label()),
        }
    }

    /// The command-line spelling (`bfs`, `dfs`, `dfs-recursive`, `dijkstra-heap`...).
    pub fn id(self) -> String {
        match self {
            Search::Bfs => "bfs".into(),
            Search::Dfs(DfsKind::Iterative) => "dfs".into(),
            Search::Dfs(DfsKind::Recursive) => "dfs-recursive".into(),
            Search::Dijkstra(frontier) => format!("dijkstra-{}", frontier.label()),
        }
    }
}

/// Times one search per root. Only the algorithm is timed: the graph is
/// already in memory and nothing is written until the loop ends.
pub fn time_searches(graph: &AnyGraph, roots: &[Vertex], search: Search, ui: &Ui) -> Timing {
    let bar = ui.progress(
        Some(roots.len() as u64),
        &format!("{} × {}", search.label(), roots.len()),
    );
    let time_all = || {
        let mut samples = Vec::with_capacity(roots.len());
        for &root in roots {
            let elapsed = dispatch!(graph, g => time_one(g, root, search));
            samples.push(elapsed.as_secs_f64() * 1000.0);
            bar.inc(1);
        }
        samples
    };
    // The recursive DFS gets one deep stack for the whole loop, so spawning
    // its thread is never part of a timing.
    let samples = match search {
        Search::Dfs(DfsKind::Recursive) => with_stack_for(graph.vertex_count(), time_all),
        _ => time_all(),
    };
    bar.finish_and_clear();
    Timing::from_samples(samples)
}

fn time_one<G: Weighted>(graph: &G, root: Vertex, search: Search) -> Duration {
    let start = Instant::now();
    let reached = match search {
        Search::Bfs => bfs(graph, root).reached_count(),
        Search::Dfs(DfsKind::Iterative) => dfs(graph, root).reached_count(),
        Search::Dfs(DfsKind::Recursive) => dfs_recursive(graph, root, graph.vertex_count() as u32)
            .expect("the stack is sized for any depth")
            .reached_count(),
        Search::Dijkstra(frontier) => dijkstra(graph, root, frontier)
            .expect("negative weights are refused before timing")
            .reached_count(),
    };
    let elapsed = start.elapsed();
    black_box(reached);
    elapsed
}
