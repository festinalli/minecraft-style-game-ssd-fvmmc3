# Spec 010 — Física de entidades

> O QUÊ e o PORQUÊ.

## Intenção

Tirar a física do jogador de dentro de `controls.js` e torná-la **genérica**:
um corpo (AABB) com posição, velocidade e `onGround` que **qualquer entidade**
usa — jogador, porco, zumbi, creeper. O jogador passa a rodar exatamente o
mesmo código dos mobs. Junto vêm o que a Parte 2 precisa: **pulo automático**
de degrau de 1 bloco (mobs), **distância de queda** (dano de queda do jogador)
e **knockback** (golpe de zumbi, explosão de creeper).

## Por que agora

A Parte 2 coloca ~18 criaturas no mundo. Cada uma precisa de gravidade,
colisão com os blocos e de não atravessar paredes. Duplicar o `moveAxis` do
jogador em cada mob violaria "uma verdade por fato" (constitution). Além
disso, o jogador ganha vida (012) e combate (014): precisa saber **de quanto
caiu** e **ser empurrado**.

## Escopo

### Faz parte
- `src/entities/physics.js` **puro** (sem DOM, sem Three.js): `GRAVITY`,
  `collidesBox`, `createBody`, `stepBody`, `canStepUp`.
- `collidesAABB` (jogador, olho→pés) passa a **delegar** a `collidesBox`
  (fonte única da colisão), com resultado idêntico ao da Parte 1.
- Lógica do jogador em função pura (`stepPlayer` e auxiliares) que usa
  `stepBody`; `controls.js` fica fino (eventos → `input`) e ganha a API nova:
  `onLand`, `knock`, `setFlyAllowed`, `isFlying`, `isOnGround`, `teleport`,
  `resetFall`.
- Corpo sobreposto a blocos (spawn dentro do terreno, bloco colocado em cima)
  é **empurrado para cima** até ficar livre — nunca fica preso.

### NÃO faz parte
- Dano de queda em si (`fallDamage` é da feature 012) — aqui só se mede a
  distância e se avisa `onLand`.
- IA dos mobs e a decisão de quando pular (013): aqui só `canStepUp` e o corpo.
- Água, escadas, gelo, corpos empurrando corpos.
- Mudar a sensação do jogador: andar 6, correr ×1,8, voo 14/12, gravidade 28,
  pulo 9 e colisão por eixo com revert seguem **iguais** à Parte 1.

## Critérios de aceitação

1. `GRAVITY = 28` é declarada **só** em `physics.js`; `controls.js` não tem
   constante de gravidade (nem integração: usa `stepPlayer`).
2. `collidesBox(world, x, feetY, z, halfW, height)` detecta bloco sólido em
   cada eixo (X, Y, Z) e respeita corpos de alturas diferentes; `collidesAABB`
   devolve o **mesmo resultado** que a implementação antiga (comparado, num
   teste, contra uma cópia dela em milhares de pontos do mundo real).
3. `stepBody` aplica gravidade por padrão, integra `vel * dt` eixo a eixo em
   passos de no máximo 0,2 bloco e **não atravessa** parede nem chão com
   `dt = 0.1`, mesmo a velocidades altas; zera a velocidade do eixo que
   colidiu; só o eixo bloqueado para (desliza no outro).
4. `stepBody` devolve `{ hitX, hitZ, landed, impactVy }`: `landed` só na
   transição ar → chão e `impactVy` é a velocidade vertical (negativa) no
   pouso (0 quando não pousou). `onGround` fica coerente.
5. `canStepUp` é `true` para degrau de 1 bloco com altura livre acima (2 blocos
   para o zumbi), e `false` para degrau de 2 blocos, teto baixo, caminho livre
   (nada a subir) e direção nula. Um zumbi que anda contra um degrau de 1 e
   pula com `MOB_DEFS.zombie.jumpSpeed` **sobe nele**; contra parede de 2
   blocos **não** sobe.
6. Corpo que nasce dentro de blocos é empurrado para cima até não colidir, com
   X/Z preservados; corpo livre não é movido.
7. O jogador, com inputs scriptados (andar, correr, pular, cair, parede, voo,
   `dt` variável), percorre **a mesma trajetória** que a integração antiga
   (cópia dela no teste) — olho idêntico a 1e-9 e `onGround` idêntico em
   centenas de quadros.
8. `onLand(distancia)` dispara **uma vez** por pouso com `pico − pouso` em
   blocos; nunca em voo; não dispara andando no plano nem pela "tremida"
   residual de repouso; `teleport`, `resetFall` e knock vertical para cima
   zeram a referência (não contam queda anterior).
9. `knock(dirX, dirZ, strength, up)` empurra na direção horizontal normalizada
   (direção nula não gera NaN), o impulso horizontal decai exponencialmente
   (constante de tempo ~0,25 s, independente do FPS), é cortado por parede, e
   `up > 0` lança o jogador para cima.
10. `setFlyAllowed(false)` desliga o voo se estiver ligado e faz `F` não ter
    efeito; `setFlyAllowed(true)` devolve o `F`. `teleport` recebe a posição do
    **olho** e zera velocidades. `isFlying()`/`isOnGround()` refletem o estado
    (`isOnGround()` é `false` em voo).
11. Compatibilidade: o `main.js` atual (`createControls(camera, el, world)` →
    `{ controls, update }`) segue funcionando; `npm run build` passa.
