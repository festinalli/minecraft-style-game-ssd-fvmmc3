# Tasks 009 — Dia e noite

- [x] T1 — `time.js`: constantes, `phaseOf`, `dayNumber`, `isNight`,
  `phaseName`.
- [x] T2 — `time.js`: `skyState` (cores, neblina, direções, intensidades,
  `nightFactor`, `starAlpha`) com `out` opcional.
- [x] T3 — `sky.js`: grupo do céu (estrelas, sol, lua com `DataTexture`).
- [x] T4 — `sky.js`: `update` (fundo, neblina, luzes, alvo da direcional,
  posições/orientações, visibilidade, estrelas) e `dispose`.
- [x] T5 — `tests/time.test.js` (fases, continuidade, periodicidade, pureza).
- [x] T6 — `tests/sky.test.js` (cena no Node, 20 instantes, dia × noite).
- [x] T7 — ADR 0008 (dia/noite como função pura do tempo).
- [x] T8 — `npm run build` (outDir próprio) + `node --test`.
- [x] T9 — Validação visual no jogo real (sol/lua/estrelas, crepúsculo, noite
  jogável) — humano / integrador. (Já conferido numa página de preview isolada com
  o Three.js real: amanhecer, dia, pôr do sol, noite com lua e estrelas.)
  Conferido também no jogo integrado (dia, entardecer rosado e noite com estrelas; o
  relógio do HUD troca para a lua).
