//! The summary file required by the assignment ("Saída").

use crate::algo::{Components, DegreeStats, in_degree_stats, weight_stats};
use crate::graph::Weighted;
use std::io::{self, Write};

/// Writes vertex/edge counts, degree statistics and the connected components;
/// for a weighted graph also the smallest, largest and mean weight and the
/// number of negative edges.
///
/// A directed graph adds a first line `directed`, counts `arcs`, gives the
/// out-degree (`degrees`) and the in-degree statistics and calls its
/// components `weak_components`. An undirected summary is unchanged.
///
/// ```text
/// vertices 5
/// edges 5
/// degree_min 1
/// degree_max 4
/// degree_mean 2.000
/// degree_median 2.0
/// components 1
/// # component size vertices...
/// 1 5 1 2 3 4 5
/// ```
pub fn write_summary<W: Write, G: Weighted>(
    mut w: W,
    graph: &G,
    degrees: &DegreeStats,
    components: &Components,
) -> io::Result<()> {
    let directed = graph.is_directed();
    if directed {
        writeln!(w, "directed")?;
    }
    writeln!(w, "vertices {}", graph.vertex_count())?;
    let (edges, degree) = match directed {
        true => ("arcs", "out_degree"),
        false => ("edges", "degree"),
    };
    writeln!(w, "{edges} {}", graph.edge_count())?;
    let mut write_degrees = |name: &str, stats: &DegreeStats| -> io::Result<()> {
        writeln!(w, "{name}_min {}", stats.min)?;
        writeln!(w, "{name}_max {}", stats.max)?;
        writeln!(w, "{name}_mean {:.3}", stats.mean)?;
        writeln!(w, "{name}_median {:.1}", stats.median)
    };
    write_degrees(degree, degrees)?;
    if directed {
        write_degrees("in_degree", &in_degree_stats(graph))?;
    }
    if let Some(weights) = weight_stats(graph) {
        writeln!(w, "weight_min {}", weights.min)?;
        writeln!(w, "weight_max {}", weights.max)?;
        writeln!(w, "weight_mean {:.6}", weights.mean)?;
        writeln!(w, "weight_negative {}", weights.negative)?;
    }
    let components_name = match directed {
        true => "weak_components",
        false => "components",
    };
    writeln!(w, "{components_name} {}", components.count())?;
    for edge in graph.negative_loops() {
        writeln!(w, "# negative loop {} {}", edge.u, edge.weight)?;
    }
    writeln!(w, "# component size vertices...")?;
    let mut w = io::BufWriter::new(w);
    for (index, members) in components.iter().enumerate() {
        write!(w, "{} {}", index + 1, members.len())?;
        for v in members {
            write!(w, " {v}")?;
        }
        writeln!(w)?;
    }
    w.flush()
}
