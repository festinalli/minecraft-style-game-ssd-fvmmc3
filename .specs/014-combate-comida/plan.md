# Plan 014 — Combate, drops e comida

## Arquitetura

- **`src/game/game.js`** (sem DOM) concentra as REGRAS: `attack(ray)`,
  `onBlockBroken`, `getHeldBlock`, `onBlockPlaced`, `useItem`, `onLand`. Devolve
  **eventos** (`player-hurt`, `player-died`, `explosion`, `sound`, `toast`);
  nada de DOM/Three na lógica.
- **`src/player/editing.js`** fica só com GEOMETRIA (raycast contra malhas,
  realce, `resolveTarget`, `cellOverlapsBox`) e delega decisões ao host por
  callbacks (`onAttack`, `onBreak`, `onPlace`, `onUse`, `onSwing`).
  `HOTBAR`/seleção saem daqui: a verdade é `game/items.js` + `inventory.js`.
- **`src/main.js`** só cola: câmera, HUD, som, empurrão do jogador, rebuild de
  malhas após explosão.

## Contratos

- `game.attack({origin, dir, blockDistance}) -> {hit, events}`; `hit` = o clique
  foi consumido por uma criatura (não quebra bloco).
- `mobs.raycast(origin, dir, MELEE_REACH)` + comparação com `blockDistance`.
- `cellOverlapsBox(cell, x, feetY, z, halfW, height)` PURA.

## Riscos

- Latência do raycast do bloco (um quadro): aceitável (o golpe usa o raio do
  quadro corrente, o mesmo do realce).
- Fome/durabilidade ficam fora: a carne é cura instantânea, simples de equilibrar.
