# Assignment, Part 1 (COS 242, 2026/2)

Source: `docs/trabalho-P1.pdf` (Portuguese) and `docs/Enunciado.md` (the
presentation announcement). This is a faithful English summary.

## Deliverables

- A **graph library** (functions or classes) reusable by other programs.
  Undirected graphs only in part 1. Same pair of students for all three parts.
- A **program** that uses the library to run the case studies on the six
  course graphs (`graphs/grafo_1.txt` … `grafo_6.txt`).
- A **report** of at most 5 pages, submitted on Moodle, with the source-code
  URL, design decisions, and the case-study tables (rows = graphs, columns =
  measured features).
- An **8-minute presentation** focused on interesting implementation aspects
  (class/object organisation, *not* how BFS works) plus a table or chart of
  the case-study results. Bring it on a pendrive or a cloud URL. The class
  votes for the best work.

## Required library features

1. **Input** — read a graph from a text file: first line is the vertex count,
   each following line is an edge (`u v`).
2. **Output** — write a text file with: number of vertices, number of edges,
   min/max/mean/median degree, and the connected components.
3. **Representations** — adjacency matrix *and* adjacency list, chosen by the
   library user.
4. **BFS and DFS** from a user-given start vertex, writing the parent and
   level of every vertex (root at level 0) to a file.
5. **Distance** between two vertices (BFS as the primitive) and the
   **diameter** (largest shortest path). Hint from the handout: also implement
   an approximate algorithm usable on very large graphs.
6. **Connected components** — count, size of each, vertex list of each,
   listed from largest to smallest.

## Case-study questions (for each of the six graphs)

1. Memory (MB) used by the process with the matrix vs the list, measured
   after loading the graph.
2. Mean time of one BFS over 100 searches from distinct start vertices, matrix
   vs list.
3. Same as 2 for DFS.
4. Parent of vertices 10, 20 and 30 in the BFS tree and in the DFS tree when
   the search starts at vertices 1, 2 and 3.
5. Distance between the pairs (10,20), (10,30), (20,30).
6. Number of connected components; size of the largest and the smallest.
7. Diameter (exact when feasible, approximate otherwise).

**Timing rule:** exclude time spent reading the graph from disk and writing
results; measure only the algorithm (clock before and after).

## Facts about the course graphs

| Graph | Vertices | Edges (unique) | Notes |
|---|---:|---:|---|
| grafo_1 | 10 000 | 109 921 | 4 self-loops, 52 duplicate lines |
| grafo_2 | 49 948 | 1 298 710 | 65 self-loops, 1 019 duplicates |
| grafo_3 | 375 000 | 765 616 | two disjoint random graphs (250 000 + 125 000 vertices) |
| grafo_4 | 375 000 | ~8.2 M | |
| grafo_5 | 4 843 750 | ~13.2 M | |
| grafo_6 | 4 843 750 | 46 469 479 | 722 MB text file |

The bitset adjacency matrix needs `(n+1)²/8` bytes: 12.5 MB (graph 1),
312 MB (graph 2), 17.6 GB (graphs 3–4), 2.9 TB (graphs 5–6). On the 16 GB
development machine only graphs 1 and 2 fit, which is itself a result.

---

# Assignment, Part 2 (COS 242, 2026/2)

Source: `docs/trabalho-P2.pdf` (Portuguese, released 2026-10-08). This is a
faithful English summary; the design that answers it is `spec/PHASE2.md`.

## Deliverables

- Same pair of students. The new features go **into the Part 1 library**,
  not into a separate program.
- A **report** of at most 5 pages with the design and implementation
  decisions, the case-study results and the source-code URL.
- An **8-minute presentation** of implementation details and results.

## Required library features

1. **Weighted graphs.** Represent and manipulate *undirected* graphs whose
   edges carry real-valued weights. How the library is extended is our
   decision (and a thing to present). The input file gains a third column,
   the weight, which may be any floating-point number, negative included.
   The handout's Figure 1 (vertex count, then `u v w` per line):

   ```
   5
   1 2 0.1
   2 5 0.2
   5 3 5
   3 4 -9.5
   4 5 2.3
   1 5 1
   ```

2. **Distance and shortest paths.** From any source vertex, the distance to
   every other vertex and the shortest paths themselves (the spanning tree
   induced by the search). If every weight is non-negative, use
   **Dijkstra**; otherwise the library must *report that shortest paths
   with negative weights are not implemented yet* (a clear refusal, not a
   wrong answer and not a crash).

3. **Dijkstra, two ways.** (1) a plain **vector** of distance estimates
   (extract-min is a linear scan); (2) a **heap** of estimates. The heap may
   be our own or a library's, but it must support **efficient key
   modification** (decrease-key); the handout calls this out explicitly.
   The handout also asks *not to write Dijkstra twice*: abstract how
   estimates are stored, updated and how the minimum is extracted, and run
   one algorithm over both.

## Case-study questions

For each **weighted course graph** (published on the course website):

1. Distance and shortest path from vertex **10** to vertices **20, 30, 40,
   50, 60**, in a table.
2. **Mean time** of one single-source Dijkstra (source to all vertices),
   vector vs heap: pick `k` random sources (e.g. `k = 100`), time the total,
   report the sample mean, in a table comparing both implementations across
   the graphs.

For the **collaboration network** of Computer Science researchers (also on
the website; an edge weight is inversely proportional to the number of
co-authored papers, so a small weight means close collaborators):

3. Distance and shortest path from **Edsger W. Dijkstra** to **Alan M.
   Turing**, **J. B. Kruskal**, **Jon M. Kleinberg**, **Éva Tardos** and
   **Daniel R. Figueiredo**. Names must be matched with exactly this
   spelling to find the vertex indices, so the network ships with a
   vertex-name file that the library has to read.

**Timing rule** (carried over from Part 1): measure the algorithm only, not
parsing or writing results.

## The files (downloaded 2026-10-22, W6 and W7 on 2026-10-29)

| File | Vertices | Edges | Weights | Notes |
|---|---|---|---|---|
| `grafo_W_3.txt` | 100,000 | 6,099,868 | 0 to 10 | 73 duplicate lines, connected |
| `grafo_W_4.txt` | 1,000,000 | 30,999,944 | 0 to 10 | 34 duplicate lines, connected |
| `grafo_W_5.txt` | 10,000,000 | 39,999,991 | 0 to 10 | 4 duplicate lines, connected |
| `grafo_W_6.txt` | 10,000,000 | 73,403,372 | 0 to 10 | published 2026-10-29; 9,999,997 vertices reachable from a random root |
| `grafo_W_7.txt` | 50,000,000 | 59,999,999 | 0 to 10 | published 2026-10-29; connected |
| `rede_colaboracao.txt` | 722,385 | 2,272,543 | 0.0037 to 113 | 77,486 components, largest 576,309 |

- The weighted graphs are new random graphs, not the Part 1 graphs with
  weights added; the batch has no `grafo_W_1` or `grafo_W_2`.
- No file has a negative weight or a self-loop, so every question is a
  Dijkstra; the refusal is shown on the handout's Figure 1 instead.
- The vertex names are a separate file, `rede_colaboracao_vertices.txt`:
  `index,name` per line, no header, UTF-8. The six names asked for are there
  with the exact spelling (Dijkstra 2722, Turing 11365, J. B. Kruskal
  471365, Kleinberg 5709, Tardos 11386, Figueiredo 343930).
- Alan M. Turing's only edge goes to vertex 717737, whose only edge is back
  to him: the two are a component of their own, so there is no path from
  Dijkstra and the answer is "unreachable", not a distance.
- The vector Dijkstra is `O(n²)` per source: about 2 s on `grafo_W_3`,
  minutes on `grafo_W_4`, hours on `grafo_W_5` and `grafo_W_6`, and about
  two weeks on `grafo_W_7` (Apple M5). The study runs
  it under `--dijkstra-budget`, reporting the runs that finished or an
  estimate from the run cut short, like the Part 1 matrix memory refusals.
