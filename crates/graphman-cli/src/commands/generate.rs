//! `graphman generate`: random graphs in the course format, with or without
//! weights, for trying the library before (or beside) the course files.

use crate::rng::SplitMix64;
use crate::ui::Ui;
use anyhow::{Context, Result, bail, ensure};
use graphman::{EdgeList, Vertex, Weight};
use std::fs::File;
use std::path::PathBuf;

#[derive(clap::Args)]
pub struct Args {
    /// Number of vertices (ignored with --like).
    #[arg(short = 'n', long, default_value_t = 1000)]
    vertices: usize,

    /// Number of edges to draw, `u v` uniformly at random (ignored with
    /// --like). Self-loops and repeats are dropped, so a few less are written.
    #[arg(short = 'm', long, default_value_t = 5000)]
    edges: usize,

    /// Reuse the edges of an existing graph file instead of drawing new ones
    /// (to put weights on an unweighted course graph).
    #[arg(long, value_name = "FILE")]
    like: Option<PathBuf>,

    /// Weight range `MIN:MAX` (uniform reals); omit for an unweighted graph.
    #[arg(short, long, value_name = "MIN:MAX")]
    weights: Option<String>,

    /// Seed of the generator.
    #[arg(long, default_value_t = 42)]
    seed: u64,

    /// Output file.
    #[arg(short, long)]
    output: PathBuf,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("generate");
    let mut rng = SplitMix64::new(args.seed);
    let range = args.weights.as_deref().map(parse_range).transpose()?;
    let (n, pairs): (usize, Vec<(Vertex, Vertex)>) = match &args.like {
        Some(path) => {
            let edges =
                EdgeList::from_path(path).with_context(|| format!("reading {}", path.display()))?;
            let pairs = edges.edges().iter().map(|&[u, v]| (u, v)).collect();
            (edges.vertex_count(), pairs)
        }
        None => {
            ensure!(args.vertices >= 1, "a graph needs at least one vertex");
            let n = args.vertices as u64;
            let pairs = (0..args.edges)
                .map(|_| {
                    let u = (rng.next_u64() % n) as Vertex + 1;
                    let v = (rng.next_u64() % n) as Vertex + 1;
                    (u, v)
                })
                .collect();
            (args.vertices, pairs)
        }
    };
    let edges = match range {
        None => EdgeList::from_edges(n, pairs)?,
        Some((low, high)) => {
            let weighted = pairs.into_iter().map(|(u, v)| {
                // 53 random bits: a uniform real in [0, 1).
                let unit = (rng.next_u64() >> 11) as Weight / (1u64 << 53) as Weight;
                // Three decimals, as the course files print them.
                let weight = ((low + unit * (high - low)) * 1000.0).round() / 1000.0;
                (u, v, weight)
            });
            EdgeList::from_weighted_edges(n, weighted)?
        }
    };
    let file = File::create(&args.output)
        .with_context(|| format!("creating {}", args.output.display()))?;
    edges.write_to(file)?;
    ui.done(&format!(
        "wrote {}: {} vertices, {} {}edges",
        args.output.display(),
        edges.vertex_count(),
        edges.edge_count(),
        if edges.is_weighted() { "weighted " } else { "" }
    ));
    Ok(())
}

/// Parses `MIN:MAX`.
fn parse_range(text: &str) -> Result<(Weight, Weight)> {
    let Some((low, high)) = text.split_once(':') else {
        bail!("expected a weight range MIN:MAX, found {text:?}");
    };
    let (low, high): (Weight, Weight) = (low.trim().parse()?, high.trim().parse()?);
    ensure!(
        low.is_finite() && high.is_finite() && low <= high,
        "the weight range {text:?} is empty"
    );
    Ok((low, high))
}
