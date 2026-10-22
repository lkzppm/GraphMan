# GraphMan, Parte 2: grafos com pesos e Dijkstra

Lucas Pacheco e Rogério Santana · COS 242, Teoria dos Grafos, UFRJ, 2026/2.
Código: https://github.com/lkzppm/GraphMan · Site: https://graphman-ufrj.vercel.app

A Parte 2 entrou na mesma biblioteca da Parte 1, sem um programa à parte:
o mesmo leitor de arquivos, as mesmas três representações (lista de
adjacência, matriz, CSR) e os mesmos algoritmos genéricos. Este relatório
descreve as decisões de projeto, a implementação do Dijkstra com vetor e
com heap, a leitura dos nomes de vértices e os resultados dos estudos de
caso.

## 1. Pesos: uma coluna ao lado da adjacência

O peso é um `f64` (`Weight`). Um arquivo com pesos é só um arquivo com uma
terceira coluna: a primeira aresta decide se o arquivo tem duas ou três
colunas, e toda linha seguinte precisa ter o mesmo número (um arquivo
misturado é um erro de leitura, não um palpite). Pesos `NaN` ou infinitos
são recusados na leitura.

A normalização é a da Parte 1 aplicada a triplas `(u, v, peso)`: laços
descartados, cada aresta orientada como `[menor, maior]`, ordenação e
remoção de duplicatas. **Uma aresta repetida fica com o menor peso**, o
único que um caminho mínimo usaria. Nos arquivos da disciplina isso
removeu 73, 34 e 4 linhas repetidas em `grafo_W_3`, `grafo_W_4` e
`grafo_W_5`.

Os pesos ficam **ao lado** da estrutura, nunca dentro dela: a CSR ganha um
vetor `weights` paralelo a `targets`, a lista ganha uma linha de pesos
paralela a cada linha de vizinhos, e a matriz guarda uma tabela de pesos ao
lado do seu bitset. Com isso:

- o trait `Graph` da Parte 1 não lê a coluna, então BFS, DFS, componentes e
  diâmetro custam exatamente o que custavam;
- um trait novo, `Weighted: Graph`, devolve pares `(vizinho, peso)`; um grafo
  sem pesos responde peso 1 para toda aresta, então o Dijkstra roda em
  qualquer grafo e, sem pesos, devolve os níveis da BFS (um teste confere);
- um grafo sem pesos não guarda pesos.

**Pesos negativos.** A primeira aresta negativa é encontrada durante a
normalização e guardada, então a recusa custa `O(1)`: o Dijkstra devolve o
erro `NegativeWeight`, cuja mensagem termina em "shortest paths with
negative weights are not implemented yet" (no site, em português), como
pede o enunciado. Num grafo
não direcionado, uma aresta negativa `{u, v}` já torna o passeio
`u v u v ...` tão curto quanto se queira, então não existe resposta a dar.
Pesos zero são aceitos: o Dijkstra só precisa de pesos não negativos.
Nenhum arquivo da disciplina tem peso negativo; a recusa aparece na Figura 1
do enunciado (aresta `3 4 -9.5`) e nos testes.

## 2. Um Dijkstra, três fronteiras

O enunciado pede o Dijkstra com vetor e com heap sem escrever o algoritmo
duas vezes. A resposta é a mesma ideia da Parte 1 (a representação é uma
estratégia) um nível abaixo: o algoritmo é escrito uma vez, e o modo de
guardar as estimativas é um trait.

```rust
pub trait Frontier {
    fn reset(&mut self, vertex_count: usize);
    fn decrease(&mut self, v: Vertex, distance: Weight); // insere ou diminui
    fn pop_min(&mut self) -> Option<(Vertex, Weight)>;   // menor, depois menor id
}

pub fn dijkstra_into<G: Weighted, F: Frontier, V: Visitor>(
    graph: &G, root: Vertex, frontier: &mut F,
    tree: &mut ShortestPathTree, visitor: &mut V,
) -> Result<(), NegativeWeight>;
```

O compilador gera uma cópia do laço para cada par (representação,
fronteira), sem chamada virtual no laço interno. As fronteiras são:

| Fronteira | Como guarda as estimativas | Custo de uma execução |
|---|---|---|
| `VectorFrontier` | um vetor `estimativa[v]`; `pop_min` percorre os `n` | `O(n² + m)` |
| `HeapFrontier` | heap binário indexado, escrito por nós: `position[v]` acha a entrada, que sobe no heap | `O((n + m) log n)` |
| `LazyHeapFrontier` | `BinaryHeap` da biblioteca padrão, sem decrease-key: insere de novo e descarta a cópia velha | `O(m log m)` |

O `HeapFrontier` é a "modificação eficiente de chave" que o enunciado
pede: sem `position[v]`, diminuir a chave de um vértice exigiria procurá-lo
no heap. O `LazyHeapFrontier` é a régua que mostra o que a decrease-key
compra. O vetor percorre as estimativas com oito mínimos parciais
independentes, que o compilador transforma em comparações SIMD; continua
sendo a varredura linear completa que o enunciado descreve.

**Determinismo.** A relaxação é estrita e toda fronteira desempata pelo
menor vértice, então as três fixam os vértices na mesma ordem e constroem
**a mesma árvore**, não só as mesmas distâncias, em qualquer representação.
Os testes exigem isso em grafos aleatórios com pesos inteiros pequenos
(muitos empates) e conferem cada distância com um Bellman-Ford escrito no
próprio teste.

**Saída.** `ShortestPathTree` guarda distância e pai de cada vértice (a
árvore geradora induzida pela busca, gravada em arquivo `vértice pai
distância` por linha) e reconstrói o caminho até qualquer vértice. Para as
`k` execuções do estudo, a fronteira e a árvore são alocadas uma vez e cada
execução limpa só o que a anterior tocou.

## 3. Nomes de vértices

A rede de colaboração vem com um arquivo separado de nomes,
`rede_colaboracao_vertices.txt`, uma linha `índice,nome` por vértice, em
UTF-8. `VertexNames` lê esse formato (aceita também ponto e vírgula,
tabulação ou espaço, pula um cabeçalho e aceita Latin-1 quando o arquivo
não é UTF-8), guarda todos os nomes num único `String` e uma lista ordenada
por nome para busca exata por busca binária. A linha de comando aceita
nomes onde aceita vértices (`--from "Edsger W. Dijkstra"`), e um nome quase
certo lista os mais próximos ("você quis dizer"), sem diferenciar acentos
nem maiúsculas na sugestão. A busca da resposta, porém, é exata, como pede
o enunciado.

## 4. Estudos de caso

Máquina: Apple M5, 16 GB de memória, macOS. Tempos medem só o algoritmo, sem leitura do arquivo
nem escrita de resultados. Todas as execuções usam a CSR.

| Grafo | Vértices | Arestas | Pesos | Duplicatas descartadas |
|---|---:|---:|---|---:|
| W3 | 100.000 | 6.099.868 | 0 a 10 | 73 |
| W4 | 1.000.000 | 30.999.944 | 0 a 10 | 34 |
| W5 | 10.000.000 | 39.999.991 | 0 a 10 | 4 |
| rede de colaboração | 722.385 | 2.272.543 | 0,004 a 113 | 0 |

### 4.1 Distância e caminho mínimo a partir do vértice 10

| Grafo | até 20 | até 30 | até 40 | até 50 | até 60 |
|---|---:|---:|---:|---:|---:|
| W3 | 0,8 (18) | 0,89 (14) | 0,84 (10) | 0,87 (9) | 0,97 (16) |
| W4 | 2,66 (13) | 2,02 (17) | 2,52 (15) | 2,69 (18) | 2,41 (19) |
| W5 | 17,34 (13) | 17,24 (18) | 17,37 (14) | 15,43 (12) | 17,99 (22) |

Entre parênteses, o número de arestas do caminho. Os caminhos:

- W3, 10 até 20: 10 → 2858 → 35293 → 3905 → 24445 → 39345 → 61279 → 41321 → 70540 → 26049 → 84450 → 68904 → 87862 → 86778 → 27694 → 16608 → 86355 → 15760 → 20
- W3, 10 até 30: 10 → 2858 → 35293 → 96094 → 85187 → 53177 → 64898 → 87087 → 77935 → 42304 → 78071 → 93985 → 27642 → 26151 → 30
- W3, 10 até 40: 10 → 2858 → 35293 → 3905 → 24445 → 86286 → 14327 → 19697 → 15930 → 46307 → 40
- W3, 10 até 50: 10 → 56663 → 84437 → 19040 → 82510 → 17622 → 94992 → 70948 → 19878 → 50
- W3, 10 até 60: 10 → 2858 → 35293 → 3905 → 24445 → 89584 → 2874 → 99253 → 66532 → 33719 → 96654 → 75728 → 79865 → 74717 → 59399 → 8718 → 60
- W4, 10 até 20: 10 → 532245 → 877016 → 554617 → 430107 → 437166 → 805646 → 841402 → 663364 → 655748 → 634947 → 318070 → 807260 → 20
- W4, 10 até 30: 10 → 873980 → 182382 → 261305 → 81769 → 694525 → 219466 → 207765 → 44636 → 183747 → 920911 → 35338 → 239369 → 417194 → 132461 → 740528 → 707581 → 30
- W4, 10 até 40: 10 → 873980 → 182382 → 674971 → 557022 → 188455 → 418550 → 275098 → 277633 → 801708 → 730863 → 274827 → 386086 → 188007 → 477496 → 40
- W4, 10 até 50: 10 → 873980 → 182382 → 261305 → 81769 → 694525 → 382144 → 748624 → 663332 → 149827 → 349584 → 735867 → 9905 → 716970 → 472621 → 407659 → 994210 → 630598 → 50
- W4, 10 até 60: 10 → 873980 → 182382 → 674971 → 106317 → 27985 → 280367 → 227336 → 364950 → 883474 → 283156 → 161217 → 224210 → 188021 → 614364 → 358029 → 855615 → 822462 → 774634 → 60
- W5, 10 até 20: 10 → 7622850 → 4615833 → 6528266 → 1295458 → 7103730 → 8790605 → 7788327 → 6766415 → 7155379 → 2031914 → 3908338 → 8885874 → 20
- W5, 10 até 30: 10 → 2846336 → 5413988 → 202621 → 9270546 → 6836812 → 2983314 → 8775277 → 5549785 → 3485759 → 4341576 → 8868678 → 3166991 → 5117196 → 7291082 → 1816279 → 5664093 → 8947758 → 30
- W5, 10 até 40: 10 → 1299954 → 1419794 → 9885733 → 5641294 → 409605 → 4105715 → 660832 → 5850281 → 3215052 → 7676193 → 9008138 → 4846487 → 9798152 → 40
- W5, 10 até 50: 10 → 1299954 → 9927727 → 8451042 → 5368621 → 4276332 → 3716282 → 3724752 → 700154 → 9271362 → 6416250 → 396789 → 50
- W5, 10 até 60: 10 → 1299954 → 1419794 → 1899178 → 7524819 → 757290 → 9445351 → 9611705 → 9104671 → 8941517 → 264365 → 3945175 → 3090234 → 2071841 → 8424191 → 2860740 → 1175531 → 1925405 → 7718765 → 3193827 → 7824884 → 1454010 → 60

### 4.2 Tempo médio de um Dijkstra, vetor e heap

`k = 100` origens aleatórias por grafo (as mesmas para as três
fronteiras), cada execução da origem a todos os vértices.

| Grafo | Vetor | Heap | Heap lazy | Vetor / heap |
|---|---:|---:|---:|---:|
| W3 | 1,86 s | 39,1 ms | 56,3 ms | 48× |
| W4 | 3,1 min (4 de 100) | 416,6 ms | 893,6 ms | 442× |
| W5 | ≈ 6,4 h (estimativa) | 5,92 s | 8,78 s | 3.903× |

Cada fronteira tem um orçamento de 900 s por grafo. O vetor é `O(n²)` por execução: quando o orçamento acaba, a célula traz quantas execuções terminaram ("k de 100"), e quando nenhuma terminou, a execução interrompida é escalada para a componente inteira da origem ("estimativa"), o que é quase exato para o vetor, cujo passo sempre percorre os `n` vértices. É o mesmo tratamento honesto das recusas de memória da matriz na Parte 1: uma célula marcada, não um número inventado.

Em `W5`, a execução do vetor interrompida aos 900 s tinha fixado 389.888 dos 10 milhões de vértices; escalada para o grafo inteiro, dá cerca de 6,4 horas por origem, e 100 origens levariam mais de 26 dias. Em `W4`, 4 execuções completas couberam no orçamento, cerca de 3,1 minutos cada. O heap lazy (sem decrease-key) foi medido como referência: fica entre 1,4 e 2,1 vezes o tempo do heap indexado.

### 4.3 Rede de colaboração

A partir de Edsger W. Dijkstra (vértice 2722). O peso de uma aresta é
inversamente proporcional ao número de artigos em coautoria, então peso
pequeno é colaboração próxima.

| Até | Distância | Caminho |
|---|---:|---|
| Alan M. Turing | ∞ | sem caminho |
| J. B. Kruskal | 3,48 | Edsger W. Dijkstra → John R. Rice → Dan C. Marinescu → Howard Jay Siegel → Edwin K. P. Chong → Ness B. Shroff → R. Srikant → Albert G. Greenberg → J. B. Kruskal |
| Jon M. Kleinberg | 2,707 | Edsger W. Dijkstra → A. J. M. van Gasteren → Gerard Tel → Hans L. Bodlaender → Dimitrios M. Thilikos → Prabhakar Ragde → Avi Wigderson → Eli Upfal → Prabhakar Raghavan → Jon M. Kleinberg |
| Éva Tardos | 2,754 | Edsger W. Dijkstra → A. J. M. van Gasteren → Gerard Tel → Hans L. Bodlaender → Jan van Leeuwen → Mark H. Overmars → Micha Sharir → Haim Kaplan → Robert Endre Tarjan → Andrew V. Goldberg → Serge A. Plotkin → Éva Tardos |
| Daniel R. Figueiredo | 2,943 | Edsger W. Dijkstra → John R. Rice → Dan C. Marinescu → Chuang Lin → Bo Li → Y. Thomas Hou → Zhi-Li Zhang → Donald F. Towsley → Daniel R. Figueiredo |

Alan M. Turing (vértice 11365) não é alcançável: sua única aresta vai até o vértice 717737, que não tem outra. Os dois formam uma componente própria, uma das 77.486 da rede (a maior tem 576.309 pesquisadores, e Dijkstra está nela). A resposta certa é "sem caminho", não uma distância.

## 5. Conclusão

Os pesos entraram como uma coluna ao lado das estruturas da Parte 1, sem
mudar o custo de nada que já existia, e o Dijkstra foi escrito uma vez
sobre o trait `Frontier`, com três fronteiras que constroem a mesma árvore.
Os números confirmam a análise: o vetor cresce com `n²` e o heap com
`(n + m) log n`, e a distância entre eles vai de dezenas de vezes no grafo
de 100 mil vértices a cerca de 3.900 vezes no de 10 milhões. A
decrease-key do heap indexado o deixa 1,4 a 2,1 vezes mais rápido que o
heap lazy, que insere de novo em vez de atualizar. A Parte 3 deve
acrescentar direção e fluxos sobre o mesmo núcleo: um trait `Directed` ao lado de `Weighted`, sem reescrever os
algoritmos.
