// Partes (caixas), layout da textura e pintura das skins das criaturas.
// PURO: sem Three.js e sem DOM — roda no Node (testes headless). O `model.js`
// transforma isto em geometria e `THREE.DataTexture`.
//
// Convenções (valem para modelo, IA e câmera — ver brief §4.4):
//   - unidade = "pixel de modelo" (~16 px por bloco); o `model.js` escala tudo
//     para a hitbox de `mobs.js`, então estes números só definem PROPORÇÃO;
//   - Y para cima, origem nos pés; a FRENTE é +Z;
//   - +X é a ESQUERDA do próprio personagem (a mão direita fica em −X).

import { makeRng } from '../rng.js';
import { MOB_DEFS } from './mobs.js';

export const SKIN_KINDS = ['pig', 'sheep', 'zombie', 'creeper', 'avatar'];

/** Largura fixa do atlas de cada criatura (px). A altura sai do empacotamento. */
export const TEX_WIDTH = 64;

/** Faces de uma caixa e o eixo para onde apontam. */
export const FACE_NAMES = ['top', 'bottom', 'right', 'front', 'left', 'back'];
export const FACE_NORMAL = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  right: [-1, 0, 0], // lado direito do personagem
  front: [0, 0, 1], // rosto
  left: [1, 0, 0],
  back: [0, 0, -1],
};

// ---------------------------------------------------------------------------
// Partes do esqueleto
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Part
 * @property {string} name
 * @property {number[]} size      [w, h, d] em px de modelo
 * @property {number[]} center    centro da caixa (px de modelo, absoluto)
 * @property {number[]|null} pivot ponto de rotação (absoluto); padrão = center
 * @property {string|null} parent  parte-pai na hierarquia de animação
 * @property {string|null} tex     usa a região de textura de outra parte
 * @property {boolean} reach       braço estendido: fora da centralização em XZ
 */
function part(name, size, center, extra = {}) {
  return { name, size, center, pivot: null, parent: null, tex: null, reach: false, ...extra };
}

/** Quatro patas nos cantos: FL/FR na frente (+Z), BL/BR atrás; L = +X. */
function fourLegs(size, x, z, topY) {
  const [, h] = size;
  const cy = h / 2;
  const leg = (name, sx, sz, extra = {}) =>
    part(name, size, [sx * x, cy, sz * z], { pivot: [sx * x, topY, sz * z], ...extra });
  return [
    leg('legFL', 1, 1),
    leg('legFR', -1, 1, { tex: 'legFL' }),
    leg('legBL', 1, -1, { tex: 'legFL' }),
    leg('legBR', -1, -1, { tex: 'legFL' }),
  ];
}

/** Humanoide (zumbi e avatar): mesma estrutura, braço de comprimento variável. */
function humanoid(armLen, reach) {
  const top = 24; // topo do tronco
  return [
    part('body', [6, 12, 4], [0, 18, 0]),
    part('head', [8, 8, 8], [0, 28, 0], { pivot: [0, 24, 0] }),
    part('armL', [3, armLen, 3], [4.25, top - armLen / 2, 0], { pivot: [4.25, 22.5, 0], reach }),
    part('armR', [3, armLen, 3], [-4.25, top - armLen / 2, 0], { pivot: [-4.25, 22.5, 0], reach, tex: 'armL' }),
    part('legL', [3, 12, 4], [1.5, 6, 0], { pivot: [1.5, 12, 0] }),
    part('legR', [3, 12, 4], [-1.5, 6, 0], { pivot: [-1.5, 12, 0], tex: 'legL' }),
  ];
}

const RIG_BUILDERS = {
  pig: () => [
    part('body', [10, 7, 9], [0, 8.5, 0]),
    part('head', [8, 7, 6], [0, 9.5, 6], { pivot: [0, 8, 3.5] }),
    part('snout', [4, 3, 1], [0, 8, 9.5], { parent: 'head' }),
    part('earL', [2, 1, 2], [3, 13.5, 4.5], { parent: 'head' }),
    part('earR', [2, 1, 2], [-3, 13.5, 4.5], { parent: 'head', tex: 'earL' }),
    ...fourLegs([4, 5, 4], 3, 2.5, 5),
  ],
  sheep: () => [
    part('body', [12, 10, 10], [0, 12, 0]),
    part('head', [6, 6, 6], [0, 15, 6.5], { pivot: [0, 13, 4] }),
    part('tuft', [7, 2, 7], [0, 19, 6.5], { parent: 'head' }),
    ...fourLegs([4, 8, 4], 3, 3, 8),
  ],
  zombie: () => humanoid(10, true),
  creeper: () => [
    part('body', [8, 12, 4], [0, 12, 0]),
    part('head', [8, 8, 8], [0, 22, 0], { pivot: [0, 18, 0] }),
    ...fourLegs([4, 6, 4], 2, 2, 6),
  ],
  avatar: () => humanoid(12, false),
};

const rigCache = new Map();

/** Esqueleto de um tipo: `{ kind, parts: Part[] }` (cacheado; não mutar). */
export function rigOf(kind) {
  let rig = rigCache.get(kind);
  if (!rig) {
    const build = RIG_BUILDERS[kind];
    if (!build) throw new Error(`Criatura desconhecida: "${kind}" (esperado: ${SKIN_KINDS.join(', ')})`);
    rig = { kind, parts: build() };
    rigCache.set(kind, rig);
  }
  return rig;
}

// ---------------------------------------------------------------------------
// Layout da textura (cruz do Minecraft, empacotada em prateleiras)
// ---------------------------------------------------------------------------

/** Retângulos (px) das 6 faces de uma caixa [w,h,d] cuja cruz começa em (x,y). */
export function faceRects(x, y, w, h, d) {
  return {
    top: { x: x + d, y, w, h: d },
    bottom: { x: x + d + w, y, w, h: d },
    right: { x, y: y + d, w: d, h },
    front: { x: x + d, y: y + d, w, h },
    left: { x: x + d + w, y: y + d, w: d, h },
    back: { x: x + 2 * d + w, y: y + d, w, h },
  };
}

const layoutCache = new Map();

/**
 * Layout da skin de um tipo.
 * `regions[chave]` = região (cruz) de uma caixa; `partRegion[nomeDaParte]` diz
 * qual região a parte usa (pernas/braços simétricos compartilham a mesma).
 * @returns {{ width:number, height:number,
 *   regions:Record<string,{x:number,y:number,w:number,h:number,faces:Record<string,{x,y,w,h}>}>,
 *   partRegion:Record<string,string> }}
 */
export function skinLayout(kind) {
  let layout = layoutCache.get(kind);
  if (layout) return layout;
  const rig = rigOf(kind);
  const regions = {};
  const partRegion = {};
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const p of rig.parts) {
    const [w, h, d] = p.size;
    if (p.tex) {
      const base = rig.parts.find((q) => q.name === p.tex);
      if (!base || base.size.join() !== p.size.join()) {
        throw new Error(`Parte "${p.name}" compartilha textura com "${p.tex}" mas o tamanho difere`);
      }
      partRegion[p.name] = p.tex;
      continue;
    }
    const rw = 2 * d + 2 * w;
    const rh = d + h;
    if (cx + rw > TEX_WIDTH) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    regions[p.name] = { x: cx, y: cy, w: rw, h: rh, faces: faceRects(cx, cy, w, h, d) };
    partRegion[p.name] = p.name;
    cx += rw;
    rowH = Math.max(rowH, rh);
  }
  const height = Math.ceil((cy + rowH) / 8) * 8;
  layout = { width: TEX_WIDTH, height, regions, partRegion };
  layoutCache.set(kind, layout);
  return layout;
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

/** Normaliza `variant`: só a ovelha tem variantes (`MOB_DEFS.sheep.variants`). */
export function normalizeVariant(kind, variant = 0) {
  if (kind !== 'sheep') return 0;
  const n = MOB_DEFS.sheep.variants;
  const v = Number.isFinite(variant) ? Math.trunc(variant) : 0;
  return ((v % n) + n) % n;
}

// ---------------------------------------------------------------------------
// Ferramentas de pintura
// ---------------------------------------------------------------------------

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const mul = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];

function createSkin(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Pinta o pixel (i,j) RELATIVO ao retângulo `r` (ignora o que sair dele). */
function put(sk, r, i, j, c) {
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return;
  const o = ((r.y + j) * sk.width + (r.x + i)) * 4;
  sk.data[o] = c[0];
  sk.data[o + 1] = c[1];
  sk.data[o + 2] = c[2];
  sk.data[o + 3] = 255;
}

function fill(sk, r, c, i0 = 0, j0 = 0, w = r.w, h = r.h) {
  for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) put(sk, r, i, j, c);
}

/** Pixel RGB lido de volta (para detalhes que dependem do que já foi pintado). */
function get(sk, r, i, j) {
  const o = ((r.y + j) * sk.width + (r.x + i)) * 4;
  return [sk.data[o], sk.data[o + 1], sk.data[o + 2]];
}

/** Ruído por pixel: `base` variando ±`amt` (multiplicativo). */
function grain(sk, r, base, rng, amt = 0.05, shade = 1) {
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      put(sk, r, i, j, mul(base, shade * (1 + (rng.next() - 0.5) * 2 * amt)));
    }
  }
}

/** Brilho leve por face — dá volume sem depender só da luz da cena. */
const FACE_SHADE = { top: 1.07, bottom: 0.7, front: 1, back: 0.93, left: 0.9, right: 0.9 };

function grainAll(sk, faces, base, rng, amt = 0.05) {
  for (const name of FACE_NAMES) grain(sk, faces[name], base, rng, amt, FACE_SHADE[name]);
}

/** Manchas quadradas `size`×`size` mais escuras/claras, espalhadas. */
function blotches(sk, r, rng, count, size, factor) {
  for (let k = 0; k < count; k++) {
    const x0 = rng.int(Math.max(1, r.w - size + 1));
    const y0 = rng.int(Math.max(1, r.h - size + 1));
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (x0 + i < r.w && y0 + j < r.h) put(sk, r, x0 + i, y0 + j, mul(get(sk, r, x0 + i, y0 + j), factor));
      }
    }
  }
}

/** Bitmap de strings ('X' = pixel) pintado a partir de (i0,j0) com a cor `c`. */
function stamp(sk, r, rows, c, i0 = 0, j0 = 0) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'X') put(sk, r, i0 + i, j0 + j, c);
  });
}

// ---------------------------------------------------------------------------
// Pintores por tipo
// ---------------------------------------------------------------------------

function paintPig(sk, F, rng) {
  const PINK = rgb(0xf2a0ae);
  const PINK_D = rgb(0xe08a9c);
  const PINK_L = rgb(0xf9c2ca);
  const EAR = rgb(0xd97790);
  const HOOF = rgb(0x9c5468);
  const EYE = rgb(0x14141f);
  const WHITE = rgb(0xffffff);
  const NOSTRIL = rgb(0xa94e66);

  const body = F('body');
  grainAll(sk, body, PINK, rng, 0.05);
  for (const n of FACE_NAMES) blotches(sk, body[n], rng, n === 'top' ? 3 : 2, 2, 0.9);

  const head = F('head');
  grainAll(sk, head, PINK, rng, 0.04);
  // bochechas mais claras e olhos (branco por fora, íris escura por dentro)
  fill(sk, head.front, mul(PINK, 1.06), 0, 4, head.front.w, 2);
  put(sk, head.front, 1, 2, WHITE);
  put(sk, head.front, 2, 2, EYE);
  put(sk, head.front, 5, 2, EYE);
  put(sk, head.front, 6, 2, WHITE);
  put(sk, head.front, 2, 3, mul(PINK, 0.9));
  put(sk, head.front, 5, 3, mul(PINK, 0.9));

  const snout = F('snout');
  grainAll(sk, snout, PINK_L, rng, 0.03);
  fill(sk, snout.front, mul(PINK_L, 1.03));
  put(sk, snout.front, 1, 1, NOSTRIL);
  put(sk, snout.front, 2, 1, NOSTRIL);
  fill(sk, snout.front, mul(PINK_L, 0.88), 0, 2, snout.front.w, 1);

  grainAll(sk, F('earL'), EAR, rng, 0.04);

  const leg = F('legFL');
  grainAll(sk, leg, PINK_D, rng, 0.04);
  for (const n of ['front', 'back', 'left', 'right']) fill(sk, leg[n], HOOF, 0, leg[n].h - 1, leg[n].w, 1);
  fill(sk, leg.bottom, HOOF);
}

// Cores da lã e da pele da cabeça/patas, na ordem de `variant` (branca,
// cinza, marrom, preta — a mesma ordem documentada em MOB_DEFS.sheep).
const WOOL = [0xf1f1ec, 0x9a9aa2, 0x7b5a38, 0x303036].map(rgb);
const SHEEP_SKIN = [0xdcbca6, 0xa89a90, 0x6c5240, 0x4a4442].map(rgb);
const WOOL_TONES = [0.84, 0.92, 1, 1, 1.06];

function woolFace(sk, r, base, rng, spread) {
  const cw = Math.ceil(r.w / 2);
  const ch = Math.ceil(r.h / 2);
  const cells = [];
  for (let k = 0; k < cw * ch; k++) cells.push(WOOL_TONES[rng.int(WOOL_TONES.length)]);
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      let f = 1 + (cells[(j >> 1) * cw + (i >> 1)] - 1) * spread;
      if (j % 4 === 3) f *= 0.93; // linha de cacho
      f *= 1 + (rng.next() - 0.5) * 0.05;
      put(sk, r, i, j, mul(base, f));
    }
  }
}

function woolAll(sk, faces, base, rng, spread) {
  for (const n of FACE_NAMES) woolFace(sk, faces[n], base, rng, spread);
}

function paintSheep(sk, F, rng, variant) {
  const wool = WOOL[variant % WOOL.length];
  const skin = SHEEP_SKIN[variant % SHEEP_SKIN.length];
  const spread = wool[0] + wool[1] + wool[2] < 240 ? 1.7 : 1; // lã escura precisa de mais contraste
  const EYE = rgb(0x14141f);
  const WHITE = rgb(0xffffff);

  woolAll(sk, F('body'), wool, rng, spread);
  woolAll(sk, F('tuft'), wool, rng, spread);

  const head = F('head');
  grainAll(sk, head, skin, rng, 0.04);
  const f = head.front; // 6 x 6
  fill(sk, f, mul(skin, 1.05), 0, 0, f.w, 1);
  put(sk, f, 0, 2, WHITE); // olhos nas bordas, íris por dentro (como a ovelha clássica)
  put(sk, f, 1, 2, EYE);
  put(sk, f, 4, 2, EYE);
  put(sk, f, 5, 2, WHITE);
  fill(sk, f, mul(skin, 0.82), 2, 3, 2, 1); // focinho
  fill(sk, f, mul(skin, 0.62), 2, 4, 2, 1); // boca

  const leg = F('legFL'); // 4 x 8 x 4: topo coberto de lã, casco escuro embaixo
  grainAll(sk, leg, mul(skin, 0.8), rng, 0.04);
  for (const n of ['front', 'back', 'left', 'right']) {
    for (let j = 0; j < 3; j++) for (let i = 0; i < leg[n].w; i++) put(sk, leg[n], i, j, mul(wool, (j === 2 ? 0.88 : 1) * (1 + (rng.next() - 0.5) * 0.08)));
    fill(sk, leg[n], rgb(0x3a3330), 0, leg[n].h - 1, leg[n].w, 1);
  }
  woolFace(sk, leg.top, wool, rng, spread);
  fill(sk, leg.bottom, rgb(0x3a3330));
}

function paintZombie(sk, F, rng) {
  const SKIN = rgb(0x79a86a);
  const SKIN_D = rgb(0x5b8a50);
  const SHIRT = rgb(0x2cb2c4);
  const PANTS = rgb(0x2d3b94);
  const SHOE = rgb(0x3b3b45);
  const EYE = rgb(0x0e1218);
  const GLINT = rgb(0xd9d46a);
  const MOUTH = rgb(0x24391f);

  const head = F('head');
  grainAll(sk, head, SKIN, rng, 0.06);
  for (const n of FACE_NAMES) blotches(sk, head[n], rng, 5, 2, 0.84);
  fill(sk, head.top, mul(SKIN_D, 1.02), 0, 0, head.top.w, head.top.h);
  grain(sk, head.top, SKIN_D, rng, 0.07);
  const f = head.front; // 8 x 8
  fill(sk, f, EYE, 1, 3, 2, 2);
  fill(sk, f, EYE, 5, 3, 2, 2);
  put(sk, f, 2, 4, GLINT);
  put(sk, f, 5, 4, GLINT);
  fill(sk, f, SKIN_D, 3, 5, 2, 1); // nariz
  fill(sk, f, MOUTH, 2, 6, 4, 1);
  put(sk, f, 3, 7, mul(SKIN, 0.78));
  put(sk, f, 4, 7, mul(SKIN, 0.78));

  // camisa rasgada: a borda de baixo é irregular e deixa a pele aparecer
  const body = F('body');
  grainAll(sk, body, SHIRT, rng, 0.05);
  for (const n of ['front', 'back', 'left', 'right']) {
    const r = body[n];
    for (let i = 0; i < r.w; i++) {
      const tear = rng.int(4);
      for (let j = r.h - tear; j < r.h; j++) put(sk, r, i, j, mul(SKIN, 0.95 + rng.next() * 0.1));
    }
  }
  fill(sk, body.front, mul(SKIN_D, 1), 1, 4, 2, 2);
  fill(sk, body.top, SKIN);

  const arm = F('armL');
  grainAll(sk, arm, SKIN, rng, 0.06);
  for (const n of ['front', 'back', 'left', 'right']) {
    const r = arm[n];
    for (let i = 0; i < r.w; i++) {
      const sleeve = 4 + rng.int(2); // manga curta e esfiapada
      for (let j = 0; j < sleeve; j++) put(sk, r, i, j, mul(SHIRT, 1 + (rng.next() - 0.5) * 0.1));
    }
  }
  fill(sk, arm.top, SHIRT);
  grain(sk, arm.bottom, SKIN_D, rng, 0.06);

  const leg = F('legL');
  grainAll(sk, leg, PANTS, rng, 0.05);
  for (const n of ['front', 'back', 'left', 'right']) {
    fill(sk, leg[n], SHOE, 0, leg[n].h - 2, leg[n].w, 2);
  }
  fill(sk, leg.bottom, SHOE);
  fill(sk, leg.front, mul(SKIN, 0.9), 0, 5, 2, 2); // rasgo no joelho
}

const CAMO = [0x70c25f, 0x5aa84d, 0x479240, 0x347a35, 0x82d46f].map(rgb);
const CREEPER_SPOT = rgb(0x1f4b24);

function camoFace(sk, r, rng, shade) {
  const idx = new Int8Array(r.w * r.h);
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      let k;
      if (i > 0 && rng.chance(0.4)) k = idx[j * r.w + i - 1];
      else if (j > 0 && rng.chance(0.3)) k = idx[(j - 1) * r.w + i];
      else k = rng.int(CAMO.length);
      idx[j * r.w + i] = k;
      put(sk, r, i, j, mul(rng.chance(0.035) ? CREEPER_SPOT : CAMO[k], shade));
    }
  }
}

function camoAll(sk, faces, rng, shade) {
  for (const n of FACE_NAMES) camoFace(sk, faces[n], rng, shade * FACE_SHADE[n]);
}

/** O rosto clássico (8x8). */
const CREEPER_FACE = [
  '........',
  '........',
  '.XX..XX.',
  '.XX..XX.',
  '...XX...',
  '..XXXX..',
  '..XXXX..',
  '..X..X..',
];

function paintCreeper(sk, F, rng) {
  const head = F('head');
  camoAll(sk, head, rng, 1);
  stamp(sk, head.front, CREEPER_FACE, rgb(0x0b150c));
  camoAll(sk, F('body'), rng, 0.97);
  const leg = F('legFL');
  camoAll(sk, leg, rng, 0.82);
  fill(sk, leg.bottom, mul(CAMO[3], 0.55));
}

function paintAvatar(sk, F, rng) {
  const SKIN = rgb(0xe9b48f);
  const SKIN_D = rgb(0xd09873);
  const HAIR = rgb(0x4b2f1c);
  const SHIRT = rgb(0x2f6fdc);
  const SHIRT_D = rgb(0x2457b4);
  const PANTS = rgb(0x232d73);
  const SHOE = rgb(0x3a3a42);
  const WHITE = rgb(0xffffff);
  const IRIS = rgb(0x2f4f9f);
  const MOUTH = rgb(0xa5624f);

  const head = F('head');
  grainAll(sk, head, SKIN, rng, 0.03);
  grain(sk, head.top, HAIR, rng, 0.09, FACE_SHADE.top);
  grain(sk, head.back, HAIR, rng, 0.09, FACE_SHADE.back);
  fill(sk, head.back, mul(SKIN, 0.9), 0, 7, 8, 1); // nuca
  // laterais: pele no rosto, cabelo em cima e atrás da orelha (metade de trás)
  for (const [name, backCols] of [['right', [0, 1, 2, 3]], ['left', [4, 5, 6, 7]]]) {
    const r = head[name];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const hair = j < 3 || (j <= 5 && backCols.includes(i));
        put(sk, r, i, j, mul(hair ? HAIR : SKIN, 0.92 * (1 + (rng.next() - 0.5) * (hair ? 0.18 : 0.06))));
      }
    }
    put(sk, r, backCols[3] === 3 ? 4 : 3, 4, mul(SKIN_D, 0.95)); // orelha, junto da linha do rosto
  }
  const f = head.front; // 8 x 8
  fill(sk, f, mul(HAIR, 1.04), 0, 0, 8, 2);
  fill(sk, f, HAIR, 0, 2, 1, 2);
  fill(sk, f, HAIR, 7, 2, 1, 2);
  fill(sk, f, mul(HAIR, 0.85), 1, 3, 2, 1); // sobrancelhas
  fill(sk, f, mul(HAIR, 0.85), 5, 3, 2, 1);
  put(sk, f, 1, 4, WHITE);
  put(sk, f, 2, 4, IRIS);
  put(sk, f, 5, 4, IRIS);
  put(sk, f, 6, 4, WHITE);
  fill(sk, f, SKIN_D, 3, 5, 2, 1); // nariz
  fill(sk, f, MOUTH, 3, 6, 2, 1);

  const body = F('body'); // camisa azul, decote e cinto
  grainAll(sk, body, SHIRT, rng, 0.04);
  fill(sk, body.front, SKIN, 2, 0, 2, 1); // decote
  fill(sk, body.front, mul(SHIRT, 1.07), 1, 2, 4, 4); // peito
  for (const n of ['front', 'back', 'left', 'right']) fill(sk, body[n], mul(PANTS, 1.05), 0, body[n].h - 1, body[n].w, 1);
  fill(sk, body.top, SKIN);

  const arm = F('armL'); // manga curta azul, antebraço de pele
  grainAll(sk, arm, SKIN, rng, 0.03);
  for (const n of ['front', 'back', 'left', 'right']) {
    const r = arm[n];
    for (let j = 0; j < 5; j++) for (let i = 0; i < r.w; i++) put(sk, r, i, j, mul(j === 4 ? SHIRT_D : SHIRT, 1 + (rng.next() - 0.5) * 0.06));
  }
  fill(sk, arm.top, SHIRT);

  const leg = F('legL'); // calça azul-escura e sapato
  grainAll(sk, leg, PANTS, rng, 0.04);
  for (const n of ['front', 'back', 'left', 'right']) fill(sk, leg[n], SHOE, 0, leg[n].h - 3, leg[n].w, 3);
  fill(sk, leg.bottom, SHOE);
}

const PAINTERS = {
  pig: paintPig,
  sheep: paintSheep,
  zombie: paintZombie,
  creeper: paintCreeper,
  avatar: paintAvatar,
};

function seedOf(kind, variant) {
  let h = 2166136261;
  const s = `${kind}:${variant}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Skin procedural de um tipo, em pixels RGBA (linha 0 = topo da imagem).
 * Determinística: mesmo (kind, variant) ⇒ mesmos bytes. Cada chamada devolve
 * um array NOVO (o cache de textura fica em model.js).
 *
 * @param {string} kind  'pig' | 'sheep' | 'zombie' | 'creeper' | 'avatar'
 * @param {number} [variant]  só a ovelha usa (0..3 = branca/cinza/marrom/preta)
 * @returns {{ width:number, height:number, data:Uint8Array }}
 */
export function skinPixels(kind, variant = 0) {
  const paint = PAINTERS[kind];
  if (!paint) throw new Error(`Criatura desconhecida: "${kind}" (esperado: ${SKIN_KINDS.join(', ')})`);
  const v = normalizeVariant(kind, variant);
  const layout = skinLayout(kind);
  const sk = createSkin(layout.width, layout.height);
  paint(sk, (key) => layout.regions[key].faces, makeRng(seedOf(kind, v)), v);
  return sk;
}
