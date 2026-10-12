import { collidesBox } from '../entities/physics.js';

// Dimensões do jogador (em blocos). `eye` = altura do olho a partir dos pés.
export const PLAYER = { halfWidth: 0.3, height: 1.8, eye: 1.62 };

/**
 * O corpo do jogador (AABB), com o OLHO em (x, y, z), colide com algum bloco
 * sólido do mundo? Função pura — usa coordenadas GLOBAIS de bloco
 * (world.getBlock gera o chunk sob demanda). Testável headless.
 *
 * Só converte olho → pés: a colisão em si mora em `collidesBox`
 * (src/entities/physics.js), a fonte única usada também pelos mobs.
 *
 * @param {import('../world/world.js').World} world
 */
export function collidesAABB(world, x, y, z) {
  return collidesBox(world, x, y - PLAYER.eye, z, PLAYER.halfWidth, PLAYER.height);
}
