// Testes headless do LOOP JOGÁVEL (feature 014): game.js ligando tempo, vida,
// inventário e criaturas — golpear, coletar, comer, cair, morrer, renascer,
// Criativo, explosão e save. Mundo plano artificial, sem DOM nem câmera.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { CHUNK_VOLUME, chunkIndex } from '../src/world/terrain.js';
import { BLOCK } from '../src/blocks.js';
import { makeRng } from '../src/rng.js';
import { DAY_LENGTH, START_SECONDS } from '../src/game/time.js';
import { createGame } from '../src/game/game.js';
import { COMBAT, DAMAGE, FOOD, HOTBAR_SLOTS, ITEM, MELEE_REACH } from '../src/game/items.js';
import { MOB_DEFS } from '../src/entities/mobs.js';
import { PLAYER } from '../src/player/collision.js';
import { deserializeChunks, serializeChunks } from '../src/world/persistence.js';

const S = 10; // superfície do mundo plano: pés em y = S
const NIGHT = DAY_LENGTH * 0.75;
const NOON = DAY_LENGTH * 0.25;

const SLOT = {
  DIRT: HOTBAR_SLOTS.findIndex((s) => s.block === BLOCK.DIRT),
  PLANKS: HOTBAR_SLOTS.findIndex((s) => s.block === BLOCK.PLANKS),
  COBBLE: HOTBAR_SLOTS.findIndex((s) => s.block === BLOCK.COBBLE),
  GRASS: HOTBAR_SLOTS.findIndex((s) => s.block === BLOCK.GRASS),
  SWORD: HOTBAR_SLOTS.findIndex((s) => s.item === ITEM.SWORD),
  PORK: HOTBAR_SLOTS.findIndex((s) => s.item === ITEM.PORK),
};

/** Topo de pedregulho: não está em nenhum `spawn.on`, então nada nasce sozinho. */
function flatWorld() {
  const w = new World(1);
  for (let cx = -4; cx < 4; cx++) {
    for (let cz = -4; cz < 4; cz++) {
      const d = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y < S; y++) d[chunkIndex(x, y, z)] = y === S - 1 ? BLOCK.COBBLE : BLOCK.STONE;
        }
      }
      w.applyChunk(cx, cz, d);
    }
  }
  return w;
}

function newGame(opts = {}) {
  return createGame({ world: flatWorld(), rng: makeRng(7), ...opts });
}

const PLAYER_POS = { x: 0.5, y: S, z: 0.5 };
const eye = () => ({ x: PLAYER_POS.x, y: PLAYER_POS.y + PLAYER.eye, z: PLAYER_POS.z });
const types = (events) => events.map((e) => e.type);
const ofType = (events, t) => events.filter((e) => e.type === t);

/** Raio do olho do jogador até o centro da criatura. */
function rayAt(mob, blockDistance = Infinity) {
  const o = eye();
  const c = { x: mob.body.pos.x, y: mob.body.pos.y + mob.def.height / 2, z: mob.body.pos.z };
  const d = { x: c.x - o.x, y: c.y - o.y, z: c.z - o.z };
  const len = Math.hypot(d.x, d.y, d.z);
  return { origin: o, dir: { x: d.x / len, y: d.y / len, z: d.z / len }, blockDistance };
}

/** Coloca a criatura parada a `dx` blocos do jogador (sem IA mexendo nela). */
function parkMob(game, kind, dx = 1.5) {
  const m = game.mobs.spawn(kind, PLAYER_POS.x + dx, S, PLAYER_POS.z);
  return m;
}

/** Deixa o cooldown do golpe e do mob esfriarem sem simular a IA (mundo vazio). */
function cool(game, seconds = COMBAT.ATTACK_COOLDOWN + 0.05) {
  return game.update(seconds, { pos: PLAYER_POS });
}

test('novo jogo em Sobrevivência: 20 HP, kit inicial, espada permanente, de manhã', () => {
  const g = newGame();
  assert.equal(g.mode, 'survival');
  assert.equal(g.stats.hp, 20);
  assert.equal(g.seconds, START_SECONDS);
  assert.equal(g.day, 1);
  assert.equal(g.night, false);
  assert.equal(g.inventory.count(SLOT.PLANKS), 8);
  assert.equal(g.inventory.count(SLOT.PORK), 3);
  assert.equal(g.inventory.count(SLOT.SWORD), Infinity);
  assert.equal(g.inventory.count(SLOT.DIRT), 0);
  assert.equal(g.isNewGame, true);
});

test('golpe com a espada: 2 golpes matam um porco; solta carne; conta abate', () => {
  const g = newGame();
  g.inventory.select(SLOT.SWORD);
  const pig = parkMob(g, 'pig');
  const porkBefore = g.inventory.count(SLOT.PORK);

  const r1 = g.attack(rayAt(pig));
  assert.equal(r1.hit, true);
  assert.equal(pig.hp, MOB_DEFS.pig.maxHp - DAMAGE.SWORD);
  assert.ok(ofType(r1.events, 'sound').some((e) => e.name === 'hit'));
  assert.equal(g.stats.kills, 0);

  cool(g);
  pig.body.pos.x = PLAYER_POS.x + 1.5; // o knockback o empurrou: traz de volta
  pig.body.pos.z = PLAYER_POS.z;
  const r2 = g.attack(rayAt(pig));
  assert.equal(r2.hit, true);
  assert.equal(pig.hp <= 0 || pig.dead || pig.dying > 0, true, 'o porco morreu');
  assert.equal(g.stats.kills, 1);
  const gained = g.inventory.count(SLOT.PORK) - porkBefore;
  assert.ok(gained >= 1 && gained <= 2, 'dropa 1–2 carnes, veio ' + gained);
  assert.ok(ofType(r2.events, 'toast').some((e) => /Carne/.test(e.text)));
});

test('golpe de punho (slot de bloco) dá DAMAGE.FIST: 10 golpes para um porco', () => {
  const g = newGame();
  g.inventory.select(SLOT.GRASS);
  const pig = parkMob(g, 'pig');
  let hits = 0;
  while (!(pig.dead || pig.dying > 0) && hits < 20) {
    pig.body.pos.x = PLAYER_POS.x + 1.5;
    pig.body.pos.z = PLAYER_POS.z;
    assert.equal(g.attack(rayAt(pig)).hit, true);
    hits++;
    cool(g);
  }
  assert.equal(hits, Math.ceil(MOB_DEFS.pig.maxHp / DAMAGE.FIST));
});

test('cooldown: dois cliques seguidos são um golpe só — e o clique não vaza para o bloco', () => {
  const g = newGame();
  g.inventory.select(SLOT.SWORD);
  const zombie = parkMob(g, 'zombie', 1.5);
  const a = g.attack(rayAt(zombie));
  const hpAfterFirst = zombie.hp;
  const b = g.attack(rayAt(zombie));
  assert.equal(a.hit, true);
  assert.equal(b.hit, true, 'consumido: não quebra o bloco atrás da criatura');
  assert.equal(zombie.hp, hpAfterFirst, 'sem dano durante o cooldown');
  cool(g);
  assert.equal(g.attack(rayAt(zombie)).hit, true);
  assert.ok(zombie.hp < hpAfterFirst, 'depois do cooldown volta a ferir');
});

test('não golpeia através de parede: bloco mirado mais perto que a criatura', () => {
  const g = newGame();
  g.inventory.select(SLOT.SWORD);
  const pig = parkMob(g, 'pig', 3);
  const r = g.attack(rayAt(pig, 1.0));
  assert.equal(r.hit, false);
  assert.equal(pig.hp, MOB_DEFS.pig.maxHp);
});

test('fora do alcance do golpe: nada acontece', () => {
  const g = newGame();
  const pig = parkMob(g, 'pig', MELEE_REACH + 1.5);
  assert.equal(g.attack(rayAt(pig)).hit, false);
  assert.equal(pig.hp, MOB_DEFS.pig.maxHp);
});

test('comer carne: cura PORK_HEAL, gasta 1, respeita o intervalo; vida cheia não gasta', () => {
  const g = newGame();
  g.stats.damage(8, { source: 'test' }); // 12/20
  g.stats.update(1); // passa a invulnerabilidade
  g.inventory.select(SLOT.PORK);
  const before = g.inventory.count(SLOT.PORK);

  const ev = g.useItem();
  assert.equal(g.stats.hp, 12 + FOOD.PORK_HEAL);
  assert.equal(g.inventory.count(SLOT.PORK), before - 1);
  assert.ok(types(ev).includes('sound') && ofType(ev, 'sound').some((e) => e.name === 'eat'));

  assert.deepEqual([...g.useItem()], [], 'segunda mordida colada: bloqueada pelo intervalo');
  assert.equal(g.inventory.count(SLOT.PORK), before - 1);

  g.update(FOOD.EAT_COOLDOWN + 0.1, { pos: PLAYER_POS });
  g.useItem(); // 18 + 6 → 20 (cura só o que falta)
  assert.equal(g.stats.hp, 20);
  const left = g.inventory.count(SLOT.PORK);
  g.update(FOOD.EAT_COOLDOWN + 0.1, { pos: PLAYER_POS });
  assert.deepEqual([...g.useItem()], [], 'vida cheia: não come');
  assert.equal(g.inventory.count(SLOT.PORK), left, 'e não gasta a carne');
});

test('só a carne é comida: clique direito com espada ou bloco não faz nada', () => {
  const g = newGame();
  g.stats.damage(8, { source: 'test' });
  g.stats.update(1);
  g.inventory.select(SLOT.SWORD);
  assert.deepEqual([...g.useItem()], []);
  g.inventory.select(SLOT.GRASS);
  assert.deepEqual([...g.useItem()], []);
  assert.equal(g.stats.hp, 12);
});

test('quebrar bloco devolve o drop certo (grama→terra, pedra→pedregulho, madeira→madeira)', () => {
  const g = newGame();
  g.onBlockBroken(BLOCK.GRASS);
  g.onBlockBroken(BLOCK.STONE);
  g.onBlockBroken(BLOCK.STONE);
  g.onBlockBroken(BLOCK.WOOD);
  assert.equal(g.inventory.count(SLOT.DIRT), 1);
  assert.equal(g.inventory.count(SLOT.COBBLE), 2);
  assert.equal(g.inventory.count(HOTBAR_SLOTS.findIndex((s) => s.block === BLOCK.WOOD)), 1);
  assert.equal(g.inventory.count(SLOT.GRASS), 0, 'grama nunca é coletada como grama');
});

test('colocar bloco: gasta 1 por vez e para quando zera', () => {
  const g = newGame();
  g.inventory.select(SLOT.PLANKS);
  for (let i = 0; i < 8; i++) {
    assert.equal(g.getHeldBlock(), BLOCK.PLANKS, 'ainda há tábuas: ' + i);
    g.onBlockPlaced();
  }
  assert.equal(g.inventory.count(SLOT.PLANKS), 0);
  assert.equal(g.getHeldBlock(), null, 'sem unidades não coloca');
  g.inventory.select(SLOT.SWORD);
  assert.equal(g.getHeldBlock(), null, 'espada não é bloco');
});

test('queda: até 3 blocos não machuca; 10 blocos tira 7 HP; Criativo nunca', () => {
  const g = newGame();
  assert.deepEqual([...g.onLand(3)], []);
  assert.equal(g.stats.hp, 20);
  const ev = g.onLand(10);
  assert.equal(g.stats.hp, 13);
  const hurt = ofType(ev, 'player-hurt')[0];
  assert.equal(hurt.amount, 7);
  assert.equal(hurt.source, 'fall');
  assert.equal(hurt.knock, null, 'queda não empurra');

  const c = newGame({ mode: 'creative' });
  assert.deepEqual([...c.onLand(30)], []);
  assert.equal(c.stats.hp, 20);
});

test('zumbi à noite: fere com knockback, mata, congela o relógio e renasce limpo', () => {
  const g = newGame();
  g.setSeconds(NIGHT);
  const zombie = parkMob(g, 'zombie', 1.0);
  const def = MOB_DEFS.zombie;

  const hurts = [];
  let died = null;
  let t = 0;
  for (; t < 30 && !died; t += 1 / 30) {
    const ev = g.update(1 / 30, { pos: PLAYER_POS });
    hurts.push(...ofType(ev, 'player-hurt'));
    died = ofType(ev, 'player-died')[0] ?? null;
  }
  assert.ok(hurts.length >= 2, 'bateu várias vezes');
  const first = hurts[0];
  assert.equal(first.source, 'zombie');
  assert.equal(first.amount, def.attackDamage);
  assert.equal(first.knock.strength, def.knockback);
  assert.equal(first.knock.up, def.knockbackUp);
  assert.ok(died, 'o jogador parado acabou morrendo');
  assert.equal(died.cause, 'zombie');
  assert.equal(g.stats.dead, true);
  assert.equal(g.stats.hp, 0);
  // golpes respeitam o cooldown do zumbi (não é metralhadora)
  assert.ok(t >= (Math.ceil(20 / def.attackDamage) - 1) * def.attackCooldown, 'tempo mínimo até a morte');

  // morto: o relógio congela e nada mais machuca
  const frozenAt = g.seconds;
  const ev = g.update(5, { pos: PLAYER_POS });
  assert.equal(g.seconds, frozenAt);
  assert.deepEqual(ofType(ev, 'player-hurt'), []);
  assert.equal(g.attack(rayAt(zombie)).hit, false, 'morto não golpeia');

  // renascer
  g.respawn();
  assert.equal(g.stats.dead, false);
  assert.equal(g.stats.hp, 20);
  assert.equal(g.mobs.count('zombie'), 0, 'hostis foram limpos');
  assert.equal(g.stats.kills, 0, 'abates preservados (0 aqui, nenhum antes)');
  const after = g.update(1 / 30, { pos: PLAYER_POS });
  assert.deepEqual(ofType(after, 'player-died'), []);
});

test('renascer de noite pula para o amanhecer (dia seguinte); de dia o relógio segue', () => {
  const g = newGame();
  g.setSeconds(NIGHT);
  const day = g.day;
  g.stats.damage(99, { source: 'test' });
  g.respawn();
  assert.equal(g.night, false, 'não renasce no escuro');
  assert.equal(g.day, day + 1);
  assert.equal(g.seconds % DAY_LENGTH, START_SECONDS, 'amanhecer');

  const h = newGame();
  h.setSeconds(NOON);
  h.stats.damage(99, { source: 'test' });
  h.respawn();
  assert.equal(h.seconds, NOON, 'de dia o relógio não mexe');
});

test('o jogador respira: invulnerabilidade logo após levar dano (sem combo instantâneo)', () => {
  const g = newGame();
  g.setSeconds(NIGHT);
  parkMob(g, 'zombie', 1.0);
  parkMob(g, 'zombie', -1.0);
  const hits = [];
  for (let t = 0; t < 3; t += 1 / 60) {
    const ev = g.update(1 / 60, { pos: PLAYER_POS });
    for (const e of ofType(ev, 'player-hurt')) {
      void e;
      hits.push(t);
    }
  }
  assert.ok(hits.length >= 2, 'dois zumbis acertaram mais de uma vez');
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i] - hits[i - 1] >= 0.45, 'intervalo entre danos');
});

test('de dia, um zumbi exposto ao sol queima até morrer (e o jogador longe não sofre)', () => {
  const g = newGame();
  g.setSeconds(NOON);
  const zombie = g.mobs.spawn('zombie', 30.5, S, 0.5); // longe: só o sol age
  for (let t = 0; t < 14; t += 0.1) g.update(0.1, { pos: PLAYER_POS });
  assert.ok(zombie.dead || zombie.dying > 0 || g.mobs.mobs.get(zombie.id) === undefined, 'queimou até morrer');
  assert.equal(g.stats.hp, 20);
});

test('Criativo: sem dano, sem hostis, blocos infinitos que não gastam', () => {
  const g = newGame({ mode: 'creative' });
  g.setSeconds(NIGHT);
  parkMob(g, 'zombie', 1.0);
  for (let t = 0; t < 8; t += 0.1) {
    const ev = g.update(0.1, { pos: PLAYER_POS });
    assert.deepEqual(ofType(ev, 'player-hurt'), []);
  }
  assert.equal(g.stats.hp, 20);
  g.inventory.select(SLOT.DIRT);
  assert.equal(g.getHeldBlock(), BLOCK.DIRT);
  g.onBlockPlaced();
  assert.equal(g.inventory.count(SLOT.DIRT), Infinity);
  g.onBlockBroken(BLOCK.STONE);
  assert.equal(g.inventory.count(SLOT.COBBLE), Infinity);
});

test('trocar para Criativo limpa hostis e volta a Sobrevivência sem perder o estoque', () => {
  const g = newGame();
  g.inventory.select(SLOT.PORK);
  parkMob(g, 'zombie', 6);
  g.setMode('creative');
  assert.equal(g.mobs.count('zombie'), 0);
  g.setMode('survival');
  assert.equal(g.mode, 'survival');
  assert.equal(g.inventory.count(SLOT.PORK), 3, 'a carne real foi preservada');
});

test('creeper: infla, explode, abre a cratera e machuca por distância', () => {
  const g = newGame();
  g.setSeconds(NIGHT);
  const def = MOB_DEFS.creeper;
  g.mobs.spawn('creeper', 0.5 + 6, S, 0.5);
  let boom = null;
  let hurt = null;
  const sounds = [];
  for (let t = 0; t < 20 && !boom; t += 1 / 30) {
    const ev = g.update(1 / 30, { pos: PLAYER_POS });
    boom = ofType(ev, 'explosion')[0] ?? null;
    hurt = ofType(ev, 'player-hurt')[0] ?? hurt;
    sounds.push(...ofType(ev, 'sound').map((e) => e.name));
  }
  assert.ok(boom, 'o creeper explodiu');
  assert.ok(boom.blocks.length > 0, 'abriu uma cratera');
  for (const b of boom.blocks) assert.ok(b.y >= 1, 'nunca abaixo de y = 1');
  assert.ok(hurt, 'o jogador parado a ~2,5 blocos foi atingido');
  assert.equal(hurt.source, 'creeper');
  assert.ok(hurt.amount > 0 && hurt.amount <= def.blastDamage);
  assert.ok(hurt.knock.strength === def.knockback);
  assert.ok(sounds.includes('hiss'), 'avisou com o chiado');
});

test('tempo e dia avançam enquanto vivo: 1 dia = DAY_LENGTH s', () => {
  const g = newGame();
  g.setSeconds(0);
  g.update(DAY_LENGTH - 1, { pos: PLAYER_POS });
  assert.equal(g.day, 1);
  g.update(2, { pos: PLAYER_POS });
  assert.equal(g.day, 2);
});

test('save: toJSON → novo jogo restaura modo, relógio, vida, abates e inventário', () => {
  const g = newGame();
  g.setSeconds(1234);
  g.stats.damage(6, { source: 'test' });
  g.stats.addKill();
  g.stats.addKill();
  g.inventory.select(SLOT.PORK);
  g.onBlockBroken(BLOCK.STONE);
  const json = JSON.parse(JSON.stringify(g.toJSON())); // passa por JSON de verdade

  const h = newGame({ saved: json });
  assert.equal(h.isNewGame, false);
  assert.equal(h.seconds, 1234);
  assert.equal(h.stats.hp, 14);
  assert.equal(h.stats.kills, 2);
  assert.equal(h.inventory.selected, SLOT.PORK);
  assert.equal(h.inventory.count(SLOT.PORK), 3);
  assert.equal(h.inventory.count(SLOT.COBBLE), 1);
  assert.equal(h.inventory.count(SLOT.PLANKS), 8);
});

test('save corrompido ou de versão desconhecida vira jogo novo com kit (nunca quebra)', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { v: 99 }, { v: 1, seconds: 'abc', stats: 'x', inventory: [] }]) {
    const g = newGame({ saved: bad });
    assert.equal(g.stats.hp, 20);
    assert.ok(g.seconds >= 0 && Number.isFinite(g.seconds));
    assert.ok(g.inventory.count(SLOT.PORK) >= 0);
  }
  const partial = newGame({ saved: { v: 1, mode: 'creative', seconds: 50 } });
  assert.equal(partial.mode, 'creative');
  assert.equal(partial.seconds, 50);
});

test('o resumo da morte reporta dias e abates', () => {
  const g = newGame();
  g.setSeconds(DAY_LENGTH * 2.5);
  g.stats.addKill();
  assert.deepEqual(g.summary(), { days: 3, kills: 1 });
});

test('determinismo: mesma seed e mesma sequência => mesmos eventos', () => {
  const run = () => {
    const g = newGame({ rng: makeRng(99) });
    g.setSeconds(NIGHT);
    g.mobs.spawn('zombie', 5.5, S, 0.5);
    g.mobs.spawn('creeper', -6.5, S, 0.5);
    const log = [];
    for (let i = 0; i < 600; i++) {
      for (const e of g.update(1 / 60, { pos: PLAYER_POS })) {
        log.push(e.type + ':' + (e.amount ?? e.name ?? ''));
      }
    }
    return log.join('|') + '#' + g.stats.hp;
  };
  assert.equal(run(), run());
});

test('save: o modo do envelope vence um stats/inventory com modo diferente', () => {
  const g = newGame();
  const json = JSON.parse(JSON.stringify(g.toJSON()));
  json.mode = 'creative';
  json.stats.mode = 'survival';
  json.inventory.mode = 'survival';
  const h = newGame({ saved: json });
  assert.equal(h.mode, 'creative');
  assert.equal(h.inventory.count(SLOT.DIRT), Infinity, 'inventário também está em Criativo');
});

test('save: round-trip pelo formato REAL (serializeChunks → deserializeChunks → createGame)', () => {
  const g = newGame();
  g.setSeconds(777);
  g.stats.addKill();
  g.onBlockBroken(BLOCK.STONE);
  const text = serializeChunks([], 1337, { x: 1, y: 30, z: 2 }, g.toJSON());
  const back = deserializeChunks(text);
  assert.deepEqual(back.player, { x: 1, y: 30, z: 2 });
  const h = newGame({ saved: back.game });
  assert.equal(h.isNewGame, false);
  assert.equal(h.seconds, 777);
  assert.equal(h.stats.kills, 1);
  assert.equal(h.inventory.count(SLOT.COBBLE), 1);
});

test('golpe em criatura devolve hit-mob (tipo e ponto de impacto na hitbox); o golpe que mata também', () => {
  const g = newGame();
  g.inventory.select(SLOT.SWORD);
  const pig = parkMob(g, 'pig');
  const { halfW, height } = MOB_DEFS.pig;
  const x0 = pig.body.pos.x;
  const y0 = pig.body.pos.y;
  const z0 = pig.body.pos.z;

  const r1 = g.attack(rayAt(pig));
  const hits = ofType(r1.events, 'hit-mob');
  assert.equal(hits.length, 1, 'um golpe, um evento hit-mob');
  assert.equal(hits[0].kind, 'pig');
  // o raio entra pela face da hitbox voltada para o jogador (x0 - halfW)
  assert.ok(Math.abs(hits[0].x - (x0 - halfW)) < 1e-6, 'x na face da hitbox');
  assert.ok(hits[0].y >= y0 && hits[0].y <= y0 + height, 'y dentro da altura do porco');
  assert.ok(Math.abs(hits[0].z - z0) <= halfW + 1e-6, 'z dentro da largura do porco');

  // golpe ainda recarregando: o clique é consumido, sem dano e sem hit-mob
  const again = g.attack(rayAt(pig));
  assert.equal(again.hit, true);
  assert.equal(ofType(again.events, 'hit-mob').length, 0);

  // o golpe que mata também emite o evento (o impacto aconteceu)
  cool(g);
  pig.body.pos.x = PLAYER_POS.x + 1.5; // o knockback o empurrou: traz de volta
  pig.body.pos.z = PLAYER_POS.z;
  const r2 = g.attack(rayAt(pig));
  assert.equal(g.stats.kills, 1);
  assert.equal(ofType(r2.events, 'hit-mob').length, 1);
});

test('sem criatura na mira não há hit-mob (o clique vai para o bloco)', () => {
  const g = newGame();
  const miss = g.attack({ origin: eye(), dir: { x: 0, y: 1, z: 0 }, blockDistance: Infinity });
  assert.equal(miss.hit, false);
  assert.equal(ofType(miss.events, 'hit-mob').length, 0);
});
