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

Web job: installs the wasm32 target, then `pnpm install --frozen-lockfile`, `pnpm run prepare-assets`
(wasm + data), `pnpm run typecheck`, `pnpm run lint`, `pnpm exec next build`.

Run the same locally before committing:

```
cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features
cd web && pnpm run prepare-assets && pnpm run typecheck && pnpm run lint && pnpm run build
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

`--only` runs some sections and keeps the rest of the graph's previous JSON,
so one table can be refreshed without repeating an hour of diameter. The
Part 1 sections are `memory`, `searches` (BFS, iterative DFS and recursive
DFS means), `trees` (the parents, plus a check that the recursive DFS built
the iterative one's tree), `distances`, `components` and `diameter`:

```
./target/release/graphman study graphs/grafo_*.txt --out studies --only searches,trees
```

## Weighted graphs (Part 2)

The weighted course files are not out yet; until they are, `samples/` has
the handout's figures, a 100-vertex weighted graph and a synthetic named
network (see `samples/README.md`), and `graphman generate --like
graphs/grafo_N.txt --weights 0:1 -o grafo_W_N.txt` puts random weights on a
Part 1 graph. The mechanisms:

```
graphman dijkstra G --from 10 --to 20 30 40 50 60 --frontier heap     # tree file + paths
graphman bench G --algo dijkstra --frontier vector -n 100            # mean per source
graphman dijkstra R --names R_names.txt --from "Edsger W. Dijkstra" --to "Alan M. Turing"
```

The vector frontier is `O(n²)` per source: fine up to grafo_2's 50 000
vertices, about 16 s per source at 375 000 and hours at 4.8M.

The study runner answers the Part 2 questions on any weighted file (a
weighted file gets the Part 2 sections, `paths` and `frontiers`, by
default; `--only` picks either):

```
./target/release/graphman study graphs/weighted/*.txt --out studies --dijkstra-budget 600
./target/release/graphman study R.txt --names R_names.txt --out studies --only paths \
    --from "Edsger W. Dijkstra" \
    --to "Alan M. Turing" "J. B. Kruskal" "Jon M. Kleinberg" "Éva Tardos" "Daniel R. Figueiredo"
```

- `paths`: one Dijkstra from `--from` (default 10), then the distance and
  path to each of `--to` (default 20 30 40 50 60). Ids or exact names.
- `frontiers`: the mean of one single-source Dijkstra per frontier
  (`--frontiers vector,heap,lazy-heap`) over `--runs` sources drawn with the
  Part 1 seed, on `--dijkstra-repr csr`. Each frontier has
  `--dijkstra-budget` seconds: when they run out, the cell keeps the runs
  that finished and says so; when none finished, the run that was cut short
  gives an estimate (its time scaled to its root's component, close to exact
  for the vector, whose every step scans all `n` estimates). Rerunning one
  frontier (`--only frontiers --frontiers vector`) keeps the others.

Results go to `studies/weighted/<name>.json`, merged into
`studies/weighted/results.json` and a "Part 2" block of `studies/RESULTS.md`.
A file with a negative weight records the library's refusal instead.

## Web app

```
cd web
pnpm install
pnpm run dev         # builds the wasm + syncs data, then http://localhost:3000
pnpm run build       # same, then `next build`
pnpm run wasm        # only rebuild crates/graphman-wasm → src/wasm + public/wasm
pnpm run data        # only copy studies/results.json and the wiki examples → src/data
```

`pnpm run wasm` needs `cargo` with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`); it downloads the matching
`wasm-bindgen` CLI into `web/.cache` by itself. The observatory needs a
browser with WebGPU (Chrome/Edge, Safari 26+, Firefox 141+).

## Deploying to Vercel

Import the GitHub repository, set **Root Directory** to `web` and keep
"Include source files outside of the Root Directory" enabled (the build
compiles `crates/`). `web/vercel.json` sets `pnpm install --frozen-lockfile` / `pnpm run build`; the
build script installs a minimal Rust toolchain with rustup when `cargo` is
missing, so nothing else is configured. Production deploys track `main`,
previews come from pull requests.

Design rules live in `spec/DESIGN.md`.
