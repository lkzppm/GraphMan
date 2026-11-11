//! `graphman bellman-ford`: the distance from chosen vertices to one target
//! (Part 3), the tree of shortest paths toward it, or whether the graph has
//! a negative cycle at all.

use crate::load::{GraphArgs, NamesArgs, display_vertex, output_path, resolve_vertex};
use crate::ui::{self, Ui};
use anyhow::{Context, Result, bail};
use graphman::algo::{
    MeasuredSchedule, NegativeCycle, ScheduleKind, ShortestPathTree, bellman_ford_to_into,
    negative_cycle,
};
use graphman::{AnyGraph, Vertex, VertexNames, dispatch};
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

    /// The target: every distance is to this vertex (an id, or a name with --names).
    #[arg(short, long, required_unless_present = "negative_cycle")]
    to: Option<String>,

    /// Vertices to report the distance and the path from.
    #[arg(short = 's', long = "from", num_args = 1..)]
    from: Vec<String>,

    /// Which vertex to re-examine next: rounds, early-stop, queue, yen, random-yen or slf.
    #[arg(long, default_value = "queue")]
    schedule: ScheduleKind,

    /// Only ask whether the graph has a negative cycle anywhere.
    #[arg(long, conflicts_with_all = ["to", "from"])]
    negative_cycle: bool,

    /// Output file for the tree (default: <graph>.bellman-ford-to-<target>.txt).
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Print the answers as JSON on stdout.
    #[arg(long)]
    json: bool,
}

/// One source's answer.
#[derive(Serialize)]
struct Answer {
    from: Vertex,
    to: Vertex,
    /// `None` when `from` cannot reach `to`.
    distance: Option<f64>,
    path: Vec<Vertex>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("bellman-ford");
    let names = args.names.load(ui)?;
    let graph = args.graph.load(ui)?;
    if args.negative_cycle {
        return whole_graph(&graph, args.schedule, args.json, names.as_ref(), ui);
    }
    let n = graph.vertex_count();
    let target = args.to.as_deref().expect("clap requires --to");
    let target = resolve_vertex(target, names.as_ref(), n)?;
    let sources = args
        .from
        .iter()
        .map(|s| resolve_vertex(s, names.as_ref(), n))
        .collect::<Result<Vec<_>>>()?;

    // Distances to a target are distances from it on the transpose.
    let start = Instant::now();
    let transpose = match graph.is_directed() {
        true => Some(
            graph
                .transpose_within(args.graph.budget())
                .context("building the transpose")?,
        ),
        false => None,
    };
    let reverse = transpose.as_ref().unwrap_or(&graph);
    if transpose.is_some() {
        ui.step(&format!(
            "transposed in {} ({} on the heap)",
            ui::duration(start.elapsed()),
            ui::bytes(reverse.heap_bytes())
        ));
    }

    let mut tree = ShortestPathTree::new(n);
    let mut schedule = MeasuredSchedule::new(args.schedule.schedule());
    let start = Instant::now();
    let result =
        dispatch!(reverse, g => bellman_ford_to_into(g, target, &mut schedule, &mut tree, &mut ()));
    let elapsed = start.elapsed();
    let counts = schedule.counts();
    ui.step(&format!(
        "bellman-ford ({}) to {} in {}: {} passes, {} scans, {} improvements",
        args.schedule.label(),
        display_vertex(target, names.as_ref()),
        ui::duration(elapsed),
        counts.passes,
        counts.scans,
        counts.lowered
    ));
    if let Err(cycle) = result {
        report_cycle(&cycle, args.json, names.as_ref(), ui)?;
        bail!("a negative cycle reaches {target}: no shortest path to it is defined");
    }
    ui.kv(
        "reach",
        format!("{} vertices reach {target}", tree.reached_count()),
    );

    let answers: Vec<Answer> = sources
        .iter()
        .map(|&from| Answer {
            from,
            to: target,
            distance: tree.distance(from),
            path: tree.path_from(from).unwrap_or_default(),
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
                None => "∞  (no path)".into(),
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

    let suffix = format!("bellman-ford-to-{target}.txt");
    let path = output_path(&args.output, &args.graph.stem(), &suffix);
    let file = File::create(&path).with_context(|| format!("creating {}", path.display()))?;
    tree.write_toward_root_to(file)?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}

/// `--negative-cycle`: Bellman-Ford from every vertex at once.
fn whole_graph(
    graph: &AnyGraph,
    schedule: ScheduleKind,
    json: bool,
    names: Option<&VertexNames>,
    ui: &Ui,
) -> Result<()> {
    let start = Instant::now();
    let found = dispatch!(graph, g => negative_cycle(g, schedule));
    ui.step(&format!(
        "searched the whole graph ({}) in {}",
        schedule.label(),
        ui::duration(start.elapsed())
    ));
    match found {
        None => {
            ui.done("no negative cycle");
            match json {
                true => println!("null"),
                false => println!("negative-cycle none"),
            }
            Ok(())
        }
        Some(cycle) => {
            report_cycle(&cycle, json, names, ui)?;
            bail!("the graph has a negative cycle")
        }
    }
}

/// Shows a negative cycle: its vertices in order and its weight.
fn report_cycle(
    cycle: &NegativeCycle,
    json: bool,
    names: Option<&VertexNames>,
    ui: &Ui,
) -> Result<()> {
    let mut shown: Vec<String> = cycle
        .cycle
        .iter()
        .map(|&v| display_vertex(v, names))
        .collect();
    shown.push(display_vertex(cycle.cycle[0], names));
    ui.warn(&format!(
        "negative cycle of {} arc(s), weight {}: {}",
        cycle.len(),
        ui::weight(cycle.weight),
        shown.join(" > ")
    ));
    match json {
        true => println!("{}", serde_json::to_string_pretty(cycle)?),
        false => {
            let vertices: Vec<String> = cycle.cycle.iter().map(Vertex::to_string).collect();
            println!("negative-cycle {} {}", cycle.weight, vertices.join(" "));
        }
    }
    Ok(())
}
