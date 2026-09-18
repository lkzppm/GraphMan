//! WebAssembly bindings of GraphMan for the web observatory.
//!
//! One [`WasmGraph`] per uploaded file: it parses the course format, builds a
//! [`Csr`] and answers everything the observatory asks (searches, distances,
//! components, degree statistics, a diameter, an initial layout). Vertices
//! stay 1-based and every per-vertex array is indexed by vertex with index 0
//! unused, exactly like the library's raw arrays, so the GPU buffers on the
//! other side can be indexed by vertex id directly.
//!
//! Everything here is glue: the algorithms are the library's, unchanged.

#![warn(missing_docs, clippy::all)]

use graphman::algo::{
    self, Components, Control, DegreeStats, DiameterMethod, SearchTree, UNREACHED, bfs_into,
    dfs_into, radial_layout,
};
use graphman::io::write_summary;
use graphman::{Build, Csr, EdgeList, Graph, NO_VERTEX, Vertex};
use std::f64::consts::TAU;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// `performance.now()`: the high-resolution clock of windows and workers.
    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

/// Which traversal to run.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchKind {
    /// Breadth-first search.
    Bfs = 0,
    /// Depth-first search.
    Dfs = 1,
}

/// Which diameter strategy to run (see the library's `DiameterMethod`).
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiameterKind {
    /// One BFS per vertex.
    Exact = 0,
    /// iFUB: exact with far fewer BFS runs in practice.
    IFub = 1,
    /// Takes–Kosters eccentricity bounding.
    Bounds = 2,
    /// 4-sweep lower bound: four BFS runs, not certified.
    Sweep = 3,
}

impl From<DiameterKind> for DiameterMethod {
    fn from(kind: DiameterKind) -> Self {
        match kind {
            DiameterKind::Exact => DiameterMethod::Exact,
            DiameterKind::IFub => DiameterMethod::IFub,
            DiameterKind::Bounds => DiameterMethod::Bounds,
            DiameterKind::Sweep => DiameterMethod::Sweep,
        }
    }
}

/// Min, max, mean and median degree.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct DegreeSummary {
    /// Smallest degree.
    pub min: u32,
    /// Largest degree.
    pub max: u32,
    /// Average degree, `2m / n`.
    pub mean: f64,
    /// Median degree.
    pub median: f64,
}

impl From<DegreeStats> for DegreeSummary {
    fn from(stats: DegreeStats) -> Self {
        Self {
            min: stats.min as u32,
            max: stats.max as u32,
            mean: stats.mean,
            median: stats.median,
        }
    }
}

/// The result of a diameter computation.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct DiameterResult {
    /// The diameter (a lower bound when `isExact` is false).
    pub value: u32,
    /// One endpoint of a longest shortest path.
    pub from: u32,
    /// The other endpoint.
    pub to: u32,
    /// How many BFS runs it took.
    #[wasm_bindgen(js_name = bfsCount)]
    pub bfs_count: u32,
    /// Whether `value` is certified to be the diameter.
    #[wasm_bindgen(js_name = isExact)]
    pub is_exact: bool,
    /// Whether the BFS budget ran out before the method finished.
    pub cancelled: bool,
    /// Milliseconds spent in the algorithm.
    #[wasm_bindgen(js_name = elapsedMs)]
    pub elapsed_ms: f64,
}

/// A BFS or DFS tree: parent and level of every reached vertex.
#[wasm_bindgen]
pub struct SearchResult {
    kind: SearchKind,
    tree: SearchTree,
    elapsed_ms: f64,
}

#[wasm_bindgen]
impl SearchResult {
    /// Which traversal produced this tree.
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> SearchKind {
        self.kind
    }

    /// The start vertex.
    #[wasm_bindgen(getter)]
    pub fn root(&self) -> u32 {
        self.tree.root()
    }

    /// The deepest level reached.
    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> u32 {
        self.tree.depth()
    }

    /// How many vertices the traversal reached (the root included).
    #[wasm_bindgen(getter)]
    pub fn reached(&self) -> u32 {
        self.tree.reached_count() as u32
    }

    /// Milliseconds spent in the traversal itself (no allocation, no copies).
    #[wasm_bindgen(getter, js_name = elapsedMs)]
    pub fn elapsed_ms(&self) -> f64 {
        self.elapsed_ms
    }

    /// Parent of every vertex, indexed by vertex (`0` = none).
    pub fn parents(&self) -> Vec<u32> {
        self.tree.parents_raw().to_vec()
    }

    /// Level of every vertex, indexed by vertex (`0xFFFFFFFF` = unreached).
    pub fn levels(&self) -> Vec<u32> {
        self.tree.levels_raw().to_vec()
    }

    /// Reached vertices in discovery order.
    pub fn order(&self) -> Vec<u32> {
        self.tree.order().to_vec()
    }

    /// Discovery index of every vertex, indexed by vertex (`0xFFFFFFFF` =
    /// unreached). This is what animates a traversal: vertex `v` appears at
    /// frame `ranks[v]`.
    pub fn ranks(&self) -> Vec<u32> {
        let mut ranks = vec![UNREACHED; self.tree.vertex_count() + 1];
        for (rank, &v) in self.tree.order().iter().enumerate() {
            ranks[v as usize] = rank as u32;
        }
        ranks
    }

    /// Number of vertices at each level, `0..=depth`.
    #[wasm_bindgen(js_name = levelSizes)]
    pub fn level_sizes(&self) -> Vec<u32> {
        let mut sizes = vec![0u32; self.tree.depth() as usize + 1];
        for &v in self.tree.order() {
            sizes[self.tree.level(v).expect("ordered vertices are reached") as usize] += 1;
        }
        sizes
    }

    /// Parent of `v`; `undefined` for the root and for unreached vertices.
    pub fn parent(&self, v: u32) -> Option<u32> {
        self.tree.parent(v)
    }

    /// Level of `v`; `undefined` if unreached.
    pub fn level(&self, v: u32) -> Option<u32> {
        self.tree.level(v)
    }

    /// The tree in the assignment's output format: `vertex parent level`
    /// per line, unreached vertices as `- -`.
    #[wasm_bindgen(js_name = toText)]
    pub fn to_text(&self) -> String {
        let mut out = Vec::new();
        self.tree
            .write_to(&mut out)
            .expect("writing to a Vec never fails");
        String::from_utf8(out).expect("the tree is written as ASCII")
    }
}

/// An undirected graph loaded from the course's text format.
#[wasm_bindgen(js_name = Graph)]
pub struct WasmGraph {
    graph: Csr,
    tree: SearchTree,
    components: Option<Components>,
    self_loops_dropped: u32,
    duplicates_dropped: u32,
}

#[wasm_bindgen(js_class = Graph)]
impl WasmGraph {
    /// Parses the text format (`n`, then one `u v` edge per line) and builds
    /// the compressed-sparse-row representation. Throws with the parser's
    /// message (line number included) on malformed input.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<WasmGraph, JsError> {
        let edges = EdgeList::parse(bytes).map_err(|e| JsError::new(&e.to_string()))?;
        let graph = Csr::build(&edges).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self {
            tree: SearchTree::new(graph.vertex_count()),
            graph,
            components: None,
            self_loops_dropped: edges.self_loops_dropped() as u32,
            duplicates_dropped: edges.duplicates_dropped() as u32,
        })
    }

    /// Number of vertices `n`.
    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> u32 {
        self.graph.vertex_count() as u32
    }

    /// Number of unique, loop-free edges `m`.
    #[wasm_bindgen(getter, js_name = edgeCount)]
    pub fn edge_count(&self) -> u32 {
        self.graph.edge_count() as u32
    }

    /// Self-loops discarded by the parser.
    #[wasm_bindgen(getter, js_name = selfLoopsDropped)]
    pub fn self_loops_dropped(&self) -> u32 {
        self.self_loops_dropped
    }

    /// Duplicate edge lines discarded by the parser.
    #[wasm_bindgen(getter, js_name = duplicatesDropped)]
    pub fn duplicates_dropped(&self) -> u32 {
        self.duplicates_dropped
    }

    /// Heap bytes owned by the representation.
    #[wasm_bindgen(getter, js_name = heapBytes)]
    pub fn heap_bytes(&self) -> u32 {
        self.graph.heap_bytes() as u32
    }

    /// Degree of every vertex, indexed by vertex.
    pub fn degrees(&self) -> Vec<u32> {
        let mut degrees = vec![0u32; self.graph.vertex_count() + 1];
        for v in self.graph.vertices() {
            degrees[v as usize] = self.graph.degree(v) as u32;
        }
        degrees
    }

    /// Degree of `v`.
    pub fn degree(&self, v: u32) -> Result<u32, JsError> {
        self.check(v)?;
        Ok(self.graph.degree(v) as u32)
    }

    /// Neighbours of `v`, ascending.
    pub fn neighbors(&self, v: u32) -> Result<Vec<u32>, JsError> {
        self.check(v)?;
        Ok(self.graph.row(v).to_vec())
    }

    /// Every edge once, as a flat `[u, v, u, v, ...]` array with `u < v`.
    pub fn edges(&self) -> Vec<u32> {
        let mut edges = Vec::with_capacity(2 * self.graph.edge_count());
        for v in self.graph.vertices() {
            for &w in self.graph.row(v) {
                if w > v {
                    edges.push(v);
                    edges.push(w);
                }
            }
        }
        edges
    }

    /// The CSR row offsets (`n + 2` entries): `offsets[v]..offsets[v + 1]`
    /// indexes the neighbours of `v` in [`csrTargets`](Self::csr_targets).
    #[wasm_bindgen(js_name = csrOffsets)]
    pub fn csr_offsets(&self) -> Vec<u32> {
        self.graph.offsets().to_vec()
    }

    /// Every neighbour row back to back (`2m` entries).
    #[wasm_bindgen(js_name = csrTargets)]
    pub fn csr_targets(&self) -> Vec<u32> {
        self.graph.targets().to_vec()
    }

    /// Min, max, mean and median degree.
    #[wasm_bindgen(js_name = degreeStats)]
    pub fn degree_stats(&self) -> DegreeSummary {
        algo::degree_stats(&self.graph).into()
    }

    /// Number of connected components.
    #[wasm_bindgen(js_name = componentCount)]
    pub fn component_count(&mut self) -> u32 {
        self.components().count() as u32
    }

    /// Component sizes, largest first.
    #[wasm_bindgen(js_name = componentSizes)]
    pub fn component_sizes(&mut self) -> Vec<u32> {
        self.components().sizes().map(|s| s as u32).collect()
    }

    /// Component id (`1..=count`, largest first) of every vertex, indexed by vertex.
    #[wasm_bindgen(js_name = componentLabels)]
    pub fn component_labels(&mut self) -> Vec<u32> {
        let n = self.graph.vertex_count() as Vertex;
        let components = self.components();
        let mut labels = Vec::with_capacity(n as usize + 1);
        labels.push(0);
        labels.extend((1..=n).map(|v| components.component_of(v)));
        labels
    }

    /// Runs a BFS or DFS from `root` and returns the tree, timed with
    /// `performance.now()` (as coarse as the browser makes it).
    pub fn search(&mut self, kind: SearchKind, root: u32) -> Result<SearchResult, JsError> {
        self.check(root)?;
        let start = now();
        match kind {
            SearchKind::Bfs => bfs_into(&self.graph, root, &mut self.tree, &mut ()),
            SearchKind::Dfs => dfs_into(&self.graph, root, &mut self.tree, &mut ()),
        }
        let elapsed_ms = now() - start;
        Ok(SearchResult {
            kind,
            tree: self.tree.clone(),
            elapsed_ms,
        })
    }

    /// Distance between `a` and `b`; `undefined` when they are in different components.
    pub fn distance(&mut self, a: u32, b: u32) -> Result<Option<u32>, JsError> {
        self.check(a)?;
        self.check(b)?;
        Ok(algo::distance_into(&self.graph, a, b, &mut self.tree))
    }

    /// Diameter with the given method, giving up (and returning the best
    /// lower bound so far, flagged `cancelled`) after `bfsBudget` BFS runs.
    pub fn diameter(&self, kind: DiameterKind, bfs_budget: u32) -> DiameterResult {
        let budget = bfs_budget as usize;
        let progress = move |done: usize| {
            if done >= budget {
                Control::Break
            } else {
                Control::Continue
            }
        };
        let start = now();
        let d = algo::diameter_with_progress(&self.graph, kind.into(), &progress);
        DiameterResult {
            value: d.value,
            from: d.endpoints.0,
            to: d.endpoints.1,
            bfs_count: d.bfs_count as u32,
            is_exact: d.is_exact,
            cancelled: d.cancelled,
            elapsed_ms: now() - start,
        }
    }

    /// The assignment's summary file: counts, degree statistics and components.
    pub fn summary(&mut self) -> String {
        let degrees = algo::degree_stats(&self.graph);
        let components = self.components().clone();
        let mut out = Vec::new();
        write_summary(&mut out, &self.graph, &degrees, &components)
            .expect("writing to a Vec never fails");
        String::from_utf8(out).expect("the summary is written as ASCII")
    }

    /// A starting position for every vertex, as a flat `[x, y, x, y, ...]`
    /// array indexed by vertex (index 0 unused), in world units where an
    /// edge is roughly [`EDGE_LENGTH`] long.
    ///
    /// Each component is laid out radially from its smallest vertex with the
    /// library's [`radial_layout`]: BFS levels become rings whose area is
    /// proportional to the number of vertices on them, so density is uniform.
    /// Components are packed largest-first, the largest in the middle and the
    /// rest on concentric rings around it. `O(n + m)`; graphs too large to
    /// simulate keep this layout as their final one.
    #[wasm_bindgen(js_name = initialLayout)]
    pub fn initial_layout(&mut self) -> Vec<f32> {
        let n = self.graph.vertex_count();
        let mut positions = vec![0f32; 2 * (n + 1)];
        let components = self.components().clone();

        // Disc radius of a component: area proportional to its size.
        let disc_radius = |size: usize| EDGE_LENGTH * (size as f64 / 2.0).sqrt() + EDGE_LENGTH;

        // Pack the discs largest-first: the first at the origin, the rest on
        // concentric rings, each ring filled before the next one starts.
        // Sizes are descending, so the first disc of a ring is its thickest.
        let gap = EDGE_LENGTH;
        let mut ring = 0.0f64; // centre line of the current ring
        let mut outer = 0.0f64; // outer edge of everything placed, plus the gap
        let mut angle = 0.0f64;
        for (index, members) in components.iter().enumerate() {
            let radius = disc_radius(members.len());
            let (cx, cy) = if index == 0 {
                outer = radius + gap;
                (0.0, 0.0)
            } else {
                let width = |ring: f64| 2.2 * (radius / ring).min(1.0).asin();
                if ring == 0.0 || angle + width(ring) > TAU {
                    ring = outer + radius;
                    outer = ring + radius + gap;
                    angle = 0.0;
                }
                let a = angle + width(ring) / 2.0;
                angle += width(ring);
                (ring * a.cos(), ring * a.sin())
            };

            let root = members[0];
            bfs_into(&self.graph, root, &mut self.tree, &mut ());
            let layout = radial_layout(&self.tree);

            // `before[l]` counts the vertices on levels below `l`. A vertex on
            // level `l` sits at the radius where the fraction of the component
            // inside it equals the fraction discovered up to the middle of its
            // level, so each ring's area matches the number of vertices on it.
            let depth = self.tree.depth() as usize;
            let mut before = vec![0f64; depth + 2];
            for &v in self.tree.order() {
                before[self.tree.level(v).expect("reached") as usize + 1] += 1.0;
            }
            for l in 1..before.len() {
                before[l] += before[l - 1];
            }
            let total = members.len() as f64;
            let spread = radius - EDGE_LENGTH;
            for &v in self.tree.order() {
                let l = self.tree.level(v).expect("reached") as usize;
                let fraction = (before[l] + (before[l + 1] - before[l]) / 2.0) / total;
                let r = if l == 0 {
                    0.0
                } else {
                    spread * fraction.sqrt()
                };
                let a = layout.angle[v as usize] as f64;
                positions[2 * v as usize] = (cx + r * a.cos()) as f32;
                positions[2 * v as usize + 1] = (cy + r * a.sin()) as f32;
            }
        }
        self.tree.reset();
        positions
    }

    fn components(&mut self) -> &Components {
        if self.components.is_none() {
            self.components = Some(Components::compute(&self.graph));
        }
        self.components.as_ref().expect("just computed")
    }

    fn check(&self, v: u32) -> Result<(), JsError> {
        if v == NO_VERTEX || v as usize > self.graph.vertex_count() {
            return Err(JsError::new(&format!(
                "vertex {v} is outside 1..={}",
                self.graph.vertex_count()
            )));
        }
        Ok(())
    }
}

/// Target edge length of the initial layout, in world units. The GPU
/// simulation on the web side uses the same constant as its rest length.
pub const EDGE_LENGTH: f64 = 24.0;

/// The rest length the web renderer should use, exposed for the JS side.
#[wasm_bindgen(js_name = edgeLength)]
pub fn edge_length() -> f64 {
    EDGE_LENGTH
}
