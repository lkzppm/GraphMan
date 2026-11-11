//! Bellman-Ford (Part 3): every schedule must agree with `petgraph`, with
//! Dijkstra when no weight is negative, and with itself; every negative
//! cycle it reports must be a real one.

use graphman::algo::{
    self, MeasuredSchedule, NegativeCycle, Schedule, ScheduleKind, ShortestPathTree, Start, Visitor,
};
use graphman::{
    Build, Csr, EdgeList, FrontierKind, Graph, Orientation, Representation, Vertex, Weight,
    Weighted, dispatch,
};
use petgraph::graph::NodeIndex;

const DIRECTED: Orientation = Orientation::Directed;

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

/// Random arcs with integer weights `0..9`, reweighted by a random potential
/// `h`: `w + h(u) - h(v)`. Every cycle keeps its (non-negative) weight, so
/// there is no negative cycle, but many arcs are negative. Integers keep
/// every sum exact.
fn potential_digraph(seed: u64, n: u32, m: usize) -> Vec<(Vertex, Vertex, Weight)> {
    let mut rng = Rng(seed);
    let h: Vec<Weight> = (0..=n).map(|_| rng.below(20) as Weight).collect();
    (0..m)
        .map(|_| {
            let (u, v) = (rng.below(n) + 1, rng.below(n) + 1);
            let w = rng.below(9) as Weight;
            (u, v, w + h[u as usize] - h[v as usize])
        })
        .collect()
}

fn digraph(n: u32, arcs: &[(Vertex, Vertex, Weight)]) -> EdgeList {
    EdgeList::from_weighted_edges_with(n as usize, arcs.iter().copied(), DIRECTED).unwrap()
}

/// The same arcs as a `petgraph` digraph (node 0 unused, as in GraphMan).
fn petgraph_of(edges: &EdgeList) -> petgraph::Graph<(), Weight> {
    let mut g = petgraph::Graph::new();
    for _ in 0..=edges.vertex_count() {
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
    // GraphMan keeps negative loops beside the adjacency; petgraph keeps them in it.
    for edge in edges.negative_loops() {
        let u = NodeIndex::new(edge.u as usize);
        g.add_edge(u, u, edge.weight);
    }
    g
}

/// The distances `petgraph` finds from `root`, or `None` on a negative cycle.
fn oracle(edges: &EdgeList, root: Vertex) -> Option<Vec<Weight>> {
    let g = petgraph_of(edges);
    let paths = petgraph::algo::bellman_ford(&g, NodeIndex::new(root as usize)).ok()?;
    Some(paths.distances)
}

/// Every reached vertex but the root sits one arc after its parent.
fn assert_valid_tree<G: Weighted>(graph: &G, tree: &ShortestPathTree, label: &str) {
    for v in graph.vertices() {
        let Some(parent) = tree.parent(v) else {
            continue;
        };
        let weight = graph.weight(parent, v).expect("an arc from the parent");
        assert_eq!(
            tree.distance(parent).unwrap() + weight,
            tree.distance(v).unwrap(),
            "{label}: {parent} -> {v}"
        );
    }
}

/// A cycle is real: its arcs exist and add up to its (negative) weight.
fn assert_real_cycle<G: Weighted>(graph: &G, cycle: &NegativeCycle) {
    assert!(cycle.weight < 0.0, "{cycle}");
    let total: Weight = match cycle.len() {
        1 => {
            graph
                .negative_loops()
                .iter()
                .find(|e| e.u == cycle.cycle[0])
                .unwrap()
                .weight
        }
        _ => cycle
            .arcs()
            .map(|(u, v)| graph.weight(u, v).expect("an arc"))
            .sum(),
    };
    assert_eq!(total, cycle.weight, "{cycle}");
    assert_eq!(cycle.cycle[0], *cycle.cycle.iter().min().unwrap());
}

#[test]
fn every_schedule_matches_petgraph_with_negative_arcs() {
    for seed in 0..20 {
        let edges = digraph(60, &potential_digraph(seed, 60, 240));
        assert!(edges.negative_edge().is_some());
        for root in [1, 30] {
            let expected = oracle(&edges, root).expect("no negative cycle");
            for r in Representation::ALL {
                let graph = r.build(&edges).unwrap();
                for kind in ScheduleKind::ALL {
                    let label = format!("seed {seed} root {root} {r} {kind}");
                    let tree = dispatch!(&graph, g => algo::bellman_ford(g, root, kind)).unwrap();
                    for v in 1..=60 {
                        let found = tree.distance(v).unwrap_or(Weight::INFINITY);
                        assert_eq!(found, expected[v as usize], "{label}: d({v})");
                    }
                    dispatch!(&graph, g => assert_valid_tree(g, &tree, &label));
                    assert_eq!(tree.root(), root);
                    // The order lists the reached vertices by distance.
                    let order = tree.order();
                    assert_eq!(order.len(), tree.reached_count());
                    assert!(
                        order
                            .windows(2)
                            .all(|p| tree.distance(p[0]) <= tree.distance(p[1]))
                    );
                }
            }
        }
    }
}

#[test]
fn without_negative_weights_bellman_ford_finds_dijkstras_distances() {
    for seed in 0..10 {
        let mut rng = Rng(seed);
        let triples: Vec<_> = (0..200)
            .map(|_| {
                (
                    rng.below(50) + 1,
                    rng.below(50) + 1,
                    rng.below(10) as Weight / 4.0,
                )
            })
            .collect();
        for orientation in [Orientation::Undirected, DIRECTED] {
            let edges =
                EdgeList::from_weighted_edges_with(50, triples.iter().copied(), orientation)
                    .unwrap();
            let graph = Csr::build(&edges).unwrap();
            let dijkstra = algo::dijkstra(&graph, 1, FrontierKind::Heap).unwrap();
            for kind in ScheduleKind::ALL {
                let tree = algo::bellman_ford(&graph, 1, kind).unwrap();
                for v in 1..=50 {
                    assert_eq!(
                        tree.distance(v),
                        dijkstra.distance(v),
                        "{orientation} {kind}"
                    );
                }
                assert_valid_tree(&graph, &tree, kind.label());
            }
        }
    }
}

#[test]
fn distances_to_a_target_come_from_the_transpose() {
    for seed in 0..10 {
        let edges = digraph(50, &potential_digraph(seed, 50, 200));
        let reversed = edges.transpose();
        for target in [1, 25] {
            let expected = oracle(&reversed, target).unwrap();
            for r in Representation::ALL {
                let graph = r.build(&edges).unwrap();
                for kind in ScheduleKind::ALL {
                    let tree =
                        dispatch!(&graph, g => algo::bellman_ford_to(g, target, kind)).unwrap();
                    for v in 1..=50 {
                        let found = tree.distance(v).unwrap_or(Weight::INFINITY);
                        assert_eq!(found, expected[v as usize], "{r} {kind} d({v}, {target})");
                        // The path from v runs along the graph's own arcs.
                        let Some(path) = tree.path_from(v) else {
                            continue;
                        };
                        assert_eq!((path[0], *path.last().unwrap()), (v, target));
                        let length: Weight = path
                            .windows(2)
                            .map(|arc| graph.weight(arc[0], arc[1]).expect("an arc"))
                            .sum();
                        assert_eq!(length, found, "{r} {kind} path {path:?}");
                    }
                }
            }
        }
    }
}

#[test]
fn the_handout_question_on_a_small_digraph() {
    // From 10, 20 and 30 to 100 on a ring of 100 arcs i → i + 1 weighing 1,
    // with a shortcut 20 → 90 weighing -5.
    let mut arcs: Vec<_> = (1..=100).map(|i| (i, i % 100 + 1, 1.0)).collect();
    arcs.push((20, 90, -5.0));
    let graph = Csr::build(&digraph(100, &arcs)).unwrap();
    let tree = algo::bellman_ford_to(&graph, 100, ScheduleKind::Queue).unwrap();
    assert_eq!(tree.distance(30), Some(70.0));
    assert_eq!(tree.distance(20), Some(5.0));
    assert_eq!(tree.distance(10), Some(15.0));
    let path = tree.path_from(10).unwrap();
    assert_eq!(path, (10..=20).chain(90..=100).collect::<Vec<_>>());
    let mut text = Vec::new();
    tree.write_toward_root_to(&mut text).unwrap();
    let text = String::from_utf8(text).unwrap();
    assert!(text.starts_with("# target 100\n# vertex successor distance\n"));
    assert!(text.contains("\n20 90 5\n"));
}

/// Potential arcs plus a planted cycle 41 → 42 → 43 → 41 of weight -1,
/// entered from `entry` (no entry: unreachable).
fn with_planted_cycle(seed: u64, entry: Option<Vertex>) -> EdgeList {
    let mut arcs = potential_digraph(seed, 40, 160);
    arcs.extend([(41, 42, 2.0), (42, 43, -4.0), (43, 41, 1.0)]);
    if let Some(entry) = entry {
        arcs.push((entry, 41, 3.0));
    }
    // 41..=43 also reach back into the rest, so the cycle reaches vertex 1.
    arcs.push((42, 1, 0.0));
    digraph(45, &arcs)
}

#[test]
fn a_reachable_negative_cycle_is_returned_as_a_certificate() {
    for seed in 0..10 {
        let edges = with_planted_cycle(seed, Some(1));
        assert!(oracle(&edges, 1).is_none());
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            for kind in ScheduleKind::ALL {
                let cycle = dispatch!(&graph, g => algo::bellman_ford(g, 1, kind)).unwrap_err();
                dispatch!(&graph, g => assert_real_cycle(g, &cycle));
                assert_eq!(cycle.cycle, [41, 42, 43], "{r} {kind}");
                assert_eq!(cycle.weight, -1.0);
                // To vertex 1, which the cycle reaches: the same cycle,
                // read in the graph's own orientation.
                let to = dispatch!(&graph, g => algo::bellman_ford_to(g, 1, kind)).unwrap_err();
                let algo::BellmanFordError::NegativeCycle(to) = to else {
                    panic!("the transpose fits");
                };
                assert_eq!(to, cycle, "{r} {kind}");
            }
        }
    }
}

#[test]
fn an_unreachable_negative_cycle_only_shows_from_everywhere() {
    let edges = with_planted_cycle(3, None);
    let graph = Csr::build(&edges).unwrap();
    for kind in ScheduleKind::ALL {
        // Nothing in 1..=40 enters the cycle.
        let tree = algo::bellman_ford(&graph, 1, kind).unwrap();
        assert!(!tree.is_reached(41));
        let cycle = algo::negative_cycle(&graph, kind).expect("41 -> 42 -> 43 -> 41");
        assert_eq!(cycle.cycle, [41, 42, 43]);
        // To 1, which the cycle reaches through 42 -> 1: no answer.
        assert!(algo::bellman_ford_to(&graph, 1, kind).is_err());
    }
    let clean = Csr::build(&digraph(40, &potential_digraph(3, 40, 160))).unwrap();
    assert_eq!(algo::negative_cycle(&clean, ScheduleKind::Queue), None);
}

#[test]
fn random_negative_cycles_agree_with_petgraph() {
    let mut cycles = 0;
    for seed in 0..60 {
        let mut rng = Rng(seed);
        let arcs: Vec<_> = (0..90)
            .map(|_| {
                (
                    rng.below(30) + 1,
                    rng.below(30) + 1,
                    rng.below(20) as Weight - 4.0,
                )
            })
            .collect();
        let edges = digraph(30, &arcs);
        let graph = Csr::build(&edges).unwrap();
        for root in [1, 15] {
            let expected = oracle(&edges, root);
            for kind in ScheduleKind::ALL {
                match (algo::bellman_ford(&graph, root, kind), &expected) {
                    (Ok(tree), Some(distances)) => {
                        for v in 1..=30 {
                            let found = tree.distance(v).unwrap_or(Weight::INFINITY);
                            assert_eq!(found, distances[v as usize]);
                        }
                    }
                    (Err(cycle), None) => {
                        assert_real_cycle(&graph, &cycle);
                        cycles += 1;
                    }
                    (found, _) => panic!("seed {seed} root {root} {kind}: {found:?}"),
                }
            }
        }
        // The whole-graph answer agrees with petgraph's from a virtual root.
        let mut with_root = arcs.clone();
        with_root.extend((1..=30).map(|v| (31, v, 0.0)));
        let anywhere = oracle(&digraph(31, &with_root), 31).is_none();
        for kind in ScheduleKind::ALL {
            let found = algo::negative_cycle(&graph, kind);
            assert_eq!(found.is_some(), anywhere, "seed {seed} {kind}");
            if let Some(cycle) = found {
                assert_real_cycle(&graph, &cycle);
            }
        }
    }
    assert!(
        cycles > 20,
        "the sample should have negative cycles ({cycles})"
    );
}

#[test]
fn a_negative_loop_is_a_cycle_of_one_arc() {
    let text = b"4\n1 2 1\n2 3 1\n3 3 -1\n4 4 -2\n";
    let edges = EdgeList::parse_with(text, DIRECTED).unwrap();
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        for kind in ScheduleKind::ALL {
            let from_1 = dispatch!(&graph, g => algo::bellman_ford(g, 1, kind)).unwrap_err();
            assert_eq!(from_1, NegativeCycle::new(vec![3], -1.0), "{r} {kind}");
            // 4 is out of reach of 1, and no loop reaches 2.
            let to_2 = dispatch!(&graph, g => algo::bellman_ford_to(g, 2, kind)).unwrap();
            assert_eq!(to_2.distance(1), Some(1.0));
            let anywhere = dispatch!(&graph, g => algo::negative_cycle(g, kind)).unwrap();
            assert_eq!(anywhere.cycle, [3]);
        }
    }
}

#[test]
fn an_undirected_negative_edge_is_a_cycle_of_two_arcs() {
    let edges = EdgeList::parse(b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n").unwrap();
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        for kind in ScheduleKind::ALL {
            let cycle = dispatch!(&graph, g => algo::bellman_ford(g, 1, kind)).unwrap_err();
            assert_eq!(cycle, NegativeCycle::new(vec![3, 4], -19.0), "{r} {kind}");
        }
    }
    // Out of reach, it changes nothing.
    let edges = EdgeList::parse(b"4\n1 2 1\n3 4 -1\n").unwrap();
    let tree = algo::bellman_ford(&Csr::build(&edges).unwrap(), 1, ScheduleKind::Queue).unwrap();
    assert_eq!(tree.distance(2), Some(1.0));
}

#[test]
fn passes_show_what_each_optimisation_buys() {
    let n = 40;
    let passes = |arcs: &[(Vertex, Vertex, Weight)], root, kind: ScheduleKind| {
        let graph = Csr::build(&digraph(n, arcs)).unwrap();
        let mut schedule = MeasuredSchedule::new(kind.schedule());
        algo::bellman_ford_with(&graph, root, &mut schedule, &mut ()).unwrap();
        schedule.counts()
    };
    // A path climbing the ids: one pass in id order relaxes it all.
    let up: Vec<_> = (1..n).map(|i| (i, i + 1, 1.0)).collect();
    // The same path descending: one vertex per pass in id order.
    let down: Vec<_> = (1..n).map(|i| (i + 1, i, 1.0)).collect();
    let rounds = passes(&up, 1, ScheduleKind::Rounds);
    assert_eq!(rounds.passes, n as usize - 1);
    assert_eq!(rounds.scans, (n as usize - 1) * n as usize);
    assert_eq!(passes(&up, 1, ScheduleKind::EarlyStop).passes, 2);
    assert_eq!(passes(&down, n, ScheduleKind::EarlyStop).passes, n as usize);
    // Yen sweeps down too: two passes either way, the second confirming.
    assert_eq!(passes(&up, 1, ScheduleKind::Yen).passes, 2);
    assert_eq!(passes(&down, n, ScheduleKind::Yen).passes, 2);
    // The queue scans each vertex of a path once.
    let queue = passes(&down, n, ScheduleKind::Queue);
    assert_eq!((queue.scans, queue.lowered), (n as usize, n as usize - 1));

    // On random graphs, the bounds of the table in `algo::schedule`.
    for seed in 0..10 {
        let arcs = potential_digraph(seed, n, 160);
        for kind in ScheduleKind::ALL {
            let counts = passes(&arcs, 1, kind);
            let bound = match kind {
                ScheduleKind::Rounds | ScheduleKind::EarlyStop | ScheduleKind::Queue => n as usize,
                ScheduleKind::Yen => (n as usize).div_ceil(2) + 1,
                ScheduleKind::RandomYen | ScheduleKind::Slf => n as usize * n as usize,
            };
            assert!(counts.passes <= bound, "{kind}: {counts:?}");
            assert!(counts.lowered >= 1);
        }
    }
}

#[test]
fn the_visitor_sees_scans_relaxations_and_passes() {
    #[derive(Default)]
    struct Log {
        scans: Vec<Vertex>,
        relaxed: usize,
        passes: Vec<usize>,
    }
    impl Visitor for Log {
        fn scan(&mut self, v: Vertex, _distance: Weight) {
            self.scans.push(v);
        }
        fn relax(&mut self, _v: Vertex, _parent: Vertex, previous: Weight, distance: Weight) {
            assert!(distance < previous);
            self.relaxed += 1;
        }
        fn pass_complete(&mut self, pass: usize) {
            self.passes.push(pass);
        }
    }
    // 1 → 2 (4), 1 → 3 (3), 3 → 2 (-2): 2 is lowered twice.
    let edges = EdgeList::parse_with(b"3\n1 2 4\n1 3 3\n3 2 -2\n", DIRECTED).unwrap();
    let graph = Csr::build(&edges).unwrap();
    let mut log = Log::default();
    let mut schedule = ScheduleKind::Queue.schedule();
    algo::bellman_ford_with(&graph, 1, &mut schedule, &mut log).unwrap();
    assert_eq!(log.scans, [1, 2, 3, 2]);
    assert_eq!(log.relaxed, 3);
    assert_eq!(log.passes, [1, 2, 3]);
    assert_eq!(schedule.passes(), 3);
}

#[test]
fn potentials_from_everywhere_make_every_arc_non_negative() {
    for seed in 0..10 {
        let edges = digraph(50, &potential_digraph(seed, 50, 200));
        let graph = Csr::build(&edges).unwrap();
        let mut tree = ShortestPathTree::new(50);
        let mut schedule = ScheduleKind::Queue.schedule();
        algo::bellman_ford_into(&graph, Start::Everywhere, &mut schedule, &mut tree, &mut ())
            .unwrap();
        assert_eq!(tree.reached_count(), 50);
        let h = |v| tree.distance(v).unwrap();
        for u in graph.vertices() {
            assert!(h(u) <= 0.0);
            for (v, w) in graph.weighted_neighbors(u) {
                assert!(w + h(u) - h(v) >= 0.0, "{u} -> {v}");
            }
        }
    }
}

#[test]
fn a_tree_is_reused_across_runs_and_algorithms() {
    let csr = Csr::build(&digraph(30, &potential_digraph(1, 30, 120))).unwrap();
    let mut tree = ShortestPathTree::new(30);
    let mut schedule = ScheduleKind::Yen.schedule();
    for root in 1..=30 {
        algo::bellman_ford_into(&csr, Start::Vertex(root), &mut schedule, &mut tree, &mut ())
            .unwrap();
        assert_eq!(
            tree,
            algo::bellman_ford(&csr, root, ScheduleKind::Yen).unwrap(),
            "{root}"
        );
    }
    // A failed run leaves the tree empty.
    let cyclic = Csr::build(&with_planted_cycle(1, Some(1))).unwrap();
    let mut tree = ShortestPathTree::new(45);
    let mut schedule = ScheduleKind::Queue.schedule();
    assert!(
        algo::bellman_ford_into(&cyclic, Start::Vertex(1), &mut schedule, &mut tree, &mut ())
            .is_err()
    );
    assert_eq!(tree.reached_count(), 0);
    assert!(!tree.is_reached(1));
}
