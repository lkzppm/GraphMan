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

# Part 3: directed graphs, Bellman-Ford and Floyd-Warshall

Every algorithm runs on the compressed sparse row representation; distances to a target come from Bellman-Ford from it on the transpose, built once and not timed.

## 1. Bellman-Ford: distance to the target

### grafo_W_1 (directed, 25000 vertices, 549953 arcs)

No answer: a negative cycle 10659 -> 14329 -> 10659 of weight -1.77 reaches 100.

Negative cycle in the graph: yes: negative cycle 10 -> 11278 -> 10 of weight -2.

### grafo_W_2 (directed, 25000 vertices, 824964 arcs)

| From | To | Distance | Arcs | Shortest path |
|---:|---:|---:|---:|---|
| 10 | 100 | 10.47 | 11 | 10 → 22754 → 23713 → 20821 → 23161 → 3591 → 7214 → 4808 → 7704 → 10831 → 14144 → 100 |
| 20 | 100 | 8.48 | 6 | 20 → 6795 → 7737 → 11988 → 7094 → 14144 → 100 |
| 30 | 100 | 8.71 | 11 | 30 → 23783 → 439 → 502 → 7344 → 7842 → 10419 → 12598 → 13685 → 17695 → 14144 → 100 |

Negative cycle in the graph: no.

### grafo_W_3 (directed, 100000 vertices, 6099941 arcs)

| From | To | Distance | Arcs | Shortest path |
|---:|---:|---:|---:|---|
| 10 | 100 | 4.63 | 8 | 10 → 2858 → 9370 → 31488 → 43785 → 48833 → 70398 → 74552 → 100 |
| 20 | 100 | 5.42 | 8 | 20 → 2526 → 8495 → 13021 → 15939 → 20244 → 36899 → 74552 → 100 |
| 30 | 100 | 4.67 | 7 | 30 → 29698 → 43059 → 43482 → 35741 → 74494 → 74552 → 100 |

Negative cycle in the graph: no.

### grafo_W_4 (directed, 1000000 vertices, 30999978 arcs)

| From | To | Distance | Arcs | Shortest path |
|---:|---:|---:|---:|---|
| 10 | 100 | 9.04 | 13 | 10 → 91829 → 417272 → 775161 → 842600 → … → 620573 → 21519 → 43375 → 351045 → 100 |
| 20 | 100 | 8.83 | 11 | 20 → 775000 → 859374 → 148050 → 161821 → 274264 → 315038 → 749181 → 51701 → 83053 → 351045 → 100 |
| 30 | 100 | 9.23 | 14 | 30 → 124400 → 225008 → 352692 → 424754 → … → 620573 → 21519 → 43375 → 351045 → 100 |

Negative cycle in the graph: no.

### grafo_W_5 (directed, 10000000 vertices, 39999995 arcs)

| From | To | Distance | Arcs | Shortest path |
|---:|---:|---:|---:|---|
| 10 | 100 | 37.85 | 22 | 10 → 8226464 → 8398644 → 9402245 → 9739987 → … → 9168609 → 1011134 → 617312 → 4484876 → 100 |
| 20 | 100 | 42.63 | 22 | 20 → 8885874 → 9172974 → 190993 → 901806 → … → 9168609 → 1011134 → 617312 → 4484876 → 100 |
| 30 | 100 | 37.86 | 30 | 30 → 792746 → 8357921 → 3360862 → 7413679 → … → 9336327 → 69858 → 617312 → 4484876 → 100 |

Negative cycle in the graph: no.

## 2. Floyd-Warshall: distances between the pairs

### grafo_W_1

No answer: negative cycle 2 -> 17332 -> 2 of weight -0.55.

### grafo_W_2

| from \ to | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 11.73 | 8.14 | 9.49 | 7.08 |
| **20** | 3.84 | 0 | 7.03 | 8.3 | 4.7 |
| **30** | 5.79 | 12.55 | 0 | 8.3 | 6.33 |
| **40** | 5.05 | 12.32 | 5.36 | 0 | 5.71 |
| **50** | 4.48 | 12.23 | 7.79 | 8.26 | 0 |

### grafo_W_3

Floyd-Warshall refused (120.00 GB): the all-pairs table of 100000 vertices needs 120001200000 bytes, over the budget of 17179869184 bytes. The table comes from one Bellman-Ford per row.

| from \ to | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 4.99 | 5.71 | 7.49 | 4.31 |
| **20** | 3.48 | 0 | 6.19 | 8.27 | 4.32 |
| **30** | 3.96 | 5.8 | 0 | 8.3 | 3.17 |
| **40** | 3.58 | 5.59 | 6.1 | 0 | 3.84 |
| **50** | 3.25 | 5.41 | 6.12 | 8.1 | 0 |

### grafo_W_4

Floyd-Warshall refused (12.00 TB): the all-pairs table of 1000000 vertices needs 12000012000000 bytes, over the budget of 17179869184 bytes. The table comes from one Bellman-Ford per row.

| from \ to | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 10.52 | 10.15 | 10.69 | 8.24 |
| **20** | 7.79 | 0 | 9.19 | 9.67 | 7.58 |
| **30** | 7.61 | 10.25 | 0 | 8.77 | 6.55 |
| **40** | 7.94 | 8.65 | 9.22 | 0 | 7.75 |
| **50** | 7.99 | 11.41 | 8.8 | 8.55 | 0 |

### grafo_W_5

Floyd-Warshall refused (1200.00 TB): the all-pairs table of 10000000 vertices needs 1200000120000000 bytes, over the budget of 17179869184 bytes. The table comes from one Bellman-Ford per row.

| from \ to | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 40.2 | 39.56 | 41.55 | 44.91 |
| **20** | 39.17 | 0 | 39.98 | 49.82 | 45.16 |
| **30** | 34.46 | 42.64 | 0 | 47.04 | 43.85 |
| **40** | 38.73 | 43.91 | 47.3 | 0 | 45.24 |
| **50** | 44.06 | 40.62 | 45.25 | 49.11 | 0 |

## 3. Mean running time (seconds)

Mean over 10 runs, the algorithm alone. Bellman-Ford runs to the target of question 1; BFS, DFS and Dijkstra from random roots. `≈` marks an estimate: from the run the budget cut short, or, for a Floyd-Warshall whose table does not fit, from one run on a random digraph of 1024 vertices with the same mean out-degree, scaled by `(n / 1024)³`.

| Graph | Vertices | Arcs | bellman-ford (rounds) | bellman-ford (early-stop) | bellman-ford (queue) | bellman-ford (yen) | bellman-ford (random-yen) | bellman-ford (slf) | floyd-warshall (plain) | floyd-warshall (pruned) | floyd-warshall (parallel) | floyd-warshall (blocked) | bfs (queue) | dfs (iterative) | dijkstra (heap) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| grafo_W_1 | 25000 | 549953 | 0.000316 s | 0.000328 s | 0.000255 s | 0.000243 s | 0.000273 s | 0.000068 s | 0.7865 s | 0.3147 s | 0.3113 s | 0.5532 s | 0.000672 s | 0.0014 s | refused |
| grafo_W_2 | 25000 | 824964 | 15.3 s | 0.0113 s | 0.0052 s | 0.0051 s | 0.0073 s | 0.0043 s | ≈ 1.5 h | 1.4 h (1 of 10 runs) | 1956.0 s (1 of 10 runs) | ≈ 1537.5 s | 0.000738 s | 0.0019 s | 0.0033 s |
| grafo_W_3 | 100000 | 6099941 | 466.4 s (1 of 10 runs) | 0.1004 s | 0.0618 s | 0.0306 s | 0.0785 s | 0.0484 s | ≈ 4.6 days (does not fit) | ≈ 4.6 days (does not fit) | ≈ 1.3 days (does not fit) | ≈ 6.1 days (does not fit) | 0.0055 s | 0.0134 s | 0.0242 s |
| grafo_W_4 | 1000000 | 30999978 | ≈ 8.8 h | 0.9756 s | 0.7243 s | 0.4268 s | 0.9865 s | 0.5451 s | ≈ 4564.4 days (does not fit) | ≈ 4336.8 days (does not fit) | ≈ 1287.1 days (does not fit) | ≈ 5965.1 days (does not fit) | 0.0853 s | 0.1553 s | 0.2906 s |
| grafo_W_5 | 10000000 | 39999995 | ≈ 28.0 days | 7.5902 s | 4.5218 s | 4.2805 s | 7.1737 s | 3.9678 s | ≈ 4294573.3 days (does not fit) | ≈ 2390753.0 days (does not fit) | ≈ 948028.1 days (does not fit) | ≈ 3549267.4 days (does not fit) | 0.5871 s | 1.6060 s | 4.0846 s |

## 4. All pairs: Bellman-Ford from every vertex against Floyd-Warshall

| Graph | Vertices | Arcs | bellman-ford-all (queue) | floyd-warshall (pruned) | floyd-warshall (parallel) | dijkstra-all (heap) | johnson (heap) |
|---|---:|---:|---:|---:|---:|---:|---:|
| grafo_W_1 | 25000 | 549953 | 7.5602 s | 0.3147 s | 0.3113 s | refused | 0.000653 s |
| grafo_W_2 | 25000 | 824964 | 135.0 s (6 of 10 runs) | 1.4 h (1 of 10 runs) | 1956.0 s (1 of 10 runs) | 81.4 s | 89.7 s |
| grafo_W_3 | 100000 | 6099941 | ≈ 1.8 h | ≈ 4.6 days (does not fit) | ≈ 1.3 days (does not fit) | ≈ 2341.8 s | ≈ 2742.6 s |
| grafo_W_4 | 1000000 | 30999978 | ≈ 11.5 days | ≈ 4336.8 days (does not fit) | ≈ 1287.1 days (does not fit) | ≈ 4.7 days | ≈ 5.7 days |
| grafo_W_5 | 10000000 | 39999995 | ≈ 564.9 days | ≈ 2390753.0 days (does not fit) | ≈ 948028.1 days (does not fit) | ≈ 536.3 days | ≈ 548.3 days |

- **grafo_W_1**: Floyd-Warshall is 24.3× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ 0.128 scans per vertex and run, `m` = 549953), Floyd-Warshall makes `n³` = 1.56e13 updates in a cache-friendly loop.
- **grafo_W_2**: Bellman-Ford from every vertex is 14.5× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ 3.236 scans per vertex and run, `m` = 824964), Floyd-Warshall makes `n³` = 1.56e13 updates in a cache-friendly loop.
- **grafo_W_3**: Bellman-Ford from every vertex is 61.7× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ 3.880 scans per vertex and run, `m` = 6099941), Floyd-Warshall makes `n³` = 1.00e15 updates in a cache-friendly loop.
- **grafo_W_4**: Bellman-Ford from every vertex is 375.6× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ 3.962 scans per vertex and run, `m` = 30999978), Floyd-Warshall makes `n³` = 1.00e18 updates in a cache-friendly loop.
- **grafo_W_5**: Bellman-Ford from every vertex is 4232.2× faster. `n` queue Bellman-Fords examine about `n · c · m` arcs (here `c` ≈ 2.744 scans per vertex and run, `m` = 39999995), Floyd-Warshall makes `n³` = 1.00e21 updates in a cache-friendly loop.
