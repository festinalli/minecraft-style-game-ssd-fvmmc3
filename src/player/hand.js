import * as THREE from 'three';
import { BLOCK_COLOR } from '../blocks.js';
import { ITEM } from '../game/items.js';

// Mão em 1ª pessoa: o item selecionado pendurado na câmera, no canto inferior
// direito. Balança ao andar e faz um arco ao golpear/colocar. Sem texturas:
// caixas coloridas (a constitution proíbe arquivos de imagem na Parte 2).

const SWING_TIME = 0.28; // s por golpe
const REST = new THREE.Vector3(0.46, -0.4, -0.8);

function box(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, depthTest: false, depthWrite: false })
  );
}

function buildItem(held) {
  const g = new THREE.Group();
  if (!held) {
    // mão vazia: um "braço" de pele
    const arm = box(0.14, 0.14, 0.5, 0xc99774);
    arm.position.set(0, -0.02, -0.12);
    g.add(arm);
  } else if (held.kind === 'block') {
    const cube = box(0.2, 0.2, 0.2, BLOCK_COLOR[held.block] ?? 0x888888);
    cube.rotation.set(0.35, 0.7, 0);
    g.add(cube);
  } else if (held.item === ITEM.SWORD) {
    const blade = box(0.05, 0.5, 0.1, 0xd7dbe0);
    blade.position.y = 0.3;
    const guard = box(0.26, 0.05, 0.08, 0x6b4a2a);
    guard.position.y = 0.04;
    const grip = box(0.06, 0.18, 0.06, 0x4a3320);
    grip.position.y = -0.07;
    g.add(blade, guard, grip);
    g.rotation.set(0.5, 0.2, -0.35);
  } else if (held.item === ITEM.PORK) {
    const meat = box(0.3, 0.18, 0.2, 0xe08a8f);
    const fat = box(0.3, 0.05, 0.2, 0xf6d2d4);
    fat.position.y = 0.115;
    g.add(meat, fat);
    g.rotation.set(0.3, 0.6, 0);
  }
  g.traverse((o) => {
    if (o.isMesh) o.renderOrder = 999; // desenha por cima do mundo
  });
  return g;
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
}

/**
 * @param {THREE.Camera} camera  a câmera da CABEÇA (a mão é filha dela)
 */
export function createHand(camera) {
  const root = new THREE.Group();
  root.position.copy(REST);
  camera.add(root);

  let item = null;
  let heldKey = '';
  let swingT = 1; // 0..1; 1 = parado
  let bobT = 0;

  function setHeld(held) {
    const key = held ? (held.kind === 'block' ? 'b' + held.block : 'i' + held.item) : '';
    if (key === heldKey && item) return;
    heldKey = key;
    if (item) {
      root.remove(item);
      disposeGroup(item);
    }
    item = buildItem(held);
    root.add(item);
  }

  setHeld(null);

  return {
    setHeld,
    swing() {
      swingT = 0;
    },
    setVisible(v) {
      root.visible = v;
    },
    /** @param {number} speed velocidade horizontal do jogador (b/s) */
    update(dt, speed) {
      if (swingT < 1) swingT = Math.min(1, swingT + dt / SWING_TIME);
      bobT += dt * Math.min(speed, 12) * 1.4;
      const bob = Math.min(speed / 6, 1.5);
      const s = Math.sin(swingT * Math.PI); // 0 → 1 → 0
      root.position.set(
        REST.x - s * 0.18,
        REST.y + Math.sin(bobT) * 0.012 * bob - s * 0.1,
        REST.z + Math.abs(Math.cos(bobT)) * 0.008 * bob - s * 0.12
      );
      root.rotation.set(-s * 1.1, -s * 0.35, s * 0.2);
    },
    dispose() {
      camera.remove(root);
      if (item) disposeGroup(item);
    },
  };
}
