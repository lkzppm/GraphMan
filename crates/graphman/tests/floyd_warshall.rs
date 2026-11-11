//! Floyd-Warshall (Part 3): every sweep must agree with `petgraph`, with
//! one Bellman-Ford per vertex and with each other, and refuse what it
//! cannot answer.

use graphman::algo::{self, AllPairs, Control, FloydError, NegativeCycle, ScheduleKind, SweepKind};
use graphman::{
    Build, Csr, EdgeList, FrontierKind, Graph, MemoryBudget, Orientation, Representation, Vertex,
    Weight, Weighted, dispatch,
};
use petgraph::graph::NodeIndex;

const DIRECTED: Orientation = Orientation::Directed;
const UNLIMITED: MemoryBudget = MemoryBudget::Unlimited;

/// A tiny deterministic PRNG (SplitMix64).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u32) -> u32 {
        (self.next() % n as u64) as u32
    }
}

/// Random arcs reweighted by a random potential: negative arcs, no
/// negative cycle, integer weights (so every sweep's sums are exact).
fn potential_digraph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let h: Vec<Weight> = (0..=n).map(|_| rng.below(20) as Weight).collect();
    let arcs: Vec<_> = (0..m)
        .map(|_| {
            let (u, v) = (rng.below(n) + 1, rng.below(n) + 1);
            let w = rng.below(9) as Weight;
            (u, v, w + h[u as usize] - h[v as usize])
        })
        .collect();
    EdgeList::from_weighted_edges_with(n as usize, arcs, DIRECTED).unwrap()
}

/// `petgraph`'s Floyd-Warshall on the same arcs (and loops), indexed `[i][j]`.
fn oracle(edges: &EdgeList) -> Option<Vec<Vec<Weight>>> {
    let n = edges.vertex_count();
    let mut g = petgraph::Graph::<(), Weight>::new();
    for _ in 0..=n {
        g.add_node(());
    }
    for edge in edges.weighted_edges() {
        let (u, v) = (
            NodeIndex::new(edge.u as usize),
            NodeIndex::new(edge.v as usize),
        );
        g.add_edge(u, v, edge.weight);
        if !edges.is_directed() {
            g.add_edge(v, u, edge.weight);
        }
    }
    // petgraph's Floyd-Warshall sets the diagonal to 0 over any loop; for
    // GraphMan a negative loop is a negative cycle of one arc.
    if !edges.negative_loops().is_empty() {
        return None;
    }
    let all = petgraph::algo::floyd_warshall(&g, |e| *e.weight()).ok()?;
    Some(
        (0..=n)
            .map(|i| {
                (0..=n)
                    // petgraph writes "unreachable" as the largest float.
                    .map(|j| match all[&(NodeIndex::new(i), NodeIndex::new(j))] {
                        Weight::MAX => Weight::INFINITY,
                        d => d,
                    })
                    .collect()
            })
            .collect(),
    )
}

/// Every reached vertex of every tree sits one arc after its parent, and
/// every path adds up to its distance.
fn assert_valid<G: Weighted>(graph: &G, all: &AllPairs) {
    for i in graph.vertices() {
        for j in graph.vertices() {
            let Some(d) = all.distance(i, j) else {
                assert_eq!(all.path(i, j), None);
                continue;
            };
            if let Some(p) = all.parent(i, j) {
                let w = graph.weight(p, j).expect("an arc from the parent");
                assert_eq!(all.distance(i, p).unwrap() + w, d, "{i}: {p} -> {j}");
            }
            let path = all.path(i, j).unwrap();
            assert_eq!((path[0], *path.last().unwrap()), (i, j));
            let length: Weight = path
                .windows(2)
                .map(|a| graph.weight(a[0], a[1]).unwrap())
                .sum();
            assert_eq!(length, d);
        }
    }
}

#[test]
fn every_sweep_matches_petgraph() {
    // 70 and 150 vertices: two and three tiles for the blocked sweep.
    for (seed, n, m) in [(0, 70, 300), (1, 70, 150), (2, 150, 600), (3, 150, 2000)] {
        let edges = potential_digraph(seed, n, m);
        let expected = oracle(&edges).expect("no negative cycle");
        let graph = Csr::build(&edges).unwrap();
        let mut answers = Vec::new();
        for sweep in SweepKind::ALL {
            let all = algo::floyd_warshall(&graph, sweep, UNLIMITED).unwrap();
            for i in 1..=n {
                for j in 1..=n {
                    let found = all.distance(i, j).unwrap_or(Weight::INFINITY);
                    assert_eq!(
                        found, expected[i as usize][j as usize],
                        "{sweep} d({i}, {j})"
                    );
                }
            }
            assert_valid(&graph, &all);
            answers.push(all);
        }
        // Plain, pruned and parallel walk the same order: the same trees too.
        assert_eq!(answers[0], answers[1]);
        assert_eq!(answers[0], answers[2]);
    }
}

#[test]
fn row_i_is_the_tree_bellman_ford_grows_from_i() {
    let edges = potential_digraph(7, 60, 240);
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        let all =
            dispatch!(&graph, g => algo::floyd_warshall(g, SweepKind::Pruned, UNLIMITED)).unwrap();
        for i in 1..=60 {
            let tree = all.tree(i);
            let bf = dispatch!(&graph, g => algo::bellman_ford(g, i, ScheduleKind::Queue)).unwrap();
            assert_eq!(tree.root(), i);
            for j in 1..=60 {
                assert_eq!(tree.distance(j), bf.distance(j), "{r} {i} -> {j}");
                assert_eq!(tree.distance(j), all.distance(i, j));
                assert_eq!(tree.path_to(j), all.path(i, j));
            }
            assert_eq!(tree.order().len(), tree.reached_count());
            assert_eq!(all.row(i).len(), 60);
        }
        let mut text = Vec::new();
        all.write_tree_to(1, &mut text).unwrap();
        assert!(String::from_utf8(text).unwrap().starts_with("# root 1\n"));
    }
}

#[test]
fn undirected_graphs_give_dijkstras_distances_both_ways() {
    let mut rng = Rng(11);
    let triples: Vec<_> = (0..300)
        .map(|_| {
            (
                rng.below(80) + 1,
                rng.below(80) + 1,
                rng.below(40) as Weight / 8.0,
            )
        })
        .collect();
    let graph = Csr::build(&EdgeList::from_weighted_edges(80, triples).unwrap()).unwrap();
    for sweep in SweepKind::ALL {
        let all = algo::floyd_warshall(&graph, sweep, UNLIMITED).unwrap();
        for i in 1..=80 {
            let dijkstra = algo::dijkstra(&graph, i, FrontierKind::Heap).unwrap();
            for j in 1..=80 {
                assert_eq!(all.distance(i, j), dijkstra.distance(j), "{sweep}");
                assert_eq!(all.distance(i, j), all.distance(j, i));
            }
        }
    }
}

#[test]
fn the_handout_question_on_a_small_digraph() {
    // A ring 1 → 2 → … → 50 → 1 of unit arcs, and a shortcut 40 → 10 of -5.
    let mut arcs: Vec<_> = (1..=50).map(|i| (i, i % 50 + 1, 1.0)).collect();
    arcs.push((40, 10, -5.0));
    let graph =
        Csr::build(&EdgeList::from_weighted_edges_with(50, arcs, DIRECTED).unwrap()).unwrap();
    let all = algo::floyd_warshall(&graph, SweepKind::Blocked, UNLIMITED).unwrap();
    let pairs: [Vertex; 5] = [10, 20, 30, 40, 50];
    let table: Vec<Vec<Weight>> = pairs
        .iter()
        .map(|&i| pairs.iter().map(|&j| all.distance(i, j).unwrap()).collect())
        .collect();
    assert_eq!(
        table,
        [
            [0.0, 10.0, 20.0, 30.0, 40.0],
            [15.0, 0.0, 10.0, 20.0, 30.0],
            [5.0, 15.0, 0.0, 10.0, 20.0],
            [-5.0, 5.0, 15.0, 0.0, 10.0],
            [10.0, 20.0, 30.0, 40.0, 0.0],
        ]
    );
    assert_eq!(
        all.path(40, 20),
        Some((10..=20).fold(vec![40], |mut p, v| {
            p.push(v);
            p
        }))
    );
}

#[test]
fn a_negative_cycle_shows_on_the_diagonal_and_comes_back_real() {
    let mut cycles = 0;
    for seed in 0..40 {
        let mut rng = Rng(seed);
        let arcs: Vec<_> = (0..80)
            .map(|_| {
                (
                    rng.below(30) + 1,
                    rng.below(30) + 1,
                    rng.below(20) as Weight - 4.0,
                )
            })
            .collect();
        let edges = EdgeList::from_weighted_edges_with(30, arcs, DIRECTED).unwrap();
        let expected = oracle(&edges);
        let graph = Csr::build(&edges).unwrap();
        for sweep in SweepKind::ALL {
            match (algo::floyd_warshall(&graph, sweep, UNLIMITED), &expected) {
                (Ok(all), Some(distances)) => {
                    for i in 1..=30 {
                        for j in 1..=30 {
                            let found = all.distance(i, j).unwrap_or(Weight::INFINITY);
                            assert_eq!(found, distances[i as usize][j as usize]);
                        }
                    }
                }
                (Err(FloydError::NegativeCycle(cycle)), None) => {
                    assert!(cycle.weight < 0.0);
                    let total: Weight = match cycle.len() {
                        1 => graph.negative_loops()[0].weight,
                        _ => cycle.arcs().map(|(u, v)| graph.weight(u, v).unwrap()).sum(),
                    };
                    assert_eq!(total, cycle.weight, "{sweep} {cycle}");
                    cycles += 1;
                }
                (found, _) => panic!("seed {seed} {sweep}: {found:?}"),
            }
        }
    }
    assert!(
        cycles > 20,
        "the sample should have negative cycles ({cycles})"
    );
}

#[test]
fn loops_and_undirected_negative_edges_are_cycles() {
    let looped = EdgeList::parse_with(b"3\n1 2 1\n3 3 -1\n", DIRECTED).unwrap();
    let error = algo::floyd_warshall(&Csr::build(&looped).unwrap(), SweepKind::Plain, UNLIMITED);
    assert_eq!(error, Err(NegativeCycle::new(vec![3], -1.0).into()));

    let figure =
        EdgeList::parse(b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n").unwrap();
    for sweep in SweepKind::ALL {
        let error = algo::floyd_warshall(&Csr::build(&figure).unwrap(), sweep, UNLIMITED);
        assert_eq!(
            error,
            Err(NegativeCycle::new(vec![3, 4], -19.0).into()),
            "{sweep}"
        );
    }
}

#[test]
fn the_table_is_priced_and_refused_past_the_budget() {
    assert_eq!(AllPairs::required_bytes(1_000), 12 * (1_000_000 + 1_000));
    assert_eq!(
        AllPairs::required_bytes(100_000),
        12 * (10_000_000_000 + 100_000)
    );
    assert_eq!(AllPairs::required_bytes(usize::MAX / 2), usize::MAX);
    let graph = Csr::build(&potential_digraph(1, 40, 100)).unwrap();
    let budget = MemoryBudget::Bytes(AllPairs::required_bytes(40) - 1);
    assert_eq!(
        algo::floyd_warshall(&graph, SweepKind::Plain, budget),
        Err(FloydError::TooLarge {
            vertex_count: 40,
            required_bytes: AllPairs::required_bytes(40),
            limit_bytes: AllPairs::required_bytes(40) - 1,
        })
    );
    let all = algo::floyd_warshall(&graph, SweepKind::Plain, MemoryBudget::Machine).unwrap();
    assert_eq!(all.heap_bytes(), 40 * 40 * 12);
}

#[test]
fn the_progress_callback_can_stop_a_run() {
    let graph = Csr::build(&potential_digraph(1, 200, 800)).unwrap();
    for sweep in SweepKind::ALL {
        let stop = |rounds: usize| match rounds < 100 {
            true => Control::Continue,
            false => Control::Break,
        };
        let error = algo::floyd_warshall_with_progress(&graph, sweep, UNLIMITED, &stop);
        let Err(FloydError::Cancelled { rounds, of }) = error else {
            panic!("{sweep}: {error:?}");
        };
        assert_eq!(of, 200);
        // A tile is 64 rounds: the blocked sweep stops at the tile's end.
        assert_eq!(
            rounds,
            if sweep == SweepKind::Blocked {
                128
            } else {
                100
            }
        );
    }
}

#[test]
fn sweeps_parse() {
    for sweep in SweepKind::ALL {
        assert_eq!(sweep.label().parse::<SweepKind>(), Ok(sweep));
    }
    assert!("diagonal".parse::<SweepKind>().is_err());
    let graph = Csr::build(&EdgeList::parse_with(b"1\n", DIRECTED).unwrap()).unwrap();
    let all = algo::floyd_warshall(&graph, SweepKind::Blocked, UNLIMITED).unwrap();
    assert_eq!(
        (all.distance(1, 1), all.path(1, 1)),
        (Some(0.0), Some(vec![1]))
    );
    assert_eq!(graph.vertex_count(), 1);
}

#[test]
fn zero_weight_cycles_still_give_one_tree_per_row() {
    // Weights 0, 1 and 2 on 100 vertices (two tiles): plenty of zero-weight
    // cycles. Reading tiles out of the plain order, the blocked sweep's
    // predecessors go round them in most of these graphs; every row must
    // still be a tree.
    for seed in 0..10 {
        let mut rng = Rng(seed);
        let arcs: Vec<_> = (0..400)
            .map(|_| {
                (
                    rng.below(100) + 1,
                    rng.below(100) + 1,
                    rng.below(3) as Weight,
                )
            })
            .collect();
        let edges = EdgeList::from_weighted_edges_with(100, arcs, DIRECTED).unwrap();
        let graph = Csr::build(&edges).unwrap();
        for sweep in SweepKind::ALL {
            let all = algo::floyd_warshall(&graph, sweep, UNLIMITED).unwrap();
            for i in 1..=100 {
                for j in 1..=100 {
                    // At most n - 1 predecessors back to the row's vertex.
                    let mut at = j;
                    for _ in 0..100 {
                        match all.parent(i, at) {
                            Some(p) => at = p,
                            None => break,
                        }
                    }
                    assert!(
                        all.parent(i, at).is_none(),
                        "{sweep} seed {seed}: row {i} loops"
                    );
                }
            }
            assert_valid(&graph, &all);
            let bf = algo::bellman_ford(&graph, 1, ScheduleKind::Queue).unwrap();
            for j in 1..=100 {
                assert_eq!(all.distance(1, j), bf.distance(j), "{sweep} seed {seed}");
            }
        }
    }
}
