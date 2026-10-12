// Céu do jogo: aplica `skyState(seconds)` (time.js, puro) na cena Three.js —
// fundo, neblina, luzes — e move sol, lua e estrelas centrados na câmera.
//
// Three.js SEM DOM: texturas são `DataTexture` (pixels em memória), nada de
// canvas — roda no Node, então os testes headless instanciam o céu de verdade.
// Ver `.specs/009-dia-noite/` e `docs/adr/0008-*.md`.

import * as THREE from 'three';
import { makeRng } from '../rng.js';
import { phaseOf, skyState, createSkyState, ORBIT_AXIS } from './time.js';

// --- Geometria do céu ---
// As distâncias ficam ABAIXO do plano `far` da câmera do jogo (128 em main.js);
// raios maiores seriam cortados pelo frustum e o céu sumiria.
export const SUN_DISTANCE = 90; // sol e lua (centro do quadrado) até a câmera
export const LIGHT_DISTANCE = 80; // posição da luz direcional = câmera + dir * 80
export const STAR_RADIUS = 100; // esfera das estrelas
export const STAR_COUNT = 300;
export const SUN_SIZE = 24; // lado do quadrado do sol (blocos)
export const MOON_SIZE = 18;
const STAR_SEED = 0x5ca1ab1e;
const MOON_SEED = 0x6d00;
const HIDE_BELOW = -0.12; // sol/lua somem quando `dir.y` fica abaixo disso (já se puseram)

// --- Cores de iluminação (a cor de DIA é a que o integrador configurou na luz) ---
const SUN_WARM = new THREE.Color(0xffb27a); // luz rasante do crepúsculo
const MOON_LIGHT = new THREE.Color(0x8ea2ff); // luz da lua: azulada
const HEMI_SKY_NIGHT = new THREE.Color(0x2a3a78);
const HEMI_GROUND_NIGHT = new THREE.Color(0x10131f);
const AMBIENT_NIGHT = new THREE.Color(0x7080c0);
const SUN_TWILIGHT_TINT = new THREE.Color(1.0, 0.72, 0.5); // o disco do sol esquenta perto do horizonte

/** Textura 16x16 de pixels (estilo Minecraft), sem canvas. `pixel(x,y)` → [r,g,b] 0..255. */
function pixelTexture(size, pixel) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const mixRgb = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Sol: quadrado amarelo-claro com miolo quase branco e borda alaranjada. */
function makeSunTexture() {
  const core = [255, 252, 216];
  const edge = [255, 205, 84];
  return pixelTexture(16, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) / 7.5; // 0 (centro) .. 1 (borda)
    return mixRgb(core, edge, Math.pow(d, 1.6));
  });
}

/** Lua: quadrado cinza-azulado claro com crateras (posições do rng semeado). */
function makeMoonTexture() {
  const rng = makeRng(MOON_SEED);
  const craters = [];
  for (let i = 0; i < 6; i++) craters.push([rng.range(2, 13), rng.range(2, 13), rng.range(0.9, 1.8)]);
  const base = [226, 232, 246];
  const dark = [168, 178, 204];
  const edge = [196, 205, 226];
  return pixelTexture(16, (x, y) => {
    for (const [cx, cy, r] of craters) {
      if (Math.hypot(x - cx, y - cy) <= r) return dark;
    }
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) / 7.5;
    return d > 0.85 ? edge : base;
  });
}

/** Estrelas: `STAR_COUNT` pontos numa esfera de `STAR_RADIUS`, brilhos variados. */
function makeStars() {
  const rng = makeRng(STAR_SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = rng.range(-1, 1); // y uniforme => distribuição uniforme na esfera
    const a = rng.angle();
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(a) * r * STAR_RADIUS;
    positions[i * 3 + 1] = y * STAR_RADIUS;
    positions[i * 3 + 2] = Math.sin(a) * r * STAR_RADIUS;
    const b = rng.range(0.55, 1);
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = Math.min(1, b + 0.12); // levemente azuladas
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 2.5,
    sizeAttenuation: false, // tamanho em pixels: o raio da esfera não muda o visual
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Points(geometry, material);
}

function makeDisc(geometry, texture, size) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    fog: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(size, size, 1);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Cria o céu: sol, lua e estrelas na cena + controle das 3 luzes e do fundo.
 * Quem chama `update` a cada frame é o loop do jogo; `createSky` NÃO adiciona
 * as luzes à cena (isso continua com o integrador).
 *
 * @param {THREE.Scene} scene
 * @param {{ sun?: THREE.DirectionalLight, hemi?: THREE.HemisphereLight, ambient?: THREE.AmbientLight }} lights
 * @returns {{ update(seconds:number, cameraPos:{x:number,y:number,z:number}): void, dispose(): void,
 *   group: THREE.Group, stars: THREE.Points, sunMesh: THREE.Mesh, moonMesh: THREE.Mesh,
 *   readonly state: ReturnType<typeof createSkyState> }}
 */
export function createSky(scene, { sun, hemi, ambient } = {}) {
  const state = createSkyState();

  // --- Objetos do céu (um grupo centrado na câmera) ---
  const group = new THREE.Group();
  group.name = 'sky';
  const stars = makeStars();
  stars.frustumCulled = false;
  stars.renderOrder = -2;
  const quad = new THREE.PlaneGeometry(1, 1);
  const sunTexture = makeSunTexture();
  const moonTexture = makeMoonTexture();
  const sunMesh = makeDisc(quad, sunTexture, SUN_SIZE);
  const moonMesh = makeDisc(quad, moonTexture, MOON_SIZE);
  sunMesh.name = 'sky:sun';
  moonMesh.name = 'sky:moon';
  sunMesh.renderOrder = -1;
  moonMesh.renderOrder = -1;
  group.add(stars, sunMesh, moonMesh);
  scene.add(group);

  // --- Cores de dia das luzes (as que o integrador configurou) ---
  const sunDay = sun ? sun.color.clone() : null;
  const hemiSkyDay = hemi ? hemi.color.clone() : null;
  const hemiGroundDay = hemi && hemi.groundColor ? hemi.groundColor.clone() : null;
  const ambientDay = ambient ? ambient.color.clone() : null;

  // --- Objetos de trabalho (nada é alocado dentro de update) ---
  const orbitAxis = new THREE.Vector3(ORBIT_AXIS.x, ORBIT_AXIS.y, ORBIT_AXIS.z);
  const qOrbit = new THREE.Quaternion();
  // Em fase 0 o sol está em +X e o quadrado deve olhar para a câmera (-X): +Z local -> -X.
  // A lua, oposta, está em -X e olha para +X. Girar tudo por qOrbit mantém o quadrado
  // voltado para a câmera e rodando com o céu, como no Minecraft.
  const qSunBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  const qMoonBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const tmpColor = new THREE.Color();
  let disposed = false;

  function update(seconds, cameraPos) {
    if (disposed) return;
    const cx = cameraPos ? cameraPos.x : 0;
    const cy = cameraPos ? cameraPos.y : 0;
    const cz = cameraPos ? cameraPos.z : 0;
    skyState(seconds, state);

    // Fundo e neblina: mesma cor (horizonte sem emenda). Os valores são sRGB, como os hex do jogo.
    if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color();
    scene.background.setRGB(state.skyColor.r, state.skyColor.g, state.skyColor.b, THREE.SRGBColorSpace);
    if (scene.fog) {
      scene.fog.color.setRGB(state.fogColor.r, state.fogColor.g, state.fogColor.b, THREE.SRGBColorSpace);
    }

    // Luzes. A direcional é o sol de dia e a lua à noite (fraca, azulada): fica com a mais forte.
    if (sun) {
      const useSun = state.sunIntensity >= state.moonIntensity;
      const dir = useSun ? state.sunDir : state.moonDir;
      sun.intensity = state.sunIntensity + state.moonIntensity;
      sun.position.set(cx + dir.x * LIGHT_DISTANCE, cy + dir.y * LIGHT_DISTANCE, cz + dir.z * LIGHT_DISTANCE);
      // O alvo acompanha a câmera; senão a direção da luz (posição - alvo) derivaria com o jogador.
      sun.target.position.set(cx, cy, cz);
      sun.target.updateMatrixWorld();
      sun.color.copy(sunDay).lerp(SUN_WARM, state.twilight * 0.6).lerp(MOON_LIGHT, state.nightFactor);
    }
    if (hemi) {
      hemi.intensity = state.hemiIntensity;
      hemi.color.copy(hemiSkyDay).lerp(HEMI_SKY_NIGHT, state.nightFactor);
      if (hemiGroundDay) hemi.groundColor.copy(hemiGroundDay).lerp(HEMI_GROUND_NIGHT, state.nightFactor);
    }
    if (ambient) {
      ambient.intensity = state.ambientIntensity;
      ambient.color.copy(ambientDay).lerp(AMBIENT_NIGHT, state.nightFactor);
    }

    // Objetos do céu: centrados na câmera, girando em torno do eixo da órbita.
    group.position.set(cx, cy, cz);
    qOrbit.setFromAxisAngle(orbitAxis, phaseOf(seconds) * Math.PI * 2);

    const s = state.sunDir;
    sunMesh.position.set(s.x * SUN_DISTANCE, s.y * SUN_DISTANCE, s.z * SUN_DISTANCE);
    sunMesh.quaternion.multiplyQuaternions(qOrbit, qSunBase);
    sunMesh.visible = s.y > HIDE_BELOW;
    sunMesh.material.color.copy(tmpColor.setRGB(1, 1, 1).lerp(SUN_TWILIGHT_TINT, state.twilight));

    const m = state.moonDir;
    moonMesh.position.set(m.x * SUN_DISTANCE, m.y * SUN_DISTANCE, m.z * SUN_DISTANCE);
    moonMesh.quaternion.multiplyQuaternions(qOrbit, qMoonBase);
    moonMesh.visible = m.y > HIDE_BELOW;

    stars.quaternion.copy(qOrbit);
    stars.material.opacity = state.starAlpha;
    stars.visible = state.starAlpha > 0.01;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    stars.geometry.dispose();
    stars.material.dispose();
    quad.dispose();
    sunMesh.material.dispose();
    moonMesh.material.dispose();
    sunTexture.dispose();
    moonTexture.dispose();
  }

  return {
    update,
    dispose,
    group,
    stars,
    sunMesh,
    moonMesh,
    get state() {
      return state;
    },
  };
}
