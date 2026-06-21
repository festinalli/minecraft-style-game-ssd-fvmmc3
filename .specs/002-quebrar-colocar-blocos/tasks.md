# Tasks 002 — Quebrar e colocar blocos

> Passos pequenos, verificáveis um a um. Marque `[x]` no mesmo commit.

- [x] T1 — `resolveTarget(point, normal, offsetX, offsetZ)`: função pura de
  conversão impacto→voxel (bloco atingido e bloco a colocar).
- [x] T2 — `createEditing()`: Raycaster do centro da tela com `far = REACH`.
- [x] T3 — Realce do bloco mirado (LineSegments) atualizado por frame.
- [x] T4 — Clique esquerdo remove; clique direito coloca (com checagem de AIR e
  da célula do jogador); `contextmenu` bloqueado.
- [x] T5 — Seleção de tipo por teclas `1`–`4` + HUD de hotbar refletindo seleção.
- [x] T6 — Integração no `main.js`: `worldMesh` mutável + `rebuildWorld()` com
  dispose; chamar `updateHighlight()` no loop.
- [x] T7 — ADR 0003 (rebuild da malha inteira por ora).
- [x] T8 — Verificação: teste headless de `resolveTarget` + `npm run build`.
- [ ] T9 — Validação manual no navegador (critérios 1–6) — humano com `npm run dev`.
- [x] T10 — Atualizar README e ROADMAP/LOOP (002 → feito).
