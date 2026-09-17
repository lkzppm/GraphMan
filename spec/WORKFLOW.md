# Workflow

## Git flow

- `main` — presentable state only; every merge into it comes from `dev`.
- `dev` — integration branch. Feature and fix branches start here.
- `feat/<topic>`, `fix/<topic>` — one topic per branch, short-lived.
- Commit with the `/commit` skill (conventional commits: `feat:`, `fix:`,
  `docs:`, `chore:`, `refactor:`, `perf:`, `test:`, `ci:`).
- Merge with the `/merge` skill: it opens a pull request and arms auto-merge,
  so the merge lands only when CI is green.
- Never push directly to `main`.

## CI (`.github/workflows/ci.yml`)

Rust job: `cargo fmt --check`, `cargo clippy --all-targets --all-features
-D warnings`, `cargo test --all-features`, `cargo doc` with warnings denied,
and a smoke test of the release CLI on the Figure 1 graph.

Web job: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`.

Run the same locally before committing:

```
cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features
cd web && npm run typecheck && npm run lint && npm run build
```

## Case studies

```
cargo build --release
./target/release/graphman study graphs/grafo_1.txt graphs/grafo_2.txt graphs/grafo_3.txt --out studies
./target/release/graphman study graphs/grafo_4.txt --out studies --diameter-budget 900
./target/release/graphman study graphs/grafo_5.txt graphs/grafo_6.txt --out studies --diameter-budget 600
```

Every graph writes `studies/<name>.json`; each run re-merges every JSON in
`studies/` into `studies/results.json` and `studies/RESULTS.md`. Memory is
measured in a fresh subprocess per representation (`graphman memory`), so
representations never pollute each other. Run studies on an otherwise idle
machine: the BFS/DFS means are single-threaded wall-clock timings.

Useful knobs: `--runs 100` (searches per representation), `--seed 42`,
`--reprs list,matrix,csr`, `--exact-limit 400000` (skip brute force above
this many vertices), `--diameter-budget <seconds>` (per exact method; when it
runs out the best lower bound so far is recorded and flagged).

## Observatory data

```
./target/release/graphman export graphs/grafo_1.txt --out web/public/data
cd web && npm run data        # refreshes manifest.json and results.json
```

`export` writes `<name>.bfs.gmo`, `<name>.dfs.gmo` (binary layouts, see
`spec/ARCHITECTURE.md`) and `<name>.json` (metadata). The `.gmo` files are
gitignored (tens of MB for the large graphs); regenerate them locally or in
the deployment step.

## Web app

```
cd web
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/
```

Design rules live in `spec/DESIGN.md`. In short: one accent colour
(`#0066cc`, `#2997ff` on dark tiles), display type at weight 600 with tight
tracking, body at 17px, alternating white/parchment/near-black tiles, pill
CTAs, no decorative gradients, a single drop-shadow reserved for the product
image.
