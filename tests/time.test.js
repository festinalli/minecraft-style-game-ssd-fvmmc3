// Testes headless da feature 009 (dia e noite) — src/game/time.js é PURO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_LENGTH,
  START_SECONDS,
  SKY_COLORS,
  LIGHT,
  ORBIT_AXIS,
  phaseOf,
  dayNumber,
  isNight,
  phaseName,
  skyState,
  createSkyState,
} from '../src/game/time.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b}, veio ${a}`);
const at = (phase) => phase * DAY_LENGTH; // segundos do dia 1 na fase `phase`
const hex = (c) =>
  (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
const len = (v) => Math.hypot(v.x, v.y, v.z);
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test('constantes: dia de 360 s, jogo começa de manhã (fase 0.05)', () => {
  assert.equal(DAY_LENGTH, 360);
  near(START_SECONDS, 0.05 * 360, 1e-12);
  near(phaseOf(START_SECONDS), 0.05, 1e-12);
  assert.equal(isNight(START_SECONDS), false);
  assert.equal(phaseName(START_SECONDS), 'Dia');
});

test('phaseOf: [0,1), pontos cardeais do dia, periódica e válida para tempo negativo', () => {
  assert.equal(phaseOf(0), 0);
  near(phaseOf(at(0.25)), 0.25, 1e-12);
  near(phaseOf(at(0.5)), 0.5, 1e-12);
  near(phaseOf(at(0.75)), 0.75, 1e-12);
  assert.equal(phaseOf(DAY_LENGTH), 0);
  near(phaseOf(DAY_LENGTH + 90), 0.25, 1e-12);
  near(phaseOf(10 * DAY_LENGTH + 270), 0.75, 1e-9);
  near(phaseOf(-90), 0.75, 1e-12); // 90 s antes do amanhecer = fase 0.75
  for (const s of [-1e-20, -1e-12, -DAY_LENGTH, -0.0001, 0.0001, DAY_LENGTH - 1e-9, 1e9, -1e9]) {
    const p = phaseOf(s);
    assert.ok(p >= 0 && p < 1, `phaseOf(${s}) = ${p}`);
  }
});

test('dayNumber: começa em 1 e vira exatamente a cada DAY_LENGTH', () => {
  assert.equal(dayNumber(0), 1);
  assert.equal(dayNumber(START_SECONDS), 1);
  assert.equal(dayNumber(DAY_LENGTH - 0.001), 1);
  assert.equal(dayNumber(DAY_LENGTH), 2);
  assert.equal(dayNumber(DAY_LENGTH + 0.001), 2);
  assert.equal(dayNumber(2 * DAY_LENGTH - 0.001), 2);
  assert.equal(dayNumber(2 * DAY_LENGTH), 3);
  assert.equal(dayNumber(10 * DAY_LENGTH + 5), 11);
  assert.equal(dayNumber(-50), 1, 'tempo negativo não gera dia 0');
  // vira junto com a fase 0 (amanhecer)
  let prev = dayNumber(0);
  let flips = 0;
  for (let s = 0.5; s < 5 * DAY_LENGTH; s += 0.5) {
    const d = dayNumber(s);
    if (d !== prev) {
      flips++;
      near(phaseOf(s), 0, 0.5 / DAY_LENGTH, 'o dia deve virar no amanhecer');
      prev = d;
    }
  }
  assert.equal(flips, 4);
});

test('isNight === (nightFactor >= 0.5) em toda amostra; nightFactor/starAlpha em [0,1]; starAlpha ≈ nightFactor²', () => {
  let nights = 0;
  let total = 0;
  for (let s = -DAY_LENGTH; s < 3 * DAY_LENGTH; s += 0.25) {
    const k = skyState(s);
    assert.equal(isNight(s), k.nightFactor >= 0.5, `s=${s}`);
    assert.ok(k.nightFactor >= 0 && k.nightFactor <= 1);
    assert.ok(k.starAlpha >= 0 && k.starAlpha <= 1);
    near(k.starAlpha, k.nightFactor * k.nightFactor, 1e-12);
    total++;
    if (isNight(s)) nights++;
  }
  const frac = nights / total;
  assert.ok(frac > 0.4 && frac < 0.55, 'fração de noite do ciclo: ' + frac);
});

test('isNight: duas viradas por dia (anoitecer e amanhecer), nesta ordem', () => {
  const flips = [];
  let prev = isNight(0);
  for (let s = 0.25; s <= DAY_LENGTH; s += 0.25) {
    const n = isNight(s);
    if (n !== prev) flips.push({ s, to: n });
    prev = n;
  }
  assert.equal(flips.length, 2);
  assert.equal(flips[0].to, true); // anoitece
  assert.equal(flips[1].to, false); // amanhece
  // anoitece pouco depois do pôr do sol (fase 0.5) e amanhece pouco antes do nascer (fase 1.0)
  assert.ok(phaseOf(flips[0].s) > 0.5 && phaseOf(flips[0].s) < 0.55);
  assert.ok(phaseOf(flips[1].s) > 0.95 && phaseOf(flips[1].s) < 1);
});

test('instantes-chave: meio-dia = visual da Parte 1; meia-noite = noite jogável', () => {
  const noon = skyState(at(0.25));
  assert.equal(noon.nightFactor, 0);
  assert.equal(noon.starAlpha, 0);
  assert.equal(hex(noon.skyColor), 0x87b7e8);
  assert.equal(hex(noon.skyColor), SKY_COLORS.day);
  near(noon.sunIntensity, 1.6, 1e-9);
  near(noon.hemiIntensity, 0.7, 1e-9);
  near(noon.ambientIntensity, 0.25, 1e-9);
  assert.equal(noon.moonIntensity, 0);

  const midnight = skyState(at(0.75));
  assert.equal(midnight.nightFactor, 1);
  assert.equal(midnight.starAlpha, 1);
  assert.equal(hex(midnight.skyColor), 0x0a0f24);
  assert.equal(midnight.sunIntensity, 0);
  near(midnight.hemiIntensity, 0.22, 1e-9);
  near(midnight.ambientIntensity, 0.14, 1e-9);
  assert.ok(midnight.moonIntensity > 0.2 && midnight.moonIntensity <= LIGHT.moon);
  assert.ok(midnight.skyColor.b > midnight.skyColor.r, 'noite azulada');

  // o início do jogo reproduz exatamente o céu e as luzes da Parte 1
  const start = skyState(START_SECONDS);
  assert.equal(hex(start.skyColor), 0x87b7e8);
  near(start.sunIntensity, 1.6, 1e-9);
  near(start.hemiIntensity, 0.7, 1e-9);
  near(start.ambientIntensity, 0.25, 1e-9);
});

test('noite jogável: luz de preenchimento nunca zera e o céu nunca é preto', () => {
  let minHemi = Infinity;
  let minAmb = Infinity;
  let minLum = Infinity;
  for (let s = 0; s < 2 * DAY_LENGTH; s += 0.5) {
    const k = skyState(s);
    minHemi = Math.min(minHemi, k.hemiIntensity);
    minAmb = Math.min(minAmb, k.ambientIntensity);
    minLum = Math.min(minLum, lum(k.skyColor));
    // há SEMPRE alguma luz direcional (sol de dia, lua à noite), exceto no instante do cruzamento
  }
  near(minHemi, 0.22, 1e-9);
  near(minAmb, 0.14, 1e-9);
  assert.ok(minLum > 0.03, 'céu da noite quase preto: ' + minLum);
  assert.ok(minLum < lum(skyState(at(0.25)).skyColor) / 3, 'a noite deve ser bem mais escura que o dia');
});

test('crepúsculo: nascer e pôr do sol têm céu quente (vermelho > azul), diferente de dia e noite', () => {
  const dawn = skyState(at(0)).skyColor;
  const dusk = skyState(at(0.5)).skyColor;
  const day = skyState(at(0.25)).skyColor;
  const night = skyState(at(0.75)).skyColor;
  for (const c of [dawn, dusk]) {
    assert.ok(c.r > c.b + 0.1, 'crepúsculo deveria ser quente');
    assert.ok(c.r > day.r, 'mais vermelho que o dia');
    assert.ok(c.r > night.r + 0.3);
  }
  // ao pôr do sol é mais laranja (menos azul/mais saturado); ao amanhecer, mais rosado (mais azul)
  assert.ok(dawn.b > dusk.b, 'amanhecer mais rosado que o entardecer');
  assert.ok(dusk.r > dusk.g && dusk.g > dusk.b, 'entardecer laranja: r > g > b');
  // o tom quente aparece e some suavemente: pico no horizonte, nulo a pleno dia
  const tw = (s) => skyState(s).twilight;
  assert.equal(tw(at(0.25)), 0);
  assert.equal(tw(at(0.75)), 0);
  assert.ok(tw(at(0)) > 0.95 && tw(at(0.5)) > 0.95);
});

test('neblina acompanha a cor do céu', () => {
  for (let s = 0; s < DAY_LENGTH; s += 1) {
    const k = skyState(s);
    assert.deepEqual(k.fogColor, k.skyColor);
    assert.notEqual(k.fogColor, k.skyColor, 'objetos distintos (mexer em um não pode mexer no outro)');
  }
});

test('continuidade: nenhuma grandeza salta entre amostras de 0.5 s (2 dias)', () => {
  // limites ~1.5x acima do pior passo real; um degrau de verdade (>= 0.1) seria pego
  const LIM = { color: 0.05, sun: 0.1, moon: 0.045, hemi: 0.02, ambient: 0.01, nf: 0.05, star: 0.06, dir: 0.0105, tw: 0.06 };
  let prev = skyState(0);
  const maxSeen = Object.fromEntries(Object.keys(LIM).map((k) => [k, 0]));
  for (let s = 0.5; s <= 2 * DAY_LENGTH; s += 0.5) {
    const k = skyState(s);
    const d = {
      color: Math.max(
        Math.abs(k.skyColor.r - prev.skyColor.r),
        Math.abs(k.skyColor.g - prev.skyColor.g),
        Math.abs(k.skyColor.b - prev.skyColor.b)
      ),
      sun: Math.abs(k.sunIntensity - prev.sunIntensity),
      moon: Math.abs(k.moonIntensity - prev.moonIntensity),
      hemi: Math.abs(k.hemiIntensity - prev.hemiIntensity),
      ambient: Math.abs(k.ambientIntensity - prev.ambientIntensity),
      nf: Math.abs(k.nightFactor - prev.nightFactor),
      star: Math.abs(k.starAlpha - prev.starAlpha),
      dir: Math.hypot(k.sunDir.x - prev.sunDir.x, k.sunDir.y - prev.sunDir.y, k.sunDir.z - prev.sunDir.z),
      tw: Math.abs(k.twilight - prev.twilight),
    };
    for (const key of Object.keys(LIM)) {
      maxSeen[key] = Math.max(maxSeen[key], d[key]);
      assert.ok(d[key] <= LIM[key], `salto em ${key} (${d[key]}) em t=${s}`);
    }
    prev = k;
  }
  // sanidade: o teste enxerga as transições (não está medindo algo constante)
  assert.ok(maxSeen.color > 0.01 && maxSeen.sun > 0.03);
});

test('continuidade na virada do dia (fase 1 -> 0) e periodicidade', () => {
  for (const base of [0, DAY_LENGTH, 7 * DAY_LENGTH]) {
    const a = skyState(base - 0.001);
    const b = skyState(base + 0.001);
    near(a.skyColor.r, b.skyColor.r, 1e-3);
    near(a.sunIntensity, b.sunIntensity, 1e-3);
    near(a.nightFactor, b.nightFactor, 1e-3);
  }
  for (const s of [0, 17.3, 90, 181.7, 270, 359.9]) {
    const a = skyState(s);
    for (const k of [1, 2, 9]) {
      const b = skyState(s + k * DAY_LENGTH);
      near(a.skyColor.r, b.skyColor.r, 1e-9);
      near(a.skyColor.g, b.skyColor.g, 1e-9);
      near(a.skyColor.b, b.skyColor.b, 1e-9);
      near(a.sunIntensity, b.sunIntensity, 1e-9);
      near(a.nightFactor, b.nightFactor, 1e-9);
      near(a.sunDir.x, b.sunDir.x, 1e-9);
      near(a.sunDir.y, b.sunDir.y, 1e-9);
    }
  }
});

test('sol e lua: vetores unitários, sol nasce em +X e se põe em -X, lua oposta, leve inclinação em Z', () => {
  for (let s = 0; s < DAY_LENGTH; s += 1.5) {
    const k = skyState(s);
    near(len(k.sunDir), 1, 1e-12, 'sol unitário');
    near(len(k.moonDir), 1, 1e-12, 'lua unitária');
    near(k.sunDir.x + k.moonDir.x, 0, 1e-12);
    near(k.sunDir.y + k.moonDir.y, 0, 1e-12);
    near(k.sunDir.z + k.moonDir.z, 0, 1e-12);
  }
  const sunrise = skyState(at(0)).sunDir;
  near(sunrise.x, 1, 1e-12);
  near(sunrise.y, 0, 1e-12);
  const sunset = skyState(at(0.5)).sunDir;
  near(sunset.x, -1, 1e-12);
  near(sunset.y, 0, 1e-9);
  const noon = skyState(at(0.25)).sunDir;
  assert.ok(noon.y > 0.9, 'sol alto ao meio-dia');
  assert.ok(noon.z > 0.1 && noon.z < 0.5, 'leve inclinação em Z: ' + noon.z);
  near(noon.x, 0, 1e-9);
  const midnight = skyState(at(0.75));
  assert.ok(midnight.sunDir.y < -0.9, 'sol sob o chão à meia-noite');
  assert.ok(midnight.moonDir.y > 0.9, 'lua alta à meia-noite');
  // sol acima do horizonte durante o dia, abaixo durante a noite profunda
  assert.ok(skyState(at(0.1)).sunDir.y > 0 && skyState(at(0.4)).sunDir.y > 0);
  assert.ok(skyState(at(0.6)).sunDir.y < 0 && skyState(at(0.9)).sunDir.y < 0);
  // eixo da órbita unitário e perpendicular ao arco
  near(len(ORBIT_AXIS), 1, 1e-12);
  const d = ORBIT_AXIS.x * noon.x + ORBIT_AXIS.y * noon.y + ORBIT_AXIS.z * noon.z;
  near(d, 0, 1e-9, 'eixo perpendicular à posição do sol');
});

test('luzes: o sol só ilumina acima do horizonte; a lua só abaixo; nunca os dois', () => {
  for (let s = 0; s < DAY_LENGTH; s += 0.5) {
    const k = skyState(s);
    if (k.sunDir.y <= 0) assert.equal(k.sunIntensity, 0, `sol abaixo do horizonte em t=${s}`);
    if (k.moonDir.y <= 0) assert.equal(k.moonIntensity, 0, `lua abaixo do horizonte em t=${s}`);
    assert.ok(k.sunIntensity === 0 || k.moonIntensity === 0);
    assert.ok(k.sunIntensity >= 0 && k.sunIntensity <= LIGHT.day.sun + 1e-12);
    assert.ok(k.moonIntensity >= 0 && k.moonIntensity <= LIGHT.moon + 1e-12);
    assert.ok(k.hemiIntensity >= LIGHT.night.hemi - 1e-12 && k.hemiIntensity <= LIGHT.day.hemi + 1e-12);
    assert.ok(k.ambientIntensity >= LIGHT.night.ambient - 1e-12 && k.ambientIntensity <= LIGHT.day.ambient + 1e-12);
    for (const c of ['r', 'g', 'b']) assert.ok(k.skyColor[c] >= 0 && k.skyColor[c] <= 1);
  }
  // o sol sobe e desce monotonicamente de intensidade (manhã sobe, tarde desce)
  let p = skyState(at(0)).sunIntensity;
  for (let s = at(0); s <= at(0.25); s += 0.5) {
    const v = skyState(s).sunIntensity;
    assert.ok(v >= p - 1e-12);
    p = v;
  }
  for (let s = at(0.25); s <= at(0.5); s += 0.5) {
    const v = skyState(s).sunIntensity;
    assert.ok(v <= p + 1e-12);
    p = v;
  }
});

test('phaseName: Dia -> Entardecer -> Noite -> Amanhecer -> Dia, cada rótulo contíguo', () => {
  const seq = [];
  for (let s = START_SECONDS; s <= START_SECONDS + DAY_LENGTH; s += 0.5) {
    const n = phaseName(s);
    if (seq[seq.length - 1] !== n) seq.push(n);
  }
  assert.deepEqual(seq, ['Dia', 'Entardecer', 'Noite', 'Amanhecer', 'Dia']);
  assert.equal(phaseName(at(0.25)), 'Dia');
  assert.equal(phaseName(at(0.5)), 'Entardecer');
  assert.equal(phaseName(at(0.75)), 'Noite');
  assert.equal(phaseName(at(0)), 'Amanhecer');
  // coerente com isNight
  for (let s = 0; s < DAY_LENGTH; s += 0.5) assert.equal(phaseName(s) === 'Noite', isNight(s));
});

test('skyState: `out` reaproveita o objeto (sem alocar) e dá o mesmo resultado; sem `out` devolve novo', () => {
  const out = createSkyState();
  const r = skyState(123.4, out);
  assert.equal(r, out);
  assert.deepEqual(out, skyState(123.4));
  const a = skyState(10);
  const b = skyState(10);
  assert.notEqual(a, b);
  assert.notEqual(a.skyColor, b.skyColor);
  assert.deepEqual(a, b);
  // reuso não vaza estado de uma chamada para a outra
  skyState(at(0.75), out);
  skyState(at(0.25), out);
  assert.deepEqual(out, skyState(at(0.25)));
  // formato do contrato
  for (const key of [
    'skyColor', 'fogColor', 'sunDir', 'moonDir', 'sunIntensity', 'hemiIntensity',
    'ambientIntensity', 'nightFactor', 'starAlpha',
  ]) {
    assert.ok(key in a, 'faltou ' + key);
  }
});

test('pureza e robustez: sem Math.random(); NaN/Infinity não envenenam o céu', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random() proibido');
  };
  try {
    for (let s = 0; s < DAY_LENGTH; s += 7) {
      skyState(s);
      isNight(s);
      phaseName(s);
      dayNumber(s);
    }
  } finally {
    Math.random = original;
  }
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    const k = skyState(bad);
    for (const c of ['r', 'g', 'b']) assert.ok(Number.isFinite(k.skyColor[c]), `cor não finita para ${bad}`);
    assert.ok(Number.isFinite(k.sunIntensity));
    assert.equal(phaseOf(bad), phaseOf(START_SECONDS));
    assert.equal(dayNumber(bad), 1);
  }
  // determinismo: mesma entrada => mesma saída
  assert.deepEqual(skyState(77.7), skyState(77.7));
});
