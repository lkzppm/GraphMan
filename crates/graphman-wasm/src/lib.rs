//! WebAssembly bindings of GraphMan for the web observatory.
//!
//! One [`WasmGraph`] per uploaded file: it parses the course format once,
//! builds the representation the visitor picked and answers everything the
//! observatory asks (searches, distances,
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
use graphman::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, BuildError, Csr, EdgeList, Graph,
    MemoryBudget, NO_VERTEX, Representation, Vertex, dispatch,
};
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

/// How [`WasmGraph::layout`] arranges the vertices.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutKind {
    /// BFS levels from the root as evenly spaced rings, subtrees in wedges;
    /// the other components packed around.
    Radial = 0,
    /// BFS levels from the root as rows, level 0 on top, subtrees kept
    /// together; the other components packed around.
    Layered = 1,
    /// Every vertex on one circle, sorted by degree (highest first).
    Degree = 2,
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

/// Which storage strategy backs the graph (the library's `Representation`).
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepresentationKind {
    /// One neighbour vector per vertex.
    List = 0,
    /// A packed `n x n` bitset.
    Matrix = 1,
    /// Compressed sparse row: two contiguous arrays.
    Csr = 2,
}

impl From<RepresentationKind> for Representation {
    fn from(kind: RepresentationKind) -> Self {
        match kind {
            RepresentationKind::List => Representation::AdjacencyList,
            RepresentationKind::Matrix => Representation::AdjacencyMatrix,
            RepresentationKind::Csr => Representation::Csr,
        }
    }
}

impl From<Representation> for RepresentationKind {
    fn from(representation: Representation) -> Self {
        match representation {
            Representation::AdjacencyList => RepresentationKind::List,
            Representation::AdjacencyMatrix => RepresentationKind::Matrix,
            Representation::Csr => RepresentationKind::Csr,
        }
    }
}

/// How many bytes one representation may claim inside the tab.
///
/// wasm32 addresses 4 GiB in total, and the edge list, the GPU buffers and
/// the browser itself live in there too. Past this cap a build is a typed
/// error and a number in the memory panel, never a killed tab.
pub const BUDGET_BYTES: usize = 1 << 30;

/// Builds one representation of `edges` within [`BUDGET_BYTES`].
///
/// The library's `BuildError` is kept until the boundary: `JsError` only
/// exists on wasm, so the budget stays testable on the host.
fn build(edges: &EdgeList, representation: Representation) -> Result<AnyGraph, BuildError> {
    representation.build_within(edges, MemoryBudget::Bytes(BUDGET_BYTES))
}

/// A one-vertex graph with no edges, which owns a few bytes at most.
///
/// Switching strategy parks the graph here for the length of one build, so
/// the tab never holds two representations of the same graph at once.
fn empty_graph() -> AnyGraph {
    let edges = EdgeList::parse(b"1\n").expect("one vertex and no edges parses");
    AnyGraph::Csr(Csr::build_unchecked(&edges).expect("three offsets always allocate"))
}

/// What each representation of the loaded graph costs, in bytes.
///
/// The three figures come from the library's `Build::required_bytes`, so they
/// are known before anything is allocated: that is what turns the 17.6 GB
/// adjacency matrix of a large graph into a number on screen.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct MemoryReport {
    /// Bytes an adjacency list would need.
    pub list: f64,
    /// Bytes an adjacency matrix would need.
    pub matrix: f64,
    /// Bytes a CSR would need.
    pub csr: f64,
    /// The cap a representation may not cross, [`BUDGET_BYTES`].
    pub budget: f64,
}

impl MemoryReport {
    /// What a graph of this size costs in each representation.
    fn of(edges: &EdgeList) -> Self {
        let (n, m) = (edges.vertex_count(), edges.edge_count());
        Self {
            list: AdjacencyList::required_bytes(n, m) as f64,
            matrix: AdjacencyMatrix::required_bytes(n, m) as f64,
            csr: Csr::required_bytes(n, m) as f64,
            budget: BUDGET_BYTES as f64,
        }
    }
}

/// A parsed, normalised edge list that has not picked a representation yet.
///
/// The observatory parses first and builds second, so it can show what each
/// storage strategy would cost for the file in hand before one byte of it is
/// allocated. [`build`](Self::build) hands the edges over to the graph.
#[wasm_bindgen(js_name = Parsed)]
pub struct WasmEdges {
    edges: EdgeList,
}

#[wasm_bindgen(js_class = Parsed)]
impl WasmEdges {
    /// Parses the text format (`n`, then one `u v` edge per line), dropping
    /// self-loops and duplicates. Throws with the parser's message (line
    /// number included) on malformed input.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<WasmEdges, JsError> {
        let edges = EdgeList::parse(bytes).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self { edges })
    }

    /// Number of vertices `n`.
    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> u32 {
        self.edges.vertex_count() as u32
    }

    /// Number of unique, loop-free edges `m`.
    #[wasm_bindgen(getter, js_name = edgeCount)]
    pub fn edge_count(&self) -> u32 {
        self.edges.edge_count() as u32
    }

    /// What every representation of this graph would cost, and the cap.
    #[wasm_bindgen(js_name = memoryReport)]
    pub fn memory_report(&self) -> MemoryReport {
        MemoryReport::of(&self.edges)
    }

    /// Builds `representation` and moves the edges into the graph, which
    /// keeps them so the strategy can be changed later without parsing again.
    pub fn build(self, representation: RepresentationKind) -> Result<WasmGraph, JsError> {
        WasmGraph::of(self.edges, representation)
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
///
/// The normalised [`EdgeList`] is kept next to the representation so the
/// visitor can change storage strategy without uploading the file again:
/// [`rebuild`](Self::rebuild) drops the old representation and builds another
/// from the same parsed edges, which is what the CLI does between two
/// `--repr` runs.
#[wasm_bindgen(js_name = Graph)]
pub struct WasmGraph {
    edges: EdgeList,
    graph: AnyGraph,
    tree: SearchTree,
    components: Option<Components>,
}

#[wasm_bindgen(js_class = Graph)]
impl WasmGraph {
    /// Parses the text format (`n`, then one `u v` edge per line) and builds
    /// `representation`. Throws with the parser's message (line number
    /// included) on malformed input, and with the library's build error when
    /// the representation does not fit [`BUDGET_BYTES`].
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], representation: RepresentationKind) -> Result<WasmGraph, JsError> {
        WasmEdges::new(bytes)?.build(representation)
    }

    /// Builds `representation` over edges that are already parsed.
    fn of(edges: EdgeList, representation: RepresentationKind) -> Result<WasmGraph, JsError> {
        let graph =
            build(&edges, representation.into()).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self {
            tree: SearchTree::new(graph.vertex_count()),
            edges,
            graph,
            components: None,
        })
    }

    /// Builds `representation` from the edges already parsed and drops the
    /// old one. Everything derived from the graph (the search tree, the cached
    /// components) is invalidated, the graph itself is not: every search and
    /// layout gives the same answer afterwards, at a different cost.
    pub fn rebuild(&mut self, representation: RepresentationKind) -> Result<(), JsError> {
        let previous = self.graph.representation();
        if previous == representation.into() {
            return Ok(());
        }
        // The old representation is dropped before the new one is allocated:
        // one graph is loaded at a time, which is what the budget is about.
        self.components = None;
        self.tree = SearchTree::new(0);
        self.graph = empty_graph();
        match build(&self.edges, representation.into()) {
            Ok(graph) => {
                self.tree = SearchTree::new(graph.vertex_count());
                self.graph = graph;
                Ok(())
            }
            Err(error) => {
                // The budget is checked before anything is claimed, so the
                // strategy that fitted a moment ago still fits.
                self.graph = build(&self.edges, previous)
                    .expect("the previous representation fitted a moment ago");
                self.tree = SearchTree::new(self.graph.vertex_count());
                Err(JsError::new(&error.to_string()))
            }
        }
    }

    /// The representation in use.
    #[wasm_bindgen(getter)]
    pub fn representation(&self) -> RepresentationKind {
        self.graph.representation().into()
    }

    /// What every representation of this graph would cost, and the cap.
    #[wasm_bindgen(js_name = memoryReport)]
    pub fn memory_report(&self) -> MemoryReport {
        MemoryReport::of(&self.edges)
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
        self.edges.self_loops_dropped() as u32
    }

    /// Duplicate edge lines discarded by the parser.
    #[wasm_bindgen(getter, js_name = duplicatesDropped)]
    pub fn duplicates_dropped(&self) -> u32 {
        self.edges.duplicates_dropped() as u32
    }

    /// Heap bytes owned by the representation.
    #[wasm_bindgen(getter, js_name = heapBytes)]
    pub fn heap_bytes(&self) -> u32 {
        self.graph.heap_bytes() as u32
    }

    /// Degree of every vertex, indexed by vertex.
    pub fn degrees(&self) -> Vec<u32> {
        let n = self.graph.vertex_count();
        let mut degrees = vec![0u32; n + 1];
        for v in 1..=n as Vertex {
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
        Ok(dispatch!(&self.graph, g => g.neighbors(v).collect()))
    }

    /// Every edge once, as a flat `[u, v, u, v, ...]` array with `u < v`.
    pub fn edges(&self) -> Vec<u32> {
        dispatch!(&self.graph, g => {
            let mut edges = Vec::with_capacity(2 * g.edge_count());
            for v in g.vertices() {
                for w in g.neighbors(v).filter(|&w| w > v) {
                    edges.push(v);
                    edges.push(w);
                }
            }
            edges
        })
    }

    /// Row offsets of the neighbour rows (`n + 2` entries, index 0 unused):
    /// `offsets[v]..offsets[v + 1]` indexes the neighbours of `v` in
    /// [`adjacencyTargets`](Self::adjacency_targets). Read off the degrees, so
    /// the GPU gets the same buffers whichever representation is in use.
    #[wasm_bindgen(js_name = adjacencyOffsets)]
    pub fn adjacency_offsets(&self) -> Vec<u32> {
        let n = self.graph.vertex_count();
        let mut offsets = Vec::with_capacity(n + 2);
        offsets.push(0);
        offsets.push(0);
        for v in 1..=n as Vertex {
            let last = *offsets.last().expect("offsets is never empty");
            offsets.push(last + self.graph.degree(v) as u32);
        }
        offsets
    }

    /// Every neighbour row back to back (`2m` entries), ascending within a row.
    #[wasm_bindgen(js_name = adjacencyTargets)]
    pub fn adjacency_targets(&self) -> Vec<u32> {
        dispatch!(&self.graph, g => {
            let mut targets = Vec::with_capacity(2 * g.edge_count());
            for v in g.vertices() {
                targets.extend(g.neighbors(v));
            }
            targets
        })
    }

    /// Min, max, mean and median degree.
    #[wasm_bindgen(js_name = degreeStats)]
    pub fn degree_stats(&self) -> DegreeSummary {
        dispatch!(&self.graph, g => algo::degree_stats(g)).into()
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
        dispatch!(&self.graph, g => match kind {
            SearchKind::Bfs => bfs_into(g, root, &mut self.tree, &mut ()),
            SearchKind::Dfs => dfs_into(g, root, &mut self.tree, &mut ()),
        });
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
        Ok(dispatch!(&self.graph, g => algo::distance_into(g, a, b, &mut self.tree)))
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
        let d =
            dispatch!(&self.graph, g => algo::diameter_with_progress(g, kind.into(), &progress));
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
        let components = self.components().clone();
        let mut out = Vec::new();
        dispatch!(&self.graph, g => {
            let degrees = algo::degree_stats(g);
            write_summary(&mut out, g, &degrees, &components)
        })
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
        let components = self.components().clone();
        let positions =
            dispatch!(&self.graph, g => initial_layout_of(g, &mut self.tree, &components));
        self.tree.reset();
        positions
    }

    /// Positions for every vertex (same shape as [`initialLayout`](Self::initial_layout))
    /// arranged by `kind`. Every component gets the layout: the level ones
    /// start at `root` in its component and at the smallest vertex in the
    /// others. Radial components are packed as discs, the root's at the
    /// origin; layered components stand side by side, level 0 on one line.
    /// `O(n + m)`.
    pub fn layout(&mut self, kind: LayoutKind, root: u32) -> Result<Vec<f32>, JsError> {
        self.check(root)?;
        let components = self.components().clone();
        let positions =
            dispatch!(&self.graph, g => layout_of(g, &mut self.tree, &components, kind, root));
        self.tree.reset();
        Ok(positions)
    }

    fn components(&mut self) -> &Components {
        if self.components.is_none() {
            self.components = Some(dispatch!(&self.graph, g => Components::compute(g)));
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

/// A starting position for every vertex; see [`WasmGraph::initial_layout`].
///
/// Generic over the representation, so the compiler specialises the whole
/// layout for whichever storage strategy the visitor picked.
fn initial_layout_of<G: Graph>(
    graph: &G,
    tree: &mut SearchTree,
    components: &Components,
) -> Vec<f32> {
    let n = graph.vertex_count();
    let mut positions = vec![0f32; 2 * (n + 1)];
    let radii: Vec<f64> = components.sizes().map(disc_radius).collect();
    let centres = pack_discs(&radii, 0);
    for (index, members) in components.iter().enumerate() {
        let (cx, cy) = centres[index];
        disc_layout(graph, tree, members, cx, cy, radii[index], &mut positions);
    }
    positions
}

/// Positions arranged by `kind`; see [`WasmGraph::layout`].
fn layout_of<G: Graph>(
    graph: &G,
    tree: &mut SearchTree,
    components: &Components,
    kind: LayoutKind,
    root: Vertex,
) -> Vec<f32> {
    let n = graph.vertex_count();
    let mut positions = vec![0f32; 2 * (n + 1)];

    if kind == LayoutKind::Degree {
        let mut order: Vec<Vertex> = graph.vertices().collect();
        order.sort_by_key(|&v| core::cmp::Reverse(graph.degree(v)));
        let radius = (n as f64 * SPACING / TAU).max(EDGE_LENGTH);
        for (i, &v) in order.iter().enumerate() {
            let a = TAU * i as f64 / n as f64;
            positions[2 * v as usize] = (radius * a.cos()) as f32;
            positions[2 * v as usize + 1] = (radius * a.sin()) as f32;
        }
        return positions;
    }

    // Each component around its own origin first: the root's, then the
    // rest largest first. `extent` is a disc radius (radial) or a block
    // width (layered); layered rows are shared so levels line up.
    let home = (components.component_of(root) - 1) as usize;
    let order: Vec<usize> = core::iter::once(home)
        .chain((0..components.count()).filter(|&c| c != home))
        .collect();
    let mut extent = vec![0f64; components.count()];
    let mut depths = vec![0usize; components.count()];
    for &c in &order {
        let members = components.members(c as u32 + 1);
        let start = if c == home { root } else { members[0] };
        bfs_into(graph, start, tree, &mut ());
        let layout = radial_layout(tree);
        let depth = tree.depth() as usize;
        let mut counts = vec![0f64; depth + 1];
        for &v in tree.order() {
            counts[tree.level(v).expect("reached") as usize] += 1.0;
        }
        depths[c] = depth;
        match kind {
            LayoutKind::Radial => {
                // Rings far enough apart that the fullest one has room.
                let gap = counts
                    .iter()
                    .enumerate()
                    .skip(1)
                    .map(|(l, &count)| count * SPACING / (TAU * l as f64))
                    .fold(2.0 * EDGE_LENGTH, f64::max);
                for &v in tree.order() {
                    let l = tree.level(v).expect("reached") as f64;
                    let a = layout.angle[v as usize] as f64;
                    positions[2 * v as usize] = (l * gap * a.cos()) as f32;
                    positions[2 * v as usize + 1] = (l * gap * a.sin()) as f32;
                }
                extent[c] = depth as f64 * gap + EDGE_LENGTH;
            }
            LayoutKind::Layered => {
                // Rows as wide as the fullest level; a vertex's x comes
                // from its wedge angle, so every subtree is a contiguous
                // block. y is the level for now, scaled by `row` below.
                let width = counts
                    .iter()
                    .fold(4.0 * EDGE_LENGTH, |w, &count| w.max(count * SPACING));
                for &v in tree.order() {
                    let l = tree.level(v).expect("reached") as f32;
                    let t = layout.angle[v as usize] as f64 / TAU;
                    positions[2 * v as usize] = ((t - 0.5) * width) as f32;
                    positions[2 * v as usize + 1] = l;
                }
                extent[c] = width;
            }
            LayoutKind::Degree => unreachable!("handled above"),
        }
    }

    // Then move each component to its place.
    match kind {
        LayoutKind::Radial => {
            let centres = pack_discs(&extent, home);
            for (c, members) in components.iter().enumerate() {
                let (cx, cy) = centres[c];
                for &v in members {
                    positions[2 * v as usize] += cx as f32;
                    positions[2 * v as usize + 1] += cy as f32;
                }
            }
        }
        LayoutKind::Layered => {
            // Side by side in `order`, level 0 on one line, centred as a
            // whole. One row height for every component, so levels line
            // up, chosen so the whole picture is about 2.5:1.
            let gap = 4.0 * EDGE_LENGTH;
            let total: f64 = extent.iter().sum::<f64>() + gap * (extent.len() - 1) as f64;
            let deepest = depths.iter().copied().max().unwrap_or(0);
            let row = (total / (2.5 * deepest.max(1) as f64)).max(2.0 * EDGE_LENGTH);
            let height = deepest as f64 * row;
            let mut x = -total / 2.0;
            for &c in &order {
                let cx = x + extent[c] / 2.0;
                x += extent[c] + gap;
                for &v in components.members(c as u32 + 1) {
                    positions[2 * v as usize] += cx as f32;
                    let l = positions[2 * v as usize + 1] as f64;
                    positions[2 * v as usize + 1] = (l * row - height / 2.0) as f32;
                }
            }
        }
        LayoutKind::Degree => unreachable!("handled above"),
    }
    positions
}

/// Lays one component out radially from its smallest vertex inside the disc
/// at `(cx, cy)`: BFS levels become rings whose area is proportional to the
/// number of vertices on them, so density is uniform.
fn disc_layout<G: Graph>(
    graph: &G,
    tree: &mut SearchTree,
    members: &[Vertex],
    cx: f64,
    cy: f64,
    radius: f64,
    positions: &mut [f32],
) {
    bfs_into(graph, members[0], tree, &mut ());
    let layout = radial_layout(tree);

    // `before[l]` counts the vertices on levels below `l`. A vertex on
    // level `l` sits at the radius where the fraction of the component
    // inside it equals the fraction discovered up to the middle of its
    // level, so each ring's area matches the number of vertices on it.
    let depth = tree.depth() as usize;
    let mut before = vec![0f64; depth + 2];
    for &v in tree.order() {
        before[tree.level(v).expect("reached") as usize + 1] += 1.0;
    }
    for l in 1..before.len() {
        before[l] += before[l - 1];
    }
    let total = members.len() as f64;
    let spread = radius - EDGE_LENGTH;
    for &v in tree.order() {
        let l = tree.level(v).expect("reached") as usize;
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

/// Target edge length of the initial layout, in world units. The GPU
/// simulation on the web side uses the same constant as its rest length.
pub const EDGE_LENGTH: f64 = 24.0;

/// Room given to each vertex along a ring or a row in the level layouts.
const SPACING: f64 = EDGE_LENGTH / 2.0;

/// Disc radius of a component: area proportional to its size.
fn disc_radius(size: usize) -> f64 {
    EDGE_LENGTH * (size as f64 / 2.0).sqrt() + EDGE_LENGTH
}

/// Packs discs of the given radii (in size order, largest first): `first`
/// at the origin, the rest on concentric rings around it, each ring filled
/// before the next one starts. Returns the centre of each disc.
fn pack_discs(radii: &[f64], first: usize) -> Vec<(f64, f64)> {
    let gap = EDGE_LENGTH;
    let mut centres = vec![(0.0, 0.0); radii.len()];
    let mut ring = 0.0f64; // centre line of the current ring
    let mut outer = radii.get(first).copied().unwrap_or(0.0) + gap; // outer edge placed, plus the gap
    let mut angle = 0.0f64;
    for (index, &radius) in radii.iter().enumerate() {
        if index == first {
            continue;
        }
        let width = |ring: f64| 2.2 * (radius / ring).min(1.0).asin();
        if ring == 0.0 || angle + width(ring) > TAU {
            ring = outer + radius;
            outer = ring + radius + gap;
            angle = 0.0;
        }
        let a = angle + width(ring) / 2.0;
        angle += width(ring);
        centres[index] = (ring * a.cos(), ring * a.sin());
    }
    centres
}

/// The rest length the web renderer should use, exposed for the JS side.
#[wasm_bindgen(js_name = edgeLength)]
pub fn edge_length() -> f64 {
    EDGE_LENGTH
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A triangle, a duplicate edge line, a self-loop and an isolated vertex.
    const SAMPLE: &[u8] = b"4\n1 2\n2 3\n3 1\n1 3\n3 3\n";

    fn graph(kind: RepresentationKind) -> WasmGraph {
        WasmGraph::new(SAMPLE, kind).expect("the sample parses and fits the budget")
    }

    #[test]
    fn every_representation_answers_the_same() {
        let csr = graph(RepresentationKind::Csr);
        for kind in [RepresentationKind::List, RepresentationKind::Matrix] {
            let other = graph(kind);
            assert_eq!(other.representation(), kind);
            assert_eq!(other.vertex_count(), csr.vertex_count());
            assert_eq!(other.edge_count(), csr.edge_count());
            assert_eq!(other.degrees(), csr.degrees());
            assert_eq!(other.edges(), csr.edges());
            assert_eq!(other.adjacency_offsets(), csr.adjacency_offsets());
            assert_eq!(other.adjacency_targets(), csr.adjacency_targets());
        }
    }

    #[test]
    fn the_parser_normalises_once_for_every_representation() {
        let g = graph(RepresentationKind::List);
        assert_eq!((g.vertex_count(), g.edge_count()), (4, 3));
        assert_eq!(g.self_loops_dropped(), 1);
        assert_eq!(g.duplicates_dropped(), 1);
    }

    #[test]
    fn rebuilding_changes_the_cost_and_nothing_else() {
        let mut g = graph(RepresentationKind::Csr);
        let (edges, degrees) = (g.edges(), g.degrees());
        g.rebuild(RepresentationKind::Matrix)
            .expect("four vertices fit anywhere");
        assert_eq!(g.representation(), RepresentationKind::Matrix);
        assert_eq!(g.edges(), edges);
        g.rebuild(RepresentationKind::Matrix)
            .expect("already there");
        assert_eq!(g.representation(), RepresentationKind::Matrix);
        assert_eq!(g.degrees(), degrees);
        assert_eq!(g.self_loops_dropped(), 1);
    }

    #[test]
    fn a_matrix_over_the_budget_is_an_error_not_a_dead_tab() {
        // 200 000 vertices need 5 GB of bits, well past the tab's budget;
        // the sparse representations of the same graph are a few megabytes.
        let edges = EdgeList::parse(b"200000\n1 2\n").expect("parses");
        assert!(build(&edges, Representation::AdjacencyMatrix).is_err());
        assert!(build(&edges, Representation::AdjacencyList).is_ok());
        assert!(build(&edges, Representation::Csr).is_ok());
    }

    #[test]
    fn the_memory_report_ranks_the_representations() {
        let g = graph(RepresentationKind::Csr);
        let report = g.memory_report();
        assert!(report.csr < report.list);
        assert!(g.heap_bytes() > 0);
        assert_eq!(report.budget, BUDGET_BYTES as f64);
    }
}
