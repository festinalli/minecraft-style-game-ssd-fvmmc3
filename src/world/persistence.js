// Persistência do mundo infinito: salva apenas os CHUNKS MODIFICADOS.
// Parte PURA (serialize/deserialize) testável headless; parte browser usa
// localStorage e o objeto World.
//
// Formato v2 (inalterado desde a Parte 1): { v, seed, player, chunks }.
// A Parte 2 acrescenta o campo OPCIONAL `game` (estado de jogo: modo, tempo,
// vida, inventário) SEM mudar VERSION nem KEY: saves antigos seguem carregando
// (`game` volta null) e um build antigo ignora o campo. Ver ADR 0011.

import { isMode } from '../game/stats.js';

const VERSION = 2;
const KEY = 'voxelcraft.save.v2';

/** Versão do envelope do campo `game` (independente de VERSION do save). */
export const GAME_VERSION = 1;

// --- helpers base64 <-> bytes ---
function bytesToB64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Posição do jogador do save: 3 números finitos, ou null (nunca NaN/lixo no mundo). */
export function sanitizePlayer(raw) {
  if (!isPlainObject(raw)) return null;
  const { x, y, z } = raw;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function isPlainObject(o) {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

// --- PURO ---

/**
 * Monta o envelope `game` a gravar no save. `stats` e `inventory` são os
 * resultados de `stats.toJSON()` / `inventory.toJSON()`.
 * @param {{ mode: string, seconds: number, stats: object, inventory: object }} g
 */
export function makeGame({ mode, seconds, stats, inventory }) {
  return { v: GAME_VERSION, mode, seconds, stats, inventory };
}

/**
 * Normaliza o `game` lido do disco. Devolve null se ausente ou irreconhecível
 * (não é objeto, `v` diferente de GAME_VERSION); senão o envelope com cada campo
 * inválido trocado por null (o integrador usa o padrão daquele campo). Nunca lança.
 * @param {unknown} raw
 * @returns {{ v:number, mode:string|null, seconds:number|null, stats:object|null, inventory:object|null } | null}
 */
export function sanitizeGame(raw) {
  if (!isPlainObject(raw) || raw.v !== GAME_VERSION) return null;
  return {
    v: GAME_VERSION,
    mode: isMode(raw.mode) ? raw.mode : null,
    seconds: Number.isFinite(raw.seconds) && raw.seconds >= 0 ? raw.seconds : null,
    stats: isPlainObject(raw.stats) ? raw.stats : null,
    inventory: isPlainObject(raw.inventory) ? raw.inventory : null,
  };
}

/**
 * @param {Array<[string, Uint8Array]>} entries  pares chunkKey -> dados
 * @param {number} seed
 * @param {{x,y,z}} player
 * @param {object} [game]  estado de jogo (opcional; ver `makeGame`)
 * @returns {string}
 */
export function serializeChunks(entries, seed, player, game) {
  const chunks = {};
  for (const [key, data] of entries) chunks[key] = bytesToB64(data);
  const save = { v: VERSION, seed, player, chunks };
  if (game != null) save.game = game; // sem `game` o JSON é idêntico ao da Parte 1
  return JSON.stringify(save);
}

/**
 * @param {string} str
 * @returns {{seed:number, player:{x,y,z}|null, chunks:Array<[string,Uint8Array]>, game:object|null} | null}
 *   `player` é null se faltar ou não tiver 3 números finitos; `game` é null em saves
 *   antigos ou quando o campo está corrompido; um `game` ruim nunca invalida os chunks.
 */
export function deserializeChunks(str) {
  let obj;
  try {
    obj = JSON.parse(str);
  } catch {
    return null;
  }
  if (!isPlainObject(obj) || obj.v !== VERSION || !isPlainObject(obj.chunks)) return null;

  const chunks = [];
  try {
    for (const key of Object.keys(obj.chunks)) {
      if (typeof obj.chunks[key] !== 'string') return null;
      chunks.push([key, b64ToBytes(obj.chunks[key])]);
    }
  } catch {
    return null;
  }
  return { seed: obj.seed, player: sanitizePlayer(obj.player), chunks, game: sanitizeGame(obj.game) };
}

// --- Browser (localStorage) ---

export function saveWorld(world, player, game) {
  const entries = [];
  for (const key of world.modified) {
    const data = world.chunks.get(key);
    if (data) entries.push([key, data]);
  }
  try {
    localStorage.setItem(KEY, serializeChunks(entries, world.seed, player, game));
    return true;
  } catch {
    return false;
  }
}

export function loadWorld() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? deserializeChunks(s) : null;
  } catch {
    return null;
  }
}

export function clearWorld() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave() {
  try {
    return localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}
