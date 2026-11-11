//! `graphman johnson`: all pairs as one Bellman-Ford and `n` Dijkstras over
//! any frontier, printed like `graphman floyd-warshall`.

use super::floyd_warshall::report;
use crate::load::{GraphArgs, NamesArgs, resolve_vertex};
use crate::ui::{self, Ui};
use anyhow::{Context, Result, bail};
use graphman::algo::{FloydError, FrontierKind, johnson};
use graphman::{Vertex, dispatch};
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    #[command(flatten)]
    names: NamesArgs,

    /// Vertices whose pairwise distances to print, as a table (ids or names).
    #[arg(short, long, num_args = 1.., default_values = ["10", "20", "30", "40", "50"])]
    pairs: Vec<String>,

    /// Dijkstra's frontier: vector, heap, lazy-heap, quad-heap, pairing or radix.
    #[arg(short, long, default_value = "heap")]
    frontier: FrontierKind,

    /// Also write the shortest-path tree from every vertex into this directory.
    #[arg(long, value_name = "DIR")]
    trees: Option<PathBuf>,

    /// Print the table as JSON on stdout.
    #[arg(long)]
    json: bool,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("johnson");
    let names = args.names.load(ui)?;
    let graph = args.graph.load(ui)?;
    let n = graph.vertex_count();
    let vertices = args
        .pairs
        .iter()
        .map(|v| resolve_vertex(v, names.as_ref(), n))
        .collect::<Result<Vec<Vertex>>>()?;
    let start = Instant::now();
    let all = match dispatch!(&graph, g => johnson(g, args.frontier, args.graph.budget())) {
        Ok(all) => all,
        Err(FloydError::NegativeCycle(cycle)) => {
            let shown: Vec<String> = cycle.cycle.iter().map(Vertex::to_string).collect();
            ui.warn(&format!("{cycle}"));
            println!("negative-cycle {} {}", cycle.weight, shown.join(" "));
            bail!("the graph has a negative cycle: no shortest paths are defined");
        }
        Err(error) => return Err(error).context("johnson"),
    };
    ui.step(&format!(
        "johnson (bellman-ford + {n} dijkstras, {}) in {}",
        args.frontier.label(),
        ui::duration(start.elapsed())
    ));
    let prefix = format!("{}.johnson", args.graph.stem());
    report(
        &all,
        &vertices,
        names.as_ref(),
        args.json,
        args.trees.as_deref(),
        &prefix,
        ui,
    )
}
