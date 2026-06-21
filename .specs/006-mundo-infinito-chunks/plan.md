# Plan 006 — Mundo infinito (streaming de chunks)

> O COMO. Pivô arquitetural — substitui o mundo finito (ADR 0006).

## Novo modelo de mundo

- **Y finito** (`WORLD_HEIGHT`), **X/Z infinitos**. Mundo = dicionário de chunks
  `(cx,cz) → Uint8Array` (tamanho `CHUNK_SIZE² × WORLD_HEIGHT`).
- **Coordenadas globais de bloco** (inteiros, qualquer X/Z). Geometria dos chunks
  é construída já em **coordenadas de mundo** (sem o offset de centralização
  antigo) — o ponto do raycast vira coordenada de bloco direto.

## Módulos

### `src/world/world.js` (reescrito)
```js
export const CHUNK_SIZE = 16, WORLD_HEIGHT = 48;
export const chunkCoord = b => Math.floor(b / CHUNK_SIZE);
export const localCoord = b => ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
export const chunkKey = (cx,cz) => cx + ',' + cz;
export function generateChunk(seed, cx, cz): Uint8Array     // PURO/determinístico
export class World {
  getBlock(bx,by,bz), setBlock(bx,by,bz,block)             // gera chunk sob demanda
  getChunkData(cx,cz), isModified(cx,cz), applyChunk(cx,cz,data)
  surfaceY(bx,bz)
}
export function buildChunkMesh(world, cx, cz, material): THREE.Mesh  // world coords, face culling
```
Face culling usa `world.getBlock` no vizinho → gera o chunk vizinho sob demanda,
garantindo bordas corretas.

### `src/world/streamer.js` (novo)
```js
createStreamer({ world, scene, material, radius, budget }): {
  update(playerPos, immediate?),  // garante malhas no raio; remove fora; orça/frame
  rebuildAround(bx, bz),          // rebuilda chunk do bloco + vizinho de borda
  getMeshes(): Mesh[]
}
```
- Carregamento **incremental**: fila ordenada por distância, `budget` chunks/frame
  (no primeiro update, `immediate` constrói tudo — fica escondido atrás do overlay).
- **Descarrega** malha fora do raio (dispose). **Evicta dados** de chunks pristinos
  além de `radius+2` (regeneráveis); nunca evicta chunk modificado.

### `src/player/collision.js` (assinatura muda)
`collidesAABB(world, x, y, z)` — usa `world.getBlock` em coords globais.

### `src/player/editing.js` (adaptado)
- `resolveTarget(point, normal)` → `{hit, place}` em **coords globais** (sem offset).
- Raycast em `getMeshes()` (vários meshes). Ao editar: `world.setBlock` +
  `streamer.rebuildAround`.

### `src/world/persistence.js` (formato v2)
- `serializeChunks(entries, seed, player)` ↔ `deserializeChunks(str)`: salva
  **só chunks modificados** (`key → base64`). Browser: itera `world` modificados.

### `main.js`
- `world = new World(SEED)`; aplica save (chunks modificados + player); cria
  `streamer`; spawn em `(0.5, surfaceY(0,0)+queda, 0.5)`; no loop chama
  `streamer.update(camera.position)`; fog/`camera.far` ~ `radius·CHUNK_SIZE`.

## Decisões técnicas
- **Geometria em coords de mundo** (mesh na origem) simplifica raycast/edição.
- **Dados gerados sob demanda e cacheados**; colisão sempre correta mesmo sem
  malha. Eviction só de pristinos → memória limitada, determinismo intacto.
- **Save incremental por chunk modificado** (v2) — substitui o blob único (v1).
  Saves v1 antigos são ignorados (versionamento).

## Validação (mapeia critérios)
- Headless: `chunkCoord/localCoord` (inclui negativos), `generateChunk`
  determinístico e idêntico ao "mundo global" em coords compartilhadas,
  `buildChunkMesh` não-vazio com UV, `serializeChunks` round-trip (crit. 8, 3).
- `npm run build`. Manual: explorar sem borda, editar em bordas, recarregar
  (crit. 1–7).
