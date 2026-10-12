# Prompt — Voxelcraft Parte 2: Criaturas + sobrevivência jogável

> Prompt reutilizável para qualquer agente de código (Claude Code, Codex, etc.).
> Cole o bloco "Prompt curto" e deixe o agente ler o resto deste arquivo.

## Prompt curto (copiar e colar)

```text
Você é um agente de desenvolvimento no projeto Voxelcraft (JavaScript + Three.js
+ Vite, Spec-Driven Development). A Parte 1 entregou um sandbox de blocos sem
personagens, sem vida e sem objetivo. Implemente a PARTE 2 — "Criaturas":
coloque personagens no mundo (porco, ovelha, zumbi, creeper e o avatar do
jogador) e transforme o jogo num survival jogável: vida, dano, ciclo dia/noite,
combate, drops, comida, morte e respawn, com HUD e sons.

Leia CLAUDE.md, .specs/constitution.md e docs/prompts/parte-2-criaturas.md e
siga à risca: spec antes de código (.specs/008 → 016), números só em
src/entities/mobs.js e src/game/items.js, lógica pura testável com `npm test`,
`npm run build` verde, e um playtest real no navegador antes de dizer "pronto".
Não toque no README da raiz do repositório de perfil nem adicione dependências.
```

## 1. Objetivo e "jogável" quer dizer…

Uma pessoa abre a página, clica em **Sobrevivência** e consegue, sem instrução
nenhuma, viver este loop:

1. Dia: explora, vê **porcos e ovelhas** andando, bate neles com a espada e
   ganha **carne**; quebra árvores e blocos e **coleta** o que quebrou.
2. Entardece: o céu escurece (sol → lua, estrelas). Aparecem **zumbis** e
   **creepers** perto do jogador.
3. Perde vida (corações), foge, luta ou **se abriga** construindo — zumbis
   queimam no sol e param de nascer de dia; um creeper explode e **abre um
   buraco** no terreno.
4. Come carne para curar. Se a vida zera: tela **"Você morreu"** com dias
   sobrevividos e abates; **Renascer** volta ao ponto inicial.
5. O **Modo Criativo** preserva a Parte 1 (blocos infinitos, voo, sem dano,
   sem hostis).

Critério-mãe: **nenhuma tela morta**. Todo estado (morreu, pausado, criativo)
tem saída clara, e `npm run build` + `npm test` passam.

## 2. Regras do projeto que NÃO podem quebrar

- SDD: para cada feature 008–016, `.specs/NNN-nome/{spec,plan,tasks}.md`
  **antes** do código; tasks marcadas no mesmo commit.
- Constitution: Three.js é a única dependência de runtime; nada de mesh por
  voxel; nada de `Math.random()` — aleatoriedade vem de `rng` injetado
  (`src/rng.js`); uma verdade por fato (números em `mobs.js`/`items.js`).
- Saves da Parte 1 (`voxelcraft.save.v2`) **continuam carregando**; o estado novo
  entra em campo opcional `game` do mesmo JSON.
- Sem arquivos de imagem/áudio no repo: skins, atlas e sons são procedurais.
- Lógica pura (física, IA, spawn, stats, inventário, tempo, árvores,
  serialização) tem teste headless em `tests/*.test.js` (`node:test`, sem
  dependência nova). Módulos que usam Three.js mas não DOM rodam no Node.
- Hot path: zero alocação por frame em loops de mob/colisão quando evitável;
  no máximo ~18 mobs vivos ao mesmo tempo; 60 FPS num notebook comum.

## 3. Features (ordem e critérios de aceitação resumidos)

| #   | Feature | Aceita quando… |
|-----|---------|----------------|
| 008 | **Árvores** (terreno determinístico) | tronco+copa aparecem; mesma seed ⇒ mesmas árvores; copas cruzam bordas de chunk sem corte; nenhuma árvore na água/areia; save antigo carrega |
| 009 | **Dia e noite** | ciclo de `DAY_LENGTH` s; céu/neblina/luzes interpolam; sol e lua visíveis; estrelas à noite; `isNight`/`dayNumber` puros |
| 010 | **Física de entidades** | `collidesBox`/`stepBody` genéricos; jogador usa o mesmo código; pulo automático de 1 bloco; queda mede distância; knockback do jogador |
| 011 | **Modelos de criaturas** | porco, ovelha (4 cores), zumbi, creeper e avatar do jogador; skins procedurais; animação de andar, ferido, inchar, queimar, morrer; galeria `dev/mobs.html` |
| 012 | **Vida, inventário e modos** | `stats`, `inventory`, `mode`; dano de queda; regeneração; save/load estendido |
| 013 | **Mobs: IA, spawn, despawn** | passivos vagueiam/fogem; zumbi persegue e bate; creeper incha e explode; população por dia/noite com tetos; headless determinístico |
| 014 | **Combate, drops e comida** | clique esquerdo golpeia mob na mira (sem atravessar parede) ou quebra bloco; drops entram no inventário; carne cura; espada = slot 9 |
| 015 | **HUD e sons** | corações, hotbar de 10 slots com contagem, relógio/dia, flash de dano, tela de morte, menu com modos; sons sintetizados |
| 016 | **Terceira pessoa e mão** | `V` alterna 1ª/3ª pessoa mostrando o avatar; mão/espada em 1ª pessoa balança ao golpear/colocar |

## 4. Contratos entre módulos

Convenções: Y para cima; `pos` de mob e de `ctx.player` = **centro dos pés**;
tempo em segundos; HP inteiro (1 coração = 2 HP; jogador 20 HP).

### 4.1 Dados (já existem — não duplicar)

- `src/entities/mobs.js`: `MOB_DEFS`, `MOB_KINDS`, `BEHAVIOR`, `SPAWN`.
- `src/game/items.js`: `ITEM`, `HOTBAR_SLOTS` (10), `DAMAGE`, `FOOD`,
  `MELEE_REACH`, `STARTER_KIT`, `MAX_STACK`, `blockDrop`.
- `src/rng.js`: `mulberry32`, `makeRng(seed)` → `{next,int,range,chance,pick,angle}`.

### 4.2 Mundo (008, 009)

```js
// src/world/terrain.js — PURO. Consts movidas de world.js (que as re-exporta).
export const CHUNK_SIZE, WORLD_HEIGHT, BASE_HEIGHT, WATER_LEVEL;
export function terrainHeight(noise, wx, wz): number;      // altura da coluna
export function chunkIndex(lx, y, lz): number;             // layout do Uint8Array
export function treesForChunk(seed, cx, cz): Array<{x,z,groundY,trunk}>;
export function decorateTrees(data, seed, cx, cz, noise): void; // escreve WOOD/LEAVES
// world.js: generateChunk(seed,cx,cz) mantém a assinatura e passa a chamar decorateTrees.

// src/game/time.js — PURO
export const DAY_LENGTH, START_SECONDS;
export function phaseOf(seconds): number;     // [0,1): 0 amanhecer, .25 meio-dia, .5 pôr do sol, .75 meia-noite
export function dayNumber(seconds): number;   // 1, 2, 3…
export function isNight(seconds): boolean;
export function skyState(seconds): {
  skyColor:{r,g,b}, fogColor:{r,g,b}, sunDir:{x,y,z}, moonDir:{x,y,z},
  sunIntensity, hemiIntensity, ambientIntensity, nightFactor /*0..1*/, starAlpha /*0..1*/ };

// src/game/sky.js — THREE sem DOM
export function createSky(scene, { sun, hemi, ambient }): { update(seconds, cameraPos), dispose() };
```

### 4.3 Física e controles (010)

```js
// src/entities/physics.js — PURO (usa world.getBlock)
export const GRAVITY = 28;
export function collidesBox(world, x, feetY, z, halfW, height): boolean;
export function createBody({x,y,z,halfW,height}): Body;    // {pos,vel,halfW,height,onGround}
export function stepBody(world, body, dt, opts?): { hitX, hitZ, landed, impactVy };
export function canStepUp(world, body, dirX, dirZ): boolean; // degrau de 1 bloco livre

// src/player/collision.js: collidesAABB(world,x,y,z) segue existindo (olho→pés) e delega a collidesBox.
// src/player/controls.js
createControls(camera, domElement, world, { onLand(fallDistance) }?) → {
  controls, update(dt),
  knock(dirX, dirZ, strength, up),   // impulso horizontal que decai + vertical
  setFlyAllowed(bool),               // false em Sobrevivência (F não faz nada, sai do voo)
  isFlying(), isOnGround(), teleport(x, y, z) /* olho */, resetFall() }
```

### 4.4 Modelos (011) — Three.js, **sem DOM** (skin em `DataTexture`)

```js
// src/entities/model.js
export function skinPixels(kind, variant): { width, height, data: Uint8Array /*RGBA*/ };
export function createMobView(kind, { variant = 0 } = {}): View;
export function createAvatarView(): View;
// View = { object: THREE.Group, update(dt, s), dispose() }
// s = { speed /*b/s horizontal*/, hurt /*0..1*/, fuse /*0..1*/, burning /*bool*/,
//       attack /*0..1*/, dying /*0..1*/, sprinting? , holding? }
// `object` tem a origem nos PÉS; escala visual ≈ hitbox de MOB_DEFS[kind].
// Orientação (convenção ÚNICA, vale para modelo, IA e câmera 3ª pessoa):
//   a FRENTE do modelo é +Z local; yaw = atan2(dirX, dirZ); o caller faz
//   view.object.rotation.y = yaw e view.object.position.set(pos.x, pos.y, pos.z).
//   Para a câmera do jogador (PointerLockControls), yaw do avatar = yaw da câmera + π
//   (a câmera olha para -Z local).
```

### 4.5 Jogador (012)

```js
// src/game/stats.js — PURO
export const MAX_HP = 20;
export function fallDamage(distance): number;   // 0 até 3 blocos; depois ceil(d - 3)
export function createStats({ mode = 'survival' }?) → {
  hp, maxHp, mode, dead, kills, sinceDamage, invuln,
  damage(amount, {source}?) → { applied, died },   // respeita invuln e Criativo
  heal(amount) → number, update(dt) /*regen: +1 HP a cada 4 s, 8 s após dano*/,
  addKill(), respawn(), setMode(m), toJSON(), fromJSON(o) }

// src/game/inventory.js — PURO
createInventory({ mode }) → {
  selected, select(i), cycle(dir), setMode(m), slot(i) /* de HOTBAR_SLOTS */,
  count(i) → number | Infinity,        // Criativo: Infinity p/ blocos; espada: Infinity
  getSelected() → { index, kind, block?, item?, count },
  addBlock(id, n=1), addItem(id, n=1), // respeitam MAX_STACK
  consumeSelected() → boolean,         // gasta 1 bloco/carne; Criativo nunca gasta
  giveStarterKit(), toJSON(), fromJSON(o) }

// src/world/persistence.js (compatível com v2)
serializeChunks(entries, seed, player, game?)   // game é opcional
deserializeChunks(str) → { seed, player, chunks, game }   // game = null em saves antigos
saveWorld(world, player, game?)
```

### 4.6 Mobs (013)

```js
// src/entities/ai.js — PURO (decide intenção; não move)
export function think(mob, def, ctx, rng, dt): void
//   escreve mob.wish = {x,z} (direção unitária ou 0), mob.speed, mob.wantJump, mob.state
// src/entities/manager.js
createMobManager({ world, rng, scene = null, makeView = createMobView }) → {
  mobs /* Map id→Mob */, count(kind?), spawn(kind, x, y, z, { variant }?) → Mob,
  update(dt, ctx) → Event[],      // ctx = { player:{pos,alive,mode}, seconds }
  raycast(origin, dir, maxDist) → { mob, distance, point } | null,
  damage(mob, amount, { fromX, fromZ, knock }?) → { killed, drops:[{item,count}] },
  populate(playerPos, seconds), clear(), clearHostiles(), dispose() }
// Mob = { id, kind, def, body, yaw, hp, variant, state, hurtT, attackCd, fuse, dying, … }
// Events:
//  { type:'hurt-player', amount, source /*kind*/, fromX, fromZ, knock, knockUp }
//  { type:'explosion', x, y, z, radius, blocks:[{x,y,z}] /* já viraram AIR */ }
//  { type:'sound', name, x, y, z }
//  { type:'mob-died', mob, drops, byPlayer }
// Sem `scene` o gerenciador roda headless (sem View) — é assim que os testes funcionam.
```

### 4.7 HUD e som (015)

```js
// src/ui/hud.js
createHud() → {
  setHealth(hp, maxHp), setHotbar(slots, selectedIndex),   // slots: [{label, color?, item?, count|null}]
  setClock({ day, phaseName /*'Amanhecer'|'Dia'|'Entardecer'|'Noite'*/, night }),
  flashDamage(), toast(text, ms=1800), setInGame(bool),
  showDeath({ days, kills }), hideDeath(),
  bindMenu({ onStart(mode), onNewWorld(), onRespawn() }) }
// src/audio.js — WebAudio procedural; no-op no Node/sem AudioContext
createAudio() → { resume(), play(name, { volume, pitch }?), setMuted(b) }
// nomes: hit hurt break place eat pig sheep zombie hiss explode death step
```

## 5. Definição de pronto

1. `npm run build` e `npm test` sem erro.
2. Playtest no navegador (dev server) cobrindo o loop da §1: ver porco, golpear,
   coletar carne, comer, anoitecer, zumbi atacar, morrer, renascer, creeper
   explodir, alternar Criativo, recarregar e ver o save restaurado.
3. README/LOOP/CLAUDE.md/constitution atualizados no mesmo commit (controles,
   mapa de pastas, roadmap 008–016, ADRs 0007+).

## 6. O que NÃO fazer

- Não criar crafting, água, cavernas ou multiplayer (ficam para a Parte 3).
- Não persistir mobs; eles repopulam.
- Não deixar `console.log` de debug nem hooks de teste em produção
  (`import.meta.env.DEV` apenas).
