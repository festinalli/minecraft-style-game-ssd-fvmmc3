# Plan 008 — Árvores

> O COMO. Derivado da spec 008.

## Mudanças por módulo

### `src/world/terrain.js` (novo, PURO — sem Three.js)
- Constantes movidas de `world.js`: `CHUNK_SIZE`, `WORLD_HEIGHT`, `BASE_HEIGHT`,
  `WATER_LEVEL` (+ derivada `CHUNK_VOLUME`).
- `terrainHeight(noise, wx, wz)` — a MESMA expressão que estava em
  `generateChunk` (mesma ordem de operações ⇒ mesmo resultado bit a bit).
- `surfaceBlockFor(height)` — `SAND` se `height <= WATER_LEVEL`, senão `GRASS`.
  Usada por `generateChunk` **e** pela regra "árvore só em grama" (uma verdade).
- `chunkIndex(lx, y, lz)` — layout do `Uint8Array` (`lx + lz*16 + y*256`).
- **Grade de árvores:**
  - `TREE_CELL = 6`; célula `(gx, gz)` cobre as colunas `[gx*6, gx*6+5]`.
  - `cellHash(seed, gx, gz, salt)` — hash inteiro de 32 bits (finalizador
    estilo murmur3 encadeado); `salt` separa existência, posição, tronco e cantos.
  - Existência: `hash < 0.55`. Posição: `x`/`z` com margem de 1 coluna dentro da
    célula (offsets 1..4 ⇒ troncos a ≥ 3 colunas entre si). Tronco: `4 + h % 3`.
  - Filtros (nesta ordem, do mais barato ao mais caro): existe? → fora do
    quadrado de spawn (Chebyshev < 4)? → `terrainHeight` ⇒ é grama? → cabe em
    `WORLD_HEIGHT - 1` (`groundY + trunk + 2`)?
  - Árvore = `{ x, z, groundY, trunk, corners }` (`corners` = máscara de 16 bits
    de cantos omitidos; contrato mínimo `{x,z,groundY,trunk}` preservado).
- `treesForChunk(seed, cx, cz, noise?)` — árvores cuja pegada (tronco ± raio 2)
  pode tocar o chunk: itera as células que intersectam o chunk expandido em 2
  colunas e filtra pela caixa. `noise` é opcional (default `makeNoise2D(seed)`).
- `forEachTreeBlock(tree, fn)` — única definição da FORMA: tronco (`WOOD`) e
  copa (`LEAVES`, camadas `CANOPY_RADII = [2,2,1,1]` a partir de `topo - 1`,
  cantos omitidos pela máscara; a última camada é sempre em cruz; a coluna do
  tronco não recebe folha enquanto há tronco). Recorta `y` em `[0, WORLD_HEIGHT)`.
- `decorateTrees(data, seed, cx, cz, noise?)` — para cada árvore de
  `treesForChunk`, escreve só os blocos dentro do chunk. Regra de escrita:
  `WOOD` entra em `AIR`/`LEAVES`; `LEAVES` entra só em `AIR`. Essa regra é
  **comutativa** (o resultado final de um bloco não depende da ordem das
  árvores), por isso chunks vizinhos concordam sem coordenação.

### `src/world/world.js`
- Importa constantes/funções de `terrain.js`; re-exporta `CHUNK_SIZE` e
  `WORLD_HEIGHT`. Remove `idx` local (usa `chunkIndex`).
- `generateChunk`: preenche colunas com `terrainHeight` + `surfaceBlockFor`
  (mesmo preenchimento de antes) e termina chamando
  `decorateTrees(data, seed, cx, cz, noise)` reaproveitando o `noise` já criado.
- `World` e `buildChunkMesh` inalterados (API pública preservada).
  `surfaceY` passa a devolver o topo da copa em colunas com árvore (folha é
  sólida) — o spawn `(0,0)` é imune graças à zona livre de 4 colunas.

## Decisões técnicas
- **Grade + hash** em vez de sortear por chunk: a árvore existe independente de
  qual chunk a gera ⇒ copas cruzam a borda sem coordenação (ADR 0007).
- Margem de 1 coluna na célula evita troncos colados e copas totalmente
  sobrepostas, mantendo a densidade visual agradável.

## Validação (mapeia critérios)
- `tests/terrain.test.js`: regressão do terreno (reimplementa a fórmula e o
  gerador antigos no teste), layout/`chunkIndex`, re-exports, determinismo,
  regras por árvore, forma da copa (fixtures), consistência de borda com
  referência independente (ordem invertida), coordenadas negativas, spawn,
  densidade (~55%), custo determinístico (nº de chamadas de ruído), save antigo.
- Benchmark manual (200 chunks com × sem árvores) registrado em `ADR 0007`.
- `npm run build`.
