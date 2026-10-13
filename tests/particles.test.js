// Testes headless do feedback visual de quebra e combate (spec 018): src/fx/particles.js
// sem DOM e sem renderer. O `scene` é falso; o InstancedMesh é o real do Three.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createParticles, FX } from '../src/fx/particles.js';
import { makeRng } from '../src/rng.js';
import { MOB_DEFS } from '../src/entities/mobs.js';

const DT = 1 / 60;
const HALF = 0.06; // metade da aresta do cubinho: é a altura de repouso sobre um chão

/** Scene falso: guarda o que foi adicionado e removido. */
function fakeScene() {
  return {
    added: [],
    removed: [],
    add(o) {
      this.added.push(o);
    },
    remove(o) {
      this.removed.push(o);
    },
  };
}

function make(seed = 1, max = FX.MAX) {
  const scene = fakeScene();
  const fx = createParticles(scene, { max, rng: makeRng(seed) });
  return { fx, scene, mesh: scene.added[0] };
}

/** Escala de cada instância (comprimento da coluna 0 da matriz); 0 = slot morto. */
function scaleOf(mesh, i) {
  const m = mesh.instanceMatrix.array;
  return Math.hypot(m[i * 16], m[i * 16 + 1], m[i * 16 + 2]);
}

/** Translação (centro) de cada instância. */
function posOf(mesh, i) {
  const m = mesh.instanceMatrix.array;
  return { x: m[i * 16 + 12], y: m[i * 16 + 13], z: m[i * 16 + 14] };
}

/** Índices das instâncias visíveis (escala > 0). */
function visibleIdx(mesh) {
  const out = [];
  for (let i = 0; i < mesh.count; i++) if (scaleOf(mesh, i) > 1e-6) out.push(i);
  return out;
}

/** Cor (linear, como o Three guarda) de uma instância, arredondada para comparar. */
function colorOf(mesh, i) {
  const a = mesh.instanceColor.array;
  return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]].map((v) => +v.toFixed(5));
}

function expectedColor(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b].map((v) => +v.toFixed(5));
}

test('constantes da spec: vida 0,6 s, gravidade 14, teto 96', () => {
  assert.deepEqual(FX, { LIFE: 0.6, GRAVITY: 14, MAX: 96 });
});

test('emit: exatamente `count` partículas vivas e visíveis; count 0 não emite', () => {
  const { fx, mesh } = make();
  assert.equal(fx.alive(), 0);
  assert.equal(visibleIdx(mesh).length, 0, 'pool começa invisível');

  fx.emit(0.5, 10.5, 0.5, 0x8d8d92, 8);
  assert.equal(fx.alive(), 8, 'quebra de pedra: 8 cubinhos');
  assert.equal(visibleIdx(mesh).length, 8, 'e 8 instâncias visíveis');

  fx.emit(0.5, 10.5, 0.5, 0x8d8d92, 0);
  assert.equal(fx.alive(), 8, 'count 0 não solta nada');
});

test('cor por instância: cada slot leva a cor do emit que o criou', () => {
  const { fx, mesh } = make();
  fx.emit(0.5, 10.5, 0.5, 0xff0000, 8);
  fx.emit(0.5, 10.5, 0.5, 0x00ff00, 2);
  for (let i = 0; i < 8; i++) assert.deepEqual(colorOf(mesh, i), expectedColor(0xff0000), `slot ${i}`);
  for (let i = 8; i < 10; i++) assert.deepEqual(colorOf(mesh, i), expectedColor(0x00ff00), `slot ${i}`);
});

test('cor de criatura: 6 cubinhos na cor do porco (MOB_DEFS.pig.color)', () => {
  const { fx, mesh } = make();
  fx.emit(2.0, 10.4, 0.5, MOB_DEFS.pig.color, 6);
  const rows = visibleIdx(mesh).map((i) => colorOf(mesh, i));
  assert.equal(rows.length, 6);
  for (const c of rows) assert.deepEqual(c, expectedColor(MOB_DEFS.pig.color));
});

test('cada tipo de criatura tem cor base (usada pelo golpe)', () => {
  for (const kind of ['pig', 'sheep', 'zombie', 'creeper']) {
    assert.equal(typeof MOB_DEFS[kind].color, 'number', kind);
  }
});

test('vida: 0,6 s por partícula; encolhe com a vida e some ao fim', () => {
  const { fx, mesh } = make();
  fx.emit(0.5, 10.5, 0.5, 0x8d8d92, 1);
  assert.ok(Math.abs(scaleOf(mesh, 0) - 1) < 1e-6, 'nasce em tamanho cheio');

  fx.update(0.3);
  assert.ok(Math.abs(scaleOf(mesh, 0) - 0.5) < 1e-4, 'na metade da vida, metade do tamanho');

  fx.update(0.2); // 0,5 s
  assert.equal(fx.alive(), 1, 'ainda viva em 0,5 s');

  fx.update(0.15); // 0,65 s
  assert.equal(fx.alive(), 0, 'expirada depois de 0,6 s');
  assert.equal(visibleIdx(mesh).length, 0, 'slot morto fica com escala zero');
});

test('teto: 200 quebras seguidas (8 cubinhos cada) nunca passam de 96 vivas', () => {
  const { fx } = make(5);
  for (let i = 0; i < 200; i++) {
    fx.emit((i % 16) + 0.5, 10.5, 0.5, 0xb9925a, 8);
    assert.ok(fx.alive() <= FX.MAX, `quebra ${i}: ${fx.alive()} vivas`);
  }
  assert.equal(fx.alive(), FX.MAX, 'o pool satura exatamente em 96');
});

test('teto com tempo passando: o pool continua limitado e reaproveita slots', () => {
  const { fx, mesh } = make(6);
  let peak = 0;
  for (let i = 0; i < 200; i++) {
    fx.emit((i % 16) + 0.5, 10.5, 0.5, 0x8b5a2b, 8);
    peak = Math.max(peak, fx.alive());
    fx.update(DT);
  }
  assert.ok(peak <= FX.MAX, `pico ${peak}`);
  assert.equal(mesh.count, FX.MAX, 'o InstancedMesh nunca cresce além do pool');
});

test('pool cheio: o efeito novo entra e rouba das partículas mais antigas', () => {
  const { fx, mesh } = make(3, 4);
  fx.emit(0.5, 10.5, 0.5, 0xff0000, 4); // enche o pool de 4
  fx.emit(0.5, 10.5, 0.5, 0x00ff00, 2); // pool cheio: 2 novas tomam lugar
  assert.equal(fx.alive(), 4, 'continua no teto de 4');
  const greens = visibleIdx(mesh).filter((i) => colorOf(mesh, i).join() === expectedColor(0x00ff00).join());
  assert.equal(greens.length, 2, 'as duas verdes estão visíveis');
});

test('partículas não atravessam o topo do bloco (param em floor + metade do cubinho)', () => {
  const { fx, mesh } = make(9);
  // Bloco quebrado na célula y = 10: o centro sai em 10,5 e o bloco de baixo tem topo em 10,
  // então o repouso dos cubinhos é 10 + HALF. O impulso para baixo garante que todos
  // cheguem ao chão antes de acabar a vida (sem ele, dependeria do sorteio da seed).
  fx.emit(5.5, 10.5, 5.5, 0x7a7a80, 8, { x: 0, y: -3, z: 0 });
  const rest = 10 + HALF;
  const landedSlots = new Set();
  for (let step = 0; step < 60; step++) {
    fx.update(DT);
    for (const i of visibleIdx(mesh)) {
      const y = posOf(mesh, i).y;
      assert.ok(y >= rest - 1e-4, `passo ${step}, slot ${i}: y=${y} atravessou o chão`);
      if (Math.abs(y - rest) < 1e-3) landedSlots.add(i);
    }
  }
  assert.equal(landedSlots.size, 8, 'os 8 cubinhos chegaram ao topo e pararam nele');
});

test('impulso: com `impulse` o grupo anda no sentido do golpe', () => {
  const { fx, mesh } = make(21);
  fx.emit(0.5, 10.5, 0.5, 0xffffff, 40, { x: 3, y: 0, z: 0 });
  fx.update(0.1);
  const xs = visibleIdx(mesh).map((i) => posOf(mesh, i).x);
  assert.equal(xs.length, 40);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(mean - 0.5 > 0.2, `média andou ${(mean - 0.5).toFixed(3)} para +x (esperado ~0,3)`);
});

test('determinismo: mesma seed e mesma sequência => mesmas matrizes e cores', () => {
  const run = (seed) => {
    const { fx, mesh } = make(seed);
    for (let i = 0; i < 60; i++) {
      fx.emit(i * 0.3, 10.5, 0.5, i % 2 ? 0x6ab04c : 0x8b5a2b, 8, { x: 1, y: 0, z: 0 });
      fx.update(DT);
    }
    return {
      matrix: Array.from(mesh.instanceMatrix.array),
      colors: Array.from(mesh.instanceColor.array),
      alive: fx.alive(),
    };
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42).matrix, run(43).matrix, 'outra seed muda as direções');
});

test('sem rng injetado não há sorteio escondido: createParticles exige o rng', () => {
  assert.throws(() => createParticles(fakeScene()), /rng/);
});

test('o módulo não usa Math.random (constitution)', () => {
  const src = readFileSync(new URL('../src/fx/particles.js', import.meta.url), 'utf8');
  assert.equal(/Math\.random/.test(src), false);
});

test('dispose: sai da cena, zera o pool e emit depois disso não faz nada', () => {
  const { fx, scene, mesh } = make();
  fx.emit(0.5, 10.5, 0.5, 0xffffff, 8);
  fx.dispose();
  assert.equal(scene.removed[0], mesh);
  assert.equal(fx.alive(), 0);
  fx.emit(0.5, 10.5, 0.5, 0xffffff, 8);
  assert.equal(fx.alive(), 0);
});
