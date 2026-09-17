//! `graphman study`: the program that answers the assignment's case studies.
//!
//! For every graph it measures memory per representation (in a fresh
//! subprocess each), times 100 BFS and 100 DFS per representation, records
//! the parents of vertices 10/20/30 for searches from 1/2/3, the distances
//! between (10,20), (10,30), (20,30), the connected components and the
//! diameter (4-sweep bound, iFUB exact, and brute force when affordable).
//! Results go to `<out>/<graph>.json`, and every JSON in `<out>` is merged
//! into `results.json` and `RESULTS.md`.

use super::bench::{Search, time_searches};
use super::memory::measure_in_subprocess;
use crate::load::GraphArgs;
use crate::report::*;
use crate::rng::SplitMix64;
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{
    Components, Control, DiameterMethod, bfs, degree_stats, dfs, diameter_with_progress,
    distance_into,
};
use graphman::{Representation, SearchTree, Vertex, dispatch};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    /// Graph files to study. With none, only re-merge the JSON already in `--out`.
    graphs: Vec<PathBuf>,

    /// Output directory for JSON and Markdown results.
    #[arg(short, long, default_value = "studies")]
    out: PathBuf,

    /// Searches per representation and algorithm (distinct random roots).
    #[arg(short = 'n', long, default_value_t = 100)]
    runs: usize,

    /// Seed for choosing the search roots.
    #[arg(long, default_value_t = 42)]
    seed: u64,

    /// Representations to compare.
    #[arg(long, value_delimiter = ',', default_values = ["list", "matrix", "csr"])]
    reprs: Vec<Representation>,

    /// Brute-force exact diameter only for graphs with at most this many vertices.
    #[arg(long, default_value_t = 400_000)]
    exact_limit: usize,

    /// Skip every diameter computation.
    #[arg(long)]
    no_diameter: bool,

    /// Wall-clock budget in seconds for each exact diameter method; when it
    /// runs out the best lower bound so far is recorded instead.
    #[arg(long, default_value_t = 600.0)]
    diameter_budget: f64,

    /// Roots of the searches whose trees are inspected.
    #[arg(long, value_delimiter = ',', default_values = ["1", "2", "3"])]
    roots: Vec<Vertex>,

    /// Vertices whose parent and level are reported for each root.
    #[arg(long, value_delimiter = ',', default_values = ["10", "20", "30"])]
    parent_of: Vec<Vertex>,

    /// Vertex pairs for distance queries (`--pair 10 20 --pair 10 30`). Default: (10,20) (10,30) (20,30).
    #[arg(long, num_args = 2, action = clap::ArgAction::Append)]
    pair: Vec<Vertex>,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    std::fs::create_dir_all(&args.out)?;
    let pairs: Vec<(Vertex, Vertex)> = if args.pair.is_empty() {
        vec![(10, 20), (10, 30), (20, 30)]
    } else {
        args.pair.chunks(2).map(|p| (p[0], p[1])).collect()
    };
    for path in &args.graphs {
        let study = study_graph(path, &args, &pairs, ui)?;
        let json_path = args.out.join(format!("{}.json", study.name));
        std::fs::write(&json_path, serde_json::to_string_pretty(&study)?)?;
        ui.done(&format!("wrote {}", json_path.display()));
    }
    merge(&args.out, ui)
}

fn study_graph(
    path: &Path,
    args: &Args,
    pairs: &[(Vertex, Vertex)],
    ui: &Ui,
) -> Result<GraphStudy> {
    let name = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    ui.title(&format!("study {name}"));
    let load = GraphArgs {
        graph: path.to_path_buf(),
        repr: Representation::Csr,
        force: false,
    };
    let parse_start = Instant::now();
    let edges = load.edges(ui)?;
    let parse_ms = parse_start.elapsed().as_secs_f64() * 1000.0;
    let n = edges.vertex_count();
    let (self_loops_dropped, duplicates_dropped) =
        (edges.self_loops_dropped(), edges.duplicates_dropped());
    let roots = SplitMix64::new(args.seed).distinct_vertices(n, args.runs);

    // 1–3. Memory and search timings per representation.
    let mut representations = Vec::new();
    for &repr in &args.reprs {
        ui.step(&format!("measuring the {repr} in a fresh process"));
        let memory = measure_in_subprocess(path, repr, false)?;
        let (mut bfs_timing, mut dfs_timing) = (None, None);
        if memory.feasible {
            ui.kv(
                "resident",
                memory.resident_bytes.map_or("n/a".into(), ui::bytes),
            );
            let graph = GraphArgs {
                graph: path.to_path_buf(),
                repr,
                force: false,
            }
            .build(&edges, ui)?;
            let t = time_searches(&graph, &roots, Search::Bfs, ui);
            ui.kv(
                "BFS mean",
                format!("{:.3} ms over {} runs", t.mean_ms, t.runs),
            );
            bfs_timing = Some(t);
            let t = time_searches(&graph, &roots, Search::Dfs, ui);
            ui.kv(
                "DFS mean",
                format!("{:.3} ms over {} runs", t.mean_ms, t.runs),
            );
            dfs_timing = Some(t);
        } else {
            ui.warn(&format!(
                "{repr} does not fit: needs {}",
                ui::bytes(memory.required_bytes)
            ));
        }
        representations.push(RepresentationStudy {
            representation: repr,
            memory,
            bfs: bfs_timing,
            dfs: dfs_timing,
        });
    }

    // Everything else is representation-independent; use the fastest one.
    let graph = load.build(&edges, ui)?;
    drop(edges);
    let degree = dispatch!(&graph, g => degree_stats(g));

    // 4. Parents of 10, 20, 30 for searches from 1, 2, 3.
    let mut parents = Vec::new();
    for &root in &args.roots {
        if root as usize > n {
            continue;
        }
        for (algorithm, tree) in [
            ("bfs", dispatch!(&graph, g => bfs(g, root))),
            ("dfs", dispatch!(&graph, g => dfs(g, root))),
        ] {
            for &vertex in &args.parent_of {
                if vertex as usize > n {
                    continue;
                }
                parents.push(ParentAnswer {
                    algorithm: algorithm.into(),
                    root,
                    vertex,
                    parent: tree.parent(vertex),
                    level: tree.level(vertex),
                });
            }
        }
    }
    ui.step(&format!("recorded {} parent answers", parents.len()));

    // 5. Distances.
    let mut tree = SearchTree::new(n);
    let distances: Vec<DistanceAnswer> = pairs
        .iter()
        .filter(|(u, v)| *u as usize <= n && *v as usize <= n)
        .map(|&(from, to)| DistanceAnswer {
            from,
            to,
            distance: dispatch!(&graph, g => distance_into(g, from, to, &mut tree)),
        })
        .collect();
    drop(tree);
    for d in &distances {
        ui.kv(
            &format!("d({}, {})", d.from, d.to),
            d.distance.map_or("∞".into(), |d| d.to_string()),
        );
    }

    // 6. Components.
    let start = Instant::now();
    let comps = dispatch!(&graph, g => Components::compute(g));
    let components = ComponentsAnswer {
        count: comps.count(),
        largest: comps.largest_size(),
        smallest: comps.smallest_size(),
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
    };
    ui.kv(
        "components",
        format!(
            "{} (largest {}, smallest {})",
            components.count, components.largest, components.smallest
        ),
    );
    drop(comps);

    // 7. Diameter.
    let mut diameters = Vec::new();
    if !args.no_diameter {
        let mut methods = vec![
            DiameterMethod::Sweep,
            DiameterMethod::IFub,
            DiameterMethod::Bounds,
        ];
        if n <= args.exact_limit {
            methods.push(DiameterMethod::Exact);
        } else {
            ui.warn(&format!(
                "skipping brute-force diameter ({n} vertices > --exact-limit {})",
                args.exact_limit
            ));
        }
        for method in methods {
            let total = (method == DiameterMethod::Exact).then_some(n as u64);
            let bar = ui.progress(total, &format!("diameter {method}"));
            let start = Instant::now();
            let budget = std::time::Duration::from_secs_f64(args.diameter_budget);
            let progress = |done: usize| {
                bar.set_position(done as u64);
                if start.elapsed() > budget {
                    Control::Break
                } else {
                    Control::Continue
                }
            };
            let d = dispatch!(&graph, g => diameter_with_progress(g, method, &progress));
            bar.finish_and_clear();
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            let note = match (d.is_exact, d.cancelled) {
                (true, _) => "",
                (false, true) => " (lower bound: budget exhausted)",
                (false, false) => " (lower bound)",
            };
            ui.kv(
                &format!("diameter {method}"),
                format!(
                    "{}{note} with {} BFS in {}",
                    d.value,
                    d.bfs_count,
                    ui::duration(start.elapsed())
                ),
            );
            diameters.push(DiameterAnswer {
                method,
                value: d.value,
                is_exact: d.is_exact,
                cancelled: d.cancelled,
                bfs_count: d.bfs_count,
                endpoints: d.endpoints,
                elapsed_ms,
            });
        }
    }

    Ok(GraphStudy {
        name,
        file: path.display().to_string(),
        vertices: n,
        edges: graph.edge_count(),
        self_loops_dropped,
        duplicates_dropped,
        parse_ms,
        degree,
        representations,
        parents,
        distances,
        components,
        diameters,
        machine: MachineInfo::detect(),
        generated_at_unix: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

/// Merges every `<out>/*.json` study into `results.json` and `RESULTS.md`.
fn merge(out: &Path, ui: &Ui) -> Result<()> {
    let mut studies: Vec<GraphStudy> = Vec::new();
    for entry in std::fs::read_dir(out)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "json")
            && path.file_name().is_some_and(|f| f != "results.json")
        {
            let text = std::fs::read_to_string(&path)?;
            if let Ok(study) = serde_json::from_str::<GraphStudy>(&text) {
                studies.push(study);
            }
        }
    }
    studies.sort_by_key(|s| (s.vertices, s.edges, s.name.clone()));
    std::fs::write(
        out.join("results.json"),
        serde_json::to_string_pretty(&studies)?,
    )?;
    std::fs::write(out.join("RESULTS.md"), markdown(&studies))
        .with_context(|| format!("writing {}", out.join("RESULTS.md").display()))?;
    ui.done(&format!(
        "merged {} studies into {}",
        studies.len(),
        out.join("RESULTS.md").display()
    ));
    Ok(())
}

fn mb(bytes: usize) -> String {
    format!("{:.1}", bytes as f64 / 1e6)
}

fn cell_memory(r: &RepresentationStudy) -> String {
    match (r.memory.feasible, r.memory.resident_bytes) {
        (true, Some(rss)) => format!(
            "{} MB (structure {} MB)",
            mb(rss),
            mb(r.memory.accounted_bytes.unwrap_or(0))
        ),
        (true, None) => format!("structure {} MB", mb(r.memory.accounted_bytes.unwrap_or(0))),
        (false, _) => format!(
            "needs {} — does not fit",
            ui::bytes(r.memory.required_bytes)
        ),
    }
}

fn cell_timing(t: &Option<Timing>) -> String {
    t.as_ref()
        .map_or("—".into(), |t| format!("{:.3} ms", t.mean_ms))
}

/// Renders the report tables: rows are graphs, columns are features.
pub fn markdown(studies: &[GraphStudy]) -> String {
    let mut md = String::new();
    let _ = writeln!(md, "# Case study results\n");
    if let Some(m) = studies.first().map(|s| &s.machine) {
        let _ = writeln!(
            md,
            "Machine: {} {} ({}), {} threads, {} RAM. Times exclude reading and writing files.\n",
            m.os,
            m.arch,
            m.cpu.as_deref().unwrap_or("unknown cpu"),
            m.threads,
            m.total_memory_bytes.map_or("?".into(), ui::bytes)
        );
    }
    let reprs: Vec<Representation> = studies
        .first()
        .map(|s| s.representations.iter().map(|r| r.representation).collect())
        .unwrap_or_default();

    let _ = writeln!(md, "## Graphs\n");
    let _ = writeln!(
        md,
        "| Graph | Vertices | Edges | Min degree | Max degree | Mean degree | Median degree |"
    );
    let _ = writeln!(md, "|---|---:|---:|---:|---:|---:|---:|");
    for s in studies {
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} | {} | {:.2} | {:.1} |",
            s.name, s.vertices, s.edges, s.degree.min, s.degree.max, s.degree.mean, s.degree.median
        );
    }

    let _ = writeln!(md, "\n## 1. Memory after loading (process RSS)\n");
    let _ = write!(md, "| Graph |");
    for r in &reprs {
        let _ = write!(md, " {} |", r);
    }
    let _ = writeln!(md, "\n|---|{}", "---|".repeat(reprs.len()));
    for s in studies {
        let _ = write!(md, "| {} |", s.name);
        for r in &s.representations {
            let _ = write!(md, " {} |", cell_memory(r));
        }
        let _ = writeln!(md);
    }

    for (title, pick) in [
        ("2. Mean BFS time (100 searches from distinct vertices)", 0),
        ("3. Mean DFS time (100 searches from distinct vertices)", 1),
    ] {
        let _ = writeln!(md, "\n## {title}\n");
        let _ = write!(md, "| Graph |");
        for r in &reprs {
            let _ = write!(md, " {} |", r);
        }
        let _ = writeln!(md, "\n|---|{}", "---:|".repeat(reprs.len()));
        for s in studies {
            let _ = write!(md, "| {} |", s.name);
            for r in &s.representations {
                let _ = write!(
                    md,
                    " {} |",
                    cell_timing(if pick == 0 { &r.bfs } else { &r.dfs })
                );
            }
            let _ = writeln!(md);
        }
    }

    let _ = writeln!(md, "\n## 4. Parents in the BFS and DFS trees\n");
    let _ = writeln!(
        md,
        "Cells read `parent (level)`; `—` means the vertex was not reached.\n"
    );
    let vertices: Vec<Vertex> = studies
        .first()
        .map(|s| {
            let mut v: Vec<Vertex> = s.parents.iter().map(|p| p.vertex).collect();
            v.sort_unstable();
            v.dedup();
            v
        })
        .unwrap_or_default();
    let _ = write!(md, "| Graph | Search | Root |");
    for v in &vertices {
        let _ = write!(md, " parent of {v} |");
    }
    let _ = writeln!(md, "\n|---|---|---:|{}", "---:|".repeat(vertices.len()));
    for s in studies {
        for algorithm in ["bfs", "dfs"] {
            let mut roots: Vec<Vertex> = s
                .parents
                .iter()
                .filter(|p| p.algorithm == algorithm)
                .map(|p| p.root)
                .collect();
            roots.dedup();
            for root in roots {
                let _ = write!(
                    md,
                    "| {} | {} | {} |",
                    s.name,
                    algorithm.to_uppercase(),
                    root
                );
                for v in &vertices {
                    let answer = s
                        .parents
                        .iter()
                        .find(|p| p.algorithm == algorithm && p.root == root && p.vertex == *v);
                    let cell = match answer {
                        Some(ParentAnswer {
                            parent: Some(p),
                            level: Some(l),
                            ..
                        }) => format!("{p} ({l})"),
                        Some(ParentAnswer {
                            parent: None,
                            level: Some(l),
                            ..
                        }) => format!("root ({l})"),
                        _ => "—".into(),
                    };
                    let _ = write!(md, " {cell} |");
                }
                let _ = writeln!(md);
            }
        }
    }

    let _ = writeln!(md, "\n## 5. Distances\n");
    let pairs: Vec<(Vertex, Vertex)> = studies
        .first()
        .map(|s| s.distances.iter().map(|d| (d.from, d.to)).collect())
        .unwrap_or_default();
    let _ = write!(md, "| Graph |");
    for (u, v) in &pairs {
        let _ = write!(md, " d({u}, {v}) |");
    }
    let _ = writeln!(md, "\n|---|{}", "---:|".repeat(pairs.len()));
    for s in studies {
        let _ = write!(md, "| {} |", s.name);
        for d in &s.distances {
            let _ = write!(
                md,
                " {} |",
                d.distance.map_or("∞".into(), |d| d.to_string())
            );
        }
        let _ = writeln!(md);
    }

    let _ = writeln!(md, "\n## 6. Connected components\n");
    let _ = writeln!(md, "| Graph | Components | Largest | Smallest | Time |");
    let _ = writeln!(md, "|---|---:|---:|---:|---:|");
    for s in studies {
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} | {:.1} ms |",
            s.name,
            s.components.count,
            s.components.largest,
            s.components.smallest,
            s.components.elapsed_ms
        );
    }

    let _ = writeln!(md, "\n## 7. Diameter\n");
    let _ = writeln!(
        md,
        "| Graph | 4-sweep bound | iFUB (exact) | iFUB BFS runs | iFUB time | Brute force | Brute-force BFS runs | Brute-force time |"
    );
    let _ = writeln!(md, "|---|---:|---:|---:|---:|---:|---:|---:|");
    for s in studies {
        let find = |m: DiameterMethod| s.diameters.iter().find(|d| d.method == m);
        let fmt_time = |d: &DiameterAnswer| {
            ui::duration(std::time::Duration::from_secs_f64(d.elapsed_ms / 1000.0))
        };
        let fmt_value = |d: &DiameterAnswer| match (d.is_exact, d.cancelled) {
            (true, _) => d.value.to_string(),
            (false, true) => format!("≥ {} (budget)", d.value),
            (false, false) => format!("≥ {}", d.value),
        };
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            s.name,
            find(DiameterMethod::Sweep).map_or("—".into(), fmt_value),
            find(DiameterMethod::IFub).map_or("—".into(), fmt_value),
            find(DiameterMethod::IFub).map_or("—".into(), |d| d.bfs_count.to_string()),
            find(DiameterMethod::IFub).map_or("—".into(), fmt_time),
            find(DiameterMethod::Bounds).map_or("—".into(), fmt_value),
            find(DiameterMethod::Bounds).map_or("—".into(), |d| d.bfs_count.to_string()),
            find(DiameterMethod::Bounds).map_or("—".into(), fmt_time),
            find(DiameterMethod::Exact).map_or("skipped".into(), fmt_value),
            find(DiameterMethod::Exact).map_or("—".into(), |d| d.bfs_count.to_string()),
            find(DiameterMethod::Exact).map_or("—".into(), fmt_time),
        );
    }
    md
}
