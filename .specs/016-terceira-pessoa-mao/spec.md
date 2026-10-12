# Spec 016 — Terceira pessoa e mão

> O QUÊ e o PORQUÊ.

## Intenção

Fazer o jogador **existir no mundo**: em 1ª pessoa ele vê a própria mão (bloco,
espada ou carne) que balança ao andar e faz um arco ao golpear/colocar; com `V`
a câmera recua e mostra o **avatar** do jogador.

## Por que agora

As criaturas ganharam corpo; o jogador seguia sendo uma câmera. A mão dá
feedback imediato a cada clique, e a 3ª pessoa deixa ver o personagem, a espada
e a animação de golpe.

## Escopo

### Faz parte
- Mão em 1ª pessoa com o item selecionado (bloco = cubo colorido, espada, carne),
  balanço ao andar, arco ao golpear/colocar.
- `V` alterna 1ª/3ª pessoa. Na 3ª, a câmera recua até `THIRD_PERSON_DISTANCE` e
  **encosta** em blocos (não atravessa parede). Edição e golpe seguem saindo da
  CABEÇA (como no Minecraft).
- Avatar acompanha o corpo: andar, segurar o item, flash ao ferir.

### NÃO faz parte
- Seleção de skin, câmera frontal, animação de mineração contínua.

## Critérios de aceitação

1. Selecionar outro slot troca o item da mão no mesmo quadro.
2. Clicar dispara o balanço da mão (dura ~0,28 s).
3. `V` mostra o avatar de costas para a câmera, na posição dos pés, virado para
   onde se olha; `V` de novo esconde-o e volta a mão.
4. Com a câmera encostada numa parede, ela não atravessa o bloco.
5. Pausar/renascer mantém o modo de câmera coerente.
