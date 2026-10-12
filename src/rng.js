// RNG determinístico (mulberry32). Fonte única: atlas, spawn e IA usam daqui.
// Nunca usar Math.random() em geração de mundo, IA ou spawn (constitution):
// a aleatoriedade entra sempre por um `rng` injetado, para os testes serem
// reprodutíveis.

/** @param {number} seed @returns {() => number} função que devolve [0, 1) */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Empacota o gerador com helpers usados pela IA e pelo spawn.
 * @param {number} seed
 */
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    /** [0, 1) */
    next,
    /** inteiro em [0, n) */
    int: (n) => Math.floor(next() * n),
    /** real em [a, b) */
    range: (a, b) => a + next() * (b - a),
    /** true com probabilidade p */
    chance: (p) => next() < p,
    /** elemento aleatório de um array */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** ângulo em [0, 2π) */
    angle: () => next() * Math.PI * 2,
  };
}
