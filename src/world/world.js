import * as THREE from 'three';
import { BLOCK, isSolid } from '../blocks.js';
import { makeNoise2D } from './noise.js';
import { tileFor, uvForTile } from './atlas.js';
import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  BASE_HEIGHT,
  CHUNK_VOLUME,
  chunkIndex,
  terrainHeight,
  surfaceBlockFor,
  decorateTrees,
} from './terrain.js';

// --- Constantes canônicas (fonte única: terrain.js) ---
// Re-exportadas aqui porque o resto do jogo (main, streamer, testes) as importa
// de world.js desde a Parte 1.
export { CHUNK_SIZE, WORLD_HEIGHT };

// --- Conversão de coordenadas (PURAS) ---
export const chunkCoord = (b) => Math.floor(b / CHUNK_SIZE);
export const localCoord = (b) => ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
export const chunkKey = (cx, cz) => cx + ',' + cz;
export const parseKey = (key) => key.split(',').map(Number);

/**
 * Gera os blocos de um chunk de forma determinística (PURO): terreno por
 * altura de coluna + árvores por grade de células (ver terrain.js).
 * @param {number} seed
 * @param {number} cx @param {number} cz coordenadas do chunk
 * @returns {Uint8Array}
 */
export function generateChunk(seed, cx, cz) {
  const data = new Uint8Array(CHUNK_VOLUME); // tudo AIR (0)
  const noise = makeNoise2D(seed);
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const height = terrainHeight(noise, baseX + lx, baseZ + lz);
      for (let y = 0; y <= height; y++) {
        let block;
        if (y === height) block = surfaceBlockFor(height);
        else if (y >= height - 3) block = BLOCK.DIRT;
        else block = BLOCK.STONE;
        data[chunkIndex(lx, y, lz)] = block;
      }
    }
  }
  decorateTrees(data, seed, cx, cz, noise); // troncos e copas (inclusive das árvores vizinhas)
  return data;
}

/**
 * O fundo do mundo (y = 0) é indestrutível desde a Parte 2. Saves da Parte 1 podem ter
 * buracos nessa camada (dava para quebrá-la): sela com pedra ao carregar, senão o
 * jogador cairia para sempre. Só mexe em AIR; dados de tamanho errado são ignorados.
 * @param {Uint8Array} data
 */
export function sealBottom(data) {
  if (!data || data.length !== CHUNK_VOLUME) return;
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const i = chunkIndex(lx, 0, lz);
      if (data[i] === BLOCK.AIR) data[i] = BLOCK.STONE;
    }
  }
}

/**
 * Mundo infinito em X/Z: dicionário de chunks gerados sob demanda.
 */
export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map(); // key -> Uint8Array
    this.modified = new Set(); // keys de chunks editados (não regeneráveis)
  }

  /** Dados do chunk; gera e cacheia se necessário. */
  getChunkData(cx, cz) {
    const key = chunkKey(cx, cz);
    let data = this.chunks.get(key);
    if (!data) {
      data = generateChunk(this.seed, cx, cz);
      this.chunks.set(key, data);
    }
    return data;
  }

  getBlock(bx, by, bz) {
    if (by < 0 || by >= WORLD_HEIGHT) return BLOCK.AIR;
    const data = this.getChunkData(chunkCoord(bx), chunkCoord(bz));
    return data[chunkIndex(localCoord(bx), by, localCoord(bz))];
  }

  setBlock(bx, by, bz, block) {
    if (by < 0 || by >= WORLD_HEIGHT) return;
    const cx = chunkCoord(bx);
    const cz = chunkCoord(bz);
    const data = this.getChunkData(cx, cz);
    data[chunkIndex(localCoord(bx), by, localCoord(bz))] = block;
    this.modified.add(chunkKey(cx, cz));
  }

  isModified(cx, cz) {
    return this.modified.has(chunkKey(cx, cz));
  }

  /** Aplica dados vindos do save (marca como modificado). */
  applyChunk(cx, cz, data) {
    const key = chunkKey(cx, cz);
    sealBottom(data);
    this.chunks.set(key, data);
    this.modified.add(key);
  }

  /** Descarta os dados de um chunk pristino (regenerável) para liberar memória. */
  evictChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (!this.modified.has(key)) this.chunks.delete(key);
  }

  /** Y da superfície (topo do bloco mais alto) na coluna (bx, bz). */
  surfaceY(bx, bz) {
    const data = this.getChunkData(chunkCoord(bx), chunkCoord(bz));
    const lx = localCoord(bx);
    const lz = localCoord(bz);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(data[chunkIndex(lx, y, lz)])) return y + 1;
    }
    return BASE_HEIGHT;
  }
}

// --- Geometria ---

// Faces do cubo: normal, sombreamento, nome (top/bottom/side), corners e UVs
// locais [u,v] já orientados (v=0 = topo do tile; faces laterais: V segue Y).
const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, name: 'side',
    corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uv: [[0, 0], [0, 1], [1, 0], [1, 1]] }, // -x
  { dir: [1, 0, 0], shade: 0.8, name: 'side',
    corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uv: [[1, 0], [1, 1], [0, 0], [0, 1]] }, // +x
  { dir: [0, -1, 0], shade: 0.55, name: 'bottom',
    corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] }, // -y
  { dir: [0, 1, 0], shade: 1.0, name: 'top',
    corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [0, 0], [1, 0]] }, // +y
  { dir: [0, 0, -1], shade: 0.7, name: 'side',
    corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] }, // -z
  { dir: [0, 0, 1], shade: 0.7, name: 'side',
    corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uv: [[0, 1], [1, 1], [0, 0], [1, 0]] }, // +z
];

// Tile (UVs) por (bloco, face): tileFor/uvForTile são puras, então calculamos uma vez.
const FACE_NAMES = ['side', 'bottom', 'top'];
const uvCache = new Map();
function faceRect(block, face) {
  const key = block * 3 + FACE_NAMES.indexOf(face.name);
  let r = uvCache.get(key);
  if (!r) {
    r = uvForTile(tileFor(block, face.name));
    uvCache.set(key, r);
  }
  return r;
}

/**
 * Constrói a malha de UM chunk (face culling), em coordenadas de mundo.
 *
 * Caminho QUENTE (~40 mil consultas de vizinho por chunk): lê direto os arrays do
 * chunk e dos 4 vizinhos laterais, em vez de world.getBlock (que monta uma chave de
 * string por consulta e custava ~60% do tempo). O resultado é idêntico — o teste de
 * paridade em tests/mesh.test.js compara com a implementação por getBlock.
 * Os vizinhos são gerados sob demanda, como antes (faces de borda corretas).
 *
 * @param {World} world
 * @param {number} cx @param {number} cz
 * @param {THREE.Material} [material]
 * @returns {THREE.Mesh}
 */
export function buildChunkMesh(world, cx, cz, material) {
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  const self = world.getChunkData(cx, cz);
  const west = world.getChunkData(cx - 1, cz);
  const east = world.getChunkData(cx + 1, cz);
  const north = world.getChunkData(cx, cz - 1);
  const south = world.getChunkData(cx, cz + 1);

  /** Sólido em (lx, y, lz) locais; lx/lz podem valer -1 ou CHUNK_SIZE (vizinho). */
  function solidAt(lx, y, lz) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    let data = self;
    if (lx < 0) {
      data = west;
      lx += CHUNK_SIZE;
    } else if (lx >= CHUNK_SIZE) {
      data = east;
      lx -= CHUNK_SIZE;
    } else if (lz < 0) {
      data = north;
      lz += CHUNK_SIZE;
    } else if (lz >= CHUNK_SIZE) {
      data = south;
      lz -= CHUNK_SIZE;
    }
    return isSolid(data[chunkIndex(lx, y, lz)]);
  }

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const block = self[chunkIndex(lx, y, lz)];
        if (!isSolid(block)) continue;
        const bx = baseX + lx;
        const bz = baseZ + lz;

        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f];
          const dx = face.dir[0];
          const dy = face.dir[1];
          const dz = face.dir[2];
          if (solidAt(lx + dx, y + dy, lz + dz)) continue;

          const ndx = positions.length / 3;
          const s = face.shade;
          const rect = faceRect(block, face);
          const du = rect.u1 - rect.u0;
          const dv = rect.v1 - rect.v0;

          for (let k = 0; k < 4; k++) {
            const corner = face.corners[k];
            positions.push(bx + corner[0], y + corner[1], bz + corner[2]);
            normals.push(dx, dy, dz);
            colors.push(s, s, s);
            const uv = face.uv[k];
            uvs.push(rect.u0 + uv[0] * du, rect.v0 + uv[1] * dv);
          }
          indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mat =
    material ||
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'chunk:' + chunkKey(cx, cz);
  mesh.userData.cx = cx;
  mesh.userData.cz = cz;
  return mesh;
}
