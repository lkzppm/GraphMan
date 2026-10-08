//! Loading graphs from the command line: shared argument struct and timing.

use crate::ui::{self, Ui};
use anyhow::{Context, Result, bail};
use graphman::{AnyGraph, EdgeList, MemoryBudget, Representation, Vertex, VertexNames};
use std::path::PathBuf;
use std::time::Instant;

/// Arguments shared by every command that reads a graph.
#[derive(clap::Args, Clone)]
pub struct GraphArgs {
    /// Graph file: first line is the vertex count, then one edge per line,
    /// `u v` (unweighted) or `u v weight` (weighted).
    pub graph: PathBuf,

    /// Storage strategy: list, matrix or csr.
    #[arg(short, long, default_value = "list")]
    pub repr: Representation,

    /// Build even if the representation exceeds this machine's memory.
    #[arg(long)]
    pub force: bool,
}

impl GraphArgs {
    pub fn budget(&self) -> MemoryBudget {
        if self.force {
            MemoryBudget::Unlimited
        } else {
            MemoryBudget::Machine
        }
    }

    /// The file name without extension, used to name outputs.
    pub fn stem(&self) -> String {
        self.graph
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// Parses the file (reporting what was normalised away).
    pub fn edges(&self, ui: &Ui) -> Result<EdgeList> {
        let start = Instant::now();
        let edges = EdgeList::from_path(&self.graph)
            .with_context(|| format!("reading {}", self.graph.display()))?;
        ui.step(&format!(
            "parsed {} in {}: {} vertices, {} {}edges",
            self.graph.display(),
            ui::duration(start.elapsed()),
            edges.vertex_count(),
            edges.edge_count(),
            if edges.is_weighted() { "weighted " } else { "" }
        ));
        if edges.self_loops_dropped() + edges.duplicates_dropped() > 0 {
            ui.kv(
                "normalised",
                format!(
                    "{} self-loops and {} duplicate edges dropped",
                    edges.self_loops_dropped(),
                    edges.duplicates_dropped()
                ),
            );
        }
        if let Some(edge) = edges.negative_edge() {
            ui.warn(&format!(
                "edge {}-{} has the negative weight {}: shortest paths will be refused",
                edge.u, edge.v, edge.weight
            ));
        }
        Ok(edges)
    }

    /// Builds the requested representation from parsed edges.
    pub fn build(&self, edges: &EdgeList, ui: &Ui) -> Result<AnyGraph> {
        let start = Instant::now();
        let graph = self
            .repr
            .build_within(edges, self.budget())
            .with_context(|| format!("building the {}", self.repr))?;
        ui.step(&format!(
            "built {} in {} ({} on the heap)",
            self.repr,
            ui::duration(start.elapsed()),
            ui::bytes(graph.heap_bytes())
        ));
        Ok(graph)
    }

    /// Parse and build in one go.
    pub fn load(&self, ui: &Ui) -> Result<AnyGraph> {
        let edges = self.edges(ui)?;
        self.build(&edges, ui)
    }
}

/// Resolves an optional output path, defaulting to `<stem>.<suffix>`.
pub fn output_path(explicit: &Option<PathBuf>, stem: &str, suffix: &str) -> PathBuf {
    explicit
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("{stem}.{suffix}")))
}

/// The optional file that names the vertices.
#[derive(clap::Args, Clone, Default)]
pub struct NamesArgs {
    /// Vertex names, one `index,name` per line; vertices may then be given
    /// by name (e.g. `--from "Edsger W. Dijkstra"`) and are printed with it.
    #[arg(long, value_name = "FILE")]
    pub names: Option<PathBuf>,
}

impl NamesArgs {
    /// Reads the names file, if one was given.
    pub fn load(&self, ui: &Ui) -> Result<Option<VertexNames>> {
        let Some(path) = &self.names else {
            return Ok(None);
        };
        let names = VertexNames::from_path(path)
            .with_context(|| format!("reading names from {}", path.display()))?;
        ui.step(&format!(
            "read {} names from {}",
            names.len(),
            path.display()
        ));
        Ok(Some(names))
    }
}

/// A vertex given on the command line: its id, or its exact name when a
/// names file was given. A near miss lists the closest names.
pub fn resolve_vertex(
    arg: &str,
    names: Option<&VertexNames>,
    vertex_count: usize,
) -> Result<Vertex> {
    let arg = arg.trim();
    let vertex = match (arg.parse::<Vertex>(), names) {
        (Ok(v), _) => v,
        (Err(_), None) => bail!("{arg:?} is not a vertex id (pass --names to use names)"),
        (Err(_), Some(names)) => match names.vertex(arg) {
            Some(v) => v,
            None => {
                let near: Vec<String> = names
                    .search(arg, 5)
                    .into_iter()
                    .map(|v| format!("{:?}", names.name(v).unwrap_or_default()))
                    .collect();
                match near.is_empty() {
                    true => bail!("no vertex is named {arg:?}"),
                    false => bail!(
                        "no vertex is named {arg:?}; did you mean {}?",
                        near.join(", ")
                    ),
                }
            }
        },
    };
    if vertex < 1 || vertex as usize > vertex_count {
        bail!("vertex {vertex} is outside 1..={vertex_count}");
    }
    Ok(vertex)
}

/// How a vertex is shown to a person: `name (id)` when it has a name.
pub fn display_vertex(v: Vertex, names: Option<&VertexNames>) -> String {
    match names.and_then(|names| names.name(v)) {
        Some(name) => format!("{name} ({v})"),
        None => v.to_string(),
    }
}
