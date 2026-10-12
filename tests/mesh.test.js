// Testes headless da malha de chunk e do fundo do mundo (revisão da Parte 2):
// - buildChunkMesh (caminho quente por arrays) é IDÊNTICO à implementação de
//   referência por world.getBlock (a da Parte 1);
// - sealBottom/applyChunk selam y = 0 em saves antigos (a Parte 1 deixava quebrá-lo).

import test from 'node:test';
import assert from 'node:assert/strict';
import { World, buildChunkMesh, sealBottom, CHUNK_SIZE, WORLD_HEIGHT } from '../src/world/world.js';
import { CHUNK_VOLUME, chunkIndex } from '../src/world/terrain.js';
import { tileFor, uvForTile } from '../src/world/atlas.js';
import { BLOCK, isSolid } from '../src/blocks.js';

const FACES = [
  { dir: [-1, 0, 0], shade: 0.8, name: 'side', corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], uv: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { dir: [1, 0, 0], shade: 0.8, name: 'side', corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], uv: [[1, 0], [1, 1], [0, 0], [0, 1]] },
  { dir: [0, -1, 0], shade: 0.55, name: 'bottom', corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] },
  { dir: [0, 1, 0], shade: 1.0, name: 'top', corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [0, 0], [1, 0]] },
  { dir: [0, 0, -1], shade: 0.7, name: 'side', corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], uv: [[1, 1], [0, 1], [1, 0], [0, 0]] },
  { dir: [0, 0, 1], shade: 0.7, name: 'side', corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], uv: [[0, 1], [1, 1], [0, 0], [1, 0]] },
];

/** Implementação de REFERÊNCIA (a da Parte 1): consulta cada vizinho com world.getBlock. */
function referenceArrays(world, cx, cz) {
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
  return { positions, normals, colors, uvs, indices };
}

function assertSameMesh(world, cx, cz, label) {
  const ref = referenceArrays(world, cx, cz);
  const g = buildChunkMesh(world, cx, cz).geometry;
  const got = {
    positions: g.getAttribute('position').array,
    normals: g.getAttribute('normal').array,
    colors: g.getAttribute('color').array,
    uvs: g.getAttribute('uv').array,
    indices: g.getIndex().array,
  };
  for (const key of Object.keys(ref)) {
    assert.equal(got[key].length, ref[key].length, `${label}: tamanho de ${key}`);
    const f32 = key !== 'indices';
    for (let i = 0; i < ref[key].length; i++) {
      const want = f32 ? Math.fround(ref[key][i]) : ref[key][i];
      if (got[key][i] !== want) assert.fail(`${label}: ${key}[${i}] ${got[key][i]} != ${want}`);
    }
  }
  return ref.positions.length / 12; // nº de faces
}

test('malha: idêntica à referência por getBlock em chunks do mundo real (com árvores)', () => {
  const w = new World(1337);
  let faces = 0;
  for (const [cx, cz] of [[0, 0], [-1, -1], [3, 2], [-5, 4], [7, -6]]) faces += assertSameMesh(w, cx, cz, `chunk ${cx},${cz}`);
  assert.ok(faces > 1000, 'há geometria de verdade: ' + faces);
});

test('malha: idêntica nas bordas quando os vizinhos foram editados (face culling entre chunks)', () => {
  const w = new World(1337);
  const y = w.surfaceY(15, 7) + 1;
  // buraco na borda leste do chunk (0,0) e parede na borda oeste do (1,0)
  for (let dy = 0; dy < 3; dy++) w.setBlock(15, y - 1 - dy, 7, BLOCK.AIR);
  for (let dz = 0; dz < 4; dz++) w.setBlock(16, y, 5 + dz, BLOCK.PLANKS);
  // e na borda norte/sul
  w.setBlock(4, w.surfaceY(4, 0) - 1, 0, BLOCK.AIR);
  w.setBlock(9, w.surfaceY(9, -1), -1, BLOCK.COBBLE);
  for (const [cx, cz] of [[0, 0], [1, 0], [0, -1], [-1, 0], [0, 1]]) assertSameMesh(w, cx, cz, `borda ${cx},${cz}`);
});

test('malha: topo e fundo do mundo (y = 0 e y = WORLD_HEIGHT - 1) seguem a referência', () => {
  const w = new World(5);
  for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
    w.setBlock(x, 0, z, BLOCK.AIR);
    w.setBlock(x, WORLD_HEIGHT - 1, z, BLOCK.STONE);
  }
  assertSameMesh(w, 0, 0, 'topo/fundo');
});

test('malha: benchmark informativo (caminho quente vs referência)', (t) => {
  const w = new World(1337);
  const chunks = [];
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) chunks.push([cx, cz]);
  for (const [cx, cz] of chunks) w.getChunkData(cx, cz); // gera tudo antes de medir
  const t0 = performance.now();
  for (const [cx, cz] of chunks) buildChunkMesh(w, cx, cz);
  const fast = performance.now() - t0;
  const t1 = performance.now();
  for (const [cx, cz] of chunks) referenceArrays(w, cx, cz);
  const slow = performance.now() - t1;
  t.diagnostic(`49 chunks: caminho quente ${(fast / 49).toFixed(1)} ms/chunk · referência ${(slow / 49).toFixed(1)} ms/chunk`);
  assert.ok(fast < slow, 'o caminho quente não pode ser mais lento que a referência');
});

test('sealBottom: tampa buracos em y = 0 sem tocar no resto e ignora tamanho errado', () => {
  const d = new Uint8Array(CHUNK_VOLUME);
  d[chunkIndex(3, 0, 4)] = BLOCK.DIRT;
  d[chunkIndex(3, 1, 4)] = BLOCK.GRASS;
  sealBottom(d);
  for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
    assert.ok(d[chunkIndex(x, 0, z)] !== BLOCK.AIR, 'fundo sólido');
  }
  assert.equal(d[chunkIndex(3, 0, 4)], BLOCK.DIRT, 'não troca o que já é sólido');
  assert.equal(d[chunkIndex(3, 1, 4)], BLOCK.GRASS, 'não mexe nas camadas de cima');
  assert.equal(d[chunkIndex(0, 2, 0)], BLOCK.AIR);
  assert.doesNotThrow(() => sealBottom(new Uint8Array(10)));
  assert.doesNotThrow(() => sealBottom(null));
});

test('applyChunk: um chunk de save antigo com buraco em y = 0 já entra selado', () => {
  const w = new World(1337);
  const d = new Uint8Array(CHUNK_VOLUME); // tudo AIR, como um save da Parte 1 cavado até o fundo
  w.applyChunk(2, 2, d);
  assert.ok(isSolid(w.getBlock(2 * CHUNK_SIZE + 5, 0, 2 * CHUNK_SIZE + 5)));
  assert.equal(w.isModified(2, 2), true);
});
