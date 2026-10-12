import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInventory, isPermanentItem } from '../src/game/inventory.js';
import { MODE } from '../src/game/stats.js';
import { HOTBAR_SLOTS, STARTER_KIT, MAX_STACK, ITEM } from '../src/game/items.js';
import { BLOCK } from '../src/blocks.js';

// Índices dos slots lidos de HOTBAR_SLOTS (nada de números mágicos de layout).
const slotOfBlock = (b) => HOTBAR_SLOTS.findIndex((s) => s.kind === 'block' && s.block === b);
const slotOfItem = (it) => HOTBAR_SLOTS.findIndex((s) => s.kind === 'item' && s.item === it);
const SWORD = slotOfItem(ITEM.SWORD);
const PORK = slotOfItem(ITEM.PORK);
const PLANKS = slotOfBlock(BLOCK.PLANKS);
const GRASS = slotOfBlock(BLOCK.GRASS);

// --- slots ---

test('slots: 10, vindos de HOTBAR_SLOTS (mesma referência), null fora do intervalo', () => {
  const inv = createInventory();
  assert.equal(HOTBAR_SLOTS.length, 10);
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) assert.equal(inv.slot(i), HOTBAR_SLOTS[i]);
  for (const bad of [-1, 10, 1.5, NaN, undefined, null, '2']) {
    assert.equal(inv.slot(bad), null, String(bad));
  }
  assert.ok(SWORD >= 0 && PORK >= 0 && PLANKS >= 0 && GRASS >= 0);
});

// --- seleção ---

test('select: começa em 0; clampa inteiros fora do intervalo; ignora o resto', () => {
  const inv = createInventory();
  assert.equal(inv.selected, 0);
  assert.equal(inv.select(4), 4);
  assert.equal(inv.selected, 4);
  assert.equal(inv.select(99), 9);
  assert.equal(inv.select(-7), 0);
  inv.select(5);
  for (const bad of [2.5, NaN, Infinity, -Infinity, '3', null, undefined, {}, []]) {
    assert.equal(inv.select(bad), 5, String(bad));
  }
  assert.equal(inv.selected, 5);
});

test('cycle: dá a volta nos dois sentidos; só o sinal importa; 0/NaN não mexem', () => {
  const inv = createInventory();
  assert.equal(inv.cycle(-1), 9); // 0 -> 9 (wrap para trás)
  assert.equal(inv.cycle(1), 0); // 9 -> 0 (wrap para frente)
  assert.equal(inv.cycle(1), 1);
  assert.equal(inv.cycle(120), 2); // deltaY da roda: só o sinal
  assert.equal(inv.cycle(-0.01), 1);
  inv.select(3);
  for (const noop of [0, NaN, undefined, null, 'x']) {
    assert.equal(inv.cycle(noop), 3, String(noop));
  }
  // uma volta completa devolve ao mesmo slot
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) inv.cycle(1);
  assert.equal(inv.selected, 3);
});

// --- contagens ---

test('count (Sobrevivência): blocos e carne começam em 0; espada é Infinity', () => {
  const inv = createInventory();
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) {
    assert.equal(inv.count(i), i === SWORD ? Infinity : 0, `slot ${i}`);
  }
});

test('count (Criativo): blocos e carne Infinity; espada Infinity', () => {
  const inv = createInventory({ mode: MODE.CREATIVE });
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) assert.equal(inv.count(i), Infinity, `slot ${i}`);
});

test('count: índice inválido é 0 em qualquer modo', () => {
  for (const mode of [MODE.SURVIVAL, MODE.CREATIVE]) {
    const inv = createInventory({ mode });
    for (const bad of [-1, 10, 1.5, NaN, undefined, '0']) assert.equal(inv.count(bad), 0, `${mode} ${String(bad)}`);
  }
});

test('modo inválido no construtor cai em Sobrevivência', () => {
  assert.equal(createInventory({ mode: 'banana' }).mode, MODE.SURVIVAL);
  assert.equal(createInventory().mode, MODE.SURVIVAL);
  assert.equal(createInventory({}).mode, MODE.SURVIVAL);
});

// --- getSelected ---

test('getSelected: bloco => { index, kind, block, count } sem a chave "item"', () => {
  const inv = createInventory();
  inv.addBlock(BLOCK.PLANKS, 5);
  inv.select(PLANKS);
  const sel = inv.getSelected();
  assert.deepEqual(sel, { index: PLANKS, kind: 'block', block: BLOCK.PLANKS, count: 5 });
  assert.ok(!('item' in sel));
});

test('getSelected: item => { index, kind, item, count } sem a chave "block"', () => {
  const inv = createInventory();
  inv.select(SWORD);
  const sword = inv.getSelected();
  assert.deepEqual(sword, { index: SWORD, kind: 'item', item: ITEM.SWORD, count: Infinity });
  assert.ok(!('block' in sword));
  inv.addItem(ITEM.PORK, 2);
  inv.select(PORK);
  assert.deepEqual(inv.getSelected(), { index: PORK, kind: 'item', item: ITEM.PORK, count: 2 });
});

test('getSelected: Criativo mostra Infinity no bloco selecionado', () => {
  const inv = createInventory({ mode: MODE.CREATIVE });
  assert.deepEqual(inv.getSelected(), { index: 0, kind: 'block', block: HOTBAR_SLOTS[0].block, count: Infinity });
});

// --- adicionar ---

test('addBlock/addItem: devolvem quanto entrou e a contagem sobe', () => {
  const inv = createInventory();
  assert.equal(inv.addBlock(BLOCK.STONE), 1); // n padrão = 1
  assert.equal(inv.addBlock(BLOCK.STONE, 4), 4);
  assert.equal(inv.count(slotOfBlock(BLOCK.STONE)), 5);
  assert.equal(inv.addItem(ITEM.PORK, 2), 2);
  assert.equal(inv.count(PORK), 2);
});

test('MAX_STACK: parcial perto do teto, 0 no teto, e nunca passa do teto', () => {
  const inv = createInventory();
  assert.equal(inv.addBlock(BLOCK.DIRT, MAX_STACK + 500), MAX_STACK); // do zero ao teto
  assert.equal(inv.count(slotOfBlock(BLOCK.DIRT)), MAX_STACK);
  assert.equal(inv.addBlock(BLOCK.DIRT, 1), 0); // no teto: nada entra

  const near = createInventory();
  near.addBlock(BLOCK.SAND, MAX_STACK - 5);
  assert.equal(near.addBlock(BLOCK.SAND, 10), 5); // só 5 cabem
  assert.equal(near.count(slotOfBlock(BLOCK.SAND)), MAX_STACK);

  const meat = createInventory();
  assert.equal(meat.addItem(ITEM.PORK, MAX_STACK - 1), MAX_STACK - 1);
  assert.equal(meat.addItem(ITEM.PORK, 3), 1);
  assert.equal(meat.count(PORK), MAX_STACK);
});

test('add: id desconhecido, n inválido e fracionário', () => {
  const inv = createInventory();
  assert.equal(inv.addBlock(BLOCK.AIR, 3), 0); // AIR não está na hotbar
  assert.equal(inv.addBlock(999, 3), 0);
  assert.equal(inv.addBlock(undefined, 3), 0);
  assert.equal(inv.addItem('diamond', 3), 0);
  for (const bad of [0, -1, NaN, Infinity, '3', null, {}]) {
    assert.equal(inv.addBlock(BLOCK.WOOD, bad), 0, String(bad));
  }
  assert.equal(inv.count(slotOfBlock(BLOCK.WOOD)), 0);
  assert.equal(inv.addBlock(BLOCK.WOOD, 2.9), 2); // floor
  assert.equal(inv.addBlock(BLOCK.WOOD, 0.9), 0);
  assert.equal(inv.count(slotOfBlock(BLOCK.WOOD)), 2);
});

test('add: a espada é permanente — nada entra, contagem segue Infinity', () => {
  const inv = createInventory();
  assert.equal(inv.addItem(ITEM.SWORD, 5), 0);
  assert.equal(inv.count(SWORD), Infinity);
  assert.ok(isPermanentItem(ITEM.SWORD));
  assert.ok(!isPermanentItem(ITEM.PORK));
});

test('add no Criativo: não faz nada (o estoque real de Sobrevivência não cresce escondido)', () => {
  const inv = createInventory({ mode: MODE.CREATIVE });
  assert.equal(inv.addBlock(BLOCK.STONE, 10), 0);
  assert.equal(inv.addItem(ITEM.PORK, 10), 0);
  inv.setMode(MODE.SURVIVAL);
  assert.equal(inv.count(slotOfBlock(BLOCK.STONE)), 0);
  assert.equal(inv.count(PORK), 0);
});

// --- consumir ---

test('consumeSelected (Sobrevivência): gasta 1, false se vazio, nunca fica negativo', () => {
  const inv = createInventory();
  inv.addBlock(BLOCK.PLANKS, 2);
  inv.select(PLANKS);
  assert.equal(inv.consumeSelected(), true);
  assert.equal(inv.count(PLANKS), 1);
  assert.equal(inv.consumeSelected(), true);
  assert.equal(inv.count(PLANKS), 0);
  assert.equal(inv.consumeSelected(), false);
  assert.equal(inv.consumeSelected(), false);
  assert.equal(inv.count(PLANKS), 0);
});

test('consumeSelected: carne gasta 1 por vez', () => {
  const inv = createInventory();
  inv.addItem(ITEM.PORK, 3);
  inv.select(PORK);
  assert.equal(inv.consumeSelected(), true);
  assert.equal(inv.count(PORK), 2);
});

test('consumeSelected: a espada não é consumível em nenhum modo', () => {
  const inv = createInventory();
  inv.select(SWORD);
  assert.equal(inv.consumeSelected(), false);
  assert.equal(inv.count(SWORD), Infinity);
  inv.setMode(MODE.CREATIVE);
  assert.equal(inv.consumeSelected(), false);
});

test('consumeSelected (Criativo): sempre true e nunca gasta — nem com estoque real 0', () => {
  const inv = createInventory({ mode: MODE.CREATIVE });
  inv.select(GRASS);
  for (let i = 0; i < 50; i++) assert.equal(inv.consumeSelected(), true);
  assert.equal(inv.count(GRASS), Infinity);
  inv.select(PORK);
  assert.equal(inv.consumeSelected(), true);
  inv.setMode(MODE.SURVIVAL);
  assert.equal(inv.count(GRASS), 0); // o estoque real nunca foi mexido
});

// --- kit inicial ---

test('giveStarterKit: aplica exatamente o STARTER_KIT, lendo de items.js', () => {
  const inv = createInventory();
  inv.giveStarterKit();
  const expected = new Array(HOTBAR_SLOTS.length).fill(0);
  for (const [id, n] of Object.entries(STARTER_KIT.blocks)) expected[slotOfBlock(Number(id))] = n;
  for (const [id, n] of Object.entries(STARTER_KIT.items)) expected[slotOfItem(id)] = n;
  expected[SWORD] = Infinity;
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) assert.equal(inv.count(i), expected[i], `slot ${i}`);
  assert.ok(inv.count(PLANKS) > 0 && inv.count(PORK) > 0, 'o kit não pode ser vazio');
});

test('giveStarterKit: chamar duas vezes não duplica', () => {
  const inv = createInventory();
  inv.giveStarterKit();
  const once = inv.toJSON();
  inv.giveStarterKit();
  inv.giveStarterKit();
  assert.deepEqual(inv.toJSON(), once);
});

test('giveStarterKit: nunca reduz o que o jogador já tem a mais', () => {
  const inv = createInventory();
  inv.addBlock(BLOCK.PLANKS, STARTER_KIT.blocks[BLOCK.PLANKS] + 7);
  inv.giveStarterKit();
  assert.equal(inv.count(PLANKS), STARTER_KIT.blocks[BLOCK.PLANKS] + 7);
  assert.equal(inv.count(PORK), STARTER_KIT.items[ITEM.PORK]); // o que faltava foi completado
});

test('giveStarterKit: a seleção não muda', () => {
  const inv = createInventory();
  inv.select(6);
  inv.giveStarterKit();
  assert.equal(inv.selected, 6);
});

// --- modos ---

test('setMode: alterna preservando as contagens reais; inválido é ignorado', () => {
  const inv = createInventory();
  inv.addBlock(BLOCK.COBBLE, 12);
  const cobble = slotOfBlock(BLOCK.COBBLE);
  assert.equal(inv.setMode(MODE.CREATIVE), MODE.CREATIVE);
  assert.equal(inv.count(cobble), Infinity);
  assert.equal(inv.setMode('banana'), MODE.CREATIVE);
  assert.equal(inv.setMode(undefined), MODE.CREATIVE);
  assert.equal(inv.setMode(MODE.SURVIVAL), MODE.SURVIVAL);
  assert.equal(inv.count(cobble), 12);
});

// --- JSON ---

test('toJSON: indexado por id, sem zeros e sem a espada', () => {
  const inv = createInventory();
  inv.giveStarterKit();
  inv.addBlock(BLOCK.STONE, 40);
  inv.select(3);
  const j = inv.toJSON();
  assert.deepEqual(j, {
    v: 1,
    mode: MODE.SURVIVAL,
    selected: 3,
    blocks: { [BLOCK.PLANKS]: STARTER_KIT.blocks[BLOCK.PLANKS], [BLOCK.STONE]: 40 },
    items: { [ITEM.PORK]: STARTER_KIT.items[ITEM.PORK] },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(j)), j);
  assert.equal(JSON.stringify(inv), JSON.stringify(j));
});

test('fromJSON(toJSON()) é identidade (inclusive seleção e modo)', () => {
  const a = createInventory();
  a.giveStarterKit();
  a.addBlock(BLOCK.WOOD, 77);
  a.addItem(ITEM.PORK, 5);
  a.select(8);
  a.setMode(MODE.CREATIVE);
  const b = createInventory();
  assert.equal(b.fromJSON(JSON.parse(JSON.stringify(a.toJSON()))), true);
  assert.deepEqual(b.toJSON(), a.toJSON());
  assert.equal(b.selected, 8);
  assert.equal(b.mode, MODE.CREATIVE);
  b.setMode(MODE.SURVIVAL);
  assert.equal(b.count(slotOfBlock(BLOCK.WOOD)), 77);
});

test('fromJSON: descarta ids desconhecidos e a espada; clampa e zera valores ruins', () => {
  const inv = createInventory();
  inv.addBlock(BLOCK.GRASS, 10); // será substituído
  inv.fromJSON({
    v: 1,
    selected: 2,
    blocks: {
      [BLOCK.DIRT]: 1500, // acima do teto
      [BLOCK.STONE]: -4, // negativo
      [BLOCK.SAND]: 3.9, // fracionário
      [BLOCK.WOOD]: 'muitos', // lixo
      [BLOCK.LEAVES]: NaN,
      [BLOCK.PLANKS]: 8,
      [BLOCK.AIR]: 50, // não está na hotbar
      99: 5, // desconhecido
      banana: 7,
    },
    items: { [ITEM.PORK]: 4, [ITEM.SWORD]: 30, diamond: 9 },
  });
  assert.equal(inv.count(slotOfBlock(BLOCK.DIRT)), MAX_STACK);
  assert.equal(inv.count(slotOfBlock(BLOCK.STONE)), 0);
  assert.equal(inv.count(slotOfBlock(BLOCK.SAND)), 3);
  assert.equal(inv.count(slotOfBlock(BLOCK.WOOD)), 0);
  assert.equal(inv.count(slotOfBlock(BLOCK.LEAVES)), 0);
  assert.equal(inv.count(PLANKS), 8);
  assert.equal(inv.count(PORK), 4);
  assert.equal(inv.count(SWORD), Infinity);
  assert.equal(inv.count(GRASS), 0, 'o estoque anterior é substituído (o que faltar fica 0)');
  assert.deepEqual(Object.keys(inv.toJSON().blocks).sort(), [BLOCK.DIRT, BLOCK.SAND, BLOCK.PLANKS].map(String).sort());
  assert.deepEqual(Object.keys(inv.toJSON().items), [ITEM.PORK]);
});

test('fromJSON: selected inválido vira 0; fora do intervalo é clampado', () => {
  for (const bad of [undefined, null, NaN, 'x', '3', 2.5, {}, Infinity]) {
    const inv = createInventory();
    inv.select(5);
    inv.fromJSON({ selected: bad });
    assert.equal(inv.selected, 0, String(bad));
  }
  const inv = createInventory();
  inv.fromJSON({ selected: 40 });
  assert.equal(inv.selected, HOTBAR_SLOTS.length - 1);
  inv.fromJSON({ selected: -3 });
  assert.equal(inv.selected, 0);
});

test('fromJSON: blocks/items ausentes ou do tipo errado viram inventário vazio', () => {
  for (const o of [{}, { blocks: null, items: 'x' }, { blocks: [1, 2], items: [3] }, { blocks: 5 }]) {
    const inv = createInventory();
    inv.giveStarterKit();
    assert.equal(inv.fromJSON(o), true);
    for (let i = 0; i < HOTBAR_SLOTS.length; i++) assert.equal(inv.count(i), i === SWORD ? Infinity : 0);
  }
});

test('fromJSON: modo válido é aplicado, inválido mantém o atual', () => {
  const a = createInventory();
  a.fromJSON({ mode: 'creative' });
  assert.equal(a.mode, MODE.CREATIVE);
  const b = createInventory({ mode: MODE.CREATIVE });
  b.fromJSON({ mode: 'banana' });
  assert.equal(b.mode, MODE.CREATIVE);
  b.fromJSON({});
  assert.equal(b.mode, MODE.CREATIVE);
});

test('fromJSON: não-objeto não altera nada e devolve false', () => {
  for (const bad of [null, undefined, 3, 'x', true, [], [1]]) {
    const inv = createInventory();
    inv.giveStarterKit();
    inv.select(4);
    const before = inv.toJSON();
    assert.equal(inv.fromJSON(bad), false, String(bad));
    assert.deepEqual(inv.toJSON(), before);
  }
});

test('fromJSON: chaves herdadas (__proto__, constructor) não viram contagem', () => {
  const inv = createInventory();
  const evil = JSON.parse('{"selected":1,"blocks":{"__proto__":{"1":50},"constructor":9},"items":{"__proto__":{"pork":50}}}');
  inv.fromJSON(evil);
  assert.equal(inv.count(GRASS), 0);
  assert.equal(inv.count(PORK), 0);
});

// --- independência entre instâncias ---

test('instâncias são independentes (sem estado global compartilhado)', () => {
  const a = createInventory();
  const b = createInventory();
  a.addBlock(BLOCK.GRASS, 9);
  a.select(7);
  assert.equal(b.count(GRASS), 0);
  assert.equal(b.selected, 0);
});

// --- qualidade ---

test('inventory.js: sem Math.random(), sem console.log e sem layout duplicado', () => {
  const src = readFileSync(new URL('../src/game/inventory.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('Math.random'));
  assert.ok(!src.includes('console.log'));
  assert.ok(!/\b999\b/.test(src), 'MAX_STACK vem de items.js');
  assert.ok(!/BLOCK\./.test(src), 'quais blocos existem vem de HOTBAR_SLOTS');
});
