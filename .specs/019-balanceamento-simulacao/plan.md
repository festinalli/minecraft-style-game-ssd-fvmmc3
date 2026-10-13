# Plan 019 — Balanceamento por simulação

## Arquitetura

- **`src/balance/scenarios.js`** (novo, PURO, sem DOM): cada cenário é uma função
  `runScenario(name, seed) → { seconds, dealt, died, playerWon, ... }`.
  - Usa `createGame` (game.js) com `world` plano artificial e `rng` semeado.
  - O **bot** do jogador é uma função pura: fica no lugar, ou encara o alvo e golpeia
    com `game.attack` respeitando o cooldown (`COMBAT.ATTACK_COOLDOWN`).
- **`scripts/balance.mjs`**: chama `runAll()` de `scenarios.js` e imprime a tabela.
- **`tests/balance.test.js`**: `runAll()` com 50 seeds fixas e `assert` nas faixas.
- As faixas ficam em `src/balance/targets.js` (fonte única, usada pelo script e pelo teste).

## Contratos

```js
// src/balance/targets.js
export const TARGETS = { zombieSolo: [4, 8], ..., };
// src/balance/scenarios.js
export function runAll({ seeds = 50 } = {}): Array<{ name, value, target:[min,max], ok }>;
```

## Riscos

- Mundo plano e bot simples podem não refletir o jogo real. A spec aceita isso:
  o objetivo é detectar regressão de número, não prever sensação de jogo.
- Tempo de execução: 5 cenários × 50 seeds deve caber em < 5 s no teste.
