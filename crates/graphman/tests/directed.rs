//! Directed graphs (Part 3): parsing arcs, building the three
//! representations from them and transposing them. Every representation
//! must agree with the edge list and with each other.

use graphman::{
    AdjacencyList, AdjacencyMatrix, AnyGraph, Build, BuildError, Csr, EdgeList, Graph,
    MemoryBudget, Orientation, Representation, Vertex, Weight, Weighted, WeightedEdge, dispatch,
};

const DIRECTED: Orientation = Orientation::Directed;

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

/// A random weighted digraph with some negative arcs (and loops, and
/// repeated arcs, which normalisation must handle).
fn random_digraph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let arcs: Vec<(Vertex, Vertex, Weight)> = (0..m)
        .map(|_| {
            let (u, v) = (rng.below(n) + 1, rng.below(n) + 1);
            (u, v, rng.below(20) as Weight - 3.0)
        })
        .collect();
    EdgeList::from_weighted_edges_with(n as usize, arcs, DIRECTED).unwrap()
}

/// Every row of a graph with its weights.
fn rows<G: Weighted>(graph: &G) -> Vec<Vec<(Vertex, Weight)>> {
    graph
        .vertices()
        .map(|v| graph.weighted_neighbors(v).collect())
        .collect()
}

/// The out-rows an edge list describes, read straight off its arcs.
fn expected_rows(edges: &EdgeList) -> Vec<Vec<(Vertex, Weight)>> {
    let mut rows = vec![Vec::new(); edges.vertex_count()];
    for WeightedEdge { u, v, weight } in edges.weighted_edges() {
        rows[u as usize - 1].push((v, weight));
        if !edges.is_directed() {
            rows[v as usize - 1].push((u, weight));
        }
    }
    for row in &mut rows {
        row.sort_by_key(|&(v, _)| v);
    }
    rows
}

#[test]
fn a_line_is_an_arc_from_its_first_vertex_to_its_second() {
    let text = b"4\n2 1\n1 2\n3 1\n1 2\n4 4\n";
    let arcs = EdgeList::parse_with(text, DIRECTED).unwrap();
    assert!(arcs.is_directed());
    assert_eq!(arcs.edges(), &[[1, 2], [2, 1], [3, 1]]);
    assert_eq!(arcs.duplicates_dropped(), 1);
    assert_eq!(arcs.self_loops_dropped(), 1);
    assert_eq!(arcs.degrees(), vec![0, 1, 1, 1, 0]);
    assert_eq!(arcs.in_degrees(), vec![0, 2, 1, 0, 0]);

    // The same lines as edges: Parts 1 and 2, unchanged.
    let edges = EdgeList::parse(text).unwrap();
    assert_eq!(
        edges,
        EdgeList::parse_with(text, Orientation::Undirected).unwrap()
    );
    assert!(!edges.is_directed());
    assert_eq!(edges.edges(), &[[1, 2], [1, 3]]);
    assert_eq!(edges.duplicates_dropped(), 2);
    assert_eq!(edges.in_degrees(), edges.degrees());
    assert_ne!(arcs, edges);
}

#[test]
fn a_repeated_arc_keeps_its_smallest_weight_each_way() {
    let arcs =
        EdgeList::parse_with(b"3\n1 2 4\n2 1 7\n1 2 0.5\n2 1 9\n2 3 -1\n", DIRECTED).unwrap();
    assert_eq!(arcs.edges(), &[[1, 2], [2, 1], [2, 3]]);
    assert_eq!(arcs.weights().unwrap(), &[0.5, 7.0, -1.0]);
    assert_eq!(
        arcs.negative_edge(),
        Some(WeightedEdge {
            u: 2,
            v: 3,
            weight: -1.0
        })
    );
    // Written back and read again with the same orientation, it is the same list.
    let mut text = Vec::new();
    arcs.write_to(&mut text).unwrap();
    assert_eq!(EdgeList::parse_with(&text, DIRECTED).unwrap(), arcs);
}

#[test]
fn negative_loops_are_kept_one_per_vertex() {
    let text = b"3\n1 1 -2\n1 2 1\n3 3 -1\n1 1 -5\n2 2 3\n";
    for orientation in [Orientation::Undirected, DIRECTED] {
        let edges = EdgeList::parse_with(text, orientation).unwrap();
        assert_eq!(edges.edges(), &[[1, 2]], "{orientation}");
        assert_eq!(edges.self_loops_dropped(), 4);
        // A loop is not an edge of the graph, so it is not its negative edge.
        assert_eq!(edges.negative_edge(), None);
        let loops = [
            WeightedEdge {
                u: 1,
                v: 1,
                weight: -5.0,
            },
            WeightedEdge {
                u: 3,
                v: 3,
                weight: -1.0,
            },
        ];
        assert_eq!(edges.negative_loops(), &loops);
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            assert_eq!(graph.negative_loops(), &loops, "{r}");
            assert_eq!(
                dispatch!(&graph, g => g.neighbors(1).collect::<Vec<_>>()),
                [2]
            );
        }
    }
    // Unweighted files have no negative loops.
    assert!(
        EdgeList::parse(b"2\n1 1\n")
            .unwrap()
            .negative_loops()
            .is_empty()
    );
}

#[test]
fn every_representation_stores_the_arcs_once() {
    for seed in 0..10 {
        let edges = random_digraph(seed, 40, 160);
        let expected = expected_rows(&edges);
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            assert!(graph.is_directed(), "{r}");
            assert_eq!(graph.orientation(), DIRECTED);
            assert_eq!(graph.edge_count(), edges.edge_count(), "{r}");
            assert_eq!(graph.negative_edge(), edges.negative_edge(), "{r}");
            dispatch!(&graph, g => {
                assert_eq!(rows(g), expected, "{r}");
                for (index, row) in expected.iter().enumerate() {
                    let u = index as Vertex + 1;
                    assert_eq!(g.degree(u), row.len(), "{r}");
                    for &(v, weight) in row {
                        assert!(g.has_edge(u, v));
                        assert_eq!(g.weight(u, v), Some(weight));
                        // The reverse arc exists only when the file has it.
                        let back = expected[v as usize - 1].iter().any(|&(w, _)| w == u);
                        assert_eq!(g.has_edge(v, u), back, "{r} {v}->{u}");
                    }
                }
            });
            assert_eq!(
                graph.heap_bytes(),
                r.required_bytes_oriented(40, edges.edge_count(), true, DIRECTED),
                "{r}"
            );
        }
    }
}

#[test]
fn a_directed_graph_costs_half_the_rows_of_an_undirected_one() {
    let (n, m) = (10_000, 100_000);
    for weighted in [false, true] {
        let size = |r: Representation, o| r.required_bytes_oriented(n, m, weighted, o);
        for r in [Representation::Csr, Representation::AdjacencyList] {
            let entry = 4 + if weighted { 8 } else { 0 };
            assert_eq!(
                size(r, Orientation::Undirected) - size(r, DIRECTED),
                m * entry,
                "{r}"
            );
        }
        // The matrix is n × n either way.
        let matrix = Representation::AdjacencyMatrix;
        assert_eq!(
            size(matrix, Orientation::Undirected),
            size(matrix, DIRECTED)
        );
        assert_eq!(
            matrix.required_bytes(n, m, weighted),
            size(matrix, Orientation::Undirected)
        );
    }
}

/// Transposes `graph` and checks it against the build of the transposed list.
fn check_transpose<G: Build>(graph: &G, edges: &EdgeList) {
    let transpose = graph.transpose().unwrap();
    let reversed = edges.transpose();
    let expected = G::build(&reversed).unwrap();
    assert_eq!(rows(&transpose), rows(&expected));
    assert_eq!(rows(&transpose), expected_rows(&reversed));
    assert_eq!(transpose.edge_count(), graph.edge_count());
    assert_eq!(transpose.is_directed(), graph.is_directed());
    assert_eq!(transpose.negative_edge(), reversed.negative_edge());
    assert_eq!(transpose.negative_loops(), graph.negative_loops());
    for v in graph.vertices() {
        assert_eq!(transpose.degree(v), expected.degree(v));
    }
    assert_eq!(transpose.heap_bytes(), expected.heap_bytes());
    // Twice is the identity.
    assert_eq!(rows(&transpose.transpose().unwrap()), rows(graph));
}

#[test]
fn the_transpose_reverses_every_arc() {
    for seed in 0..10 {
        let edges = random_digraph(seed, 30, 120);
        check_transpose(&Csr::build(&edges).unwrap(), &edges);
        check_transpose(&AdjacencyList::build(&edges).unwrap(), &edges);
        check_transpose(&AdjacencyMatrix::build(&edges).unwrap(), &edges);
        // The edge list's own transpose, twice, is the list.
        assert_eq!(edges.transpose().transpose(), edges);
        assert_eq!(edges.transpose().in_degrees(), edges.degrees());
    }
}

#[test]
fn the_transpose_of_a_small_digraph() {
    // 1 → 2 (-1), 1 → 3 (2), 3 → 2 (4): into 2 come 1 and 3.
    let edges = EdgeList::parse_with(b"3\n1 2 -1\n1 3 2\n3 2 4\n", DIRECTED).unwrap();
    let graph = Csr::build(&edges).unwrap();
    let transpose = graph.transpose().unwrap();
    assert_eq!(transpose.row(2), &[1, 3]);
    assert_eq!(transpose.row_weights(2), &[-1.0, 4.0]);
    assert_eq!(transpose.row(3), &[1]);
    assert!(transpose.row(1).is_empty());
    assert_eq!(
        transpose.negative_edge(),
        Some(WeightedEdge {
            u: 2,
            v: 1,
            weight: -1.0
        })
    );
}

#[test]
fn an_undirected_graph_is_its_own_transpose() {
    let edges = EdgeList::parse(b"5\n1 2 0.1\n2 5 0.2\n5 3 5\n3 4 -9.5\n4 5 2.3\n1 5 1\n").unwrap();
    assert_eq!(edges.transpose(), edges);
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        assert!(!graph.is_directed());
        let transpose = graph.transpose_within(MemoryBudget::Unlimited).unwrap();
        let (a, b) = match (&graph, &transpose) {
            (AnyGraph::List(a), AnyGraph::List(b)) => (rows(a), rows(b)),
            (AnyGraph::Matrix(a), AnyGraph::Matrix(b)) => (rows(a), rows(b)),
            (AnyGraph::Csr(a), AnyGraph::Csr(b)) => (rows(a), rows(b)),
            _ => panic!("the transpose changed the representation"),
        };
        assert_eq!(a, b, "{r}");
    }
}

#[test]
fn the_transpose_is_refused_past_the_budget() {
    let edges = random_digraph(1, 30, 120);
    let graph = Csr::build(&edges).unwrap();
    // Both copies are held at once: the graph alone fits, the pair does not.
    let budget = MemoryBudget::Bytes(graph.heap_bytes() + 8);
    assert!(matches!(
        graph.transpose_within(budget),
        Err(BuildError::OverBudget { .. })
    ));
    assert!(
        graph
            .transpose_within(MemoryBudget::Bytes(3 * graph.heap_bytes()))
            .is_ok()
    );
}

#[test]
fn unweighted_arcs_weigh_one() {
    let edges = EdgeList::from_edges_with(3, [(1, 2), (2, 3), (3, 1), (1, 2)], DIRECTED).unwrap();
    assert_eq!(edges.edge_count(), 3);
    for r in Representation::ALL {
        let graph = r.build(&edges).unwrap();
        assert!(!graph.is_weighted());
        assert_eq!(graph.weight(1, 2), Some(1.0));
        assert_eq!(graph.weight(2, 1), None);
        let transpose = graph.transpose_within(MemoryBudget::Unlimited).unwrap();
        assert_eq!(transpose.weight(2, 1), Some(1.0));
        assert_eq!(transpose.weight(1, 2), None);
    }
}

// Part 3, item 2: the searches already written run on directed graphs.

/// Distances by hops along the arcs, from `root`: a textbook BFS on the rows.
fn oracle_bfs(rows: &[Vec<(Vertex, Weight)>], root: Vertex) -> Vec<Option<(Vertex, u32)>> {
    let mut seen = vec![None; rows.len() + 1];
    seen[root as usize] = Some((0, 0));
    let mut queue = std::collections::VecDeque::from([root]);
    while let Some(v) = queue.pop_front() {
        let level = seen[v as usize].unwrap().1;
        for &(w, _) in &rows[v as usize - 1] {
            if seen[w as usize].is_none() {
                seen[w as usize] = Some((v, level + 1));
                queue.push_back(w);
            }
        }
    }
    seen
}

/// The textbook recursive DFS on the rows: `(parent, level)` per vertex.
fn oracle_dfs(rows: &[Vec<(Vertex, Weight)>], root: Vertex) -> Vec<Option<(Vertex, u32)>> {
    fn visit(rows: &[Vec<(Vertex, Weight)>], v: Vertex, seen: &mut [Option<(Vertex, u32)>]) {
        let level = seen[v as usize].unwrap().1;
        for &(w, _) in &rows[v as usize - 1] {
            if seen[w as usize].is_none() {
                seen[w as usize] = Some((v, level + 1));
                visit(rows, w, seen);
            }
        }
    }
    let mut seen = vec![None; rows.len() + 1];
    seen[root as usize] = Some((0, 0));
    visit(rows, root, &mut seen);
    seen
}

/// `(parent, level)` per vertex of a search tree, `0` as the root's parent.
fn tree_of(tree: &graphman::SearchTree) -> Vec<Option<(Vertex, u32)>> {
    (0..=tree.vertex_count() as Vertex)
        .map(|v| match v {
            0 => None,
            v => tree
                .level(v)
                .map(|level| (tree.parent(v).unwrap_or(0), level)),
        })
        .collect()
}

/// Bellman-Ford over the arcs: the slow, obviously right oracle.
fn oracle_distances(edges: &EdgeList, root: Vertex) -> Vec<Weight> {
    let mut distance = vec![Weight::INFINITY; edges.vertex_count() + 1];
    distance[root as usize] = 0.0;
    for _ in 1..edges.vertex_count() {
        for WeightedEdge { u, v, weight } in edges.weighted_edges() {
            if distance[u as usize] + weight < distance[v as usize] {
                distance[v as usize] = distance[u as usize] + weight;
            }
        }
    }
    distance
}

/// A random digraph with non-negative weights, for Dijkstra.
fn random_positive_digraph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let arcs: Vec<(Vertex, Vertex, Weight)> = (0..m)
        .map(|_| (rng.below(n) + 1, rng.below(n) + 1, rng.below(9) as Weight))
        .collect();
    EdgeList::from_weighted_edges_with(n as usize, arcs, DIRECTED).unwrap()
}

#[test]
fn bfs_and_dfs_follow_the_arcs() {
    use graphman::algo;
    for seed in 0..10 {
        let edges = random_digraph(seed, 40, 90);
        let rows = expected_rows(&edges);
        for r in Representation::ALL {
            let graph = r.build(&edges).unwrap();
            for root in [1, 7, 23] {
                let (bfs, dfs, recursive) = dispatch!(&graph, g => (
                    algo::bfs(g, root),
                    algo::dfs(g, root),
                    algo::dfs_recursive(g, root, 100).unwrap(),
                ));
                assert_eq!(tree_of(&bfs), oracle_bfs(&rows, root), "{r} bfs {root}");
                assert_eq!(tree_of(&dfs), oracle_dfs(&rows, root), "{r} dfs {root}");
                assert_eq!(dfs, recursive, "{r} {root}");
            }
        }
    }
}

#[test]
fn reachability_is_one_way() {
    use graphman::algo;
    // 1 → 2 → 3, and 4 → 1.
    let edges = EdgeList::parse_with(b"4\n1 2\n2 3\n4 1\n", DIRECTED).unwrap();
    let graph = Csr::build(&edges).unwrap();
    assert_eq!(algo::bfs(&graph, 1).reached_count(), 3);
    assert_eq!(algo::bfs(&graph, 3).reached_count(), 1);
    assert_eq!(algo::bfs(&graph, 4).level(3), Some(3));
    assert_eq!(algo::distance(&graph, 1, 3), Some(2));
    assert_eq!(algo::distance(&graph, 3, 1), None);
    assert!(!algo::dfs(&graph, 2).is_reached(1));
    // On the transpose the arcs point back.
    let back = graph.transpose().unwrap();
    assert_eq!(algo::distance(&back, 3, 1), Some(2));
    assert_eq!(algo::bfs(&back, 1).order(), &[1, 4]);
}

#[test]
fn dijkstra_follows_the_arcs_with_every_frontier() {
    use graphman::algo::{self, FrontierKind};
    for seed in 0..10 {
        let edges = random_positive_digraph(seed, 40, 160);
        for root in [1, 13, 40] {
            let oracle = oracle_distances(&edges, root);
            let mut trees = Vec::new();
            for r in Representation::ALL {
                let graph = r.build(&edges).unwrap();
                for frontier in FrontierKind::ALL {
                    let tree = dispatch!(&graph, g => algo::dijkstra(g, root, frontier)).unwrap();
                    for v in 1..=40 {
                        let expected = oracle[v as usize];
                        let found = tree.distance(v).unwrap_or(Weight::INFINITY);
                        assert_eq!(found, expected, "{r} {frontier:?} {root}->{v}");
                        // The parent of v is a tail of an arc into v.
                        if let Some(p) = tree.parent(v) {
                            let weight = graph.weight(p, v).expect("an arc p -> v");
                            assert_eq!(tree.distance(p).unwrap() + weight, expected);
                        }
                    }
                    trees.push(tree);
                }
            }
            // Every representation and frontier builds the same tree.
            assert!(trees.windows(2).all(|pair| pair[0] == pair[1]));
        }
    }
}

#[test]
fn components_of_a_digraph_are_weakly_connected() {
    use graphman::algo::Components;
    for seed in 0..10 {
        let arcs = random_digraph(seed, 60, 45);
        // The same lines read as edges: the components of the underlying graph.
        let mut text = Vec::new();
        arcs.write_to(&mut text).unwrap();
        let undirected = EdgeList::parse(&text).unwrap();
        for r in Representation::ALL {
            let a = dispatch!(&r.build(&arcs).unwrap(), g => Components::compute(g));
            let b = dispatch!(&r.build(&undirected).unwrap(), g => Components::compute(g));
            assert_eq!(a, b, "{r} seed {seed}");
        }
    }
    // 1 → 2 ← 3: one weak component, although no vertex reaches all three.
    let edges = EdgeList::parse_with(b"4\n1 2\n3 2\n", DIRECTED).unwrap();
    let components = Components::compute(&Csr::build(&edges).unwrap());
    assert_eq!(components.count(), 2);
    assert_eq!(components.members(1), &[1, 2, 3]);
    assert_eq!(components.members(2), &[4]);
}

#[test]
fn the_diameter_of_a_digraph_is_its_longest_finite_distance() {
    use graphman::algo::{self, DiameterError, DiameterMethod};
    for seed in 0..10 {
        let edges = random_digraph(seed, 50, 120);
        let graph = Csr::build(&edges).unwrap();
        let rows = expected_rows(&edges);
        let oracle = (1..=50)
            .flat_map(|root| oracle_bfs(&rows, root))
            .filter_map(|seen| seen.map(|(_, level)| level))
            .max()
            .unwrap();
        let exact = algo::diameter(&graph, DiameterMethod::Exact).unwrap();
        assert_eq!(exact.value, oracle, "seed {seed}");
        let (from, to) = exact.endpoints;
        assert_eq!(algo::distance(&graph, from, to), Some(oracle));
        let sweep = algo::diameter(&graph, DiameterMethod::Sweep).unwrap();
        assert!(sweep.value <= oracle);
        // iFUB and the bounds need d(u, v) = d(v, u): refused, not wrong.
        for method in [DiameterMethod::IFub, DiameterMethod::Bounds] {
            assert_eq!(
                algo::diameter(&graph, method),
                Err(DiameterError::Directed { method })
            );
            assert!(!method.supports(DIRECTED));
            assert!(method.supports(Orientation::Undirected));
        }
    }
}

#[test]
fn degree_statistics_count_each_arc_once() {
    use graphman::algo::{degree_stats, in_degree_stats, weight_stats};
    // Out-degrees 3, 1, 0, 0; in-degrees 0, 1, 2, 1.
    let edges = EdgeList::parse_with(b"4\n1 2 1\n1 3 -2\n1 4 3\n2 3 4\n", DIRECTED).unwrap();
    let graph = AdjacencyList::build(&edges).unwrap();
    let out = degree_stats(&graph);
    assert_eq!((out.min, out.max, out.mean, out.median), (0, 3, 1.0, 0.5));
    let inn = in_degree_stats(&graph);
    assert_eq!((inn.min, inn.max, inn.mean, inn.median), (0, 2, 1.0, 1.0));
    let weights = weight_stats(&graph).unwrap();
    assert_eq!((weights.min, weights.max, weights.negative), (-2.0, 4.0, 1));
    assert_eq!(weights.mean, 1.5);

    let mut summary = Vec::new();
    let components = graphman::Components::compute(&graph);
    graphman::io::write_summary(&mut summary, &graph, &out, &components).unwrap();
    let summary = String::from_utf8(summary).unwrap();
    assert!(summary.starts_with("directed\nvertices 4\narcs 4\nout_degree_min 0\n"));
    assert!(summary.contains("\nin_degree_max 2\n"));
    assert!(summary.contains("\nweak_components 1\n"));
}
