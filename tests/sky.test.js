// Testes headless da feature 009 — src/game/sky.js (Three.js sem DOM) no Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSky, SUN_DISTANCE, LIGHT_DISTANCE, STAR_RADIUS, STAR_COUNT } from '../src/game/sky.js';
import { DAY_LENGTH, START_SECONDS, LIGHT, skyState, isNight } from '../src/game/time.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b}, veio ${a}`);
const at = (phase) => phase * DAY_LENGTH;

/** Cena como a do jogo: fundo, neblina e as 3 luzes da Parte 1. */
function makeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b7e8);
  scene.fog = new THREE.Fog(0x87b7e8, 48, 96);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(40, 80, 20);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5a3a, 0.7);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(sun, hemi, ambient);
  return { scene, sun, hemi, ambient };
}

function makeSky(cam) {
  const env = makeScene();
  const sky = createSky(env.scene, { sun: env.sun, hemi: env.hemi, ambient: env.ambient });
  return { ...env, sky, cam: cam ?? new THREE.Vector3(0.5, 30, 0.5) };
}

const hexOf = (color) => color.getHex();
const worldPos = (obj) => obj.getWorldPosition(new THREE.Vector3());
/** Normal (frente) do quadrado em coordenadas de mundo. */
const faceNormal = (mesh) => new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);

test('ambiente: o teste roda sem DOM (nada de document/window/canvas)', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  const { sky } = makeSky();
  assert.ok(sky.group.isGroup);
});

test('createSky: instancia no THREE.Scene e adiciona só o grupo do céu', () => {
  const { scene, sky } = makeSky();
  assert.equal(scene.children.filter((c) => c.name === 'sky').length, 1);
  assert.equal(scene.children.length, 4); // 3 luzes + céu
  assert.equal(sky.group.children.length, 3); // estrelas, sol, lua
  assert.equal(typeof sky.update, 'function');
  assert.equal(typeof sky.dispose, 'function');
});

test('update: 20 instantes do ciclo sem erro, tudo finito e a cena não cresce', () => {
  const { scene, sun, hemi, ambient, sky } = makeSky();
  const cam = new THREE.Vector3();
  for (let i = 0; i < 20; i++) {
    const seconds = (i / 20) * DAY_LENGTH + 3.7;
    cam.set(i * 37.5 - 300, 20 + i, 900 - i * 91);
    sky.update(seconds, cam);
    scene.updateMatrixWorld(true);

    const bg = scene.background;
    assert.ok(bg.isColor, 'background deve ser Color');
    for (const c of [bg.r, bg.g, bg.b, scene.fog.color.r, scene.fog.color.g, scene.fog.color.b]) {
      assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `cor inválida no instante ${i}`);
    }
    for (const light of [sun, hemi, ambient]) {
      assert.ok(Number.isFinite(light.intensity) && light.intensity >= 0, `intensidade inválida (${light.type})`);
      assert.ok(Number.isFinite(light.color.r + light.color.g + light.color.b));
    }
    assert.ok(Number.isFinite(sun.position.x + sun.position.y + sun.position.z));
    for (const obj of [sky.sunMesh, sky.moonMesh, sky.stars]) {
      const p = worldPos(obj);
      assert.ok(Number.isFinite(p.x + p.y + p.z));
    }
    assert.equal(scene.children.length, 4);
    assert.equal(sky.group.children.length, 3);
  }
});

test('scene.background muda entre dia e noite e segue o skyState (sRGB)', () => {
  const { scene, sky, cam } = makeSky();
  sky.update(at(0.25), cam);
  const noon = hexOf(scene.background);
  assert.equal(noon, 0x87b7e8, 'meio-dia = cor do céu da Parte 1');
  sky.update(START_SECONDS, cam);
  assert.equal(hexOf(scene.background), 0x87b7e8, 'o jogo começa com o mesmo céu de antes');

  sky.update(at(0.75), cam);
  const midnight = hexOf(scene.background);
  assert.equal(midnight, 0x0a0f24);
  assert.notEqual(noon, midnight);

  sky.update(at(0.5), cam);
  const dusk = scene.background;
  assert.ok(dusk.r > dusk.b, 'pôr do sol quente');
  const s = skyState(at(0.5));
  near(dusk.getHex(), new THREE.Color().setRGB(s.skyColor.r, s.skyColor.g, s.skyColor.b, THREE.SRGBColorSpace).getHex(), 0);

  // bate com skyState em vários instantes (±1/255 por canal)
  for (let t = 0; t < DAY_LENGTH; t += 13) {
    sky.update(t, cam);
    const k = skyState(t).skyColor;
    const c = scene.background.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    near(c.r, k.r, 1 / 255);
    near(c.g, k.g, 1 / 255);
    near(c.b, k.b, 1 / 255);
  }
});

test('scene.background: reutiliza a Color existente; cria uma se não for Color', () => {
  const { scene, sky, cam } = makeSky();
  const original = scene.background;
  sky.update(START_SECONDS, cam);
  sky.update(200, cam);
  assert.equal(scene.background, original, 'sem alocar uma Color nova a cada frame');

  for (const bad of [null, undefined, new THREE.Texture()]) {
    scene.background = bad;
    sky.update(START_SECONDS, cam);
    assert.ok(scene.background.isColor);
    assert.equal(hexOf(scene.background), 0x87b7e8);
  }
});

test('neblina acompanha o fundo; cena sem neblina não quebra', () => {
  const { scene, sky, cam } = makeSky();
  for (const t of [at(0.1), at(0.5), at(0.62), at(0.75), at(0.97)]) {
    sky.update(t, cam);
    assert.equal(scene.fog.color.getHex(), scene.background.getHex());
  }
  const bare = new THREE.Scene(); // sem fog, sem luzes
  const sky2 = createSky(bare, {});
  sky2.update(at(0.3), cam);
  assert.equal(bare.fog, null);
  assert.ok(bare.background.isColor);
});

test('luzes: dia = valores do main.js da Parte 1; noite = hemisfério/ambiente fracos e luz da lua', () => {
  const { sun, hemi, ambient, sky, cam } = makeSky();
  sky.update(at(0.25), cam);
  near(sun.intensity, 1.6, 1e-9);
  near(hemi.intensity, 0.7, 1e-9);
  near(ambient.intensity, 0.25, 1e-9);
  // cores de dia preservadas exatamente (a cor configurada pelo integrador)
  assert.equal(sun.color.getHex(), 0xffffff);
  assert.equal(hemi.color.getHex(), 0xcfe8ff);
  assert.equal(hemi.groundColor.getHex(), 0x4a5a3a);
  assert.equal(ambient.color.getHex(), 0xffffff);

  sky.update(at(0.75), cam);
  near(hemi.intensity, 0.22, 1e-9);
  near(ambient.intensity, 0.14, 1e-9);
  assert.ok(sun.intensity > 0.2 && sun.intensity < LIGHT.day.sun / 2, 'a direcional vira a lua: fraca (' + sun.intensity + ')');
  assert.ok(sun.color.b > sun.color.r, 'luz da lua azulada');
  assert.ok(hemi.color.b > hemi.color.r, 'hemisfério azulado à noite');
  // continua dando para enxergar: soma das luzes de preenchimento nunca zera
  assert.ok(hemi.intensity + ambient.intensity > 0.3);

  // o crepúsculo esquenta a luz do sol
  sky.update(at(0.46), cam);
  assert.ok(sun.color.r >= sun.color.b);
  const warm = sun.color.clone();
  sky.update(at(0.25), cam);
  assert.ok(warm.b < sun.color.b, 'luz rasante mais quente que a do meio-dia');
});

test('luz direcional aponta para a direção certa de qualquer ponto do mundo (alvo acompanha a câmera)', () => {
  const { sun, sky } = makeSky();
  const cams = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(500, 30, -700),
    new THREE.Vector3(-12345, 41, 98765),
  ];
  for (const cam of cams) {
    for (const [phase, which] of [[0.25, 'sunDir'], [0.1, 'sunDir'], [0.75, 'moonDir'], [0.62, 'moonDir']]) {
      sky.update(at(phase), cam);
      const st = skyState(at(phase));
      const dir = st[which];
      // posição = câmera + dir*80
      near(sun.position.x - cam.x, dir.x * LIGHT_DISTANCE, 1e-9);
      near(sun.position.y - cam.y, dir.y * LIGHT_DISTANCE, 1e-9);
      near(sun.position.z - cam.z, dir.z * LIGHT_DISTANCE, 1e-9);
      // alvo na câmera, com a matriz de mundo já atualizada (o alvo não está na cena)
      near(sun.target.position.x, cam.x, 1e-9);
      near(sun.target.matrixWorld.elements[12], cam.x, 1e-9);
      near(sun.target.matrixWorld.elements[13], cam.y, 1e-9);
      near(sun.target.matrixWorld.elements[14], cam.z, 1e-9);
      // direção efetiva que o renderer usa: posição - alvo
      const eff = sun.position.clone().sub(sun.target.position).normalize();
      near(eff.x, dir.x, 1e-9);
      near(eff.y, dir.y, 1e-9);
      near(eff.z, dir.z, 1e-9);
    }
  }
  // de dia a luz vem de cima; de noite (lua) também: a direcional nunca ilumina "por baixo"
  for (let t = 0; t < DAY_LENGTH; t += 3) {
    sky.update(t, cams[0]);
    if (sun.intensity > 0.05) assert.ok(sun.position.y - cams[0].y > 0, `luz vindo de baixo em t=${t}`);
  }
});

test('intensidade da direcional é contínua no pôr do sol e no amanhecer (sol <-> lua)', () => {
  const { sun, sky, cam } = makeSky();
  let prev = null;
  let maxStep = 0;
  for (let t = 0; t <= DAY_LENGTH; t += 0.5) {
    sky.update(t, cam);
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(sun.intensity - prev));
    prev = sun.intensity;
  }
  assert.ok(maxStep < 0.1, 'salto na luz direcional: ' + maxStep);
});

test('sol e lua: quadrados centrados na câmera, voltados para ela, à distância certa', () => {
  const { scene, sky } = makeSky();
  const cams = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-321, 40, 777)];
  for (const cam of cams) {
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * DAY_LENGTH;
      sky.update(t, cam);
      scene.updateMatrixWorld(true);
      near(worldPos(sky.group).distanceTo(cam), 0, 1e-9, 'grupo centrado na câmera');
      const st = skyState(t);
      for (const [mesh, dir] of [[sky.sunMesh, st.sunDir], [sky.moonMesh, st.moonDir]]) {
        const p = worldPos(mesh);
        near(p.x - cam.x, dir.x * SUN_DISTANCE, 1e-6);
        near(p.y - cam.y, dir.y * SUN_DISTANCE, 1e-6);
        near(p.z - cam.z, dir.z * SUN_DISTANCE, 1e-6);
        // a frente do quadrado (+Z) olha para a câmera
        const toCam = cam.clone().sub(p).normalize();
        near(faceNormal(mesh).dot(toCam), 1, 1e-6, `quadrado de costas no instante ${i}`);
      }
      // sol e lua sempre em lados opostos
      near(sky.sunMesh.position.dot(sky.moonMesh.position), -SUN_DISTANCE * SUN_DISTANCE, 1e-6);
    }
  }
});

test('sol e lua: achatados (plano) com textura de pixels, sem filtro suave', () => {
  const { sky } = makeSky();
  for (const mesh of [sky.sunMesh, sky.moonMesh]) {
    assert.equal(mesh.geometry.type, 'PlaneGeometry');
    assert.ok(mesh.material.isMeshBasicMaterial);
    const map = mesh.material.map;
    assert.ok(map.isDataTexture, 'DataTexture (sem canvas)');
    assert.equal(map.image.width, 16);
    assert.equal(map.image.height, 16);
    assert.equal(map.image.data.length, 16 * 16 * 4);
    assert.equal(map.magFilter, THREE.NearestFilter);
    assert.equal(map.minFilter, THREE.NearestFilter);
    assert.equal(mesh.scale.x, mesh.scale.y);
    assert.ok(mesh.scale.x > 5);
  }
  // sol e lua são diferentes (não a mesma textura)
  assert.notDeepEqual(sky.sunMesh.material.map.image.data, sky.moonMesh.material.map.image.data);
});

test('sol, lua e estrelas: fog:false, depthWrite:false, frustumCulled:false', () => {
  const { sky } = makeSky();
  for (const obj of [sky.sunMesh, sky.moonMesh, sky.stars]) {
    assert.equal(obj.material.fog, false);
    assert.equal(obj.material.depthWrite, false);
    assert.equal(obj.frustumCulled, false);
  }
});

test('visibilidade: sol de dia, lua de noite, estrelas só à noite (opacidade = starAlpha)', () => {
  const { sky, cam } = makeSky();
  sky.update(at(0.25), cam);
  assert.equal(sky.sunMesh.visible, true);
  assert.equal(sky.moonMesh.visible, false);
  assert.equal(sky.stars.visible, false);
  assert.equal(sky.stars.material.opacity, 0);

  sky.update(at(0.75), cam);
  assert.equal(sky.sunMesh.visible, false);
  assert.equal(sky.moonMesh.visible, true);
  assert.equal(sky.stars.visible, true);
  near(sky.stars.material.opacity, 1, 1e-12);

  // no horizonte (pôr do sol) os dois aparecem: um se pondo, o outro nascendo
  sky.update(at(0.5), cam);
  assert.equal(sky.sunMesh.visible, true);
  assert.equal(sky.moonMesh.visible, true);

  for (let t = 0; t < DAY_LENGTH; t += 2) {
    sky.update(t, cam);
    const k = skyState(t);
    near(sky.stars.material.opacity, k.starAlpha, 1e-12);
    assert.equal(sky.stars.visible, k.starAlpha > 0.01);
    if (!isNight(t) && k.sunDir.y > 0.3) assert.equal(sky.stars.visible, false, 'estrelas de dia');
    assert.equal(sky.sunMesh.visible, k.sunDir.y > -0.12);
    assert.equal(sky.moonMesh.visible, k.moonDir.y > -0.12);
  }
});

test('estrelas: 300 pontos na esfera, reprodutíveis (rng semeado), bem distribuídas e girando com o céu', () => {
  const a = makeSky();
  const b = makeSky();
  const pa = a.sky.stars.geometry.getAttribute('position');
  const pb = b.sky.stars.geometry.getAttribute('position');
  assert.ok(a.sky.stars.isPoints);
  assert.equal(pa.count, STAR_COUNT);
  assert.equal(STAR_COUNT, 300);
  assert.deepEqual(pa.array, pb.array, 'mesmas estrelas em cada instância');

  let up = 0;
  let minLen = Infinity;
  let maxLen = 0;
  for (let i = 0; i < pa.count; i++) {
    const l = Math.hypot(pa.getX(i), pa.getY(i), pa.getZ(i));
    minLen = Math.min(minLen, l);
    maxLen = Math.max(maxLen, l);
    if (pa.getY(i) > 0) up++;
  }
  near(minLen, STAR_RADIUS, 1e-3);
  near(maxLen, STAR_RADIUS, 1e-3);
  assert.ok(up > 100 && up < 200, 'estrelas deveriam cobrir os dois hemisférios: ' + up);
  // as estrelas cabem no frustum da câmera do jogo (far = 128)
  assert.ok(STAR_RADIUS < 128 && SUN_DISTANCE < 128);

  // o campo gira com o sol: a direção +X do campo vira a direção do sol
  for (const phase of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9]) {
    a.sky.update(at(phase), a.cam);
    const rotated = new THREE.Vector3(1, 0, 0).applyQuaternion(a.sky.stars.quaternion);
    const sd = skyState(at(phase)).sunDir;
    near(rotated.x, sd.x, 1e-9);
    near(rotated.y, sd.y, 1e-9);
    near(rotated.z, sd.z, 1e-9);
  }
});

test('o grupo do céu segue a câmera', () => {
  const { scene, sky } = makeSky();
  sky.update(100, new THREE.Vector3(0, 10, 0));
  scene.updateMatrixWorld(true);
  near(worldPos(sky.stars).x, 0, 1e-9);
  sky.update(100, { x: 1000, y: 50, z: -2000 }); // aceita {x,y,z} simples
  scene.updateMatrixWorld(true);
  const p = worldPos(sky.stars);
  near(p.x, 1000, 1e-9);
  near(p.y, 50, 1e-9);
  near(p.z, -2000, 1e-9);
});

test('determinismo e pureza: mesmo instante => mesmo céu; update nunca chama Math.random()', () => {
  // (o Three.js usa Math.random para UUID ao CONSTRUIR objetos; por isso o bloqueio vale só em update.
  //  As estrelas são reprodutíveis entre instâncias — teste de estrelas — logo não usam Math.random.)
  const a = makeSky();
  const b = makeSky();
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random() proibido em update');
  };
  try {
    for (const t of [0, 77, at(0.5), at(0.8)]) {
      a.sky.update(t, a.cam);
      b.sky.update(t, b.cam);
      assert.equal(a.scene.background.getHex(), b.scene.background.getHex());
      assert.equal(a.sun.intensity, b.sun.intensity);
      assert.deepEqual(a.sky.sunMesh.position.toArray(), b.sky.sunMesh.position.toArray());
    }
  } finally {
    Math.random = original;
  }
});

test('createSky tolera luzes ausentes (só o que foi passado é controlado)', () => {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const sky = createSky(scene, { hemi });
  sky.update(at(0.75), { x: 0, y: 0, z: 0 });
  near(hemi.intensity, 0.22, 1e-9);
  const sky2 = createSky(new THREE.Scene());
  sky2.update(at(0.1), undefined); // câmera ausente: assume a origem
  assert.ok(sky2.group.position.length() === 0);
});

test('dispose: remove o céu da cena, libera recursos e é idempotente', () => {
  const { scene, sky, cam } = makeSky();
  sky.update(at(0.3), cam);
  const disposed = [];
  const watch = (obj, name) => obj.addEventListener('dispose', () => disposed.push(name));
  watch(sky.stars.geometry, 'stars.geometry');
  watch(sky.stars.material, 'stars.material');
  watch(sky.sunMesh.geometry, 'quad.geometry');
  watch(sky.sunMesh.material, 'sun.material');
  watch(sky.moonMesh.material, 'moon.material');
  watch(sky.sunMesh.material.map, 'sun.texture');
  watch(sky.moonMesh.material.map, 'moon.texture');

  sky.dispose();
  assert.equal(scene.children.filter((c) => c.name === 'sky').length, 0);
  assert.equal(scene.children.length, 3, 'as luzes (do integrador) permanecem na cena');
  assert.deepEqual(disposed.sort(), [
    'moon.material', 'moon.texture', 'quad.geometry', 'stars.geometry', 'stars.material',
    'sun.material', 'sun.texture',
  ]);
  assert.doesNotThrow(() => sky.dispose());
  const bg = scene.background.getHex();
  assert.doesNotThrow(() => sky.update(at(0.75), cam), 'update depois do dispose é inofensivo');
  assert.equal(scene.background.getHex(), bg, 'update depois do dispose não mexe na cena');
});
