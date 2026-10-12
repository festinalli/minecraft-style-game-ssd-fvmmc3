# ADR 0011 — Modos de jogo e save compatível com a Parte 1

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A Parte 2 (feature 012) introduz estado de jogo que a Parte 1 não tinha: vida,
inventário com quantidades, tempo de jogo e dois modos (Sobrevivência e
Criativo). Esse estado precisa ser persistido, mas já existem saves reais no
formato v2 (`voxelcraft.save.v2`, ADR 0006) e o jogador não pode perder o mundo
que construiu. Precisamos decidir (a) onde vive a verdade sobre o modo, (b) como
estender o save e (c) o que fazer com dado corrompido.

## Decisão

1. **O save continua v2.** `VERSION = 2` e a chave `voxelcraft.save.v2` não mudam.
   O estado novo entra num campo **opcional** `game` do mesmo JSON, com versão
   própria (`GAME_VERSION = 1`) e formato
   `{ v, mode, seconds, stats, inventory }`. Sem `game`, o JSON gravado é
   byte-idêntico ao da Parte 1.
2. **Leitura tolerante, isolada dos chunks.** `deserializeChunks` devolve
   `{ seed, player, chunks, game }`. `game` passa por `sanitizeGame`: `null` se
   ausente ou irreconhecível; campo individual ruim vira `null` e o integrador
   usa o padrão (modo do menu, `START_SECONDS`, stats e inventário novos).
   Um `game` corrompido **nunca** invalida os chunks.
3. **Lógica pura, sem duplicar fontes.** `stats.js` é a única fonte das regras de
   vida e dos modos (`MODE`); `inventory.js` lê `HOTBAR_SLOTS`, `STARTER_KIT` e
   `MAX_STACK` de `items.js`. O inventário é serializado por **id**, não por
   posição do slot.
4. **Modo:** `game.mode` é o modo da sessão e vale em conflito; `stats` e
   `inventory` também levam `mode` no próprio JSON para que `fromJSON(toJSON())`
   seja identidade. Criativo = dano ignorado, vida cheia, contagens `Infinity`,
   nada se gasta; as contagens reais de Sobrevivência são preservadas ao alternar.
5. **O save não ressuscita tela de morte.** `stats.fromJSON` nunca restaura
   `dead`; `hp` fora de `[1, maxHp]` é inválido e vira `maxHp`. Assim um jogo
   carregado está sempre jogável (critério "nenhuma tela morta").

## Alternativas descartadas

- **Subir para v3.** Como no ADR 0006 (v1 ignorado), um bump descartaria os
  mundos existentes. Um campo aditivo custa quase nada e ainda deixa um build
  antigo ler o save novo (ele ignora `game`) — coberto por teste com uma cópia do
  leitor antigo.
- **Chave de `localStorage` separada para o estado de jogo.** Dois writes
  independentes poderiam ficar dessincronizados (mundo de um instante, inventário
  de outro). Um único JSON é gravado de uma vez.
- **Rejeitar o save inteiro se `game` for inválido.** Perderia as construções do
  jogador por causa de um campo secundário.

## Consequências

- **Positivo:** saves da Parte 1 carregam sem migração; estado novo é pequeno e
  versionado; vida, inventário e persistência são testáveis no Node, sem DOM.
- **Negativo:** `localStorage` ganha mais bytes por save (insignificante frente
  aos chunks em base64). O `mode` aparece em três lugares do JSON (envelope,
  `stats`, `inventory`); a regra "vale `game.mode`" tem de ser seguida pelo
  integrador (`setMode(game.mode)` depois dos `fromJSON`).
- **Pendente de outros donos:** a noção de item "permanente" (espada) está em
  `inventory.js`; poderia migrar para `items.js`. O tamanho esperado de cada
  chunk não é validado na leitura (comportamento herdado da Parte 1).
