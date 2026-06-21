# Plan 007 — Hotbar / inventário

> O COMO. Derivado da spec 007.

## Mudanças por módulo

### `src/blocks.js`
- Novos tipos: `WOOD=5, LEAVES=6, PLANKS=7, COBBLE=8` + cores base em `BLOCK_COLOR`.

### `src/world/atlas.js`
- Novos tiles: `WOOD_TOP, WOOD_SIDE, LEAVES, PLANKS, COBBLE`.
- **Atlas com múltiplas linhas:** `ATLAS_ROWS = ceil(nTiles / ATLAS_COLS)`;
  `uvForTile` passa a considerar a linha. `texture.flipY = false` (v=0 = topo do
  canvas) para a orientação ser previsível.
- `tileFor`: madeira (topo/fundo = anéis, lateral = casca); folhas/tábuas/cobble
  iguais em todas as faces.
- Desenhar os novos tiles (ruído + detalhes simples: anéis da madeira, linhas
  das tábuas, manchas do cobble).

### `src/world/world.js`
- **UVs explícitas por face** (substitui `cornerUV`): cada face declara as 4
  coordenadas UV locais (0..1) já orientadas — em faces laterais, V segue o eixo
  Y do mundo (corrige a rotação). UV final = interpola dentro do `rect` do tile.

### `src/player/editing.js`
- `HOTBAR` cresce para 8 (`...,WOOD,LEAVES,PLANKS,COBBLE`).
- Teclas `1`–`8` (já genéricas via `HOTBAR.length`).
- **Roda do mouse:** listener `wheel` cicla `selectedIndex` (wrap-around) quando
  travado; dispara `onSelect`.

### `main.js` / `index.html`
- `renderHotbar` já itera `HOTBAR` (8 slots aparecem sozinhos). Sem mudança
  estrutural além de garantir cores dos novos blocos.

## Decisão técnica
- **UV explícita por face** é mais verbosa, porém inequívoca e correta para
  qualquer tile (topo/lateral). Evita o "texture rotacionada" do mapeamento
  genérico anterior. (Sem ADR próprio — é correção/detalhe de implementação
  dentro do já decidido em ADR 0005.)

## Validação (mapeia critérios)
- Teste headless: `tileFor` dos novos blocos (madeira topo≠lateral; folhas/
  tábuas/cobble únicos); `uvForTile` multi-linha dentro de [0,1] e linhas
  distintas sem sobreposição; UVs por face dentro do tile (crit. 6).
- `npm run build` + testes anteriores (crit. 7). Manual: 1–8, roda, novos blocos,
  orientação (crit. 1–5).
