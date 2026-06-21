import * as THREE from 'three';
import { World, CHUNK_SIZE, parseKey } from './world/world.js';
import { createStreamer } from './world/streamer.js';
import { PLAYER } from './player/collision.js';
import { createControls } from './player/controls.js';
import { createEditing, HOTBAR } from './player/editing.js';
import { makeAtlasTexture } from './world/atlas.js';
import { loadWorld, saveWorld, clearWorld } from './world/persistence.js';
import { BLOCK_COLOR } from './blocks.js';

const WORLD_SEED = 1337; // seed fixa: mundo determinístico (constitution)
const RENDER_RADIUS = 6; // chunks visíveis ao redor do jogador

// --- Renderer ---
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

// --- Cena e céu ---
const scene = new THREE.Scene();
const SKY = 0x87b7e8;
const VIEW = RENDER_RADIUS * CHUNK_SIZE;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, VIEW * 0.5, VIEW); // esconde o pop-in dos chunks

// --- Câmera ---
const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.1,
  VIEW + CHUNK_SIZE * 2
);

// --- Luzes ---
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 20);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.7));
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// --- Material (atlas de texturas) ---
const atlas = makeAtlasTexture();
const worldMaterial = new THREE.MeshStandardMaterial({
  map: atlas,
  vertexColors: true, // sombreamento por face multiplica a textura
  roughness: 0.95,
  metalness: 0.0,
});

// --- Mundo (infinito, por chunks) ---
const world = new World(WORLD_SEED);

// Carrega save compatível (mesma seed): aplica os chunks modificados salvos.
let savedPlayer = null;
const saved = loadWorld();
if (saved && saved.seed === WORLD_SEED) {
  for (const [key, data] of saved.chunks) {
    const [cx, cz] = parseKey(key);
    world.applyChunk(cx, cz, data);
  }
  savedPlayer = saved.player ?? null;
}

// --- Streaming de chunks ---
const streamer = createStreamer({
  world,
  scene,
  material: worldMaterial,
  radius: RENDER_RADIUS,
});

// --- Autosave (debounced) ---
let saveTimer = null;
function saveCurrent() {
  saveWorld(world, { x: camera.position.x, y: camera.position.y, z: camera.position.z });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 500);
}

// --- Spawn ---
if (savedPlayer) {
  camera.position.set(savedPlayer.x, savedPlayer.y, savedPlayer.z);
} else {
  const surfaceY = world.surfaceY(0, 0);
  camera.position.set(0.5, surfaceY + PLAYER.eye + 3, 0.5);
}
camera.lookAt(camera.position.x + 12, camera.position.y - 1, camera.position.z + 12);

// Constrói os chunks próximos de uma vez (escondido atrás do overlay).
streamer.update(camera.position, true);

// --- Controles ---
const { controls, update } = createControls(camera, renderer.domElement, world);
scene.add(controls.object); // PointerLockControls move este objeto (a câmera)

const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const hud = document.getElementById('hud');
const hotbar = document.getElementById('hotbar');

// --- Edição (quebrar/colocar blocos) ---
const editing = createEditing({
  camera,
  scene,
  world,
  getMeshes: () => streamer.getMeshes(),
  rebuildAround: (bx, bz) => streamer.rebuildAround(bx, bz),
  isLocked: () => controls.isLocked,
  getPlayerPos: (out) => out.copy(camera.position),
  onSelect: (block) => renderHotbar(block),
  onEdit: scheduleSave,
});

// HUD da hotbar: um quadradinho por tipo, destacando o selecionado.
function renderHotbar(selected) {
  hotbar.innerHTML = '';
  HOTBAR.forEach((block, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (block === selected ? ' active' : '');
    slot.style.background = '#' + BLOCK_COLOR[block].toString(16).padStart(6, '0');
    slot.innerHTML = `<span>${i + 1}</span>`;
    hotbar.appendChild(slot);
  });
}

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  crosshair.classList.remove('hidden');
  hud.classList.remove('hidden');
  hotbar.classList.remove('hidden');
});
controls.addEventListener('unlock', () => {
  overlay.classList.remove('hidden');
  crosshair.classList.add('hidden');
  hud.classList.add('hidden');
  hotbar.classList.add('hidden');
  saveCurrent(); // captura a posição ao pausar
});

window.addEventListener('beforeunload', saveCurrent);

// Botão "Novo mundo": descarta o save e recomeça.
const newWorldBtn = document.getElementById('new-world');
newWorldBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // não dispara o lock do overlay
  clearWorld();
  location.reload();
});

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop ---
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let fpsAccum = 0;
let fpsFrames = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1); // clamp p/ evitar saltos
  update(dt);
  streamer.update(camera.position); // streaming incremental conforme anda
  editing.updateHighlight();

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
