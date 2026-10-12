// Testes headless da feature 013 (IA): `think` puro, sem mundo e sem Three.js.
// Mobs montados à mão; o rng é sempre o semeado de src/rng.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../src/rng.js';
import { MOB_DEFS, MOB_KINDS } from '../src/entities/mobs.js';
import { createBody } from '../src/entities/physics.js';
import { PLAYER } from '../src/player/collision.js';
import { AI, STATE, VOICE, initMob, isTargetable, think } from '../src/entities/ai.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b} ± ${eps}, veio ${a}`);

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

/** Mob mínimo, com os campos de IA já inicializados. `x,z` = pés. */
function mk(kind, { x = 0, y = 10, z = 0, seed = 1 } = {}) {
  const def = MOB_DEFS[kind];
  const rng = makeRng(seed);
  const mob = {
    id: 1,
    kind,
    def,
    body: createBody({ x, y, z, halfW: def.halfW, height: def.height }),
    hp: def.maxHp,
    dead: false,
    blockedT: 0,
  };
  initMob(mob, def, rng);
  return { mob, def, rng };
}

const player = (x, z, { y = 10, alive = true, mode = 'survival' } = {}) => ({ pos: { x, y, z }, alive, mode });
const ctxOf = (p, events = []) => ({ player: p, seconds: 0, events });
const len = (v) => Math.sqrt(v.x * v.x + v.z * v.z);
const strikes = (events) => events.filter((e) => e.type === 'hurt-player');
const sounds = (events, name) => events.filter((e) => e.type === 'sound' && (!name || e.name === name));

/** Centro-a-centro horizontal ao longo de +X que deixa `edge` blocos entre as bordas. */
const xForEdge = (def, edge) => def.halfW + PLAYER.halfWidth + edge;

// ---------------------------------------------------------------------------
// 1. Fonte
// ---------------------------------------------------------------------------

test('fontes: ai.js e manager.js sem Math.random, Date.now nem console', () => {
  for (const file of ['src/entities/ai.js', 'src/entities/manager.js']) {
    // tira comentários antes de varrer (os comentários citam "Math.random" de propósito)
    const src = fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random\s*\(/.test(src), `${file}: Math.random`);
    assert.ok(!/Date\.now|performance\.now|new Date/.test(src), `${file}: relógio`);
    assert.ok(!/console\./.test(src), `${file}: console`);
  }
});

test('isTargetable: vivo e fora do Criativo; mode ausente = Sobrevivência', () => {
  assert.equal(isTargetable(player(0, 0)), true);
  assert.equal(isTargetable(player(0, 0, { alive: false })), false);
  assert.equal(isTargetable(player(0, 0, { mode: 'creative' })), false);
  assert.equal(isTargetable({ pos: { x: 0, y: 0, z: 0 } }), true);
  assert.equal(isTargetable(null), false);
  assert.equal(isTargetable({}), false);
});

test('initMob: fase inicial sorteada (grupo não sincroniza) e dentro dos limites', () => {
  const phases = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const { mob, def } = mk('pig', { seed });
    assert.equal(mob.state, STATE.IDLE);
    assert.ok(mob.stateT >= 0 && mob.stateT <= def.idleTime[1]);
    assert.ok(mob.voiceT >= AI.voiceGap[0] && mob.voiceT <= AI.voiceGap[1]);
    assert.deepEqual(mob.wish, { x: 0, z: 0 });
    assert.equal(mob.fuse, 0);
    assert.equal(mob.attackCd, 0);
    phases.add(mob.stateT);
  }
  assert.ok(phases.size >= 25, 'fases iniciais diferentes por seed');
});

// ---------------------------------------------------------------------------
// 2. Passivo: idle <-> wander
// ---------------------------------------------------------------------------

/** Roda `think` por `seconds` e devolve a trilha quadro a quadro. */
function trace(kind, seconds, { seed = 1, player: p = player(500, 500), mutate } = {}) {
  const { mob, def, rng } = mk(kind, { seed });
  const ctx = ctxOf(p);
  const rows = [];
  for (let i = 0; i < seconds / DT; i++) {
    if (mutate) mutate(mob, i);
    think(mob, def, ctx, rng, DT);
    rows.push({ state: mob.state, wx: mob.wish.x, wz: mob.wish.z, speed: mob.speed });
  }
  return { rows, mob, def, ctx };
}

for (const kind of ['pig', 'sheep']) {
  test(`passivo (${kind}): alterna idle e wander com durações dentro de idleTime/wanderTime`, () => {
    const { rows, def } = trace(kind, 240);
    // segmentos contíguos do mesmo estado
    const segs = [];
    for (const r of rows) {
      const last = segs[segs.length - 1];
      if (last && last.state === r.state) last.frames++;
      else segs.push({ state: r.state, frames: 1 });
    }
    assert.ok(segs.length >= 20, `muitas transições (${segs.length})`);
    const idle = segs.filter((s) => s.state === STATE.IDLE);
    const wander = segs.filter((s) => s.state === STATE.WANDER);
    assert.ok(idle.length >= 8 && wander.length >= 8);
    assert.ok(segs.every((s) => s.state === STATE.IDLE || s.state === STATE.WANDER), 'nunca chase/flee sem motivo');
    // ignora o 1º segmento (fase inicial sorteada, pode ser curta) e o último (cortado)
    const slack = 2.5 * DT;
    for (const s of segs.slice(1, -1)) {
      const [lo, hi] = s.state === STATE.IDLE ? def.idleTime : def.wanderTime;
      const d = s.frames * DT;
      assert.ok(d >= lo - slack && d <= hi + slack, `${s.state} durou ${d.toFixed(3)}s fora de [${lo}, ${hi}]`);
    }
    // wander: direção unitária e walkSpeed; idle: parado
    for (const r of rows) {
      if (r.state === STATE.WANDER) {
        near(Math.hypot(r.wx, r.wz), 1, 1e-9, 'direção unitária');
        assert.equal(r.speed, def.walkSpeed);
      } else {
        assert.equal(r.wx, 0);
        assert.equal(r.wz, 0);
        assert.equal(r.speed, 0);
      }
    }
  });
}

test('passivo: as direções do passeio cobrem o círculo (aleatórias, não fixas)', () => {
  const { rows } = trace('pig', 300);
  const quadrants = new Set();
  for (const r of rows) if (r.state === STATE.WANDER) quadrants.add((r.wx >= 0 ? 1 : 0) + (r.wz >= 0 ? 2 : 0));
  assert.equal(quadrants.size, 4);
});

test('passivo: determinístico por seed (mesma => mesma trilha; outra => outra)', () => {
  const a = trace('sheep', 60, { seed: 11 });
  const b = trace('sheep', 60, { seed: 11 });
  const c = trace('sheep', 60, { seed: 12 });
  assert.deepEqual(a.rows, b.rows);
  assert.notDeepEqual(a.rows, c.rows);
});

test('passivo: voz ocasional ao vagar (pig/sheep), nunca em intervalo menor que voiceGap', () => {
  for (const kind of ['pig', 'sheep']) {
    const { mob, def, rng } = mk(kind, { seed: 5 });
    const ctx = ctxOf(player(500, 500));
    const times = [];
    for (let i = 0; i < 300 / DT; i++) {
      think(mob, def, ctx, rng, DT);
      while (ctx.events.length) {
        const e = ctx.events.pop();
        assert.equal(e.type, 'sound');
        assert.equal(e.name, VOICE[kind]);
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z));
        times.push(i * DT);
      }
    }
    assert.ok(times.length >= 300 / AI.voiceGap[1] - 1 && times.length <= 300 / AI.voiceGap[0] + 1, `${kind}: ${times.length} vozes em 300 s`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= AI.voiceGap[0] - 2 * DT);
  }
});

test('think funciona sem ctx.events (nada é emitido, nada quebra)', () => {
  const { mob, def, rng } = mk('zombie');
  const ctx = { player: player(def.halfW + PLAYER.halfWidth + 0.5, 0), seconds: 0 };
  assert.doesNotThrow(() => think(mob, def, ctx, rng, DT));
  assert.equal(mob.attackCd, def.attackCooldown, 'golpeou mesmo assim (só não emitiu)');
});

// ---------------------------------------------------------------------------
// 3. Passivo ferido: foge
// ---------------------------------------------------------------------------

test('fuga: hurtBy => flee por fleeTime com fleeSpeed, para longe da origem; depois idle', () => {
  for (const kind of ['pig', 'sheep']) {
    for (let seed = 1; seed <= 15; seed++) {
      const { mob, def, rng } = mk(kind, { x: 5, z: 5, seed });
      const ctx = ctxOf(player(500, 500));
      mob.hurtBy = { x: 2, z: 5 }; // golpe vindo de -X: foge para +X
      think(mob, def, ctx, rng, DT);
      assert.equal(mob.state, STATE.FLEE);
      assert.equal(mob.hurtBy, null, 'hurtBy consumido');
      assert.equal(mob.speed, def.fleeSpeed);
      assert.ok(def.fleeSpeed > def.walkSpeed);
      near(len(mob.wish), 1, 1e-9);
      assert.ok(mob.wish.x > Math.cos(AI.fleeJitter) - 1e-9, `${kind}/${seed}: foge para longe (wish.x=${mob.wish.x})`);

      // dura fleeTime
      let t = DT;
      while (mob.state === STATE.FLEE && t < def.fleeTime + 1) {
        think(mob, def, ctx, rng, DT);
        t += DT;
      }
      near(t, def.fleeTime, 2 * DT, 'duração da fuga');
      assert.equal(mob.state, STATE.IDLE);
      assert.equal(mob.speed, 0);
    }
  }
});

test('fuga: ferido de novo durante a fuga reinicia o tempo e vira o rumo', () => {
  const { mob, def, rng } = mk('pig', { x: 0, z: 0, seed: 3 });
  const ctx = ctxOf(player(500, 500));
  mob.hurtBy = { x: -3, z: 0 };
  think(mob, def, ctx, rng, DT);
  for (let i = 0; i < 2 / DT; i++) think(mob, def, ctx, rng, DT); // 2 s depois
  assert.equal(mob.state, STATE.FLEE);
  assert.ok(mob.stateT < def.fleeTime - 1.5);
  mob.hurtBy = { x: 3, z: 0 }; // agora vem de +X: foge para -X
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.FLEE);
  near(mob.stateT, def.fleeTime - DT, 1e-9, 'reiniciou (menos o quadro atual)');
  assert.ok(mob.wish.x < -0.9, 'virou o rumo');
});

test('fuga: golpe vindo de dentro do mob (origem = posição) foge para algum lado, sem NaN', () => {
  const { mob, def, rng } = mk('sheep', { x: 7, z: 7 });
  mob.hurtBy = { x: 7, z: 7 };
  think(mob, def, ctxOf(player(500, 500)), rng, DT);
  assert.equal(mob.state, STATE.FLEE);
  near(len(mob.wish), 1, 1e-9);
  assert.ok(Number.isFinite(mob.wish.x) && Number.isFinite(mob.wish.z));
});

test('fuga: bloqueada por mais de passiveUnstickAfter, desliza (muda o rumo ~90 graus)', () => {
  const { mob, def, rng } = mk('pig', { seed: 2 });
  const ctx = ctxOf(player(500, 500));
  mob.hurtBy = { x: -3, z: 0 };
  think(mob, def, ctx, rng, DT);
  const before = { ...mob.wish };
  mob.blockedT = AI.passiveUnstickAfter + 0.1;
  think(mob, def, ctx, rng, DT);
  const dot = before.x * mob.wish.x + before.z * mob.wish.z;
  assert.ok(Math.abs(dot) < 0.45, `quase perpendicular (dot=${dot})`);
  assert.equal(mob.blockedT, 0);
  assert.equal(mob.state, STATE.FLEE);
});

test('passeio bloqueado: pede pulinho (wantJump) e depois escolhe outro rumo', () => {
  const { mob, def, rng } = mk('pig', { seed: 4 });
  const ctx = ctxOf(player(500, 500));
  // força o passeio
  for (let i = 0; i < 20 / DT && mob.state !== STATE.WANDER; i++) think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.WANDER);
  const h0 = Math.atan2(mob.wish.x, mob.wish.z);
  mob.blockedT = AI.hopAfter + 0.05;
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.wantJump, true);
  assert.equal(Math.atan2(mob.wish.x, mob.wish.z), h0, 'ainda não trocou de rumo');
  mob.blockedT = AI.passiveUnstickAfter + 0.05;
  think(mob, def, ctx, rng, DT);
  assert.notEqual(Math.atan2(mob.wish.x, mob.wish.z), h0, 'trocou de rumo');
  assert.equal(mob.blockedT, 0);
});

// ---------------------------------------------------------------------------
// 4. Zumbi: aggro
// ---------------------------------------------------------------------------

test('zumbi: fora do aggroRange nunca persegue; dentro, persegue em linha reta com chaseSpeed', () => {
  const def = MOB_DEFS.zombie;
  // fora
  {
    const { rows } = trace('zombie', 30, { player: player(def.aggroRange + 1, 0), seed: 2 });
    assert.ok(rows.every((r) => r.state === STATE.IDLE || r.state === STATE.WANDER));
    assert.ok(rows.every((r) => r.speed === 0 || r.speed === def.walkSpeed));
  }
  // dentro (a +X)
  {
    const { mob, def: d, rng } = mk('zombie');
    const ctx = ctxOf(player(def.aggroRange - 1, 0));
    think(mob, d, ctx, rng, DT);
    assert.equal(mob.state, STATE.CHASE);
    assert.equal(mob.speed, d.chaseSpeed);
    near(mob.wish.x, 1, 1e-9);
    near(mob.wish.z, 0, 1e-9);
    assert.deepEqual({ x: mob.face.x, z: mob.face.z }, { x: 1, z: 0 });
  }
  // direção qualquer: wish unitário rumo ao jogador
  for (const [px, pz] of [[-6, 8], [3, -4], [0, 12], [-9, -9]]) {
    const { mob, def: d, rng } = mk('zombie', { x: 1, z: -2 });
    think(mob, d, ctxOf(player(px, pz)), rng, DT);
    assert.equal(mob.state, STATE.CHASE);
    const dx = px - 1;
    const dz = pz + 2;
    const l = Math.hypot(dx, dz);
    near(mob.wish.x, dx / l, 1e-9);
    near(mob.wish.z, dz / l, 1e-9);
  }
});

test('zumbi: histerese — quem persegue só larga além de aggroRange x loseAggroMult', () => {
  const def = MOB_DEFS.zombie;
  const between = (def.aggroRange + def.aggroRange * AI.loseAggroMult) / 2;
  // sem perseguir: entre os dois alcances NÃO começa
  {
    const { mob, def: d, rng } = mk('zombie');
    think(mob, d, ctxOf(player(between, 0)), rng, DT);
    assert.notEqual(mob.state, STATE.CHASE);
  }
  // perseguindo: entre os dois alcances MANTÉM; além do maior, larga
  {
    const { mob, def: d, rng } = mk('zombie');
    const ctx = ctxOf(player(def.aggroRange - 1, 0));
    think(mob, d, ctx, rng, DT);
    assert.equal(mob.state, STATE.CHASE);
    ctx.player = player(between, 0);
    think(mob, d, ctx, rng, DT);
    assert.equal(mob.state, STATE.CHASE);
    ctx.player = player(def.aggroRange * AI.loseAggroMult + 0.5, 0);
    think(mob, d, ctx, rng, DT);
    assert.ok(mob.state === STATE.IDLE || mob.state === STATE.WANDER, `largou (estado ${mob.state})`);
    assert.equal(mob.speed, 0);
  }
});

test('zumbi: Criativo, jogador morto ou sem jogador => nunca persegue nem ataca', () => {
  const def = MOB_DEFS.zombie;
  const closeX = xForEdge(def, 0.3);
  for (const p of [player(closeX, 0, { mode: 'creative' }), player(closeX, 0, { alive: false }), null, {}]) {
    const { mob, def: d, rng } = mk('zombie', { seed: 8 });
    const ctx = ctxOf(p);
    for (let i = 0; i < 20 / DT; i++) {
      think(mob, d, ctx, rng, DT);
      assert.ok(mob.state === STATE.IDLE || mob.state === STATE.WANDER);
      assert.ok(mob.speed === 0 || mob.speed === d.walkSpeed);
    }
    assert.equal(strikes(ctx.events).length, 0);
    assert.equal(mob.attackCd, 0);
  }
});

test('zumbi: ao virar Criativo no meio da perseguição, desiste no quadro seguinte', () => {
  const { mob, def, rng } = mk('zombie');
  const ctx = ctxOf(player(8, 0));
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.CHASE);
  ctx.player = player(8, 0, { mode: 'creative' });
  think(mob, def, ctx, rng, DT);
  assert.ok(mob.state === STATE.IDLE || mob.state === STATE.WANDER);
  assert.equal(mob.speed, 0);
});

test('zumbi: grunhe uma vez ao começar a perseguir e de vez em quando depois', () => {
  const { mob, def, rng } = mk('zombie', { seed: 6 });
  const ctx = ctxOf(player(12, 0));
  think(mob, def, ctx, rng, DT);
  assert.equal(sounds(ctx.events, 'zombie').length, 1, 'ao engajar');
  ctx.events.length = 0;
  for (let i = 0; i < 60 / DT; i++) think(mob, def, ctx, rng, DT);
  const n = sounds(ctx.events, 'zombie').length;
  assert.ok(n >= 60 / AI.chaseVoiceGap[1] - 1 && n <= 60 / AI.chaseVoiceGap[0] + 1, `${n} grunhidos em 60 s`);
});

// ---------------------------------------------------------------------------
// 5. Zumbi: ataque
// ---------------------------------------------------------------------------

test('ataque do zumbi: no alcance e com cooldown zerado emite UM hurt-player com os números do def', () => {
  const { mob, def, rng } = mk('zombie', { x: 3, z: 4 });
  const ctx = ctxOf(player(3 + xForEdge(def, def.attackReach - 0.05), 4));
  think(mob, def, ctx, rng, DT);
  const hits = strikes(ctx.events);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    type: 'hurt-player',
    amount: def.attackDamage,
    source: 'zombie',
    fromX: 3,
    fromZ: 4,
    knock: def.knockback,
    knockUp: def.knockbackUp,
  });
  assert.equal(mob.attackCd, def.attackCooldown);
  assert.equal(mob.attackT, 1);
  assert.equal(mob.state, STATE.ATTACK);
});

test('ataque do zumbi: cooldown correto (um golpe a cada attackCooldown, nem mais nem menos)', () => {
  const { mob, def, rng } = mk('zombie');
  const ctx = ctxOf(player(xForEdge(def, 0.4), 0));
  const frames = [];
  for (let i = 0; i < 10 / DT; i++) {
    const before = ctx.events.length;
    think(mob, def, ctx, rng, DT);
    if (strikes(ctx.events).length > frames.length) frames.push(i);
    assert.ok(ctx.events.length >= before);
  }
  assert.ok(frames.length >= 10 && frames.length <= 11, `${frames.length} golpes em 10 s`);
  assert.equal(frames[0], 0, 'o primeiro golpe é imediato');
  for (let i = 1; i < frames.length; i++) near((frames[i] - frames[i - 1]) * DT, def.attackCooldown, 1.5 * DT, 'intervalo');
});

test('ataque do zumbi: não bate fora do alcance, com cooldown ativo nem com Δy >= altura', () => {
  const { def } = mk('zombie');
  const cases = [
    ['fora do alcance (borda a borda)', player(xForEdge(def, def.attackReach + 0.05), 0), 0],
    ['cooldown ativo', player(xForEdge(def, 0.3), 0), 0.5],
    ['jogador 1 altura acima', player(xForEdge(def, 0.3), 0, { y: 10 + def.height }), 0],
    ['jogador 1 altura abaixo', player(xForEdge(def, 0.3), 0, { y: 10 - def.height }), 0],
  ];
  for (const [label, p, cd] of cases) {
    const { mob, rng } = mk('zombie');
    mob.attackCd = cd;
    const ctx = ctxOf(p);
    think(mob, def, ctx, rng, DT);
    assert.equal(strikes(ctx.events).length, 0, label);
  }
  // logo abaixo da altura: bate
  const { mob, rng } = mk('zombie');
  const ctx = ctxOf(player(xForEdge(def, 0.3), 0, { y: 10 + def.height - 0.05 }));
  think(mob, def, ctx, rng, DT);
  assert.equal(strikes(ctx.events).length, 1, 'Δy logo abaixo da altura');
});

test('ataque do zumbi: anda até attackReach x stopFraction e então para; attackT decai em attackAnim', () => {
  const { def } = mk('zombie');
  // entre o alcance do golpe e o ponto de parada: ainda avança
  {
    const { mob, rng } = mk('zombie');
    think(mob, def, ctxOf(player(xForEdge(def, def.attackReach * AI.stopFraction + 0.1), 0)), rng, DT);
    assert.equal(mob.state, STATE.ATTACK);
    assert.equal(mob.speed, def.chaseSpeed);
  }
  // encostado: para (e continua olhando para o jogador)
  {
    const { mob, rng } = mk('zombie');
    think(mob, def, ctxOf(player(xForEdge(def, def.attackReach * AI.stopFraction - 0.05), 0)), rng, DT);
    assert.equal(mob.speed, 0);
    assert.deepEqual(mob.wish, { x: 0, z: 0 });
    assert.deepEqual({ x: mob.face.x, z: mob.face.z }, { x: 1, z: 0 });
  }
  // animação do golpe
  {
    const { mob, rng } = mk('zombie');
    const ctx = ctxOf(player(xForEdge(def, 0.3), 0));
    think(mob, def, ctx, rng, DT);
    assert.equal(mob.attackT, 1);
    for (let i = 0; i < AI.attackAnim / DT + 2; i++) think(mob, def, ctx, rng, DT);
    assert.equal(mob.attackT, 0);
  }
});

test('zumbi: o ataque não toca no jogador nem no ctx (só empurra em ctx.events)', () => {
  const { mob, def, rng } = mk('zombie');
  const p = player(xForEdge(def, 0.3), 0);
  Object.freeze(p);
  Object.freeze(p.pos);
  const ctx = Object.freeze({ player: p, seconds: 0, events: [] }); // se think escrever aqui, lança (módulos ES são estritos)
  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) think(mob, def, ctx, rng, DT);
  });
  assert.ok(strikes(ctx.events).length >= 3);
});

test('ataque do zumbi: com ctx.los o golpe exige linha de visão (parede => não bate, continua empurrando)', () => {
  const { def } = mk('zombie');
  const px = xForEdge(def, 0.9); // alcance geométrico, mas a parede está no meio
  // sem linha de visão
  {
    const { mob, rng } = mk('zombie', { x: 2, y: 10, z: 3 });
    const calls = [];
    const ctx = ctxOf(player(2 + px, 3, { y: 10 }));
    ctx.los = (...a) => {
      calls.push(a);
      return false;
    };
    think(mob, def, ctx, rng, DT);
    assert.equal(strikes(ctx.events).length, 0);
    assert.equal(mob.attackCd, 0, 'o cooldown não é gasto');
    assert.equal(mob.state, STATE.CHASE, 'não está "em alcance"');
    assert.equal(mob.speed, def.chaseSpeed, 'segue empurrando em direção ao jogador');
    assert.equal(calls.length, 1);
    // do peito de quem bate ao peito do jogador
    const [ax, ay, az, bx, by, bz] = calls[0];
    near(ax, 2, 1e-12);
    near(az, 3, 1e-12);
    near(ay, 10 + def.height * 0.6, 1e-12);
    near(bx, 2 + px, 1e-12);
    near(bz, 3, 1e-12);
    near(by, 10 + PLAYER.height * 0.6, 1e-12);
  }
  // com linha de visão livre
  {
    const { mob, rng } = mk('zombie');
    const ctx = ctxOf(player(px, 0));
    ctx.los = () => true;
    think(mob, def, ctx, rng, DT);
    assert.equal(strikes(ctx.events).length, 1);
    assert.equal(mob.state, STATE.ATTACK);
  }
  // fora do alcance geométrico nem consulta a linha de visão
  {
    const { mob, rng } = mk('zombie');
    let n = 0;
    const ctx = ctxOf(player(xForEdge(def, def.attackReach + 1), 0));
    ctx.los = () => {
      n++;
      return true;
    };
    think(mob, def, ctx, rng, DT);
    assert.equal(n, 0);
  }
});

// ---------------------------------------------------------------------------
// 6. Desencalhar
// ---------------------------------------------------------------------------

test('desencalhar: blockedT > unstickAfter => anda de lado (perpendicular) por lateralTime, sinal sorteado', () => {
  const signs = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const { mob, def, rng } = mk('zombie', { seed });
    const ctx = ctxOf(player(10, 0)); // alvo a +X
    think(mob, def, ctx, rng, DT);
    assert.equal(mob.wish.x, 1);
    mob.blockedT = AI.unstickAfter + 0.05;
    think(mob, def, ctx, rng, DT);
    assert.equal(mob.blockedT, 0, 'consumiu o bloqueio');
    near(len(mob.wish), 1, 1e-9);
    near(mob.wish.x, 0, 1e-9, 'perpendicular ao alvo');
    assert.equal(Math.abs(mob.wish.z), 1);
    assert.equal(mob.speed, def.chaseSpeed);
    signs.add(Math.sign(mob.wish.z));

    // mantém o mesmo lado por ~lateralTime e depois volta a ir reto
    const side = Math.sign(mob.wish.z);
    let t = DT;
    while (Math.abs(mob.wish.x) < 0.5 && t < 3) {
      think(mob, def, ctx, rng, DT);
      if (Math.abs(mob.wish.x) < 0.5) assert.equal(Math.sign(mob.wish.z), side);
      t += DT;
    }
    near(t, AI.lateralTime, 3 * DT, 'duração do desvio');
    assert.equal(mob.wish.x, 1, 'voltou a perseguir em linha reta');
  }
  assert.deepEqual([...signs].sort(), [-1, 1], 'os dois lados acontecem');
});

test('desencalhar: abaixo do limite continua em linha reta; pulinho pedido a partir de hopAfter', () => {
  const { mob, def, rng } = mk('zombie');
  const ctx = ctxOf(player(10, 0));
  mob.blockedT = AI.hopAfter - 0.05;
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.wish.x, 1);
  assert.equal(mob.wantJump, false);
  mob.blockedT = AI.hopAfter + 0.05;
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.wish.x, 1);
  assert.equal(mob.wantJump, true);
});

// ---------------------------------------------------------------------------
// 7. Creeper
// ---------------------------------------------------------------------------

/** Distância centro a centro (a que a IA usa) entre um creeper em (0,10,0) e o jogador em (x,10,0). */
const creeperCenterDist = (px) => Math.sqrt(px * px + (PLAYER.height / 2 - MOB_DEFS.creeper.height / 2) ** 2);
/** x do jogador que dá uma distância centro a centro `d` do creeper em (0,10,0). */
const xForDist = (d) => Math.sqrt(d * d - (PLAYER.height / 2 - MOB_DEFS.creeper.height / 2) ** 2);

test('creeper: persegue até fuseStartDist; só aí o fuse começa (com hiss, uma vez)', () => {
  const def = MOB_DEFS.creeper;
  const { mob, rng } = mk('creeper', { seed: 3 });
  const ctx = ctxOf(player(xForDist(def.fuseStartDist + 0.2), 0));
  for (let i = 0; i < 90; i++) think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.CHASE);
  assert.equal(mob.fuse, 0, 'fora do fuseStartDist não infla');
  assert.equal(mob.speed, def.chaseSpeed);
  assert.equal(sounds(ctx.events, 'hiss').length, 0);

  ctx.player = player(xForDist(def.fuseStartDist - 0.1), 0);
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.FUSE);
  assert.equal(mob.speed, 0, 'para de andar');
  assert.deepEqual(mob.wish, { x: 0, z: 0 });
  assert.deepEqual({ x: mob.face.x, z: mob.face.z }, { x: 1, z: 0 }, 'olha para o jogador');
  near(mob.fuse, DT / def.fuseTime, 1e-12);
  assert.equal(sounds(ctx.events, 'hiss').length, 1);

  for (let i = 0; i < 30; i++) think(mob, def, ctx, rng, DT);
  assert.equal(sounds(ctx.events, 'hiss').length, 1, 'hiss só ao iniciar');
});

test('creeper: fuse sobe 0..1 em fuseTime s e vira "explode" (fuse = 1)', () => {
  const def = MOB_DEFS.creeper;
  const { mob, rng } = mk('creeper');
  const ctx = ctxOf(player(xForDist(def.fuseStartDist - 0.5), 0));
  let t = 0;
  let prev = 0;
  while (mob.state !== STATE.EXPLODE && t < def.fuseTime + 1) {
    think(mob, def, ctx, rng, DT);
    t += DT;
    assert.ok(mob.fuse >= prev && mob.fuse <= 1);
    prev = mob.fuse;
  }
  assert.equal(mob.state, STATE.EXPLODE);
  assert.equal(mob.fuse, 1);
  near(t, def.fuseTime, 2 * DT, 'tempo até explodir');
  // depois de decidir explodir, think não desfaz a decisão (o gerenciador executa)
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.EXPLODE);
});

test('creeper: histerese — infla entre start e abort; além de fuseAbortDist volta a perseguir e o fuse decai', () => {
  const def = MOB_DEFS.creeper;
  const { mob, rng } = mk('creeper', { seed: 9 });
  const ctx = ctxOf(player(xForDist(def.fuseStartDist - 0.3), 0));
  const half = Math.round((def.fuseTime / 2) / DT);
  for (let i = 0; i < half; i++) think(mob, def, ctx, rng, DT);
  near(mob.fuse, 0.5, 2 * DT / def.fuseTime);
  const peak = mob.fuse;

  // zona intermediária (> start, < abort): quem já infla CONTINUA inflando
  ctx.player = player(xForDist((def.fuseStartDist + def.fuseAbortDist) / 2), 0);
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.FUSE);
  assert.ok(mob.fuse > peak);
  const mid = mob.fuse;

  // além do abort: volta a perseguir e o fuse DECAI à mesma taxa
  ctx.player = player(xForDist(def.fuseAbortDist + 0.3), 0);
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.CHASE);
  assert.equal(mob.speed, def.chaseSpeed);
  near(mob.fuse, mid - DT / def.fuseTime, 1e-12);
  for (let i = 0; i < 4 / DT && mob.fuse > 0; i++) think(mob, def, ctx, rng, DT);
  assert.equal(mob.fuse, 0);
  assert.equal(mob.state, STATE.CHASE);

  // voltando para dentro: infla de novo, com novo hiss
  ctx.events.length = 0;
  ctx.player = player(xForDist(def.fuseStartDist - 0.3), 0);
  think(mob, def, ctx, rng, DT);
  assert.equal(mob.state, STATE.FUSE);
  assert.equal(sounds(ctx.events, 'hiss').length, 1);
});

test('creeper: Criativo ou jogador morto => não infla, não persegue; fuse em curso decai', () => {
  const def = MOB_DEFS.creeper;
  for (const p of [player(1, 0, { mode: 'creative' }), player(1, 0, { alive: false })]) {
    const { mob, rng } = mk('creeper', { seed: 4 });
    const ctx = ctxOf(player(1, 0));
    for (let i = 0; i < 40; i++) think(mob, def, ctx, rng, DT);
    assert.equal(mob.state, STATE.FUSE);
    const was = mob.fuse;
    assert.ok(was > 0.3);
    ctx.player = p;
    think(mob, def, ctx, rng, DT);
    assert.notEqual(mob.state, STATE.FUSE);
    assert.ok(mob.fuse < was, 'decaindo');
    for (let i = 0; i < 3 / DT; i++) {
      think(mob, def, ctx, rng, DT);
      assert.ok(mob.state === STATE.IDLE || mob.state === STATE.WANDER);
    }
    assert.equal(mob.fuse, 0);
    assert.equal(mob.attackCd, 0);
  }
});

test('creeper: fora do aggroRange passeia (idle/wander) e nunca infla', () => {
  const def = MOB_DEFS.creeper;
  const { rows, mob } = trace('creeper', 30, { player: player(def.aggroRange + 2, 0) });
  assert.ok(rows.every((r) => r.state === STATE.IDLE || r.state === STATE.WANDER));
  assert.equal(mob.fuse, 0);
});

test('creeper: nunca emite hurt-player (o dano é da explosão, do gerenciador)', () => {
  const def = MOB_DEFS.creeper;
  const { mob, rng } = mk('creeper');
  const ctx = ctxOf(player(0.5, 0));
  for (let i = 0; i < 3 / DT; i++) think(mob, def, ctx, rng, DT);
  assert.equal(strikes(ctx.events).length, 0);
});

// ---------------------------------------------------------------------------
// Invariantes gerais
// ---------------------------------------------------------------------------

test('mob morto: think zera a intenção, consome hurtBy e não emite nada', () => {
  for (const kind of MOB_KINDS) {
    const { mob, def, rng } = mk(kind);
    mob.dead = true;
    mob.hurtBy = { x: 1, z: 1 };
    mob.wish.x = 1;
    mob.speed = 3;
    const ctx = ctxOf(player(def.halfW + PLAYER.halfWidth + 0.3, 0));
    think(mob, def, ctx, rng, DT);
    assert.deepEqual(mob.wish, { x: 0, z: 0 });
    assert.equal(mob.speed, 0);
    assert.equal(mob.hurtBy, null);
    assert.equal(ctx.events.length, 0);
  }
});

test('invariantes: wish unitário ou nulo, speed finita >= 0, fuse em [0,1], estado conhecido (todos os tipos, jogador errante)', () => {
  const known = new Set(Object.values(STATE));
  for (const kind of MOB_KINDS) {
    for (let seed = 1; seed <= 6; seed++) {
      const { mob, def, rng } = mk(kind, { seed });
      const walker = makeRng(seed * 101);
      const ctx = ctxOf(player(6, 0));
      for (let i = 0; i < 40 / DT; i++) {
        if (i % 30 === 0) {
          // jogador pula de lugar (perto, longe, às vezes Criativo ou morto)
          const a = walker.angle();
          const d = walker.range(0.4, 30);
          ctx.player = player(Math.cos(a) * d, Math.sin(a) * d, {
            y: 10 + walker.range(-2, 2),
            mode: walker.chance(0.1) ? 'creative' : 'survival',
            alive: !walker.chance(0.1),
          });
          if (walker.chance(0.15)) mob.blockedT = walker.range(0, 2);
          if (walker.chance(0.05) && !def.hostile) mob.hurtBy = { x: walker.range(-3, 3), z: walker.range(-3, 3) };
        }
        ctx.events.length = 0;
        think(mob, def, ctx, rng, DT);
        const l = len(mob.wish);
        assert.ok(l === 0 || Math.abs(l - 1) < 1e-9, `${kind}: |wish| = ${l}`);
        assert.ok(Number.isFinite(mob.speed) && mob.speed >= 0);
        assert.ok(mob.fuse >= 0 && mob.fuse <= 1);
        assert.ok(known.has(mob.state), mob.state);
        assert.ok(mob.attackCd >= 0 && mob.attackT >= 0 && mob.attackT <= 1);
        assert.equal(typeof mob.wantJump, 'boolean');
        if (l === 0) assert.equal(mob.speed, 0, 'sem direção não há velocidade');
        if (mob.state === STATE.EXPLODE) mob.state = STATE.IDLE; // o gerenciador removeria
      }
    }
  }
});
