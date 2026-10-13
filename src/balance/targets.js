// Faixas-alvo do balanceamento por simulação (feature 019). FONTE ÚNICA: lida por
// `scripts/balance.mjs` e por `tests/balance.test.js`.
//
// São METAS de jogo (o que o combate deve produzir), não os números em si: os números
// moram em `src/entities/mobs.js` (criaturas) e `src/game/items.js` (itens e combate).
// Cada faixa é [mínimo, máximo], inclusiva, e vale para a MÉDIA das seeds de `scenarios.js`.

export const TARGETS = Object.freeze({
  zumbiSolo: Object.freeze([4, 8]), // s até a morte do jogador, parado
  zumbiRevidando: Object.freeze([1, 1]), // fração de vitórias do jogador (100% das seeds)
  doisZumbis: Object.freeze([0.2, 0.6]), // fração de mortes em 30 s, parado
  creeperDano: Object.freeze([4, 8]), // HP da explosão, jogador parado a 2,5 blocos
  carneCura: Object.freeze([6, 6]), // HP curado por carne consumida
});
