# ADR 0017 — Feedback visual de quebra e combate em pool fixo de instâncias

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

Quebrar bloco e acertar criatura não tinham retorno visual. Partículas são cosméticas, mas
não podem custar alocação por quadro nem crescer sem limite.

## Decisão

- **Um `InstancedMesh` com 96 instâncias** (`src/fx/particles.js`): uma draw call, cor por
  instância via `setColorAt`, matrizes e vetores pré-alocados.
- **Pool cheio:** a partícula mais antiga cede o lugar. Assim nunca há mais de 96 vivas,
  mesmo com 200 quebras seguidas (teste).
- **Direções pelo `rng` injetado**, para o teste ser determinístico (nada de `Math.random()`).
- **Sem DOM e sem renderer no teste**: o módulo roda no Node com um `InstancedMesh` real.

## Consequências

- **Positivo:** custo fixo por quadro, sem lixo para o coletor; o teste pega o crescimento.
- **Negativo:** efeito puramente visual; não há partículas de explosão nem de passo.
