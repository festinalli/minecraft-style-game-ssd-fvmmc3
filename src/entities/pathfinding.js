// Caminho local (feature 017): busca em largura PURA — sem Three.js, sem mundo e
// sem `Math.random`. O módulo não conhece o mundo: recebe as consultas por função
// (`walk.free` e `walk.ground`) e devolve a sequência de células a percorrer. O
// gerenciador (`manager.js`) monta essas funções a partir de `world.getBlock` e
// `collidesBox`.
//
// Convenções: células são inteiras (blocos); `y` é a altura dos PÉS. A grade da
// busca é (x, z) e `y` acompanha o chão. O corpo tem ~2 blocos: a célula dos pés e a
// de cima precisam estar livres.
//
// Vizinhança, em ordem fixa (+X, −X, +Z, −Z), para empates determinísticos. Para
// cada vizinho (nx, nz) saindo de (x, y, z), a altura de destino é a primeira que
// couber, nesta ordem:
//   1. degrau: o bloco à altura dos pés é sólido, o destino cabe 1 acima e a origem
//      também tem teto livre para o corpo subir ⇒ y + 1;
//   2. plano: o corpo cabe em y e há chão ⇒ y;
//   3. descida: o corpo cabe em y e a coluna fica livre até o destino y − k, com
//      chão em y − k, para k = 1..MAX_DROP ⇒ y − k.
// Qualquer outro caso: o vizinho não é alcançável (nada de atravessar bloco, nada de
// degrau de 2 nem de queda maior que MAX_DROP).

/** Constantes de busca (fonte única). Balanceamento de criatura NÃO mora aqui. */
export const PATH = {
  RADIUS: 12, // meia-janela: a janela é centrada entre o mob e o alvo (25 × 25); alcança alvos a até 2·RADIUS por eixo
  MAX_NODES: 700, // teto de células descobertas por busca (a janela inteira tem 625)
  REPLAN_EVERY: 0.5, // s entre replanejamentos de um mob que persegue
  MAX_DROP: 2, // maior queda aceita, em blocos
};

const DX = [1, -1, 0, 0];
const DZ = [0, 0, 1, -1];

/**
 * Altura de destino ao entrar na coluna (nx, nz) saindo de (x, y, z), ou null.
 * `walk.free(x,y,z)`: pés e cabeça livres. `walk.ground(x,y,z)`: bloco em y − 1 sólido.
 * Degrau e plano são exclusivos (o degrau exige o bloco à altura dos pés sólido,
 * o plano exige esse mesmo bloco livre), então a ordem não muda o resultado.
 */
function landing(walk, ox, oy, oz, x, z, maxDrop) {
  // Subir 1 exige o destino livre e a origem com teto livre (o corpo passa por cima).
  if (walk.ground(x, oy + 1, z) && walk.free(x, oy + 1, z) && walk.free(ox, oy + 1, oz)) return oy + 1;
  if (!walk.free(x, oy, z)) return null;
  if (walk.ground(x, oy, z)) return oy;
  for (let k = 1; k <= maxDrop; k++) {
    const t = oy - k;
    if (!walk.free(x, t, z)) return null; // a coluna até o destino precisa estar livre
    if (walk.ground(x, t, z)) return t;
  }
  return null;
}

/**
 * Busca em largura de `start` até a coluna de `goal` (só X e Z do alvo importam; o
 * `y` com que a busca chega à coluna é o que vai no caminho). Não confere se o
 * próprio início é um lugar válido: a busca parte dele.
 *
 * `opts` (todos opcionais): `radius` (PATH.RADIUS), `maxNodes` (PATH.MAX_NODES),
 * `maxDrop` (PATH.MAX_DROP).
 *
 * @param {{free:(x:number,y:number,z:number)=>boolean, ground:(x:number,y:number,z:number)=>boolean}} walk
 * @param {{x:number,y:number,z:number}} start células inteiras (y = pés)
 * @param {{x:number,z:number}} goal célula inteira (y, se houver, é ignorado)
 * @param {{radius?:number, maxNodes?:number, maxDrop?:number}} [opts]
 * @returns {{path: Array<{x:number,y:number,z:number}>|null, visited: number}}
 *   `path`: waypoints do início (exclusivo) ao alvo (inclusivo); `[]` se o início já
 *   está na coluna do alvo; `null` se o alvo está fora da janela, se não há caminho
 *   dentro dela ou se o teto de nós acabou antes. `visited`: células descobertas
 *   (≤ maxNodes; 0 quando nem começou a busca).
 */
export function searchPath(walk, start, goal, opts = {}) {
  const radius = opts.radius ?? PATH.RADIUS;
  const maxNodes = opts.maxNodes ?? PATH.MAX_NODES;
  const maxDrop = opts.maxDrop ?? PATH.MAX_DROP;
  const sx = start.x;
  const sz = start.z;
  const gx = goal.x;
  const gz = goal.z;

  if (gx === sx && gz === sz) return { path: [], visited: 0 };
  // Janela centrada entre início e alvo: cobre alvos a até 2·radius em cada eixo.
  if (Math.abs(gx - sx) > 2 * radius || Math.abs(gz - sz) > 2 * radius) return { path: null, visited: 0 };
  const cx = Math.floor((sx + gx) / 2);
  const cz = Math.floor((sz + gz) / 2);

  // Células descobertas, em arrays paralelos. A raiz (índice 0) não tem pai.
  const side = 2 * radius + 1;
  const seen = new Uint8Array(side * side); // índice = (x − cx + radius) · side + (z − cz + radius)
  const qx = [sx];
  const qy = [start.y];
  const qz = [sz];
  const qp = [-1];
  seen[(sx - cx + radius) * side + (sz - cz + radius)] = 1;

  let found = -1;
  for (let head = 0; head < qx.length && found < 0; head++) {
    const x = qx[head];
    const y = qy[head];
    const z = qz[head];
    for (let d = 0; d < 4 && found < 0; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (Math.abs(nx - cx) > radius || Math.abs(nz - cz) > radius) continue; // fora da janela
      const k = (nx - cx + radius) * side + (nz - cz + radius);
      if (seen[k]) continue;
      const ny = landing(walk, x, y, z, nx, nz, maxDrop);
      if (ny === null) continue;
      if (qx.length >= maxNodes) return { path: null, visited: qx.length }; // teto de nós
      seen[k] = 1;
      qx.push(nx);
      qy.push(ny);
      qz.push(nz);
      qp.push(head);
      if (nx === gx && nz === gz) found = qx.length - 1; // BFS: a 1ª descoberta é a mais curta
    }
  }

  if (found < 0) return { path: null, visited: qx.length };
  const path = [];
  for (let i = found; i > 0; i = qp[i]) path.push({ x: qx[i], y: qy[i], z: qz[i] });
  path.reverse();
  return { path, visited: qx.length };
}

/**
 * Só o caminho (ver `searchPath`). Mesma entrada ⇒ mesma saída: não há aleatoriedade.
 * @returns {Array<{x:number,y:number,z:number}>|null}
 */
export function findPath(walk, start, goal, opts) {
  return searchPath(walk, start, goal, opts).path;
}
