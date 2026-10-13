# ADR 0016 — Caminho local por busca em largura, com janela entre o mob e o alvo

- **Status:** Aceito
- **Data:** 2026-10-12

## Contexto

Zumbi e creeper andavam em linha reta até o jogador. Um muro entre os dois os prendia
para sempre (ADR 0012 registrava isso como limite). Sem caminho, um abrigo de um bloco
de altura funcionava de graça, e o jogador aprendia que o zumbi "não sabe o que faz".

## Decisão

1. **Busca em largura pura** em `src/entities/pathfinding.js`, sobre a grade (x, z), com
   `y` acompanhando o chão. O módulo não conhece o mundo: recebe `free` e `ground` por
   função, e o gerenciador as monta a partir de `world.getBlock` e `collidesBox`.
2. **Janela 25 × 25 centrada no ponto médio** entre o mob e o alvo (`PATH.RADIUS = 12`).
   Assim a janela cobre alvos a até 24 blocos em cada eixo, e o mob enxerga o contorno
   mesmo com o jogador longe. Teto de 700 células descobertas.
3. **Degrau de 1 bloco só com teto livre na origem.** O corpo precisa passar por cima;
   sem isso o plano "subia" através do próprio teto. Queda de até 2 blocos.
4. **Replanejamento a cada 0,5 s**, com orçamento de 2 planos por quadro, para os mobs não
   replanejarem todos no mesmo quadro.

## Consequências

- **Positivo:** zumbi contorna muro e chega ao jogador (teste: a 18 blocos, atrás de um
  muro em U, chega antes de 22 s). Custo medido: 0,03 ms por busca no pior caso em campo
  aberto, com a janela inteira de 625 células.
- **Limite:** alvo a mais de 24 blocos em algum eixo não é planejado; o mob segue em linha
  reta. Obstáculo maior que a janela ainda engana o caminho.
- **Corrigido na revisão da feature:** a primeira versão centrava a janela no mob (raio 8).
  Um zumbi que percebia o jogador a 21 blocos ficava preso atrás de um muro, e o degrau
  sem teto na origem deixava o corpo atravessar o próprio teto.
