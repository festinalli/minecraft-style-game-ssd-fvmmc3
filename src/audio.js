// Áudio procedural (feature 015): 12 sons sintetizados com WebAudio —
// osciladores + ruído filtrado + envelopes ADSR curtos. Sem arquivos de áudio.
// Ver ADR 0013.
//
// Duas camadas:
//  - RECEITAS (`SOUND_RECIPES`): dados puros e congelados, validáveis no Node.
//  - MOTOR (`createAudio`): cria o AudioContext só no primeiro `resume()` (o
//    navegador exige gesto do usuário) e agenda os nós de cada voz. Sem
//    AudioContext (Node, navegador antigo) tudo vira no-op, sem erro.
//
// Aleatoriedade: a variação de pitch por chamada e o buffer de ruído vêm de
// `makeRng` (src/rng.js) — nunca `Math.random()` (constitution).

import { makeRng } from './rng.js';

/** Nomes aceitos por `play` (brief §4.7). */
export const SOUND_NAMES = Object.freeze([
  'hit',
  'hurt',
  'break',
  'place',
  'eat',
  'pig',
  'sheep',
  'zombie',
  'hiss',
  'explode',
  'death',
  'step',
]);

/** Volume mestre (baixo, para não assustar) e teto de vozes simultâneas. */
export const MASTER_VOLUME = 0.35;
export const MAX_VOICES = 12;

const NOISE_SECONDS = 2; // buffer de ruído branco reaproveitado por todas as vozes
const NOISE_SEED = 0x5eed; // semente fixa: o ruído é o mesmo em toda sessão
const JITTER_SEED = 0xa0d10; // semente da variação de pitch (quando não há rng injetado)
const TAIL = 0.05; // folga (s) entre o fim lógico da voz e o `stop()` dos nós

export const WAVES = Object.freeze(['sine', 'square', 'sawtooth', 'triangle']);
export const FILTERS = Object.freeze(['lowpass', 'highpass', 'bandpass']);

// ---------------------------------------------------------------------------
// Receitas
// ---------------------------------------------------------------------------
//
// Camada (layer):
//   kind    'osc' | 'noise'
//   wave    onda do oscilador (só 'osc')
//   f       [início, fim] em Hz — rampa exponencial (só 'osc')
//   filter  { type, f: [início, fim], q } — varredura de filtro (opcional)
//   vibrato { rate, depth } — LFO em Hz que modula a frequência (só 'osc')
//   delay   atraso em s a partir do início da voz (padrão 0)
//   dur     duração da camada em s
//   gain    pico (antes do volume mestre)
//   env     [ataque, decaimento, sustentação 0..1, soltura] em s; a soma
//           ataque + decaimento + soltura cabe em `dur`

const osc = (wave, f, dur, gain, env, extra = {}) => ({ kind: 'osc', wave, f, dur, gain, env, ...extra });
const noise = (filter, dur, gain, env, extra = {}) => ({ kind: 'noise', filter, dur, gain, env, ...extra });
const band = (type, f0, f1, q = 1) => ({ type, f: [f0, f1], q });

function recipe(vary, layers, level = 1) {
  let dur = 0;
  for (const l of layers) dur = Math.max(dur, (l.delay ?? 0) + l.dur);
  return { vary, dur, level, layers };
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

/**
 * `vary` = variação máxima de pitch por chamada (±fração); `dur` = duração total
 * (s), calculada das camadas; `level` = ganho de mixagem da voz, para os sons
 * soarem com volume parecido (os percussivos de ruído filtrado saem baixos).
 */
export const SOUND_RECIPES = deepFreeze({
  // golpe seco: estalo curto de ruído + "tum" grave
  hit: recipe(0.08, [
    noise(band('bandpass', 2200, 700, 1.2), 0.09, 0.55, [0.002, 0.03, 0.35, 0.05]),
    osc('triangle', [190, 70], 0.09, 0.6, [0.002, 0.03, 0.4, 0.04]),
  ], 3.4),
  // grunhido grave de dor
  hurt: recipe(0.06, [
    osc('sawtooth', [240, 120], 0.3, 0.5, [0.01, 0.06, 0.7, 0.12], {
      filter: band('lowpass', 1400, 350, 1.5),
      vibrato: { rate: 24, depth: 14 },
    }),
    noise(band('lowpass', 900, 300), 0.22, 0.3, [0.005, 0.05, 0.5, 0.1]),
  ], 1.5),
  // estalo de bloco quebrando: lasca aguda + miolo + tick de onda quadrada
  break: recipe(0.08, [
    noise(band('bandpass', 3000, 900, 0.8), 0.22, 0.55, [0.001, 0.04, 0.3, 0.12]),
    noise(band('lowpass', 1200, 500), 0.12, 0.4, [0.002, 0.03, 0.4, 0.06], { delay: 0.03 }),
    osc('square', [320, 90], 0.07, 0.18, [0.001, 0.02, 0.3, 0.03]),
  ], 3.8),
  // toque surdo de bloco colocado
  place: recipe(0.06, [
    osc('sine', [150, 78], 0.12, 0.7, [0.002, 0.04, 0.35, 0.06]),
    noise(band('lowpass', 700, 300), 0.07, 0.3, [0.001, 0.02, 0.4, 0.03]),
  ], 2.5),
  // mordida estalada: três "crocs" seguidos
  eat: recipe(0.08, [
    noise(band('bandpass', 2600, 1400, 2), 0.06, 0.5, [0.001, 0.02, 0.3, 0.03]),
    noise(band('bandpass', 2300, 1300, 2), 0.06, 0.45, [0.001, 0.02, 0.3, 0.03], { delay: 0.11 }),
    noise(band('bandpass', 2000, 1100, 2), 0.06, 0.4, [0.001, 0.02, 0.3, 0.03], { delay: 0.22 }),
  ], 2.4),
  // oink: "oi" que sobe + "nk" que cai, dentes de serra curtos
  pig: recipe(0.07, [
    osc('sawtooth', [300, 520], 0.09, 0.45, [0.01, 0.02, 0.8, 0.03], {
      filter: band('lowpass', 1800, 2400, 1),
      vibrato: { rate: 30, depth: 25 },
    }),
    osc('sawtooth', [520, 170], 0.24, 0.5, [0.005, 0.05, 0.7, 0.1], {
      delay: 0.09,
      filter: band('lowpass', 2000, 600, 2),
      vibrato: { rate: 26, depth: 20 },
    }),
    noise(band('bandpass', 900, 600), 0.2, 0.15, [0.01, 0.05, 0.5, 0.08], { delay: 0.09 }),
  ], 1.2),
  // bééé: quadrada vibrada, nasal, com uma segunda voz levemente desafinada
  sheep: recipe(0.05, [
    osc('square', [430, 380], 0.55, 0.3, [0.03, 0.08, 0.8, 0.15], {
      filter: band('bandpass', 1100, 900, 3),
      vibrato: { rate: 15, depth: 55 },
    }),
    osc('square', [440, 392], 0.55, 0.2, [0.03, 0.08, 0.8, 0.15], {
      filter: band('bandpass', 1100, 900, 3),
      vibrato: { rate: 13, depth: 60 },
    }),
  ], 2.6),
  // resmungo grave com ruído
  zombie: recipe(0.05, [
    osc('sawtooth', [100, 68], 0.7, 0.55, [0.05, 0.12, 0.7, 0.25], {
      filter: band('lowpass', 650, 300, 2),
      vibrato: { rate: 6, depth: 9 },
    }),
    noise(band('bandpass', 500, 260, 2), 0.6, 0.35, [0.08, 0.1, 0.6, 0.2]),
  ], 1.05),
  // chiado do creeper: ruído branco com passa-altas subindo
  hiss: recipe(0.04, [noise(band('highpass', 1800, 6500, 0.7), 1.2, 0.5, [0.06, 0.1, 0.9, 0.2])], 0.75),
  // estrondo: estalo agudo, ruído low-pass com queda longa e sub-grave
  explode: recipe(0.03, [
    noise(band('lowpass', 2400, 110, 0.8), 1.4, 1.0, [0.004, 0.25, 0.45, 0.7]),
    osc('sine', [95, 26], 1.2, 0.9, [0.005, 0.2, 0.5, 0.6]),
    noise(band('highpass', 1800, 900), 0.14, 0.5, [0.001, 0.04, 0.2, 0.08]),
  ], 1.2),
  // tom descendente
  death: recipe(0.04, [
    osc('triangle', [440, 80], 0.9, 0.55, [0.01, 0.15, 0.7, 0.3]),
    osc('sawtooth', [220, 40], 0.9, 0.25, [0.01, 0.15, 0.6, 0.3], { filter: band('lowpass', 1200, 200, 1) }),
  ], 1.3),
  // passo curto (variação maior: cada passo soa um pouco diferente)
  step: recipe(0.15, [
    noise(band('lowpass', 520, 240, 0.7), 0.08, 0.5, [0.002, 0.02, 0.3, 0.04]),
    osc('sine', [95, 55], 0.06, 0.3, [0.001, 0.02, 0.3, 0.03]),
  ], 3.6),
});

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

function defaultContextFactory() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} [opts]  só para testes
 * @param {() => object|null} [opts.contextFactory]  cria o AudioContext (padrão: o do navegador)
 * @param {{range:(a:number,b:number)=>number}} [opts.rng]  variação de pitch e posição no ruído
 */
export function createAudio({ contextFactory = defaultContextFactory, rng = makeRng(JITTER_SEED) } = {}) {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let unsupported = false;
  let muted = false;
  /** vozes ativas: { end (s do contexto), out (GainNode), sources } */
  let voices = [];

  function build() {
    let made;
    try {
      made = contextFactory();
    } catch {
      made = null;
    }
    if (!made) {
      unsupported = true;
      return;
    }
    ctx = made;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    // Compressor leve: só segura os picos quando muitas vozes somam (não achata o volume).
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);

    const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    const white = makeRng(NOISE_SEED);
    for (let i = 0; i < len; i++) data[i] = white.next() * 2 - 1;
  }

  /**
   * Cria (na 1ª chamada) e retoma o AudioContext. Chame dentro de um gesto do
   * usuário (clique em "Sobrevivência"/"Criativo"). Resolve `true` se o áudio
   * está rodando.
   * @returns {Promise<boolean>}
   */
  async function resume() {
    try {
      if (!ctx && !unsupported) build();
      if (!ctx) return false;
      if (ctx.state === 'suspended') await ctx.resume();
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  function setMuted(flag) {
    muted = !!flag;
    if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  }

  /** Voz que já acabou: só solta o nó de saída. */
  function disconnectVoice(v) {
    try {
      v.out.disconnect();
    } catch {
      /* já desconectada */
    }
  }

  /** Voz ainda soando, cortada por falta de polifonia: fade curto para não estalar. */
  function stealVoice(v, now) {
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, 0.01);
    } catch {
      /* sem automação: o stop() abaixo já resolve */
    }
    for (const s of v.sources) {
      try {
        s.stop(now + 0.06);
      } catch {
        /* já tinha parado */
      }
    }
  }

  /** Descarta vozes que já acabaram; se ainda houver `MAX_VOICES`, corta a mais antiga. */
  function reserveVoice(now) {
    let kept = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.end > now) voices[kept++] = v;
      else disconnectVoice(v);
    }
    voices.length = kept;
    if (voices.length >= MAX_VOICES) {
      let oldest = 0;
      for (let i = 1; i < voices.length; i++) if (voices[i].end < voices[oldest].end) oldest = i;
      stealVoice(voices[oldest], now);
      voices.splice(oldest, 1);
    }
  }

  function envelope(param, t0, peak, [a, d, s, r], dur) {
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(peak, t0 + a);
    param.linearRampToValueAtTime(peak * s, t0 + a + d);
    param.setValueAtTime(peak * s, t0 + dur - r);
    param.linearRampToValueAtTime(0, t0 + dur);
  }

  function sweep(param, [from, to], t0, dur, pitch) {
    param.setValueAtTime(from * pitch, t0);
    if (to !== from) param.exponentialRampToValueAtTime(to * pitch, t0 + dur);
  }

  function addLayer(layer, t0, pitch, out, sources) {
    const start = t0 + (layer.delay ?? 0);
    const stop = start + layer.dur + TAIL;
    let src;
    if (layer.kind === 'osc') {
      src = ctx.createOscillator();
      src.type = layer.wave;
      sweep(src.frequency, layer.f, start, layer.dur, pitch);
      if (layer.vibrato) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = layer.vibrato.rate;
        depth.gain.value = layer.vibrato.depth * pitch;
        lfo.connect(depth);
        depth.connect(src.frequency);
        lfo.start(start);
        lfo.stop(stop);
        sources.push(lfo);
      }
    } else {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
    }

    const amp = ctx.createGain();
    envelope(amp.gain, start, layer.gain, layer.env, layer.dur);

    let tail = src;
    const f = layer.filter;
    if (f) {
      const filter = ctx.createBiquadFilter();
      filter.type = f.type;
      filter.Q.value = f.q;
      sweep(filter.frequency, f.f, start, layer.dur, pitch);
      src.connect(filter);
      tail = filter;
    }
    tail.connect(amp);
    amp.connect(out);

    if (layer.kind === 'noise') {
      const room = Math.max(0, NOISE_SECONDS - layer.dur - TAIL);
      src.start(start, rng.range(0, room));
    } else {
      src.start(start);
    }
    src.stop(stop);
    sources.push(src);
  }

  /**
   * Toca um som. Devolve `true` se agendou (false = no-op: nome inválido,
   * mudo, sem contexto ou contexto parado).
   * @param {string} name  um de SOUND_NAMES
   * @param {{volume?: number, pitch?: number}} [opts]  volume em [0,1]; pitch multiplica as frequências
   */
  function play(name, opts) {
    if (typeof name !== 'string' || !Object.hasOwn(SOUND_RECIPES, name)) return false;
    if (muted || !ctx || ctx.state !== 'running') return false;
    const rec = SOUND_RECIPES[name];
    const rawVol = opts?.volume;
    const volume = clamp(typeof rawVol === 'number' && !Number.isNaN(rawVol) ? rawVol : 1, 0, 1);
    if (volume <= 0) return false;
    const rawPitch = opts?.pitch;
    const base = typeof rawPitch === 'number' && Number.isFinite(rawPitch) && rawPitch > 0 ? rawPitch : 1;
    const pitch = base * (1 + rng.range(-rec.vary, rec.vary));

    const t0 = ctx.currentTime;
    reserveVoice(t0);
    const out = ctx.createGain();
    out.gain.value = volume * rec.level;
    out.connect(master);
    const sources = [];
    for (const layer of rec.layers) addLayer(layer, t0, pitch, out, sources);
    voices.push({ end: t0 + rec.dur + TAIL, out, sources });
    return true;
  }

  /** Vozes ainda soando (para diagnóstico e testes). */
  function activeVoices() {
    if (!ctx) return 0;
    const now = ctx.currentTime;
    let n = 0;
    for (const v of voices) if (v.end > now) n++;
    return n;
  }

  return { resume, play, setMuted, activeVoices };
}
