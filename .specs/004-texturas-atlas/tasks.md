# Tasks 004 — Texturas (atlas)

- [x] T1 — `src/world/atlas.js` layout puro: `TILES`, `tileFor`, `uvForTile`.
- [x] T2 — `makeAtlasTexture()`: desenha tiles no canvas (nearest, sem mipmap).
- [x] T3 — `world.js`: `FACES[*].name`; emitir `uv`; vertex color = sombreamento.
- [x] T4 — `buildWorldMesh(voxels, material?)` aceitando material injetado.
- [x] T5 — `main.js`: criar textura+material e reaproveitar no rebuild.
- [x] T6 — ADR 0005 (atlas procedural em runtime).
- [x] T7 — Verificação: teste headless de `tileFor`/`uvForTile` + presença de
  `uv` na geometria + `npm run build`.
- [ ] T8 — Validação manual (aparência) — humano.
- [x] T9 — Atualizar README/LOOP (004 → feito).
