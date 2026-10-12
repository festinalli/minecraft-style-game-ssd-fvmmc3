import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_HP, HEALTH, MODE, isMode, fallDamage, createStats } from '../src/game/stats.js';

// Passos binários exatos (1/64, 0.25, 0.5...) evitam erro de ponto flutuante
// nas contagens de tempo exatas.
function advance(stats, seconds, dt) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stats.update(dt);
}

// --- fallDamage ---

test('fallDamage: 0 até 3 blocos; depois ceil(d - 3)', () => {
  const table = [
    [0, 0],
    [1, 0],
    [2.99, 0],
    [3, 0],
    [3.01, 1],
    [4, 1],
    [4.5, 2],
    [5, 2],
    [6.2, 4],
    [10, 7],
    [23, 20],
  ];
  for (const [d, hp] of table) assert.equal(fallDamage(d), hp, `d=${d}`);
  // a tabela acima vale para o limiar canônico (uma verdade: HEALTH)
  assert.equal(fallDamage(HEALTH.FALL_SAFE_DISTANCE), 0);
  assert.equal(fallDamage(HEALTH.FALL_SAFE_DISTANCE + 1), 1);
});

test('fallDamage: entrada inválida não causa dano', () => {
  for (const bad of [-1, -100, NaN, undefined, null, '10', {}, [], true]) {
    assert.equal(fallDamage(bad), 0, String(bad));
  }
});

test('fallDamage: queda de 23 blocos mata do HP cheio (ceil(23 - 3) = MAX_HP)', () => {
  const s = createStats();
  const r = s.damage(fallDamage(23), { source: 'fall' });
  assert.equal(r.applied, MAX_HP);
  assert.equal(r.died, true);
});

// --- estado inicial ---

test('estado inicial: vida cheia, vivo, sem abates, Sobrevivência', () => {
  const s = createStats();
  assert.equal(MAX_HP, 20);
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.maxHp, MAX_HP);
  assert.equal(s.mode, MODE.SURVIVAL);
  assert.equal(s.dead, false);
  assert.equal(s.kills, 0);
  assert.equal(s.invuln, 0);
  assert.equal(s.sinceDamage, 0);
});

test('modo: createStats aceita só modos válidos (inválido cai em Sobrevivência)', () => {
  assert.equal(createStats({ mode: 'creative' }).mode, MODE.CREATIVE);
  assert.equal(createStats({ mode: 'banana' }).mode, MODE.SURVIVAL);
  assert.equal(createStats({}).mode, MODE.SURVIVAL);
  assert.ok(isMode('survival') && isMode('creative'));
  assert.ok(!isMode('banana') && !isMode(undefined) && !isMode(null));
});

// --- dano ---

test('damage: subtrai HP, devolve { applied, died } e registra a origem', () => {
  const s = createStats();
  const r = s.damage(6, { source: 'zombie' });
  assert.deepEqual(r, { applied: 6, died: false });
  assert.equal(s.hp, 14);
  assert.equal(s.lastSource, 'zombie');
  assert.equal(s.dead, false);
});

test('damage: aceita ausência de opts e opts nulo', () => {
  const s = createStats();
  assert.equal(s.damage(1).applied, 1);
  s.update(HEALTH.INVULN_TIME);
  assert.equal(s.damage(1, null).applied, 1);
  assert.equal(s.lastSource, null);
});

test('damage: fracionário arredonda para cima (HP segue inteiro)', () => {
  const s = createStats();
  assert.equal(s.damage(0.2).applied, 1);
  s.update(HEALTH.INVULN_TIME);
  assert.equal(s.damage(2.4).applied, 3);
  assert.equal(s.hp, 16);
  assert.ok(Number.isInteger(s.hp));
});

test('damage: zero, negativo, NaN e não-número são ignorados sem efeito colateral', () => {
  const s = createStats();
  for (const bad of [0, -5, NaN, undefined, null, '4', {}, [], false]) {
    assert.deepEqual(s.damage(bad), { applied: 0, died: false }, String(bad));
  }
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.invuln, 0); // dano inválido não dispara imunidade
});

test('damage: os métodos funcionam destacados do objeto (sem depender de this)', () => {
  const { damage, update } = createStats();
  assert.equal(damage(3).applied, 3);
  update(1);
});

// --- invulnerabilidade ---

test('invulnerabilidade: 0.5 s após o dano, outro dano é ignorado', () => {
  const s = createStats();
  s.damage(4);
  assert.equal(s.invuln, HEALTH.INVULN_TIME);
  assert.deepEqual(s.damage(4), { applied: 0, died: false });
  assert.equal(s.hp, 16);
  s.update(0.25);
  assert.deepEqual(s.damage(4), { applied: 0, died: false }); // ainda imune
  s.update(0.25);
  assert.equal(s.invuln, 0);
  assert.equal(s.damage(4).applied, 4); // acabou
  assert.equal(s.hp, 12);
});

test('invulnerabilidade: 5 passos de 0.1 s zeram 0.5 s (tolerância de float)', () => {
  const s = createStats();
  s.damage(1);
  for (let i = 0; i < 5; i++) s.update(0.1);
  assert.equal(s.invuln, 0);
  assert.equal(s.damage(1).applied, 1);
});

test('invulnerabilidade: cada dano válido reinicia invuln e sinceDamage', () => {
  const s = createStats();
  s.damage(2);
  s.update(3);
  assert.equal(s.sinceDamage, 3);
  s.damage(2);
  assert.equal(s.sinceDamage, 0);
  assert.equal(s.invuln, HEALTH.INVULN_TIME);
});

test('update: ignora dt inválido (negativo, zero, NaN, Infinity, não-número)', () => {
  const s = createStats();
  s.damage(5);
  const before = { invuln: s.invuln, since: s.sinceDamage, hp: s.hp };
  for (const bad of [-1, 0, NaN, Infinity, undefined, '1']) s.update(bad);
  assert.deepEqual({ invuln: s.invuln, since: s.sinceDamage, hp: s.hp }, before);
});

// --- morte ---

test('hp nunca fica abaixo de 0: dano excessivo aplica só o HP restante', () => {
  const s = createStats();
  const r = s.damage(999);
  assert.deepEqual(r, { applied: MAX_HP, died: true });
  assert.equal(s.hp, 0);
  assert.equal(s.dead, true);
});

test('damage: Infinity é letal e continua aplicando só o HP restante', () => {
  const s = createStats();
  assert.deepEqual(s.damage(Infinity), { applied: MAX_HP, died: true });
  assert.equal(s.hp, 0);
});

test('died só na transição para 0: dano em jogador morto não "morre" de novo', () => {
  const s = createStats();
  assert.equal(s.damage(MAX_HP - 1).died, false);
  assert.equal(s.hp, 1);
  s.update(HEALTH.INVULN_TIME);
  const fatal = s.damage(1);
  assert.deepEqual(fatal, { applied: 1, died: true });
  assert.equal(s.dead, true);
  s.update(10);
  assert.deepEqual(s.damage(5), { applied: 0, died: false });
  assert.equal(s.hp, 0);
  assert.equal(s.dead, true);
});

test('jogador morto não regenera nem cura', () => {
  const s = createStats();
  s.damage(MAX_HP);
  advance(s, 60, 0.5);
  assert.equal(s.hp, 0);
  assert.equal(s.dead, true);
  assert.equal(s.heal(6), 0);
  assert.equal(s.hp, 0);
});

// --- Criativo ---

test('Criativo: dano ignorado, vida cheia e sem imunidade disparada', () => {
  const s = createStats({ mode: MODE.CREATIVE });
  assert.deepEqual(s.damage(50, { source: 'creeper' }), { applied: 0, died: false });
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.invuln, 0);
  assert.equal(s.dead, false);
  assert.equal(s.lastSource, null);
});

test('Criativo: update não mexe na vida', () => {
  const s = createStats({ mode: MODE.CREATIVE });
  advance(s, 30, 0.5);
  assert.equal(s.hp, MAX_HP);
});

// --- regeneração ---

test('regeneração: nada antes de 12 s; +1 aos 12 s; depois +1 a cada 4 s; para no máximo', () => {
  const s = createStats();
  s.damage(4); // hp 16
  const first = HEALTH.REGEN_DELAY + HEALTH.REGEN_INTERVAL;
  assert.equal(first, 12);

  advance(s, first - 0.5, 0.5); // 11.5 s
  assert.equal(s.hp, 16, 'ainda sem cura em 11.5 s');
  s.update(0.5); // 12 s
  assert.equal(s.hp, 17);
  advance(s, 3.5, 0.5); // 15.5 s
  assert.equal(s.hp, 17);
  s.update(0.5); // 16 s
  assert.equal(s.hp, 18);
  advance(s, 4, 0.5); // 20 s
  assert.equal(s.hp, 19);
  advance(s, 4, 0.5); // 24 s
  assert.equal(s.hp, 20);
  advance(s, 40, 0.5);
  assert.equal(s.hp, 20, 'não passa de maxHp');
});

test('regeneração: mesmo resultado com dt de 1/64 s, 0.5 s ou um único update', () => {
  const makeHurt = () => {
    const s = createStats();
    s.damage(8); // hp 12
    return s;
  };
  const fine = makeHurt();
  advance(fine, 11.984375, 1 / 64); // 767 passos = 11.984375 s: ainda não
  assert.equal(fine.hp, 12);
  fine.update(1 / 64); // 12 s exatos
  assert.equal(fine.hp, 13);
  advance(fine, 8, 1 / 64); // 20 s
  assert.equal(fine.hp, 15);

  const coarse = makeHurt();
  advance(coarse, 20, 0.5);
  assert.equal(coarse.hp, 15);

  const once = makeHurt();
  once.update(20); // um passo só: cura em laço (12 s de elegível = 3 curas)
  assert.equal(once.hp, 15);
});

test('regeneração: passo grande que cruza o atraso conta só a parte depois dele', () => {
  const s = createStats();
  s.damage(6); // hp 14
  s.update(7.75);
  assert.equal(s.hp, 14);
  s.update(0.5); // sinceDamage 8.25: só 0.25 s contam
  assert.equal(s.hp, 14);
  s.update(3.5); // 11.75 s: ainda 0.25 s antes dos 12
  assert.equal(s.hp, 14);
  s.update(0.25); // 12 s
  assert.equal(s.hp, 15);
});

test('regeneração: novo dano zera o ciclo (não guarda tempo acumulado)', () => {
  const s = createStats();
  s.damage(4); // hp 16
  advance(s, 10, 0.5); // 2 s de regen acumulados, sem cura ainda
  assert.equal(s.hp, 16);
  s.damage(2); // hp 14 — reinicia
  advance(s, 11.5, 0.5);
  assert.equal(s.hp, 14, 'o tempo anterior não pode adiantar a cura');
  s.update(0.5); // 12 s depois do 2º dano
  assert.equal(s.hp, 15);
});

test('regeneração: vida cheia não acumula "crédito" para depois', () => {
  const s = createStats();
  advance(s, 60, 0.5); // cheio por muito tempo
  s.damage(2);
  advance(s, 11.5, 0.5);
  assert.equal(s.hp, 18);
  s.update(0.5);
  assert.equal(s.hp, 19);
});

test('regeneração: comer (heal) no meio do ciclo não quebra a contagem', () => {
  const s = createStats();
  s.damage(10); // hp 10
  advance(s, 10, 0.5); // 2 s elegíveis
  assert.equal(s.heal(2), 2); // hp 12
  advance(s, 2, 0.5); // chega a 12 s
  assert.equal(s.hp, 13);
});

// --- cura ---

test('heal: devolve o que realmente curou e respeita o máximo', () => {
  const s = createStats();
  s.damage(10); // hp 10
  assert.equal(s.heal(6), 6);
  assert.equal(s.hp, 16);
  assert.equal(s.heal(6), 4); // só 4 cabem
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.heal(1), 0);
});

test('heal: arredonda para baixo e ignora valores inválidos', () => {
  const s = createStats();
  s.damage(10);
  assert.equal(s.heal(2.9), 2);
  assert.equal(s.hp, 12);
  for (const bad of [0, 0.5, -3, NaN, undefined, '3', null]) {
    assert.equal(s.heal(bad), 0, String(bad));
  }
  assert.equal(s.hp, 12);
});

// --- abates ---

test('addKill: conta e devolve o total', () => {
  const s = createStats();
  assert.equal(s.addKill(), 1);
  assert.equal(s.addKill(), 2);
  assert.equal(s.kills, 2);
});

// --- respawn ---

test('respawn: vida cheia, vivo, imune por 1.5 s; mantém abates e modo', () => {
  const s = createStats();
  s.addKill();
  s.addKill();
  s.addKill();
  s.damage(MAX_HP);
  assert.equal(s.dead, true);

  s.respawn();
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.dead, false);
  assert.equal(s.invuln, HEALTH.RESPAWN_INVULN);
  assert.equal(s.kills, 3);
  assert.equal(s.mode, MODE.SURVIVAL);

  assert.deepEqual(s.damage(8), { applied: 0, died: false }); // imune
  advance(s, 1, 0.5);
  assert.equal(s.damage(8).applied, 0); // ainda imune aos 1.0 s
  s.update(0.5); // 1.5 s
  assert.equal(s.damage(8).applied, 8);
});

test('respawn: depois de renascer a regeneração funciona normalmente', () => {
  const s = createStats();
  s.damage(MAX_HP);
  s.respawn();
  advance(s, 2, 0.5);
  s.damage(2);
  advance(s, 12, 0.5);
  assert.equal(s.hp, 19);
});

test('respawn: sem estar morto só reabastece (idempotente)', () => {
  const s = createStats();
  s.damage(5);
  s.respawn();
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.dead, false);
});

// --- modos ---

test('setMode: Criativo dá vida cheia e reanima; modo inválido é ignorado', () => {
  const s = createStats();
  s.damage(15);
  assert.equal(s.hp, 5);
  assert.equal(s.setMode(MODE.CREATIVE), MODE.CREATIVE);
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.setMode('banana'), MODE.CREATIVE);
  assert.equal(s.setMode(undefined), MODE.CREATIVE);
  assert.equal(s.mode, MODE.CREATIVE);
});

test('setMode: morto que vira Criativo não fica "morto com vida cheia"', () => {
  const s = createStats();
  s.damage(MAX_HP);
  assert.equal(s.dead, true);
  s.setMode(MODE.CREATIVE);
  assert.equal(s.dead, false);
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.invuln, 0);
});

test('setMode: voltar a Sobrevivência mantém a vida e o dano volta a valer', () => {
  const s = createStats({ mode: MODE.CREATIVE });
  s.setMode(MODE.SURVIVAL);
  assert.equal(s.hp, MAX_HP);
  assert.equal(s.damage(7).applied, 7);
  assert.equal(s.hp, 13);
});

// --- JSON ---

test('toJSON: só estado persistente e serializável', () => {
  const s = createStats();
  s.damage(6);
  s.addKill();
  const j = s.toJSON();
  assert.deepEqual(j, { v: 1, mode: 'survival', hp: 14, kills: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(j)), j);
  // JSON.stringify do próprio objeto usa o toJSON
  assert.equal(JSON.stringify(s), JSON.stringify(j));
});

test('fromJSON(toJSON()) é identidade para hp, kills e modo', () => {
  const a = createStats();
  a.damage(9);
  a.addKill();
  a.addKill();
  const b = createStats();
  assert.equal(b.fromJSON(JSON.parse(JSON.stringify(a.toJSON()))), true);
  assert.deepEqual(b.toJSON(), a.toJSON());

  const c = createStats({ mode: MODE.CREATIVE });
  const d = createStats();
  d.fromJSON(c.toJSON());
  assert.equal(d.mode, MODE.CREATIVE);
  assert.equal(d.hp, MAX_HP);
});

test('fromJSON: hp inválido ou fora de [1, maxHp] vira maxHp; válido é mantido', () => {
  for (const bad of [undefined, null, NaN, 'x', '10', 0, -3, 2.5, 21, 99, Infinity, -Infinity, {}, []]) {
    const s = createStats();
    assert.equal(s.fromJSON({ hp: bad, kills: 0 }), true);
    assert.equal(s.hp, MAX_HP, `hp=${String(bad)}`);
  }
  for (const ok of [1, 7, MAX_HP]) {
    const s = createStats();
    s.fromJSON({ hp: ok });
    assert.equal(s.hp, ok);
  }
});

test('fromJSON: kills negativo/inválido vira 0; fracionário vira floor', () => {
  const table = [
    [-5, 0],
    [NaN, 0],
    ['x', 0],
    ['4', 0],
    [undefined, 0],
    [Infinity, 0],
    [2.7, 2],
    [0, 0],
    [12, 12],
  ];
  for (const [input, expected] of table) {
    const s = createStats();
    s.fromJSON({ hp: 10, kills: input });
    assert.equal(s.kills, expected, `kills=${String(input)}`);
  }
});

test('fromJSON: nunca restaura "morto" e zera o estado transitório', () => {
  const s = createStats();
  s.damage(MAX_HP);
  s.update(3);
  assert.equal(s.dead, true);
  s.fromJSON({ v: 1, mode: 'survival', hp: 0, kills: 4, dead: true });
  assert.equal(s.dead, false);
  assert.equal(s.hp, MAX_HP); // hp 0 = inválido => maxHp
  assert.equal(s.kills, 4);
  assert.equal(s.invuln, 0);
  assert.equal(s.sinceDamage, 0);
  assert.equal(s.lastSource, null);
  // e o dano volta a valer (sem imunidade herdada)
  assert.equal(s.damage(3).applied, 3);
});

test('fromJSON: regeneração recomeça do zero depois de carregar', () => {
  const s = createStats();
  s.fromJSON({ hp: 10, kills: 0 });
  advance(s, 11.5, 0.5);
  assert.equal(s.hp, 10);
  s.update(0.5);
  assert.equal(s.hp, 11);
});

test('fromJSON: modo válido é aplicado, inválido/ausente mantém o atual; Criativo força vida cheia', () => {
  const a = createStats({ mode: MODE.CREATIVE });
  a.fromJSON({ hp: 3, kills: 1 }); // sem modo: mantém Criativo (=> vida cheia)
  assert.equal(a.mode, MODE.CREATIVE);
  assert.equal(a.hp, MAX_HP);

  const b = createStats();
  b.fromJSON({ mode: 'banana', hp: 3 });
  assert.equal(b.mode, MODE.SURVIVAL);
  assert.equal(b.hp, 3);

  const c = createStats();
  c.fromJSON({ mode: 'creative', hp: 3 });
  assert.equal(c.mode, MODE.CREATIVE);
  assert.equal(c.hp, MAX_HP);
});

test('fromJSON: não-objeto não altera o estado e devolve false', () => {
  for (const bad of [null, undefined, 5, 'x', true, [], [1, 2]]) {
    const s = createStats();
    s.damage(5);
    s.addKill();
    const before = s.toJSON();
    assert.equal(s.fromJSON(bad), false, String(bad));
    assert.deepEqual(s.toJSON(), before);
    assert.equal(s.invuln, HEALTH.INVULN_TIME); // transitório intacto
  }
});

// --- qualidade ---

test('stats.js: sem Math.random() e sem console.log (constitution)', () => {
  const src = readFileSync(new URL('../src/game/stats.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('Math.random'));
  assert.ok(!src.includes('console.log'));
});
