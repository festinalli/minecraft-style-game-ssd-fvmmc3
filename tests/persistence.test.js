import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAME_VERSION,
  makeGame,
  sanitizeGame,
  serializeChunks,
  deserializeChunks,
  saveWorld,
  loadWorld,
  clearWorld,
  hasSave,
  sanitizePlayer,
} from '../src/world/persistence.js';
import { makeRng } from '../src/rng.js';
import { createStats, MODE } from '../src/game/stats.js';
import { createInventory } from '../src/game/inventory.js';

// ---------------------------------------------------------------------------
// Fixture: um save v2 EXATAMENTE como a Parte 1 gravava (sem o campo `game`).
// "AQID/w==" = [1, 2, 3, 255]; "BAUG" = [4, 5, 6].
// Escrita à mão de propósito: não depende do código novo para ser produzida.
// ---------------------------------------------------------------------------
const PART1_SAVE =
  '{"v":2,"seed":1337,"player":{"x":0.5,"y":30.25,"z":-12},"chunks":{"0,0":"AQID/w==","-1,2":"BAUG"}}';

// Cópia do leitor da Parte 1 (antes desta feature), para provar que um build
// ANTIGO ainda lê um save NOVO (o campo extra é ignorado).
function legacyDeserialize(str) {
  let obj;
  try {
    obj = JSON.parse(str);
  } catch {
    return null;
  }
  if (!obj || obj.v !== 2 || typeof obj.chunks !== 'object') return null;
  const chunks = [];
  try {
    for (const key of Object.keys(obj.chunks)) {
      const bin = atob(obj.chunks[key]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      chunks.push([key, out]);
    }
  } catch {
    return null;
  }
  return { seed: obj.seed, player: obj.player, chunks };
}

const bytesEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function randomBytes(length, seed) {
  const rng = makeRng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.int(256);
  return out;
}

function gameFixture() {
  const stats = createStats();
  stats.damage(6);
  stats.addKill();
  stats.addKill();
  const inventory = createInventory();
  inventory.giveStarterKit();
  inventory.addBlock(3, 21); // pedra
  inventory.select(4);
  return makeGame({ mode: MODE.SURVIVAL, seconds: 321.5, stats: stats.toJSON(), inventory: inventory.toJSON() });
}

// --- formato antigo (regressão) ---

test('serializeChunks sem game: JSON idêntico ao formato da Parte 1 (sem a chave game)', () => {
  const entries = [
    ['0,0', new Uint8Array([1, 2, 3, 255])],
    ['-1,2', new Uint8Array([4, 5, 6])],
  ];
  const player = { x: 0.5, y: 30.25, z: -12 };
  const out = serializeChunks(entries, 1337, player);
  assert.equal(out, PART1_SAVE);
  assert.equal(serializeChunks(entries, 1337, player, undefined), PART1_SAVE);
  assert.equal(serializeChunks(entries, 1337, player, null), PART1_SAVE);
  assert.ok(!('game' in JSON.parse(out)));
});

test('save v2 da Parte 1 (fixture) carrega: seed, player, chunks e game = null', () => {
  const r = deserializeChunks(PART1_SAVE);
  assert.ok(r, 'o save antigo tem que carregar');
  assert.equal(r.seed, 1337);
  assert.deepEqual(r.player, { x: 0.5, y: 30.25, z: -12 });
  assert.equal(r.game, null);
  assert.equal(r.chunks.length, 2);
  const byKey = new Map(r.chunks);
  assert.deepEqual([...byKey.get('0,0')], [1, 2, 3, 255]);
  assert.deepEqual([...byKey.get('-1,2')], [4, 5, 6]);
  assert.ok(byKey.get('0,0') instanceof Uint8Array);
});

test('VERSION continua 2: v diferente de 2, JSON inválido e chunks malformados => null', () => {
  const base = JSON.parse(PART1_SAVE);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, v: 1 })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, v: 3 })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, v: '2' })), null);
  assert.equal(deserializeChunks('{nao e json'), null);
  assert.equal(deserializeChunks(''), null);
  assert.equal(deserializeChunks('null'), null);
  assert.equal(deserializeChunks('42'), null);
  assert.equal(deserializeChunks('[]'), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, chunks: null })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, chunks: [] })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, chunks: 'x' })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, chunks: { '0,0': '###' } })), null);
  assert.equal(deserializeChunks(JSON.stringify({ ...base, chunks: { '0,0': 123 } })), null);
  const noChunks = { ...base };
  delete noChunks.chunks;
  assert.equal(deserializeChunks(JSON.stringify(noChunks)), null);
});

test('save sem nenhum chunk modificado carrega com lista vazia', () => {
  const r = deserializeChunks(serializeChunks([], 7, { x: 1, y: 2, z: 3 }));
  assert.deepEqual(r.chunks, []);
  assert.equal(r.seed, 7);
  assert.equal(r.game, null);
});

// --- round-trip com e sem game ---

test('round-trip sem game: chunks idênticos byte a byte, game = null', () => {
  const entries = [
    ['0,0', randomBytes(300, 1)],
    ['3,-4', randomBytes(77, 2)],
  ];
  const r = deserializeChunks(serializeChunks(entries, 99, { x: 1, y: 2, z: 3 }));
  assert.equal(r.seed, 99);
  assert.deepEqual(r.player, { x: 1, y: 2, z: 3 });
  assert.equal(r.game, null);
  assert.equal(r.chunks.length, entries.length);
  entries.forEach(([key, data], i) => {
    assert.equal(r.chunks[i][0], key);
    assert.ok(bytesEqual(r.chunks[i][1], data), key);
  });
});

test('round-trip com game: game volta igual e os chunks seguem idênticos', () => {
  const entries = [['2,2', randomBytes(1000, 3)]];
  const game = gameFixture();
  const str = serializeChunks(entries, 5, { x: 9, y: 9, z: 9 }, game);
  assert.deepEqual(JSON.parse(str).game, game);
  const r = deserializeChunks(str);
  assert.deepEqual(r.game, game);
  assert.equal(r.game.v, GAME_VERSION);
  assert.ok(bytesEqual(r.chunks[0][1], entries[0][1]));
  assert.equal(r.seed, 5);
});

test('compat para frente: um leitor ANTIGO lê um save novo e ignora o game', () => {
  const entries = [['0,0', randomBytes(500, 4)]];
  const str = serializeChunks(entries, 11, { x: 0, y: 40, z: 0 }, gameFixture());
  const old = legacyDeserialize(str);
  assert.ok(old);
  assert.equal(old.seed, 11);
  assert.ok(bytesEqual(old.chunks[0][1], entries[0][1]));
  assert.ok(!('game' in old));
});

test('fim a fim: stats + inventário => game => save => load => estado idêntico', () => {
  const stats = createStats();
  stats.damage(9);
  stats.addKill();
  const inv = createInventory();
  inv.giveStarterKit();
  inv.addBlock(5, 33);
  inv.select(9);

  const game = makeGame({ mode: stats.mode, seconds: 4242.75, stats: stats.toJSON(), inventory: inv.toJSON() });
  const loaded = deserializeChunks(serializeChunks([], 1, { x: 0, y: 0, z: 0 }, game)).game;

  const stats2 = createStats();
  const inv2 = createInventory();
  assert.equal(stats2.fromJSON(loaded.stats), true);
  assert.equal(inv2.fromJSON(loaded.inventory), true);
  stats2.setMode(loaded.mode);
  inv2.setMode(loaded.mode);
  assert.equal(loaded.seconds, 4242.75);
  assert.deepEqual(stats2.toJSON(), stats.toJSON());
  assert.deepEqual(inv2.toJSON(), inv.toJSON());
});

// --- game corrompido nunca derruba o load ---

test('game corrompido nunca derruba o load: chunks seguem válidos', () => {
  const entries = [['0,0', randomBytes(256, 5)]];
  const corrupt = [
    'texto',
    '',
    42,
    0,
    true,
    false,
    [],
    [1, 2, 3],
    {},
    { v: 2 },
    { v: '1' },
    { v: 0 },
    { v: null, stats: {} },
    { mode: 'survival', stats: {}, inventory: {} }, // sem v
  ];
  for (const bad of corrupt) {
    const str = serializeChunks(entries, 3, { x: 1, y: 2, z: 3 }, bad);
    const r = deserializeChunks(str);
    assert.ok(r, `load não pode falhar com game=${JSON.stringify(bad)}`);
    assert.equal(r.game, null, JSON.stringify(bad));
    assert.equal(r.seed, 3);
    assert.ok(bytesEqual(r.chunks[0][1], entries[0][1]));
  }
});

test('game corrompido direto no JSON do disco (inclusive profundo) também não quebra', () => {
  const base = JSON.parse(PART1_SAVE);
  const variants = [
    { ...base, game: 'lixo' },
    { ...base, game: { v: 1, stats: 'x', inventory: [1, 2], mode: 5, seconds: 'abc' } },
    { ...base, game: { v: 1, stats: { hp: 'x', deep: { a: { b: [1, 2, { c: 1 }] } } } } },
    { ...base, game: { __proto__: null, v: 99 } },
  ];
  for (const v of variants) {
    const r = deserializeChunks(JSON.stringify(v));
    assert.ok(r);
    assert.equal(r.chunks.length, 2);
    assert.equal(r.seed, 1337);
  }
});

test('sanitizeGame: irreconhecível => null', () => {
  for (const bad of [undefined, null, 'x', 5, true, [], [1], {}, { v: 2 }, { v: '1' }, { v: 0 }]) {
    assert.equal(sanitizeGame(bad), null, JSON.stringify(bad));
  }
});

test('sanitizeGame: campo ruim vira null e os bons passam', () => {
  assert.deepEqual(sanitizeGame({ v: 1 }), { v: 1, mode: null, seconds: null, stats: null, inventory: null });
  assert.deepEqual(
    sanitizeGame({ v: 1, mode: 'god', seconds: -1, stats: 'x', inventory: [1] }),
    { v: 1, mode: null, seconds: null, stats: null, inventory: null }
  );
  for (const badSeconds of [NaN, Infinity, -0.001, '5', null, {}]) {
    assert.equal(sanitizeGame({ v: 1, seconds: badSeconds }).seconds, null, String(badSeconds));
  }
  const good = sanitizeGame({ v: 1, mode: 'creative', seconds: 0, stats: { hp: 3 }, inventory: {}, extra: 'x' });
  assert.deepEqual(good, { v: 1, mode: 'creative', seconds: 0, stats: { hp: 3 }, inventory: {} });
  assert.ok(!('extra' in good), 'campos desconhecidos não passam');
});

test('makeGame: monta o envelope versionado', () => {
  const g = makeGame({ mode: 'creative', seconds: 10, stats: { a: 1 }, inventory: { b: 2 } });
  assert.deepEqual(g, { v: GAME_VERSION, mode: 'creative', seconds: 10, stats: { a: 1 }, inventory: { b: 2 } });
  assert.deepEqual(sanitizeGame(g), g);
});

// --- base64 grande ---

// Tamanho de um chunk cheio: 16 x 16 x 48 (CHUNK_SIZE² x WORLD_HEIGHT em world.js).
// Fixo aqui de propósito: world.js puxa Three/atlas e não é importável no Node.
const FULL_CHUNK = 16 * 16 * 48;

test('base64 grande: chunk cheio com todos os valores 0-255 sobrevive byte a byte', () => {
  const data = new Uint8Array(FULL_CHUNK);
  for (let i = 0; i < data.length; i++) data[i] = i % 256; // cobre os 256 valores
  const r = deserializeChunks(serializeChunks([['0,0', data]], 1, null));
  assert.ok(bytesEqual(r.chunks[0][1], data));
});

test('base64 grande: tamanhos de borda (padding e bloco interno de 0x8000)', () => {
  const sizes = [0, 1, 2, 3, 4, 5, 0x7fff, 0x8000, 0x8001, 0x10000, 0x10001, FULL_CHUNK, 300001];
  for (const size of sizes) {
    const data = randomBytes(size, size + 1);
    const r = deserializeChunks(serializeChunks([['0,0', data]], 1, null));
    assert.equal(r.chunks[0][1].length, size, `tamanho ${size}`);
    assert.ok(bytesEqual(r.chunks[0][1], data), `conteúdo ${size}`);
  }
});

test('base64 grande: muitos chunks cheios + game no mesmo save', () => {
  const entries = [];
  for (let i = 0; i < 24; i++) entries.push([`${i},${-i}`, randomBytes(FULL_CHUNK, 100 + i)]);
  const game = gameFixture();
  const str = serializeChunks(entries, 2026, { x: 1, y: 2, z: 3 }, game);
  assert.ok(str.length > 24 * FULL_CHUNK, 'o save é grande de verdade');
  const r = deserializeChunks(str);
  assert.equal(r.chunks.length, 24);
  entries.forEach(([key, data], i) => {
    assert.equal(r.chunks[i][0], key);
    assert.ok(bytesEqual(r.chunks[i][1], data), key);
  });
  assert.deepEqual(r.game, game);
});

// --- wrappers de browser (localStorage simulado) ---

function fakeStorage() {
  const store = new Map();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
}

function withStorage(fake, fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  }
}

function fakeWorld() {
  const a = randomBytes(FULL_CHUNK, 7);
  const b = randomBytes(FULL_CHUNK, 8);
  return {
    seed: 4321,
    modified: new Set(['0,0', '5,5']), // '5,5' foi modificado mas sem dados (descartado)
    chunks: new Map([
      ['0,0', a],
      ['1,1', b], // não modificado: não deve ser salvo
    ]),
    a,
  };
}

test('saveWorld/loadWorld: ciclo completo com game; só chunks modificados; chave v2', () => {
  const storage = fakeStorage();
  const world = fakeWorld();
  const game = gameFixture();
  withStorage(storage, () => {
    assert.equal(hasSave(), false);
    assert.equal(loadWorld(), null);
    assert.equal(saveWorld(world, { x: 1, y: 2, z: 3 }, game), true);
    assert.equal(hasSave(), true);
    assert.deepEqual([...storage.store.keys()], ['voxelcraft.save.v2']);

    const r = loadWorld();
    assert.equal(r.seed, 4321);
    assert.deepEqual(r.player, { x: 1, y: 2, z: 3 });
    assert.deepEqual(r.game, game);
    assert.equal(r.chunks.length, 1);
    assert.equal(r.chunks[0][0], '0,0');
    assert.ok(bytesEqual(r.chunks[0][1], world.a));
  });
});

test('saveWorld sem game (chamada da Parte 1): grava o formato antigo e loadWorld devolve game = null', () => {
  const storage = fakeStorage();
  const world = fakeWorld();
  withStorage(storage, () => {
    assert.equal(saveWorld(world, { x: 1, y: 2, z: 3 }), true);
    assert.ok(!('game' in JSON.parse(storage.store.get('voxelcraft.save.v2'))));
    const r = loadWorld();
    assert.equal(r.game, null);
    assert.equal(r.chunks.length, 1);
  });
});

test('loadWorld carrega o save da Parte 1 já presente no localStorage', () => {
  const storage = fakeStorage();
  storage.store.set('voxelcraft.save.v2', PART1_SAVE);
  withStorage(storage, () => {
    const r = loadWorld();
    assert.equal(r.seed, 1337);
    assert.equal(r.game, null);
    assert.equal(r.chunks.length, 2);
  });
});

test('clearWorld apaga o save (hasSave volta a false)', () => {
  const storage = fakeStorage();
  withStorage(storage, () => {
    saveWorld(fakeWorld(), { x: 0, y: 0, z: 0 }, gameFixture());
    assert.equal(hasSave(), true);
    clearWorld();
    assert.equal(hasSave(), false);
    assert.equal(loadWorld(), null);
  });
});

test('storage com falha (cota cheia / bloqueado): nunca lança', () => {
  const throwing = {
    getItem() {
      throw new Error('bloqueado');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('bloqueado');
    },
  };
  withStorage(throwing, () => {
    assert.equal(saveWorld(fakeWorld(), { x: 0, y: 0, z: 0 }, gameFixture()), false);
    assert.equal(loadWorld(), null);
    assert.equal(hasSave(), false);
    assert.doesNotThrow(() => clearWorld());
  });
});

test('save corrompido no localStorage => loadWorld devolve null (jogo começa do zero)', () => {
  const storage = fakeStorage();
  storage.store.set('voxelcraft.save.v2', '{"v":2,"chunks":{"0,0":"@@@"}}');
  withStorage(storage, () => assert.equal(loadWorld(), null));
});

// --- qualidade ---

test('persistence.js: sem Math.random() e sem console.log; chave e versão do save inalteradas', () => {
  const src = readFileSync(new URL('../src/world/persistence.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('Math.random'));
  assert.ok(!src.includes('console.log'));
  assert.ok(src.includes("const VERSION = 2;"));
  assert.ok(src.includes("const KEY = 'voxelcraft.save.v2';"));
});

test('sanitizePlayer: só aceita 3 números finitos (nunca NaN/Infinity/texto no mundo)', () => {
  assert.deepEqual(sanitizePlayer({ x: 1, y: 2.5, z: -3 }), { x: 1, y: 2.5, z: -3 });
  for (const bad of [null, undefined, 5, 'x', [], {}, { x: 1, y: 2 }, { x: NaN, y: 1, z: 1 }, { x: 1, y: Infinity, z: 1 }, { x: '1', y: 1, z: 1 }]) {
    assert.equal(sanitizePlayer(bad), null, JSON.stringify(bad));
  }
});

test('deserializeChunks: player corrompido vira null, sem derrubar chunks nem game', () => {
  const json = JSON.stringify({ v: 2, seed: 1337, player: { x: 'a', y: null, z: 3 }, chunks: {}, game: { v: 1, mode: 'creative' } });
  const r = deserializeChunks(json);
  assert.equal(r.player, null);
  assert.equal(r.seed, 1337);
  assert.equal(r.game.mode, 'creative');
});
