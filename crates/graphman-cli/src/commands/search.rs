//! `graphman bfs` / `graphman dfs`: search trees written to a file. DFS runs
//! iteratively by default, or recursively with `--recursive` (same tree).

use crate::deep::with_stack_for;
use crate::load::{GraphArgs, output_path};
use crate::ui::{self, Ui};
use anyhow::{Context, Result, ensure};
use graphman::algo::{bfs, dfs, dfs_recursive};
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

    /// DFS only: run the recursive DFS (one call per tree level, on a thread
    /// with a stack sized for the graph) instead of the iterative one.
    #[arg(long)]
    recursive: bool,
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
    ensure!(
        !args.recursive || matches!(algorithm, Algorithm::Dfs),
        "--recursive applies to dfs only"
    );
    let n = graph.vertex_count();
    let start = Instant::now();
    let tree = match algorithm {
        Algorithm::Bfs => dispatch!(&graph, g => bfs(g, args.root)),
        Algorithm::Dfs if args.recursive => with_stack_for(
            n,
            || dispatch!(&graph, g => dfs_recursive(g, args.root, n as u32)),
        )?,
        Algorithm::Dfs => dispatch!(&graph, g => dfs(g, args.root)),
    };
    ui.step(&format!(
        "{}{} from {} in {}: reached {} vertices, depth {}",
        algorithm.label(),
        if args.recursive { " (recursive)" } else { "" },
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
