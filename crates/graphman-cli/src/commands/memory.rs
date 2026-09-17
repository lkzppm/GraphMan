//! `graphman memory`: resident memory after loading one representation.
//!
//! This is the assignment's "pause the program after loading the graph and
//! check the memory of the process", automated: parse, build, drop the edge
//! list, read the RSS.

use crate::load::GraphArgs;
use crate::report::MemoryReport;
use crate::ui::{self, Ui};
use anyhow::Result;
use graphman::metrics::memory;
use graphman::{EdgeList, Representation};
use std::hint::black_box;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Print the report as JSON on stdout.
    #[arg(long)]
    json: bool,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("memory");
    let baseline = memory::resident_bytes();
    let edges = args.graph.edges(ui)?;
    let report = measure(&args.graph, edges, baseline, ui);
    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "{} feasible {} required {} accounted {} resident {} peak {}",
            report.representation.label(),
            report.feasible,
            report.required_bytes,
            report.accounted_bytes.unwrap_or(0),
            report.resident_bytes.unwrap_or(0),
            report.peak_resident_bytes.unwrap_or(0)
        );
    }
    Ok(())
}

/// Builds `repr` from `edges` (consuming them) and measures the process.
pub fn measure(
    args: &GraphArgs,
    edges: EdgeList,
    baseline: Option<usize>,
    ui: &Ui,
) -> MemoryReport {
    ui.kv("RSS at start", baseline.map_or("n/a".into(), ui::bytes));
    ui.kv(
        "RSS after parse",
        memory::resident_bytes().map_or("n/a".into(), ui::bytes),
    );
    let required = args
        .repr
        .required_bytes(edges.vertex_count(), edges.edge_count());
    let start = Instant::now();
    match args.repr.build_within(&edges, args.budget()) {
        Ok(graph) => {
            let build_ms = start.elapsed().as_secs_f64() * 1000.0;
            ui.kv(
                "RSS after build",
                memory::resident_bytes().map_or("n/a".into(), ui::bytes),
            );
            drop(edges);
            ui.kv(
                "RSS after drop",
                memory::resident_bytes().map_or("n/a".into(), ui::bytes),
            );
            memory::release_unused();
            let resident = memory::resident_bytes();
            let footprint = memory::footprint_bytes();
            let peak = memory::peak_resident_bytes();
            let accounted = graph.heap_bytes();
            black_box(&graph);
            ui.kv("representation", args.repr);
            ui.kv("required", ui::bytes(required));
            ui.kv("accounted", ui::bytes(accounted));
            ui.kv("resident (RSS)", resident.map_or("n/a".into(), ui::bytes));
            ui.kv("footprint", footprint.map_or("n/a".into(), ui::bytes));
            ui.kv("peak RSS", peak.map_or("n/a".into(), ui::bytes));
            MemoryReport {
                representation: args.repr,
                feasible: true,
                required_bytes: required,
                accounted_bytes: Some(accounted),
                baseline_resident_bytes: baseline,
                resident_bytes: resident,
                footprint_bytes: footprint,
                peak_resident_bytes: peak,
                build_ms: Some(build_ms),
                error: None,
            }
        }
        Err(err) => {
            ui.warn(&format!("{err}"));
            MemoryReport {
                representation: args.repr,
                feasible: false,
                required_bytes: required,
                accounted_bytes: None,
                baseline_resident_bytes: baseline,
                resident_bytes: None,
                footprint_bytes: None,
                peak_resident_bytes: None,
                build_ms: None,
                error: Some(err.to_string()),
            }
        }
    }
}

/// Runs `graphman memory --json` in a fresh process so that the measurement
/// is not polluted by other representations living in this one.
pub fn measure_in_subprocess(
    graph: &std::path::Path,
    repr: Representation,
    force: bool,
) -> Result<MemoryReport> {
    let exe = std::env::current_exe()?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--quiet")
        .arg("memory")
        .arg(graph)
        .arg("--repr")
        .arg(repr.label())
        .arg("--json");
    if force {
        cmd.arg("--force");
    }
    let output = cmd.output()?;
    anyhow::ensure!(
        output.status.success(),
        "memory subprocess failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(serde_json::from_slice(&output.stdout)?)
}
