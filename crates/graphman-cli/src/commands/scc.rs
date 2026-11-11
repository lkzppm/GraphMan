//! `graphman scc`: strongly connected components, in a topological order of
//! the condensation.

use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::StrongComponents;
use graphman::dispatch;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Output file (default: <graph>.scc.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Also write the condensation (one vertex per component) in the course format.
    #[arg(long, value_name = "FILE")]
    condensation: Option<PathBuf>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("scc");
    let graph = args.graph.load(ui)?;
    let start = Instant::now();
    let scc = dispatch!(&graph, g => StrongComponents::compute(g));
    ui.step(&format!(
        "{} strongly connected components in {}",
        scc.count(),
        ui::duration(start.elapsed())
    ));
    ui.kv("largest", scc.largest_size());
    ui.kv(
        "acyclic",
        match scc.is_acyclic() {
            true => "yes: the components are a topological order",
            false => "no",
        },
    );
    let path = output_path(&args.output, &args.graph.stem(), "scc.txt");
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    scc.write_to(file)?;
    ui.done(&format!("wrote {}", path.display()));
    if let Some(path) = &args.condensation {
        let condensation = dispatch!(&graph, g => scc.condensation(g));
        let file = File::create(path).with_context(|| format!("creating {}", path.display()))?;
        condensation.write_to(file)?;
        ui.done(&format!(
            "wrote the condensation to {}: {} vertices, {} arcs",
            path.display(),
            condensation.vertex_count(),
            condensation.edge_count()
        ));
    }
    Ok(())
}
