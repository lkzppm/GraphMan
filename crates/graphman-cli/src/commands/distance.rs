//! `graphman distance`: shortest-path distances between vertex pairs.
//!
//! On an unweighted graph the distance is the number of edges (a BFS that
//! stops at the target); on a weighted one it is the sum of the weights (a
//! Dijkstra that stops at the target). `--hops` counts edges either way.

use crate::load::{GraphArgs, NamesArgs, display_vertex, resolve_vertex};
use crate::ui::{self, Ui};
use anyhow::Result;
use graphman::algo::{HeapFrontier, ShortestPathTree, distance_into, shortest_path_into};
use graphman::{SearchTree, Vertex, dispatch};
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    #[command(flatten)]
    names: NamesArgs,

    /// Pairs of vertices (ids, or names with --names), e.g. `--pair 10 20 --pair 10 30`.
    #[arg(short, long, num_args = 2, value_names = ["U", "V"], required = true)]
    pair: Vec<String>,

    /// Count edges (BFS) even when the graph has weights.
    #[arg(long)]
    hops: bool,

    /// Also print the path after the distance.
    #[arg(long)]
    path: bool,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("distance");
    let names = args.names.load(ui)?;
    let graph = args.graph.load(ui)?;
    let n = graph.vertex_count();
    let weighted = graph.is_weighted() && !args.hops;
    let mut tree = SearchTree::new(n);
    let mut weighted_tree = ShortestPathTree::new(n);
    let mut frontier = HeapFrontier::new(n);
    for pair in args.pair.chunks(2) {
        let u = resolve_vertex(&pair[0], names.as_ref(), n)?;
        let v = resolve_vertex(&pair[1], names.as_ref(), n)?;
        let start = Instant::now();
        // (exact, for stdout; rounded, for people)
        let (distance, path): (Option<(String, String)>, Option<Vec<Vertex>>) = if weighted {
            let found = dispatch!(&graph, g => shortest_path_into(g, u, v, &mut frontier, &mut weighted_tree))?;
            match found {
                Some(p) => (
                    Some((p.distance.to_string(), ui::weight(p.distance))),
                    Some(p.vertices),
                ),
                None => (None, None),
            }
        } else {
            let d = dispatch!(&graph, g => distance_into(g, u, v, &mut tree));
            (d.map(|d| (d.to_string(), d.to_string())), tree.path_to(v))
        };
        let elapsed = ui::duration(start.elapsed());
        let shown = path.as_ref().map(|p| {
            p.iter()
                .map(|&w| display_vertex(w, names.as_ref()))
                .collect::<Vec<_>>()
                .join(" > ")
        });
        match (distance.as_ref().map(|d| &d.0), args.path, &path) {
            (Some(d), true, Some(p)) => {
                let p: Vec<String> = p.iter().map(Vertex::to_string).collect();
                println!("{u} {v} {d} {}", p.join(" "));
            }
            (Some(d), _, _) => println!("{u} {v} {d}"),
            (None, _, _) => println!("{u} {v} inf"),
        }
        ui.kv(
            &format!("d({u}, {v})"),
            match (distance.map(|d| d.1), shown) {
                (Some(d), Some(shown)) if args.path => format!("{d} in {elapsed}  {shown}"),
                (Some(d), _) => format!("{d} in {elapsed}"),
                (None, _) => format!("∞ in {elapsed}"),
            },
        );
    }
    Ok(())
}
