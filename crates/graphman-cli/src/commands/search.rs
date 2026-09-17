//! `graphman bfs` / `graphman dfs`: search trees written to a file.

use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result, ensure};
use graphman::algo::{bfs, dfs};
use graphman::{Vertex, dispatch};
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Clone, Copy)]
pub enum Algorithm {
    Bfs,
    Dfs,
}

impl Algorithm {
    pub fn label(self) -> &'static str {
        match self {
            Algorithm::Bfs => "bfs",
            Algorithm::Dfs => "dfs",
        }
    }
}

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Start vertex.
    #[arg(short = 's', long = "from", default_value_t = 1)]
    root: Vertex,

    /// Output file (default: <graph>.<bfs|dfs>-<root>.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,
}

pub fn run(args: Args, algorithm: Algorithm, ui: &Ui) -> Result<()> {
    ui.title(algorithm.label());
    let graph = args.graph.load(ui)?;
    ensure!(
        args.root >= 1 && args.root as usize <= graph.vertex_count(),
        "start vertex {} is outside 1..={}",
        args.root,
        graph.vertex_count()
    );
    let start = Instant::now();
    let tree = match algorithm {
        Algorithm::Bfs => dispatch!(&graph, g => bfs(g, args.root)),
        Algorithm::Dfs => dispatch!(&graph, g => dfs(g, args.root)),
    };
    ui.step(&format!(
        "{} from {} in {}: reached {} vertices, depth {}",
        algorithm.label(),
        args.root,
        ui::duration(start.elapsed()),
        tree.reached_count(),
        tree.depth()
    ));
    let suffix = format!("{}-{}.txt", algorithm.label(), args.root);
    let path = output_path(&args.output, &args.graph.stem(), &suffix);
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    tree.write_to(file)?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}
