# 🟩 Voxelcraft

Um jogo estilo **Minecraft** (mundo de blocos / voxels) que roda no navegador.
Construído com **Spec-Driven Development (SDD)** — toda feature nasce de uma spec.

> **Parte 2 — Criaturas:** agora o mundo tem **personagens** (porco, ovelha, zumbi,
> creeper e o seu avatar), **vida e dano**, **dia e noite**, **combate**, **comida**,
> **morte e renascimento** — um survival jogável. O modo **Criativo** preserva o
> sandbox da Parte 1.

## ✨ O que já tem

### Parte 1 — O mundo

**Feature 001 — Mundo + câmera**
- Terreno voxel **procedural e determinístico** (mesma seed ⇒ mesmo mundo).
- Tipos de bloco por cor: grama, terra, pedra (e areia nas partes baixas).
- Câmera em **primeira pessoa** e **voo livre** (Criativo).
- Render otimizado por **face culling** (só desenha faces expostas).

**Feature 002 — Quebrar / colocar blocos** · raycast com realce do bloco apontado.
**Feature 003 — Física** · gravidade, colisão e pulo.
**Feature 004 — Texturas** · atlas procedural em runtime, visual pixelado.
**Feature 005 — Salvar / carregar** · `localStorage`, só chunks modificados.
**Feature 006 — Mundo infinito** · chunks gerados sob demanda, descarregados ao longe.
**Feature 007 — Hotbar** · 8 blocos, seleção por teclas e roda do mouse.

### Parte 2 — Criaturas

**Feature 008 — Árvores** · geradas de forma determinística por uma grade de células;
copas cruzam as bordas de chunk sem cortes; nunca no spawn nem na água.

**Feature 009 — Dia e noite** · ciclo de 6 minutos (`DAY_LENGTH`): amanhecer, pôr do sol,
noite com lua e estrelas. Relógio no HUD ("Dia N · Noite").

**Feature 010 — Física de entidades** · corpo AABB genérico; **o jogador e as criaturas
usam o mesmo código** de colisão e gravidade. As criaturas sobem degraus de 1 bloco
sozinhas (o jogador pula com `Espaço`); knockback e distância de queda para todos.

**Feature 011 — Personagens** · porco, ovelha (4 cores), zumbi, creeper e o **avatar**,
montados de caixas com **skins procedurais** (sem arquivos de imagem), com animações de
andar, ferido, inchar, queimar, golpear e morrer.

**Feature 012 — Vida, inventário e modos** · 10 corações, regeneração, dano de queda,
inventário com quantidades, kit inicial; **Sobrevivência** e **Criativo**; save
compatível com a Parte 1.

**Feature 013 — Criaturas vivas** · animais vagueiam e fogem ao apanhar; **zumbis**
nascem à noite, perseguem e batem (e **queimam ao sol**); **creepers** inflam e
explodem abrindo **crateras**; população cresce com os dias.

**Feature 014 — Combate, drops e comida** · golpe com a espada (ou punho), sem acertar
através de parede; blocos quebrados e carne vão pro inventário; carne cura; não dá pra se
prender dentro de um bloco recém-colocado.

**Feature 015 — HUD e sons** · corações, hotbar de 10 slots com contagens, relógio,
flash de dano, tela de morte, menu com os dois modos; sons sintetizados em tempo real.

**Feature 016 — Terceira pessoa e mão** · `V` alterna a câmera e mostra o seu avatar;
em 1ª pessoa o item balança na mão e faz um arco ao golpear.

## 🎮 Controles

| Ação                     | Tecla                         |
|--------------------------|-------------------------------|
| Olhar                    | Mouse                         |
| Mover                    | `W` `A` `S` `D`               |
| Pular                    | `Espaço`                      |
| Correr                   | `Ctrl` ou `Shift` (no chão)   |
| Golpear / quebrar bloco  | Botão esquerdo                |
| Colocar bloco / comer    | Botão direito                 |
| Escolher item            | `1`–`9`, `0` ou roda do mouse |
| Câmera 1ª / 3ª pessoa    | `V`                           |
| Voo (**só Criativo**)    | `F`; sobe/desce `Espaço` / `Shift` |
| Som ligado / desligado   | `M`                           |
| Pausar                   | `Esc`                         |

Hotbar: `1`–`8` blocos (grama, terra, pedra, areia, madeira, folhas, tábuas, pedregulho),
`9` espada, `0` carne. Clique em **Sobrevivência** ou **Criativo** para começar.

## 🧭 Como sobreviver

1. De dia, bata em porcos e ovelhas com a espada (`9`) e junte **carne**; quebre blocos
   para coletar material. Coma com o botão direito (`0`) para curar 3 corações.
2. Ao anoitecer aparecem **zumbis** e **creepers**. Fuja (você corre mais que eles),
   lute ou **construa um abrigo** — zumbis não atravessam paredes e queimam no sol.
3. Creepers explodem: afaste-se quando começarem a inchar e piscar.
4. Morreu? **Renascer** — se for noite, o relógio pula para a manhã do dia seguinte. O
   save guarda vida, inventário, hora do dia e abates.

## 🚀 Como rodar

```bash
npm install
npm run dev      # abre em http://localhost:5173
npm test         # testes headless (lógica, IA, física, save, loop jogável)
```

Build estático (publicável no GitHub Pages):

```bash
npm run build    # gera dist/
npm run preview  # serve o build localmente
```

Galerias de desenvolvimento (com `npm run dev`): `/dev/mobs.html` e `/dev/hud.html`.

## 🧱 Stack

JavaScript (ES Modules) · [Three.js](https://threejs.org/) · [Vite](https://vitejs.dev/).
Three.js é a única dependência de runtime. Testes com `node:test` (embutido no Node).
Veja `.specs/constitution.md`.

## 🗂️ Estrutura (Spec-Driven Development)

```
├── CLAUDE.md            # contexto do agente (lido sempre) + mapa de pastas
├── README.md            # você está aqui
├── LOOP.md              # loop de desenvolvimento (SDD + modelo Karpathy) + roadmap
├── .specs/              # constitution + 001…016 (spec · plan · tasks por feature)
├── docs/adr/            # decisões arquiteturais (0001–0015)
├── docs/prompts/        # prompt da Parte 2 (reutilizável)
├── tests/               # testes headless
├── dev/                 # galerias de desenvolvimento
└── src/                 # game/ entities/ player/ ui/ world/ + main.js
```

### Como nasce uma feature nova
1. Cria `.specs/<feature>/spec.md` (intenção + critérios de aceitação).
2. Deriva `plan.md` (arquitetura, contratos).
3. Quebra em `tasks.md` (passos pequenos e verificáveis).
4. Implementa, marcando tasks no **mesmo commit**, com teste headless da lógica.
   Decisão relevante? Vira ADR.

## 🛣️ Próximas features (Parte 3 — ideias)
- Crafting e ferramentas com durabilidade.
- Água, cavernas (ruído 3D) e minérios.
- Pathfinding nas criaturas e mais espécies (esqueleto com arco).
- Cama (definir ponto de renascimento) e baú.

> Roadmap e status atual em [`LOOP.md`](./LOOP.md).
