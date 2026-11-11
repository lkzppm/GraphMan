//! Johnson's algorithm and strongly connected components (Part 3, the plus):
//! checked against Floyd-Warshall, Bellman-Ford and `petgraph`.

use graphman::algo::{
    self, Components, FloydError, Reweighted, ScheduleKind, StrongComponents, SweepKind,
};
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

/// Negative arcs, no negative cycle, integer weights.
fn potential_digraph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let h: Vec<Weight> = (0..=n).map(|_| rng.below(20) as Weight).collect();
    let arcs: Vec<_> = (0..m)
        .map(|_| {
            let (u, v) = (rng.below(n) + 1, rng.below(n) + 1);
            (u, v, rng.below(9) as Weight + h[u as usize] - h[v as usize])
        })
        .collect();
    EdgeList::from_weighted_edges_with(n as usize, arcs, DIRECTED).unwrap()
}

#[test]
fn johnson_agrees_with_floyd_warshall_for_every_frontier() {
    for seed in 0..8 {
        let edges = potential_digraph(seed, 60, 240);
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            let floyd =
                dispatch!(&graph, g => algo::floyd_warshall(g, SweepKind::Pruned, UNLIMITED))
                    .unwrap();
            for frontier in FrontierKind::ALL {
                let all = dispatch!(&graph, g => algo::johnson(g, frontier, UNLIMITED)).unwrap();
                for i in 1..=60 {
                    for j in 1..=60 {
                        assert_eq!(all.distance(i, j), floyd.distance(i, j), "{r} {frontier:?}");
                        let Some(path) = all.path(i, j) else { continue };
                        let length: Weight = path
                            .windows(2)
                            .map(|a| graph.weight(a[0], a[1]).unwrap())
                            .sum();
                        assert_eq!(Some(length), all.distance(i, j));
                    }
                }
            }
        }
    }
}

#[test]
fn johnson_agrees_with_petgraph() {
    let edges = potential_digraph(3, 40, 160);
    let mut g = petgraph::Graph::<(), Weight>::new();
    for _ in 0..=40 {
        g.add_node(());
    }
    for e in edges.weighted_edges() {
        g.add_edge(
            NodeIndex::new(e.u as usize),
            NodeIndex::new(e.v as usize),
            e.weight,
        );
    }
    let expected = petgraph::algo::johnson(&g, |e| *e.weight()).unwrap();
    let all = algo::johnson(&Csr::build(&edges).unwrap(), FrontierKind::Heap, UNLIMITED).unwrap();
    for i in 1..=40u32 {
        for j in 1..=40u32 {
            let found = all.distance(i, j);
            let oracle = expected.get(&(NodeIndex::new(i as usize), NodeIndex::new(j as usize)));
            assert_eq!(found, oracle.copied(), "{i} -> {j}");
        }
    }
}

#[test]
fn reweighted_arcs_are_non_negative_and_paths_keep_their_rank() {
    let edges = potential_digraph(5, 50, 200);
    let graph = Csr::build(&edges).unwrap();
    let h = algo::potentials(&graph, ScheduleKind::Queue).unwrap();
    let view = Reweighted::new(&graph, &h);
    assert!(view.negative_edge().is_none() && view.is_weighted());
    assert_eq!(view.edge_count(), graph.edge_count());
    for u in graph.vertices() {
        for ((v, w), (v2, w2)) in graph.weighted_neighbors(u).zip(view.weighted_neighbors(u)) {
            assert_eq!(v, v2);
            assert!(w2 >= 0.0);
            assert_eq!(w2, w + h[u as usize] - h[v as usize]);
        }
    }
    // Dijkstra on the view, corrected, is Bellman-Ford on the graph.
    let tree = algo::dijkstra(&view, 1, FrontierKind::Radix).unwrap();
    let bf = algo::bellman_ford(&graph, 1, ScheduleKind::Queue).unwrap();
    for v in 1..=50 {
        assert_eq!(
            tree.distance(v).map(|d| view.original(1, v, d)),
            bf.distance(v)
        );
    }
}

#[test]
fn johnson_reports_a_negative_cycle_and_respects_the_budget() {
    let edges = EdgeList::parse_with(b"3\n1 2 1\n2 3 -2\n3 1 0\n", DIRECTED).unwrap();
    let graph = Csr::build(&edges).unwrap();
    let error = algo::johnson(&graph, FrontierKind::Heap, UNLIMITED).unwrap_err();
    let FloydError::NegativeCycle(cycle) = error else {
        panic!("{error:?}");
    };
    assert_eq!((cycle.cycle, cycle.weight), (vec![1, 2, 3], -1.0));
    assert!(matches!(
        algo::johnson(&graph, FrontierKind::Heap, MemoryBudget::Bytes(10)),
        Err(FloydError::TooLarge { .. })
    ));
}

/// The components as a sorted list of sorted vertex sets.
fn partition(sets: impl Iterator<Item = Vec<Vertex>>) -> Vec<Vec<Vertex>> {
    let mut sets: Vec<Vec<Vertex>> = sets
        .map(|mut s| {
            s.sort_unstable();
            s
        })
        .collect();
    sets.sort();
    sets
}

#[test]
fn strong_components_match_petgraph_and_come_in_topological_order() {
    for seed in 0..20 {
        let mut rng = Rng(seed);
        let arcs: Vec<_> = (0..120)
            .map(|_| (rng.below(80) + 1, rng.below(80) + 1))
            .collect();
        let edges = EdgeList::from_edges_with(80, arcs.iter().copied(), DIRECTED).unwrap();
        let mut g = petgraph::Graph::<(), ()>::new();
        for _ in 0..80 {
            g.add_node(());
        }
        for &[u, v] in edges.edges() {
            g.add_edge(
                NodeIndex::new(u as usize - 1),
                NodeIndex::new(v as usize - 1),
                (),
            );
        }
        let expected = partition(
            petgraph::algo::tarjan_scc(&g)
                .into_iter()
                .map(|c| c.into_iter().map(|v| v.index() as Vertex + 1).collect()),
        );
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            let scc = dispatch!(&graph, g => StrongComponents::compute(g));
            assert_eq!(
                partition(scc.iter().map(<[Vertex]>::to_vec)),
                expected,
                "{r}"
            );
            // Every arc runs forward between components (or inside one).
            for &[u, v] in edges.edges() {
                assert!(scc.component_of(u) <= scc.component_of(v));
            }
            // The condensation is acyclic.
            let condensation = dispatch!(&graph, g => scc.condensation(g));
            let condensed = StrongComponents::compute(&Csr::build(&condensation).unwrap());
            assert!(condensed.is_acyclic());
            assert_eq!(condensation.vertex_count(), scc.count());
        }
    }
}

#[test]
fn on_an_undirected_graph_strong_components_are_the_components() {
    let mut rng = Rng(9);
    let pairs: Vec<_> = (0..60)
        .map(|_| (rng.below(100) + 1, rng.below(100) + 1))
        .collect();
    let graph = Csr::build(&EdgeList::from_edges(100, pairs).unwrap()).unwrap();
    let scc = StrongComponents::compute(&graph);
    let components = Components::compute(&graph);
    assert_eq!(
        partition(scc.iter().map(<[Vertex]>::to_vec)),
        partition(components.iter().map(<[Vertex]>::to_vec))
    );
}

#[test]
fn shortest_paths_on_a_dag_need_one_pass() {
    for seed in 0..10 {
        let mut rng = Rng(seed);
        // Arcs climb the ids: acyclic, negative weights welcome.
        let arcs: Vec<_> = (0..200)
            .filter_map(|_| {
                let (a, b) = (rng.below(60) + 1, rng.below(60) + 1);
                (a != b).then(|| (a.min(b), a.max(b), rng.below(20) as Weight - 8.0))
            })
            .collect();
        let edges = EdgeList::from_weighted_edges_with(60, arcs, DIRECTED).unwrap();
        let graph = Csr::build(&edges).unwrap();
        let scc = StrongComponents::compute(&graph);
        assert!(scc.is_acyclic());
        let order = scc.topological_order().unwrap();
        let position = |v: Vertex| order.iter().position(|&w| w == v).unwrap();
        for &[u, v] in edges.edges() {
            assert!(position(u) < position(v));
        }
        for root in [1, 20] {
            let dag = algo::dag_shortest_path(&graph, root).unwrap();
            let bf = algo::bellman_ford(&graph, root, ScheduleKind::Queue).unwrap();
            for v in 1..=60 {
                assert_eq!(dag.distance(v), bf.distance(v));
            }
        }
    }
    let cyclic = EdgeList::parse_with(b"3\n1 2 1\n2 3 1\n3 2 1\n", DIRECTED).unwrap();
    let error = algo::dag_shortest_path(&Csr::build(&cyclic).unwrap(), 1).unwrap_err();
    assert_eq!(error.size, 2);
}

#[test]
fn a_long_path_needs_no_deep_stack() {
    // 200,000 vertices in one directed path and back: one component, found
    // without recursion.
    let n = 200_000u32;
    let arcs = (1..n).map(|v| (v, v + 1)).chain([(n, 1)]);
    let graph =
        Csr::build(&EdgeList::from_edges_with(n as usize, arcs, DIRECTED).unwrap()).unwrap();
    let scc = StrongComponents::compute(&graph);
    assert_eq!((scc.count(), scc.largest_size()), (1, n as usize));
    let mut text = Vec::new();
    scc.write_to(&mut text).unwrap();
    assert!(text.starts_with(b"strong_components 1\n"));
}
