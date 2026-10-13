# Spec 017 — Pathfinding local

> O QUÊ e o PORQUÊ.

## Intenção

Hoje zumbis e creepers andam em linha reta até o jogador. Quando há uma parede no
caminho, eles ficam encostados nela, empurrando, até um desencalhe aleatório os
soltar. Um zumbi que não sabe contornar um muro não é uma ameaça — e o jogador que
construiu um abrigo aprende, com razão, que o zumbi "não sabe o que faz".

## Escopo

### Faz parte
- Busca de caminho **local, em 2D** (eixos X e Z, no nível dos pés), por busca em
  largura, dentro de uma janela de 25 × 25 blocos centrada no ponto médio entre o mob e o
  alvo (assim alcança alvos a até 24 blocos em cada eixo, cobrindo a percepção do zumbi).
- Vizinhança de 4 direções. Subir 1 bloco é permitido (`canStepUp`); descer até 2
  blocos é permitido; saltos maiores não.
- Recalcula o caminho a cada 0,5 s, ou quando o alvo muda de bloco.
- Se não há caminho dentro da janela, o mob **não tenta atravessar**: fica parado
  na borda mais próxima e segue o comportamento atual de desencalhe.
- Determinístico: mesma entrada ⇒ mesmo caminho (empates resolvidos por ordem fixa).

### NÃO faz parte
- Caminho 3D (escadas, escalar, pular vãos).
- Caminho para passivos (porco e ovelha fogem, não perseguem).
- Caminho global (fora da janela, o mob usa a linha reta de sempre).

## Critérios de aceitação

1. Um zumbi atrás de um muro em U de 3 blocos de altura chega ao jogador pela
   abertura em até 8 s (hoje: nunca chega).
2. Com o jogador numa ilha sem acesso (cercado por bloco sólido), o zumbi não
   atravessa nem entra no bloco: fica do lado de fora.
3. Nenhum caminho passa por bloco sólido nem por célula ocupada pelos pés de outro
   mob bloqueado.
4. Mesma seed e mesma sequência de estados ⇒ mesmos caminhos (teste de determinismo).
5. Custo: no máximo 700 nós visitados por busca (a janela inteira tem 625); média abaixo de 0,3 ms por busca
   em medição headless.
6. `npm test` e `npm run build` passam.
