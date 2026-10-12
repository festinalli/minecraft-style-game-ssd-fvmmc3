import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAudio,
  SOUND_NAMES,
  SOUND_RECIPES,
  MASTER_VOLUME,
  MAX_VOICES,
  WAVES,
  FILTERS,
} from '../src/audio.js';

// ---------------------------------------------------------------------------
// AudioContext falso: registra nós, automação de parâmetros e estado.
// ---------------------------------------------------------------------------

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v, t) {
    this.calls.push({ op: 'set', v, t });
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.calls.push({ op: 'lin', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    assert.ok(v > 0, `rampa exponencial exige valor > 0 (recebeu ${v})`);
    this.calls.push({ op: 'exp', v, t });
    return this;
  }
  setTargetAtTime(v, t, tc) {
    this.calls.push({ op: 'target', v, t, tc });
    return this;
  }
  cancelScheduledValues(t) {
    this.calls.push({ op: 'cancel', t });
    return this;
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.outputs = [];
    this.disconnected = false;
  }
  connect(to) {
    this.outputs.push(to);
    return to;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  constructor(kind) {
    super(kind);
    this.starts = [];
    this.stops = [];
  }
  start(...args) {
    this.starts.push(args);
  }
  stop(...args) {
    this.stops.push(args);
  }
}

class FakeCtx {
  constructor({ autoRun = true } = {}) {
    this.state = 'suspended';
    this.autoRun = autoRun;
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = new FakeNode('destination');
    this.created = []; // { kind, node } na ordem de criação
    this.resumeCalls = 0;
  }
  resume() {
    this.resumeCalls++;
    if (this.autoRun) this.state = 'running';
    return Promise.resolve();
  }
  track(kind, node) {
    this.created.push({ kind, node });
    return node;
  }
  createGain() {
    const n = new FakeNode('gain');
    n.gain = new FakeParam(1);
    return this.track('gain', n);
  }
  createDynamicsCompressor() {
    const n = new FakeNode('compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0);
    return this.track('compressor', n);
  }
  createBiquadFilter() {
    const n = new FakeNode('filter');
    n.type = 'lowpass';
    n.frequency = new FakeParam(350);
    n.Q = new FakeParam(1);
    return this.track('filter', n);
  }
  createOscillator() {
    const n = new FakeSource('osc');
    n.type = 'sine';
    n.frequency = new FakeParam(440);
    return this.track('osc', n);
  }
  createBufferSource() {
    const n = new FakeSource('noise');
    n.buffer = null;
    return this.track('noise', n);
  }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    const buf = { channels, length, sampleRate: rate, data, getChannelData: () => data };
    return this.track('buffer', buf);
  }
  nodes(kind) {
    return this.created.filter((c) => c.kind === kind).map((c) => c.node);
  }
}

/** createAudio com fábrica falsa já "gestualizada" (resume feito). */
async function running(opts = {}) {
  const ctx = new FakeCtx(opts.ctx);
  let made = 0;
  const audio = createAudio({
    contextFactory: () => {
      made++;
      return ctx;
    },
    rng: opts.rng,
  });
  if (opts.resume !== false) await audio.resume();
  return { audio, ctx, made: () => made };
}

/** rng sem variação: range() = 0, então pitch = 1 e offset de ruído = 0. */
const NO_JITTER = { range: () => 0, next: () => 0.5 };

/** Nós criados por uma chamada de play(). */
function playAndCapture(audio, ctx, name, opts) {
  const before = ctx.created.length;
  const ok = audio.play(name, opts);
  return { ok, made: ctx.created.slice(before) };
}

// ---------------------------------------------------------------------------
// Receitas (dados puros)
// ---------------------------------------------------------------------------

test('SOUND_NAMES é exatamente a lista do brief e cada nome tem receita', () => {
  assert.deepEqual(
    [...SOUND_NAMES],
    ['hit', 'hurt', 'break', 'place', 'eat', 'pig', 'sheep', 'zombie', 'hiss', 'explode', 'death', 'step']
  );
  assert.equal(new Set(SOUND_NAMES).size, SOUND_NAMES.length, 'sem nomes repetidos');
  assert.deepEqual(Object.keys(SOUND_RECIPES).sort(), [...SOUND_NAMES].sort());
  assert.ok(Object.isFrozen(SOUND_NAMES) && Object.isFrozen(SOUND_RECIPES));
  assert.ok(Object.isFrozen(SOUND_RECIPES.explode.layers[0]), 'congelada em profundidade');
});

test('receitas: frequências, filtros, envelopes e durações são válidos', () => {
  for (const name of SOUND_NAMES) {
    const r = SOUND_RECIPES[name];
    assert.ok(r.vary > 0 && r.vary <= 0.2, `${name}: vary`);
    assert.ok(r.level > 0 && r.level <= 5, `${name}: level`);
    assert.ok(r.dur > 0 && r.dur <= 2, `${name}: duração total <= 2 s (${r.dur})`);
    assert.ok(r.layers.length >= 1, name);
    let longest = 0;
    for (const [i, l] of r.layers.entries()) {
      const where = `${name}[${i}]`;
      assert.ok(l.kind === 'osc' || l.kind === 'noise', where);
      assert.ok(l.dur > 0, `${where}: dur`);
      assert.ok(l.gain > 0 && l.gain <= 1, `${where}: gain`);
      assert.ok((l.delay ?? 0) >= 0, `${where}: delay`);
      longest = Math.max(longest, (l.delay ?? 0) + l.dur);

      const [a, d, s, rel] = l.env;
      assert.equal(l.env.length, 4, where);
      assert.ok(a >= 0 && d >= 0 && rel >= 0, `${where}: env >= 0`);
      assert.ok(s >= 0 && s <= 1, `${where}: sustentação em [0,1]`);
      assert.ok(a + d + rel <= l.dur + 1e-9, `${where}: o envelope cabe na duração`);

      if (l.kind === 'osc') {
        assert.ok(WAVES.includes(l.wave), `${where}: onda`);
        assert.equal(l.f.length, 2, where);
        assert.ok(l.f[0] > 0 && l.f[1] > 0, `${where}: f > 0 (rampa exponencial)`);
        if (l.vibrato) assert.ok(l.vibrato.rate > 0 && l.vibrato.depth >= 0, `${where}: vibrato`);
      }
      if (l.filter) {
        assert.ok(FILTERS.includes(l.filter.type), `${where}: tipo de filtro`);
        assert.ok(l.filter.f[0] > 0 && l.filter.f[1] > 0 && l.filter.q > 0, `${where}: filtro`);
      }
    }
    assert.ok(Math.abs(r.dur - longest) < 1e-9, `${name}: dur = fim da camada mais longa`);
  }
});

test('receitas seguem o brief: cada som tem o caráter pedido', () => {
  const layers = (n) => SOUND_RECIPES[n].layers;
  const osc = (n) => layers(n).filter((l) => l.kind === 'osc');
  const noise = (n) => layers(n).filter((l) => l.kind === 'noise');

  // pig: dente de serra curto com queda de pitch
  assert.ok(osc('pig').some((l) => l.wave === 'sawtooth' && l.f[1] < l.f[0]), 'pig cai de pitch');
  assert.ok(SOUND_RECIPES.pig.dur < 0.5);
  // sheep: onda quadrada vibrada
  assert.ok(osc('sheep').some((l) => l.wave === 'square' && l.vibrato), 'sheep: quadrada com vibrato');
  // zombie: resmungo grave + ruído
  assert.ok(osc('zombie').every((l) => l.f[0] <= 150), 'zombie é grave');
  assert.ok(noise('zombie').length >= 1);
  // hiss: ruído branco com filtro alto subindo
  assert.ok(osc('hiss').length === 0 && noise('hiss').length === 1);
  const hiss = noise('hiss')[0];
  assert.equal(hiss.filter.type, 'highpass');
  assert.ok(hiss.filter.f[1] > hiss.filter.f[0], 'o corte sobe');
  // explode: ruído low-pass com queda longa + sub-grave
  const boom = noise('explode').find((l) => l.filter.type === 'lowpass');
  assert.ok(boom && boom.filter.f[1] < boom.filter.f[0] && boom.dur >= 1, 'estrondo low-pass caindo');
  assert.ok(osc('explode').some((l) => l.f[0] <= 100 && l.f[1] < l.f[0]), 'sub-grave descendo');
  // death: tom descendente
  assert.ok(osc('death').some((l) => l.f[1] < l.f[0] / 2), 'death desce');
  // curtos e secos
  for (const n of ['hit', 'break', 'place', 'eat', 'step']) assert.ok(SOUND_RECIPES[n].dur <= 0.35, `${n} é curto`);
  // hurt: grave
  assert.ok(osc('hurt').some((l) => l.f[0] <= 300), 'hurt é grave');
  // explode é a mais longa e a mais forte
  const longest = Math.max(...SOUND_NAMES.map((n) => SOUND_RECIPES[n].dur));
  assert.equal(SOUND_RECIPES.explode.dur, longest);
});

// ---------------------------------------------------------------------------
// Sem AudioContext (Node): tudo é no-op
// ---------------------------------------------------------------------------

test('Node sem AudioContext: createAudio não lança e tudo é no-op', async () => {
  assert.equal(typeof globalThis.AudioContext, 'undefined', 'premissa: Node não tem AudioContext');
  const audio = createAudio();
  assert.equal(await audio.resume(), false);
  assert.equal(await audio.resume(), false, 'resume repetido também é seguro');
  for (const name of SOUND_NAMES) assert.equal(audio.play(name), false, name);
  assert.equal(audio.play('hit', { volume: 0.5, pitch: 2 }), false);
  audio.setMuted(true);
  audio.setMuted(false);
  assert.equal(audio.activeVoices(), 0);
});

test('fábrica que devolve null ou lança vira no-op e não é chamada de novo', async () => {
  for (const factory of [() => null, () => { throw new Error('sem áudio'); }]) {
    let calls = 0;
    const audio = createAudio({ contextFactory: () => { calls++; return factory(); } });
    assert.equal(await audio.resume(), false);
    assert.equal(await audio.resume(), false);
    assert.equal(audio.play('hit'), false);
    assert.equal(calls, 1, 'tenta criar o contexto uma única vez');
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida do contexto
// ---------------------------------------------------------------------------

test('o AudioContext só nasce no primeiro resume() e play antes disso é no-op', async () => {
  const ctx = new FakeCtx();
  let made = 0;
  const audio = createAudio({ contextFactory: () => { made++; return ctx; } });
  assert.equal(made, 0, 'criar o motor não cria o contexto');
  assert.equal(audio.play('hit'), false, 'sem gesto não toca');
  assert.equal(ctx.created.length, 0);
  assert.equal(await audio.resume(), true);
  assert.equal(made, 1);
  await audio.resume();
  await audio.resume();
  assert.equal(made, 1, 'resume repetido não recria o contexto');
  assert.equal(ctx.resumeCalls, 1, 'só retoma enquanto estiver suspenso');
  assert.equal(audio.play('hit'), true);
});

test('contexto que continua suspenso: resume() resolve false e play não enfileira', async () => {
  const { audio, ctx } = await running({ ctx: { autoRun: false } });
  assert.equal(ctx.state, 'suspended');
  assert.equal(await audio.resume(), false);
  const before = ctx.created.length;
  assert.equal(audio.play('explode'), false);
  assert.equal(ctx.created.length, before, 'nenhum nó criado (senão tocaria tudo de uma vez ao retomar)');
});

test('grafo: voz -> master (0,35) -> compressor -> destino; ruído branco criado uma vez', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const [master] = ctx.nodes('gain');
  const [comp] = ctx.nodes('compressor');
  assert.equal(master.gain.value, MASTER_VOLUME);
  assert.ok(MASTER_VOLUME > 0 && MASTER_VOLUME <= 0.4, 'volume mestre baixo');
  assert.deepEqual(master.outputs, [comp]);
  assert.deepEqual(comp.outputs, [ctx.destination]);
  assert.ok(comp.ratio.value > 1 && comp.threshold.value < 0, 'compressor configurado');

  const [noise] = ctx.nodes('buffer');
  assert.equal(noise.length, ctx.sampleRate * 2, 'ruído de 2 s');
  let min = 1;
  let max = -1;
  for (const v of noise.data) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min >= -1 && max <= 1 && min < -0.9 && max > 0.9, 'ruído branco em [-1, 1]');

  audio.play('explode');
  audio.play('hiss');
  assert.equal(ctx.nodes('buffer').length, 1, 'o buffer é reaproveitado por todas as vozes');
  for (const src of ctx.nodes('noise')) assert.equal(src.buffer, noise);
});

test('o ruído é o mesmo em toda sessão (semente fixa, sem Math.random)', async () => {
  const a = await running();
  const b = await running();
  assert.deepEqual(a.ctx.nodes('buffer')[0].data, b.ctx.nodes('buffer')[0].data);
});

// ---------------------------------------------------------------------------
// play(): validação de nome, volume, pitch
// ---------------------------------------------------------------------------

test('nomes desconhecidos são ignorados sem erro e sem criar nós', async () => {
  const { audio, ctx } = await running();
  const before = ctx.created.length;
  for (const bad of ['nope', '', 'HIT', 'hit ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 42, {}, [], () => 'hit']) {
    assert.equal(audio.play(bad), false, String(bad));
  }
  assert.equal(ctx.created.length, before);
  assert.equal(audio.activeVoices(), 0);
});

test('todos os 12 sons tocam, agendam em ordem e terminam dentro da duração da receita', async () => {
  for (const name of SOUND_NAMES) {
    const { audio, ctx } = await running({ rng: NO_JITTER });
    ctx.currentTime = 10;
    const rec = SOUND_RECIPES[name];
    const { ok, made } = playAndCapture(audio, ctx, name);
    assert.equal(ok, true, name);

    const sources = made.filter((c) => c.kind === 'osc' || c.kind === 'noise').map((c) => c.node);
    assert.ok(sources.length >= rec.layers.length, `${name}: uma fonte por camada (+LFOs)`);
    for (const s of sources) {
      assert.equal(s.starts.length, 1, `${name}: start uma vez`);
      assert.equal(s.stops.length, 1, `${name}: stop uma vez`);
      const start = s.starts[0][0];
      const stop = s.stops[0][0];
      assert.ok(start >= 10 && stop > start, `${name}: stop depois do start`);
      assert.ok(stop <= 10 + rec.dur + 0.05 + 1e-9, `${name}: nada passa do fim da voz`);
    }

    // automação de ganho: começa em 0, tempos não decrescem, termina em 0
    for (const g of made.filter((c) => c.kind === 'gain').map((c) => c.node)) {
      const calls = g.gain.calls;
      if (calls.length === 0) continue; // ganho da voz / LFO: só `.value`
      assert.equal(calls[0].op, 'set');
      assert.equal(calls[0].v, 0, `${name}: envelope parte do silêncio`);
      assert.equal(calls.at(-1).v, 0, `${name}: envelope termina em silêncio`);
      for (let i = 1; i < calls.length; i++) assert.ok(calls[i].t >= calls[i - 1].t, `${name}: eventos em ordem`);
    }

    assert.equal(audio.activeVoices(), 1);
    ctx.currentTime = 10 + rec.dur + 0.06;
    assert.equal(audio.activeVoices(), 0, `${name}: a voz some depois da duração`);
  }
});

test('oscilador: onda, rampa de frequência e vibrato vêm da receita', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const { made } = playAndCapture(audio, ctx, 'sheep');
  const oscs = made.filter((c) => c.kind === 'osc').map((c) => c.node);
  const main = oscs.filter((o) => o.type === 'square');
  assert.equal(main.length, 2, 'duas vozes quadradas');
  assert.deepEqual(
    main[0].frequency.calls.map((c) => [c.op, c.v]),
    [['set', 430], ['exp', 380]]
  );
  const lfos = oscs.filter((o) => o.type === 'sine');
  assert.equal(lfos.length, 2, 'um LFO por vibrato');
  assert.equal(lfos[0].frequency.value, 15);
  const depth = made.filter((c) => c.kind === 'gain').map((c) => c.node).find((g) => g.gain.value === 55);
  assert.ok(depth && depth.outputs[0] === main[0].frequency, 'LFO modula a frequência');
});

test('volume: limitado a [0,1], 0 não toca, inválido vira 1', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const level = SOUND_RECIPES.step.level;
  const voiceGain = (opts) => {
    const { ok, made } = playAndCapture(audio, ctx, 'step', opts);
    return ok ? made.find((c) => c.kind === 'gain').node.gain.value : null;
  };
  assert.equal(voiceGain(undefined), level);
  assert.equal(voiceGain({ volume: 1 }), level);
  assert.equal(voiceGain({ volume: 5 }), level, 'acima de 1 é cortado');
  assert.equal(voiceGain({ volume: Number.NaN }), level, 'NaN vira 1');
  assert.ok(Math.abs(voiceGain({ volume: 0.5 }) - level / 2) < 1e-12);
  assert.equal(voiceGain({ volume: 0 }), null, 'volume 0 nem agenda');
  assert.equal(voiceGain({ volume: -3 }), null, 'negativo vira 0');
});

test('pitch multiplica frequências de osciladores e de filtros; inválido vira 1', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const first = (pitch) => {
    const { made } = playAndCapture(audio, ctx, 'pig', pitch === undefined ? undefined : { pitch });
    const osc = made.find((c) => c.kind === 'osc').node;
    const filter = made.find((c) => c.kind === 'filter').node;
    return { f: osc.frequency.calls[0].v, cutoff: filter.frequency.calls[0].v };
  };
  const base = first(1);
  assert.equal(base.f, 300);
  const up = first(2);
  assert.equal(up.f, 600);
  assert.equal(up.cutoff, base.cutoff * 2);
  assert.equal(first(0.5).f, 150);
  for (const bad of [0, -1, Number.NaN, Infinity, 'alto', null]) {
    assert.equal(first(bad).f, 300, `pitch ${String(bad)} cai para 1`);
  }
});

test('variação de pitch por chamada: pequena, vem do rng semeado e é reprodutível', async () => {
  const sequence = async () => {
    const { audio, ctx } = await running(); // rng padrão (semeado)
    const out = [];
    for (let i = 0; i < 40; i++) {
      ctx.currentTime = i; // vozes anteriores já terminaram
      const { made } = playAndCapture(audio, ctx, 'step');
      out.push(made.find((c) => c.kind === 'osc').node.frequency.calls[0].v / 95);
    }
    return out;
  };
  const a = await sequence();
  const b = await sequence();
  assert.deepEqual(a, b, 'mesma semente => mesma sequência');
  const vary = SOUND_RECIPES.step.vary;
  for (const r of a) assert.ok(r >= 1 - vary - 1e-9 && r <= 1 + vary + 1e-9, `razão ${r} dentro de ±${vary}`);
  assert.ok(new Set(a.map((r) => r.toFixed(6))).size > 20, 'cada chamada varia de fato');
  assert.ok(Math.max(...a) - Math.min(...a) < 2 * vary + 1e-9);
});

test('nunca usa Math.random (constitution): nem para ruído nem para pitch', async () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random é proibido');
  };
  try {
    const { audio, ctx } = await running();
    for (const name of SOUND_NAMES) {
      ctx.currentTime += 3;
      assert.equal(audio.play(name), true);
    }
  } finally {
    Math.random = original;
  }
  const src = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/Math\.random|console\./.test(code), 'sem Math.random nem console.* no código');
});

test('noise: o trecho do buffer escolhido cabe inteiro dentro dos 2 s', async () => {
  // rng extremo: range(a, b) devolve sempre o maior valor possível.
  const { audio, ctx } = await running({ rng: { range: (a, b) => b, next: () => 0.99 } });
  for (const name of SOUND_NAMES) {
    ctx.currentTime += 3;
    const { made } = playAndCapture(audio, ctx, name);
    for (const src of made.filter((c) => c.kind === 'noise').map((c) => c.node)) {
      const [, offset] = src.starts[0];
      const dur = src.stops[0][0] - src.starts[0][0];
      assert.ok(offset >= 0 && offset + dur <= 2 + 1e-9, `${name}: offset ${offset} + ${dur} <= 2 s`);
    }
  }
});

// ---------------------------------------------------------------------------
// Mudo e polifonia
// ---------------------------------------------------------------------------

test('setMuted: silencia sem criar nós, vale antes e depois do contexto e é reversível', async () => {
  // mudo ANTES do primeiro resume
  const early = await running({ resume: false });
  early.audio.setMuted(true);
  await early.audio.resume();
  assert.equal(early.ctx.nodes('gain')[0].gain.value, 0, 'master nasce mudo');
  const before = early.ctx.created.length;
  assert.equal(early.audio.play('explode'), false);
  assert.equal(early.ctx.created.length, before, 'mudo não cria nós');
  early.audio.setMuted(false);
  assert.equal(early.ctx.nodes('gain')[0].gain.value, MASTER_VOLUME);
  assert.equal(early.audio.play('explode'), true);

  // mudo DEPOIS
  const late = await running();
  assert.equal(late.audio.play('hit'), true);
  late.audio.setMuted(true);
  assert.equal(late.ctx.nodes('gain')[0].gain.value, 0);
  assert.equal(late.audio.play('hit'), false);
  late.audio.setMuted(true); // idempotente
  late.audio.setMuted(0);
  assert.equal(late.ctx.nodes('gain')[0].gain.value, MASTER_VOLUME);
});

test('polifonia: no máximo 12 vozes; a mais antiga é cortada com fade, a recente toca', async () => {
  assert.equal(MAX_VOICES, 12);
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const stolen = [];
  for (let i = 0; i < 30; i++) {
    const { ok, made } = playAndCapture(audio, ctx, 'explode');
    assert.equal(ok, true, 'a chamada nova sempre toca');
    stolen.push(made);
    assert.ok(audio.activeVoices() <= MAX_VOICES, `vozes ativas ${audio.activeVoices()} <= 12`);
  }
  assert.equal(audio.activeVoices(), MAX_VOICES);
  const faded = ctx.nodes('gain').filter((g) => g.gain.calls.some((c) => c.op === 'target'));
  assert.equal(faded.length, 30 - MAX_VOICES, 'as 18 mais antigas receberam fade-out');
  // as 12 últimas continuam inteiras
  for (const made of stolen.slice(-MAX_VOICES)) {
    const out = made.find((c) => c.kind === 'gain').node;
    assert.ok(!out.gain.calls.some((c) => c.op === 'target'), 'voz recente não é cortada');
  }
  // o fade de quem foi cortado termina rápido e a fonte para logo
  const victim = stolen[0];
  const vSources = victim.filter((c) => c.kind === 'osc' || c.kind === 'noise').map((c) => c.node);
  for (const s of vSources) assert.ok(s.stops.at(-1)[0] <= 0.06 + 1e-9, 'stop(now + 0,06)');
});

test('polifonia: a voz mais curta (que acaba antes) é a cortada, não a explosão longa', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const boom = playAndCapture(audio, ctx, 'explode');
  ctx.currentTime = 0.05;
  for (let i = 0; i < MAX_VOICES - 1; i++) audio.play('step'); // 1 + 11 = 12 vozes
  assert.equal(audio.activeVoices(), MAX_VOICES);
  const { ok } = playAndCapture(audio, ctx, 'hit'); // 13ª: estoura o teto
  assert.equal(ok, true);
  const boomOut = boom.made.find((c) => c.kind === 'gain').node;
  assert.ok(!boomOut.gain.calls.some((c) => c.op === 'target'), 'a explosão (fim mais distante) sobrevive');
  const steps = ctx.nodes('gain').filter((g) => g.gain.calls.some((c) => c.op === 'target'));
  assert.equal(steps.length, 1, 'exatamente uma voz foi cortada');
});

test('vozes terminadas liberam vaga e têm o nó de saída desconectado', async () => {
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const first = playAndCapture(audio, ctx, 'hit');
  assert.equal(audio.activeVoices(), 1);
  ctx.currentTime = 1; // hit já acabou
  assert.equal(audio.activeVoices(), 0);
  playAndCapture(audio, ctx, 'place'); // play() limpa as vozes vencidas
  const firstOut = first.made.find((c) => c.kind === 'gain').node;
  assert.equal(firstOut.disconnected, true, 'saída da voz vencida foi desconectada');
  assert.equal(audio.activeVoices(), 1);
});

test('integração: play no meio de uma rajada nunca lança, mesmo com contexto hostil', async () => {
  // contexto cujo stop()/disconnect() lançam (já parados): o motor tem que engolir.
  const { audio, ctx } = await running({ rng: NO_JITTER });
  const orig = ctx.createOscillator.bind(ctx);
  ctx.createOscillator = () => {
    const n = orig();
    n.stop = (...a) => {
      n.stops.push(a);
      if (a[0] <= 0.1) throw new Error('InvalidStateError');
    };
    return n;
  };
  for (let i = 0; i < 40; i++) {
    assert.doesNotThrow(() => audio.play(i % 2 ? 'death' : 'zombie'));
  }
});
