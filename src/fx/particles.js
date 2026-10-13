// Feedback visual de quebra e combate (spec 018): cubinhos com a cor do bloco
// quebrado ou da criatura atingida. SEM DOM e sem renderer: o teste roda no Node
// com um `scene` falso e um InstancedMesh real do Three.js.
//
// Um único InstancedMesh com um pool fixo de `max` slots. `emit` reaproveita slots
// mortos; com o pool cheio, a partícula mais antiga (menor número de emissão) cede o
// lugar ao efeito novo. Vetores, cor e matriz são pré-alocados: nenhum objeto novo
// por quadro.
//
// Aleatoriedade só pelo `rng` injetado (constitution): nenhum gerador não semeado.

import * as THREE from 'three';

/** Fonte única dos números do efeito (spec 018). */
export const FX = { LIFE: 0.6, GRAVITY: 14, MAX: 96 };

const SIZE = 0.12; // aresta do cubinho (blocos)
const HALF = SIZE / 2;
const SPEED_XZ = 2.2; // espalhamento horizontal (b/s), para cada lado
const SPEED_Y_MIN = 2.5; // impulso vertical inicial (b/s)
const SPEED_Y_MAX = 4.5;
const FRICTION = 6; // atrito no topo do bloco (1/s): os cubinhos param logo

// Escala zero: é assim que um slot morto "some" sem remover a instância.
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * @param {THREE.Scene|{add:Function, remove:Function}} scene
 * @param {object} [opts]
 * @param {number} [opts.max=FX.MAX]  tamanho fixo do pool (inteiro >= 1)
 * @param {ReturnType<import('../rng.js').makeRng>} opts.rng  rng injetado (obrigatório)
 */
export function createParticles(scene, { max = FX.MAX, rng } = {}) {
  if (!rng) throw new Error('createParticles: é preciso um rng injetado (src/rng.js)');
  if (!Number.isInteger(max) || max < 1) throw new Error('createParticles: max deve ser inteiro >= 1');

  const geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const material = new THREE.MeshBasicMaterial(); // sem luz: a cor da instância é a cor final
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Cor por instância, criada de uma vez para todos os slots (branco = sem tingir).
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  // O boundingSphere do InstancedMesh é calculado uma vez e cacheado: com os cubinhos
  // espalhados, a culling por frustum os esconderia. São poucos: desliga a culling.
  mesh.frustumCulled = false;
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, HIDDEN);
  scene.add(mesh);

  // Estado de cada slot, criado uma vez: nada de objeto novo por quadro.
  // `seq` = número da emissão que criou a partícula (ordena quem é mais antigo).
  const slots = [];
  for (let i = 0; i < max; i++) {
    slots.push({ index: i, seq: 0, life: 0, floor: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  let emitted = 0;

  // Temporários pré-alocados.
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion(); // identidade: os cubinhos não giram
  const mat = new THREE.Matrix4();
  const col = new THREE.Color();

  let disposed = false;

  function writeMatrix(p) {
    const s = p.life / FX.LIFE; // encolhe linearmente até sumir em LIFE
    pos.set(p.x, p.y, p.z);
    scl.set(s, s, s);
    mat.compose(pos, quat, scl);
    mesh.setMatrixAt(p.index, mat);
  }

  function claimSlot() {
    for (let i = 0; i < max; i++) if (slots[i].life <= 0) return slots[i];
    // Pool cheio: a partícula mais antiga cede o lugar ao efeito novo.
    let victim = slots[0];
    for (let i = 1; i < max; i++) if (slots[i].seq < victim.seq) victim = slots[i];
    return victim;
  }

  /**
   * Solta `count` cubinhos saindo de (x, y, z), com a cor `colorHex` (0xRRGGBB).
   * A velocidade inicial é sorteada pelo rng e somada a `impulse` ({x, y, z}, b/s).
   * Os cubinhos param no topo do bloco em que o ponto está: `floor = Math.floor(y)`.
   */
  function emit(x, y, z, colorHex, count, impulse = null) {
    if (disposed || !(count > 0)) return;
    const floor = Math.floor(y);
    const ix = impulse ? impulse.x : 0;
    const iy = impulse ? impulse.y : 0;
    const iz = impulse ? impulse.z : 0;
    col.setHex(colorHex);
    const n = Math.floor(count);
    for (let k = 0; k < n; k++) {
      const p = claimSlot();
      p.x = x;
      p.y = y;
      p.z = z;
      p.floor = floor;
      p.vx = rng.range(-SPEED_XZ, SPEED_XZ) + ix;
      p.vy = rng.range(SPEED_Y_MIN, SPEED_Y_MAX) + iy;
      p.vz = rng.range(-SPEED_XZ, SPEED_XZ) + iz;
      p.life = FX.LIFE;
      p.seq = ++emitted;
      mesh.setColorAt(p.index, col);
      writeMatrix(p);
    }
    mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Avança `dt` s: gravidade, parada no topo do bloco, encolhe e some em LIFE. */
  function update(dt) {
    if (disposed || !(dt > 0)) return;
    let any = false;
    for (let i = 0; i < max; i++) {
      const p = slots[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.life = 0;
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      p.vy -= FX.GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const rest = p.floor + HALF;
      if (p.y < rest) {
        p.y = rest;
        p.vy = 0;
        const damp = Math.max(0, 1 - FRICTION * dt);
        p.vx *= damp;
        p.vz *= damp;
      }
      writeMatrix(p);
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Quantas partículas estão vivas agora (teste e HUD de debug). */
  function alive() {
    let n = 0;
    for (let i = 0; i < max; i++) if (slots[i].life > 0) n++;
    return n;
  }

  /** Tira o efeito da cena e libera a GPU. Depois disso, emit e update não fazem nada. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const p of slots) p.life = 0;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { emit, update, alive, dispose };
}
