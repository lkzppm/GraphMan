# Case study results

Machine: macos aarch64 (Apple M5), 10 threads, 17.18 GB RAM. Times exclude reading and writing files.

## Graphs

| Graph | Vertices | Edges | Min degree | Max degree | Mean degree | Median degree |
|---|---:|---:|---:|---:|---:|---:|
| grafo_1 | 10000 | 109921 | 8 | 43 | 21.98 | 22.0 |
| grafo_2 | 49948 | 1298710 | 1 | 112 | 52.00 | 55.0 |
| grafo_3 | 375000 | 765615 | 1 | 15 | 4.08 | 4.0 |
| grafo_4 | 375000 | 8186986 | 9 | 89 | 43.66 | 47.0 |
| grafo_5 | 4843750 | 13168911 | 1 | 22 | 5.44 | 5.0 |
| grafo_6 | 4843750 | 46469479 | 2 | 56 | 19.19 | 20.0 |

## 1. Memory after loading (process RSS)

| Graph | adjacency list | adjacency matrix | compressed sparse row |
|---|---|---|---|
| grafo_1 | 3.8 MB (structure 1.1 MB) | 15.0 MB (structure 12.6 MB) | 3.4 MB (structure 0.9 MB) |
| grafo_2 | 15.5 MB (structure 11.6 MB) | 314.7 MB (structure 312.3 MB) | 13.5 MB (structure 10.6 MB) |
| grafo_3 | 21.2 MB (structure 15.1 MB) | needs 17.58 GB — does not fit | 13.1 MB (structure 7.6 MB) |
| grafo_4 | 83.8 MB (structure 74.5 MB) | needs 17.58 GB — does not fit | 72.4 MB (structure 67.0 MB) |
| grafo_5 | 272.2 MB (structure 221.6 MB) | needs 2.93 TB — does not fit | 166.0 MB (structure 124.7 MB) |
| grafo_6 | 545.6 MB (structure 488.0 MB) | needs 2.93 TB — does not fit | 432.3 MB (structure 391.1 MB) |

## 2. Mean BFS time (100 searches from distinct vertices)

| Graph | adjacency list | adjacency matrix | compressed sparse row |
|---|---:|---:|---:|
| grafo_1 | 0.324 ms | 1.832 ms | 0.203 ms |
| grafo_2 | 0.906 ms | 12.001 ms | 0.931 ms |
| grafo_3 | 4.387 ms | — | 3.592 ms |
| grafo_4 | 31.631 ms | — | 28.316 ms |
| grafo_5 | 113.547 ms | — | 133.084 ms |
| grafo_6 | 216.734 ms | — | 185.023 ms |

## 3. Mean DFS time (100 searches from distinct vertices)

| Graph | adjacency list | adjacency matrix | compressed sparse row |
|---|---:|---:|---:|
| grafo_1 | 0.588 ms | 2.586 ms | 0.543 ms |
| grafo_2 | 2.428 ms | 16.736 ms | 2.397 ms |
| grafo_3 | 9.673 ms | — | 7.519 ms |
| grafo_4 | 33.849 ms | — | 32.970 ms |
| grafo_5 | 571.885 ms | — | 292.879 ms |
| grafo_6 | 515.389 ms | — | 336.573 ms |

## 4. Parents in the BFS and DFS trees

Cells read `parent (level)`; `—` means the vertex was not reached.

| Graph | Search | Root | parent of 10 | parent of 20 | parent of 30 |
|---|---|---:|---:|---:|---:|
| grafo_1 | BFS | 1 | 2042 (3) | 8382 (3) | 2394 (4) |
| grafo_1 | BFS | 2 | 8935 (2) | 9071 (4) | 3555 (4) |
| grafo_1 | BFS | 3 | 7685 (3) | 9543 (4) | 5783 (3) |
| grafo_1 | DFS | 1 | 709 (234) | 666 (383) | 86 (209) |
| grafo_1 | DFS | 2 | 709 (296) | 666 (454) | 86 (271) |
| grafo_1 | DFS | 3 | 709 (267) | 666 (452) | 86 (242) |
| grafo_2 | BFS | 1 | — | — | — |
| grafo_2 | BFS | 2 | 1351 (3) | — | — |
| grafo_2 | BFS | 3 | — | 46738 (3) | 12999 (3) |
| grafo_2 | DFS | 1 | — | — | — |
| grafo_2 | DFS | 2 | 3946 (138) | — | — |
| grafo_2 | DFS | 3 | — | 217 (45) | 3513 (190) |
| grafo_3 | BFS | 1 | — | — | 141597 (14) |
| grafo_3 | BFS | 2 | 158403 (8) | 75471 (9) | — |
| grafo_3 | BFS | 3 | 158403 (10) | 319691 (7) | — |
| grafo_3 | DFS | 1 | — | — | 141597 (26137) |
| grafo_3 | DFS | 2 | 192218 (52838) | 141526 (75181) | — |
| grafo_3 | DFS | 3 | 106718 (42515) | 141526 (2794) | — |
| grafo_4 | BFS | 1 | 243865 (4) | 370783 (4) | 136244 (3) |
| grafo_4 | BFS | 2 | — | — | — |
| grafo_4 | BFS | 3 | — | — | — |
| grafo_4 | DFS | 1 | 12269 (6814) | 10738 (8215) | 1531 (692) |
| grafo_4 | DFS | 2 | — | — | — |
| grafo_4 | DFS | 3 | — | — | — |
| grafo_5 | BFS | 1 | 1888350 (8) | — | 2502539 (9) |
| grafo_5 | BFS | 2 | — | — | — |
| grafo_5 | BFS | 3 | 1888350 (9) | — | 191713 (9) |
| grafo_5 | DFS | 1 | 1888350 (16234) | — | 191713 (865915) |
| grafo_5 | DFS | 2 | — | — | — |
| grafo_5 | DFS | 3 | 1888350 (115591) | — | 2502539 (607746) |
| grafo_6 | BFS | 1 | — | — | — |
| grafo_6 | BFS | 2 | 1677854 (4) | 3607226 (5) | 3898629 (5) |
| grafo_6 | BFS | 3 | — | — | — |
| grafo_6 | DFS | 1 | — | — | — |
| grafo_6 | DFS | 2 | 381031 (154795) | 431008 (58744) | 446011 (268600) |
| grafo_6 | DFS | 3 | — | — | — |

## 5. Distances

| Graph | d(10, 20) | d(10, 30) | d(20, 30) |
|---|---:|---:|---:|
| grafo_1 | 3 | 3 | 4 |
| grafo_2 | ∞ | ∞ | 3 |
| grafo_3 | 9 | ∞ | ∞ |
| grafo_4 | 4 | 3 | 4 |
| grafo_5 | ∞ | 9 | ∞ |
| grafo_6 | 5 | 5 | 5 |

## 6. Connected components

| Graph | Components | Largest | Smallest | Time |
|---|---:|---:|---:|---:|
| grafo_1 | 1 | 10000 | 10000 | 0.2 ms |
| grafo_2 | 10 | 25000 | 48 | 2.2 ms |
| grafo_3 | 2 | 250000 | 125000 | 7.7 ms |
| grafo_4 | 2 | 250000 | 125000 | 38.7 ms |
| grafo_5 | 5 | 2500000 | 156250 | 279.7 ms |
| grafo_6 | 5 | 2500000 | 156250 | 640.0 ms |

## 7. Diameter

| Graph | 4-sweep bound | iFUB (exact) | iFUB BFS runs | iFUB time | Bounding (exact) | Bounding BFS runs | Bounding time | Brute force | Brute-force BFS runs | Brute-force time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grafo_1 | ≥ 4 | 5 | 9492 | 384.05 ms | 5 | 1446 | 104.68 ms | 5 | 10004 | 408.52 ms |
| grafo_2 | ≥ 20 | 20 | 39949 | 6.77 s | 20 | 16147 | 2.18 s | 20 | 49988 | 8.41 s |
| grafo_3 | ≥ 21 | 22 | 237789 | 4.6 min | 22 | 19589 | 29.04 s | 22 | 375008 | 9.4 min |
| grafo_4 | ≥ 5 | 5 | 370868 | 36.4 min | 5 | 144111 | 8.5 min | 5 | 375008 | 40.4 min |
| grafo_5 | ≥ 58 | ≥ 58 (budget) | 379 | 45.18 s | ≥ 58 (budget) | 342 | 45.17 s | skipped | — | — |
| grafo_6 | ≥ 19 | ≥ 19 (budget) | 181 | 45.45 s | ≥ 19 (budget) | 165 | 45.54 s | skipped | — | — |
