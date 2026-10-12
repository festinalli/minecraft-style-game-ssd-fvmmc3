// Física genérica de entidades (feature 010): UM só código de colisão e
// movimento para o jogador e para os mobs. PURO — usa só `world.getBlock`
// (coordenadas globais de bloco) e `isSolid`; não importa Three.js nem DOM,
// então roda no Node (testes headless).
//
// Convenções: Y para cima; `body.pos` = CENTRO DOS PÉS; tempo em segundos;
// velocidades em blocos/s. A caixa (AABB) do corpo vai de `pos.y` até
// `pos.y + height`, com meia-largura `halfW` em X e Z.
//
// Colisão por eixo com revert (ADR 0004): cada eixo é movido em passos de no
// máximo `MAX_STEP`; o passo que colide é desfeito e o eixo para. Sem "snap".

import { isSolid } from '../blocks.js';

// --- Constantes (fonte única) ---
export const GRAVITY = 28; // blocos/s² — jogador e mobs
export const MAX_STEP = 0.2; // subdivisão do movimento (anti-tunneling)
export const STEP_REACH = 0.3; // até onde `canStepUp` olha à frente (blocos)
const MAX_UNSTICK = 64; // teto de iterações ao desencalhar (mundo tem 48 camadas)

// Movimento do jogador (valores da Parte 1; fonte única aqui).
export const MOVE = {
  walk: 6, // andar (blocos/s)
  runMult: 1.8, // Ctrl
  fly: 14, // horizontal em modo voo
  flyVertical: 12, // subir/descer em modo voo
  jump: 9, // impulso do pulo
};

/** Constante de tempo (s) do decaimento exponencial do knockback horizontal. */
export const KNOCK_TAU = 0.25;
export const KNOCK_CUTOFF = 0.05; // b/s — abaixo disso o knockback horizontal zera

/**
 * Queda mínima (blocos) para `stepPlayer` reportar um pouso. Maior que
 * `MAX_STEP`: depois de pousar, o revert deixa o corpo a menos de um passo do
 * chão e ele "tremula" até assentar (alguns `landed` de poucos centímetros).
 */
export const LAND_MIN_DISTANCE = 0.25;

/**
 * @typedef {object} Body
 * @property {{x:number,y:number,z:number}} pos  centro dos PÉS
 * @property {{x:number,y:number,z:number}} vel  blocos/s
 * @property {number} halfW   meia-largura (X e Z)
 * @property {number} height  altura da caixa
 * @property {boolean} onGround
 */

// ---------------------------------------------------------------------------
// Colisão
// ---------------------------------------------------------------------------

/**
 * A caixa (centro da base em `x,z`; pés em `feetY`) sobrepõe algum bloco
 * sólido? Função pura, coordenadas GLOBAIS (world.getBlock gera o chunk sob
 * demanda). Bordas inclusivas (`floor(max)`): encostar exatamente na aresta de
 * um bloco conta como colisão — é o comportamento da Parte 1.
 *
 * @param {import('../world/world.js').World} world
 */
export function collidesBox(world, x, feetY, z, halfW, height) {
  const vx0 = Math.floor(x - halfW);
  const vx1 = Math.floor(x + halfW);
  const vy0 = Math.floor(feetY);
  const vy1 = Math.floor(feetY + height);
  const vz0 = Math.floor(z - halfW);
  const vz1 = Math.floor(z + halfW);

  for (let vx = vx0; vx <= vx1; vx++) {
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vz = vz0; vz <= vz1; vz++) {
        if (isSolid(world.getBlock(vx, vy, vz))) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Corpo
// ---------------------------------------------------------------------------

/**
 * Cria um corpo parado, no ar (`onGround = false` até o primeiro pouso).
 * @param {{x:number,y:number,z:number,halfW:number,height:number}} o
 *   `y` = altura dos PÉS.
 * @returns {Body}
 */
export function createBody({ x, y, z, halfW, height }) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    halfW,
    height,
    onGround: false,
  };
}

// Move `body` em UM eixo (0=x, 1=y, 2=z), subdividido em passos <= MAX_STEP,
// revertendo o passo que colidir. Retorna true se algum passo foi bloqueado.
function moveAxis(world, body, axis, amount) {
  if (amount === 0) return false;
  const p = body.pos;
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / MAX_STEP));
  const step = amount / steps;
  for (let i = 0; i < steps; i++) {
    const prev = axis === 0 ? p.x : axis === 1 ? p.y : p.z;
    const next = prev + step;
    if (axis === 0) p.x = next;
    else if (axis === 1) p.y = next;
    else p.z = next;
    if (collidesBox(world, p.x, p.y, p.z, body.halfW, body.height)) {
      if (axis === 0) p.x = prev;
      else if (axis === 1) p.y = prev;
      else p.z = prev;
      return true;
    }
  }
  return false;
}

// Corpo sobreposto a blocos (nasceu dentro do terreno, ou um bloco foi
// colocado em cima dele): sobe até a próxima aresta de bloco, repetidamente,
// até a caixa ficar livre. X/Z não mudam. O mundo acaba em y = WORLD_HEIGHT
// (getBlock devolve AIR acima), então o laço termina; MAX_UNSTICK é só rede de
// segurança para mundos falsos.
function unstick(world, body) {
  const p = body.pos;
  if (!collidesBox(world, p.x, p.y, p.z, body.halfW, body.height)) return;
  for (let i = 0; i < MAX_UNSTICK; i++) {
    p.y = Math.floor(p.y) + 1;
    if (!collidesBox(world, p.x, p.y, p.z, body.halfW, body.height)) break;
  }
  if (body.vel.y < 0) body.vel.y = 0;
}

/**
 * Avança o corpo `dt` segundos. O chamador é dono da velocidade horizontal
 * (a IA ou o jogador escrevem `vel.x/z` antes); aqui entram gravidade,
 * colisão e `onGround`.
 *
 * Ordem: desencalhar → gravidade → mover X, Z, Y (passos ≤ MAX_STEP, revert) →
 * zerar a velocidade do eixo bloqueado.
 *
 * Resultado:
 *  - hitX/hitZ: o corpo bateu num bloco naquele eixo neste passo;
 *  - hitCeiling: bateu a cabeça subindo;
 *  - landed: passou de "no ar" para "no chão" neste passo (não repete enquanto
 *    estiver parado no chão). Logo após um pouso longo o corpo pode "tremular"
 *    até assentar (folga < MAX_STEP) e reportar novos `landed` de impacto
 *    minúsculo — filtre por `impactVy`/distância se isso importar;
 *  - impactVy: velocidade vertical (b/s, NEGATIVA) no instante do pouso; 0 se
 *    não pousou.
 *
 * @param {import('../world/world.js').World} world
 * @param {Body} body
 * @param {number} dt segundos
 * @param {{gravity?: boolean, out?: object}} [opts]
 *   gravity=false: não aplica gravidade (corpo voador); out: objeto reutilizado
 *   para o resultado (evita alocação em loops quentes).
 * @returns {{hitX:boolean,hitZ:boolean,hitCeiling:boolean,landed:boolean,impactVy:number}}
 */
export function stepBody(world, body, dt, opts) {
  const out = (opts && opts.out) || {};
  const gravity = !opts || opts.gravity !== false;
  const vel = body.vel;

  out.hitX = false;
  out.hitZ = false;
  out.hitCeiling = false;
  out.landed = false;
  out.impactVy = 0;

  unstick(world, body);

  if (vel.y > 0) body.onGround = false; // subindo não está no chão
  const wasGrounded = body.onGround;

  if (gravity) vel.y -= GRAVITY * dt;

  if (moveAxis(world, body, 0, vel.x * dt)) {
    out.hitX = true;
    vel.x = 0;
  }
  if (moveAxis(world, body, 2, vel.z * dt)) {
    out.hitZ = true;
    vel.z = 0;
  }
  if (moveAxis(world, body, 1, vel.y * dt)) {
    if (vel.y < 0) {
      body.onGround = true;
      if (!wasGrounded) {
        out.landed = true;
        out.impactVy = vel.y;
      }
    } else {
      out.hitCeiling = true;
    }
    vel.y = 0;
  } else {
    body.onGround = false;
  }
  return out;
}

/**
 * Há, logo à frente (`reach` blocos na direção `dirX,dirZ`), um degrau de
 * 1 bloco que o corpo consegue subir pulando? Predicado geométrico — quem
 * chama confere `onGround` e decide pular (`vel.y = def.jumpSpeed`).
 *
 * Verdadeiro sse: (1) à frente, na altura atual, a caixa colide (há o que
 * subir); (2) à frente, 1 bloco acima, a caixa cabe (degrau de exatamente 1 e
 * altura livre: 2 blocos acima do degrau para o zumbi, 1 para o porco); e
 * (3) no lugar atual, 1 bloco acima, a caixa cabe (a cabeça não bate no teto ao
 * subir). Direção nula ⇒ false.
 *
 * @param {import('../world/world.js').World} world
 * @param {Body} body
 * @param {number} dirX @param {number} dirZ direção horizontal (não precisa ser unitária)
 * @param {number} [reach]
 */
export function canStepUp(world, body, dirX, dirZ, reach = STEP_REACH) {
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len < 1e-9) return false;
  const p = body.pos;
  const px = p.x + (dirX / len) * reach;
  const pz = p.z + (dirZ / len) * reach;
  const { halfW, height } = body;
  if (!collidesBox(world, px, p.y, pz, halfW, height)) return false;
  if (collidesBox(world, px, p.y + 1, pz, halfW, height)) return false;
  return !collidesBox(world, p.x, p.y + 1, p.z, halfW, height);
}

// ---------------------------------------------------------------------------
// Jogador (puro): o MESMO stepBody dos mobs + andar/correr/pular/voar/knock
// ---------------------------------------------------------------------------

/**
 * Estado do jogador em volta de um corpo (pés em `body.pos`).
 * @param {Body} body
 */
export function createPlayerState(body) {
  return {
    body,
    flying: false,
    flyAllowed: true, // Sobrevivência desliga (F não faz nada)
    kx: 0, // knockback horizontal atual (b/s), decai
    kz: 0,
    peakY: body.pos.y, // maior Y dos pés desde que saiu do chão (medida de queda)
  };
}

/** Alterna o voo (tecla F). No-op se o voo não é permitido. Devolve `flying`. */
export function toggleFly(st) {
  if (!st.flyAllowed) return st.flying;
  st.flying = !st.flying;
  st.body.vel.y = 0;
  st.peakY = st.body.pos.y;
  return st.flying;
}

/** Permite/proíbe o voo; proibir desliga o voo ligado (e começa a cair dali). */
export function allowFly(st, allowed) {
  st.flyAllowed = !!allowed;
  if (!st.flyAllowed && st.flying) {
    st.flying = false;
    st.body.vel.y = 0;
    st.peakY = st.body.pos.y;
  }
}

/**
 * Empurra o jogador. A direção é o vetor horizontal de (dirX,dirZ)
 * normalizado (nulo ⇒ sem impulso horizontal); `strength` em b/s decai com
 * constante de tempo `KNOCK_TAU`; `up > 0` dá impulso vertical (e zera a
 * referência de queda: subir não conta como cair).
 */
export function knockPlayer(st, dirX, dirZ, strength, up = 0) {
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (len > 1e-9) {
    st.kx = (dirX / len) * strength;
    st.kz = (dirZ / len) * strength;
  }
  if (up > 0) {
    st.body.vel.y = up;
    st.body.onGround = false;
    st.peakY = st.body.pos.y;
  }
}

/** Zera a referência de queda (ex.: respawn): o próximo pouso mede daqui. */
export function resetPlayerFall(st) {
  st.peakY = st.body.pos.y;
}

/** Teletransporta os PÉS para (x, feetY, z): zera velocidades e queda. */
export function teleportPlayer(st, x, feetY, z) {
  const b = st.body;
  b.pos.x = x;
  b.pos.y = feetY;
  b.pos.z = z;
  b.vel.x = 0;
  b.vel.y = 0;
  b.vel.z = 0;
  b.onGround = false;
  st.kx = 0;
  st.kz = 0;
  st.peakY = feetY;
}

// Opções reutilizadas por stepPlayer (stepBody só lê, não guarda): zero alocação.
const PLAYER_OPTS = { gravity: true, out: null };

/**
 * Um quadro do jogador. `input` = { moveX, moveZ (unitário ou 0), run, up,
 * down, jump } — `jump` é um pedido de 1 quadro; `up/down` valem em voo.
 *
 * Resultado (reutilize `out` para não alocar): { hitX, hitZ, hitCeiling,
 * landed, impactVy } de `stepBody` + `fall`: distância caída (pico − pouso, em
 * blocos) se este quadro foi um pouso de queda >= `LAND_MIN_DISTANCE`, senão 0.
 * Em voo nunca há `landed` nem `fall`.
 *
 * @param {import('../world/world.js').World} world
 * @param {ReturnType<typeof createPlayerState>} st
 * @param {{moveX:number,moveZ:number,run:boolean,up:boolean,down:boolean,jump:boolean}} input
 * @param {number} dt
 * @param {object} [out]
 */
export function stepPlayer(world, st, input, dt, out = {}) {
  const body = st.body;
  const vel = body.vel;
  const flying = st.flying;

  if (input.jump && !flying && body.onGround) {
    vel.y = MOVE.jump;
    body.onGround = false;
  }

  // Knockback: v(t) = k·e^(−t/τ). A velocidade MÉDIA no quadro é k·τ·(1−f)/dt
  // (f = e^(−dt/τ)), o que torna o deslocamento total independente do FPS.
  const knocked = (st.kx !== 0 || st.kz !== 0) && dt > 0;
  let f = 1;
  let kAvgX = 0;
  let kAvgZ = 0;
  if (knocked) {
    f = Math.exp(-dt / KNOCK_TAU);
    const avg = (KNOCK_TAU * (1 - f)) / dt;
    kAvgX = st.kx * avg;
    kAvgZ = st.kz * avg;
  }

  const hSpeed = (flying ? MOVE.fly : MOVE.walk) * (input.run ? MOVE.runMult : 1);
  vel.x = input.moveX * hSpeed + kAvgX;
  vel.z = input.moveZ * hSpeed + kAvgZ;
  if (flying) {
    vel.y = (input.up ? MOVE.flyVertical : 0) - (input.down ? MOVE.flyVertical : 0);
  }

  PLAYER_OPTS.gravity = !flying;
  PLAYER_OPTS.out = out;
  stepBody(world, body, dt, PLAYER_OPTS);

  // knockback: parede corta o eixo; senão decai e, abaixo do corte, zera
  if (out.hitX) st.kx = 0;
  if (out.hitZ) st.kz = 0;
  if (knocked) {
    st.kx *= f;
    st.kz *= f;
    if (st.kx * st.kx + st.kz * st.kz < KNOCK_CUTOFF * KNOCK_CUTOFF) {
      st.kx = 0;
      st.kz = 0;
    }
  }

  // queda
  out.fall = 0;
  if (flying) {
    body.onGround = false;
    out.landed = false;
    out.impactVy = 0;
    st.peakY = body.pos.y;
  } else if (out.landed) {
    const d = st.peakY - body.pos.y;
    if (d >= LAND_MIN_DISTANCE) out.fall = d;
    st.peakY = body.pos.y;
  } else if (body.onGround) {
    st.peakY = body.pos.y;
  } else if (body.pos.y > st.peakY) {
    st.peakY = body.pos.y;
  }
  return out;
}
