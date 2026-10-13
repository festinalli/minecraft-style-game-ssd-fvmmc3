// IA das criaturas (feature 013): máquina de estados por `def.behavior`.
// PURO — sem Three.js, sem mundo, sem `Math.random`. `think` só DECIDE: escreve
// a intenção no próprio mob (`wish`, `speed`, `wantJump`, `state`, `face` e os
// temporizadores da IA) e, no máximo, empurra eventos em `ctx.events`. Quem
// move o corpo, aplica a física e o dano é o gerenciador (`manager.js`).
//
// Convenções: Y para cima; `mob.body.pos` e `ctx.player.pos` = centro dos PÉS;
// tempo em segundos; orientação `yaw = atan2(dirX, dirZ)` (frente do modelo = +Z),
// portanto uma direção (x, z) vem de `x = sin(yaw)`, `z = cos(yaw)`.
//
// Aleatoriedade só pelo `rng` injetado (src/rng.js): mesma seed + mesma
// sequência de `ctx` ⇒ mesmas decisões. Balanceamento (velocidades, alcances,
// tempos de combate) vem de `MOB_DEFS` — aqui só moram constantes de FEITIO.

import { BEHAVIOR } from './mobs.js';
import { PLAYER } from '../player/collision.js';

/** Constantes de feitio da IA (não são balanceamento de combate: esse é de `mobs.js`). */
export const AI = {
  loseAggroMult: 1.3, // histerese: quem já persegue só desiste além de aggroRange × isto
  stopFraction: 0.5, // o zumbi para quando a distância borda a borda ≤ attackReach × isto
  unstickAfter: 1.0, // s empurrando sem sair do lugar antes de lateralizar (hostis em perseguição)
  lateralTime: 0.8, // s andando de lado ao desencalhar
  passiveUnstickAfter: 0.6, // s bloqueado antes de passeio/fuga escolherem outro rumo
  hopAfter: 0.35, // s bloqueado antes de pedir um pulinho (`wantJump`)
  attackAnim: 0.4, // s de animação do golpe (`attackT` vai de 1 a 0)
  voiceGap: [6, 16], // s entre grunhidos de quem passeia (porco/ovelha)
  chaseVoiceGap: [4, 9], // s entre grunhidos do zumbi perseguindo
  fleeJitter: 0.35, // rad de desvio aleatório no rumo de fuga
};

/** Voz de cada tipo (nomes de `audio.js`); o creeper não tem voz de passeio. */
export const VOICE = { pig: 'pig', sheep: 'sheep', zombie: 'zombie' };

// Estados (strings; úteis para teste e para depuração).
export const STATE = {
  IDLE: 'idle',
  WANDER: 'wander',
  FLEE: 'flee',
  CHASE: 'chase',
  ATTACK: 'attack',
  FUSE: 'fuse',
  EXPLODE: 'explode',
  DYING: 'dying',
};

const HALF_PI = Math.PI / 2;
const EPS = 1e-6;
const CHEST = 0.6; // fração da altura onde o golpe "sai" e "chega" (linha de visão)
const FUSE_DONE = 1 - 1e-9; // soma de dt/fuseTime pode parar em 0.9999999999999999

/**
 * O jogador pode ser alvo de hostis? Vivo e fora do Criativo. `mode` ausente
 * conta como Sobrevivência. (O gerenciador usa a mesma regra para spawnar hostis.)
 * @param {{pos?:object, alive?:boolean, mode?:string}|null|undefined} player
 */
export function isTargetable(player) {
  return !!player && !!player.pos && player.alive !== false && player.mode !== 'creative';
}

/**
 * Inicializa os campos de IA de um mob recém-criado. A fase inicial é
 * sorteada, para um grupo de mobs não começar a andar todo ao mesmo tempo.
 * @param {object} mob @param {object} def @param {ReturnType<import('../rng.js').makeRng>} rng
 */
export function initMob(mob, def, rng) {
  mob.state = STATE.IDLE;
  mob.stateT = rng.range(0, def.idleTime[1]);
  mob.heading = rng.angle();
  mob.voiceT = rng.range(AI.voiceGap[0], AI.voiceGap[1]);
  mob.wish = { x: 0, z: 0 };
  mob.face = { x: 0, z: 0 };
  mob.speed = 0;
  mob.wantJump = false;
  mob.attackCd = 0;
  mob.attackT = 0;
  mob.fuse = 0;
  mob.blockedT = 0;
  mob.lateralT = 0;
  mob.lateralDir = 1;
  mob.hurtBy = null;
  // Caminho local (feature 017): o gerenciador planeja e guarda aqui; a IA só lê o próximo waypoint.
  mob.path = null; // waypoints {x,y,z} ainda não alcançados, ou null
  mob.pathT = 0; // s até o próximo replanejamento (≤ 0 ⇒ replaneja quando puder)
  mob.pathGX = NaN; // coluna do alvo do último plano
  mob.pathGZ = NaN;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function emitSound(ctx, name, mob, def) {
  if (!ctx.events) return;
  const p = mob.body.pos;
  ctx.events.push({ type: 'sound', name, x: p.x, y: p.y + def.height * 0.5, z: p.z });
}

function enterIdle(mob, def, rng) {
  mob.state = STATE.IDLE;
  mob.stateT = rng.range(def.idleTime[0], def.idleTime[1]);
  mob.lateralT = 0;
}

function enterWander(mob, def, rng) {
  mob.state = STATE.WANDER;
  mob.stateT = rng.range(def.wanderTime[0], def.wanderTime[1]);
  mob.heading = rng.angle();
  mob.blockedT = 0;
  mob.lateralT = 0;
}

/** Anda no rumo `mob.heading` com a velocidade dada. */
function walkHeading(mob, speed) {
  mob.wish.x = Math.sin(mob.heading);
  mob.wish.z = Math.cos(mob.heading);
  mob.speed = speed;
}

/** Voz periódica: emite `name` quando `voiceT` zera e sorteia a próxima. */
function talk(mob, def, ctx, rng, dt, name, gap) {
  mob.voiceT -= dt;
  if (mob.voiceT > 0) return;
  mob.voiceT = rng.range(gap[0], gap[1]);
  emitSound(ctx, name, mob, def);
}

/**
 * Passeio: `idle` ↔ `wander` com durações sorteadas em `def.idleTime` /
 * `def.wanderTime`. Quem vem de outro estado (perdeu o alvo, fim da fuga)
 * recomeça parado. Bloqueado por muito tempo, escolhe outro rumo.
 */
function roam(mob, def, ctx, rng, dt, talks) {
  if (mob.state !== STATE.IDLE && mob.state !== STATE.WANDER) {
    enterIdle(mob, def, rng);
    return;
  }
  mob.stateT -= dt;
  if (mob.stateT <= 0) {
    if (mob.state === STATE.IDLE) enterWander(mob, def, rng);
    else enterIdle(mob, def, rng);
  }
  if (mob.state === STATE.WANDER) {
    if (mob.blockedT > AI.passiveUnstickAfter) {
      mob.heading = rng.angle();
      mob.blockedT = 0;
    }
    walkHeading(mob, def.walkSpeed);
    mob.wantJump = mob.blockedT > AI.hopAfter;
  }
  if (talks) talk(mob, def, ctx, rng, dt, VOICE[def.kind], AI.voiceGap);
}

/** Distâncias entre o mob e o alvo (centros do corpo para a 3D). */
const D = { dx: 0, dz: 0, dy: 0, horiz: 0, dist: 0 };
function measure(mob, def, target) {
  const p = mob.body.pos;
  D.dx = target.x - p.x;
  D.dz = target.z - p.z;
  D.dy = target.y + PLAYER.height * 0.5 - (p.y + def.height * 0.5); // centro a centro
  D.horiz = Math.sqrt(D.dx * D.dx + D.dz * D.dz);
  D.dist = Math.sqrt(D.horiz * D.horiz + D.dy * D.dy);
}

/** Aponta `mob.face` para o alvo (se não estiver em cima dele). */
function faceTarget(mob) {
  if (D.horiz > EPS) {
    mob.face.x = D.dx / D.horiz;
    mob.face.z = D.dz / D.horiz;
  }
}

/** Vetor (dx, dz) da perseguição, a partir do mob, até o ponto de mira. */
const AIM = { dx: 0, dz: 0 };

/**
 * Ponto de mira da perseguição: o próximo waypoint do caminho local (`ctx.nextStep`,
 * feature 017), centro da célula; sem caminho (null, ou `nextStep` ausente), o próprio
 * alvo — ou seja, a linha reta de sempre.
 */
function aimAt(mob, ctx, target) {
  const wp = ctx.nextStep ? ctx.nextStep(mob, target) : null;
  if (wp) {
    AIM.dx = wp.x + 0.5 - mob.body.pos.x;
    AIM.dz = wp.z + 0.5 - mob.body.pos.z;
  } else {
    AIM.dx = D.dx;
    AIM.dz = D.dz;
  }
  return AIM;
}

/**
 * Perseguição rumo à direção (dx, dz) (o ponto de mira menos a posição do mob); se
 * ficou preso por mais de `AI.unstickAfter` s anda de lado (sinal sorteado) por
 * `AI.lateralTime`. Escreve `wish`/`speed`/`wantJump`.
 */
function chaseTarget(mob, rng, dt, speed, dx, dz) {
  const horiz = Math.sqrt(dx * dx + dz * dz);
  if (horiz <= EPS) return;
  const ux = dx / horiz;
  const uz = dz / horiz;
  if (mob.lateralT <= 0 && mob.blockedT > AI.unstickAfter) {
    mob.lateralT = AI.lateralTime;
    mob.lateralDir = rng.chance(0.5) ? 1 : -1;
    mob.blockedT = 0;
  }
  if (mob.lateralT > 0) {
    mob.lateralT -= dt;
    mob.wish.x = -uz * mob.lateralDir; // perpendicular ao alvo
    mob.wish.z = ux * mob.lateralDir;
  } else {
    mob.wish.x = ux;
    mob.wish.z = uz;
  }
  mob.speed = speed;
  mob.wantJump = mob.blockedT > AI.hopAfter;
}

// ---------------------------------------------------------------------------
// Comportamentos
// ---------------------------------------------------------------------------

function startFlee(mob, def, rng, from) {
  const p = mob.body.pos;
  const ax = p.x - from.x;
  const az = p.z - from.z;
  mob.heading =
    Math.sqrt(ax * ax + az * az) > EPS
      ? Math.atan2(ax, az) + rng.range(-AI.fleeJitter, AI.fleeJitter)
      : rng.angle(); // golpe "de dentro": foge para qualquer lado
  mob.state = STATE.FLEE;
  mob.stateT = def.fleeTime;
  mob.blockedT = 0;
}

function thinkPassive(mob, def, ctx, rng, dt) {
  if (mob.hurtBy) {
    const from = mob.hurtBy;
    mob.hurtBy = null;
    startFlee(mob, def, rng, from);
  }
  if (mob.state === STATE.FLEE) {
    mob.stateT -= dt;
    if (mob.stateT <= 0) {
      enterIdle(mob, def, rng);
      return;
    }
    if (mob.blockedT > AI.passiveUnstickAfter) {
      mob.heading += (rng.chance(0.5) ? 1 : -1) * HALF_PI; // desliza ao longo do obstáculo
      mob.blockedT = 0;
    }
    walkHeading(mob, def.fleeSpeed);
    mob.wantJump = mob.blockedT > AI.hopAfter;
    return;
  }
  roam(mob, def, ctx, rng, dt, true);
}

function strike(mob, def, ctx) {
  mob.attackCd = def.attackCooldown;
  mob.attackT = 1;
  if (!ctx.events) return;
  const p = mob.body.pos;
  ctx.events.push({
    type: 'hurt-player',
    amount: def.attackDamage,
    source: def.kind,
    fromX: p.x,
    fromZ: p.z,
    knock: def.knockback,
    knockUp: def.knockbackUp,
  });
}

function thinkMelee(mob, def, ctx, rng, dt) {
  mob.hurtBy = null; // hostil ferido não foge
  const target = isTargetable(ctx.player) ? ctx.player.pos : null;
  if (target) {
    measure(mob, def, target);
    const engaged = mob.state === STATE.CHASE || mob.state === STATE.ATTACK;
    const range = engaged ? def.aggroRange * AI.loseAggroMult : def.aggroRange;
    if (D.dist <= range) {
      if (!engaged) {
        emitSound(ctx, VOICE[def.kind], mob, def);
        mob.voiceT = rng.range(AI.chaseVoiceGap[0], AI.chaseVoiceGap[1]);
      }
      const edge = D.horiz - (def.halfW + PLAYER.halfWidth); // borda a borda, na horizontal
      const dyFeet = target.y - mob.body.pos.y;
      const mp = mob.body.pos;
      // Alcance geométrico E, se o host informa, linha de visão livre: parede de 1 bloco
      // entre os dois (distância borda a borda 1,0 < attackReach) não deixa o zumbi bater.
      const inReach =
        edge <= def.attackReach &&
        Math.abs(dyFeet) < def.height &&
        (!ctx.los || ctx.los(mp.x, mp.y + def.height * CHEST, mp.z, target.x, target.y + PLAYER.height * CHEST, target.z));
      mob.state = inReach ? STATE.ATTACK : STATE.CHASE;
      faceTarget(mob);
      if (edge > def.attackReach * AI.stopFraction) {
        const a = aimAt(mob, ctx, target);
        chaseTarget(mob, rng, dt, def.chaseSpeed, a.dx, a.dz);
      }
      if (inReach && mob.attackCd <= 0) strike(mob, def, ctx);
      talk(mob, def, ctx, rng, dt, VOICE[def.kind], AI.chaseVoiceGap);
      return;
    }
  }
  roam(mob, def, ctx, rng, dt, false); // sem alvo: passeia devagar
}

function decayFuse(mob, def, dt) {
  if (mob.fuse > 0) mob.fuse = Math.max(0, mob.fuse - dt / def.fuseTime);
}

function thinkCreeper(mob, def, ctx, rng, dt) {
  mob.hurtBy = null;
  if (mob.state === STATE.EXPLODE) return; // já decidiu; o gerenciador executa
  const target = isTargetable(ctx.player) ? ctx.player.pos : null;
  const fusing = mob.state === STATE.FUSE;
  if (target) {
    measure(mob, def, target);
    const engaged = fusing || mob.state === STATE.CHASE;
    const range = engaged ? def.aggroRange * AI.loseAggroMult : def.aggroRange;
    if (D.dist <= range) {
      // Quem já infla só desiste além de fuseAbortDist; quem ainda não, só começa dentro de fuseStartDist.
      const inflate = fusing ? D.dist <= def.fuseAbortDist : D.dist <= def.fuseStartDist;
      faceTarget(mob);
      if (inflate) {
        if (!fusing) {
          mob.state = STATE.FUSE;
          emitSound(ctx, 'hiss', mob, def);
        }
        mob.fuse = Math.min(1, mob.fuse + dt / def.fuseTime);
        if (mob.fuse >= FUSE_DONE) {
          mob.fuse = 1;
          mob.state = STATE.EXPLODE;
        }
        return; // parado enquanto infla
      }
      mob.state = STATE.CHASE;
      decayFuse(mob, def, dt);
      const a = aimAt(mob, ctx, target);
      chaseTarget(mob, rng, dt, def.chaseSpeed, a.dx, a.dz);
      return;
    }
  }
  decayFuse(mob, def, dt); // sem alvo: desinfla e passeia
  roam(mob, def, ctx, rng, dt, false);
}

/**
 * Um passo de decisão de UM mob. Não move o corpo nem toca no mundo.
 *
 * Escreve em `mob`: `wish` ({x,z} unitário ou 0), `speed` (b/s), `wantJump`,
 * `face` (direção para onde olhar quando parado), `state` e os temporizadores
 * (`stateT`, `attackCd`, `attackT`, `fuse`, `lateralT`, `voiceT`, `heading`).
 * Lê de `mob`: `body.pos`, `dead`, `hurtBy` (consumido) e `blockedT` (mantido
 * pelo gerenciador: s empurrando sem progredir).
 *
 * `ctx = { player:{pos,alive,mode}, seconds, events?, los? }`. Se `events` existir,
 * `think` empurra nele `hurt-player` (golpe do zumbi) e `sound` (voz, hiss). Se `los`
 * existir — `los(ax, ay, az, bx, by, bz) => boolean`, "o segmento a→b está livre de
 * blocos?" — o zumbi só bate com linha de visão (o gerenciador a fornece; sem ela,
 * vale só a geometria). Se `nextStep` existir — `nextStep(mob, alvo) => {x,y,z}|null`,
 * o próximo waypoint do caminho local (feature 017) — quem persegue mira nele; `null`
 * (ou ausente) é a linha reta de sempre.
 *
 * @param {object} mob @param {object} def
 * @param {{player:object, seconds?:number, events?:Array, los?:Function, nextStep?:Function}} ctx
 * @param {ReturnType<import('../rng.js').makeRng>} rng
 * @param {number} dt segundos
 */
export function think(mob, def, ctx, rng, dt) {
  mob.wish.x = 0;
  mob.wish.z = 0;
  mob.speed = 0;
  mob.wantJump = false;
  mob.face.x = 0;
  mob.face.z = 0;
  if (mob.attackCd > 0) mob.attackCd = Math.max(0, mob.attackCd - dt);
  if (mob.attackT > 0) mob.attackT = Math.max(0, mob.attackT - dt / AI.attackAnim);
  if (mob.dead) {
    mob.hurtBy = null;
    return;
  }
  switch (def.behavior) {
    case BEHAVIOR.MELEE:
      thinkMelee(mob, def, ctx, rng, dt);
      break;
    case BEHAVIOR.CREEPER:
      thinkCreeper(mob, def, ctx, rng, dt);
      break;
    default:
      thinkPassive(mob, def, ctx, rng, dt);
  }
}
