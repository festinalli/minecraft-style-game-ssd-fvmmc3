# Plan 017 — Pathfinding local

## Arquitetura

- **`src/entities/pathfinding.js`** (novo, PURO): `findPath(isWalkable, start, goal, opts)`.
  - `isWalkable(x, y, z)` é injetado: devolve se a célula (x, y, z) pode ser
    ocupada pelos pés. O manager passa uma função baseada em `world.getBlock` e
    `canStepUp`. Mantém o módulo testável sem mundo.
  - Busca em largura sobre a grade (x, z), com `y` acompanhando o chão
    (sobe 1, desce até 2).
  - Janela: `opts.radius = 8` ao redor do início. Limite de nós: `opts.maxNodes = 400`.
  - Retorna lista de células `[{x, y, z}]` do início (exclusivo) ao alvo (inclusivo),
    ou `null`.
- **`src/entities/ai.js`**: `thinkMelee` e `thinkCreeper` ganham um `mob.path`
  (lista de waypoints) e `mob.pathT` (tempo até recalcular). O `wish` aponta para o
  próximo waypoint em vez do jogador, quando há caminho.
- **`src/entities/manager.js`**: fornece `ctx.walkable` (função de célula) e
  reaproveita a checagem de `canStepUp` já existente.

## Contratos

```js
// src/entities/pathfinding.js
export const PATH = { RADIUS: 8, MAX_NODES: 400, REPLAN_EVERY: 0.5, MAX_DROP: 2 };
export function findPath(isWalkable, start, goal, opts = {}): Array<{x,y,z}> | null;
```

- Os números ficam em `PATH` neste módulo (a constitution proíbe duplicar valores).

## Riscos

- Custo da busca em um quadro com muitos mobs: limitado por `MAX_NODES` e por
  replanejamento a cada 0,5 s, com escalonamento por mob (não todos no mesmo quadro).
- Caminho que passa por célula onde o mob não cabe (teto baixo): `isWalkable` checa
  a altura do corpo, não só o chão.
