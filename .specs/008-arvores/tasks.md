# Tasks 008 — Árvores

- [x] T1 — `terrain.js`: constantes, `terrainHeight`, `surfaceBlockFor`,
  `chunkIndex` (movidos de `world.js`).
- [x] T2 — `world.js`: importar de `terrain.js`, re-exportar `CHUNK_SIZE` e
  `WORLD_HEIGHT`, manter toda a API pública.
- [x] T3 — `terrain.js`: grade de células + hash (`cellHash`), `treesForChunk`.
- [x] T4 — `terrain.js`: forma da árvore (`forEachTreeBlock`) e
  `decorateTrees` (escrita comutativa, só dentro do chunk).
- [x] T5 — `world.js`: `generateChunk` chama `decorateTrees`.
- [x] T6 — `tests/terrain.test.js`: regressão, borda, determinismo, regras,
  spawn, densidade, save antigo.
- [x] T7 — Medir custo (200 chunks com × sem árvores) e registrar: 1,27× aquecido,
  1,3–1,5× na 1ª execução (ver ADR 0007).
- [x] T8 — ADR 0007 (árvores por grade determinística).
- [x] T9 — `npm run build` (outDir próprio) + `node --test`.
- [x] T10 — Validação manual no jogo real (ver árvores, copas na borda, spawn
  livre) — humano / integrador. (Já conferido numa página de preview isolada com
  o Three.js real: árvores, copas inteiras nas bordas, spawn livre.)
