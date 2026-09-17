//! `graphman` — the command-line face of the GraphMan library.
//!
//! Every subcommand is a thin adapter: it parses arguments, loads a graph in
//! the requested representation and calls into `graphman`. The `study`
//! subcommand is the program used to answer the assignment's case studies.

mod commands;
mod load;
mod report;
mod rng;
mod ui;

use anyhow::Result;
use clap::{Parser, Subcommand};

/// GraphMan: graph manipulation, measured.
#[derive(Parser)]
#[command(name = "graphman", version, about, propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Worker threads for parallel algorithms (default: all cores).
    #[arg(long, global = true)]
    threads: Option<usize>,

    /// Suppress progress bars and decorative output.
    #[arg(short, long, global = true)]
    quiet: bool,
}

#[derive(Subcommand)]
enum Command {
    /// Summary file: vertex/edge counts, degree statistics and components.
    Info(commands::info::Args),
    /// Breadth-first search tree (parent and level of every vertex).
    Bfs(commands::search::Args),
    /// Depth-first search tree (parent and level of every vertex).
    Dfs(commands::search::Args),
    /// Distance between pairs of vertices.
    Distance(commands::distance::Args),
    /// Diameter: exact (brute force or iFUB) or a 4-sweep lower bound.
    Diameter(commands::diameter::Args),
    /// Connected components, largest first.
    Components(commands::components::Args),
    /// Time BFS or DFS from many distinct start vertices.
    Bench(commands::bench::Args),
    /// Resident memory of the process after loading the graph.
    Memory(commands::memory::Args),
    /// Run the whole case study and write JSON + Markdown results.
    Study(commands::study::Args),
    /// Export search-tree layouts for the web observatory.
    Export(commands::export::Args),
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    if let Some(threads) = cli.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()?;
    }
    let ui = ui::Ui::new(cli.quiet);
    match cli.command {
        Command::Info(args) => commands::info::run(args, &ui),
        Command::Bfs(args) => commands::search::run(args, commands::search::Algorithm::Bfs, &ui),
        Command::Dfs(args) => commands::search::run(args, commands::search::Algorithm::Dfs, &ui),
        Command::Distance(args) => commands::distance::run(args, &ui),
        Command::Diameter(args) => commands::diameter::run(args, &ui),
        Command::Components(args) => commands::components::run(args, &ui),
        Command::Bench(args) => commands::bench::run(args, &ui),
        Command::Memory(args) => commands::memory::run(args, &ui),
        Command::Study(args) => commands::study::run(args, &ui),
        Command::Export(args) => commands::export::run(args, &ui),
    }
}
