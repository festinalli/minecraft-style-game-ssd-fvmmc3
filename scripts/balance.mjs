// Tabela de balanceamento por simulação (feature 019). Uso: `npm run balance`.
// Imprime as cinco métricas com a faixa-alvo de src/balance/targets.js e sai com código 1
// se alguma cair fora da faixa (o mesmo critério de tests/balance.test.js).

import { runAll } from '../src/balance/scenarios.js';
import { TARGETS } from '../src/balance/targets.js';

const SEEDS = 50;

const fmt = (v, unit) => (unit === '%' ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(2)} ${unit}`);
const cell = (s, w) => String(s).padEnd(w);

const rows = runAll({ seeds: SEEDS });

const W = { name: 16, value: 14, range: 22, target: 20 };
console.log(`Balanceamento por simulação: ${SEEDS} seeds fixas (1..${SEEDS}), média por cenário\n`);
console.log(
  `${cell('métrica', W.name)}${cell('média', W.value)}${cell('mín..máx', W.range)}${cell('faixa-alvo', W.target)}ok`
);
console.log('-'.repeat(W.name + W.value + W.range + W.target + 4));
for (const r of rows) {
  const [lo, hi] = TARGETS[r.name];
  console.log(
    `${cell(r.name, W.name)}${cell(fmt(r.value, r.unit), W.value)}` +
      `${cell(`${fmt(r.min, r.unit)}..${fmt(r.max, r.unit)}`, W.range)}` +
      `${cell(`[${fmt(lo, r.unit)}, ${fmt(hi, r.unit)}]`, W.target)}${r.ok ? 'ok' : 'FORA DA FAIXA'}`
  );
}

const fora = rows.filter((r) => !r.ok);
if (fora.length) {
  console.log(`\n${fora.length} métrica(s) fora da faixa: ${fora.map((r) => r.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nTodas as métricas dentro da faixa.');
}
