# Spec 019 — Balanceamento por simulação

> O QUÊ e o PORQUÊ.

## Intenção

Os números de combate (dano do zumbi, do creeper, cooldown do golpe, cura da carne)
foram ajustados por olho e por um playtest curto. Esta feature transforma esses
números em **metas medidas**: uma simulação headless roda cenários fixos, compara
com faixas-alvo e falha se um número sair da faixa. Assim, mexer em `mobs.js` ou
`items.js` deixa de ser palpite.

## Escopo

### Faz parte
- `scripts/balance.mjs` (novo) — imprime uma tabela de métricas.
  - Comando: `npm run balance`.
- `tests/balance.test.js` (novo) — as mesmas métricas com **faixas-alvo** e seed fixa.
- Cenários (cada um repetido com 50 seeds fixas):
  1. **Zumbi sozinho, jogador parado**: tempo até morte; dano por segundo.
  2. **Zumbi sozinho, jogador revidando** com espada (bot com cooldown e alcance).
  3. **Dois zumbis, jogador parado**: fração das simulações em que o jogador morre em 30 s.
  4. **Creeper, jogador parado a 2,5 blocos**: dano total da explosão.
  5. **Carne**: quantas unidades de cura por fome consumida (determinístico).
- Faixas-alvo (documentadas aqui e no teste):
  - Cenário 1: morte entre 4 e 8 s.
  - Cenário 2: jogador vence em 100% das simulações.
  - Cenário 3: morte em 20% a 60% das simulações.
  - Cenário 4: dano entre 4 e 8 HP (2 a 4 corações).
  - Cenário 5: cura de 6 HP por carne, 1 carne por mordida.

### NÃO faz parte
- Ajuste automático (otimização). Os números são escolhidos por um humano, com a
  tabela na mão.
- Economia, drops raros, progressão.

## Critérios de aceitação

1. `npm run balance` imprime a tabela das 5 métricas sem erro.
2. `npm test` falha se qualquer métrica sair da faixa-alvo (o teste é a fonte de
   verdade do balanceamento).
3. A simulação é determinística: duas execuções produzem a mesma tabela.
4. Os números ajustados ficam **só** em `src/entities/mobs.js` e `src/game/items.js`.
5. `npm test` e `npm run build` passam.
