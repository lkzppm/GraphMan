# Architecture

## Crates

### `graphman` (core library)

```
src/lib.rs            crate docs and re-exports
src/graph/            Graph trait, Build trait, MemoryBudget, AnyGraph + dispatch!
  adjacency_list.rs   Vec<Vec<Vertex>>            O(n + m) words
  csr.rs              offsets + targets arrays     O(n + m) words, contiguous
  adjacency_matrix.rs packed bitset, n×n bits      O(n²) bits, BitRow iterator
src/io/
  edge_list.rs        parser for the course format → normalised EdgeList
  summary.rs          the "output" file (counts, degree stats, components)
src/algo/
  traversal.rs        SearchTree, Visitor, bfs*, dfs*
  distance.rs         distance (BFS with early exit), eccentricity
  components.rs       Components (largest first, deterministic numbering)
  diameter.rs         Exact, IFub, Bounds (Takes–Kosters), Sweep; cancellable
  stats.rs            DegreeStats (counting-sort median)
  layout.rs           radial layout derived from a search tree (O(n))
src/metrics/memory.rs process RSS / footprint / peak / total memory (macOS, Linux)
```

Design decisions worth presenting:

1. **Storage is a strategy.** `Graph` is a five-method trait with a GAT
   `Neighbors<'a>` iterator. Every algorithm is written once, generically, and
   monomorphised per representation: no virtual calls in the inner loops, and
   swapping the representation cannot change a result. `AnyGraph` + the
   `dispatch!` macro turn a runtime choice into one `match` at the CLI edge.
2. **Normalise once.** `EdgeList` drops self-loops, orients edges as
   `[min, max]`, sorts and dedups. Because the list is sorted, every builder
   produces ascending neighbour rows for free, which is what makes BFS/DFS
   trees identical across representations (tests enforce it). Large edge
   lists live in an anonymous memory mapping so the memory they used goes
   back to the OS the instant the representation is built (heap allocators,
   macOS especially, keep freed blocks).
3. **Traversals are observable.** `bfs_into`/`dfs_into` take a `Visitor`
   (discover / level_complete / finish, all defaulted) and return `Control`
   to stop early. `distance` is a BFS with a `StopAt` visitor; the observatory
   frames are another visitor. DFS is iterative with a stack of neighbour
   iterators, so it produces the recursive tree with O(depth) memory.
4. **Nothing is allocated twice.** `SearchTree::reset` only touches the
   vertices the previous search reached, so thousands of BFS runs (the
   diameter algorithms) cost no allocations and no O(n) clears.
5. **Memory budget.** Builders compute `required_bytes` up front and refuse
   (with a typed error) anything over the machine's physical memory unless
   forced. A 375 000-vertex bitset matrix is 17.6 GB; this is what turns a
   swap death into a table cell.
6. **Diameter, four ways.** The driver walks components largest-first and
   skips any component too small to beat the current best. Exact methods are
   seeded with a 4-sweep of every relevant component. Bounds (Takes–Kosters)
   runs one batch of BFS per round in parallel with rayon. Every method is
   cancellable through the progress callback and then reports a flagged lower
   bound, which is how the study handles the 4.8M-vertex graphs.

Features: `mmap` (memory-mapped file loading and anonymous edge store),
`parallel` (rayon), `serde` (serialisable results). The core has no CLI or
terminal dependencies so that it can be compiled to WebAssembly later.

### `graphman-cli` (binary `graphman`)

```
src/main.rs           clap: one subcommand per module in commands/
src/load.rs           GraphArgs (path, --repr, --force), timed parse/build
src/ui.rs             stderr reporter, progress bars, byte/duration formatting
src/rng.rs            SplitMix64, distinct random roots
src/report.rs         serde types of every measurement (Timing, MemoryReport, GraphStudy…)
src/commands/
  info, bfs/dfs (search.rs), distance, diameter, components   the assignment's features
  bench      time BFS/DFS from N distinct random roots
  memory     RSS after loading one representation (run in a subprocess by `study`)
  study      the case-study runner: JSON per graph + merged results.json + RESULTS.md
  export     BFS/DFS layouts for the observatory (.gmo + .json)
```

All decorative output goes to stderr; stdout carries results (`--json` where
available) so the commands compose.

## Web (`web/`)

Vite + React 19 + TypeScript, `motion` for transitions, a hand-written
WebGL2 renderer for the observatory (millions of points and tree edges in
two draw calls). No chart library: charts are small React/SVG components
following the dataviz guidance and the design tokens.

Sections (one page, alternating tiles): Hero → Observatory (dark) → Anatomy
(parchment) → Case studies (white) → Footer (parchment).

### `.gmo` layout format (little endian)

```
"GMO1"            magic
u32 vertex_count  n
u32 root
u32 max_level     deepest reached level
u32 reached       vertices reached from the root
u32 kind          0 = BFS, 1 = DFS
f32 angle[n]      polar angle of vertex i+1 (unreached: golden-angle hash)
u32 level[n]      level of vertex i+1 (0xFFFFFFFF = unreached)
u32 parent[n]     parent of vertex i+1 (0 = none)
```

The renderer computes `radius = f(level / max_level)` in the vertex shader,
so BFS (linear rings) and DFS (very deep trees, compressed radially) share
one buffer layout, and switching between them is a shader-side morph.

### Data files

`web/public/data/manifest.json` (generated by `npm run data`) lists the
exported graphs; `results.json` is a copy of `studies/results.json`.
