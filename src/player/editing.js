import * as THREE from 'three';
import { BLOCK, isSolid } from '../blocks.js';
import { WORLD_HEIGHT } from '../world/terrain.js';

export const REACH = 8; // alcance (em blocos) para mirar/editar

/**
 * Função PURA: do ponto de impacto + normal da face para coordenadas GLOBAIS
 * de bloco (a geometria dos chunks já está em coords de mundo, sem offset).
 *
 * @returns {{hit:{x,y,z}, place:{x,y,z}}}
 *   hit   = bloco atingido (para remover)
 *   place = vizinho na direção da normal (para colocar)
 */
export function resolveTarget(point, normal) {
  const hit = {
    x: Math.floor(point.x - normal.x * 0.5),
    y: Math.floor(point.y - normal.y * 0.5),
    z: Math.floor(point.z - normal.z * 0.5),
  };
  const place = {
    x: hit.x + Math.round(normal.x),
    y: hit.y + Math.round(normal.y),
    z: hit.z + Math.round(normal.z),
  };
  return { hit, place };
}

/**
 * PURA: a célula inteira de bloco `cell` intersecta a caixa de uma entidade
 * (centro dos pés em x,z; `feetY` na base; `halfW` e `height`)? Usada para
 * não prender o jogador (ou uma criatura) dentro de um bloco recém-colocado.
 */
export function cellOverlapsBox(cell, x, feetY, z, halfW, height) {
  return (
    cell.x + 1 > x - halfW && cell.x < x + halfW &&
    cell.y + 1 > feetY && cell.y < feetY + height &&
    cell.z + 1 > z - halfW && cell.z < z + halfW
  );
}

/**
 * Mira por raycast, realce do bloco alvo e edição (remover/colocar) num mundo
 * de chunks. As REGRAS (o que colocar, o que acontece ao quebrar, golpear
 * criaturas, comer) ficam no host via callbacks — aqui só há geometria.
 *
 * @param {object} opts
 * @param {THREE.Camera} opts.camera
 * @param {THREE.Scene} opts.scene
 * @param {import('../world/world.js').World} opts.world
 * @param {() => THREE.Mesh[]} opts.getMeshes  malhas de chunk ativas
 * @param {(bx:number, bz:number) => void} opts.rebuildAround  rebuilda chunk(s)
 * @param {() => boolean} opts.isLocked
 * @param {() => number|null} opts.getHeldBlock  bloco que seria colocado (ou null)
 * @param {(cell:{x,y,z}) => boolean} [opts.isCellBlocked]  jogador/criatura ocupa a célula?
 * @param {(ray:{origin,dir,blockDistance:number}) => boolean} [opts.onAttack]
 *        true = acertou uma criatura (o clique não quebra bloco)
 * @param {(block:number, cell:{x,y,z}) => void} [opts.onBreak]
 * @param {(block:number, cell:{x,y,z}) => void} [opts.onPlace]
 * @param {() => void} [opts.onUse]   botão direito sem bloco na mão (ex.: comer)
 * @param {() => void} [opts.onSwing] qualquer golpe/colocação (animação da mão)
 * @param {() => void} [opts.onEdit]  notifica edição (ex.: autosave)
 */
export function createEditing(opts) {
  const {
    camera, scene, world, getMeshes, rebuildAround, isLocked, getHeldBlock,
    isCellBlocked, onAttack, onBreak, onPlace, onUse, onSwing, onEdit,
  } = opts;

  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const center = new THREE.Vector2(0, 0);

  let current = null; // { hit, place, distance } do quadro atual

  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 })
  );
  highlight.visible = false;
  scene.add(highlight);

  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  function pick() {
    const hits = raycaster.intersectObjects(getMeshes(), false);
    if (hits.length === 0) return null;
    const h = hits[0];
    if (!h.face) return null;
    const t = resolveTarget(h.point, h.face.normal);
    t.distance = h.distance;
    return t;
  }

  // Recalcula o raio a partir da câmera NESTE instante. O clique usa isto em vez
  // do raio do último quadro: a mira nunca fica um quadro atrasada em relação
  // ao mouse (e o golpe acerta o que está sob a mira de verdade).
  function refreshTarget() {
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(center, camera);
    current = pick();
  }

  function updateHighlight() {
    if (!isLocked()) {
      highlight.visible = false;
      current = null;
      return;
    }
    refreshTarget();
    if (!current) {
      highlight.visible = false;
      return;
    }
    highlight.visible = true;
    highlight.position.set(current.hit.x + 0.5, current.hit.y + 0.5, current.hit.z + 0.5);
  }

  function onMouseDown(e) {
    if (!isLocked()) return;
    refreshTarget();

    if (e.button === 0) {
      onSwing?.();
      // 1) criatura na mira (e mais perto que o bloco mirado)?
      if (onAttack) {
        rayOrigin.copy(raycaster.ray.origin);
        rayDir.copy(raycaster.ray.direction);
        const blockDistance = current ? current.distance : Infinity;
        if (onAttack({ origin: rayOrigin, dir: rayDir, blockDistance })) return;
      }
      // 2) senão, quebra o bloco. O fundo do mundo (y = 0) é indestrutível.
      if (!current) return;
      const { x, y, z } = current.hit;
      if (y <= 0) return;
      const block = world.getBlock(x, y, z);
      if (block === BLOCK.AIR) return;
      world.setBlock(x, y, z, BLOCK.AIR);
      rebuildAround(x, z);
      onBreak?.(block, { x, y, z });
      onEdit?.();
    } else if (e.button === 2) {
      const held = getHeldBlock?.() ?? null;
      if (held == null) {
        onUse?.();
        return;
      }
      if (!current) return;
      const p = current.place;
      if (p.y < 0 || p.y >= WORLD_HEIGHT) return; // teto do mundo: nada a colocar (e nada a gastar)
      if (isSolid(world.getBlock(p.x, p.y, p.z))) return;
      if (isCellBlocked?.(p)) return;
      onSwing?.();
      world.setBlock(p.x, p.y, p.z, held);
      rebuildAround(p.x, p.z);
      onPlace?.(held, p);
      onEdit?.();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('contextmenu', onContextMenu);

  function dispose() {
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('contextmenu', onContextMenu);
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight.material.dispose();
  }

  return { updateHighlight, dispose };
}
