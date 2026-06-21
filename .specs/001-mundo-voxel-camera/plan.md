# Plan 001 — Mundo voxel + câmera

> O COMO. Derivado do spec.md. Arquitetura, contratos e decisões técnicas.

## Visão geral da arquitetura

```
main.js  ──cria──►  Scene + Camera + Renderer + Lights
   │
   ├─ world.js  ──gera blocos via──►  noise.js
   │     └─ buildChunkMesh()  ──►  BufferGeometry única (face culling)
   │
   └─ controls.js  ──►  PointerLockControls + estado de teclado (WASD/voo)
                          atualizado a cada frame no loop
```

Loop principal (`requestAnimationFrame`): `controls.update(dt)` → `renderer.render`.

## Contratos dos módulos

### `src/blocks.js`
```js
export const BLOCK = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3 };
// cor sólida por tipo (THREE.Color em hex)
export const BLOCK_COLOR = { [BLOCK.GRASS]: 0x6ab04c, ... };
```
Fonte única de tipos e cores (a constitution proíbe duplicar isso).

### `src/world/noise.js`
```js
export function makeNoise2D(seed): (x, z) => number  // retorno ~[-1, 1]
```
Ruído de valor (value noise) com interpolação suave + hash determinístico a
partir da seed. Sem `Math.random()`.

### `src/world/world.js`
```js
export const CHUNK_SIZE = 16;     // blocos por lado (X e Z) por chunk
export const WORLD_CHUNKS = 4;    // grade WORLD_CHUNKS×WORLD_CHUNKS de chunks
export const MAX_HEIGHT = 24;

export function generateWorld(seed): VoxelData   // mapa de blocos sólidos
export function buildWorldMesh(voxels): THREE.Mesh  // 1 mesh, face culling
```
- Altura de cada coluna = `noise` remapeado para `[baseHeight, MAX_HEIGHT]`.
- Tipo por profundidade: topo = GRASS, alguns abaixo = DIRT, resto = STONE.
- **Face culling:** para cada bloco sólido, emite um quad por face apenas se o
  vizinho naquela direção for AIR (fora dos limites conta como AIR só no topo e
  laterais; fundo não precisa).
- Cor por vértice (`vertexColors`) vinda de `BLOCK_COLOR`, com leve variação por
  face (faces de cima mais claras) para dar leitura de volume.

### `src/player/controls.js`
```js
export function createControls(camera, domElement): {
  update(dt), connectUI(overlayEl), enabled
}
```
- Usa `PointerLockControls` de `three/examples/jsm`.
- Estado de teclas em `keydown`/`keyup`.
- WASD move no plano relativo ao yaw da câmera; `Space`/`ShiftLeft` = sobe/desce.
- Velocidade constante (sem física). `dt` para movimento independente de FPS.

## Decisões técnicas

- **Face culling em geometria agregada** em vez de `InstancedMesh`: dá controle
  de cor por face e remove faces internas (menos triângulos). Ver `constitution`.
- **Voo livre sem colisão** nesta v1: colisão/gravidade é feature separada, fora
  do escopo (spec). Mantém a v1 pequena e focada em render + navegação.
- **Cores sólidas, não texturas:** evita pipeline de assets/atlas agora. Vira
  feature futura. Registrado como decisão em ADR 0002.
- **Mundo finito pequeno** (`WORLD_CHUNKS²` chunks) gerado de uma vez: streaming
  de chunks infinito é complexidade fora do escopo da v1.

## Riscos / mitigação

- *Contagem de triângulos alta* → face culling + mundo finito pequeno.
- *Pointer lock bloqueado pelo navegador* → só ativa após clique do usuário
  (overlay), conforme critério de aceitação 1–2.

## Como validar (mapeia para os critérios do spec)

- `npm run dev`, abrir, clicar → mouse captura (crit. 1–2).
- Andar com WASD/Space/Shift, Esc solta (crit. 3–4).
- Recarregar → mesmo terreno (crit. 5).
- Conferir variação de altura e 3 cores (crit. 6).
- `npm run build` sem erro (crit. 8).
