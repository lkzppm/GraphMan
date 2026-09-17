//! The summary file required by the assignment ("Saída").

use crate::algo::{Components, DegreeStats};
use crate::graph::Graph;
use std::io::{self, Write};

/// Writes vertex/edge counts, degree statistics and the connected components.
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
pub fn write_summary<W: Write, G: Graph>(
    mut w: W,
    graph: &G,
    degrees: &DegreeStats,
    components: &Components,
) -> io::Result<()> {
    writeln!(w, "vertices {}", graph.vertex_count())?;
    writeln!(w, "edges {}", graph.edge_count())?;
    writeln!(w, "degree_min {}", degrees.min)?;
    writeln!(w, "degree_max {}", degrees.max)?;
    writeln!(w, "degree_mean {:.3}", degrees.mean)?;
    writeln!(w, "degree_median {:.1}", degrees.median)?;
    writeln!(w, "components {}", components.count())?;
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
