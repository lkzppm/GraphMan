//! `graphman generate`: random graphs in the course format, with or without
//! weights, for trying the library before (or beside) the course files.
//!
//! For Part 3, `--directed` keeps each line's direction, `--potential`
//! makes negative arcs without negative cycles (non-negative weights
//! reweighted by a random potential, Johnson in reverse: every cycle keeps
//! its weight) and `--plant-cycle` adds one negative cycle of three arcs,
//! printed so a test knows what to find.

use crate::rng::SplitMix64;
use crate::ui::Ui;
use anyhow::{Context, Result, bail, ensure};
use graphman::{EdgeList, Orientation, Vertex, Weight};
use std::fs::File;
use std::path::{Path, PathBuf};

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
    #[arg(short, long, value_name = "MIN:MAX", allow_hyphen_values = true)]
    weights: Option<String>,

    /// Read and draw the lines as arcs (the file format does not change;
    /// duplicates are counted per direction).
    #[arg(short = 'D', long)]
    directed: bool,

    /// With a negative MIN: draw weights in [0.001, MAX], then add
    /// h(u) − h(v) for a random potential h in [0, −MIN]. Arcs go negative
    /// (down to about MIN) but no cycle does. Directed only.
    #[arg(long, requires_all = ["weights", "directed"])]
    potential: bool,

    /// Add one negative cycle a → b → c → a of weight −1 on three random
    /// vertices (printed). Directed and weighted only.
    #[arg(long, requires_all = ["weights", "directed"])]
    plant_cycle: bool,

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
    let orientation = Orientation::from_directed(args.directed);
    let (n, pairs): (usize, Vec<(Vertex, Vertex)>) = match &args.like {
        Some(path) => {
            let edges = EdgeList::from_path_with(path, orientation)
                .with_context(|| format!("reading {}", path.display()))?;
            if range.is_none() {
                // Nothing to draw: the copy keeps the file's own weights, if any.
                return write(&edges, &args.output, ui);
            }
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
        None => EdgeList::from_edges_with(n, pairs, orientation)?,
        Some((low, high)) => {
            // 53 random bits: a uniform real in [0, 1).
            let mut unit = || (rng.next_u64() >> 11) as Weight / (1u64 << 53) as Weight;
            // Three decimals, as the course files print them.
            let round = |w: Weight| (w * 1000.0).round() / 1000.0;
            let potential: Vec<Weight> = match args.potential {
                true => (0..=n).map(|_| round(unit() * (-low).max(0.0))).collect(),
                false => Vec::new(),
            };
            let mut weighted: Vec<(Vertex, Vertex, Weight)> = pairs
                .into_iter()
                .map(|(u, v)| match args.potential {
                    // Every cycle's potentials cancel, so it keeps the sum
                    // of its drawn weights: at least 0.001 an arc, far
                    // above any rounding of the sums.
                    true => {
                        let w = round(unit() * high).max(0.001);
                        (u, v, w + potential[u as usize] - potential[v as usize])
                    }
                    false => (u, v, round(low + unit() * (high - low))),
                })
                .collect();
            if args.plant_cycle {
                ensure!(n >= 3, "a planted cycle needs three vertices");
                let mut pick = || (rng.next_u64() % n as u64) as Vertex + 1;
                let a = pick();
                let b = std::iter::repeat_with(&mut pick)
                    .find(|&b| b != a)
                    .expect("n >= 3");
                let c = std::iter::repeat_with(&mut pick)
                    .find(|&c| c != a && c != b)
                    .expect("n >= 3");
                weighted.extend([(a, b, 1.0), (b, c, 1.0), (c, a, -3.0)]);
                ui.kv(
                    "planted cycle",
                    format!("{a} -> {b} -> {c} -> {a}, weight -1"),
                );
            }
            EdgeList::from_weighted_edges_with(n, weighted, orientation)?
        }
    };
    write(&edges, &args.output, ui)
}

/// Writes `edges` in the course format and says so.
fn write(edges: &EdgeList, output: &Path, ui: &Ui) -> Result<()> {
    let file = File::create(output).with_context(|| format!("creating {}", output.display()))?;
    edges.write_to(file)?;
    ui.done(&format!(
        "wrote {}: {} vertices, {} {}{}",
        output.display(),
        edges.vertex_count(),
        edges.edge_count(),
        if edges.is_weighted() { "weighted " } else { "" },
        if edges.is_directed() { "arcs" } else { "edges" }
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
