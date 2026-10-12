// Terreno determinístico (PURO, sem Three.js): constantes do mundo, altura da
// coluna, layout do array de chunk e árvores por grade de células.
//
// Fonte única de CHUNK_SIZE / WORLD_HEIGHT / BASE_HEIGHT / WATER_LEVEL
// (`world.js` importa daqui e re-exporta as duas primeiras).
// Mesma seed ⇒ mesmo terreno e mesmas árvores (constitution): nada de
// `Math.random()` — a aleatoriedade das árvores é um hash inteiro de
// (célula, seed). Ver `.specs/008-arvores/` e `docs/adr/0007-*.md`.

import { BLOCK } from '../blocks.js';
import { makeNoise2D } from './noise.js';

// --- Constantes canônicas (fonte única) ---
export const CHUNK_SIZE = 16; // blocos por lado (X e Z) de um chunk
export const WORLD_HEIGHT = 48; // altura finita do mundo (Y)
export const BASE_HEIGHT = 8; // piso mínimo do terreno
export const WATER_LEVEL = 10; // colunas baixas ganham areia no topo
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Índice de (lx, y, lz) dentro do Uint8Array de um chunk. */
export const chunkIndex = (lx, y, lz) => lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

/**
 * Altura da coluna (Y do bloco de topo) em coordenadas de mundo.
 * Mesma expressão (e mesma ordem de operações) do gerador original: o terreno
 * não muda por causa das árvores.
 * @param {(x:number, z:number) => number} noise de `makeNoise2D(seed)`
 * @param {number} wx @param {number} wz
 * @returns {number} inteiro em [1, WORLD_HEIGHT - 1]
 */
export function terrainHeight(noise, wx, wz) {
  const n01 = (noise(wx, wz) + 1) / 2; // [0,1]
  return Math.max(
    1,
    Math.min(WORLD_HEIGHT - 1, Math.floor(BASE_HEIGHT + n01 * (WORLD_HEIGHT - BASE_HEIGHT - 8)))
  );
}

/** Bloco de topo de uma coluna de altura `height`: areia na beira d'água, senão grama. */
export const surfaceBlockFor = (height) => (height <= WATER_LEVEL ? BLOCK.SAND : BLOCK.GRASS);

// --- Árvores (grade de células) ---

export const TREE_CELL = 6; // lado (em colunas) de cada célula; no máx. 1 árvore por célula
export const TREE_CHANCE = 0.55; // probabilidade de a célula ter árvore (antes dos filtros de terreno)
export const TREE_MARGIN = 1; // colunas livres nas bordas da célula (troncos ≥ 3 colunas entre si)
export const TREE_SPAWN_CLEAR = 4; // nenhuma árvore a menos de 4 colunas (Chebyshev) de (0,0)
export const TRUNK_MIN = 4;
export const TRUNK_MAX = 6;
/** Raio de cada camada da copa, de baixo para cima. */
export const CANOPY_RADII = [2, 2, 1, 1];
/** Deslocamento (em Y) da 1ª camada da copa em relação ao topo do tronco. */
export const CANOPY_FIRST = -1;
/** Quantos blocos a copa sobe acima do topo do tronco. */
export const CANOPY_ABOVE = CANOPY_FIRST + CANOPY_RADII.length - 1; // = 2
/** Maior raio da copa: o quanto uma árvore invade colunas vizinhas. */
export const CANOPY_REACH = Math.max(...CANOPY_RADII);

// "Sais" que separam as decisões tiradas do hash de uma mesma célula.
const SALT_EXISTS = 1;
const SALT_X = 2;
const SALT_Z = 3;
const SALT_TRUNK = 4;
const SALT_CORNERS = 5;

const TWO_POW_32 = 4294967296;

// Finalizador de 32 bits (estilo murmur3): espalha bem os bits.
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash inteiro (uint32) de (seed, célula, sal). Determinístico e sem estado. */
function cellHash(seed, gx, gz, salt) {
  let h = mix32((seed | 0) ^ Math.imul(salt, 0x9e3779b1));
  h = mix32(h ^ Math.imul(gx | 0, 0x27d4eb2f));
  h = mix32(h ^ Math.imul(gz | 0, 0x165667b1));
  return h;
}

/**
 * A célula (gx, gz) "sorteou" uma árvore? Só o hash — ignora o terreno.
 * @returns {boolean}
 */
export function cellHasTree(seed, gx, gz) {
  return cellHash(seed, gx, gz, SALT_EXISTS) / TWO_POW_32 < TREE_CHANCE;
}

/**
 * Árvore da célula (gx, gz) ou `null` (célula vazia, spawn, areia/água, não cabe).
 * Os filtros vão do mais barato ao mais caro: o ruído só roda para quem passou.
 */
function treeInCell(seed, noise, gx, gz) {
  if (!cellHasTree(seed, gx, gz)) return null;

  const span = TREE_CELL - 2 * TREE_MARGIN;
  const x = gx * TREE_CELL + TREE_MARGIN + (cellHash(seed, gx, gz, SALT_X) % span);
  const z = gz * TREE_CELL + TREE_MARGIN + (cellHash(seed, gx, gz, SALT_Z) % span);
  if (Math.max(Math.abs(x), Math.abs(z)) < TREE_SPAWN_CLEAR) return null; // zona do spawn

  const groundY = terrainHeight(noise, x, z);
  if (surfaceBlockFor(groundY) !== BLOCK.GRASS) return null; // nada em areia/água

  const trunk = TRUNK_MIN + (cellHash(seed, gx, gz, SALT_TRUNK) % (TRUNK_MAX - TRUNK_MIN + 1));
  if (groundY + trunk + CANOPY_ABOVE > WORLD_HEIGHT - 1) return null; // não cabe no mundo

  return { x, z, groundY, trunk, corners: cellHash(seed, gx, gz, SALT_CORNERS) & 0xffff };
}

/**
 * Árvores que podem ter blocos (tronco ou copa) dentro do chunk: as da própria
 * área e as das células vizinhas cuja copa invade o chunk. Ordem determinística
 * (por linha de células). Cada árvore é `{ x, z, groundY, trunk, corners }` em
 * coordenadas de mundo (`x`,`z` = coluna do tronco; `groundY` = Y da grama).
 * @param {number} seed @param {number} cx @param {number} cz
 * @param {(x:number, z:number) => number} [noise] reaproveita o ruído do chunk
 * @returns {Array<{x:number, z:number, groundY:number, trunk:number, corners:number}>}
 */
export function treesForChunk(seed, cx, cz, noise = makeNoise2D(seed)) {
  const minX = cx * CHUNK_SIZE - CANOPY_REACH;
  const maxX = cx * CHUNK_SIZE + CHUNK_SIZE - 1 + CANOPY_REACH;
  const minZ = cz * CHUNK_SIZE - CANOPY_REACH;
  const maxZ = cz * CHUNK_SIZE + CHUNK_SIZE - 1 + CANOPY_REACH;
  const gx0 = Math.floor(minX / TREE_CELL);
  const gx1 = Math.floor(maxX / TREE_CELL);
  const gz0 = Math.floor(minZ / TREE_CELL);
  const gz1 = Math.floor(maxZ / TREE_CELL);

  const trees = [];
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const tree = treeInCell(seed, noise, gx, gz);
      if (tree && tree.x >= minX && tree.x <= maxX && tree.z >= minZ && tree.z <= maxZ) {
        trees.push(tree);
      }
    }
  }
  return trees;
}

// Canto (|dx| = |dz| = r) omitido? Bit = camada*4 + (dx>0) + 2*(dz>0).
// A camada do topo é sempre em cruz (sem cantos).
function cornerOmitted(mask, layer, dx, dz) {
  if (layer === CANOPY_RADII.length - 1) return true;
  return ((mask >>> (layer * 4 + (dx > 0 ? 1 : 0) + (dz > 0 ? 2 : 0))) & 1) === 1;
}

/**
 * Enumera os blocos de UMA árvore (única definição da forma): primeiro o tronco
 * (`WOOD`, de `groundY + 1` a `groundY + trunk`), depois a copa (`LEAVES`).
 * A coluna do tronco não recebe folha enquanto há tronco. `y` é recortado em
 * `[0, WORLD_HEIGHT)`. Em coordenadas de mundo; não aloca.
 * @param {{x:number, z:number, groundY:number, trunk:number, corners?:number}} tree
 * @param {(x:number, y:number, z:number, block:number) => void} fn
 */
export function forEachTreeBlock(tree, fn) {
  const top = tree.groundY + tree.trunk;
  for (let y = tree.groundY + 1; y <= top; y++) {
    if (y >= 0 && y < WORLD_HEIGHT) fn(tree.x, y, tree.z, BLOCK.WOOD);
  }
  const mask = (tree.corners | 0) >>> 0;
  for (let layer = 0; layer < CANOPY_RADII.length; layer++) {
    const y = top + CANOPY_FIRST + layer;
    if (y < 0 || y >= WORLD_HEIGHT) continue;
    const r = CANOPY_RADII[layer];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0 && y <= top) continue; // aqui há tronco
        if (Math.abs(dx) === r && Math.abs(dz) === r && cornerOmitted(mask, layer, dx, dz)) continue;
        fn(tree.x + dx, y, tree.z + dz, BLOCK.LEAVES);
      }
    }
  }
}

/**
 * Escreve as árvores no chunk `data` (apenas os blocos que caem dentro dele).
 * Regra de escrita COMUTATIVA — `WOOD` entra em AIR/LEAVES, `LEAVES` só em AIR —
 * então o bloco final não depende da ordem das árvores: chunks vizinhos geram
 * a mesma árvore completa sem se consultarem.
 * @param {Uint8Array} data chunk com o terreno já preenchido
 * @param {number} seed @param {number} cx @param {number} cz
 * @param {(x:number, z:number) => number} [noise]
 */
export function decorateTrees(data, seed, cx, cz, noise = makeNoise2D(seed)) {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const put = (x, y, z, block) => {
    const lx = x - baseX;
    const lz = z - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    const i = chunkIndex(lx, y, lz);
    const cur = data[i];
    if (cur === BLOCK.AIR || (block === BLOCK.WOOD && cur === BLOCK.LEAVES)) data[i] = block;
  };
  const trees = treesForChunk(seed, cx, cz, noise);
  for (let i = 0; i < trees.length; i++) forEachTreeBlock(trees[i], put);
}
