// Testes headless da feature 013 (gerenciador de mobs): física, passivos, zumbi,
// queima, dano/morte, creeper/explosão, população, despawn, raycast,
// determinismo e orçamento de CPU. Mundo plano artificial (rápido, controlado)
// e o mundo real da seed 1337.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World, WORLD_HEIGHT } from '../src/world/world.js';
import { CHUNK_VOLUME, chunkIndex } from '../src/world/terrain.js';
import { BLOCK, isSolid } from '../src/blocks.js';
import { makeRng } from '../src/rng.js';
import { DAY_LENGTH, dayNumber, isNight } from '../src/game/time.js';
import { MOB_DEFS, MOB_KINDS, SPAWN } from '../src/entities/mobs.js';
import { collidesBox } from '../src/entities/physics.js';
import { PLAYER } from '../src/player/collision.js';
import { AI, STATE } from '../src/entities/ai.js';
import { createMobManager } from '../src/entities/manager.js';

const DT = 1 / 60;
const SEED = 1337;
const S = 10; // altura da superfície do mundo plano (camadas 0..S-1 sólidas; pés em y = S)
const NIGHT = DAY_LENGTH * 0.75; // dia 1, meia-noite
const NOON = DAY_LENGTH * 0.25; // dia 1, meio-dia

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

/**
 * Mundo plano artificial: chunks [-half, half) viram pedra até S-1 e `top` na
 * camada de cima. O topo padrão (pedregulho) não está em nenhum `spawn.on`, então
 * NADA nasce sozinho — o teste controla quem existe. Use `top: BLOCK.GRASS` para
 * testar o spawn natural.
 */
function flatWorld({ surface = S, half = 5, top = BLOCK.COBBLE } = {}) {
  const w = new World(1);
  for (let cx = -half; cx < half; cx++) {
    for (let cz = -half; cz < half; cz++) {
      const d = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y < surface; y++) d[chunkIndex(x, y, z)] = y === surface - 1 ? top : BLOCK.STONE;
        }
      }
      w.applyChunk(cx, cz, d);
    }
  }
  return w;
}

function fill(w, x0, y0, z0, x1, y1, z1, block = BLOCK.STONE) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) w.setBlock(x, y, z, block);
}

/** Mundo real da seed 1337 com os chunks [-r, r] já gerados (o spawn periódico exige chunk gerado). */
function realWorld(r = 4) {
  const w = new World(SEED);
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.getChunkData(cx, cz);
  return w;
}

const P = (x, y, z, o = {}) => ({ pos: { x, y, z }, alive: true, mode: 'survival', ...o });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b} ± ${eps}, veio ${a}`);

/** Roda `seconds` s. `ctxOf(i)` ou um ctx fixo. Devolve os eventos com `t` (s). */
function run(mgr, seconds, ctxOf, onFrame) {
  const events = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const ctx = typeof ctxOf === 'function' ? ctxOf(i) : ctxOf;
    const ev = mgr.update(DT, ctx);
    for (const e of ev) events.push({ ...e, t: (i + 1) * DT });
    if (onFrame) onFrame(i, ev);
  }
  return events;
}

const ofType = (events, type) => events.filter((e) => e.type === type);

/**
 * Views falsas: registram tudo, e a posição de spawn é a 1ª chamada de
 * `position.set` — `onSpawn(view, x, y, z)` roda nesse instante, com o mundo
 * exatamente como estava quando o mob nasceu.
 */
function spyViews(onSpawn) {
  const views = [];
  const scene = { added: [], add(o) { this.added.push(o); } };
  const makeView = (kind, opts) => {
    const v = {
      kind,
      opts,
      positions: [],
      states: [],
      disposed: 0,
      object: {
        rotation: { y: 0 },
        position: {
          set(x, y, z) {
            v.positions.push([x, y, z]);
            if (v.positions.length === 1 && onSpawn) onSpawn(v, x, y, z);
          },
        },
      },
      update(dt, s) {
        v.states.push({ dt, ...s });
      },
      dispose() {
        v.disposed++;
      },
    };
    views.push(v);
    return v;
  };
  return { scene, makeView, views };
}

function newManager(world, seed = 1, extra = {}) {
  const rng = makeRng(seed);
  return { rng, mgr: createMobManager({ world, rng, ...extra }) };
}

/** Mata na hora (o dano devolve o resultado). */
const kill = (mgr, mob) => mgr.damage(mob, mob.def.maxHp * 10, { fromX: mob.body.pos.x + 1, fromZ: mob.body.pos.z });

// ---------------------------------------------------------------------------
// API básica
// ---------------------------------------------------------------------------

test('spawn/count: cria com os números do def, ids únicos, variante da ovelha, tipo desconhecido lança', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 3);
  const pig = mgr.spawn('pig', 4.5, S, 2.5);
  const zombie = mgr.spawn('zombie', -4.5, S, 2.5);
  assert.notEqual(pig.id, zombie.id);
  assert.equal(mgr.mobs.get(pig.id), pig);
  assert.equal(pig.kind, 'pig');
  assert.equal(pig.def, MOB_DEFS.pig);
  assert.equal(pig.hp, MOB_DEFS.pig.maxHp);
  assert.deepEqual([pig.body.pos.x, pig.body.pos.y, pig.body.pos.z], [4.5, S, 2.5]);
  assert.equal(pig.body.halfW, MOB_DEFS.pig.halfW);
  assert.equal(pig.body.height, MOB_DEFS.pig.height);
  assert.equal(pig.variant, 0);
  assert.equal(pig.view, null, 'sem scene é headless');
  assert.equal(mgr.count(), 2);
  assert.equal(mgr.count('pig'), 1);
  assert.equal(mgr.count('creeper'), 0);

  // ovelha: variante explícita (normalizada) ou sorteada nas 4 cores
  assert.equal(mgr.spawn('sheep', 0.5, S, 0.5, { variant: 2 }).variant, 2);
  assert.equal(mgr.spawn('sheep', 0.5, S, 0.5, { variant: 6 }).variant, 6 % MOB_DEFS.sheep.variants);
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(mgr.spawn('sheep', 0.5, S, 0.5).variant);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);

  assert.throws(() => mgr.spawn('dragon', 0, S, 0), /desconhecida/);
});

test('update: sem eventos devolve SEMPRE o mesmo array vazio congelado; dt inválido não faz nada', () => {
  const w = flatWorld();
  const { mgr } = newManager(w);
  mgr.spawn('pig', 0.5, S, 0.5);
  const ctx = { player: P(30, S, 0.5), seconds: NOON };
  const a = mgr.update(DT, ctx);
  const b = mgr.update(DT, ctx);
  assert.equal(a.length, 0);
  assert.ok(Object.isFrozen(a));
  assert.equal(a, b, 'sem alocar array por quadro');
  const pos = { ...mgr.mobs.values().next().value.body.pos };
  for (const bad of [0, -1, NaN, undefined]) assert.equal(mgr.update(bad, ctx).length, 0);
  assert.deepEqual({ ...mgr.mobs.values().next().value.body.pos }, pos, 'dt inválido não move');
  assert.doesNotThrow(() => mgr.update(DT, null));
});

test('update: dt gigante (aba travada) é limitado — o mob não teleporta nem some do mundo', () => {
  const w = flatWorld();
  const { mgr } = newManager(w);
  const z = mgr.spawn('zombie', 0.5, S, 0.5);
  z.attackCd = 1;
  mgr.update(50, { player: P(40, S, 0.5), seconds: NIGHT });
  assert.ok(z.attackCd > 0.85 && z.attackCd < 0.95, `attackCd=${z.attackCd}: dt limitado a 0,1 s`);
  assert.ok(Math.hypot(z.body.pos.x - 0.5, z.body.pos.z - 0.5) < 1);
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

test('Views: sem scene não chama makeView; com scene cria, posiciona, atualiza e descarta', () => {
  const w = flatWorld();

  // headless: makeView nunca é chamado
  {
    const { mgr } = newManager(w, 1, {
      makeView: () => {
        throw new Error('makeView não deveria ser chamado sem scene');
      },
    });
    mgr.spawn('pig', 0.5, S, 0.5);
    mgr.spawn('creeper', 3.5, S, 0.5);
    assert.doesNotThrow(() => run(mgr, 2, { player: P(10, S, 0.5), seconds: NIGHT }));
  }

  // com scene (views falsas)
  const { scene, makeView, views } = spyViews();
  const { mgr } = newManager(w, 2, { scene, makeView });
  const sheep = mgr.spawn('sheep', 2.5, S, 3.5, { variant: 3 });
  assert.equal(views.length, 1);
  assert.equal(views[0].kind, 'sheep');
  assert.deepEqual(views[0].opts, { variant: 3 });
  assert.equal(scene.added[0], views[0].object, 'adicionada à cena');
  assert.deepEqual(views[0].positions[0], [2.5, S, 3.5], 'posicionada já no spawn');

  run(mgr, 3, { player: P(20, S, 3.5), seconds: NOON });
  const v = views[0];
  const last = v.positions[v.positions.length - 1];
  assert.deepEqual(last, [sheep.body.pos.x, sheep.body.pos.y, sheep.body.pos.z]);
  assert.equal(v.object.rotation.y, sheep.yaw);
  assert.ok(v.states.length >= 170, 'atualizada a cada quadro');
  for (const s of v.states) {
    for (const k of ['speed', 'hurt', 'fuse', 'attack', 'dying']) assert.ok(Number.isFinite(s[k]), k);
    assert.equal(typeof s.burning, 'boolean');
    assert.ok(s.hurt >= 0 && s.hurt <= 1 && s.fuse >= 0 && s.fuse <= 1 && s.attack >= 0 && s.attack <= 1 && s.dying >= 0 && s.dying <= 1);
  }
  assert.ok(v.states.some((s) => s.speed > 0.5), 'o passeio vira "speed" na View');

  // morte: dispose depois do corpo
  assert.equal(v.disposed, 0);
  kill(mgr, sheep);
  run(mgr, MOB_DEFS.sheep.corpseTime + 0.2, { player: P(20, S, 3.5), seconds: NOON });
  assert.equal(v.disposed, 1);
  assert.equal(mgr.mobs.size, 0);
  assert.ok(v.states.some((s) => s.dying > 0.9), 'a View viu a animação de morte');

  // clear / dispose / despawn também descartam
  const a = mgr.spawn('pig', 0.5, S, 0.5);
  const b = mgr.spawn('zombie', 1.5, S, 0.5);
  const c = mgr.spawn('pig', 300, S, 0.5);
  const base = views.length - 3;
  mgr.update(DT, { player: P(0, S, 0), seconds: NOON }); // c está além de despawnDist
  assert.equal(views[base + 2].disposed, 1, 'despawn descarta a View');
  assert.ok(!mgr.mobs.has(c.id));
  mgr.clearHostiles();
  assert.equal(views[base + 1].disposed, 1);
  assert.ok(mgr.mobs.has(a.id) && !mgr.mobs.has(b.id));
  mgr.dispose();
  assert.equal(views[base].disposed, 1);
  mgr.dispose(); // idempotente
  assert.equal(views[base].disposed, 1);
});

test('Views reais (Three.js): as 4 criaturas entram na cena, seguem o mob e saem ao descartar', () => {
  const w = flatWorld();
  const scene = new THREE.Scene();
  const { mgr } = newManager(w, 5, { scene });
  const mobs = MOB_KINDS.map((k, i) => mgr.spawn(k, 3.5 * i - 5, S, 0.5));
  assert.equal(scene.children.length, 4);
  run(mgr, 2, { player: P(-20, S, 0.5), seconds: NIGHT });
  for (const m of mobs) {
    assert.ok(m.view, m.kind);
    near(m.view.object.position.x, m.body.pos.x, 1e-12);
    near(m.view.object.position.y, m.body.pos.y, 1e-12);
    near(m.view.object.position.z, m.body.pos.z, 1e-12);
    near(m.view.object.rotation.y, m.yaw, 1e-12);
    assert.ok(Number.isFinite(m.view.object.rotation.y));
  }
  mgr.clear();
  assert.equal(scene.children.length, 0);
  assert.equal(mgr.mobs.size, 0);
});

// ---------------------------------------------------------------------------
// Física
// ---------------------------------------------------------------------------

test('física (mundo plano): nenhum mob fica sobreposto a blocos nem afunda, 40 s de noite', () => {
  // sem creeper (as crateras mudariam o chão): ninguém jamais abaixo da superfície
  {
    const w = flatWorld();
    const { mgr } = newManager(w, 4);
    for (const kind of ['pig', 'sheep', 'zombie']) {
      const i = MOB_KINDS.indexOf(kind);
      mgr.spawn(kind, -6 + 2 * i, S, 6);
      mgr.spawn(kind, 6 - 2 * i, S + 3, -6); // este cai do ar
    }
    const player = P(0.5, S, 0.5);
    let checked = 0;
    run(mgr, 40, () => ({ player, seconds: NIGHT }), () => {
      for (const m of mgr.mobs.values()) {
        const p = m.body.pos;
        assert.ok(!collidesBox(w, p.x, p.y, p.z, m.def.halfW, m.def.height), `${m.kind} dentro de bloco em (${p.x}, ${p.y}, ${p.z})`);
        assert.ok(p.y >= S - 1e-9, `${m.kind} afundou: y=${p.y}`);
        checked++;
      }
    });
    assert.ok(checked > 40 * 60 * 5, 'conferiu muitos mobs x quadros');
  }
  // com creepers explodindo no meio: continua sem sobreposição (o chão vira cratera, mas ninguém entra no bloco)
  {
    const w = flatWorld();
    const { mgr } = newManager(w, 4);
    for (const kind of MOB_KINDS) {
      mgr.spawn(kind, -6 + 2 * MOB_KINDS.indexOf(kind), S, 6);
      mgr.spawn(kind, 6 - 2 * MOB_KINDS.indexOf(kind), S + 3, -6);
    }
    const player = P(0.5, S, 0.5);
    let craters = 0;
    run(mgr, 40, () => ({ player, seconds: NIGHT }), (i, ev) => {
      craters += ofType(ev, 'explosion').length;
      for (const m of mgr.mobs.values()) {
        const p = m.body.pos;
        assert.ok(!collidesBox(w, p.x, p.y, p.z, m.def.halfW, m.def.height), `${m.kind} dentro de bloco`);
        assert.ok(p.y >= 1, `${m.kind} atravessou o fundo do mundo: y=${p.y}`);
      }
    });
    assert.ok(craters >= 1, 'houve explosão no teste');
  }
});

test('física (mundo real, seed 1337): população inteira de noite, sem sobreposição nem afundar', () => {
  const w = realWorld(5);
  const { mgr } = newManager(w, 6);
  const sy = w.surfaceY(0, 0);
  const player = P(0.5, sy, 0.5);
  mgr.populate(player.pos, NIGHT);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.floor(Math.cos(a) * 14);
    const z = Math.floor(Math.sin(a) * 14);
    mgr.spawn(i % 2 ? 'zombie' : 'creeper', x + 0.5, w.surfaceY(x, z), z + 0.5);
  }
  let bad = 0;
  let minAbove = Infinity;
  run(mgr, 60, (i) => {
    // o jogador caminha em círculo (e sempre pisa no chão)
    const a = i * DT * 0.5;
    const x = Math.cos(a) * 9;
    const z = Math.sin(a) * 9;
    player.pos.x = x;
    player.pos.z = z;
    player.pos.y = w.surfaceY(Math.floor(x), Math.floor(z));
    return { player, seconds: NIGHT };
  }, () => {
    for (const m of mgr.mobs.values()) {
      const p = m.body.pos;
      if (collidesBox(w, p.x, p.y, p.z, m.def.halfW, m.def.height)) bad++;
      minAbove = Math.min(minAbove, p.y - 1);
      assert.ok(p.y >= 1, `${m.kind} afundou no mundo: y=${p.y}`);
    }
  });
  assert.equal(bad, 0);
  assert.ok(mgr.mobs.size >= 6);
});

test('pulo automático: o zumbi sobe degrau de 1 bloco sozinho e NÃO sobe parede de 2', () => {
  // degrau de 1: plataforma de x=3 em diante
  {
    const w = flatWorld();
    fill(w, 3, S, -4, 14, S, 4, BLOCK.COBBLE);
    const { mgr } = newManager(w, 7);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const player = P(8.5, S + 1, 0.5);
    let climbedAt = null;
    let contactAt = null;
    run(mgr, 6, { player, seconds: NIGHT }, (i) => {
      if (contactAt === null && z.body.pos.x + z.def.halfW >= 3 - 0.08) contactAt = i * DT;
      if (climbedAt === null && z.body.pos.y >= S + 0.9 && contactAt !== null) climbedAt = i * DT; // pés quase na altura do degrau
    });
    assert.ok(climbedAt !== null && climbedAt < 3, `subiu o degrau (t=${climbedAt})`);
    // o salto vem de canStepUp (1 quadro depois de bater); o pulinho por bloqueio só viria depois de AI.hopAfter
    assert.ok(climbedAt - contactAt < AI.hopAfter, `subiu ${(climbedAt - contactAt).toFixed(2)} s depois de encostar (< ${AI.hopAfter})`);
    assert.ok(z.body.pos.x > 3.3, 'e continuou em frente');
    near(z.body.pos.y, S + 1, 0.05, 'em cima do degrau');
  }
  // parede de 2 blocos (larga demais para contornar em poucos segundos)
  {
    const w = flatWorld();
    fill(w, 3, S, -25, 3, S + 1, 25, BLOCK.COBBLE);
    const { mgr } = newManager(w, 7);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const player = P(7.5, S, 0.5);
    let maxY = 0;
    let maxX = 0;
    run(mgr, 8, { player, seconds: NIGHT }, () => {
      maxY = Math.max(maxY, z.body.pos.y);
      maxX = Math.max(maxX, z.body.pos.x);
    });
    assert.ok(maxX < 3 - z.def.halfW + 1e-9, `não atravessou a parede (x máx = ${maxX})`);
    assert.ok(maxY < S + 1.4, `não subiu em cima da parede (y máx = ${maxY})`);
  }
});

test('porco também sobe degrau de 1 bloco ao passear contra ele (mesma física)', () => {
  const w = flatWorld();
  fill(w, 3, S, -30, 30, S, 30, BLOCK.COBBLE);
  const { mgr } = newManager(w, 8);
  const pig = mgr.spawn('pig', 2.5, S, 0.5);
  // força o rumo +X na marra, sem passar pela IA: wish fixo antes de cada quadro
  let climbed = false;
  for (let i = 0; i < 120; i++) {
    pig.state = STATE.WANDER;
    pig.stateT = 5;
    pig.heading = Math.PI / 2; // sin = 1, cos = 0 => +X
    mgr.update(DT, { player: P(-30, S, 0.5), seconds: NOON });
    if (pig.body.pos.y >= S + 1 - 1e-9) climbed = true;
  }
  assert.ok(climbed, 'o porco subiu no degrau');
});

test('o zumbi contorna um obstáculo curto (desencalha lateralizando)', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const w = flatWorld();
    fill(w, 4, S, -1, 4, S + 1, 1, BLOCK.COBBLE); // parede 1x3, 2 de altura
    const { mgr } = newManager(w, seed);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const player = P(11.5, S, 0.5);
    let passed = null;
    run(mgr, 25, { player, seconds: NIGHT }, (i) => {
      if (passed === null && z.body.pos.x > 5) passed = i * DT;
    });
    assert.ok(passed !== null, `seed ${seed}: contornou a parede`);
  }
});

// ---------------------------------------------------------------------------
// Passivos
// ---------------------------------------------------------------------------

test('porco: vagueia — muda de posição, alterna parado/andando, anda ~walkSpeed, nunca afunda', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 11);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const def = pig.def;
  const player = P(25, S, 0.5);
  const start = { x: pig.body.pos.x, z: pig.body.pos.z };
  let prev = { x: start.x, z: start.z };
  let prevState = pig.state;
  let toWander = 0;
  let toIdle = 0;
  let maxIdleStep = 0;
  let wanderDist = 0;
  let wanderTime = 0;
  let maxFar = 0;
  const xs = new Set();
  run(mgr, 90, { player, seconds: NOON }, () => {
    const p = pig.body.pos;
    const step = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (pig.state === STATE.IDLE && prevState === STATE.IDLE) maxIdleStep = Math.max(maxIdleStep, step);
    if (pig.state === STATE.WANDER && prevState === STATE.WANDER) {
      wanderDist += step;
      wanderTime += DT;
    }
    if (prevState === STATE.IDLE && pig.state === STATE.WANDER) toWander++;
    if (prevState === STATE.WANDER && pig.state === STATE.IDLE) toIdle++;
    assert.ok(pig.state === STATE.IDLE || pig.state === STATE.WANDER);
    assert.equal(p.y, S, 'nunca afunda nem flutua');
    assert.ok(!collidesBox(w, p.x, p.y, p.z, def.halfW, def.height));
    maxFar = Math.max(maxFar, Math.hypot(p.x - start.x, p.z - start.z));
    xs.add(Math.round(p.x * 100));
    prev = { x: p.x, z: p.z };
    prevState = pig.state;
  });
  assert.ok(toWander >= 5 && toIdle >= 5, `alterna (${toWander} idle->wander, ${toIdle} wander->idle)`);
  assert.ok(maxFar > 3, `mudou de posição (afastou-se ${maxFar.toFixed(1)})`);
  assert.ok(xs.size > 100, 'trajetória contínua');
  assert.equal(maxIdleStep, 0, 'parado de verdade');
  near(wanderDist / wanderTime, def.walkSpeed, def.walkSpeed * 0.15, 'velocidade do passeio');
});

test('porco ferido foge: para longe do golpe, mais rápido que o passeio, por fleeTime; emite a voz', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 12);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const def = pig.def;
  const player = P(30, S, 0.5);
  const res = mgr.damage(pig, 1, { fromX: -3, fromZ: 0.5, knock: 6 });
  assert.deepEqual(res, { killed: false, drops: [] });
  assert.equal(pig.hp, def.maxHp - 1);

  const ev = run(mgr, 0.5, { player, seconds: NOON });
  assert.ok(ev.some((e) => e.type === 'sound' && e.name === 'pig'), 'grunhido de dor');
  assert.equal(pig.state, STATE.FLEE);

  // depois do knockback (>1,2 s), mede a velocidade de fuga
  run(mgr, 1.0, { player, seconds: NOON });
  const a = { x: pig.body.pos.x, z: pig.body.pos.z };
  run(mgr, 1.5, { player, seconds: NOON });
  const b = { x: pig.body.pos.x, z: pig.body.pos.z };
  const speed = Math.hypot(b.x - a.x, b.z - a.z) / 1.5;
  assert.ok(speed > def.walkSpeed * 1.5, `fugiu rápido (${speed.toFixed(2)} b/s)`);
  near(speed, def.fleeSpeed, def.fleeSpeed * 0.1, 'fleeSpeed');
  assert.ok(pig.body.pos.x - 0.5 > 6, 'longe do golpe, que veio de -X');

  // passa a fuga: volta a idle/wander
  run(mgr, def.fleeTime, { player, seconds: NOON });
  assert.ok(pig.state === STATE.IDLE || pig.state === STATE.WANDER);
});

test('ovelha ferida foge como o porco; zumbi/creeper feridos NÃO fogem', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 13);
  const sheep = mgr.spawn('sheep', 0.5, S, 0.5);
  const zombie = mgr.spawn('zombie', 6.5, S, 0.5);
  const creeper = mgr.spawn('creeper', 12.5, S, 0.5);
  const player = P(-30, S, 0.5, { mode: 'creative' });
  for (const m of [sheep, zombie, creeper]) mgr.damage(m, 1, { fromX: m.body.pos.x - 2, fromZ: 0.5, knock: 6 });
  run(mgr, 0.3, { player, seconds: NIGHT });
  assert.equal(sheep.state, STATE.FLEE);
  assert.notEqual(zombie.state, STATE.FLEE);
  assert.notEqual(creeper.state, STATE.FLEE);
  assert.equal(zombie.hurtBy, null, 'hurtBy consumido pela IA');
});

// ---------------------------------------------------------------------------
// Zumbi
// ---------------------------------------------------------------------------

test('zumbi: persegue, alcança o jogador parado e bate no ritmo do cooldown com o dano/knock do def', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 14);
  const z = mgr.spawn('zombie', 15.5, S, 0.5);
  const def = z.def;
  const player = P(0.5, S, 0.5);
  const ev = run(mgr, 12, { player, seconds: NIGHT });
  const hits = ofType(ev, 'hurt-player');
  assert.ok(hits.length >= 9, `${hits.length} golpes em 12 s`);
  const approach = (15 - def.halfW - PLAYER.halfWidth - def.attackReach) / def.chaseSpeed;
  assert.ok(hits[0].t < approach + 1 && hits[0].t > approach - 1, `1º golpe em ${hits[0].t.toFixed(2)} s (previsto ~${approach.toFixed(2)})`);
  for (let i = 1; i < hits.length; i++) near(hits[i].t - hits[i - 1].t, def.attackCooldown, 2.5 * DT, 'cooldown');
  for (const h of hits) {
    assert.equal(h.amount, def.attackDamage);
    assert.equal(h.source, 'zombie');
    assert.equal(h.knock, def.knockback);
    assert.equal(h.knockUp, def.knockbackUp);
    near(Math.hypot(h.fromX - 0.5, h.fromZ - 0.5), def.halfW + PLAYER.halfWidth + def.attackReach * 0.5, 0.6, 'origem do golpe = posição do zumbi');
  }
  // fica colado ao jogador, parado, olhando para ele
  assert.equal(z.state, STATE.ATTACK);
  const gap = Math.hypot(z.body.pos.x - 0.5, z.body.pos.z - 0.5);
  assert.ok(gap > 1.0 && gap < 1.4, `distância final ${gap.toFixed(2)}`);
  near(Math.abs(z.yaw), Math.PI / 2, 0.05, 'de frente para o jogador (yaw = atan2(dx, dz); jogador a -X)'); // atan2(-1, 0) = -π/2
  assert.ok(z.yaw < 0);
});

test('zumbi: Criativo ou jogador morto => ninguém apanha; e ele não persegue', () => {
  for (const o of [{ mode: 'creative' }, { alive: false }]) {
    const w = flatWorld();
    const { mgr } = newManager(w, 15);
    const z = mgr.spawn('zombie', 4.5, S, 0.5);
    const ev = run(mgr, 20, { player: P(0.5, S, 0.5, o), seconds: NIGHT });
    assert.equal(ofType(ev, 'hurt-player').length, 0);
    assert.ok(z.state === STATE.IDLE || z.state === STATE.WANDER);
  }
});

test('zumbi: some o alvo no meio (Criativo) e a perseguição para', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 16);
  const z = mgr.spawn('zombie', 10.5, S, 0.5);
  const player = P(0.5, S, 0.5);
  run(mgr, 1, { player, seconds: NIGHT });
  assert.equal(z.state, STATE.CHASE);
  player.mode = 'creative';
  const ev = run(mgr, 15, { player, seconds: NIGHT });
  assert.equal(ofType(ev, 'hurt-player').length, 0);
  assert.ok(z.state === STATE.IDLE || z.state === STATE.WANDER);
});

test('zumbi: parede de 1 bloco entre os dois impede o golpe (abrigo funciona); sem a parede, bate', () => {
  const w = flatWorld();
  fill(w, 1, S, -20, 1, S + 2, 20, BLOCK.COBBLE); // parede de 1 bloco de espessura, larga demais para contornar
  const { mgr } = newManager(w, 81);
  const def = MOB_DEFS.zombie;
  const z = mgr.spawn('zombie', 0.65, S, 0.5); // encostado na parede, lado oeste
  const player = P(2.35, S, 0.5); // encostado na parede, lado leste
  // prova de que o cenário É de alcance geométrico (sem a linha de visão, bateria)
  const edge = player.pos.x - z.body.pos.x - (def.halfW + PLAYER.halfWidth);
  assert.ok(edge <= def.attackReach, `borda a borda ${edge} <= attackReach ${def.attackReach}`);

  const behind = run(mgr, 8, { player, seconds: NIGHT });
  assert.equal(ofType(behind, 'hurt-player').length, 0, 'atrás da parede ninguém apanha');
  assert.notEqual(z.state, STATE.ATTACK);
  assert.ok(z.body.pos.x < 1, 'e o zumbi não atravessou');

  fill(w, 1, S, -20, 1, S + 2, 20, BLOCK.AIR); // derruba a parede
  const open = run(mgr, 3, { player, seconds: NIGHT });
  assert.ok(ofType(open, 'hurt-player').length >= 1, 'sem a parede, bate');
});

test('zumbi: bate por cima de uma mureta de 1 bloco (a linha de visão passa rente ao peito)', () => {
  const w = flatWorld();
  fill(w, 1, S, -20, 1, S, 20, BLOCK.COBBLE); // mureta de 1 bloco
  const { mgr } = newManager(w, 82);
  const z = mgr.spawn('zombie', 0.65, S, 0.5);
  z.stateT = 1e9;
  const ev = run(mgr, 4, { player: P(2.35, S + 1, 0.5), seconds: NIGHT }); // jogador em cima da mureta
  assert.ok(ofType(ev, 'hurt-player').length >= 1);
});

test('separação: zumbis que chegam juntos não se empilham — cada um fica em seu canto', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 83);
  const zs = [0, 1, 2, 3].map((i) => mgr.spawn('zombie', 15.5 + i * 0.1, S, 0.5 + i * 0.1));
  const player = P(0.5, S, 0.5);
  run(mgr, 14, { player, seconds: NIGHT });
  let minD = Infinity;
  for (let i = 0; i < zs.length; i++) {
    for (let j = i + 1; j < zs.length; j++) {
      minD = Math.min(minD, Math.hypot(zs[i].body.pos.x - zs[j].body.pos.x, zs[i].body.pos.z - zs[j].body.pos.z));
    }
    const d = Math.hypot(zs[i].body.pos.x - 0.5, zs[i].body.pos.z - 0.5);
    assert.ok(d < 3, `zumbi ${i} chegou perto do jogador (${d.toFixed(2)})`);
  }
  assert.ok(minD > 0.4, `distância mínima entre zumbis ${minD.toFixed(2)} (corpos de ${2 * zs[0].def.halfW})`);
});

test('separação: três porcos nascidos no MESMO ponto se afastam até não se sobrepor (sem NaN)', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 84);
  const pigs = [0, 1, 2].map(() => mgr.spawn('pig', 0.5, S, 0.5));
  for (const p of pigs) {
    p.state = STATE.IDLE;
    p.stateT = 1e9; // parados: só a separação os move
  }
  run(mgr, 4, { player: P(25, S, 0.5), seconds: NOON });
  const min = 2 * pigs[0].def.halfW;
  for (let i = 0; i < 3; i++) {
    assert.ok(Number.isFinite(pigs[i].body.pos.x) && Number.isFinite(pigs[i].body.pos.z));
    assert.equal(pigs[i].body.pos.y, S);
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(pigs[i].body.pos.x - pigs[j].body.pos.x, pigs[i].body.pos.z - pigs[j].body.pos.z);
      assert.ok(d >= min - 0.05, `porcos ${i} e ${j} a ${d.toFixed(2)} (corpo ${min})`);
    }
  }
  // repouso: depois de separados, ficam quietos
  const before = pigs.map((p) => ({ ...p.body.pos }));
  run(mgr, 2, { player: P(25, S, 0.5), seconds: NOON });
  pigs.forEach((p, i) => {
    const moved = Math.hypot(p.body.pos.x - before[i].x, p.body.pos.z - before[i].z);
    assert.ok(moved < 0.05, `porco ${i} ainda andou ${moved.toFixed(3)} em 2 s`);
  });
});

test('separação: não empurra mobs mortos nem atravessa parede', () => {
  const w = flatWorld();
  fill(w, 2, S, -5, 2, S + 2, 5, BLOCK.COBBLE);
  const { mgr } = newManager(w, 85);
  const a = mgr.spawn('pig', 1.4, S, 0.5);
  const b = mgr.spawn('pig', 1.4, S, 0.5);
  const dead = mgr.spawn('pig', 1.4, S, 0.5);
  for (const m of [a, b]) {
    m.state = STATE.IDLE;
    m.stateT = 1e9;
  }
  kill(mgr, dead);
  dead.kx = 0;
  dead.kz = 0;
  run(mgr, 0.2, { player: P(25, S, 0.5), seconds: NOON });
  run(mgr, 3, { player: P(25, S, 0.5), seconds: NOON }, () => {
    for (const m of [a, b]) assert.ok(!collidesBox(w, m.body.pos.x, m.body.pos.y, m.body.pos.z, m.def.halfW, m.def.height));
  });
  assert.ok(Math.max(a.body.pos.x, b.body.pos.x) + a.def.halfW <= 2 + 1e-9, 'a parede segurou');
});

// ---------------------------------------------------------------------------
// Queima ao sol
// ---------------------------------------------------------------------------

test('queima: zumbi exposto de dia perde burnDps HP/s (burning na View) e morre; abrigado não queima; creeper não queima', () => {
  const { scene, makeView, views } = spyViews();

  // exposto
  {
    const w = flatWorld();
    const { mgr } = newManager(w, 17, { scene, makeView });
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const def = z.def;
    const player = P(14.5, S, 0.5, { mode: 'creative' });
    run(mgr, 1, { player, seconds: NOON });
    assert.equal(z.burning, true);
    run(mgr, 2, { player, seconds: NOON });
    near(def.maxHp - z.hp, def.burnDps * 3, 1.01, 'HP perdido em 3 s');
    const ev = run(mgr, 12, { player, seconds: NOON });
    const died = ofType(ev, 'mob-died');
    assert.equal(died.length, 1);
    assert.equal(died[0].byPlayer, false);
    assert.deepEqual(died[0].drops, []);
    assert.equal(died[0].mob, z);
    const tDeath = 3 + died[0].t;
    near(tDeath, def.maxHp / def.burnDps, 0.8, 'morreu em maxHp/burnDps s');
    assert.equal(z.dead, true);
    assert.equal(z.burning, false);
    const v = views[views.length - 1];
    assert.ok(v.states.some((s) => s.burning === true), 'a View recebeu burning');
    assert.ok(v.states.some((s) => s.hurt > 0), 'e o flash de dano');
    run(mgr, 1, { player, seconds: NOON });
    assert.equal(mgr.mobs.size, 0, 'corpo removido');
  }

  // abrigado sob QUALQUER bloco (aqui: um telhado de tábuas) => não queima
  {
    const w = flatWorld();
    fill(w, -40, S + 3, -40, 40, S + 3, 40, BLOCK.PLANKS);
    const { mgr } = newManager(w, 18);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const player = P(14.5, S, 0.5, { mode: 'creative' });
    run(mgr, 15, { player, seconds: NOON }, () => assert.equal(z.burning, false));
    assert.equal(z.hp, z.def.maxHp, 'abrigado: nenhum dano');
    // tirou o telhado: passa a queimar
    fill(w, -40, S + 3, -40, 40, S + 3, 40, BLOCK.AIR);
    run(mgr, 1, { player, seconds: NOON });
    assert.equal(z.burning, true);
    assert.ok(z.hp < z.def.maxHp);
  }

  // um único bloco logo acima da cabeça também abriga (e folhas contam)
  {
    const w = flatWorld();
    const { mgr } = newManager(w, 19);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    z.state = STATE.IDLE;
    z.stateT = 1e9; // fica parado sob o bloco
    w.setBlock(0, S + 2, 0, BLOCK.LEAVES); // cabeça vai até S+1,8; o bloco está em S+2
    run(mgr, 5, { player: P(14.5, S, 0.5, { mode: 'creative' }), seconds: NOON });
    assert.equal(z.hp, z.def.maxHp);
    w.setBlock(0, S + 2, 0, BLOCK.AIR);
    w.setBlock(0, S + 12, 0, BLOCK.COBBLE); // muito alto, mas ainda é "sobre a cabeça"
    run(mgr, 3, { player: P(14.5, S, 0.5, { mode: 'creative' }), seconds: NOON });
    assert.equal(z.hp, z.def.maxHp, 'qualquer bloco na coluna abriga');
  }

  // de noite não queima; creeper nunca queima
  {
    const w = flatWorld();
    const { mgr } = newManager(w, 20);
    const zombie = mgr.spawn('zombie', 0.5, S, 0.5);
    const creeper = mgr.spawn('creeper', 5.5, S, 0.5);
    const player = P(14.5, S, 0.5, { mode: 'creative' });
    run(mgr, 20, { player, seconds: NIGHT });
    assert.equal(zombie.hp, zombie.def.maxHp);
    run(mgr, 20, { player, seconds: NOON });
    assert.equal(creeper.hp, creeper.def.maxHp);
    assert.equal(creeper.burning, false);
    assert.equal(zombie.dead, true, 'o zumbi queimou de dia');
  }
});

// ---------------------------------------------------------------------------
// Dano, knockback, morte, drops
// ---------------------------------------------------------------------------

test('dano: aplica o golpe, empurra para longe da origem, imunidade de hurtTime ao knockback e hurtT 1->0', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 21);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const def = pig.def;
  mgr.update(DT, { player: P(30, S, 0.5), seconds: NOON }); // assenta no chão
  pig.state = STATE.IDLE;
  pig.stateT = 1e9;

  const r1 = mgr.damage(pig, 3, { fromX: -2, fromZ: 0.5, knock: 6 });
  assert.equal(r1.killed, false);
  assert.equal(pig.hp, def.maxHp - 3);
  assert.equal(pig.hurtT, 1);
  assert.ok(pig.kx > 5.9 && Math.abs(pig.kz) < 1e-9, 'empurrão para +X');

  // 2º golpe DENTRO da janela (5 quadros depois): o dano vale, o empurrão NÃO se renova
  // (se renovasse, kx voltaria a 6; sem renovar, segue decaindo)
  const hurtPlayer = { player: P(30, S, 0.5), seconds: NOON };
  for (let i = 0; i < 5; i++) mgr.update(DT, hurtPlayer);
  const kx = pig.kx;
  assert.ok(kx > 3 && kx < 5.5, `kx decaiu de 6 para ${kx}`);
  const r2 = mgr.damage(pig, 1, { fromX: -2, fromZ: 0.5, knock: 6 });
  assert.equal(r2.killed, false);
  assert.equal(pig.hp, def.maxHp - 4, 'o dano sempre vale');
  assert.equal(pig.kx, kx, 'sem novo knockback na imunidade');
  assert.ok(pig.hurtT > 0 && pig.hurtT < 1, 'e o flash não reinicia');

  // hurtT cai a 0 em hurtTime (contado desde o 1º golpe: já passaram 5 quadros)
  let t = 5 * DT;
  const player = hurtPlayer;
  while (pig.hurtT > 0 && t < 1) {
    mgr.update(DT, player);
    t += DT;
  }
  near(t, def.hurtTime, 2 * DT, 'hurtT chega a 0 em hurtTime');
  // foi empurrado ~ knock * tau para +X (e ainda desliza)
  assert.ok(pig.body.pos.x > 0.5 + 0.8, `deslocou ${pig.body.pos.x - 0.5}`);

  // fora da janela, novo golpe empurra de novo (agora para -X)
  run(mgr, 1, player);
  pig.state = STATE.IDLE;
  pig.stateT = 1e9;
  const x0 = pig.body.pos.x;
  mgr.damage(pig, 1, { fromX: x0 + 2, fromZ: pig.body.pos.z, knock: 6 });
  assert.ok(pig.kx < -5.9);
  run(mgr, 0.4, { player: P(30, S, 0.5), seconds: NOON });
  assert.ok(pig.body.pos.x < x0 - 0.5);
});

test('dano: o knockback não atravessa parede e dá um hop; sem origem não há NaN', () => {
  const w = flatWorld();
  fill(w, 2, S, -3, 2, S + 2, 3, BLOCK.COBBLE); // parede em x=2
  const { mgr } = newManager(w, 22);
  const pig = mgr.spawn('pig', 1.2, S, 0.5);
  mgr.update(DT, { player: P(30, S, 0.5), seconds: NOON });
  mgr.damage(pig, 1, { fromX: -4, fromZ: 0.5, knock: 9 }); // empurra para +X, contra a parede
  let maxY = 0;
  run(mgr, 1, { player: P(30, S, 0.5), seconds: NOON }, () => {
    maxY = Math.max(maxY, pig.body.pos.y);
    assert.ok(pig.body.pos.x + pig.def.halfW <= 2 + 1e-9, 'não atravessou a parede');
  });
  assert.ok(maxY > S + 0.05, 'o golpe dá um hop');

  const sheep = mgr.spawn('sheep', 5.5, S, 5.5);
  assert.doesNotThrow(() => mgr.damage(sheep, 1)); // sem opts
  assert.doesNotThrow(() => mgr.damage(sheep, 1, { knock: 6 })); // sem origem
  run(mgr, 1, { player: P(30, S, 0.5), seconds: NOON });
  assert.ok(Number.isFinite(sheep.body.pos.x) && Number.isFinite(sheep.body.pos.z));
});

test('morte: damage devolve {killed, drops}; mob-died sai no próximo update; corpo anima dying e some', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 23);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const def = pig.def;
  const res = mgr.damage(pig, def.maxHp, { fromX: 3, fromZ: 0.5, knock: 6 });
  assert.equal(res.killed, true);
  assert.equal(res.drops.length, 1);
  assert.equal(res.drops[0].item, def.drops[0].item);
  assert.ok(res.drops[0].count >= def.drops[0].min && res.drops[0].count <= def.drops[0].max);
  assert.equal(pig.dead, true);
  assert.equal(pig.hp, 0);
  assert.equal(mgr.count('pig'), 0, 'morto não conta como vivo');
  assert.ok(mgr.mobs.has(pig.id), 'mas o corpo ainda está lá');

  // dano em mob já morto não faz nada
  assert.deepEqual(mgr.damage(pig, 99, { fromX: 0, fromZ: 0, knock: 6 }), { killed: false, drops: [] });

  const player = { player: P(30, S, 0.5), seconds: NOON };
  const ev = mgr.update(DT, player);
  const died = ofType(ev, 'mob-died');
  assert.equal(died.length, 1);
  assert.equal(died[0].mob, pig);
  assert.equal(died[0].byPlayer, true);
  assert.deepEqual(died[0].drops, res.drops);
  assert.ok(ev.some((e) => e.type === 'sound' && e.name === 'death'));
  assert.equal(ofType(mgr.update(DT, player), 'mob-died').length, 0, 'o evento sai uma única vez');

  // dying 0 -> 1 em corpseTime; depois removido
  let t = DT;
  let last = 0;
  while (mgr.mobs.has(pig.id) && t < 2) {
    assert.ok(pig.dying >= last && pig.dying <= 1);
    last = pig.dying;
    mgr.update(DT, player);
    t += DT;
  }
  assert.ok(!mgr.mobs.has(pig.id));
  near(t, def.corpseTime, 3 * DT, 'tempo de corpo');
});

test('morte: o corpo não é golpeado nem conta; zumbi/creeper não dropam; ovelha dropa 1; porco 1..2 (ambos aparecem)', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 24);
  const counts = new Map();
  for (let i = 0; i < 80; i++) {
    const pig = mgr.spawn('pig', 0.5, S, 0.5);
    const r = kill(mgr, pig);
    assert.equal(r.killed, true);
    counts.set(r.drops[0].count, (counts.get(r.drops[0].count) || 0) + 1);
    const sheep = mgr.spawn('sheep', 0.5, S, 0.5);
    const rs = kill(mgr, sheep);
    assert.deepEqual(rs.drops, [{ item: MOB_DEFS.sheep.drops[0].item, count: 1 }]);
  }
  assert.deepEqual([...counts.keys()].sort(), [1, 2]);
  assert.ok(counts.get(1) > 15 && counts.get(2) > 15, `distribuição ${[...counts]}`);
  for (const k of ['zombie', 'creeper']) assert.deepEqual(kill(mgr, mgr.spawn(k, 0.5, S, 0.5)), { killed: true, drops: [] });
});

test('morte: dano em mob removido (despawn/explodido) é ignorado, sem eventos fantasmas', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 25);
  const far = mgr.spawn('pig', 300, S, 0.5);
  mgr.update(DT, { player: P(0, S, 0), seconds: NOON }); // despawn
  assert.ok(!mgr.mobs.has(far.id));
  assert.deepEqual(mgr.damage(far, 99, { fromX: 0, fromZ: 0, knock: 6 }), { killed: false, drops: [] });
  assert.equal(mgr.update(DT, { player: P(0, S, 0), seconds: NOON }).length, 0);
});

test('som: dano não letal => voz do mob (creeper: hurt); letal => death', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 26);
  const player = { player: P(30, S, 0.5), seconds: NOON };
  const expect = { pig: 'pig', sheep: 'sheep', zombie: 'zombie', creeper: 'hurt' };
  for (const kind of MOB_KINDS) {
    const m = mgr.spawn(kind, 0.5, S, 0.5);
    mgr.damage(m, 1, { fromX: -2, fromZ: 0.5, knock: 6 });
    const ev = mgr.update(DT, player);
    const s = ev.find((e) => e.type === 'sound' && e.name === expect[kind]);
    assert.ok(s, `${kind}: som ${expect[kind]}`);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z));
    kill(mgr, m);
    assert.ok(mgr.update(DT, player).some((e) => e.type === 'sound' && e.name === 'death'), `${kind}: death`);
  }
});

// ---------------------------------------------------------------------------
// Creeper
// ---------------------------------------------------------------------------

test('creeper (fluxo): infla só dentro de fuseStartDist, desarma ao afastar, e depois explode uma vez', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 27);
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  const def = c.def;
  const player = P(14.5, S, 0.5);
  const cdist = () =>
    Math.hypot(player.pos.x - c.body.pos.x, player.pos.z - c.body.pos.z, player.pos.y + PLAYER.height / 2 - (c.body.pos.y + def.height / 2));
  const events = [];

  // 1) aproximação: o fuse só sobe depois de entrar em fuseStartDist; para de andar
  let firstFuseDist = null;
  let stoppedAt = null;
  for (let i = 0; i < 60 * 12 && firstFuseDist === null; i++) {
    events.push(...mgr.update(DT, { player, seconds: NIGHT }));
    if (c.fuse > 0) firstFuseDist = cdist();
    else assert.equal(c.fuse, 0);
  }
  assert.ok(firstFuseDist !== null, 'começou a inflar');
  assert.ok(firstFuseDist <= def.fuseStartDist + 1e-9 && firstFuseDist > def.fuseStartDist - 0.15, `começou a ${firstFuseDist.toFixed(2)}`);
  assert.equal(events.filter((e) => e.type === 'sound' && e.name === 'hiss').length, 1);
  stoppedAt = { x: c.body.pos.x, z: c.body.pos.z };
  run(mgr, 0.5, { player, seconds: NIGHT });
  assert.deepEqual({ x: c.body.pos.x, z: c.body.pos.z }, stoppedAt, 'parado enquanto infla');
  assert.equal(c.state, STATE.FUSE);
  const mid = c.fuse;
  assert.ok(mid > 0.3 && mid < 0.45, `fuse ${mid}`);

  // 2) o jogador foge para além de fuseAbortDist: desarma (decai) e o creeper volta a perseguir
  player.pos.x = c.body.pos.x + def.fuseAbortDist + 2.5;
  const evAbort = run(mgr, 0.4, { player, seconds: NIGHT });
  assert.equal(c.state, STATE.CHASE);
  assert.ok(c.fuse < mid, 'fuse decaindo');
  assert.equal(ofType(evAbort, 'explosion').length, 0);
  let t = 0;
  while (c.fuse > 0 && t < 3) {
    mgr.update(DT, { player, seconds: NIGHT });
    t += DT;
  }
  assert.equal(c.fuse, 0, 'desinflou por completo');
  assert.ok(c.body.pos.x > stoppedAt.x, 'voltou a perseguir');

  // 3) o jogador fica parado: ele chega, infla (novo hiss) e explode — uma vez
  const evEnd = run(mgr, 8, { player, seconds: NIGHT });
  assert.equal(ofType(evEnd, 'explosion').length, 1);
  assert.equal(evEnd.filter((e) => e.type === 'sound' && e.name === 'hiss').length, 1, 'novo hiss ao reiniciar');
  const died = ofType(evEnd, 'mob-died');
  assert.equal(died.length, 1);
  assert.equal(died[0].mob, c);
  assert.equal(died[0].byPlayer, false);
  assert.equal(mgr.mobs.has(c.id), false, 'o creeper some ao explodir');
  assert.equal(mgr.count('creeper'), 0);
});

test('creeper: com o jogador a ~fuseStartDist, o dano pelo CENTRO é ceil(blastDamage x (1 - d/blastRadius)) e o tempo é fuseTime', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 28);
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  const def = c.def;
  const player = P(6.5, S, 0.5);
  const ev = run(mgr, 10, { player, seconds: NIGHT });
  const ex = ofType(ev, 'explosion')[0];
  const hurt = ofType(ev, 'hurt-player');
  assert.equal(hurt.length, 1);
  const cx = ex.x;
  const cy = ex.y;
  const cz = ex.z;
  const d = Math.hypot(player.pos.x - cx, player.pos.y + PLAYER.height / 2 - cy, player.pos.z - cz);
  assert.equal(hurt[0].amount, Math.ceil(def.blastDamage * (1 - d / def.blastRadius)));
  assert.equal(hurt[0].source, 'creeper');
  assert.equal(hurt[0].knock, def.knockback);
  assert.equal(hurt[0].knockUp, def.knockbackUp);
  near(hurt[0].fromX, cx, 1e-12);
  near(hurt[0].fromZ, cz, 1e-12);
  assert.ok(hurt[0].amount >= 1);
  // ordem: a explosão (reconstruir chunks) vem antes do dano
  assert.ok(ev.findIndex((e) => e.type === 'explosion') < ev.findIndex((e) => e.type === 'hurt-player'));
  // hiss -> explosão leva ~fuseTime
  const hiss = ev.find((e) => e.type === 'sound' && e.name === 'hiss');
  near(ex.t - hiss.t, def.fuseTime, 3 * DT, 'fuseTime');
});

test('explosão: dano ao jogador por distância ao centro (0 fora do raio) em várias distâncias', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 29);
  const def = MOB_DEFS.creeper;
  for (const dx of [0, 1, 2, 3, 3.4, 3.45, 3.5, 4, 8]) {
    const c = mgr.spawn('creeper', 0.5, S, 0.5);
    c.state = STATE.EXPLODE; // dispara a explosão sem esperar o fuse
    const player = P(0.5 + dx, S, 0.5);
    const ev = mgr.update(DT, { player, seconds: NIGHT });
    const ex = ofType(ev, 'explosion')[0];
    assert.ok(ex, `dx=${dx}: explodiu`);
    const d = Math.hypot(dx, player.pos.y + PLAYER.height / 2 - ex.y);
    const hurt = ofType(ev, 'hurt-player');
    if (d < def.blastRadius) {
      assert.equal(hurt.length, 1, `dx=${dx}`);
      assert.equal(hurt[0].amount, Math.ceil(def.blastDamage * (1 - d / def.blastRadius)), `dx=${dx}`);
    } else {
      assert.equal(hurt.length, 0, `dx=${dx}: fora do raio`);
    }
  }
  // no centro exato: dano máximo
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  c.state = STATE.EXPLODE;
  const ev = mgr.update(DT, { player: P(0.5, S + c.def.height / 2 - PLAYER.height / 2, 0.5), seconds: NIGHT });
  assert.equal(ofType(ev, 'hurt-player')[0].amount, def.blastDamage);
});

test('explosão: Criativo ou jogador morto não leva dano (os blocos ainda voam)', () => {
  for (const o of [{ mode: 'creative' }, { alive: false }]) {
    const w = flatWorld();
    const { mgr } = newManager(w, 30);
    const c = mgr.spawn('creeper', 0.5, S, 0.5);
    c.state = STATE.EXPLODE;
    const ev = mgr.update(DT, { player: P(1.5, S, 0.5, o), seconds: NIGHT });
    assert.equal(ofType(ev, 'hurt-player').length, 0);
    assert.equal(ofType(ev, 'explosion').length, 1);
  }
});

/** Snapshot { "x,y,z": bloco } de um cubo. */
function snapshot(w, x0, x1, z0, z1) {
  const s = new Map();
  for (let x = x0; x <= x1; x++) for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = z0; z <= z1; z++) s.set(`${x},${y},${z}`, w.getBlock(x, y, z));
  return s;
}

test('explosão: remove exatamente as células sólidas cujo centro está em carveRadius (y >= 1); fora e y=0 intactos', () => {
  const def = MOB_DEFS.creeper;
  const r = def.carveRadius;

  for (const [label, build, spawnY] of [
    // maciço de pedra com um túnel 1x2 onde o creeper cabe
    ['dentro do maciço', (w) => { fill(w, -12, S, -12, 12, S + 9, 12, BLOCK.STONE); fill(w, 0, S, 0, 0, S + 1, 0, BLOCK.AIR); }, S],
    // beira do fundo do mundo: poço até y=1, camada y=0 por baixo
    ['junto ao fundo do mundo (y=0)', (w) => { fill(w, 0, 1, 0, 0, 2, 0, BLOCK.AIR); }, 1],
  ]) {
    const w = flatWorld({ surface: label.startsWith('junto') ? 3 : S });
    build(w);
    const before = snapshot(w, -7, 7, -7, 7);
    const { mgr } = newManager(w, 31);
    const c = mgr.spawn('creeper', 0.5, spawnY, 0.5);
    const cx = 0.5;
    const cy = spawnY + def.height / 2;
    const cz = 0.5;
    c.state = STATE.EXPLODE;
    const ev = mgr.update(DT, { player: P(40, S, 0.5), seconds: NIGHT });
    const ex = ofType(ev, 'explosion')[0];
    assert.ok(ex, label);
    near(ex.x, cx, 1e-9);
    near(ex.y, cy, 1e-9);
    near(ex.z, cz, 1e-9);
    assert.equal(ex.radius, def.blastRadius);

    const listed = new Set(ex.blocks.map((b) => `${b.x},${b.y},${b.z}`));
    assert.equal(listed.size, ex.blocks.length, 'sem blocos repetidos');
    const expected = new Set();
    for (const [key, blk] of before) {
      const [x, y, z] = key.split(',').map(Number);
      const inside = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 <= r * r;
      const now = w.getBlock(x, y, z);
      if (inside && y >= 1 && blk !== BLOCK.AIR) {
        expected.add(key);
        assert.equal(now, BLOCK.AIR, `${label}: ${key} deveria virar AIR`);
      } else {
        assert.equal(now, blk, `${label}: ${key} deveria ficar intacto (era ${blk}, ficou ${now})`);
      }
    }
    assert.deepEqual([...listed].sort(), [...expected].sort(), `${label}: a lista bate com o que sumiu`);
    assert.ok(ex.blocks.every((b) => b.y >= 1), 'nunca y < 1');
    assert.ok(ex.blocks.length > (label.startsWith('junto') ? 5 : 40), `${label}: abriu um buraco (${ex.blocks.length} blocos)`);
    if (label.startsWith('junto')) {
      for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) assert.equal(w.getBlock(x, 0, z), BLOCK.STONE, `y=0 em (${x},${z}) intacto`);
    }
  }
});

test('explosão (mundo real): marca os chunks tocados como modificados e só eles', () => {
  const w = new World(SEED);
  const sy = w.surfaceY(0, 0);
  const { mgr } = newManager(w, 32);
  assert.equal(w.isModified(0, 0), false);
  const c = mgr.spawn('creeper', 0.5, sy, 0.5);
  c.state = STATE.EXPLODE;
  const ev = mgr.update(DT, { player: P(30, sy, 0.5), seconds: NIGHT });
  const ex = ofType(ev, 'explosion')[0];
  assert.ok(ex.blocks.length > 0);
  const touched = new Set(ex.blocks.map((b) => `${Math.floor(b.x / 16)},${Math.floor(b.z / 16)}`));
  for (const key of touched) {
    const [cx, cz] = key.split(',').map(Number);
    assert.equal(w.isModified(cx, cz), true, `chunk ${key} modificado`);
  }
  assert.equal(w.isModified(4, 4), false);
  assert.equal(w.isModified(-4, 3), false);
  for (const b of ex.blocks) assert.equal(w.getBlock(b.x, b.y, b.z), BLOCK.AIR);
});

test('explosão: mobs na área levam dano por distância (podem morrer, sem byPlayer); fora do raio, nada', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 33);
  const def = MOB_DEFS.creeper;
  const cy = def.height / 2; // altura do centro da explosão acima dos pés
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  const sheep = mgr.spawn('sheep', 0.5 + 0.5, S, 0.5); // quase em cima
  const pig = mgr.spawn('pig', 0.5 + 2.2, S, 0.5);
  const zombie = mgr.spawn('zombie', 0.5, S, 0.5 + 2.5);
  const far = mgr.spawn('pig', 0.5 - 4, S, 0.5);
  for (const m of [sheep, pig, zombie, far]) {
    m.state = STATE.IDLE;
    m.stateT = 1e9;
  }
  /** Dano esperado em `m` (centro do corpo a `dh` blocos na horizontal do centro da explosão). */
  const expected = (m, dh) => {
    const d = Math.hypot(dh, m.def.height / 2 - cy);
    return d >= def.blastRadius ? 0 : Math.ceil(def.blastDamage * (1 - d / def.blastRadius));
  };
  c.state = STATE.EXPLODE;
  const away = { player: P(40, S, 0.5, { mode: 'creative' }), seconds: NIGHT };
  const ev = mgr.update(DT, away);

  assert.equal(sheep.dead, true, 'ovelha encostada morre');
  assert.ok(expected(sheep, 0.5) >= sheep.def.maxHp);
  assert.equal(pig.hp, pig.def.maxHp - expected(pig, 2.2));
  assert.equal(zombie.hp, zombie.def.maxHp - expected(zombie, 2.5));
  assert.equal(far.hp, far.def.maxHp, 'fora do raio: intacto');
  assert.ok(pig.hp < pig.def.maxHp && zombie.hp < zombie.def.maxHp);
  const died = ofType(ev, 'mob-died');
  assert.ok(died.some((e) => e.mob === sheep && e.byPlayer === false), 'mortes pela explosão não são do jogador');
  assert.ok(died.some((e) => e.mob === c && e.byPlayer === false), 'o creeper conta como morto');
  assert.ok(!died.some((e) => e.mob === pig || e.mob === far));
  // feridos são empurrados para longe do centro
  run(mgr, 0.5, away);
  assert.ok(pig.body.pos.x > 0.5 + 2.2 + 0.5, 'porco empurrado para longe do centro (+X)');
  assert.ok(zombie.body.pos.z > 0.5 + 2.5 + 0.3, 'zumbi empurrado para longe do centro (+Z)');
});

test('creeper: se o jogador o mata durante o fuse, não há explosão', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 34);
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  const player = P(3.4, S, 0.5);
  run(mgr, 0.8, { player, seconds: NIGHT });
  assert.ok(c.fuse > 0.3 && c.fuse < 1, `fuse = ${c.fuse}`);
  const res = mgr.damage(c, 99, { fromX: 3.4, fromZ: 0.5, knock: 6 });
  assert.equal(res.killed, true);
  assert.equal(c.fuse, 0, 'desinflou ao morrer');
  const ev = run(mgr, 3, { player, seconds: NIGHT });
  assert.equal(ofType(ev, 'explosion').length, 0);
  assert.equal(ofType(ev, 'hurt-player').length, 0);
});

// ---------------------------------------------------------------------------
// População: spawn periódico, tetos, populate
// ---------------------------------------------------------------------------

const hostileCap = (seconds) => Math.min(SPAWN.hostileCapMax, SPAWN.hostileCapBase + dayNumber(seconds));
const hostiles = (mgr) => mgr.count('zombie') + mgr.count('creeper');
const passives = (mgr) => mgr.count('pig') + mgr.count('sheep');

test('população: de dia só passivos, até passiveCap; nenhum hostil nasce', () => {
  const w = realWorld(4);
  const { mgr } = newManager(w, 40);
  const player = P(0.5, w.surfaceY(0, 0), 0.5);
  let maxPassive = 0;
  const kinds = new Set();
  run(mgr, 240, { player, seconds: NOON }, () => {
    assert.equal(hostiles(mgr), 0);
    assert.ok(passives(mgr) <= SPAWN.passiveCap, `${passives(mgr)} passivos (teto ${SPAWN.passiveCap})`);
    maxPassive = Math.max(maxPassive, passives(mgr));
    for (const m of mgr.mobs.values()) kinds.add(m.kind);
  });
  assert.equal(maxPassive, SPAWN.passiveCap, 'a população chegou ao teto');
  assert.ok(kinds.size >= 1 && [...kinds].every((k) => k === 'pig' || k === 'sheep'), `só porcos e ovelhas (vistos: ${[...kinds]})`);
});

test('população: de noite, em Sobrevivência, hostis até min(hostileCapMax, base + dia); nunca acima', () => {
  for (const day of [1, 3, 20]) {
    const seconds = (day - 1) * DAY_LENGTH + NIGHT;
    assert.equal(dayNumber(seconds), day);
    assert.ok(isNight(seconds));
    const cap = hostileCap(seconds);
    const w = realWorld(4);
    const { mgr } = newManager(w, 41 + day);
    const player = P(0.5, w.surfaceY(0, 0), 0.5);
    let max = 0;
    run(mgr, 150, { player, seconds }, () => {
      const n = hostiles(mgr);
      assert.ok(n <= cap, `dia ${day}: ${n} hostis (teto ${cap})`);
      max = Math.max(max, n);
    });
    assert.equal(max, cap, `dia ${day}: chegou ao teto ${cap}`);
  }
  assert.equal(hostileCap(NIGHT), SPAWN.hostileCapBase + 1);
  assert.equal(hostileCap(50 * DAY_LENGTH + NIGHT), SPAWN.hostileCapMax);
});

test('população: Criativo, jogador morto ou de dia => nenhum hostil nasce (de noite, 120 s)', () => {
  for (const [o, seconds] of [[{ mode: 'creative' }, NIGHT], [{ alive: false }, NIGHT], [{}, NOON]]) {
    const w = realWorld(4);
    const { mgr } = newManager(w, 50);
    const player = P(0.5, w.surfaceY(0, 0), 0.5, o);
    run(mgr, 120, { player, seconds }, () => assert.equal(hostiles(mgr), 0));
  }
});

test('população: mistura zumbi:creeper segue os pesos (3:1) e cada grupo respeita group[min,max]', () => {
  const w = realWorld(4);
  const { mgr } = newManager(w, 51, { scene: null });
  const player = P(0.5, w.surfaceY(0, 0), 0.5);
  const seenIds = new Set();
  const tally = { zombie: 0, creeper: 0 };
  const perTick = new Map();
  const seconds = 30 * DAY_LENGTH + NIGHT;
  run(mgr, 900, { player, seconds }, (i) => {
    for (const m of mgr.mobs.values()) {
      if (seenIds.has(m.id) || !m.def.hostile) continue;
      seenIds.add(m.id);
      tally[m.kind]++;
      const key = `${i}:${m.kind}`;
      perTick.set(key, (perTick.get(key) || 0) + 1);
    }
    mgr.clearHostiles(); // mantém o teto livre para acumular amostras
  });
  const total = tally.zombie + tally.creeper;
  assert.ok(total > 150, `${total} hostis amostrados`);
  const frac = tally.zombie / total;
  const expected = MOB_DEFS.zombie.spawn.weight / (MOB_DEFS.zombie.spawn.weight + MOB_DEFS.creeper.spawn.weight);
  near(frac, expected, 0.1, `fração de zumbis (${tally.zombie}/${total})`);
  for (const [key, n] of perTick) {
    const kind = key.split(':')[1];
    const g = MOB_DEFS[kind].spawn.group;
    assert.ok(n >= 1 && n <= g[1], `${key}: grupo de ${n}, esperado ${g}`);
  }
  assert.ok([...perTick].some(([k, n]) => k.endsWith('zombie') && n === MOB_DEFS.zombie.spawn.group[1]), 'grupos de 2 zumbis acontecem');
});

test('população: mistura porco:ovelha segue os pesos (3:2) e cada grupo respeita group[min,max]', () => {
  const w = realWorld(4);
  const { mgr } = newManager(w, 58);
  const player = P(0.5, w.surfaceY(0, 0), 0.5);
  const seen = new Set();
  const tally = { pig: 0, sheep: 0 };
  const perTick = new Map();
  const variants = new Set();
  run(mgr, 500, { player, seconds: NOON }, (i) => {
    for (const m of mgr.mobs.values()) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      tally[m.kind]++;
      if (m.kind === 'sheep') variants.add(m.variant);
      const key = `${i}:${m.kind}`;
      perTick.set(key, (perTick.get(key) || 0) + 1);
    }
    if (i % 100 === 99) mgr.clear(); // libera o teto; o relógio de spawn recomeça (1,5 s = 90 quadros < 100)
  });
  const total = tally.pig + tally.sheep;
  assert.ok(total > 150, `${total} passivos amostrados`);
  const expected = MOB_DEFS.pig.spawn.weight / (MOB_DEFS.pig.spawn.weight + MOB_DEFS.sheep.spawn.weight);
  // a unidade sorteada é o GRUPO (porco 1-3, ovelha 2-4): compara grupos, não indivíduos
  const groups = { pig: 0, sheep: 0 };
  for (const [key] of perTick) groups[key.split(':')[1]]++;
  near(groups.pig / (groups.pig + groups.sheep), expected, 0.1, `fração de grupos de porcos (${groups.pig}/${groups.pig + groups.sheep})`);
  for (const [key, n] of perTick) {
    const kind = key.split(':')[1];
    const g = MOB_DEFS[kind].spawn.group;
    assert.ok(n >= 1 && n <= g[1], `${key}: grupo de ${n}, esperado ${g}`);
  }
  assert.deepEqual([...variants].sort(), [0, 1, 2, 3], 'as 4 cores de lã aparecem');
});

/** Raio máximo de espalhamento de um grupo em relação ao centro sorteado (diagonal do quadrado ±2,5). */
const GROUP_SPREAD_MAX = 2.5 * Math.SQRT2;

test('spawn natural: posição entre minDist e maxDist, suporte em spawn.on, 2 de ar acima, corpo livre, chunk gerado', () => {
  const w = realWorld(4);
  const player = P(0.5, w.surfaceY(0, 0), 0.5);
  const seconds = 5 * DAY_LENGTH + NIGHT;
  let checked = 0;
  const kinds = new Set();
  const { scene, makeView } = spyViews((v, x, y, z) => {
    const def = MOB_DEFS[v.kind];
    kinds.add(v.kind);
    checked++;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    assert.ok(d >= SPAWN.minDist - 1e-9, `${v.kind} nasceu perto demais: ${d.toFixed(2)}`);
    assert.ok(d <= SPAWN.maxDist + GROUP_SPREAD_MAX + 1e-9, `${v.kind} nasceu longe demais: ${d.toFixed(2)}`);
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    assert.ok(w.chunks.has(`${Math.floor(bx / 16)},${Math.floor(bz / 16)}`), 'chunk já gerado');
    assert.equal(y, Math.floor(y), 'pés na face de cima de um bloco');
    const support = w.getBlock(bx, y - 1, bz);
    assert.ok(def.spawn.on.includes(support), `${v.kind} sobre bloco inválido (${support})`);
    assert.notEqual(support, BLOCK.LEAVES, 'nunca em copa de árvore');
    assert.notEqual(support, BLOCK.WOOD, 'nunca em tronco');
    assert.ok(!isSolid(w.getBlock(bx, y, bz)) && !isSolid(w.getBlock(bx, y + 1, bz)), '2 blocos de ar acima');
    assert.equal(w.surfaceY(bx, bz), y, 'é o topo da coluna (nada em cima, nem copa)');
    assert.ok(!collidesBox(w, x, y, z, def.halfW, def.height), 'corpo cabe');
  });
  const { mgr } = newManager(w, 52, { scene, makeView });
  run(mgr, 300, { player, seconds });
  assert.ok(checked >= 15, `${checked} spawns verificados`);
  assert.ok(kinds.has('pig') && kinds.has('zombie'), `tipos vistos: ${[...kinds]}`);
});

test('spawn natural: nenhum membro de grupo nasce a menos de minDist, mesmo com um rng que empurra todos para perto', () => {
  const w = flatWorld({ top: BLOCK.GRASS });
  // rng "adversário": ângulo 0 (leste), distância sempre = minDist, deslocamentos sempre -2,5, grupo sempre cheio
  const stub = { next: () => 0.5, int: (n) => n - 1, range: (a) => a, chance: () => false, pick: (arr) => arr[0], angle: () => 0 };
  const positions = [];
  const { scene, makeView } = spyViews((v, x, y, z) => positions.push([v.kind, x, y, z]));
  const mgr = createMobManager({ world: w, rng: stub, scene, makeView });
  const player = P(0.5, S, 0.5);
  run(mgr, SPAWN.tryInterval + 0.2, { player, seconds: NOON });
  assert.equal(positions.length, 1, 'só o centro do grupo (a exatamente minDist) nasce; os que cairiam mais perto são recusados');
  const [, x, , z] = positions[0];
  assert.ok(Math.hypot(x - player.pos.x, z - player.pos.z) >= SPAWN.minDist - 1e-9);
});

test('tetos: o grupo é cortado para caber exatamente no teto (rng que sempre pede o grupo cheio)', () => {
  // rng "guloso": grupo sempre no tamanho máximo, sem deslocamento entre membros, ângulo fixo
  const greedy = { next: () => 0.5, int: (n) => n - 1, range: (a, b) => (a + b) / 2, chance: () => false, pick: (arr) => arr[0], angle: () => 0 };
  const far = (kind, n) => {
    // vivos "de verdade" (até despawnDist) mas congelados (além de simRadius): contam para o teto e não se mexem
    const w = flatWorld({ top: BLOCK.GRASS, half: 6 });
    const mgr = createMobManager({ world: w, rng: greedy });
    for (let i = 0; i < n; i++) mgr.spawn(kind, 0.5 + SPAWN.simRadius + 4, S, 0.5 + i * 2);
    return { w, mgr };
  };

  // hostis: dia 1 => teto 4; com 3 vivos cabe UM (um grupo de 2 estouraria o teto)
  {
    const cap = hostileCap(NIGHT);
    const { mgr } = far('zombie', cap - 1);
    run(mgr, SPAWN.tryInterval + 0.2, { player: P(0.5, S, 0.5), seconds: NIGHT });
    assert.equal(hostiles(mgr), cap, `hostis: exatamente o teto (${hostiles(mgr)})`);
  }
  // passivos: com passiveCap-1 vivos cabe UM (um grupo de 3 estouraria)
  {
    const { mgr } = far('pig', SPAWN.passiveCap - 1);
    run(mgr, SPAWN.tryInterval + 0.2, { player: P(0.5, S, 0.5), seconds: NOON });
    assert.equal(passives(mgr), SPAWN.passiveCap, `passivos: exatamente o teto (${passives(mgr)})`);
  }
  // já no teto: nada nasce
  {
    const { mgr } = far('pig', SPAWN.passiveCap);
    run(mgr, 3 * SPAWN.tryInterval, { player: P(0.5, S, 0.5), seconds: NOON });
    assert.equal(passives(mgr), SPAWN.passiveCap);
  }
});

test('spawn natural: copa de árvore não serve — com tudo coberto por folhas nada nasce; sem elas, nasce', () => {
  const w = flatWorld({ top: BLOCK.GRASS });
  fill(w, -75, S + 4, -75, 75, S + 4, 75, BLOCK.LEAVES);
  const { mgr } = newManager(w, 54);
  const player = P(0.5, S, 0.5);
  const seconds = NIGHT;
  run(mgr, 120, { player, seconds });
  assert.equal(mgr.mobs.size, 0, 'nada nasceu sobre as copas');
  fill(w, -75, S + 4, -75, 75, S + 4, 75, BLOCK.AIR);
  run(mgr, 60, { player, seconds });
  assert.ok(passives(mgr) > 0 && hostiles(mgr) > 0, 'sem as copas, nasce');
});

test('spawn natural: só em chunk já gerado — chunk ausente não é gerado nem recebe mobs', () => {
  const w = new World(SEED);
  w.getChunkData(0, 0); // só o chunk do jogador
  const { mgr } = newManager(w, 55);
  const player = P(8.5, w.surfaceY(8, 8), 8.5);
  run(mgr, 120, { player, seconds: NOON });
  assert.equal(mgr.mobs.size, 0);
  assert.equal(w.chunks.size, 1, 'tentativas de spawn não geram chunks');
});

test('populate: cria initialPassive passivos entre initialMinDist e initialMaxDist, completa sem duplicar', () => {
  const w = new World(SEED); // propositalmente sem pré-gerar: populate gera o que precisa
  const { mgr } = newManager(w, 56);
  const sy = w.surfaceY(0, 0);
  const pos = { x: 0.5, y: sy, z: 0.5 };
  mgr.populate(pos, 0);
  assert.equal(passives(mgr), SPAWN.initialPassive);
  assert.equal(hostiles(mgr), 0);
  for (const m of mgr.mobs.values()) {
    assert.ok(m.kind === 'pig' || m.kind === 'sheep');
    const d = Math.hypot(m.body.pos.x - pos.x, m.body.pos.z - pos.z);
    assert.ok(d >= SPAWN.initialMinDist - 0.2 && d <= SPAWN.initialMaxDist + GROUP_SPREAD_MAX + 0.2, `distância ${d.toFixed(1)}`);
    assert.equal(m.body.pos.y, w.surfaceY(Math.floor(m.body.pos.x), Math.floor(m.body.pos.z)), 'em pé no chão');
    assert.ok(m.def.spawn.on.includes(w.getBlock(Math.floor(m.body.pos.x), m.body.pos.y - 1, Math.floor(m.body.pos.z))));
    if (m.kind === 'sheep') assert.ok(m.variant >= 0 && m.variant < MOB_DEFS.sheep.variants);
  }
  mgr.populate(pos, 0);
  assert.equal(passives(mgr), SPAWN.initialPassive, 'chamar de novo não duplica');
  const some = [...mgr.mobs.values()].slice(0, 3);
  for (const m of some) kill(mgr, m);
  run(mgr, 1, { player: { pos, alive: true, mode: 'survival' }, seconds: NOON });
  mgr.populate(pos, 0);
  assert.equal(passives(mgr), SPAWN.initialPassive, 'completa o que faltou');
  mgr.clear();
  mgr.populate(pos, 0);
  assert.equal(passives(mgr), SPAWN.initialPassive, 'recomeça do zero (respawn)');
});

test('populate: mesma seed e mesmo mundo => mesma população', () => {
  const a = newManager(new World(SEED), 57);
  const b = newManager(new World(SEED), 57);
  const pos = { x: 0.5, y: 25, z: 0.5 };
  a.mgr.populate(pos, 0);
  b.mgr.populate(pos, 0);
  const sig = (m) => [...m.mobs.values()].map((x) => [x.kind, x.variant, x.body.pos.x, x.body.pos.y, x.body.pos.z]);
  assert.deepEqual(sig(a.mgr), sig(b.mgr));
});

// ---------------------------------------------------------------------------
// Despawn / congelar
// ---------------------------------------------------------------------------

test('distância: além de despawnDist some; além de simRadius congela; dentro simula', () => {
  const w = flatWorld({ half: 8 });
  const { mgr } = newManager(w, 60);
  const player = P(0.5, S, 0.5, { mode: 'creative' });
  const nearPig = mgr.spawn('pig', 20.5, S, 0.5);
  const frozen = mgr.spawn('pig', 0.5 + SPAWN.simRadius + 4, S, 0.5);
  const gone = mgr.spawn('pig', 0.5 + SPAWN.despawnDist + 2, S, 0.5);
  const p0 = { ...frozen.body.pos };
  const s0 = frozen.state;
  const t0 = frozen.stateT;
  run(mgr, 60, { player, seconds: NOON });
  assert.ok(!mgr.mobs.has(gone.id), 'despawnado');
  assert.deepEqual({ ...frozen.body.pos }, p0, 'congelado: não se moveu');
  assert.equal(frozen.state, s0);
  assert.equal(frozen.stateT, t0, 'nem o relógio da IA andou');
  assert.ok(mgr.mobs.has(frozen.id));
  assert.ok(Math.hypot(nearPig.body.pos.x - 20.5, nearPig.body.pos.z - 0.5) > 1, 'o de perto andou');

  // o jogador anda até o congelado: ele descongela
  player.pos.x = frozen.body.pos.x - 20;
  run(mgr, 40, { player, seconds: NOON });
  assert.notDeepEqual({ ...frozen.body.pos }, p0);
});

test('despawn diurno: hostis além de daylightDespawnDist somem a ~daylightDespawnChance por segundo; perto e à noite ficam', () => {
  const N = 120;
  const makeScene = (distFar, seconds, secs) => {
    const w = flatWorld({ half: 6 });
    const { mgr } = newManager(w, 61);
    for (let i = 0; i < N; i++) mgr.spawn('creeper', 0.5 + distFar, S, 0.5 + (i - N / 2) * 0.3); // fileira: sem sobreposição
    const player = P(0.5, S, 0.5, { mode: 'creative' });
    run(mgr, secs, { player, seconds });
    return mgr.count('creeper');
  };
  // 4 s de dia a 30 blocos: sobrevivem ~ (1 - p)^4
  const survivors = makeScene(30, NOON, 4);
  const expected = Math.pow(1 - SPAWN.daylightDespawnChance, 4);
  near(survivors / N, expected, 0.1, `sobreviventes após 4 s (${survivors}/${N})`);
  assert.equal(makeScene(SPAWN.daylightDespawnDist / 2, NOON, 8), N, 'perto: nenhum some');
  assert.equal(makeScene(30, NIGHT, 30), N, 'à noite: nenhum some');
  assert.equal(makeScene(30, NOON, 40), 0, 'com o tempo todos somem');
});

test('clearHostiles/clear/dispose: só os hostis, tudo, e depois de dispose o gerenciador fica inerte', () => {
  const w = flatWorld({ top: BLOCK.GRASS });
  const { mgr } = newManager(w, 62);
  mgr.spawn('pig', 3.5, S, 3.5);
  mgr.spawn('sheep', 5.5, S, 3.5);
  mgr.spawn('zombie', 7.5, S, 3.5);
  mgr.spawn('creeper', 9.5, S, 3.5);
  assert.equal(mgr.count(), 4);
  mgr.clearHostiles();
  assert.equal(mgr.count(), 2);
  assert.equal(hostiles(mgr), 0);
  const pig = mgr.mobs.values().next().value;
  mgr.damage(pig, 1, { fromX: 0, fromZ: 0, knock: 6 }); // enfileira um evento de som
  mgr.clear();
  assert.equal(mgr.mobs.size, 0);
  assert.equal(mgr.update(DT, { player: P(0, S, 0), seconds: NOON }).length, 0, 'clear também descarta eventos pendentes');
  mgr.spawn('pig', 3.5, S, 3.5);
  mgr.dispose();
  assert.equal(mgr.mobs.size, 0);
  assert.equal(mgr.update(DT, { player: P(0, S, 0), seconds: NOON }).length, 0);
  mgr.populate({ x: 0, y: S, z: 0 }, 0);
  assert.equal(mgr.mobs.size, 0, 'populate depois de dispose não faz nada');
});

// ---------------------------------------------------------------------------
// Raycast
// ---------------------------------------------------------------------------

test('raycast: acerta o mob certo (o mais próximo), com distância e ponto de impacto corretos', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 70);
  const pig = mgr.spawn('pig', 0.5, S, 5.5);
  const sheep = mgr.spawn('sheep', 0.5, S, 10.5);
  const origin = { x: 0.5, y: S + 0.5, z: 0.5 };
  const dir = { x: 0, y: 0, z: 1 };

  const hit = mgr.raycast(origin, dir, 20);
  assert.equal(hit.mob, pig, 'o mais próximo');
  const frontFace = 5.5 - pig.def.halfW;
  near(hit.distance, frontFace - 0.5, 1e-9);
  near(hit.point.z, frontFace, 1e-9);
  near(hit.point.x, 0.5, 1e-9);
  near(hit.point.y, S + 0.5, 1e-9);

  // maxDist respeitado (inclusive: no limite acerta, aquém não)
  assert.equal(mgr.raycast(origin, dir, 3.9), null);
  assert.equal(mgr.raycast(origin, dir, hit.distance + 1e-6).mob, pig);
  assert.equal(mgr.raycast(origin, dir, 0), null);
  assert.equal(mgr.raycast(origin, dir, -1), null);

  // alvo desviado: acima da altura do porco passa por cima dele (e a ovelha, mais alta, é atingida)
  const high = mgr.raycast({ x: 0.5, y: S + 1.1, z: 0.5 }, dir, 20);
  assert.equal(high.mob, sheep, 'passou por cima do porco (0,9) e bateu na ovelha (1,3)');
  // mira de lado: erra os dois
  assert.equal(mgr.raycast({ x: 3, y: S + 0.5, z: 0.5 }, dir, 20), null);
  // direção oposta
  assert.equal(mgr.raycast(origin, { x: 0, y: 0, z: -1 }, 20), null);
  // direção nula
  assert.equal(mgr.raycast(origin, { x: 0, y: 0, z: 0 }, 20), null);
  // direção não unitária dá o mesmo resultado (distância em unidades do mundo)
  const h2 = mgr.raycast(origin, { x: 0, y: 0, z: 7 }, 20);
  assert.equal(h2.mob, pig);
  near(h2.distance, hit.distance, 1e-9);
  // dentro da caixa: distância 0
  const inside = mgr.raycast({ x: 0.5, y: S + 0.4, z: 5.5 }, dir, 20);
  assert.equal(inside.mob, pig);
  assert.equal(inside.distance, 0);
});

test('raycast: ignora mortos e deixa passar para o de trás; o corpo não é alvo', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 71);
  const a = mgr.spawn('zombie', 0.5, S, 4.5);
  const b = mgr.spawn('zombie', 0.5, S, 8.5);
  const origin = { x: 0.5, y: S + 1, z: 0.5 };
  const dir = { x: 0, y: 0, z: 1 };
  assert.equal(mgr.raycast(origin, dir, 30).mob, a);
  kill(mgr, a);
  assert.equal(mgr.raycast(origin, dir, 30).mob, b);
  kill(mgr, b);
  assert.equal(mgr.raycast(origin, dir, 30), null);
});

test('raycast: concorda com uma marcha de raio independente em centenas de raios aleatórios', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 72);
  const rng = makeRng(99);
  const list = [];
  for (let i = 0; i < 8; i++) list.push(mgr.spawn(MOB_KINDS[i % 4], rng.range(-6, 6), S, rng.range(-6, 6)));
  const inBox = (m, x, y, z) => {
    const p = m.body.pos;
    return Math.abs(x - p.x) <= m.def.halfW && Math.abs(z - p.z) <= m.def.halfW && y >= p.y && y <= p.y + m.def.height;
  };
  let hits = 0;
  let misses = 0;
  for (let n = 0; n < 500; n++) {
    const o = { x: rng.range(-9, 9), y: S + rng.range(0.2, 2.5), z: rng.range(-9, 9) };
    // aponta para perto de um mob qualquer (parte acerta, parte passa raspando ou erra)
    const target = list[rng.int(list.length)].body.pos;
    const tx = target.x + rng.range(-1.2, 1.2) - o.x;
    const ty = S + rng.range(0, 1.8) - o.y;
    const tz = target.z + rng.range(-1.2, 1.2) - o.z;
    const l = Math.hypot(tx, ty, tz) || 1;
    const dir = { x: tx / l, y: ty / l, z: tz / l };
    const maxD = rng.range(2, 14);
    // referência: marcha em passos de 1 mm
    let ref = null;
    for (let t = 0; t <= maxD; t += 0.001) {
      const hit = list.find((m) => inBox(m, o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t));
      if (hit) {
        ref = { mob: hit, t };
        break;
      }
    }
    const got = mgr.raycast(o, dir, maxD);
    if (ref) {
      hits++;
      assert.ok(got, `raio ${n}: devia acertar`);
      near(got.distance, ref.t, 0.0021, `raio ${n}: distância`);
      // o ponto de impacto está na caixa do mob devolvido e à distância dita
      const p = got.mob.body.pos;
      const eps = 1e-9;
      assert.ok(Math.abs(got.point.x - p.x) <= got.mob.def.halfW + eps && Math.abs(got.point.z - p.z) <= got.mob.def.halfW + eps);
      assert.ok(got.point.y >= p.y - eps && got.point.y <= p.y + got.mob.def.height + eps);
      near(Math.hypot(got.point.x - o.x, got.point.y - o.y, got.point.z - o.z), got.distance, 1e-9, 'ponto à distância dita');
    } else {
      misses++;
      // a marcha de 1 mm pode perder um raspão menor que 1 mm: se o raycast acertou, que seja dentro de maxDist
      if (got) assert.ok(got.distance <= maxD && got.distance >= 0);
    }
  }
  assert.ok(hits > 100 && misses > 50, `cobriu acertos (${hits}) e erros (${misses})`);
});

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

/** Roda um cenário completo (anoitecer, população, perseguição, golpes, explosões) e devolve a trilha. */
function scenario(seed) {
  const w = flatWorld({ top: BLOCK.GRASS });
  const rng = makeRng(seed);
  const mgr = createMobManager({ world: w, rng });
  const pos0 = { x: 0.5, y: S, z: 0.5 };
  mgr.populate(pos0, 0);
  mgr.spawn('zombie', 9.5, S, 2.5);
  mgr.spawn('creeper', -9.5, S, 2.5);
  const trail = [];
  const slim = (e, i) => ({
    i,
    type: e.type,
    name: e.name,
    amount: e.amount,
    source: e.source,
    x: e.x,
    y: e.y,
    z: e.z,
    id: e.mob?.id,
    kind: e.mob?.kind,
    drops: e.drops,
    byPlayer: e.byPlayer,
    blocks: e.blocks?.length,
    knock: e.knock,
  });
  const player = P(0.5, S, 0.5);
  const total = 100 * 60;
  for (let i = 0; i < total; i++) {
    const a = i * DT * 0.35;
    player.pos.x = Math.cos(a) * 7;
    player.pos.z = Math.sin(a) * 7;
    const seconds = DAY_LENGTH * 0.45 + i * DT * 3; // do fim da tarde até a noite (acelerado)
    if (i % 200 === 100) {
      const alive = [...mgr.mobs.values()].filter((m) => !m.dead);
      if (alive.length) mgr.damage(alive[(i / 200) % alive.length | 0], 4, { fromX: player.pos.x, fromZ: player.pos.z, knock: 6 });
    }
    for (const e of mgr.update(DT, { player, seconds })) trail.push(slim(e, i));
  }
  const snap = [...mgr.mobs.values()].map((m) => [m.id, m.kind, m.state, m.hp, m.variant, m.body.pos.x, m.body.pos.y, m.body.pos.z, m.yaw, m.fuse, m.attackCd]);
  return { trail, snap, next: rng.next() };
}

test('determinismo: mesma seed + mesma sequência de ctx => eventos, estados finais e rng idênticos', () => {
  const a = scenario(2024);
  const b = scenario(2024);
  assert.ok(a.trail.length > 30, `cenário rico (${a.trail.length} eventos)`);
  const types = new Set(a.trail.map((e) => e.type));
  for (const t of ['sound', 'hurt-player']) assert.ok(types.has(t), `cenário exercita ${t}`);
  assert.deepEqual(a.trail, b.trail);
  assert.deepEqual(a.snap, b.snap);
  assert.equal(a.next, b.next, 'consumiu o rng exatamente igual');
  const c = scenario(2025);
  assert.notDeepEqual(a.trail, c.trail, 'outra seed => outra história');
});

// ---------------------------------------------------------------------------
// Orçamento de CPU
// ---------------------------------------------------------------------------

test('orçamento: 18 mobs simulando 600 quadros de 1/60 s em ~1,5 s de CPU ou menos', (t) => {
  const w = realWorld(4);
  const sy = w.surfaceY(0, 0);
  // 9 passivos, 6 zumbis, 3 creepers espalhados a 6..24 blocos
  const kinds = ['pig', 'sheep', 'pig', 'sheep', 'pig', 'sheep', 'pig', 'sheep', 'pig', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'creeper', 'creeper', 'creeper'];

  // trajetória do jogador pré-calculada (correndo em círculo a 6 b/s: os hostis perseguem o tempo todo,
  // o pior caso de movimento + colisão + degraus) — fora da medição
  const path = [];
  for (let i = 0; i < 600; i++) {
    const a = i * DT * 0.6;
    const x = Math.cos(a) * 10;
    const z = Math.sin(a) * 10;
    path.push({ player: P(x, w.surfaceY(Math.floor(x), Math.floor(z)), z), seconds: NIGHT });
  }

  /** Uma rodada completa: mobs novos, 600 quadros, tempo medido só do laço de update. */
  function round(seed) {
    const { mgr } = newManager(w, seed);
    const rng = makeRng(5 + seed);
    for (const kind of kinds) {
      const a = rng.angle();
      const d = rng.range(6, 24);
      const x = Math.floor(Math.cos(a) * d);
      const z = Math.floor(Math.sin(a) * d);
      mgr.spawn(kind, x + 0.5, w.surfaceY(x, z), z + 0.5);
    }
    assert.equal(mgr.count(), 18);
    let moving = 0;
    const start = process.hrtime.bigint();
    for (let i = 0; i < 600; i++) mgr.update(DT, path[i]);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    for (const m of mgr.mobs.values()) if (Math.hypot(m.body.vel.x, m.body.vel.z) > 0.1 || m.state === STATE.WANDER || m.state === STATE.CHASE) moving++;
    return { ms, alive: mgr.count(), moving };
  }

  // O laço é síncrono e ligado à CPU, então o tempo de relógio (alta resolução) é o tempo de CPU
  // (process.cpuUsage tem resolução de ~15 ms no Windows). A 1ª rodada inclui o aquecimento do JIT.
  const rounds = [1, 2, 3, 4, 5].map((seed) => round(seed));
  const times = rounds.map((r) => r.ms).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  t.diagnostic(
    `18 mobs x 600 quadros: mediana ${median.toFixed(1)} ms de CPU (${(median / 600).toFixed(3)} ms/quadro); 1ª rodada (com JIT frio) ${rounds[0].ms.toFixed(1)} ms; pior ${times[times.length - 1].toFixed(1)} ms`
  );
  for (const r of rounds) {
    assert.ok(r.alive >= 15, `os mobs seguiram vivos e simulando (${r.alive})`);
    assert.ok(r.moving >= 10, `a maioria estava em movimento (${r.moving})`);
  }
  assert.ok(rounds[0].ms < 1500, `1ª rodada: ${rounds[0].ms.toFixed(0)} ms > 1500 ms`);
  assert.ok(median < 1500, `mediana: ${median.toFixed(0)} ms > 1500 ms`);
});

test('vazio: mob que cai abaixo de SPAWN.voidY é removido (saves antigos com buraco até o fundo)', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 91);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const keep = mgr.spawn('pig', 3.5, S, 0.5);
  pig.body.pos.y = SPAWN.voidY - 1;
  mgr.update(DT, { player: P(0.5, S, 0.5), seconds: NOON });
  assert.equal(mgr.mobs.has(pig.id), false, 'o que caiu no vazio sumiu');
  assert.equal(mgr.mobs.has(keep.id), true, 'os demais ficam');
});

// ---------------------------------------------------------------------------
// Caminho local (feature 017): quem persegue contorna obstáculos pela grade
// ---------------------------------------------------------------------------

/** Muro em U de 3 blocos: base em x=3 (z −3..3) e braços em z=±3 (x 0..2); abertura a oeste. */
function uWall(w) {
  fill(w, 3, S, -3, 3, S + 2, 3, BLOCK.COBBLE);
  fill(w, 0, S, -3, 2, S + 2, -3, BLOCK.COBBLE);
  fill(w, 0, S, 3, 2, S + 2, 3, BLOCK.COBBLE);
}

test('caminho local: zumbi contorna um muro em U de 3 blocos e chega ao jogador em até 8 s, sem entrar em bloco', () => {
  for (const seed of [1, 2, 3]) {
    const w = flatWorld();
    uWall(w);
    const { mgr } = newManager(w, seed);
    const z = mgr.spawn('zombie', 0.5, S, 0.5); // dentro do U
    const player = P(6.5, S, 0.5); // do lado de fora, a leste
    let arrivedAt = null;
    let inside = false;
    let waypointInSolid = false;
    run(mgr, 8, { player, seconds: NIGHT }, (i) => {
      const p = z.body.pos;
      if (collidesBox(w, p.x, p.y, p.z, z.def.halfW, z.def.height)) inside = true;
      for (const c of z.path ?? []) {
        if (isSolid(w.getBlock(c.x, c.y, c.z)) || isSolid(w.getBlock(c.x, c.y + 1, c.z))) waypointInSolid = true;
      }
      if (arrivedAt === null && z.state === STATE.ATTACK) arrivedAt = (i + 1) * DT;
    });
    assert.ok(arrivedAt !== null, `seed ${seed}: chegou ao jogador em 8 s`);
    assert.equal(inside, false, 'o corpo nunca ficou dentro de um bloco');
    assert.equal(waypointInSolid, false, 'nenhum waypoint do caminho é sólido');
  }
});

test('caminho local: zumbi fora de uma ilha cercada nunca entra no bloco nem na ilha, e não bate através da cerca', () => {
  const w = flatWorld();
  // cerca de 3 blocos de altura em volta de (6,0): o jogador fica numa "ilha" sem acesso
  fill(w, 5, S, -1, 7, S + 2, -1, BLOCK.COBBLE);
  fill(w, 5, S, 1, 7, S + 2, 1, BLOCK.COBBLE);
  fill(w, 5, S, 0, 5, S + 2, 0, BLOCK.COBBLE);
  fill(w, 7, S, 0, 7, S + 2, 0, BLOCK.COBBLE);
  const { mgr } = newManager(w, 21);
  const z = mgr.spawn('zombie', 0.5, S, 0.5);
  const player = P(6.5, S, 0.5);
  let inside = false;
  let intoIsland = false;
  const ev = run(mgr, 10, { player, seconds: NIGHT }, () => {
    const p = z.body.pos;
    if (collidesBox(w, p.x, p.y, p.z, z.def.halfW, z.def.height)) inside = true;
    if (Math.floor(p.x) === 6 && Math.floor(p.z) === 0) intoIsland = true;
  });
  assert.equal(inside, false, 'nunca ficou dentro de bloco');
  assert.equal(intoIsland, false, 'nunca entrou na célula do jogador, dentro da cerca');
  assert.equal(ofType(ev, 'hurt-player').length, 0, 'a cerca bloqueia a linha de visão: ninguém apanha');
});

test('caminho local: mesma seed e mesma sequência de ctx ⇒ mesmos caminhos a cada quadro', () => {
  const runOnce = () => {
    const w = flatWorld();
    uWall(w);
    const { mgr } = newManager(w, 33);
    const z = mgr.spawn('zombie', 0.5, S, 0.5);
    const snaps = [];
    const ctxOf = (i) => ({ player: P(i > 300 ? 4.5 : 6.5, S, i > 120 ? 2.5 : 0.5), seconds: NIGHT });
    run(mgr, 8, ctxOf, () => snaps.push(JSON.stringify([z.path, z.body.pos])));
    return snaps;
  };
  const a = runOnce();
  const b = runOnce();
  assert.ok(a.some((s) => s.includes('"x":')), 'houve caminho');
  assert.deepEqual(a, b);
});

test('caminho local: o caminho nunca passa pela célula dos pés de outro mob (porco parado no meio)', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 44);
  const z = mgr.spawn('zombie', 0.5, S, 0.5);
  const pig = mgr.spawn('pig', 2.5, S, 0.5); // no meio do caminho, em (2, S, 0)
  const player = P(4.5, S, 0.5);
  let violou = false;
  let attackedAt = null;
  run(mgr, 8, { player, seconds: NIGHT }, (i) => {
    pig.state = STATE.IDLE; // o porco fica parado: a célula dele é fixa
    pig.stateT = 1e9;
    if (z.path && z.path.some((c) => c.x === 2 && c.z === 0)) violou = true;
    if (attackedAt === null && z.state === STATE.ATTACK) attackedAt = (i + 1) * DT;
  });
  assert.equal(violou, false, 'nenhum caminho passou pelos pés do porco');
  assert.ok(attackedAt !== null, 'e o zumbi contorna o porco e alcança o jogador');
});

test('caminho local: replanejamento escalonado — no máximo 2 mobs planejam por quadro, e todos têm caminho em 3 quadros', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 55);
  const zs = [];
  for (let i = 0; i < 6; i++) zs.push(mgr.spawn('zombie', 5.5, S, -2.5 + i)); // seis zumbis que chegam juntos
  const player = P(0.5, S, 0.5);
  mgr.update(DT, { player, seconds: NIGHT });
  const primeiro = zs.filter((z) => z.path !== null).length;
  assert.ok(primeiro >= 1 && primeiro <= 2, `após 1 quadro, ${primeiro} planejaram (orçamento de 2 por quadro)`);
  mgr.update(DT, { player, seconds: NIGHT });
  mgr.update(DT, { player, seconds: NIGHT });
  assert.equal(zs.filter((z) => z.path !== null).length, 6, 'em 3 quadros, os seis têm caminho');
});

test('caminho local: o creeper também contorna o muro em U e passa para o outro lado (persegue pela abertura)', () => {
  const w = flatWorld();
  uWall(w);
  const { mgr } = newManager(w, 66);
  const c = mgr.spawn('creeper', 0.5, S, 0.5);
  const player = P(6.5, S, 0.5);
  let passou = false;
  run(mgr, 8, { player, seconds: NIGHT }, () => {
    if (c.body.pos.x > 3.5) passou = true; // além da base do U (x=3): só andando por fora dos braços
  });
  assert.ok(passou, 'o creeper saiu do U e passou da base');
});

test('caminho local: passivos não planejam caminho (porco e ovelha não perseguem)', () => {
  const w = flatWorld();
  const { mgr } = newManager(w, 77);
  const pig = mgr.spawn('pig', 0.5, S, 0.5);
  const sheep = mgr.spawn('sheep', 3.5, S, 0.5);
  run(mgr, 5, { player: P(4.5, S, 0.5), seconds: NOON });
  assert.equal(pig.path, null);
  assert.equal(sheep.path, null);
});

test('caminho local: alvo a 9 blocos, atrás do U: o zumbi não oscila na borda da janela e contorna o muro', () => {
  const w = flatWorld();
  uWall(w);
  const { mgr } = newManager(w, 67);
  const z = mgr.spawn('zombie', 0.5, S, 0.5);
  const player = P(9.5, S, 0.5); // fora da janela a partir do início; o caminho nasce quando o zumbi entra nela
  let arrivedAt = null;
  run(mgr, 12, { player, seconds: NIGHT }, (i) => {
    if (arrivedAt === null && z.state === STATE.ATTACK) arrivedAt = (i + 1) * DT;
  });
  assert.ok(arrivedAt !== null && arrivedAt < 10, `chegou em ${arrivedAt === null ? 'nunca' : arrivedAt.toFixed(2) + ' s'}`);
});

test('perseguição a 18 blocos atrás do muro em U (percebido com aggroRange 21): a janela alcança e o zumbi chega', () => {
  const w = flatWorld();
  uWall(w);
  const { mgr } = newManager(w, 71);
  const z = mgr.spawn('zombie', 0.5, S, 0.5);
  const player = P(18.5, S, 0.5);
  let arrivedAt = null;
  run(mgr, 25, { player, seconds: NIGHT }, (i) => {
    if (arrivedAt === null && z.state === STATE.ATTACK) arrivedAt = (i + 1) * DT;
  });
  assert.ok(arrivedAt !== null && arrivedAt < 22, 'chegou em ' + (arrivedAt === null ? 'nunca' : arrivedAt.toFixed(2) + ' s'));
});
