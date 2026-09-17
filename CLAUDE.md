# GraphMan — guide for coding agents

GraphMan is a graph library + CLI in Rust and a web "observatory" in React,
built for the COS 242 (Graph Theory, UFRJ) course project. Part 1 (this
repo's current scope) covers undirected graphs: two representations,
BFS/DFS, distances, diameter, connected components and a benchmark study.
Parts 2 and 3 will add weighted/directed graphs and flows on top of the same
core, so keep the `Graph` trait small and the algorithms generic.

Everything in the repo is in English. The presentation and report are in
Portuguese (the course language), but code, comments, docs and commits are
English.

## Read these first

- `spec/ASSIGNMENT.md` — what the course requires (translated summary of
  `docs/trabalho-P1.pdf`) and the case-study questions.
- `spec/ARCHITECTURE.md` — how the Rust crates and the web app are organised,
  the design decisions worth presenting, and the data formats.
- `spec/WORKFLOW.md` — git flow, commit style, CI, how to run studies and
  regenerate the web data.
- `spec/DESIGN.md` — GraphMan's own design system: paper/graphite scenes, one
  signal blue, liquid and metal motion, chart rules.

## Layout

```
crates/graphman/       core library (no CLI concerns, wasm-friendly)
crates/graphman-cli/   `graphman` binary: commands + the case-study runner
web/                   Vite + React + TypeScript observatory and presentation site
studies/               case-study outputs (results.json, RESULTS.md, per-graph JSON)
graphs/                course input graphs (gitignored, 100 MB–700 MB each)
docs/                  course handouts (Portuguese) and the report
spec/                  project knowledge for humans and agents
assets/                brand assets (logo)
```

## Commands

```
cargo test                                  # unit + integration + doc tests
cargo clippy --all-targets -- -D warnings   # must be clean (CI enforces)
cargo fmt --all
cargo build --release                       # binary at target/release/graphman
graphman study graphs/grafo_1.txt --out studies   # case studies → JSON + RESULTS.md
graphman export graphs/grafo_1.txt --out web/public/data   # observatory data
cd web && npm install && npm run dev        # web app
```

## Rules

- Never commit directly to `main`. Work on `feat/*` or `fix/*` from `dev`, use
  the `/commit` skill to commit and the `/merge` skill to open PRs (CI gates).
- Keep `cargo clippy -D warnings`, `cargo fmt --check` and `npm run lint`
  green before committing.
- Vertices are 1-based (`1..=n`, as in the input files); `0` is `NO_VERTEX`.
- Algorithms are generic over `Graph`; never write an algorithm for one
  representation. Use `dispatch!` on `AnyGraph` at the CLI boundary only.
- Every representation keeps neighbour rows ascending; tests rely on all
  representations producing identical search trees.
- Timings in studies exclude parsing and file output (course rule).
- The course graphs are random graphs, which are the worst case for the smart
  diameter algorithms; report BFS counts honestly rather than tuning for them.
