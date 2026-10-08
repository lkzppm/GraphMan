# Phase 2 and beyond

Part 1 delivered undirected, unweighted graphs with three representations
and a diameter study. Part 2 (`docs/trabalho-P2.pdf`, summarised in
`spec/ASSIGNMENT.md`) is now out and is narrower than first guessed:
**undirected graphs with real weights, and Dijkstra written once over two
interchangeable stores of distance estimates** (a vector and a heap with
decrease-key). Direction and flows are left for Part 3. This document
records how the core grows without breaking Part 1, how Part 2 is
answered, and how the library relates to `petgraph`, the Rust graph
library everybody already uses.

The short version: GraphMan keeps its own structures and algorithms, uses
`petgraph` as a test oracle and a benchmark baseline, and later speaks
`petgraph`'s traits so that its unique algorithms run on `petgraph` graphs
and `petgraph`'s algorithms run on GraphMan structures. The contribution to
the community is the gap, not another general graph crate.

## 1. Why not build on `petgraph` or `graph`

- **The course grades the library.** The assignment asks for a reusable
  library with representations chosen by the user and case studies that
  measure them. A Dijkstra imported from `petgraph` would leave nothing to
  present and nothing to measure.
- **The wasm crate must stay small.** `petgraph` brings `fixedbitset`,
  `indexmap` and `hashbrown`; the observatory bundle does not want them.
- **Weights and direction are cheap on top of CSR.** A directed CSR is the
  current one with out-rows only, plus an optional reverse CSR for
  in-neighbours. Weights are one array parallel to `targets`. The work is
  in the traits, not in the algorithms.
- **`graph` (crates.io) is the closest relative** in spirit: CSR, parallel
  construction, built for billions of edges. It has no diameter, no matrix
  representation and no browser target. It is a benchmark opponent, not a
  base.
- **`daggy`** is a DAG wrapper on `petgraph` and **`egui_graphs`** is a
  visualisation widget on `petgraph`. Neither competes with the library;
  `egui_graphs` competes with the observatory at a scale of thousands of
  nodes, not millions.

## 2. Where `petgraph` does belong

### Test oracle (`[dev-dependencies]`)

Every result GraphMan produces that `petgraph` can also produce is checked
against it on random graphs: connected component counts, shortest-path
distances, minimum spanning tree weights, maximum flow values. The
comparison runs in `cargo test`, never in the library. `proptest` generates
the graphs so that thousands of cases replace hand-written examples.

### Benchmark baseline (case studies)

The Part 2 report runs `petgraph::algo::dijkstra` and the `graph` crate's
delta-stepping SSSP on the same course graphs and puts them in the tables
next to GraphMan. Being within a few percent of `petgraph` at half the
memory is a stronger claim than any "better than" and is one a reader can
check.

## 3. Core growth: the traits

`Graph` stays exactly as it is: undirected, unweighted, ascending neighbour
rows, a GAT iterator. Everything from Part 1 keeps compiling and every
Part 1 test keeps passing. New capabilities are new traits, and every
algorithm bounds on the least it needs, so BFS keeps running on a weighted
graph without knowing it is one.

```
Graph               vertex_count, edge_count, degree, neighbors, has_edge
Weighted: Graph     type Weight; weighted_neighbors -> (Vertex, Weight)   Part 2
Directed: Graph     out_neighbors, in_neighbors, out_degree, in_degree     Part 3
```

- **`Weighted`.** The weight type is generic with a small `Measure` trait:
  zero, addition, a total order (`f64::total_cmp`, NaN is rejected by the
  parser) and an infinity for "unreached". Course graphs use `f64`, since
  the handout says weights are arbitrary floats; `u32` weights make the
  hop-count algorithms the special case where every weight is one, which
  gives a free test: Dijkstra with unit weights must reproduce BFS levels.
- **Negative weights** are found at load time (`EdgeList::min_weight`, one
  pass, kept on the edge list and the representation), so the check costs
  nothing per call. Dijkstra returns a typed
  `Error::NegativeWeight { u, v, weight }` naming the first offending edge,
  which is the handout's "inform that it is not implemented yet". Worth a
  sentence in the report: in an *undirected* graph a single negative edge
  `{u, v}` already makes `u v u v ...` a negative closed walk, so shortest
  walks are unbounded and even Bellman-Ford can only report the cycle.
  Zero weights are allowed; the handout's "positive" is read as
  "non-negative", which is all Dijkstra needs.
- **Representations.** CSR gains a `weights: Vec<W>` parallel to `targets`
  (row `v` keeps ascending neighbour ids, the weights follow their
  targets). The adjacency list gains `Vec<Vec<(Vertex, W)>>`. The bit
  matrix stays unweighted; Part 2 does not ask for two representations,
  and a dense weighted matrix would be refused by the memory budget on
  every course graph anyway. Cost to report: `f64` weights add 8 bytes per
  directed arc, about 740 MB on grafo_6's 93M arcs if the weighted graphs
  share its size; `f32` would halve that and is a one-line type change if
  memory becomes the problem.
- **`EdgeList`** learns an optional third column. A file with two columns
  everywhere is unweighted exactly as before; three everywhere is weighted;
  a mix is a parse error with the line number. Normalisation keeps
  sorting and deduplicating so rows stay ascending, with two rules for the
  weights: a **self-loop** is dropped (a non-negative loop is never on a
  shortest path) but its weight still counts for the negative check; a
  **duplicate** edge keeps its **smallest** weight (the only one a shortest
  path could use) and is counted in `duplicates_dropped`, with the number
  whose weights disagreed reported beside it.
- **Vertex names.** The collaboration network comes with a file mapping
  indices to researcher names. Names live beside the graph, never in it
  (section 7): `io::VertexNames` parses the file once, keeps the names in
  one `String` arena with offsets, and answers `name(v)` and
  `index_of("Éva Tardos")` (exact, UTF-8, as the handout requires; a near
  miss suggests the closest names instead of failing silently).
- **`Directed`** (Part 3). `neighbors` on a directed graph means
  out-neighbours, so BFS, DFS and components (weakly connected) work
  unchanged. `in_neighbors` comes from a reverse CSR built on demand and
  cached, since only a few algorithms (reverse search, residual graphs)
  need it.

## 4. Dijkstra for Part 2

### One algorithm, two stores

The handout asks for Dijkstra with a vector and with a heap, and
explicitly asks for the storage to be abstracted instead of writing the
algorithm twice. That is the Part 1 story again ("storage is a strategy")
one level down, so it is also the slide:

```rust
/// Where Dijkstra keeps its tentative distances.
pub trait Frontier<W: Measure> {
    fn reset(&mut self, vertex_count: usize);
    /// Lower the estimate of `v` to `dist` (insert if new).
    fn decrease(&mut self, v: Vertex, dist: W);
    /// Remove and return the open vertex with the smallest estimate.
    fn pop_min(&mut self) -> Option<(Vertex, W)>;
}

pub fn dijkstra_into<G: Weighted, F: Frontier<G::Weight>>(
    graph: &G, root: Vertex, frontier: &mut F, tree: &mut ShortestPathTree<G::Weight>,
) -> Result<(), Error>;
```

- **`VecFrontier`**: the course's vector: one estimate per vertex plus
  the `seen`/settled bits; `pop_min` scans every vertex, so a run is
  `O(n² + m)`. The scan stops early when the minimum is infinity (the
  rest of the graph is another component).
- **`HeapFrontier`**: an indexed binary heap written here, no crate: a
  `heap: Vec<Vertex>` plus a `position: Vec<u32>` per vertex, so
  `decrease` sifts the vertex up from where it is, `O(log n)`, and a run is
  `O((n + m) log n)`. This is the "efficient key modification" the handout
  warns about; `std::collections::BinaryHeap` has no decrease-key.
- Optional third column, cheap to add and good for the talk:
  **`LazyHeapFrontier`**, `BinaryHeap` with duplicate entries skipped when
  popped (what `petgraph::algo::dijkstra` does). It shows what the
  decrease-key buys, or does not, on the course graphs.

### Determinism

Both frontiers break ties on `(distance, vertex id)` and relaxation uses a
strict `<`, so the vector and the heap settle vertices in the same order
and produce **the same tree**, not just the same distances. Tests enforce
it, exactly as Part 1 enforces identical BFS trees across representations.

### Output

`ShortestPathTree<W>` mirrors `SearchTree`: `root`, `parent`, `dist: Vec<W>`
(infinity when unreached), the settle `order`, `path_to(v)` walking the
parents, and a `reset` that only touches the vertices the previous run
reached, so `k = 100` runs on a 4.8M-vertex graph allocate nothing. The
settle order doubles as the observatory's discovery ranks.

### Case-study runner

`graphman study` detects a weighted file and runs:

- distances and paths from 10 to 20, 30, 40, 50, 60 (one table per graph);
- the mean of `k` single-source runs (`--runs 100`, same SplitMix64 roots
  as Part 1) for each frontier, parsing excluded. The vector variant is
  `O(n²)`, so it gets a `--dijkstra-budget <seconds>`: when it runs out
  the table records how many runs finished and their mean, flagged, the
  same honest-cell treatment as the Part 1 matrix refusals;
- for the collaboration network (`--names <file>`), the paths from
  "Edsger W. Dijkstra" to the five researchers, printed with names.

`petgraph::algo::dijkstra` runs as a baseline column in the timing table
(a dev/bench-only dependency, never in the library).

### Tests

- `proptest` random weighted graphs: vector, heap and lazy heap agree on
  every distance and every parent; distances equal `petgraph`'s.
- Unit weights reproduce BFS levels.
- The handout's Figure 1 graph is refused for its `-9.5` edge, and accepted
  once that weight is made positive (a hand-checked distance table).
- Wiki examples in `tests/wiki.rs` for weighted loading, Dijkstra, the
  refusal and name lookup, so the Library page documents only what ran.

### The rest of the plan (beyond what Part 2 grades)

| Algorithm | Notes |
|---|---|
| A* / best-first | the same driver, the frontier keyed by distance plus a heuristic |
| Bellman-Ford | negative weights; on undirected graphs it can only report the negative cycle (see section 3) |
| Minimum spanning tree | Prim over `HeapFrontier`; Kruskal with a union-find |
| Weighted eccentricity, diameter | iFUB and Takes-Kosters hold for any non-negative metric with Dijkstra in place of BFS |

Part 3 adds `Directed`, then `Flow` (Ford-Fulkerson with BFS augmenting
paths, then Dinic) on top of `Directed + Weighted`, using the cached
reverse CSR for the residual graph.

### Web

- **wasm**: `Graph` accepts weighted files and gains `dijkstra(root,
  frontier)` returning parents, distances and settle ranks as typed arrays,
  plus `withNames(file)` for the collaboration network. Glue only, as
  always; no rayon is needed.
- **Observatory**: Dijkstra joins BFS/DFS as a search; the existing
  `reveal` sweep animates the settle order and `setPath` draws the
  shortest path, with the distance shown as a sum of weights. Edge
  weights can tint the edges. Dropping the names file next to the
  collaboration network turns vertex ids into names (hover, search box,
  "Dijkstra to Turing"). A negative-weight file shows the refusal in the
  sidebar instead of a search.
- **Studies tab** and **Presentation** gain the Part 2 tables (paths,
  vector vs heap vs lazy heap vs `petgraph`) and the "one Dijkstra, two
  frontiers" slide. All new strings go through `src/i18n/`.

## 5. `feat/petgraph`: the bridge

A future branch adds an optional `petgraph` feature to `graphman`. It has
two halves and neither touches the default build.

### GraphMan structures as `petgraph` graphs

Implement `petgraph::visit` traits for `Csr`, `AdjacencyList` and
`AdjacencyMatrix`:

```
GraphBase          NodeId = Vertex, EdgeId = (Vertex, Vertex)
NodeCount          vertex_count
NodeIndexable      to_index = v - 1, from_index = i + 1, node_bound = n
IntoNeighbors      neighbors (out-neighbours on Directed)
IntoNeighborsDirected  in_neighbors on Directed
IntoEdges          weighted_neighbors on Weighted
Visitable          a FixedBitSet, or GraphMan's own bitset behind VisitMap
GetAdjacencyMatrix has_edge, O(1) on the matrix
```

The 1-based vertex convention is absorbed by `NodeIndexable`, so nothing
else in GraphMan changes. With these impls, every `petgraph::algo`
function (Tarjan, Kosaraju, toposort, Floyd-Warshall, Johnson, isomorphism,
dominators, PageRank, Steiner tree) runs on a GraphMan CSR unmodified.

### GraphMan algorithms on `petgraph` graphs

Re-express the algorithms that `petgraph` lacks as functions generic over
`petgraph::visit` bounds, the way `rustworkx-core` does:

```
diameter<G: IntoNeighbors + NodeIndexable + NodeCount + Sync>(g, method)
eccentricities<G: ...>(g) -> Vec<u32>
radius, center, periphery
components<G: ...>(g) -> Components   // membership, not just a count
distance_distribution<G: ...>(g)      // sampled or exact
closeness, harmonic centrality        // later
```

Internally these are the Part 1 implementations with `Graph` replaced by
the `petgraph` bounds; `SearchTree` works on any `NodeIndexable` graph.
A `petgraph::Graph`, `StableGraph` or `Csr` user then calls GraphMan's
iFUB on their existing structure without converting anything.

### What this buys

- GraphMan's unique value stays in GraphMan; adoption rides on the
  standard traits.
- The observatory and the CLI keep the slim default build.
- The oracle tests from section 2 become one-liners: build a GraphMan
  graph, hand it to `petgraph::algo`, compare.

## 6. Publishing

The crate name `graphman` is free on crates.io as of September 2026. It is
reserved when the weighted API of section 3 has settled, not before: a
published 0.1 is a promise about the trait shapes. The first release ships
the default features plus `petgraph`, with the bridge documented as the
intended entry point for existing `petgraph` users.

## 7. Non-goals

- A general-purpose graph library. `petgraph` is that, with several
  hundred million downloads; a fifth one would not be used.
- Mutation after construction. Graphs are built once from an edge list.
  Incremental edits stay out until a study needs them.
- Node and edge payloads. Vertices are `u32` ids; labels and attributes
  live beside the graph, not in it.
