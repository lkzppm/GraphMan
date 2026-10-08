//! Weighted graphs and Dijkstra: every representation and every frontier
//! must agree with each other and with a brute-force oracle.

use graphman::algo::{
    self, Frontier, FrontierKind, HeapFrontier, LazyHeapFrontier, ShortestPathTree, VectorFrontier,
};
use graphman::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, Csr, EdgeList, Graph, MemoryBudget,
    NegativeWeight, Representation, Vertex, Weight, Weighted, WeightedEdge, dispatch,
};

/// Figure 1 of the Part 2 handout.
const FIGURE: &[u8] = b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n";

/// The same graph with the negative weight made positive.
const FIGURE_POSITIVE: &[u8] = b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 9.5\n4 5 2.3\n1 5 1\n";

/// A tiny deterministic PRNG (SplitMix64) so tests never need a dependency.
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

/// A random weighted graph. Small integer weights (with zeros) make ties
/// common, which is what the determinism tests need; `fractional` adds
/// arbitrary reals.
fn random_weighted(seed: u64, n: u32, m: usize, fractional: bool) -> EdgeList {
    let mut rng = Rng(seed);
    let edges: Vec<(Vertex, Vertex, Weight)> = (0..m)
        .map(|_| {
            let (u, v) = (rng.below(n) + 1, rng.below(n) + 1);
            let weight = match fractional {
                true => rng.below(1_000_000) as Weight / 1000.0,
                false => rng.below(5) as Weight,
            };
            (u, v, weight)
        })
        .collect();
    EdgeList::from_weighted_edges(n as usize, edges).unwrap()
}

/// Bellman-Ford: `n - 1` rounds of relaxing every edge. Slow and obviously
/// right, which is what an oracle should be.
fn oracle(edges: &EdgeList, root: Vertex) -> Vec<Weight> {
    let mut distance = vec![Weight::INFINITY; edges.vertex_count() + 1];
    distance[root as usize] = 0.0;
    for _ in 1..edges.vertex_count() {
        let mut changed = false;
        for WeightedEdge { u, v, weight } in edges.weighted_edges() {
            for (a, b) in [(u, v), (v, u)] {
                let through = distance[a as usize] + weight;
                if through < distance[b as usize] {
                    distance[b as usize] = through;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    distance
}

fn close(a: Weight, b: Weight) -> bool {
    a == b || (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

fn all_representations(edges: &EdgeList) -> Vec<AnyGraph> {
    Representation::ALL
        .into_iter()
        .map(|r| r.build_within(edges, MemoryBudget::Unlimited).unwrap())
        .collect()
}

fn run<G: Weighted, F: Frontier>(graph: &G, root: Vertex, frontier: &mut F) -> ShortestPathTree {
    algo::dijkstra_with(graph, root, frontier, &mut ()).unwrap()
}

#[test]
fn the_handout_figure_is_refused_for_its_negative_edge() {
    let edges = EdgeList::parse(FIGURE).unwrap();
    for graph in all_representations(&edges) {
        assert!(graph.is_weighted());
        for kind in FrontierKind::ALL {
            let refused = dispatch!(&graph, g => algo::dijkstra(g, 1, kind)).unwrap_err();
            assert_eq!(
                refused,
                NegativeWeight {
                    edge: WeightedEdge {
                        u: 3,
                        v: 4,
                        weight: -9.5
                    }
                }
            );
            assert!(refused.to_string().contains("not implemented yet"));
        }
        // The unweighted algorithms still run on it.
        assert_eq!(dispatch!(&graph, g => algo::bfs(g, 1).depth()), 2);
    }
}

#[test]
fn the_positive_figure_has_the_hand_checked_distances() {
    let edges = EdgeList::parse(FIGURE_POSITIVE).unwrap();
    let expected: [(Vertex, Weight, &[Vertex]); 5] = [
        (1, 0.0, &[1]),
        (2, 0.1, &[1, 2]),
        (5, 0.3, &[1, 2, 5]),
        (4, 2.6, &[1, 2, 5, 4]),
        (3, 5.3, &[1, 2, 5, 3]),
    ];
    for graph in all_representations(&edges) {
        for kind in FrontierKind::ALL {
            let tree = dispatch!(&graph, g => algo::dijkstra(g, 1, kind)).unwrap();
            assert_eq!(
                tree.order(),
                &[1, 2, 5, 4, 3],
                "{kind} on {}",
                graph.representation()
            );
            for (v, distance, path) in expected {
                assert!(close(tree.distance(v).unwrap(), distance), "d(1, {v})");
                assert_eq!(tree.path_to(v).unwrap(), path);
            }
            assert_eq!(tree.parent(1), None);
            assert_eq!(tree.last_settled().0, 3);
        }
    }
}

#[test]
fn every_representation_reads_the_same_weights() {
    let edges = random_weighted(3, 200, 800, true);
    let graphs = all_representations(&edges);
    for graph in &graphs {
        assert!(graph.is_weighted());
        for WeightedEdge { u, v, weight } in edges.weighted_edges() {
            assert_eq!(graph.weight(u, v), Some(weight));
            assert_eq!(graph.weight(v, u), Some(weight));
        }
        assert_eq!(graph.weight(1, 1), None);
    }
    for v in 1..=200 {
        let rows: Vec<Vec<(Vertex, Weight)>> = graphs
            .iter()
            .map(|g| dispatch!(g, g => g.weighted_neighbors(v).collect()))
            .collect();
        assert!(rows.windows(2).all(|w| w[0] == w[1]), "row {v}");
        let plain: Vec<Vertex> = dispatch!(&graphs[0], g => g.neighbors(v).collect());
        assert_eq!(rows[0].iter().map(|&(w, _)| w).collect::<Vec<_>>(), plain);
    }
}

#[test]
fn frontiers_and_representations_build_identical_trees() {
    for (seed, n, m) in [(1u64, 60u32, 150usize), (2, 300, 900), (3, 500, 4000)] {
        let edges = random_weighted(seed, n, m, false);
        let graphs = all_representations(&edges);
        for root in [1, 2, n / 2, n] {
            let reference = dispatch!(&graphs[0], g => run(g, root, &mut HeapFrontier::default()));
            let truth = oracle(&edges, root);
            for v in 1..=n {
                let found = reference.distance(v).unwrap_or(Weight::INFINITY);
                assert!(
                    close(found, truth[v as usize]),
                    "seed {seed}, d({root}, {v})"
                );
            }
            for graph in &graphs {
                let vector = dispatch!(graph, g => run(g, root, &mut VectorFrontier::default()));
                let heap = dispatch!(graph, g => run(g, root, &mut HeapFrontier::default()));
                let lazy = dispatch!(graph, g => run(g, root, &mut LazyHeapFrontier::default()));
                let at = graph.representation();
                assert_eq!(
                    vector, reference,
                    "vector on {at}, seed {seed}, root {root}"
                );
                assert_eq!(heap, reference, "heap on {at}, seed {seed}, root {root}");
                assert_eq!(
                    lazy, reference,
                    "lazy heap on {at}, seed {seed}, root {root}"
                );
            }
        }
    }
}

#[test]
fn real_weights_match_the_oracle() {
    let edges = random_weighted(11, 400, 2000, true);
    let graph = Csr::build(&edges).unwrap();
    let mut frontier = VectorFrontier::default();
    let mut tree = ShortestPathTree::new(400);
    for root in [1, 77, 400] {
        algo::dijkstra_into(&graph, root, &mut frontier, &mut tree, &mut ()).unwrap();
        let truth = oracle(&edges, root);
        for v in 1..=400u32 {
            let found = tree.distance(v).unwrap_or(Weight::INFINITY);
            assert!(close(found, truth[v as usize]), "d({root}, {v})");
            if let Some(path) = tree.path_to(v) {
                // The path exists in the graph and weighs what it claims.
                let total: Weight = path
                    .windows(2)
                    .map(|e| graph.weight(e[0], e[1]).unwrap())
                    .sum();
                assert!(close(total, found));
            }
        }
    }
}

#[test]
fn unit_weights_reproduce_bfs_distances() {
    let mut rng = Rng(5);
    let pairs: Vec<(Vertex, Vertex)> = (0..1500)
        .map(|_| (rng.below(500) + 1, rng.below(500) + 1))
        .collect();
    let unweighted = EdgeList::from_edges(500, pairs.iter().copied()).unwrap();
    let ones = EdgeList::from_weighted_edges(500, pairs.iter().map(|&(u, v)| (u, v, 1.0))).unwrap();
    for edges in [&unweighted, &ones] {
        let graph = AdjacencyList::build(edges).unwrap();
        assert_eq!(graph.is_weighted(), edges.is_weighted());
        for root in [1, 250, 500] {
            let bfs = algo::bfs(&graph, root);
            let dijkstra = algo::dijkstra(&graph, root, FrontierKind::Heap).unwrap();
            assert_eq!(bfs.reached_count(), dijkstra.reached_count());
            for v in 1..=500 {
                assert_eq!(
                    bfs.level(v).map(Weight::from),
                    dijkstra.distance(v),
                    "d({root}, {v})"
                );
            }
        }
    }
}

#[test]
fn shortest_path_stops_early_and_the_tree_stays_reusable() {
    let edges = random_weighted(8, 300, 1200, true);
    let graph = Csr::build(&edges).unwrap();
    let full = algo::dijkstra(&graph, 1, FrontierKind::Heap).unwrap();
    let mut frontier = HeapFrontier::default();
    let mut tree = ShortestPathTree::new(300);
    for target in [1, 5, 150, 300] {
        let path = algo::shortest_path_into(&graph, 1, target, &mut frontier, &mut tree).unwrap();
        match full.distance(target) {
            None => assert_eq!(path, None),
            Some(distance) => {
                let path = path.unwrap();
                assert_eq!(path.distance, distance);
                assert_eq!(Some(path.vertices), full.path_to(target));
                // Stopped at the target: nothing farther was settled.
                assert!(
                    tree.order()
                        .iter()
                        .all(|&v| tree.distance(v).unwrap() <= distance)
                );
                assert!(
                    tree.distances_raw()
                        .iter()
                        .all(|&d| d <= distance || d.is_infinite())
                );
            }
        }
    }
    // After an early stop, a full run into the same tree is a fresh run.
    algo::dijkstra_into(&graph, 1, &mut frontier, &mut tree, &mut ()).unwrap();
    assert_eq!(tree, full);
}

#[test]
fn unreachable_vertices_have_no_distance() {
    let edges = EdgeList::parse(b"6\n1 2 1.5\n2 3 0\n4 5 2\n").unwrap();
    let graph = AdjacencyMatrix::build(&edges).unwrap();
    let tree = algo::dijkstra(&graph, 1, FrontierKind::Vector).unwrap();
    assert_eq!(tree.distance(3), Some(1.5)); // zero-weight edge
    assert_eq!(tree.distance(4), None);
    assert_eq!(tree.path_to(6), None);
    assert_eq!(tree.reached_count(), 3);
    assert_eq!(algo::shortest_path(&graph, 1, 5).unwrap(), None);
    let mut text = Vec::new();
    tree.write_to(&mut text).unwrap();
    let text = String::from_utf8(text).unwrap();
    assert!(text.contains("\n3 2 1.5\n") && text.contains("\n4 - -\n"));
}

#[test]
fn weights_change_what_each_representation_costs() {
    let (n, m) = (10_000, 109_921);
    for r in Representation::ALL {
        assert!(r.required_bytes(n, m, true) > r.required_bytes(n, m, false));
    }
    // CSR and list: one f64 per neighbour entry. Matrix: an n × n table.
    assert_eq!(
        Representation::Csr.required_bytes(n, m, true)
            - Representation::Csr.required_bytes(n, m, false),
        2 * m * 8
    );
    assert_eq!(
        Representation::AdjacencyMatrix.required_bytes(n, m, true)
            - Representation::AdjacencyMatrix.required_bytes(n, m, false),
        (n + 1) * (n + 1) * 8
    );
    let edges = random_weighted(2, 50, 100, true);
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        assert_eq!(
            graph.heap_bytes(),
            r.required_bytes(50, edges.edge_count(), true),
            "{r}"
        );
    }
    let unweighted = EdgeList::from_edges(50, edges.edges().iter().map(|&[u, v]| (u, v))).unwrap();
    let csr = Csr::build(&unweighted).unwrap();
    assert!(!csr.is_weighted() && csr.weights().is_empty());
    assert_eq!(
        csr.weight(edges.edges()[0][0], edges.edges()[0][1]),
        Some(1.0)
    );
    assert_eq!(Graph::vertex_count(&csr), 50);
}

#[test]
fn sizes_that_do_not_fit_saturate_instead_of_wrapping() {
    // On a 32-bit target (the browser) these products overflow; a wrapped
    // size would slip under the budget. Saturated, it exceeds every budget.
    let huge = usize::MAX / 4;
    for r in Representation::ALL {
        assert_eq!(r.required_bytes(huge, huge, true), usize::MAX, "{r}");
    }
    assert_eq!(
        Representation::AdjacencyMatrix.required_bytes(1 << 34, 0, false),
        usize::MAX
    );
}

#[test]
fn a_refused_run_leaves_an_empty_tree() {
    let good = Csr::build(&EdgeList::parse(FIGURE_POSITIVE).unwrap()).unwrap();
    let bad = Csr::build(&EdgeList::parse(FIGURE).unwrap()).unwrap();
    let mut tree = ShortestPathTree::new(5);
    let mut frontier = HeapFrontier::default();
    algo::dijkstra_into(&good, 1, &mut frontier, &mut tree, &mut ()).unwrap();
    assert!(algo::dijkstra_into(&bad, 1, &mut frontier, &mut tree, &mut ()).is_err());
    assert_eq!(tree.reached_count(), 0);
    assert_eq!(tree.distance(1), None);
    assert!(tree.distances_raw().iter().all(|d| d.is_infinite()));
}
