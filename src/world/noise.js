// Value noise 2D determinístico.
// Mesma seed ⇒ mesmo terreno (exigência da constitution). Sem Math.random().

// Hash inteiro -> [0, 1) determinístico a partir de (x, z, seed).
function hash2(x, z, seed) {
  let h = (x | 0) * 374761393 + (z | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0, 1)
}

// Interpolação suave (smoothstep / fade do Perlin).
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Ruído de valor numa escala. Retorna ~[0, 1].
function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);

  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed);
  const v11 = hash2(x0 + 1, z0 + 1, seed);

  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
}

/**
 * Cria uma função de ruído 2D fractal (várias oitavas) determinística.
 * @param {number} seed
 * @returns {(x:number, z:number) => number} valor ~[-1, 1]
 */
export function makeNoise2D(seed) {
  const octaves = 4;
  const baseFreq = 0.045;
  const persistence = 0.5;

  return function noise2D(x, z) {
    let amp = 1;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(x * freq, z * freq, seed + o * 1013) * amp;
      norm += amp;
      amp *= persistence;
      freq *= 2;
    }
    // [0,1] -> [-1,1]
    return (sum / norm) * 2 - 1;
  };
}
