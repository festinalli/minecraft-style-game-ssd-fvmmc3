# Plan 002 — Quebrar e colocar blocos

> O COMO. Derivado da spec 002.

## Arquitetura

Novo módulo `src/player/editing.js` cuida de mira, realce e edição. `main.js`
fornece o mundo (`voxels`), a malha atual e um callback para reconstruí-la.

```
main.js
 ├─ worldMesh (mutável)
 ├─ rebuildWorld()  ──► remove mesh antiga, dispose, buildWorldMesh, add
 └─ createEditing({ camera, scene, voxels, getMesh, rebuild, isLocked, playerPos })
        ├─ Raycaster (far = REACH) a partir do centro da tela
        ├─ highlight: LineSegments (EdgesGeometry de um cubo)
        ├─ updateHighlight()  ← chamado todo frame
        └─ onMouseDown (esq=remove, dir=coloca)
```

## Contratos

### `src/player/editing.js`
```js
export const REACH = 8;

// Função PURA (testável headless): do ponto de impacto + normal da face
// para coordenadas de voxel. Retorna { hit, place } em índices de voxel.
export function resolveTarget(point, normal, offsetX, offsetZ): {
  hit:   {x,y,z},   // bloco atingido (remover)
  place: {x,y,z},   // vizinho na direção da normal (colocar)
}

export function createEditing(opts): { updateHighlight(), dispose() }
```

### Convenção de coordenadas (consistente com `world.js`)
A malha posiciona vértices em `worldX = voxelX - offsetX` (idem Z; Y sem offset).
Logo, dado um ponto `p` no mundo e a normal `n` da face atingida:

- **Bloco atingido** (logo "atrás" da face, no sentido oposto à normal):
  - `hit.x = floor(p.x - n.x*0.5 + offsetX)`
  - `hit.y = floor(p.y - n.y*0.5)`
  - `hit.z = floor(p.z - n.z*0.5 + offsetZ)`
- **Bloco a colocar** (do lado de fora da face): `place = hit + n`.

### Edição + rebuild
- Remover: `voxels.set(hit.x,hit.y,hit.z, AIR)` → `rebuild()`.
- Colocar: se `voxels.get(place)` é AIR **e** `place` ≠ célula do jogador →
  `voxels.set(place, selected)` → `rebuild()`.
- `rebuild()` recria a `BufferGeometry` inteira (mundo pequeno, custo aceitável;
  otimização por chunk fica pra quando houver streaming — feature 006).

## Decisões técnicas

- **Rebuild da malha inteira** a cada edição em vez de edição incremental de
  buffers: simples e suficiente para o mundo finito atual (~30k tris). Registrado
  em ADR 0003.
- **Lógica de coordenadas isolada numa função pura** (`resolveTarget`) para poder
  testar headless sem WebGL (critério 8).
- **Realce** com `EdgesGeometry` levemente maior (1.002) pra não fazer z-fighting.

## Riscos / mitigação
- *Erro de sinal no offset/normal* → função pura + teste headless dedicado.
- *Colocar bloco sobre o jogador* → checagem explícita contra a célula do jogador.
- *Custo de rebuild* → mundo finito pequeno; monitorar FPS (HUD já existe).

## Validação (mapeia critérios)
- Teste headless de `resolveTarget` para remover e colocar (crit. 8).
- `npm run build` (crit. 7).
- Manual: realce, esq/dir, teclas 1–4, sem menu de contexto (crit. 1–6).
