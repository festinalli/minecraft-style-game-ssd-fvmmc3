import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { makeRng } from '../src/rng.js';
import { MOB_DEFS, MOB_KINDS } from '../src/entities/mobs.js';
import { PLAYER } from '../src/player/collision.js';
import {
  createAvatarView,
  createMobView,
  hitboxOf,
  skinPixels,
  skinTexture,
} from '../src/entities/model.js';
import { FACE_NAMES, FACE_NORMAL, rigOf, skinLayout, SKIN_KINDS } from '../src/entities/skins.js';

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

const ALL = [...MOB_KINDS, 'avatar'];
const make = (kind, variant = 0) => (kind === 'avatar' ? createAvatarView() : createMobView(kind, { variant }));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} esperado ${b} ± ${eps}, veio ${a}`);

function bbox(obj) {
  let root = obj;
  while (root.parent) root = root.parent; // atualiza a árvore inteira (matrizes dos pais)
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}
const size = (b) => b.getSize(new THREE.Vector3());

function pixel(sk, r, i, j) {
  const o = ((r.y + j) * sk.width + (r.x + i)) * 4;
  return [sk.data[o], sk.data[o + 1], sk.data[o + 2], sk.data[o + 3]];
}
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function meanColor(sk, r) {
  const sum = [0, 0, 0];
  for (let j = 0; j < r.h; j++) {
    for (let i = 0; i < r.w; i++) {
      const p = pixel(sk, r, i, j);
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
    }
  }
  const n = r.w * r.h;
  return sum.map((v) => v / n);
}

function assertFinite(view, label) {
  view.object.updateMatrixWorld(true);
  view.object.traverse((o) => {
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(o.position[k]), `${label}: position.${k} de ${o.name}`);
      assert.ok(Number.isFinite(o.rotation[k]), `${label}: rotation.${k} de ${o.name}`);
      assert.ok(Number.isFinite(o.scale[k]), `${label}: scale.${k} de ${o.name}`);
    }
    for (const e of o.matrixWorld.elements) assert.ok(Number.isFinite(e), `${label}: matrixWorld de ${o.name}`);
  });
  const m = view.material;
  for (const c of [m.emissive.r, m.emissive.g, m.emissive.b, m.color.r, m.color.g, m.color.b]) {
    assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `${label}: cor do material fora de [0,1]: ${c}`);
  }
}

/** Retângulos das 6 faces de uma parte, na skin do tipo. */
function partFaces(kind, partName) {
  const layout = skinLayout(kind);
  return layout.regions[layout.partRegion[partName]].faces;
}

// ---------------------------------------------------------------------------
// skins (pixels)
// ---------------------------------------------------------------------------

test('skinPixels: determinístico, tamanho certo e RGBA completo, para todo tipo/variante', () => {
  for (const kind of SKIN_KINDS) {
    const variants = kind === 'sheep' ? MOB_DEFS.sheep.variants : 1;
    for (let v = 0; v < variants; v++) {
      const a = skinPixels(kind, v);
      const b = skinPixels(kind, v);
      const layout = skinLayout(kind);
      assert.equal(a.width, layout.width, kind);
      assert.equal(a.height, layout.height, kind);
      assert.ok(a.data instanceof Uint8Array, kind);
      assert.equal(a.data.length, a.width * a.height * 4, kind);
      assert.deepEqual(Buffer.from(a.data), Buffer.from(b.data), `${kind}:${v} muda entre chamadas`);
      assert.notEqual(a.data, b.data, 'cada chamada devolve um array novo (o cache fica na textura)');
    }
  }
});

test('skinPixels: toda face usada por alguma caixa é 100% opaca (sem buraco no modelo)', () => {
  for (const kind of SKIN_KINDS) {
    const sk = skinPixels(kind, 0);
    for (const p of rigOf(kind).parts) {
      const faces = partFaces(kind, p.name);
      for (const f of FACE_NAMES) {
        const r = faces[f];
        assert.ok(r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= sk.width && r.y + r.h <= sk.height, `${kind}.${p.name}.${f} dentro da textura`);
        for (let j = 0; j < r.h; j++) {
          for (let i = 0; i < r.w; i++) {
            assert.equal(pixel(sk, r, i, j)[3], 255, `${kind}.${p.name}.${f} (${i},${j}) transparente`);
          }
        }
      }
    }
  }
});

test('skinLayout: as regiões das caixas (e suas 6 faces) não se sobrepõem', () => {
  for (const kind of SKIN_KINDS) {
    const layout = skinLayout(kind);
    const rects = [];
    for (const [key, reg] of Object.entries(layout.regions)) {
      for (const f of FACE_NAMES) rects.push({ id: `${kind}.${key}.${f}`, ...reg.faces[f] });
    }
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a];
        const B = rects[b];
        const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
        assert.ok(!overlap, `${A.id} sobrepõe ${B.id}`);
      }
    }
    // ~16 texels por bloco: nenhuma textura exagerada
    assert.ok(layout.width * layout.height <= 64 * 64, `${kind} textura grande demais`);
  }
});

test('ovelha: as 4 variantes são skins diferentes (lã distinta) e variant fora do range normaliza', () => {
  const n = MOB_DEFS.sheep.variants;
  assert.equal(n, 4);
  const wool = [];
  const bodyRect = skinLayout('sheep').regions.body.faces.front;
  for (let v = 0; v < n; v++) wool.push(meanColor(skinPixels('sheep', v), bodyRect));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const d = Math.abs(wool[a][0] - wool[b][0]) + Math.abs(wool[a][1] - wool[b][1]) + Math.abs(wool[a][2] - wool[b][2]);
      assert.ok(d > 40, `lã ${a} e ${b} muito parecidas (${d.toFixed(1)})`);
    }
  }
  // branca > cinza > preta em brilho; marrom mais quente (r > b)
  assert.ok(luma(wool[0]) > luma(wool[1]) && luma(wool[1]) > luma(wool[3]));
  assert.ok(wool[2][0] > wool[2][2] + 20, 'marrom é quente');
  const bytes = (v) => Buffer.from(skinPixels('sheep', v).data);
  assert.deepEqual(bytes(n), bytes(0)); // 4 => 0
  assert.deepEqual(bytes(-1), bytes(n - 1)); // -1 => 3
  assert.deepEqual(bytes(NaN), bytes(0));
  assert.deepEqual(bytes(1.9), bytes(1)); // trunca
  assert.deepEqual(Buffer.from(skinPixels('pig', 3).data), Buffer.from(skinPixels('pig', 0).data), 'tipos sem variante ignoram variant');
});

test('skins: o rosto está na face frontal (+Z) da cabeça; costas e laterais não têm rosto', () => {
  const dark = (c) => luma(c) < 50;
  // creeper: rosto clássico com 20 texels escuros na face frontal
  {
    const sk = skinPixels('creeper', 0);
    const f = partFaces('creeper', 'head');
    let front = 0;
    let back = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      if (dark(pixel(sk, f.front, i, j))) front++;
      if (dark(pixel(sk, f.back, i, j))) back++;
    }
    assert.ok(front >= 18, `rosto do creeper (${front} texels escuros)`);
    assert.ok(back <= 6, `costas do creeper sem rosto (${back})`);
    for (const [i, j] of [[1, 2], [2, 2], [5, 2], [6, 2], [1, 3], [6, 3], [3, 4], [4, 4], [2, 5], [5, 5], [2, 7], [5, 7]]) {
      assert.ok(dark(pixel(sk, f.front, i, j)), `creeper: texel (${i},${j}) do rosto`);
    }
  }
  // porco: olhos (branco por fora, íris escura por dentro) e narinas no focinho
  {
    const sk = skinPixels('pig', 0);
    const f = partFaces('pig', 'head').front;
    assert.ok(dark(pixel(sk, f, 2, 2)) && dark(pixel(sk, f, 5, 2)));
    assert.ok(luma(pixel(sk, f, 1, 2)) > 220 && luma(pixel(sk, f, 6, 2)) > 220);
    const snout = partFaces('pig', 'snout').front;
    assert.ok(luma(pixel(sk, snout, 1, 1)) < luma(pixel(sk, snout, 0, 0)) - 25, 'narina mais escura que o focinho');
  }
  // zumbi: órbitas escuras e boca
  {
    const sk = skinPixels('zombie', 0);
    const f = partFaces('zombie', 'head').front;
    for (const [i, j] of [[1, 3], [2, 3], [5, 3], [6, 3], [1, 4], [6, 4]]) assert.ok(dark(pixel(sk, f, i, j)), `zumbi: olho (${i},${j})`);
    assert.ok(luma(pixel(sk, f, 3, 6)) < luma(pixel(sk, f, 3, 1)) - 30, 'boca escura');
  }
  // ovelha: olhos nas bordas da cara
  {
    const sk = skinPixels('sheep', 0);
    const f = partFaces('sheep', 'head').front;
    assert.ok(luma(pixel(sk, f, 0, 2)) > 220 && dark(pixel(sk, f, 1, 2)) && dark(pixel(sk, f, 4, 2)) && luma(pixel(sk, f, 5, 2)) > 220);
  }
  // avatar: cabelo marrom em cima e atrás, rosto de pele com olhos azuis na frente
  {
    const sk = skinPixels('avatar', 0);
    const f = partFaces('avatar', 'head');
    const hairTop = meanColor(sk, f.top);
    const hairBack = meanColor(sk, f.back);
    const faceFront = meanColor(sk, { x: f.front.x, y: f.front.y + 3, w: 8, h: 5 });
    assert.ok(hairTop[0] < 110 && hairBack[0] < 120, 'cabelo escuro no topo e atrás');
    assert.ok(faceFront[0] > 170, 'rosto de pele na frente');
    assert.ok(pixel(sk, f.front, 2, 4)[2] > pixel(sk, f.front, 2, 4)[0], 'íris azulada');
  }
});

test('skins: paleta legível — zumbi (camisa ciano) não se confunde com creeper (camuflagem verde)', () => {
  const z = skinPixels('zombie', 0);
  const c = skinPixels('creeper', 0);
  const shirt = meanColor(z, { ...partFaces('zombie', 'body').front, h: 6 });
  const camo = meanColor(c, partFaces('creeper', 'body').front);
  assert.ok(shirt[2] > shirt[0] + 60, `camisa do zumbi é ciano (b > r): ${shirt}`);
  assert.ok(camo[1] > camo[2] + 40 && camo[2] < shirt[2] - 40, `creeper é verde puro: ${camo}`);
  // o avatar tem camisa azul (b >> r) e calça azul-escura: nada de verde de zumbi
  const a = skinPixels('avatar', 0);
  const aShirt = meanColor(a, { ...partFaces('avatar', 'body').front, h: 8 });
  assert.ok(aShirt[2] > aShirt[1] + 40 && aShirt[2] > aShirt[0] + 80, `camisa do avatar azul: ${aShirt}`);
  const aPants = meanColor(a, { ...partFaces('avatar', 'legL').front, h: 8 });
  assert.ok(luma(aPants) < 70 && aPants[2] > aPants[0], 'calça azul-escura');
});

test('skins: kind desconhecido lança erro claro', () => {
  assert.throws(() => skinPixels('dragon', 0), /desconhecida/);
  assert.throws(() => createMobView('dragon'), /desconhecida/);
  assert.throws(() => createMobView('avatar'), /desconhecida/, 'avatar tem fábrica própria');
  assert.throws(() => createMobView(undefined), /desconhecida/);
});

// ---------------------------------------------------------------------------
// instanciação, textura compartilhada, UVs
// ---------------------------------------------------------------------------

test('Views instanciam com o formato do contrato (object Group, update, dispose)', () => {
  for (const kind of ALL) {
    const v = make(kind);
    assert.ok(v.object instanceof THREE.Group, kind);
    assert.equal(typeof v.update, 'function');
    assert.equal(typeof v.dispose, 'function');
    assert.equal(v.kind, kind);
    assert.deepEqual(Object.keys(v).filter((k) => ['object', 'update', 'dispose'].includes(k)).sort(), ['dispose', 'object', 'update']);
    v.dispose();
  }
  assert.equal(make('sheep', 2).variant, 2);
  assert.equal(make('sheep', 6).variant, 2, 'variant normalizado');
});

test('textura: DataTexture pixelada, sRGB, cache por (kind, variant), compartilhada entre Views', () => {
  const t = skinTexture('sheep', 1);
  assert.ok(t instanceof THREE.DataTexture);
  assert.equal(t.magFilter, THREE.NearestFilter);
  assert.equal(t.minFilter, THREE.NearestFilter);
  assert.equal(t.colorSpace, THREE.SRGBColorSpace);
  assert.equal(t.generateMipmaps, false);
  assert.equal(t.image.data.length, t.image.width * t.image.height * 4);
  assert.equal(skinTexture('sheep', 1), t, 'cache');
  assert.equal(skinTexture('sheep', 5), t, 'variant normalizado cai no mesmo cache (5 % 4 = 1)');
  assert.notEqual(skinTexture('sheep', 2), t);
  assert.equal(skinTexture('pig', 0), skinTexture('pig', 3), 'tipos sem variante: um só cache');

  const a = createMobView('sheep', { variant: 1 });
  const b = createMobView('sheep', { variant: 1 });
  const c = createMobView('sheep', { variant: 3 });
  assert.equal(a.material.map, t);
  assert.equal(b.material.map, t, 'mesma textura nas duas Views');
  assert.notEqual(c.material.map, t);
  assert.notEqual(a.material, b.material, 'cada View tem o próprio material (flash independente)');
  assert.ok(a.material instanceof THREE.MeshStandardMaterial);
  assert.ok(a.material.roughness >= 0.8, 'roughness alta como o resto do jogo');
});

test('UVs: todos dentro da textura e cada face aponta para o retângulo certo, sem espelhar', () => {
  for (const kind of ALL) {
    const view = make(kind);
    const layout = skinLayout(kind);
    for (const p of rigOf(kind).parts) {
      const geo = view.meshes[p.name].geometry;
      const faces = partFaces(kind, p.name);
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, `${kind}.${p.name} uv fora de [0,1]`);
      }
      // 4 vértices por face; face = a que tem a normal do vértice
      for (const f of FACE_NAMES) {
        const n = FACE_NORMAL[f];
        const idx = [];
        for (let i = 0; i < pos.count; i++) if (nor.getX(i) === n[0] && nor.getY(i) === n[1] && nor.getZ(i) === n[2]) idx.push(i);
        assert.equal(idx.length, 4, `${kind}.${p.name}.${f}`);
        const r = faces[f];
        // 1) dentro do retângulo da face
        for (const i of idx) {
          const px = uv.getX(i) * layout.width;
          const py = uv.getY(i) * layout.height;
          assert.ok(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h, `${kind}.${p.name}.${f} fora do retângulo`);
        }
        // 2) orientação vista de FORA: direita = (-normal) x cima; u cresce p/ a direita, v cresce p/ baixo
        const up = f === 'top' ? new THREE.Vector3(0, 0, -1) : f === 'bottom' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3(-n[0], -n[1], -n[2]).cross(up);
        let du = 0;
        let dv = 0;
        const c = new THREE.Vector3();
        for (const i of idx) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        c.multiplyScalar(0.25);
        for (const i of idx) {
          const rel = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(c);
          du += rel.dot(right) * (uv.getX(i) - 0.5);
          dv += rel.dot(up) * (uv.getY(i) - 0.5);
        }
        assert.ok(du > 0, `${kind}.${p.name}.${f} espelhado em U`);
        assert.ok(dv < 0, `${kind}.${p.name}.${f} de cabeça para baixo (V)`);
      }
    }
    view.dispose();
  }
});

// ---------------------------------------------------------------------------
// dimensões x hitbox
// ---------------------------------------------------------------------------

test('hitbox: altura ±5% de MOB_DEFS (avatar: PLAYER), pés em y=0 e modelo centrado em XZ', () => {
  for (const kind of ALL) {
    const hb = kind === 'avatar' ? { halfW: PLAYER.halfWidth, height: PLAYER.height } : MOB_DEFS[kind];
    assert.deepEqual(hitboxOf(kind), { halfW: hb.halfW, height: hb.height }, `hitboxOf(${kind}) lê da fonte única`);
    const v = make(kind);
    v.update(1 / 60, {});
    const b = bbox(v.object);
    const s = size(b);
    near(s.y / hb.height, 1, 0.05, `${kind}: altura`);
    near(b.min.y, 0, 0.01, `${kind}: pés no chão`);
    // centro da caixa SEM os braços estendidos do zumbi
    const core = new THREE.Box3();
    for (const m of Object.values(v.meshes)) if (!m.userData.reach) core.expandByObject(m);
    near((core.min.x + core.max.x) / 2, 0, 0.02, `${kind}: centro X`);
    near((core.min.z + core.max.z) / 2, 0, 0.02, `${kind}: centro Z`);
    v.dispose();
  }
});

test('hitbox: a maior extensão horizontal casa com a largura da hitbox (zumbi: braços estendidos até 1,25x)', () => {
  for (const kind of ALL) {
    const hb = hitboxOf(kind);
    const v = make(kind);
    v.update(1 / 60, {});
    const s = size(bbox(v.object));
    const ratio = Math.max(s.x, s.z) / (2 * hb.halfW);
    const max = kind === 'zombie' ? 1.25 : 1.12;
    assert.ok(ratio >= 0.85 && ratio <= max, `${kind}: extensão/hitbox = ${ratio.toFixed(3)} fora de [0.85, ${max}]`);
    // o corpo (sem braços) nunca passa de 10% da hitbox em X
    const core = new THREE.Box3();
    for (const m of Object.values(v.meshes)) if (!m.userData.reach) core.expandByObject(m);
    assert.ok(size(core).x <= 2 * hb.halfW * 1.1, `${kind}: corpo mais largo que a hitbox`);
    v.dispose();
  }
});

test('densidade: ~16 texels por bloco em todas as criaturas (pixels quadrados, tamanho de skin do jogo)', () => {
  for (const kind of ALL) {
    const v = make(kind);
    const texelsPerBlock = 1 / v.rig.fit.scale.x; // 1 px de modelo = 1 texel
    assert.ok(texelsPerBlock >= 13 && texelsPerBlock <= 20, `${kind}: ${texelsPerBlock.toFixed(1)} texels/bloco`);
    assert.equal(v.rig.fit.scale.x, v.rig.fit.scale.y, 'escala uniforme (texels quadrados)');
    assert.equal(v.rig.fit.scale.x, v.rig.fit.scale.z);
  }
});

test('createMobView aceita opts ausente/nulo e variant inválido sem quebrar', () => {
  assert.equal(createMobView('sheep').variant, 0);
  assert.equal(createMobView('sheep', null).variant, 0);
  assert.equal(createMobView('sheep', {}).variant, 0);
  assert.equal(createMobView('sheep', { variant: -1 }).variant, 3);
  assert.equal(createMobView('pig', { variant: 9 }).variant, 0);
});

test('hitbox: a escala é DERIVADA de MOB_DEFS (mudar a hitbox muda o modelo; nenhum número copiado)', () => {
  const orig = MOB_DEFS.pig.height;
  try {
    MOB_DEFS.pig.height = orig * 2;
    const v = createMobView('pig');
    v.update(0, {});
    near(size(bbox(v.object)).y, orig * 2, orig * 2 * 0.05, 'porco dobrado');
    v.dispose();
  } finally {
    MOB_DEFS.pig.height = orig;
  }
  const v = createMobView('pig');
  v.update(0, {});
  near(size(bbox(v.object)).y, orig, orig * 0.05, 'porco restaurado');
});

// ---------------------------------------------------------------------------
// orientação (+Z é a frente)
// ---------------------------------------------------------------------------

test('orientação: focinho do porco tem o maior z da cabeça e do modelo (frente = +Z)', () => {
  const v = createMobView('pig');
  v.update(0, {});
  const head = bbox(v.meshes.head);
  const snout = bbox(v.meshes.snout);
  const body = bbox(v.meshes.body);
  const all = bbox(v.object);
  assert.ok(snout.max.z > head.max.z + 0.01, 'focinho sai da cabeça para +Z');
  near(snout.max.z, all.max.z, 1e-6, 'focinho é o ponto mais à frente');
  assert.ok(head.max.z > body.max.z, 'cabeça à frente do corpo');
  assert.ok(head.min.z > body.min.z, 'cabeça não está atrás do corpo');
  // as orelhas ficam em cima da cabeça
  assert.ok(bbox(v.meshes.earL).min.y >= head.max.y - 0.02);
});

test('orientação: ovelha e avatar têm a cabeça à frente do tronco; zumbi estica os braços para +Z', () => {
  const sheep = createMobView('sheep');
  sheep.update(0, {});
  assert.ok(bbox(sheep.meshes.head).max.z > bbox(sheep.meshes.body).max.z);

  const z = createMobView('zombie');
  z.update(0, {});
  const bodyBox = bbox(z.meshes.body);
  for (const arm of ['armL', 'armR']) {
    const a = bbox(z.meshes[arm]);
    assert.ok(a.max.z > bodyBox.max.z + 0.3, `${arm} aponta para +Z`);
    assert.ok(a.min.z > bodyBox.min.z - 0.01, `${arm} não vai para trás`);
  }
  // braços esquerdo/direito: esquerda do personagem = +X
  assert.ok(bbox(z.meshes.armL).getCenter(new THREE.Vector3()).x > 0);
  assert.ok(bbox(z.meshes.armR).getCenter(new THREE.Vector3()).x < 0);

  const a = createAvatarView();
  a.update(0, {});
  // o rosto do avatar está pintado em +Z, mas o corpo fica atrás da linha dos olhos: cabeça e tronco compartilham o eixo
  near(bbox(a.meshes.head).getCenter(new THREE.Vector3()).z, bbox(a.meshes.body).getCenter(new THREE.Vector3()).z, 0.02);
});

test('orientação: rotation.y = yaw (atan2(dirX, dirZ)) leva a frente para a direção certa', () => {
  const v = createMobView('pig');
  v.update(0, {});
  const dir = { x: 1, z: 0 };
  v.object.rotation.y = Math.atan2(dir.x, dir.z); // olhando para +X
  v.object.updateMatrixWorld(true);
  const all = bbox(v.object);
  const snout = bbox(v.meshes.snout);
  near(snout.max.x, all.max.x, 1e-6, 'focinho aponta para +X depois do yaw');
  assert.ok(snout.max.x > 0.3);
});

// ---------------------------------------------------------------------------
// update: robustez
// ---------------------------------------------------------------------------

test('update: sem NaN/Infinity em nenhuma combinação de estado (inclusive entradas inválidas)', () => {
  const rng = makeRng(2026);
  const speeds = [0, 0.3, 1.6, 6, 10.8, 50, -3, NaN, Infinity, undefined];
  const unit = [0, 0.25, 0.5, 1, 5, -1, NaN, undefined];
  const holds = [null, undefined, 'sword', 'pork', 0x336699, 0, 'lixo', NaN, false];
  const dts = [0, 1 / 60, 0.05, 1, NaN, -1, Infinity, undefined];
  for (const kind of ALL) {
    const v = make(kind, 2);
    for (let n = 0; n < 250; n++) {
      const s = {
        speed: rng.pick(speeds),
        hurt: rng.pick(unit),
        fuse: rng.pick(unit),
        attack: rng.pick(unit),
        dying: rng.pick(unit),
        burning: rng.pick([true, false, undefined, 1, 0]),
        sprinting: rng.pick([true, false, undefined]),
        holding: rng.pick(holds),
      };
      v.update(rng.pick(dts), s);
      assertFinite(v, `${kind} #${n} ${JSON.stringify(s)}`);
    }
    for (const bad of [undefined, null, {}, 0, 'x']) {
      v.update(1 / 60, bad); // `s` ausente / inválido => defaults seguros
      assertFinite(v, `${kind} s=${String(bad)}`);
    }
    v.update(); // até sem argumentos
    assertFinite(v, `${kind} sem argumentos`);
    v.dispose();
  }
});

test('update: todos os campos têm default seguro (undefined => 0/false) = pose neutra', () => {
  for (const kind of ALL) {
    const a = make(kind);
    const b = make(kind);
    a.update(1 / 60, {});
    b.update(1 / 60, { speed: 0, hurt: 0, fuse: 0, burning: false, attack: 0, dying: 0, sprinting: false, holding: null });
    a.object.updateMatrixWorld(true);
    b.object.updateMatrixWorld(true);
    const ea = [];
    const eb = [];
    a.object.traverse((o) => ea.push(...o.matrixWorld.elements));
    b.object.traverse((o) => eb.push(...o.matrixWorld.elements));
    assert.deepEqual(ea, eb, kind);
    assert.deepEqual(a.material.emissive.toArray(), [0, 0, 0]);
    assert.equal(a.material.color.r, 1);
  }
});

// ---------------------------------------------------------------------------
// andar
// ---------------------------------------------------------------------------

function legsOf(v) {
  return v.parts.legFL ? [v.parts.legFL, v.parts.legFR, v.parts.legBL, v.parts.legBR] : [v.parts.legL, v.parts.legR];
}

test('andar: parado = pose neutra (pernas em 0; braços do avatar ~0; do zumbi esticados à frente)', () => {
  for (const kind of ALL) {
    const v = make(kind);
    for (let i = 0; i < 30; i++) v.update(1 / 60, { speed: 0 });
    for (const leg of legsOf(v)) assert.equal(Math.abs(leg.rotation.x), 0, `${kind} perna parada`);
  }
  const av = createAvatarView();
  av.update(1 / 60, {});
  assert.ok(Math.abs(av.parts.armL.rotation.x) < 0.06 && Math.abs(av.parts.armR.rotation.x) < 0.06);
  const z = createMobView('zombie');
  z.update(1 / 60, {});
  for (const arm of [z.parts.armL, z.parts.armR]) near(arm.rotation.x, -1.45, 0.1, 'braço do zumbi à frente');
});

test('andar: depois de andar e parar, volta à pose neutra (sem ficar travado no meio da passada)', () => {
  for (const kind of ALL) {
    const v = make(kind);
    let swung = 0;
    for (let i = 0; i < 90; i++) {
      v.update(1 / 60, { speed: 3 });
      swung = Math.max(swung, ...legsOf(v).map((l) => Math.abs(l.rotation.x)));
    }
    assert.ok(swung > 0.2, `${kind}: estava andando antes de parar`);
    for (let i = 0; i < 240; i++) v.update(1 / 60, { speed: 0 });
    for (const leg of legsOf(v)) near(leg.rotation.x, 0, 1e-3, `${kind} voltou ao neutro`);
  }
});

test('andar: amplitude e frequência do balanço crescem com speed; pernas em oposição de fase', () => {
  const stats = (kind, speed) => {
    const v = make(kind);
    let max = 0;
    let crossings = 0;
    let prev = 0;
    const dt = 1 / 120;
    for (let i = 0; i < 240; i++) {
      v.update(dt, { speed });
      const x = legsOf(v)[0].rotation.x;
      if (i > 60) {
        max = Math.max(max, Math.abs(x));
        if (prev !== 0 && Math.sign(x) !== Math.sign(prev) && x !== 0) crossings++;
      }
      if (x !== 0) prev = x;
    }
    return { max, crossings };
  };
  for (const kind of ALL) {
    const s0 = stats(kind, 0);
    const s1 = stats(kind, 0.5);
    const s2 = stats(kind, 1);
    const s3 = stats(kind, 2);
    assert.equal(s0.max, 0, `${kind}: parado não balança`);
    assert.ok(s1.max > 0 && s2.max > s1.max && s3.max > s2.max, `${kind}: amplitude cresce (${s1.max.toFixed(3)} < ${s2.max.toFixed(3)} < ${s3.max.toFixed(3)})`);
    assert.ok(s2.crossings > s1.crossings && s3.crossings > s2.crossings, `${kind}: frequência cresce (${s1.crossings}, ${s2.crossings}, ${s3.crossings})`);
    assert.ok(s3.max < 1.2, `${kind}: balanço limitado`);
  }
  // quadrúpedes: diagonais em fase (FL com BR) e opostas entre si
  const pig = createMobView('pig');
  for (let i = 0; i < 40; i++) pig.update(1 / 60, { speed: 1.6 });
  const p = pig.parts;
  near(p.legFL.rotation.x, p.legBR.rotation.x, 1e-9);
  near(p.legFR.rotation.x, p.legBL.rotation.x, 1e-9);
  near(p.legFL.rotation.x, -p.legFR.rotation.x, 1e-9);
  // bípedes: perna esquerda oposta à direita; braço oposto à perna do mesmo lado
  const av = createAvatarView();
  for (let i = 0; i < 40; i++) av.update(1 / 60, { speed: 5 });
  near(av.parts.legL.rotation.x, -av.parts.legR.rotation.x, 1e-9);
  assert.ok(av.parts.armL.rotation.x * av.parts.legL.rotation.x <= 0, 'braço L oposto à perna L');
});

test('andar: sprinting amplia o balanço do avatar', () => {
  const run = (sprinting) => {
    const v = createAvatarView();
    let max = 0;
    for (let i = 0; i < 120; i++) {
      v.update(1 / 60, { speed: 9, sprinting });
      max = Math.max(max, Math.abs(v.parts.armL.rotation.x));
    }
    return max;
  };
  assert.ok(run(true) > run(false) * 1.1);
});

test('andar: respiração mínima quando parado (escala Y oscila de leve, nunca mais que 2%)', () => {
  const v = createMobView('pig');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    v.update(1 / 60, {});
    lo = Math.min(lo, v.rig.body.scale.y);
    hi = Math.max(hi, v.rig.body.scale.y);
    assert.equal(v.rig.body.scale.x, 1);
  }
  assert.ok(hi - lo > 0.005 && hi - lo < 0.04, `respiração ${lo}..${hi}`);
});

// ---------------------------------------------------------------------------
// ferido, inchar, queimar
// ---------------------------------------------------------------------------

test('hurt: flash vermelho proporcional no material PRÓPRIO da View; zera sem ferimento', () => {
  const a = createMobView('pig');
  const b = createMobView('pig');
  a.update(1 / 60, { hurt: 1 });
  b.update(1 / 60, {});
  const e = a.material.emissive.clone(); // cópia: o Color do material é mutado a cada update
  assert.ok(e.r > 0.5 && e.r > e.g * 5 && e.r > e.b * 5, 'vermelho');
  assert.deepEqual(b.material.emissive.toArray(), [0, 0, 0], 'outra View do mesmo tipo não pisca');
  a.update(1 / 60, { hurt: 0.5 });
  near(a.material.emissive.r, e.r / 2, 0.01, 'proporcional');
  a.update(1 / 60, { hurt: 0 });
  assert.deepEqual(a.material.emissive.toArray(), [0, 0, 0]);
  assert.equal(a.material.map, b.material.map, 'o flash não toca na textura compartilhada');
});

function widthAndHeight(v) {
  const s = size(bbox(v.object));
  return { x: s.x, y: s.y, z: s.z };
}

test('fuse: o creeper incha de 1x a ~1,25x em XZ (e um pouco em Y); outros tipos ignoram', () => {
  const c = createMobView('creeper');
  c.update(0, { fuse: 0 });
  const base = widthAndHeight(c);
  c.update(0, { fuse: 1 });
  const full = widthAndHeight(c);
  near(full.x / base.x, 1.25, 0.02, 'X');
  near(full.z / base.z, 1.25, 0.02, 'Z');
  assert.ok(full.y / base.y > 1.1 && full.y / base.y < 1.25, `Y ${full.y / base.y}`);
  c.update(0, { fuse: 0.5 });
  const half = widthAndHeight(c);
  assert.ok(half.x > base.x * 1.05 && half.x < full.x * 0.99, 'cresce de forma contínua');
  c.update(0, { fuse: 0 });
  near(widthAndHeight(c).x, base.x, 1e-6, 'desarmar volta ao tamanho normal');

  for (const kind of ['pig', 'sheep', 'zombie', 'avatar']) {
    const v = make(kind);
    v.update(0, {});
    const b = widthAndHeight(v);
    v.update(0, { fuse: 1 });
    near(widthAndHeight(v).x, b.x, 1e-6, `${kind} não incha`);
    assert.deepEqual(v.material.emissive.toArray(), [0, 0, 0], `${kind} não pisca`);
  }
});

test('fuse: pisca branco em pulsos cada vez mais rápidos', () => {
  const pulses = (fuse) => {
    const v = createMobView('creeper');
    let count = 0;
    let was = false;
    for (let i = 0; i < 240; i++) {
      v.update(1 / 240, { fuse });
      const e = v.material.emissive;
      const on = e.r > 0.1 && Math.abs(e.r - e.g) < 1e-9 && Math.abs(e.g - e.b) < 1e-9; // branco, não colorido
      if (on && !was) count++;
      was = on;
    }
    return count;
  };
  const slow = pulses(0.2);
  const mid = pulses(0.6);
  const fast = pulses(1);
  assert.ok(slow >= 3, `pulsa mesmo com fuse baixo (${slow})`);
  assert.ok(mid > slow && fast > mid, `pulsos por segundo crescem: ${slow} < ${mid} < ${fast}`);
  const idle = createMobView('creeper');
  for (let i = 0; i < 60; i++) idle.update(1 / 60, { fuse: 0 });
  assert.deepEqual(idle.material.emissive.toArray(), [0, 0, 0], 'sem fuse não pisca');
});

test('burning: tom laranja pulsante + partículas reaproveitadas (sem alocar por frame); some ao apagar', () => {
  const v = createMobView('zombie');
  assert.equal(v.object.getObjectByName('fire'), undefined, 'sem fogo até queimar');
  v.update(1 / 60, { burning: true });
  const fire = v.object.getObjectByName('fire');
  assert.ok(fire && fire.children.length === 8, 'pool de partículas');
  const ids = fire.children.map((m) => m.uuid);
  const geos = new Set(fire.children.map((m) => m.geometry.uuid));
  assert.equal(geos.size, 1, 'uma geometria para todas as partículas');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 120; i++) {
    v.update(1 / 60, { burning: true });
    const e = v.material.emissive;
    assert.ok(e.r > e.g && e.g > e.b && e.r > 0.1, 'laranja (r > g > b)');
    lo = Math.min(lo, e.r);
    hi = Math.max(hi, e.r);
  }
  assert.ok(hi - lo > 0.1, 'pulsa');
  const again = v.object.getObjectByName('fire');
  assert.equal(again, fire, 'mesmo grupo');
  assert.deepEqual(again.children.map((m) => m.uuid), ids, 'mesmas partículas (nada novo por frame)');
  for (const m of fire.children) {
    assert.ok(m.position.y >= 0 && m.position.y <= v.hitbox.height * 1.05, 'partícula dentro da altura do mob');
    assert.ok(Math.abs(m.position.x) <= v.hitbox.halfW + 1e-9 && Math.abs(m.position.z) <= v.hitbox.halfW + 1e-9);
  }
  v.update(1 / 60, { burning: false });
  assert.equal(v.object.getObjectByName('fire'), undefined, 'apagou: partículas saem da árvore');
  assert.deepEqual(v.material.emissive.toArray(), [0, 0, 0]);
  // e quem não queima não paga nada por isso
  const calm = createMobView('pig');
  for (let i = 0; i < 10; i++) calm.update(1 / 60, {});
  assert.equal(calm.object.getObjectByName('fire'), undefined);
});

// ---------------------------------------------------------------------------
// atacar, morrer
// ---------------------------------------------------------------------------

test('attack: o braço faz um arco (0 -> pico em 0,5 -> 0) no zumbi e no avatar', () => {
  const sample = (v, arm) => {
    const out = [];
    for (let k = 0; k <= 20; k++) {
      v.update(0, { attack: k / 20 }); // dt=0: o balanço lento fica congelado
      out.push(arm.rotation.x);
    }
    return out;
  };
  for (const [v, arm, rest] of [
    [createMobView('zombie'), null, -1.45],
    [createAvatarView(), null, 0],
  ]) {
    const a = arm ?? (v.kind === 'zombie' ? v.parts.armL : v.parts.armR);
    const xs = sample(v, a);
    const minIdx = xs.indexOf(Math.min(...xs));
    assert.ok(Math.abs(minIdx - 10) <= 1, `${v.kind}: pico perto de 0,5 (veio ${minIdx / 20})`);
    near(xs[0], rest, 0.1, `${v.kind}: começa no repouso`);
    near(xs[20], xs[0], 1e-9, `${v.kind}: termina onde começou`);
    assert.ok(xs[10] < xs[0] - 0.7, `${v.kind}: arco amplo (${(xs[0] - xs[10]).toFixed(2)} rad)`);
    for (let k = 1; k <= 10; k++) assert.ok(xs[k] <= xs[k - 1] + 1e-9, `${v.kind}: sobe sem recuar`);
    for (let k = 11; k <= 20; k++) assert.ok(xs[k] >= xs[k - 1] - 1e-9, `${v.kind}: volta sem recuar`);
    near(xs[5], xs[15], 1e-9, `${v.kind}: arco simétrico`);
  }
  // o braço esquerdo do avatar (sem item) não golpeia
  const av = createAvatarView();
  av.update(0, { attack: 0 });
  const left0 = av.parts.armL.rotation.x;
  av.update(0, { attack: 0.5 });
  near(av.parts.armL.rotation.x, left0, 1e-9);
  // criaturas sem braços ignoram attack
  const pig = createMobView('pig');
  pig.update(0, { attack: 0.5 });
  assertFinite(pig, 'porco atacando');
});

test('dying: tomba de lado até 90 graus pela aresta dos pés, afunda um pouco e escurece', () => {
  for (const kind of ALL) {
    const v = make(kind);
    const hb = v.hitbox;
    v.update(0, { dying: 0 });
    const upright = size(bbox(v.object));
    near(v.rig.pose.rotation.z, 0, 1e-12);
    assert.equal(v.material.color.r, 1);

    v.update(0, { dying: 0.5 });
    const mid = v.rig.pose.rotation.z;
    assert.ok(mid > 0.3 && mid < Math.PI / 2, `${kind}: meio da queda ${mid}`);

    v.update(0, { dying: 1 });
    near(v.rig.pose.rotation.z, Math.PI / 2, 1e-9, `${kind}: 90 graus`);
    const b = bbox(v.object);
    const s = size(b);
    // deitado: a altura vira a extensão em X; o tombo é para o lado (X), não para a frente (Z)
    near(s.x, upright.y, upright.y * 0.1, `${kind}: deitado ao longo de X`);
    near(s.z, upright.z, 0.02, `${kind}: Z inalterado`);
    assert.ok(s.y < upright.y, `${kind}: ficou mais baixo`);
    // afunda só um pouco (nunca enterra o corpo) e fica rente ao chão
    assert.ok(b.min.y <= -0.005 && b.min.y >= -hb.halfW * 0.4, `${kind}: afunda um pouco (${b.min.y.toFixed(3)})`);
    // cai pela aresta lateral dos pés: não passa de halfW para o lado +X
    assert.ok(b.max.x <= hb.halfW * 1.4 + 1e-9, `${kind}: não atravessa para +X (${b.max.x.toFixed(3)})`);
    // escurece
    assert.ok(v.material.color.r < 0.6 && v.material.color.r > 0.3, `${kind}: escurece (${v.material.color.r})`);
    assert.equal(v.material.color.r, v.material.color.g);
    // dying volta a 0: levanta (reversível para o gallery/testes)
    v.update(0, { dying: 0 });
    near(v.rig.pose.rotation.z, 0, 1e-12);
    v.dispose();
  }
});

// ---------------------------------------------------------------------------
// item na mão do avatar
// ---------------------------------------------------------------------------

test('holding: espada, carne e bloco aparecem na mão DIREITA (−X); só o item atual fica na árvore', () => {
  const v = createAvatarView();
  const name = ['item:sword', 'item:pork', 'item:block'];
  const present = () => name.filter((n) => v.object.getObjectByName(n));

  v.update(1 / 60, {});
  assert.deepEqual(present(), [], 'sem item');
  v.update(1 / 60, { holding: 'sword' });
  assert.deepEqual(present(), ['item:sword']);
  const sword = v.object.getObjectByName('item:sword');
  v.object.updateMatrixWorld(true);
  const wp = sword.getWorldPosition(new THREE.Vector3());
  assert.ok(wp.x < -0.15, `espada na mão direita (x=${wp.x.toFixed(3)})`);
  assert.ok(wp.y > 0.4 && wp.y < 1.2, 'à altura do quadril');
  let p = sword;
  let underRightArm = false;
  while ((p = p.parent)) if (p === v.parts.armR) underRightArm = true;
  assert.ok(underRightArm, 'pendurada no braço direito (acompanha o golpe)');
  assert.ok(bbox(sword).max.z > bbox(v.meshes.body).max.z + 0.1, 'lâmina aponta para a frente');

  v.update(1 / 60, { holding: 'pork' });
  assert.deepEqual(present(), ['item:pork']);
  v.update(1 / 60, { holding: 0x6ab04c });
  assert.deepEqual(present(), ['item:block']);
  const blk = v.object.getObjectByName('item:block');
  assert.equal(blk.material.color.getHex(), new THREE.Color(0x6ab04c).getHex(), 'cor do bloco');
  v.update(1 / 60, { holding: 0x8d8d92 });
  assert.equal(blk.material.color.getHex(), new THREE.Color(0x8d8d92).getHex(), 'cor muda sem recriar');
  assert.equal(v.object.getObjectByName('item:block'), blk, 'mesmo mesh');
  for (const bad of [null, undefined, 'lixo', NaN, false]) {
    v.update(1 / 60, { holding: bad });
    assert.deepEqual(present(), [], `holding=${String(bad)} => mão vazia`);
  }
  // o item acompanha o braço no golpe
  v.update(0, { holding: 'sword', attack: 0 });
  const y0 = v.object.getObjectByName('item:sword').getWorldPosition(new THREE.Vector3());
  v.update(0, { holding: 'sword', attack: 0.5 });
  v.object.updateMatrixWorld(true);
  const y1 = v.object.getObjectByName('item:sword').getWorldPosition(new THREE.Vector3());
  assert.ok(y1.y > y0.y + 0.3, 'espada sobe no golpe');
  // trocar de item repetidamente não cria nós novos
  const nodes = () => {
    let n = 0;
    v.object.traverse(() => n++);
    return n;
  };
  v.update(1 / 60, { holding: 'sword' });
  const before = nodes();
  for (let i = 0; i < 50; i++) v.update(1 / 60, { holding: i % 2 ? 'sword' : 'pork' });
  assert.equal(nodes(), before);
  // mobs ignoram `holding`
  const z = createMobView('zombie');
  let n0 = 0;
  z.object.traverse(() => n0++);
  z.update(1 / 60, { holding: 'sword' });
  let n1 = 0;
  z.object.traverse(() => n1++);
  assert.equal(n1, n0);
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

test('dispose: idempotente, libera só geometrias/material próprios e NÃO a textura compartilhada', () => {
  const scene = new THREE.Scene();
  const a = createMobView('creeper');
  const b = createMobView('creeper');
  scene.add(a.object, b.object);
  const tex = skinTexture('creeper', 0);
  let texDisposed = 0;
  tex.addEventListener('dispose', () => texDisposed++);

  const counts = new Map();
  const watch = (o) => {
    counts.set(o, 0);
    o.addEventListener('dispose', () => counts.set(o, counts.get(o) + 1));
  };
  for (const m of Object.values(a.meshes)) watch(m.geometry);
  watch(a.material);
  a.update(1 / 60, { burning: true }); // cria o pool de fogo (também é da View)
  const fire = a.object.getObjectByName('fire');
  for (const g of new Set(fire.children.map((m) => m.geometry))) watch(g);
  for (const m of new Set(fire.children.map((m) => m.material))) watch(m);

  a.dispose();
  a.dispose(); // idempotente
  for (const [o, n] of counts) assert.equal(n, 1, `${o.type} disposed ${n}x`);
  assert.equal(texDisposed, 0, 'textura compartilhada intacta');
  assert.ok(!scene.children.includes(a.object), 'object sai da cena');
  assert.ok(scene.children.includes(b.object));

  // a outra View continua funcionando e usando a mesma textura
  b.update(1 / 60, { speed: 2, fuse: 0.5, hurt: 0.3 });
  assertFinite(b, 'b depois do dispose de a');
  assert.equal(b.material.map, tex);
  // update depois de dispose é no-op (não lança nem toca no estado)
  assert.doesNotThrow(() => a.update(1 / 60, { speed: 3, burning: true }));
  const bGeos = new Set(Object.values(b.meshes).map((m) => m.geometry.uuid));
  for (const m of Object.values(a.meshes)) assert.ok(!bGeos.has(m.geometry.uuid), 'geometrias não são compartilhadas entre Views');
  b.dispose();
  b.dispose();
  assert.equal(texDisposed, 0);
});

test('dispose: avatar libera também os itens da mão (inclusive os que não estão pendurados)', () => {
  const v = createAvatarView();
  const counts = new Map();
  v.object.traverse((o) => {
    if (o.isMesh) {
      counts.set(o.geometry, 0);
      o.geometry.addEventListener('dispose', () => counts.set(o.geometry, counts.get(o.geometry) + 1));
    }
  });
  v.update(1 / 60, { holding: 'pork' }); // só a carne fica pendurada
  const hung = [];
  v.object.traverse((o) => o.isMesh && o.name.startsWith('item') === false && hung.push(o));
  v.dispose();
  v.dispose();
  for (const [g, n] of counts) assert.ok(n <= 1, 'nunca dispõe duas vezes');
  assert.ok([...counts.values()].every((n) => n === 1), 'todas as geometrias visíveis foram liberadas');
});

// ---------------------------------------------------------------------------
// higiene do código
// ---------------------------------------------------------------------------

test('higiene: módulos de modelo são determinísticos, sem DOM e sem console de debug', () => {
  for (const file of ['../src/entities/skins.js', '../src/entities/model.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/Math\.random\s*\(/.test(src), `${file}: Math.random`);
    assert.ok(!/console\.(log|debug)\s*\(/.test(src), `${file}: console.log`);
    assert.ok(!/\b(document|window|HTMLCanvasElement|OffscreenCanvas|Image)\b\s*[.(]/.test(src.replace(/\/\/.*$/gm, '')), `${file}: DOM`);
  }
  const skins = fs.readFileSync(new URL('../src/entities/skins.js', import.meta.url), 'utf8');
  assert.ok(!/from\s+'three'/.test(skins), 'skins.js é puro (sem Three.js)');
});

test('higiene: mexer em hitbox/variants vem só de mobs.js (nenhuma cópia dos números nos modelos)', () => {
  const src =
    fs.readFileSync(new URL('../src/entities/model.js', import.meta.url), 'utf8') +
    fs.readFileSync(new URL('../src/entities/skins.js', import.meta.url), 'utf8');
  for (const kind of MOB_KINDS) {
    for (const key of ['halfW', 'height', 'maxHp']) {
      const v = MOB_DEFS[kind][key];
      assert.ok(!new RegExp(`${key}\\s*[:=]\\s*${String(v).replace('.', '\\.')}\\b`).test(src), `${kind}.${key}=${v} copiado`);
    }
  }
  assert.ok(src.includes('MOB_DEFS.sheep.variants'), 'variantes da ovelha vêm de mobs.js');
});
