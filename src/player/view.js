import * as THREE from 'three';

// Geometria PURA da câmera do jogador (sem DOM): testável no Node.
//
// ARMADILHA que isto resolve: o PointerLockControls guarda a orientação num Euler
// 'YXZ' interno e só escreve `camera.quaternion`; `camera.rotation` continua na
// ordem padrão 'XYZ' e é só uma visão derivada — seu `.y` NÃO é o yaw (errava o
// avatar em 3ª pessoa para yaw > 90° ou com a cabeça inclinada). Sempre extraia o yaw
// do quaternion, na ordem 'YXZ'.

const euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Yaw da cabeça (rad) a partir do quaternion da câmera. 0 = olhando para −Z. */
export function headYaw(quaternion) {
  euler.setFromQuaternion(quaternion, 'YXZ');
  return euler.y;
}

/**
 * Yaw do AVATAR (frente do modelo = +Z, yaw = atan2(dirX, dirZ)) para que ele
 * olhe para onde a câmera olha: a câmera olha para −Z, então somamos π.
 */
export function avatarYaw(quaternion) {
  return headYaw(quaternion) + Math.PI;
}

/**
 * Quanto a câmera de 3ª pessoa recua atrás da cabeça: anda para trás em passos de
 * `step` até esbarrar num bloco sólido e para um pouco antes, nunca menos que `min`.
 *
 * @param {(x:number,y:number,z:number)=>boolean} solidAt  consulta em coordenadas de MUNDO (inteiras via floor)
 * @param {{x:number,y:number,z:number}} head  posição da cabeça
 * @param {{x:number,y:number,z:number}} forward  direção em que a cabeça olha (unitária)
 * @param {number} maxDist  recuo máximo
 */
export function thirdPersonBack(solidAt, head, forward, maxDist, { step = 0.2, margin = 0.25, min = 0.3 } = {}) {
  let d = 0;
  for (; d < maxDist; d += step) {
    const x = head.x - forward.x * (d + margin);
    const y = head.y - forward.y * (d + margin);
    const z = head.z - forward.z * (d + margin);
    if (solidAt(Math.floor(x), Math.floor(y), Math.floor(z))) break;
  }
  return Math.max(min, d - step / 2);
}

/** Abaixo disto a câmera está praticamente dentro da cabeça: esconda o avatar. */
export const AVATAR_HIDE_BELOW = 0.9;
