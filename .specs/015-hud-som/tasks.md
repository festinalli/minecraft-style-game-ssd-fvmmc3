# Tasks 015 — HUD, menu e sons

- [x] T1 — `index.html`: estrutura nova (menu com modos, tela de morte, corações,
  relógio, toasts, flash) mantendo os ids da Parte 1 + CSS (tokens, responsivo,
  `prefers-reduced-motion`).
- [x] T2 — `hud.js` (puro): `heartsFor`, `isLowHealth`, `phaseLabel`, `clockLabel`,
  `formatCount`, `countText`, `slotKeyLabel`, `deathSummary`, cores e geradores
  de SVG (coração ×3, espada, carne, cubo, sol, lua).
- [x] T3 — `hud.js` (DOM): `createHud` com `setHealth`, `setHotbar`, `setClock`,
  `flashDamage`, `toast`, `setInGame`, `showDeath`/`hideDeath`, `bindMenu` e os
  extras `setMode`/`setMenuState`.
- [x] T4 — `audio.js`: receitas dos 12 sons + motor (`createAudio`, polifonia,
  mudo, pitch/volume, contexto preguiçoso, no-op sem `AudioContext`).
- [x] T5 — `dev/hud.html` + `dev/hud.js`: galeria que reaproveita o `index.html`.
- [x] T6 — `tests/hud.test.js` (puras + DOM falso + `index.html`).
- [x] T7 — `tests/audio.test.js` (receitas + motor com `AudioContext` falso).
- [x] T8 — Verificação visual na galeria (desktop + 375 px), console limpo,
  iterar até ficar polido; níveis dos sons medidos com `OfflineAudioContext`.
- [x] T9 — `node --test`, `npm run build` (outDir próprio) e marcar estas tasks.
- [x] T10 — ADR 0013 (HUD e áudio procedurais).
- [ ] T11 — (PENDENTE, humano: **ouvir os sons** e conferir o flash vermelho de dano a olho;
  já conferidos no navegador: corações, hotbar com contagens, relógio, toasts, tela de
  morte e Renascer) Validação manual com o `main.js` integrado (loop completo: ouvir os
  sons, ver o flash ao tomar dano, morrer e renascer) — integrador/humano. Não dá
  para ouvir nem testar pointer lock no ambiente automatizado.
