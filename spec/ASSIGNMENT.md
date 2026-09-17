# Assignment — Part 1 (COS 242, 2026/2)

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
