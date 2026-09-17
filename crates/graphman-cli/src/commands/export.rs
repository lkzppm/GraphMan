//! `graphman export`: search-tree layouts for the web observatory.
//!
//! Binary layout (`.gmo`, little endian):
//!
//! ```text
//! "GMO1"            magic
//! u32 vertex_count  n
//! u32 root
//! u32 max_level     deepest reached level
//! u32 reached       vertices reached from the root
//! u32 kind          0 = BFS, 1 = DFS
//! f32 angle[n]      polar angle of vertex i+1 (unreached: hashed)
//! u32 level[n]      level of vertex i+1 (0xFFFFFFFF = unreached)
//! u32 parent[n]     parent of vertex i+1 (0 = none)
//! ```

use crate::load::GraphArgs;
use crate::ui::{self, Ui};
use anyhow::{Context, Result};
use graphman::algo::{Components, UNREACHED, bfs, degree_stats, dfs, radial_layout};
use graphman::{AnyGraph, SearchTree, Vertex, dispatch};
use serde::Serialize;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

#[derive(clap::Args)]
pub struct Args {
    #[command(flatten)]
    graph: GraphArgs,

    /// Root of the exported search trees.
    #[arg(short = 's', long = "from", default_value_t = 1)]
    root: Vertex,

    /// Output directory.
    #[arg(short, long, default_value = "web/public/data")]
    out: PathBuf,

    /// Name of the exported files (default: the graph's file stem).
    #[arg(long)]
    name: Option<String>,
}

#[derive(Serialize)]
struct Meta {
    name: String,
    vertices: usize,
    edges: usize,
    root: Vertex,
    degree: graphman::algo::DegreeStats,
    components: usize,
    largest_component: usize,
    bfs: TreeMeta,
    dfs: TreeMeta,
}

#[derive(Serialize)]
struct TreeMeta {
    file: String,
    max_level: u32,
    reached: usize,
    bytes: usize,
}

pub fn run(args: Args, ui: &Ui) -> Result<()> {
    ui.title("export");
    let graph = args.graph.load(ui)?;
    let name = args.name.clone().unwrap_or_else(|| args.graph.stem());
    std::fs::create_dir_all(&args.out)?;

    let bfs_meta = export_tree(
        &graph,
        args.root,
        0,
        &args.out,
        &format!("{name}.bfs.gmo"),
        ui,
    )?;
    let dfs_meta = export_tree(
        &graph,
        args.root,
        1,
        &args.out,
        &format!("{name}.dfs.gmo"),
        ui,
    )?;
    let (degree, components) = dispatch!(&graph, g => (degree_stats(g), Components::compute(g)));
    let meta = Meta {
        name: name.clone(),
        vertices: graph.vertex_count(),
        edges: graph.edge_count(),
        root: args.root,
        degree,
        components: components.count(),
        largest_component: components.largest_size(),
        bfs: bfs_meta,
        dfs: dfs_meta,
    };
    let path = args.out.join(format!("{name}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&meta)?)?;
    ui.done(&format!("wrote {}", path.display()));
    Ok(())
}

fn export_tree(
    graph: &AnyGraph,
    root: Vertex,
    kind: u32,
    dir: &std::path::Path,
    file: &str,
    ui: &Ui,
) -> Result<TreeMeta> {
    let start = Instant::now();
    let tree = if kind == 0 {
        dispatch!(graph, g => bfs(g, root))
    } else {
        dispatch!(graph, g => dfs(g, root))
    };
    let mut layout = radial_layout(&tree);
    if kind == 1 {
        spiral_angles(&tree, &mut layout.angle);
    }
    let max_level = tree.depth();
    ui.step(&format!(
        "{} tree from {}: {} reached, depth {}, laid out in {}",
        if kind == 0 { "BFS" } else { "DFS" },
        root,
        tree.reached_count(),
        max_level,
        ui::duration(start.elapsed())
    ));

    let path = dir.join(file);
    let mut w = BufWriter::new(
        std::fs::File::create(&path).with_context(|| format!("creating {}", path.display()))?,
    );
    let n = graph.vertex_count();
    w.write_all(b"GMO1")?;
    for value in [n as u32, root, max_level, tree.reached_count() as u32, kind] {
        w.write_all(&value.to_le_bytes())?;
    }
    write_angles(&mut w, &tree, &layout.angle)?;
    for v in 1..=n {
        w.write_all(&tree.levels_raw()[v].to_le_bytes())?;
    }
    for v in 1..=n {
        w.write_all(&tree.parents_raw()[v].to_le_bytes())?;
    }
    w.flush()?;
    let bytes = std::fs::metadata(&path)?.len() as usize;
    ui.done(&format!("wrote {} ({})", path.display(), ui::bytes(bytes)));
    Ok(TreeMeta {
        file: file.to_string(),
        max_level,
        reached: tree.reached_count(),
        bytes,
    })
}

/// A DFS of a random graph is one enormous path with short side branches:
/// wedge allocation gives that path the whole circle and every branch a
/// sliver, which draws as a solid band. Placing vertices by discovery order
/// along a spiral instead keeps the path readable as a path (radius still
/// grows with the level) and hangs the branches off it as short hairs.
fn spiral_angles(tree: &SearchTree, angles: &mut [f32]) {
    const TURNS: f32 = 4.0;
    let reached = tree.reached_count().max(1) as f32;
    for (index, &v) in tree.order().iter().enumerate() {
        angles[v as usize] = (index as f32 / reached) * core::f32::consts::TAU * TURNS;
    }
}

/// Reached vertices keep their layout angle; unreached ones are scattered
/// with the golden angle so the renderer can draw them as an outer halo.
fn write_angles<W: Write>(w: &mut W, tree: &SearchTree, angles: &[f32]) -> Result<()> {
    const GOLDEN_ANGLE: f32 = 2.399_963_2;
    for (v, &angle) in angles.iter().enumerate().skip(1) {
        let angle = if tree.levels_raw()[v] == UNREACHED {
            (v as f32 * GOLDEN_ANGLE) % core::f32::consts::TAU
        } else {
            angle
        };
        w.write_all(&angle.to_le_bytes())?;
    }
    Ok(())
}
