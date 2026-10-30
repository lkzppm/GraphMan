# Roteiro da apresentação (8 minutos)

Notas de fala para os cinco slides de `/presentation`. O texto na tela é
pouco de propósito: o que está aqui é o que se fala, não o que se lê.
Tempos somam 7 min 30 s, deixando meio minuto de folga para o cronômetro.

Antes de começar: abrir `graphman-ufrj.vercel.app/presentation` no
computador da sala, apertar `F` para tela cheia, deixar uma segunda aba
com `/observatory` e o `grafo_1.txt` na área de trabalho para a demo.
Setas do teclado trocam de slide; voltar um slide reinicia a animação.

## Slide 1, capa (20 s)

- Deixar a marca terminar de se desenhar antes de falar (uns 2 s).
- Uma frase, já que o slide não a traz: "GraphMan é uma biblioteca de
  grafos em Rust; o mesmo código roda os estudos de caso na linha de
  comando e o observatório no navegador."
- Nomes da dupla, e só. A pilha embaixo não precisa ser lida.

## Slide 2, arquitetura (1 min 30 s)

Deixar o mapa se desenhar da esquerda para a direita e acompanhar com a fala.

- **Entrada**: o arquivo da disciplina, n na primeira linha, uma aresta
  por linha.
- **EdgeList**: a leitura normaliza uma vez só: descarta laços, orienta
  cada aresta como [menor, maior], ordena e remove duplicatas. Toda
  representação nasce dessa lista ordenada.
- **A biblioteca** (o crate Rust, ícone azul): três jeitos de guardar o
  mesmo grafo, desenhados como são. Lista de adjacência: um vetor por
  vértice. Matriz de bits: n² bits, simétrica. CSR: dois arrays, offsets
  sobre vizinhos. O usuário escolhe uma na borda, com um `match` só, e
  nada mais no código sabe qual foi escolhida.
- **Os algoritmos** (a linha embaixo): BFS, DFS, distância, componentes e
  diâmetro escritos uma vez sobre o trait `Graph`, cinco métodos, e
  monomorfizados pelo compilador: sem chamada virtual no laço interno.
  Trocar a representação não muda o resultado, só o custo. Os testes
  exigem árvores de busca idênticas nas três.
- **Duas pontas** (a seta bifurca): o binário com os estudos de caso e o
  crate wasm que vira o observatório. Mesma biblioteca, sem cópia.
- Fechar: "armazenamento é uma estratégia, não uma decisão da biblioteca".

## Slide 3, decisões (1 min 30 s)

Cinco figuras, cada uma roda sozinha. Uma frase por figura, na ordem em
que elas animam.

1. **Normalizar uma vez**: o laço e a aresta duplicada aparecem em cinza,
   são riscados e somem. É isso que garante a mesma árvore em toda
   representação.
2. **Buscas observáveis**: a BFS acende nível por nível até a barra cair.
   BFS e DFS reportam a um `Visitor` que pode parar a busca; `distance`
   é uma BFS que para no destino. A DFS é iterativa, memória proporcional
   à profundidade, não ao tamanho do grafo.
3. **Nada alocado duas vezes**: só as células que a busca tocou acendem, e
   só elas são limpas depois. Milhares de BFS do diâmetro não custam
   alocação nem limpeza O(n).
4. **Orçamento, não crash**: a barra da lista cabe, a da matriz passa da
   linha. Os construtores calculam os bytes antes de alocar: a matriz de
   375 mil vértices (17,6 GB) vira um erro tipado e uma célula na tabela,
   em vez de derrubar a máquina.
5. **Diâmetro de quatro jeitos**: as barras são as BFS que cada método
   gastou no grafo 4, em escala log. Força bruta roda uma BFS por vértice;
   iFUB e os limites de Takes-Kosters param quando o limite superior
   encontra o inferior; o 4-sweep dá o chute inicial com quatro BFS. Os
   grafos da disciplina são aleatórios, o pior caso para esses métodos,
   e os números estão aí como saíram.

## Slide 4, benchmark (1 min 30 s)

A tabela que o enunciado pede, em barras: três por medida, uma cor por
representação (lista azul, matriz azul-claro, CSR azul-escuro). Não ler
linha por linha: apontar três coisas e mandar para a aba de estudos de caso.

- **Memória**: a lista cresce com n + m; a matriz de bits estoura o
  orçamento a partir do grafo 3 (barra tracejada com o que ela precisaria:
  17,6 GB nos grafos 3 e 4, quase 3 TB nos grafos 5 e 6). CSR é a menor
  das três em todos os grafos.
- **Tempo**: média de 100 buscas de raízes distintas, sem leitura nem
  escrita. De 0,2 ms no grafo 1 a 0,3 s no grafo 6. A matriz é de 3 a 10
  vezes mais lenta onde cabe; CSR é a mais rápida, por localidade de
  cache. DFS é mais lenta que BFS na mesma representação, sobretudo nos
  grafos esparsos.
- **Componentes e diâmetro**: grafo 2 tem 10 componentes, os grafos 5 e 6
  têm 5 e guardam o diâmetro (59 e 19) na menor componente, o que o
  driver aproveita para podar as maiores.
- Fechar: "pais dos vértices 10, 20 e 30, distâncias entre os pares, cada
  método de diâmetro com tempo e contagem de BFS: está tudo desenhado na
  aba de estudos de caso e no relatório." Clicar no botão só se sobrar
  tempo.

## Slide 5, teste no seu navegador (1 min plus demo)

- "Tudo isso roda na sua aba: o mesmo crate Rust compilado para
  WebAssembly lê o arquivo e o WebGPU desenha."
- O QR leva à página inicial do site; de lá, a aba Observatório. Apontar
  o QR e pausar 10 s para a sala apontar a câmera. Avisar: o observatório
  precisa de Chrome, Edge, Safari 26 ou Firefox recente; muitos Android
  não expõem WebGPU e vão ver um aviso, o resto do site funciona.
- Com o tempo que sobrar, trocar de aba e soltar o `grafo_1.txt` no
  observatório: clicar num vértice roda uma BFS, arrastar move, o menu de
  layouts troca radial e camadas. Trinta segundos bastam.
- Última frase: "código e relatório estão no GitHub, o link está no rodapé
  do site."

## Plano B

- Sem internet na sala: o deck é uma página, então gerar um PDF na véspera
  com Imprimir no navegador em cada slide, ou levar o repositório no
  pendrive e rodar `pnpm run dev` localmente.
- Se o observatório não abrir no computador da sala (sem WebGPU), a demo
  passa a ser a página de estudos de caso, que não precisa de GPU.

---

# Parte 2: grafos com pesos (10 minutos)

Onze slides em `/presentation#part-2` (ou na capa, o seletor Parte 1 /
Parte 2; as teclas `1` e `2` também trocam). Tempos somam cerca de
9 min 30 s; se o tempo for de 8 minutos, encurtar os slides 4 (as seis
filas, só as três da disciplina) e 9 (nomes).

Antes de começar: abrir `graphman-ufrj.vercel.app/presentation#part-2`,
`F` para tela cheia, e uma segunda aba com `/observatory` para a demo
(o exemplo "com nomes" já vem no menu Exemplos; não precisa de arquivo).

## Slide 1, capa (20 s)

- "A Parte 2 entrou na mesma biblioteca: pesos, Dijkstra com seis filas de
  prioridade, e nomes de vértices." Só isso; o seletor mostra as duas partes.

## Slide 2, pesos (1 min)

Deixar a Figura 1 do enunciado virar os arrays da CSR.

- **A terceira coluna** é só uma coluna: o leitor decide na primeira
  aresta se o arquivo tem pesos, e toda linha tem que concordar.
- **Uma coluna ao lado**: os pesos são um vetor paralelo a `targets`, não
  pares misturados na adjacência. Consequência: BFS, DFS, componentes e
  diâmetro nunca leem os pesos e custam o mesmo que na Parte 1.
- **Duplicata fica com o menor peso**, o único que um caminho mínimo usaria.
- **A aresta `3 4 -9,5`** (destacada): o Dijkstra recusa com um erro
  tipado, "pesos negativos ainda não implementados", em vez de dar uma
  resposta errada. Nenhum grafo da disciplina tem peso negativo.

## Slide 3, um Dijkstra, escrito uma vez (45 s)

O coração da Parte 2: o enunciado pede para não escrever o Dijkstra duas
vezes.

- O código na tela é tudo: um trait `Frontier` com `decrease` e `pop_min`,
  e um `dijkstra_into` escrito uma vez. É a ideia da Parte 1 (a
  representação é uma estratégia) um nível abaixo.
- Empates vão para o menor vértice, então toda fila constrói **a mesma
  árvore**, e os testes exigem isso.

## Slide 4, seis filas de prioridade (1 min 15 s)

- **Vetor**: o cursor varre tudo para achar o menor. `O(n²)`.
- **Heap com decrease-key**: o heap é nosso, com `position[v]`, então
  baixar a chave acha a entrada em `O(1)` e ela sobe. É a dica do
  professor por e-mail: procurar o vértice dentro do heap anularia o heap.
- **Heap preguiçoso**: o `BinaryHeap` da biblioteca padrão, sem
  decrease-key. É exatamente a "saída fácil" do e-mail: insere de novo
  toda vez que a estimativa baixa, e na segunda vez que o vértice sai
  ele é pulado (o vetor de marcação é `latest[v]`). Está aí como régua.
- As três de baixo são as que vão mais rápido na prática: o heap 4-ário
  (metade dos níveis para subir), o pairing heap (corta e funde) e o
  radix heap (baldes pelos bits da distância, sem comparar chaves).

## Slide 5, o que cada fila guarda (1 min)

A resposta à pergunta do professor: "qual o preço da saída fácil?".

- As figuras estão em escala, um pixel por byte. Contorno: um array
  indexado por vértice. Preenchido: uma entrada da fila. Riscado: uma
  cópia velha. Tracejado: a folga que um vetor que cresce guarda.
- **Heap com decrease-key**: 4 bytes de `position` por vértice, e no
  máximo uma entrada (16 bytes) por vértice. O traço `n` nunca é cruzado.
- **Heap preguiçoso**: cada estimativa que baixa entra de novo, então ele
  pode ter uma entrada por relaxamento que melhora: até m, não n. O traço
  `n` é cruzado. Esse é o preço: memória `O(m)` em vez de `O(n)`, `log m`
  em cada operação em vez de `log n` (a mesma ordem, já que m ≤ n²), e
  as entradas velhas que saem só para serem jogadas fora.
- Vetor e pairing heap têm tamanho fixo (8 e 20 bytes por vértice). O
  radix heap insere de novo como o preguiçoso, e cada um dos seus baldes
  guarda o maior tamanho que já teve.

## Slide 6, vetor contra heap (1 min 30 s)

A tabela que o enunciado pede, em barras com escala log, agora com os
cinco grafos.

- **W3** (100 mil vértices): vetor 1,9 s, heap 35 ms, 53 vezes.
- **W4** (1 milhão): heap 0,43 s; o vetor leva 3 minutos por origem, então
  só 4 das 100 couberam no orçamento, e a célula diz "4/100".
- **W5** (10 milhões, 40 milhões de arestas): heap 4,9 s; nenhuma execução
  do vetor terminou. A barra tracejada é uma estimativa: a execução
  cortada fixou 390 mil vértices em 15 min, escalado dá 6,4 horas por
  origem.
- **W6** (10 milhões, 73 milhões de arestas): heap 5,8 s; vetor ≈ 7,4 h,
  cerca de 4.600 vezes o heap.
- **W7** (50 milhões, 60 milhões de arestas): heap 22,1 s, nas 100
  origens. O vetor fixou 33 mil vértices em 15 minutos: ≈ 16 dias por
  origem, umas 62.000 vezes o heap.
- A frase: "a razão cresce com n, como a análise prevê: n² contra
  (n + m) log n. E a gente mostra a célula honesta em vez de inventar um
  número", como as recusas de memória da matriz na Parte 1.
- O radix heap é o mais rápido em todos (2,7 s no W6, 8,7 s no W7). O heap
  preguiçoso fica 1,6 a 2,2 vezes atrás do indexado até o W6; no W7, que
  é esparso, ele empata (22,5 s contra 22,1 s).

## Slide 7, memória, medida (1 min)

Cinco execuções sem cronômetro por fila, com um invólucro (`Measured`)
que conta as entradas a cada `pop_min`; é uma fila também, então não há
um segundo Dijkstra.

- **Heap no pico**: o heap indexado chega a 95% de n no W3 e 92% no W4
  (grafos densos: quase todo vértice entra na fronteira logo), 61% no W5,
  75% no W6 e 14% no W7, que é esparso.
- **Preguiçoso ÷ heap**: o preguiçoso guarda 3,8 vezes as entradas do
  heap no W3, 3,3 no W4, 1,8 no W5, 2,1 no W6 e só 1,1 no W7. No W6
  são 16 milhões de entradas para 10 milhões de vértices: mais entradas
  que vértices.
- Em bytes, no W6 (como o slide mostra): heap 166 MB, preguiçoso 332 MB,
  radix 788 MB (os baldes). Para comparar, o próprio grafo ocupa 1,68 GB:
  a fila é pequena perto do grafo, mas a diferença entre as filas é de 2 a
  5 vezes.
- **No W7 a ordem se inverte.** Com 50 milhões de vértices e uma
  fronteira de só 14% de n, o que pesa é o que é fixo por vértice: o heap
  (319 MB, 4 bytes de `position` por vértice) fica menor que o vetor
  (382 MB, 8 bytes por vértice), o pairing heap vai a 954 MB e o radix a
  1 GB. E o preguiçoso, com só 10% a mais de entradas, quase não paga pela
  saída fácil: é por isso que no slide 6 ele empata com o heap no W7.

## Slide 8, caminhos mínimos (1 min)

- As distâncias de 10 até 20, 30, 40, 50 e 60 nos cinco grafos, com o
  número de arestas embaixo, e cada caminho desenhado em escala. Não ler:
  os caminhos inteiros estão no relatório e na aba de estudos de caso.

## Slide 9, nomes (40 s)

- O arquivo de nomes vira `VertexNames`: uma string só com todos os nomes,
  uma entrada por vértice com o seu trecho, e um índice ordenado por nome.
- `name(v)` e `vertex(nome)` são buscas binárias; sem tabela hash, 20
  bytes por nome além do texto. A busca da interface ignora caixa e
  acentos: "eva tardos" sugere Éva Tardos.

## Slide 10, a partir de Edsger W. Dijkstra (50 s)

- A rede de colaboração, a partir de Edsger W. Dijkstra. Peso pequeno é
  colaboração próxima. Ler um caminho em voz alta, o de Éva Tardos passa
  por Tarjan e Goldberg.
- **Turing: sem caminho.** A única aresta dele vai até um coautor que não
  tem outra; os dois formam uma componente própria, separada da componente
  gigante onde está Dijkstra. É uma resposta, não um erro.

## Slide 11, teste no seu navegador (1 min, mais a demo)

- O QR e a frase da Parte 1, e então a demo: Exemplos → "com nomes".
- Escolher Dijkstra, clicar num vértice (origem), **dois cliques** em
  outro (destino): o caminho aparece passo a passo, com o peso de cada
  aresta e os nomes, e as setas andam por ele.
- Se sobrar tempo: o seletor de filas e a faixa de estruturas embaixo,
  que mostra o vetor sendo varrido, o heap sendo reordenado e as cópias
  velhas do heap preguiçoso esperando para serem puladas.
