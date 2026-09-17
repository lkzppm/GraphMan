//! `graphman info`: the summary file required by the assignment.

use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{Components, degree_stats};
use graphman::{dispatch, io::write_summary};
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Output file (default: <graph>.summary.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("info");
    let graph = args.graph.load(ui)?;
    let start = Instant::now();
    let (stats, components) = dispatch!(&graph, g => (degree_stats(g), Components::compute(g)));
    ui.step(&format!(
        "degrees and components in {}",
        ui::duration(start.elapsed())
    ));
    ui.kv("vertices", graph.vertex_count());
    ui.kv("edges", graph.edge_count());
    ui.kv("degree min/max", format!("{} / {}", stats.min, stats.max));
    ui.kv("degree mean", format!("{:.3}", stats.mean));
    ui.kv("degree median", format!("{:.1}", stats.median));
    ui.kv(
        "components",
        format!(
            "{} (largest {}, smallest {})",
            components.count(),
            components.largest_size(),
            components.smallest_size()
        ),
    );

    let path = output_path(&args.output, &args.graph.stem(), "summary.txt");
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    dispatch!(&graph, g => write_summary(file, g, &stats, &components))?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}
