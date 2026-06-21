# Tasks 006 — Mundo infinito (streaming de chunks)

- [x] T1 — `world.js` reescrito: coords (chunkCoord/localCoord/chunkKey),
  `generateChunk` (puro), classe `World` (getBlock/setBlock/getChunkData/
  isModified/applyChunk/surfaceY).
- [x] T2 — `buildChunkMesh(world, cx, cz, material)`: coords de mundo, face
  culling com vizinho sob demanda, UVs (reusa atlas).
- [x] T3 — `streamer.js`: streaming por raio, fila orçada/frame, descarregar
  malha fora do raio, evict de dados pristinos, `rebuildAround`.
- [x] T4 — `collision.js`: `collidesAABB(world, x, y, z)` em coords globais.
- [x] T5 — `editing.js`: `resolveTarget(point, normal)` global; raycast
  multi-mesh; editar via `world.setBlock` + `streamer.rebuildAround`.
- [x] T6 — `persistence.js` v2: `serializeChunks`/`deserializeChunks` (só
  modificados); wrappers browser sobre o `World`.
- [x] T7 — `main.js`: World + save + streamer + spawn + loop + fog/far.
- [x] T8 — ADR 0006 (mundo infinito por chunks; substitui finito).
- [x] T9 — Verificação headless (coords, geração determinística, mesh, save por
  chunk) + `npm run build` + regressão das partes ainda válidas.
- [ ] T10 — Validação manual (explorar/editar bordas/recarregar) — humano.
- [x] T11 — Atualizar README/LOOP (006 → feito).
