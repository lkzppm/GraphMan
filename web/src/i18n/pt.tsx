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
    menu: 'Menu',
    close: 'Fechar o menu',
  },

  hero: {
    eyebrow: 'feito para cos 242 · teoria dos grafos · ufrj 2026/2',
    brief: (
      <>
        Uma biblioteca de grafos em Rust: um trait <code>Graph</code>, três formas de guardar um
        grafo, quatro formas de achar o diâmetro, rodando no seu navegador.
      </>
    ),
    open: 'Abrir o observatório',
    library: 'A biblioteca',
    discover: '// descubra mais',
    discoverLabel: 'Descubra mais',
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
    },
    figure: {
      graph: 'o grafo',
      list: 'lista de adjacência',
      matrix: 'matriz de bits',
      csr: 'CSR',
      offsets: 'offsets',
      targets: 'targets',
    },
  },

  pipeline: {
    title: (
      <>
        Sem servidor, sem dados pré-calculados: a própria biblioteca{' '}
        <span className="accent">no seu navegador</span>
      </>
    ),
    lead: 'O observatório começa vazio. Carregue qualquer grafo no formato da disciplina e tudo o que você vê é calculado na hora.',
    steps: [
      {
        title: 'Rust, compilado para WebAssembly',
        body: 'O mesmo crate que roda os estudos de caso (crates/graphman) é exposto com wasm-bindgen. Leitura, BFS, DFS, distâncias, componentes e o diâmetro rodam na sua aba, em uma thread, a partir do arquivo que você solta.',
      },
      {
        title: 'WebGPU via vgpu',
        body: 'Posições, arestas e a árvore de busca vivem em buffers da GPU. Compute shaders rodam a simulação de forças e o morph entre quatro layouts (forças, radial, camadas, grau); cada vértice e aresta é desenhado com a cor do nível em que a busca o alcançou.',
      },
    ],
  },

  library: {
    contents: 'Conteúdo',
    copy: 'Copiar',
    copied: 'Copiado',
    chapters: {
      start: {
        title: 'Começo',
        body: 'Adicione o crate, leia uma lista de arestas, construa uma representação e chame os algoritmos. Os vértices são numerados a partir de 1, exatamente como nos arquivos de entrada.',
        file: 'o arquivo',
      },
      format: {
        title: 'O formato',
        body: 'A primeira linha é o número de vértices, depois uma aresta por linha. A leitura normaliza uma única vez, e assim toda representação concorda sobre qual é o grafo: laços são descartados, cada aresta não direcionada é guardada uma vez como [min, max], duplicatas saem, a lista é ordenada.',
        raw: 'como escrito',
        kept: 'depois da leitura',
        loop: 'laço',
        duplicate: 'duplicata',
      },
      representations: {
        title: 'Três representações',
        body: 'AdjacencyList (uma linha por vértice), AdjacencyMatrix (uma matriz de bits compacta) e Csr (dois arrays contíguos) implementam o mesmo trait Graph, pequeno, e todas mantêm as linhas de vizinhos em ordem crescente. Os algoritmos são escritos uma vez e monomorfizados por representação: trocar o armazenamento muda o custo, nunca a resposta.',
        table: [
          ['Representação', 'Memória', 'neighbors(v)', 'has_edge(u, v)'],
          ['AdjacencyList', 'O(n + m) palavras, um bloco por vértice', 'O(deg v)', 'O(log deg u)'],
          ['Csr', 'O(n + m) palavras, dois blocos', 'O(deg v)', 'O(log deg u)'],
          ['AdjacencyMatrix', 'O(n²) bits', 'O(n / 64) palavras', 'O(1)'],
        ],
        dispatch:
          'Quando a representação é escolhida em tempo de execução (a CLI recebe como flag), AnyGraph guarda a que foi construída e dispatch! roda uma expressão genérica sobre ela. O algoritmo continua especializado por representação; a única decisão dinâmica é um match. Todo builder também sabe seu custo antes de alocar (required_bytes) e o confere contra um MemoryBudget, a memória da máquina por padrão: a matriz de bits de 375 000 vértices tem 17,6 GB, e pedi-la devolve um BuildError::OverBudget tipado, não um processo morrendo em swap.',
      },
      traversals: {
        title: 'Buscas',
        body: 'bfs e dfs devolvem uma SearchTree: pai e nível de cada vértice alcançado, mais a ordem de descoberta. A BFS é síncrona por nível (a ordem serve de fila); a DFS é iterativa sobre iteradores de vizinhos, então usa memória O(profundidade) e produz exatamente a árvore que a versão recursiva produziria.',
        bfs: 'BFS a partir de 1: vértices por nível, arestas da árvore em azul, profundidade 2',
        dfs: 'DFS a partir de 1: o mesmo grafo, um caminho só até a profundidade 4',
      },
      visitors: {
        title: 'Visitors',
        body: 'Uma busca reporta a um Visitor: discover, level_complete (BFS) e finish (DFS), cada um com um padrão vazio. Devolver Control::Break interrompe a busca; distância é uma BFS com um visitor que para no destino. As árvores são reutilizáveis pelas variantes _into: um reset só toca o que a busca anterior alcançou.',
        state: 'a busca quando para',
        sequence: 'O que Until(4) ouve na BFS a partir de 1',
        go: 'Continue',
        stop: 'Break',
      },
      distance: {
        title: 'Distância e componentes',
        body: 'distance roda uma BFS que para no destino e devolve None entre componentes; eccentricity é o vértice mais distante de um dado. Components::compute rotula cada vértice com uma BFS por componente, numeradas da maior para a menor, empate pelo menor vértice.',
        legend: 'duas componentes, o caminho mais curto de 4 a 3 em azul',
      },
      diameter: {
        title: 'Diâmetro',
        body: 'Quatro estratégias dividem um driver que percorre as componentes da maior para a menor e pula as pequenas demais para superar o melhor valor encontrado. Exact é uma BFS por vértice; iFUB (Crescenzi et al., 2013) e os limites de Takes-Kosters (2011) são exatos com muito menos buscas em grafos reais; o 4-sweep é um limite inferior barato. Toda execução pode ser cancelada por um callback de progresso, e então reporta o melhor limite, marcado como não exato.',
        legend:
          'as pontas 1 e 5 em destaque, um caminho mais curto mais longo em azul: o diâmetro é 2',
      },
      cli: {
        title: 'A linha de comando',
        body: 'O binário graphman embrulha a biblioteca: todo comando recebe um arquivo de grafo, um --repr (list, matrix ou csr) e escreve os arquivos de saída da disciplina. study roda o estudo de caso inteiro e escreve JSON mais o RESULTS.md.',
        flow: [
          'um grafo no formato da disciplina',
          'um comando',
          'o arquivo de saída da disciplina',
        ],
        commands: [
          'o arquivo de resumo: contagens, estatísticas de grau, componentes',
          'uma árvore de busca a partir do vértice 1, guardada como CSR',
          'distâncias entre pares de vértices',
          'o diâmetro pelos limites de Takes-Kosters, desistindo após 60 s',
          'o estudo de caso de um grafo, em studies/',
        ],
      },
    },
  },

  footer: {
    project: 'Projeto',
    source: 'Código no GitHub',
    stack: 'Stack',
    licence: 'Licença MIT',
    author: 'Autor',
    authorName: 'Lucas Pacheco',
    github: 'GitHub',
    linkedin: 'LinkedIn',
    course: 'Disciplina',
    courseName: 'COS 242 · Teoria dos Grafos',
    copyright: '© 2026',
  },

  studies: {
    overview: 'Geral',
    views: 'Visões',
    average: (n: string) => `média dos ${n} grafos`,
    of: (k: string, n: string) => `${k} de ${n}`,
    emptyTitle: 'Ainda sem resultados.',
    emptyLead: (
      <>
        Rode <code className="mono">graphman study</code> nos grafos da disciplina e reconstrua o
        site; a página se preenche a partir de studies/results.json.
      </>
    ),
    graph: (n: string) => `Grafo ${n}`,
    representations: {
      adjacency_list: 'Lista de adjacência',
      adjacency_matrix: 'Matriz de adjacência',
      csr: 'CSR',
    },
    short: { adjacency_list: 'lista', adjacency_matrix: 'matriz', csr: 'CSR' },
    methods: {
      exact: 'Força bruta',
      i_fub: 'iFUB',
      bounds: 'Takes-Kosters',
      sweep: '4-sweep',
    },
    facts: {
      vertices: 'vértices',
      edges: 'arestas',
      degree: (min: string, max: string, mean: string, median: string) =>
        `grau de ${min} a ${max}, média ${mean}, mediana ${median}`,
      dropped: (loops: string, dups: string) => `${loops} laços, ${dups} duplicatas descartados`,
    },
    questions: {
      memory: {
        title: 'Memória por representação',
        needs: (bytes: string) => `precisaria de ${bytes}`,
      },
      bfs: { title: 'Tempo médio de uma BFS' },
      dfs: { title: 'Tempo médio de uma DFS' },
      parents: {
        title: 'Pais de 10, 20 e 30',
        root: (r: string) => `raiz ${r}`,
        vertex: (v: string) => `vértice ${v}`,
        level: 'nível',
        meanLevel: 'nível médio',
        reached: 'alcançado',
        unreached: 'outra componente',
      },
      distances: { title: 'Distâncias (10, 20), (10, 30), (20, 30)' },
      components: {
        title: 'Componentes conexas',
        unit: (n: number) => (n === 1 ? 'componente' : 'componentes'),
        largest: (n: string) => `maior ${n}`,
        smallest: (n: string) => `menor ${n}`,
        others: (n: string) => `${n} outras`,
      },
      diameter: {
        title: 'Diâmetro',
        bfs: (count: string) => `${count} BFS`,
        stopped: (elapsed: string) => `parou em ${elapsed}`,
        exact: 'exatos',
      },
    },
  },

  observatory: {
    diameterMethods: {
      Sweep: { label: '4-sweep', hint: 'quatro BFS, um limite' },
      IFub: { label: 'iFUB', hint: 'exato, menos BFS' },
      Bounds: { label: 'Takes–Kosters', hint: 'exato, por limites' },
      Exact: { label: 'Força bruta', hint: 'exato, uma BFS cada' },
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
    budgetHit: 'orçamento esgotado',
    bfsCount: (count: string) => `${count} BFS`,
    diameterExact: 'exato',
    diameterBound: 'limite inferior',
    diameterHint: 'Escolha um método e calcule o mais longo dos caminhos mínimos.',
    showDiameterPath: (from: string, to: string) => `Desenhar o caminho de ${from} até ${to}`,
    sample: 'Exemplo',
    sampleHint: '5 vértices · 5 arestas',
    openFile: 'Abrir um arquivo',
    openFileHint: '.txt · formato da disciplina',
    controlsTitle: 'Controles',
    sections: 'Seções',
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
            body: 'Laços descartados, arestas orientadas [min, max], ordenadas e sem duplicatas, e toda representação ganha linhas de vizinhos crescentes e árvores de busca idênticas. Os testes garantem.',
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
          { value: '4', label: 'layouts', hint: 'forças, radial, camadas, grau, morph na GPU' },
          { value: '0', label: 'servidores', hint: 'tudo calculado no cliente' },
        ],
        cta: 'Abrir o observatório',
        source: 'github.com/lkzppm/GraphMan',
      },
    },
  },
};
