# Tasks 010 — Física de entidades

- [x] T1 — `src/entities/physics.js`: `GRAVITY`, `collidesBox`, `createBody`,
  `stepBody` (gravidade, eixo a eixo em passos ≤ 0,2, revert, `onGround`,
  `landed`/`impactVy`, desencalhar) e `canStepUp`.
- [x] T2 — `physics.js`: jogador puro — `createPlayerState`, `stepPlayer`,
  `toggleFly`, `allowFly`, `knockPlayer`, `teleportPlayer`, `resetPlayerFall`
  (queda com `peakY`, knock exponencial, voo).
- [x] T3 — `collision.js`: `collidesAABB` delega a `collidesBox` (`PLAYER`
  intacto).
- [x] T4 — `controls.js`: fino (eventos → `input`), usa `stepPlayer`; API nova
  (`onLand`, `knock`, `setFlyAllowed`, `isFlying`, `isOnGround`, `teleport`,
  `resetFall`); sem constante de gravidade local; câmera ↔ corpo.
- [x] T5 — `tests/physics.test.js`: colisão por eixo, `collidesAABB` ≡ antiga,
  `stepBody` (pouso, `dt` grande, deslize, opts), desencalhar, `canStepUp` +
  simulação do zumbi, regressão do jogador contra a integração antiga, queda,
  knock, voo/teleport, `createControls` com DOM falso, varredura de fontes.
- [x] T6 — ADR 0009 (física genérica compartilhada jogador/mobs).
- [x] T7 — Verificação: `node --test tests/physics.test.js` + build com outDir
  próprio + suíte inteira.
- [x] T8 — Validação manual (andar, pular, voo, cair, ser empurrado) — no navegador:
  andar, voo, queda com dano até a morte e empurrão do zumbi; o pulo tem teste headless.
- [x] T9 — Integrador: ligar `onLand`→`fallDamage`, `knock`←`hurt-player`,
  `setFlyAllowed`←modo, `teleport`/`resetFall` no respawn; atualizar README/LOOP.
