# ADR 0018 — Balanceamento como teste com faixas-alvo

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

Os números de combate (dano do zumbi e do creeper, cooldown, cura da carne) foram ajustados
por olho e por playtest curto. Nada impedia que uma mudança quebrasse o equilíbrio sem
ninguém perceber.

## Decisão

- **Faixas-alvo em `src/balance/targets.js`** (fonte única), escritas na spec 019.
- **Simulação headless** em `src/balance/scenarios.js`: 5 cenários com 50 seeds fixas, um bot
  de jogador com o mesmo cooldown do jogo.
- **`tests/balance.test.js` falha** se qualquer métrica sair da faixa. `npm run balance`
  imprime a tabela.
- **Números de criatura e item continuam só em `mobs.js` e `items.js`.**
- **Ajuste registrado:** `zombie.aggroRange` de 20 para 21 blocos, único número que levou
  `doisZumbis` (morte de 2 zumbis em 30 s) de 16% para 30%, dentro da faixa de 20% a 60%.
  A varredura foi feita antes, só em memória.

## Consequências

- **Positivo:** uma mudança de número que quebra o equilíbrio aparece no `npm test`.
- **Limites:** a régua mede combate isolado em mundo plano, não a sensação de jogo.
  `doisZumbis` é sensível: ±1 bloco de `aggroRange` move a métrica cerca de ±14 pontos,
  e 50 seeds dão ruído de cerca de ±6 pontos. Vale aumentar as seeds antes de consolidar.
- **Efeito colateral do ajuste:** a percepção maior foi o que expôs a lacuna da janela de
  pathfinding (ADR 0016), corrigida na mesma feature.
