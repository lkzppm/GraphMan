//! `graphman bench`: mean running time of BFS/DFS over many start vertices.

use crate::load::GraphArgs;
use crate::report::Timing;
use crate::rng::SplitMix64;
use crate::ui::Ui;
use anyhow::Result;
use graphman::algo::{bfs, dfs};
use graphman::{AnyGraph, Graph, Vertex, dispatch};
use std::hint::black_box;
use std::time::{Duration, Instant};

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Algorithm to time: bfs or dfs.
    #[arg(short, long, default_value = "bfs")]
    algo: String,

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
    let timing = match args.algo.as_str() {
        "bfs" => time_searches(&graph, &roots, Search::Bfs, ui),
        "dfs" => time_searches(&graph, &roots, Search::Dfs, ui),
        other => anyhow::bail!("unknown algorithm {other:?} (expected bfs or dfs)"),
    };
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
            args.algo,
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
    Dfs,
}

impl Search {
    pub fn label(self) -> &'static str {
        match self {
            Search::Bfs => "BFS",
            Search::Dfs => "DFS",
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
    let mut samples = Vec::with_capacity(roots.len());
    for &root in roots {
        let elapsed = dispatch!(graph, g => time_one(g, root, search));
        samples.push(elapsed.as_secs_f64() * 1000.0);
        bar.inc(1);
    }
    bar.finish_and_clear();
    Timing::from_samples(samples)
}

fn time_one<G: Graph>(graph: &G, root: Vertex, search: Search) -> Duration {
    let start = Instant::now();
    let tree = match search {
        Search::Bfs => bfs(graph, root),
        Search::Dfs => dfs(graph, root),
    };
    let elapsed = start.elapsed();
    black_box(tree.reached_count());
    elapsed
}
