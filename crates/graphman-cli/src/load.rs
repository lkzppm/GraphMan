//! Loading graphs from the command line: shared argument struct and timing.

use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::{AnyGraph, EdgeList, MemoryBudget, Representation};
use std::path::PathBuf;
use std::time::Instant;

/// Arguments shared by every command that reads a graph.
#[derive(clap::Args, Clone)]
pub struct GraphArgs {
    /// Graph file: first line is the vertex count, then one edge per line.
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
            "parsed {} in {}: {} vertices, {} edges",
            self.graph.display(),
            ui::duration(start.elapsed()),
            edges.vertex_count(),
            edges.edge_count()
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
