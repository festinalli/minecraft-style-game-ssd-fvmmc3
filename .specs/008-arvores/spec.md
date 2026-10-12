# Spec 008 — Árvores (terreno determinístico)

> O QUÊ e o PORQUÊ. Parte 2 do Voxelcraft (ver `docs/prompts/parte-2-criaturas.md`).

## Intenção

Povoar o terreno com **árvores** (tronco de madeira + copa de folhas) geradas
junto com o chunk, de forma **determinística**: mesma seed ⇒ mesmas árvores,
nos mesmos lugares, com a mesma forma.

## Por que agora

O mundo da Parte 1 é só relevo liso (grama, areia, pedra). Os blocos `WOOD` e
`LEAVES` já existem na hotbar (feature 007), mas ninguém os encontra no mundo.
Árvores dão referência visual, abrigo e material de construção, e preparam o
loop de sobrevivência da Parte 2 ("quebra árvores e blocos e coleta").

## Escopo

### Faz parte
- **`src/world/terrain.js` (novo, PURO):** passa a ser a fonte única de
  `CHUNK_SIZE`, `WORLD_HEIGHT`, `BASE_HEIGHT`, `WATER_LEVEL`, da fórmula de
  altura da coluna (`terrainHeight`) e do layout do array de chunk
  (`chunkIndex`). `world.js` importa daqui e **re-exporta** `CHUNK_SIZE` e
  `WORLD_HEIGHT`.
- **Árvores por grade de células** (6×6 colunas, no máximo uma árvore por
  célula). Existência (~55%), posição dentro da célula e tamanho do tronco vêm
  de um **hash inteiro** de (célula, seed). Nada de `Math.random()`.
- **Onde nascem:** só em coluna cujo bloco de topo seria `GRASS`
  (`altura > WATER_LEVEL`); **nunca** a menos de 4 colunas de `(0,0)` (spawn).
- **Forma:** tronco de 4 a 6 blocos de `WOOD`; copa de `LEAVES` em 4 camadas
  (raios 2, 2, 1, 1) começando 1 bloco abaixo do topo do tronco, cantos omitidos
  de forma determinística; folhas só ocupam `AIR`, o tronco sobrescreve folhas.
  Nada ultrapassa `WORLD_HEIGHT - 1` (árvore que não cabe inteira não nasce).
- **Copas que cruzam a borda do chunk ficam completas dos dois lados:**
  `decorateTrees` olha as células que intersectam o chunk expandido e escreve
  apenas os blocos que caem dentro do chunk.
- `generateChunk(seed, cx, cz)` mantém a assinatura e chama `decorateTrees`.
- **Terreno idêntico ao anterior** (bit a bit, mesma seed): árvores só
  acrescentam blocos `WOOD`/`LEAVES` sobre `AIR`.

### NÃO faz parte
- Biomas, florestas densas por região, outros tipos de árvore, flores.
- Folhas que decaem ao quebrar o tronco; drop de maçã.
- Migração de saves antigos (não há o que migrar — ver ADR 0007 sobre a emenda
  visual na fronteira chunk modificado/pristino).

## Critérios de aceitação

1. **Regressão do terreno:** `terrainHeight(noise, wx, wz)` é idêntica à fórmula
   antiga de `generateChunk`; todo bloco de um chunk novo que não seja
   `WOOD`/`LEAVES` é igual ao do gerador antigo, para várias seeds e chunks.
2. `world.js` continua exportando `World`, `generateChunk`, `chunkCoord`,
   `localCoord`, `chunkKey`, `parseKey`, `buildChunkMesh`, `CHUNK_SIZE` e
   `WORLD_HEIGHT`, e `World` mantém `getBlock/setBlock/surfaceY/evictChunk/
   applyChunk/isModified` com o mesmo comportamento.
3. **Determinismo:** mesma seed ⇒ mesmas árvores (`treesForChunk`) e mesmos
   bytes de chunk; seeds diferentes ⇒ árvores diferentes.
4. Toda árvore tem: tronco de 4 a 6 blocos de `WOOD` sobre um bloco `GRASS`
   (`altura > WATER_LEVEL`), no máximo uma por célula 6×6, fora do quadrado de
   4 colunas ao redor de `(0,0)`, e cabe em `WORLD_HEIGHT - 1`.
5. A copa tem camadas de raio 2, 2, 1, 1; só `LEAVES` em `AIR`; o tronco nunca
   é trocado por folha.
6. **Borda de chunk:** para toda árvore que toca um chunk (inclusive as que
   nascem no vizinho), todos os blocos esperados dela que caem nesse chunk estão
   presentes; o resultado não depende da ordem de geração dos chunks nem de
   qual chunk é gerado primeiro (inclusive em coordenadas negativas).
7. Nenhuma árvore em areia/água; o spawn `(0,0)` continua livre de tronco e copa
   (`surfaceY(0,0) === terrainHeight + 1`).
8. **Custo:** gerar 200 chunks com árvores não fica mais de ~2× mais lento que
   o mesmo terreno sem árvores (medido e registrado no ADR/relatório).
9. Chunks antigos (sem árvores) aplicados com `applyChunk` continuam carregando
   e sendo lidos normalmente.
10. `npm run build` conclui sem erros e `node --test tests/terrain.test.js`
    passa.
