# ADR 0007 — Árvores por grade de células determinística

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A feature 008 coloca árvores no terreno. O mundo é infinito e gerado **chunk a
chunk, sob demanda e em qualquer ordem** (ADR 0006); chunks pristinos distantes
são descartados e regenerados depois. A constitution exige que a mesma seed gere
o mesmo mundo e proíbe aleatoriedade não semeada. Uma árvore (copa de raio 2)
**cruza a borda do chunk** com frequência: se cada chunk decidisse sozinho
"tenho uma árvore aqui", a copa apareceria cortada ou duplicada na fronteira.

Alternativas consideradas:

1. **Sortear árvores por chunk** (rng semeado por `(seed, cx, cz)`): a árvore
   pertence a UM chunk; os vizinhos não sabem dela ⇒ copas cortadas na borda.
2. **Limiar de ruído** (árvore onde um segundo ruído passa de X): sem controle de
   espaçamento (árvores coladas ou em blocos), custo de ruído por coluna.
3. **Grade de células com hash inteiro** (escolhida).

## Decisão

1. **Grade de 6×6 colunas, no máximo uma árvore por célula.** Existência (~55%),
   posição dentro da célula (margem de 1 coluna) e tamanho do tronco (4 a 6)
   saem de um **hash inteiro de (seed, célula, sal)** — função pura, sem estado,
   sem `Math.random()`. A árvore de uma célula é a mesma não importa qual chunk
   a consulte.
2. **`decorateTrees(data, seed, cx, cz, noise)`** olha as células que
   intersectam o chunk **expandido em 2 colunas** (o raio da copa) e escreve só
   os blocos que caem dentro do chunk. Cada lado da borda escreve a sua metade
   da mesma árvore ⇒ copas completas sem coordenação entre chunks e sem
   depender da ordem de geração.
3. **Regra de escrita comutativa:** `WOOD` entra em `AIR`/`LEAVES`; `LEAVES` só
   entra em `AIR`. O bloco final não depende da ordem em que as árvores são
   aplicadas (e o espaçamento mínimo de 3 colunas entre troncos garante que um
   tronco nunca cai dentro de outra copa).
4. **Filtros de terreno:** só em coluna cujo topo seria `GRASS`
   (`altura > WATER_LEVEL`, via a mesma `surfaceBlockFor` usada pelo gerador —
   uma verdade por fato), nunca a menos de 4 colunas (Chebyshev) de `(0,0)`
   (spawn), e a árvore tem que caber inteira em `WORLD_HEIGHT - 1` (se não
   couber, não nasce).
5. **Forma única:** `forEachTreeBlock(tree, fn)` define tronco e copa (camadas
   de raio 2,2,1,1; cantos omitidos por uma máscara de 16 bits do hash; topo em
   cruz). O gerador e os testes usam a mesma função.
6. **`terrain.js` vira a fonte única** de `CHUNK_SIZE`, `WORLD_HEIGHT`,
   `BASE_HEIGHT`, `WATER_LEVEL`, `terrainHeight` e `chunkIndex`; `world.js`
   importa daí e re-exporta `CHUNK_SIZE`/`WORLD_HEIGHT` (a API pública da
   Parte 1 não muda). A fórmula de altura é a mesma, bit a bit: a seed 1337
   gera o mesmo relevo de antes; árvores só **acrescentam** blocos sobre `AIR`.

## Consequências

- **Positivo:** árvores determinísticas (mesma seed ⇒ mesmas árvores), sem corte
  na borda de chunk, independentes da ordem de geração e do eviction; teste de
  regressão do terreno e de consistência de borda são triviais (a árvore é função
  de `(seed, célula)`).
- **Custo medido** (Node 24, `generateChunk` × 200 chunks, seed 1337): com JIT
  aquecido 8,4 ms → 10,7 ms (**1,27×**, melhor caso 1,21×); primeira execução
  num processo novo 20 → 25–31 ms (**1,3–1,5×**). Meta era ≤ ~2×. O ruído só é
  chamado por célula candidata (≤ 25 por chunk, contra 256 colunas do terreno).
  Densidade efetiva: ~4 árvores por chunk (o terreno é quase todo grama).
- **Negativo / ressalvas:**
  - **Emenda visual com saves antigos.** Chunks modificados salvos na Parte 1
    não têm árvores e são carregados como estão (`applyChunk`), enquanto os
    vizinhos pristinos são regenerados **com** árvores. Na fronteira
    modificado/pristino pode aparecer uma árvore pela metade (copa invadindo o
    chunk antigo some do lado antigo; ou uma copa "flutuando" se o tronco
    estiver no chunk antigo). Não há migração (nada a migrar: o chunk antigo é
    legítimo); saves novos já guardam as árvores dentro dos chunks modificados.
    Para eliminar a emenda basta "Novo mundo".
  - `World.surfaceY` passa a devolver o topo da copa em colunas com árvore
    (folha é sólida). Quem precisa do chão deve checar o bloco de baixo
    (`SPAWN.on: [GRASS]` dos mobs já faz isso). O spawn `(0,0)` é imune: nenhum
    tronco a menos de 4 colunas e a copa só chega à coluna 2.
  - A densidade é uniforme (sem biomas/florestas); mudar `TREE_CHANCE`,
    `TREE_CELL` ou o hash **muda o mundo** para a mesma seed (como qualquer
    mudança de gerador).
