// Testes headless da feature 010 (física de entidades): colisão, corpo,
// canStepUp, jogador (regressão contra a integração antiga), queda, knock,
// voo e a API de createControls (com DOM falso).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { World, WORLD_HEIGHT } from '../src/world/world.js';
import { BLOCK } from '../src/blocks.js';
import { makeRng } from '../src/rng.js';
import { MOB_DEFS, MOB_KINDS } from '../src/entities/mobs.js';
import {
  GRAVITY, MAX_STEP, MOVE, KNOCK_TAU, LAND_MIN_DISTANCE,
  collidesBox, createBody, stepBody, canStepUp,
  createPlayerState, stepPlayer, toggleFly, allowFly,
  knockPlayer, teleportPlayer, resetPlayerFall,
} from '../src/entities/physics.js';
import { PLAYER, collidesAABB } from '../src/player/collision.js';
import { createControls } from '../src/player/controls.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const SEED = 1337;

// ---------------------------------------------------------------------------
// Utilitários de mundo
// ---------------------------------------------------------------------------

const S = 10; // altura da superfície do mundo plano (camadas 0..S-1 sólidas)

/** Mundo plano artificial: região [-16,16)² vira pedra até S e ar acima. */
function flatWorld(surface = S) {
  const w = new World(1);
  for (let x = -16; x < 16; x++) {
    for (let z = -16; z < 16; z++) {
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        w.setBlock(x, y, z, y < surface ? BLOCK.STONE : BLOCK.AIR);
      }
    }
  }
  return w;
}

/** Preenche o paralelepípedo [x0..x1]×[y0..y1]×[z0..z1] (inclusive). */
function fill(w, x0, y0, z0, x1, y1, z1, block = BLOCK.STONE) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) w.setBlock(x, y, z, block);
    }
  }
}

const playerBody = (x, feetY, z) =>
  createBody({ x, y: feetY, z, halfW: PLAYER.halfWidth, height: PLAYER.height });

const mobBody = (kind, x, feetY, z) =>
  createBody({ x, y: feetY, z, halfW: MOB_DEFS[kind].halfW, height: MOB_DEFS[kind].height });

const IDLE = { moveX: 0, moveZ: 0, run: false, up: false, down: false, jump: false };

/** Roda `frames` quadros do jogador; devolve todos os resultados de `fall` > 0. */
function runPlayer(world, st, frames, dt, inputFn = () => IDLE, onFrame = null) {
  const falls = [];
  const out = {};
  for (let f = 0; f < frames; f++) {
    stepPlayer(world, st, inputFn(f), dt, out);
    if (out.fall > 0) falls.push(out.fall);
    if (onFrame) onFrame(f, out);
  }
  return falls;
}

// ---------------------------------------------------------------------------
// Colisão
// ---------------------------------------------------------------------------

test('GRAVITY é 28 e MAX_STEP 0.2 (valores da Parte 1)', () => {
  assert.equal(GRAVITY, 28);
  assert.equal(MAX_STEP, 0.2);
  assert.deepEqual(MOVE, { walk: 6, runMult: 1.8, fly: 14, flyVertical: 12, jump: 9 });
});

test('collidesBox: chão, ar livre e cada eixo (X, Y, Z)', () => {
  const w = flatWorld();
  const box = (x, y, z, hw = 0.3, h = 1.8) => collidesBox(w, x, y, z, hw, h);

  assert.equal(box(0.5, S, 0.5), false, 'em pé sobre o chão não colide');
  assert.equal(box(0.5, S + 5, 0.5), false, 'no ar');
  assert.equal(box(0.5, S - 0.01, 0.5), true, 'pés um pouco dentro do chão');
  assert.equal(box(0.5, 3, 0.5), true, 'bem dentro da pedra');

  // eixo X: bloco isolado em (5, S, 0)
  w.setBlock(5, S, 0, BLOCK.STONE);
  assert.equal(box(4.6, S, 0.5), false, 'maxX = 4.9 < 5');
  assert.equal(box(4.71, S, 0.5), true, 'maxX = 5.01 entra no bloco');
  assert.equal(box(5.5, S, 0.5), true, 'dentro');
  assert.equal(box(6.29, S, 0.5), true, 'minX = 5.99 ainda no bloco');
  assert.equal(box(6.4, S, 0.5), false, 'minX = 6.1 passou do bloco');
  assert.equal(box(-5.5, S, 0.5), false, 'outro lado do mundo');

  // eixo Z: bloco isolado em (0, S, 5)
  w.setBlock(0, S, 5, BLOCK.STONE);
  assert.equal(box(0.5, S, 4.6), false);
  assert.equal(box(0.5, S, 4.71), true);
  assert.equal(box(0.5, S, 6.29), true);
  assert.equal(box(0.5, S, 6.4), false);

  // eixo Y: teto isolado em (0, S+2, 0): a cabeça (S+1.8) não toca, pular sim
  w.setBlock(0, S + 2, 0, BLOCK.STONE);
  assert.equal(box(0.5, S, 0.5), false, 'cabeça em S+1.8 < S+2');
  assert.equal(box(0.5, S + 0.3, 0.5), true, 'cabeça em S+2.1 entra no teto');
  assert.equal(box(0.5, S + 2, 0.5), true, 'pés dentro do bloco');
  assert.equal(box(0.5, S + 3, 0.5), false, 'acima do teto');
});

test('collidesBox: a altura do corpo importa (porco cabe, zumbi não)', () => {
  const w = flatWorld();
  w.setBlock(0, S + 1, 0, BLOCK.STONE); // teto a 1 bloco do chão
  const pig = MOB_DEFS.pig;
  const zombie = MOB_DEFS.zombie;
  assert.equal(collidesBox(w, 0.5, S, 0.5, pig.halfW, pig.height), false, 'porco 0.9 cabe');
  assert.equal(collidesBox(w, 0.5, S, 0.5, zombie.halfW, zombie.height), true, 'zumbi 1.8 bate');
});

test('collidesBox: meia-largura importa (corpo largo encosta, fino não)', () => {
  const w = flatWorld();
  w.setBlock(5, S, 0, BLOCK.STONE);
  assert.equal(collidesBox(w, 4.3, S, 0.5, 0.3, 1), false, 'fino: maxX 4.6');
  assert.equal(collidesBox(w, 4.3, S, 0.5, 0.8, 1), true, 'largo: maxX 5.1');
});

// cópia da implementação ANTIGA de collidesAABB (Parte 1), para comparar
function oldCollidesAABB(world, x, y, z) {
  const HALF = 0.3;
  const HEIGHT = 1.8;
  const EYE = 1.62;
  const feet = y - EYE;
  const minX = x - HALF;
  const maxX = x + HALF;
  const minZ = z - HALF;
  const maxZ = z + HALF;
  const minY = feet;
  const maxY = feet + HEIGHT;
  const vx0 = Math.floor(minX);
  const vx1 = Math.floor(maxX);
  const vy0 = Math.floor(minY);
  const vy1 = Math.floor(maxY);
  const vz0 = Math.floor(minZ);
  const vz1 = Math.floor(maxZ);
  for (let vx = vx0; vx <= vx1; vx++) {
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vz = vz0; vz <= vz1; vz++) {
        const b = world.getBlock(vx, vy, vz);
        if (b !== BLOCK.AIR && b !== undefined) return true;
      }
    }
  }
  return false;
}

test('collidesAABB (olho->pés) = implementação antiga em milhares de pontos', () => {
  assert.deepEqual(PLAYER, { halfWidth: 0.3, height: 1.8, eye: 1.62 });
  const world = new World(SEED);
  const rng = makeRng(2026);
  const fracs = [0, 0.2, 0.3, 0.5, 0.7, 0.8, 0.999];
  let hits = 0;
  let misses = 0;
  for (let i = 0; i < 6000; i++) {
    // metade aleatória contínua, metade em frações "de borda" (arestas de bloco)
    const x = i % 2 ? rng.range(-40, 40) : rng.int(80) - 40 + rng.pick(fracs);
    const y = i % 2 ? rng.range(0, 45) : rng.int(45) + rng.pick(fracs) + PLAYER.eye;
    const z = i % 2 ? rng.range(-40, 40) : rng.int(80) - 40 + rng.pick(fracs);
    const novo = collidesAABB(world, x, y, z);
    assert.equal(novo, oldCollidesAABB(world, x, y, z), `ponto ${x},${y},${z}`);
    assert.equal(novo, collidesBox(world, x, y - PLAYER.eye, z, 0.3, 1.8), 'delega a collidesBox');
    if (novo) hits++;
    else misses++;
  }
  assert.ok(hits > 300 && misses > 300, `amostra cobre os dois casos (${hits}/${misses})`);
});

// ---------------------------------------------------------------------------
// Corpo
// ---------------------------------------------------------------------------

test('createBody: pés em pos, velocidade zero, no ar, objetos independentes', () => {
  const a = createBody({ x: 1, y: 2, z: 3, halfW: 0.45, height: 0.9 });
  const b = createBody({ x: 1, y: 2, z: 3, halfW: 0.45, height: 0.9 });
  assert.deepEqual(a, {
    pos: { x: 1, y: 2, z: 3 },
    vel: { x: 0, y: 0, z: 0 },
    halfW: 0.45,
    height: 0.9,
    onGround: false,
  });
  a.pos.x = 99;
  a.vel.y = 5;
  assert.equal(b.pos.x, 1);
  assert.equal(b.vel.y, 0);
});

test('stepBody: cai, pousa uma vez medindo impactVy, assenta sem afundar', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S + 5, 0.5);
  const landings = [];
  let minY = Infinity;
  for (let f = 0; f < 240; f++) {
    const r = stepBody(w, body, DT);
    minY = Math.min(minY, body.pos.y);
    if (r.landed) landings.push({ f, impactVy: r.impactVy });
  }
  const ideal = -Math.sqrt(2 * GRAVITY * 5); // ~ -16.7 b/s
  assert.ok(landings.length >= 1);
  assert.ok(Math.abs(landings[0].impactVy - ideal) < 0.6, `impacto ${landings[0].impactVy} ~ ${ideal}`);
  // depois do primeiro pouso só "tremidas" de impacto minúsculo (folga < MAX_STEP)
  for (const l of landings.slice(1)) {
    assert.ok(l.impactVy > -Math.sqrt(2 * GRAVITY * MAX_STEP) - 1e-6, `tremida ${l.impactVy}`);
  }
  assert.equal(body.onGround, true);
  assert.equal(body.vel.y, 0);
  assert.ok(minY >= S - 1e-9, 'nunca afunda no chão');
  assert.ok(body.pos.y - S < MAX_STEP, 'assenta rente ao chão');
  assert.equal(body.pos.x, 0.5);
  assert.equal(body.pos.z, 0.5);
});

test('stepBody: parado no chão não reporta pouso nem sai do lugar', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S, 0.5);
  stepBody(w, body, DT); // primeiro quadro: nasceu "no ar" e encosta
  const y0 = body.pos.y;
  for (let f = 0; f < 120; f++) {
    const r = stepBody(w, body, DT);
    assert.equal(r.landed, false, `quadro ${f}`);
    assert.equal(r.impactVy, 0);
    assert.equal(r.hitX || r.hitZ, false);
  }
  assert.equal(body.pos.y, y0);
  assert.equal(body.onGround, true);
});

test('stepBody: não atravessa o chão com dt grande e velocidade alta', () => {
  const w = flatWorld();
  for (const dt of [0.1, 0.05, 1 / 60]) {
    const body = playerBody(0.5, S + 30, 0.5);
    body.vel.y = -60;
    for (let f = 0; f < 40; f++) {
      stepBody(w, body, dt);
      assert.ok(body.pos.y >= S - 1e-9, `dt ${dt}: y ${body.pos.y}`);
      assert.equal(collidesBox(w, body.pos.x, body.pos.y, body.pos.z, body.halfW, body.height), false);
    }
    assert.equal(body.onGround, true);
  }
});

test('stepBody: não atravessa parede em nenhum eixo (dt 0.1, 40 b/s) e zera a velocidade', () => {
  const w = flatWorld();
  // paredes de 3 de altura a 5 blocos do centro, em cada direção
  fill(w, 8, S, -3, 8, S + 2, 3); // +x
  fill(w, -8, S, -3, -8, S + 2, 3); // -x
  fill(w, -3, S, 8, 3, S + 2, 8); // +z
  fill(w, -3, S, -8, 3, S + 2, -8); // -z
  const cases = [
    { vx: 40, vz: 0, hit: 'hitX', limit: (b) => b.pos.x + b.halfW < 8 },
    { vx: -40, vz: 0, hit: 'hitX', limit: (b) => b.pos.x - b.halfW > -7 },
    { vx: 0, vz: 40, hit: 'hitZ', limit: (b) => b.pos.z + b.halfW < 8 },
    { vx: 0, vz: -40, hit: 'hitZ', limit: (b) => b.pos.z - b.halfW > -7 },
  ];
  for (const c of cases) {
    const body = playerBody(0.5, S, 0.5);
    let hit = false;
    for (let f = 0; f < 10; f++) {
      body.vel.x = c.vx;
      body.vel.z = c.vz;
      const r = stepBody(w, body, 0.1);
      if (r[c.hit]) {
        hit = true;
        assert.equal(c.hit === 'hitX' ? body.vel.x : body.vel.z, 0, 'zera o eixo que bateu');
      }
      assert.ok(c.limit(body), `${c.hit} ${c.vx},${c.vz}: pos ${body.pos.x},${body.pos.z}`);
      assert.equal(collidesBox(w, body.pos.x, body.pos.y, body.pos.z, body.halfW, body.height), false);
    }
    assert.ok(hit, `${c.hit} ${c.vx},${c.vz} bateu na parede`);
  }
});

test('stepBody: parede fina de 1 bloco não é atravessada nem a 100 b/s', () => {
  const w = flatWorld();
  fill(w, 5, S, -3, 5, S + 2, 3);
  const body = playerBody(0.5, S, 0.5);
  body.vel.x = 100;
  const r = stepBody(w, body, 0.1);
  assert.equal(r.hitX, true);
  assert.ok(body.pos.x + body.halfW < 5);
});

test('stepBody: bate em X e continua deslizando em Z', () => {
  const w = flatWorld();
  fill(w, 6, S, -8, 6, S + 2, 8);
  const body = playerBody(5.0, S, 0.5);
  stepBody(w, body, DT); // assenta
  const z0 = body.pos.z;
  let sawHitX = false;
  for (let f = 0; f < 30; f++) {
    body.vel.x = 4;
    body.vel.z = 3;
    const r = stepBody(w, body, DT);
    if (r.hitX) sawHitX = true;
    assert.equal(r.hitZ, false);
  }
  assert.ok(sawHitX);
  assert.ok(body.pos.x + body.halfW < 6);
  assert.ok(Math.abs(body.pos.z - (z0 + 3 * 30 * DT)) < 1e-9, 'Z andou tudo');
});

test('stepBody: bate a cabeça no teto (hitCeiling) e cai de volta', () => {
  const w = flatWorld();
  w.setBlock(0, S + 2, 0, BLOCK.STONE); // teto a 2 blocos do chão
  const body = playerBody(0.5, S, 0.5);
  stepBody(w, body, DT);
  body.vel.y = MOVE.jump;
  let bumped = false;
  let maxHead = 0;
  for (let f = 0; f < 60; f++) {
    const r = stepBody(w, body, DT);
    if (r.hitCeiling) {
      bumped = true;
      assert.equal(body.vel.y, 0);
      assert.equal(body.onGround, false);
    }
    maxHead = Math.max(maxHead, body.pos.y + body.height);
    assert.equal(collidesBox(w, 0.5, body.pos.y, 0.5, body.halfW, body.height), false);
  }
  assert.ok(bumped);
  assert.ok(maxHead < S + 2, 'cabeça nunca entra no teto');
  assert.equal(body.onGround, true);
});

test('stepBody: vel.y > 0 com onGround esquecido em true (pulo de mob) não deixa o corpo "no chão"', () => {
  const w = flatWorld();
  w.setBlock(0, S + 1, 0, BLOCK.STONE); // teto logo acima da cabeça do porco (S + 0.9)
  const body = mobBody('pig', 0.5, S, 0.5);
  stepBody(w, body, DT);
  assert.equal(body.onGround, true);
  body.vel.y = 10; // o chamador (IA/manager) não limpou onGround
  const r = stepBody(w, body, DT);
  assert.equal(r.hitCeiling, true);
  assert.equal(body.onGround, false, 'subindo não conta como no chão');
  assert.equal(body.vel.y, 0);
});

test('stepBody: gravity:false não puxa; out é reaproveitado; sem opts devolve objeto novo', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S + 5, 0.5);
  const out = { lixo: 1 };
  for (let f = 0; f < 30; f++) {
    const r = stepBody(w, body, DT, { gravity: false, out });
    assert.equal(r, out, 'devolve o mesmo objeto');
  }
  assert.equal(body.pos.y, S + 5);
  assert.equal(body.vel.y, 0);
  assert.deepEqual(
    { hitX: out.hitX, hitZ: out.hitZ, landed: out.landed, impactVy: out.impactVy },
    { hitX: false, hitZ: false, landed: false, impactVy: 0 }
  );
  const a = stepBody(w, body, DT);
  const b = stepBody(w, body, DT);
  assert.notEqual(a, b);
  assert.ok(body.vel.y < 0, 'gravidade padrão ligada');
});

test('stepBody: dt = 0 não move nem quebra', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S + 3, 0.5);
  body.vel.x = 5;
  const r = stepBody(w, body, 0);
  assert.equal(body.pos.x, 0.5);
  assert.equal(body.pos.y, S + 3);
  assert.equal(r.landed, false);
});

test('stepBody: nasce dentro do terreno e é empurrado para cima, sem mexer em X/Z', () => {
  const w = flatWorld();
  const body = playerBody(0.5, 7.3, 0.5); // pés em plena pedra (camadas 0..9)
  body.vel.y = -3;
  const r = stepBody(w, body, DT);
  assert.equal(collidesBox(w, body.pos.x, body.pos.y, body.pos.z, body.halfW, body.height), false);
  assert.equal(body.pos.y, S, 'sobe até o topo do chão');
  assert.equal(body.pos.x, 0.5);
  assert.equal(body.pos.z, 0.5);
  assert.equal(body.onGround, true);
  assert.equal(r.hitX || r.hitZ, false);
});

test('stepBody: bloco colocado em cima do corpo não o prende', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S, 0.5);
  stepBody(w, body, DT);
  w.setBlock(0, S + 1, 0, BLOCK.STONE); // bloco no meio do corpo (camadas S..S+1)
  stepBody(w, body, DT);
  assert.equal(collidesBox(w, body.pos.x, body.pos.y, body.pos.z, body.halfW, body.height), false);
  assert.equal(body.pos.y, S + 2, 'ficou em cima do bloco novo');
  // e depois se move normalmente
  body.vel.x = 3;
  stepBody(w, body, DT);
  assert.ok(body.pos.x > 0.5);
});

test('stepBody: corpo livre nunca é movido pelo desencalhar (trajetória = queda livre)', () => {
  const w = flatWorld();
  const body = playerBody(0.5, S + 10, 0.5);
  let v = 0;
  let y = S + 10;
  for (let f = 0; f < 20; f++) {
    stepBody(w, body, DT);
    v -= GRAVITY * DT;
    y += v * DT;
    assert.ok(Math.abs(body.pos.y - y) < 1e-12);
  }
});

test('desencalhar termina até em mundo todo sólido (rede de segurança)', () => {
  const solido = { getBlock: () => BLOCK.STONE };
  const body = playerBody(0.5, 5, 0.5);
  stepBody(solido, body, DT); // termina (não trava) e a posição segue finita
  assert.ok(Number.isFinite(body.pos.y));
  assert.ok(body.pos.y > 5, 'tentou subir');
});

// ---------------------------------------------------------------------------
// canStepUp
// ---------------------------------------------------------------------------

test('canStepUp: degrau de 1 livre / degrau de 2 / teto baixo / caminho livre', () => {
  const w = flatWorld();
  const z = 0.5;
  const zombie = () => mobBody('zombie', 4.6, S, z);
  w.setBlock(5, S, 0, BLOCK.STONE); // degrau de 1

  assert.equal(canStepUp(w, zombie(), 1, 0), true, 'degrau de 1 com espaço');
  assert.equal(canStepUp(w, zombie(), 5, 0), true, 'direção não unitária');
  assert.equal(canStepUp(w, zombie(), 1, 0.2), true, 'direção levemente torta');
  assert.equal(canStepUp(w, zombie(), -1, 0), false, 'olhando para o lado oposto');
  assert.equal(canStepUp(w, zombie(), 0, 0), false, 'direção nula');
  assert.equal(canStepUp(w, mobBody('zombie', 3.0, S, z), 1, 0), false, 'degrau ainda longe');
  assert.equal(canStepUp(w, mobBody('zombie', 4.6, S, 3.5), 1, 0), false, 'caminho livre (nada a subir)');

  // diagonal: o degrau (5,S,0) entra na caixa deslocada
  assert.equal(canStepUp(w, zombie(), 1, 1), true, 'diagonal');

  // degrau de 2 blocos
  w.setBlock(5, S + 1, 0, BLOCK.STONE);
  assert.equal(canStepUp(w, zombie(), 1, 0), false, 'degrau de 2');
  w.setBlock(5, S + 1, 0, BLOCK.AIR);

  // teto baixo acima do degrau: 1 bloco livre só
  w.setBlock(5, S + 2, 0, BLOCK.STONE);
  assert.equal(canStepUp(w, zombie(), 1, 0), false, 'teto baixo: zumbi não cabe');
  assert.equal(canStepUp(w, mobBody('pig', 4.6, S, z), 1, 0), true, 'porco (0.9) cabe no mesmo vão');
  w.setBlock(5, S + 2, 0, BLOCK.AIR);

  // teto sobre o lugar atual: não dá para subir 1 bloco aqui
  w.setBlock(4, S + 2, 0, BLOCK.STONE);
  assert.equal(canStepUp(w, zombie(), 1, 0), false, 'cabeça bateria ao pular');
  w.setBlock(4, S + 2, 0, BLOCK.AIR);
  assert.equal(canStepUp(w, zombie(), 1, 0), true, 'sem o teto volta a poder');
});

test('canStepUp: alcance configurável (reach)', () => {
  const w = flatWorld();
  w.setBlock(5, S, 0, BLOCK.STONE);
  const b = mobBody('zombie', 4.0, S, 0.5); // maxX = 4.3: ainda 0.7 do degrau
  assert.equal(canStepUp(w, b, 1, 0), false, 'alcance padrão curto');
  assert.equal(canStepUp(w, b, 1, 0, 0.8), true, 'alcance maior enxerga');
});

test('canStepUp: com alcance maior, teto só sobre o lugar atual (coluna de trás) impede o pulo', () => {
  const w = flatWorld();
  w.setBlock(5, S, 0, BLOCK.STONE); // degrau
  const b = mobBody('zombie', 4.0, S, 0.5); // pegada atual cobre x 3.7..4.3 (colunas 3 e 4)
  assert.equal(canStepUp(w, b, 1, 0, 0.8), true);
  w.setBlock(3, S + 2, 0, BLOCK.STONE); // teto só na coluna 3: fora da pegada à frente (4..5)
  assert.equal(canStepUp(w, b, 1, 0, 0.8), false, 'cabeça bateria ao subir 1 bloco aqui');
});

/** Zumbi andando em +X a 3.6 b/s; pula quando canStepUp (como a IA fará). */
function walkZombie(w, frames) {
  const z = MOB_DEFS.zombie;
  const body = mobBody('zombie', 2.0, S, 0.5);
  const out = {};
  let maxY = body.pos.y;
  let jumps = 0;
  for (let f = 0; f < frames; f++) {
    body.vel.x = z.chaseSpeed;
    body.vel.z = 0;
    if (body.onGround && canStepUp(w, body, 1, 0)) {
      body.vel.y = z.jumpSpeed;
      jumps++;
    }
    stepBody(w, body, DT, { out });
    maxY = Math.max(maxY, body.pos.y);
  }
  return { body, maxY, jumps };
}

test('zumbi anda contra degrau de 1 e SOBE usando jumpSpeed de mobs.js', () => {
  const w = flatWorld();
  fill(w, 5, S, -3, 15, S, 3); // degrau de 1 bloco (platô largo)
  const { body, jumps } = walkZombie(w, 150);
  assert.ok(jumps >= 1, 'pulou');
  assert.ok(body.pos.x > 6, `passou do degrau (x=${body.pos.x})`);
  assert.ok(Math.abs(body.pos.y - (S + 1)) < MAX_STEP, `em cima do degrau (y=${body.pos.y})`);
  assert.equal(body.onGround, true);
});

test('zumbi contra parede de 2 blocos NÃO sobe nem pula', () => {
  const w = flatWorld();
  fill(w, 5, S, -3, 15, S + 1, 3); // platô de 2 blocos de altura
  const { body, maxY, jumps } = walkZombie(w, 150);
  assert.equal(jumps, 0);
  assert.ok(maxY < S + 0.5);
  assert.ok(body.pos.x + body.halfW < 5);
});

test('porco (altura 0.9) sobe degrau de 1 mesmo sob teto de 1.5 blocos', () => {
  const w = flatWorld();
  fill(w, 5, S, -3, 15, S, 3); // degrau (platô)
  fill(w, 4, S + 2, -3, 15, S + 2, 3); // teto: cobre o degrau com 1 bloco livre
  const pig = MOB_DEFS.pig;
  const body = mobBody('pig', 2.0, S, 0.5);
  for (let f = 0; f < 150; f++) {
    body.vel.x = pig.fleeSpeed;
    if (body.onGround && canStepUp(w, body, 1, 0)) body.vel.y = pig.jumpSpeed;
    stepBody(w, body, DT);
  }
  assert.ok(body.pos.x > 6, `x=${body.pos.x}`);
  assert.ok(Math.abs(body.pos.y - (S + 1)) < MAX_STEP);
});

// ---------------------------------------------------------------------------
// Invariante com várias entidades no terreno real
// ---------------------------------------------------------------------------

function simulaBando(seed) {
  const world = new World(SEED);
  const rng = makeRng(seed);
  const bodies = [];
  for (let i = 0; i < 18; i++) {
    const kind = MOB_KINDS[i % MOB_KINDS.length];
    const x = rng.range(-30, 30);
    const z = rng.range(-30, 30);
    const y = world.surfaceY(Math.floor(x), Math.floor(z)) + rng.range(0, 5);
    bodies.push({ kind, body: mobBody(kind, x, y, z), wish: { x: 0, z: 0 }, until: 0 });
  }
  const out = {};
  for (let f = 0; f < 600; f++) {
    for (const m of bodies) {
      const def = MOB_DEFS[m.kind];
      if (f >= m.until) {
        const a = rng.angle();
        const moving = rng.chance(0.8);
        m.wish.x = moving ? Math.sin(a) : 0;
        m.wish.z = moving ? Math.cos(a) : 0;
        m.until = f + 20 + rng.int(60);
      }
      const sp = def.chaseSpeed ?? def.fleeSpeed;
      m.body.vel.x = m.wish.x * sp;
      m.body.vel.z = m.wish.z * sp;
      if (m.body.onGround && canStepUp(world, m.body, m.wish.x, m.wish.z)) m.body.vel.y = def.jumpSpeed;
      stepBody(world, m.body, DT, { out });
      const b = m.body;
      assert.equal(collidesBox(world, b.pos.x, b.pos.y, b.pos.z, b.halfW, b.height), false, `quadro ${f}: ${m.kind} preso em bloco`);
    }
  }
  return bodies.map((m) => [m.body.pos.x, m.body.pos.y, m.body.pos.z, m.body.onGround]);
}

test('18 criaturas no terreno real (seed 1337): nunca presas em blocos e determinísticas', () => {
  const a = simulaBando(7);
  const b = simulaBando(7);
  assert.deepEqual(a, b, 'mesma seed => mesma simulação');
  assert.ok(a.filter((p) => p[3]).length >= 14, 'a maioria terminou no chão');
});

// ---------------------------------------------------------------------------
// Jogador: regressão contra a integração ANTIGA (controls.js da Parte 1)
// ---------------------------------------------------------------------------

const OLD = {
  WALK_SPEED: 6, RUN_MULT: 1.8, FLY_SPEED: 14, FLY_VERTICAL: 12,
  GRAVITY: 28, JUMP_SPEED: 9, MAX_STEP: 0.2,
};

/** Cópia fiel da lógica antiga (o vetor `move` entra pronto, sem THREE). */
function createOldPlayer(world, x, y, z) {
  const camera = { position: { x, y, z } };
  let flyMode = false;
  let velY = 0;
  let onGround = false;

  function moveAxis(axis, amount) {
    if (amount === 0) return false;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / OLD.MAX_STEP));
    const step = amount / steps;
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const prev = camera.position[axis];
      camera.position[axis] += step;
      if (oldCollidesAABB(world, camera.position.x, camera.position.y, camera.position.z)) {
        camera.position[axis] = prev;
        blocked = true;
        break;
      }
    }
    return blocked;
  }

  return {
    camera,
    get flyMode() { return flyMode; },
    get velY() { return velY; },
    get onGround() { return onGround; },
    toggleFly() { flyMode = !flyMode; velY = 0; }, // keydown F
    jump() { if (!flyMode && onGround) { velY = OLD.JUMP_SPEED; onGround = false; } }, // keydown Space
    update(dt, k) {
      const move = { x: k.moveX, z: k.moveZ };
      const hSpeed = (flyMode ? OLD.FLY_SPEED : OLD.WALK_SPEED) * (k.run ? OLD.RUN_MULT : 1);
      moveAxis('x', move.x * hSpeed * dt);
      moveAxis('z', move.z * hSpeed * dt);
      if (flyMode) {
        velY = 0;
        onGround = false;
        let dy = 0;
        if (k.up) dy += OLD.FLY_VERTICAL * dt;
        if (k.down) dy -= OLD.FLY_VERTICAL * dt;
        moveAxis('y', dy);
      } else {
        velY -= OLD.GRAVITY * dt;
        const blocked = moveAxis('y', velY * dt);
        if (blocked) {
          if (velY < 0) onGround = true;
          velY = 0;
        } else {
          onGround = false;
        }
      }
    },
  };
}

/**
 * Roda o jogador antigo e o novo com o mesmo roteiro; exige olho idêntico
 * (1e-9) e onGround idêntico a cada quadro. Devolve estatísticas para provar
 * que o cenário exercita o que diz exercitar.
 */
function compareWithOld(world, eye, frames, script) {
  const old = createOldPlayer(world, eye.x, eye.y, eye.z);
  const body = playerBody(eye.x, eye.y - PLAYER.eye, eye.z);
  const st = createPlayerState(body);
  const out = {};
  const stats = { maxRise: 0, wallHits: 0, groundFrames: 0, airFrames: 0, flyFrames: 0, ceilingHits: 0 };
  let minY = Infinity;
  let maxY = -Infinity;
  for (let f = 0; f < frames; f++) {
    const s = script(f);
    if (s.toggleFly) {
      old.toggleFly();
      toggleFly(st);
    }
    if (s.jump) old.jump();
    old.update(s.dt, s);
    stepPlayer(world, st, {
      moveX: s.moveX || 0, moveZ: s.moveZ || 0, run: !!s.run,
      up: !!s.up, down: !!s.down, jump: !!s.jump,
    }, s.dt, out);

    const ey = body.pos.y + PLAYER.eye;
    assert.ok(Math.abs(old.camera.position.x - body.pos.x) < 1e-9, `quadro ${f}: x ${old.camera.position.x} vs ${body.pos.x}`);
    assert.ok(Math.abs(old.camera.position.y - ey) < 1e-9, `quadro ${f}: y ${old.camera.position.y} vs ${ey}`);
    assert.ok(Math.abs(old.camera.position.z - body.pos.z) < 1e-9, `quadro ${f}: z ${old.camera.position.z} vs ${body.pos.z}`);
    assert.equal(body.onGround, old.onGround, `quadro ${f}: onGround`);
    assert.equal(st.flying, old.flyMode, `quadro ${f}: flyMode`);
    if (!old.flyMode) assert.ok(Math.abs(body.vel.y - old.velY) < 1e-9, `quadro ${f}: velY`);

    minY = Math.min(minY, ey);
    maxY = Math.max(maxY, ey);
    if (out.hitX || out.hitZ) stats.wallHits++;
    if (out.hitCeiling) stats.ceilingHits++;
    if (old.flyMode) stats.flyFrames++;
    else if (old.onGround) stats.groundFrames++;
    else stats.airFrames++;
  }
  stats.maxRise = maxY - minY;
  return stats;
}

test('regressão: spawn do main.js (cai 3 blocos) + andar/correr/pular no terreno real', () => {
  const world = new World(SEED);
  const eye = { x: 0.5, y: world.surfaceY(0, 0) + PLAYER.eye + 3, z: 0.5 };
  const stats = compareWithOld(world, eye, 360, (f) => ({
    dt: DT,
    moveX: f < 200 ? 0.6 : -0.6,
    moveZ: f < 200 ? 0.8 : -0.8,
    run: f >= 100 && f < 250,
    jump: f === 90 || f === 130 || f === 170 || f === 260 || f === 300,
  }));
  assert.ok(stats.airFrames > 30 && stats.groundFrames > 100, 'cobre ar e chão');
  assert.ok(stats.wallHits >= 0);
});

test('regressão: parede, deslize e pulos no mundo plano', () => {
  const w = flatWorld();
  fill(w, 4, S, -16, 4, S + 2, 15); // parede longa em x=4
  fill(w, -16, S, 6, 15, S, 6); // degrau de 1 em z=6 (precisa pular)
  const eye = { x: 0.5, y: S + PLAYER.eye + 0.2, z: 0.5 };
  const stats = compareWithOld(w, eye, 300, (f) => {
    if (f < 60) return { dt: DT, moveX: 1, moveZ: 0, run: true }; // de frente na parede
    if (f < 120) return { dt: DT, moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2, run: false }; // desliza em z
    if (f < 180) return { dt: DT, moveX: 0, moveZ: 1, jump: f % 25 === 0 }; // pula no degrau
    return { dt: DT, moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2, run: true, jump: f % 40 === 0 };
  });
  assert.ok(stats.wallHits > 50, `bateu na parede (${stats.wallHits})`);
  assert.ok(stats.maxRise > 1, 'pulou');
});

test('regressão: cabeçada no teto ao pular', () => {
  const w = flatWorld();
  fill(w, -2, S + 2, -2, 6, S + 2, 2); // teto baixo (2 blocos acima do chão)
  const eye = { x: 0.5, y: S + PLAYER.eye + 0.1, z: 0.5 };
  const stats = compareWithOld(w, eye, 200, (f) => ({
    dt: DT, moveX: f > 60 ? 0.5 : 0, moveZ: 0, jump: f % 30 === 0,
  }));
  assert.ok(stats.ceilingHits >= 3, `bateu a cabeça (${stats.ceilingHits})`);
});

test('regressão: voo (subir, correr, descer até bater no chão, desligar e cair)', () => {
  const w = flatWorld();
  fill(w, 10, S, -4, 10, S + 20, 4); // parede alta para o voo colidir
  const eye = { x: 0.5, y: S + PLAYER.eye + 2, z: 0.5 };
  const stats = compareWithOld(w, eye, 420, (f) => {
    if (f === 10) return { dt: DT, toggleFly: true };
    if (f < 70) return { dt: DT, up: true };
    if (f < 160) return { dt: DT, moveX: 1, run: true }; // voa até a parede
    if (f < 175) return { dt: DT, up: true, down: true }; // sobe+desce: parado
    if (f < 260) return { dt: DT, down: true, moveX: -Math.SQRT1_2, moveZ: Math.SQRT1_2 }; // desce até o chão
    if (f === 300) return { dt: DT, toggleFly: true, moveX: 0.3, moveZ: 0.2 };
    return { dt: DT, moveX: 0.3, moveZ: 0.2, jump: f === 380 };
  });
  assert.ok(stats.flyFrames > 250);
  assert.ok(stats.wallHits > 5);
  assert.ok(stats.groundFrames > 50);
});

test('regressão: dt variável (inclusive o clamp 0.1 do main.js) em queda alta', () => {
  const w = flatWorld(8);
  const dts = [1 / 144, 1 / 60, 0.1, 1 / 30, 0.1, 0.016, 0.1];
  const eye = { x: 0.5, y: 8 + PLAYER.eye + 38, z: 0.5 };
  const stats = compareWithOld(w, eye, 280, (f) => ({
    dt: dts[f % dts.length],
    moveX: Math.SQRT1_2,
    moveZ: -Math.SQRT1_2,
    run: f % 50 < 20,
    jump: f % 45 === 0,
  }));
  assert.ok(stats.airFrames > 40);
  assert.ok(stats.groundFrames > 40);
});

// ---------------------------------------------------------------------------
// Queda: distância medida (pico − pouso)
// ---------------------------------------------------------------------------

test('queda: cair de 8 blocos reporta ~8 uma vez e não "treme" depois', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S + 8, 0.5));
  const falls = runPlayer(w, st, 300, DT);
  assert.equal(falls.length, 1, `um pouso só (${falls})`);
  assert.ok(falls[0] <= 8 && falls[0] > 8 - MAX_STEP - 1e-9, `~8 (${falls[0]})`);
});

test('queda: pulo no plano reporta o pico do pulo (~1.45) uma vez', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 30, DT); // assenta
  const falls = runPlayer(w, st, 120, DT, (f) => ({ ...IDLE, jump: f === 0 }));
  const apex = (MOVE.jump * MOVE.jump) / (2 * GRAVITY); // 1.446
  assert.equal(falls.length, 1);
  // Euler semi-implícito a 60 FPS e o assento rente ao chão tiram ~0.1 do ideal
  assert.ok(Math.abs(falls[0] - apex) < 0.2, `pulo ${falls[0]} ~ ${apex}`);
});

test('queda: andar/correr no plano e parado nunca dispara pouso', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  const falls = runPlayer(w, st, 400, DT, (f) => ({
    ...IDLE, moveX: Math.SQRT1_2, moveZ: Math.SQRT1_2 * (f < 200 ? 1 : -1), run: f % 100 < 50,
  }));
  assert.deepEqual(falls, []);
});

test('queda: sair de uma borda de 4 blocos reporta ~4', () => {
  const w = flatWorld(S + 4);
  fill(w, 5, S, -8, 15, S + 3, 8, BLOCK.AIR); // fosso: a plataforma termina em x=5
  const st = createPlayerState(playerBody(2, S + 4, 0.5));
  runPlayer(w, st, 20, DT); // assenta na plataforma alta
  const falls = runPlayer(w, st, 200, DT, () => ({ ...IDLE, moveX: 1 }));
  assert.equal(falls.length, 1);
  assert.ok(falls[0] <= 4 && falls[0] > 4 - MAX_STEP - 1e-9, `~4 (${falls[0]})`);
});

test('queda: nunca em voo; ao desligar o voo mede a partir de onde estava', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 10, DT);
  toggleFly(st);
  assert.equal(st.flying, true);
  // sobe 20 blocos voando e depois desce até encostar no chão, tudo em voo
  let landedInFlight = false;
  const falls = runPlayer(w, st, 400, DT, (f) => ({ ...IDLE, up: f < 100, down: f >= 160 }), (f, out) => {
    if (out.landed) landedInFlight = true;
    assert.equal(st.body.onGround, false, `quadro ${f}: onGround em voo`);
  });
  assert.deepEqual(falls, []);
  assert.equal(landedInFlight, false);

  // sobe de novo, desliga o voo no alto e cai
  runPlayer(w, st, 100, DT, () => ({ ...IDLE, up: true }));
  const top = st.body.pos.y;
  assert.ok(top > S + 15);
  toggleFly(st);
  const falls2 = runPlayer(w, st, 300, DT);
  assert.equal(falls2.length, 1);
  assert.ok(Math.abs(falls2[0] - (top - S)) < MAX_STEP + 1e-9, `${falls2[0]} ~ ${top - S}`);
});

test('queda: teleport no meio da queda zera a referência', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S + 40, 0.5));
  runPlayer(w, st, 40, DT); // já caiu uns 6 blocos
  assert.ok(st.body.pos.y < S + 36);
  teleportPlayer(st, 3.5, S + 5, 3.5);
  assert.equal(st.body.vel.y, 0);
  assert.equal(st.body.onGround, false);
  const falls = runPlayer(w, st, 200, DT);
  assert.equal(falls.length, 1);
  assert.ok(falls[0] <= 5 && falls[0] > 5 - MAX_STEP - 1e-9, `~5, não ~40 (${falls[0]})`);
});

test('queda: resetPlayerFall no meio da queda mede dali', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S + 30, 0.5));
  runPlayer(w, st, 40, DT);
  const yReset = st.body.pos.y;
  assert.ok(yReset < S + 30 - 5 && yReset > S + 3, `reset em ${yReset}`);
  resetPlayerFall(st);
  const falls = runPlayer(w, st, 300, DT);
  assert.equal(falls.length, 1);
  assert.ok(Math.abs(falls[0] - (yReset - S)) < MAX_STEP + 1e-9, `${falls[0]} ~ ${yReset - S}`);
});

test('queda: knock vertical para cima zera a referência (não conta a queda anterior)', () => {
  const w = flatWorld();
  // cai de 30 e, a ~3 blocos do chão, leva um knock para cima
  const st2 = createPlayerState(playerBody(0.5, S + 30, 0.5));
  const falls = [];
  const out = {};
  let knocked = false;
  for (let f = 0; f < 400; f++) {
    if (!knocked && st2.body.pos.y < S + 3 && st2.body.vel.y < 0) {
      knockPlayer(st2, 1, 0, 0, 6);
      knocked = true;
    }
    stepPlayer(w, st2, IDLE, DT, out);
    if (out.fall > 0) falls.push(out.fall);
  }
  assert.ok(knocked);
  assert.equal(falls.length, 1);
  assert.ok(falls[0] < 4.5, `mede do ponto do knock (${falls[0]}), não ~30`);
});

// ---------------------------------------------------------------------------
// Knock
// ---------------------------------------------------------------------------

test('knock: direção normalizada, decai ~e^(-t/0.25) e o deslocamento total é força × tau', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 20, DT); // assenta
  const x0 = st.body.pos.x;
  const z0 = st.body.pos.z;
  knockPlayer(st, 3, 4, 10, 0); // direção (0.6, 0.8)
  assert.ok(Math.abs(st.kx - 6) < 1e-12 && Math.abs(st.kz - 8) < 1e-12);

  const speeds = [];
  runPlayer(w, st, 15, DT, () => IDLE, () => speeds.push(Math.hypot(st.kx, st.kz)));
  // 15 quadros = 0.25 s = 1 tau => 10/e
  assert.ok(Math.abs(speeds[14] - 10 / Math.E) < 0.05, `após 0.25 s: ${speeds[14]}`);
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] < speeds[i - 1], 'monotônico');

  runPlayer(w, st, 240, DT);
  assert.equal(st.kx, 0);
  assert.equal(st.kz, 0, 'zerou depois de alguns segundos');
  const dx = st.body.pos.x - x0;
  const dz = st.body.pos.z - z0;
  assert.ok(Math.abs(dx - 6 * KNOCK_TAU) < 0.02, `dx ${dx} ~ ${6 * KNOCK_TAU}`);
  assert.ok(Math.abs(dz - 8 * KNOCK_TAU) < 0.02, `dz ${dz} ~ ${8 * KNOCK_TAU}`);
  assert.equal(st.body.onGround, true);
});

test('knock: deslocamento independe do FPS', () => {
  const w = flatWorld();
  const result = [];
  for (const dt of [1 / 20, 1 / 60, 1 / 144, 0.1]) {
    const st = createPlayerState(playerBody(0.5, S, 0.5));
    runPlayer(w, st, 10, 1 / 60);
    const x0 = st.body.pos.x;
    knockPlayer(st, 1, 0, 9, 0);
    runPlayer(w, st, Math.round(2 / dt), dt);
    result.push(st.body.pos.x - x0);
  }
  for (const r of result) assert.ok(Math.abs(r - 9 * KNOCK_TAU) < 0.02, `${r}`);
});

test('knock: direção nula não gera NaN; up lança para cima; só vertical funciona', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 20, DT);
  knockPlayer(st, 0, 0, 9, 0);
  assert.equal(st.kx, 0);
  assert.equal(st.kz, 0);
  const x0 = st.body.pos.x;
  runPlayer(w, st, 10, DT);
  assert.equal(st.body.pos.x, x0);

  knockPlayer(st, 0, 0, 9, 5); // só vertical
  assert.equal(st.body.vel.y, 5);
  assert.equal(st.body.onGround, false);
  let maxY = st.body.pos.y;
  runPlayer(w, st, 60, DT, () => IDLE, () => { maxY = Math.max(maxY, st.body.pos.y); });
  assert.ok(Number.isFinite(maxY) && Math.abs(maxY - (S + 25 / (2 * GRAVITY))) < 0.1, `apex ${maxY}`);
  assert.equal(st.body.pos.x, x0);
  assert.ok(Number.isFinite(st.body.pos.z));
});

test('knock: parede corta o impulso naquele eixo', () => {
  const w = flatWorld();
  fill(w, 3, S, -4, 3, S + 2, 4);
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 20, DT);
  knockPlayer(st, 1, 0, 20, 0);
  runPlayer(w, st, 60, DT);
  assert.equal(st.kx, 0, 'impulso zerado ao bater');
  assert.ok(st.body.pos.x + PLAYER.halfWidth < 3);
  // andar de volta funciona normalmente
  runPlayer(w, st, 30, DT, () => ({ ...IDLE, moveX: -1 }));
  assert.ok(st.body.pos.x < 0.3);
});

test('knock: soma-se ao andar (empurra e o jogador continua controlando)', () => {
  const w = flatWorld();
  const a = createPlayerState(playerBody(0.5, S, 0.5));
  const b = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, a, 20, DT);
  runPlayer(w, b, 20, DT);
  knockPlayer(b, 1, 0, 9, 0);
  runPlayer(w, a, 30, DT, () => ({ ...IDLE, moveZ: 1 }));
  runPlayer(w, b, 30, DT, () => ({ ...IDLE, moveZ: 1 }));
  assert.ok(Math.abs(a.body.pos.z - b.body.pos.z) < 1e-9, 'andar em Z não muda');
  assert.ok(b.body.pos.x - a.body.pos.x > 1, 'knock deslocou em X');
});

// ---------------------------------------------------------------------------
// Voo e permissão de voo
// ---------------------------------------------------------------------------

test('voo: F alterna; allowFly(false) desliga e bloqueia; allowFly(true) libera', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S, 0.5));
  runPlayer(w, st, 20, DT);
  assert.equal(st.flying, false);
  assert.equal(toggleFly(st), true);
  runPlayer(w, st, 10, DT, () => ({ ...IDLE, up: true }));
  assert.ok(st.body.pos.y > S + 1, 'sobe em voo');
  assert.equal(st.body.onGround, false);

  allowFly(st, false);
  assert.equal(st.flying, false, 'desligou o voo ligado');
  assert.equal(toggleFly(st), false, 'F não tem efeito');
  assert.equal(st.flying, false);
  const y = st.body.pos.y;
  runPlayer(w, st, 10, DT, () => ({ ...IDLE, up: true }));
  assert.ok(st.body.pos.y < y, 'sem voo, up não sobe: cai');

  allowFly(st, true);
  assert.equal(toggleFly(st), true);
  assert.equal(st.flying, true);
});

test('voo: Espaço sobe, Shift desce a 12 b/s e anda a 14 (correr x1.8); colide com o chão', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(-14.5, S + 5, 0.5)); // mundo plano vai até x = 16
  toggleFly(st);
  runPlayer(w, st, 60, DT, () => ({ ...IDLE, up: true }));
  assert.ok(Math.abs(st.body.pos.y - (S + 5 + MOVE.flyVertical)) < 1e-9, 'subiu 12 em 1 s');
  runPlayer(w, st, 30, DT, () => ({ ...IDLE, moveX: 1 }));
  assert.ok(Math.abs(st.body.pos.x - (-14.5 + MOVE.fly / 2)) < 1e-9, 'voa a 14 b/s');
  const x1 = st.body.pos.x;
  runPlayer(w, st, 30, DT, () => ({ ...IDLE, moveX: 1, run: true }));
  assert.ok(Math.abs(st.body.pos.x - x1 - (MOVE.fly * MOVE.runMult) / 2) < 1e-9, 'correndo x1.8');
  runPlayer(w, st, 300, DT, () => ({ ...IDLE, down: true }));
  assert.ok(st.body.pos.y >= S - 1e-9 && st.body.pos.y < S + 0.25, 'parou no chão');
  assert.equal(st.body.onGround, false, 'voo nunca marca chão');
});

test('jogador em terra: andar 6, correr x1.8, pulo 9 (limites do Parte 1)', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(-12.5, S, 0.5));
  runPlayer(w, st, 20, DT);
  const x0 = st.body.pos.x;
  runPlayer(w, st, 60, DT, () => ({ ...IDLE, moveX: 1 }));
  assert.ok(Math.abs(st.body.pos.x - x0 - 6) < 1e-9, 'andar 6 b/s');
  const x1 = st.body.pos.x;
  runPlayer(w, st, 60, DT, () => ({ ...IDLE, moveX: 1, run: true }));
  assert.ok(Math.abs(st.body.pos.x - x1 - 6 * 1.8) < 1e-9, 'correr 10.8 b/s');
  // pulo: só no chão, sem pulo duplo
  let jumps = 0;
  const before = st.body.vel.y;
  assert.equal(before, 0);
  stepPlayer(w, st, { ...IDLE, jump: true }, DT, {});
  assert.ok(st.body.vel.y > 8, 'pulou');
  jumps++;
  const vy = st.body.vel.y;
  stepPlayer(w, st, { ...IDLE, jump: true }, DT, {});
  assert.ok(st.body.vel.y < vy, 'no ar, Espaço não pula de novo');
  assert.equal(jumps, 1);
});

test('stepPlayer: sem "out" devolve um objeto completo; com "out" reaproveita-o', () => {
  const w = flatWorld();
  const st = createPlayerState(playerBody(0.5, S + 3, 0.5));
  const r = stepPlayer(w, st, IDLE, DT);
  for (const k of ['hitX', 'hitZ', 'hitCeiling', 'landed', 'impactVy', 'fall']) assert.ok(k in r, k);
  const mine = {};
  assert.equal(stepPlayer(w, st, IDLE, DT, mine), mine);
  assert.notEqual(r, mine);
});

test('teleportPlayer: pés, zera velocidades/knock; determinismo do jogador', () => {
  const w = flatWorld();
  const mk = () => {
    const st = createPlayerState(playerBody(0.5, S + 3, 0.5));
    knockPlayer(st, 1, 1, 9, 4);
    runPlayer(w, st, 10, DT);
    teleportPlayer(st, 2.5, S + 6, -3.5);
    return st;
  };
  const st = mk();
  assert.deepEqual(st.body.pos, { x: 2.5, y: S + 6, z: -3.5 });
  assert.deepEqual(st.body.vel, { x: 0, y: 0, z: 0 });
  assert.equal(st.kx, 0);
  assert.equal(st.kz, 0);
  assert.equal(st.body.onGround, false);
  runPlayer(w, st, 100, DT, (f) => ({ ...IDLE, moveX: Math.sin(f / 7), moveZ: Math.cos(f / 5), jump: f % 33 === 0 }));
  const again = mk();
  runPlayer(w, again, 100, DT, (f) => ({ ...IDLE, moveX: Math.sin(f / 7), moveZ: Math.cos(f / 5), jump: f % 33 === 0 }));
  assert.deepEqual(st.body, again.body);
});

// ---------------------------------------------------------------------------
// createControls (com DOM falso)
// ---------------------------------------------------------------------------

function fakeDom() {
  const handlers = {};
  const doc = {
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    removeEventListener(type, fn) {
      const a = handlers[type];
      if (a && a.includes(fn)) a.splice(a.indexOf(fn), 1);
    },
  };
  globalThis.document = doc;
  const fire = (type, code) => (handlers[type] || []).forEach((fn) => fn({ code, preventDefault() {} }));
  return {
    el: { ownerDocument: doc },
    press: (code) => fire('keydown', code),
    release: (code) => fire('keyup', code),
    cleanup: () => { delete globalThis.document; },
  };
}

/** Câmera olhando para +X (horizontal), como no jogo: PointerLockControls só gira. */
function makeCamera(x, y, z) {
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 200);
  camera.position.set(x, y, z);
  camera.rotation.set(0, -Math.PI / 2, 0, 'YXZ');
  return camera;
}

function withControls(world, eye, fn, opts) {
  const dom = fakeDom();
  try {
    const camera = makeCamera(eye.x, eye.y, eye.z);
    const calls = [];
    const api = createControls(camera, dom.el, world, { onLand: (d) => calls.push(d), ...opts });
    api.controls.isLocked = true;
    return fn({ api, camera, dom, calls, frames: (n, dt = DT) => { for (let i = 0; i < n; i++) api.update(dt); } });
  } finally {
    dom.cleanup();
  }
}

test('createControls: compatível com o main.js atual (camera, el, world) -> { controls, update }', () => {
  const w = flatWorld();
  const dom = fakeDom();
  try {
    const camera = makeCamera(0.5, S + PLAYER.eye + 3, 0.5);
    const api = createControls(camera, dom.el, w);
    assert.ok(api.controls && typeof api.update === 'function');
    for (const m of ['knock', 'setFlyAllowed', 'isFlying', 'isOnGround', 'teleport', 'resetFall']) {
      assert.equal(typeof api[m], 'function', m);
    }
    api.controls.isLocked = true;
    for (let i = 0; i < 200; i++) api.update(DT); // sem onLand: não quebra
    assert.equal(api.isOnGround(), true);
    assert.ok(camera.position.y - PLAYER.eye >= S - 1e-9);
    assert.ok(camera.position.y - PLAYER.eye < S + MAX_STEP);
  } finally {
    dom.cleanup();
  }
});

test('createControls: spawn do main.js (3 blocos acima do chão, seed 1337) não passa do limite sem dano', () => {
  const world = new World(SEED);
  const eye = { x: 0.5, y: world.surfaceY(0, 0) + PLAYER.eye + 3, z: 0.5 };
  withControls(world, eye, ({ api, calls, frames }) => {
    frames(300);
    assert.equal(api.isOnGround(), true);
    assert.ok(calls.length <= 1, `no máximo um pouso (${calls})`);
    for (const d of calls) assert.ok(d <= 3, `queda do spawn ${d} <= 3 (limite sem dano)`);
  });
});

test('createControls: sem pointer lock não simula (igual à Parte 1)', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye + 5, z: 0.5 }, ({ api, camera, frames }) => {
    api.controls.isLocked = false;
    const y = camera.position.y;
    frames(30);
    assert.equal(camera.position.y, y);
    api.controls.isLocked = true;
    frames(5);
    assert.ok(camera.position.y < y);
  });
});

test('createControls: onLand dispara UMA vez ao pousar, com a distância caída', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye + 6, z: 0.5 }, ({ api, calls, frames }) => {
    frames(300);
    assert.equal(calls.length, 1, `chamadas ${calls}`);
    assert.ok(calls[0] <= 6 && calls[0] > 6 - MAX_STEP - 1e-9, `distância ${calls[0]}`);
    assert.equal(api.isOnGround(), true);
  });
});

test('createControls: andar no plano não dispara onLand; Espaço pula e pousa uma vez', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, dom, calls, frames }) => {
    frames(30);
    calls.length = 0;
    dom.press('KeyW');
    frames(120);
    assert.ok(camera.position.x > 8, `andou +x (${camera.position.x})`);
    assert.deepEqual(calls, []);
    dom.release('KeyW');
    frames(20);
    const y0 = camera.position.y;
    dom.press('Space');
    dom.release('Space');
    frames(3);
    assert.ok(camera.position.y > y0 + 0.3, 'pulou');
    assert.equal(api.isOnGround(), false);
    frames(80);
    assert.equal(calls.length, 1);
    assert.ok(Math.abs(calls[0] - 1.446) < 0.2, `pulo ${calls[0]}`);
    assert.equal(api.isOnGround(), true);
  });
});

test('createControls: F voa, setFlyAllowed(false) desliga e bloqueia F; true libera', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye + 1, z: 0.5 }, ({ api, camera, dom, calls, frames }) => {
    frames(60);
    calls.length = 0; // descarta o pouso do spawn (1 bloco acima do chão)
    assert.equal(api.isFlying(), false);
    dom.press('KeyF');
    assert.equal(api.isFlying(), true);
    dom.press('Space'); // em voo, Espaço sobe (não pula)
    frames(30);
    assert.ok(camera.position.y > S + PLAYER.eye + 5, 'subiu voando');
    assert.equal(api.isOnGround(), false);
    dom.release('Space');

    api.setFlyAllowed(false);
    assert.equal(api.isFlying(), false, 'desligou o voo');
    dom.press('KeyF');
    assert.equal(api.isFlying(), false, 'F sem efeito');
    frames(5);
    assert.equal(api.isFlying(), false);

    frames(200); // caiu dali
    assert.equal(calls.length, 1);
    assert.ok(calls[0] > 5, `caiu de ~${calls[0]}`);

    api.setFlyAllowed(true);
    dom.press('KeyF');
    assert.equal(api.isFlying(), true);
    dom.press('KeyF');
    assert.equal(api.isFlying(), false);
  });
});

test('createControls: knock empurra na direção dada, com impulso vertical opcional', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, calls, frames }) => {
    frames(30);
    calls.length = 0;
    const x0 = camera.position.x;
    const z0 = camera.position.z;
    api.knock(0, -1, 9, 5); // -z
    frames(1);
    assert.equal(api.isOnGround(), false, 'saiu do chão');
    frames(120);
    assert.ok(Math.abs(camera.position.x - x0) < 1e-9, 'x intacto');
    assert.ok(Math.abs(z0 - camera.position.z - 9 * KNOCK_TAU) < 0.05, `z recuou ${z0 - camera.position.z}`);
    assert.equal(api.isOnGround(), true);
    assert.ok(calls.length <= 1 && (calls[0] === undefined || calls[0] < 1), 'um arco curto, sem dano');
  });
});

test('createControls: teleport recebe o OLHO, atualiza a câmera e zera a queda', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye + 30, z: 0.5 }, ({ api, camera, calls, frames }) => {
    frames(20);
    api.teleport(3.5, S + PLAYER.eye + 4, -2.5);
    assert.equal(camera.position.x, 3.5);
    assert.ok(Math.abs(camera.position.y - (S + PLAYER.eye + 4)) < 1e-12);
    assert.equal(camera.position.z, -2.5);
    assert.equal(api.isOnGround(), false);
    assert.ok(Math.abs(api.body.pos.y - (S + 4)) < 1e-12, 'pés = olho - eye');
    frames(200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0] <= 4 && calls[0] > 4 - MAX_STEP - 1e-9, `~4 (${calls[0]})`);
  });
});

test('createControls: resetFall zera a referência; câmera movida por fora é adotada', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye + 30, z: 0.5 }, ({ api, camera, calls, frames }) => {
    frames(30);
    const yReset = api.body.pos.y;
    api.resetFall();
    frames(300);
    assert.equal(calls.length, 1);
    assert.ok(Math.abs(calls[0] - (yReset - S)) < MAX_STEP + 1e-9);

    // alguém (ex.: o spawn do main.js) move a câmera por fora
    calls.length = 0;
    camera.position.set(-4.5, S + PLAYER.eye + 7, 4.5);
    frames(1);
    assert.ok(Math.abs(camera.position.x + 4.5) < 1e-12, 'adotou a posição nova');
    frames(300);
    assert.equal(calls.length, 1);
    assert.ok(calls[0] <= 7 && calls[0] > 7 - MAX_STEP - 1e-9, `~7 (${calls[0]})`);
  });
});

test('createControls: pedido de pulo feito em pausa não vale depois', () => {
  const w = flatWorld();
  withControls(w, { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, dom, frames }) => {
    frames(30);
    api.controls.isLocked = false;
    dom.press('Space');
    frames(2); // update em pausa descarta o pedido
    api.controls.isLocked = true;
    const y0 = camera.position.y;
    frames(10);
    assert.ok(Math.abs(camera.position.y - y0) < 0.02, 'não pulou sozinho');
  });
});

// ---------------------------------------------------------------------------
// Uma verdade por fato (varredura dos fontes)
// ---------------------------------------------------------------------------

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('fontes: GRAVITY só em physics.js; controls/collision sem física própria nem Math.random', () => {
  const src = path.join(ROOT, 'src');
  const donos = listJs(src).filter((f) => /\b(?:const|let|var)\s+GRAVITY\s*=/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(donos.map((f) => path.relative(src, f).replaceAll('\\', '/')), ['entities/physics.js']);

  const controls = fs.readFileSync(path.join(src, 'player', 'controls.js'), 'utf8');
  assert.match(controls, /from '\.\.\/entities\/physics\.js'/);
  assert.doesNotMatch(controls, /moveAxis|MAX_STEP|collidesAABB|GRAVITY/);

  const collision = fs.readFileSync(path.join(src, 'player', 'collision.js'), 'utf8');
  assert.match(collision, /collidesBox/);
  assert.doesNotMatch(collision, /Math\.floor/, 'colisão só em collidesBox');

  for (const f of ['entities/physics.js', 'player/controls.js', 'player/collision.js']) {
    const txt = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(txt, /Math\.random/, f);
    assert.doesNotMatch(txt, /console\./, f);
  }

  const physics = fs.readFileSync(path.join(src, 'entities', 'physics.js'), 'utf8');
  assert.doesNotMatch(physics, /from 'three|document|window/, 'physics.js é puro (sem Three/DOM)');
  assert.ok(LAND_MIN_DISTANCE > MAX_STEP, 'o filtro de pouso cobre a tremida do revert');
});

// --- Revisão da Parte 2: teclado só com mouse capturado, soltar teclas, Shift corre ---

test('createControls: teclas pressionadas SEM pointer lock são ignoradas (F não voa, W não anda)', () => {
  withControls(flatWorld(), { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, dom, frames }) => {
    api.controls.isLocked = false; // no menu / pausa
    dom.press('KeyF');
    dom.press('KeyW');
    api.controls.isLocked = true; // volta ao jogo
    frames(30);
    assert.equal(api.isFlying(), false, 'F no menu não liga o voo');
    assert.ok(Math.abs(camera.position.x - 0.5) < 1e-6, 'W no menu não anda: x=' + camera.position.x);
  });
});

test('createControls: pausar (unlock) solta as teclas — o jogador não sai andando sozinho', () => {
  withControls(flatWorld(), { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, dom, frames }) => {
    dom.press('KeyW');
    frames(30);
    const moved = camera.position.x - 0.5;
    assert.ok(moved > 1, 'andou segurando W: ' + moved);
    api.controls.dispatchEvent({ type: 'unlock' });
    frames(5); // ainda travado no teste: se a tecla estivesse presa, continuaria andando
    const x0 = camera.position.x;
    frames(30);
    assert.ok(Math.abs(camera.position.x - x0) < 1e-6, 'parou depois do unlock');
  });
});

test('createControls: Shift corre no chão (alternativa ao Ctrl, que com W fecha a aba); no voo Shift só desce', () => {
  const dist = (keys, fly) => withControls(flatWorld(), { x: 0.5, y: S + PLAYER.eye, z: 0.5 }, ({ api, camera, dom, frames }) => {
    if (fly) {
      dom.press('KeyF');
      assert.equal(api.isFlying(), true);
    }
    for (const k of keys) dom.press(k);
    frames(60); // 1 s
    return camera.position.x - 0.5;
  });
  const walk = dist(['KeyW'], false);
  const ctrl = dist(['KeyW', 'ControlLeft'], false);
  const shift = dist(['KeyW', 'ShiftLeft'], false);
  assert.ok(ctrl / walk > 1.6 && ctrl / walk < 2, 'Ctrl corre ~1.8x: ' + ctrl / walk);
  assert.ok(Math.abs(shift - ctrl) < 0.05, 'Shift corre como Ctrl: ' + shift + ' vs ' + ctrl);
  const flyPlain = dist(['KeyW'], true);
  const flyShift = dist(['KeyW', 'ShiftLeft'], true);
  assert.ok(Math.abs(flyShift - flyPlain) < 0.05, 'no voo Shift não acelera: ' + flyShift + ' vs ' + flyPlain);
});
