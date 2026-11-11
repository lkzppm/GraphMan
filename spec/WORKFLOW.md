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

The weighted course files are `graphs/grafo_W_{3,4,5,6,7}.txt` and the
collaboration network `graphs/rede_colaboracao.txt` with its names in
`graphs/rede_colaboracao_vertices.txt` (gitignored, as the Part 1 graphs;
see `spec/ASSIGNMENT.md`). `samples/` has the handout's figures, a
100-vertex weighted graph and a synthetic named network (see
`samples/README.md`) for tests and the site. The mechanisms:

```
graphman dijkstra G --from 10 --to 20 30 40 50 60 --frontier heap     # tree file + paths
graphman bench G --algo dijkstra --frontier vector -n 100            # mean per source
graphman dijkstra R --names R_names.txt --from "Edsger W. Dijkstra" --to "Alan M. Turing"
```

The vector frontier is `O(n²)` per source: fine up to grafo_2's 50 000
vertices, about 16 s per source at 375 000 and hours at 4.8M.

The study runner answers the Part 2 questions on any weighted file (a
weighted file gets the Part 2 sections, `paths`, `frontiers` and
`frontier-memory`, by default; `--only` picks some):

```
./target/release/graphman study graphs/grafo_W_*.txt --out studies --dijkstra-budget 900
./target/release/graphman study graphs/rede_colaboracao.txt --only paths \
    --names graphs/rede_colaboracao_vertices.txt \
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
  frontier (`--only frontiers --frontiers vector`) keeps the others. The
  list is comma separated: `--frontiers lazy-heap,radix`, not spaces.
- `frontier-memory`: the bytes each frontier holds during a Dijkstra and
  the most entries it held, from `--memory-runs` (5) untimed runs per
  frontier from the first of the same sources; the vector is sized, not
  run. Minutes on every graph:
  `--only frontier-memory` refreshes it alone.

Results go to `studies/weighted/<name>.json`, merged into
`studies/weighted/results.json` and a "Part 2" block of `studies/RESULTS.md`.
A file with a negative weight records the library's refusal instead.

## Directed graphs (Part 3)

The Part 3 files are not published yet (see `spec/ASSIGNMENT.md`). Any
weighted file can be read as a digraph with `--directed` (`-D`): each line
`u v w` is the arc from `u` to `v`. The mechanisms:

```
graphman bellman-ford G -D --to 100 --from 10 20 30 --schedule queue   # tree file + paths
graphman bellman-ford G -D --negative-cycle                            # the whole graph
graphman floyd-warshall G -D --pairs 10 20 30 40 50 --sweep parallel    # the 5 × 5 table
```

The study runner answers the four Part 3 questions (`--directed` selects
the Part 3 sections by default; `--only` picks some):

```
./target/release/graphman study graphs/<file>.txt --directed --out studies \
    --part3-budget 600 --apsp-budget 900
```

- `bellman-ford`: one queue Bellman-Ford to `--target` (100) on the
  transpose, the distance and path from each of `--sources` (10,20,30),
  and the negative-cycle verdicts (to the target, and anywhere).
- `floyd-warshall`: the table of `--pairs-of` (10,...,50) by the parallel
  sweep; when the `n × n` table does not fit, one Bellman-Ford per row, and
  the table says so.
- `timings`: the mean of `--repeats` (10) runs, in seconds, of every
  `--schedules` (all six) and `--sweeps` (all four), and BFS, DFS and
  Dijkstra (heap) for scale. Each cell has `--part3-budget` seconds; the
  textbook `rounds` cut short is scaled from its passes, Floyd-Warshall
  from its rounds, and a Floyd-Warshall whose table does not fit is timed
  on a 1024-vertex random digraph of the same mean out-degree and scaled
  by `(n / 1024)³`.
- `all-pairs`: Bellman-Ford to every target (queue) against Floyd-Warshall
  (the `timings` cells of `pruned` and `parallel`) and Dijkstra from every
  source when no arc is negative. `--apsp-budget` per cell; the targets
  done are scaled to `n` when it runs out. The Markdown states which was
  faster and the measured scans per vertex behind the answer.

Results go to `studies/directed/<name>.json`, merged into
`studies/directed/results.json` and a "Part 3" block of
`studies/RESULTS.md`. The transpose is built once and not timed.

## The DBLP collaboration network (monthly)

`.github/workflows/dblp.yml` runs on the 6th of every month and on demand
(Actions → DBLP → Run workflow, optionally with the URL of any dump). It
downloads the newest monthly snapshot from DROPS, converts it with
`graphman dblp`, creates the release `dblp-<date>` with the course-format
files (whole and up to 2009, gzipped) and `manifest.json` (the release
notes are the generated `README.md`), and deploys the site layout (one
file per year, `--site`) to GitHub Pages for the site's DBLP tab. A
snapshot that already has a release is skipped unless `force` is ticked.

One-time setup: Settings → Pages → Source: *GitHub Actions* (the workflow
asks for it itself through `actions/configure-pages`, which may need that
click once). Nothing else: the default `GITHUB_TOKEN` creates releases and
deploys Pages.

By hand, with the dump at hand (https://dblp.org/xml/ or DROPS):

```
./target/release/graphman dblp dblp-2026-11-01.xml.gz --out graphs            # rede_colaboracao.txt + _vertices.txt
./target/release/graphman dblp dblp.xml.gz --out out --years 2009,2020 --gzip  # plus the network up to each year
./target/release/graphman dblp dblp.xml.gz --out out --gzip --site by-year     # plus the site layout, one file per year
./target/release/graphman dblp dblp.xml.gz --out out --formal-only            # preprints left out
```

Minutes and a few GB of memory for the whole of DBLP (the XML is streamed).
`graphman info` and `graphman dijkstra --names` read the files back.

To try the tab before a monthly build exists, or against a build of your
own, give the page a local copy: `node .github/scripts/dblp-site.mjs
by-year web/public/dblp-data` lays the files out as Pages would
(gitignored), and `NEXT_PUBLIC_DBLP_SITE=/dblp-data pnpm run dev` points
the page at them.

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
