// Ciclo de dia e noite (PURO: sem Three.js, sem DOM, sem estado).
//
// O tempo do jogo é só um número de segundos. Tudo — fase do dia, número do
// dia, se é noite, cores do céu, posição do sol/lua, intensidade das luzes — é
// FUNÇÃO PURA dele. Salvar o jogo = salvar `seconds`. Ver `.specs/009-dia-noite/`
// e `docs/adr/0008-*.md`.
//
// Modelo: fase p = (seconds / DAY_LENGTH) mod 1 e elevação do sol
// e = sin(2π·p)  (1 = zênite, 0 = horizonte, -1 = nadir).
//   p = 0 amanhecer · 0.25 meio-dia · 0.5 pôr do sol · 0.75 meia-noite

export const DAY_LENGTH = 360; // segundos reais por dia completo
export const START_SECONDS = 0.05 * DAY_LENGTH; // o jogo começa de manhã (fase 0.05)

const TAU = Math.PI * 2;

// --- Órbita do sol/lua ---
// O sol percorre um arco no plano XY inclinado `ORBIT_TILT` rad em torno do eixo X
// (leve inclinação em Z): nasce em +X, culmina perto de +Y, se põe em -X.
export const ORBIT_TILT = 0.35;
const COS_TILT = Math.cos(ORBIT_TILT);
const SIN_TILT = Math.sin(ORBIT_TILT);
/** Eixo (unitário) em torno do qual o céu gira: perpendicular ao plano da órbita. */
export const ORBIT_AXIS = Object.freeze({ x: 0, y: -SIN_TILT, z: COS_TILT });

// --- Faixas de elevação (sobre `e = sin(2πp)`) ---
const ELEV_NIGHT = -0.3; // abaixo disso: noite fechada (céu = cor da noite)
const ELEV_DAY = 0.15; // acima disso: claridade total de dia
const TWILIGHT_WIDTH = 0.3; // meia-largura do crepúsculo ao redor do horizonte
const TWILIGHT_STRENGTH = 0.75; // quanto o céu chega a ser tingido no pico do crepúsculo
const SUN_RAMP = 0.3; // elevação em que o sol/lua chega à intensidade plena

// --- Cores (hex sRGB, como no resto do jogo) ---
export const SKY_COLORS = Object.freeze({
  day: 0x87b7e8, // a cor do céu da Parte 1
  night: 0x0a0f24, // azul muito escuro
  dawn: 0xf0a0a8, // crepúsculo da manhã: rosado
  dusk: 0xe8855a, // crepúsculo da tarde: laranja
});

// --- Luzes: dia = valores do main.js da Parte 1; noite = "jogável", nunca preto total ---
export const LIGHT = Object.freeze({
  day: Object.freeze({ sun: 1.6, hemi: 0.7, ambient: 0.25 }),
  night: Object.freeze({ sun: 0, hemi: 0.22, ambient: 0.14 }),
  moon: 0.6, // intensidade máxima da luz da lua (a direcional vira lua à noite)
});

const hexToRgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const RGB_DAY = hexToRgb(SKY_COLORS.day);
const RGB_NIGHT = hexToRgb(SKY_COLORS.night);
const RGB_DAWN = hexToRgb(SKY_COLORS.dawn);
const RGB_DUSK = hexToRgb(SKY_COLORS.dusk);

// --- Helpers numéricos ---
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a * (1 - t) + b * t; // exata em t=0 e t=1
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
// Tempo inválido (NaN/Infinity) não pode envenenar a cena: cai no início do jogo.
const sane = (seconds) => (Number.isFinite(seconds) ? seconds : START_SECONDS);

/** Fase do dia em [0, 1): 0 amanhecer, .25 meio-dia, .5 pôr do sol, .75 meia-noite. */
export function phaseOf(seconds) {
  const p = (sane(seconds) / DAY_LENGTH) % 1;
  const q = p < 0 ? p + 1 : p;
  return q >= 1 ? 0 : q; // -1e-20 + 1 === 1 em ponto flutuante
}

/** Número do dia: 1, 2, 3… (vira no amanhecer, a cada `DAY_LENGTH` s). */
export function dayNumber(seconds) {
  return Math.max(1, Math.floor(sane(seconds) / DAY_LENGTH) + 1);
}

// Elevação do sol e fator de noite — uma só definição, usada por isNight E skyState
// (por isso `isNight(s) === (nightFactor >= 0.5)` vale com igualdade exata).
const elevationOf = (seconds) => Math.sin(phaseOf(seconds) * TAU);
const nightFactorAt = (e) => 1 - smoothstep(ELEV_NIGHT, ELEV_DAY, e);
const twilightAt = (e) => {
  const u = Math.min(Math.abs(e) / TWILIGHT_WIDTH, 1);
  const k = 1 - u * u;
  return k * k;
};

/** É noite? (`nightFactor >= 0.5`: de ~4° abaixo do horizonte ao anoitecer até o mesmo ao amanhecer.) */
export function isNight(seconds) {
  return nightFactorAt(elevationOf(seconds)) >= 0.5;
}

/** Rótulo do relógio do HUD: 'Amanhecer' | 'Dia' | 'Entardecer' | 'Noite'. */
export function phaseName(seconds) {
  const phase = phaseOf(seconds);
  const e = Math.sin(phase * TAU);
  if (nightFactorAt(e) >= 0.5) return 'Noite';
  if (twilightAt(e) > 0.15) return Math.cos(phase * TAU) >= 0 ? 'Amanhecer' : 'Entardecer';
  return 'Dia';
}

/** Objeto no formato de `skyState`, para reutilizar entre frames (zero alocação). */
export function createSkyState() {
  return {
    skyColor: { r: 0, g: 0, b: 0 },
    fogColor: { r: 0, g: 0, b: 0 },
    sunDir: { x: 0, y: 0, z: 0 },
    moonDir: { x: 0, y: 0, z: 0 },
    sunIntensity: 0,
    moonIntensity: 0,
    hemiIntensity: 0,
    ambientIntensity: 0,
    nightFactor: 0,
    starAlpha: 0,
    twilight: 0,
  };
}

/**
 * Estado do céu no instante `seconds`. Cores em [0,1] no espaço sRGB (o mesmo
 * dos hex do jogo). Direções unitárias. Contínuo em `seconds` (sem saltos).
 *
 * Campos do contrato: skyColor, fogColor, sunDir, moonDir, sunIntensity,
 * hemiIntensity, ambientIntensity, nightFactor, starAlpha.
 * Extras (aditivos): `moonIntensity` (luz da lua; a direcional vira lua à noite)
 * e `twilight` (0..1, pico no horizonte — tinge as luzes no pôr do sol).
 *
 * @param {number} seconds
 * @param {ReturnType<typeof createSkyState>} [out] reaproveita um objeto (sem alocar)
 */
export function skyState(seconds, out = createSkyState()) {
  const phase = phaseOf(seconds);
  const theta = phase * TAU;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const e = sinT; // = elevationOf(seconds)

  const nightFactor = nightFactorAt(e);
  const dayFactor = 1 - nightFactor;
  const twilight = twilightAt(e);
  const warmth = smoothstep(-0.5, 0.5, cosT); // 1 = amanhecer (rosado), 0 = entardecer (laranja)
  const tint = twilight * TWILIGHT_STRENGTH;

  const sky = out.skyColor;
  sky.r = lerp(lerp(RGB_NIGHT[0], RGB_DAY[0], dayFactor), lerp(RGB_DUSK[0], RGB_DAWN[0], warmth), tint);
  sky.g = lerp(lerp(RGB_NIGHT[1], RGB_DAY[1], dayFactor), lerp(RGB_DUSK[1], RGB_DAWN[1], warmth), tint);
  sky.b = lerp(lerp(RGB_NIGHT[2], RGB_DAY[2], dayFactor), lerp(RGB_DUSK[2], RGB_DAWN[2], warmth), tint);
  out.fogColor.r = sky.r; // a neblina acompanha o céu (horizonte sem emenda)
  out.fogColor.g = sky.g;
  out.fogColor.b = sky.b;

  // Órbita: já unitária (cos² + sin²·(cos²t + sin²t) = 1). Lua = oposto exato.
  const sx = cosT;
  const sy = sinT * COS_TILT;
  const sz = sinT * SIN_TILT;
  out.sunDir.x = sx;
  out.sunDir.y = sy;
  out.sunDir.z = sz;
  out.moonDir.x = 0 - sx; // `0 -` evita -0
  out.moonDir.y = 0 - sy;
  out.moonDir.z = 0 - sz;

  out.sunIntensity = LIGHT.day.sun * smoothstep(0, SUN_RAMP, e);
  out.moonIntensity = LIGHT.moon * smoothstep(0, SUN_RAMP, -e);
  out.hemiIntensity = lerp(LIGHT.night.hemi, LIGHT.day.hemi, dayFactor);
  out.ambientIntensity = lerp(LIGHT.night.ambient, LIGHT.day.ambient, dayFactor);

  out.nightFactor = nightFactor;
  out.starAlpha = nightFactor * nightFactor;
  out.twilight = twilight;
  return out;
}
