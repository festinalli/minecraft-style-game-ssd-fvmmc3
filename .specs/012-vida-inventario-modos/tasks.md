# Tasks 012 — Vida, inventário e modos

- [x] T1 — `stats.js`: `MAX_HP`, `HEALTH`, `MODE/isMode`, `fallDamage`.
- [x] T2 — `stats.js`: `createStats` (dano + invulnerabilidade + morte + criativo).
- [x] T3 — `stats.js`: `update` (regeneração independente do `dt`), `heal`,
  `addKill`, `respawn`, `setMode`.
- [x] T4 — `stats.js`: `toJSON/fromJSON` com saneamento.
- [x] T5 — `inventory.js`: slots, seleção (`select/cycle`), `count`,
  `getSelected`.
- [x] T6 — `inventory.js`: `addBlock/addItem` (MAX_STACK), `consumeSelected`,
  `giveStarterKit`, `setMode`.
- [x] T7 — `inventory.js`: `toJSON/fromJSON` com saneamento.
- [x] T8 — `persistence.js`: campo `game` (`serializeChunks/deserializeChunks`,
  `GAME_VERSION`, `makeGame`, `sanitizeGame`) mantendo `VERSION = 2`.
- [x] T9 — `persistence.js`: `saveWorld/loadWorld` com `game`.
- [x] T10 — `tests/stats.test.js`.
- [x] T11 — `tests/inventory.test.js`.
- [x] T12 — `tests/persistence.test.js` (inclui fixture do save da Parte 1).
- [x] T13 — ADR 0011 (modos e save compatível).
- [x] T14 — Verificação: `node --test` + `vite build` com outDir próprio.
- [x] T15 — Integração em `main.js`/HUD e playtest — feito (vida, inventário, modos e save
  restaurado após recarregar a página).
