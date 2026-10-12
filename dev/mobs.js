// Galeria de verificação visual das criaturas (feature 011) — SÓ desenvolvimento.
// Abra com `npx vite` em /dev/mobs.html. Não entra no build de produção.
//
// Parâmetros iniciais por hash (úteis para capturas automatizadas), ex.:
//   #cam=front&walk=1&hurt=1&night=1&hitbox=1&skins=1&hold=sword&orbit=0
// Chaves: cam(front|side|back|top) walk sprint hurt fuse burning attack dying
//         orbit night hitbox skins row2 panel hold(none|sword|pork|block)
//         sheep(0..3) speed zoom paused advance(seg) focus(avatar|zombie|creeper|pig|sheep|sheepN)

import * as THREE from 'three';
import { createAvatarView, createMobView, skinPixels } from '../src/entities/model.js';
import { MOB_DEFS } from '../src/entities/mobs.js';
import { BLOCK, BLOCK_COLOR } from '../src/blocks.js';

const $ = (sel) => document.querySelector(sel);

// --- estado da galeria ---
const state = {
  walk: false,
  sprint: false,
  hurt: false,
  fuse: false,
  burning: false,
  attack: false,
  dying: false,
  orbit: true,
  night: false,
  hitbox: false,
  skins: false,
  row2: false,
  panel: true,
  hold: 'sword',
  sheep: 1,
  speed: 3,
  paused: false,
};
const cam = { theta: 0.5, elev: 0.28, radius: 9.5 };
const CAM_PRESETS = {
  front: { theta: 0, elev: 0.12 },
  side: { theta: Math.PI / 2, elev: 0.12 },
  back: { theta: Math.PI, elev: 0.12 },
  top: { theta: 0, elev: 1.35 },
};

const params = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of params) {
  if (k === 'cam' && CAM_PRESETS[v]) Object.assign(cam, CAM_PRESETS[v]);
  else if (k === 'hold') state.hold = v;
  else if (k === 'sheep' || k === 'speed') state[k] = Number(v);
  else if (k === 'zoom') cam.radius = Number(v);
  else if (k === 'theta') cam.theta = Number(v);
  else if (k === 'elev') cam.elev = Number(v);
  else if (k in state && typeof state[k] === 'boolean') state[k] = v === '1' || v === 'true';
}
if (params.has('cam') || params.has('theta')) state.orbit = params.get('orbit') === '1';

// --- renderer, cena, luzes ---
const app = $('#app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); // dev: capturas de tela
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 20);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.7);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(sun, hemi, ambient);

const DAY = { sky: 0x87b7e8, sun: 1.6, hemi: 0.7, ambient: 0.25, sunColor: 0xffffff };
const NIGHT = { sky: 0x0b1226, sun: 0.22, hemi: 0.22, ambient: 0.1, sunColor: 0x8fa8ff };
function applyLighting() {
  const l = state.night ? NIGHT : DAY;
  scene.background = new THREE.Color(l.sky);
  scene.fog = new THREE.Fog(l.sky, 25, 60);
  sun.intensity = l.sun;
  sun.color.setHex(l.sunColor);
  hemi.intensity = l.hemi;
  ambient.intensity = l.ambient;
}

// chão: grama + grade de 1 bloco para dar noção de escala
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x6ab04c, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x000000, 0x000000);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.22;
scene.add(grid);

// --- personagens ---
const HOLD_ITEM = { none: null, sword: 'sword', pork: 'pork', block: BLOCK_COLOR[BLOCK.STONE] };
const SPACING = 1.7;
const chars = [];

function addChar({ id, label, make }, x, z, row) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = label;
  document.body.appendChild(tag);
  const c = {
    id,
    label,
    make,
    row,
    group,
    tag,
    view: null,
    box: null,
    s: { speed: 0, hurt: 0, fuse: 0, burning: false, attack: 0, dying: 0, sprinting: false, holding: null },
  };
  build(c);
  chars.push(c);
  return c;
}

function build(c) {
  if (c.view) c.view.dispose();
  if (c.box) c.group.remove(c.box);
  c.view = c.make();
  c.group.add(c.view.object);
  const hb = c.view.hitbox;
  c.box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * hb.halfW, hb.height, 2 * hb.halfW)),
    new THREE.LineBasicMaterial({ color: 0xffe14d })
  );
  c.box.position.y = hb.height / 2;
  c.box.visible = state.hitbox;
  c.group.add(c.box);
}

const SHEEP_LABEL = ['branca', 'cinza', 'marrom', 'preta'];
const MAIN = [
  { id: 'avatar', label: 'Jogador', make: () => createAvatarView() },
  { id: 'zombie', label: 'Zumbi', make: () => createMobView('zombie') },
  { id: 'creeper', label: 'Creeper', make: () => createMobView('creeper') },
  { id: 'pig', label: 'Porco', make: () => createMobView('pig') },
  { id: 'sheep', label: `Ovelha ${SHEEP_LABEL[state.sheep]}`, make: () => createMobView('sheep', { variant: state.sheep }) },
];
MAIN.forEach((def, i) => addChar(def, (i - (MAIN.length - 1) / 2) * SPACING, 0, 1));
const sheepRow = [];
for (let v = 0; v < MOB_DEFS.sheep.variants; v++) {
  sheepRow.push(
    addChar(
      { id: `sheep${v}`, label: `Ovelha ${SHEEP_LABEL[v] ?? v}`, make: () => createMobView('sheep', { variant: v }) },
      (v - (MOB_DEFS.sheep.variants - 1) / 2) * SPACING,
      -2.4,
      2
    )
  );
}

// --- painel de skins (atlas ampliado) ---
function buildSkinsPanel() {
  const host = $('#skins');
  const list = [['avatar', 0], ['zombie', 0], ['creeper', 0], ['pig', 0], ...Array.from({ length: MOB_DEFS.sheep.variants }, (_, v) => ['sheep', v])];
  for (const [kind, variant] of list) {
    const px = skinPixels(kind, variant);
    const canvas = document.createElement('canvas');
    canvas.width = px.width;
    canvas.height = px.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
    canvas.style.width = `${px.width * 3}px`;
    canvas.style.height = `${px.height * 3}px`;
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = kind === 'sheep' ? `sheep ${variant}` : kind;
    fig.append(canvas, cap);
    host.appendChild(fig);
  }
}
buildSkinsPanel();

// --- UI ---
function syncButtons() {
  for (const b of document.querySelectorAll('button[data-k]')) b.setAttribute('aria-pressed', String(!!state[b.dataset.k]));
  for (const b of document.querySelectorAll('button[data-hold]')) b.setAttribute('aria-pressed', String(state.hold === b.dataset.hold));
  $('#sheep-v').textContent = String(state.sheep);
  $('#speed').value = String(state.speed);
  $('#speedv').textContent = state.speed.toFixed(1);
  $('#skins').style.display = state.skins ? 'flex' : 'none';
  $('#panel').style.display = state.panel ? '' : 'none';
  for (const c of chars) {
    c.box.visible = state.hitbox;
    if (c.row === 2) {
      c.group.visible = state.row2;
      c.tag.style.display = state.row2 ? '' : 'none';
    }
  }
  applyLighting();
}

const timers = { hurt: 0, fuse: 0, attack: 0, dying: 0 };
$('#states').addEventListener('click', (e) => {
  const k = e.target.dataset?.k;
  if (!k) return;
  state[k] = !state[k];
  if (k === 'sprint' && state.sprint) {
    state.walk = true;
    state.speed = 10;
  }
  if (k === 'walk' && !state.walk) state.sprint = false;
  if (k === 'dying') timers.dying = 0;
  syncButtons();
});
document.addEventListener('click', (e) => {
  const k = e.target.dataset?.k;
  if (!k || e.target.closest('#states')) return;
  state[k] = !state[k];
  syncButtons();
});
$('#hold').addEventListener('click', (e) => {
  if (e.target.dataset.hold) {
    state.hold = e.target.dataset.hold;
    syncButtons();
  }
});
$('#cams').addEventListener('click', (e) => {
  const p = CAM_PRESETS[e.target.dataset.cam];
  if (p) {
    Object.assign(cam, p);
    state.orbit = false;
    syncButtons();
  }
});
$('#sheep-next').addEventListener('click', () => {
  state.sheep = (state.sheep + 1) % MOB_DEFS.sheep.variants;
  const main = chars.find((c) => c.id === 'sheep');
  build(main); // recria a ovelha principal com a cor nova
  main.tag.textContent = `Ovelha ${SHEEP_LABEL[state.sheep]}`;
  syncButtons();
});
$('#speed').addEventListener('input', (e) => {
  state.speed = Number(e.target.value);
  syncButtons();
});

// arrastar gira, roda dá zoom
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.theta -= (e.clientX - drag.x) * 0.008;
  cam.elev = Math.min(1.5, Math.max(0.02, cam.elev + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', () => (drag = null));
renderer.domElement.addEventListener('wheel', (e) => {
  cam.radius = Math.min(30, Math.max(2.5, cam.radius * (1 + Math.sign(e.deltaY) * 0.08)));
  e.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    state.panel = !state.panel;
    syncButtons();
  }
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- loop ---
const target = new THREE.Vector3(0, 0.85, -0.6);
const tmp = new THREE.Vector3();
const ATTACK_CYCLE = 0.8; // s por golpe repetido
const ATTACK_TIME = 0.45; // s do arco do golpe

function stepSim(dt) {
  timers.hurt = (timers.hurt + dt) % 1.2;
  timers.fuse = (timers.fuse + dt) % (MOB_DEFS.creeper.fuseTime + 0.7);
  timers.attack = (timers.attack + dt) % ATTACK_CYCLE;
  timers.dying = Math.min(1, timers.dying + dt / MOB_DEFS.pig.corpseTime);
  for (const c of chars) {
    const s = c.s;
    s.speed = state.walk ? state.speed : 0;
    s.sprinting = state.sprint;
    s.hurt = state.hurt ? Math.max(0, 1 - timers.hurt / MOB_DEFS.pig.hurtTime) : 0;
    s.fuse = state.fuse ? Math.min(1, timers.fuse / MOB_DEFS.creeper.fuseTime) : 0;
    s.burning = state.burning;
    s.attack = state.attack ? Math.min(1, timers.attack / ATTACK_TIME) : 0;
    s.dying = state.dying ? timers.dying : 0;
    s.holding = HOLD_ITEM[state.hold] ?? null;
    c.view.update(dt, s);
  }
  if (state.orbit) cam.theta += dt * 0.35;
}

function placeCamera() {
  const ce = Math.cos(cam.elev);
  camera.position.set(
    target.x + cam.radius * Math.sin(cam.theta) * ce,
    target.y + cam.radius * Math.sin(cam.elev),
    target.z + cam.radius * Math.cos(cam.theta) * ce
  );
  camera.lookAt(target);
}

function placeTags() {
  for (const c of chars) {
    if (c.row === 2 && !state.row2) continue;
    tmp.set(c.group.position.x, c.view.hitbox.height + 0.3, c.group.position.z).project(camera);
    const visible = tmp.z < 1;
    c.tag.style.display = visible ? '' : 'none';
    c.tag.style.left = `${((tmp.x + 1) / 2) * window.innerWidth}px`;
    c.tag.style.top = `${((1 - tmp.y) / 2) * window.innerHeight}px`;
  }
}

function draw() {
  placeCamera();
  placeTags();
  renderer.render(scene, camera);
}

let last = performance.now();
let frames = 0;
let acc = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.paused) stepSim(dt);
  draw();
  frames++;
  acc += dt;
  if (acc >= 0.5) {
    $('#status').textContent = `${Math.round(frames / acc)} FPS · ${renderer.info.render.triangles} triângulos`;
    frames = 0;
    acc = 0;
  }
  draw();
requestAnimationFrame(loop);
}

// gancho de DEV para capturas determinísticas (a página inteira é só de dev)
function focusOn(id) {
  const c = chars.find((q) => q.id === id);
  if (c) target.set(c.group.position.x, c.view.hitbox.height * 0.5, c.group.position.z);
}

window.__gallery = {
  focus: focusOn,
  draw,
  state,
  cam,
  chars,
  timers,
  /** Simula `seconds` em passos de 1/60 s (use com `paused`). */
  advance(seconds) {
    for (let t = 0; t < seconds; t += 1 / 60) stepSim(1 / 60);
  },
};

syncButtons();
if (params.has('focus')) focusOn(params.get('focus'));
if (params.has('advance')) window.__gallery.advance(Number(params.get('advance')));
draw();
requestAnimationFrame(loop);
