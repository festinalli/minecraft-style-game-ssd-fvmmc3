# Plan 004 — Texturas (atlas)

> O COMO. Derivado da spec 004.

## Arquitetura

Novo módulo **`src/world/atlas.js`** com duas partes bem separadas:

1. **Layout (PURO, sem DOM):** mapeia (tipo de bloco, face) → tile, e tile → UVs.
   Testável headless.
2. **Geração da imagem (browser):** `makeAtlasTexture()` desenha os tiles num
   `<canvas>` e devolve uma `THREE.CanvasTexture` (nearest, sem mipmap).

`world.js` passa a:
- emitir o atributo **`uv`** sempre (puro, vem do layout do atlas);
- usar **vertex color = tom de cinza do sombreamento** (multiplica a textura);
- aceitar um **material** por parâmetro (browser injeta o material com `map`);
  sem material, cai num default (usado só em teste, nunca renderizado).

```
main.js: tex = makeAtlasTexture(); mat = MeshStandardMaterial({map:tex, vertexColors:true})
         buildWorldMesh(voxels, mat)   e rebuildWorld reaproveita o mesmo mat
```

## Contratos

### `src/world/atlas.js`
```js
export const TILES = { GRASS_TOP, GRASS_SIDE, DIRT, STONE, SAND };
export function tileFor(blockType, faceName /* 'top'|'bottom'|'side' */): number
export function uvForTile(tileIndex): { u0, v0, u1, v1 }   // com inset anti-bleed
export function makeAtlasTexture(): THREE.CanvasTexture     // browser only
```
Atlas: 8 colunas × 1 linha de tiles 16px (128×16, ambos potência de 2).

### `src/world/world.js` (mudanças)
- `FACES[*].name` ∈ {top|bottom|side} para escolher o tile.
- `buildWorldMesh(voxels, material?)`: emite `uv`; vertex color = `shade` (cinza);
  material default = `MeshStandardMaterial({ vertexColors:true })` se não vier um.

### Mapeamento de UV por corner
Corners de cada face seguem padrão consistente (0–1 e 0–2 são arestas; 3=1+2−0):
`u = (k∈{0,2}) ? u0 : u1`, `v = (k∈{0,1}) ? v0 : v1`.

## Decisões técnicas
- **Atlas procedural em runtime** (canvas) evita binários no repo e mantém o
  projeto 100% texto/código. Registrado em ADR 0005.
- **Vertex color vira sombreamento (cinza)** que multiplica a textura → preserva
  o realce direcional sem duplicar a cor (que agora vem da textura).
- **Layout separado da imagem** para manter os testes headless (sem canvas).

## Validação (mapeia critérios)
- Teste headless: `tileFor` (grama topo≠lateral≠fundo) e `uvForTile` (faixas
  corretas/determinismo) (crit. 5). Build + teste de mundo com atributo `uv`
  presente (crit. 6).
- Manual: aparência texturizada e pixelada (crit. 1–3).
