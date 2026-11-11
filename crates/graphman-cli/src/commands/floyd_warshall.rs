//! `graphman floyd-warshall`: the distances between chosen pairs of vertices
//! from one all-pairs table (Part 3), and optionally every tree.

use crate::load::{GraphArgs, NamesArgs, display_vertex, resolve_vertex};
use crate::ui::{self, Ui};
use anyhow::{Context, Result, bail};
use graphman::algo::{AllPairs, Control, FloydError, SweepKind, floyd_warshall_with_progress};
use graphman::{Vertex, dispatch};
use serde::Serialize;
use std::fs::{self, File};
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

    /// How the table is walked: plain, pruned, parallel or blocked.
    #[arg(long, default_value = "pruned")]
    sweep: SweepKind,

    /// Also write the shortest-path tree from every vertex into this directory.
    #[arg(long, value_name = "DIR")]
    trees: Option<PathBuf>,

    /// Print the table as JSON on stdout.
    #[arg(long)]
    json: bool,
}

#[derive(Serialize)]
struct Table {
    vertices: Vec<Vertex>,
    /// `distances[a][b]` from `vertices[a]` to `vertices[b]`; `None` when unreachable.
    distances: Vec<Vec<Option<f64>>>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("floyd-warshall");
    let names = args.names.load(ui)?;
    let graph = args.graph.load(ui)?;
    let n = graph.vertex_count();
    let vertices = args
        .pairs
        .iter()
        .map(|v| resolve_vertex(v, names.as_ref(), n))
        .collect::<Result<Vec<_>>>()?;
    ui.kv(
        "table",
        format!(
            "{n} × {n} cells, {} ({} rounds of {n} × {n} updates)",
            ui::bytes(AllPairs::required_bytes(n)),
            n
        ),
    );

    let bar = ui.progress(Some(n as u64), &format!("floyd-warshall {}", args.sweep));
    let progress = |rounds: usize| {
        bar.set_position(rounds as u64);
        Control::Continue
    };
    let start = Instant::now();
    let result = dispatch!(&graph, g => floyd_warshall_with_progress(g, args.sweep, args.graph.budget(), &progress));
    bar.finish_and_clear();
    let all = match result {
        Ok(all) => all,
        Err(FloydError::NegativeCycle(cycle)) => {
            let vertices: Vec<String> = cycle.cycle.iter().map(Vertex::to_string).collect();
            ui.warn(&format!(
                "negative cycle of {} arc(s), weight {}",
                cycle.len(),
                ui::weight(cycle.weight)
            ));
            println!("negative-cycle {} {}", cycle.weight, vertices.join(" "));
            bail!("the graph has a negative cycle: no shortest paths are defined");
        }
        Err(error) => return Err(error).context("floyd-warshall"),
    };
    ui.step(&format!(
        "floyd-warshall ({}) in {}",
        args.sweep,
        ui::duration(start.elapsed())
    ));

    let table = Table {
        distances: vertices
            .iter()
            .map(|&i| vertices.iter().map(|&j| all.distance(i, j)).collect())
            .collect(),
        vertices: vertices.clone(),
    };
    for (&i, row) in vertices.iter().zip(&table.distances) {
        let shown: Vec<String> = row
            .iter()
            .map(|d| d.map_or("∞".into(), ui::weight))
            .collect();
        ui.kv(&display_vertex(i, names.as_ref()), shown.join("  "));
    }
    if args.json {
        println!("{}", serde_json::to_string_pretty(&table)?);
    } else {
        let header: Vec<String> = vertices.iter().map(Vertex::to_string).collect();
        println!("from\\to {}", header.join(" "));
        for (&i, row) in vertices.iter().zip(&table.distances) {
            let cells: Vec<String> = row
                .iter()
                .map(|d| d.map_or("inf".into(), |d| d.to_string()))
                .collect();
            println!("{i} {}", cells.join(" "));
        }
    }

    if let Some(dir) = &args.trees {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        let stem = args.graph.stem();
        for i in 1..=n as Vertex {
            let path = dir.join(format!("{stem}.floyd-warshall-{i}.txt"));
            let file =
                File::create(&path).with_context(|| format!("creating {}", path.display()))?;
            all.write_tree_to(i, file)?;
        }
        ui.done(&format!("wrote {n} trees to {}", dir.display()));
    }
    Ok(())
}
