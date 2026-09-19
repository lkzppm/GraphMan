// Brazilian Portuguese interface strings, the course's language and the
// site's default. Same shape as `en.tsx`: the type keeps it complete.
import type { Dictionary } from './index';

export const pt: Dictionary = {
  lang: 'pt-BR',
  name: 'Português',

  nav: {
    home: 'Início do GraphMan',
    pages: 'Páginas',
    observatory: 'Observatório',
    library: 'Biblioteca',
    studies: 'Estudos de caso',
    presentation: 'Apresentação',
    source: 'Código no GitHub',
    language: 'Idioma',
  },

  hero: {
    eyebrow: 'feito para cos 242 · teoria dos grafos · ufrj 2026/2',
    brief: (
      <>
        Uma biblioteca de grafos em Rust que mede a si mesma — um trait <code>Graph</code>, três
        formas de guardar um grafo, quatro formas de achar o diâmetro — rodando no seu navegador.
      </>
    ),
    open: 'Abrir o observatório',
    library: 'A biblioteca',
    discover: '// descubra mais',
    discoverLabel: 'Descubra mais',
    whatEyebrow: 'o que é',
    whatTitle: 'Um trait, três representações, quatro diâmetros',
    whatLead: (
      <>
        O GraphMan lê o formato de lista de arestas da disciplina para uma lista de adjacência, uma
        matriz de bits ou CSR, e roda BFS, DFS, distâncias, componentes e o diâmetro em qualquer uma
        delas por um único trait <code className="mono">Graph</code>. Mede a própria memória e o
        próprio tempo nos seis grafos da disciplina e, compilado para WebAssembly, é o motor do
        observatório.
      </>
    ),
    facts: {
      edges: 'arestas no maior grafo',
      parsedIn: (time: string) => `lido em ${time}`,
      representations: 'representações',
      oneTrait: 'um trait Graph',
      methods: 'métodos de diâmetro',
      cancellable: 'todos canceláveis',
      servers: 'servidores',
      inTab: 'a biblioteca roda na sua aba',
    },
  },

  pipeline: {
    eyebrow: 'No navegador',
    title: 'Sem servidor, sem dados pré-calculados: a própria biblioteca.',
    lead: 'O observatório começa vazio. Carregue qualquer grafo no formato da disciplina e tudo o que você vê é calculado na hora.',
    steps: [
      {
        title: 'Rust, compilado para WebAssembly',
        body: 'O mesmo crate que roda os estudos de caso (crates/graphman) é exposto com wasm-bindgen. Leitura, BFS, DFS, distâncias, componentes e o diâmetro rodam na sua aba, em uma thread, a partir do arquivo que você solta.',
      },
      {
        title: 'A árvore de busca é o layout',
        body: 'Uma BFS a partir do menor vértice de cada componente dá a cada vértice um anel e um ângulo em O(n). Esse layout radial é o ponto de partida, e o final para grafos grandes demais para simular.',
      },
      {
        title: 'WebGPU via vgpu',
        body: 'Posições, arestas e a árvore de busca vivem em buffers da GPU. Um compute shader relaxa o layout com uma simulação de forças; dois draws desenham cada vértice e aresta, coloridos pelo nível em que a busca os alcançou.',
      },
    ],
  },

  decisions: {
    eyebrow: 'A biblioteca',
    title: 'Seis decisões que valem apresentar.',
    lead: 'Grafos não direcionados por enquanto; as partes 2 e 3 adicionam pesos, direções e fluxos sobre o mesmo núcleo — por isso o trait fica pequeno e os algoritmos, genéricos.',
    items: [
      {
        title: 'Armazenamento é uma estratégia',
        body: 'Um trait Graph de cinco métodos com um iterador de vizinhos (GAT). Cada algoritmo é escrito uma vez e monomorfizado por representação: trocar o armazenamento não muda o resultado, só o custo.',
      },
      {
        title: 'Normalizar uma vez',
        body: 'O parser descarta laços, orienta arestas como [min, max], ordena e remove duplicatas. Como a lista vem ordenada, todo construtor ganha linhas de vizinhos crescentes de graça e todas as árvores de busca saem idênticas.',
      },
      {
        title: 'Buscas observáveis',
        body: 'BFS e DFS reportam a um Visitor e podem parar cedo. Distância é uma BFS com condição de parada; a DFS é iterativa sobre iteradores de vizinhos e produz a árvore recursiva com memória O(profundidade).',
      },
      {
        title: 'Nada é alocado duas vezes',
        body: 'Uma SearchTree reinicia só o que a busca anterior tocou. Milhares de BFS nos algoritmos de diâmetro não custam alocações nem limpezas O(n).',
      },
      {
        title: 'Um orçamento de memória, não um crash',
        body: 'Os construtores calculam os bytes de que precisam antes. Uma matriz de bits de 375 000 vértices tem 17,6 GB; em vez de morrer no swap, você recebe um erro tipado e uma célula na tabela.',
      },
      {
        title: 'Diâmetro de quatro jeitos',
        body: 'Força bruta, iFUB, limites de Takes–Kosters e 4-sweep. O driver percorre as componentes da maior para a menor, pula as pequenas demais para importar e todo método é cancelável com um orçamento.',
      },
    ],
  },

  footer: {
    project: 'Projeto',
    source: 'Código no GitHub',
    stack: 'Stack',
    licence: 'Licença MIT',
    course: 'Disciplina',
    courseName: 'COS 242 · Teoria dos Grafos',
    legal:
      'Os tempos dos estudos de caso foram medidos na máquina indicada em cada estudo e excluem leitura e escrita, como a disciplina pede.',
    built: '// feito em set 2026 · rio de janeiro',
  },

  studies: {
    eyebrow: 'Estudos de caso',
    title: 'Medido, não estimado.',
    lead: (
      <>
        Seis grafos da disciplina, de 10 mil a 4,8 milhões de vértices. Todo número abaixo vem de{' '}
        <code className="mono">graphman study</code>; memória é o footprint do processo medido em um
        subprocesso novo por representação, tempos são médias de relógio de parede em 100 buscas a
        partir de raízes aleatórias distintas.
      </>
    ),
    emptyTitle: 'Ainda sem resultados.',
    emptyLead: (
      <>
        Rode <code className="mono">graphman study</code> nos grafos da disciplina e reconstrua o
        site; as tabelas se preenchem a partir de studies/results.json.
      </>
    ),
    graph: (n: string) => `Grafo ${n}`,
    columns: {
      graph: 'Grafo',
      vertices: 'Vértices',
      edges: 'Arestas',
      components: 'Componentes',
      largest: 'Maior',
      smallest: 'Menor',
    },
    representations: {
      adjacency_list: 'Lista de adjacência',
      adjacency_matrix: 'Matriz de adjacência',
      csr: 'CSR',
    },
    methods: {
      exact: 'Força bruta',
      i_fub: 'iFUB',
      bounds: 'Takes–Kosters',
      sweep: '4-sweep',
    },
    memoryCaption: 'Memória do processo após carregar o grafo',
    needed: (bytes: string) => `precisa de ${bytes}`,
    overBudget: 'acima do orçamento',
    timeCaption: (algo: string) => `Tempo médio de ${algo}, 100 buscas`,
    diameterCaption: 'Diâmetro: valor e número de BFS por método',
    bfsRuns: (count: string) => `${count} BFS`,
    componentsCaption: 'Componentes e distâncias',
    note: 'Um diâmetro marcado (≥) é um limite inferior: o 4-sweep nunca certifica, e os métodos exatos foram interrompidos pelo orçamento de tempo nos dois maiores grafos. Grafos aleatórios são o pior caso para o iFUB e para o algoritmo de limites, e as contagens de BFS são reportadas como medidas.',
  },

  observatory: {
    diameterMethods: {
      Sweep: '4-sweep (limite inferior)',
      IFub: 'iFUB (exato)',
      Bounds: 'Takes–Kosters (exato)',
      Exact: 'Força bruta (exato)',
    },
    controls: [
      ['clique', 'escolhe a origem'],
      ['arrastar', 'move um vértice'],
      ['arrastar fundo', 'desloca a vista'],
      ['scroll', 'zoom'],
      ['2 cliques', 'enquadra o grafo'],
      ['F', 'enquadra o grafo'],
      ['espaço', 'toca / pausa'],
      ['← →', 'avança um vértice / componente'],
      ['↑ ↓', 'avança um nível'],
      ['esc', 'limpa a origem / componente'],
      ['soltar arquivo', 'carrega um grafo'],
    ],
    layouts: {
      force: { label: 'Forças', hint: 'molas e repulsão' },
      radial: { label: 'Níveis radiais', hint: 'anéis de BFS em torno da origem' },
      layered: { label: 'Camadas', hint: 'níveis em linhas, subárvores juntas' },
      degree: { label: 'Círculo por grau', hint: 'ordenado por grau, arestas como cordas' },
    },
    format: {
      vertices: '// vértices',
      edge: '// uma aresta por linha',
    },
    graph: 'Grafo',
    loadFile: 'Carregar um arquivo de grafo',
    downloadSummary: 'Baixar o arquivo de resumo',
    closeGraph: 'Fechar o grafo',
    parsedIn: (time: string) => `lido em ${time}`,
    vertices: 'Vértices',
    edges: 'Arestas',
    components: 'Componentes',
    browseComponents: 'Navegar pelas componentes',
    meanDegree: 'Grau médio',
    loopsDropped: (n: number) => `${n} laços descartados`,
    duplicatesDropped: (n: number) => `${n} duplicatas descartadas`,
    search: 'Busca',
    downloadTree: 'Baixar o arquivo da árvore',
    clearSearch: 'Limpar a busca',
    origin: 'Origem',
    originPlaceholder: 'clique um vértice',
    traversal: 'Algoritmo',
    theOrigin: 'a origem',
    runFrom: (kind: string, root: string) => `Rodar ${kind} a partir de ${root}`,
    mode: 'Modo',
    modeSearch: 'Max',
    modeDistance: 'Distância',
    distance: 'Distância',
    pathLength: 'Passos',
    target: 'Destino',
    targetPlaceholder: 'e outro',
    theTarget: 'o destino',
    runDistance: (kind: string, from: string, to: string) =>
      `${kind} a partir de ${from} até chegar a ${to}`,
    path: 'Caminho mínimo',
    noPath: 'sem caminho: o destino está em outra componente',
    pathOnly: 'Deixar cinza tudo menos o caminho',
    colourSearch: 'Colorir a busca inteira de novo',
    fitPath: 'Enquadrar o caminho na tela',
    reached: 'Alcançados',
    eccentricity: 'Excentric.',
    depth: 'Profundidade',
    time: 'Tempo',
    pause: 'Pausar',
    replay: 'Repetir',
    play: 'Tocar',
    progress: 'Progresso da descoberta',
    searchHint: 'Clique um vértice na tela para torná-lo a origem, ou digite seu número.',
    diameter: 'Diâmetro',
    method: 'Método',
    bfsBudget: 'Orçamento de BFS',
    computing: 'Calculando…',
    compute: 'Calcular',
    budgetHit: ' (orçamento esgotado)',
    bfsCount: (count: string) => `${count} BFS`,
    sample: 'Exemplo',
    sampleHint: '5 vértices · 5 arestas',
    openFile: 'Abrir um arquivo',
    openFileHint: '.txt · formato da disciplina',
    controlsTitle: 'Controles',
    keysNote: '// rust → wasm · webgpu · roda na sua aba',
    canvas: 'Tela do grafo',
    noWebGpu: 'WebGPU não está disponível',
    noWebGpuHint:
      'O observatório precisa de um navegador com WebGPU (Chrome, Edge, Safari 26 ou Firefox 141 em diante).',
    failed: 'Algo deu errado',
    booting: 'Iniciando a biblioteca…',
    parsing: (name: string) => `Lendo ${name}…`,
    drop: 'Solte um arquivo de grafo em qualquer lugar',
    fileFormat: 'Formato do arquivo',
    browse: 'Procurar arquivos',
    trySample: 'Testar o exemplo',
    hideControls: 'Esconder os controles',
    showControls: 'Mostrar os controles',
    hideNumbers: 'Esconder os números dos vértices',
    showNumbers: 'Mostrar os números dos vértices',
    stopFollowing: 'Parar de seguir a busca',
    follow: 'Seguir a busca (manter os vértices descobertos à vista)',
    hideLayouts: 'Esconder os layouts',
    chooseLayout: 'Escolher um layout',
    layoutsMenu: 'Layouts',
    layout: 'Layout',
    simulation: 'Simulação',
    pauseSimulation: 'Pausar a simulação de forças',
    resumeSimulation: 'Retomar a simulação de forças',
    reheat: 'Reaquecer a simulação',
    zoomIn: 'Aproximar',
    zoomOut: 'Afastar',
    fit: 'Enquadrar o grafo na tela (F)',
    exitFullscreen: 'Sair da tela cheia',
    fullscreen: 'Tela cheia',
    level: (n: number | string) => `nível ${n}`,
    notReached: 'não alcançado',
    component: (n: number) => `componente ${n}`,
    theRest: 'o resto',
    originVertex: (v: number) => `Origem: vértice ${v}`,
    chooseOrigin: 'Clique um vértice para escolher a origem',
    vertex: (v: number) => `vértice ${v}`,
    degree: (d: number) => `grau ${d}`,
    parent: (p: number) => ` · pai ${p}`,
    dismiss: 'Fechar',
    couldNotLoad: (name: string, message: string) =>
      `Não foi possível carregar ${name}: ${message}`,
    tooLarge: (name: string, size: string, limit: string) =>
      `${name} tem ${size}; o observatório aceita arquivos de até ${limit}.`,
    degreeDistribution: 'Distribuição de graus',
    verticesPerDegree: 'vértices por grau',
    degreeBucket: (range: string, count: string) => `grau ${range}: ${count}`,
    componentsCount: (n: string) => `Componentes · ${n}`,
    connected: 'conexo',
    smallest: (n: string) => `menor ${n}`,
    pickComponent: 'Escolher uma componente',
    componentTitle: (i: number, size: string) => `componente ${i}: ${size} vértices`,
    componentLabel: (i: number, size: string) => `Componente ${i}, ${size} vértices`,
    moreComponents: (n: string, size: string) => `mais ${n} componentes: ${size} vértices`,
    smallerComponents: (n: string) => `${n} componentes menores`,
    previousComponent: 'Componente anterior (maior)',
    nextComponent: 'Próxima componente (menor)',
    componentWord: 'componente',
    backToSummary: 'Voltar ao resumo do grafo',
    backToSummaryShort: 'Voltar ao resumo',
    ofGraph: (pct: string) => `${pct}% do grafo`,
    ofEdges: (pct: string) => `${pct}% das arestas`,
    componentDegree: 'Grau',
    mean: (v: string) => `média ${v}`,
    density: 'Densidade',
    ofPossible: 'das arestas possíveis',
    levelNoun: 'nível',
    depthNoun: 'profundidade',
    verticesPer: (noun: string) => `Vértices por ${noun}`,
    goTo: (noun: string, n: number) => `Ir para ${noun} ${n}`,
    depthTrace: 'Profundidade ao longo da busca',
  },

  presentation: {
    title: 'Apresentação',
    counter: (i: number, n: number) => `${i} / ${n}`,
    previous: 'Slide anterior',
    next: 'Próximo slide',
    fullscreen: 'Tela cheia (F)',
    hint: '← → para navegar · F tela cheia',
    slides: {
      cover: {
        eyebrow: 'cos 242 · teoria dos grafos · ufrj 2026/2 · parte 1',
        tagline: 'Uma biblioteca de grafos em Rust que mede a si mesma.',
        author: 'Lucas Pacheco',
        stack: ['Rust 2024', 'WebAssembly', 'WebGPU · vgpu', 'Next.js', 'Vercel'],
      },
      architecture: {
        eyebrow: '01 · arquitetura',
        title: 'Armazenamento é uma estratégia.',
        lead: 'Um trait de cinco métodos; cada algoritmo escrito uma vez e monomorfizado por representação. Trocar o armazenamento não muda o resultado, só o custo.',
        crates: [
          {
            name: 'graphman',
            role: 'a biblioteca',
            body: 'Trait Graph · lista de adjacência, matriz de bits, CSR · BFS, DFS, distâncias, componentes, quatro diâmetros · métricas de memória. Sem CLI, sem E/S: compila para wasm.',
          },
          {
            name: 'graphman-cli',
            role: 'o programa',
            body: 'Um comando por funcionalidade, e study: o estudo de caso inteiro em JSON e Markdown, memória em um subprocesso novo por representação.',
          },
          {
            name: 'graphman-wasm',
            role: 'os bindings',
            body: 'Só cola de wasm-bindgen. O mesmo código que rodou os estudos é o motor do observatório no navegador.',
          },
        ],
      },
      decisions: {
        eyebrow: '02 · decisões',
        title: 'Cinco coisas que a biblioteca faz uma vez só.',
        items: [
          {
            title: 'Normalizar uma vez',
            body: 'Laços descartados, arestas orientadas [min, max], ordenadas e sem duplicatas — toda representação ganha linhas de vizinhos crescentes e árvores de busca idênticas. Os testes garantem.',
          },
          {
            title: 'Buscas observáveis',
            body: 'BFS e DFS reportam a um Visitor e podem parar cedo; distância é uma BFS com parada. A DFS é iterativa, com memória O(profundidade).',
          },
          {
            title: 'Nada é alocado duas vezes',
            body: 'Uma SearchTree reinicia só o que a última busca tocou: milhares de BFS não custam alocações nem limpezas O(n).',
          },
          {
            title: 'Orçamento de memória, não crash',
            body: 'Os construtores calculam seus bytes antes; uma matriz de bits de 375 000 vértices (17,6 GB) vira um erro tipado e uma célula na tabela.',
          },
          {
            title: 'Diâmetro de quatro jeitos',
            body: 'Força bruta, iFUB, limites de Takes–Kosters e 4-sweep, todos canceláveis com um orçamento; componentes percorridas da maior para a menor.',
          },
        ],
      },
      results: {
        eyebrow: '03 · estudos de caso',
        title: 'Medido, não estimado.',
        columns: {
          graph: 'Grafo',
          vertices: 'Vértices',
          edges: 'Arestas',
          list: 'Lista (memória)',
          matrix: 'Matriz (memória)',
          bfs: 'BFS (lista)',
          dfs: 'DFS (lista)',
          components: 'Componentes',
          diameter: 'Diâmetro',
        },
        needed: (bytes: string) => `precisa de ${bytes}`,
        note: 'Memória: footprint do processo após carregar. Tempos: média de 100 buscas a partir de raízes distintas, sem leitura nem escrita. ≥ marca um limite inferior (4-sweep ou método interrompido pelo orçamento).',
      },
      observatory: {
        eyebrow: '04 · o observatório',
        title: 'A biblioteca, na sua aba.',
        lead: 'Sem servidor, sem dados exportados: o arquivo que você solta é lido pelo crate Rust compilado para WebAssembly e desenhado com WebGPU.',
        facts: [
          {
            value: '1.3M',
            label: 'arestas a 60 fps',
            hint: 'grafo 2, camada de arestas em cache + nível de detalhe',
          },
          { value: '1 s', label: 'para carregar o grafo 4', hint: '105 MB, 8,2M arestas' },
          { value: '4', label: 'layouts', hint: 'forças, radial, camadas, grau — morph na GPU' },
          { value: '0', label: 'servidores', hint: 'tudo calculado no cliente' },
        ],
        cta: 'Abrir o observatório',
        source: 'github.com/lkzppm/GraphMan',
      },
    },
  },
};
