// Simulação de balanceamento (feature 019): cinco cenários de combate rodados HEADLESS
// com `createGame`, sobre um mundo plano feito de chunks reais de `World`.
//
// PURO: sem DOM, sem câmera, sem `Math.random`. A aleatoriedade vem só de `makeRng(seed)`:
// a mesma lista de seeds dá a mesma tabela, byte a byte (é o que o teste confere).
//
// Cada cenário roda uma vez por seed e devolve UM número por seed. `runAll` tira a média
// (o `value` de cada linha) e compara com a faixa de `targets.js`.
//
// Convenções do jogo: `pos` de mob e de jogador = centro dos PÉS; Y para cima; tempo em s.

import { World } from '../world/world.js';
import { CHUNK_SIZE, CHUNK_VOLUME, chunkIndex } from '../world/terrain.js';
import { BLOCK } from '../blocks.js';
import { makeRng } from '../rng.js';
import { DAY_LENGTH } from '../game/time.js';
import { createGame } from '../game/game.js';
import { COMBAT, HOTBAR_SLOTS, ITEM } from '../game/items.js';
import { PLAYER } from '../player/collision.js';
import { SPAWN } from '../entities/mobs.js';
import { TARGETS } from './targets.js';

// --- Parâmetros da simulação (não são balanceamento: esse mora em mobs.js e items.js) ---
const DT = 1 / 60; // passo fixo: um quadro a 60 FPS
const SEED_COUNT = 50; // seeds fixas (1..50) quando `runAll` não recebe outro número
const SURFACE = 10; // topo do mundo plano: pés do jogador e dos mobs em y = SURFACE
const FLAT_HALF = 4; // chunks [-4, 4) por lado (128 blocos): o terreno gerado não entra na cena
const NIGHT = DAY_LENGTH * 0.75; // meia-noite do dia 1: sem sol, o zumbi não queima
const SEED_SALT = 7919; // separa o sorteio de posições do rng do jogo (mesma seed)
const HOME = { x: 0.5, z: 0.5 }; // jogador parado no centro de um bloco
const PLAYER_POS = { x: HOME.x, y: SURFACE, z: HOME.z };
const EYE = { x: HOME.x, y: SURFACE + PLAYER.eye, z: HOME.z }; // olho do jogador (ponto de mira)
const ENCOUNTER = [4, 8]; // blocos: onde nasce o zumbi solo (encontro: já dentro do aggroRange)
const CREEPER_DIST = 2.5; // blocos: "creeper parado a 2,5 blocos" (spec 019)
const HP_BEFORE_EAT = 10; // HP do jogador antes de comer: sobra espaço para a cura inteira
const SOLO_CAP = 60; // s: teto de segurança (o zumbi mata em alguns segundos)
const FIGHT_CAP = 30; // s: teto da luta com a espada
const TWO_WINDOW = 30; // s: janela de "dois zumbis" (spec 019)
const CREEPER_CAP = 10; // s: fusível de 1,5 s, com folga

const slotOf = (item) => HOTBAR_SLOTS.findIndex((s) => s.item === item);

/**
 * Mundo plano de chunks reais de `World`: pedregulho na superfície (fora de todo `spawn.on`,
 * então nada nasce sozinho) e pedra embaixo. Os chunks cobrem com folga o spawn (34 blocos)
 * e um passeio de 30 s: nas 50 seeds fixas nenhum mob sai dessa área (o zumbi mais longe
 * chega a ~43 blocos do centro, a área vai a 64), então o terreno gerado por seed não entra.
 */
function flatWorld() {
  const w = new World(1);
  for (let cx = -FLAT_HALF; cx < FLAT_HALF; cx++) {
    for (let cz = -FLAT_HALF; cz < FLAT_HALF; cz++) {
      const d = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let y = 0; y < SURFACE; y++) d[chunkIndex(x, y, z)] = y === SURFACE - 1 ? BLOCK.COBBLE : BLOCK.STONE;
        }
      }
      w.applyChunk(cx, cz, d);
    }
  }
  return w;
}

/** Um jogo novo, à meia-noite do dia 1, com o rng da seed e um gerador de posições à parte. */
function newRun(seed) {
  const game = createGame({ world: flatWorld(), rng: makeRng(seed) });
  game.setSeconds(NIGHT);
  return { game, place: makeRng(seed + SEED_SALT) };
}

/** Ponto no anel [minD, maxD] em torno do jogador. Sem arredondar: a distância exata importa. */
function ringPoint(place, minD, maxD) {
  const a = place.angle();
  const d = place.range(minD, maxD);
  return { x: HOME.x + Math.cos(a) * d, z: HOME.z + Math.sin(a) * d };
}

/** Cria uma criatura no anel [minD, maxD] (pés na superfície). */
function spawnIn(run, kind, minD, maxD) {
  const p = ringPoint(run.place, minD, maxD);
  return run.game.mobs.spawn(kind, p.x, SURFACE, p.z);
}

/**
 * Bot do jogador (puro). Parado: nunca golpeia. Lutando: a cada passo, se o golpe está
 * pronto, mira o centro do alvo e chama `game.attack(ray)`; quem decide alcance e linha de
 * visão é o próprio `game.attack`. O cooldown do bot anda no mesmo passo e com o mesmo dt
 * do cooldown do jogo (ambos decrementam uma vez por quadro, depois do golpe), então o bot
 * nunca dispara com o golpe ainda recarregando.
 * @returns {{fight:boolean, cd:number}} estado do bot (só o cooldown muda)
 */
export function createBot({ fight }) {
  return { fight: !!fight, cd: 0 };
}

/**
 * Um passo do bot, ANTES do `game.update` do quadro. `target` é a criatura mirada.
 * @param {{fight:boolean, cd:number}} bot
 * @param {ReturnType<typeof createGame>} game
 * @param {{x:number,y:number,z:number}} eye ponto de origem do raio (olho do jogador)
 * @param {object|null} target
 * @param {number} dt
 */
export function botStep(bot, game, eye, target, dt) {
  if (bot.fight && target && bot.cd <= 0) {
    const c = target.body.pos;
    const dx = c.x - eye.x;
    const dy = c.y + target.def.height / 2 - eye.y;
    const dz = c.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    const res = game.attack({
      origin: eye,
      dir: { x: dx / len, y: dy / len, z: dz / len },
      blockDistance: Infinity, // mundo plano: nenhum bloco entre o olho e a criatura
    });
    if (res.hit) bot.cd = COMBAT.ATTACK_COOLDOWN;
  }
  if (bot.cd > 0) bot.cd -= dt;
}

/**
 * Avança o jogo em passos de DT até `cap` s, até `until()` virar verdadeiro ou o jogador morrer.
 * `hurt` soma o dano que o jogador de fato levou (evento `player-hurt`, já sem a parte que a
 * invulnerabilidade bloqueou).
 * @returns {{t:number, hurt:number, dead:boolean}}
 */
function simulate(run, { cap, bot = null, target = null, until = () => false }) {
  const { game } = run;
  const steps = Math.round(cap / DT);
  let hurt = 0;
  for (let i = 1; i <= steps; i++) {
    if (bot) botStep(bot, game, EYE, target, DT);
    const events = game.update(DT, { pos: PLAYER_POS });
    for (let k = 0; k < events.length; k++) {
      if (events[k].type === 'player-hurt') hurt += events[k].amount;
    }
    if (game.stats.dead || until()) return { t: i * DT, hurt, dead: game.stats.dead };
  }
  return { t: cap, hurt, dead: false };
}

// --- Cenários: cada um devolve UM número por seed ---

/** Zumbi solo, jogador parado: segundos do encontro até a morte do jogador. */
function zumbiSolo(seed) {
  const run = newRun(seed);
  spawnIn(run, 'zombie', ENCOUNTER[0], ENCOUNTER[1]);
  const r = simulate(run, { cap: SOLO_CAP });
  return r.dead ? r.t : SOLO_CAP;
}

/** Zumbi solo, jogador revidando com a espada: 1 se o zumbi cai e o jogador não, 0 se não. */
function zumbiRevidando(seed) {
  const run = newRun(seed);
  run.game.inventory.select(slotOf(ITEM.SWORD));
  const z = spawnIn(run, 'zombie', ENCOUNTER[0], ENCOUNTER[1]);
  simulate(run, { cap: FIGHT_CAP, bot: createBot({ fight: true }), target: z, until: () => z.dead });
  return z.dead && !run.game.stats.dead ? 1 : 0;
}

/** Dois zumbis no anel de nascimento natural, jogador parado, 30 s: 1 se o jogador morre. */
function doisZumbis(seed) {
  const run = newRun(seed);
  spawnIn(run, 'zombie', SPAWN.minDist, SPAWN.maxDist);
  spawnIn(run, 'zombie', SPAWN.minDist, SPAWN.maxDist);
  return simulate(run, { cap: TWO_WINDOW }).dead ? 1 : 0;
}

/** Creeper parado a 2,5 blocos: dano total que a explosão dá ao jogador. */
function creeperDano(seed) {
  const run = newRun(seed);
  const c = spawnIn(run, 'creeper', CREEPER_DIST, CREEPER_DIST);
  return simulate(run, { cap: CREEPER_CAP, until: () => c.dead }).hurt;
}

/** Carne: HP curado por unidade consumida, com o jogador em HP_BEFORE_EAT. */
function carneCura(seed) {
  const { game } = newRun(seed);
  game.stats.damage(game.stats.maxHp - HP_BEFORE_EAT, { source: 'teste' });
  const slot = slotOf(ITEM.PORK);
  game.inventory.select(slot);
  const hp0 = game.stats.hp;
  const n0 = game.inventory.count(slot);
  game.useItem();
  const eaten = n0 - game.inventory.count(slot);
  return eaten > 0 ? (game.stats.hp - hp0) / eaten : 0;
}

/** Os cinco cenários, na ordem da tabela. `unit` '%' formata como fração em porcentagem. */
export const SCENARIOS = Object.freeze([
  { name: 'zumbiSolo', label: 'Zumbi sozinho, parado (até a morte)', unit: 's', run: zumbiSolo },
  { name: 'zumbiRevidando', label: 'Zumbi, jogador revidando com espada', unit: '%', run: zumbiRevidando },
  { name: 'doisZumbis', label: 'Dois zumbis, parado, 30 s (morte)', unit: '%', run: doisZumbis },
  { name: 'creeperDano', label: 'Creeper a 2,5 blocos (dano da explosão)', unit: 'HP', run: creeperDano },
  { name: 'carneCura', label: 'Carne (cura por unidade)', unit: 'HP', run: carneCura },
]);

const seedsOf = (n) => Array.from({ length: n }, (_, i) => i + 1);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Roda os cinco cenários com `seeds` seeds fixas (1..seeds).
 * @param {{seeds?: number}} [opts]
 * @returns {Array<{name:string, label:string, unit:string, value:number, min:number, max:number,
 *   target:number[], ok:boolean}>} `value` é a média das seeds; `ok` diz se cai na faixa.
 */
export function runAll({ seeds = SEED_COUNT } = {}) {
  const list = seedsOf(seeds);
  return SCENARIOS.map(({ name, label, unit, run }) => {
    const vals = list.map(run);
    const value = mean(vals);
    const target = TARGETS[name];
    return {
      name,
      label,
      unit,
      value,
      min: Math.min(...vals),
      max: Math.max(...vals),
      target: [...target],
      ok: value >= target[0] && value <= target[1],
    };
  });
}
