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

Web job: installs the wasm32 target, then `npm ci`, `npm run prepare-assets`
(wasm + data), `npm run typecheck`, `npm run lint`, `npx next build`.

Run the same locally before committing:

```
cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features
cd web && npm run prepare-assets && npm run typecheck && npm run lint && npm run build
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

## Web app

```
cd web
npm install
npm run dev          # builds the wasm + syncs data, then http://localhost:3000
npm run build        # same, then `next build`
npm run wasm         # only rebuild crates/graphman-wasm → src/wasm + public/wasm
npm run data         # only copy studies/results.json → src/data
```

`npm run wasm` needs `cargo` with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`); it downloads the matching
`wasm-bindgen` CLI into `web/.cache` by itself. The observatory needs a
browser with WebGPU (Chrome/Edge, Safari 26+, Firefox 141+).

## Deploying to Vercel

Import the GitHub repository, set **Root Directory** to `web` and keep
"Include source files outside of the Root Directory" enabled (the build
compiles `crates/`). `web/vercel.json` sets `npm ci` / `npm run build`; the
build script installs a minimal Rust toolchain with rustup when `cargo` is
missing, so nothing else is configured. Production deploys track `main`,
previews come from pull requests.

Design rules live in `spec/DESIGN.md`.
