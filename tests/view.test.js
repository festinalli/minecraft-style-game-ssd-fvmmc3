// Testes headless de src/player/view.js: o yaw do avatar em 3ª pessoa (bug achado na
// revisão — camera.rotation.y ≠ yaw no PointerLockControls) e o recuo da câmera.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AVATAR_HIDE_BELOW, avatarYaw, headYaw, thirdPersonBack } from '../src/player/view.js';

const deg = (d) => (d * Math.PI) / 180;

/** Câmera orientada como o PointerLockControls faz: Euler YXZ -> quaternion. */
function cameraLooking(yaw, pitch) {
  const cam = new THREE.PerspectiveCamera();
  cam.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  cam.updateMatrixWorld(true);
  return cam;
}

/** Direção horizontal para onde a câmera olha. */
function lookDir(cam) {
  const d = new THREE.Vector3();
  cam.getWorldDirection(d);
  d.y = 0;
  return d.normalize();
}

/** Para onde aponta a FRENTE (+Z local) de um objeto rotacionado em Y por `yaw`. */
function modelFront(yaw) {
  return new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

test('headYaw devolve o yaw para qualquer orientação (a rotation.y do three NÃO serve)', () => {
  let rotationYWrong = 0;
  for (const yawDeg of [-170, -135, -90, -45, 0, 30, 60, 90, 135, 179]) {
    for (const pitchDeg of [-80, -45, 0, 30, 70]) {
      const cam = cameraLooking(deg(yawDeg), deg(pitchDeg));
      assert.ok(Math.abs(headYaw(cam.quaternion) - deg(yawDeg)) < 1e-9, `yaw ${yawDeg} pitch ${pitchDeg}`);
      if (Math.abs(cam.rotation.y - deg(yawDeg)) > 1e-3) rotationYWrong++;
    }
  }
  assert.ok(rotationYWrong > 10, 'a armadilha é real: camera.rotation.y erra em muitos ângulos (' + rotationYWrong + ')');
});

test('avatarYaw: o avatar olha exatamente para onde a câmera olha, em todas as direções e inclinações', () => {
  for (let yawDeg = -180; yawDeg < 180; yawDeg += 15) {
    for (const pitchDeg of [-85, -40, 0, 40, 85]) {
      const cam = cameraLooking(deg(yawDeg), deg(pitchDeg));
      const want = lookDir(cam);
      const got = modelFront(avatarYaw(cam.quaternion));
      assert.ok(want.distanceTo(got) < 1e-6, `yaw ${yawDeg} pitch ${pitchDeg}: ${got.toArray()} vs ${want.toArray()}`);
    }
  }
});

test('avatarYaw com um PointerLockControls REAL: após mover o mouse, a frente do avatar segue o olhar', () => {
  const cam = new THREE.PerspectiveCamera();
  const el = { ownerDocument: { addEventListener() {}, removeEventListener() {}, pointerLockElement: null } };
  const controls = new PointerLockControls(cam, el);
  cam.lookAt(12, -1, 12); // o olhar inicial do jogo (main.js): exatamente o caso que errava 90°
  cam.updateMatrixWorld(true);
  assert.ok(lookDir(cam).distanceTo(modelFront(avatarYaw(cam.quaternion))) < 1e-6, 'olhar inicial');
  // gira o mouse (o PointerLockControls escreve no quaternion via Euler YXZ)
  for (const dx of [200, 400, 800]) {
    controls.getObject().quaternion.copy(cam.quaternion);
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    e.y -= dx * 0.002;
    cam.quaternion.setFromEuler(e);
    cam.updateMatrixWorld(true);
    assert.ok(lookDir(cam).distanceTo(modelFront(avatarYaw(cam.quaternion))) < 1e-6, 'dx=' + dx);
  }
});

test('thirdPersonBack: sem obstáculo recua tudo; com parede para antes dela; nunca menos que o mínimo', () => {
  const head = { x: 0.5, y: 10.5, z: 0.5 };
  const fwd = { x: 0, y: 0, z: -1 }; // olhando para −Z: a câmera recua para +Z
  const free = thirdPersonBack(() => false, head, fwd, 3.6);
  assert.ok(free >= 3.4 && free <= 3.7, 'livre: ' + free);

  const wallAt = (z) => (_x, _y, bz) => bz >= z; // parede sólida a partir de bloco z
  const near = thirdPersonBack(wallAt(2), head, fwd, 3.6); // parede em z = 2: ~1.5 atrás da cabeça
  assert.ok(near < 1.6 && near > 0.9, 'encostou: ' + near);

  const glued = thirdPersonBack(wallAt(1), head, fwd, 3.6); // parede colada nas costas
  assert.ok(Math.abs(glued - 0.3) < 1e-9, 'recuo mínimo');
  assert.ok(glued < AVATAR_HIDE_BELOW, 'e nesse caso o avatar é escondido');
  assert.ok(free > AVATAR_HIDE_BELOW);
});

test('thirdPersonBack: olhando para cima a câmera recua para baixo e para no chão', () => {
  const head = { x: 0.5, y: 10.5, z: 0.5 };
  const up = { x: 0, y: 1, z: 0 }; // olha para cima → recua para baixo
  const groundAt = (_x, y) => y <= 7; // chão em y = 7
  const back = thirdPersonBack(groundAt, head, up, 3.6);
  assert.ok(back > 2 && back < 2.5, 'recuou até perto do chão: ' + back);
  assert.ok(head.y - back >= 8, 'e a câmera ficou ACIMA do chão (y >= 8): ' + (head.y - back));
});
