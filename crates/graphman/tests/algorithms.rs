//! Cross-representation and cross-method consistency tests.

use graphman::algo::{self, DiameterMethod};
use graphman::{
    AdjacencyList, AdjacencyMatrix, Build, Components, Csr, EdgeList, Graph, MemoryBudget,
    Representation, dispatch,
};

/// Figure 1 of the assignment.
fn figure_one() -> EdgeList {
    EdgeList::parse(b"5\n1 2\n2 5\n5 3\n4 5\n1 5\n").unwrap()
}

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

fn random_graph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let edges = (0..m).map(|_| (rng.below(n) + 1, rng.below(n) + 1));
    EdgeList::from_edges(n as usize, edges).unwrap()
}

#[test]
fn figure_one_bfs_and_dfs_match_the_assignment() {
    let g = AdjacencyList::build(&figure_one()).unwrap();
    let bfs = algo::bfs(&g, 1);
    assert_eq!((bfs.parent(1), bfs.level(1)), (None, Some(0)));
    assert_eq!((bfs.parent(2), bfs.level(2)), (Some(1), Some(1)));
    assert_eq!((bfs.parent(5), bfs.level(5)), (Some(1), Some(1)));
    assert_eq!((bfs.parent(3), bfs.level(3)), (Some(5), Some(2)));
    assert_eq!((bfs.parent(4), bfs.level(4)), (Some(5), Some(2)));
    assert_eq!(bfs.order(), &[1, 2, 5, 3, 4]);

    let dfs = algo::dfs(&g, 1);
    assert_eq!(dfs.order(), &[1, 2, 5, 3, 4]);
    assert_eq!((dfs.parent(5), dfs.level(5)), (Some(2), Some(2)));
    assert_eq!((dfs.parent(3), dfs.level(3)), (Some(5), Some(3)));
    assert_eq!((dfs.parent(4), dfs.level(4)), (Some(5), Some(3)));
}

#[test]
fn figure_one_stats_distance_components_and_diameter() {
    let g = Csr::build(&figure_one()).unwrap();
    let stats = algo::degree_stats(&g);
    assert_eq!((stats.min, stats.max), (1, 4));
    assert!((stats.mean - 2.0).abs() < 1e-12);
    assert_eq!(stats.median, 2.0);

    assert_eq!(algo::distance(&g, 3, 4), Some(2));
    assert_eq!(algo::distance(&g, 1, 1), Some(0));
    assert_eq!(algo::eccentricity(&g, 5).0, 1);

    let components = Components::compute(&g);
    assert_eq!(components.count(), 1);
    assert_eq!(components.members(1), &[1, 2, 3, 4, 5]);

    for method in DiameterMethod::ALL {
        let d = algo::diameter(&g, method);
        assert_eq!(d.value, 2, "{method}");
        assert_eq!(algo::distance(&g, d.endpoints.0, d.endpoints.1), Some(2));
    }
}

#[test]
fn every_representation_agrees() {
    let edges = random_graph(7, 300, 900);
    let graphs = [
        Representation::AdjacencyList.build(&edges).unwrap(),
        Representation::AdjacencyMatrix.build(&edges).unwrap(),
        Representation::Csr.build(&edges).unwrap(),
    ];
    for g in &graphs {
        assert_eq!(g.vertex_count(), 300);
        assert_eq!(g.edge_count(), edges.edge_count());
    }
    let list = &graphs[0];
    for g in &graphs[1..] {
        for v in 1..=300u32 {
            assert_eq!(g.degree(v), list.degree(v));
            let mine: Vec<u32> = dispatch!(g, g => g.neighbors(v).collect());
            let theirs: Vec<u32> = dispatch!(list, g => g.neighbors(v).collect());
            assert_eq!(
                mine,
                theirs,
                "neighbours of {v} differ in {}",
                g.representation()
            );
            assert!(
                mine.windows(2).all(|w| w[0] < w[1]),
                "neighbours must be ascending"
            );
        }
        for root in [1u32, 2, 3, 150, 300] {
            let a = dispatch!(g, g => algo::bfs(g, root));
            let b = dispatch!(list, g => algo::bfs(g, root));
            assert_eq!(a, b, "bfs from {root} in {}", g.representation());
            let a = dispatch!(g, g => algo::dfs(g, root));
            let b = dispatch!(list, g => algo::dfs(g, root));
            assert_eq!(a, b, "dfs from {root} in {}", g.representation());
        }
        for &[u, v] in edges.edges() {
            assert!(g.has_edge(u, v) && g.has_edge(v, u));
        }
        assert!(!g.has_edge(1, 1));
    }
}

#[test]
fn diameter_methods_agree_on_random_graphs() {
    for (seed, n, m) in [
        (1u64, 200u32, 260usize),
        (2, 500, 700),
        (3, 1000, 1500),
        (4, 400, 5000),
    ] {
        let g = Csr::build(&random_graph(seed, n, m)).unwrap();
        let exact = algo::diameter(&g, DiameterMethod::Exact);
        let ifub = algo::diameter(&g, DiameterMethod::IFub);
        let bounds = algo::diameter(&g, DiameterMethod::Bounds);
        let sweep = algo::diameter(&g, DiameterMethod::Sweep);
        assert_eq!(ifub.value, exact.value, "seed {seed}");
        assert_eq!(bounds.value, exact.value, "seed {seed}");
        assert!(ifub.is_exact && bounds.is_exact && exact.is_exact && !sweep.is_exact);
        assert!(sweep.value <= exact.value, "seed {seed}");
        // Exact-but-smart methods may spend a few extra sweeps on tiny graphs,
        // but never a multiple of the brute force.
        assert!(ifub.bfs_count <= exact.bfs_count + 64, "seed {seed}");
        assert!(bounds.bfs_count <= exact.bfs_count + 64, "seed {seed}");
        for d in [&exact, &ifub, &bounds, &sweep] {
            assert_eq!(
                algo::distance(&g, d.endpoints.0, d.endpoints.1),
                Some(d.value)
            );
        }
    }
}

#[test]
fn components_are_sorted_and_complete() {
    // Three components: a path of 4, a triangle and an isolated vertex.
    let edges = EdgeList::from_edges(8, [(1, 2), (2, 3), (3, 4), (5, 6), (6, 7), (7, 5)]).unwrap();
    let g = AdjacencyList::build(&edges).unwrap();
    let c = Components::compute(&g);
    assert_eq!(c.count(), 3);
    assert_eq!(c.sizes().collect::<Vec<_>>(), vec![4, 3, 1]);
    assert_eq!(c.members(1), &[1, 2, 3, 4]);
    assert_eq!(c.members(2), &[5, 6, 7]);
    assert_eq!(c.members(3), &[8]);
    assert_eq!((c.largest_size(), c.smallest_size()), (4, 1));
    assert_eq!(c.component_of(6), 2);

    assert_eq!(algo::distance(&g, 1, 5), None);
    assert_eq!(algo::diameter(&g, DiameterMethod::Exact).value, 3);
    assert_eq!(algo::diameter(&g, DiameterMethod::IFub).value, 3);
    assert_eq!(algo::diameter(&g, DiameterMethod::Bounds).value, 3);
    let tree = algo::bfs(&g, 8);
    assert_eq!(tree.reached_count(), 1);
    assert!(!tree.is_reached(1));
}

#[test]
fn path_graph_diameter_and_search_trees() {
    let n = 1000u32;
    let edges = EdgeList::from_edges(n as usize, (1..n).map(|v| (v, v + 1))).unwrap();
    let g = Csr::build(&edges).unwrap();
    for method in DiameterMethod::ALL {
        let d = algo::diameter(&g, method);
        assert_eq!(d.value, n - 1, "{method}");
    }
    let dfs = algo::dfs(&g, 1);
    assert_eq!(dfs.depth(), n - 1);
    let bfs = algo::bfs(&g, 500);
    assert_eq!(bfs.depth(), 500);
    assert_eq!(bfs.last_discovered().1, 500);
}

#[test]
fn matrix_respects_the_memory_budget() {
    let edges = random_graph(9, 2000, 100);
    let err = AdjacencyMatrix::build_within(&edges, MemoryBudget::Bytes(1000)).unwrap_err();
    assert!(matches!(err, graphman::BuildError::OverBudget { .. }));
    assert!(AdjacencyMatrix::build_within(&edges, MemoryBudget::Unlimited).is_ok());
    assert_eq!(
        Representation::AdjacencyMatrix.required_bytes(375_000, 0) / 1_000_000_000,
        17
    );
}

#[test]
fn radial_layout_partitions_the_circle() {
    let g = Csr::build(&random_graph(11, 2000, 6000)).unwrap();
    let tree = algo::bfs(&g, 1);
    let layout = algo::radial_layout(&tree);
    assert_eq!(layout.subtree_size[1] as usize, tree.reached_count());
    for &v in tree.order() {
        let a = layout.angle[v as usize];
        assert!(
            (0.0..=core::f32::consts::TAU + 1e-3).contains(&a),
            "angle {a} of {v}"
        );
    }
}

#[test]
fn search_tree_reset_is_incremental_and_correct() {
    let g = Csr::build(&random_graph(5, 100, 150)).unwrap();
    let mut tree = graphman::SearchTree::new(100);
    algo::bfs_into(&g, 1, &mut tree, &mut ());
    let fresh = algo::bfs(&g, 50);
    algo::bfs_into(&g, 50, &mut tree, &mut ());
    assert_eq!(tree, fresh);
}
