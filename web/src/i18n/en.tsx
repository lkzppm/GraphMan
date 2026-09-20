// English interface strings. This object is the schema every other language
// must match (see `index.ts`). Functions take the values a sentence needs
// so word order stays each language's business.

export const en = {
  lang: 'en',
  name: 'English',

  nav: {
    home: 'GraphMan home',
    pages: 'Pages',
    observatory: 'Observatory',
    library: 'Library',
    studies: 'Case studies',
    presentation: 'Presentation',
    source: 'Source on GitHub',
    language: 'Language',
  },

  hero: {
    eyebrow: 'built for cos 242 · graph theory · ufrj 2026/2',
    brief: (
      <>
        A Rust graph library: one <code>Graph</code> trait, three ways to store a graph, four ways
        to find its diameter, running in your browser.
      </>
    ),
    open: 'Open the observatory',
    library: 'The library',
    discover: '// discover more',
    discoverLabel: 'Discover more',
    whatTitle: 'One trait, three representations, four diameters',
    whatLead: (
      <>
        GraphMan reads the course&apos;s edge-list format into an adjacency list, a bitset matrix or
        CSR, and runs BFS, DFS, distances, components and the diameter on any of them through one
        small <code className="mono">Graph</code> trait. It measures its own memory and time on the
        six course graphs, and compiled to WebAssembly it is the engine of the observatory.
      </>
    ),
    facts: {
      edges: 'edges in the largest graph',
      parsedIn: (time: string) => `parsed in ${time}`,
      representations: 'representations',
      oneTrait: 'one Graph trait',
      methods: 'diameter methods',
      cancellable: 'all cancellable',
    },
    // The figure beside the lead: one small graph and its three encodings.
    figure: {
      graph: 'the graph',
      list: 'adjacency list',
      matrix: 'bitset matrix',
      csr: 'CSR',
      offsets: 'offsets',
      targets: 'targets',
    },
  },

  pipeline: {
    title: (
      <>
        No server, no pre-baked data: the library itself{' '}
        <span className="accent">in your browser</span>
      </>
    ),
    lead: 'The observatory starts empty. Load any graph in the course format and everything you see is computed on the spot.',
    steps: [
      {
        title: 'Rust, compiled to WebAssembly',
        body: 'The same crate that runs the case studies (crates/graphman) is bound with wasm-bindgen. Parsing, BFS, DFS, distances, components and the diameter run in your tab, single-threaded, from the file you drop.',
      },
      {
        title: 'WebGPU through vgpu',
        body: 'Positions, edges and the search tree live in GPU buffers. Compute shaders run the force simulation and morph between four layouts (force, radial, layered, degree); every vertex and edge is drawn coloured by the level the search reached it at.',
      },
    ],
  },

  // The library page: a manual on the sample graph. Code examples come from
  // crates/graphman/tests/wiki.rs (via web/src/data/wiki.json), so only the
  // words live here.
  library: {
    contents: 'Contents',
    copy: 'Copy',
    copied: 'Copied',
    chapters: {
      start: {
        title: 'Start',
        body: 'Add the crate, parse an edge list, build a representation and call the algorithms. Vertices are numbered from 1, exactly as in the input files.',
        file: 'the file',
      },
      format: {
        title: 'The format',
        body: 'The first line is the vertex count, then one edge per line. Parsing normalises once, so every representation agrees on what the graph is: self-loops are dropped, each undirected edge is kept once as [min, max], duplicates go, the list is sorted.',
        raw: 'as written',
        kept: 'after parsing',
        loop: 'self-loop',
        duplicate: 'duplicate',
      },
      representations: {
        title: 'Three representations',
        body: 'AdjacencyList (one row per vertex), AdjacencyMatrix (a packed bitset) and Csr (two contiguous arrays) all implement the same small Graph trait, and all keep neighbour rows ascending. Algorithms are written once and monomorphised per representation: swapping the storage changes the cost, never the answer.',
        table: [
          ['Representation', 'Memory', 'neighbors(v)', 'has_edge(u, v)'],
          ['AdjacencyList', 'O(n + m) words, one block per vertex', 'O(deg v)', 'O(log deg u)'],
          ['Csr', 'O(n + m) words, two blocks', 'O(deg v)', 'O(log deg u)'],
          ['AdjacencyMatrix', 'O(n²) bits', 'O(n / 64) words', 'O(1)'],
        ],
        dispatch:
          "When the representation is chosen at runtime (the CLI takes it as a flag), AnyGraph holds whichever was built and dispatch! runs a generic expression on it. The algorithm is still specialised per representation; the only dynamic decision is one match. Every builder also knows its cost before allocating (required_bytes) and checks it against a MemoryBudget, the machine's memory by default: a 375 000-vertex bitset matrix is 17.6 GB, and asking for it gives a typed BuildError::OverBudget, not a process dying in swap.",
      },
      traversals: {
        title: 'Traversals',
        body: 'bfs and dfs return a SearchTree: parent and level of every reached vertex, plus the order of discovery. BFS is level-synchronous (the order doubles as the queue); DFS is iterative over neighbour iterators, so it uses O(depth) memory and yields exactly the tree the recursive version would.',
        bfs: 'BFS from 1: vertices by level, tree edges in blue, depth 2',
        dfs: 'DFS from 1: the same graph, one path down to depth 4',
      },
      visitors: {
        title: 'Visitors',
        body: 'A traversal reports to a Visitor: discover, level_complete (BFS) and finish (DFS), each with a no-op default. Returning Control::Break stops the search; distance is a BFS with a visitor that breaks at the target. Trees are reusable through the _into variants: a reset only touches what the previous search reached.',
        state: 'the search when it stops',
        sequence: 'What Until(4) hears on the BFS from 1',
        go: 'Continue',
        stop: 'Break',
      },
      distance: {
        title: 'Distance and components',
        body: 'distance runs a BFS that stops at the target and returns None across components; eccentricity is the farthest vertex from one. Components::compute labels every vertex with one BFS per component, numbered from the largest, ties broken by the smallest vertex.',
        legend: 'two components, the shortest path from 4 to 3 in blue',
      },
      diameter: {
        title: 'Diameter',
        body: 'Four strategies share one driver that walks the components from largest to smallest and skips any too small to beat the best value found. Exact is one BFS per vertex; iFUB (Crescenzi et al., 2013) and the Takes-Kosters bounds (2011) are exact with far fewer searches on real graphs; the 4-sweep is a cheap lower bound. Every run can be cancelled through a progress callback and then reports its best bound, flagged as not exact.',
        legend: 'the endpoints 1 and 5 ringed, a longest shortest path in blue: the diameter is 2',
      },
      cli: {
        title: 'The command line',
        body: "The graphman binary wraps the library: every command takes a graph file, a --repr (list, matrix or csr) and writes the assignment's output files. study runs the whole case study and writes JSON plus RESULTS.md.",
        flow: ['a graph in the course format', 'one command', "the assignment's output file"],
        commands: [
          'the summary file: counts, degree statistics, components',
          'a search tree from vertex 1, stored as CSR',
          'distances for pairs of vertices',
          'the diameter by Takes-Kosters bounds, giving up after 60 s',
          'the case study of one graph, into studies/',
        ],
      },
    },
  },

  footer: {
    project: 'Project',
    source: 'Source on GitHub',
    stack: 'Stack',
    licence: 'MIT licensed',
    author: 'Author',
    authorName: 'Lucas Pacheco',
    github: 'GitHub',
    linkedin: 'LinkedIn',
    course: 'Course',
    courseName: 'COS 242 · Graph Theory',
    copyright: '© 2026',
  },

  studies: {
    overview: 'Overview',
    views: 'Views',
    average: (n: string) => `mean of the ${n} graphs`,
    of: (k: string, n: string) => `${k} of ${n}`,
    emptyTitle: 'No results yet.',
    emptyLead: (
      <>
        Run <code className="mono">graphman study</code> on the course graphs and rebuild the site;
        the page fills itself from studies/results.json.
      </>
    ),
    graph: (n: string) => `Graph ${n}`,
    representations: {
      adjacency_list: 'Adjacency list',
      adjacency_matrix: 'Adjacency matrix',
      csr: 'CSR',
    },
    short: { adjacency_list: 'list', adjacency_matrix: 'matrix', csr: 'CSR' },
    methods: {
      exact: 'Brute force',
      i_fub: 'iFUB',
      bounds: 'Takes-Kosters',
      sweep: '4-sweep',
    },
    facts: {
      vertices: 'vertices',
      edges: 'edges',
      degree: (min: string, max: string, mean: string, median: string) =>
        `degree ${min} to ${max}, mean ${mean}, median ${median}`,
      dropped: (loops: string, dups: string) => `${loops} self-loops, ${dups} duplicates dropped`,
    },
    questions: {
      memory: {
        title: 'Memory per representation',
        needs: (bytes: string) => `would need ${bytes}`,
      },
      bfs: { title: 'Mean time of one BFS' },
      dfs: { title: 'Mean time of one DFS' },
      parents: {
        title: 'Parents of 10, 20 and 30',
        root: (r: string) => `root ${r}`,
        vertex: (v: string) => `vertex ${v}`,
        level: 'level',
        meanLevel: 'mean level',
        reached: 'reached',
        unreached: 'another component',
      },
      distances: { title: 'Distances (10, 20), (10, 30), (20, 30)' },
      components: {
        title: 'Connected components',
        count: (n: string) => `${n} components`,
        one: '1 component',
        largest: (n: string) => `largest ${n}`,
        smallest: (n: string) => `smallest ${n}`,
        others: (n: string) => `${n} others`,
      },
      diameter: {
        title: 'Diameter',
        bfs: (count: string) => `${count} BFS`,
        stopped: (elapsed: string) => `stopped at ${elapsed}`,
        exact: 'exact',
      },
    },
  },

  observatory: {
    diameterMethods: {
      Sweep: { label: '4-sweep', hint: 'four BFS, a bound' },
      IFub: { label: 'iFUB', hint: 'exact, fewest BFS' },
      Bounds: { label: 'Takes–Kosters', hint: 'exact, by bounds' },
      Exact: { label: 'Brute force', hint: 'exact, one BFS each' },
    },
    controls: [
      ['click', 'pick the origin'],
      ['drag', 'move a vertex'],
      ['drag bg', 'pan'],
      ['scroll', 'zoom'],
      ['dbl-click', 'fit the graph'],
      ['F', 'fit the graph'],
      ['space', 'play / pause'],
      ['← →', 'step a vertex / component'],
      ['↑ ↓', 'step a level'],
      ['esc', 'clear the origin / component'],
      ['drop file', 'load a graph'],
    ] as [string, string][],
    layouts: {
      force: { label: 'Force', hint: 'springs and repulsion' },
      radial: { label: 'Radial levels', hint: 'BFS rings around the origin' },
      layered: { label: 'Layered', hint: 'levels as rows, subtrees together' },
      degree: { label: 'Degree circle', hint: 'sorted by degree, edges as chords' },
    },
    format: {
      vertices: '// vertices',
      edge: '// one edge per line',
    },
    graph: 'Graph',
    loadFile: 'Load a graph file',
    downloadSummary: 'Download the summary file',
    closeGraph: 'Close the graph',
    parsedIn: (time: string) => `parsed in ${time}`,
    vertices: 'Vertices',
    edges: 'Edges',
    components: 'Components',
    browseComponents: 'Browse the components',
    meanDegree: 'Mean degree',
    loopsDropped: (n: number) => `${n} loops dropped`,
    duplicatesDropped: (n: number) => `${n} duplicates dropped`,
    search: 'Search',
    downloadTree: 'Download the tree file',
    clearSearch: 'Clear the search',
    origin: 'Origin',
    originPlaceholder: 'click a vertex',
    traversal: 'Traversal',
    theOrigin: 'the origin',
    runFrom: (kind: string, root: string) => `Run ${kind} from ${root}`,
    mode: 'Mode',
    modeSearch: 'Max',
    modeDistance: 'Distance',
    distance: 'Distance',
    pathLength: 'Steps',
    target: 'Target',
    targetPlaceholder: 'and another',
    theTarget: 'the target',
    runDistance: (kind: string, from: string, to: string) =>
      `${kind} from ${from} until it reaches ${to}`,
    path: 'Shortest path',
    noPath: 'no path: the target is in another component',
    pathOnly: 'Grey out everything but the path',
    colourSearch: 'Colour the whole traversal again',
    fitPath: 'Fit the path to the view',
    reached: 'Reached',
    eccentricity: 'Eccentricity',
    depth: 'Depth',
    time: 'Time',
    pause: 'Pause',
    replay: 'Replay',
    play: 'Play',
    progress: 'Discovery progress',
    searchHint: 'Click a vertex on the canvas to make it the origin, or type its number.',
    diameter: 'Diameter',
    method: 'Method',
    bfsBudget: 'BFS budget',
    computing: 'Computing…',
    compute: 'Compute',
    budgetHit: 'budget hit',
    bfsCount: (count: string) => `${count} BFS`,
    diameterExact: 'exact',
    diameterBound: 'lower bound',
    diameterHint: 'Pick a method and compute the longest of all the shortest paths.',
    showDiameterPath: (from: string, to: string) => `Draw the path from ${from} to ${to}`,
    sample: 'Sample',
    sampleHint: '5 vertices · 5 edges',
    openFile: 'Open a file',
    openFileHint: '.txt · course format',
    controlsTitle: 'Controls',
    keysNote: '// rust → wasm · webgpu · runs in your tab',
    canvas: 'Graph canvas',
    noWebGpu: 'WebGPU is not available',
    noWebGpuHint:
      'The observatory needs a browser with WebGPU (Chrome, Edge, Safari 26 or Firefox 141 and newer).',
    failed: 'Something went wrong',
    booting: 'Starting the library…',
    parsing: (name: string) => `Parsing ${name}…`,
    drop: 'Drop a graph file anywhere',
    fileFormat: 'File format',
    browse: 'Browse files',
    trySample: 'Try the sample',
    hideControls: 'Hide the controls',
    showControls: 'Show the controls',
    hideNumbers: 'Hide vertex numbers',
    showNumbers: 'Show vertex numbers',
    stopFollowing: 'Stop following the search',
    follow: 'Follow the search (keep discovered vertices in view)',
    hideLayouts: 'Hide the layouts',
    chooseLayout: 'Choose a layout',
    layoutsMenu: 'Layouts',
    layout: 'Layout',
    simulation: 'Simulation',
    pauseSimulation: 'Pause the force simulation',
    resumeSimulation: 'Resume the force simulation',
    reheat: 'Reheat the simulation',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit the graph to the view (F)',
    exitFullscreen: 'Exit full screen',
    fullscreen: 'Full screen',
    level: (n: number | string) => `level ${n}`,
    notReached: 'not reached',
    component: (n: number) => `component ${n}`,
    theRest: 'the rest',
    originVertex: (v: number) => `Origin: vertex ${v}`,
    chooseOrigin: 'Click a vertex to choose the origin',
    vertex: (v: number) => `vertex ${v}`,
    degree: (d: number) => `degree ${d}`,
    parent: (p: number) => ` · parent ${p}`,
    dismiss: 'Dismiss',
    couldNotLoad: (name: string, message: string) => `Could not load ${name}: ${message}`,
    tooLarge: (name: string, size: string, limit: string) =>
      `${name} is ${size}; the observatory accepts files up to ${limit}.`,
    degreeDistribution: 'Degree distribution',
    verticesPerDegree: 'vertices per degree',
    degreeBucket: (range: string, count: string) => `degree ${range}: ${count}`,
    componentsCount: (n: string) => `Components · ${n}`,
    connected: 'connected',
    smallest: (n: string) => `smallest ${n}`,
    pickComponent: 'Pick a component',
    componentTitle: (i: number, size: string) => `component ${i}: ${size} vertices`,
    componentLabel: (i: number, size: string) => `Component ${i}, ${size} vertices`,
    moreComponents: (n: string, size: string) => `${n} more components: ${size} vertices`,
    smallerComponents: (n: string) => `${n} smaller components`,
    previousComponent: 'Previous (larger) component',
    nextComponent: 'Next (smaller) component',
    componentWord: 'component',
    backToSummary: 'Back to the graph summary',
    backToSummaryShort: 'Back to the summary',
    ofGraph: (pct: string) => `${pct}% of the graph`,
    ofEdges: (pct: string) => `${pct}% of the edges`,
    componentDegree: 'Degree',
    mean: (v: string) => `mean ${v}`,
    density: 'Density',
    ofPossible: 'of the possible edges',
    levelNoun: 'level',
    depthNoun: 'depth',
    verticesPer: (noun: string) => `Vertices per ${noun}`,
    goTo: (noun: string, n: number) => `Go to ${noun} ${n}`,
    depthTrace: 'Depth over the traversal',
  },

  presentation: {
    title: 'Presentation',
    counter: (i: number, n: number) => `${i} / ${n}`,
    previous: 'Previous slide',
    next: 'Next slide',
    fullscreen: 'Full screen (F)',
    hint: '← → to move · F full screen',
    slides: {
      cover: {
        eyebrow: 'cos 242 · graph theory · ufrj 2026/2 · part 1',
        tagline: 'A Rust graph library that measures itself.',
        author: 'Lucas Pacheco',
        stack: ['Rust 2024', 'WebAssembly', 'WebGPU · vgpu', 'Next.js', 'Vercel'],
      },
      architecture: {
        eyebrow: '01 · architecture',
        title: 'Storage is a strategy.',
        lead: 'One five-method trait; every algorithm written once and monomorphised per representation. Swapping the storage cannot change a result, only its cost.',
        crates: [
          {
            name: 'graphman',
            role: 'the library',
            body: 'Graph trait · adjacency list, bitset matrix, CSR · BFS, DFS, distances, components, four diameters · memory metrics. No CLI, no I/O concerns: it compiles to wasm.',
          },
          {
            name: 'graphman-cli',
            role: 'the program',
            body: 'One command per feature, and study: the whole case study to JSON and Markdown, memory in a fresh subprocess per representation.',
          },
          {
            name: 'graphman-wasm',
            role: 'the bindings',
            body: 'wasm-bindgen glue only. The same code the studies ran is the engine of the observatory in the browser.',
          },
        ],
      },
      decisions: {
        eyebrow: '02 · decisions',
        title: 'Five things the library does once.',
        items: [
          {
            title: 'Normalise once',
            body: 'Self-loops dropped, edges oriented [min, max], sorted and deduped, so every representation gets ascending neighbour rows and identical search trees. Tests enforce it.',
          },
          {
            title: 'Traversals are observable',
            body: 'BFS and DFS report to a Visitor and can stop early; distance is a BFS with a stop. DFS is iterative with O(depth) memory.',
          },
          {
            title: 'Nothing is allocated twice',
            body: 'A SearchTree resets only what the last search touched: thousands of BFS runs cost no allocations and no O(n) clears.',
          },
          {
            title: 'A memory budget, not a crash',
            body: 'Builders compute their bytes up front; a 375 000-vertex bitset matrix (17.6 GB) becomes a typed error and a table cell.',
          },
          {
            title: 'Diameter, four ways',
            body: 'Brute force, iFUB, Takes–Kosters bounds and a 4-sweep, all cancellable with a budget; components walked largest-first.',
          },
        ],
      },
      results: {
        eyebrow: '03 · case studies',
        title: 'Measured, not estimated.',
        columns: {
          graph: 'Graph',
          vertices: 'Vertices',
          edges: 'Edges',
          list: 'List (memory)',
          matrix: 'Matrix (memory)',
          bfs: 'BFS (list)',
          dfs: 'DFS (list)',
          components: 'Components',
          diameter: 'Diameter',
        },
        needed: (bytes: string) => `${bytes} needed`,
        note: 'Memory: process footprint after loading. Times: mean of 100 searches from distinct roots, excluding parsing and output. ≥ marks a lower bound (4-sweep or a method stopped by its budget).',
      },
      observatory: {
        eyebrow: '04 · the observatory',
        title: 'The library, in your tab.',
        lead: 'No server, no exported data: the file you drop is parsed by the Rust crate compiled to WebAssembly and drawn with WebGPU.',
        facts: [
          {
            value: '1.3M',
            label: 'edges at 60 fps',
            hint: 'graph 2, cached edge layer + level of detail',
          },
          { value: '1 s', label: 'to load graph 4', hint: '105 MB, 8.2M edges' },
          { value: '4', label: 'layouts', hint: 'force, radial, layered, degree, GPU morph' },
          { value: '0', label: 'servers', hint: 'everything computed client-side' },
        ],
        cta: 'Open the observatory',
        source: 'github.com/lkzppm/GraphMan',
      },
    },
  },
};
