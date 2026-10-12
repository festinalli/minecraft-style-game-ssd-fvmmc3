// Galeria de HUD (feature 015): monta o HUD real e deixa exercitar cada estado.
// Abra com `npx vite` em /dev/hud.html. O visual vem do index.html de verdade
// (uma só fonte de verdade): a galeria busca o <style> e o markup de lá.
// Dica: ?panel=0 começa com o painel recolhido (bom para screenshots).

import { createHud, phaseLabel } from '../src/ui/hud.js';
import { createAudio, SOUND_NAMES } from '../src/audio.js';
import { HOTBAR_SLOTS, ITEM } from '../src/game/items.js';
import { BLOCK_COLOR } from '../src/blocks.js';

// --- Monta o index.html real dentro desta página ---
const html = await (await fetch(new URL('../index.html', import.meta.url))).text();
const parsed = new DOMParser().parseFromString(html, 'text/html');
for (const style of parsed.querySelectorAll('style')) document.head.appendChild(document.importNode(style, true));
const panel = document.getElementById('dev-panel');
for (const el of [...parsed.body.children]) {
  if (el.tagName === 'SCRIPT') continue;
  document.body.insertBefore(document.importNode(el, true), document.getElementById('dev-toggle'));
}

const hud = createHud();
const audio = createAudio();
const stage = document.getElementById('stage');
window.gallery = { hud, audio }; // só nesta página de desenvolvimento (não entra no build do jogo)

// --- Estado da galeria ---
const state = { hp: 20, maxHp: 20, selected: 0, day: 1, inGame: true, menu: false, mode: 'survival', muted: false };
const SURVIVAL_COUNTS = [0, 0, 0, 0, 0, 0, 8, 0, 1, 3];
const CREATIVE_COUNTS = HOTBAR_SLOTS.map(() => Infinity);
let counts = SURVIVAL_COUNTS;

function slotsFor(list) {
  return HOTBAR_SLOTS.map((slot, i) => ({
    label: String((i + 1) % 10),
    color: slot.kind === 'block' ? BLOCK_COLOR[slot.block] : null,
    item: slot.kind === 'item' ? slot.item : null,
    count: slot.kind === 'item' && slot.item === ITEM.SWORD ? null : list[i],
  }));
}

const logEl = document.createElement('div');
logEl.id = 'dev-log';
let logLines = [];
function log(msg) {
  logLines = [msg, ...logLines].slice(0, 4);
  logEl.textContent = logLines.join('\n');
}

function refreshHealth() {
  hud.setHealth(state.hp, state.maxHp);
  const range = document.getElementById('hp-range');
  if (range) range.value = String(state.hp);
  log(`vida ${state.hp}/${state.maxHp}`);
}
function refreshHotbar() {
  hud.setHotbar(slotsFor(counts), state.selected);
}
function refreshClock(phase, night) {
  hud.setClock({ day: state.day, phaseName: phaseLabel(phase), night });
  log(`relógio: dia ${state.day}, fase ${phaseLabel(phase)}${night ? ' (noite)' : ''}`);
}
function applyView() {
  hud.setInGame(state.inGame && !state.menu);
  hud.setMenuState({ paused: state.menu, mode: state.mode });
}

// --- Painel ---
function section(title, ...nodes) {
  const h = document.createElement('h4');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(...nodes);
  panel.append(h, row);
}
function btn(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', () => {
    audio.resume(); // o clique é o gesto que libera o áudio
    fn();
  });
  return b;
}

const range = document.createElement('input');
range.type = 'range';
range.id = 'hp-range';
range.min = '0';
range.max = '20';
range.value = '20';
range.addEventListener('input', () => {
  state.hp = Number(range.value);
  refreshHealth();
});
section(
  'Vida',
  range,
  btn('−1', () => {
    state.hp = Math.max(0, state.hp - 1);
    refreshHealth();
  }),
  btn('+1', () => {
    state.hp = Math.min(state.maxHp, state.hp + 1);
    refreshHealth();
  }),
  btn('−3 + flash', () => {
    state.hp = Math.max(0, state.hp - 3);
    refreshHealth();
    hud.flashDamage();
    audio.play('hurt');
  }),
  btn('Cheia', () => {
    state.hp = state.maxHp;
    refreshHealth();
  }),
  btn('maxHp 10', () => {
    state.maxHp = state.maxHp === 20 ? 10 : 20;
    state.hp = Math.min(state.hp, state.maxHp);
    refreshHealth();
  })
);

section(
  'Hotbar',
  btn('Sobrevivência', () => {
    counts = SURVIVAL_COUNTS;
    refreshHotbar();
    log('hotbar: kit de sobrevivência');
  }),
  btn('Criativo ∞', () => {
    counts = CREATIVE_COUNTS;
    refreshHotbar();
    log('hotbar: criativo (∞)');
  }),
  btn('Contagens', () => {
    counts = [999, 64, 1, 12, 0, 5, 8, 100, 1, 3];
    refreshHotbar();
    log('hotbar: 999 64 1 12 0 5 8 100 …');
  }),
  btn('Zerar', () => {
    counts = HOTBAR_SLOTS.map(() => 0);
    refreshHotbar();
    log('hotbar: tudo 0 (esmaecido)');
  }),
  btn('◀', () => {
    state.selected = (state.selected + HOTBAR_SLOTS.length - 1) % HOTBAR_SLOTS.length;
    refreshHotbar();
  }),
  btn('▶', () => {
    state.selected = (state.selected + 1) % HOTBAR_SLOTS.length;
    refreshHotbar();
  })
);

section(
  'Relógio',
  btn('Amanhecer', () => refreshClock(0, false)),
  btn('Dia', () => refreshClock(0.25, false)),
  btn('Entardecer', () => refreshClock(0.5, false)),
  btn('Noite', () => refreshClock(0.75, true)),
  btn('+1 dia', () => {
    state.day += 1;
    refreshClock(0.25, false);
  }),
  btn('Dia 123', () => {
    state.day = 123;
    refreshClock(0.75, true);
  })
);

section(
  'Efeitos',
  btn('Flash de dano', () => hud.flashDamage()),
  btn('Toast', () => hud.toast('+1 Carne')),
  btn('5 toasts', () => {
    for (let i = 1; i <= 5; i++) hud.toast(`+${i} Carne`);
  }),
  btn('Toast longo', () => hud.toast('Texto bem longo para testar a quebra de linha do aviso em telas estreitas', 4000)),
  btn('Toast <b>html</b>', () => hud.toast('<b>não é html</b> & <i>tags</i>'))
);

section(
  'Telas',
  btn('Morte', () => {
    hud.showDeath({ days: 3, kills: 5 });
    log('morte: 3 dias, 5 abates');
  }),
  btn('Morte (nada)', () => hud.showDeath({})),
  btn('Esconder morte', () => hud.hideDeath()),
  btn('Menu on/off', () => {
    state.menu = !state.menu;
    applyView();
  }),
  btn('Em jogo on/off', () => {
    state.inGame = !state.inGame;
    applyView();
  }),
  btn('Modo: survival', () => {
    state.mode = 'survival';
    hud.setMode('survival');
    applyView();
  }),
  btn('Modo: creative', () => {
    state.mode = 'creative';
    hud.setMode('creative');
    applyView();
  })
);

section(
  'Fundo',
  btn('Dia', () => (stage.className = '')),
  btn('Noite', () => (stage.className = 'night')),
  btn('Neve', () => (stage.className = 'snow')),
  btn('Caverna', () => (stage.className = 'cave'))
);

section(
  'Som',
  ...SOUND_NAMES.map((name) =>
    btn(name, () => {
      const ok = audio.play(name);
      log(`som ${name}: ${ok ? 'tocou' : 'sem áudio (mudo/parado)'} · vozes ${audio.activeVoices()}`);
    })
  ),
  btn('30× explode', () => {
    for (let i = 0; i < 30; i++) audio.play('explode');
    log(`30× explode · vozes ativas ${audio.activeVoices()} (máx. 12)`);
  }),
  btn('Mudo', () => {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    log(state.muted ? 'áudio mudo' : 'áudio ligado');
  })
);
panel.append(logEl);

// --- Menu ligado com handlers que só registram no log ---
hud.bindMenu({
  onStart: (mode) => {
    state.mode = mode;
    state.menu = false;
    state.inGame = true;
    hud.setMode(mode);
    applyView();
    log(`onStart('${mode}')`);
  },
  onNewWorld: () => log('onNewWorld()'),
  onRespawn: () => {
    hud.hideDeath();
    state.hp = state.maxHp;
    refreshHealth();
    applyView();
    log('onRespawn()');
  },
});

// --- Teclado: 1..9,0 escolhem o slot, como no jogo ---
document.addEventListener('keydown', (e) => {
  if (!/^[0-9]$/.test(e.key) || e.target instanceof HTMLInputElement) return;
  state.selected = (Number(e.key) + 9) % 10;
  refreshHotbar();
});

// --- Painel recolhido? ---
const toggle = document.getElementById('dev-toggle');
const params = new URLSearchParams(location.search);
if (params.get('panel') === '0' || window.innerWidth < 600) panel.classList.add('collapsed');
toggle.addEventListener('click', () => panel.classList.toggle('collapsed'));

// --- Estado inicial ---
hud.setMode('survival');
refreshHealth();
refreshHotbar();
refreshClock(0.25, false);
applyView();
log('galeria pronta');
