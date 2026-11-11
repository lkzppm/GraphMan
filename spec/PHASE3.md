# Phase 3: direction, Bellman-Ford, Floyd-Warshall

Part 3 (`docs/trabalho-P3.pdf`, summarised in `spec/ASSIGNMENT.md`) is
narrower than the plan in `spec/PHASE2.md` guessed: **direction, negative
weights and all-pairs shortest paths**, no flows. This document is the
design: how direction enters the core without breaking Parts 1 and 2,
how Bellman-Ford and Floyd-Warshall are written once over interchangeable
strategies (the Part 2 frontier story, again), what we add beyond the
handout, and how the study runner answers the four questions. Nothing here
is implemented yet; the order of work is section 10.

The slide, in one line: **Part 1 abstracted the storage, Part 2 the
frontier, Part 3 the schedule** (which vertex Bellman-Ford re-examines next)
**and the sweep** (how Floyd-Warshall walks its table).

## 1. What the handout asks, and what it leaves to us

| Handout | Our reading | Where |
|---|---|---|
| directed weighted graphs, list or vector (matrix optional) | all three representations, the matrix included (its bitset is already `n × n`) | §2 |
| a user parameter says directed or not | `--directed` on every command, `Orientation` in the library | §2 |
| arc from the first vertex of a line to the second | parse without orienting `[min, max]` | §2 |
| BFS, DFS, Dijkstra on directed graphs | they read `neighbors` = out-neighbours; nothing to rewrite | §3 |
| Bellman-Ford **to** one vertex, distances + tree + negative cycle | Bellman-Ford **from** that vertex on the transpose; the tree's parents are successors in the graph | §4 |
| "the two optimisations discussed in class" | early stop + only the vertices that changed (to confirm against the slides) | §4 |
| Floyd-Warshall, distances + a tree from each vertex + negative cycle | one distance table and one predecessor table, row `i` of the latter is the tree from `i` | §5 |
| "the memory optimisation discussed in class" | one table updated in place, `n²` instead of `n³` | §5 |

Two readings to confirm with the professor (the report states them):

- **"The two optimisations."** The usual pair in the Kleinberg-Tardos
  formulation of Bellman-Ford (distances *to* a sink, which is how the
  handout phrases it) is (1) stop when an iteration changes no distance,
  and (2) in each iteration only push from the vertices whose distance
  changed in the previous one. Its O(n) memory (one array instead of the
  `n × n` table of the recurrence) is sometimes counted as a third. We
  implement all of them; each is a separate schedule (§4) so the study can
  show what each one buys.
- **"Whether the graph has a negative cycle."** A Bellman-Ford to `t` only
  sees the negative cycles that can reach `t`. We report those (they are
  what makes the distances undefined) and also answer the whole-graph
  question with the zero-start trick (§4), and say which is which.

## 2. Core growth: direction

### Parsing

```rust
pub enum Orientation { Undirected, Directed }

EdgeList::parse_with(bytes, Orientation::Directed)
EdgeList::from_path_with(path, orientation)
```

- `parse` keeps meaning undirected, so Parts 1 and 2 are untouched.
- **Directed normalisation** is the Part 2 one minus the `[min, max]`
  orientation: the records are `(tail, head, weight)`, sorted by
  `(tail, head)`, a repeated arc keeps its smallest weight, and `(u, v)`
  and `(v, u)` are two different arcs. The sorted order is exactly the
  out-rows, so every builder still produces ascending rows for free.
- **Self-loops** are still dropped from the adjacency (a non-negative loop
  never shortens a path), but a **negative self-loop is a negative cycle
  of one arc**: every one is kept (one per vertex, its smallest weight,
  sorted by vertex) as `EdgeList::negative_loops` and
  `Weighted::negative_loops`, and Bellman-Ford and Floyd-Warshall report
  it as the cycle `[v]`. All of them, not just the first: a Bellman-Ford
  to `t` must see the loops that reach `t`, and the first one in vertex
  order may not. In Part 2 they were dropped silently; the undirected
  parse records them too (Dijkstra still ignores them, as in Part 2: a
  loop is never on a shortest simple path).
- `WeightedEdge { u, v, weight }` keeps its fields; on a directed list they
  mean tail and head (the doc comment changes, not the type).
- `EdgeList::transpose()` swaps every arc and re-sorts (`O(m log m)`):
  the input of the reverse graph. `EdgeList::in_degrees()` beside
  `degrees()` (which is the row length, so the out-degree when directed).
- `from_edges_with` / `from_weighted_edges_with` take an `Orientation`
  like `parse_with`; the old names stay undirected.

### Traits

`Graph` stays five methods plus one flag; no `Directed` trait after all:

```
Graph      + is_directed()      stored at build time; neighbors() = out-neighbours,
                                degree() = out-degree, edge_count() = arcs
Weighted     (unchanged)        weighted_neighbors() = out-arcs with weights
Build      + transpose(&self)   the same representation with every arc reversed
```

- PHASE2 §3 sketched a `Directed` trait with `in_neighbors` backed by a
  cached reverse CSR. Only Bellman-Ford's push step needs in-arcs, and it
  needs *all* of them in order, so the cleaner tool is a **transpose that
  is itself a graph**: Bellman-Ford to `t` on `G` is Bellman-Ford from `t`
  on `Gᵀ`, written once over `Weighted` like Dijkstra. An undirected graph
  is its own transpose: callers check `is_directed()` and skip the copy.
- `Csr::transpose` is a counting sort of `targets` by head (`O(n + m)`,
  one pass, rows come out ascending); the list and the matrix transpose
  the same way. The transpose doubles the memory: `transpose_within`
  refuses it when the graph and its transpose together exceed the budget,
  like any other build. `Build::transpose_unchecked` does the work,
  `transpose` uses the machine's memory.
- **Sizes.** A directed list or CSR holds `m` row entries, not `2m`:
  `required_bytes_oriented(n, m, weighted, orientation)` on `Build` and
  `Representation`; `required_bytes(n, m, weighted)` keeps meaning
  undirected, so Parts 1 and 2 (and the library page) are unchanged.
- `AnyGraph` and `dispatch!` are unchanged: direction is data, not a type,
  so it does not double the variants.

### What changes meaning on a directed graph

| Algorithm | Directed behaviour |
|---|---|
| BFS, DFS (both), Dijkstra, `distance`, `shortest_path` | unchanged code: they follow out-arcs; "reached" means reachable from the root |
| Dijkstra on a negative arc | still refused, `NegativeWeight`, but the message now points to Bellman-Ford instead of "not implemented yet" |
| `Components` | **weakly** connected components, by a union-find over the arcs (generic over `Graph`, `O(m α(n))`); the BFS version stays for undirected graphs |
| strongly connected components | new, §6 |
| diameter | the largest finite `d(u, v)` over ordered pairs. `diameter` returns `Result<Diameter, DiameterError>`: brute force and the 4-sweep still run (every BFS level is a real distance, and a weak component of `s` vertices still bounds it by `s − 1`); iFUB and the bounds are refused with `DiameterError::Directed { method }` (they need `d(u, v) = d(v, u)`). `DiameterMethod::supports(orientation)` |
| degree statistics, the summary file | `degree_stats` is the out-degree (mean `m / n`), `in_degree_stats` the in-degree; `weight_stats` counts each arc once. The summary opens with `directed`, counts `arcs`, writes `out_degree_*`, `in_degree_*`, `weak_components` and a `# negative loop v w` line per negative loop; an undirected summary is unchanged |

## 3. BFS, DFS and Dijkstra on directed graphs

No new algorithm: the handout's item 2 is satisfied by the trait design,
and that is the slide. What needs doing:

- Tests: on a directed graph, each traversal's tree equals the one built
  on an undirected graph with the same out-rows; reachability is
  asymmetric (`1 → 2` reached, `2 → 1` not); Dijkstra checked against
  Bellman-Ford (§4) and `petgraph` on random digraphs.
- The CLI: `graphman bfs|dfs|dijkstra G --directed`.
- The `dijkstra` refusal message for a negative arc suggests
  `graphman bellman-ford`.

## 4. Bellman-Ford: one algorithm over a schedule

### The driver

Every Bellman-Ford variant is the same loop: take a vertex, relax its
out-arcs, and tell someone which neighbours improved. They differ only in
**which vertex comes next** and **when a pass ends**. That is a strategy,
like the Part 2 frontier:

```rust
pub enum Start { Vertex(Vertex), Everywhere }

pub trait Schedule {
    fn reset(&mut self, vertex_count: usize, start: Start);
    fn next(&mut self) -> Option<Vertex>;                       // next vertex to scan, None: done
    fn lowered(&mut self, v: Vertex, distance: &[Weight]);      // v's estimate went down
    fn passes(&self) -> usize;                                  // completed passes
    fn kind(&self) -> ScheduleKind;
    fn heap_bytes(&self) -> usize;
}

pub fn bellman_ford_into<G: Weighted, S: Schedule, V: Visitor>(
    graph: &G, start: Start, schedule: &mut S, tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeCycle>;

pub fn bellman_ford(graph, root, kind) -> Result<ShortestPathTree, NegativeCycle>;
pub fn bellman_ford_to<G: Build>(graph: &G, target: Vertex, kind: ScheduleKind)
    -> Result<ShortestPathTree, BellmanFordError>;  // NegativeCycle | Transpose(BuildError)
pub fn bellman_ford_to_into(reverse, target, schedule, tree, visitor);  // transpose built once
pub fn negative_cycle(graph, kind) -> Option<NegativeCycle>;            // Start::Everywhere
```

- **Implemented** (`algo/schedule.rs`, `algo/bellman_ford.rs`, `tests/bellman_ford.rs`
  against `petgraph`). `lowered` receives the whole distance array (SLF
  compares the lowered vertex with the front); `next` needs nothing.
  All six schedules of the table below are three types (`SweepSchedule`,
  `QueueSchedule`, `YenSchedule`) behind `AnySchedule`, built by
  `ScheduleKind::schedule()`. No schedule caps its passes: `rounds` is
  "at least `n − 1` passes, then until one changes nothing", so without a
  negative cycle it is the textbook `n − 1` plus the confirming pass, and
  with one it runs until the `hops` rule fires.
- `Visitor` gains `scan(v, distance)` and `pass_complete(pass)`
  (Bellman-Ford only) beside `relax`, for the observatory's pass-by-pass
  animation. `ShortestPathTree::path_from(v)` reads a tree grown toward its
  root forward, `write_toward_root_to` writes `vertex successor distance`.

- **The result is Part 2's `ShortestPathTree`**: distances, parents
  (successors toward the target, when run on the transpose), `path_to`,
  `write_to`, `reset`. The observatory, the CLI and the tests already
  speak it.
- **Relaxation is strict and parents are kept on ties**, as in Dijkstra.
  With non-negative weights every schedule must give Dijkstra's distances
  (tests); trees may differ on ties, since Bellman-Ford has no settle
  order, so the tests check each tree is *a* shortest-path tree.
- **Negative cycles, one rule for every schedule.** Each estimate carries
  the number of arcs of the walk that produced it (`hops[w] = hops[v] + 1`
  on an improving relaxation). Without a negative cycle every estimate is
  a simple path (with strict relaxation a vertex can never improve itself
  around a cycle of weight `≥ 0`), so `hops` never reaches `n`; the first
  time it does, a
  negative cycle reaches the root. This works for pass-based and queue
  schedules alike, needs no "`n`-th pass" bookkeeping, and stops early.
  The cycle is then **extracted and returned**, not just flagged: walk the
  parent pointers from that vertex until one repeats; every cycle of the
  parent graph has negative weight (Cherkassky-Goldberg), so that is a
  certificate the caller can check. `NegativeCycle { cycle: Vec<Vertex>,
  weight: Weight }`, in arc order from its smallest vertex.
  The walk that reached `n` arcs may have been cut since by a better
  estimate, so the parents can still lead back to the root: the run then
  goes on (the estimates around the cycle keep falling, so the parent
  graph closes it) and the next `n` attempts are skipped, `O(1)` amortised.
  Negative loops are checked once the run is over (a reached vertex with
  one is the cycle `[v]`). On a transpose the cycle is reversed back to
  the graph's orientation.
- **The whole-graph question** ("does `G` have a negative cycle at all?")
  is the same driver with `Start::Everywhere`: every vertex starts at
  distance 0 and active, which is Bellman-Ford from a virtual vertex with a
  0-arc to every vertex, without adding the vertex. `algo::negative_cycle(&g)`.
  It is also the first step of Johnson (§6).
- **Undirected graphs**: each edge is two arcs, so any negative edge is a
  negative cycle of two arcs; Bellman-Ford returns it at once (the
  argument PHASE2 §3 made for refusing Dijkstra, now an answer instead of a
  refusal).

### The schedules

| `ScheduleKind` | What it does | Passes, worst case | Role |
|---|---|---|---|
| `rounds` | the textbook: `n − 1` passes over every vertex | exactly `n − 1` | the baseline, no optimisation |
| `early-stop` | passes over every vertex, stop after a pass with no change | `≤ n − 1` | optimisation 1 |
| `queue` | FIFO of the vertices lowered since they were last scanned (an in-queue bit, no duplicates); a pass is one generation of the queue | `≤ n − 1`, `O(nm)` | optimisations 1 + 2: Bellman-Ford-Moore, a.k.a. SPFA; the one the study answers with |
| `yen` | vertices in id order, each pass sweeps up then down (arcs `u < v` then `u > v`, two DAGs) | `≤ ⌈n/2⌉` | Yen (1970); a halved bound, provably optimal for fixed orders (Hu-Kozma 2024) |
| `random-yen` | `yen` over a random vertex order (seeded) | `≈ n/3` expected | Bannister-Eppstein (2012) |
| `slf` | the queue as a deque: a lowered vertex goes to the front if its label is below the front's | `O(nm)` | Bertsekas' Small Label First, a cheap label-correcting heuristic |

- Each one is a few dozen lines; the driver, the tree and the cycle rule
  are written once. That is the Part 2 claim made again: a new way of
  choosing the next vertex is a new `Schedule`, never a second
  Bellman-Ford.
- `Measured<S>` (as for frontiers) counts passes, scans and improving
  relaxations, so the study can put "how much work" next to "how long".
- On graphs with non-negative weights, Dijkstra is the yardstick: the
  study shows each schedule's relaxations against Dijkstra's (one per
  improving relaxation), which says how much label-correcting costs over
  label-setting.

## 5. Floyd-Warshall: one table, several sweeps

### The data

```rust
pub struct AllPairs {           // n × n, row-major, vertex ids 1..=n mapped to 0..n
    distance: Vec<Weight>,      // 8 B per cell
    parent: Vec<Vertex>,        // 4 B per cell: parent[i][j] = j's parent in the tree from i
}
impl AllPairs {
    fn distance(&self, i, j) -> Option<Weight>;
    fn path(&self, i, j) -> Option<Vec<Vertex>>;
    fn tree(&self, i) -> TreeView<'_>;        // row i of parent: the shortest-path tree from i
    fn write_tree_to(&self, i, w);            // the same `vertex parent distance` file as Dijkstra
}
pub fn floyd_warshall<G: Weighted>(g: &G, sweep: SweepKind, budget: MemoryBudget)
    -> Result<AllPairs, FloydError>;          // NegativeCycle, TooLarge, AllocationFailed, Cancelled
pub fn floyd_warshall_with_progress(g, sweep, budget, progress: &dyn Fn(rounds) -> Control);
```

- **Implemented** (`algo/floyd_warshall.rs`, `tests/floyd_warshall.rs`
  against `petgraph` and Bellman-Ford). `tree(i)` returns a
  `ShortestPathTree` (the type Dijkstra and Bellman-Ford build, so
  `path_to` and the tree file come for free) rather than a borrowed view;
  `path(i, j)`, `row(i)`, `parent(i, j)`. A negative loop is refused before
  the first round. `Cancelled { rounds, of }` lets the study time a run cut
  short and scale it to `n` rounds.
- **Zero-weight cycles.** Every predecessor the rule sets is tight, but a
  row's predecessors can still go round a cycle of weight exactly 0. The
  blocked sweep does it on most random graphs with zero-weight arcs and two
  tiles or more (its tiles read values out of the plain order); the plain
  order did not on any graph tried. After the sweep, each row is checked
  for a loop (`O(n)` a row, `O(n²)` in all) and a looping row is regrown by
  one Bellman-Ford from its vertex, whose parent graph cannot loop. No
  extra memory (the alternative, a hop count to break ties, costs 4 bytes a
  cell and slows the inner loop).

- **The memory optimisation.** The recurrence `D_k[i][j] = min(D_{k-1}[i][j],
  D_{k-1}[i][k] + D_{k-1}[k][j])` needs `n + 1` tables (`n³`). Round `k`
  never changes row `k` or column `k` (`D[k][k] = 0` unless a negative
  cycle went through `k`, which stops the run), so the update can be done
  **in place in one table**: `n²` cells. Predecessors follow the same
  rule: on an improvement `parent[i][j] = parent[k][j]`, so row `i` of
  `parent` *is* the tree from `i` the handout asks for, with no extra
  memory and no per-vertex rebuild.
- **Cost:** 12 B a cell, priced up front by `required_bytes` and refused
  beyond the machine's memory, like the Part 1 matrix:

  | n | table | updates (n³) |
  |---:|---:|---:|
  | 1,000 | 12 MB | 10⁹ |
  | 10,000 | 1.2 GB | 10¹² |
  | 50,000 | 30 GB | 1.25 × 10¹⁴ |
  | 100,000 (`grafo_W_3`) | 120 GB | 10¹⁵ |
  | 10,000,000 (`grafo_W_5`) | 1.2 PB | 10²¹ |

- **Negative cycles.** A negative cycle through `i` shows up as
  `D[i][i] < 0`. It is checked after each round on the diagonal entries
  that round touched; the run stops at the first one and returns the cycle
  read off `parent` (`i`, `parent[i][i]`, ... back to `i`).

### The sweeps

The algorithm is the triple loop; how the loop walks memory is the
strategy, and on 10¹² updates it is the whole running time:

| `SweepKind` | What changes | Why it matters |
|---|---|---|
| `plain` | `for k, for i, for j` on the flat table, row `k` hoisted | the textbook with the memory optimisation; the baseline |
| `pruned` | skip row `i` when `D[i][k] = ∞` | on sparse digraphs most of the early rounds are skipped; free to add |
| `parallel` | rows `i` in parallel with rayon (independent within a round, since row `k` is read-only) | all cores; CLI only, the wasm build stays sequential |
| `blocked` | Venkataraman-Sahni-Mukhopadhyaya tiling: the diagonal tile, then its row and column tiles, then the rest, each tile fitting in cache | cache misses instead of memory bandwidth; the well-known 2-5× on large `n` |

- The inner loop over `j` is written branch-free (compare, then select
  the distance and the parent) so the compiler vectorises it, as the
  vector frontier's scan was in Part 2.
- Every sweep gives the same distances (tests on integer weights compare
  exactly; `blocked` may pick a different parent on a tie, so the trees are
  checked as valid shortest-path trees, not equal ones).

### When the table does not fit

If the case-study graphs are the Part 2 ones, Floyd-Warshall cannot run
anywhere (120 GB at the smallest). The study then does what Parts 1 and 2
did with the matrix and the vector: the cell is a **refusal with an
estimate**. The time per cell update is measured on the largest table that
fits (same sweep, a random digraph of the same density) and multiplied by
`n³`; the bytes are exact. Question 2 (the 5 × 5 table) is still answered,
by Johnson or by five Bellman-Fords, and the table says which algorithm
produced it.

## 6. Beyond the handout (the Part 3 "plus")

Part 2's plus was more frontiers than the two asked for, all behind one
trait. Part 3's, in order of value per effort:

1. **More schedules** (§4): the two optimisations the class asked for,
   plus Yen, randomised Yen and SLF behind `Schedule`, measured in passes,
   relaxations and seconds. The direct analogue of the heap zoo.
2. **The negative cycle as a certificate** (§4): the cycle itself and its
   weight, for the target's reach and for the whole graph, instead of a
   boolean. Shown in the CLI and drawn in the observatory.
3. **More sweeps** (§5): pruned, parallel and blocked Floyd-Warshall.
4. **Johnson's algorithm**, the third column of question 4: one
   whole-graph Bellman-Ford gives potentials `h`; a `Reweighted<'a, G>`
   view implements `Weighted` with `w(u, v) + h(u) − h(v) ≥ 0` (clamped at
   0 against rounding); then `n` Dijkstras over **any Part 2 frontier** on
   that view, and `d(u, v) = d'(u, v) − h(u) + h(v)`. No second Dijkstra,
   no copy of the graph: it ties all three parts together, and
   `O(nm log n)` beats Floyd-Warshall's `n³` on sparse graphs, which is
   the honest answer to question 4's "why".
5. **Strongly connected components** (iterative Tarjan, one pass, no
   recursion, like the DFS) and the **condensation**; a topological order
   when the graph is acyclic, and the `O(n + m)` **DAG shortest path**,
   which handles negative arcs without Bellman-Ford. Cheap, and the
   natural directed counterpart of Part 1's components.
6. **`petgraph` as the oracle**, finally (PHASE2 §2): `bellman_ford`,
   `find_negative_cycle`, `floyd_warshall` and `johnson` exist there, so
   `proptest` digraphs with negative arcs check every distance and every
   cycle verdict. `dev-dependencies` only.
7. **A generator for the cases the course files lack**: `graphman generate
   --directed --weights -1:10 --potential` gives negative arcs **without**
   negative cycles (random non-negative weights reweighted by a random
   potential, Johnson in reverse), and `--plant-cycle` adds one known
   negative cycle. Without these, Bellman-Ford's only test on course
   graphs would be non-negative ones, where it is a slow Dijkstra.

Stretch, only if time is left: Cherkassky-Goldberg's subtree disassembly
(detects a cycle without waiting for `hops` to reach `n`); Goldberg-Radzik;
a GPU Floyd-Warshall in the observatory (WebGPU compute, one dispatch per
`k`, which `vgpu` already does for the layout).

## 7. CLI

```
graphman bfs|dfs|dijkstra G --directed ...           # Part 1/2 commands, out-arcs
graphman bellman-ford G --directed --to 100 --from 10 20 30 [--schedule queue] [--json]
graphman bellman-ford G --directed --negative-cycle  # the whole-graph question
graphman floyd-warshall G --directed --pairs 10 20 30 40 50 [--sweep parallel] [--trees DIR]
graphman johnson G --directed --pairs 10 20 30 40 50 [--frontier heap]
graphman scc G --directed
graphman bench G --directed --algo bellman-ford|floyd-warshall|johnson -n 10
graphman generate -n 1000 -m 5000 --directed --weights -1:10 --potential -o g.txt
```

- `--directed` lives in `GraphArgs` (`load.rs`), so every command takes
  it; `info` prints it with the arc count, in/out-degree stats and the
  negative arcs and loops.
- `bellman-ford` writes `<graph>.bellman-ford-to-<t>.txt` (`vertex
  successor distance`) and prints `from to distance path...` per source;
  a negative cycle prints the cycle and its weight and exits non-zero.
- `floyd-warshall` prints the `k × k` table of the asked pairs; the trees
  are written only with `--trees` (all of them is `n²` lines).

## 8. Case-study runner

`graphman study G --directed` (study/directed.rs), results in
`studies/directed/` and a "Part 3" block of `RESULTS.md`:

| Section | Question | What it runs |
|---|---|---|
| `bellman-ford` | 1 | `queue` Bellman-Ford to 100; distance and path from 10, 20, 30; the negative-cycle verdicts (to 100, whole graph) |
| `floyd-warshall` | 2 | the 5 × 5 table of {10, ..., 50}, or the refusal + the same table from Johnson |
| `timings` | 3 | 10 runs each, mean in seconds: Bellman-Ford per schedule, Floyd-Warshall per sweep, and, for scale, directed BFS, DFS and Dijkstra (heap) |
| `all-pairs` | 4 | `n` Bellman-Fords (one per target) vs Floyd-Warshall vs Johnson vs `n` Dijkstras when no arc is negative, each mean of 10 |

- **Budgets.** `--apsp-budget` (seconds) per all-pairs cell: when it runs
  out, the time of the targets done is scaled to `n` (each target costs
  about the same on a random graph; the report says it is an estimate),
  the honest-cell rule of Part 2's `--dijkstra-budget`. Floyd-Warshall's
  memory refusal is §5.
- **Why question 4 comes out the way it will:** `n` queue Bellman-Fords
  cost about `n · c · m` (`c` the relaxations per arc, small on random
  graphs), Floyd-Warshall `n³` with a tiny constant and streaming memory.
  On sparse graphs (`m ≪ n²/c`) Bellman-Ford wins despite its worse
  bound; on dense ones Floyd-Warshall wins; Johnson beats both on sparse
  graphs. The study measures where the crossover is (a sweep of densities
  on generated graphs) instead of asserting it.
- Timings exclude parsing, the transpose (built once, like the
  representation) and output. The 10 runs reuse the tree and the schedule
  (`reset`), as Part 2 did.

## 9. Web

- **Parse option:** a "directed" switch beside the upload; the wasm
  `Graph` takes it at parse time.
- **Observatory:** arrowheads in the edge shader (direction is per edge,
  one bit); Bellman-Ford as a fourth search with a schedule switch,
  animated pass by pass, and the negative cycle highlighted; SCCs as a
  colouring like the components; Floyd-Warshall as a matrix heatmap of
  the distance table with a `k` slider, for graphs small enough to hold it
  (a few thousand vertices).
- **Case studies, presentation, library page:** a Part 3 sheet, Part 3
  slides and Part 3 chapters (code in `tests/wiki.rs`), as in Part 2. All
  strings in `src/i18n/`, Portuguese first.

## 10. Order of work

1. `Orientation`, directed normalisation, `negative_loops`, `is_directed`,
   `transpose` for the three representations; tests that the undirected
   paths are byte-for-byte unchanged. **Done** (`tests/directed.rs`).
2. Directed BFS/DFS/Dijkstra tests, weak components, the diameter refusal,
   `--directed` in the CLI. **Done** (`-D`/`--directed` on every command
   that reads a graph; `info` shows out- and in-degrees).
3. `Schedule`, `bellman_ford_into`, `NegativeCycle`, `rounds`,
   `early-stop`, `queue`; `petgraph` oracle. **Done**, with `yen`,
   `random-yen` and `slf` from step 6 (the trait shaped them, a few dozen
   lines each), `graphman bellman-ford` and `MeasuredSchedule`.
4. `AllPairs`, `floyd_warshall` (`plain`, `pruned`), the budget. **Done**,
   with `parallel` and `blocked` from step 6 and `graphman floyd-warshall`.
5. The study runner (questions 1 to 4) with `queue` and `plain`: this is
   everything the handout grades. **Done** (`study/directed.rs`, every
   schedule and sweep; `--part3-budget` per timing cell, `--repeats`;
   refused Floyd-Warshall cells estimated on a 1024-vertex stand-in; see
   `spec/WORKFLOW.md`). A trial on `grafo_W_3` read as a digraph: queue
   Bellman-Ford to 100 in 0.05 s, 100,000 of them ≈ 1.6 h, Floyd-Warshall
   ≈ 4.5 days (1.3 on all cores) and 120 GB.
6. The plus: `yen`, `random-yen`, `slf`, `parallel`, `blocked`, Johnson,
   SCC, the generator options. **Done**: `algo::johnson` over a
   `Reweighted` view (any frontier) and `potentials`; `StrongComponents`
   (iterative Tarjan, numbered in topological order), `condensation`,
   `topological_order`, `dag_shortest_path`; `graphman johnson`,
   `graphman scc`; `graphman generate -D -w -1:10 --potential
   [--plant-cycle]`; Johnson is a column of the study's question 4.
7. Web: directed switch and arrows, Bellman-Ford in the observatory, the
   Part 3 sheet and slides. **Started** (the course's Part 3 graphs are not out,
   so the observatory is tested on examples): two directed examples
   (`samples/directed.txt`, negative arcs without a negative cycle, and
   `samples/directed_cycle.txt`, with one) in the Examples menu, read as
   arcs; arc heads in the edge shader (three segments an arc: the shaft and
   two barbs, in device pixels); Bellman-Ford as a fourth search with a
   schedule picker (the frontier picker made generic), shown as Dijkstra's
   tree (`Search.kind` stays `'dijkstra'`, `schedule` names the order;
   distance bands start at the smallest distance, and the replay walks the
   final tree breadth-first, since a child can be closer than its parent);
   a reachable negative cycle is drawn as a path, with its weight. Wasm:
   `Parsed(bytes, directed)`, `Graph.directed`, `edges()` lists every arc,
   `bellmanFord`, `negativeCycle`, `edgeWeight`. Since then: the Directed
   switch on the opening card; the negative cycle in red in the path card;
   Floyd-Warshall as a fifth algorithm with no origin (a sweep picker,
   Plain / Pruned / Blocked, and one run button for every pair; the table
   shown on its own with its numbers, pairs with a path and the farthest
   pair, and replayed round by round: the vertices 1 to k lit, the pivot k
   selected, the strip's `D_k` following; a click then reads a vertex's
   row, a double click the path between two, off the same tables, run once
   per graph and sweep; refused past 1,000 vertices, the CLI takes it; a
   negative cycle anywhere drawn as Bellman-Ford's); Bellman-Ford's replay in the order the
   vertices became final; the structure strip showing each programme's
   table (`FloydRounds` in the library: the plain sweep one round at a time,
   reporting the cells each round lowered; `bellmanFordTrace`, `floydTrace`
   in wasm); the level layouts drawing the search's own tree. Still to
   come: SCC colouring, the Part 3 sheet and slides. The library page now
   has its Part 3 chapters (direction, Bellman-Ford, schedules,
   Floyd-Warshall, Johnson, strong components; examples in `tests/wiki.rs`)
   and is split into the library's workings and its algorithms.

## References

- Kleinberg and Tardos, *Algorithm Design*, §6.8 (Bellman-Ford to a sink,
  O(n) memory), §6.9 (the push-based and early-stop implementation) and
  §6.10 (negative cycles).
- J. Y. Yen, "An algorithm for finding shortest routes from all source
  nodes to a given destination in general networks", 1970.
- M. J. Bannister and D. Eppstein, "Randomized speedup of the Bellman-Ford
  algorithm", ANALCO 2012 (arXiv:1111.5414).
- J. Hu and L. Kozma, "Non-adaptive Bellman-Ford: Yen's improvement is
  optimal", 2024 (arXiv:2402.10343).
- B. V. Cherkassky and A. V. Goldberg, "Negative-cycle detection
  algorithms", Mathematical Programming, 1999.
- D. P. Bertsekas, "A simple and fast label correcting algorithm for
  shortest paths", Networks, 1993 (SLF).
- G. Venkataraman, S. Sahni and S. Mukhopadhyaya, "A blocked all-pairs
  shortest-paths algorithm", JEA 2003.
- `petgraph::algo::{bellman_ford, find_negative_cycle, floyd_warshall,
  johnson}`, the oracle.
