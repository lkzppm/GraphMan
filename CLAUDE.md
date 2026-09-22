# GraphMan — guide for coding agents

GraphMan is a graph library + CLI in Rust and a web "observatory" in Next.js,
built for the COS 242 (Graph Theory, UFRJ) course project. Part 1 (this
repo's current scope) covers undirected graphs: two representations,
BFS/DFS, distances, diameter, connected components and a benchmark study.
Parts 2 and 3 will add weighted/directed graphs and flows on top of the same
core, so keep the `Graph` trait small and the algorithms generic.

Everything in the repo is in English. The presentation and report are in
Portuguese (the course language), but code, comments, docs and commits are
English. The web site's interface is bilingual (Portuguese by default,
English by a switch): every visible string lives in `web/src/i18n/`
(`en.tsx` is the schema, `pt.tsx` must match it), never inline in a
component. Never use the em dash (—) in anything the visitor reads, site
or slides: a comma, a colon or a full stop takes its place.

## Read these first

- `spec/ASSIGNMENT.md` — what the course requires (translated summary of
  `docs/trabalho-P1.pdf`) and the case-study questions.
- `spec/ARCHITECTURE.md` — how the Rust crates and the web app are organised,
  the design decisions worth presenting, and the data formats.
- `spec/WORKFLOW.md` — git flow, commit style, CI, how to run studies and
  regenerate the web data.
- `spec/DESIGN.md` — the design system: white + greys + one blue, tracked
  capitals, mono numbers, accent-edged surfaces, the shakable mark (a
  Golem-inspired voice), canvas colours.

## Layout

```
crates/graphman/       core library (no CLI concerns, wasm-friendly)
crates/graphman-cli/   `graphman` binary: commands + the case-study runner
crates/graphman-wasm/  wasm-bindgen bindings of the library for the browser
web/                   Next.js site: landing page + the observatory (vgpu / WebGPU)
studies/               case-study outputs (results.json, RESULTS.md, per-graph JSON)
graphs/                course input graphs (gitignored, 100 MB–700 MB each)
docs/                  course handouts (Portuguese) and the report
spec/                  project knowledge for humans and agents
assets/                brand assets (logo PNG/JPG + the SVG logo and one-colour mark)
```

## Commands

```
cargo test                                  # unit + integration + doc tests
cargo clippy --all-targets -- -D warnings   # must be clean (CI enforces)
cargo fmt --all
cargo build --release                       # binary at target/release/graphman
graphman study graphs/grafo_1.txt --out studies   # case studies → JSON + RESULTS.md
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
- Algorithms are generic over `Graph`; never write an algorithm for one
  representation. Use `dispatch!` on `AnyGraph` at the CLI boundary only.
- The wasm crate is glue only: no algorithms there, and it must build with
  `default-features = false` (no mmap, no rayon).
- The observatory computes everything client-side from the uploaded file:
  no pre-exported data, no server.
- The library page's code examples live in `crates/graphman/tests/wiki.rs`
  (blocks between `// wiki:start <id>` and `// wiki:end`, extracted by
  `web/scripts/sync-data.mjs`); change them there, never in the web code,
  so the page only ever shows what `cargo test` has run.
- Every representation keeps neighbour rows ascending; tests rely on all
  representations producing identical search trees.
- Timings in studies exclude parsing and file output (course rule).
- The course graphs are random graphs, which are the worst case for the smart
  diameter algorithms; report BFS counts honestly rather than tuning for them.
