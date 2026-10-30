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
| grafo_1 | 3.7 MB (structure 1.1 MB) | 15.0 MB (structure 12.6 MB) | 3.4 MB (structure 0.9 MB) |
| grafo_2 | 15.4 MB (structure 11.6 MB) | 314.6 MB (structure 312.3 MB) | 13.4 MB (structure 10.6 MB) |
| grafo_3 | 21.1 MB (structure 15.1 MB) | needs 17.58 GB — does not fit | 13.0 MB (structure 7.6 MB) |
| grafo_4 | 83.8 MB (structure 74.5 MB) | needs 17.58 GB — does not fit | 72.4 MB (structure 67.0 MB) |
| grafo_5 | 272.1 MB (structure 221.6 MB) | needs 2.93 TB — does not fit | 165.9 MB (structure 124.7 MB) |
| grafo_6 | 544.2 MB (structure 488.0 MB) | needs 2.93 TB — does not fit | 432.3 MB (structure 391.1 MB) |

## 2. Mean BFS time (100 searches from distinct vertices)

| Graph | adjacency list | adjacency matrix | compressed sparse row |
|---|---:|---:|---:|
| grafo_1 | 0.386 ms | 1.655 ms | 0.206 ms |
| grafo_2 | 0.914 ms | 11.580 ms | 0.749 ms |
| grafo_3 | 4.141 ms | — | 3.538 ms |
| grafo_4 | 21.310 ms | — | 18.822 ms |
| grafo_5 | 95.182 ms | — | 86.191 ms |
| grafo_6 | 192.136 ms | — | 163.465 ms |

## 3. Mean DFS time, iterative and recursive (100 searches from distinct vertices)

The recursive DFS runs on a thread whose stack is sized for a path through every vertex.

| Graph | adjacency list iterative | adjacency list recursive | adjacency matrix iterative | adjacency matrix recursive | compressed sparse row iterative | compressed sparse row recursive |
|---|---:|---:|---:|---:|---:|---:|
| grafo_1 | 0.564 ms | 0.287 ms | 2.252 ms | 1.723 ms | 0.516 ms | 0.270 ms |
| grafo_2 | 2.333 ms | 0.934 ms | 16.363 ms | 13.534 ms | 2.351 ms | 0.872 ms |
| grafo_3 | 9.249 ms | 7.999 ms | — | — | 7.056 ms | 6.226 ms |
| grafo_4 | 31.531 ms | 23.328 ms | — | — | 27.990 ms | 20.308 ms |
| grafo_5 | 302.622 ms | 298.421 ms | — | — | 224.621 ms | 216.359 ms |
| grafo_6 | 332.415 ms | 301.842 ms | — | — | 269.721 ms | 244.710 ms |

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

The recursive DFS built exactly the iterative DFS's tree from every root above.

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
| grafo_2 | 10 | 25000 | 48 | 2.0 ms |
| grafo_3 | 2 | 250000 | 125000 | 7.5 ms |
| grafo_4 | 2 | 250000 | 125000 | 38.7 ms |
| grafo_5 | 5 | 2500000 | 156250 | 292.5 ms |
| grafo_6 | 5 | 2500000 | 156250 | 489.0 ms |

## 7. Diameter

| Graph | 4-sweep bound | iFUB (exact) | iFUB BFS runs | iFUB time | Bounding (exact) | Bounding BFS runs | Bounding time | Brute force | Brute-force BFS runs | Brute-force time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grafo_1 | ≥ 4 | 5 | 9492 | 420.55 ms | 5 | 1446 | 114.25 ms | 5 | 10004 | 528.34 ms |
| grafo_2 | ≥ 20 | 20 | 96 | 18.93 ms | 20 | 182 | 24.25 ms | 20 | 49988 | 10.23 s |
| grafo_3 | ≥ 21 | 22 | 25750 | 21.32 s | 22 | 3365 | 2.58 s | 22 | 375008 | 9.2 min |
| grafo_4 | ≥ 5 | 5 | 370868 | 36.4 min | 5 | 144111 | 8.5 min | 5 | 375008 | 40.4 min |
| grafo_5 | ≥ 58 | 59 | 5200 | 11.67 s | 59 | 1812 | 6.37 s | skipped | — | — |
| grafo_6 | ≥ 19 | 19 | 111023 | 4.6 min | 19 | 7109 | 23.71 s | skipped | — | — |

# Part 2: weighted graphs

Dijkstra runs on the compressed sparse row representation. Every frontier builds the same tree, so the paths come from one run with the heap.

## 1. Distance and shortest path

### grafo_W_3

From 10.

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| 20 | 0.8 | 18 | 10 → 2858 → 35293 → 3905 → 24445 → 39345 → 61279 → 41321 → 70540 → 26049 → 84450 → 68904 → 87862 → 86778 → 27694 → 16608 → 86355 → 15760 → 20 |
| 30 | 0.89 | 14 | 10 → 2858 → 35293 → 96094 → 85187 → 53177 → 64898 → 87087 → 77935 → 42304 → 78071 → 93985 → 27642 → 26151 → 30 |
| 40 | 0.84 | 10 | 10 → 2858 → 35293 → 3905 → 24445 → 86286 → 14327 → 19697 → 15930 → 46307 → 40 |
| 50 | 0.87 | 9 | 10 → 56663 → 84437 → 19040 → 82510 → 17622 → 94992 → 70948 → 19878 → 50 |
| 60 | 0.97 | 16 | 10 → 2858 → 35293 → 3905 → 24445 → 89584 → 2874 → 99253 → 66532 → 33719 → 96654 → 75728 → 79865 → 74717 → 59399 → 8718 → 60 |

### grafo_W_4

From 10.

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| 20 | 2.66 | 13 | 10 → 532245 → 877016 → 554617 → 430107 → 437166 → 805646 → 841402 → 663364 → 655748 → 634947 → 318070 → 807260 → 20 |
| 30 | 2.02 | 17 | 10 → 873980 → 182382 → 261305 → 81769 → 694525 → 219466 → 207765 → 44636 → 183747 → 920911 → 35338 → 239369 → 417194 → 132461 → 740528 → 707581 → 30 |
| 40 | 2.52 | 15 | 10 → 873980 → 182382 → 674971 → 557022 → 188455 → 418550 → 275098 → 277633 → 801708 → 730863 → 274827 → 386086 → 188007 → 477496 → 40 |
| 50 | 2.69 | 18 | 10 → 873980 → 182382 → 261305 → 81769 → 694525 → 382144 → 748624 → 663332 → 149827 → 349584 → 735867 → 9905 → 716970 → 472621 → 407659 → 994210 → 630598 → 50 |
| 60 | 2.41 | 19 | 10 → 873980 → 182382 → 674971 → 106317 → 27985 → 280367 → 227336 → 364950 → 883474 → 283156 → 161217 → 224210 → 188021 → 614364 → 358029 → 855615 → 822462 → 774634 → 60 |

### grafo_W_5

From 10.

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| 20 | 17.34 | 13 | 10 → 7622850 → 4615833 → 6528266 → 1295458 → 7103730 → 8790605 → 7788327 → 6766415 → 7155379 → 2031914 → 3908338 → 8885874 → 20 |
| 30 | 17.24 | 18 | 10 → 2846336 → 5413988 → 202621 → 9270546 → 6836812 → 2983314 → 8775277 → 5549785 → 3485759 → 4341576 → 8868678 → 3166991 → 5117196 → 7291082 → 1816279 → 5664093 → 8947758 → 30 |
| 40 | 17.37 | 14 | 10 → 1299954 → 1419794 → 9885733 → 5641294 → 409605 → 4105715 → 660832 → 5850281 → 3215052 → 7676193 → 9008138 → 4846487 → 9798152 → 40 |
| 50 | 15.43 | 12 | 10 → 1299954 → 9927727 → 8451042 → 5368621 → 4276332 → 3716282 → 3724752 → 700154 → 9271362 → 6416250 → 396789 → 50 |
| 60 | 17.99 | 22 | 10 → 1299954 → 1419794 → 1899178 → 7524819 → 757290 → 9445351 → 9611705 → 9104671 → 8941517 → 264365 → 3945175 → 3090234 → 2071841 → 8424191 → 2860740 → 1175531 → 1925405 → 7718765 → 3193827 → 7824884 → 1454010 → 60 |

### grafo_W_6

From 10.

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| 20 | 11.26 | 20 | 10 → 7194590 → 1623776 → 6004729 → 5713792 → 8358296 → 2533780 → 5227148 → 8652974 → 6001519 → 3007875 → 2659882 → 1975860 → 7178227 → 4239765 → 4333977 → 5135142 → 7805172 → 6937097 → 2042733 → 20 |
| 30 | 10.67 | 22 | 10 → 6473892 → 2441538 → 1548272 → 787618 → 5728075 → 8108429 → 6007822 → 5550988 → 2523255 → 782814 → 7306955 → 153130 → 9107012 → 8930108 → 2199545 → 9604404 → 5436447 → 8094054 → 8301086 → 7882916 → 7776260 → 30 |
| 40 | 11.31 | 11 | 10 → 7194590 → 1308444 → 2430454 → 9006783 → 9339181 → 6729573 → 6733497 → 5619464 → 9959710 → 9649921 → 40 |
| 50 | 9.6 | 12 | 10 → 6473892 → 2441538 → 3496708 → 8719217 → 3608871 → 1734087 → 8196874 → 3353190 → 4171489 → 6448393 → 8854015 → 50 |
| 60 | 10.72 | 20 | 10 → 6473892 → 2441538 → 1548272 → 787618 → 9566932 → 345742 → 218396 → 8462300 → 2279724 → 9337595 → 9606830 → 9928328 → 8701739 → 8354591 → 8135590 → 4215828 → 8346899 → 3411658 → 6447603 → 60 |

### grafo_W_7

From 10.

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| 20 | 93.47 | 33 | 10 → 44348966 → 895015 → 41433396 → 36342079 → 15296633 → 26159915 → 16943639 → 38743389 → 10078159 → 21570419 → 11797967 → 14033688 → 15395825 → 37638078 → 10256175 → 47812933 → 16114395 → 3709139 → 16167977 → 42063355 → 25051663 → 11357393 → 1237413 → 44073100 → 46623569 → 16564439 → 33972685 → 44128375 → 38865462 → 44580311 → 49167593 → 34107790 → 20 |
| 30 | 95.08 | 32 | 10 → 44348966 → 895015 → 41433396 → 49215936 → 31738577 → 6483504 → 6934370 → 37879154 → 8001897 → 22183730 → 7265763 → 1661582 → 11612335 → 1574885 → 30723220 → 39141968 → 27645810 → 37795681 → 33920812 → 34023581 → 12510615 → 18298407 → 31754868 → 14520632 → 7334968 → 721843 → 7608283 → 44662249 → 46198809 → 161794 → 37094018 → 30 |
| 40 | 100.69 | 46 | 10 → 44348966 → 895015 → 41433396 → 49215936 → 31738577 → 6483504 → 35576121 → 13084740 → 8200352 → 334647 → 21020208 → 33240812 → 43511183 → 39829015 → 31993368 → 35257514 → 1449696 → 2909571 → 35131499 → 46634817 → 8774626 → 26615224 → 12496865 → 25597904 → 17624904 → 28515031 → 9039078 → 42335617 → 44883250 → 25945871 → 4357404 → 43686238 → 2293704 → 18096524 → 17747192 → 14433007 → 4134285 → 11543624 → 49518359 → 34048991 → 36125121 → 20450161 → 31315434 → 44798389 → 37766241 → 40 |
| 50 | 95.77 | 34 | 10 → 44348966 → 895015 → 41433396 → 30012782 → 5306752 → 45425007 → 45928549 → 3090492 → 35262022 → 25302788 → 39964857 → 25438408 → 42769429 → 18259600 → 14013095 → 21407931 → 29028767 → 13632589 → 26269428 → 19841425 → 16775149 → 408668 → 33679805 → 18032133 → 15314852 → 41061763 → 21731902 → 43132195 → 43482012 → 248139 → 24050455 → 39437117 → 4560936 → 50 |
| 60 | 82.25 | 36 | 10 → 44348966 → 895015 → 41433396 → 36342079 → 15296633 → 26159915 → 27614435 → 30636628 → 46606379 → 39970228 → 44691860 → 28472827 → 14457897 → 49527742 → 23832529 → 33803765 → 40354942 → 41967334 → 30441838 → 2384620 → 9629521 → 15597152 → 8376037 → 19638652 → 35026345 → 21270637 → 16840822 → 36015359 → 4125149 → 20825658 → 31193177 → 35236066 → 37175171 → 16297527 → 34154631 → 60 |

### rede_colaboracao

From Edsger W. Dijkstra (2722).

| To | Distance | Edges | Shortest path |
|---|---:|---:|---|
| Alan M. Turing (11365) | ∞ | — | not reachable (another component) |
| J. B. Kruskal (471365) | 3.480368 | 8 | Edsger W. Dijkstra → John R. Rice → Dan C. Marinescu → Howard Jay Siegel → Edwin K. P. Chong → Ness B. Shroff → R. Srikant → Albert G. Greenberg → J. B. Kruskal |
| Jon M. Kleinberg (5709) | 2.706994 | 9 | Edsger W. Dijkstra → A. J. M. van Gasteren → Gerard Tel → Hans L. Bodlaender → Dimitrios M. Thilikos → Prabhakar Ragde → Avi Wigderson → Eli Upfal → Prabhakar Raghavan → Jon M. Kleinberg |
| Éva Tardos (11386) | 2.753514 | 11 | Edsger W. Dijkstra → A. J. M. van Gasteren → Gerard Tel → Hans L. Bodlaender → Jan van Leeuwen → Mark H. Overmars → Micha Sharir → Haim Kaplan → Robert Endre Tarjan → Andrew V. Goldberg → Serge A. Plotkin → Éva Tardos |
| Daniel R. Figueiredo (343930) | 2.942831 | 8 | Edsger W. Dijkstra → John R. Rice → Dan C. Marinescu → Chuang Lin → Bo Li → Y. Thomas Hou → Zhi-Li Zhang → Donald F. Towsley → Daniel R. Figueiredo |

## 2. Mean time of one single-source Dijkstra

Mean over 100 distinct random sources (the Part 1 seed); a frontier that runs out of its budget reports the runs that finished, or an estimate from the run it cut short.

| Graph | Vertices | Edges | vector | heap | lazy-heap | quad-heap | pairing | radix | vector / heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grafo_W_3 | 100000 | 6099868 | 1.86 s | 35.302 ms | 55.319 ms | 32.733 ms | 49.986 ms | 26.946 ms | 53× |
| grafo_W_4 | 1000000 | 30999944 | 184.09 s (4 of 100 runs in 900 s) | 429.353 ms | 895.367 ms | 427.975 ms | 815.864 ms | 267.741 ms | 429× |
| grafo_W_5 | 10000000 | 39999991 | ≈ 6.4 h (no run in 900 s; one settled 3.9% of its component) | 4.92 s | 8.06 s | 5.06 s | 14.45 s | 2.35 s | 4691× |
| grafo_W_6 | 10000000 | 73403372 | ≈ 7.4 h (no run in 900 s; one settled 3.4% of its component) | 5.76 s | 12.83 s | 7.35 s | 15.23 s | 2.72 s | 4593× |
| grafo_W_7 | 50000000 | 59999999 | ≈ 15.9 days (no run in 900 s; one settled 0.1% of its component) | 22.07 s | 22.46 s | 21.46 s | 81.31 s | 8.72 s | 62252× |
| rede_colaboracao | 722385 | 2272543 | — | — | — | — | — | — | — |

## 3. Memory of each frontier

Bytes each frontier owns after a few untimed runs from the first sources: its arrays indexed by vertex, plus the entry storage the largest run needed (as allocated). In brackets, the most entries it held at once. The vector is sized, not run: one estimate per vertex, never grown. Decreases are the estimates handed in, one per relaxation that lowered one (the root's included): the ceiling for a frontier that pushes again instead of lowering a key.

| Graph | Vertices | Edges | Graph bytes | Tree bytes | Decreases | vector | heap | lazy-heap | quad-heap | pairing | radix |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grafo_W_3 | 100000 | 6099868 | 146.80 MB | 2.01 MB | 438008 | 800.01 kB | 2.50 MB (95304) | 9.19 MB (365348) | 2.50 MB (95304) | 2.00 MB (95304) | 13.27 MB (361359) |
| grafo_W_4 | 1000000 | 30999944 | 748.00 MB | 20.13 MB | 3717193 | 8.00 MB | 20.78 MB (917421) | 75.11 MB (2984677) | 20.78 MB (917421) | 20.00 MB (917421) | 169.02 MB (2879398) |
| grafo_W_5 | 10000000 | 39999991 | 1000.00 MB | 201.25 MB | 18401019 | 80.00 MB | 174.22 MB (6119217) | 348.44 MB (10805165) | 174.22 MB (6119217) | 200.00 MB (6119217) | 788.98 MB (10542503) |
| grafo_W_6 | 10000000 | 73403372 | 1.80 GB | 201.25 MB | 23365784 | 80.00 MB | 174.22 MB (7489464) | 348.44 MB (16027236) | 174.22 MB (7489464) | 200.00 MB (7489464) | 825.74 MB (15806239) |
| grafo_W_7 | 50000000 | 59999999 | 1.64 GB | 1.01 GB | 53742464 | 400.00 MB | 334.22 MB (6818124) | 534.22 MB (7493194) | 334.22 MB (6818124) | 1.00 GB (6818124) | 1.08 GB (7406089) |
