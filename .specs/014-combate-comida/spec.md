# Spec 014 — Combate, drops e comida

> O QUÊ e o PORQUÊ.

## Intenção

Dar ao jogador **ação sobre as criaturas** e **consequência por agir**: golpear
porcos, ovelhas, zumbis e creepers; coletar o que cai (blocos quebrados e carne);
comer para se curar. É o que fecha o loop de sobrevivência da Parte 2.

## Por que agora

Já existem criaturas (011, 013), vida (012) e HUD (015), mas sem este elo o
jogador só **sofre** dano — não revida, não ganha nada, não se cura.

## Escopo

### Faz parte
- **Clique esquerdo**: se há uma criatura na mira, mais perto que o bloco
  mirado e dentro de `MELEE_REACH`, **golpeia** (dano `DAMAGE.SWORD` com a espada
  selecionada, `DAMAGE.FIST` com qualquer outro slot) com knockback; senão,
  **quebra o bloco** (comportamento da Parte 1).
- **Sem golpe através de parede**: o bloco mirado mais próximo que a criatura
  bloqueia o golpe.
- **Drops**: em Sobrevivência, quebrar um bloco soma `blockDrop(bloco)` ao
  inventário; matar porco/ovelha soma carne (toast `+N Carne`); matar conta
  um abate.
- **Clique direito**: com **bloco** selecionado e quantidade > 0, coloca (e
  gasta 1); com **carne**, come (cura `FOOD.PORK_HEAL`, gasta 1, intervalo
  `FOOD.EAT_COOLDOWN`, não come com vida cheia).
- **Colocar bloco nunca prende** o jogador nem uma criatura: células que
  intersectam a AABB do jogador ou de um mob são recusadas.
- O **fundo do mundo (y = 0) é indestrutível** (não há como cair no vazio).
- **Cooldown do golpe** (`COMBAT.ATTACK_COOLDOWN`): enquanto recarrega, o clique em cima
  de uma criatura é consumido sem dano (não quebra o bloco atrás dela).
- **Renascer de noite pula para o amanhecer** (evita laço de morte com zumbis a caminho).
- **Criativo**: nada é gasto nem coletado; criaturas ainda podem ser golpeadas.

### NÃO faz parte
- Crafting, durabilidade, dano por arma diferente além de punho/espada.
- Drops físicos no chão (tudo é coletado automaticamente).
- Combate à distância.

## Critérios de aceitação

1. Com a espada, 2 golpes matam um porco (10 HP); 4 matam um zumbi (20 HP);
   com punho, 10 golpes matam um porco.
2. Matar um porco dá 1–2 carnes no inventário e incrementa abates.
3. Um golpe a uma criatura atrás de um bloco **não** a atinge (e quebra o bloco).
4. Comer carne com 14/20 HP deixa 20/20; com 20/20 não gasta a carne.
5. Quebrar GRAMA dá TERRA; PEDRA dá PEDREGULHO; os demais dão a si mesmos.
6. Colocar bloco com `0` unidades não coloca; em Criativo coloca sempre.
7. Tentar colocar um bloco dentro do próprio corpo ou de um mob é ignorado.
8. `npm run build` e `npm test` passam.
9. Dois cliques colados são um golpe só; depois do cooldown volta a ferir.
10. Morrer à noite e renascer põe o relógio no amanhecer do dia seguinte; de dia, o relógio não muda.
