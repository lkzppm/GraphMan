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
