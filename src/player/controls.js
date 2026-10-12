import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { PLAYER } from './collision.js';
import {
  createBody, createPlayerState, stepPlayer, toggleFly, allowFly,
  knockPlayer, teleportPlayer, resetPlayerFall,
} from '../entities/physics.js';
// `world` expõe getBlock(bx,by,bz) em coordenadas globais.
// Toda a física (gravidade, colisão, andar/correr/pular/voar, knock, queda) mora
// em src/entities/physics.js — o MESMO código dos mobs. Aqui ficam só os
// eventos (teclado/mouse) e a ligação câmera ↔ corpo.

/**
 * Câmera/jogador em 1ª pessoa: pointer lock para olhar; WASD para andar;
 * gravidade + colisão AABB; pulo (Espaço no chão); modo voo (F).
 *
 * @param {THREE.Camera} camera
 * @param {HTMLElement} domElement
 * @param {import('../world/world.js').World} world
 * @param {{ onLand?: (fallDistance: number) => void }} [opts]
 *   onLand: dispara UMA vez a cada pouso, com a distância caída em blocos
 *   (pico − pouso; nunca em voo). O dano de queda é de quem recebe.
 */
export function createControls(camera, domElement, world, { onLand } = {}) {
  const controls = new PointerLockControls(camera, domElement);

  // O corpo vive nos PÉS; a câmera (olho) fica `PLAYER.eye` acima.
  const body = createBody({
    x: camera.position.x,
    y: camera.position.y - PLAYER.eye,
    z: camera.position.z,
    halfW: PLAYER.halfWidth,
    height: PLAYER.height,
  });
  const state = createPlayerState(body);

  const keys = {
    forward: false, backward: false, left: false, right: false,
    up: false, down: false, run: false, jump: false,
  };
  const input = { moveX: 0, moveZ: 0, run: false, up: false, down: false, jump: false };
  const result = {};

  // Teclas só valem com o mouse capturado: no menu/pausa, F não liga o voo e a barra de
  // espaço continua ativando o botão focado (Renascer, modos).
  function onKeyDown(e) {
    if (!controls.isLocked) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = true; break;
      case 'KeyS': case 'ArrowDown': keys.backward = true; break;
      case 'KeyA': case 'ArrowLeft': keys.left = true; break;
      case 'KeyD': case 'ArrowRight': keys.right = true; break;
      case 'ControlLeft': case 'ControlRight': keys.run = true; break;
      case 'ShiftLeft': case 'ShiftRight': keys.down = true; break;
      case 'KeyF': toggleFly(state); break;
      case 'Space':
        if (state.flying) keys.up = true;
        else keys.jump = true; // pedido de 1 quadro, consumido em update()
        break;
      default: return;
    }
    e.preventDefault();
  }

  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': keys.forward = false; break;
      case 'KeyS': case 'ArrowDown': keys.backward = false; break;
      case 'KeyA': case 'ArrowLeft': keys.left = false; break;
      case 'KeyD': case 'ArrowRight': keys.right = false; break;
      case 'ControlLeft': case 'ControlRight': keys.run = false; break;
      case 'ShiftLeft': case 'ShiftRight': keys.down = false; break;
      case 'Space': keys.up = false; break;
      default: return;
    }
    e.preventDefault();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Solta tudo ao pausar ou perder o foco (Alt+Tab): senão o jogador sai andando sozinho.
  function releaseAll() {
    for (const k of Object.keys(keys)) keys[k] = false;
  }
  controls.addEventListener('unlock', releaseAll);
  if (typeof window !== 'undefined') window.addEventListener('blur', releaseAll);

  const forwardDir = new THREE.Vector3();
  const rightDir = new THREE.Vector3();
  const move = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  // Último valor que ESCREVEMOS na câmera. Se a câmera estiver diferente no
  // próximo quadro, alguém a moveu por fora (ex.: o spawn do main.js): o corpo
  // adota a posição como um teleporte (sem velocidade nem queda acumulada).
  let syncX = camera.position.x;
  let syncY = camera.position.y;
  let syncZ = camera.position.z;

  function writeCamera() {
    camera.position.set(body.pos.x, body.pos.y + PLAYER.eye, body.pos.z);
    syncX = camera.position.x;
    syncY = camera.position.y;
    syncZ = camera.position.z;
  }

  function adoptExternalMove() {
    const c = camera.position;
    if (c.x !== syncX || c.y !== syncY || c.z !== syncZ) {
      teleportPlayer(state, c.x, c.y - PLAYER.eye, c.z);
      syncX = c.x;
      syncY = c.y;
      syncZ = c.z;
    }
  }

  function update(dt) {
    if (!controls.isLocked) {
      keys.jump = false; // um pulo pedido em pausa não vale depois
      return;
    }
    adoptExternalMove();

    // direção horizontal a partir do olhar
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0;
    forwardDir.normalize();
    rightDir.crossVectors(forwardDir, worldUp).normalize();

    move.set(0, 0, 0);
    if (keys.forward) move.add(forwardDir);
    if (keys.backward) move.sub(forwardDir);
    if (keys.right) move.add(rightDir);
    if (keys.left) move.sub(rightDir);
    if (move.lengthSq() > 0) move.normalize();

    input.moveX = move.x;
    input.moveZ = move.z;
    // Correr: Ctrl, ou Shift no chão (Ctrl+W fecha a aba do navegador; no voo Shift desce).
    input.run = keys.run || (keys.down && !state.flying);
    input.up = keys.up;
    input.down = keys.down;
    input.jump = keys.jump;
    keys.jump = false;

    stepPlayer(world, state, input, dt, result);
    writeCamera();
    if (result.fall > 0 && onLand) onLand(result.fall);
  }

  return {
    controls,
    update,
    /** Corpo do jogador: `body.pos` = centro dos PÉS (use em ctx.player.pos). */
    body,
    /**
     * Empurra o jogador: impulso horizontal na direção de (dirX,dirZ)
     * normalizada, que decai (~0,25 s), e vertical `up` (>0) opcional.
     */
    knock(dirX, dirZ, strength, up = 0) {
      knockPlayer(state, dirX, dirZ, strength, up);
    },
    /** false em Sobrevivência: desliga o voo se ligado e `F` não faz nada. */
    setFlyAllowed(allowed) {
      allowFly(state, allowed);
    },
    isFlying: () => state.flying,
    isOnGround: () => body.onGround,
    /** Leva o OLHO para (x, y, z); zera velocidades e a referência de queda. */
    teleport(x, y, z) {
      teleportPlayer(state, x, y - PLAYER.eye, z);
      writeCamera();
    },
    /** Zera a referência de queda (o próximo pouso mede a partir daqui). */
    resetFall() {
      resetPlayerFall(state);
    },
  };
}
