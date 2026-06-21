import * as THREE from 'three';
import { BLOCK, isSolid } from '../blocks.js';
import { makeNoise2D } from './noise.js';
import { tileFor, uvForTile } from './atlas.js';

// --- Constantes canônicas (fonte única) ---
export const CHUNK_SIZE = 16; // blocos por lado (X e Z) de um chunk
export const WORLD_HEIGHT = 48; // altura finita do mundo (Y)

const BASE_HEIGHT = 8; // piso mínimo do terreno
const WATER_LEVEL = 10; // colunas baixas ganham areia no topo
const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

// --- Conversão de coordenadas (PURAS) ---
export const chunkCoord = (b) => Math.floor(b / CHUNK_SIZE);
export const localCoord = (b) => ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
export const chunkKey = (cx, cz) => cx + ',' + cz;
export const parseKey = (key) => key.split(',').map(Number);

// índice de (lx, y, lz) dentro do array de um chunk
const idx = (lx, y, lz) => lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

/**
 * Gera os blocos de um chunk de forma determinística (PURO).
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
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const n01 = (noise(wx, wz) + 1) / 2; // [0,1]
      const height = Math.max(
        1,
        Math.min(WORLD_HEIGHT - 1, Math.floor(BASE_HEIGHT + n01 * (WORLD_HEIGHT - BASE_HEIGHT - 8)))
      );
      for (let y = 0; y <= height; y++) {
        let block;
        if (y === height) block = height <= WATER_LEVEL ? BLOCK.SAND : BLOCK.GRASS;
        else if (y >= height - 3) block = BLOCK.DIRT;
        else block = BLOCK.STONE;
        data[idx(lx, y, lz)] = block;
      }
    }
  }
  return data;
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
    return data[idx(localCoord(bx), by, localCoord(bz))];
  }

  setBlock(bx, by, bz, block) {
    if (by < 0 || by >= WORLD_HEIGHT) return;
    const cx = chunkCoord(bx);
    const cz = chunkCoord(bz);
    const data = this.getChunkData(cx, cz);
    data[idx(localCoord(bx), by, localCoord(bz))] = block;
    this.modified.add(chunkKey(cx, cz));
  }

  isModified(cx, cz) {
    return this.modified.has(chunkKey(cx, cz));
  }

  /** Aplica dados vindos do save (marca como modificado). */
  applyChunk(cx, cz, data) {
    const key = chunkKey(cx, cz);
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
      if (isSolid(data[idx(lx, y, lz)])) return y + 1;
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

/**
 * Constrói a malha de UM chunk (face culling), em coordenadas de mundo.
 * Faces de borda consultam o vizinho via world.getBlock (gera sob demanda).
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

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const bx = baseX + lx;
        const bz = baseZ + lz;
        const block = world.getBlock(bx, y, bz);
        if (!isSolid(block)) continue;

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          if (isSolid(world.getBlock(bx + dx, y + dy, bz + dz))) continue;

          const ndx = positions.length / 3;
          const s = face.shade;
          const rect = uvForTile(tileFor(block, face.name));

          for (let k = 0; k < 4; k++) {
            const [ox, oy, oz] = face.corners[k];
            positions.push(bx + ox, y + oy, bz + oz);
            normals.push(dx, dy, dz);
            colors.push(s, s, s);
            const [lu, lv] = face.uv[k];
            uvs.push(rect.u0 + lu * (rect.u1 - rect.u0), rect.v0 + lv * (rect.v1 - rect.v0));
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
