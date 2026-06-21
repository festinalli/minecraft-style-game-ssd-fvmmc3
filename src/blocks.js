// Fonte única de tipos de bloco e suas cores.
// A constitution proíbe duplicar estes valores em outros lugares.

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
};

// Cor base por tipo (hex). Usada na hotbar e como base do atlas procedural.
export const BLOCK_COLOR = {
  [BLOCK.GRASS]: 0x6ab04c,
  [BLOCK.DIRT]: 0x8b5a2b,
  [BLOCK.STONE]: 0x8d8d92,
  [BLOCK.SAND]: 0xe4d7a3,
  [BLOCK.WOOD]: 0x9c6b3f,
  [BLOCK.LEAVES]: 0x4a8b3a,
  [BLOCK.PLANKS]: 0xb9925a,
  [BLOCK.COBBLE]: 0x7a7a80,
};

export function isSolid(block) {
  return block !== BLOCK.AIR && block !== undefined;
}
