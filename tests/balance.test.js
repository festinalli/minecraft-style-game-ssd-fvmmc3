// Testes do balanceamento por simulação (feature 019): cada métrica cai na faixa-alvo de
// src/balance/targets.js com 50 seeds fixas, e a simulação é determinística (duas execuções
// dão a mesma tabela). Headless, sem DOM. O arquivo inteiro deve levar menos de 5 s.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAll } from '../src/balance/scenarios.js';
import { TARGETS } from '../src/balance/targets.js';

const SEEDS = 50;

// Uma única execução compartilhada pelos asserts (a segunda serve ao determinismo).
let table = null;
const rows = () => (table ??= runAll({ seeds: SEEDS }));

test('faixas da spec 019: targets.js tem exatamente os números documentados (mudar exige justificar na spec)', () => {
  assert.deepEqual([...TARGETS.zumbiSolo], [4, 8], 'zumbi solo: morte entre 4 e 8 s');
  assert.deepEqual([...TARGETS.zumbiRevidando], [1, 1], 'zumbi revidando: vitória em 100% das seeds');
  assert.deepEqual([...TARGETS.doisZumbis], [0.2, 0.6], 'dois zumbis: morte em 20% a 60% das seeds');
  assert.deepEqual([...TARGETS.creeperDano], [4, 8], 'creeper a 2,5 blocos: 4 a 8 HP');
  assert.deepEqual([...TARGETS.carneCura], [6, 6], 'carne: 6 HP por unidade');
});

test('runAll: os cinco cenários, na ordem, cada um com { name, value, target, ok }', () => {
  const r = rows();
  assert.deepEqual(
    r.map((x) => x.name),
    ['zumbiSolo', 'zumbiRevidando', 'doisZumbis', 'creeperDano', 'carneCura']
  );
  for (const x of r) {
    assert.equal(typeof x.value, 'number', `${x.name}: value numérico`);
    assert.deepEqual(x.target, [...TARGETS[x.name]], `${x.name}: target vem de targets.js`);
    assert.equal(typeof x.ok, 'boolean', `${x.name}: ok booleano`);
  }
});

test('cada métrica cai na faixa-alvo com 50 seeds fixas', () => {
  for (const x of rows()) {
    const [lo, hi] = TARGETS[x.name];
    assert.ok(x.ok, `${x.name}: média ${x.value} fora de [${lo}, ${hi}]`);
    assert.ok(x.value >= lo && x.value <= hi, `${x.name}: ${x.value} em [${lo}, ${hi}]`);
  }
});

test('determinismo: duas execuções produzem exatamente a mesma tabela', () => {
  assert.deepEqual(runAll({ seeds: SEEDS }), rows());
});

test('pureza: o módulo de cenários não chama Math.random (aleatoriedade só pelo rng semeado)', () => {
  const src = readFileSync(new URL('../src/balance/scenarios.js', import.meta.url), 'utf8');
  assert.equal(/Math\.random\s*\(/.test(src), false);
});
