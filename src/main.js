import * as THREE from 'three';
import { World, CHUNK_SIZE, chunkCoord, parseKey } from './world/world.js';
import { createStreamer } from './world/streamer.js';
import { PLAYER } from './player/collision.js';
import { createControls } from './player/controls.js';
import { createEditing, cellOverlapsBox } from './player/editing.js';
import { createHand } from './player/hand.js';
import { AVATAR_HIDE_BELOW, avatarYaw, thirdPersonBack } from './player/view.js';
import { collidesBox } from './entities/physics.js';
import { makeAtlasTexture } from './world/atlas.js';
import { loadWorld, saveWorld, clearWorld } from './world/persistence.js';
import { BLOCK_COLOR, isSolid } from './blocks.js';
import { makeRng } from './rng.js';
import { createSky } from './game/sky.js';
import { phaseOf } from './game/time.js';
import { createGame } from './game/game.js';
import { HOTBAR_SLOTS, ITEM } from './game/items.js';
import { MAX_HP } from './game/stats.js';
import { createAvatarView } from './entities/model.js';
import { createHud, phaseLabel } from './ui/hud.js';
import { createAudio } from './audio.js';
import { createParticles } from './fx/particles.js';

const WORLD_SEED = 1337; // seed fixa: mundo determinístico (constitution)
const RENDER_RADIUS = 6; // chunks visíveis ao redor do jogador
const EYE = PLAYER.eye;
const THIRD_PERSON_DISTANCE = 3.6;
const BREAK_PARTICLES = 8; // cubinhos ao quebrar um bloco (spec 018)
const HIT_PARTICLES = 6; // cubinhos ao acertar uma criatura
const HIT_PUSH = 3; // impulso horizontal dos cubinhos do golpe (b/s), no sentido do golpe
const HIT_LIFT = 1.5; // impulso vertical dos cubinhos do golpe (b/s)

// --- Renderer ---
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

// --- Cena ---
const scene = new THREE.Scene();
const SKY = 0x87b7e8;
const VIEW = RENDER_RADIUS * CHUNK_SIZE;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, VIEW * 0.5, VIEW); // esconde o pop-in dos chunks

// --- Câmeras: `camera` = a CABEÇA (lógica; PointerLockControls a move);
// `viewCam` = a câmera de render em 3ª pessoa. ---
const FAR = VIEW + CHUNK_SIZE * 2;
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, FAR);
const viewCam = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, FAR);

// --- Luzes (valores/cores seguem o ciclo dia-noite em sky.js) ---
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 20);
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.7);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);
const sky = createSky(scene, { sun, hemi, ambient });

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
let savedGame = null;
const saved = loadWorld();
if (saved && saved.seed === WORLD_SEED) {
  for (const [key, data] of saved.chunks) {
    const [cx, cz] = parseKey(key);
    world.applyChunk(cx, cz, data);
  }
  savedPlayer = saved.player ?? null;
  savedGame = saved.game ?? null;
}

// --- Streaming de chunks ---
const streamer = createStreamer({
  world,
  scene,
  material: worldMaterial,
  radius: RENDER_RADIUS,
});

// --- Jogo (regras) ---
// O RNG de gameplay (IA, spawn) é semeado: a constitution proíbe Math.random().
// A seed de runtime mistura a do mundo com o relógio só para variar as partidas.
const rng = makeRng((WORLD_SEED ^ (Date.now() & 0x7fffffff)) >>> 0);
const game = createGame({ world, rng, scene, saved: savedGame, mode: 'survival' });
// Efeitos visuais (spec 018) têm rng próprio: não consomem o do jogo (IA e spawn).
const particles = createParticles(scene, { rng: makeRng(WORLD_SEED + 1) });

const hud = createHud();
const audio = createAudio();
const hand = createHand(camera);
const avatar = createAvatarView();
avatar.object.visible = false;
scene.add(avatar.object);

// --- Spawn ---
const spawn = { x: 0.5, z: 0.5, y: world.surfaceY(0, 0) };
const eyeAtSpawn = () => spawn.y + EYE + 0.2;
/**
 * Pousa o jogador no chão logo abaixo de (x, feetY, z). Um save feito no ar (o voo da
 * Parte 1 era salvo assim) não pode virar dano de queda ao carregar em Sobrevivência.
 */
function settleFeetY(x, feetY, z) {
  let y = Math.max(feetY, 1);
  if (collidesBox(world, x, y, z, PLAYER.halfWidth, PLAYER.height)) return feetY; // dentro de bloco: a física desencalha
  for (let i = 0; i < 800 && y > 1; i++) {
    if (collidesBox(world, x, y - 0.05, z, PLAYER.halfWidth, PLAYER.height)) break;
    y -= 0.25;
  }
  return y;
}

if (savedPlayer) {
  const feetY = settleFeetY(savedPlayer.x, savedPlayer.y - EYE, savedPlayer.z);
  camera.position.set(savedPlayer.x, feetY + EYE, savedPlayer.z);
} else {
  camera.position.set(spawn.x, eyeAtSpawn(), spawn.z);
}
camera.lookAt(camera.position.x + 12, camera.position.y - 1, camera.position.z + 12);

// Constrói os chunks próximos de uma vez (escondido atrás do menu).
streamer.update(camera.position, true);

const feet = { x: 0, y: 0, z: 0 };
function updateFeet() {
  feet.x = camera.position.x;
  feet.y = camera.position.y - EYE;
  feet.z = camera.position.z;
}
updateFeet();

// --- Autosave (debounced + periódico) ---
let saveTimer = null;
let resetting = false; // "Novo mundo": nada pode regravar o save antes do reload
let saveWarned = false;
function saveCurrent() {
  if (resetting) return;
  const ok = saveWorld(
    world,
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    game.toJSON()
  );
  if (!ok && !saveWarned) {
    saveWarned = true;
    hud.toast('Não foi possível salvar o jogo (armazenamento cheio ou bloqueado)', 4500);
  }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 500);
}
setInterval(() => {
  if (inGame) saveCurrent();
}, 15000);

// --- Controles do jogador ---
const player = createControls(camera, renderer.domElement, world, {
  onLand: (distance) => dispatch(game.onLand(distance)),
});
const pointer = player.controls; // PointerLockControls
scene.add(pointer.object); // move este objeto (a câmera)
player.setFlyAllowed(game.mode === 'creative');

let inGame = false;
let deadScreen = false;
let viewMode = 'first'; // 'first' | 'third'
let swingClock = 1; // 0..1 durante um golpe (anima o avatar em 3ª pessoa)
let sinceHurt = 99; // s desde o último dano (flash do avatar)
let muted = false;
let stepDist = 0; // blocos andados desde o último passo sonoro
const SWING_SECONDS = 0.28;
const HURT_FLASH_SECONDS = 0.35;
const STEP_STRIDE = 2.2;

// --- Edição (golpear / quebrar / colocar / comer) ---
function isCellBlocked(cell) {
  if (cellOverlapsBox(cell, feet.x, feet.y, feet.z, PLAYER.halfWidth, PLAYER.height)) return true;
  for (const mob of game.mobs.mobs.values()) {
    const p = mob.body.pos;
    if (cellOverlapsBox(cell, p.x, p.y, p.z, mob.def.halfW, mob.def.height)) return true;
  }
  return false;
}

const editing = createEditing({
  camera,
  scene,
  world,
  getMeshes: () => streamer.getMeshes(),
  rebuildAround: (bx, bz) => streamer.rebuildAround(bx, bz),
  isLocked: () => pointer.isLocked && !deadScreen,
  getHeldBlock: () => game.getHeldBlock(),
  isCellBlocked,
  onAttack: (ray) => {
    const r = game.attack(ray);
    dispatch(r.events);
    return r.hit;
  },
  onBreak: (block, cell) => {
    dispatch(game.onBlockBroken(block));
    audio.play('break');
    particles.emit(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5, BLOCK_COLOR[block], BREAK_PARTICLES);
  },
  onPlace: () => {
    game.onBlockPlaced();
    audio.play('place');
  },
  onUse: () => dispatch(game.useItem()),
  onSwing: () => {
    hand.swing();
    swingClock = 0;
  },
  onEdit: scheduleSave,
});

// --- Hotbar: teclas 1-9 e 0, roda do mouse ---
document.addEventListener('keydown', (e) => {
  if (!pointer.isLocked || deadScreen) return;
  if (e.code === 'KeyV') {
    if (e.repeat) return; // segurar a tecla não pode ficar alternando a câmera
    viewMode = viewMode === 'first' ? 'third' : 'first';
    hand.setVisible(viewMode === 'first');
    avatar.object.visible = viewMode === 'third';
    return;
  }
  if (e.code === 'KeyM') {
    if (e.repeat) return;
    muted = !muted;
    audio.setMuted(muted);
    hud.toast(muted ? 'Som desligado' : 'Som ligado');
    return;
  }
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (!m) return;
  const n = Number(m[1]);
  game.inventory.select(n === 0 ? 9 : n - 1);
});
document.addEventListener(
  'wheel',
  (e) => {
    if (!pointer.isLocked || deadScreen) return;
    e.preventDefault();
    if (e.deltaY === 0) return; // rolagem horizontal/trackpad parado não troca de slot
    game.inventory.cycle(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false }
);

// --- Eventos do jogo -> mundo/HUD/som/jogador ---
const dirVec = new THREE.Vector3();
const hitImpulse = { x: 0, y: 0, z: 0 };
function rebuildChunksOf(blocks) {
  // Cada chunk tocado, e o vizinho quando o bloco está na borda (face culling entre chunks).
  const keys = new Set();
  const add = (cx, cz) => keys.add(cx + ',' + cz);
  for (const b of blocks) {
    const cx = chunkCoord(b.x);
    const cz = chunkCoord(b.z);
    const lx = b.x - cx * CHUNK_SIZE;
    const lz = b.z - cz * CHUNK_SIZE;
    add(cx, cz);
    if (lx === 0) add(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) add(cx + 1, cz);
    if (lz === 0) add(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) add(cx, cz + 1);
  }
  for (const key of keys) {
    const [cx, cz] = parseKey(key);
    streamer.rebuildAround(cx * CHUNK_SIZE + CHUNK_SIZE / 2, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
  }
}

function playSoundAt(e) {
  if (e.local) {
    audio.play(e.name);
    return;
  }
  const d = Math.hypot(e.x - camera.position.x, e.y - camera.position.y, e.z - camera.position.z);
  const volume = Math.max(0, 1 - d / 32);
  if (volume > 0.04) audio.play(e.name, { volume });
}

function dispatch(events) {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'player-hurt':
        sinceHurt = 0;
        hud.flashDamage();
        audio.play('hurt');
        if (e.knock) {
          dirVec.set(feet.x - e.knock.fromX, 0, feet.z - e.knock.fromZ);
          player.knock(dirVec.x, dirVec.z, e.knock.strength, e.knock.up);
        }
        scheduleSave();
        break;
      case 'player-died':
        die();
        break;
      case 'explosion':
        rebuildChunksOf(e.blocks);
        playSoundAt({ name: 'explode', x: e.x, y: e.y, z: e.z });
        scheduleSave();
        break;
      case 'sound':
        playSoundAt(e);
        break;
      case 'hit-mob': {
        const def = game.mobDef(e.kind);
        if (!def) break;
        // impulso no sentido do golpe: do jogador até o ponto de impacto (horizontal)
        const hx = e.x - feet.x;
        const hz = e.z - feet.z;
        const len = Math.hypot(hx, hz) || 1;
        hitImpulse.x = (hx / len) * HIT_PUSH;
        hitImpulse.y = HIT_LIFT;
        hitImpulse.z = (hz / len) * HIT_PUSH;
        particles.emit(e.x, e.y, e.z, def.color, HIT_PARTICLES, hitImpulse);
        break;
      }
      case 'toast':
        hud.toast(e.text);
        scheduleSave();
        break;
      default:
        break;
    }
  }
}

function die() {
  deadScreen = true;
  audio.play('death');
  hud.setInGame(false);
  hud.showDeath(game.summary());
  saveCurrent();
  if (pointer.isLocked) pointer.unlock();
}

function respawn() {
  game.respawn();
  deadScreen = false;
  hud.hideDeath();
  spawn.y = world.surfaceY(0, 0); // o jogador pode ter construído sobre o ponto inicial
  player.teleport(spawn.x, eyeAtSpawn(), spawn.z);
  updateFeet();
  streamer.update(camera.position, true);
  game.populate(feet);
  pointer.lock();
}

// Rede de segurança: saves antigos podem ter buracos até o fundo; quem cair no vazio
// volta ao ponto inicial (sem dano) em vez de cair para sempre.
function rescueFromVoid() {
  spawn.y = world.surfaceY(0, 0);
  player.teleport(spawn.x, eyeAtSpawn(), spawn.z);
  updateFeet();
  streamer.update(camera.position, true);
  hud.toast('Você caiu no vazio e foi resgatado');
}

// --- Menu / pausa / morte ---
function startPlaying(mode) {
  game.setMode(mode);
  player.setFlyAllowed(mode === 'creative');
  hud.setMode(mode);
  audio.resume();
  pointer.lock();
}

hud.bindMenu({
  onStart: startPlaying,
  onNewWorld: () => {
    if (!window.confirm('Apagar o mundo salvo e recomeçar do zero?')) return;
    resetting = true; // o beforeunload do reload regravaria o save que acabamos de apagar
    clearTimeout(saveTimer);
    clearWorld();
    location.reload();
  },
  onRespawn: () => {
    audio.resume();
    respawn();
  },
});

pointer.addEventListener('lock', () => {
  inGame = true;
  hud.setInGame(true);
  audio.resume();
});
pointer.addEventListener('unlock', () => {
  inGame = false;
  hud.setInGame(false); // mostra o menu; na morte quem aparece é a tela de morte
  if (deadScreen) hud.showDeath(game.summary());
  else hud.setMenuState({ paused: true, mode: game.mode });
  saveCurrent(); // captura a posição ao pausar
});
// Clicar no fundo do menu continua no modo atual (os botões não deixam o clique subir).
document.getElementById('overlay')?.addEventListener('click', () => {
  if (!deadScreen) startPlaying(game.mode);
});
window.addEventListener('beforeunload', saveCurrent);

// --- Resize ---
window.addEventListener('resize', () => {
  for (const cam of [camera, viewCam]) {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Câmera de 3ª pessoa: recua da cabeça até esbarrar em bloco ---
const fwd = new THREE.Vector3();
const solidAt = (x, y, z) => isSolid(world.getBlock(x, y, z));
/** Posiciona a câmera de 3ª pessoa atrás da cabeça; devolve o recuo usado. */
function placeThirdPersonCamera() {
  camera.getWorldDirection(fwd);
  const back = thirdPersonBack(solidAt, camera.position, fwd, THIRD_PERSON_DISTANCE);
  viewCam.position.set(
    camera.position.x - fwd.x * back,
    camera.position.y - fwd.y * back,
    camera.position.z - fwd.z * back
  );
  viewCam.quaternion.copy(camera.quaternion);
  return back;
}

// --- Avatar / mão ---
function heldForView() {
  const sel = game.inventory.getSelected();
  if (sel.kind === 'block') return BLOCK_COLOR[sel.block] ?? null;
  return sel.item === ITEM.SWORD || sel.item === ITEM.PORK ? sel.item : null;
}
function heldForHand() {
  const sel = game.inventory.getSelected();
  return sel.kind === 'block' ? { kind: 'block', block: sel.block } : { kind: 'item', item: sel.item };
}

// --- HUD incremental ---
let lastHp = -1;
let lastSig = '';
let lastClockKey = '';
function refreshHud() {
  const s = game.stats;
  if (s.hp !== lastHp) {
    lastHp = s.hp;
    hud.setHealth(s.hp, s.maxHp ?? MAX_HP);
  }
  const inv = game.inventory;
  let sig = String(inv.selected);
  for (let i = 0; i < HOTBAR_SLOTS.length; i++) sig += ',' + inv.count(i);
  sig += game.mode;
  if (sig !== lastSig) {
    lastSig = sig;
    hud.setHotbar(
      HOTBAR_SLOTS.map((slot, i) => {
        const c = inv.count(i);
        return {
          label: String((i + 1) % 10),
          color: slot.kind === 'block' ? BLOCK_COLOR[slot.block] : null,
          item: slot.kind === 'item' ? slot.item : null,
          count: slot.kind === 'item' && slot.item === ITEM.SWORD ? null : c,
        };
      }),
      inv.selected
    );
    hand.setHeld(heldForHand());
  }
  const phase = phaseOf(game.seconds);
  const key = game.day + phaseLabel(phase) + game.night;
  if (key !== lastClockKey) {
    lastClockKey = key;
    hud.setClock({ day: game.day, phaseName: phaseLabel(phase), night: game.night });
  }
}

// --- Loop ---
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let fpsAccum = 0;
let fpsFrames = 0;
let lastX = camera.position.x;
let lastZ = camera.position.z;
let speed = 0;
let gameErrorLogged = false;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1); // clamp p/ evitar saltos
  player.update(dt);
  updateFeet();
  if (feet.y < -16) rescueFromVoid();
  swingClock = Math.min(1, swingClock + dt / SWING_SECONDS);
  sinceHurt += dt;

  if (pointer.isLocked && !deadScreen) {
    // Um erro nas regras não pode congelar o render (o loop morreria em silêncio):
    // registra uma vez e segue desenhando.
    try {
      dispatch(game.update(dt, { pos: feet }));
    } catch (err) {
      if (!gameErrorLogged) {
        gameErrorLogged = true;
        console.error('[voxelcraft] erro no loop do jogo:', err);
      }
    }
  }

  particles.update(dt);

  // velocidade horizontal (avatar, mão)
  const inst = dt > 0 ? Math.hypot(camera.position.x - lastX, camera.position.z - lastZ) / dt : 0;
  speed += (inst - speed) * Math.min(1, dt * 10);
  lastX = camera.position.x;
  lastZ = camera.position.z;

  streamer.update(camera.position); // streaming incremental conforme anda
  editing.updateHighlight();

  // passos: um som a cada STEP_STRIDE blocos andados no chão
  if (pointer.isLocked && !deadScreen && player.isOnGround() && !player.isFlying() && speed > 1.5) {
    stepDist += speed * dt;
    if (stepDist >= STEP_STRIDE) {
      stepDist -= STEP_STRIDE;
      audio.play('step', { volume: 0.5 });
    }
  } else {
    stepDist = 0;
  }

  const renderCam = viewMode === 'third' ? viewCam : camera;
  if (viewMode === 'third') {
    const back = placeThirdPersonCamera();
    // câmera quase dentro da cabeça (parede nas costas): esconde o avatar
    avatar.object.visible = back > AVATAR_HIDE_BELOW;
    avatar.object.position.set(feet.x, feet.y, feet.z);
    avatar.object.rotation.y = avatarYaw(camera.quaternion);
    avatar.update(dt, {
      speed,
      hurt: sinceHurt < HURT_FLASH_SECONDS ? 1 - sinceHurt / HURT_FLASH_SECONDS : 0,
      attack: swingClock < 1 ? swingClock : 0,
      holding: heldForView(),
    });
  } else {
    hand.update(dt, speed);
  }
  sky.update(game.seconds, renderCam.position);
  refreshHud();

  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    if (fpsEl) fpsEl.textContent = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  renderer.render(scene, renderCam);
  requestAnimationFrame(animate);
}

hud.setMode(game.mode);
game.populate(feet);
refreshHud();
animate();

// Gancho de playtest: só existe no servidor de desenvolvimento (some do build).
if (import.meta.env.DEV) {
  window.__vc = {
    THREE, game, world, camera, player, pointer, hud, audio, streamer, scene,
    /** Simula o clique do menu sem precisar de pointer lock real. */
    fakeLock() {
      pointer.isLocked = true;
      pointer.dispatchEvent({ type: 'lock' });
    },
    setSeconds: (s) => game.setSeconds(s),
    spawnMob: (kind, dx = 4, dz = 0) =>
      game.mobs.spawn(kind, feet.x + dx, feet.y + 1, feet.z + dz),
    look: (yaw, pitch = 0) => {
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
    },
    teleportFeet: (x, y, z) => player.teleport(x, y + EYE, z),
  };
}
