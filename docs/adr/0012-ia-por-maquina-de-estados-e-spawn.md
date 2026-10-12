# ADR 0012 — IA por máquina de estados pura, gerenciador que move, spawn por dia e noite

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A Parte 2 coloca porcos, ovelhas, zumbis e creepers no mundo. Eles precisam
decidir o que fazer (passear, fugir, perseguir, bater, inchar, explodir), nascer
e sumir conforme o ciclo de dia e noite, e custar pouco: até ~18 mobs
simulando a 60 FPS. Tudo isso precisa rodar no `node --test` (sem navegador) e
ser determinístico (constitution: mesma seed ⇒ mesmo comportamento).

## Decisão

1. **A IA decide, o gerenciador move.** `src/entities/ai.js` é puro: `think(mob,
   def, ctx, rng, dt)` escreve só a intenção no mob (`wish`, `speed`,
   `wantJump`, `face`, `state` e os temporizadores da IA) e empurra eventos em
   `ctx.events`. Não conhece o mundo. O que depende do mundo chega pelo mob
   (`blockedT`, medido pelo gerenciador pelo deslocamento real) ou é injetado
   (`ctx.los`, linha de visão). `src/entities/manager.js` aplica a intenção com
   a física genérica (ADR 0009), cuida de dano, morte, queima, explosão e spawn.
2. **Uma máquina de estados por `def.behavior`:** passivo (`idle ↔ wander`,
   `flee` ao ser ferido), zumbi (`idle/wander → chase ⇄ attack`, histerese de
   aggro), creeper (`chase → fuse → explode`, `fuse` decai além de
   `fuseAbortDist`). Alvo = jogador vivo fora do Criativo. Perseguição em linha
   reta; preso por mais de 1 s, o mob anda de lado (sinal sorteado).
3. **Aleatoriedade só pelo `rng` injetado**, na mesma ordem em qualquer
   execução (fase inicial, durações, rumos, grupos, drops, despawn diurno). Um
   teste roda o mesmo cenário duas vezes e compara eventos, estados finais e o
   próximo número do rng.
4. **Headless por padrão:** sem `scene` não existe View; com `scene` cada mob
   tem uma View posicionada em `(pos, yaw)` e atualizada com um objeto de estado
   reutilizado (zero alocação por quadro).
5. **Eventos por fila:** `update()` devolve os eventos do quadro; o dano feito
   fora dele (`damage()`, do clique do jogador) enfileira som e `mob-died` para o
   próximo `update`. Os drops voltam no retorno de `damage()` **e** vão em
   `mob-died` — o host credita pelo retorno, uma vez.
6. **População:** a cada `tryInterval`, hostis só em Sobrevivência, de noite e
   com jogador vivo (teto `min(max, base + dia)`), passivos até `passiveCap`.
   Os tetos são **duros** e contam todos os vivos que existem de verdade (até
   `despawnDist`), inclusive congelados — desvio consciente do comentário de
   `passiveCap` ("raio simRadius"), que deixaria passar do teto. Colunas válidas:
   chunk já gerado, suporte em `spawn.on`, ar acima, corpo cabendo (copas e
   troncos não servem). Além de `simRadius` o mob congela; além de `despawnDist`
   some; de dia, hostis além de `daylightDespawnDist` somem a
   `daylightDespawnChance` por segundo (campo novo e aditivo em `SPAWN`).
7. **Queima e explosão:** o zumbi queima se não há nenhum bloco sólido acima da
   cabeça (`world.surfaceY`; qualquer bloco abriga). A explosão remove toda
   célula sólida cujo **centro** cai em `carveRadius` (nunca `y < 1`), via
   `world.setBlock` (marca o chunk como modificado), e o dano é
   `ceil(blastDamage × (1 − d/blastRadius))` pela distância ao centro do corpo.
   O som da explosão é do evento `explosion` (o host já toca `explode` nele):
   o gerenciador não emite um `sound 'explode'` duplicado.
8. **Duas regras de jogabilidade além do brief:** o zumbi só bate com **linha de
   visão** (senão uma parede de 1 bloco, com 1,0 de borda a borda < `attackReach`
   1,2, não abrigaria ninguém) e corpos que se sobrepõem se **afastam
   suavemente** (senão zumbis que chegam juntos viram um só).

## Consequências

- **Positivo:** a IA e o gerenciador inteiros rodam no Node (91 testes só desta
  feature); trocar números é editar `mobs.js`; 18 mobs × 600 quadros custam
  ~25–50 ms de CPU (orçamento era ~1,5 s).
- **Playtest numérico** (mundo plano, jogador com física real): um zumbi mata um
  jogador parado de 20 HP em 5,7 s (4 HP por segundo); contra um jogador que
  revida com a espada e boa pontaria, o `knockback` 6 mantém o zumbi fora do
  alcance de 1,2 e ele nunca bate (sozinho, trivial; 2 zumbis tiram ~8 HP; 3 ou
  mais matam). O jogador (6 b/s) escapa do zumbi (3,6) e do creeper (3,0).
  Queimar leva 10 s. **O creeper era fraco em dano** com os números iniciais
  (`fuseStartDist` 3,0, raio 3,5, dano 12: um jogador parado levava só 2 HP).
  O integrador rebalanceou em `mobs.js` para `fuseStartDist` 2,5, `blastRadius` 4,0 e
  `blastDamage` 16: parado a 2,5 blocos o jogador leva 6 HP (3 corações); no playtest
  a ~2 blocos levou 8 HP, além da cratera e do empurrão.
- **Limites conhecidos:** sem pathfinding (obstáculos grandes viram um passeio
  lateral aleatório); o dano de mob não tem janela de imunidade (só o knockback e
  o flash têm) — a cadência de golpes do jogador é do host; sem colisão
  jogador × mob (só separação entre mobs); a separação é O(n²) (com ≤ ~20 mobs
  é desprezível, mas não escala para centenas).
- **Para o integrador:** creditar drops pelo retorno de `damage()` e ignorar
  `mob-died.drops`; tocar `explode` no evento `explosion`; chamar `populate` no
  início e depois do respawn.
