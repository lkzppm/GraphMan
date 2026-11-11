//! `graphman info`: the summary file required by the assignment.

use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{Components, degree_stats, in_degree_stats, weight_stats};
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
    let (stats, weights, components) =
        dispatch!(&graph, g => (degree_stats(g), weight_stats(g), Components::compute(g)));
    ui.step(&format!(
        "degrees and components in {}",
        ui::duration(start.elapsed())
    ));
    let directed = graph.is_directed();
    ui.kv("orientation", graph.orientation());
    ui.kv("vertices", graph.vertex_count());
    ui.kv(if directed { "arcs" } else { "edges" }, graph.edge_count());
    let mut degrees = vec![(if directed { "out-degree" } else { "degree" }, stats)];
    if directed {
        degrees.push(("in-degree", dispatch!(&graph, g => in_degree_stats(g))));
    }
    for (name, stats) in degrees {
        ui.kv(
            &format!("{name} min/max"),
            format!("{} / {}", stats.min, stats.max),
        );
        ui.kv(&format!("{name} mean"), format!("{:.3}", stats.mean));
        ui.kv(&format!("{name} median"), format!("{:.1}", stats.median));
    }
    if let Some(weights) = weights {
        ui.kv(
            "weight min/max",
            format!("{} / {}", ui::weight(weights.min), ui::weight(weights.max)),
        );
        ui.kv("weight mean", ui::weight(weights.mean));
        ui.kv("negative weights", weights.negative);
    }
    if !graph.negative_loops().is_empty() {
        ui.kv("negative loops", graph.negative_loops().len());
    }
    ui.kv(
        if directed {
            "weak components"
        } else {
            "components"
        },
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
