// Fonte única das criaturas: hitbox, vida, velocidades, combate e spawn.
// Balanceamento mora AQUI (e só aqui). Modelos (`model.js`), IA (`ai.js`) e o
// gerenciador (`manager.js`) leem estes valores — nunca os copiam.
//
// Unidades: blocos e segundos. HP: 1 coração = 2 HP. Jogador tem 20 HP.
// Hitbox: AABB de base quadrada (`halfW`) e altura (`height`); `pos` do mob é
// o CENTRO DOS PÉS.

import { BLOCK } from '../blocks.js';
import { ITEM } from '../game/items.js';

export const MOB_KINDS = ['pig', 'sheep', 'zombie', 'creeper'];

/** Comportamentos de IA reconhecidos por `ai.js`. */
export const BEHAVIOR = { PASSIVE: 'passive', MELEE: 'melee', CREEPER: 'creeper' };

const COMMON = {
  gravity: true,
  jumpSpeed: 8.5, // pulo automático ao topar num degrau de 1 bloco
  turnRate: 8, // rad/s — suaviza a rotação do corpo
  corpseTime: 0.5, // s de animação de morte antes de sumir
  hurtTime: 0.35, // s de flash vermelho + imunidade a novo knockback
};

export const MOB_DEFS = {
  pig: {
    ...COMMON,
    kind: 'pig',
    behavior: BEHAVIOR.PASSIVE,
    hostile: false,
    maxHp: 10,
    halfW: 0.45,
    height: 0.9,
    walkSpeed: 1.6,
    fleeSpeed: 3.6, // ao ser ferido, foge por `fleeTime`
    fleeTime: 4,
    idleTime: [1.5, 4], // [min, max] parado entre andadas
    wanderTime: [1.5, 4], // [min, max] andando numa direção
    drops: [{ item: ITEM.PORK, min: 1, max: 2 }],
    spawn: { on: [BLOCK.GRASS], group: [1, 3], weight: 3 },
  },
  sheep: {
    ...COMMON,
    kind: 'sheep',
    behavior: BEHAVIOR.PASSIVE,
    hostile: false,
    maxHp: 8,
    halfW: 0.45,
    height: 1.3,
    walkSpeed: 1.4,
    fleeSpeed: 3.2,
    fleeTime: 4,
    idleTime: [2, 5],
    wanderTime: [1.5, 3.5],
    drops: [{ item: ITEM.PORK, min: 1, max: 1 }],
    variants: 4, // cores da lã (branca, cinza, marrom, preta) — `variant` 0..3
    spawn: { on: [BLOCK.GRASS], group: [2, 4], weight: 2 },
  },
  zombie: {
    ...COMMON,
    kind: 'zombie',
    behavior: BEHAVIOR.MELEE,
    hostile: true,
    maxHp: 20,
    halfW: 0.3,
    height: 1.8,
    walkSpeed: 1.2, // vagueia devagar quando não viu o jogador
    chaseSpeed: 3.6, // jogador anda 6 e corre ~10.8: dá pra fugir
    idleTime: [1, 3],
    wanderTime: [1, 3],
    aggroRange: 20,
    attackReach: 1.2, // distância horizontal entre os corpos (borda a borda)
    attackDamage: 4, // HP (2 corações)
    attackCooldown: 1.0,
    knockback: 7, // impulso horizontal no jogador (b/s)
    knockbackUp: 5,
    burnsInDaylight: true, // 2 HP/s sob o sol, até morrer (a menos que abrigado)
    burnDps: 2,
    drops: [],
    spawn: { on: [BLOCK.GRASS, BLOCK.SAND, BLOCK.STONE, BLOCK.DIRT], group: [1, 2], weight: 3 },
  },
  creeper: {
    ...COMMON,
    kind: 'creeper',
    behavior: BEHAVIOR.CREEPER,
    hostile: true,
    maxHp: 16,
    halfW: 0.3,
    height: 1.7,
    walkSpeed: 1.2,
    chaseSpeed: 3.0,
    idleTime: [1, 3],
    wanderTime: [1, 3],
    aggroRange: 18,
    fuseStartDist: 2.5, // começa a "inchar" dentro disso
    fuseAbortDist: 5.5, // se o jogador se afastar além disso, desarma
    fuseTime: 1.5, // s até explodir
    blastRadius: 4.0, // alcance do dano ao jogador/mobs
    blastDamage: 16, // HP no centro; cai linearmente até 0 na borda (parado a 2,5: 6 HP)
    carveRadius: 2.5, // esfera de blocos destruídos (nunca y < 1)
    knockback: 9,
    knockbackUp: 6,
    burnsInDaylight: false,
    drops: [],
    spawn: { on: [BLOCK.GRASS, BLOCK.SAND, BLOCK.STONE, BLOCK.DIRT], group: [1, 1], weight: 1 },
  },
};

/** Regras globais de população (gerenciador de spawn). */
export const SPAWN = {
  tryInterval: 1.5, // s entre tentativas de spawn
  minDist: 20, // nunca nasce mais perto do que isso do jogador
  maxDist: 34,
  simRadius: 48, // fora disso o mob fica congelado
  despawnDist: 64, // fora disso o mob some
  passiveCap: 10, // passivos vivos ao mesmo tempo (contados até despawnDist)
  hostileCapBase: 3, // teto de hostis = min(hostileCapMax, base + dia)
  hostileCapMax: 8, // 8 hostis + 10 passivos = no máximo 18 criaturas vivas
  initialPassive: 6, // população inicial ao começar o jogo
  initialMinDist: 12,
  initialMaxDist: 30,
  daylightDespawnChance: 0.25, // por segundo, hostis longe sob o sol
  daylightDespawnDist: 24, // "longe" = mais distante do jogador que isto (blocos)
  voidY: -16, // abaixo disto o mob caiu num buraco até o fundo do mundo: some
};
