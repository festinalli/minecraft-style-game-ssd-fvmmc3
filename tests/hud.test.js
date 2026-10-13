import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HEART_COUNT,
  LOW_HP,
  MAX_TOASTS,
  TOAST_MS,
  PIXEL_ART,
  heartsFor,
  isLowHealth,
  phaseLabel,
  clockLabel,
  formatCount,
  countText,
  slotKeyLabel,
  deathSummary,
  deathLabels,
  cssColor,
  shadeColor,
  gridToSvg,
  heartSvg,
  itemIconSvg,
  blockIconSvg,
  sunSvg,
  moonSvg,
  createHud,
} from '../src/ui/hud.js';
import { phaseOf, isNight, DAY_LENGTH, dayNumber } from '../src/game/time.js';
import { HOTBAR_SLOTS, ITEM, MAX_STACK } from '../src/game/items.js';
import { BLOCK_COLOR } from '../src/blocks.js';

// ===========================================================================
// Funções puras
// ===========================================================================

test('heartsFor: todo HP de 0 a 20 dá 10 corações, 2 HP = 1 coração, ímpar = meio', () => {
  for (let hp = 0; hp <= 20; hp++) {
    const h = heartsFor(hp, 20);
    assert.equal(h.length, HEART_COUNT, `hp ${hp}: sempre 10 entradas`);
    const full = h.filter((s) => s === 'full').length;
    const half = h.filter((s) => s === 'half').length;
    const empty = h.filter((s) => s === 'empty').length;
    assert.equal(full, Math.floor(hp / 2), `hp ${hp}: cheios`);
    assert.equal(half, hp % 2, `hp ${hp}: HP ímpar => exatamente um meio coração`);
    assert.equal(full + half + empty, HEART_COUNT);
    // ordem: cheio -> meio -> vazio
    const expected = [...Array(full).fill('full'), ...Array(half).fill('half'), ...Array(empty).fill('empty')];
    assert.deepEqual(h, expected, `hp ${hp}: ordenado`);
  }
});

test('heartsFor: casos de borda e entradas inválidas', () => {
  assert.deepEqual(heartsFor(20, 20), Array(10).fill('full'));
  assert.deepEqual(heartsFor(0, 20), Array(10).fill('empty'));
  // clamp
  assert.deepEqual(heartsFor(-5, 20), Array(10).fill('empty'));
  assert.deepEqual(heartsFor(99, 20), Array(10).fill('full'));
  assert.deepEqual(heartsFor(Infinity, 20), Array(10).fill('full'));
  // inválidos nunca lançam e viram "sem vida"
  for (const bad of [Number.NaN, undefined, null, 'x']) {
    assert.deepEqual(heartsFor(bad, 20), Array(10).fill('empty'), String(bad));
  }
  assert.deepEqual(heartsFor(10, 0), Array(10).fill('empty'), 'maxHp 0');
  assert.deepEqual(heartsFor(10, -4), Array(10).fill('empty'), 'maxHp negativo');
  assert.deepEqual(heartsFor(10, Number.NaN), Array(10).fill('empty'), 'maxHp NaN');
  // sem maxHp: escala padrão de 20
  assert.deepEqual(heartsFor(7), heartsFor(7, 20));
  // retorna um array novo a cada chamada (sem estado compartilhado)
  const a = heartsFor(5, 20);
  a[0] = 'empty';
  assert.equal(heartsFor(5, 20)[0], 'full');
});

test('heartsFor: HP positivo nunca mostra tudo vazio; maxHp diferente de 20 é reescalado', () => {
  assert.deepEqual(heartsFor(0.01, 20).slice(0, 2), ['half', 'empty'], 'fração mínima = meio coração');
  assert.equal(heartsFor(0.0001, 1000)[0], 'half');
  // maxHp 10: cada HP vale um coração inteiro
  assert.deepEqual(heartsFor(5, 10), [...Array(5).fill('full'), ...Array(5).fill('empty')]);
  assert.deepEqual(heartsFor(10, 10), Array(10).fill('full'));
  assert.deepEqual(heartsFor(1, 10), ['full', ...Array(9).fill('empty')]);
  // maxHp 40: 4 HP = 1 coração
  assert.deepEqual(heartsFor(20, 40), [...Array(5).fill('full'), ...Array(5).fill('empty')]);
  assert.equal(heartsFor(1, 40)[0], 'half', '1/40 = meio meio-coração: arredonda para cima');
  assert.deepEqual(heartsFor(3, 40).slice(0, 2), ['full', 'empty'], '1,5 meio-coração arredonda para cima (nunca mostra menos do que tem)');
  // sem erro de ponto flutuante virando meio coração extra: n/10 da vida = exatamente n corações
  assert.deepEqual(heartsFor(3, 30), ['full', ...Array(9).fill('empty')]);
  for (let maxHp = 1; maxHp <= 300; maxHp++) {
    for (let n = 0; n <= HEART_COUNT; n++) {
      const got = heartsFor((maxHp * n) / HEART_COUNT, maxHp);
      assert.deepEqual(
        got,
        [...Array(n).fill('full'), ...Array(HEART_COUNT - n).fill('empty')],
        `maxHp ${maxHp}, ${n}/10 da vida`
      );
    }
  }
});

test('isLowHealth: hp <= 4 (escala de 20) treme os corações', () => {
  assert.equal(LOW_HP, 4);
  for (let hp = 0; hp <= 20; hp++) assert.equal(isLowHealth(hp, 20), hp <= 4, `hp ${hp}`);
  assert.equal(isLowHealth(2, 10), true, 'mesma proporção em maxHp 10');
  assert.equal(isLowHealth(3, 10), false);
});

test('phaseLabel: as quatro fases e o wrap do ciclo', () => {
  assert.equal(phaseLabel(0), 'Amanhecer');
  assert.equal(phaseLabel(0.25), 'Dia');
  assert.equal(phaseLabel(0.5), 'Entardecer');
  assert.equal(phaseLabel(0.75), 'Noite');
  // dá a volta fora de [0,1)
  assert.equal(phaseLabel(1.75), 'Noite');
  assert.equal(phaseLabel(-0.25), 'Noite');
  assert.equal(phaseLabel(2), 'Amanhecer');
  // valor inválido não lança e cai numa fase válida
  for (const bad of [Number.NaN, undefined, 'x', Infinity]) {
    assert.ok(['Amanhecer', 'Dia', 'Entardecer', 'Noite'].includes(phaseLabel(bad)), String(bad));
  }
});

test('phaseLabel varre o ciclo: só 4 nomes, na ordem certa, e Noite == isNight (time.js)', () => {
  const order = ['Amanhecer', 'Dia', 'Entardecer', 'Noite'];
  const seen = [];
  for (let i = 0; i < 3600; i++) {
    const seconds = (i / 3600) * DAY_LENGTH;
    const label = phaseLabel(phaseOf(seconds));
    assert.ok(order.includes(label), `fase ${i / 3600}: ${label}`);
    // a noite do HUD é exatamente a noite do jogo
    assert.equal(label === 'Noite', isNight(seconds), `fase ${(i / 3600).toFixed(4)}: Noite <=> isNight`);
    if (seen.at(-1) !== label) seen.push(label);
  }
  // começando em 0: Amanhecer, Dia, Entardecer, Noite, e volta ao Amanhecer no fim do ciclo
  assert.deepEqual(seen.slice(0, 4), order);
  assert.ok(seen.length <= 6, 'transições limpas (sem tremer entre fases)');
});

test('clockLabel: "Dia N · fase", Dia vira "Pleno dia" e entradas ruins não quebram', () => {
  assert.equal(clockLabel(1, 'Amanhecer'), 'Dia 1 · Amanhecer');
  assert.equal(clockLabel(3, 'Entardecer'), 'Dia 3 · Entardecer');
  assert.equal(clockLabel(12, 'Noite'), 'Dia 12 · Noite');
  assert.equal(clockLabel(2, 'Dia'), 'Dia 2 · Pleno dia', 'evita "Dia 2 · Dia"');
  assert.equal(clockLabel(0, 'Noite'), 'Dia 1 · Noite', 'o dia mínimo é 1');
  assert.equal(clockLabel(-4, 'Noite'), 'Dia 1 · Noite');
  assert.equal(clockLabel(7.9, 'Noite'), 'Dia 7 · Noite');
  assert.equal(clockLabel(undefined, undefined), 'Dia 1');
  assert.equal(clockLabel('5', '  '), 'Dia 5');
  assert.equal(clockLabel(4, '__proto__'), 'Dia 4 · __proto__', 'nome desconhecido é mostrado como veio');
  // integra com time.js: o que o main passa vira o texto do relógio
  const s = 2.6 * DAY_LENGTH;
  assert.equal(clockLabel(dayNumber(s), phaseLabel(phaseOf(s))).startsWith('Dia 3 · '), true);
});

test('formatCount: ∞, zero, vazio, inteiros e teto de pilha', () => {
  assert.equal(formatCount(Infinity), '∞');
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1), '1');
  assert.equal(formatCount(64), '64');
  assert.equal(formatCount(MAX_STACK), String(MAX_STACK));
  assert.equal(formatCount(MAX_STACK + 1), `${MAX_STACK}+`, 'teto lido de MAX_STACK, não copiado');
  assert.equal(formatCount(123456), `${MAX_STACK}+`);
  assert.equal(formatCount(7.9), '7', 'contagens são inteiras');
  assert.equal(formatCount(-3), '0');
  assert.equal(formatCount(-Infinity), '0');
  for (const none of [null, undefined, Number.NaN, '12', {}, true]) assert.equal(formatCount(none), '', String(none));
});

test('countText: item permanente com ∞ não mostra número; bloco com ∞ mostra', () => {
  assert.equal(countText({ color: 0x6ab04c, count: Infinity }), '∞', 'Criativo: bloco infinito');
  assert.equal(countText({ item: ITEM.SWORD, count: Infinity }), '', 'espada não tem número');
  assert.equal(countText({ item: ITEM.SWORD, count: null }), '');
  assert.equal(countText({ item: ITEM.PORK, count: 3 }), '3');
  assert.equal(countText({ item: ITEM.PORK, count: 0 }), '0');
  assert.equal(countText({ color: 1, count: 0 }), '0');
  assert.equal(countText({}), '');
  assert.equal(countText(null), '');
  assert.equal(countText(undefined), '');
});

test('slotKeyLabel: 1..9 e depois 0', () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => slotKeyLabel(i)),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
  );
  assert.equal(HOTBAR_SLOTS.length, 10, 'o HUD cobre exatamente os slots de items.js');
});

test('deathSummary: sempre inteiros >= 0', () => {
  assert.deepEqual(deathSummary({ days: 3, kills: 5 }), { days: 3, kills: 5 });
  assert.deepEqual(deathSummary({ days: 3.9, kills: 5.2 }), { days: 3, kills: 5 });
  assert.deepEqual(deathSummary({ days: -2, kills: -1 }), { days: 0, kills: 0 });
  assert.deepEqual(deathSummary({ days: '4', kills: '2' }), { days: 4, kills: 2 });
  assert.deepEqual(deathSummary({}), { days: 0, kills: 0 });
  assert.deepEqual(deathSummary(null), { days: 0, kills: 0 });
  assert.deepEqual(deathSummary(undefined), { days: 0, kills: 0 });
  assert.deepEqual(deathSummary({ days: Number.NaN, kills: Infinity }), { days: 0, kills: 0 });
});

test('cssColor / shadeColor: normaliza e nunca repassa texto arbitrário', () => {
  assert.equal(cssColor(0x6ab04c), '#6ab04c');
  assert.equal(cssColor(0xff), '#0000ff');
  assert.equal(cssColor(0), '#000000');
  assert.equal(cssColor(0x1ffffff), '#ffffff', 'bits acima de 24 são descartados');
  assert.equal(cssColor('#ABC'), '#aabbcc');
  assert.equal(cssColor(' #6AB04C '), '#6ab04c');
  assert.equal(cssColor('red'), '#888888');
  assert.equal(cssColor('#12345'), '#888888');
  assert.equal(cssColor('#fff;background:url(//evil)'), '#888888', 'sem injeção de CSS');
  assert.equal(cssColor('"><script>alert(1)</script>'), '#888888', 'sem injeção de SVG/HTML');
  assert.equal(cssColor(Number.NaN), '#888888');
  assert.equal(cssColor(null), '#888888');
  assert.equal(cssColor(undefined, '#123456'), '#123456', 'fallback customizável');

  assert.equal(shadeColor('#808080', 0), '#808080');
  assert.equal(shadeColor('#808080', 1), '#ffffff');
  assert.equal(shadeColor('#808080', -1), '#000000');
  assert.equal(shadeColor('#000000', 0.5), '#808080');
  assert.equal(shadeColor(0xff0000, 0.5), '#ff8080');
  assert.equal(shadeColor('#ff0000', -0.5), '#800000');
  assert.equal(shadeColor('#336699', 5), '#ffffff', 'amount é limitado a [-1,1]');
});

// ---------------------------------------------------------------------------
// Pixel art -> SVG
// ---------------------------------------------------------------------------

function svgStats(svg) {
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="([^"]+)"\/>/g)];
  return { rects, cells: rects.reduce((n, m) => n + Number(m[3]), 0) };
}

test('pixel art: grades retangulares e todo caractere tem cor na paleta', () => {
  for (const [name, rows] of Object.entries(PIXEL_ART)) {
    assert.ok(rows.length >= 9, name);
    assert.equal(new Set(rows.map((r) => r.length)).size, 1, `${name}: todas as linhas têm a mesma largura`);
  }
  // cada célula pintada vira exatamente uma célula de <rect> (paleta completa, sem 'undefined')
  const painted = (rows) => rows.join('').replace(/\./g, '').length;
  const svgs = {
    heart: heartSvg('full'),
    sword: itemIconSvg(ITEM.SWORD),
    pork: itemIconSvg(ITEM.PORK),
    sun: sunSvg(),
    moon: moonSvg(),
  };
  for (const [name, svg] of Object.entries(svgs)) {
    const { cells, rects } = svgStats(svg);
    assert.equal(cells, painted(PIXEL_ART[name]), `${name}: células pintadas == células do SVG`);
    assert.ok(rects.length > 0 && !svg.includes('undefined'), name);
    assert.ok(rects.length < cells, `${name}: corridas horizontais agrupadas`);
  }
});

test('gridToSvg: viewBox, corridas agrupadas, "." vazio e caractere fora da paleta ignorado', () => {
  const svg = gridToSvg(['..aab', 'b...a'], { a: '#111111', b: '#222222' });
  assert.ok(svg.startsWith('<svg viewBox="0 0 5 2"') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.deepEqual(
    svgStats(svg).rects.map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), m[4]]),
    [[2, 0, 2, '#111111'], [4, 0, 1, '#222222'], [0, 1, 1, '#222222'], [4, 1, 1, '#111111']]
  );
  assert.equal(svgStats(gridToSvg(['zzz'], { a: '#fff' })).rects.length, 0, 'chave fora da paleta = vazio');
  assert.equal(svgStats(gridToSvg(['__proto__'.slice(0, 3)], {})).rects.length, 0, 'paleta vazia não herda de Object');
});

test('corações: cheio, meio e vazio são diferentes; meio = metade cheia + metade vazia', () => {
  const full = heartSvg('full');
  const half = heartSvg('half');
  const empty = heartSvg('empty');
  assert.equal(new Set([full, half, empty]).size, 3);
  assert.equal(heartSvg('qualquer coisa'), empty, 'estado inválido = vazio');
  assert.equal(heartSvg(undefined), empty);
  assert.equal(heartSvg('full'), full, 'determinístico (cache devolve o mesmo)');
  // o cheio tem o vermelho do coração; o vazio não
  assert.ok(full.includes('#e3262e') && !empty.includes('#e3262e'));
  // o meio coração tem vermelho só nas colunas 0..4 e vazio (translúcido) nas demais
  const redCols = svgStats(half).rects.filter((m) => m[4] === '#e3262e');
  assert.ok(redCols.length > 0 && redCols.every((m) => Number(m[1]) + Number(m[3]) - 1 <= 4), 'vermelho só na metade esquerda');
  assert.ok(half.includes('rgba('), 'metade direita com a cor de vazio');
});

test('ícones de item e de bloco', () => {
  assert.notEqual(itemIconSvg(ITEM.SWORD), itemIconSvg(ITEM.PORK));
  const unknown = itemIconSvg('nao-existe');
  assert.ok(unknown.startsWith('<svg') && !unknown.includes('undefined'));
  assert.equal(itemIconSvg('__proto__'), unknown, 'nome especial cai no ícone genérico');
  assert.equal(itemIconSvg('constructor'), unknown);
  assert.equal(itemIconSvg(null), unknown);
  assert.equal(itemIconSvg(undefined), unknown);
  assert.equal(itemIconSvg(42), unknown);

  const grass = blockIconSvg(BLOCK_COLOR[1]);
  const dirt = blockIconSvg(BLOCK_COLOR[2]);
  assert.notEqual(grass, dirt);
  assert.equal(grass.match(/<polygon/g).length, 3, 'cubo = topo + dois lados');
  const [top, left, right] = [...grass.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.equal(left, '#6ab04c', 'lado esquerdo = cor base do bloco');
  assert.equal(top, shadeColor('#6ab04c', 0.3), 'topo mais claro');
  assert.equal(right, shadeColor('#6ab04c', -0.32), 'lado direito mais escuro');
  assert.equal(blockIconSvg('lixo'), blockIconSvg(null), 'cor inválida cai no cinza padrão');
  assert.ok(!blockIconSvg('"><script>').includes('script'));
  assert.notEqual(sunSvg(), moonSvg());
});

// ===========================================================================
// DOM falso: o suficiente para exercitar createHud sem navegador
// ===========================================================================

class FakeClassList {
  constructor() {
    this.set = new Set();
    this.ops = []; // histórico: ['add'|'remove', nome]
  }
  add(...names) {
    for (const n of names) {
      this.set.add(n);
      this.ops.push(['add', n]);
    }
  }
  remove(...names) {
    for (const n of names) {
      this.set.delete(n);
      this.ops.push(['remove', n]);
    }
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    this.ops.push([on ? 'add' : 'remove', name]);
    return on;
  }
  contains(name) {
    return this.set.has(name);
  }
}

class FakeEl {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.doc = doc;
    this.id = '';
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this.classList = new FakeClassList();
    this._text = '';
    this._html = '';
    this.htmlWrites = 0;
    this.textWrites = 0;
  }
  get className() {
    return [...this.classList.set].join(' ');
  }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
    this.textWrites++;
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    this.htmlWrites++;
  }
  get offsetWidth() {
    return 1;
  }
  appendChild(child) {
    if (child.parent) child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  focus() {
    this.doc.activeElement = this;
  }
  /** Dispara um clique com bubbling (stopPropagation interrompe a subida). */
  click() {
    const ev = {
      type: 'click',
      target: this,
      stopped: false,
      stopPropagation() {
        this.stopped = true;
      },
    };
    for (let el = this; el && !ev.stopped; el = el.parent) for (const fn of el.listeners.click ?? []) fn(ev);
    return ev;
  }
  has(cls) {
    return this.classList.contains(cls);
  }
}

class FakeDoc {
  constructor() {
    this.body = new FakeEl('body', this);
    this.activeElement = null;
    this.pointerLockExits = 0;
  }
  createElement(tag) {
    return new FakeEl(tag, this);
  }
  getElementById(id) {
    const walk = (el) => {
      if (el.id === id) return el;
      for (const c of el.children) {
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this.body);
  }
  exitPointerLock() {
    this.pointerLockExits++;
  }
}

function makeHud() {
  const doc = new FakeDoc();
  const hud = createHud({ doc });
  const $ = (id) => doc.getElementById(id);
  return { doc, hud, $ };
}

/** Slots no formato que o main.js passa (mesma lógica de `refreshHud`). */
function slotsFrom(counts) {
  return HOTBAR_SLOTS.map((slot, i) => ({
    label: String((i + 1) % 10),
    color: slot.kind === 'block' ? BLOCK_COLOR[slot.block] : null,
    item: slot.kind === 'item' ? slot.item : null,
    count: slot.kind === 'item' && slot.item === ITEM.SWORD ? null : counts[i],
  }));
}

// ---------------------------------------------------------------------------
// Corações
// ---------------------------------------------------------------------------

test('createHud: nasce com 10 corações cheios e cria os elementos que faltam', () => {
  const { $ } = makeHud();
  const hearts = $('hearts');
  assert.equal(hearts.children.length, HEART_COUNT);
  assert.ok(hearts.children.every((h) => h.dataset.state === 'full' && h.innerHTML.startsWith('<svg')));
  assert.ok(!hearts.has('low'));
  for (const id of ['crosshair', 'hud', 'clock', 'hotbar', 'toasts', 'damage-flash', 'overlay', 'death', 'btn-survival', 'btn-creative', 'btn-new-world', 'btn-respawn']) {
    assert.ok($(id), `#${id}`);
  }
});

test('setHealth: mostra cheio/meio/vazio, treme com hp <= 4 e só reescreve o que mudou', () => {
  const { hud, $ } = makeHud();
  const hearts = $('hearts');
  const states = () => hearts.children.map((h) => h.dataset.state);
  const writes = () => hearts.children.map((h) => h.htmlWrites);

  hud.setHealth(7, 20);
  assert.deepEqual(states(), heartsFor(7, 20));
  assert.equal(hearts.children[3].innerHTML, heartSvg('half'));
  assert.equal(hearts.children[0].innerHTML, heartSvg('full'));
  assert.equal(hearts.children[9].innerHTML, heartSvg('empty'));
  assert.ok(!hearts.has('low'));
  assert.equal(hearts.getAttribute('aria-label'), 'Vida: 7 de 20');

  // mesma vida: nenhuma escrita no DOM
  const before = writes();
  hud.setHealth(7, 20);
  assert.deepEqual(writes(), before, 'chamada repetida não toca no DOM');

  // 7 -> 6: só o coração 3 (meio -> vazio) muda
  hud.setHealth(6, 20);
  const after = writes();
  assert.deepEqual(
    after.map((n, i) => n - before[i]),
    [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    'só o coração afetado é reescrito'
  );

  // fronteira do tremor: 5 não, 4 sim, 0 sim, de volta a 5 não
  hud.setHealth(5, 20);
  assert.ok(!hearts.has('low'));
  hud.setHealth(4, 20);
  assert.ok(hearts.has('low'));
  hud.setHealth(0, 20);
  assert.ok(hearts.has('low'));
  assert.deepEqual(states(), Array(10).fill('empty'));
  hud.setHealth(5, 20);
  assert.ok(!hearts.has('low'));

  // curar até o máximo
  hud.setHealth(20, 20);
  assert.deepEqual(states(), Array(10).fill('full'));
  // maxHp diferente de 20 é reescalado
  hud.setHealth(5, 10);
  assert.deepEqual(states(), heartsFor(5, 10));
});

test('setHealth: valores ruins não lançam', () => {
  const { hud, $ } = makeHud();
  for (const bad of [Number.NaN, undefined, null, -3, 999]) assert.doesNotThrow(() => hud.setHealth(bad, 20));
  assert.doesNotThrow(() => hud.setHealth(10));
  assert.deepEqual($('hearts').children.map((h) => h.dataset.state), heartsFor(10, 20));
});

// ---------------------------------------------------------------------------
// Hotbar
// ---------------------------------------------------------------------------

test('setHotbar: 10 slots com rótulos 1..9,0, ícones, contagens e seleção', () => {
  const { hud, $ } = makeHud();
  const hotbar = $('hotbar');
  const counts = [0, 0, 0, 0, 0, 0, 8, 0, 1, 3];
  hud.setHotbar(slotsFrom(counts), 6);

  assert.equal(hotbar.children.length, 10);
  const keys = hotbar.children.map((s) => s.children[0].textContent);
  assert.deepEqual(keys, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  const cnt = hotbar.children.map((s) => s.children[2].textContent);
  assert.deepEqual(cnt, ['0', '0', '0', '0', '0', '0', '8', '0', '', '3'], 'espada sem número');

  // ícones: cubo para bloco (na cor do bloco), SVG de item para espada e carne
  const icon = (i) => hotbar.children[i].children[1].innerHTML;
  assert.equal(icon(0), blockIconSvg(BLOCK_COLOR[1]));
  assert.equal(icon(6), blockIconSvg(BLOCK_COLOR[7]));
  assert.equal(icon(8), itemIconSvg(ITEM.SWORD));
  assert.equal(icon(9), itemIconSvg(ITEM.PORK));

  // 0 => esmaecido; selecionado => active
  const empty = hotbar.children.map((s) => s.has('empty'));
  assert.deepEqual(empty, [true, true, true, true, true, true, false, true, false, false]);
  assert.deepEqual(hotbar.children.map((s) => s.has('active')), [false, false, false, false, false, false, true, false, false, false]);
});

test('setHotbar: Criativo mostra ∞ nos blocos; itens (espada/carne) com contagem infinita ficam sem número', () => {
  const { hud, $ } = makeHud();
  const hotbar = $('hotbar');
  hud.setHotbar(slotsFrom(Array(10).fill(Infinity)), 0);
  const cnt = hotbar.children.map((s) => s.children[2].textContent);
  assert.deepEqual(cnt, ['∞', '∞', '∞', '∞', '∞', '∞', '∞', '∞', '', ''], 'regra: item + Infinity => sem número');
  assert.ok(hotbar.children.every((s) => !s.has('empty')));
});

test('setHotbar: contagens grandes, slot a slot, e rótulo cai para a tecla do índice', () => {
  const { hud, $ } = makeHud();
  const hotbar = $('hotbar');
  const slots = slotsFrom([MAX_STACK, 64, 1, 12, 0, 5, 8, 100, 1, 3]);
  slots[1] = { color: 0x8b5a2b, count: MAX_STACK + 50 }; // sem label
  slots[2] = { label: '', color: 0x8d8d92, count: 1 }; // label vazio
  slots[3] = { label: 'Q', color: 0xe4d7a3, count: 12 }; // label próprio (o integrador manda a tecla)
  hud.setHotbar(slots, 0);
  assert.equal(hotbar.children[0].children[2].textContent, String(MAX_STACK));
  assert.equal(hotbar.children[1].children[2].textContent, `${MAX_STACK}+`);
  assert.equal(hotbar.children[1].children[0].textContent, '2', 'sem label: tecla do índice');
  assert.equal(hotbar.children[2].children[0].textContent, '3', 'label vazio: tecla do índice');
  assert.equal(hotbar.children[3].children[0].textContent, 'Q', 'label informado é respeitado');
});

test('setHotbar: dados iguais não reescrevem o DOM; trocar a seleção toca só em 2 slots', () => {
  const { hud, $ } = makeHud();
  const hotbar = $('hotbar');
  const counts = [5, 4, 3, 2, 1, 9, 8, 7, 1, 3];
  hud.setHotbar(slotsFrom(counts), 2);
  const snap = () => hotbar.children.map((s) => s.children.map((c) => c.htmlWrites + c.textWrites + s.classList.ops.length));
  const before = snap();
  hud.setHotbar(slotsFrom(counts), 2); // novos objetos, mesmo conteúdo
  assert.deepEqual(snap(), before, 'nenhuma escrita');
  const opsBefore = hotbar.children.map((s) => s.classList.ops.length);
  hud.setHotbar(slotsFrom(counts), 3);
  const changed = hotbar.children.map((s, i) => s.classList.ops.length - opsBefore[i]);
  assert.deepEqual(changed.map((n) => n > 0), [false, false, true, true, false, false, false, false, false, false], 'só o slot antigo e o novo');
  assert.ok(hotbar.children[3].has('active') && !hotbar.children[2].has('active'));

  // mudar uma contagem reescreve só aquele slot
  const textBefore = hotbar.children.map((s) => s.children[2].textWrites);
  const c2 = [...counts];
  c2[7] = 6;
  hud.setHotbar(slotsFrom(c2), 3);
  const textAfter = hotbar.children.map((s) => s.children[2].textWrites);
  assert.deepEqual(textAfter.map((n, i) => n - textBefore[i]), [0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
});

test('setHotbar: aceita cor como string, item sem cor, slot vazio e lista maior/menor', () => {
  const { hud, $ } = makeHud();
  const hotbar = $('hotbar');
  hud.setHotbar([{ color: '#ff0000', count: 2 }, { item: ITEM.PORK, color: 0x123456, count: 4 }, {}, null], 1);
  assert.equal(hotbar.children.length, 4);
  assert.equal(hotbar.children[0].children[1].innerHTML, blockIconSvg('#ff0000'));
  assert.equal(hotbar.children[1].children[1].innerHTML, itemIconSvg(ITEM.PORK), 'item tem precedência sobre cor');
  assert.equal(hotbar.children[2].children[1].innerHTML, '', 'slot sem cor nem item: sem ícone');
  assert.equal(hotbar.children[3].children[2].textContent, '');
  hud.setHotbar(slotsFrom(Array(10).fill(1)), 0); // cresce
  assert.equal(hotbar.children.length, 10);
  hud.setHotbar([{ color: 1, count: 1 }], 0); // encolhe
  assert.equal(hotbar.children.length, 1);
  assert.doesNotThrow(() => hud.setHotbar(undefined, 0));
  assert.equal(hotbar.children.length, 0);
});

// ---------------------------------------------------------------------------
// Relógio
// ---------------------------------------------------------------------------

test('setClock: texto "Dia N · fase", ícone sol/lua e classe night', () => {
  const { hud, $ } = makeHud();
  const clock = $('clock');
  const [icon, text] = clock.children;
  assert.equal(text.textContent, 'Dia 1 · Amanhecer', 'estado inicial');
  assert.equal(icon.innerHTML, sunSvg());

  hud.setClock({ day: 3, phaseName: 'Entardecer', night: false });
  assert.equal(text.textContent, 'Dia 3 · Entardecer');
  assert.equal(icon.innerHTML, sunSvg());
  assert.ok(!clock.has('night'));

  hud.setClock({ day: 3, phaseName: 'Noite', night: true });
  assert.equal(text.textContent, 'Dia 3 · Noite');
  assert.equal(icon.innerHTML, moonSvg());
  assert.ok(clock.has('night'));

  hud.setClock({ day: 4, phaseName: 'Dia', night: false });
  assert.equal(text.textContent, 'Dia 4 · Pleno dia');
  assert.equal(icon.innerHTML, sunSvg());
  assert.ok(!clock.has('night'));
});

test('setClock: chamadas repetidas não reescrevem; entradas ruins não lançam', () => {
  const { hud, $ } = makeHud();
  const [icon, text] = $('clock').children;
  hud.setClock({ day: 2, phaseName: 'Noite', night: true });
  const w = [icon.htmlWrites, text.textWrites];
  hud.setClock({ day: 2, phaseName: 'Noite', night: true });
  assert.deepEqual([icon.htmlWrites, text.textWrites], w, 'sem escrita quando nada mudou');
  assert.doesNotThrow(() => hud.setClock());
  assert.doesNotThrow(() => hud.setClock({}));
  assert.doesNotThrow(() => hud.setClock(null === undefined ? {} : { day: 'x', phaseName: 5, night: 'sim' }));
});

// ---------------------------------------------------------------------------
// Flash de dano
// ---------------------------------------------------------------------------

test('flashDamage: aplica a classe e REINICIA a animação a cada chamada', () => {
  const { hud, $ } = makeHud();
  const flash = $('damage-flash');
  hud.flashDamage();
  assert.ok(flash.has('flash'));
  assert.deepEqual(flash.classList.ops, [['remove', 'flash'], ['add', 'flash']]);
  hud.flashDamage();
  hud.flashDamage();
  assert.ok(flash.has('flash'));
  // cada chamada remove e re-adiciona (é o que reinicia a animação CSS)
  assert.deepEqual(
    flash.classList.ops.map((o) => o.join(':')),
    Array(3).fill(['remove:flash', 'add:flash']).flat()
  );
});

// ---------------------------------------------------------------------------
// Toasts (timers simulados)
// ---------------------------------------------------------------------------

test('toast: aparece, some sozinho depois de 1800 ms (fade 250 ms) e usa textContent', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, $ } = makeHud();
  const box = $('toasts');
  assert.equal(TOAST_MS, 1800);

  hud.toast('+1 Carne');
  assert.equal(box.children.length, 1);
  const el = box.children[0];
  assert.equal(el.textContent, '+1 Carne');
  assert.ok(el.has('toast') && !el.has('out'));

  t.mock.timers.tick(1799);
  assert.equal(box.children.length, 1, 'ainda visível aos 1799 ms');
  assert.ok(!el.has('out'));
  t.mock.timers.tick(1);
  assert.ok(el.has('out'), 'aos 1800 ms começa o fade');
  assert.equal(box.children.length, 1);
  t.mock.timers.tick(249);
  assert.equal(box.children.length, 1);
  t.mock.timers.tick(1);
  assert.equal(box.children.length, 0, 'removido depois do fade');
});

test('toast: ms customizado, ms inválido, texto vazio, HTML tratado como texto', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, $ } = makeHud();
  const box = $('toasts');

  hud.toast('longo', 5000);
  t.mock.timers.tick(4999);
  assert.ok(!box.children[0].has('out'));
  t.mock.timers.tick(1);
  assert.ok(box.children[0].has('out'));
  t.mock.timers.tick(250);
  assert.equal(box.children.length, 0);

  for (const bad of [0, -5, Number.NaN, 'x', Infinity]) {
    hud.toast('ms ruim', bad);
    t.mock.timers.tick(TOAST_MS - 1);
    assert.ok(!box.children.at(-1).has('out'), `ms ${String(bad)}: ainda não`);
    t.mock.timers.tick(1);
    assert.ok(box.children.at(-1).has('out'), `ms ${String(bad)} cai para o padrão`);
    t.mock.timers.tick(250);
    assert.equal(box.children.length, 0);
  }

  hud.toast('');
  hud.toast(undefined);
  hud.toast(null);
  assert.equal(box.children.length, 0, 'texto vazio é ignorado');
  hud.toast(0);
  assert.equal(box.children[0].textContent, '0', 'o número 0 é um texto válido');

  box.innerHTML = '';
  const html = '<img src=x onerror=alert(1)><b>oi</b>';
  hud.toast(html);
  assert.equal(box.children[0].textContent, html, 'texto literal');
  assert.equal(box.children[0].innerHTML, '', 'nunca vai por innerHTML');
});

test('toast: empilha, no máximo 4 (o mais antigo sai) e timers de toasts removidos não quebram', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, $ } = makeHud();
  const box = $('toasts');
  assert.equal(MAX_TOASTS, 4);
  for (let i = 1; i <= 6; i++) hud.toast(`+${i} Carne`);
  assert.deepEqual(box.children.map((c) => c.textContent), ['+3 Carne', '+4 Carne', '+5 Carne', '+6 Carne']);
  // os mais antigos já saíram à força: seus timers não podem remover/derrubar nada
  assert.doesNotThrow(() => {
    t.mock.timers.tick(TOAST_MS);
    t.mock.timers.tick(250);
  });
  assert.equal(box.children.length, 0);
  // depois de tudo sumir dá para empilhar de novo
  hud.toast('de novo');
  assert.equal(box.children.length, 1);
});

// ---------------------------------------------------------------------------
// Em jogo / menu / morte
// ---------------------------------------------------------------------------

test('setInGame: mira, hotbar, corações, relógio e FPS só em jogo; o menu no estado inverso', () => {
  const { hud, $ } = makeHud();
  const parts = ['crosshair', 'hotbar', 'hearts', 'clock', 'hud'].map($);
  hud.setInGame(true);
  assert.ok(parts.every((p) => p.has('hidden') === false));
  assert.ok($('overlay').has('hidden'), 'jogando: menu escondido');
  hud.setInGame(false);
  assert.ok(parts.every((p) => p.has('hidden')));
  assert.ok(!$('overlay').has('hidden'), 'fora do jogo: menu visível');
  hud.setInGame(1);
  assert.ok($('overlay').has('hidden'));
  hud.setInGame(undefined);
  assert.ok(!$('overlay').has('hidden'));
});

test('showDeath / hideDeath: números, foco, menu escondido, pointer lock solto, idempotentes', () => {
  const { hud, doc, $ } = makeHud();
  const death = $('death');
  death.classList.add('hidden');

  hud.showDeath({ days: 3, kills: 5 });
  assert.ok(!death.has('hidden'));
  assert.equal($('death-days').textContent, '3');
  assert.equal($('death-kills').textContent, '5');
  assert.ok(doc.body.has('dead'), 'body.dead esconde o menu por baixo');
  assert.equal(doc.activeElement, $('btn-respawn'), 'foco em "Renascer"');
  assert.equal(doc.pointerLockExits, 1);

  // repetir (o handler de unlock chama de novo): atualiza números, não repete efeitos
  doc.activeElement = null;
  hud.showDeath({ days: 4, kills: 6 });
  assert.equal($('death-days').textContent, '4');
  assert.equal(doc.pointerLockExits, 1, 'não solta o mouse de novo');
  assert.equal(doc.activeElement, null, 'não rouba o foco de novo');

  hud.hideDeath();
  assert.ok(death.has('hidden') && !doc.body.has('dead'));
  hud.hideDeath(); // idempotente
  assert.ok(death.has('hidden') && !doc.body.has('dead'));

  // morrer de novo depois de renascer funciona do zero
  hud.showDeath({ days: 1, kills: 0 });
  assert.ok(!death.has('hidden') && doc.body.has('dead'));
  assert.equal(doc.pointerLockExits, 2);
  assert.equal(doc.activeElement, $('btn-respawn'));
  assert.equal($('death-kills').textContent, '0');
});

test('showDeath: dados ruins viram 0 e um doc sem exitPointerLock não quebra', () => {
  const { hud, doc, $ } = makeHud();
  doc.exitPointerLock = undefined;
  assert.doesNotThrow(() => hud.showDeath());
  assert.equal($('death-days').textContent, '0');
  assert.equal($('death-kills').textContent, '0');
  doc.exitPointerLock = () => {
    throw new Error('sem pointer lock');
  };
  hud.hideDeath();
  assert.doesNotThrow(() => hud.showDeath({ days: 2, kills: 2 }), 'erro ao soltar o mouse é engolido');
  assert.equal($('death-days').textContent, '2');
});

test('bindMenu: cada botão chama o handler certo e o clique não borbulha até o overlay', () => {
  const { hud, $ } = makeHud();
  const calls = [];
  let overlayClicks = 0;
  $('overlay').addEventListener('click', () => overlayClicks++); // = o `controls.lock()` da Parte 1
  hud.bindMenu({
    onStart: (mode) => calls.push(['start', mode]),
    onNewWorld: () => calls.push(['new']),
    onRespawn: () => calls.push(['respawn']),
  });

  const ev = $('btn-survival').click();
  assert.ok(ev.stopped, 'stopPropagation');
  $('btn-creative').click();
  $('btn-new-world').click();
  $('btn-respawn').click();
  assert.deepEqual(calls, [['start', 'survival'], ['start', 'creative'], ['new'], ['respawn']]);
  assert.equal(overlayClicks, 0, 'nenhum clique chegou ao overlay');

  // clique no overlay fora dos botões segue funcionando (retomar o jogo)
  $('overlay').click();
  assert.equal(overlayClicks, 1);
});

test('bindMenu: religar troca os handlers (nunca dispara em dobro); handlers ausentes não quebram', () => {
  const { hud, $ } = makeHud();
  const a = [];
  const b = [];
  hud.bindMenu({ onStart: (m) => a.push(m) });
  hud.bindMenu({ onStart: (m) => b.push(m), onRespawn: () => b.push('respawn') });
  $('btn-survival').click();
  $('btn-creative').click();
  $('btn-respawn').click();
  assert.deepEqual(a, [], 'handler antigo não é mais chamado');
  assert.deepEqual(b, ['survival', 'creative', 'respawn'], 'cada clique dispara uma única vez');
  // sem onNewWorld: clicar não lança
  assert.doesNotThrow(() => $('btn-new-world').click());
  // bindMenu sem nada limpa os handlers
  hud.bindMenu();
  assert.doesNotThrow(() => $('btn-survival').click());
  assert.deepEqual(b, ['survival', 'creative', 'respawn']);
  // handler que não é função é ignorado
  hud.bindMenu({ onStart: 'oi', onNewWorld: 42 });
  assert.doesNotThrow(() => {
    $('btn-survival').click();
    $('btn-new-world').click();
  });
});

test('compat com a Parte 1: sem bindMenu, o clique no botão do menu borbulha até o overlay', () => {
  const { $ } = makeHud();
  let overlayClicks = 0;
  $('overlay').addEventListener('click', () => overlayClicks++);
  $('btn-survival').click();
  $('btn-creative').click();
  assert.equal(overlayClicks, 2, 'o main.js antigo ainda trava o mouse ao clicar num modo');
});

test('extras: setMode (corações no Criativo) e setMenuState (pausa marca o modo atual)', () => {
  const { hud, doc, $ } = makeHud();
  hud.setMode('creative');
  assert.equal(doc.body.dataset.mode, 'creative');
  hud.setMode('survival');
  assert.equal(doc.body.dataset.mode, 'survival');
  hud.setMode('banana');
  assert.ok(!('mode' in doc.body.dataset), 'modo inválido limpa o atributo');
  hud.setMode(undefined);
  assert.ok(!('mode' in doc.body.dataset));

  const sub = $('menu-sub');
  hud.setMenuState({ paused: true, mode: 'creative' });
  assert.ok($('overlay').has('paused'));
  assert.equal(sub.textContent, 'Pausado · Parte 3 · Refinamento');
  assert.ok($('btn-creative').has('current') && !$('btn-survival').has('current'));
  assert.equal($('btn-creative').getAttribute('aria-current'), 'true');
  assert.equal($('btn-survival').getAttribute('aria-current'), null);

  hud.setMenuState({ paused: true, mode: 'survival' });
  assert.ok($('btn-survival').has('current') && !$('btn-creative').has('current'));

  hud.setMenuState({ paused: false, mode: 'survival' });
  assert.ok(!$('overlay').has('paused'));
  assert.equal(sub.textContent, 'Parte 3 · Refinamento');
  assert.ok(!$('btn-survival').has('current') && !$('btn-creative').has('current'));
  assert.equal($('btn-survival').getAttribute('aria-current'), null);
  assert.doesNotThrow(() => hud.setMenuState());
});

// ===========================================================================
// index.html e código-fonte (lidos do disco)
// ===========================================================================

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('index.html: mantém os ids da Parte 1 e acrescenta os da Parte 2 (sem repetir id)', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const required = [
    // Parte 1 (o main.js atual usa)
    'app', 'overlay', 'crosshair', 'hud', 'fps', 'hotbar', 'new-world',
    // Parte 2
    'btn-survival', 'btn-creative', 'btn-new-world', 'death', 'btn-respawn',
    'hearts', 'clock', 'toasts', 'damage-flash', 'death-days', 'death-kills', 'menu-sub',
  ];
  for (const id of required) assert.ok(ids.includes(id), `#${id} existe`);
  assert.equal(new Set(ids).size, ids.length, 'nenhum id duplicado');
  // #new-world é o invólucro do botão: o main.js da Parte 1 escuta nele e recebe o clique por bubbling
  assert.match(html, /<div id="new-world"><button id="btn-new-world"/);
  // o overlay e os botões de modo estão dentro do menu
  assert.ok(html.indexOf('id="btn-survival"') > html.indexOf('id="overlay"'));
  assert.ok(html.indexOf('id="btn-creative"') > html.indexOf('id="overlay"'));
  assert.ok(html.indexOf('id="btn-respawn"') > html.indexOf('id="death"'));
});

test('index.html: textos do menu, subtítulo, tela de morte e tabela de controles', () => {
  assert.match(html, /<h1[^>]*>VOXELCRAFT<\/h1>/);
  assert.ok(html.includes('Parte 3 · Refinamento'));
  assert.match(html, /id="btn-survival"[\s\S]*?Sobrevivência/);
  assert.match(html, /id="btn-creative"[\s\S]*?Criativo/);
  assert.match(html, /id="btn-new-world"[^>]*>Novo mundo</);
  assert.ok(html.includes('Você morreu'));
  assert.match(html, /id="btn-respawn"[^>]*>Renascer</);
  assert.ok(html.includes('Dias sobrevividos') && html.includes('Abates'));

  const controls = html.slice(html.indexOf('<dl class="controls">'), html.indexOf('</dl>'));
  const rows = [...controls.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, '')]);
  const byAction = Object.fromEntries(rows);
  assert.equal(rows.length, 11, '11 linhas de controles');
  assert.equal(byAction['Olhar'], 'Mouse');
  assert.equal(byAction['Mover'], 'W A S D');
  assert.equal(byAction['Pular'], 'Espaço');
  assert.equal(byAction['Correr'], 'Ctrl ou Shift');
  assert.equal(byAction['Golpear / Quebrar'], 'Botão esq.');
  assert.equal(byAction['Colocar / Comer'], 'Botão dir.');
  assert.equal(byAction['Escolher item'], '1–9 e 0 ou roda');
  assert.equal(byAction['Câmera 1ª / 3ª pessoa'], 'V');
  assert.equal(byAction['Voar (só Criativo)'], 'F · Espaço / Shift');
  assert.equal(byAction['Som ligado / desligado'], 'M');
  assert.equal(byAction['Pausar'], 'Esc');
});

test('index.html: sem recursos externos, responsivo, foco visível e reduced-motion', () => {
  assert.ok(!/https?:\/\//i.test(html), 'nenhuma URL http(s)');
  assert.ok(!/<img\b|<link\b|url\(/i.test(html), 'nenhuma imagem/folha externa (ícones são SVG inline)');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0"/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media \(max-width: 520px\)/, 'ajuste para celular');
  assert.match(html, /body\.dead #overlay \{ display: none/, 'o menu nunca cobre a tela de morte');
  // 10 slots cabem em 375 px: o tamanho do slot é calculado da largura da tela
  assert.match(html, /--slot: min\(48px, calc\(\(100vw - 16px - var\(--gap\) \* 9\) \/ 10\)\)/);
  // o tremor dos corações é desligado sem animação
  assert.match(html, /prefers-reduced-motion: reduce\) \{[\s\S]*#hearts\.low \.heart \{ animation: none; \}/);
});

test('hud.js / audio.js: sem console.*, sem Math.random e sem dependência fora do projeto', () => {
  for (const file of ['../src/ui/hud.js', '../src/audio.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\./.test(code), `${file}: sem console.*`);
    assert.ok(!/Math\.random/.test(code), `${file}: sem Math.random`);
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) assert.ok(spec.startsWith('.'), `${file}: import ${spec} é interno`);
  }
});

test('hud.js importa no Node sem tocar em document (createHud é que usa o DOM)', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const mod = await import('../src/ui/hud.js');
  assert.equal(typeof mod.createHud, 'function');
  assert.throws(() => mod.createHud(), 'sem DOM nem doc injetado, createHud falha de forma clara');
});

test('deathLabels: singular com 1, plural nos demais (inclusive 0)', () => {
  assert.deepEqual(deathLabels({ days: 1, kills: 1 }), { days: 'Dia sobrevivido', kills: 'Abate' });
  assert.deepEqual(deathLabels({ days: 2, kills: 0 }), { days: 'Dias sobrevividos', kills: 'Abates' });
  assert.deepEqual(deathLabels({ days: 0, kills: 5 }), { days: 'Dias sobrevividos', kills: 'Abates' });
});

/** Luminância relativa WCAG de uma cor #rrggbb. */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('index.html: texto branco dos botões de modo passa WCAG AA (>= 4.5:1), mesmo com o hover', () => {
  for (const mode of ['survival', 'creative']) {
    const m = html.match(new RegExp('\\.mode-btn\\.' + mode + ' \\{ background: (#[0-9a-fA-F]{6})'));
    assert.ok(m, 'cor do botão ' + mode);
    assert.ok(contrast('#ffffff', m[1]) >= 4.5, mode + ' ' + m[1] + ' contraste ' + contrast('#ffffff', m[1]).toFixed(2));
  }
  // o hover só escurece/clareia um pouco: brightness(1.06) ainda fica acima de 4.5:1 no verde
  assert.match(html, /\.mode-btn:hover \{ filter: brightness\(1\.06\)/);
  const green = html.match(/\.mode-btn\.survival \{ background: (#[0-9a-fA-F]{6})/)[1];
  const lit = '#' + [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(green.slice(i, i + 2), 16) * 1.06)).toString(16).padStart(2, '0')).join('');
  assert.ok(contrast('#ffffff', lit) >= 4.5, 'hover ' + lit + ' ' + contrast('#ffffff', lit).toFixed(2));
});
