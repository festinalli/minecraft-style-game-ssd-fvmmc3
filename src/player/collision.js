import { isSolid } from '../blocks.js';

// Dimensões do jogador (em blocos). `eye` = altura do olho a partir dos pés.
export const PLAYER = { halfWidth: 0.3, height: 1.8, eye: 1.62 };

/**
 * O corpo do jogador (AABB), com o OLHO em (x, y, z), colide com algum bloco
 * sólido do mundo? Função pura — usa coordenadas GLOBAIS de bloco
 * (world.getBlock gera o chunk sob demanda). Testável headless.
 *
 * @param {import('../world/world.js').World} world
 */
export function collidesAABB(world, x, y, z) {
  const feet = y - PLAYER.eye;
  const minX = x - PLAYER.halfWidth;
  const maxX = x + PLAYER.halfWidth;
  const minZ = z - PLAYER.halfWidth;
  const maxZ = z + PLAYER.halfWidth;
  const minY = feet;
  const maxY = feet + PLAYER.height;

  const vx0 = Math.floor(minX);
  const vx1 = Math.floor(maxX);
  const vy0 = Math.floor(minY);
  const vy1 = Math.floor(maxY);
  const vz0 = Math.floor(minZ);
  const vz1 = Math.floor(maxZ);

  for (let vx = vx0; vx <= vx1; vx++) {
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vz = vz0; vz <= vz1; vz++) {
        if (isSolid(world.getBlock(vx, vy, vz))) return true;
      }
    }
  }
  return false;
}
