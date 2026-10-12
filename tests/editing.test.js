// Testes headless das funções PURAS de src/player/editing.js (feature 014):
// resolveTarget (do impacto do raio para bloco/vizinho) e cellOverlapsBox
// (não prender o jogador/criatura dentro de um bloco recém-colocado).

import test from 'node:test';
import assert from 'node:assert/strict';
import { REACH, cellOverlapsBox, resolveTarget } from '../src/player/editing.js';
import { PLAYER } from '../src/player/collision.js';

const FEET = 10;
const body = (x, z) => [x, FEET, z, PLAYER.halfWidth, PLAYER.height];

test('resolveTarget: face de cima, de baixo e laterais devolvem hit e vizinho certos', () => {
  // topo do bloco (3,5,7): ponto em y=6, normal +Y
  let t = resolveTarget({ x: 3.4, y: 6, z: 7.6 }, { x: 0, y: 1, z: 0 });
  assert.deepEqual(t.hit, { x: 3, y: 5, z: 7 });
  assert.deepEqual(t.place, { x: 3, y: 6, z: 7 });
  // face -X do mesmo bloco
  t = resolveTarget({ x: 3, y: 5.5, z: 7.5 }, { x: -1, y: 0, z: 0 });
  assert.deepEqual(t.hit, { x: 3, y: 5, z: 7 });
  assert.deepEqual(t.place, { x: 2, y: 5, z: 7 });
  // face -Y (de baixo) e +Z
  t = resolveTarget({ x: 3.5, y: 5, z: 7.5 }, { x: 0, y: -1, z: 0 });
  assert.deepEqual(t.place, { x: 3, y: 4, z: 7 });
  t = resolveTarget({ x: 3.5, y: 5.5, z: 8 }, { x: 0, y: 0, z: 1 });
  assert.deepEqual(t.place, { x: 3, y: 5, z: 8 });
});

test('resolveTarget: coordenadas negativas (mundo infinito em todas as direções)', () => {
  const t = resolveTarget({ x: -0.3, y: 6, z: -4.2 }, { x: 0, y: 1, z: 0 });
  assert.deepEqual(t.hit, { x: -1, y: 5, z: -5 });
  assert.deepEqual(t.place, { x: -1, y: 6, z: -5 });
});

test('cellOverlapsBox: célula dentro do corpo (pés e cabeça) é recusada', () => {
  const [x, f, z, hw, h] = body(0.5, 0.5);
  assert.equal(cellOverlapsBox({ x: 0, y: FEET, z: 0 }, x, f, z, hw, h), true, 'célula dos pés');
  assert.equal(cellOverlapsBox({ x: 0, y: FEET + 1, z: 0 }, x, f, z, hw, h), true, 'célula do peito/cabeça');
});

test('cellOverlapsBox: acima da cabeça e abaixo dos pés ficam livres (dá para fazer pilar)', () => {
  const [x, f, z, hw, h] = body(0.5, 0.5);
  // altura 1.8: ocupa y de 10 a 11.8 → a célula y=12 está livre
  assert.equal(cellOverlapsBox({ x: 0, y: FEET + 2, z: 0 }, x, f, z, hw, h), false);
  // a célula logo abaixo dos pés (o chão) só encosta, não sobrepõe
  assert.equal(cellOverlapsBox({ x: 0, y: FEET - 1, z: 0 }, x, f, z, hw, h), false);
});

test('cellOverlapsBox: vizinhas laterais livres quando o corpo está no meio da célula', () => {
  const [x, f, z, hw, h] = body(0.5, 0.5); // ocupa x,z de 0.2 a 0.8
  for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    assert.equal(cellOverlapsBox({ x: cx, y: FEET, z: cz }, x, f, z, hw, h), false, `(${cx},${cz})`);
  }
});

test('cellOverlapsBox: corpo cruzando a fronteira de duas células ocupa as duas', () => {
  const [x, f, z, hw, h] = body(1.0, 0.5); // x de 0.7 a 1.3: célula 0 e célula 1
  assert.equal(cellOverlapsBox({ x: 0, y: FEET, z: 0 }, x, f, z, hw, h), true);
  assert.equal(cellOverlapsBox({ x: 1, y: FEET, z: 0 }, x, f, z, hw, h), true);
  assert.equal(cellOverlapsBox({ x: 2, y: FEET, z: 0 }, x, f, z, hw, h), false);
  assert.equal(cellOverlapsBox({ x: -1, y: FEET, z: 0 }, x, f, z, hw, h), false);
});

test('cellOverlapsBox: encostar exatamente na aresta NÃO conta como sobreposição', () => {
  // corpo de x 0.2..0.8 e célula x=1 (1..2): só toca em x=0.8 < 1 → livre; célula em 0.8 exato:
  assert.equal(cellOverlapsBox({ x: 1, y: FEET, z: 0 }, 0.7, FEET, 0.5, 0.3, 1.8), false, 'aresta em x=1.0');
  assert.equal(cellOverlapsBox({ x: 1, y: FEET, z: 0 }, 0.71, FEET, 0.5, 0.3, 1.8), true, 'invade por 0.01');
});

test('cellOverlapsBox: funciona para qualquer criatura (porco 0.45 × 0.9)', () => {
  assert.equal(cellOverlapsBox({ x: 2, y: FEET, z: 2 }, 2.5, FEET, 2.5, 0.45, 0.9), true);
  assert.equal(cellOverlapsBox({ x: 2, y: FEET + 1, z: 2 }, 2.5, FEET, 2.5, 0.45, 0.9), false, 'acima do porco');
  assert.equal(cellOverlapsBox({ x: 3, y: FEET, z: 2 }, 2.5, FEET, 2.5, 0.45, 0.9), false, 'ao lado do porco');
});

test('REACH segue sendo o alcance de edição da Parte 1', () => {
  assert.equal(REACH, 8);
});
