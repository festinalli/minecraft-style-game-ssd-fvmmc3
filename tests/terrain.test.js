// Testes headless da feature 008 (árvores) e da refatoração de terrain.js.
// Rodam no Node: só lógica pura de mundo (sem DOM, sem WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK } from '../src/blocks.js';
import { makeNoise2D } from '../src/world/noise.js';
import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  BASE_HEIGHT,
  WATER_LEVEL,
  CHUNK_VOLUME,
  TREE_CELL,
  TREE_CHANCE,
  TREE_SPAWN_CLEAR,
  TRUNK_MIN,
  TRUNK_MAX,
  CANOPY_RADII,
  CANOPY_ABOVE,
  terrainHeight,
  surfaceBlockFor,
  chunkIndex,
  cellHasTree,
  treesForChunk,
  forEachTreeBlock,
  decorateTrees,
} from '../src/world/terrain.js';
import * as worldModule from '../src/world/world.js';

const {
  World,
  generateChunk,
  chunkCoord,
  localCoord,
  chunkKey,
  parseKey,
  buildChunkMesh,
} = worldModule;

// --- Referência: o gerador ANTIGO (pré-008), reimplementado aqui de propósito ---
// (não importa nada de terrain.js: se a fórmula nova divergir, o teste pega.)
function oldHeight(noise, wx, wz) {
  const n01 = (noise(wx, wz) + 1) / 2;
  return Math.max(1, Math.min(48 - 1, Math.floor(8 + n01 * (48 - 8 - 8))));
}

function oldGenerateChunk(seed, cx, cz) {
  const data = new Uint8Array(16 * 16 * 48);
  const noise = makeNoise2D(seed);
  for (let lx = 0; lx < 16; lx++) {
    for (let lz = 0; lz < 16; lz++) {
      const height = oldHeight(noise, cx * 16 + lx, cz * 16 + lz);
      for (let y = 0; y <= height; y++) {
        let block;
        if (y === height) block = height <= 10 ? BLOCK.SAND : BLOCK.GRASS;
        else if (y >= height - 3) block = BLOCK.DIRT;
        else block = BLOCK.STONE;
        data[lx + lz * 16 + y * 256] = block;
      }
    }
  }
  return data;
}

const SEEDS = [1337, 42, 7, 0, -5, 99999];
const cellOf = (v) => Math.floor(v / TREE_CELL);

/** Todas as árvores (sem repetir) que tocam os chunks [lo..hi]² . */
function collectTrees(seed, lo, hi) {
  const seen = new Map();
  for (let cx = lo; cx <= hi; cx++) {
    for (let cz = lo; cz <= hi; cz++) {
      for (const t of treesForChunk(seed, cx, cz)) seen.set(t.x + ',' + t.z, t);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Constantes, layout e API de world.js preservada
// ---------------------------------------------------------------------------

test('terrain: constantes canônicas e layout do chunk (chunkIndex)', () => {
  assert.equal(CHUNK_SIZE, 16);
  assert.equal(WORLD_HEIGHT, 48);
  assert.equal(BASE_HEIGHT, 8);
  assert.equal(WATER_LEVEL, 10);
  assert.equal(CHUNK_VOLUME, 16 * 16 * 48);
  assert.equal(chunkIndex(0, 0, 0), 0);
  assert.equal(chunkIndex(3, 5, 7), 3 + 7 * 16 + 5 * 256);
  // bijeção: todo (lx,y,lz) cai em um índice único dentro do volume
  const seen = new Set();
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = chunkIndex(lx, y, lz);
        assert.ok(i >= 0 && i < CHUNK_VOLUME);
        seen.add(i);
      }
    }
  }
  assert.equal(seen.size, CHUNK_VOLUME);
});

test('world.js: re-exporta as constantes e mantém toda a API pública', () => {
  assert.equal(worldModule.CHUNK_SIZE, CHUNK_SIZE);
  assert.equal(worldModule.WORLD_HEIGHT, WORLD_HEIGHT);
  for (const name of [
    'World', 'generateChunk', 'chunkCoord', 'localCoord', 'chunkKey', 'parseKey',
    'buildChunkMesh', 'CHUNK_SIZE', 'WORLD_HEIGHT',
  ]) {
    assert.ok(name in worldModule, 'faltou o export ' + name);
  }
  const proto = World.prototype;
  for (const m of [
    'getChunkData', 'getBlock', 'setBlock', 'isModified', 'applyChunk', 'evictChunk', 'surfaceY',
  ]) {
    assert.equal(typeof proto[m], 'function', 'faltou World#' + m);
  }
  // conversões puras continuam as mesmas (inclusive negativos)
  assert.equal(chunkCoord(-1), -1);
  assert.equal(chunkCoord(16), 1);
  assert.equal(localCoord(-1), 15);
  assert.equal(localCoord(17), 1);
  assert.equal(chunkKey(-2, 3), '-2,3');
  assert.deepEqual(parseKey('-2,3'), [-2, 3]);
  assert.equal(typeof buildChunkMesh, 'function');
});

// ---------------------------------------------------------------------------
// Regressão: o terreno NÃO mudou
// ---------------------------------------------------------------------------

test('regressão: terrainHeight é idêntica à fórmula antiga de generateChunk', () => {
  for (const seed of [0, 1, 42, 1337, -7, 99999, 123456789]) {
    const noise = makeNoise2D(seed);
    for (let wx = -100; wx <= 100; wx += 3) {
      for (let wz = -100; wz <= 100; wz += 3) {
        assert.equal(terrainHeight(noise, wx, wz), oldHeight(noise, wx, wz), `seed ${seed} (${wx},${wz})`);
      }
    }
  }
});

test('regressão: surfaceBlockFor — areia até WATER_LEVEL, grama acima', () => {
  assert.equal(surfaceBlockFor(1), BLOCK.SAND);
  assert.equal(surfaceBlockFor(WATER_LEVEL), BLOCK.SAND);
  assert.equal(surfaceBlockFor(WATER_LEVEL + 1), BLOCK.GRASS);
  assert.equal(surfaceBlockFor(WORLD_HEIGHT - 1), BLOCK.GRASS);
});

test('regressão: terreno do chunk é bit a bit o do gerador antigo; árvores só sobre AIR', () => {
  let treeBlocks = 0;
  for (const seed of [1337, 42, 7]) {
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        const now = generateChunk(seed, cx, cz);
        const old = oldGenerateChunk(seed, cx, cz);
        assert.equal(now.length, old.length);
        for (let i = 0; i < now.length; i++) {
          if (now[i] === BLOCK.WOOD || now[i] === BLOCK.LEAVES) {
            assert.equal(old[i], BLOCK.AIR, `árvore sobrescreveu terreno (seed ${seed}, chunk ${cx},${cz}, i=${i})`);
            treeBlocks++;
          } else {
            assert.equal(now[i], old[i], `terreno diferente (seed ${seed}, chunk ${cx},${cz}, i=${i})`);
          }
        }
      }
    }
  }
  assert.ok(treeBlocks > 500, 'o teste seria vácuo sem árvores: ' + treeBlocks);
});

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

test('determinismo: mesma seed => mesmas árvores e mesmos bytes; seeds diferentes => árvores diferentes', () => {
  for (const seed of [1337, -5]) {
    for (const [cx, cz] of [[0, 0], [-1, 2], [5, -4]]) {
      assert.deepEqual(treesForChunk(seed, cx, cz), treesForChunk(seed, cx, cz));
      assert.deepEqual(generateChunk(seed, cx, cz), generateChunk(seed, cx, cz));
    }
  }
  const a = JSON.stringify(collectTrees(1337, -3, 3));
  const b = JSON.stringify(collectTrees(1338, -3, 3));
  const c = JSON.stringify(collectTrees(1337, -3, 3));
  assert.notEqual(a, b);
  assert.equal(a, c);
});

test('determinismo: o hash das células depende da seed (padrões de células independentes)', () => {
  // independente do terreno: só o hash de (célula, seed)
  const diff = (s1, s2) => {
    let d = 0;
    let total = 0;
    for (let gx = -40; gx < 40; gx++) {
      for (let gz = -40; gz < 40; gz++) {
        total++;
        if (cellHasTree(s1, gx, gz) !== cellHasTree(s2, gx, gz)) d++;
      }
    }
    return d / total;
  };
  // duas seeds independentes discordam em ~2*0.55*0.45 = ~50% das células
  assert.ok(diff(1337, 1338) > 0.35, 'seeds vizinhas deveriam gerar padrões bem diferentes');
  assert.ok(diff(0, 1) > 0.35);
  assert.equal(diff(1337, 1337), 0);
  // e é função da célula: (gx,gz) != (gz,gx) em geral
  let assimetricas = 0;
  for (let g = 1; g < 60; g++) if (cellHasTree(1337, g, -g) !== cellHasTree(1337, -g, g)) assimetricas++;
  assert.ok(assimetricas > 10);
});

test('pureza: gerar chunks nunca chama Math.random()', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random() proibido na geração de mundo');
  };
  try {
    for (let cx = -2; cx <= 2; cx++) generateChunk(1337, cx, cx);
    treesForChunk(5, 3, -3);
    cellHasTree(5, 3, -3);
  } finally {
    Math.random = original;
  }
});

test('treesForChunk: contrato {x,z,groundY,trunk} com inteiros, sem repetidas, ordem estável', () => {
  for (const seed of SEEDS) {
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        const trees = treesForChunk(seed, cx, cz);
        const keys = new Set();
        for (const t of trees) {
          for (const f of ['x', 'z', 'groundY', 'trunk']) {
            assert.ok(Number.isInteger(t[f]), `${f} deve ser inteiro`);
          }
          keys.add(t.x + ',' + t.z);
        }
        assert.equal(keys.size, trees.length, 'árvore repetida na lista do chunk');
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Regras de cada árvore
// ---------------------------------------------------------------------------

test('regras: tronco 4..6, sobre grama (acima da água), 1 por célula, fora do spawn, cabe no mundo', () => {
  let total = 0;
  for (const seed of SEEDS) {
    const noise = makeNoise2D(seed);
    const world = new World(seed);
    const trees = collectTrees(seed, -4, 4);
    const cells = new Set();
    for (const t of trees) {
      total++;
      assert.ok(t.trunk >= TRUNK_MIN && t.trunk <= TRUNK_MAX, 'tronco ' + t.trunk);
      assert.equal(t.groundY, terrainHeight(noise, t.x, t.z));
      assert.ok(t.groundY > WATER_LEVEL, 'árvore na água/areia');
      assert.equal(world.getBlock(t.x, t.groundY, t.z), BLOCK.GRASS, 'tronco deve nascer sobre grama');
      for (let k = 1; k <= t.trunk; k++) {
        assert.equal(world.getBlock(t.x, t.groundY + k, t.z), BLOCK.WOOD, `tronco bloco ${k}`);
      }
      assert.notEqual(world.getBlock(t.x, t.groundY + t.trunk + 1, t.z), BLOCK.WOOD, 'tronco longo demais');
      assert.ok(t.groundY + t.trunk + CANOPY_ABOVE <= WORLD_HEIGHT - 1, 'ultrapassa o teto do mundo');
      assert.ok(Math.max(Math.abs(t.x), Math.abs(t.z)) >= TREE_SPAWN_CLEAR, 'árvore na zona do spawn');
      const cell = cellOf(t.x) + ',' + cellOf(t.z);
      assert.ok(!cells.has(cell), 'duas árvores na mesma célula ' + cell);
      cells.add(cell);
      assert.ok(cellHasTree(seed, cellOf(t.x), cellOf(t.z)), 'árvore em célula que o hash não sorteou');
    }
    // troncos nunca colados: margem de 1 coluna na célula => >= 3 colunas entre si
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const d = Math.max(Math.abs(trees[i].x - trees[j].x), Math.abs(trees[i].z - trees[j].z));
        assert.ok(d >= 3, `troncos a ${d} colunas`);
      }
    }
  }
  assert.ok(total > 100, 'amostra pequena demais: ' + total);
});

test('regras: toda coluna com tronco tem grama embaixo; nenhuma madeira em areia', () => {
  let wood = 0;
  for (const seed of [1337, 42]) {
    for (let cx = -4; cx <= 4; cx++) {
      for (let cz = -4; cz <= 4; cz++) {
        const data = generateChunk(seed, cx, cz);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            for (let y = 0; y < WORLD_HEIGHT; y++) {
              if (data[chunkIndex(lx, y, lz)] !== BLOCK.WOOD) continue;
              wood++;
              let b = y;
              while (data[chunkIndex(lx, b, lz)] === BLOCK.WOOD) b--;
              assert.equal(data[chunkIndex(lx, b, lz)], BLOCK.GRASS, 'madeira que não nasce de grama');
              assert.ok(b > WATER_LEVEL);
            }
          }
        }
      }
    }
  }
  assert.ok(wood > 100);
});

test('regras: com ruído controlado — areia/água não tem árvore; teto do mundo recorta o tronco', () => {
  // ruído = -1 => altura 8 (<= WATER_LEVEL): coluna de areia
  const baixo = () => -1;
  for (let cx = -3; cx <= 3; cx++) assert.equal(treesForChunk(1337, cx, cx, baixo).length, 0);

  // ruído = +1 => altura 40: só cabem troncos de 4 ou 5 (40 + trunk + 2 <= 47)
  const alto = () => 1;
  assert.equal(terrainHeight(alto, 0, 0), 40);
  const trees = [];
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) trees.push(...treesForChunk(1337, cx, cz, alto));
  assert.ok(trees.length > 20);
  for (const t of trees) {
    assert.ok(t.trunk >= 4 && t.trunk <= 5, 'tronco 6 não cabe a altura 40: ' + t.trunk);
    assert.ok(t.groundY + t.trunk + CANOPY_ABOVE <= WORLD_HEIGHT - 1);
  }

  // decorateTrees num platô de altura 40: nada passa de WORLD_HEIGHT - 1
  const data = new Uint8Array(CHUNK_VOLUME);
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      for (let y = 0; y <= 40; y++) data[chunkIndex(lx, y, lz)] = y === 40 ? BLOCK.GRASS : BLOCK.STONE;
    }
  }
  decorateTrees(data, 1337, 2, 2, alto);
  let maxY = 0;
  let any = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === BLOCK.WOOD || data[i] === BLOCK.LEAVES) {
      any++;
      maxY = Math.max(maxY, Math.floor(i / 256));
    }
  }
  assert.ok(any > 0);
  assert.ok(maxY <= WORLD_HEIGHT - 1);
});

test('densidade: o hash sorteia ~55% das células; no mundo real há árvores em quantidade razoável', () => {
  for (const seed of [1, 1337]) {
    let n = 0;
    let total = 0;
    for (let gx = -50; gx < 50; gx++) {
      for (let gz = -50; gz < 50; gz++) {
        total++;
        if (cellHasTree(seed, gx, gz)) n++;
      }
    }
    const ratio = n / total;
    assert.ok(Math.abs(ratio - TREE_CHANCE) < 0.03, `razão ${ratio} longe de ${TREE_CHANCE}`);
  }
  // árvores por chunk (tronco dentro do chunk): em média entre ~0,5 e 4
  let sum = 0;
  let chunks = 0;
  for (let cx = -5; cx < 5; cx++) {
    for (let cz = -5; cz < 5; cz++) {
      chunks++;
      for (const t of treesForChunk(1337, cx, cz)) {
        if (chunkCoord(t.x) === cx && chunkCoord(t.z) === cz) sum++;
      }
    }
  }
  const avg = sum / chunks;
  assert.ok(avg > 0.5 && avg < 4.6, 'média de árvores por chunk: ' + avg);
});

// ---------------------------------------------------------------------------
// Forma (fixtures)
// ---------------------------------------------------------------------------

function blocksOf(tree) {
  const out = [];
  forEachTreeBlock(tree, (x, y, z, b) => out.push({ x, y, z, b }));
  return out;
}

test('forma: tronco de WOOD + copa em camadas de raio 2,2,1,1 (sem cantos omitidos)', () => {
  assert.deepEqual(CANOPY_RADII, [2, 2, 1, 1]);
  const tree = { x: 10, z: -7, groundY: 12, trunk: 5, corners: 0 };
  const blocks = blocksOf(tree);
  const top = 12 + 5; // Y do último bloco de tronco

  const wood = blocks.filter((b) => b.b === BLOCK.WOOD);
  assert.deepEqual(wood.map((b) => b.y), [13, 14, 15, 16, 17]);
  assert.ok(wood.every((b) => b.x === 10 && b.z === -7));

  const leaves = blocks.filter((b) => b.b === BLOCK.LEAVES);
  // y das camadas: topo-1, topo, topo+1, topo+2
  const byY = new Map();
  for (const l of leaves) byY.set(l.y, [...(byY.get(l.y) ?? []), l]);
  assert.deepEqual([...byY.keys()].sort((a, b) => a - b), [top - 1, top, top + 1, top + 2]);
  const radius = (ls) => Math.max(...ls.map((l) => Math.max(Math.abs(l.x - 10), Math.abs(l.z + 7))));
  assert.equal(radius(byY.get(top - 1)), 2);
  assert.equal(radius(byY.get(top)), 2);
  assert.equal(radius(byY.get(top + 1)), 1);
  assert.equal(radius(byY.get(top + 2)), 1);
  // contagens (sem omissões): 5x5-1(tronco), 5x5-1, 3x3 (cheio), cruz de 5 (cantos sempre fora no topo)
  assert.equal(byY.get(top - 1).length, 24);
  assert.equal(byY.get(top).length, 24);
  assert.equal(byY.get(top + 1).length, 9);
  assert.equal(byY.get(top + 2).length, 5);
  // a copa não tem folha na coluna do tronco enquanto há tronco, e cobre o topo dela
  assert.ok(!leaves.some((l) => l.x === 10 && l.z === -7 && l.y <= top));
  assert.ok(leaves.some((l) => l.x === 10 && l.z === -7 && l.y === top + 1));
  assert.ok(leaves.some((l) => l.x === 10 && l.z === -7 && l.y === top + 2));
  // sem blocos repetidos
  assert.equal(new Set(blocks.map((b) => `${b.x},${b.y},${b.z}`)).size, blocks.length);
  // nada acima de topo + CANOPY_ABOVE
  assert.equal(Math.max(...blocks.map((b) => b.y)), top + CANOPY_ABOVE);
});

test('forma: cantos omitidos pela máscara de forma determinística; topo sempre em cruz', () => {
  const full = blocksOf({ x: 0, z: 0, groundY: 20, trunk: 4, corners: 0 }).filter((b) => b.b === BLOCK.LEAVES);
  const holes = blocksOf({ x: 0, z: 0, groundY: 20, trunk: 4, corners: 0xffff }).filter((b) => b.b === BLOCK.LEAVES);
  // máscara cheia: camadas 0 e 1 perdem 4 cantos cada; a camada 2 (raio 1) perde 4; a do topo já era cruz
  assert.equal(full.length, 24 + 24 + 9 + 5);
  assert.equal(holes.length, 20 + 20 + 5 + 5);
  const corner = (b) => Math.abs(b.x) === 2 && Math.abs(b.z) === 2;
  assert.equal(holes.filter(corner).length, 0);
  assert.equal(full.filter(corner).length, 8);
  // máscara vem do hash: mesmo tree => mesma forma; sem `corners` equivale a 0
  assert.deepEqual(
    blocksOf({ x: 0, z: 0, groundY: 20, trunk: 4 }),
    blocksOf({ x: 0, z: 0, groundY: 20, trunk: 4, corners: 0 })
  );
  // um bit só omite um canto: bit 0 da camada 0 = (dx<0, dz<0)
  const one = blocksOf({ x: 0, z: 0, groundY: 20, trunk: 4, corners: 1 }).filter((b) => b.b === BLOCK.LEAVES);
  assert.equal(one.length, full.length - 1);
  const missing = full.find((f) => !one.some((o) => o.x === f.x && o.y === f.y && o.z === f.z));
  assert.deepEqual([missing.x, missing.z, missing.y], [-2, -2, 20 + 4 - 1]);
  // árvores reais variam de forma (as máscaras não são todas iguais)
  const masks = new Set(collectTrees(1337, -4, 4).map((t) => t.corners));
  assert.ok(masks.size > 5);
});

test('forma: recorte no teto (y >= WORLD_HEIGHT) e no chão (y < 0) — nunca escreve fora', () => {
  const alta = blocksOf({ x: 0, z: 0, groundY: 44, trunk: 6, corners: 0 });
  assert.ok(alta.length > 0);
  assert.ok(alta.every((b) => b.y >= 0 && b.y < WORLD_HEIGHT));
  const baixa = blocksOf({ x: 0, z: 0, groundY: -6, trunk: 4, corners: 0 });
  assert.ok(baixa.every((b) => b.y >= 0 && b.y < WORLD_HEIGHT));
});

// ---------------------------------------------------------------------------
// Borda de chunk: copas completas dos dois lados
// ---------------------------------------------------------------------------

test('borda: todo bloco esperado de cada árvore que toca um chunk está no chunk certo', () => {
  let crossing = 0;
  let checked = 0;
  for (const seed of [1337, 42, -99, 2024]) {
    const world = new World(seed);
    for (let cx = -4; cx <= 3; cx++) {
      for (let cz = -4; cz <= 3; cz++) {
        for (const tree of treesForChunk(seed, cx, cz)) {
          const owners = new Set();
          forEachTreeBlock(tree, (x, y, z, block) => {
            owners.add(chunkCoord(x) + ',' + chunkCoord(z));
            const actual = world.getBlock(x, y, z);
            checked++;
            if (block === BLOCK.WOOD) {
              assert.equal(actual, BLOCK.WOOD, `tronco faltando em ${x},${y},${z}`);
            } else {
              // folha: ou a folha, ou algo que tem prioridade (tronco de outra árvore / terreno sólido)
              assert.ok(
                actual === BLOCK.LEAVES || actual === BLOCK.WOOD || actual === BLOCK.STONE ||
                  actual === BLOCK.DIRT || actual === BLOCK.GRASS || actual === BLOCK.SAND,
                `folha faltando em ${x},${y},${z} (veio ${actual})`
              );
            }
          });
          if (owners.size > 1) crossing++;
        }
      }
    }
  }
  assert.ok(checked > 5000);
  assert.ok(crossing > 20, 'o teste seria vácuo: poucas árvores cruzam bordas (' + crossing + ')');
});

test('borda: resultado independe da ordem das árvores (referência montada de fora para dentro)', () => {
  const LO = -3;
  const HI = 2; // chunks [LO..HI]²
  const SPAN = (HI - LO + 1) * CHUNK_SIZE;
  const minB = LO * CHUNK_SIZE;
  const at = (x, y, z) => x - minB + (z - minB) * SPAN + y * SPAN * SPAN;

  for (const seed of [1337, 42, -99]) {
    // 1) terreno antigo (sem árvores) montado numa região grande
    const ref = new Uint8Array(SPAN * SPAN * WORLD_HEIGHT);
    for (let cx = LO; cx <= HI; cx++) {
      for (let cz = LO; cz <= HI; cz++) {
        const old = oldGenerateChunk(seed, cx, cz);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
              ref[at(cx * 16 + lx, y, cz * 16 + lz)] = old[lx + lz * 16 + y * 256];
            }
          }
        }
      }
    }
    // 2) as árvores listadas pelos chunks, aplicadas em duas ordens diferentes
    const trees = collectTrees(seed, LO, HI);
    const apply = (arr, list) => {
      for (const t of list) {
        forEachTreeBlock(t, (x, y, z, block) => {
          if (x < minB || z < minB || x >= minB + SPAN || z >= minB + SPAN) return;
          const i = at(x, y, z);
          if (arr[i] === BLOCK.AIR || (block === BLOCK.WOOD && arr[i] === BLOCK.LEAVES)) arr[i] = block;
        });
      }
    };
    const ordemA = ref.slice();
    const ordemB = ref.slice();
    apply(ordemA, trees.slice().sort((a, b) => b.x - a.x || b.z - a.z)); // decrescente
    apply(ordemB, trees.slice().sort((a, b) => a.z - b.z || a.x - b.x)); // por linha
    assert.deepEqual(ordemA, ordemB, 'a ordem das árvores mudou o resultado');

    // 3) cada chunk gerado sozinho == a região de referência
    let diffs = 0;
    for (let cx = LO; cx <= HI; cx++) {
      for (let cz = LO; cz <= HI; cz++) {
        const data = generateChunk(seed, cx, cz);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
              if (data[lx + lz * 16 + y * 256] !== ordemA[at(cx * 16 + lx, y, cz * 16 + lz)]) diffs++;
            }
          }
        }
      }
    }
    assert.equal(diffs, 0, `seed ${seed}: ${diffs} blocos divergem da referência`);
  }
});

test('borda: ordem de geração dos chunks não importa (vizinho antes ou depois)', () => {
  const seed = 1337;
  const a = new World(seed);
  const b = new World(seed);
  const coords = [];
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) coords.push([cx, cz]);
  for (const [cx, cz] of coords) a.getChunkData(cx, cz);
  for (const [cx, cz] of coords.slice().reverse()) b.getChunkData(cx, cz);
  for (const [cx, cz] of coords) {
    assert.deepEqual(a.getChunkData(cx, cz), b.getChunkData(cx, cz));
  }
});

// ---------------------------------------------------------------------------
// Spawn livre e World
// ---------------------------------------------------------------------------

test('spawn: nenhum tronco a menos de 4 colunas de (0,0); o chão do spawn fica livre de copa', () => {
  let cellsWithTreeInZoneCell = 0;
  for (let seed = 1; seed <= 150; seed++) {
    if (cellHasTree(seed, 0, 0)) cellsWithTreeInZoneCell++;
    for (const [cx, cz] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
      for (const t of treesForChunk(seed, cx, cz)) {
        assert.ok(Math.max(Math.abs(t.x), Math.abs(t.z)) >= TREE_SPAWN_CLEAR, `seed ${seed}: árvore em ${t.x},${t.z}`);
      }
    }
    const world = new World(seed);
    const noise = makeNoise2D(seed);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const ground = terrainHeight(noise, dx, dz);
        // nunca madeira nessa zona (o tronco mais próximo fica a >= 4 colunas)
        for (let y = ground + 1; y < WORLD_HEIGHT; y++) {
          assert.notEqual(world.getBlock(dx, y, dz), BLOCK.WOOD, `seed ${seed}: tronco em ${dx},${y},${dz}`);
        }
        // a copa (raio 2) de um tronco a 4 colunas só chega até a coluna 2:
        // o entorno imediato (|d| <= 1) é chão limpo e surfaceY(0,0) é a grama
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
          assert.equal(world.surfaceY(dx, dz), ground + 1, `seed ${seed} (${dx},${dz})`);
        }
      }
    }
  }
  // sanidade: a exclusão está ATIVA (a célula do spawn sorteia árvore em muitas seeds)
  assert.ok(cellsWithTreeInZoneCell > 50, 'o filtro do spawn nunca seria exercitado: ' + cellsWithTreeInZoneCell);
});

test('World: getBlock/setBlock/isModified/evictChunk/applyChunk/surfaceY seguem iguais', () => {
  const world = new World(1337);
  assert.equal(world.getBlock(0, -1, 0), BLOCK.AIR);
  assert.equal(world.getBlock(0, WORLD_HEIGHT, 0), BLOCK.AIR);
  const y0 = world.surfaceY(0, 0);
  assert.equal(world.getBlock(0, y0 - 1, 0), BLOCK.GRASS);
  assert.equal(world.getBlock(0, y0, 0), BLOCK.AIR);

  // setBlock marca modificado; evict só descarta chunks pristinos
  assert.equal(world.isModified(0, 0), false);
  world.setBlock(0, y0, 0, BLOCK.PLANKS);
  assert.equal(world.isModified(0, 0), true);
  assert.equal(world.getBlock(0, y0, 0), BLOCK.PLANKS);
  world.evictChunk(0, 0);
  assert.equal(world.getBlock(0, y0, 0), BLOCK.PLANKS, 'chunk modificado não pode ser evictado');
  world.getChunkData(7, 7);
  assert.ok(world.chunks.has('7,7'));
  world.evictChunk(7, 7);
  assert.ok(!world.chunks.has('7,7'));
  // chunk pristino evictado regenera idêntico (árvores incluídas)
  const antes = world.getChunkData(5, -5).slice();
  world.evictChunk(5, -5);
  assert.deepEqual(world.getChunkData(5, -5), antes);

  // chão sem árvore: surfaceY = altura + 1; coluna de árvore: topo da copa
  const noise = makeNoise2D(1337);
  const trees = collectTrees(1337, -3, 3);
  const treeCols = new Set();
  for (const t of trees) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) treeCols.add(`${t.x + dx},${t.z + dz}`);
  const w2 = new World(1337);
  let free = 0;
  for (let x = -40; x < 40; x += 5) {
    for (let z = -40; z < 40; z += 5) {
      if (treeCols.has(`${x},${z}`)) continue;
      assert.equal(w2.surfaceY(x, z), terrainHeight(noise, x, z) + 1);
      free++;
    }
  }
  assert.ok(free > 100);
  const t = trees[0];
  assert.equal(w2.surfaceY(t.x, t.z), t.groundY + t.trunk + CANOPY_ABOVE + 1, 'surfaceY inclui a copa (folha é sólida)');
});

// ---------------------------------------------------------------------------
// Saves antigos e custo
// ---------------------------------------------------------------------------

test('save antigo: chunk sem árvores aplicado via applyChunk carrega; a emenda com o vizinho pristino é a documentada', () => {
  const seed = 1337;
  // acha uma árvore cuja copa cruza do chunk (cx+1,cz) para o chunk (cx,cz)
  let found = null;
  outer: for (let cx = -4; cx <= 4; cx++) {
    for (let cz = -4; cz <= 4; cz++) {
      for (const t of treesForChunk(seed, cx + 1, cz)) {
        if (chunkCoord(t.x) !== cx + 1 || chunkCoord(t.z) !== cz) continue;
        let invade = false;
        forEachTreeBlock(t, (x, _y, z) => {
          if (chunkCoord(x) === cx && chunkCoord(z) === cz) invade = true;
        });
        if (invade) {
          found = { cx, cz, tree: t };
          break outer;
        }
      }
    }
  }
  assert.ok(found, 'não achou árvore de fronteira para o teste');
  const { cx, cz, tree } = found;

  const world = new World(seed);
  const antigo = oldGenerateChunk(seed, cx, cz); // save da Parte 1: terreno sem árvores
  world.applyChunk(cx, cz, antigo);
  assert.equal(world.isModified(cx, cz), true);
  assert.equal(world.getChunkData(cx, cz), antigo);
  world.evictChunk(cx, cz);
  assert.equal(world.getChunkData(cx, cz), antigo, 'chunk de save não pode ser evictado');
  assert.ok(world.surfaceY(cx * 16 + 3, cz * 16 + 3) > 0); // lê normalmente

  // lado antigo: sem os blocos da árvore vizinha; lado pristino: tronco e copa presentes
  let dentroDoAntigo = 0;
  forEachTreeBlock(tree, (x, y, z, block) => {
    if (chunkCoord(x) === cx && chunkCoord(z) === cz) {
      dentroDoAntigo++;
      assert.equal(world.getBlock(x, y, z), antigo[chunkIndex(localCoord(x), y, localCoord(z))]);
    } else if (block === BLOCK.WOOD) {
      assert.equal(world.getBlock(x, y, z), BLOCK.WOOD);
    }
  });
  assert.ok(dentroDoAntigo > 0);
  // o mundo continua utilizável em volta do chunk antigo
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    assert.ok(world.getChunkData(cx + dx, cz + dz).length === CHUNK_VOLUME);
  }
});

test('custo: decorateTrees consulta o ruído só por célula candidata (<= 25 por chunk), não por coluna', () => {
  let maxCalls = 0;
  for (const seed of [1337, 42]) {
    const real = makeNoise2D(seed);
    for (let cx = -5; cx < 5; cx++) {
      for (let cz = -5; cz < 5; cz++) {
        let calls = 0;
        const counting = (x, z) => {
          calls++;
          return real(x, z);
        };
        decorateTrees(new Uint8Array(CHUNK_VOLUME), seed, cx, cz, counting);
        maxCalls = Math.max(maxCalls, calls);
      }
    }
  }
  // 20 colunas expandidas / 6 => no máximo 5 células por eixo
  assert.ok(maxCalls <= 25, 'ruído chamado ' + maxCalls + 'x num chunk');
  assert.ok(maxCalls > 0);
});

test('decorateTrees: sem noise explícito gera o mesmo resultado que com o noise da seed', () => {
  const seed = 1337;
  const base = oldGenerateChunk(seed, 2, 3);
  const a = base.slice();
  const b = base.slice();
  decorateTrees(a, seed, 2, 3);
  decorateTrees(b, seed, 2, 3, makeNoise2D(seed));
  assert.deepEqual(a, b);
  assert.deepEqual(a, generateChunk(seed, 2, 3));
});

test('regra de escrita: tronco sobrescreve folha; folha só entra em AIR (nunca troca bloco existente)', () => {
  const seed = 1337;
  // uma árvore bem no interior de algum chunk (copa inteira dentro dele)
  let cx = 0;
  let cz = 0;
  let tree = null;
  for (cx = -3; cx <= 3 && !tree; cx++) {
    for (cz = -3; cz <= 3 && !tree; cz++) {
      tree = treesForChunk(seed, cx, cz).find(
        (t) => chunkCoord(t.x) === cx && chunkCoord(t.z) === cz &&
          localCoord(t.x) >= 3 && localCoord(t.x) <= 12 && localCoord(t.z) >= 3 && localCoord(t.z) <= 12
      );
      if (tree) break;
    }
    if (tree) break;
  }
  assert.ok(tree, 'sem árvore interior para o teste');
  const lx = localCoord(tree.x);
  const lz = localCoord(tree.z);

  const data = oldGenerateChunk(seed, chunkCoord(tree.x), chunkCoord(tree.z));
  // folha pré-existente no lugar de um bloco do tronco => vira madeira
  const trunkY = tree.groundY + 2;
  data[chunkIndex(lx, trunkY, lz)] = BLOCK.LEAVES;
  // pedra pré-existente no lugar de uma folha => continua pedra
  const leafY = tree.groundY + tree.trunk; // camada mais larga da copa
  data[chunkIndex(lx + 1, leafY, lz)] = BLOCK.STONE;
  // madeira pré-existente (ex.: bloco colocado) no lugar de uma folha => continua madeira
  data[chunkIndex(lx, leafY, lz + 1)] = BLOCK.WOOD;
  // tábua pré-existente => continua tábua
  data[chunkIndex(lx - 1, leafY, lz)] = BLOCK.PLANKS;

  decorateTrees(data, seed, chunkCoord(tree.x), chunkCoord(tree.z));
  assert.equal(data[chunkIndex(lx, trunkY, lz)], BLOCK.WOOD, 'tronco deve sobrescrever folha');
  assert.equal(data[chunkIndex(lx + 1, leafY, lz)], BLOCK.STONE);
  assert.equal(data[chunkIndex(lx, leafY, lz + 1)], BLOCK.WOOD);
  assert.equal(data[chunkIndex(lx - 1, leafY, lz)], BLOCK.PLANKS);

  // idempotente: decorar de novo não muda nada
  const copia = data.slice();
  decorateTrees(data, seed, chunkCoord(tree.x), chunkCoord(tree.z));
  assert.deepEqual(data, copia);
});
