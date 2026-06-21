import * as THREE from 'three';
import { BLOCK } from '../blocks.js';

// --- Layout do atlas (PURO, sem DOM) ---
export const TILE_PX = 16; // resolução de cada tile
export const ATLAS_COLS = 8; // tiles por linha (128px, potência de 2)

export const TILES = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD_TOP: 5,
  WOOD_SIDE: 6,
  LEAVES: 7,
  PLANKS: 8,
  COBBLE: 9,
};

const TILE_COUNT = Object.keys(TILES).length;
export const ATLAS_ROWS = Math.ceil(TILE_COUNT / ATLAS_COLS);

/** Tile do atlas para um (tipo de bloco, face). face ∈ 'top'|'bottom'|'side'. */
export function tileFor(blockType, faceName) {
  switch (blockType) {
    case BLOCK.GRASS:
      if (faceName === 'top') return TILES.GRASS_TOP;
      if (faceName === 'bottom') return TILES.DIRT;
      return TILES.GRASS_SIDE;
    case BLOCK.DIRT:
      return TILES.DIRT;
    case BLOCK.STONE:
      return TILES.STONE;
    case BLOCK.SAND:
      return TILES.SAND;
    case BLOCK.WOOD:
      return faceName === 'side' ? TILES.WOOD_SIDE : TILES.WOOD_TOP;
    case BLOCK.LEAVES:
      return TILES.LEAVES;
    case BLOCK.PLANKS:
      return TILES.PLANKS;
    case BLOCK.COBBLE:
      return TILES.COBBLE;
    default:
      return TILES.STONE;
  }
}

/**
 * UVs do tile (com inset anti-bleed). v0 = TOPO do tile (texture.flipY=false).
 * @returns {{u0,v0,u1,v1}}
 */
export function uvForTile(tileIndex) {
  const col = tileIndex % ATLAS_COLS;
  const row = Math.floor(tileIndex / ATLAS_COLS);
  const insetU = 0.5 / (ATLAS_COLS * TILE_PX);
  const insetV = 0.5 / (ATLAS_ROWS * TILE_PX);
  return {
    u0: col / ATLAS_COLS + insetU,
    u1: (col + 1) / ATLAS_COLS - insetU,
    v0: row / ATLAS_ROWS + insetV,
    v1: (row + 1) / ATLAS_ROWS - insetV,
  };
}

// --- Geração da imagem (browser) ---

// PRNG determinístico (mulberry32) p/ ruído estável dos tiles.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

function clamp255(v) {
  return Math.max(0, Math.min(255, v)) | 0;
}

// canto superior-esquerdo (px) de um tile no canvas.
function tileOrigin(tileIndex) {
  return {
    ox: (tileIndex % ATLAS_COLS) * TILE_PX,
    oy: Math.floor(tileIndex / ATLAS_COLS) * TILE_PX,
  };
}

// Preenche um tile com ruído por pixel a partir de uma cor base.
function drawNoisy(ctx, tileIndex, baseHex, jitter, rand) {
  const base = hexToRgb(baseHex);
  const { ox, oy } = tileOrigin(tileIndex);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (rand() - 0.5) * 2 * jitter;
      ctx.fillStyle = `rgb(${clamp255(base.r + d)},${clamp255(base.g + d)},${clamp255(base.b + d)})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

/**
 * Gera a textura-atlas em runtime (canvas). Browser only.
 * @returns {THREE.CanvasTexture}
 */
export function makeAtlasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(0xa11ce);

  drawNoisy(ctx, TILES.GRASS_TOP, 0x6ab04c, 28, rand);
  drawNoisy(ctx, TILES.DIRT, 0x8b5a2b, 30, rand);
  drawNoisy(ctx, TILES.STONE, 0x8d8d92, 26, rand);
  drawNoisy(ctx, TILES.SAND, 0xe4d7a3, 22, rand);
  drawNoisy(ctx, TILES.LEAVES, 0x4a8b3a, 40, rand);
  drawNoisy(ctx, TILES.COBBLE, 0x7a7a80, 40, rand);

  // grama lateral: terra + faixa de grama no topo (v=0 = topo, flipY=false)
  drawNoisy(ctx, TILES.GRASS_SIDE, 0x8b5a2b, 30, rand);
  {
    const { ox, oy } = tileOrigin(TILES.GRASS_SIDE);
    for (let x = 0; x < TILE_PX; x++) {
      const overhang = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < overhang; y++) {
        const d = (rand() - 0.5) * 56;
        ctx.fillStyle = `rgb(${clamp255(0x6a + d)},${clamp255(0xb0 + d)},${clamp255(0x4c + d)})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // madeira: lateral com listras verticais (casca); topo com anéis
  drawNoisy(ctx, TILES.WOOD_SIDE, 0x9c6b3f, 18, rand);
  {
    const { ox, oy } = tileOrigin(TILES.WOOD_SIDE);
    for (let x = 0; x < TILE_PX; x += 3) {
      ctx.fillStyle = 'rgba(60,38,20,0.5)';
      ctx.fillRect(ox + x, oy, 1, TILE_PX);
    }
  }
  drawNoisy(ctx, TILES.WOOD_TOP, 0xb5854f, 16, rand);
  {
    const { ox, oy } = tileOrigin(TILES.WOOD_TOP);
    ctx.strokeStyle = 'rgba(80,50,25,0.6)';
    for (let r = 2; r < TILE_PX / 2; r += 2) {
      ctx.strokeRect(ox + TILE_PX / 2 - r, oy + TILE_PX / 2 - r, r * 2, r * 2);
    }
  }

  // tábuas: base + linhas horizontais e juntas verticais
  drawNoisy(ctx, TILES.PLANKS, 0xb9925a, 16, rand);
  {
    const { ox, oy } = tileOrigin(TILES.PLANKS);
    ctx.fillStyle = 'rgba(70,45,20,0.5)';
    for (let y = 0; y < TILE_PX; y += 4) ctx.fillRect(ox, oy + y, TILE_PX, 1);
    ctx.fillRect(ox + 5, oy, 1, 4);
    ctx.fillRect(ox + 11, oy + 4, 1, 4);
    ctx.fillRect(ox + 3, oy + 8, 1, 4);
    ctx.fillRect(ox + 10, oy + 12, 1, 4);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // v=0 corresponde ao topo do canvas
  return texture;
}
