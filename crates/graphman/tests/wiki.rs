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

    let diameter = algo::diameter(&graph, algo::DiameterMethod::IFub)?;
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
    let bytes = Representation::Csr.required_bytes(5, 6, false); // 76
    let matrix = Representation::AdjacencyMatrix.required_bytes(375_000, 0, false); // 17_580_000_000
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
fn diameter() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start diameter
    use graphman::{Build, Control, Csr, DiameterMethod, EdgeList, algo};

    let edges = EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n").unwrap();
    let graph = Csr::build(&edges).unwrap();

    // Four methods, one driver: brute force, iFUB, Takes-Kosters bounds and
    // the 4-sweep lower bound. All but the sweep certify their answer.
    let exact = algo::diameter(&graph, DiameterMethod::IFub)?;
    let (value, certified) = (exact.value, exact.is_exact); // (2, true)
    let endpoints = exact.endpoints; // (1, 5): a longest shortest path, 1-3-5
    let sweep = algo::diameter(&graph, DiameterMethod::Sweep)?;
    let lower_bound = (sweep.value, sweep.is_exact); // (2, false)

    // Every method takes a budget: the callback sees the BFS count after each
    // search and may stop the run, which then reports its best lower bound.
    let stop_after_two = |bfs_count: usize| match bfs_count < 2 {
        true => Control::Continue,
        false => Control::Break,
    };
    let bounded = algo::diameter_with_progress(&graph, DiameterMethod::Exact, &stop_after_two)?;
    let gave_up = bounded.cancelled; // true
    // wiki:end
    assert_eq!((value, certified, endpoints), (2, true, (1, 5)));
    assert_eq!(algo::distance(&graph, 1, 5), Some(2));
    assert_eq!(lower_bound, (2, false));
    assert!(gave_up && !bounded.is_exact);
    for method in DiameterMethod::ALL {
        let d = algo::diameter(&graph, method)?;
        assert_eq!((d.value, d.is_exact), (2, method.is_exact()));
    }
    Ok(())
}

#[test]
fn weights() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start weights
    use graphman::{Build, Csr, EdgeList, Weighted};

    // A third column makes a weighted graph: the sample, each edge weighed.
    let text = b"5\n1 2 0.5\n1 3 2\n2 3 1\n2 4 2.5\n3 5 1\n4 5 0.75\n";
    let edges = EdgeList::parse(text)?;
    let graph = Csr::build(&edges)?;
    let weighted = graph.is_weighted(); // true
    let around_2: Vec<_> = graph.weighted_neighbors(2).collect(); // [(1, 0.5), (3, 1.0), (4, 2.5)]
    let w = graph.weight(4, 5); // Some(0.75)

    // The weights are a column beside the adjacency: BFS never reads it, and
    // a graph without one weighs 1 per edge, so hops are the unit-weight case.
    let plain = Csr::build(&EdgeList::parse(b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n")?)?;
    let unit = plain.weight(4, 5); // Some(1.0)

    // A repeated edge keeps its smallest weight, the only one a path would use.
    let repeated = EdgeList::parse(b"2\n1 2 4\n2 1 0.5\n")?;
    let kept = repeated.weights(); // Some([0.5])
    // wiki:end
    assert!(weighted);
    assert_eq!(around_2, [(1, 0.5), (3, 1.0), (4, 2.5)]);
    assert_eq!((w, unit), (Some(0.75), Some(1.0)));
    assert_eq!(kept, Some(&[0.5][..]));
    Ok(())
}

#[test]
fn dijkstra() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start dijkstra
    use graphman::{Build, Csr, EdgeList, FrontierKind, algo};

    let text = b"5\n1 2 0.5\n1 3 2\n2 3 1\n2 4 2.5\n3 5 1\n4 5 0.75\n";
    let graph = Csr::build(&EdgeList::parse(text)?)?;

    // One Dijkstra; the frontier (how estimates are kept) is the strategy.
    let tree = algo::dijkstra(&graph, 1, FrontierKind::Heap)?;
    let to_5 = tree.distance(5); // Some(2.5)
    let path = tree.path_to(5); // Some([1, 2, 3, 5]): three edges, lighter than 1-3-5
    let order = tree.order(); // [1, 2, 3, 5, 4], by distance

    // The vector scan (O(n²)) and the heap (O((n + m) log n)) agree exactly:
    // ties go to the smaller vertex in both, so even the tree is the same.
    let vector = algo::dijkstra(&graph, 1, FrontierKind::Vector)?;
    let same = vector == tree; // true

    // One pair: the run stops as soon as the target is settled.
    let between = algo::shortest_path(&graph, 1, 4)?.unwrap();
    let answer = (between.distance, between.hops()); // (3.0, 2)
    let via = between.vertices; // [1, 2, 4]

    // A negative weight is refused, not answered wrongly.
    let negative = Csr::build(&EdgeList::parse(b"3\n1 2 1\n2 3 -1\n")?)?;
    let refused = algo::dijkstra(&negative, 1, FrontierKind::Heap); // Err(NegativeWeight { .. })
    // wiki:end
    assert_eq!((to_5, path), (Some(2.5), Some(vec![1, 2, 3, 5])));
    assert_eq!(order, [1, 2, 3, 5, 4]);
    assert!(same);
    assert_eq!(answer, (3.0, 2));
    assert_eq!(via, [1, 2, 4]);
    let refused = refused.unwrap_err();
    assert_eq!(
        (refused.edge.u, refused.edge.v, refused.edge.weight),
        (2, 3, -1.0)
    );
    assert_eq!(algo::bfs(&graph, 1).path_to(5), Some(vec![1, 3, 5]));
    Ok(())
}

#[test]
fn frontiers() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start frontiers
    use graphman::algo::{self, Frontier, HeapFrontier, ShortestPathTree};
    use graphman::{Build, Csr, EdgeList, Graph};

    let text = b"5\n1 2 0.5\n1 3 2\n2 3 1\n2 4 2.5\n3 5 1\n4 5 0.75\n";
    let graph = Csr::build(&EdgeList::parse(text)?)?;

    // k sources (the case study): one frontier and one tree for every run,
    // each run resetting only what the previous one touched.
    let mut frontier = HeapFrontier::default();
    let mut tree = ShortestPathTree::new(graph.vertex_count());
    let mut farthest = Vec::new();
    for root in graph.vertices() {
        algo::dijkstra_into(&graph, root, &mut frontier, &mut tree, &mut ())?;
        farthest.push(tree.last_settled()); // (vertex, distance) farthest from root
    }
    let kind = frontier.kind(); // FrontierKind::Heap
    // wiki:end
    assert_eq!(farthest[0], (4, 3.0));
    assert_eq!(kind, graphman::FrontierKind::Heap);
    Ok(())
}

#[test]
fn names() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start names
    use graphman::VertexNames;

    // Names live beside the graph, in their own file (`index,name` per line).
    let names =
        VertexNames::parse("1,Edsger W. Dijkstra\n2,Alan M. Turing\n3,Éva Tardos\n".as_bytes())?;
    let dijkstra = names.vertex("Edsger W. Dijkstra"); // Some(1), exact spelling
    let third = names.name(3); // Some("Éva Tardos")
    let near_miss = names.search("eva tardos", 5); // [3]: ignoring case and accents
    // let names = VertexNames::from_path("graphs/rede_colaboracao_vertices.txt")?;
    // wiki:end
    assert_eq!((dijkstra, third), (Some(1), Some("Éva Tardos")));
    assert_eq!(near_miss, vec![3]);
    // The library page shows these answers beside the block.
    assert_eq!(names.vertex("Eva Tardos"), None);
    Ok(())
}

#[test]
fn subgraphs() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start subgraphs
    use graphman::algo::{self, SubgraphRule};
    use graphman::{Build, Csr, EdgeList};

    let text = b"5\n1 2\n1 3\n2 3\n2 4\n3 5\n4 5\n";
    let graph = Csr::build(&EdgeList::parse(text)?)?;

    // By size: a BFS from 1 stopped at two vertices. 3 is left out, though
    // it is as close to 1 as 2 is.
    let kept = algo::select(&graph, SubgraphRule::Ball, 1, 2); // [1, 2]
    let cut = algo::induce(&graph, kept);
    let inside = cut.edge_count(); // 1

    // By radius: everything at most k = 1 edge from 1, weights ignored, and
    // every edge among them, collected during the BFS itself.
    let ego = algo::egonet(&graph, 1, 1);
    let around = ego.kept(); // [1, 2, 3]
    let among = ego.edges(); // [(1, 2, 1.0), (1, 3, 1.0), (2, 3, 1.0)]: 2-3 as well

    // Either way, renumbered from 1 and written back in the course's format.
    let mut file = Vec::new();
    ego.write_edges(&mut file)?; // "3\n1 2\n1 3\n2 3\n"
    // wiki:end
    assert_eq!(cut.kept(), [1, 2]);
    assert_eq!(inside, 1);
    assert_eq!(around, [1, 2, 3]);
    assert_eq!(among, [(1, 2, 1.0), (1, 3, 1.0), (2, 3, 1.0)]);
    assert_eq!(file, b"3\n1 2\n1 3\n2 3\n");
    Ok(())
}

// ---- Part 3: direction, Bellman-Ford, Floyd-Warshall, Johnson, SCC ----------
//
// The directed sample: the sample's six edges read as arcs, two of them
// negative, around one cycle 2 → 4 → 5 → 3 → 2 of weight 1 (no negative
// cycle). The page draws it with the sample's positions.

#[test]
fn direction() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start direction
    use graphman::{Build, Csr, EdgeList, Graph, Orientation};

    // The same format, read as arcs: the line `u v w` is the arc u → v.
    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let arcs = EdgeList::parse_with(text, Orientation::Directed)?;
    let graph = Csr::build(&arcs)?;
    let directed = graph.is_directed(); // true
    let out: Vec<_> = graph.neighbors(3).collect(); // [2]: neighbors are out-neighbours

    // Whatever needs the in-arcs runs on the transpose, built once
    // (an undirected graph is its own).
    let reverse = graph.transpose()?;
    let into: Vec<_> = reverse.neighbors(3).collect(); // [1, 5]
    // wiki:end
    assert!(directed);
    assert_eq!(out, vec![2]);
    assert_eq!(into, vec![1, 5]);
    Ok(())
}

#[test]
fn bellman_ford() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start bellman_ford
    use graphman::{Build, Csr, EdgeList, Orientation, algo, algo::ScheduleKind};

    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let graph = Csr::build(&EdgeList::parse_with(text, Orientation::Directed)?)?;

    // Negative arcs are fine: 1 → 3 → 2 costs 2 - 1 = 1, less than 1 → 2.
    let tree = algo::bellman_ford(&graph, 1, ScheduleKind::Queue)?;
    let to_5 = tree.distance(5); // Some(1.0): 1 → 3 → 2 → 4 → 5
    let path = tree.path_to(5); // Some([1, 3, 2, 4, 5])

    // To one target from everywhere: the same run on the transpose.
    let toward_5 = algo::bellman_ford_to(&graph, 5, ScheduleKind::Queue)?;
    let from_3 = toward_5.distance(3); // Some(-1.0): 3 → 2 → 4 → 5

    // Make 5 → 3 weigh -1 and the cycle 2 → 4 → 5 → 3 → 2 weighs -2:
    // no shortest path exists, and the error is the cycle itself.
    let worse = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 -1\n";
    let graph = Csr::build(&EdgeList::parse_with(worse, Orientation::Directed)?)?;
    let cycle = algo::bellman_ford(&graph, 1, ScheduleKind::Queue).unwrap_err();
    let (around, weight) = (cycle.cycle, cycle.weight); // [2, 4, 5, 3], -2.0
    // wiki:end
    assert_eq!(to_5, Some(1.0));
    assert_eq!(path, Some(vec![1, 3, 2, 4, 5]));
    assert_eq!(from_3, Some(-1.0));
    assert_eq!((around, weight), (vec![2, 4, 5, 3], -2.0));
    Ok(())
}

#[test]
fn schedules() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start schedules
    use graphman::algo::{MeasuredSchedule, ScheduleKind};
    use graphman::{Build, Csr, EdgeList, Orientation, algo};

    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let graph = Csr::build(&EdgeList::parse_with(text, Orientation::Directed)?)?;

    // One Bellman-Ford, many orders: a schedule says which vertex to
    // re-examine next. Every one gives the same distances; the work differs.
    let mut work = Vec::new();
    for kind in [
        ScheduleKind::Rounds,
        ScheduleKind::EarlyStop,
        ScheduleKind::Queue,
    ] {
        let mut measured = MeasuredSchedule::new(kind.schedule());
        let tree = algo::bellman_ford_with(&graph, 1, &mut measured, &mut ())?;
        work.push((kind, measured.counts().scans, tree.distance(5)));
    }
    // Rounds: n - 1 passes over every vertex, then one to confirm;
    // early stop: until a pass changes nothing; queue: only what went down.
    // wiki:end
    let scans: Vec<usize> = work.iter().map(|w| w.1).collect();
    assert!(work.iter().all(|w| w.2 == Some(1.0)));
    assert!(scans[0] >= scans[1] && scans[1] >= scans[2], "{scans:?}");
    Ok(())
}

#[test]
fn floyd_warshall() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start floyd_warshall
    use graphman::algo::{FloydRounds, SweepKind};
    use graphman::{Build, Csr, EdgeList, MemoryBudget, Orientation, algo};

    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let graph = Csr::build(&EdgeList::parse_with(text, Orientation::Directed)?)?;

    // Every pair at once, in one n × n table updated in place: 12 bytes a
    // cell, priced and refused past the budget like the matrix.
    let all = algo::floyd_warshall(&graph, SweepKind::Plain, MemoryBudget::Machine)?;
    let d = all.distance(4, 2); // Some(-1.0): 4 → 5 → 3 → 2
    let path = all.path(4, 2); // Some([4, 5, 3, 2])
    let row = all.tree(1); // row 1 is the tree from 1, no extra memory

    // The same run one round at a time: D_k after each k, and what changed.
    let mut rounds = FloydRounds::new(&graph, MemoryBudget::Machine)?;
    let mut lowered = Vec::new();
    rounds.step(&mut lowered)?; // k = 1: nothing goes through 1 (no arc enters it)
    let first = lowered.len(); // 0
    // wiki:end
    assert_eq!(d, Some(-1.0));
    assert_eq!(path, Some(vec![4, 5, 3, 2]));
    assert_eq!(row.distance(5), Some(1.0));
    assert_eq!(first, 0);
    Ok(())
}

#[test]
fn johnson() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start johnson
    use graphman::algo::ScheduleKind;
    use graphman::{Build, Csr, EdgeList, FrontierKind, MemoryBudget, Orientation, algo};

    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let graph = Csr::build(&EdgeList::parse_with(text, Orientation::Directed)?)?;

    // One Bellman-Ford from everywhere gives potentials h; every arc
    // reweighted to w + h(u) - h(v) is non-negative, so n Dijkstras finish.
    let h = algo::potentials(&graph, ScheduleKind::Queue)?; // h[2] = -1, h[5] = -2
    let all = algo::johnson(&graph, FrontierKind::Heap, MemoryBudget::Machine)?;
    let d = all.distance(4, 2); // Some(-1.0), as Floyd-Warshall
    // wiki:end
    assert_eq!((h[2], h[5]), (-1.0, -2.0));
    assert_eq!(d, Some(-1.0));
    Ok(())
}

#[test]
fn strong_components() -> Result<(), Box<dyn std::error::Error>> {
    // wiki:start strong_components
    use graphman::algo::StrongComponents;
    use graphman::{Build, Csr, EdgeList, Orientation, algo};

    let text = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n5 3 2\n";
    let graph = Csr::build(&EdgeList::parse_with(text, Orientation::Directed)?)?;

    // Iterative Tarjan, numbered in a topological order of the condensation.
    let scc = StrongComponents::compute(&graph);
    let count = scc.count(); // 2: {1} and the cycle {2, 3, 4, 5}
    let cycle = scc.members(scc.component_of(2)); // [2, 3, 4, 5]
    let order = scc.topological_order(); // None: there is a cycle

    // Without the arc 5 → 3 the graph is acyclic, and a topological order
    // gives shortest paths in O(n + m), negative arcs and all.
    let dag = b"5\n1 2 4\n1 3 2\n3 2 -1\n2 4 2\n4 5 -2\n";
    let graph = Csr::build(&EdgeList::parse_with(dag, Orientation::Directed)?)?;
    let tree = algo::dag_shortest_path(&graph, 1)?;
    let to_5 = tree.distance(5); // Some(1.0)
    // wiki:end
    assert_eq!(count, 2);
    assert_eq!(cycle, &[2, 3, 4, 5]);
    assert_eq!(order, None);
    assert_eq!(to_5, Some(1.0));
    Ok(())
}
