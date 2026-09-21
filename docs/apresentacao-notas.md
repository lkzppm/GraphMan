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
- Uma frase: "GraphMan é uma biblioteca de grafos em Rust que mede a si
  mesma: o mesmo código roda os estudos de caso na linha de comando e o
  observatório no navegador."
- Nomes da dupla, e só. A pilha embaixo não precisa ser lida.

## Slide 2, arquitetura (1 min 30 s)

Deixar o mapa se desenhar da esquerda para a direita e acompanhar com a fala.

- **Entrada**: o arquivo da disciplina, n na primeira linha, uma aresta
  por linha.
- **EdgeList**: a leitura normaliza uma vez só: descarta laços, orienta
  cada aresta como [menor, maior], ordena e remove duplicatas. Toda
  representação nasce dessa lista ordenada.
- **trait Graph**: cinco métodos. É a única coisa que um algoritmo conhece.
- **Três representações** implementam o trait: lista de adjacência,
  matriz de bits, CSR (dois arrays). O usuário escolhe uma na borda, com
  um `match` só, e nada mais no código sabe qual foi escolhida.
- **Algoritmos escritos uma vez**, genéricos sobre o trait, e
  monomorfizados pelo compilador: sem chamada virtual no laço interno.
  Trocar a representação não muda o resultado, só o custo. Os testes
  exigem árvores de busca idênticas nas três.
- **Duas pontas**: o binário com os estudos de caso e o crate wasm que
  vira o observatório. Mesma biblioteca, sem cópia.
- Fechar com a legenda: "armazenamento é uma estratégia".

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

## Slide 4, estudos de caso (1 min 30 s)

A tabela que o enunciado pede, em barras. Não ler linha por linha: apontar
três coisas e mandar para a aba de estudos de caso.

- **Memória**: a lista cresce com n + m; a matriz de bits estoura o
  orçamento a partir do grafo 3 (barra tracejada com o que ela precisaria:
  17,6 GB nos grafos 3 e 4, quase 3 TB nos grafos 5 e 6).
- **Tempo**: média de 100 buscas de raízes distintas na lista, sem leitura
  nem escrita. De 0,4 ms no grafo 1 a 0,2 s no grafo 6. DFS é mais lenta
  que BFS na mesma representação, sobretudo nos grafos esparsos.
- **Componentes e diâmetro**: grafo 2 tem 10 componentes, os grafos 5 e 6
  têm 5 e guardam o diâmetro (59 e 19) na menor componente, o que o
  driver aproveita para podar as maiores.
- Fechar: "pais dos vértices 10, 20 e 30, distâncias entre os pares, cada
  método de diâmetro com tempo e contagem de BFS: está tudo desenhado na
  aba de estudos de caso e no relatório." Clicar no botão só se sobrar
  tempo.

## Slide 5, experimente (1 min plus demo)

- "Tudo isso roda na sua aba: o mesmo crate Rust compilado para
  WebAssembly lê o arquivo e o WebGPU desenha."
- Apontar o QR e pausar 10 s para a sala apontar a câmera. Avisar:
  Chrome, Edge, Safari 26 ou Firefox recente; muitos Android não expõem
  WebGPU e vão ver um aviso, o site está lá mesmo assim.
- Com o tempo que sobrar, trocar de aba e soltar o `grafo_1.txt` no
  observatório: clicar num vértice roda uma BFS, arrastar move, o menu de
  layouts troca radial e camadas. Trinta segundos bastam.
- Última frase: "código e relatório no GitHub, o link está no slide."

## Plano B

- Sem internet na sala: o deck é uma página, então gerar um PDF na véspera
  com Imprimir no navegador em cada slide, ou levar o repositório no
  pendrive e rodar `npm run dev` localmente.
- Se o observatório não abrir no computador da sala (sem WebGPU), a demo
  passa a ser a página de estudos de caso, que não precisa de GPU.
