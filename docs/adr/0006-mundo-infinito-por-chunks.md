# ADR 0006 — Mundo infinito por chunks (streaming)

- **Status:** Aceito (substitui o modelo de mundo finito dos ADRs 0001–0005)
- **Data:** 2026-06-21

## Contexto

Até a feature 005 o mundo era **finito**: um único `VoxelData` (array fixo,
centralizado por offset), uma única malha reconstruída inteira a cada edição, e
save num blob único. A feature 006 pede mundo **infinito** em X/Z.

## Decisão

Adotar um mundo **dividido em chunks** (`CHUNK_SIZE²` × `WORLD_HEIGHT`),
infinito em X/Z e finito em Y:

1. **Geração sob demanda e determinística** por coordenada global (`generateChunk`
   a partir da seed). Dados ficam cacheados num `Map`; chunks pristinos distantes
   são **evictados** (regeneráveis), chunks modificados nunca.
2. **Uma malha por chunk**, construída em **coordenadas de mundo** (sem offset).
   Streaming carrega malhas dentro de um raio (incremental, orçado por frame) e
   descarrega fora.
3. **Coordenadas globais** em toda a interação: `getBlock/setBlock(bx,by,bz)`,
   colisão e raycast operam em coords de mundo (gera o chunk vizinho sob demanda
   → face culling correto nas bordas).
4. **Save por chunk modificado** (formato v2): só o que o jogador alterou é
   persistido; o resto regenera da seed.

## Consequências

- **Positivo:** exploração sem bordas; performance mantida via descarregamento e
  carregamento incremental; saves pequenos (só edições); colisão correta mesmo
  em chunks sem malha (dados gerados sob demanda).
- **Negativo:** mais complexidade (streamer, eviction, rebuild de bordas). Y
  permanece finito. Editar numa borda exige rebuild do chunk vizinho.
- **Substitui** decisões anteriores: o offset de centralização (ADR 0003), o
  rebuild da malha inteira (ADR 0003) e o save em blob único (feature 005) deixam
  de valer. Saves no formato v1 são ignorados (versionamento v2).
