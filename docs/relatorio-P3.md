# GraphMan, Parte 3: grafos direcionados, Bellman-Ford e Floyd-Warshall

Lucas Pacheco e Rogério Santana · COS 242, Teoria dos Grafos, UFRJ, 2026/2.
Código: https://github.com/lkzppm/GraphMan · Site: https://graphman-ufrj.vercel.app
PDF entregue: [`COS242_2026-2_Trabalho-Parte-3-GraphMan.pdf`](COS242_2026-2_Trabalho-Parte-3-GraphMan.pdf)

A Parte 3 entrou na mesma biblioteca das Partes 1 e 2, sem um programa à
parte: o mesmo leitor de arquivos, as mesmas três representações (lista de
adjacência, matriz, CSR) e os mesmos algoritmos genéricos atendem aos grafos
direcionados. Cada algoritmo novo foi escrito uma única vez sobre uma
estratégia intercambiável, como o Dijkstra da Parte 2 sobre suas fronteiras:
a Parte 1 abstraiu o armazenamento, a Parte 2 a fronteira, e a Parte 3 a
**ordem**: qual vértice o Bellman-Ford examina em seguida (`Schedule`) e
como o Floyd-Warshall percorre sua tabela (`Sweep`). O design completo está
em `spec/PHASE3.md`.

## 1. Direção: um dado de leitura e um transposto

O parâmetro pedido pelo enunciado é a opção `--directed` (`-D`), aceita por
todo comando que lê um grafo; na biblioteca, é `Orientation::Directed`
passado à leitura, e no site, a chave "Direcionado". Cada linha `u v w` é o
arco de `u` para `v`. A normalização é a da Parte 2 sem a orientação
`[menor, maior]`: os arcos são ordenados por (origem, destino), um arco
repetido mantém o menor peso, e `(u, v)` e `(v, u)` são arcos distintos.
Um laço negativo não é descartado: é um ciclo negativo de um arco.

A direção é **um dado, não um tipo**:

- o trait `Graph` ganhou só `is_directed()`; `neighbors(v)` passa a
  significar os arcos que saem de `v`, e `AnyGraph` mantém três variantes,
  em vez de seis;
- para os arcos de entrada, cada representação ganhou `transpose()`, o mesmo
  tipo de grafo com os arcos invertidos (na CSR, uma ordenação por contagem
  pelo destino, `O(n + m)`, que já produz linhas crescentes);
- BFS, DFS e Dijkstra não foram reescritos: seguem `neighbors()`, agora os
  arcos de saída. Testes conferem o Dijkstra com o Bellman-Ford e com o
  `petgraph` em digrafos aleatórios, e um arco negativo continua recusado
  pelo Dijkstra, com uma mensagem que indica o Bellman-Ford.

## 2. Um Bellman-Ford, seis ordens

O enunciado pede a distância de todos os vértices **até** `t`. O
Bellman-Ford até `t` em `G` é o Bellman-Ford **a partir** de `t` em `Gᵀ`: o
transposto é construído uma vez, fora do tempo medido, e o pai de cada
vértice na árvore é o seu sucessor no caminho até `t`. O algoritmo é escrito
uma única vez, a partir de uma origem, sobre `Weighted`, e devolve a mesma
`ShortestPathTree` do Dijkstra.

Todas as variantes são o mesmo laço (tomar um vértice, relaxar seus arcos,
avisar quais vizinhos melhoraram); a estratégia `Schedule` (`reset`, `next`,
`lowered`) decide qual vértice vem a seguir e quando uma passada termina. As
duas otimizações discutidas em aula foram lidas como (1) parar quando uma
passada não altera nenhuma distância e (2) examinar, em cada passada, só os
vértices cuja distância mudou na anterior. A memória é `O(n)` em todas.

| Ordem | O que faz | Passadas, pior caso |
|---|---|---|
| `rounds` | todo vértice em toda passada, sem otimização | `n − 1` |
| `early-stop` | encerra após uma passada sem mudança (otimização 1) | `≤ n − 1` |
| `queue` | só os vértices que baixaram voltam à fila, sem duplicatas (otimizações 1 e 2); **usada nas respostas** | `≤ n − 1` |
| `yen` | vértices em ordem de número, cada passada sobe e depois desce | `≤ ⌈n/2⌉` |
| `random-yen` | Yen sobre uma ordem aleatória (Bannister e Eppstein) | `≈ n/3`, esperado |
| `slf` | a fila como deque: um vértice mais próximo que o da frente passa à frente (Bertsekas) | `O(nm)` no total |

**Ciclos negativos: um certificado, não um booleano.** Cada estimativa
guarda o número de arcos do passeio que a produziu; sem ciclo negativo,
toda estimativa é um caminho simples e esse número nunca chega a `n`. Como
esperar `n` arcos é lento quando o ciclo é curto, a cada `n` melhorias o laço
também procura um ciclo no grafo dos pais (busca amortizada de Cherkassky e
Goldberg, sem mudar o custo `O(nm)`); em `grafo_W_1`, a verificação do grafo
inteiro caiu de 18 s para 0,85 ms. O algoritmo devolve o próprio ciclo e seu
peso (`NegativeCycle`), lidos dos pais.

Um Bellman-Ford até `t` só enxerga os ciclos que alcançam `t`, que são os que
tornam as distâncias indefinidas; com `Start::Everywhere` (todo vértice em 0,
uma origem virtual), o mesmo laço responde se há ciclo negativo em qualquer
lugar. Os exemplos do repositório, também no observatório, mostram os dois
casos: em `samples/directed.txt`, `d(1, 10) = 2,25` pelo caminho
1 → 2 → 5 → 6 → 3 → 7 → 10, que usa o arco 6 → 3 de peso −2; em
`samples/directed_cycle.txt`, um arco 7 → 5 de peso −3 fecha o ciclo
3 → 7 → 5 → 6 → 3, de peso −3,75, devolvido por
`graphman bellman-ford --negative-cycle`.

## 3. Um Floyd-Warshall, uma tabela, quatro varreduras

A recorrência `Dₖ[i][j] = min(Dₖ₋₁[i][j], Dₖ₋₁[i][k] + Dₖ₋₁[k][j])` usa
`n + 1` tabelas. Como a rodada `k` não altera a linha `k` nem a coluna `k`
(salvo um ciclo negativo por `k`, que encerra a execução), a atualização é
feita **no lugar, em uma única tabela `n × n`**: essa é a otimização de
memória pedida. Os pais seguem a mesma regra (`parent[i][j] = parent[k][j]`),
então a linha `i` da tabela de pais é a árvore de caminhos mínimos a partir
de `i`. Um ciclo negativo aparece como `D[i][i] < 0`, verificado a cada
rodada, e é lido dos pais e devolvido.

A tabela custa 12 bytes por célula (8 da distância, 4 do pai) e é orçada
antes da alocação, como a matriz da Parte 1: 7,5 GB com 25 mil vértices; com
100 mil, 120 GB, e é recusada com um erro tipado.

A ordem de percurso é a estratégia `Sweep`: a biblioteca faz cada atualização
(um laço sem desvios, vetorizado), e a varredura só escolhe linhas, blocos,
ordem e núcleos. Há quatro: **simples**, **podada** (pula a linha `i` quando
`D[i][k] = ∞`), **paralela** (as linhas de uma rodada são independentes) e
**em blocos** (para caber no cache). Todas dão as mesmas distâncias,
conferidas por `check_sweep`. Em `samples/directed.txt`, a direção aparece
na tabela: `d(1, 4) = 1,25`, mas `d(4, 1) = 4`.

**Além do enunciado.** O algoritmo de Johnson reúne as três partes: um
Bellman-Ford dá potenciais `h`, a visão `Reweighted` dá pesos
`w(u, v) + h(u) − h(v) ≥ 0` sem copiar o grafo, e `n` Dijkstras sobre
qualquer fronteira da Parte 2 dão todos os pares. Também há componentes
fortemente conexas (Tarjan iterativo), condensação e caminho mínimo em DAG.

## 4. Estudos de caso

Apple M5 (macOS, aarch64, 10 threads, 16 GB), representação CSR, `graphman study --directed`.
Os tempos medem só o algoritmo: sem leitura, sem a construção do transposto e sem escrita.
Resultados brutos em `studies/directed/results.json`.

| Grafo | Vértices | Arcos | Pesos | Arcos negativos | Ciclo negativo no grafo |
|---|---:|---:|---|---:|---|
| grafo_W_1 | 25.000 | 549.953 | −5 a 10 | 4.998 | sim, 10 → 11278 → 10 (peso −2,00) |
| grafo_W_2 | 25.000 | 824.964 | 0 a 10 | 0 | não |
| grafo_W_3 | 100.000 | 6.099.941 | 0 a 10 | 0 | não |
| grafo_W_4 | 1.000.000 | 30.999.978 | 0 a 10 | 0 | não |
| grafo_W_5 | 10.000.000 | 39.999.995 | 0 a 10 | 0 | não |

`grafo_W_3` a `grafo_W_5` são os arquivos da Parte 2 lidos como direcionados: os 73, 34 e 4
arcos a mais são as linhas que a Parte 2 descartava como repetidas, pares (u, v) e (v, u).

### 4.1 Bellman-Ford: distância até o vértice 100

Um único Bellman-Ford com fila a partir de 100 no transposto. Entre parênteses, o número de arcos.

| Grafo | de 10 | de 20 | de 30 | Passadas da fila |
|---|---:|---:|---:|---:|
| grafo_W_1 | sem resposta: o ciclo negativo 10659 → 14329 → 10659 (peso −1,77) alcança o vértice 100 | | | 4 |
| grafo_W_2 | 10,47 (11) | 8,48 (6) | 8,71 (11) | 24 |
| grafo_W_3 | 4,63 (8) | 5,42 (8) | 4,67 (7) | 25 |
| grafo_W_4 | 9,04 (13) | 8,83 (11) | 9,23 (14) | 36 |
| grafo_W_5 | 37,85 (22) | 42,63 (22) | 37,86 (30) | 42 |

- grafo_W_2, 10 até 100: 10 → 22754 → 23713 → 20821 → 23161 → 3591 → 7214 → 4808 → 7704 → 10831 → 14144 → 100
- grafo_W_2, 20 até 100: 20 → 6795 → 7737 → 11988 → 7094 → 14144 → 100
- grafo_W_2, 30 até 100: 30 → 23783 → 439 → 502 → 7344 → 7842 → 10419 → 12598 → 13685 → 17695 → 14144 → 100
- grafo_W_3, 10 até 100: 10 → 2858 → 9370 → 31488 → 43785 → 48833 → 70398 → 74552 → 100
- grafo_W_3, 20 até 100: 20 → 2526 → 8495 → 13021 → 15939 → 20244 → 36899 → 74552 → 100
- grafo_W_3, 30 até 100: 30 → 29698 → 43059 → 43482 → 35741 → 74494 → 74552 → 100
- grafo_W_4, 10 até 100: 10 → 91829 → 417272 → 775161 → 842600 → 906821 → 930962 → 994427 → 321645 → 620573 → 21519 → 43375 → 351045 → 100
- grafo_W_4, 20 até 100: 20 → 775000 → 859374 → 148050 → 161821 → 274264 → 315038 → 749181 → 51701 → 83053 → 351045 → 100
- grafo_W_4, 30 até 100: 30 → 124400 → 225008 → 352692 → 424754 → 485462 → 502763 → 926624 → 80691 → 571210 → 620573 → 21519 → 43375 → 351045 → 100
- grafo_W_5, 10 até 100: 10 → 8226464 → 8398644 → 9402245 → 9739987 → 937849 → 597353 → 2241769 → 3118871 → 5374339 → 319782 → 1409550 → 8063679 → 4187984 → 8322144 → 7915275 → 1116679 → 8592040 → 9168609 → 1011134 → 617312 → 4484876 → 100
- grafo_W_5, 20 até 100: 20 → 8885874 → 9172974 → 190993 → 901806 → 2122291 → 7949832 → 4297068 → 9799215 → 4313 → 6690018 → 2041796 → 8483311 → 4418352 → 4580063 → 8048493 → 5653904 → 8592040 → 9168609 → 1011134 → 617312 → 4484876 → 100
- grafo_W_5, 30 até 100: 30 → 792746 → 8357921 → 3360862 → 7413679 → 787170 → 3097792 → 4607918 → 7198627 → 9170278 → 9726068 → 2117603 → 4473017 → 7399377 → 1303598 → 5096941 → 9492473 → 2243408 → 3162255 → 9430472 → 706910 → 7918231 → 9767508 → 600132 → 2212225 → 6106658 → 9336327 → 69858 → 617312 → 4484876 → 100

### 4.2 Floyd-Warshall: distâncias entre os pares de {10, 20, 30, 40, 50}

Da linha para a coluna. Quando a tabela n × n não cabe na memória, ela é recusada antes da
alocação e as mesmas linhas vêm de um Bellman-Ford a partir de cada vértice.

**grafo_W_1**: sem resposta; o Floyd-Warshall encontra o ciclo negativo 2 → 17332 → 2 (peso −0,55).

**grafo_W_2** · Floyd-Warshall, tabela de 7,5 GB

| de \ para | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 11,73 | 8,14 | 9,49 | 7,08 |
| **20** | 3,84 | 0 | 7,03 | 8,30 | 4,70 |
| **30** | 5,79 | 12,55 | 0 | 8,30 | 6,33 |
| **40** | 5,05 | 12,32 | 5,36 | 0 | 5,71 |
| **50** | 4,48 | 12,23 | 7,79 | 8,26 | 0 |

**grafo_W_3** · Floyd-Warshall recusado (120 GB): um Bellman-Ford por linha

| de \ para | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 4,99 | 5,71 | 7,49 | 4,31 |
| **20** | 3,48 | 0 | 6,19 | 8,27 | 4,32 |
| **30** | 3,96 | 5,80 | 0 | 8,30 | 3,17 |
| **40** | 3,58 | 5,59 | 6,10 | 0 | 3,84 |
| **50** | 3,25 | 5,41 | 6,12 | 8,10 | 0 |

**grafo_W_4** · Floyd-Warshall recusado (12 TB): um Bellman-Ford por linha

| de \ para | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 10,52 | 10,15 | 10,69 | 8,24 |
| **20** | 7,79 | 0 | 9,19 | 9,67 | 7,58 |
| **30** | 7,61 | 10,25 | 0 | 8,77 | 6,55 |
| **40** | 7,94 | 8,65 | 9,22 | 0 | 7,75 |
| **50** | 7,99 | 11,41 | 8,80 | 8,55 | 0 |

**grafo_W_5** · Floyd-Warshall recusado (1,2 PB): um Bellman-Ford por linha

| de \ para | 10 | 20 | 30 | 40 | 50 |
|---:|---:|---:|---:|---:|---:|
| **10** | 0 | 40,20 | 39,56 | 41,55 | 44,91 |
| **20** | 39,17 | 0 | 39,98 | 49,82 | 45,16 |
| **30** | 34,46 | 42,64 | 0 | 47,04 | 43,85 |
| **40** | 38,73 | 43,91 | 47,30 | 0 | 45,24 |
| **50** | 44,06 | 40,62 | 45,25 | 49,11 | 0 |

### 4.3 Tempo médio de cada algoritmo

Média de 10 execuções, em segundos, com orçamento de 600 s por célula.

| Algoritmo | Variante | grafo_W_1 | grafo_W_2 | grafo_W_3 | grafo_W_4 | grafo_W_5 |
|---|---|---:|---:|---:|---:|---:|
| bellman-ford | n − 1 rodadas | 0,000316 * | 15,3 | 466 § | ≈ 31.793 † | ≈ 2,42 × 10^6 † |
| bellman-ford | parada antecipada | 0,000328 * | 0,0113 | 0,100 | 0,976 | 7,59 |
| bellman-ford | fila | 0,000255 * | 0,00525 | 0,0618 | 0,724 | 4,52 |
| bellman-ford | Yen | 0,000243 * | 0,00512 | 0,0306 | 0,427 | 4,28 |
| bellman-ford | Yen aleatório | 0,000273 * | 0,00732 | 0,0785 | 0,986 | 7,17 |
| bellman-ford | SLF | 0,0000678 * | 0,00426 | 0,0484 | 0,545 | 3,97 |
| floyd-warshall | simples | 0,786 * | ≈ 5.516 † | ≈ 400.598 ‡ | ≈ 3,94 × 10^8 ‡ | ≈ 3,71 × 10^11 ‡ |
| floyd-warshall | podada | 0,315 * | ≈ 1.611 † | ≈ 396.270 ‡ | ≈ 3,75 × 10^8 ‡ | ≈ 2,07 × 10^11 ‡ |
| floyd-warshall | paralela (10 núcleos) | 0,311 * | ≈ 1.152 † | ≈ 111.764 ‡ | ≈ 1,11 × 10^8 ‡ | ≈ 8,19 × 10^10 ‡ |
| floyd-warshall | em blocos | 0,553 * | ≈ 1.537 † | ≈ 524.729 ‡ | ≈ 5,15 × 10^8 ‡ | ≈ 3,07 × 10^11 ‡ |
| bfs | BFS | 0,000672 | 0,000738 | 0,00550 | 0,0853 | 0,587 |
| dfs | DFS | 0,00141 | 0,00185 | 0,0134 | 0,155 | 1,61 |
| dijkstra | Dijkstra (heap) | recusado | 0,00334 | 0,0242 | 0,291 | 4,08 |

\* parou num ciclo negativo (é o tempo para encontrá-lo). § só parte das 10 execuções coube no
orçamento. † o orçamento interrompeu a execução e o tempo foi extrapolado do seu ritmo. ‡ a tabela
não cabe na memória: um digrafo aleatório de 1.024 vértices com o mesmo grau de saída foi medido e
escalado por (n / 1.024)³.

### 4.4 Todos os pares: Bellman-Ford contra Floyd-Warshall

Média de 10 rodadas completas, orçamento de 900 s por célula (escalado para os n alvos).
`c` é o número médio de varreduras por vértice em cada Bellman-Ford.

| Grafo | n × Bellman-Ford (fila) | Floyd-Warshall (podada) | Floyd-Warshall (paralela) | n × Dijkstra | Johnson | Mais rápido | c |
|---|---:|---:|---:|---:|---:|---|---:|
| grafo_W_1 | 7,56 s * | 315 ms * | 311 ms * | recusado | 653 µs * | ciclo nos dois | · |
| grafo_W_2 | 2,25 min § | ≈ 26,8 min † | ≈ 19,2 min † | 81,4 s | 89,7 s | BF, 11,9× | 3,24 |
| grafo_W_3 | ≈ 107 min † | ≈ 4,6 dias ‡ | ≈ 31,0 h ‡ | ≈ 39,0 min † | ≈ 45,7 min † | BF, 61,7× | 3,88 |
| grafo_W_4 | ≈ 11,5 dias † | ≈ 4.337 dias ‡ | ≈ 1.287 dias ‡ | ≈ 4,7 dias † | ≈ 5,7 dias † | BF, 375,6× | 3,96 |
| grafo_W_5 | ≈ 565 dias † | ≈ 6.546 anos ‡ | ≈ 2.596 anos ‡ | ≈ 536 dias † | ≈ 548 dias † | BF, 4.232,2× | 2,74 |

Os `n` Bellman-Fords foram mais eficientes. Em `grafo_W_2`, o único em que as
duas abordagens têm resposta e a tabela cabe na memória, foram 11,9 vezes
mais rápidos: 135 s contra cerca de 27 min do Floyd-Warshall podado (19 min
com os 10 núcleos); nos maiores, a vantagem estimada cresce para 62, 376 e
4.232 vezes. O motivo é a esparsidade: o Floyd-Warshall faz `n³`
atualizações, sejam quais forem os arcos (1,6 × 10¹³ em `grafo_W_2`),
enquanto `n` Bellman-Fords com fila examinam cerca de `n · c · m` arcos, com
`c` entre 2,7 e 4,0: 6,7 × 10¹⁰ em `grafo_W_2`, cerca de 230 vezes menos. A
vantagem medida é menor porque o laço do Floyd-Warshall é vetorizado e
favorável ao cache; num grafo denso, com `m` próximo de `n²`, a relação se
inverteria. Em `grafo_W_1`, não há distância a comparar: o Floyd-Warshall
acha o ciclo 2 → 17332 → 2 nas primeiras rodadas (0,31 s), e cada um dos 25
mil Bellman-Fords precisa achar de novo um ciclo que alcance o seu alvo
(7,6 s).

## 5. Conclusão

A direção entrou como um dado de leitura e um transposto, sem reescrever as
buscas, e o Bellman-Ford e o Floyd-Warshall foram escritos uma única vez
sobre ordens e varreduras intercambiáveis, devolvendo ciclos negativos como
certificados. As otimizações levam o Bellman-Ford de dias a segundos (cerca
de 28 dias contra 4,5 s em `grafo_W_5`), e, nos grafos esparsos da
disciplina, `n` Bellman-Fords custam muito menos que as `n³` atualizações do
Floyd-Warshall, cuja tabela não cabe na memória a partir de 100 mil
vértices.
