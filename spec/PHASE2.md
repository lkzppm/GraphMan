# Phase 2 and beyond

Part 1 delivered undirected, unweighted graphs with three representations
and a diameter study. Part 2 (`docs/trabalho-P2.pdf`, summarised in
`spec/ASSIGNMENT.md`) is now out and is narrower than first guessed:
**undirected graphs with real weights, and Dijkstra written once over
interchangeable stores of distance estimates** (a vector and a heap with
decrease-key). Direction and flows are left for Part 3. This document
records how the core grew without breaking Part 1 (sections 3 and 4 are
implemented; the case-study runner and the web are next), how Part 2 is
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

## 3. Core growth: weights (implemented)

Part 1 and Part 2 are one library, not two layers: the same `EdgeList`, the
same three representations, the same `AnyGraph`/`dispatch!`, the same
`Visitor`. A weighted file is just a file with a third column.

```
Graph               vertex_count, edge_count, degree, neighbors, has_edge     (unchanged)
Weighted: Graph     weighted_neighbors -> (Vertex, Weight), weight(u, v),
                    is_weighted, negative_edge                                  (Part 2)
Directed: Graph     out_neighbors, in_neighbors, out_degree, in_degree          (Part 3)
```

- **One weight type.** `graphman::Weight = f64`. The plan was a generic
  `Measure` weight; it was dropped because the course's weights are
  arbitrary reals, a type parameter would multiply `AnyGraph` variants and
  monomorphisations for no case study, and Part 3's capacities fit in
  `f64` too. `Build::required_bytes(n, m, weighted)` prices the weights.
- **Every representation is `Weighted`.** An unweighted graph answers
  `UNIT_WEIGHT` (1) for every edge, so `dijkstra` runs on any graph and
  hop counts are the unit-weight special case: Dijkstra on an unweighted
  graph returns the BFS levels (a test checks it). `Build` requires
  `Weighted`, so `dispatch!` reaches Dijkstra like it reaches BFS.
- **Weights are a column beside the adjacency, never inside it.** CSR keeps
  `weights: Vec<f64>` parallel to `targets`; the list keeps a parallel row
  per vertex (`Vec<Vec<f64>>`) rather than `Vec<Vec<(u32, f64)>>`; the
  matrix keeps an `(n+1)²` table beside its bitset (the textbook weight
  matrix, 64 times the bitset: 800 MB at 10 000 vertices, refused by the
  budget beyond). `Graph::neighbors` never reads the column, so BFS, DFS,
  components and the diameter cost exactly what they cost in Part 1, and
  an unweighted graph stores no weights at all.
- **The parser decides once.** The first edge line has two or three
  columns; every other line must match (`ParseError::InconsistentColumns`
  otherwise). Weights are any finite real (`5`, `-9.5`, `1e-3`); NaN and
  infinities are `ParseError::InvalidWeight`, and weights whose sum is not
a finite float are `ParseError::WeightsOverflow` (so no path length can
overflow to infinity and pass for "unreached"). Normalisation is the Part 1
  one on `(u, v, weight)` records: self-loops dropped, `[min, max]`,
  sorted, deduplicated, and **a repeated edge keeps its smallest weight**,
  the only one a shortest path would use. The records are then split into
  the edge array and a parallel weight array (both in anonymous mappings
  when large, like Part 1's edges).
- **Negative weights** are found during normalisation:
  `EdgeList::negative_edge` is the first negative edge in sorted order, and
  every representation keeps it, so the refusal is `O(1)`. A dropped
  self-loop is not part of the graph and does not count. Dijkstra returns
  `NegativeWeight { edge }`, whose message ends "shortest paths with
  negative weights are not implemented yet", as the handout requires. In an
  undirected graph one negative edge `{u, v}` already makes `u v u v ...` a
  walk as short as one likes, so there is no answer to give; worth a line in
  the report. Zero weights are allowed (the handout's "positive" read as
  "non-negative", which is all Dijkstra needs).
- **Vertex names** live beside the graph (section 7): `io::VertexNames`
  reads `index,name` lines (comma, semicolon, tab or spaces; a first line
  that is a count or a header is skipped; Latin-1 is accepted when the file
  is not UTF-8), keeps all names in one `String` with one entry per named
  vertex (sorted, so a stray huge index costs one entry, not a table that
  long) and a name-sorted list for exact lookup by binary search, and offers an
  accent- and case-insensitive `search` for "did you mean" suggestions.
- **`Directed`** (Part 3). `neighbors` on a directed graph means
  out-neighbours, so BFS, DFS and components (weakly connected) work
  unchanged. `in_neighbors` comes from a reverse CSR built on demand and
  cached, since only a few algorithms (reverse search, residual graphs)
  need it.

## 4. Dijkstra for Part 2 (implemented)

### One algorithm, three frontiers

The handout asks for Dijkstra with a vector and with a heap, and asks for
the storage to be abstracted instead of the algorithm written twice. That is
the Part 1 story ("storage is a strategy") one level down, and the slide:

```rust
pub trait Frontier {
    fn reset(&mut self, vertex_count: usize);
    fn decrease(&mut self, v: Vertex, distance: Weight); // insert or lower
    fn pop_min(&mut self) -> Option<(Vertex, Weight)>;   // smallest, then smaller id
    fn kind(&self) -> FrontierKind;
}

pub fn dijkstra_into<G: Weighted, F: Frontier, V: Visitor>(
    graph: &G, root: Vertex, frontier: &mut F, tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeWeight>;
```

- **`VectorFrontier`**: the course's vector, `estimate[v]` per vertex
  (`+∞` outside the frontier); `pop_min` scans all `n` entries, so a run is
  `O(n² + m)`. The scan keeps eight independent running minima that the
  compiler turns into SIMD compares (5× faster than one dependent chain on
  grafo_1, still the full linear scan), merged on `(distance, vertex)`.
- **`HeapFrontier`**: an indexed binary heap written here (no crate):
  `heap: Vec<(Weight, Vertex)>` plus `position: Vec<u32>` per vertex, so
  `decrease` sifts the vertex up from where it is, `O(log n)`; a run is
  `O((n + m) log n)`. This is the "efficient key modification" the handout
  warns about.
- **`LazyHeapFrontier`**: `std::collections::BinaryHeap` without
  decrease-key; lowering pushes a duplicate and stale entries are skipped
  when popped (what `petgraph` does). The yardstick for what decrease-key
  buys.
- `FrontierKind` (`vector`, `heap`, `lazy-heap`) picks one at runtime, like
  `Representation`; `algo::dijkstra(&g, root, kind)` is the one-call form.

First numbers (the Part 1 graphs' edges with uniform weights in `[0, 1]`
from `graphman generate --like`, CSR, release, M5, mean per source):

| Graph | BFS | heap | lazy heap | vector |
|---|---:|---:|---:|---:|
| grafo_1 (10 000) | 0.21 ms | 1.24 ms | 1.85 ms | 18.6 ms |
| grafo_4 (375 000) | 19 ms | 61 ms | 95 ms | 15.9 s |

BFS on the weighted grafo_4 takes the same 19 ms as on the unweighted one
(the weights are a column it never reads). The vector run is `n` scans of
`n` floats, so it grows with `n²`: at 4.8M vertices it would be hours per
source, which is why the study runner needs a budget (below).

### Determinism

Relaxation is strict (`<`) and every frontier breaks ties on the smaller
vertex, so all three settle in the same order and build **the same tree**,
not just the same distances, on every representation. Tests enforce it on
random graphs with small integer weights (many ties), and check every
distance against a Bellman-Ford oracle written in the test.

### Output

`ShortestPathTree` mirrors `SearchTree`: `root`, `distance(v)`,
`parent(v)`, the settle `order` (by distance), `last_settled()` (the
farthest vertex: the weighted eccentricity), `path_to(v)`, raw arrays for
the wasm side, `write_to` (`vertex parent distance` per line, like the
search trees), and a `reset` that only touches what the previous run
touched, so `k` runs from different roots allocate nothing. Settled
vertices are a bitset; a run stopped early by its visitor discards the
tentative estimates, so the tree only ever holds answers.

`Visitor` gained `settle(v, parent, distance) -> Control`;
`shortest_path(g, s, t)` is Dijkstra with a visitor that breaks at `t`.
`SearchTree::path_to` gives BFS paths too.

### CLI (implemented)

```
graphman dijkstra G --from 10 --to 20 30 40 50 60 [--frontier vector|heap|lazy-heap] [--names F] [--json]
graphman distance G --pair 10 20 [--path] [--hops] [--names F]   # weights when the file has them
graphman bench    G --algo dijkstra --frontier vector -n 100
graphman generate --like graphs/grafo_1.txt --weights 0:1 -o grafo_W_1.txt
graphman info     G                                              # + weight_min/max/mean/negative
```

`dijkstra` writes the tree file (`<graph>.dijkstra-<root>.txt`), the
handout's "spanning tree induced by the search", and prints `from to
distance path...` per target on stdout (names on stderr with `--names`).
Vertices are ids or exact names; a near miss lists the closest names.

### Still to do

- **Case-study runner.** `graphman study` on a weighted file: the 10 →
  20..60 table, the `k = 100` mean per frontier (same SplitMix64 roots as
  Part 1) with a `--dijkstra-budget <seconds>` for the vector (when it runs
  out, the cell records how many runs finished and their mean, flagged, the
  honest-cell treatment of the Part 1 matrix refusals), and the
  collaboration-network table with names. `petgraph::algo::dijkstra` as a
  baseline column (dev/bench-only dependency).
- **Web.** Done in the observatory: Dijkstra as a third search with a
  vector/heap switch, distance bands for colour and chart, the refusal as a
  notice, weight chips. Still open there: edges tinted by weight, and the
  names file (hover, a search box, "Dijkstra to Turing"), whose wasm glue
  (`setNames`, `vertexNamed`, `searchNames`) is in place. The Library page: chapters for the
  `weights`, `dijkstra`, `frontiers` and `names` blocks already proved in
  `tests/wiki.rs`. Studies and presentation: the Part 2 tables and the
  "one Dijkstra, three frontiers" slide.

### The rest of the plan (beyond what Part 2 grades)

| Algorithm | Notes |
|---|---|
| A* / best-first | the same driver, the frontier keyed by distance plus a heuristic |
| Bellman-Ford | negative weights; on undirected graphs it can only report the negative cycle (section 3) |
| Minimum spanning tree | Prim over `HeapFrontier`; Kruskal with a union-find |
| Weighted eccentricity, diameter | iFUB and Takes-Kosters hold for any non-negative metric with Dijkstra in place of BFS |

Part 3 adds `Directed`, then `Flow` (Ford-Fulkerson with BFS augmenting
paths, then Dinic) on top of `Directed + Weighted`, using the cached
reverse CSR for the residual graph.

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
