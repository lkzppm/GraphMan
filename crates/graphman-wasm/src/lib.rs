//! WebAssembly bindings of GraphMan for the web observatory.
//!
//! One [`WasmGraph`] per uploaded file: it parses the course format once
//! (with or without a weight column), builds the representation the visitor
//! picked and answers everything the observatory asks (searches, Dijkstra,
//! distances, components, degree and weight statistics, a diameter, an
//! initial layout, vertex names). Vertices
//! stay 1-based and every per-vertex array is indexed by vertex with index 0
//! unused, exactly like the library's raw arrays, so the GPU buffers on the
//! other side can be indexed by vertex id directly.
//!
//! Everything here is glue: the algorithms are the library's, unchanged.

#![warn(missing_docs, clippy::all)]

use graphman::algo::{
    self, Components, Control, DegreeStats, DiameterMethod, Frontier, FrontierEntry, FrontierKind,
    HeapFrontier, LazyHeapFrontier, PairingHeapFrontier, QuadHeapFrontier, RadialLayout,
    RadixHeapFrontier, SearchTree, ShortestPathTree, UNREACHED, VectorFrontier, Visitor,
    WeightStats, bfs_into, dfs_into, dfs_recursive_into, dijkstra_into, tree_layout,
};
use graphman::io::write_summary;
use graphman::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, BuildError, Csr, EdgeList, Graph,
    MemoryBudget, NO_VERTEX, Representation, Vertex, VertexNames, Weighted, dispatch,
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
    /// Every vertex on one circle, sorted by degree (highest first).
    Degree = 1,
}

/// Which way [`WasmGraph::layered`] and [`WasmGraph::layered_tree`] grow.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerDirection {
    /// Levels as rows, the root on top.
    Vertical = 0,
    /// Levels as columns, the root on the left.
    Horizontal = 1,
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

/// How deep the recursive DFS may nest in the browser: one call per tree
/// level, on a call stack of about a megabyte. V8 (Chrome, Node) runs out
/// between 5,150 levels (matrix) and 6,175 (list, CSR); half of the lower
/// one leaves room for the JavaScript already on the stack. Past it the
/// search refuses rather than trap the instance, and the iterative DFS
/// answers instead.
pub const DFS_RECURSION_LIMIT: u32 = 2_500;

/// The deepest tree [`WasmGraph::dfs_recursive`] accepts.
#[wasm_bindgen(js_name = dfsRecursionLimit)]
pub fn dfs_recursion_limit() -> u32 {
    DFS_RECURSION_LIMIT
}

/// How Dijkstra keeps its distance estimates (the library's `FrontierKind`).
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontierType {
    /// A vector of estimates scanned for the minimum: `O(n²)`.
    Vector = 0,
    /// An indexed binary heap with decrease-key: `O((n + m) log n)`.
    Heap = 1,
    /// A binary heap without decrease-key (stale entries skipped).
    LazyHeap = 2,
    /// An indexed 4-ary heap with decrease-key.
    QuadHeap = 3,
    /// A pairing heap with decrease-key.
    Pairing = 4,
    /// A monotone radix heap on the distances' bits (stale entries skipped).
    Radix = 5,
}

impl From<FrontierType> for FrontierKind {
    fn from(kind: FrontierType) -> Self {
        match kind {
            FrontierType::Vector => FrontierKind::Vector,
            FrontierType::Heap => FrontierKind::Heap,
            FrontierType::LazyHeap => FrontierKind::LazyHeap,
            FrontierType::QuadHeap => FrontierKind::QuadHeap,
            FrontierType::Pairing => FrontierKind::Pairing,
            FrontierType::Radix => FrontierKind::Radix,
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
        let (n, m, w) = (
            edges.vertex_count(),
            edges.edge_count(),
            edges.is_weighted(),
        );
        Self {
            list: AdjacencyList::required_bytes(n, m, w) as f64,
            matrix: AdjacencyMatrix::required_bytes(n, m, w) as f64,
            csr: Csr::required_bytes(n, m, w) as f64,
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
    /// Parses the text format (`n`, then one `u v` or `u v weight` edge per
    /// line), dropping self-loops and duplicates. Throws with the parser's
    /// message (line number included) on malformed input.
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

    /// Whether the file had a weight column.
    #[wasm_bindgen(getter)]
    pub fn weighted(&self) -> bool {
        self.edges.is_weighted()
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

/// Min, max and mean weight and the number of negative edges.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct WeightSummary {
    /// Smallest weight.
    pub min: f64,
    /// Largest weight.
    pub max: f64,
    /// Average weight.
    pub mean: f64,
    /// Edges with a negative weight (Dijkstra refuses the graph if any).
    pub negative: u32,
}

impl From<WeightStats> for WeightSummary {
    fn from(stats: WeightStats) -> Self {
        Self {
            min: stats.min,
            max: stats.max,
            mean: stats.mean,
            negative: stats.negative as u32,
        }
    }
}

/// An edge with a negative weight: why Dijkstra refuses a graph.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct NegativeEdge {
    /// The smaller endpoint.
    pub u: u32,
    /// The larger endpoint.
    pub v: u32,
    /// Its (negative) weight.
    pub weight: f64,
}

/// A Dijkstra run: distance and parent of every settled vertex, and the
/// settle order (which animates it the way discovery ranks animate a BFS).
#[wasm_bindgen]
pub struct ShortestPathResult {
    frontier: FrontierType,
    tree: ShortestPathTree,
    elapsed_ms: f64,
}

#[wasm_bindgen]
impl ShortestPathResult {
    /// Which frontier ran.
    #[wasm_bindgen(getter)]
    pub fn frontier(&self) -> FrontierType {
        self.frontier
    }

    /// The source vertex.
    #[wasm_bindgen(getter)]
    pub fn root(&self) -> u32 {
        self.tree.root()
    }

    /// How many vertices were settled (the root included).
    #[wasm_bindgen(getter)]
    pub fn reached(&self) -> u32 {
        self.tree.reached_count() as u32
    }

    /// The last settled vertex, the farthest from the root.
    #[wasm_bindgen(getter)]
    pub fn farthest(&self) -> u32 {
        self.tree.last_settled().0
    }

    /// Distance to [`farthest`](Self::farthest): the root's weighted eccentricity.
    #[wasm_bindgen(getter)]
    pub fn eccentricity(&self) -> f64 {
        self.tree.last_settled().1
    }

    /// Milliseconds spent in the algorithm itself.
    #[wasm_bindgen(getter, js_name = elapsedMs)]
    pub fn elapsed_ms(&self) -> f64 {
        self.elapsed_ms
    }

    /// Parent of every vertex, indexed by vertex (`0` = none).
    pub fn parents(&self) -> Vec<u32> {
        self.tree.parents_raw().to_vec()
    }

    /// Distance of every vertex, indexed by vertex (`Infinity` = unreached).
    pub fn distances(&self) -> Vec<f64> {
        self.tree.distances_raw().to_vec()
    }

    /// Settled vertices in settle order (non-decreasing distance).
    pub fn order(&self) -> Vec<u32> {
        self.tree.order().to_vec()
    }

    /// Settle index of every vertex, indexed by vertex (`0xFFFFFFFF` = unreached).
    pub fn ranks(&self) -> Vec<u32> {
        let mut ranks = vec![UNREACHED; self.tree.vertex_count() + 1];
        for (rank, &v) in self.tree.order().iter().enumerate() {
            ranks[v as usize] = rank as u32;
        }
        ranks
    }

    /// Distance to `v`; `undefined` if unreached.
    pub fn distance(&self, v: u32) -> Option<f64> {
        self.tree.distance(v)
    }

    /// Parent of `v`; `undefined` for the root and for unreached vertices.
    pub fn parent(&self, v: u32) -> Option<u32> {
        self.tree.parent(v)
    }

    /// The shortest path from the root to `v`, both included; empty if unreached.
    #[wasm_bindgen(js_name = pathTo)]
    pub fn path_to(&self, v: u32) -> Vec<u32> {
        self.tree.path_to(v).unwrap_or_default()
    }

    /// The tree as `vertex parent distance` per line, unreached as `- -`.
    #[wasm_bindgen(js_name = toText)]
    pub fn to_text(&self) -> String {
        let mut out = Vec::new();
        self.tree
            .write_to(&mut out)
            .expect("writing to a Vec never fails");
        String::from_utf8(out).expect("the tree is written as ASCII")
    }
}

/// Dijkstra's frontier as it stood right after one settle and the
/// relaxations it made: what the observatory's structure strip draws.
#[wasm_bindgen]
pub struct FrontierSnapshot {
    vertices: Vec<u32>,
    estimates: Vec<f64>,
    stale: Vec<u8>,
    parents: Vec<i32>,
    buckets: Vec<u8>,
    total: u32,
    relaxed: Vec<u32>,
    previous: Vec<f64>,
    lowered: Vec<f64>,
}

#[wasm_bindgen]
impl FrontierSnapshot {
    /// The first entries as stored: an array heap in heap order (index 0
    /// leaves next, the children of `i` are `2i + 1` and `2i + 2`, or
    /// `4i + 1..=4i + 4` in the 4-ary heap), the pairing heap level by
    /// level, the radix heap bucket by bucket, the vector's finite slots by
    /// vertex.
    pub fn vertices(&self) -> Vec<u32> {
        self.vertices.clone()
    }

    /// The estimate of each entry of [`vertices`](Self::vertices).
    pub fn estimates(&self) -> Vec<f64> {
        self.estimates.clone()
    }

    /// `1` for a lazy or radix heap's stale entry, `0` otherwise, per entry.
    pub fn stale(&self) -> Vec<u8> {
        self.stale.clone()
    }

    /// The pairing heap's tree: each entry's parent index, `-1` for the
    /// root; empty for the other frontiers (an array heap's is implicit).
    pub fn parents(&self) -> Vec<i32> {
        self.parents.clone()
    }

    /// The radix heap's bucket of each entry; empty for the others.
    pub fn buckets(&self) -> Vec<u8> {
        self.buckets.clone()
    }

    /// How many entries the frontier holds (all of them, past the limit too).
    #[wasm_bindgen(getter)]
    pub fn total(&self) -> u32 {
        self.total
    }

    /// The vertices whose estimate this settle lowered, in relaxation order.
    pub fn relaxed(&self) -> Vec<u32> {
        self.relaxed.clone()
    }

    /// Their estimates before (`Infinity` when just reached).
    pub fn previous(&self) -> Vec<f64> {
        self.previous.clone()
    }

    /// Their estimates after.
    pub fn lowered(&self) -> Vec<f64> {
        self.lowered.clone()
    }
}

/// A frontier that runs `inner` until its `stop`-th pop, then copies it
/// instead of popping and ends the run. Glue: it only delegates and reads.
struct Probe<'a> {
    inner: &'a mut dyn Frontier,
    pops: usize,
    stop: usize,
    taken: Option<Vec<FrontierEntry>>,
}

impl Frontier for Probe<'_> {
    fn reset(&mut self, vertex_count: usize) {
        self.inner.reset(vertex_count);
        self.pops = 0;
        self.taken = None;
    }

    fn decrease(&mut self, v: Vertex, distance: f64) {
        self.inner.decrease(v, distance);
    }

    fn pop_min(&mut self) -> Option<(Vertex, f64)> {
        if self.pops == self.stop {
            self.taken = Some(self.inner.entries());
            return None;
        }
        self.pops += 1;
        self.inner.pop_min()
    }

    fn len(&self) -> usize {
        self.inner.len()
    }

    fn heap_bytes(&self) -> usize {
        self.inner.heap_bytes()
    }

    fn kind(&self) -> FrontierKind {
        self.inner.kind()
    }

    fn entries(&self) -> Vec<FrontierEntry> {
        self.inner.entries()
    }
}

/// Records the estimates lowered by the `step`-th settle (0-based).
struct Lowered {
    step: usize,
    settles: usize,
    relaxed: Vec<u32>,
    previous: Vec<f64>,
    lowered: Vec<f64>,
}

impl Visitor for Lowered {
    fn settle(&mut self, _v: Vertex, _parent: Vertex, _distance: f64) -> Control {
        self.settles += 1;
        Control::Continue
    }

    fn relax(&mut self, v: Vertex, _parent: Vertex, previous: f64, distance: f64) {
        if self.settles == self.step + 1 {
            self.relaxed.push(v);
            self.previous.push(previous);
            self.lowered.push(distance);
        }
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
    names: Option<VertexNames>,
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
            names: None,
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

    /// Whether the file had a weight column (otherwise every edge weighs 1).
    #[wasm_bindgen(getter)]
    pub fn weighted(&self) -> bool {
        self.graph.is_weighted()
    }

    /// The edge Dijkstra would refuse this graph for (its first negative
    /// edge), or `undefined` when every weight is non-negative.
    #[wasm_bindgen(getter, js_name = negativeEdge)]
    pub fn negative_edge(&self) -> Option<NegativeEdge> {
        self.graph.negative_edge().map(|edge| NegativeEdge {
            u: edge.u,
            v: edge.v,
            weight: edge.weight,
        })
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

    /// The weight of every edge, parallel to [`edges`](Self::edges) (all `1`
    /// when the graph is unweighted).
    pub fn weights(&self) -> Vec<f64> {
        dispatch!(&self.graph, g => {
            let mut weights = Vec::with_capacity(g.edge_count());
            for v in g.vertices() {
                weights.extend(g.weighted_neighbors(v).filter(|&(w, _)| w > v).map(|(_, x)| x));
            }
            weights
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

    /// Min, max and mean weight; `undefined` for an unweighted graph.
    #[wasm_bindgen(js_name = weightStats)]
    pub fn weight_stats(&self) -> Option<WeightSummary> {
        dispatch!(&self.graph, g => algo::weight_stats(g)).map(Into::into)
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

    /// Runs the recursive DFS from `root` (the textbook one, one call per
    /// level), timed like [`search`](Self::search). Returns `undefined` when
    /// the tree would nest deeper than [`dfsRecursionLimit`](dfs_recursion_limit):
    /// the browser's stack cannot hold it, and the iterative DFS can.
    #[wasm_bindgen(js_name = dfsRecursive)]
    pub fn dfs_recursive(&mut self, root: u32) -> Result<Option<SearchResult>, JsError> {
        self.check(root)?;
        let start = now();
        let outcome = dispatch!(&self.graph, g => {
            dfs_recursive_into(g, root, &mut self.tree, &mut (), DFS_RECURSION_LIMIT)
        });
        let elapsed_ms = now() - start;
        Ok(outcome.ok().map(|()| SearchResult {
            kind: SearchKind::Dfs,
            tree: self.tree.clone(),
            elapsed_ms,
        }))
    }

    /// Runs Dijkstra from `root` with the chosen frontier and returns the
    /// tree, timed with `performance.now()`. Throws the library's refusal on
    /// a graph with a negative weight. An unweighted graph counts every edge
    /// as 1, so its distances are the BFS levels.
    pub fn dijkstra(
        &mut self,
        root: u32,
        frontier: FrontierType,
    ) -> Result<ShortestPathResult, JsError> {
        self.check(root)?;
        let n = self.graph.vertex_count();
        let mut tree = ShortestPathTree::new(n);
        let start = now();
        let run = dispatch!(&self.graph, g => match frontier {
            FrontierType::Vector => {
                dijkstra_into(g, root, &mut VectorFrontier::new(n), &mut tree, &mut ())
            }
            FrontierType::Heap => {
                dijkstra_into(g, root, &mut HeapFrontier::new(n), &mut tree, &mut ())
            }
            FrontierType::LazyHeap => {
                dijkstra_into(g, root, &mut LazyHeapFrontier::new(n), &mut tree, &mut ())
            }
            FrontierType::QuadHeap => {
                dijkstra_into(g, root, &mut QuadHeapFrontier::new(n), &mut tree, &mut ())
            }
            FrontierType::Pairing => {
                dijkstra_into(g, root, &mut PairingHeapFrontier::new(n), &mut tree, &mut ())
            }
            FrontierType::Radix => {
                dijkstra_into(g, root, &mut RadixHeapFrontier::new(n), &mut tree, &mut ())
            }
        });
        let elapsed_ms = now() - start;
        run.map_err(|e| JsError::new(&e.to_string()))?;
        Ok(ShortestPathResult {
            frontier,
            tree,
            elapsed_ms,
        })
    }

    /// Dijkstra's frontier from `root` right after its `step`-th settle
    /// (0-based) and the relaxations that settle made, with at most `limit`
    /// entries copied. The run is replayed to that point: the library's own
    /// frontier, stopped and read, never a model of it. The vector holds the
    /// same estimates as the heap at every step, only by vertex, so it is
    /// replayed with the heap (`O(log n)` a step instead of `O(n)`) and read
    /// in vertex order.
    #[wasm_bindgen(js_name = frontierAt)]
    pub fn frontier_at(
        &self,
        root: u32,
        frontier: FrontierType,
        step: u32,
        limit: u32,
    ) -> Result<FrontierSnapshot, JsError> {
        self.check(root)?;
        let n = self.graph.vertex_count();
        let mut tree = ShortestPathTree::new(n);
        let mut lowered = Lowered {
            step: step as usize,
            settles: 0,
            relaxed: Vec::new(),
            previous: Vec::new(),
            lowered: Vec::new(),
        };
        let stop = step as usize + 1;
        let graph = &self.graph;
        let mut replay = |inner: &mut dyn Frontier| -> Result<_, JsError> {
            let mut probe = Probe {
                inner,
                pops: 0,
                stop,
                taken: None,
            };
            dispatch!(graph, g => dijkstra_into(g, root, &mut probe, &mut tree, &mut lowered))
                .map_err(|e| JsError::new(&e.to_string()))?;
            Ok(probe.taken)
        };
        let taken = match frontier {
            FrontierType::Heap | FrontierType::Vector => replay(&mut HeapFrontier::new(n))?,
            FrontierType::LazyHeap => replay(&mut LazyHeapFrontier::new(n))?,
            FrontierType::QuadHeap => replay(&mut QuadHeapFrontier::new(n))?,
            FrontierType::Pairing => replay(&mut PairingHeapFrontier::new(n))?,
            FrontierType::Radix => replay(&mut RadixHeapFrontier::new(n))?,
        };
        let mut entries = taken.unwrap_or_default();
        if frontier == FrontierType::Vector {
            entries.sort_unstable_by_key(|e| e.vertex);
        }
        let total = entries.len() as u32;
        entries.truncate(limit as usize);
        Ok(FrontierSnapshot {
            vertices: entries.iter().map(|e| e.vertex).collect(),
            estimates: entries.iter().map(|e| e.estimate).collect(),
            stale: entries.iter().map(|e| u8::from(e.stale)).collect(),
            parents: if frontier == FrontierType::Pairing {
                entries
                    .iter()
                    .map(|e| e.parent.map_or(-1, |p| p as i32))
                    .collect()
            } else {
                Vec::new()
            },
            buckets: entries.iter().filter_map(|e| e.bucket).collect(),
            total,
            relaxed: lowered.relaxed,
            previous: lowered.previous,
            lowered: lowered.lowered,
        })
    }

    /// Reads a names file (`index,name` per line) for this graph's vertices.
    /// Throws with the parser's message on malformed input.
    #[wasm_bindgen(js_name = setNames)]
    pub fn set_names(&mut self, bytes: &[u8]) -> Result<u32, JsError> {
        let names = VertexNames::parse(bytes).map_err(|e| JsError::new(&e.to_string()))?;
        let count = names.len() as u32;
        self.names = Some(names);
        Ok(count)
    }

    /// The name of `v`, if a names file was given and names it.
    pub fn name(&self, v: u32) -> Option<String> {
        self.names.as_ref()?.name(v).map(str::to_owned)
    }

    /// The vertex with exactly this name, if any.
    #[wasm_bindgen(js_name = vertexNamed)]
    pub fn vertex_named(&self, name: &str) -> Option<u32> {
        self.names
            .as_ref()?
            .vertex(name)
            .filter(|&v| v as usize <= self.graph.vertex_count())
    }

    /// Up to `limit` vertices whose names contain every word of `query`,
    /// ignoring case and accents.
    #[wasm_bindgen(js_name = searchNames)]
    pub fn search_names(&self, query: &str, limit: u32) -> Vec<u32> {
        self.names
            .as_ref()
            .map_or_else(Vec::new, |names| names.search(query, limit as usize))
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
    /// library's [`RadialLayout`]: BFS levels become rings whose area is
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
    /// arranged by `kind`. Every component gets the layout: the radial one
    /// starts at `root` in its component and at the smallest vertex in the
    /// others, and its components are packed as discs, the root's at the
    /// origin. `O(n + m)`.
    pub fn layout(&mut self, kind: LayoutKind, root: u32) -> Result<Vec<f32>, JsError> {
        self.check(root)?;
        let components = self.components().clone();
        let positions =
            dispatch!(&self.graph, g => layout_of(g, &mut self.tree, &components, kind, root));
        self.tree.reset();
        Ok(positions)
    }

    /// The BFS tree from `root` drawn level by level, the other components'
    /// trees (from their smallest vertex) beside it with level 0 on one line.
    /// Same shape as [`initialLayout`](Self::initial_layout). `O(n + m)`.
    pub fn layered(&mut self, root: u32, direction: LayerDirection) -> Result<Vec<f32>, JsError> {
        self.check(root)?;
        Ok(self.layered_from(root, None, direction))
    }

    /// Like [`layered`](Self::layered), with the root's component drawn as
    /// the shortest-path tree of `run`: levels count the edges of the tree, not
    /// the distance. `O(n + m)`.
    #[wasm_bindgen(js_name = layeredTree)]
    pub fn layered_tree(
        &mut self,
        run: &ShortestPathResult,
        direction: LayerDirection,
    ) -> Vec<f32> {
        self.layered_from(run.tree.root(), Some(&run.tree), direction)
    }

    fn layered_from(
        &mut self,
        root: Vertex,
        shortest: Option<&ShortestPathTree>,
        direction: LayerDirection,
    ) -> Vec<f32> {
        let components = self.components().clone();
        let positions = dispatch!(&self.graph, g => {
            layered_layout_of(g, &mut self.tree, &components, root, shortest, direction)
        });
        self.tree.reset();
        positions
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
    let mut layout = RadialLayout::new(n);
    for (index, members) in components.iter().enumerate() {
        disc_layout(
            graph,
            tree,
            &mut layout,
            members,
            centres[index],
            radii[index],
            &mut positions,
        );
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
    // rest largest first. `extent` is a disc radius.
    let home = (components.component_of(root) - 1) as usize;
    let order: Vec<usize> = core::iter::once(home)
        .chain((0..components.count()).filter(|&c| c != home))
        .collect();
    let mut extent = vec![0f64; components.count()];
    let mut layout = RadialLayout::new(n);
    for &c in &order {
        let members = components.members(c as u32 + 1);
        let start = if c == home { root } else { members[0] };
        bfs_into(graph, start, tree, &mut ());
        layout.fill(tree);
        let depth = tree.depth() as usize;
        let mut counts = vec![0f64; depth + 1];
        for &v in tree.order() {
            counts[tree.level(v).expect("reached") as usize] += 1.0;
        }
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

    // Then move each component to its place.
    let centres = pack_discs(&extent, home);
    for (c, members) in components.iter().enumerate() {
        let (cx, cy) = centres[c];
        for &v in members {
            positions[2 * v as usize] += cx as f32;
            positions[2 * v as usize + 1] += cy as f32;
        }
    }
    positions
}

/// Every component as a tree drawn level by level; see [`WasmGraph::layered`].
/// `shortest`, when given, is the root's component's tree; the others grow a
/// BFS tree from their smallest vertex.
fn layered_layout_of<G: Graph>(
    graph: &G,
    tree: &mut SearchTree,
    components: &Components,
    root: Vertex,
    shortest: Option<&ShortestPathTree>,
    direction: LayerDirection,
) -> Vec<f32> {
    let n = graph.vertex_count();

    // One forest: the root's tree first, then the rest largest first.
    let mut parents = vec![NO_VERTEX; n + 1];
    let mut order = Vec::with_capacity(n);
    let home = (components.component_of(root) - 1) as usize;
    for c in core::iter::once(home).chain((0..components.count()).filter(|&c| c != home)) {
        let (grown_parents, grown_order) = match shortest {
            Some(run) if c == home => (run.parents_raw(), run.order()),
            _ => {
                let start = if c == home {
                    root
                } else {
                    components.members(c as u32 + 1)[0]
                };
                bfs_into(graph, start, tree, &mut ());
                (tree.parents_raw(), tree.order())
            }
        };
        for &v in grown_order {
            parents[v as usize] = grown_parents[v as usize];
        }
        order.extend_from_slice(grown_order);
    }
    let layout = tree_layout(&parents, &order);

    // A gap between trees, and one level spacing for all of them so levels
    // line up, chosen for the proportions of a wide canvas: 2.5:1 when the
    // breadth runs along it, 1.5:1 when the levels do.
    let gap = 4.0 * EDGE_LENGTH;
    let trees = components.count();
    let breadth = layout.leaves as f64 * SPACING + gap * trees.saturating_sub(1) as f64;
    let deepest = order
        .iter()
        .map(|&v| layout.depth[v as usize])
        .max()
        .unwrap_or(0)
        .max(1) as f64;
    let levels_span = match direction {
        LayerDirection::Vertical => breadth / 2.5,
        LayerDirection::Horizontal => breadth * 1.5,
    };
    let level = (levels_span / deepest).max(2.0 * EDGE_LENGTH);

    let mut positions = vec![0f32; 2 * (n + 1)];
    let mut gaps = 0.0;
    for (i, &v) in order.iter().enumerate() {
        let v = v as usize;
        if i > 0 && parents[v] == NO_VERTEX {
            gaps += gap;
        }
        let across = layout.slot[v] * SPACING + gaps - breadth / 2.0;
        let along = layout.depth[v] as f64 * level - deepest * level / 2.0;
        let (x, y) = match direction {
            LayerDirection::Vertical => (across, along),
            LayerDirection::Horizontal => (along, across),
        };
        positions[2 * v] = x as f32;
        positions[2 * v + 1] = y as f32;
    }
    positions
}

/// Lays one component out radially from its smallest vertex inside the disc
/// at `(cx, cy)`: BFS levels become rings whose area is proportional to the
/// number of vertices on them, so density is uniform.
fn disc_layout<G: Graph>(
    graph: &G,
    tree: &mut SearchTree,
    layout: &mut RadialLayout,
    members: &[Vertex],
    (cx, cy): (f64, f64),
    radius: f64,
    positions: &mut [f32],
) {
    bfs_into(graph, members[0], tree, &mut ());
    layout.fill(tree);

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

/// Room given to each vertex along a ring, or to each leaf across the levels.
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

// ---------------------------------------------------------------------------
// The DBLP site's per-year files, summed into one network

/// One pair's key in the builder's table: `u` in the high half, `v` low.
fn pair_key(u: Vertex, v: Vertex) -> u64 {
    (u64::from(u) << 32) | u64::from(v)
}

/// A hasher for those keys: splitmix64's finaliser, a few multiplies. The
/// keys are distinct integers already, and std's SipHash would cost more
/// than the parse on tens of millions of lines.
#[derive(Default)]
struct PairHasher(u64);

impl std::hash::Hasher for PairHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.write_u64(u64::from(byte));
        }
    }

    fn write_u64(&mut self, key: u64) {
        let mut x = key ^ self.0;
        x ^= x >> 30;
        x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        x ^= x >> 27;
        x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
        x ^= x >> 31;
        self.0 = x;
    }
}

type PairStrengths = std::collections::HashMap<u64, f64, std::hash::BuildHasherDefault<PairHasher>>;

/// The DBLP site's network up to a year, summed from one file per year.
///
/// `graphman dblp --site` publishes, per year, the strength every pair
/// gained that year (`u v strength` lines: how many papers it shared) and
/// the researchers whose first collaboration was that year (`vertex,name`
/// lines). Adding the years up to the one wanted and inverting the sums
/// gives that year's weights, the ones the CLI writes (see
/// `graphman::io::Network::strengths`). A strength may be any positive
/// real, as in builds made before the weights became `1 / papers`.
/// [`finish`] builds the graph, named.
///
/// [`finish`]: Self::finish
#[wasm_bindgen(js_name = NetworkBuilder)]
pub struct WasmNetworkBuilder {
    strengths: PairStrengths,
    names: Vec<u8>,
}

#[wasm_bindgen(js_class = NetworkBuilder)]
impl WasmNetworkBuilder {
    /// No years yet, with room for `pairs` pairs. A table growing on the way
    /// to the whole network must double to over 1 GiB beside its old self,
    /// which wasm's 4 GiB cannot spare once another graph is held, so the
    /// count the manifest knows is reserved at the start.
    #[wasm_bindgen(constructor)]
    pub fn new(pairs: u32) -> Self {
        Self {
            strengths: PairStrengths::with_capacity_and_hasher(pairs as usize, Default::default()),
            names: Vec::new(),
        }
    }

    /// Adds a year's strengths (`u v strength` per line). Returns how many
    /// lines it read. Throws on a malformed line.
    #[wasm_bindgen(js_name = addStrengths)]
    pub fn add_strengths(&mut self, bytes: &[u8]) -> Result<u32, JsError> {
        let mut lines = 0u32;
        for (index, line) in bytes.split(|&b| b == b'\n').enumerate() {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            if line.is_empty() {
                continue;
            }
            let (u, v, strength) = parse_strength(line).ok_or_else(|| {
                JsError::new(&format!("line {}: expected `u v strength`", index + 1))
            })?;
            *self.strengths.entry(pair_key(u, v)).or_insert(0.0) += strength;
            lines += 1;
        }
        Ok(lines)
    }

    /// Adds a year's names (`vertex,name` per line).
    #[wasm_bindgen(js_name = addNames)]
    pub fn add_names(&mut self, bytes: &[u8]) {
        self.names.extend_from_slice(bytes);
        if !bytes.ends_with(b"\n") {
            self.names.push(b'\n');
        }
    }

    /// Pairs summed so far: the edges `finish` will build.
    #[wasm_bindgen(getter, js_name = edgeCount)]
    pub fn edge_count(&self) -> u32 {
        self.strengths.len() as u32
    }

    /// Builds the network: a vertex per name given, an edge per pair summed,
    /// weighted by the inverse of its strength. `compact` leaves out the
    /// vertices no pair touched (a span of years, where most researchers
    /// named are idle) and renumbers the rest in order; otherwise the
    /// numbering is the names file's, as the course format has it. The
    /// table is freed once the edges have left it, before they are sorted
    /// and the representation is built: it is the largest thing here.
    pub fn finish(
        self,
        representation: RepresentationKind,
        compact: bool,
    ) -> Result<WasmGraph, JsError> {
        let names = VertexNames::parse(&self.names).map_err(|e| JsError::new(&e.to_string()))?;
        let n = names.len();
        let strengths = self.strengths;
        let (names, edges) = if compact {
            let mut kept = vec![false; n + 1];
            for &key in strengths.keys() {
                let (u, v) = ((key >> 32) as usize, key as Vertex as usize);
                if u > n || v > n {
                    return Err(JsError::new(&format!("vertex {} is not named", u.max(v))));
                }
                kept[u] = true;
                kept[v] = true;
            }
            let mut rank = vec![0 as Vertex; n + 1];
            let mut text = Vec::new();
            let mut next = 0;
            for v in 1..=n {
                if !kept[v] {
                    continue;
                }
                next += 1;
                rank[v] = next;
                if let Some(name) = names.name(v as Vertex) {
                    text.extend_from_slice(format!("{next},{name}\n").as_bytes());
                }
            }
            let names = VertexNames::parse(&text).map_err(|e| JsError::new(&e.to_string()))?;
            let triples: Vec<_> = strengths
                .into_iter()
                .map(|(key, strength)| {
                    (
                        rank[(key >> 32) as usize],
                        rank[key as Vertex as usize],
                        1.0 / strength,
                    )
                })
                .collect();
            let edges = EdgeList::from_weighted_edges(next as usize, triples)
                .map_err(|e| JsError::new(&e.to_string()))?;
            (names, edges)
        } else {
            let triples: Vec<_> = strengths
                .into_iter()
                .map(|(key, strength)| ((key >> 32) as Vertex, key as Vertex, 1.0 / strength))
                .collect();
            let edges = EdgeList::from_weighted_edges(n, triples)
                .map_err(|e| JsError::new(&e.to_string()))?;
            (names, edges)
        };
        let mut graph = WasmGraph::of(edges, representation)?;
        graph.names = Some(names);
        Ok(graph)
    }
}

/// `u v strength`, the strength positive and finite.
fn parse_strength(line: &[u8]) -> Option<(Vertex, Vertex, f64)> {
    let mut fields = line.split(|&b| b == b' ').filter(|field| !field.is_empty());
    let u = parse_vertex(fields.next()?)?;
    let v = parse_vertex(fields.next()?)?;
    let strength: f64 = core::str::from_utf8(fields.next()?).ok()?.parse().ok()?;
    if fields.next().is_some() || !strength.is_finite() || strength <= 0.0 {
        return None;
    }
    Some((u, v, strength))
}

fn parse_vertex(field: &[u8]) -> Option<Vertex> {
    if field.is_empty() || field.len() > 10 {
        return None;
    }
    let mut value: u64 = 0;
    for &byte in field {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + u64::from(byte - b'0');
    }
    Vertex::try_from(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A triangle, a duplicate edge line, a self-loop and an isolated vertex.
    const SAMPLE: &[u8] = b"4\n1 2\n2 3\n3 1\n1 3\n3 3\n";

    fn graph(kind: RepresentationKind) -> WasmGraph {
        WasmGraph::new(SAMPLE, kind).expect("the sample parses and fits the budget")
    }

    /// 1-2-3-4 is the short way round; the edge 1-3 is one hop but heavy.
    /// Vertex 5 is alone.
    const DETOUR: &[u8] = b"5\n1 2 1\n2 3 1\n1 3 5\n3 4 1\n";

    fn y(positions: &[f32], v: usize) -> f32 {
        positions[2 * v + 1]
    }

    fn x(positions: &[f32], v: usize) -> f32 {
        positions[2 * v]
    }

    #[test]
    fn the_layers_draw_the_tree_of_the_search_that_ran() {
        let mut g = WasmGraph::new(DETOUR, RepresentationKind::Csr).expect("parses");

        // The BFS takes the heavy edge: 2 and 3 share level 1.
        let bfs = g.layered(1, LayerDirection::Vertical).unwrap();
        assert_eq!(y(&bfs, 2), y(&bfs, 3));
        assert!(y(&bfs, 1) < y(&bfs, 2) && y(&bfs, 3) < y(&bfs, 4));

        // Dijkstra goes round it: every vertex a level further down.
        let mut tree = ShortestPathTree::new(5);
        dispatch!(&g.graph, graph => {
            dijkstra_into(graph, 1, &mut HeapFrontier::new(5), &mut tree, &mut ())
        })
        .expect("no negative weights");
        let run = ShortestPathResult {
            frontier: FrontierType::Heap,
            tree,
            elapsed_ms: 0.0,
        };
        let shortest = g.layered_tree(&run, LayerDirection::Vertical);
        assert!(y(&shortest, 1) < y(&shortest, 2));
        assert!(y(&shortest, 2) < y(&shortest, 3));
        assert!(y(&shortest, 3) < y(&shortest, 4));

        // The other component stands beside the tree, level 0 on one line.
        assert_eq!(y(&shortest, 5), y(&shortest, 1));
        assert!(x(&shortest, 5) > x(&shortest, 1));
    }

    #[test]
    fn the_layers_turn_on_their_side() {
        let mut g = WasmGraph::new(DETOUR, RepresentationKind::Csr).expect("parses");
        let across = g.layered(1, LayerDirection::Horizontal).unwrap();
        // Levels as columns, the root on the left.
        assert_eq!(x(&across, 2), x(&across, 3));
        assert!(x(&across, 1) < x(&across, 2) && x(&across, 3) < x(&across, 4));
        assert_eq!(x(&across, 5), x(&across, 1));
        assert!(y(&across, 5) > y(&across, 1));
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

    /// The Part 2 handout's figure, with its negative edge.
    const WEIGHTED: &[u8] = b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n";

    #[test]
    fn weights_travel_with_the_edges_in_every_representation() {
        let csr = WasmGraph::new(WEIGHTED, RepresentationKind::Csr).expect("fits");
        assert!(csr.weighted());
        assert_eq!(csr.edges(), vec![1, 2, 1, 5, 2, 5, 3, 4, 3, 5, 4, 5]);
        assert_eq!(csr.weights(), vec![0.1, 1.0, 0.2, -9.5, 5.0, 2.3]);
        for kind in [RepresentationKind::List, RepresentationKind::Matrix] {
            let other = WasmGraph::new(WEIGHTED, kind).expect("fits");
            assert_eq!(other.weights(), csr.weights());
        }
        let stats = csr.weight_stats().expect("weighted");
        assert_eq!((stats.min, stats.max, stats.negative), (-9.5, 5.0, 1));
        let negative = csr.negative_edge().expect("3-4 is negative");
        assert_eq!((negative.u, negative.v, negative.weight), (3, 4, -9.5));
        // An unweighted file weighs 1 per edge and has nothing to refuse.
        let plain = graph(RepresentationKind::Csr);
        assert!(!plain.weighted() && plain.negative_edge().is_none());
        assert_eq!(plain.weights(), vec![1.0; 3]);
        assert!(plain.weight_stats().is_none());
    }

    #[test]
    fn weighted_memory_reports_count_the_weights() {
        let weighted = WasmEdges::new(WEIGHTED).expect("parses");
        let plain = WasmEdges::new(b"5\n1 2\n2 5\n5 3\n3 4\n4 5\n1 5\n").expect("parses");
        assert!(weighted.weighted() && !plain.weighted());
        let (w, p) = (weighted.memory_report(), plain.memory_report());
        assert_eq!(w.csr - p.csr, (2 * 6 * 8) as f64);
        assert!(w.matrix > p.matrix && w.list > p.list);
    }

    #[test]
    fn names_resolve_both_ways() {
        let mut g = graph(RepresentationKind::List);
        let count = g
            .set_names("1,Edsger W. Dijkstra\n3,Éva Tardos\n9,Out of range\n".as_bytes())
            .expect("parses");
        assert_eq!(count, 3);
        assert_eq!(g.name(3).as_deref(), Some("Éva Tardos"));
        assert_eq!(g.name(2), None);
        assert_eq!(g.vertex_named("Edsger W. Dijkstra"), Some(1));
        assert_eq!(g.vertex_named("Out of range"), None);
        assert_eq!(g.search_names("eva", 5), vec![3]);
    }

    #[test]
    fn network_builder_sums_the_years_in_order() {
        let mut builder = WasmNetworkBuilder::new(4);
        builder.add_strengths(b"1 2 1\n1 3 1\n").unwrap();
        builder.add_names(b"1,Ana\n2,Bia\n3,Caio");
        builder.add_strengths(b"1 2 3\r\n2 4 1\n\n").unwrap();
        builder.add_names(b"4,Dora\n");
        assert_eq!(builder.edge_count(), 3);
        let graph = builder.finish(RepresentationKind::Csr, false).unwrap();
        assert_eq!(graph.vertex_count(), 4);
        assert_eq!(graph.edge_count(), 3);
        assert_eq!(graph.name(4).as_deref(), Some("Dora"));
        assert_eq!(graph.edges.edges(), [[1, 2], [1, 3], [2, 4]]);
        // 1 and 2: one paper in the first year, three in the second.
        assert_eq!(graph.edges.weights(), Some([0.25, 1.0, 1.0].as_slice()));

        // Compacted: only the second year, so Ana (1) and Caio (3) are idle
        // and the rest are renumbered in order.
        let mut span = WasmNetworkBuilder::new(4);
        span.add_names(b"1,Ana\n2,Bia\n3,Caio\n4,Dora\n");
        span.add_strengths(b"2 4 1\n").unwrap();
        let graph = span.finish(RepresentationKind::Csr, true).unwrap();
        assert_eq!(graph.vertex_count(), 2);
        assert_eq!(graph.edges.edges(), [[1, 2]]);
        assert_eq!(graph.name(1).as_deref(), Some("Bia"));
        assert_eq!(graph.name(2).as_deref(), Some("Dora"));

        // A JsError cannot be made off wasm, so the parser is checked itself.
        assert_eq!(parse_strength(b"7  9 0.25"), Some((7, 9, 0.25)));
        assert_eq!(parse_strength(b"1 2"), None);
        assert_eq!(parse_strength(b"1 2 0"), None);
        assert_eq!(parse_strength(b"1 x 1"), None);
        assert_eq!(parse_strength(b"1 2 1 4"), None);
    }

    #[test]
    fn egonet_and_shortest_path_answer_from_the_named_network() {
        let mut builder = WasmNetworkBuilder::new(4);
        builder.add_names(b"1,Ana\n2,Bia\n3,Caio\n4,Dora\n5,Eli\n");
        builder
            .add_strengths(b"1 2 2\n2 3 4\n1 3 1\n3 4 1\n")
            .unwrap();
        let graph = builder.finish(RepresentationKind::Csr, false).unwrap();

        let cut = graph.egonet(1, 1);
        assert_eq!((cut.vertices(), cut.edges()), (3, 3));

        // The two-step way (0.5 + 0.25) beats the direct edge (1).
        let path = graph.shortest_path(1, 3).unwrap().unwrap();
        assert_eq!(path.vertices(), [1, 2, 3]);
        assert_eq!(path.weights(), [0.5, 0.25]);
        assert_eq!((path.distance(), path.edges()), (0.75, 2));
        let same = graph.shortest_path(4, 4).unwrap().unwrap();
        assert_eq!((same.vertices(), same.edges()), (vec![4], 0));
        // Eli wrote with no one here: another component.
        assert!(graph.shortest_path(1, 5).unwrap().is_none());
    }
}

/// Which vertices [`WasmGraph::subgraph`] keeps (the library's `SubgraphRule`).
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubgraphKind {
    /// A BFS ball around a seed, stopped at the size wanted.
    Ball = 0,
    /// The vertices of highest degree.
    MostConnected = 1,
    /// Vertices `1..=max`.
    Earliest = 2,
}

impl From<SubgraphKind> for graphman::algo::SubgraphRule {
    fn from(kind: SubgraphKind) -> Self {
        match kind {
            SubgraphKind::Ball => Self::Ball,
            SubgraphKind::MostConnected => Self::MostConnected,
            SubgraphKind::Earliest => Self::Earliest,
        }
    }
}

/// Lines in one piece of a cut's file: a few megabytes.
const PIECE_LINES: usize = 256 * 1024;

/// A cut of the loaded graph: how big it is, and its two files in the course
/// format, a piece at a time. The whole network's edge file is larger than
/// what is left of wasm's 4 GiB beside the network itself, so a file is
/// never held here: each piece leaves for JavaScript as soon as it is written.
#[wasm_bindgen]
pub struct Subgraph {
    induced: graphman::algo::Induced,
    edge_line: usize,
    name_line: usize,
}

#[wasm_bindgen]
impl Subgraph {
    /// How many vertices the cut keeps.
    #[wasm_bindgen(getter)]
    pub fn vertices(&self) -> u32 {
        self.induced.vertex_count() as u32
    }

    /// How many edges run among them.
    #[wasm_bindgen(getter)]
    pub fn edges(&self) -> u32 {
        self.induced.edge_count() as u32
    }

    /// The edge file's size: exact when the cut is small, otherwise an
    /// estimate from a sample of its lines.
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> f64 {
        self.induced.file_bytes() as f64
    }

    /// How much of the two files has been written, from 0 to 1.
    #[wasm_bindgen(getter)]
    pub fn progress(&self) -> f64 {
        let total = self.induced.edge_lines() + self.induced.vertex_count();
        (self.edge_line + self.name_line) as f64 / total as f64
    }

    /// The next piece of the edge file (`n`, then `u v weight` per line);
    /// empty once the file is done.
    #[wasm_bindgen(js_name = nextEdges)]
    pub fn next_edges(&mut self) -> Vec<u8> {
        let end = (self.edge_line + PIECE_LINES).min(self.induced.edge_lines());
        let mut piece = Vec::new();
        self.induced
            .write_edge_lines(self.edge_line..end, &mut piece)
            .expect("writing to a Vec never fails");
        self.edge_line = end;
        piece
    }

    /// The next piece of the names file (`vertex,name` per line), read from
    /// the graph the cut came from; empty once the file is done, or at once
    /// when the graph has no names.
    #[wasm_bindgen(js_name = nextNames)]
    pub fn next_names(&mut self, graph: &WasmGraph) -> Vec<u8> {
        let mut piece = Vec::new();
        let Some(names) = &graph.names else {
            self.name_line = self.induced.vertex_count();
            return piece;
        };
        // A stretch of unnamed vertices writes nothing: only the end is empty.
        while piece.is_empty() && self.name_line < self.induced.vertex_count() {
            let end = (self.name_line + PIECE_LINES).min(self.induced.vertex_count());
            self.induced
                .write_name_lines(names, self.name_line..end, &mut piece)
                .expect("writing to a Vec never fails");
            self.name_line = end;
        }
        piece
    }
}

#[wasm_bindgen(js_class = Graph)]
impl WasmGraph {
    /// Cuts the graph to at most `max` vertices by `rule` (`seed` is the
    /// ball's centre) and renumbers them from 1: the ball's seed, the most
    /// connected vertex or vertex 1 becomes vertex 1.
    pub fn subgraph(&self, rule: SubgraphKind, seed: u32, max: u32) -> Subgraph {
        let kept =
            dispatch!(&self.graph, g => graphman::algo::select(g, rule.into(), seed, max as usize));
        let induced = dispatch!(&self.graph, g => graphman::algo::induce(g, kept));
        Subgraph {
            induced,
            edge_line: 0,
            name_line: 0,
        }
    }

    /// The egonet of radius `radius` around `seed`: everyone at most `radius`
    /// edges away, ignoring the weights, and every edge among them, with
    /// `seed` as vertex 1.
    pub fn egonet(&self, seed: u32, radius: u32) -> Subgraph {
        let induced = dispatch!(&self.graph, g => graphman::algo::egonet(g, seed, radius));
        Subgraph {
            induced,
            edge_line: 0,
            name_line: 0,
        }
    }

    /// The shortest path between two vertices by weight, read off a Dijkstra
    /// that stops at `to`; `undefined` across components. Throws when a vertex
    /// is outside the graph, or on a negative weight.
    #[wasm_bindgen(js_name = shortestPath)]
    pub fn shortest_path(&self, from: u32, to: u32) -> Result<Option<PathBetween>, JsError> {
        self.check(from)?;
        self.check(to)?;
        dispatch!(&self.graph, g => {
            let Some(path) = graphman::algo::shortest_path(g, from, to)
                .map_err(|e| JsError::new(&e.to_string()))?
            else {
                return Ok(None);
            };
            let weights = path
                .vertices
                .windows(2)
                .map(|hop| g.weight(hop[0], hop[1]).expect("a path follows edges"))
                .collect();
            Ok(Some(PathBetween { path, weights }))
        })
    }
}

/// A shortest path between two vertices (see [`WasmGraph::shortest_path`]).
#[wasm_bindgen]
pub struct PathBetween {
    path: graphman::algo::Path,
    weights: Vec<f64>,
}

#[wasm_bindgen]
impl PathBetween {
    /// The sum of the weights along the path.
    #[wasm_bindgen(getter)]
    pub fn distance(&self) -> f64 {
        self.path.distance
    }

    /// How many edges the path has.
    #[wasm_bindgen(getter)]
    pub fn edges(&self) -> u32 {
        self.path.hops() as u32
    }

    /// The vertices from one end to the other, both included.
    pub fn vertices(&self) -> Vec<u32> {
        self.path.vertices.clone()
    }

    /// The weight of each edge, in the order walked.
    pub fn weights(&self) -> Vec<f64> {
        self.weights.clone()
    }
}
