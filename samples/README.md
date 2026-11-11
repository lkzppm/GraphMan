# Samples

Small graphs in the course format, committed so the library and the CLI can
be tried without the course files (`graphs/`, gitignored, hundreds of MB).

| File | What it is |
|---|---|
| `figure1.txt` | Figure 1 of the Part 1 handout: 5 vertices, 5 edges, unweighted. |
| `figure1_weighted.txt` | Figure 1 of the Part 2 handout: the same shape with weights, including the edge `3 4 -9.5`. Dijkstra refuses it ("not implemented yet"), as the handout requires; BFS, DFS, components and the diameter still run. |
| `weighted_100.txt` | A random weighted graph, 100 vertices and 384 edges, weights uniform in `[0, 10]` with three decimals (`graphman generate -n 100 -m 400 --weights 0:10 --seed 242`). Big enough for the case-study question shape: `dijkstra --from 10 --to 20 30 40 50 60`. |
| `directed.txt` | Part 3: the observatory's ten-vertex example read as arcs (`--directed`), with two negative arcs (`6 3 -2`, `9 4 -1.5`) and an arc `10 1 2` back to the start. Every cycle still weighs more than 0: Bellman-Ford answers (from 1 to 10: 1, 2, 5, 6, 3, 7, 10, weight 2.25), Dijkstra refuses. |
| `directed_cycle.txt` | The same plus `7 5 -3`, which closes negative cycles reachable from 1: 5 → 6 → 7 → 5 weighs −1.25 and, through `6 3 -2`, 3 → 7 → 5 → 6 → 3 weighs −3.75 (the one Bellman-Ford returns). |
| `collaboration.txt` + `collaboration_names.txt` | A **synthetic** 14-vertex collaboration network with a names file, shaped like the course's: the six researchers the handout names, spelled exactly as it spells them, and eight invented people between them. Edges and weights are made up for testing; they say nothing about who wrote with whom. Turing sits in a separate component on purpose, to show an unreachable target. |

```bash
graphman dijkstra samples/collaboration.txt --names samples/collaboration_names.txt \
    --from "Edsger W. Dijkstra" \
    --to "Alan M. Turing" "J. B. Kruskal" "Jon M. Kleinberg" "Éva Tardos" "Daniel R. Figueiredo"
```

Larger weighted graphs for timing the frontiers can be generated, e.g. the
structure of a course graph with random weights:

```bash
graphman generate --like graphs/grafo_1.txt --weights 0:1 -o grafo_W_1.txt
graphman bench grafo_W_1.txt --algo dijkstra --frontier vector -n 100
graphman bench grafo_W_1.txt --algo dijkstra --frontier heap -n 100
```

Directed (Part 3):

```bash
graphman bellman-ford samples/directed.txt --directed --to 10 --from 1 2 3
graphman floyd-warshall samples/directed.txt --directed --pairs 1 4 7 10
graphman bellman-ford samples/directed_cycle.txt --directed --negative-cycle
```
