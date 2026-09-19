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
        A Rust graph library that measures itself — one <code>Graph</code> trait, three ways to
        store a graph, four ways to find its diameter — running in your browser.
      </>
    ),
    open: 'Open the observatory',
    library: 'The library',
    discover: '// discover more',
    discoverLabel: 'Discover more',
    whatEyebrow: 'what it is',
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
      servers: 'servers',
      inTab: 'the library runs in your tab',
    },
  },

  pipeline: {
    eyebrow: 'In the browser',
    title: 'No server, no pre-baked data: the library itself.',
    lead: 'The observatory starts empty. Load any graph in the course format and everything you see is computed on the spot.',
    steps: [
      {
        title: 'Rust, compiled to WebAssembly',
        body: 'The same crate that runs the case studies (crates/graphman) is bound with wasm-bindgen. Parsing, BFS, DFS, distances, components and the diameter run in your tab, single-threaded, from the file you drop.',
      },
      {
        title: 'The search tree is the layout',
        body: 'A BFS from the smallest vertex of every component gives each vertex a ring and an angle in O(n). That radial layout is the starting point, and the final one for graphs too large to simulate.',
      },
      {
        title: 'WebGPU through vgpu',
        body: 'Positions, edges and the search tree live in GPU storage buffers. A compute shader relaxes the layout with a force simulation; two draws render every vertex and edge, coloured by the level the traversal reached them at.',
      },
    ],
  },

  decisions: {
    eyebrow: 'The library',
    title: 'Six decisions worth presenting.',
    lead: 'Undirected graphs for now; parts 2 and 3 add weights, directions and flows on the same core, which is why the trait stays small and the algorithms generic.',
    items: [
      {
        title: 'Storage is a strategy',
        body: 'A five-method Graph trait with a GAT neighbour iterator. Every algorithm is written once and monomorphised per representation, so swapping the storage cannot change a result, only its cost.',
      },
      {
        title: 'Normalise once',
        body: 'The parser drops self-loops, orients edges as [min, max], sorts and dedups. Because the list is sorted, every builder gets ascending neighbour rows for free and all search trees come out identical.',
      },
      {
        title: 'Traversals are observable',
        body: 'BFS and DFS report to a Visitor and can stop early. Distance is a BFS with a stop condition; DFS is iterative over neighbour iterators and yields the recursive tree with O(depth) memory.',
      },
      {
        title: 'Nothing is allocated twice',
        body: 'A SearchTree resets only what the previous search touched. Thousands of BFS runs in the diameter algorithms cost no allocations and no O(n) clears.',
      },
      {
        title: 'A memory budget, not a crash',
        body: 'Builders compute the bytes they need up front. A 375 000-vertex bitset matrix is 17.6 GB; instead of swap death you get a typed error and a table cell.',
      },
      {
        title: 'Diameter, four ways',
        body: 'Brute force, iFUB, Takes–Kosters bounds and a 4-sweep. The driver walks components largest-first, skips those too small to matter and every method is cancellable with a budget.',
      },
    ],
  },

  footer: {
    project: 'Project',
    source: 'Source on GitHub',
    stack: 'Stack',
    licence: 'MIT licensed',
    course: 'Course',
    courseName: 'COS 242 · Graph Theory',
    legal:
      'Case-study timings were measured on the machine named in each study and exclude parsing and output, as the course requires.',
    built: '// built sep 2026 · rio de janeiro',
  },

  studies: {
    eyebrow: 'Case studies',
    title: 'Measured, not estimated.',
    lead: (
      <>
        Six course graphs, from 10 thousand to 4.8 million vertices. Every number below comes from{' '}
        <code className="mono">graphman study</code>; memory is the process footprint measured in a
        fresh subprocess per representation, times are wall-clock means over 100 searches from
        distinct random roots.
      </>
    ),
    emptyTitle: 'No results yet.',
    emptyLead: (
      <>
        Run <code className="mono">graphman study</code> on the course graphs and rebuild the site;
        the tables fill themselves from studies/results.json.
      </>
    ),
    graph: (n: string) => `Graph ${n}`,
    columns: {
      graph: 'Graph',
      vertices: 'Vertices',
      edges: 'Edges',
      components: 'Components',
      largest: 'Largest',
      smallest: 'Smallest',
    },
    representations: {
      adjacency_list: 'Adjacency list',
      adjacency_matrix: 'Adjacency matrix',
      csr: 'CSR',
    },
    methods: {
      exact: 'Brute force',
      i_fub: 'iFUB',
      bounds: 'Takes–Kosters',
      sweep: '4-sweep',
    },
    memoryCaption: 'Process memory after loading the graph',
    needed: (bytes: string) => `${bytes} needed`,
    overBudget: 'over budget',
    timeCaption: (algo: string) => `Mean ${algo} time, 100 searches`,
    diameterCaption: 'Diameter: value and BFS runs per method',
    bfsRuns: (count: string) => `${count} BFS`,
    componentsCaption: 'Components and distances',
    note: 'A flagged diameter (≥) is a lower bound: the 4-sweep never certifies, and the exact methods were stopped by their time budget on the two largest graphs. Random graphs are the worst case for iFUB and the bounding algorithm, and the BFS counts are reported as measured.',
  },

  observatory: {
    diameterMethods: {
      Sweep: '4-sweep (lower bound)',
      IFub: 'iFUB (exact)',
      Bounds: 'Takes–Kosters (exact)',
      Exact: 'Brute force (exact)',
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
    modeSearch: 'Search',
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
    budgetHit: ' (budget hit)',
    bfsCount: (count: string) => `${count} BFS`,
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
            body: 'Self-loops dropped, edges oriented [min, max], sorted and deduped — so every representation gets ascending neighbour rows and identical search trees. Tests enforce it.',
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
          { value: '4', label: 'layouts', hint: 'force, radial, layered, degree — GPU morph' },
          { value: '0', label: 'servers', hint: 'everything computed client-side' },
        ],
        cta: 'Open the observatory',
        source: 'github.com/lkzppm/GraphMan',
      },
    },
  },
};
