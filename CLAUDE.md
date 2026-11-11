# GraphMan — guide for coding agents

GraphMan is a graph library + CLI in Rust and a web "observatory" in Next.js,
built for the COS 242 (Graph Theory, UFRJ) course project. Part 1 (done)
covers undirected graphs: two representations, BFS/DFS, distances,
diameter, connected components and a benchmark study. Part 2 (done) adds
real edge weights and Dijkstra over interchangeable frontiers (vector,
decrease-key heaps and more). Part 3 (current scope, `spec/PHASE3.md`)
adds direction, Bellman-Ford over interchangeable schedules (with the
negative cycle as a certificate) and Floyd-Warshall over interchangeable
sweeps, on the same core, so keep the `Graph` trait small and the
algorithms generic.
The DBLP tab rebuilds the course's collaboration network from the
monthly DBLP dump (`graphman dblp`, a GitHub Action, GitHub Pages).

Everything in the repo is in English. The presentation and report are in
Portuguese (the course language), but code, comments, docs and commits are
English. The web site's interface is bilingual (Portuguese by default,
English by a switch): every visible string lives in `web/src/i18n/`
(`en.tsx` is the schema, `pt.tsx` must match it), never inline in a
component. Never use the em dash (—) in anything the visitor reads, site
or slides: a comma, a colon or a full stop takes its place.

## Read these first

- `spec/ASSIGNMENT.md` — what the course requires (translated summaries of
  `docs/trabalho-P1.pdf`, `docs/trabalho-P2.pdf` and `docs/trabalho-P3.pdf`)
  and the case-study questions.
- `spec/ARCHITECTURE.md` — how the Rust crates and the web app are organised,
  the design decisions worth presenting, and the data formats.
- `spec/WORKFLOW.md` — git flow, commit style, CI, how to run studies and
  regenerate the web data.
- `spec/DESIGN.md` — the design system: white + greys + one blue, tracked
  capitals, mono numbers, accent-edged surfaces, the shakable mark (a
  Golem-inspired voice), canvas colours.
- `spec/PHASE2.md` — the Part 2 design (weights, the `Frontier` trait behind
  both Dijkstras, vertex names, the study runner), direction for Part 3, and
  the planned `petgraph` bridge (test oracle now, shared traits later).
- `spec/PHASE3.md` — the Part 3 design: direction as a flag plus a
  transpose, Bellman-Ford over a `Schedule`, Floyd-Warshall over a
  `SweepKind`, Johnson, SCC, the study runner and the order of work.

## Layout

```
crates/graphman/       core library (no CLI concerns, wasm-friendly)
crates/graphman-cli/   `graphman` binary: commands + the case-study runner
crates/graphman-wasm/  wasm-bindgen bindings of the library for the browser
web/                   Next.js site: landing page + the observatory (vgpu / WebGPU)
studies/               case-study outputs (results.json, RESULTS.md, per-graph JSON)
samples/               small committed graphs (handout figures, weighted, a named network)
graphs/                course input graphs (gitignored, 100 MB–700 MB each)
docs/                  course handouts (Portuguese) and the report
spec/                  project knowledge for humans and agents
assets/                brand assets (logo PNG/JPG + the SVG logo and one-colour mark)
.github/workflows/     ci.yml (CI) and dblp.yml (the monthly DBLP build); scripts/dblp-site.mjs
```

## Commands

```
cargo test                                  # unit + integration + doc tests
cargo clippy --all-targets -- -D warnings   # must be clean (CI enforces)
cargo fmt --all
cargo build --release                       # binary at target/release/graphman
graphman study graphs/grafo_1.txt --out studies   # case studies → JSON + RESULTS.md
graphman study G --directed --out studies         # Part 3: Bellman-Ford, Floyd-Warshall, all pairs
graphman dijkstra samples/weighted_100.txt --from 10 --to 20 30 --frontier vector
graphman bellman-ford G --directed --to 100 --from 10 20 30 --schedule queue   # Part 3: distances to a target
graphman bellman-ford G --directed --negative-cycle                            # the whole-graph question
graphman floyd-warshall G --directed --pairs 10 20 30 40 50 --sweep blocked    # all pairs, one table
graphman dblp dblp.xml.gz --out graphs --years 2009   # the DBLP dump → rede_colaboracao.txt + names, whole and up to 2009
graphman dblp dblp.xml.gz --out out --gzip --site by-year   # plus the site layout: one file per year
cd web && pnpm install && pnpm run dev      # builds the wasm, syncs data, starts Next.js
cd web && pnpm run typecheck && pnpm run lint # must be green (CI enforces)
```

## Rules

- Never commit directly to `main`. Work on `feat/*` or `fix/*` from `dev`, use
  the `/commit` skill to commit and the `/merge` skill to open PRs (CI gates).
- Keep `cargo clippy -D warnings`, `cargo fmt --check`, `pnpm run typecheck`
  and `pnpm run lint` green before committing. `web/src/wasm`, `web/public/wasm`
  and `web/src/data` are generated (`pnpm run prepare-assets`), never edited.
- Vertices are 1-based (`1..=n`, as in the input files); `0` is `NO_VERTEX`.
- Algorithms are generic over `Graph` (or `Weighted` when they read
  weights); never write an algorithm for one representation. Use
  `dispatch!` on `AnyGraph` at the CLI boundary only.
- Weights are a column beside the adjacency (`Weight = f64`); `Graph`
  never reads it, and an unweighted graph answers 1 per edge. Dijkstra is
  written once (`dijkstra_into`) over a `Frontier`; a new way of keeping
  estimates is a new `Frontier`, never a second Dijkstra. Every frontier
  must break ties on the smaller vertex so the trees stay identical.
- The wasm crate is glue only: no algorithms there, and it must build with
  `default-features = false` (no mmap, no rayon).
- The observatory computes everything client-side from the uploaded file:
  no pre-exported data, no server.
- The DBLP tab is one console (`web/src/components/DblpConsole.tsx`), not
  a second observatory: it fetches the monthly build from the repository's
  GitHub Pages (`web/src/lib/dblp.ts`), never from dblp.org or from release
  assets (neither sends CORS headers; DBLP's live API sits behind an
  anti-bot challenge). The build is laid out one file per year
  (`graphman dblp --site`: the papers each pair shared that year, the
  researchers first seen that year); the page fetches the years up to the
  chosen one and sums them in wasm (`NetworkBuilder`), so any year is
  selectable and the weights match the CLI's. Files above 95 MB are split
  into parts by `.github/scripts/dblp-site.mjs` and the manifest says so; the
  page stitches them back. The year's network is held in wasm and cut with
  `algo::select` + `algo::induce` (ball, most connected, or whole) or
  `algo::egonet` (radius k around a researcher); the cut goes to the
  observatory in memory (`lib/handoff.ts`) or is exported. A last mode
  replaces the cut with the shortest path between two researchers
  (`Graph.shortestPath`), shown by the `Observatory` component itself through
  its `embed` prop, never a second canvas; the right box opens or exports it.
- The collaboration builder (`graphman::io::collaboration`) takes papers
  (year, author names) from any source; DBLP's XML and gzip stay in the CLI.
  An edge weighs `1 / shared papers`, as the professor defines it (so at most
  1); the course's 2009 file follows an older rule and the studies read that
  file as it is.
- The library page's code examples live in `crates/graphman/tests/wiki.rs`
  (blocks between `// wiki:start <id>` and `// wiki:end`, extracted by
  `web/scripts/sync-data.mjs`); change them there, never in the web code,
  so the page only ever shows what `cargo test` has run.
- Direction is data, not a type: `Graph::is_directed`, `neighbors` means
  out-neighbours, and an arc goes from the first vertex of a line to the
  second. Anything that needs in-arcs runs on `Build::transpose` (an
  undirected graph is its own). Bellman-Ford is written once
  (`bellman_ford_into`) over a `Schedule`; a new order of re-examining
  vertices is a new `Schedule`, never a second Bellman-Ford. Its negative
  cycles are returned as the cycle, not a boolean. Floyd-Warshall keeps
  one `n × n` table updated in place and is priced and refused by the
  memory budget like the matrix.
- Every representation keeps neighbour rows ascending; tests rely on all
  representations producing identical search trees.
- Timings in studies exclude parsing and file output (course rule).
- The course graphs are random graphs, which are the worst case for the smart
  diameter algorithms; report BFS counts honestly rather than tuning for them.
