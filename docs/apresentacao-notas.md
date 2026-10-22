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

# Parte 2: grafos com pesos (8 minutos)

Seis slides em `/presentation#part-2` (ou na capa, o seletor Parte 1 /
Parte 2; as teclas `1` e `2` também trocam). Tempos somam 7 min 30 s.

Antes de começar: abrir `graphman-ufrj.vercel.app/presentation#part-2`,
`F` para tela cheia, e uma segunda aba com `/observatory` para a demo
(o exemplo "com nomes" já vem no menu Exemplos; não precisa de arquivo).

## Slide 1, capa (20 s)

- "A Parte 2 entrou na mesma biblioteca: pesos, Dijkstra com vetor e com
  heap, e nomes de vértices." Só isso; o seletor mostra as duas partes.

## Slide 2, pesos (1 min 15 s)

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

## Slide 3, um Dijkstra, três fronteiras (1 min 45 s)

O coração da Parte 2: o enunciado pede para não escrever o Dijkstra duas
vezes.

- O código na tela é tudo: um trait `Frontier` com `decrease` e `pop_min`,
  e um `dijkstra_into` escrito uma vez. É a ideia da Parte 1 (a
  representação é uma estratégia) um nível abaixo.
- **Vetor**: o cursor varre tudo para achar o menor. `O(n²)`.
- **Heap com decrease-key**: o heap é nosso, com `position[v]`, então
  baixar a chave acha a entrada direto e ela sobe. É a "modificação
  eficiente de chave" que o enunciado cobra.
- **Heap lazy**: o `BinaryHeap` da biblioteca padrão, sem decrease-key;
  insere de novo e descarta a cópia velha. Está aí como régua.
- Fechar com a linha de baixo: empates vão para o menor vértice, então as
  três constroem **a mesma árvore**, e os testes exigem isso.

## Slide 4, vetor contra heap (1 min 45 s)

A tabela que o enunciado pede, em barras com escala log.

- **W3** (100 mil vértices): vetor 1,9 s, heap 39 ms, 48 vezes.
- **W4** (1 milhão): heap 0,4 s; o vetor leva 3 minutos por origem, então
  só 4 das 100 couberam no orçamento de 15 minutos, e a célula diz "4/100".
- **W5** (10 milhões): heap 5,9 s; nenhuma execução do vetor terminou. A
  barra tracejada é uma estimativa: a execução cortada fixou 390 mil
  vértices em 15 min, escalado dá 6,4 horas por origem, cerca de 3.900
  vezes o heap. Cem origens seriam 26 dias.
- A frase: "a razão cresce com n, como a análise prevê: n² contra
  (n + m) log n. E a gente mostra a célula honesta em vez de inventar um
  número", como as recusas de memória da matriz na Parte 1.
- O heap lazy fica 1,4 a 2,1 vezes atrás do heap indexado: é o que a
  decrease-key compra.

## Slide 5, caminhos mínimos (1 min 30 s)

- **À esquerda**, as distâncias de 10 até 20, 30, 40, 50 e 60 nos três
  grafos, com o número de arestas embaixo. Não ler: os caminhos inteiros
  estão no relatório e na aba de estudos de caso (clicar numa distância
  mostra o caminho).
- **À direita**, a rede de colaboração, a partir de Edsger W. Dijkstra.
  Peso pequeno é colaboração próxima. Ler um caminho em voz alta, o de
  Éva Tardos passa por Tarjan e Goldberg.
- **Turing: sem caminho.** A única aresta dele vai até um coautor que não
  tem outra; os dois formam uma componente própria, separada da componente
  gigante onde está Dijkstra. É uma resposta, não um erro.

## Slide 6, teste no seu navegador (1 min 15 s, mais a demo)

- O QR e a frase da Parte 1, e então a demo: Exemplos → "com nomes".
- Escolher Dijkstra, clicar num vértice (origem), **dois cliques** em
  outro (destino): o caminho aparece passo a passo, com o peso de cada
  aresta e os nomes, e as setas andam por ele.
- Se sobrar tempo: o seletor vetor / heap e a faixa de estruturas embaixo,
  que mostra o vetor sendo varrido e o heap sendo reordenado.
