# Tasks 001 — Mundo voxel + câmera

> Passos pequenos, verificáveis um a um, rastreáveis no PR.
> Marque `[x]` ao concluir, no MESMO commit da mudança.

## Setup
- [x] T1 — Scaffold do projeto Vite: `package.json`, `vite.config.js`,
  `index.html` com overlay de "clique para jogar" e HUD de controles.
- [x] T2 — Adicionar `three` como dependência e `.gitignore` (node_modules, dist).

## Domínio: blocos e ruído
- [x] T3 — `src/blocks.js`: enum `BLOCK` + `BLOCK_COLOR` (fonte única).
- [x] T4 — `src/world/noise.js`: value noise 2D determinístico por seed.

## Mundo
- [x] T5 — `src/world/world.js`: `generateWorld(seed)` preenchendo colunas por
  altura do ruído, com tipos por profundidade (grama/terra/pedra).
- [x] T6 — `buildWorldMesh()`: BufferGeometry única com **face culling** e cor
  por vértice (faces superiores mais claras).

## Câmera e controles
- [x] T7 — `src/player/controls.js`: PointerLockControls + WASD + voo
  (Space/Shift), movimento por `dt`.
- [x] T8 — Integração de overlay: clicar trava o mouse; `Esc` destrava e mostra
  a pausa.

## Bootstrap e loop
- [x] T9 — `src/main.js`: cena, renderer, luzes (ambiente + direcional), céu,
  adiciona mesh do mundo, loop `requestAnimationFrame`, resize handler.

## Verificação
- [x] T10 — `npm install` e `npm run build` concluem sem erro.
- [ ] T11 — Validação manual no navegador dos critérios de aceitação 1–7
  (a fazer pelo humano com `npm run dev`).

## Documentação
- [x] T12 — ADRs: 0001 (stack web/three) e 0002 (cores sólidas na v1).
- [x] T13 — README do projeto com setup e controles.
