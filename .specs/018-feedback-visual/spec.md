# Spec 018 — Feedback visual de quebra e combate

> O QUÊ e o PORQUÊ.

## Intenção

Quebrar um bloco e acertar uma criatura hoje não têm nenhum retorno visual: o bloco
simplesmente some e a criatura pisca. Partículas de cubinhos tornam a ação legível,
sem depender do som (que ainda não foi ouvido por ninguém).

## Escopo

### Faz parte
- **Quebrar bloco**: 8 cubinhos com a cor do bloco quebrado, saindo do centro da
  célula, com gravidade simples e encolhimento até sumir.
- **Acertar criatura**: 6 cubinhos com a cor da criatura (`MOB_DEFS` tem a cor base
  por tipo) e um pequeno impulso no sentido do golpe.
- **Pool fixo** de partículas reutilizadas: nunca mais que 96 vivas ao mesmo tempo;
  sem alocar objetos por quadro.
- Vida de 0,6 s por partícula.

### NÃO faz parte
- Partículas de explosão (já há crateras; ficam para depois).
- Partículas de passos ou de fogo.
- Qualquer efeito no modo Criativo que não seja o mesmo dos outros modos.

## Critérios de aceitação

1. Quebrar um bloco de pedra gera 8 partículas cinzas que somem em até 0,6 s.
2. Acertar um porco gera 6 partículas na cor do porco.
3. Com 200 quebras seguidas, o número de partículas vivas nunca passa de 96.
4. Partículas não atravessam o chão (param no topo do bloco).
5. O módulo de partículas é testável no Node (sem DOM e sem WebGL no teste).
6. `npm test` e `npm run build` passam.
