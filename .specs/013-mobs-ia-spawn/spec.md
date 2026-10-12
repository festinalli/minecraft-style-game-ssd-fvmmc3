# Spec 013 — Mobs: IA, spawn e despawn

> O QUÊ e o PORQUÊ.

## Intenção

Dar **vida** ao mundo: porcos e ovelhas que vagueiam e fogem quando feridos,
zumbis que perseguem e batem, creepers que incham e explodem abrindo um buraco
no terreno — tudo nascendo e sumindo conforme o ciclo de **dia e noite**, sob
tetos de população que mantêm os ~18 mobs vivos de que o orçamento de 60 FPS
depende.

## Por que agora

A física genérica (010) e os modelos (011) já existem, mas nada decide **o que
as criaturas fazem**. Sem IA e gerenciador o combate (014) não tem alvo, o
jogador não tem ameaça (012 só tem dano de queda) e a noite (009) é só um céu
escuro.

## Escopo

### Faz parte
- `src/entities/ai.js` **puro**: `think(mob, def, ctx, rng, dt)` — máquina de
  estados por `def.behavior` (`PASSIVE`, `MELEE`, `CREEPER`). **Decide**
  (`wish`, `speed`, `wantJump`, `state`, `face` e os temporizadores da própria
  IA); não move nada nem toca no mundo.
- `src/entities/manager.js`: `createMobManager({ world, rng, scene?, makeView? })`
  — dono dos mobs: corpo (`createBody`/`stepBody`/`canStepUp` de `physics.js`),
  pulo automático, knockback, dano, morte com drops, queima de zumbi ao sol,
  explosão de creeper, spawn/despawn por dia e noite, `raycast`, `populate`.
  **Headless** quando `scene === null` (é como os testes e o `game.js` rodam);
  com `scene`, cria e atualiza uma View por mob (`makeView(kind, {variant})`).
- Aleatoriedade **só** pelo `rng` injetado (`src/rng.js`); mesma seed + mesma
  sequência de `ctx` ⇒ mesma sequência de eventos.
- Números de balanceamento só em `mobs.js` (lidos, nunca copiados). Uma regra já
  citada num comentário de `SPAWN` (hostis "longe" = 24 blocos) vira o campo
  `SPAWN.daylightDespawnDist` — aditivo.

### NÃO faz parte
- Pathfinding (a perseguição é em linha reta; só há desencalhar por
  lateralização), colisão corpo × corpo, dano de queda de mobs.
- Persistir mobs no save (eles repopulam).
- Drops físicos no chão: o dano devolve os drops e o host os coleta.
- Ligar tudo ao jogo (`main.js`, `game.js`, `editing.js`): é do integrador.
- Dano de arma/punho do jogador, cooldown de ataque do jogador (014).

## Contrato (brief §4.6 + MOB_DEFS/SPAWN)

- `pos` do mob e de `ctx.player` = centro dos **pés**; tempo em segundos.
- Orientação: `yaw = atan2(dirX, dirZ)`, frente do modelo = +Z; o corpo gira
  para o yaw desejado com `def.turnRate`.
- `think` recebe `ctx = { player:{pos,alive,mode}, seconds, events?, los? }`;
  `ctx.events` (opcional) é onde ele empurra `hurt-player` e `sound`;
  `ctx.los(ax,ay,az,bx,by,bz)` (opcional) diz se o segmento está livre de
  blocos — o gerenciador a fornece, para o zumbi não bater através de parede.
- Eventos de `update(dt, ctx)`: `hurt-player`, `explosion`, `sound`,
  `mob-died`, conforme o brief.

## Critérios de aceitação

### IA (`think`, `tests/ai.test.js`)
1. **Puro e determinístico:** mesma seed ⇒ mesmas decisões; o código-fonte de
   `ai.js` e `manager.js` não contém `Math.random`, `Date.now` nem `console.`.
2. **Passivo alterna** `idle` ↔ `wander` com durações sorteadas dentro de
   `def.idleTime`/`def.wanderTime`; em `wander` a direção é unitária e `speed ===
   walkSpeed`; em `idle` `wish = 0` e `speed = 0`.
3. **Passivo ferido** (`mob.hurtBy`) entra em `flee` por `def.fleeTime` com
   `speed === fleeSpeed`, `wish` apontando para longe da origem do dano; depois
   volta a `idle`. Ferido de novo durante a fuga reinicia o tempo.
4. **Zumbi** fora de `aggroRange`, ou com jogador morto ou em Criativo, nunca
   persegue (fica em `idle`/`wander`); dentro, `state = 'chase'`, `speed =
   chaseSpeed`, `wish` unitário rumo ao jogador. Perde o alvo além de
   `aggroRange × AI.loseAggroMult`.
5. **Ataque do zumbi:** com a distância horizontal borda a borda ≤
   `attackReach`, `|Δy| < height` e `attackCd ≤ 0`: emite exatamente um
   `hurt-player` (`amount = attackDamage`, `source = 'zombie'`, `knock`/`knockUp`
   do def, `fromX/fromZ` = posição do mob), `attackCd = attackCooldown`,
   `attackT = 1`. Com `attackCd > 0`, fora do alcance ou com Δy ≥ altura, não
   ataca. O cooldown decai por `dt` dentro de `think`. Se `ctx.los` existe e diz
   "bloqueado", também não ataca (o cooldown não é gasto e o zumbi segue
   empurrando rumo ao jogador).
6. **Desencalhar:** `blockedT > AI.unstickAfter` ⇒ anda de lado (perpendicular ao
   alvo, sinal sorteado) por `AI.lateralTime`.
7. **Creeper:** `fuse` só sobe com o jogador a ≤ `fuseStartDist` (de 0 a 1 em
   `fuseTime` s), o creeper para (`wish = 0`) e emite `sound 'hiss'` uma vez ao
   iniciar; além de `fuseAbortDist` volta a `chase` e o `fuse` decai à mesma
   taxa; entre as duas distâncias, quem já infla continua; `fuse = 1` ⇒
   `state = 'explode'`. Sem alvo (morto/Criativo) o fuse decai e ele não persegue.

### Gerenciador (`tests/manager.test.js`)
8. **Headless:** sem `scene` nenhum `makeView` é chamado; com `scene`, cada mob
   tem View adicionada à cena, posicionada em `(pos, yaw)`, atualizada com
   `{speed, hurt, fuse, burning, attack, dying}` e `dispose()`ada ao sair
   (morte, despawn, `clear`, `dispose`).
9. **Física:** em mundo plano e no mundo real (seed 1337) nenhum mob jamais fica
   sobreposto a blocos (`collidesBox` falso em todos os quadros); o zumbi sobe um
   degrau de 1 bloco sozinho (pulo automático) e **não** sobe parede de 2.
10. **Porco:** muda de posição, alterna parado/andando e, ferido, foge — para
    longe do golpe, mais rápido que o passeio.
11. **Zumbi:** persegue e alcança o jogador parado; ataca no ritmo de
    `attackCooldown` emitindo `hurt-player` com o dano/knock do def; não ataca
    em Criativo nem com o jogador morto; **não bate através de uma parede de 1
    bloco** (abrigar-se construindo funciona) mas bate por cima de uma mureta
    baixa; contorna um obstáculo curto.
12. **Queima:** de dia, exposto ao céu, perde `burnDps` HP/s (`mob.burning`) e
    morre; **abrigado sob qualquer bloco** não queima; de noite não queima;
    creeper nunca queima.
13. **Dano e morte:** `damage()` aplica o golpe, empurra para longe da origem
    (com imunidade de `hurtTime` a novo knockback), `hurtT` vai de 1 a 0;
    matar devolve `{killed:true, drops}` (carne `min..max` via rng), emite
    `mob-died`, anima `dying` 0→1 em `corpseTime` e remove o mob. Dano em mob já
    morto não faz nada.
14. **Creeper:** infla só dentro de `fuseStartDist`, desarma ao afastar, e ao
    explodir: remove (viram `AIR`) todas as células cujo centro está dentro de
    `carveRadius`, nunca `y < 1`, nunca bloco `AIR` na lista; deixa intacto o
    que está fora; emite `explosion` com `blocks[]` e `hurt-player` com
    `ceil(blastDamage × (1 − d/blastRadius))` (0 fora do raio) medido ao
    **centro**; mobs na área levam dano; chunks tocados ficam `modified`.
15. **População:** hostis só em Sobrevivência, de noite e com jogador vivo, com
    teto `min(hostileCapMax, hostileCapBase + dia)`; passivos até `passiveCap`
    (tetos duros: contam todos os vivos que existem de verdade, até
    `despawnDist` do jogador);
    spawn só em coluna com suporte de `spawn.on`, 2 blocos de ar acima, sem copa
    de árvore, em chunk já gerado e entre `minDist` e `maxDist`; `populate`
    cria `initialPassive` passivos entre `initialMinDist` e `initialMaxDist`
    (completa o que falta, não duplica).
16. **Despawn:** além de `despawnDist` o mob some; além de `simRadius` fica
    congelado (não se move); de dia hostis a mais de `daylightDespawnDist` somem
    com `daylightDespawnChance` por segundo.
17. **Raycast:** devolve o mob mais próximo atingido pela AABB (`{mob, distance,
    point}`), `null` se nada estiver no caminho ou além de `maxDist`; ignora
    mortos; não atravessa o mob mais próximo.
18. **Determinismo:** duas execuções com a mesma seed/ctx produzem listas de
    eventos e estados finais idênticos.
19. **Orçamento:** 18 mobs simulando 600 quadros de 1/60 s custam em torno de
    1,5 s de CPU ou menos (o tempo medido é reportado).
20. **Separação:** corpos que se sobrepõem se afastam suavemente (zumbis que
    chegam juntos não viram um só; porcos nascidos no mesmo ponto se separam, sem
    NaN); a separação não empurra mortos nem atravessa parede.
21. **Compatibilidade:** o `main.js` atual (Parte 1) continua funcionando;
    `npm run build` passa; `mobs.js` só ganha o campo aditivo do critério acima.
