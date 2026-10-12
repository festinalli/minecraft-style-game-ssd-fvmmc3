import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import { MOB_DEFS, MOB_KINDS, BEHAVIOR } from '../src/entities/mobs.js';
import { HOTBAR_SLOTS, blockDrop } from '../src/game/items.js';
import { BLOCK } from '../src/blocks.js';

test('rng: mesma seed => mesma sequência; helpers respeitam limites', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
  const r = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const n = r.int(5);
    assert.ok(n >= 0 && n < 5 && Number.isInteger(n));
    const v = r.range(2, 3);
    assert.ok(v >= 2 && v < 3);
  }
});

test('mobs: todo kind tem def completa e comportamento conhecido', () => {
  const behaviors = new Set(Object.values(BEHAVIOR));
  for (const kind of MOB_KINDS) {
    const d = MOB_DEFS[kind];
    assert.equal(d.kind, kind);
    assert.ok(behaviors.has(d.behavior), kind);
    assert.ok(d.maxHp > 0 && d.halfW > 0 && d.height > 0, kind);
    assert.ok(Array.isArray(d.drops), kind);
  }
});

test('hotbar: 10 slots, 8 blocos da Parte 1 em ordem, espada e carne no fim', () => {
  assert.equal(HOTBAR_SLOTS.length, 10);
  assert.deepEqual(
    HOTBAR_SLOTS.slice(0, 8).map((s) => s.block),
    [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND, BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.COBBLE]
  );
  assert.equal(HOTBAR_SLOTS[8].item, 'sword');
  assert.equal(HOTBAR_SLOTS[9].item, 'pork');
});

test('drops de bloco: grama vira terra, pedra vira pedregulho', () => {
  assert.equal(blockDrop(BLOCK.GRASS), BLOCK.DIRT);
  assert.equal(blockDrop(BLOCK.STONE), BLOCK.COBBLE);
  assert.equal(blockDrop(BLOCK.WOOD), BLOCK.WOOD);
});
