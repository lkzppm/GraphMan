//! `graphman distance`: shortest-path distances between vertex pairs.

use crate::load::GraphArgs;
use crate::ui::{self, Ui};
use anyhow::{Result, ensure};
use graphman::algo::distance_into;
use graphman::{SearchTree, Vertex, dispatch};
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Pairs of vertices, e.g. `--pair 10 20 --pair 10 30`.
    #[arg(short, long, num_args = 2, value_names = ["U", "V"], required = true)]
    pair: Vec<Vertex>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("distance");
    let graph = args.graph.load(ui)?;
    let n = graph.vertex_count();
    let mut tree = SearchTree::new(n);
    for pair in args.pair.chunks(2) {
        let (u, v) = (pair[0], pair[1]);
        ensure!(
            (1..=n as Vertex).contains(&u) && (1..=n as Vertex).contains(&v),
            "vertices must be within 1..={n}"
        );
        let start = Instant::now();
        let d = dispatch!(&graph, g => distance_into(g, u, v, &mut tree));
        let elapsed = ui::duration(start.elapsed());
        match d {
            Some(d) => println!("{u} {v} {d}"),
            None => println!("{u} {v} inf"),
        }
        ui.kv(
            &format!("d({u}, {v})"),
            format!("{} in {elapsed}", d.map_or("∞".into(), |d| d.to_string())),
        );
    }
    Ok(())
}
