//! `graphman study`: the program that answers the assignment's case studies.
//!
//! Part 1 (unweighted graphs): for every graph it measures memory per
//! representation (in a fresh subprocess each), times 100 BFS and 100 DFS
//! (iterative and recursive) per representation, records the parents of
//! vertices 10/20/30 for searches from 1/2/3, the distances between
//! (10,20), (10,30), (20,30), the connected components and the diameter
//! (4-sweep bound, iFUB exact, and brute force when affordable).
//!
//! Part 2 (weighted graphs, [`weighted`]): the distance and shortest path
//! from one source to a few targets, and the mean time of one Dijkstra per
//! frontier.
//!
//! A weighted file gets the Part 2 study and an unweighted one the Part 1
//! study, unless `--only` names the sections. Sections left out keep the
//! graph's previous answers, so refreshing one timing never repeats an
//! hour of diameter. Results go to `<out>/<graph>.json` (Part 1) and
//! `<out>/weighted/<graph>.json` (Part 2); each directory's JSON is merged
//! into its `results.json`, and both into `<out>/RESULTS.md`.

mod weighted;

use super::bench::{Search, time_searches};
use super::memory::measure_in_subprocess;
use crate::deep::with_stack_for;
use crate::load::{GraphArgs, NamesArgs};
use crate::report::*;
use crate::rng::SplitMix64;
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{
    Components, Control, DfsKind, DiameterMethod, FrontierKind, bfs, degree_stats, dfs,
    dfs_recursive, diameter_with_progress, distance_into,
};
use graphman::{EdgeList, Representation, SearchTree, Vertex, dispatch};
use serde::de::DeserializeOwned;
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

    /// Sections to run, comma separated. Default: every Part 1 section for
    /// an unweighted file, every Part 2 section for a weighted one. The
    /// sections left out keep the graph's previous answers in `--out`.
    #[arg(long, value_delimiter = ',')]
    only: Vec<Section>,

    /// Searches (Part 1) or Dijkstra runs (Part 2) per representation,
    /// algorithm or frontier, from distinct random roots.
    #[arg(short = 'n', long, default_value_t = 100)]
    runs: usize,

    /// Seed for choosing the roots.
    #[arg(long, default_value_t = 42)]
    seed: u64,

    /// Representations to compare.
    #[arg(long, value_delimiter = ',', default_values = ["list", "matrix", "csr"])]
    reprs: Vec<Representation>,

    /// Brute-force exact diameter only for graphs with at most this many vertices.
    #[arg(long, default_value_t = 400_000)]
    exact_limit: usize,

    /// Skip every diameter computation (same as leaving `diameter` out of `--only`).
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

    #[command(flatten)]
    names: NamesArgs,

    /// Part 2: the source of the shortest paths (an id, or a name with --names).
    #[arg(long, default_value = "10")]
    from: String,

    /// Part 2: the targets of the shortest paths (ids, or names with --names).
    #[arg(long, num_args = 1.., default_values = ["20", "30", "40", "50", "60"])]
    to: Vec<String>,

    /// Part 2: the frontiers to time.
    #[arg(long, value_delimiter = ',', default_values = ["vector", "heap", "lazy-heap"])]
    frontiers: Vec<FrontierKind>,

    /// Part 2: wall-clock budget in seconds for each frontier's runs. The
    /// vector is O(n²) per run; when the budget runs out the runs that
    /// finished are reported, or an estimate from the one cut short.
    #[arg(long, default_value_t = 600.0)]
    dijkstra_budget: f64,

    /// Part 2: the representation Dijkstra runs on.
    #[arg(long, default_value = "csr")]
    dijkstra_repr: Representation,
}

/// One part of the case study, for `--only`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, clap::ValueEnum)]
pub enum Section {
    /// Part 1, question 1: memory after loading, per representation.
    Memory,
    /// Part 1, questions 2 and 3: mean BFS and DFS (iterative and recursive) times.
    Searches,
    /// Part 1, question 4: parents in the BFS and DFS trees.
    Trees,
    /// Part 1, question 5: distances between vertex pairs.
    Distances,
    /// Part 1, question 6: connected components.
    Components,
    /// Part 1, question 7: the diameter.
    Diameter,
    /// Part 2, question 1: distance and shortest path from one source.
    Paths,
    /// Part 2, question 2: mean Dijkstra time per frontier.
    Frontiers,
}

impl Section {
    const PART1: [Section; 6] = [
        Section::Memory,
        Section::Searches,
        Section::Trees,
        Section::Distances,
        Section::Components,
        Section::Diameter,
    ];
    const PART2: [Section; 2] = [Section::Paths, Section::Frontiers];
}

/// A parsed graph file, shared by both parts.
pub struct Input {
    name: String,
    path: PathBuf,
    edges: EdgeList,
    parse_ms: f64,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    std::fs::create_dir_all(&args.out)?;
    let pairs: Vec<(Vertex, Vertex)> = if args.pair.is_empty() {
        vec![(10, 20), (10, 30), (20, 30)]
    } else {
        args.pair.chunks(2).map(|p| (p[0], p[1])).collect()
    };
    for path in &args.graphs {
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        ui.title(&format!("study {name}"));
        let start = Instant::now();
        let edges = GraphArgs {
            graph: path.clone(),
            repr: Representation::Csr,
            force: false,
        }
        .edges(ui)?;
        let input = Input {
            name,
            path: path.clone(),
            edges,
            parse_ms: start.elapsed().as_secs_f64() * 1000.0,
        };
        let mut sections = match (args.only.is_empty(), input.edges.is_weighted()) {
            (false, _) => args.only.clone(),
            (true, false) => Section::PART1.to_vec(),
            (true, true) => Section::PART2.to_vec(),
        };
        if args.no_diameter {
            sections.retain(|&s| s != Section::Diameter);
        }

        if sections.iter().any(|s| Section::PART2.contains(s)) {
            let dir = args.out.join("weighted");
            std::fs::create_dir_all(&dir)?;
            let json_path = dir.join(format!("{}.json", input.name));
            let previous = previous_study(&json_path, &sections, &Section::PART2, ui);
            let study = weighted::study(&input, &args, &sections, previous, ui)?;
            std::fs::write(&json_path, serde_json::to_string_pretty(&study)?)?;
            ui.done(&format!("wrote {}", json_path.display()));
        }
        if sections.iter().any(|s| Section::PART1.contains(s)) {
            let json_path = args.out.join(format!("{}.json", input.name));
            let previous = previous_study(&json_path, &sections, &Section::PART1, ui);
            let study = study_graph(input, &args, &sections, &pairs, previous, ui)?;
            std::fs::write(&json_path, serde_json::to_string_pretty(&study)?)?;
            ui.done(&format!("wrote {}", json_path.display()));
        }
    }
    merge(&args.out, ui)
}

/// The graph's earlier study, when some of `part`'s sections are not run
/// this time and must keep their answers.
fn previous_study<T: DeserializeOwned>(
    json_path: &Path,
    sections: &[Section],
    part: &[Section],
    ui: &Ui,
) -> Option<T> {
    if part.iter().all(|s| sections.contains(s)) {
        return None;
    }
    let study = std::fs::read_to_string(json_path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());
    match &study {
        Some(_) => ui.step(&format!(
            "keeping the sections not run from {}",
            json_path.display()
        )),
        None => ui.warn(&format!(
            "no earlier study at {}: the sections not run stay empty",
            json_path.display()
        )),
    }
    study
}

pub(crate) fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn study_graph(
    input: Input,
    args: &Args,
    sections: &[Section],
    pairs: &[(Vertex, Vertex)],
    previous: Option<GraphStudy>,
    ui: &Ui,
) -> Result<GraphStudy> {
    let Input {
        name,
        path,
        edges,
        parse_ms,
    } = input;
    let path = path.as_path();
    let run = |section: Section| sections.contains(&section);
    let load = GraphArgs {
        graph: path.to_path_buf(),
        repr: Representation::Csr,
        force: false,
    };
    let n = edges.vertex_count();
    let (self_loops_dropped, duplicates_dropped) =
        (edges.self_loops_dropped(), edges.duplicates_dropped());
    let roots = SplitMix64::new(args.seed).distinct_vertices(n, args.runs);
    let mut previous = previous;

    // 1–3. Memory and search timings per representation.
    let mut representations = Vec::new();
    for &repr in &args.reprs {
        let earlier = previous.as_mut().and_then(|p| {
            p.representations
                .iter()
                .position(|r| r.representation == repr)
                .map(|i| p.representations.swap_remove(i))
        });
        let memory = if run(Section::Memory) {
            ui.step(&format!("measuring the {repr} in a fresh process"));
            let memory = measure_in_subprocess(path, repr, false)?;
            if memory.feasible {
                ui.kv(
                    "resident",
                    memory.resident_bytes.map_or("n/a".into(), ui::bytes),
                );
            }
            memory
        } else {
            earlier
                .as_ref()
                .map(|r| r.memory.clone())
                .unwrap_or_else(|| {
                    MemoryReport::unmeasured(
                        repr,
                        repr.required_bytes(n, edges.edge_count(), edges.is_weighted()),
                    )
                })
        };
        let mut study = RepresentationStudy {
            representation: repr,
            memory,
            bfs: None,
            dfs: None,
            dfs_recursive: None,
        };
        if !run(Section::Searches) {
            if let Some(earlier) = earlier {
                (study.bfs, study.dfs, study.dfs_recursive) =
                    (earlier.bfs, earlier.dfs, earlier.dfs_recursive);
            }
        } else if !study.memory.feasible {
            ui.warn(&format!(
                "{repr} does not fit: needs {}",
                ui::bytes(study.memory.required_bytes)
            ));
        } else {
            let graph = GraphArgs {
                graph: path.to_path_buf(),
                repr,
                force: false,
            }
            .build(&edges, ui)?;
            for (search, slot) in [
                (Search::Bfs, &mut study.bfs),
                (Search::Dfs(DfsKind::Iterative), &mut study.dfs),
                (Search::Dfs(DfsKind::Recursive), &mut study.dfs_recursive),
            ] {
                let t = time_searches(&graph, &roots, search, ui);
                ui.kv(
                    &format!("{} mean", search.label()),
                    format!("{:.3} ms over {} runs", t.mean_ms, t.runs),
                );
                *slot = Some(t);
            }
        }
        representations.push(study);
    }

    // Everything else is representation-independent; use the fastest one.
    let graph = load.build(&edges, ui)?;
    drop(edges);
    let degree = dispatch!(&graph, g => degree_stats(g));

    // 4. Parents of 10, 20, 30 for searches from 1, 2, 3, and whether the
    // recursive DFS agrees with the iterative one on the whole tree.
    let (parents, dfs_recursive_identical) = if run(Section::Trees) {
        let mut parents = Vec::new();
        let mut identical = true;
        for &root in &args.roots {
            if root as usize > n {
                continue;
            }
            let dfs_tree = dispatch!(&graph, g => dfs(g, root));
            let recursive = with_stack_for(
                n,
                || dispatch!(&graph, g => dfs_recursive(g, root, n as u32)),
            );
            identical &= recursive.is_ok_and(|tree| tree == dfs_tree);
            for (algorithm, tree) in [
                ("bfs", dispatch!(&graph, g => bfs(g, root))),
                ("dfs", dfs_tree),
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
        match identical {
            true => ui.kv("recursive DFS", "the same tree as the iterative one"),
            false => ui.warn("the recursive DFS built a different tree from the iterative one"),
        }
        (parents, Some(identical))
    } else {
        previous
            .as_mut()
            .map(|p| (std::mem::take(&mut p.parents), p.dfs_recursive_identical))
            .unwrap_or_default()
    };

    // 5. Distances.
    let distances: Vec<DistanceAnswer> = if run(Section::Distances) {
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
        for d in &distances {
            ui.kv(
                &format!("d({}, {})", d.from, d.to),
                d.distance.map_or("∞".into(), |d| d.to_string()),
            );
        }
        distances
    } else {
        previous
            .as_mut()
            .map(|p| std::mem::take(&mut p.distances))
            .unwrap_or_default()
    };

    // 6. Components.
    let components = if run(Section::Components) {
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
        components
    } else {
        previous
            .as_ref()
            .map(|p| p.components.clone())
            .unwrap_or_default()
    };

    // 7. Diameter.
    let mut diameters = Vec::new();
    if !run(Section::Diameter) {
        diameters = previous
            .as_mut()
            .map(|p| std::mem::take(&mut p.diameters))
            .unwrap_or_default();
    } else {
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
        dfs_recursive_identical,
        distances,
        components,
        diameters,
        machine: MachineInfo::detect(),
        generated_at_unix: now_unix(),
    })
}

/// Merges every `<out>/*.json` study into `results.json`, every
/// `<out>/weighted/*.json` into `weighted/results.json`, and both into
/// `RESULTS.md`.
fn merge(out: &Path, ui: &Ui) -> Result<()> {
    let mut studies: Vec<GraphStudy> = collect(out)?;
    studies.sort_by_key(|s| (s.vertices, s.edges, s.name.clone()));
    std::fs::write(
        out.join("results.json"),
        serde_json::to_string_pretty(&studies)?,
    )?;
    let weighted_dir = out.join("weighted");
    let mut weighted: Vec<WeightedStudy> = match weighted_dir.is_dir() {
        true => collect(&weighted_dir)?,
        false => Vec::new(),
    };
    weighted.sort_by_key(|s| (s.names_file.is_some(), s.vertices, s.edges, s.name.clone()));
    if !weighted.is_empty() {
        std::fs::write(
            weighted_dir.join("results.json"),
            serde_json::to_string_pretty(&weighted)?,
        )?;
    }
    let mut md = match studies.is_empty() {
        true => "# Case study results\n".to_string(),
        false => markdown(&studies),
    };
    if !weighted.is_empty() {
        weighted::markdown(&mut md, &weighted);
    }
    std::fs::write(out.join("RESULTS.md"), md)
        .with_context(|| format!("writing {}", out.join("RESULTS.md").display()))?;
    ui.done(&format!(
        "merged {} unweighted and {} weighted studies into {}",
        studies.len(),
        weighted.len(),
        out.join("RESULTS.md").display()
    ));
    Ok(())
}

/// Every study in `dir` (its JSON files but `results.json`).
fn collect<T: DeserializeOwned>(dir: &Path) -> Result<Vec<T>> {
    let mut studies = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().is_some_and(|e| e == "json")
            && path.file_name().is_some_and(|f| f != "results.json")
        {
            let text = std::fs::read_to_string(&path)?;
            if let Ok(study) = serde_json::from_str::<T>(&text) {
                studies.push(study);
            }
        }
    }
    Ok(studies)
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

    let _ = writeln!(
        md,
        "\n## 2. Mean BFS time (100 searches from distinct vertices)\n"
    );
    let _ = write!(md, "| Graph |");
    for r in &reprs {
        let _ = write!(md, " {} |", r);
    }
    let _ = writeln!(md, "\n|---|{}", "---:|".repeat(reprs.len()));
    for s in studies {
        let _ = write!(md, "| {} |", s.name);
        for r in &s.representations {
            let _ = write!(md, " {} |", cell_timing(&r.bfs));
        }
        let _ = writeln!(md);
    }

    let _ = writeln!(
        md,
        "\n## 3. Mean DFS time, iterative and recursive (100 searches from distinct vertices)\n"
    );
    let _ = writeln!(
        md,
        "The recursive DFS runs on a thread whose stack is sized for a path through every vertex.\n"
    );
    let _ = write!(md, "| Graph |");
    for r in &reprs {
        let _ = write!(md, " {r} iterative | {r} recursive |");
    }
    let _ = writeln!(md, "\n|---|{}", "---:|".repeat(2 * reprs.len()));
    for s in studies {
        let _ = write!(md, "| {} |", s.name);
        for r in &s.representations {
            let _ = write!(
                md,
                " {} | {} |",
                cell_timing(&r.dfs),
                cell_timing(&r.dfs_recursive)
            );
        }
        let _ = writeln!(md);
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

    let checked: Vec<&GraphStudy> = studies
        .iter()
        .filter(|s| s.dfs_recursive_identical.is_some())
        .collect();
    if !checked.is_empty() {
        let differ: Vec<&str> = checked
            .iter()
            .filter(|s| s.dfs_recursive_identical == Some(false))
            .map(|s| s.name.as_str())
            .collect();
        let _ = writeln!(
            md,
            "\n{}",
            match differ.is_empty() {
                true => "The recursive DFS built exactly the iterative DFS's tree from every root above.".to_string(),
                false => format!(
                    "The recursive DFS built a different tree from the iterative one on {}.",
                    differ.join(", ")
                ),
            }
        );
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
        "| Graph | 4-sweep bound | iFUB (exact) | iFUB BFS runs | iFUB time | Bounding (exact) | Bounding BFS runs | Bounding time | Brute force | Brute-force BFS runs | Brute-force time |"
    );
    let _ = writeln!(
        md,
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
    );
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
