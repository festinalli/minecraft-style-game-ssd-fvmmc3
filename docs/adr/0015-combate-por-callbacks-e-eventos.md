# ADR 0015 — Regras no `game.js`, geometria no `editing.js`, cola no `main.js`

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

Na Parte 1 o `editing.js` decidia tudo: raycast, o que colocar (hotbar fixa) e
o efeito da edição. Com combate, inventário, vida e sons, manter as regras ali
(ou no `main.js`) tornaria o fluxo impossível de testar sem navegador.

## Decisão

- **`game.js`** (sem DOM/câmera) aplica as regras e devolve **eventos**
  (`player-hurt`, `player-died`, `explosion`, `sound`, `toast`).
- **`editing.js`** só calcula geometria e chama callbacks (`onAttack`,
  `onBreak`, `onPlace`, `onUse`, `onSwing`).
- **`main.js`** traduz eventos em efeitos (HUD, som, empurrão, rebuild).
- O golpe respeita oclusão: a criatura só é atingida se estiver **mais perto**
  que o bloco mirado.

## Consequências

- O loop jogável (dano → morte → respawn, comer, golpear, queda) é testado
  headless em `tests/game.test.js`.
- `HOTBAR` deixa de existir em `editing.js`; a fonte única é `game/items.js`.
