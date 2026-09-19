//! The library page's code examples (`web/src/app/library`).
//!
//! Every block between `// wiki:start <id>` and `// wiki:end` is shown on
//! the page exactly as it reads here (`web/scripts/sync-data.mjs` extracts
//! them into `web/src/data/wiki.json`). The blocks read as plain usage, with
//! the results in comments; the assertions after each block check those
//! comments, so the page cannot claim anything the library does not do.
//!
//! The graph is the page's sample: a pentagon 1-2-4-5-3-1 with the chord
//! 2-3, the one the home page draws three ways.

#[test]
fn start() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start start
    use graphman::{AdjacencyList, Build, EdgeList, Graph, algo};

    // The sample graph: five vertices, six edges.
    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n")?;
    let graph = AdjacencyList::build(&edges)?;
    let n = graph.vertex_count(); // 5

    let tree = algo::bfs(&graph, 1);
    let parent = tree.parent(4); // Some(2)
    let level = tree.level(4); // Some(2)

    let diameter = algo::diameter(&graph, algo::DiameterMethod::IFub);
    let value = diameter.value; // 2
    // wiki:end
    assert_eq!(n, 5);
    assert_eq!((parent, level), (Some(2), Some(2)));
    assert_eq!(value, 2);
    Ok(())
}

#[test]
fn format() {
    // wiki:start format
    use graphman::EdgeList;

    // The parser normalises once: self-loops go, every edge is kept once as
    // [min, max], the list is sorted. Every representation is built from this.
    let text = b"5\n2 1\n1 2\n3 3\n1 3\n2 3\n2 4\n3 5\n4 5\n";
    let edges = EdgeList::parse(text).unwrap();
    let kept = edges.edge_count(); // 6
    let first = edges.edges()[0]; // [1, 2]
    let loops = edges.self_loops_dropped(); // 1
    let duplicates = edges.duplicates_dropped(); // 1

    // From a file, or from memory.
    // let edges = EdgeList::from_path("graphs/grafo_1.txt")?;
    let pairs = [(1, 2), (1, 3), (2, 3), (2, 4), (3, 5), (4, 5)];
    let same = EdgeList::from_edges(5, pairs).unwrap(); // == edges
    // wiki:end
    assert_eq!((kept, first, loops, duplicates), (6, [1, 2], 1, 1));
    assert_eq!(edges, same);
}

#[test]
fn representations() {
    // wiki:start representations
    use graphman::{AdjacencyList, AdjacencyMatrix, Build, Csr, EdgeList, Graph, algo};

    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let list = AdjacencyList::build(&edges).unwrap();
    let matrix = AdjacencyMatrix::build(&edges).unwrap();
    let csr = Csr::build(&edges).unwrap();

    // One graph, three layouts in memory, the same answers: neighbours come
    // out ascending from all three, so the search trees are identical.
    let around_2: Vec<_> = list.neighbors(2).collect(); // [1, 3, 4]
    let adjacent = matrix.has_edge(1, 3); // true
    let same_tree = algo::bfs(&list, 1) == algo::bfs(&csr, 1); // true
    // wiki:end
    assert_eq!(around_2, [1, 3, 4]);
    assert_eq!(matrix.neighbors(2).collect::<Vec<_>>(), [1, 3, 4]);
    assert_eq!(csr.neighbors(2).collect::<Vec<_>>(), [1, 3, 4]);
    assert!(adjacent && same_tree);
}

#[test]
fn dispatch() {
    // wiki:start dispatch
    use graphman::{BuildError, EdgeList, MemoryBudget, Representation, algo, dispatch};

    // Chosen at runtime (the CLI's --repr flag): AnyGraph holds any of the
    // three, and dispatch! runs a generic expression on whichever it is.
    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let chosen: Representation = "csr".parse().unwrap();
    let any = chosen.build(&edges).unwrap();
    let depth = dispatch!(&any, g => algo::bfs(g, 1).depth()); // 2

    // What each one costs is known before anything is allocated, and every
    // builder checks it against a MemoryBudget (the machine's memory by
    // default): over it is a typed error, not a process dying in swap.
    let bytes = Representation::Csr.required_bytes(5, 6); // 76
    let matrix = Representation::AdjacencyMatrix.required_bytes(375_000, 0); // 17_580_000_000
    let refused = chosen.build_within(&edges, MemoryBudget::Bytes(64)); // Err(OverBudget { .. })
    // wiki:end
    assert_eq!(depth, 2);
    assert_eq!(bytes, 76);
    assert!(matrix > 17_500_000_000 && matrix < 17_700_000_000);
    assert!(matches!(refused, Err(BuildError::OverBudget { .. })));
}

#[test]
fn traversals() {
    // wiki:start traversals
    use graphman::{Build, Csr, EdgeList, algo};

    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let graph = Csr::build(&edges).unwrap();

    // A search tree: parent and level of every reached vertex, in discovery order.
    let bfs = algo::bfs(&graph, 1);
    let order = bfs.order(); // [1, 2, 3, 4, 5]
    let parent_of_4 = bfs.parent(4); // Some(2)
    let depth = bfs.depth(); // 2

    // DFS takes neighbours in ascending order, iteratively, in O(depth) memory,
    // and produces exactly the tree the recursive version would.
    let dfs = algo::dfs(&graph, 1);
    let dfs_order = dfs.order(); // [1, 2, 3, 5, 4]
    let dfs_parent_of_4 = dfs.parent(4); // Some(5)
    let dfs_depth = dfs.depth(); // 4
    // wiki:end
    assert_eq!(
        (order, parent_of_4, depth),
        (&[1, 2, 3, 4, 5][..], Some(2), 2)
    );
    assert_eq!(
        (dfs_order, dfs_parent_of_4, dfs_depth),
        (&[1, 2, 3, 5, 4][..], Some(5), 4)
    );
}

#[test]
fn visitors() {
    // wiki:start visitors
    use graphman::{Build, Control, Csr, EdgeList, Graph, SearchTree, Vertex, Visitor, algo};

    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let graph = Csr::build(&edges).unwrap();

    // A visitor watches a traversal and may stop it. Distance is just this.
    struct Until(Vertex, Option<u32>);
    impl Visitor for Until {
        fn discover(&mut self, v: Vertex, _parent: Vertex, level: u32) -> Control {
            if v != self.0 {
                return Control::Continue;
            }
            self.1 = Some(level);
            Control::Break
        }
    }
    let mut until = Until(4, None);
    algo::bfs_with(&graph, 1, &mut until);
    let found_at = until.1; // Some(2), after discovering 1, 2, 3 and 4

    // A tree is reusable: each search resets only what the previous one
    // reached, so thousands of them cost no allocation and no O(n) clear.
    let mut tree = SearchTree::new(graph.vertex_count());
    for root in graph.vertices() {
        algo::bfs_into(&graph, root, &mut tree, &mut ());
    }
    // wiki:end
    assert_eq!(found_at, Some(2));
    assert_eq!(tree.reached_count(), 5);
    let bfs = algo::bfs(&graph, 1);
    assert_eq!(&bfs.order()[..4], [1, 2, 3, 4]);
}

#[test]
fn distance_and_components() {
    // wiki:start distance
    use graphman::{Build, Components, Csr, EdgeList, algo};

    // The sample plus a second component, {6, 7}.
    let edges = EdgeList::parse(b"7\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n6 7\n").unwrap();
    let graph = Csr::build(&edges).unwrap();

    // A BFS that stops at the target; None across components.
    let near = algo::distance(&graph, 4, 3); // Some(2)
    let apart = algo::distance(&graph, 1, 7); // None
    // The farthest vertex from 1, and how far.
    let farthest = algo::eccentricity(&graph, 1); // (2, 5)

    // Components, numbered from the largest, each listed ascending.
    let components = Components::compute(&graph);
    let count = components.count(); // 2
    let largest = components.members(1); // [1, 2, 3, 4, 5]
    let of_7 = components.component_of(7); // 2
    // wiki:end
    assert_eq!((near, apart, farthest), (Some(2), None, (2, 5)));
    assert_eq!((count, largest, of_7), (2, &[1, 2, 3, 4, 5][..], 2));
}

#[test]
fn diameter() {
    // wiki:start diameter
    use graphman::{Build, Control, Csr, DiameterMethod, EdgeList, algo};

    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let graph = Csr::build(&edges).unwrap();

    // Four methods, one driver: brute force, iFUB, Takes-Kosters bounds and
    // the 4-sweep lower bound. All but the sweep certify their answer.
    let exact = algo::diameter(&graph, DiameterMethod::IFub);
    let (value, certified) = (exact.value, exact.is_exact); // (2, true)
    let endpoints = exact.endpoints; // (1, 5): a longest shortest path, 1-3-5
    let sweep = algo::diameter(&graph, DiameterMethod::Sweep);
    let lower_bound = (sweep.value, sweep.is_exact); // (2, false)

    // Every method takes a budget: the callback sees the BFS count after each
    // search and may stop the run, which then reports its best lower bound.
    let stop_after_two = |bfs_count: usize| match bfs_count < 2 {
        true => Control::Continue,
        false => Control::Break,
    };
    let bounded = algo::diameter_with_progress(&graph, DiameterMethod::Exact, &stop_after_two);
    let gave_up = bounded.cancelled; // true
    // wiki:end
    assert_eq!((value, certified, endpoints), (2, true, (1, 5)));
    assert_eq!(algo::distance(&graph, 1, 5), Some(2));
    assert_eq!(lower_bound, (2, false));
    assert!(gave_up && !bounded.is_exact);
    for method in DiameterMethod::ALL {
        let d = algo::diameter(&graph, method);
        assert_eq!((d.value, d.is_exact), (2, method.is_exact()));
    }
}
