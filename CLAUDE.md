# CLAUDE.md — Contexto do Agente

> O agente lê este arquivo SEMPRE antes de mexer no projeto.
> Regras fixas, mapa do projeto, comandos e armadilhas conhecidas.

## O que é este projeto

**Voxelcraft** — um jogo estilo Minecraft que roda no navegador (mundo de blocos /
voxels). Construído com **Spec-Driven Development (SDD)**: nada de código sem spec.

- **Parte 1 (001–007):** sandbox de blocos — mundo infinito, física, edição, atlas, save.
- **Parte 2 (008–016) — "Criaturas":** árvores, dia/noite, personagens (porco, ovelha,
  zumbi, creeper, avatar do jogador), vida, combate, comida, morte/renascer, HUD, sons.
  O prompt que gerou a Parte 2 está em `docs/prompts/parte-2-criaturas.md`.

## Mapa do projeto

```
├── CLAUDE.md            ← você está aqui (contexto do agente)
├── README.md            ← porta de entrada pro humano (setup e como rodar)
├── LOOP.md              ← loop de desenvolvimento + roadmap
├── .specs/
│   ├── constitution.md  ← princípios inegociáveis (stack, o que nunca fazer)
│   └── NNN-feature/     ← spec.md (O QUÊ) · plan.md (O COMO) · tasks.md
├── docs/adr/            ← memória do projeto (decisão + porquê), 0001–0015
├── docs/prompts/        ← prompts/briefs reutilizáveis (Parte 2)
├── index.html           ← entrada: menu, HUD, tela de morte (HTML + CSS)
├── dev/                 ← galerias de desenvolvimento (mobs.html, hud.html) — fora do build
├── tests/               ← testes headless (node:test): `npm test`
└── src/
    ├── main.js          ← bootstrap: renderer, câmeras, loop, eventos → HUD/som/jogador
    ├── rng.js           ← RNG semeado (mulberry32) — único gerador de aleatoriedade
    ├── blocks.js        ← tipos de bloco e cores
    ├── audio.js         ← sons sintetizados (WebAudio), sem arquivos
    ├── game/
    │   ├── game.js      ← REGRAS (sem DOM): tempo, vida, inventário, golpe, comer → eventos
    │   ├── items.js     ← itens, hotbar de 10 slots, dano/comida/combate (números únicos)
    │   ├── stats.js     ← vida, dano, regeneração, queda, morte, modos
    │   ├── inventory.js ← contagens por slot, kit inicial, Criativo (infinito)
    │   ├── time.js      ← ciclo dia/noite (função pura do tempo)
    │   └── sky.js       ← céu, sol, lua, estrelas, luzes (Three.js sem DOM)
    ├── entities/
    │   ├── mobs.js      ← FONTE ÚNICA de hitbox, vida, velocidades e spawn das criaturas
    │   ├── physics.js   ← corpo AABB genérico (jogador e mobs usam o mesmo código)
    │   ├── ai.js        ← máquina de estados (passivo / zumbi / creeper)
    │   ├── pathfinding.js ← caminho local em grade 2D: busca em largura pura (ADR 0016)
    │   ├── manager.js   ← spawn, update, raycast, dano, explosão (headless sem `scene`)
    │   ├── model.js     ← modelos de caixas + animações (Three.js sem DOM)
    │   └── skins.js     ← skins procedurais em pixels RGBA
    ├── player/
    │   ├── controls.js  ← câmera 1ª pessoa + WASD (pointer lock) sobre physics.js
    │   ├── collision.js ← dimensões do jogador; delega a physics.collidesBox
    │   ├── editing.js   ← raycast, realce, quebrar/colocar (geometria; regras vão ao host)
    │   └── hand.js      ← item na mão (1ª pessoa)
    ├── fx/particles.js  ← partículas de quebra e golpe em pool fixo de 96 (ADR 0017)
    ├── balance/         ← faixas-alvo e cenários da simulação de balanceamento (ADR 0018)
    ├── ui/hud.js        ← corações, hotbar, relógio, toasts, menu, tela de morte
    └── world/
        ├── noise.js · terrain.js · world.js · streamer.js · atlas.js · persistence.js
```

## Comandos

| Ação            | Comando            |
|-----------------|--------------------|
| Instalar deps   | `npm install`      |
| Rodar (dev)     | `npm run dev`      |
| Testes headless | `npm test`         |
| Balanceamento   | `npm run balance`  |
| Build produção  | `npm run build`    |
| Preview do build| `npm run preview`  |

Galerias de desenvolvimento (com `npm run dev`): `/dev/mobs.html` (criaturas e estados),
`/dev/hud.html` (HUD). No jogo, `window.__vc` (só em `import.meta.env.DEV`) dá acesso a
`game`, `world`, `camera`… para playtest; ele **não existe no build de produção**.

## Regras fixas para o agente

1. **Spec antes de código.** Toda feature nova nasce como `.specs/<feature>/`
   com `spec.md` → `plan.md` → `tasks.md`, nessa ordem.
2. **Uma verdade por fato.** Documentação e código mudam no MESMO commit/PR.
   Balanceamento: criaturas em `entities/mobs.js`; itens, dano e comida em `game/items.js`;
   vida do jogador em `game/stats.js` (`HEALTH`); constantes de feitio da IA em `entities/ai.js`.
3. **Respeite a `constitution.md`.** Ela vence sobre qualquer preferência.
4. **Este repositório é só o jogo:** o `README.md` da raiz é o README do projeto. (Quando o
   projeto vivia dentro de um repositório de perfil, aquele README não podia ser tocado.)
5. **Decisões técnicas relevantes viram ADR** em `docs/adr/`.
6. **Lógica nova tem teste headless** em `tests/` (`npm test` precisa passar).
7. **Aleatoriedade só via `rng` injetado** (`src/rng.js`) — nunca `Math.random()`.

## Armadilhas conhecidas

- **Performance de voxel:** nunca renderize um cubo por bloco com mesh separada.
  Use **face culling** (só desenha faces expostas) em uma única `BufferGeometry`,
  como em `src/world/world.js`. Um chunk pode ter milhares de blocos.
- **Pointer Lock exige clique:** o navegador só captura o mouse após interação do
  usuário. O jogo começa "pausado" até o clique (menu). O navegador embutido de
  ferramentas de IA recusa pointer lock — use `window.__vc.fakeLock()` nos playtests.
- **Ruído determinístico:** o terreno usa seed fixa para ser reprodutível. Não
  troque por `Math.random()` na geração — quebra a reprodutibilidade.
- **Posição de mob e de `ctx.player.pos` = centro dos PÉS** (a câmera do jogador é o
  OLHO, `PLAYER.eye` acima). Orientação: frente do modelo = +Z, `yaw = atan2(dx, dz)`;
  a câmera olha para −Z, então o avatar usa `yaw da câmera + π`.
- **`world.surfaceY` inclui copas de árvore** (folha é sólida): não use como "chão" em
  coluna arbitrária; cheque o bloco abaixo (`SPAWN.on`).
- **Saves da Parte 1** (`voxelcraft.save.v2`) continuam carregando; o estado novo vive no
  campo opcional `game`. Chunks editados na Parte 1 não ganham árvores (ADR 0007).
- **Exceções no gameplay:** `main.js` captura o erro do `game.update` (loga uma vez) para o
  render não congelar; não esconda erros reais por causa disso.
