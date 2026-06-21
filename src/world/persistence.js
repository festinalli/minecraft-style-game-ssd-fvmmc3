// Persistência do mundo infinito: salva apenas os CHUNKS MODIFICADOS.
// Parte PURA (serialize/deserialize) testável headless; parte browser usa
// localStorage e o objeto World.

const VERSION = 2;
const KEY = 'voxelcraft.save.v2';

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

// --- PURO ---

/**
 * @param {Array<[string, Uint8Array]>} entries  pares chunkKey -> dados
 * @param {number} seed
 * @param {{x,y,z}} player
 * @returns {string}
 */
export function serializeChunks(entries, seed, player) {
  const chunks = {};
  for (const [key, data] of entries) chunks[key] = bytesToB64(data);
  return JSON.stringify({ v: VERSION, seed, player, chunks });
}

/**
 * @param {string} str
 * @returns {{seed:number, player:object, chunks:Array<[string,Uint8Array]>} | null}
 */
export function deserializeChunks(str) {
  let obj;
  try {
    obj = JSON.parse(str);
  } catch {
    return null;
  }
  if (!obj || obj.v !== VERSION || typeof obj.chunks !== 'object') return null;

  const chunks = [];
  try {
    for (const key of Object.keys(obj.chunks)) {
      chunks.push([key, b64ToBytes(obj.chunks[key])]);
    }
  } catch {
    return null;
  }
  return { seed: obj.seed, player: obj.player, chunks };
}

// --- Browser (localStorage) ---

export function saveWorld(world, player) {
  const entries = [];
  for (const key of world.modified) {
    const data = world.chunks.get(key);
    if (data) entries.push([key, data]);
  }
  try {
    localStorage.setItem(KEY, serializeChunks(entries, world.seed, player));
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
