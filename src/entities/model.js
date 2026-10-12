// Modelos das criaturas: bonecos de CAIXAS (estilo voxel) com skin procedural.
// Three.js SEM DOM — roda no Node (testes headless). As skins vêm de
// `skins.js` e viram `THREE.DataTexture` (NearestFilter, sRGB).
//
// Convenção única (modelo, IA e câmera): a FRENTE é +Z local, a origem fica nos
// PÉS e o caller faz `object.rotation.y = yaw` e `object.position = pos dos pés`.
// A escala é derivada da hitbox (`MOB_DEFS[kind]`; avatar = `PLAYER`), então
// nenhum número de balanceamento é copiado aqui.

import * as THREE from 'three';
import { MOB_DEFS, MOB_KINDS } from './mobs.js';
import { PLAYER } from '../player/collision.js';
import { normalizeVariant, rigOf, skinLayout, skinPixels } from './skins.js';

export { skinPixels, skinLayout };

const TAU = Math.PI * 2;
const MAX_DT = 0.25; // um frame travado não pode "pular" a animação
const NEUTRAL = Object.freeze({});

// ---------------------------------------------------------------------------
// Hitbox
// ---------------------------------------------------------------------------

/** Hitbox (halfW, height) de um tipo — a ÚNICA fonte de escala dos modelos. */
export function hitboxOf(kind) {
  if (kind === 'avatar') return { halfW: PLAYER.halfWidth, height: PLAYER.height };
  const def = MOB_DEFS[kind];
  if (!def) throw new Error(`Criatura desconhecida: "${kind}"`);
  return { halfW: def.halfW, height: def.height };
}

// ---------------------------------------------------------------------------
// Texturas (cache por kind:variant) e material-base
// ---------------------------------------------------------------------------

const textureCache = new Map();
const baseMaterialCache = new Map();

/**
 * Textura compartilhada de uma skin. Fica no cache do módulo: `dispose()` de
 * uma View nunca a destrói (use `disposeSharedSkins()` ao descartar o renderer).
 */
export function skinTexture(kind, variant = 0) {
  const v = normalizeVariant(kind, variant);
  const key = `${kind}:${v}`;
  let tex = textureCache.get(key);
  if (!tex) {
    const px = skinPixels(kind, v);
    tex = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    tex.name = `skin:${key}`;
    textureCache.set(key, tex);
  }
  return tex;
}

function baseMaterial(kind, variant) {
  const key = `${kind}:${normalizeVariant(kind, variant)}`;
  let mat = baseMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ map: skinTexture(kind, variant), roughness: 0.92, metalness: 0 });
    baseMaterialCache.set(key, mat);
  }
  return mat;
}

/** Libera as texturas/materiais-base compartilhados (hot reload, trocar de renderer). */
export function disposeSharedSkins() {
  for (const t of textureCache.values()) t.dispose();
  for (const m of baseMaterialCache.values()) m.dispose();
  textureCache.clear();
  baseMaterialCache.clear();
}

// ---------------------------------------------------------------------------
// Geometria: caixa com UVs da skin
// ---------------------------------------------------------------------------

const UV_EPS = 0.02; // px de recuo para nunca amostrar o texel vizinho

/** Face de um vértice (pela normal) e coordenadas (s,t) 0..1, vistas de FORA, t=0 no topo. */
function faceUV(x, y, z, nx, ny, nz, w, h, d) {
  if (nz > 0.5) return ['front', (x + w / 2) / w, (h / 2 - y) / h];
  if (nz < -0.5) return ['back', (w / 2 - x) / w, (h / 2 - y) / h];
  if (nx > 0.5) return ['left', (d / 2 - z) / d, (h / 2 - y) / h];
  if (nx < -0.5) return ['right', (z + d / 2) / d, (h / 2 - y) / h];
  if (ny > 0.5) return ['top', (x + w / 2) / w, (z + d / 2) / d];
  return ['bottom', (x + w / 2) / w, (d / 2 - z) / d];
}

/** BoxGeometry [w,h,d] com UVs reescritos nos retângulos da skin. */
function boxGeometry(size, faces, texW, texH) {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const [face, s, t] = faceUV(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), w, h, d);
    const r = faces[face];
    uv.setXY(i, (r.x + UV_EPS + s * (r.w - 2 * UV_EPS)) / texW, (r.y + UV_EPS + t * (r.h - 2 * UV_EPS)) / texH);
  }
  uv.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// Animação (valores visuais — não são balanceamento)
// ---------------------------------------------------------------------------

const GAIT = {
  // stride = blocos por ciclo de passada; ref = speed em que o balanço fica cheio
  pig: { quad: true, stride: 1.0, ref: 2.0, leg: 0.8 },
  sheep: { quad: true, stride: 1.1, ref: 2.0, leg: 0.7 },
  creeper: { quad: true, stride: 1.0, ref: 2.0, leg: 0.8 },
  zombie: { quad: false, stride: 1.8, ref: 3.0, leg: 0.7, arm: 0.12, armRest: -1.45 },
  avatar: { quad: false, stride: 2.2, ref: 6.0, leg: 0.9, arm: 0.85, armRest: 0 },
};

const FUSE_SCALE_XZ = 0.25; // creeper chega a 1,25x em XZ
const FUSE_SCALE_Y = 0.15;
const FIRE_COUNT = 8;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN/undefined => 0

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function buildView(kind, variant) {
  const rig = rigOf(kind);
  const layout = skinLayout(kind);
  const cfg = GAIT[kind];
  const hb = hitboxOf(kind);
  const isCreeper = kind === 'creeper';
  const isAvatar = kind === 'avatar';

  const material = baseMaterial(kind, variant).clone(); // por View: flash independente
  const own = [material]; // tudo que a View cria e portanto destrói

  const object = new THREE.Group(); // pés; yaw/posição do caller
  object.name = `view:${kind}`;
  const pose = new THREE.Group(); // tombar ao morrer
  const body = new THREE.Group(); // inchar / respirar
  const fit = new THREE.Group(); // escala e centralização pela hitbox
  object.add(pose);
  pose.add(body);
  body.add(fit);

  const parts = {};
  const meshes = {};
  const abs = {};
  for (const p of rig.parts) {
    const pivot = p.pivot ?? p.center;
    const group = new THREE.Group();
    group.name = p.name;
    const from = p.parent ? abs[p.parent] : [0, 0, 0];
    group.position.set(pivot[0] - from[0], pivot[1] - from[1], pivot[2] - from[2]);
    abs[p.name] = pivot;

    const faces = layout.regions[layout.partRegion[p.name]].faces;
    const geo = boxGeometry(p.size, faces, layout.width, layout.height);
    own.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `${p.name}:box`;
    mesh.position.set(p.center[0] - pivot[0], p.center[1] - pivot[1], p.center[2] - pivot[2]);
    mesh.userData.reach = p.reach;
    group.add(mesh);

    (p.parent ? parts[p.parent] : fit).add(group);
    parts[p.name] = group;
    meshes[p.name] = mesh;
  }

  // --- item na mão direita (−X) do avatar ---
  let hand = null;
  let sword = null;
  let pork = null;
  let blockItem = null;
  let blockMat = null;
  if (isAvatar) {
    const piece = (color, w, h, d, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
      own.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return { m, mat };
    };
    hand = new THREE.Group();
    hand.name = 'hand';
    hand.position.set(0, -9.5, 0); // ponta do braço (px de modelo, dentro de `fit`)
    parts.armR.add(hand);

    sword = new THREE.Group();
    sword.name = 'item:sword';
    for (const [c, w, h, d, x, y, z] of [
      [0xc4dcea, 2.2, 9, 1, 0, 6, 0], // lâmina
      [0xc9a227, 5, 1, 1.6, 0, 1.4, 0], // guarda
      [0x6b4a2b, 1.2, 3, 1.2, 0, -0.4, 0], // cabo
      [0xc9a227, 1.8, 1, 1.8, 0, -2.4, 0], // pomo
    ]) sword.add(piece(c, w, h, d, x, y, z).m);
    sword.rotation.x = 1.25; // lâmina para a frente e um pouco para cima
    sword.position.set(0, -0.5, 1);

    pork = new THREE.Group();
    pork.name = 'item:pork';
    for (const [c, w, h, d, x, y, z] of [
      [0xe0706e, 4, 3.4, 5, 0, 0, 1.8], // carne
      [0xf4cbc2, 4.2, 1, 5.2, 0, 1.6, 1.8], // gordura
      [0xf1ead8, 1.4, 1.4, 2.4, 0, 0, 5.2], // osso
    ]) pork.add(piece(c, w, h, d, x, y, z).m);

    const blk = piece(0xffffff, 4, 4, 4, 0, 0, 2.5);
    blockItem = blk.m;
    blockMat = blk.mat;
    blockItem.name = 'item:block';
  }
  // Só o item atual fica pendurado na mão (um item escondido ainda entraria
  // no Box3 de quem medir o `object`). Trocar de item não aloca nada.
  let holdingNow = null;
  let heldNode = null;
  function setHolding(h) {
    const next = h === 'sword' || h === 'pork' || (typeof h === 'number' && Number.isFinite(h)) ? h : null;
    if (next === holdingNow) return;
    holdingNow = next;
    if (heldNode) hand.remove(heldNode);
    heldNode = next === 'sword' ? sword : next === 'pork' ? pork : next === null ? null : blockItem;
    if (typeof next === 'number') blockMat.color.setHex(next);
    if (heldNode) hand.add(heldNode);
  }

  // --- partículas de fogo (criadas só na primeira vez que queima) ---
  let fire = null;
  function ensureFire() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const matA = new THREE.MeshBasicMaterial({ color: 0xff7a18 });
    const matB = new THREE.MeshBasicMaterial({ color: 0xffd23c });
    own.push(geo, matA, matB);
    const group = new THREE.Group();
    group.name = 'fire';
    const list = [];
    for (let i = 0; i < FIRE_COUNT; i++) {
      const m = new THREE.Mesh(geo, i % 2 ? matB : matA);
      list.push(m);
      group.add(m);
    }
    fire = { group, list };
  }

  // --- estado interno do ciclo ---
  const st = { t: 0, phase: 0, amp: 0, flash: 0, burn: 0 };
  let disposed = false;
  let edge = hb.halfW; // distância do eixo até a lateral direita (−X): aresta pela qual o corpo tomba

  function update(dt, s) {
    if (disposed) return;
    const inp = s || NEUTRAL;
    dt = dt > 0 ? (dt < MAX_DT ? dt : MAX_DT) : 0;
    const speed = inp.speed > 0 ? (inp.speed < 20 ? inp.speed : 20) : 0;
    const hurt = clamp01(inp.hurt);
    const fuse = isCreeper ? clamp01(inp.fuse) : 0;
    const attack = clamp01(inp.attack);
    const dying = clamp01(inp.dying);
    const burning = !!inp.burning;
    const sprint = !!inp.sprinting;

    // ciclo de andar: fase por distância percorrida, amplitude suavizada
    st.t += dt;
    st.phase = (st.phase + (dt * TAU * speed) / cfg.stride) % (TAU * 1000);
    const target = Math.min(1, speed / cfg.ref);
    st.amp += (target - st.amp) * Math.min(1, dt * 10);
    const sw = Math.sin(st.phase) * st.amp;
    const idle = 1 - st.amp;
    const legA = sw * cfg.leg * (sprint ? 1.2 : 1);

    if (cfg.quad) {
      parts.legFL.rotation.x = legA;
      parts.legBR.rotation.x = legA;
      parts.legFR.rotation.x = -legA;
      parts.legBL.rotation.x = -legA;
      if (kind === 'sheep') {
        // de vez em quando abaixa a cabeça para pastar
        const g = Math.max(0, Math.sin(st.t * 0.55));
        parts.head.rotation.x = idle * g * g * 0.55 + st.amp * 0.06 * Math.sin(2 * st.phase);
      } else if (kind === 'pig') {
        parts.head.rotation.x = idle * 0.05 * Math.sin(st.t * 1.7) + st.amp * 0.07 * Math.sin(2 * st.phase);
      } else {
        parts.head.rotation.x = 0;
      }
    } else {
      parts.legL.rotation.x = legA;
      parts.legR.rotation.x = -legA;
      const armA = sw * cfg.arm * (sprint ? 1.3 : 1);
      const sway = idle * 0.05;
      const swingA = Math.sin(Math.PI * attack); // 0 -> pico em 0,5 -> 0
      if (isAvatar) {
        parts.armL.rotation.x = -armA + sway * Math.sin(st.t * 1.5);
        parts.armR.rotation.x = armA - sway * Math.sin(st.t * 1.5) - swingA * 1.8;
        parts.armR.rotation.z = swingA * 0.3;
        parts.head.rotation.x = 0;
        setHolding(inp.holding);
      } else {
        // zumbi: braços esticados à frente; o golpe levanta e desce
        parts.armL.rotation.x = cfg.armRest - armA + sway * Math.sin(st.t * 1.8) - swingA * 0.85;
        parts.armR.rotation.x = cfg.armRest + armA + sway * Math.sin(st.t * 1.8 + 1.7) - swingA * 0.85;
        parts.head.rotation.x = 0.1 + swingA * 0.3;
      }
    }

    // inchar (creeper) e respirar
    const breath = Math.sin(st.t * 2.4) * 0.012 * idle;
    const sxz = 1 + FUSE_SCALE_XZ * fuse;
    body.scale.set(sxz, (1 + FUSE_SCALE_Y * fuse) * (1 + breath), sxz);

    // brilho: ferido (vermelho) + pulsos brancos do fuse + fogo (laranja)
    let er = hurt * 0.7;
    let eg = hurt * 0.04;
    let eb = hurt * 0.04;
    if (fuse > 0) {
      st.flash = (st.flash + dt * TAU * (3 + 14 * fuse)) % (TAU * 1000);
      if (Math.sin(st.flash) > 0) {
        const k = 0.25 + 0.4 * fuse;
        er += k;
        eg += k;
        eb += k;
      }
    } else {
      st.flash = 0;
    }
    if (burning) {
      st.burn = (st.burn + dt * TAU * 2.2) % (TAU * 1000);
      const k = 0.4 + 0.18 * Math.sin(st.burn);
      er += k;
      eg += k * 0.42;
      eb += k * 0.04;
    }
    material.emissive.setRGB(er < 1 ? er : 1, eg < 1 ? eg : 1, eb < 1 ? eb : 1);
    material.color.setScalar(1 - 0.55 * dying);

    // morrer: tomba de lado (até 90°) pela aresta dos pés e afunda um pouco
    const ang = (Math.PI / 2) * (1 - (1 - dying) * (1 - dying));
    pose.rotation.z = ang;
    pose.position.x = edge * (Math.cos(ang) - 1);
    pose.position.y = edge * Math.sin(ang) - edge * 0.2 * dying;

    // partículas de fogo
    if (burning) {
      if (!fire) ensureFire();
      if (!fire.group.parent) object.add(fire.group); // fora da árvore enquanto não queima
      const reach = hb.height * (1 - 0.7 * dying);
      for (let i = 0; i < FIRE_COUNT; i++) {
        const u = (st.t * 0.8 + i / FIRE_COUNT) % 1;
        const a = i * 2.399 + st.t * 1.5;
        fire.list[i].position.set(Math.cos(a) * hb.halfW * 0.9, 0.05 + u * reach, Math.sin(a) * hb.halfW * 0.9);
        fire.list[i].scale.setScalar(0.05 + 0.1 * (1 - u));
      }
    } else if (fire && fire.group.parent) {
      object.remove(fire.group);
    }
  }

  // --- escala/centralização pela hitbox, medidas na pose neutra ---
  update(0, NEUTRAL);
  object.updateMatrixWorld(true);
  const all = new THREE.Box3();
  const core = new THREE.Box3(); // sem os braços estendidos do zumbi
  for (const name of Object.keys(meshes)) {
    all.expandByObject(meshes[name]);
    if (!meshes[name].userData.reach) core.expandByObject(meshes[name]);
  }
  const scale = hb.height / (all.max.y - all.min.y);
  fit.scale.setScalar(scale);
  fit.position.set(-((core.min.x + core.max.x) / 2) * scale, -all.min.y * scale, -((core.min.z + core.max.z) / 2) * scale);
  object.updateMatrixWorld(true);
  edge = -new THREE.Box3().setFromObject(object).min.x; // lateral direita do modelo já escalado

  function dispose() {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    for (const o of own) o.dispose(); // geometrias e materiais PRÓPRIOS; a textura é compartilhada
  }

  return {
    kind,
    variant: normalizeVariant(kind, variant),
    hitbox: hb,
    object,
    rig: { pose, body, fit }, // grupos internos (tombar / inchar / escala), úteis para testes e galeria
    parts,
    meshes,
    material,
    update,
    dispose,
  };
}

/**
 * View de uma criatura (porco, ovelha, zumbi ou creeper).
 * @param {'pig'|'sheep'|'zombie'|'creeper'} kind
 * @param {{ variant?: number }} [opts]  `variant` 0..3 = cor da lã da ovelha
 */
export function createMobView(kind, opts) {
  if (!MOB_KINDS.includes(kind)) throw new Error(`Criatura desconhecida: "${kind}" (esperado: ${MOB_KINDS.join(', ')})`);
  return buildView(kind, opts?.variant ?? 0);
}

/** View do jogador (3ª pessoa): cabelo marrom, camisa azul, calça azul-escura. */
export function createAvatarView() {
  return buildView('avatar', 0);
}
