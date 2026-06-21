import {
  CHUNK_SIZE,
  chunkCoord,
  chunkKey,
  parseKey,
  buildChunkMesh,
} from './world.js';

/**
 * Streaming de chunks ao redor do jogador: cria malhas dentro de um raio,
 * descarrega fora, carrega incrementalmente (orçado por frame) e evicta dados
 * de chunks pristinos distantes.
 *
 * @param {object} opts
 * @param {import('./world.js').World} opts.world
 * @param {import('three').Scene} opts.scene
 * @param {import('three').Material} opts.material
 * @param {number} opts.radius   raio (em chunks) com malha visível
 * @param {number} [opts.budget] chunks construídos por frame (streaming)
 */
export function createStreamer({ world, scene, material, radius, budget = 2 }) {
  const meshes = new Map(); // key -> Mesh
  const queue = []; // [cx,cz] pendentes de construção
  const queued = new Set();
  let lastPcx = null;
  let lastPcz = null;

  function buildChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (meshes.has(key)) return;
    const mesh = buildChunkMesh(world, cx, cz, material);
    meshes.set(key, mesh);
    scene.add(mesh);
  }

  function disposeMesh(key) {
    const mesh = meshes.get(key);
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    meshes.delete(key);
  }

  // Recalcula o conjunto desejado quando o jogador troca de chunk.
  function reconcile(pcx, pcz) {
    // enfileira faltantes dentro do raio (mais perto primeiro)
    for (let cx = pcx - radius; cx <= pcx + radius; cx++) {
      for (let cz = pcz - radius; cz <= pcz + radius; cz++) {
        const key = chunkKey(cx, cz);
        if (!meshes.has(key) && !queued.has(key)) {
          queue.push([cx, cz]);
          queued.add(key);
        }
      }
    }
    queue.sort((a, b) => {
      const da = Math.max(Math.abs(a[0] - pcx), Math.abs(a[1] - pcz));
      const db = Math.max(Math.abs(b[0] - pcx), Math.abs(b[1] - pcz));
      return da - db;
    });

    // descarrega malhas fora do raio
    for (const key of [...meshes.keys()]) {
      const [cx, cz] = parseKey(key);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > radius) disposeMesh(key);
    }

    // evicta dados de chunks pristinos bem distantes (regeneráveis)
    for (const key of [...world.chunks.keys()]) {
      const [cx, cz] = parseKey(key);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > radius + 2) {
        world.evictChunk(cx, cz);
      }
    }
  }

  function processQueue(limit) {
    let built = 0;
    while (queue.length && built < limit) {
      const [cx, cz] = queue.shift();
      queued.delete(chunkKey(cx, cz));
      buildChunk(cx, cz);
      built++;
    }
  }

  /**
   * @param {{x:number,z:number}} playerPos
   * @param {boolean} [immediate] constrói tudo da fila de uma vez (carga inicial)
   */
  function update(playerPos, immediate = false) {
    const pcx = chunkCoord(Math.floor(playerPos.x));
    const pcz = chunkCoord(Math.floor(playerPos.z));
    if (pcx !== lastPcx || pcz !== lastPcz) {
      reconcile(pcx, pcz);
      lastPcx = pcx;
      lastPcz = pcz;
    }
    processQueue(immediate ? Infinity : budget);
  }

  // Rebuilda o chunk de um bloco editado + o vizinho, se a edição foi na borda.
  function rebuildAround(bx, bz) {
    const cx = chunkCoord(bx);
    const cz = chunkCoord(bz);
    const targets = new Set([chunkKey(cx, cz)]);
    const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (lx === 0) targets.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK_SIZE - 1) targets.add(chunkKey(cx + 1, cz));
    if (lz === 0) targets.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK_SIZE - 1) targets.add(chunkKey(cx, cz + 1));

    for (const key of targets) {
      if (!meshes.has(key)) continue; // fora da área visível: será construído ao entrar
      disposeMesh(key);
      const [tcx, tcz] = parseKey(key);
      buildChunk(tcx, tcz);
    }
  }

  function getMeshes() {
    return [...meshes.values()];
  }

  return { update, rebuildAround, getMeshes, meshes };
}
