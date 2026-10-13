# Plan 018 — Feedback visual de quebra e combate

## Arquitetura

- **`src/fx/particles.js`** (novo, Three.js sem DOM): `createParticles(scene, { max = 96 })`
  com `emit(x, y, z, color, count, impulse)`, `update(dt)` e `dispose()`.
  - Um único `THREE.InstancedMesh` com `BoxGeometry` pequena e `MeshBasicMaterial`
    (cor por instância via `setColorAt`).
  - Pool de `max` slots; `emit` reaproveita slots mortos; sem alocação por quadro
    (matrizes e vetores pré-alocados).
  - Usa um `rng` injetado (`src/rng.js`) para as direções: nada de `Math.random()`.
- **`src/main.js`**: `onBreak` emite com a cor do bloco; o evento de golpe emite com
  a cor da criatura.
- **Teste**: `tests/particles.test.js` cria o módulo com um `scene` falso e um
  `InstancedMesh` real do Three.js (sem renderer).

## Contratos

```js
export function createParticles(scene, { max = 96, rng } = {}): {
  emit(x, y, z, colorHex, count, impulse?): void,
  update(dt): void,
  alive(): number,   // para teste e HUD de debug
  dispose(): void,
};
export const FX = { LIFE: 0.6, GRAVITY: 14, MAX: 96 };  // fonte única
```

## Riscos

- `InstancedMesh` com 96 instâncias é barato; o custo real é a atualização da matriz
  e da cor a cada quadro — medido no teste de carga (200 quebras).
