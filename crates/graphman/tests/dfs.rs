//! DFS written both ways: the iterative and the recursive DFS must build the
//! same tree and report the same events on every representation, and the
//! recursive one must refuse, not overflow, past its depth.

use graphman::algo::{self, Control, RecursionLimit, SearchTree, Visitor};
use graphman::{
    AnyGraph, Build, Csr, EdgeList, Graph, MemoryBudget, Representation, Vertex, dispatch,
};

/// A tiny deterministic PRNG (SplitMix64) so tests never need a dependency.
struct Rng(u64);
impl Rng {
    fn below(&mut self, n: u32) -> u32 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) % n as u64) as u32
    }
}

fn random_graph(seed: u64, n: u32, m: usize) -> EdgeList {
    let mut rng = Rng(seed);
    let edges: Vec<(Vertex, Vertex)> = (0..m)
        .map(|_| (rng.below(n) + 1, rng.below(n) + 1))
        .collect();
    EdgeList::from_edges(n as usize, edges).unwrap()
}

/// A path `1 - 2 - ... - n`: the deepest DFS tree a graph can have.
fn path(n: u32) -> Csr {
    let edges = EdgeList::from_edges(n as usize, (1..n).map(|v| (v, v + 1))).unwrap();
    Csr::build(&edges).unwrap()
}

fn all_representations(edges: &EdgeList) -> Vec<AnyGraph> {
    Representation::ALL
        .into_iter()
        .map(|r| r.build_within(edges, MemoryBudget::Unlimited).unwrap())
        .collect()
}

/// Records every event, so two searches can be compared step by step.
#[derive(Default, PartialEq, Debug)]
struct Events(Vec<(char, Vertex, Vertex, u32)>);

impl Visitor for Events {
    fn discover(&mut self, v: Vertex, parent: Vertex, level: u32) -> Control {
        self.0.push(('d', v, parent, level));
        Control::Continue
    }
    fn finish(&mut self, v: Vertex) {
        self.0.push(('f', v, 0, 0));
    }
}

#[test]
fn both_ways_build_the_same_tree_and_events_everywhere() {
    for seed in 0..12 {
        let edges = random_graph(seed, 60, 90 + seed as usize * 10);
        for graph in all_representations(&edges) {
            for root in [1, 7, 30, 60] {
                let (iterative, recursive) = dispatch!(&graph, g => {
                    let mut a = Events::default();
                    let mut b = Events::default();
                    let ta = algo::dfs_with(g, root, &mut a);
                    let tb = algo::dfs_recursive_with(g, root, u32::MAX, &mut b).unwrap();
                    ((ta, a), (tb, b))
                });
                assert_eq!(iterative.0, recursive.0, "seed {seed} root {root}");
                assert_eq!(iterative.1, recursive.1, "seed {seed} root {root}");
            }
        }
    }
}

#[test]
fn the_depth_limit_is_exact_and_refusing_leaves_an_empty_tree() {
    let graph = path(50);
    // The tree is 49 levels deep: a limit of 49 is enough, 48 is not.
    let tree = algo::dfs_recursive(&graph, 1, 49).unwrap();
    assert_eq!(tree.depth(), 49);
    assert_eq!(tree, algo::dfs(&graph, 1));
    let mut reused = SearchTree::new(graph.vertex_count());
    assert_eq!(
        algo::dfs_recursive_into(&graph, 1, &mut reused, &mut (), 48),
        Err(RecursionLimit { max_depth: 48 })
    );
    assert_eq!(reused.reached_count(), 0);
    assert!(!reused.is_reached(49));
    // The refused tree is clean: the next search into it is a normal one.
    algo::dfs_recursive_into(&graph, 25, &mut reused, &mut (), 49).unwrap();
    assert_eq!(reused, algo::dfs(&graph, 25));
}

#[test]
fn a_visitor_stops_both_ways_at_the_same_vertex() {
    struct StopAt(Vertex);
    impl Visitor for StopAt {
        fn discover(&mut self, v: Vertex, _: Vertex, _: u32) -> Control {
            if v == self.0 {
                Control::Break
            } else {
                Control::Continue
            }
        }
    }
    let graph = Csr::build(&random_graph(3, 80, 160)).unwrap();
    let a = algo::dfs_with(&graph, 1, &mut StopAt(40));
    let b = algo::dfs_recursive_with(&graph, 1, u32::MAX, &mut StopAt(40)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn the_kinds_parse_and_print() {
    use graphman::DfsKind;
    for kind in DfsKind::ALL {
        assert_eq!(kind.label().parse::<DfsKind>(), Ok(kind));
    }
    assert!("sideways".parse::<DfsKind>().is_err());
}
