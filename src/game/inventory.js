// Inventário do jogador: a hotbar de 10 slots com quantidades.
// PURO (sem DOM, sem Three): roda no Node e é testado lá.
//
// O layout (quais blocos/itens, em que ordem), o kit inicial e o teto de pilha
// vêm de `items.js` — nada disso é copiado para cá. As teclas `1`–`9`/`0` e a
// roda do mouse ficam no integrador: aqui só `select(i)` e `cycle(dir)`.

import { HOTBAR_SLOTS, STARTER_KIT, MAX_STACK, ITEM } from './items.js';
import { MODE, isMode } from './stats.js';

const SLOT_COUNT = HOTBAR_SLOTS.length;

/** Itens que o jogador sempre tem e nunca se gastam (contagem infinita). */
const PERMANENT_ITEMS = new Set([ITEM.SWORD]);

/** @param {string} item */
export function isPermanentItem(item) {
  return PERMANENT_ITEMS.has(item);
}

// bloco/item -> índice do slot, calculado uma vez a partir de HOTBAR_SLOTS.
const BLOCK_SLOT = new Map();
const ITEM_SLOT = new Map();
HOTBAR_SLOTS.forEach((slot, i) => {
  if (slot.kind === 'block') BLOCK_SLOT.set(slot.block, i);
  else ITEM_SLOT.set(slot.item, i);
});

function isPlainObject(o) {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

/** Quantidade inteira em [0, MAX_STACK]; qualquer coisa inválida vira 0. */
function sanitizeCount(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(MAX_STACK, Math.max(0, Math.floor(v)));
}

/** `n` de uma operação de adicionar: inteiro >= 1, senão 0. */
function sanitizeAmount(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * @param {{ mode?: string }} [opts]
 */
export function createInventory({ mode = MODE.SURVIVAL } = {}) {
  // Contagens REAIS por slot (a espada ignora). Sem alocação por operação.
  const counts = new Uint16Array(SLOT_COUNT);

  const inv = {
    selected: 0,
    mode: isMode(mode) ? mode : MODE.SURVIVAL,

    /** Seleciona o slot `i`: inteiro fora do intervalo é clampado; o resto é ignorado. */
    select(i) {
      if (Number.isInteger(i)) inv.selected = Math.min(SLOT_COUNT - 1, Math.max(0, i));
      return inv.selected;
    },

    /** Passa para o slot seguinte (dir > 0) ou anterior (dir < 0), com volta. Só o sinal importa. */
    cycle(dir) {
      const d = Math.sign(dir);
      if (d) inv.selected = (inv.selected + d + SLOT_COUNT) % SLOT_COUNT;
      return inv.selected;
    },

    /** Troca o modo (inválido é ignorado). As contagens reais são preservadas. */
    setMode(m) {
      if (isMode(m)) inv.mode = m;
      return inv.mode;
    },

    /** Definição do slot `i` em HOTBAR_SLOTS (ou null se fora de 0..9). */
    slot(i) {
      return Number.isInteger(i) && i >= 0 && i < SLOT_COUNT ? HOTBAR_SLOTS[i] : null;
    },

    /**
     * Quantidade no slot `i`. Espada: Infinity sempre. Criativo: Infinity também
     * para blocos e carne. Índice inválido: 0.
     */
    count(i) {
      const slot = inv.slot(i);
      if (!slot) return 0;
      if (slot.kind === 'item' && PERMANENT_ITEMS.has(slot.item)) return Infinity;
      return inv.mode === MODE.CREATIVE ? Infinity : counts[i];
    },

    /** O slot selecionado: `{ index, kind, block|item, count }`. */
    getSelected() {
      const i = inv.selected;
      const slot = HOTBAR_SLOTS[i];
      return slot.kind === 'block'
        ? { index: i, kind: slot.kind, block: slot.block, count: inv.count(i) }
        : { index: i, kind: slot.kind, item: slot.item, count: inv.count(i) };
    },

    /**
     * Adiciona `n` unidades de um bloco da hotbar. Devolve quanto REALMENTE entrou
     * (respeita MAX_STACK). Id fora da hotbar, `n` inválido e Criativo: 0.
     */
    addBlock(id, n = 1) {
      return add(BLOCK_SLOT.get(id), n);
    },

    /** Idem para itens (carne). A espada é permanente: nada entra. */
    addItem(id, n = 1) {
      return add(ITEM_SLOT.get(id), n);
    },

    /**
     * Gasta 1 unidade do slot selecionado (bloco ou carne). Devolve true se
     * gastou; false se vazio. Criativo nunca gasta (true). A espada não é
     * consumível: false em qualquer modo.
     */
    consumeSelected() {
      const slot = HOTBAR_SLOTS[inv.selected];
      if (slot.kind === 'item' && PERMANENT_ITEMS.has(slot.item)) return false;
      if (inv.mode === MODE.CREATIVE) return true;
      if (counts[inv.selected] === 0) return false;
      counts[inv.selected] -= 1;
      return true;
    },

    /**
     * Aplica o STARTER_KIT levando cada contagem ao MÍNIMO do kit: chamar de novo
     * não duplica e nunca tira o que o jogador já tem a mais.
     */
    giveStarterKit() {
      for (const id of Object.keys(STARTER_KIT.blocks)) {
        raiseTo(BLOCK_SLOT.get(Number(id)), STARTER_KIT.blocks[id]);
      }
      for (const id of Object.keys(STARTER_KIT.items)) {
        raiseTo(ITEM_SLOT.get(id), STARTER_KIT.items[id]);
      }
    },

    /** Estado persistente, indexado por ID (não por posição) e sem zeros. */
    toJSON() {
      const blocks = {};
      const items = {};
      HOTBAR_SLOTS.forEach((slot, i) => {
        if (counts[i] === 0) return;
        if (slot.kind === 'block') blocks[slot.block] = counts[i];
        else items[slot.item] = counts[i];
      });
      return { v: 1, mode: inv.mode, selected: inv.selected, blocks, items };
    },

    /**
     * Restaura de um JSON, saneando: ids fora da hotbar são descartados, contagens
     * viram inteiros em [0, MAX_STACK] e o que faltar fica 0 (substitui o estoque).
     * Não-objeto: não altera nada e devolve false.
     * @param {object} o
     * @returns {boolean}
     */
    fromJSON(o) {
      if (!isPlainObject(o)) return false;
      if (isMode(o.mode)) inv.mode = o.mode;

      const blocks = isPlainObject(o.blocks) ? o.blocks : {};
      const items = isPlainObject(o.items) ? o.items : {};
      counts.fill(0);
      HOTBAR_SLOTS.forEach((slot, i) => {
        if (slot.kind === 'block') {
          counts[i] = sanitizeCount(blocks[slot.block]);
        } else if (!PERMANENT_ITEMS.has(slot.item)) {
          counts[i] = sanitizeCount(items[slot.item]);
        }
      });
      inv.selected = Number.isInteger(o.selected) ? Math.min(SLOT_COUNT - 1, Math.max(0, o.selected)) : 0;
      return true;
    },
  };

  function add(index, n) {
    if (index === undefined || inv.mode === MODE.CREATIVE) return 0;
    const slot = HOTBAR_SLOTS[index];
    if (slot.kind === 'item' && PERMANENT_ITEMS.has(slot.item)) return 0;
    const entered = Math.min(sanitizeAmount(n), MAX_STACK - counts[index]);
    counts[index] += entered;
    return entered;
  }

  function raiseTo(index, n) {
    if (index === undefined) return;
    const slot = HOTBAR_SLOTS[index];
    if (slot.kind === 'item' && PERMANENT_ITEMS.has(slot.item)) return;
    counts[index] = Math.max(counts[index], sanitizeCount(n));
  }

  return inv;
}
