// HUD da Parte 2 (feature 015): corações, hotbar com contagem, relógio, flash de
// dano, toasts, tela de morte e menu. Sem imagens: todo ícone é pixel art
// desenhada em código (grade de texto + paleta -> SVG inline). Ver ADR 0013.
//
// Duas camadas:
//  - Funções PURAS (sem DOM, importáveis no Node): `heartsFor`, `phaseLabel`,
//    `formatCount` e os geradores de SVG. São o que os testes headless cobrem.
//  - `createHud()`: liga/cria os elementos do `index.html` e devolve a API do
//    contrato (brief §4.7). Só toca no DOM quando o estado mudou, então o
//    integrador pode chamar `setHealth/setHotbar/setClock` a cada frame.

import { ITEM, MAX_STACK } from '../game/items.js';
import { DAY_LENGTH, phaseName } from '../game/time.js';

// ---------------------------------------------------------------------------
// Constantes de apresentação (escala do HUD — NÃO são regras de gameplay)
// ---------------------------------------------------------------------------

/** Corações desenhados; cada um vale `HP_PER_HEART` de HP (jogador: 20 HP). */
export const HEART_COUNT = 10;
export const HP_PER_HEART = 2;
/** Com tanta vida ou menos (em HP na escala de 20) os corações tremem. */
export const LOW_HP = 4;
/** Toasts simultâneos (o mais antigo sai quando passa disso) e duração padrão. */
export const MAX_TOASTS = 4;
export const TOAST_MS = 1800;
const TOAST_FADE_MS = 250;

/** Valores que `bindMenu` entrega em `onStart(mode)` (iguais aos de `stats.js`). */
export const MENU_MODE = Object.freeze({ SURVIVAL: 'survival', CREATIVE: 'creative' });

/** "Dia 3 · Dia" lê mal; a fase "Dia" aparece como "Pleno dia" no relógio. */
const PHASE_DISPLAY = Object.freeze({ Dia: 'Pleno dia' });

const SUB_TEXT = 'Parte 2 · Criaturas';
const SUB_TEXT_PAUSED = 'Pausado · Parte 2 · Criaturas';

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

/** Meios-corações cheios (0..20) para `hp` de `maxHp`; HP > 0 nunca dá 0. */
function heartHalves(hp, maxHp) {
  const h = Number(hp);
  const m = Number(maxHp);
  if (Number.isNaN(h) || Number.isNaN(m) || m <= 0) return 0;
  const frac = Math.min(1, Math.max(0, h / m));
  const total = HEART_COUNT * HP_PER_HEART;
  // O `- 1e-9` evita que erro de ponto flutuante (ex.: 0.1 * 20) vire meio coração extra.
  return Math.min(total, Math.ceil(frac * total - 1e-9));
}

/**
 * Estado de cada um dos 10 corações, da esquerda para a direita.
 * 2 HP = 1 coração; HP ímpar = um meio coração. `maxHp` diferente de 20 é
 * reescalado para os 10 corações.
 * @param {number} hp
 * @param {number} [maxHp]  padrão: 20 (HEART_COUNT × HP_PER_HEART)
 * @returns {Array<'full'|'half'|'empty'>} sempre com HEART_COUNT entradas
 */
export function heartsFor(hp, maxHp = HEART_COUNT * HP_PER_HEART) {
  const halves = heartHalves(hp, maxHp);
  const out = new Array(HEART_COUNT);
  for (let i = 0; i < HEART_COUNT; i++) {
    const left = halves - i * 2;
    out[i] = left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
  }
  return out;
}

/** true quando a vida está baixa (corações tremem). Vale `hp <= LOW_HP`. */
export function isLowHealth(hp, maxHp = HEART_COUNT * HP_PER_HEART) {
  return heartHalves(hp, maxHp) <= LOW_HP;
}

/**
 * Nome da fase do dia para o relógio. É uma ponte para `phaseName` de `time.js`
 * (única fonte dos nomes e de onde cada fase começa — inclusive a noite, que é
 * a mesma de `isNight`), recebendo a FASE em vez de segundos.
 * @param {number} phase  fração do ciclo (`phaseOf(seconds)`: 0 amanhecer, 0.25
 *   meio-dia, 0.5 pôr do sol, 0.75 meia-noite); fora de [0,1) dá a volta; valor
 *   inválido cai no início do jogo, como em `time.js`.
 * @returns {'Amanhecer'|'Dia'|'Entardecer'|'Noite'}
 */
export function phaseLabel(phase) {
  return phaseName(Number(phase) * DAY_LENGTH);
}

/** Texto do relógio: "Dia 3 · Entardecer". */
export function clockLabel(day, phaseName) {
  const d = Math.max(1, Math.floor(Number(day)) || 1);
  const name = typeof phaseName === 'string' ? phaseName.trim() : '';
  if (!name) return `Dia ${d}`;
  const shown = Object.hasOwn(PHASE_DISPLAY, name) ? PHASE_DISPLAY[name] : name;
  return `Dia ${d} · ${shown}`;
}

/**
 * Texto da contagem de um slot: `Infinity` -> "∞", 0 -> "0", `null`/inválido ->
 * "", acima do teto de pilha -> "999+" (teto lido de `MAX_STACK`).
 */
export function formatCount(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '';
  if (n === Infinity) return '∞';
  if (n <= 0) return '0';
  const k = Math.floor(n);
  return k > MAX_STACK ? `${MAX_STACK}+` : String(k);
}

/**
 * Texto que o slot mostra no canto. Igual a `formatCount`, exceto que item
 * permanente (contagem infinita, ex.: espada) não mostra número: "∞" só em bloco.
 * @param {{item?: string|null, count?: number|null}} slot
 */
export function countText(slot) {
  if (!slot) return '';
  if (slot.item && slot.count === Infinity) return '';
  return formatCount(slot.count);
}

/** Rótulo da tecla do slot `i`: 0..8 -> "1".."9", 9 -> "0". */
export function slotKeyLabel(i) {
  return String((Number(i) + 1) % 10);
}

/** Números da tela de morte, sempre inteiros >= 0. */
/** Rótulos da tela de morte no singular/plural certo ("1 dia", "2 dias"). */
export function deathLabels({ days, kills }) {
  return {
    days: days === 1 ? 'Dia sobrevivido' : 'Dias sobrevividos',
    kills: kills === 1 ? 'Abate' : 'Abates',
  };
}

export function deathSummary(summary) {
  const clean = (n) => {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  };
  return { days: clean(summary?.days), kills: clean(summary?.kills) };
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Cor segura para CSS/SVG: número (0xRRGGBB) ou string `#rgb`/`#rrggbb` viram
 * `#rrggbb` minúsculo; qualquer outra coisa vira o fallback (nunca repassa
 * texto arbitrário para `style`/`fill`).
 */
export function cssColor(color, fallback = '#888888') {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return '#' + (color & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof color === 'string') {
    const m = HEX_RE.exec(color.trim());
    if (m) {
      const h = m[1].toLowerCase();
      return '#' + (h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h);
    }
  }
  return fallback;
}

/** Clareia (amount > 0, mistura com branco) ou escurece (< 0, mistura com preto). */
export function shadeColor(color, amount) {
  const hex = cssColor(color).slice(1);
  const t = Math.min(1, Math.abs(Number(amount) || 0));
  const target = amount >= 0 ? 255 : 0;
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const c = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    out += Math.round(c + (target - c) * t).toString(16).padStart(2, '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pixel art: grade de texto + paleta -> SVG inline
// ---------------------------------------------------------------------------

/**
 * Converte uma grade ('.' = vazio, qualquer outro caractere = chave da paleta)
 * em SVG. Corridas horizontais da mesma cor viram um único <rect>.
 * @param {string[]} rows  todas com o mesmo comprimento
 * @param {Record<string,string>} palette  caractere -> cor
 */
export function gridToSvg(rows, palette) {
  const h = rows.length;
  const w = rows[0].length;
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (!Object.hasOwn(palette, ch)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${palette[ch]}"/>`;
      x += run;
    }
  }
  return (
    `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">` +
    rects +
    '</svg>'
  );
}

function buildGrid(w, h, cell) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += cell(x, y);
    rows.push(row);
  }
  return rows;
}

// Coração 9x9. Maiúsculas = coração cheio; minúsculas = a mesma célula vazia.
// O = contorno, R = vermelho, H = brilho, D = sombra.
const HEART_ROWS = [
  '.OO...OO.',
  'OHHO.ORRO',
  'OHRRORRRO',
  'ORRRRRRRO',
  'ORRRRRRDO',
  '.ORRRRDO.',
  '..ORRDO..',
  '...ORO...',
  '....O....',
];
const HEART_PALETTE = {
  O: '#2a0a0c',
  R: '#e3262e',
  H: '#ff9fa3',
  D: '#a3141c',
  o: '#3b2a31',
  r: 'rgba(20,12,16,.5)',
  h: 'rgba(255,255,255,.16)',
  d: 'rgba(0,0,0,.35)',
};
const HEART_HALF_COL = 4; // colunas 0..4 (inclui a central) ficam cheias no meio coração

// Espada 16x16 (lâmina na diagonal, ponta no canto superior direito).
const SWORD_ROWS = [
  '...............w',
  '.............ws.',
  '............ws..',
  '...........ws...',
  '..........ws....',
  '.........ws.....',
  '........ws......',
  '.......ws.......',
  '..Gg..ws........',
  '...Ggws.........',
  '....Gg..........',
  '...dDGg.........',
  '..dD..Gg........',
  '.dD.............',
  'pp..............',
  'p...............',
];
const SWORD_PALETTE = {
  w: '#eef3f8',
  s: '#a9b5c6',
  g: '#f2c14e',
  G: '#b88a1e',
  d: '#8a5a2b',
  D: '#5e3b1a',
  p: '#f2c14e',
};

// Carne (costeleta) 16x16: P = carne, L = brilho, D = sombra, F = gordura, B = osso.
const PORK_ROWS = [
  '................',
  '.....kkkkkk.....',
  '...kkPPPPPPkk...',
  '..kPPLLPPPPPPk..',
  '.kPPLLFFPPPPPPk.',
  '.kPPPFFPPPPPDPk.',
  '.kPPPPPPPPPDDPk.',
  '.kPPPPPPPPPPDPk.',
  '..kPPPPPPPPDDk..',
  '...kPPPPPPPPk...',
  '.kBBkkPPPPkk....',
  'kBBBk.kkkkk.....',
  'kBBk............',
  '.kk.............',
  '................',
  '................',
];
const PORK_PALETTE = {
  k: '#5a2030',
  P: '#f08aa0',
  L: '#ffc5d1',
  D: '#c4506b',
  F: '#fff0f3',
  B: '#f6ecd2',
};

// Sol e lua 11x11, geradas por fórmula (círculos) para não errar à mão.
const SUN_ROWS = buildGrid(11, 11, (x, y) => {
  const dx = x - 5;
  const dy = y - 5;
  const d = Math.hypot(dx, dy);
  if (d <= 2.3) return 'Y';
  if (d <= 3.3) return 'O';
  const onRay = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  return onRay && d >= 4 && d <= 5.7 ? 'R' : '.';
});
const SUN_PALETTE = { Y: '#ffe45c', O: '#f3a21f', R: '#ffd23a' };

const MOON_ROWS = buildGrid(11, 11, (x, y) => {
  const d1 = Math.hypot(x - 5, y - 5);
  const d2 = Math.hypot(x - 7.4, y - 3.6);
  if (d1 > 4.7 || d2 <= 3.9) return '.';
  return d1 > 3.8 ? 'm' : 'M';
});
const MOON_PALETTE = { M: '#f1f4ff', m: '#aeb8e6' };

const UNKNOWN_ROWS = buildGrid(16, 16, (x, y) => {
  if (x < 2 || y < 2 || x > 13 || y > 13) return '.';
  return x === 2 || y === 2 || x === 13 || y === 13 ? 'k' : 'g';
});
const UNKNOWN_PALETTE = { k: '#2b2b36', g: '#8b8b96' };

const ITEM_ICONS = {
  [ITEM.SWORD]: { rows: SWORD_ROWS, palette: SWORD_PALETTE },
  [ITEM.PORK]: { rows: PORK_ROWS, palette: PORK_PALETTE },
};

const svgCache = new Map();
function cached(key, make) {
  let svg = svgCache.get(key);
  if (svg === undefined) {
    svg = make();
    svgCache.set(key, svg);
  }
  return svg;
}

/** SVG de um coração: 'full' | 'half' | 'empty' (estado inválido = vazio). */
export function heartSvg(state) {
  const s = state === 'full' || state === 'half' ? state : 'empty';
  return cached('heart:' + s, () => {
    const rows = HEART_ROWS.map((row) => {
      if (s === 'full') return row;
      let out = '';
      for (let x = 0; x < row.length; x++) {
        const keep = s === 'half' && x <= HEART_HALF_COL;
        out += keep ? row[x] : row[x].toLowerCase();
      }
      return out;
    });
    return gridToSvg(rows, HEART_PALETTE);
  });
}

/** SVG do ícone de um item (espada, carne); item desconhecido = caixa cinza. */
export function itemIconSvg(item) {
  const known = typeof item === 'string' && Object.hasOwn(ITEM_ICONS, item);
  return cached('item:' + (known ? item : '?'), () =>
    known
      ? gridToSvg(ITEM_ICONS[item].rows, ITEM_ICONS[item].palette)
      : gridToSvg(UNKNOWN_ROWS, UNKNOWN_PALETTE)
  );
}

/** Cubo isométrico (topo claro, lado esquerdo base, lado direito escuro) na cor do bloco. */
export function blockIconSvg(color) {
  const c = cssColor(color);
  return cached('block:' + c, () => {
    const top = shadeColor(c, 0.3);
    const right = shadeColor(c, -0.32);
    return (
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      `<polygon points="8,1 15,4.5 8,8 1,4.5" fill="${top}"/>` +
      `<polygon points="1,4.5 8,8 8,15 1,11.5" fill="${c}"/>` +
      `<polygon points="15,4.5 8,8 8,15 15,11.5" fill="${right}"/>` +
      '<path d="M8 1L15 4.5V11.5L8 15L1 11.5V4.5Z M1 4.5L8 8L15 4.5 M8 8V15" ' +
      'fill="none" stroke="rgba(0,0,0,.55)" stroke-width=".8" stroke-linejoin="round"/>' +
      '</svg>'
    );
  });
}

export function sunSvg() {
  return cached('sun', () => gridToSvg(SUN_ROWS, SUN_PALETTE));
}
export function moonSvg() {
  return cached('moon', () => gridToSvg(MOON_ROWS, MOON_PALETTE));
}

/** Grades cruas (para testes e para a galeria). */
export const PIXEL_ART = Object.freeze({
  heart: HEART_ROWS,
  sword: SWORD_ROWS,
  pork: PORK_ROWS,
  sun: SUN_ROWS,
  moon: MOON_ROWS,
});

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * Liga o HUD aos elementos do `index.html` (cria os que faltarem) e devolve a
 * API do contrato (brief §4.7) mais dois extras: `setMode` e `setMenuState`.
 *
 * @param {{ doc?: Document }} [opts]  `doc` só existe para testes com DOM falso.
 */
export function createHud({ doc = globalThis.document } = {}) {
  const body = doc.body;

  function ensure(id, tag = 'div', parent = body) {
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement(tag);
      el.id = id;
      parent.appendChild(el);
    }
    return el;
  }

  const crosshairEl = ensure('crosshair');
  const hudEl = ensure('hud');
  const clockEl = ensure('clock');
  const heartsEl = ensure('hearts');
  const hotbarEl = ensure('hotbar');
  const toastsEl = ensure('toasts');
  const flashEl = ensure('damage-flash');
  const overlayEl = ensure('overlay');
  const subEl = ensure('menu-sub', 'p', overlayEl);
  const survivalBtn = ensure('btn-survival', 'button', overlayEl);
  const creativeBtn = ensure('btn-creative', 'button', overlayEl);
  const newWorldBtn = ensure('btn-new-world', 'button', overlayEl);
  const deathEl = ensure('death');
  const deathDaysEl = ensure('death-days', 'b', deathEl);
  const deathKillsEl = ensure('death-kills', 'b', deathEl);
  const respawnBtn = ensure('btn-respawn', 'button', deathEl);

  // --- Corações ---
  const heartEls = [];
  heartsEl.innerHTML = '';
  for (let i = 0; i < HEART_COUNT; i++) {
    const heart = doc.createElement('span');
    heart.className = 'heart';
    heartsEl.appendChild(heart);
    heartEls.push(heart);
  }
  const heartStates = new Array(HEART_COUNT).fill(null);
  let lastHp = null;
  let lastMaxHp = null;
  let lowState = null;

  function setHealth(hp, maxHp = HEART_COUNT * HP_PER_HEART) {
    if (hp === lastHp && maxHp === lastMaxHp) return;
    lastHp = hp;
    lastMaxHp = maxHp;
    const states = heartsFor(hp, maxHp);
    for (let i = 0; i < HEART_COUNT; i++) {
      if (states[i] === heartStates[i]) continue;
      heartStates[i] = states[i];
      heartEls[i].dataset.state = states[i];
      heartEls[i].innerHTML = heartSvg(states[i]);
    }
    const low = isLowHealth(hp, maxHp);
    if (low !== lowState) {
      lowState = low;
      heartsEl.classList.toggle('low', low);
    }
    const now = Math.max(0, Number(hp) || 0);
    heartsEl.setAttribute('aria-label', `Vida: ${now} de ${Number(maxHp) || 0}`);
  }
  setHealth(HEART_COUNT * HP_PER_HEART, HEART_COUNT * HP_PER_HEART);

  // --- Hotbar ---
  const slotEls = [];
  let hotbarFresh = true;

  function makeSlot() {
    const slot = doc.createElement('div');
    slot.className = 'slot';
    const key = doc.createElement('span');
    key.className = 'key';
    const icon = doc.createElement('div');
    icon.className = 'icon';
    const count = doc.createElement('b');
    count.className = 'count';
    slot.appendChild(key);
    slot.appendChild(icon);
    slot.appendChild(count);
    return { slot, key, icon, count, sig: null, active: null, empty: null };
  }

  /**
   * @param {Array<{label?: string, color?: number|string|null, item?: string|null,
   *   count?: number|null}>} slots
   * @param {number} selectedIndex
   */
  function setHotbar(slots, selectedIndex) {
    const list = Array.isArray(slots) ? slots : [];
    if (hotbarFresh) {
      hotbarFresh = false;
      hotbarEl.innerHTML = ''; // descarta slots de uma versão anterior da página
    }
    while (slotEls.length < list.length) {
      const s = makeSlot();
      hotbarEl.appendChild(s.slot);
      slotEls.push(s);
    }
    while (slotEls.length > list.length) slotEls.pop().slot.remove();

    for (let i = 0; i < list.length; i++) {
      const data = list[i] || {};
      const s = slotEls[i];
      const key =
        data.label !== undefined && data.label !== null && String(data.label) !== ''
          ? String(data.label)
          : slotKeyLabel(i);
      const text = countText(data);
      const empty = typeof data.count === 'number' && data.count <= 0;
      const iconKey = data.item ? 'i:' + data.item : data.color != null ? 'c:' + cssColor(data.color) : '-';
      const sig = key + '|' + iconKey + '|' + text;
      if (sig !== s.sig) {
        s.sig = sig;
        s.key.textContent = key;
        s.count.textContent = text;
        s.icon.innerHTML = data.item
          ? itemIconSvg(data.item)
          : data.color != null
            ? blockIconSvg(data.color)
            : '';
      }
      if (empty !== s.empty) {
        s.empty = empty;
        s.slot.classList.toggle('empty', empty);
      }
      const active = i === selectedIndex;
      if (active !== s.active) {
        s.active = active;
        s.slot.classList.toggle('active', active);
      }
    }
  }

  // --- Relógio ---
  const clockIconEl = doc.createElement('span');
  clockIconEl.className = 'clock-icon';
  const clockTextEl = doc.createElement('span');
  clockTextEl.className = 'clock-text';
  clockEl.innerHTML = '';
  clockEl.appendChild(clockIconEl);
  clockEl.appendChild(clockTextEl);
  let lastClockText = null;
  let lastNight = null;

  /** @param {{day:number, phaseName:string, night:boolean}} clock */
  function setClock({ day, phaseName, night } = {}) {
    const text = clockLabel(day, phaseName);
    if (text !== lastClockText) {
      lastClockText = text;
      clockTextEl.textContent = text;
    }
    const isNight = !!night;
    if (isNight !== lastNight) {
      lastNight = isNight;
      clockIconEl.innerHTML = isNight ? moonSvg() : sunSvg();
      clockEl.classList.toggle('night', isNight);
    }
  }
  setClock({ day: 1, phaseName: 'Amanhecer', night: false });

  // --- Flash de dano ---
  function flashDamage() {
    flashEl.classList.remove('flash');
    void flashEl.offsetWidth; // força reflow: reinicia a animação se já estava rodando
    flashEl.classList.add('flash');
  }

  // --- Toasts ---
  const liveToasts = [];

  function dismissToast(t, immediately) {
    const at = liveToasts.indexOf(t);
    if (at < 0) return;
    liveToasts.splice(at, 1);
    clearTimeout(t.timer);
    if (immediately) {
      t.el.remove();
      return;
    }
    t.el.classList.add('out');
    setTimeout(() => t.el.remove(), TOAST_FADE_MS);
  }

  function toast(text, ms = TOAST_MS) {
    const msg = text === undefined || text === null ? '' : String(text);
    if (!msg) return;
    const life = Number.isFinite(ms) && ms > 0 ? ms : TOAST_MS;
    const el = doc.createElement('div');
    el.className = 'toast';
    el.textContent = msg; // nunca innerHTML: o texto pode vir de qualquer evento
    toastsEl.appendChild(el);
    const t = { el, timer: null };
    liveToasts.push(t);
    while (liveToasts.length > MAX_TOASTS) dismissToast(liveToasts[0], true);
    t.timer = setTimeout(() => dismissToast(t, false), life);
  }

  // --- Em jogo / menu / morte ---
  const gameParts = [crosshairEl, hudEl, clockEl, heartsEl, hotbarEl];
  let deathShown = false;

  /** Em jogo: mira, hotbar, corações, relógio e FPS visíveis, menu escondido. */
  function setInGame(flag) {
    const on = !!flag;
    for (const el of gameParts) el.classList.toggle('hidden', !on);
    overlayEl.classList.toggle('hidden', on);
  }

  function showDeath(summary) {
    const { days, kills } = deathSummary(summary);
    deathDaysEl.textContent = String(days);
    deathKillsEl.textContent = String(kills);
    const labels = deathLabels({ days, kills });
    if (deathDaysEl.nextElementSibling) deathDaysEl.nextElementSibling.textContent = labels.days;
    if (deathKillsEl.nextElementSibling) deathKillsEl.nextElementSibling.textContent = labels.kills;
    deathEl.classList.remove('hidden');
    body.classList.add('dead'); // o CSS esconde o menu por baixo da tela de morte
    if (deathShown) return; // idempotente: só a primeira chamada mexe em foco/mouse
    deathShown = true;
    try {
      doc.exitPointerLock?.(); // sem soltar o mouse não dá para clicar em "Renascer"
    } catch {
      /* sem pointer lock ativo: nada a soltar */
    }
    respawnBtn.focus?.({ preventScroll: true });
  }

  function hideDeath() {
    deathShown = false;
    deathEl.classList.add('hidden');
    body.classList.remove('dead');
  }

  // --- Extras ---
  /** Criativo não toma dano: esconde os corações (`data-mode` no <body>). */
  function setMode(mode) {
    if (mode === MENU_MODE.SURVIVAL || mode === MENU_MODE.CREATIVE) body.dataset.mode = mode;
    else delete body.dataset.mode;
  }

  /** Menu em pausa: marca o modo atual com "Continuar" e ajusta o subtítulo. */
  function setMenuState({ paused = false, mode = null } = {}) {
    overlayEl.classList.toggle('paused', !!paused);
    subEl.textContent = paused ? SUB_TEXT_PAUSED : SUB_TEXT;
    for (const [m, btn] of [
      [MENU_MODE.SURVIVAL, survivalBtn],
      [MENU_MODE.CREATIVE, creativeBtn],
    ]) {
      const current = !!paused && mode === m;
      btn.classList.toggle('current', current);
      if (current) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
  }

  // --- Menu ---
  const handlers = { onStart: null, onNewWorld: null, onRespawn: null };
  let menuWired = false;

  /**
   * Liga os botões. Religar só troca os handlers (os `addEventListener` são
   * registrados uma vez), então nunca dispara em dobro. O clique não borbulha
   * até o overlay (que, no `main.js` da Parte 1, travava o mouse sozinho).
   */
  function bindMenu({ onStart, onNewWorld, onRespawn } = {}) {
    handlers.onStart = typeof onStart === 'function' ? onStart : null;
    handlers.onNewWorld = typeof onNewWorld === 'function' ? onNewWorld : null;
    handlers.onRespawn = typeof onRespawn === 'function' ? onRespawn : null;
    if (menuWired) return;
    menuWired = true;
    const wire = (el, fire) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fire();
      });
    wire(survivalBtn, () => handlers.onStart?.(MENU_MODE.SURVIVAL));
    wire(creativeBtn, () => handlers.onStart?.(MENU_MODE.CREATIVE));
    wire(newWorldBtn, () => handlers.onNewWorld?.());
    wire(respawnBtn, () => handlers.onRespawn?.());
  }

  return {
    setHealth,
    setHotbar,
    setClock,
    flashDamage,
    toast,
    setInGame,
    showDeath,
    hideDeath,
    bindMenu,
    setMode,
    setMenuState,
  };
}
