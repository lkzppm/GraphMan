//! `graphman components`: connected components, largest first.

use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::Components;
use graphman::dispatch;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Output file (default: <graph>.components.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("components");
    let graph = args.graph.load(ui)?;
    let start = Instant::now();
    let components = dispatch!(&graph, g => Components::compute(g));
    ui.step(&format!(
        "{} components in {}",
        components.count(),
        ui::duration(start.elapsed())
    ));
    ui.kv("largest", components.largest_size());
    ui.kv("smallest", components.smallest_size());
    let path = output_path(&args.output, &args.graph.stem(), "components.txt");
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    components.write_to(file)?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}
