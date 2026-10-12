# Plan 013 — Mobs: IA, spawn e despawn

> O COMO. Derivado da spec 013.

## Módulos

### `src/entities/ai.js` — PURO (sem Three.js, sem mundo, sem `Math.random`)
- `AI`: constantes de **feitio** da IA (histerese de aggro, fração em que o zumbi
  para, tempo de desencalhar, intervalo de vozes). Não são balanceamento de
  combate — esse mora em `mobs.js`.
- `initMob(mob, def, rng)`: campos de IA do mob (`state`, `stateT`, `wish`,
  `face`, `speed`, `wantJump`, `heading`, `voiceT`, `attackCd`, `attackT`,
  `fuse`, `blockedT`, `lateralT`, `hurtBy`) com a fase inicial **sorteada** — os
  mobs de um grupo não começam sincronizados.
- `think(mob, def, ctx, rng, dt)`: despacha por `def.behavior`.
  - `PASSIVE`: `idle → wander → idle …`; `hurtBy` ⇒ `flee`.
  - `MELEE`: alvo = jogador vivo fora do Criativo; `chase` (com histerese de
    aggro) / `attack` (parado e batendo); sem alvo, passeia como passivo.
  - `CREEPER`: `chase` até `fuseStartDist`; `fuse` (infla, parado); `explode`
    quando `fuse` chega a 1; `chase` de novo (fuse decaindo) além de
    `fuseAbortDist`.
  - Em todo `wander`/`chase`/`flee` o desencalhar usa `mob.blockedT`
    (mantido pelo gerenciador) e, em caso de bloqueio, escolhe um novo rumo ou
    anda de lado.
- Efeitos além do próprio `mob`: só `ctx.events.push(...)` (`hurt-player` do
  zumbi, `sound` de voz/hiss). Sem `ctx.events`, nada é emitido.
- Linha de visão **injetada**: `ctx.los` (opcional) é consultada só quando o
  zumbi está no alcance geométrico; a IA continua sem conhecer o mundo.
- Distâncias: borda a borda e horizontal para o ataque do zumbi; 3D entre
  centros (pés + altura/2) para aggro e fuse — a mesma medida da explosão.

### `src/entities/manager.js`
- Estado: `Map id → Mob`; `Mob` = corpo (`createBody`) + `yaw`, `hp`, `variant`,
  `state`, `hurtT`, `attackCd`, `attackT`, `fuse`, `dying`, `dead`, `burning`,
  `hurtBy`, knockback (`kx/kz`), `view` e os campos da IA.
- `update(dt, ctx)` (dt limitado a 0,1 s), em ordem:
  1. spawn: `tryInterval` acumulado; hostis (Sobrevivência + noite + vivo) e
     passivos, cada um com seu teto;
  2. para cada mob: **despawn** (> `despawnDist`), **congelado** (> `simRadius`),
     senão **simula**: temporizadores → queima → `think` → explosão? → `wish`
     vira velocidade (+ knockback exponencial como o do jogador) → pulo
     automático (`canStepUp` só quando bateu no quadro anterior, `wantJump`
     quando preso) → `stepBody` → `blockedT` pelo deslocamento real → yaw (giro
     limitado por `turnRate`) → View. Antes de simular, um passo de
     **separação** O(n²) afasta corpos sobrepostos (velocidade extra, lida do
     início do quadro: independe da ordem);
  3. mortos: `dying` 0→1 em `corpseTime`, depois removidos;
  4. devolve os eventos (array novo só quando há; senão o vazio congelado).
- Spawn de coluna: chunk **já gerado** (`world.chunks`), `surfaceY`, suporte em
  `spawn.on`, ar acima, corpo cabendo (`collidesBox`), distância ao jogador no
  intervalo; grupos espalhados num raio de ~2,5 blocos; `populate` não exige
  chunk gerado (é a carga inicial) e **completa** até `initialPassive`.
- Queima: coluna do mob via `world.surfaceY`; exposto ⇔ nenhum sólido na altura
  da cabeça ou acima; reavaliado a cada 0,25 s por mob.
- Linha de visão (`lineClear`): amostras a cada 0,2 bloco entre o peito do mob e o
  peito do jogador; qualquer bloco sólido no caminho bloqueia.
- Explosão: esfera de células por centro (`carveRadius`), `world.setBlock(AIR)`,
  evento `explosion` (`radius = blastRadius`), dano ao jogador pela distância ao
  centro do corpo, dano e knockback aos outros mobs, `mob-died` do creeper.
- `damage(mob, amount, {fromX, fromZ, knock})`: dano sempre vale; knockback e
  flash só se `hurtT === 0` (imunidade de `hurtTime`); morte sorteia drops com o
  rng; eventos de som/morte entram numa fila entregue pelo próximo `update`.
- `raycast`: slab test contra a AABB exata de cada mob vivo.
- Views (com `scene`): `view.object.position/rotation.y` e
  `view.update(dt, {speed, hurt, fuse, burning, attack, dying})` com um objeto
  reutilizado (zero alocação por quadro).

## Decisões técnicas
- **IA decide, gerenciador move** (ADR 0012): `think` não conhece o mundo, o que
  o torna testável sem mundo; o que depende do mundo (bloqueio, degrau, céu)
  chega pelo `mob` (`blockedT`) ou é feito pelo gerenciador.
- **Eventos pela fila do `ctx`**, não por retorno: `think` devolve `void` (brief)
  e pode emitir 0..n eventos.
- **Aleatoriedade:** nenhum `Math.random`; todo sorteio (fase inicial,
  durações, rumo, sinal da lateral, posição de spawn, drops, despawn diurno)
  passa pelo `rng` na mesma ordem em qualquer execução.
- **Tetos são limites duros sobre quem existe de verdade** (até `despawnDist`):
  hostis ≤ `min(hostileCapMax, hostileCapBase + dia)` e passivos ≤ `passiveCap`
  contando também os congelados entre `simRadius` e `despawnDist`. (O comentário
  de `passiveCap` em `mobs.js` fala em "raio simRadius"; contar só aquele raio
  deixaria passar do teto — registrado como desvio no ADR 0012.)
- **`attackT` conta de 1 a 0**: a View usa `sin(π·attack)`, simétrica, então a
  animação sai igual contando para baixo e o `think` basta um `= 1`.
- **Sem pathfinding:** o brief pede linha reta + desencalhar. Registrado como
  limite conhecido (ADR 0012).

## Validação (mapeia critérios)
- `tests/ai.test.js`: critérios 1–7 (mobs montados à mão, sem mundo).
- `tests/manager.test.js`: critérios 8–19 com mundo plano artificial e o mundo
  real da seed 1337; varredura de fontes; determinismo; orçamento de CPU.
- Manual (integrador): ver porcos andando, apanhar de zumbi, escapar de
  creeper, ver o buraco.
