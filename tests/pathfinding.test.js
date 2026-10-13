// Testes headless da feature 017 (caminho local): a busca PURA de `pathfinding.js`
// sobre grades de teste. Campo aberto, muro em U (com e sem abertura), ilha, degrau
// de 1 e de 2, queda de 2 e de 3, coluna e altura do corpo, desempate fixo, teto de
// nós, propriedades em mapas aleatórios semeados e custo medido (critério 5).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import { PATH, findPath, searchPath } from '../src/entities/pathfinding.js';

const FLOOR = 10; // o chão: tudo com y < FLOOR é sólido; os pés ficam em y = FLOOR

/**
 * Mundo de teste. `floorOf(x)` dá a altura do chão em cada coluna (padrão: FLOOR);
 * `blocks` são trios [x, y, z] de blocos extras. `walk` é a visão da busca
 * (`free` = pés e cabeça livres; `ground` = bloco logo abaixo dos pés é sólido).
 */
function world({ floorOf = () => FLOOR, blocks = [] } = {}) {
  const set = new Set(blocks.map(([x, y, z]) => `${x},${y},${z}`));
  const solid = (x, y, z) => y < floorOf(x) || set.has(`${x},${y},${z}`);
  const walk = {
    free: (x, y, z) => !solid(x, y, z) && !solid(x, y + 1, z),
    ground: (x, y, z) => solid(x, y - 1, z),
  };
  return { solid, walk };
}

/** Trios de um paralelepípedo [x0..x1] × [y0..y1] × [z0..z1]. */
function box(x0, y0, z0, x1, y1, z1) {
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]);
  return out;
}

const START = (x, z) => ({ x, y: FLOOR, z }); // pés no chão

/**
 * Cada passo é válido: anda 1 célula (sem diagonal), sobe no máximo 1, desce no
 * máximo MAX_DROP, e nenhum waypoint está num bloco sólido (cabe e tem chão).
 */
function assertWalkable(w, start, path) {
  let prev = start;
  for (const c of path) {
    const step = Math.abs(c.x - prev.x) + Math.abs(c.z - prev.z);
    assert.equal(step, 1, `passo de (${prev.x},${prev.z}) para (${c.x},${c.z}) não é de 1 célula`);
    const dy = c.y - prev.y;
    assert.ok(dy <= 1 && dy >= -PATH.MAX_DROP, `altura do passo em (${c.x},${c.z}): ${dy}`);
    assert.ok(w.walk.free(c.x, c.y, c.z), `(${c.x},${c.y},${c.z}) não cabe o corpo`);
    assert.ok(w.walk.ground(c.x, c.y, c.z), `(${c.x},${c.y},${c.z}) não tem chão`);
    prev = c;
  }
}

// Muro em U de 3 blocos de altura: base em x=3 (z −3..3) e braços em z=±3 (x 0..2).
// O zumbi começa dentro do U, em (0,0); o alvo está em (6,0), do lado de fora.
const U_WALL = [...box(3, FLOOR, -3, 3, FLOOR + 2, 3), ...box(0, FLOOR, -3, 2, FLOOR + 2, -3), ...box(0, FLOOR, 3, 2, FLOOR + 2, 3)];
const U_CLOSED = [...U_WALL, ...box(-1, FLOOR, -3, -1, FLOOR + 2, 3)]; // fecha a abertura a oeste

// ---------------------------------------------------------------------------
// Caminhos básicos
// ---------------------------------------------------------------------------

test('campo aberto: caminho reto e mínimo, sem o início, termina na coluna do alvo', () => {
  const w = world();
  assert.deepEqual(findPath(w.walk, START(0, 0), { x: 3, z: 0 }), [
    { x: 1, y: FLOOR, z: 0 },
    { x: 2, y: FLOOR, z: 0 },
    { x: 3, y: FLOOR, z: 0 },
  ]);
  const diag = findPath(w.walk, START(0, 0), { x: 2, z: 2 });
  assert.equal(diag.length, 4, 'diagonal = 4 passos de 1 célula');
  assertWalkable(w, START(0, 0), diag);
  assert.deepEqual(diag[3], { x: 2, y: FLOOR, z: 2 });
});

test('início já na coluna do alvo: caminho vazio (nada a andar)', () => {
  const w = world();
  assert.deepEqual(findPath(w.walk, START(5, 5), { x: 5, z: 5 }), []);
});

test('alvo fora da janela: null além de 2·PATH.RADIUS por eixo; no limite (2·RADIUS): acha', () => {
  const w = world();
  assert.equal(findPath(w.walk, START(0, 0), { x: 2 * PATH.RADIUS + 1, z: 0 }), null);
  assert.equal(findPath(w.walk, START(0, 0), { x: 0, z: -2 * PATH.RADIUS - 1 }), null);
  assert.ok(findPath(w.walk, START(0, 0), { x: 2 * PATH.RADIUS, z: 0 }) !== null);
  assert.ok(findPath(w.walk, START(0, 0), { x: 0, z: -2 * PATH.RADIUS }) !== null);
});

test('desempate fixo: ordem +X, −X, +Z, −Z; entre caminhos iguais, o de X primeiro', () => {
  const w = world();
  // Dois caminhos mínimos até (2,2); a busca fecha X antes de Z na fronteira.
  assert.deepEqual(findPath(w.walk, START(0, 0), { x: 2, z: 2 }), [
    { x: 1, y: FLOOR, z: 0 },
    { x: 2, y: FLOOR, z: 0 },
    { x: 2, y: FLOOR, z: 1 },
    { x: 2, y: FLOOR, z: 2 },
  ]);
});

// ---------------------------------------------------------------------------
// Muros, ilhas e obstáculos
// ---------------------------------------------------------------------------

test('muro em U de 3 blocos: sai pela abertura e contorna até o alvo (caminho longo e válido)', () => {
  const w = world({ blocks: U_WALL });
  const path = findPath(w.walk, START(0, 0), { x: 6, z: 0 });
  assert.ok(path !== null, 'há caminho pela abertura');
  assertWalkable(w, START(0, 0), path);
  assert.ok(path.length > 6, `contorna o muro (${path.length} passos > 6 da linha reta)`);
  assert.ok(path.some((c) => c.x < 0), 'sai do U pelo lado de fora (a oeste)');
  assert.deepEqual(path[path.length - 1], { x: 6, y: FLOOR, z: 0 });
});

test('muro em U fechado: o zumbi dentro não tem caminho para fora (null)', () => {
  const w = world({ blocks: U_CLOSED });
  assert.equal(findPath(w.walk, START(0, 0), { x: 6, z: 0 }), null);
});

test('ilha: alvo cercado por bloco sólido nos 4 lados não é alcançado (null), nem por dentro', () => {
  // anel de 3 blocos de altura em volta de (6,0); o centro fica vazio, mas inacessível
  const ring = [...box(5, FLOOR, -1, 7, FLOOR + 2, -1), ...box(5, FLOOR, 1, 7, FLOOR + 2, 1), ...box(5, FLOOR, 0, 5, FLOOR + 2, 0), ...box(7, FLOOR, 0, 7, FLOOR + 2, 0)];
  const w = world({ blocks: ring });
  assert.equal(findPath(w.walk, START(0, 0), { x: 6, z: 0 }), null);
  assert.equal(findPath(w.walk, START(0, 0), { x: 4, z: 0 }) !== null, true, 'o lado de fora segue acessível');
});

test('degrau de 1 bloco: sobe 1 em cima do degrau e desce de volta do outro lado', () => {
  const w = world({ blocks: box(3, FLOOR, -8, 3, FLOOR, 8) }); // parede baixa, longa demais para contornar na janela
  const path = findPath(w.walk, START(0, 0), { x: 6, z: 0 });
  assert.ok(path !== null, 'sobe o degrau');
  assertWalkable(w, START(0, 0), path);
  assert.ok(path.some((c) => c.x === 3 && c.y === FLOOR + 1), 'passa por cima do bloco, a 1 de altura');
  assert.deepEqual(path[path.length - 1], { x: 6, y: FLOOR, z: 0 });
});

test('degrau de 2 blocos: não sobe; contorna a ponta do muro (sem nunca cruzar o muro)', () => {
  // muro de 2 de altura em x = 3, de z = −8 a 8: a ponta em z = ±9 fica dentro da janela centrada
  const w = world({ blocks: box(3, FLOOR, -8, 3, FLOOR + 1, 8) });
  const path = findPath(w.walk, START(0, 0), { x: 6, z: 0 });
  assert.ok(path !== null, 'há volta pela ponta do muro');
  assert.ok(path.length > 6, 'a volta é mais longa que a reta: ' + path.length);
  assert.ok(path.every((c) => !(c.x === 3 && c.z >= -8 && c.z <= 8)), 'nenhum passo cruza o muro');
});

test('queda de 2 blocos é aceita; queda de 3 não (null)', () => {
  const dois = world({ floorOf: (x) => (x >= 3 ? FLOOR - 2 : FLOOR) });
  const path = findPath(dois.walk, START(0, 0), { x: 5, z: 0 });
  assert.ok(path !== null, 'desce 2');
  assertWalkable(dois, START(0, 0), path);
  assert.ok(path.some((c) => c.x === 3 && c.y === FLOOR - 2), 'pousa 2 blocos abaixo');

  const tres = world({ floorOf: (x) => (x >= 3 ? FLOOR - 3 : FLOOR) });
  assert.equal(findPath(tres.walk, START(0, 0), { x: 5, z: 0 }), null, 'queda de 3 é salto demais');
});

test('coluna de passagem bloqueada impede a descida (o corpo tem que caber durante a queda)', () => {
  const dois = world({ floorOf: (x) => (x >= 3 ? FLOOR - 2 : FLOOR) });
  // mesmo chão, mas a altura FLOOR−1 em x=3 não cabe o corpo (teto baixo): toda queda ali passa por ela
  const walk = {
    free: (x, y, z) => dois.walk.free(x, y, z) && !(x === 3 && y === FLOOR - 1),
    ground: dois.walk.ground,
  };
  assert.equal(findPath(walk, START(0, 0), { x: 5, z: 0 }), null, 'sem a coluna livre, não desce');
  assert.ok(findPath(dois.walk, START(0, 0), { x: 5, z: 0 }) !== null, 'controle: com a coluna livre, desce');
});

test('altura do corpo: passagem de 1 bloco de altura (teto baixo) não serve ao corpo de 2', () => {
  const wall = box(2, FLOOR, -8, 2, FLOOR + 1, 8).filter(([, , z]) => z !== 0); // parede com uma brecha em z=0
  const teto = world({ blocks: [...wall, [2, FLOOR + 1, 0]] }); // teto baixo sobre a brecha
  // a brecha de 1 de altura não serve: o caminho contorna a ponta do muro (não passa em z = 0)
  const contorno = findPath(teto.walk, START(0, 0), { x: 4, z: 0 });
  assert.ok(contorno !== null, 'há volta pela ponta do muro');
  assert.ok(!contorno.some((c) => c.x === 2 && c.z === 0), 'teto de 1 bloco não passa pela brecha');
  const aberta = world({ blocks: wall });
  const path = findPath(aberta.walk, START(0, 0), { x: 4, z: 0 });
  assert.ok(path !== null && path.some((c) => c.x === 2 && c.z === 0), 'controle: a brecha de 2 de altura passa');
});

// ---------------------------------------------------------------------------
// Limites e determinismo
// ---------------------------------------------------------------------------

test('teto de nós: com maxNodes pequeno a busca para (null) e nunca descobre mais que o teto', () => {
  const w = world();
  const pequena = searchPath(w.walk, START(0, 0), { x: 3, z: 0 }, { maxNodes: 10 });
  assert.equal(pequena.path, null, 'o teto acabou antes de chegar');
  assert.ok(pequena.visited <= 10, `descobertas ${pequena.visited} ≤ 10`);
  const cheia = searchPath(w.walk, START(0, 0), { x: 3, z: 0 });
  assert.ok(cheia.path !== null && cheia.visited <= PATH.MAX_NODES, 'com o teto padrão acha');
});

test('teto de nós padrão: busca que esgota a janela descobre no máximo PATH.MAX_NODES (e não é trivial)', () => {
  const w = world({ blocks: ring6() });
  const r = searchPath(w.walk, START(0, 0), { x: 6, z: 0 });
  assert.equal(r.path, null, 'alvo fechado num anel: nada a alcançar');
  assert.ok(r.visited <= PATH.MAX_NODES, `descobertas ${r.visited} ≤ ${PATH.MAX_NODES}`);
  assert.ok(r.visited > 200, `a janela inteira foi percorrida (${r.visited} células)`);
});

/** Anel de 3 blocos de altura em volta de (6,0) — o alvo fica sem acesso. */
function ring6() {
  return [...box(5, FLOOR, -1, 7, FLOOR + 2, -1), ...box(5, FLOOR, 1, 7, FLOOR + 2, 1), ...box(5, FLOOR, 0, 5, FLOOR + 2, 0), ...box(7, FLOOR, 0, 7, FLOOR + 2, 0)];
}

/** Mapa aleatório semeado: chão com alturas variando por coluna e blocos soltos sobre ele. */
function randomWorld(seed, density = 0.2) {
  const rng = makeRng(seed);
  const heights = new Map();
  for (let x = -9; x <= 9; x++) heights.set(x, FLOOR - rng.int(3)); // colunas com chão de FLOOR−2 a FLOOR
  const blocks = [];
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) {
      for (let y = FLOOR - 2; y <= FLOOR + 1; y++) {
        if (rng.chance(density)) blocks.push([x, y, z]);
      }
    }
  }
  return world({ floorOf: (x) => heights.get(x) ?? FLOOR, blocks });
}

test('determinismo: mesma entrada ⇒ mesmo caminho; mesma seed ⇒ mesmos caminhos em todo o mapa', () => {
  const coletar = (seed) => {
    const w = randomWorld(seed);
    const rng = makeRng(seed + 1000);
    const out = [];
    for (let i = 0; i < 40; i++) {
      const gx = rng.int(15) - 7;
      const gz = rng.int(15) - 7;
      out.push(findPath(w.walk, START(0, 0), { x: gx, z: gz }));
    }
    return out;
  };
  for (const seed of [3, 17, 99]) {
    assert.deepEqual(coletar(seed), coletar(seed), `seed ${seed}`);
  }
  const w = randomWorld(5);
  const a = findPath(w.walk, START(0, 0), { x: 4, z: -3 });
  const b = findPath(w.walk, START(0, 0), { x: 4, z: -3 });
  assert.deepEqual(a, b, 'a mesma busca repetida dá o mesmo resultado');
});

test('propriedades em mapas aleatórios: o caminho nunca passa por bloco sólido nem dá passo inválido', () => {
  let comCaminho = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = randomWorld(seed);
    const rng = makeRng(seed * 7 + 3);
    for (let i = 0; i < 8; i++) {
      const gx = rng.int(17) - 8;
      const gz = rng.int(17) - 8;
      const path = findPath(w.walk, START(0, 0), { x: gx, z: gz });
      if (path === null) continue;
      if (path.length > 0) comCaminho++;
      assertWalkable(w, START(0, 0), path);
      if (path.length > 0) {
        const last = path[path.length - 1];
        assert.deepEqual([last.x, last.z], [gx, gz], 'termina na coluna do alvo');
      }
    }
  }
  assert.ok(comCaminho > 100, `mapas com caminho de verdade (${comCaminho} buscas)`);
});

// ---------------------------------------------------------------------------
// Custo (critério 5 da spec: média < 0,3 ms por busca). Medida, não asserta:
// tempo de parede varia de máquina para máquina; o número vai para o diagnóstico.
// ---------------------------------------------------------------------------

test('custo: tempo médio de findPath por busca, em campo aberto e no pior caso (janela inteira)', (t) => {
  const aberto = randomWorld(11, 0.12);
  const goals = [];
  const rng = makeRng(11);
  for (let i = 0; i < 40; i++) goals.push({ x: rng.int(15) - 7, z: rng.int(15) - 7 });
  const cercado = world({ blocks: ring6() }); // o alvo fica fora de alcance: a busca percorre a janela toda

  const medir = (walk, alvos, reps) => {
    for (const g of alvos) findPath(walk, START(0, 0), g); // aquecimento
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) for (const g of alvos) findPath(walk, START(0, 0), g);
    return (performance.now() - t0) / (reps * alvos.length);
  };
  const msAberto = medir(aberto.walk, goals, 50);
  const msPior = medir(cercado.walk, [{ x: 6, z: 0 }], 2000);
  t.diagnostic(`findPath médio: campo ${msAberto.toFixed(4)} ms por busca; pior caso (janela inteira) ${msPior.toFixed(4)} ms por busca`);
  assert.ok(Number.isFinite(msAberto) && Number.isFinite(msPior));
});

test('degrau com teto sobre a origem: o corpo não sobe por cima dele; o caminho não começa com o degrau', () => {
  // degrau de 1 bloco em (1, FLOOR, 0); teto em (0, FLOOR + 2, 0), logo sobre o início
  const w = world({ blocks: [[1, FLOOR, 0], [0, FLOOR + 2, 0]] });
  const path = findPath(w.walk, START(0, 0), { x: 1, z: 0 });
  assert.ok(path !== null, 'contorna pelo lado');
  assert.ok(path.length > 1, 'não sobe direto no degrau');
  assert.notDeepEqual(path[0], { x: 1, y: FLOOR + 1, z: 0 });
});
