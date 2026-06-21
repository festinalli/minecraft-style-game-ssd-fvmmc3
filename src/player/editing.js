import * as THREE from 'three';
import { BLOCK, isSolid } from '../blocks.js';

export const REACH = 8; // alcance (em blocos) para mirar/editar

// Teclas 1–8 (e roda do mouse) -> tipo de bloco a colocar.
export const HOTBAR = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.COBBLE,
];

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
 * Mira por raycast, realce do bloco alvo e edição (remover/colocar) num mundo
 * de chunks.
 *
 * @param {object} opts
 * @param {THREE.Camera} opts.camera
 * @param {THREE.Scene} opts.scene
 * @param {import('../world/world.js').World} opts.world
 * @param {() => THREE.Mesh[]} opts.getMeshes  malhas de chunk ativas
 * @param {(bx:number, bz:number) => void} opts.rebuildAround  rebuilda chunk(s)
 * @param {() => boolean} opts.isLocked
 * @param {(out:THREE.Vector3) => void} opts.getPlayerPos
 * @param {(blockType:number) => void} [opts.onSelect]
 * @param {() => void} [opts.onEdit]  notifica edição (ex.: autosave)
 */
export function createEditing(opts) {
  const {
    camera, scene, world, getMeshes, rebuildAround,
    isLocked, getPlayerPos, onSelect, onEdit,
  } = opts;

  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  const center = new THREE.Vector2(0, 0);

  let selectedIndex = 0;
  let current = null;

  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 })
  );
  highlight.visible = false;
  scene.add(highlight);

  const playerPos = new THREE.Vector3();

  function playerCell() {
    getPlayerPos(playerPos);
    return {
      x: Math.floor(playerPos.x),
      y: Math.floor(playerPos.y),
      z: Math.floor(playerPos.z),
    };
  }

  function pick() {
    const hits = raycaster.intersectObjects(getMeshes(), false);
    if (hits.length === 0) return null;
    const h = hits[0];
    if (!h.face) return null;
    return resolveTarget(h.point, h.face.normal);
  }

  function updateHighlight() {
    if (!isLocked()) {
      highlight.visible = false;
      current = null;
      return;
    }
    raycaster.setFromCamera(center, camera);
    current = pick();
    if (!current) {
      highlight.visible = false;
      return;
    }
    highlight.visible = true;
    highlight.position.set(current.hit.x + 0.5, current.hit.y + 0.5, current.hit.z + 0.5);
  }

  function sameCell(a, b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  function onMouseDown(e) {
    if (!isLocked() || !current) return;

    if (e.button === 0) {
      const { x, y, z } = current.hit;
      world.setBlock(x, y, z, BLOCK.AIR);
      rebuildAround(x, z);
      onEdit?.();
    } else if (e.button === 2) {
      const p = current.place;
      const occupied = isSolid(world.getBlock(p.x, p.y, p.z));
      if (!occupied && !sameCell(p, playerCell())) {
        world.setBlock(p.x, p.y, p.z, HOTBAR[selectedIndex]);
        rebuildAround(p.x, p.z);
        onEdit?.();
      }
    }
  }

  function onKeyDown(e) {
    const n = Number(e.key);
    if (n >= 1 && n <= HOTBAR.length) {
      selectedIndex = n - 1;
      onSelect?.(HOTBAR[selectedIndex]);
    }
  }

  function onWheel(e) {
    if (!isLocked()) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    selectedIndex = (selectedIndex + dir + HOTBAR.length) % HOTBAR.length;
    onSelect?.(HOTBAR[selectedIndex]);
    e.preventDefault();
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', onContextMenu);

  onSelect?.(HOTBAR[selectedIndex]);

  function dispose() {
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('contextmenu', onContextMenu);
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight.material.dispose();
  }

  return { updateHighlight, dispose };
}
