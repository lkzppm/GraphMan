//! `graphman dijkstra`: shortest-path tree from one vertex, and the paths to
//! chosen targets.

use crate::load::{GraphArgs, NamesArgs, display_vertex, output_path, resolve_vertex};
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{FrontierKind, dijkstra};
use graphman::{Vertex, dispatch};
use serde::Serialize;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    #[command(flatten)]
    names: NamesArgs,

    /// Source vertex: an id, or a name with --names.
    #[arg(short = 's', long = "from", default_value = "1")]
    root: String,

    /// Targets to report the distance and the path to (ids or names).
    #[arg(short, long, num_args = 1..)]
    to: Vec<String>,

    /// How the distance estimates are kept: vector, heap or lazy-heap.
    #[arg(short, long, default_value = "heap")]
    frontier: FrontierKind,

    /// Output file for the tree (default: <graph>.dijkstra-<root>.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Print the paths to the targets as JSON on stdout.
    #[arg(long)]
    json: bool,
}

/// One target's answer.
#[derive(Serialize)]
struct Answer {
    from: Vertex,
    to: Vertex,
    /// `None` when `to` is in another component.
    distance: Option<f64>,
    path: Vec<Vertex>,
    #[serde(skip_serializing_if = "Option::is_none")]
    names: Option<Vec<String>>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("dijkstra");
    let names = args.names.load(ui)?;
    let graph = args.graph.load(ui)?;
    let n = graph.vertex_count();
    let root = resolve_vertex(&args.root, names.as_ref(), n)?;
    let targets = args
        .to
        .iter()
        .map(|t| resolve_vertex(t, names.as_ref(), n))
        .collect::<Result<Vec<_>>>()?;
    if !graph.is_weighted() {
        ui.warn("the graph has no weights: every edge weighs 1, so distances are hop counts");
    }

    let start = Instant::now();
    let tree = dispatch!(&graph, g => dijkstra(g, root, args.frontier))?;
    let (farthest, eccentricity) = tree.last_settled();
    ui.step(&format!(
        "dijkstra ({}) from {} in {}: reached {} vertices, farthest {} at {}",
        args.frontier.label(),
        display_vertex(root, names.as_ref()),
        ui::duration(start.elapsed()),
        tree.reached_count(),
        display_vertex(farthest, names.as_ref()),
        ui::weight(eccentricity)
    ));

    let answers: Vec<Answer> = targets
        .iter()
        .map(|&to| Answer {
            from: root,
            to,
            distance: tree.distance(to),
            path: tree.path_to(to).unwrap_or_default(),
            names: names.as_ref().map(|names| {
                tree.path_to(to)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|v| names.name(v).unwrap_or("?").to_owned())
                    .collect()
            }),
        })
        .collect();
    for answer in &answers {
        let shown: Vec<String> = answer
            .path
            .iter()
            .map(|&v| display_vertex(v, names.as_ref()))
            .collect();
        ui.kv(
            &format!("d({}, {})", answer.from, answer.to),
            match answer.distance {
                Some(d) => format!("{}  {}", ui::weight(d), shown.join(" > ")),
                None => "∞  (another component)".into(),
            },
        );
    }
    if args.json {
        println!("{}", serde_json::to_string_pretty(&answers)?);
    } else {
        for answer in &answers {
            let path: Vec<String> = answer.path.iter().map(Vertex::to_string).collect();
            match answer.distance {
                Some(d) => println!("{} {} {d} {}", answer.from, answer.to, path.join(" ")),
                None => println!("{} {} inf", answer.from, answer.to),
            }
        }
    }

    let suffix = format!("dijkstra-{root}.txt");
    let path = output_path(&args.output, &args.graph.stem(), &suffix);
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    tree.write_to(file)?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}
