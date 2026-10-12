// Fonte única de itens e do layout da hotbar da Parte 2.
// (Substitui o HOTBAR que vivia em player/editing.js.)

import { BLOCK } from '../blocks.js';

export const ITEM = {
  SWORD: 'sword', // espada: dano alto, permanente
  PORK: 'pork', // carne: cura ao comer, dropa de porcos/ovelhas
};

export const ITEM_LABEL = {
  [ITEM.SWORD]: 'Espada',
  [ITEM.PORK]: 'Carne',
};

/** Dano por golpe. `FIST` vale para qualquer slot que não seja a espada. */
export const DAMAGE = { FIST: 1, SWORD: 5 };

/** Golpe do jogador: intervalo mínimo entre golpes que acertam e knockback no alvo. */
export const COMBAT = { ATTACK_COOLDOWN: 0.45, KNOCK: 6 };

/** Quanto a carne cura (em HP; 1 coração = 2 HP) e o intervalo entre mordidas. */
export const FOOD = { PORK_HEAL: 6, EAT_COOLDOWN: 0.6 };

/** Alcance do golpe corpo a corpo, em blocos (editar blocos segue com REACH). */
export const MELEE_REACH = 3.5;

/**
 * Hotbar de 10 slots. Teclas: `1`–`9` = slots 0–8, `0` = slot 9. A roda do
 * mouse cicla os 10. Slots 0–7 são os 8 blocos da Parte 1 (mesma ordem).
 */
export const HOTBAR_SLOTS = [
  { kind: 'block', block: BLOCK.GRASS },
  { kind: 'block', block: BLOCK.DIRT },
  { kind: 'block', block: BLOCK.STONE },
  { kind: 'block', block: BLOCK.SAND },
  { kind: 'block', block: BLOCK.WOOD },
  { kind: 'block', block: BLOCK.LEAVES },
  { kind: 'block', block: BLOCK.PLANKS },
  { kind: 'block', block: BLOCK.COBBLE },
  { kind: 'item', item: ITEM.SWORD },
  { kind: 'item', item: ITEM.PORK },
];

/** Kit inicial no modo Sobrevivência. */
export const STARTER_KIT = {
  blocks: { [BLOCK.PLANKS]: 8 },
  items: { [ITEM.PORK]: 3 }, // a espada é permanente: não entra em contagem
};

/** Teto de unidades por tipo no inventário. */
export const MAX_STACK = 999;

/** O que quebrar um bloco devolve (modo Sobrevivência). */
export function blockDrop(block) {
  switch (block) {
    case BLOCK.GRASS:
      return BLOCK.DIRT;
    case BLOCK.STONE:
      return BLOCK.COBBLE;
    default:
      return block;
  }
}
