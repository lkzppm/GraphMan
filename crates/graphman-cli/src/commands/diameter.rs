//! `graphman diameter`: exact or approximate diameter.

use crate::load::GraphArgs;
use crate::ui::{self, Ui};
use anyhow::Result;
use graphman::algo::{Control, DiameterMethod, diameter_with_progress};
use graphman::dispatch;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Method: ifub (exact, fast in practice), exact (one BFS per vertex) or sweep (lower bound).
    #[arg(short, long, default_value = "ifub")]
    method: DiameterMethod,

    /// Stop after this many seconds and report the best lower bound so far.
    #[arg(short, long)]
    budget: Option<f64>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("diameter");
    let graph = args.graph.load(ui)?;
    let total = match args.method {
        DiameterMethod::Exact => Some(graph.vertex_count() as u64),
        _ => None,
    };
    let bar = ui.progress(total, &format!("{} (BFS runs)", args.method));
    let start = Instant::now();
    let budget = args.budget.map(std::time::Duration::from_secs_f64);
    let progress = |done: usize| {
        bar.set_position(done as u64);
        match budget {
            Some(b) if start.elapsed() > b => Control::Break,
            _ => Control::Continue,
        }
    };
    let result = dispatch!(&graph, g => diameter_with_progress(g, args.method, &progress));
    bar.finish_and_clear();
    let elapsed = start.elapsed();
    ui.step(&format!(
        "{} in {} with {} BFS runs",
        args.method,
        ui::duration(elapsed),
        result.bfs_count
    ));
    ui.kv(
        "diameter",
        format!(
            "{}{}",
            result.value,
            if result.is_exact {
                ""
            } else {
                " (lower bound)"
            }
        ),
    );
    ui.kv(
        "endpoints",
        format!("{} — {}", result.endpoints.0, result.endpoints.1),
    );
    println!(
        "diameter {} method {} exact {} bfs_runs {} endpoints {} {} elapsed_ms {:.3}",
        result.value,
        result.method,
        result.is_exact,
        result.bfs_count,
        result.endpoints.0,
        result.endpoints.1,
        elapsed.as_secs_f64() * 1000.0
    );
    Ok(())
}
