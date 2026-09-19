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
   to stop early. `distance` is a BFS with a `StopAt` visitor; anything else (frame
   capture, cancellation) is another listener. DFS is iterative with a stack of neighbour
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
terminal dependencies, which is what lets `graphman-wasm` compile it to
WebAssembly with the default features off.

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
```

All decorative output goes to stderr; stdout carries results (`--json` where
available) so the commands compose.

### `graphman-wasm` (the library in the browser)

`crates/graphman-wasm` is a thin `wasm-bindgen` layer over the core crate,
built with `default-features = false` (no `mmap`: there are no files; no
`parallel`: no threads without `SharedArrayBuffer`). It exposes one `Graph`
class per uploaded file: parse + build a `Csr`, `search(kind, root)` →
parents / levels / discovery ranks / level sizes / the assignment's text
output, `distance`, `diameter(kind, bfsBudget)` (cancellable through the
library's progress callback), degree statistics, components, and
`initialLayout()`: a BFS-radial layout per component (rings whose area is
proportional to the number of vertices on them), components packed largest
first on concentric rings; and `layout(kind, root)` for the canvas menu —
`Radial` (BFS levels from `root` as evenly spaced rings, subtrees in
wedges), `Layered` (levels as rows, level 0 on top, a vertex's x from its
wedge angle so subtrees stay contiguous) and `Degree` (one circle, sorted
by degree), the root's component at the origin and the others packed
around it with the same disc packing. All O(n + m). Every per-vertex array is indexed by vertex id
with slot 0 unused, like the library's raw arrays, so GPU buffers are
indexed by vertex id directly. Timings use `performance.now()` around the
traversal only.

`web/scripts/build-wasm.mjs` compiles it (`--profile wasm`: release without
debug info) and runs the `wasm-bindgen` CLI pinned to the crate version in
`Cargo.lock` (downloaded as a prebuilt release into `web/.cache`). Output:
`web/src/wasm/graphman.{js,d.ts}` (glue, imported by `src/lib/graphman.ts`)
and `web/public/wasm/graphman.<hash>.wasm` (fetched at runtime; the name
carries a content hash because `/wasm` is served as immutable, and
`src/wasm/manifest.ts` exports the URL). All of it is
gitignored and rebuilt by `npm run prepare-assets`, which `npm run dev` and
`npm run build` trigger. On a machine without Rust in CI or Vercel the
script installs a minimal toolchain with rustup first.

## Web (`web/`)

Next.js 16 (App Router, Turbopack), React 19, TypeScript, CSS modules, the
`geist` fonts, `lucide-react` and `simple-icons` for icons, and `vgpu`
(Vercel's WebGPU library) for the observatory. No chart or effect
libraries. Deployed on Vercel with the root directory set to
`web/`; `web/vercel.json` pins the install and build commands.

```
src/app/layout.tsx, globals.css   fonts, metadata, the LocaleProvider, the shared tabbed Nav, design tokens
src/app/page.tsx                  Home tab: Hero + Pipeline
src/app/library/, studies/        Library tab (Decisions), Case studies tab (tables)
src/app/presentation/             Presentation tab: the five slides (Deck)
src/app/observatory/              the tool, client-only (dynamic import, ssr: false)
src/components/                   Nav, Logo, BrandIcon, Reveal, Deck, Representations, Field, page sections + CSS modules
src/i18n/                         en.tsx (the schema), pt.tsx, LocaleProvider (useT / useLocale)
src/lib/graphman.ts               loads the wasm glue once
src/lib/studies.ts                types of studies/results.json (synced into src/data)
src/lib/format.ts                 number formatting
src/observatory/Observatory.tsx   state, file loading, pointer interaction, panels
src/observatory/renderer.ts       vgpu: buffers, compute step, node + edge draws
src/observatory/shaders.ts        WGSL (plain strings, reflected by vgpu)
```

### Languages

The site speaks Portuguese by default and English on request. All prose is
in `src/i18n/`: `en.tsx` is a plain object (strings, small JSX fragments
where a sentence carries a `<code>`, and functions where a sentence takes
a value, so word order stays the language's business); `Dictionary =
typeof en`, and `pt.tsx` is typed as one, so a missing key is a type error.
`LocaleProvider` keeps the choice in `localStorage` behind
`useSyncExternalStore` (the server and the hydrating client render the
default, the stored choice applies right after, no mismatch) and sets
`<html lang>`; components call `useT()` and hold no text of their own.
Page `metadata` (titles, descriptions) is static and Portuguese. Code,
comments, docs and commits stay English.

### The observatory

Everything happens in the tab: the page starts empty, a dropped file is
parsed by the wasm `Graph`, and the renderer receives:

- `positions` — a `pingPongStorage` pair of `vec2f` per vertex, seeded with
  the Rust initial layout; `velocities`, and `anchors` (each vertex's
  component centre, the gravity target);
- `edges` (`[u, v]` pairs), `csrOffsets` / `csrTargets` (the springs);
- `levels`, `ranks`, `parents` — the current search tree, `UNREACHED`
  when there is none.
- `labels` — the component id of every vertex, so a `component` uniform
  can light one component and dim the rest (node and edge shaders). The
  CSR rows are bound to the draws too: the node shader finds the
  neighbours of the selected vertex with a binary search of its row, and
  the edge draw appends the selected vertex's row as extra segments so
  its edges are lit whatever the sampling stride.

Per frame: if the simulation is warm or a vertex is being dragged, one
compute dispatch (`SIM_SHADER`, 256-wide workgroups) does a d3-style step —
exact many-body repulsion tiled through workgroup memory, springs along the
CSR rows biased towards the lower-degree endpoint, weak gravity towards the
component anchor, Verlet integration with 0.6 velocity decay, alpha cooling
over 300 steps — and pins the dragged vertex; then the edges are drawn
(`line-list`, endpoints looked up in storage) and the vertices (instanced
quads, disc SDF in the fragment shader). One `uniforms()` block (`View`:
camera, viewport, radius, reveal cursor, hovered/selected ids, theme
colours, the level-of-detail strides and fades) feeds every draw.

The course graphs have millions of edges (grafo_2: 1.3M, grafo_4: 8.2M),
and drawing them all every frame is what used to freeze the tab, so the
renderer does three things:

- **Frames are drawn only when something changed** (a `dirty` flag set by
  every setter; an untouched canvas keeps its last image).
- **The edges live in their own layer**, an `rgba16float` offscreen target
  redrawn only when the camera, the positions or the search change, and
  composited under the vertices with a fullscreen `effect()`. Hovering or
  selecting a vertex therefore redraws the vertices only.
- **Level of detail.** Per frame the edge draw covers every `stride`-th
  plain edge and every `treeStride`-th tree edge (two draws over the same
  buffer, a `Kind` uniform telling them apart) and the vertex draw every
  `nodeStride`-th vertex plus the hovered and the selected one; only the
  sampled elements are submitted, so what is culled costs nothing. While
  the picture moves the strides come from budgets (200 000 edges, 1M
  vertices per frame); once it has been still for 120 ms a "settled" frame
  draws the resting sample. The resting sample is not always everything:
  `measure()` estimates, from the densest big component (edges over the
  area its layout occupies, mean edge length; measured again for every
  layout change), how many edges cross a pixel at the
  current zoom, and `fades()` scales the edge alpha so the pile adds up to
  a readable grey (`EDGE_COVERAGE`) instead of a black disc; edges too
  faint for half-float blending (`MIN_EDGE_ALPHA`) are instead drawn as a
  stronger sample. Vertices that pile more than three deep on a pixel are
  sampled too. Zooming in thins the piles and brings everything back.

With this grafo_2 loads in a quarter of a second and pans, zooms and plays
a search at 60 fps; grafo_4 (105 MB) the same; grafo_5 (4.8M vertices,
205 MB) is usable.

The CPU keeps a mirror of the positions (one `read()` in flight at a time
while they change) for picking: hover and click scan for the nearest
vertex within 10 px, drags write the pointer's world position into the
`Params` uniform. Graphs above 30 000 vertices skip the O(n²) repulsion,
open in the `Radial` layout (rooted in the largest component) and stay
draggable (the compute step still runs in "static" mode).

A layout change (`morphTo`) uploads the target positions and slides every
vertex there over 700 ms with a small compute pass (`MORPH_SHADER`, eased
on the CPU), the simulation cooled meanwhile; the force layout returns to
`initialLayout()` and warms the simulation up again, the other layouts
switch it off (it can be turned on to relax them). The level layouts
follow the search: a new origin re-arranges the graph around it and the
view frames the origin's component.

Searches come back from wasm as typed arrays and are uploaded as-is; the
animation is the `reveal` uniform sweeping over discovery ranks at `rate`
ranks per second: the shaders derive each vertex's age since discovery from
those two numbers (pop + halo on vertices, draw-in + flash on tree edges).
A distance query is the same traversal (BFS for the shortest path, DFS
for the tree path): the path is read back along the parents on the CPU,
the timeline spans only the ranks up to the target, and the target and
path go to the renderer (`setPath`) — a `dest` uniform (WGSL reserves
`target`) colours the two ends and shrinks everything off the path, a
`mute` uniform greys the rest of the traversal on request, and the path
itself is a small buffer read by the node draw (its vertices as extra
instances) and by `PATH_SHADER`, one instanced quad per edge, drawn
after the edge samples so it sits on top. The sidebar's counts for a
distance query are cut at the target's discovery rank. The selected
vertex's edges and the path's are the *extras*: `[a, b]` pairs the CPU
builds (`updateExtras`) that a third edge draw (`Kind 2`) renders after the
plain and tree draws, so they sit on top and no stride can drop them; the
node draw appends the path's vertices as instances the same way. The edge
shader stays within WebGPU's default eight storage buffers per vertex
stage, which is why the extras are built on the CPU rather than read from
the CSR rows in the shader.

### Data

`studies/results.json` is copied to `web/src/data/results.json` by
`scripts/sync-data.mjs` (Turbopack only bundles files under `web/`) and
rendered as tables at build time.

### Timing in the browser

The observatory shows the time of the single BFS/DFS run, measured in the
wasm crate with `performance.now()` around the traversal. Browsers coarsen
that clock unless the page is cross-origin isolated, so `next.config.ts`
sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` on every route: the resolution
goes from 100 µs to 5 µs in Chrome and from 1 ms to 20 µs in Safari and
Firefox. Everything the site loads is same-origin, so nothing is blocked
by it; a future cross-origin embed (analytics, images) would need CORP
headers or `crossorigin` attributes.
