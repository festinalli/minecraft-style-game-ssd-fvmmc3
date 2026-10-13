# Tasks 018 — Feedback visual de quebra e combate

- [x] T1 — `src/fx/particles.js`: pool de 96, `emit`, `update`, `alive`, `dispose`.
- [x] T2 — `tests/particles.test.js`: contagem, cor por instância, vida, teto de 96 em 200 quebras, chão.
- [x] T3 — `main.js`: `onBreak` → partículas da cor do bloco; golpe → partículas da cor do mob.
  (Também feito aqui: `game.js` emite `hit-mob` com o ponto de impacto, com teste em `tests/game.test.js`; `mobs.js` ganhou o campo `color` em cada criatura.)
- [ ] T4 — Verificação no navegador: quebrar pedra e acertar porco, conferir cores.
  (Pendente: não foi feita nesta rodada, que não usou navegador. Ficou validado só em headless: `npm test` com 486 testes passando e `vite build` ok.)
