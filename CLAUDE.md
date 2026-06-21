# CLAUDE.md — Contexto do Agente

> O agente lê este arquivo SEMPRE antes de mexer no projeto.
> Regras fixas, mapa do projeto, comandos e armadilhas conhecidas.

## O que é este projeto

**Voxelcraft** — um jogo estilo Minecraft que roda no navegador (mundo de blocos /
voxels). Construído com **Spec-Driven Development (SDD)**: nada de código sem spec.

## Mapa do projeto

```
voxelcraft/
├── CLAUDE.md            ← você está aqui (contexto do agente)
├── README.md            ← porta de entrada pro humano (setup e como rodar)
├── .specs/
│   ├── constitution.md  ← princípios inegociáveis (stack, o que nunca fazer)
│   └── <feature>/       ← nasce sob demanda
│       ├── spec.md      ← O QUÊ e o PORQUÊ
│       ├── plan.md      ← O COMO (arquitetura, contratos)
│       └── tasks.md     ← passos executáveis e marcáveis
├── docs/
│   └── adr/             ← memória do projeto (decisão + porquê)
├── index.html           ← entrada da aplicação
├── package.json
├── vite.config.js
└── src/
    ├── main.js          ← bootstrap: cena, render, loop
    ├── blocks.js        ← tipos de bloco e cores
    ├── world/
    │   ├── noise.js     ← ruído determinístico (terreno)
    │   └── world.js     ← geração de blocos + malha (face culling)
    └── player/
        └── controls.js  ← câmera 1ª pessoa + WASD (pointer lock)
```

## Comandos

| Ação            | Comando            |
|-----------------|--------------------|
| Instalar deps   | `npm install`      |
| Rodar (dev)     | `npm run dev`      |
| Build produção  | `npm run build`    |
| Preview do build| `npm run preview`  |

## Regras fixas para o agente

1. **Spec antes de código.** Toda feature nova nasce como `.specs/<feature>/`
   com `spec.md` → `plan.md` → `tasks.md`, nessa ordem.
2. **Uma verdade por fato.** Documentação e código mudam no MESMO commit/PR.
3. **Respeite a `constitution.md`.** Ela vence sobre qualquer preferência.
4. **NÃO toque no `README.md` da raiz do repositório** (`../README.md`) — é o
   perfil pessoal do dono do repo. Este projeto vive em `voxelcraft/`.
5. **Decisões técnicas relevantes viram ADR** em `docs/adr/`.

## Armadilhas conhecidas

- **Performance de voxel:** nunca renderize um cubo por bloco com mesh separada.
  Use **face culling** (só desenha faces expostas) em uma única `BufferGeometry`,
  como em `src/world/world.js`. Um chunk pode ter milhares de blocos.
- **Pointer Lock exige clique:** o navegador só captura o mouse após interação do
  usuário. O jogo começa "pausado" até o clique.
- **Ruído determinístico:** o terreno usa seed fixa para ser reprodutível. Não
  troque por `Math.random()` na geração — quebra a reprodutibilidade.
