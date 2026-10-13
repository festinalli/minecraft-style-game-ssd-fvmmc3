# 🔁 Loop de Desenvolvimento (SDD + modelo Karpathy)

> Como evoluímos o Voxelcraft: uma feature pequena por volta, sempre verificada.

## 🎯 Goal do loop (north star)

**Um Minecraft jogável no navegador**: explorar, **construir e destruir** um
mundo de blocos, com física básica, persistência e visual reconhecível —
publicável como página estática. **(Parte 2)** E agora com **criaturas e um loop de
sobrevivência**: dia e noite, vida, combate, comida, morte e renascimento.

Cada volta do loop dá **um passo pequeno e jogável** rumo a esse goal.

## 🪜 Os passos de cada volta

1. **SPEC** — `.specs/<feature>/spec.md`: o QUÊ e o PORQUÊ + critérios de aceitação.
2. **PLAN** — `plan.md`: o COMO (arquitetura, contratos), derivado da spec.
3. **TASKS** — `tasks.md`: passos pequenos e marcáveis.
4. **CODE** — implementar na coleira curta: diff pequeno e revisável.
5. **VERIFY** — `npm run build` + teste (headless ou manual). Nada entra no escuro.
6. **COMMIT** — código + docs no mesmo commit (uma verdade por fato).
7. **ADR** — decisão técnica relevante? Vira `docs/adr/`.
8. **↻** — atualiza este roadmap e começa a próxima volta.

## 🎚️ Slider de autonomia (modelo Karpathy)

Quanto o agente corre sozinho entre pausas humanas. Definido por você:

- **Passo a passo** — para depois de cada feature pra você revisar/jogar.
- **Por milestone** — corre algumas features até um ponto jogável, então para.
- **Solto** — corre o roadmap inteiro, parando só em decisões ambíguas (ADR).

> Princípio: quanto maior a autonomia, mais rígidos os critérios de aceitação e
> a verificação automática — porque a revisão humana fica mais espaçada.

## 🗺️ Roadmap

| #   | Feature                                   | Status         |
|-----|-------------------------------------------|----------------|
| 001 | Mundo voxel + câmera 1ª pessoa            | ✅ Feito (validação manual pendente) |
| 002 | Quebrar / colocar blocos (raycast)        | ✅ Feito (validação manual pendente) |
| 003 | Gravidade, colisão e pulo                 | ✅ Feito (validação manual pendente) |
| 004 | Texturas (atlas) no lugar de cores        | ✅ Feito (validação manual pendente) |
| 005 | Salvar / carregar mundo (localStorage)    | ✅ Feito (validação manual pendente) |
| 006 | Streaming de chunks (mundo "infinito")    | ✅ Feito (validação manual pendente) |
| 007 | Hotbar / inventário                       | ✅ Feito (validação manual pendente) |
| 008 | Árvores (terreno determinístico)          | ✅ Feito |
| 009 | Dia e noite (céu, sol, lua, estrelas)     | ✅ Feito |
| 010 | Física de entidades (jogador = mobs)      | ✅ Feito |
| 011 | Personagens: porco, ovelha, zumbi, creeper, avatar | ✅ Feito |
| 012 | Vida, inventário e modos (Sobrevivência/Criativo)  | ✅ Feito |
| 013 | Criaturas vivas: IA, spawn, explosão      | ✅ Feito |
| 014 | Combate, drops e comida                   | ✅ Feito |
| 015 | HUD, menu, tela de morte e sons           | ✅ Feito |
| 016 | Terceira pessoa e mão                     | ✅ Feito |
| 017 | Pathfinding local (zumbi contorna muros)  | ✅ Feito |
| 018 | Feedback visual de quebra e combate       | ✅ Feito (validação no navegador pendente) |
| 019 | Balanceamento por simulação               | ✅ Feito |

Legenda: ✅ feito · 🔨 em progresso · ⏳ planejado

### Pendente de validação humana

- **Sons** (feature 015): sintetizados e medidos offline, mas ninguém os ouviu ainda.
- **Sensação de jogo**: balanceamento (dano do zumbi/creeper, cooldown do golpe, cura da carne)
  foi ajustado por playtest automatizado; vale uma partida de verdade.
- **Pointer lock** real: o navegador de ferramentas não o suporta; o fluxo foi exercitado com
  `window.__vc.fakeLock()`.

### Como a Parte 2 foi feita

O prompt está em [`docs/prompts/parte-2-criaturas.md`](./docs/prompts/parte-2-criaturas.md).
Cada feature teve spec → plan → tasks antes do código, testes headless (`npm test`) e
playtest no navegador (o navegador de ferramentas não faz pointer lock; use
`window.__vc.fakeLock()` em `npm run dev`).

### Próximo (Parte 4, ideias)

Crafting e ferramentas, água e cavernas, mais espécies, pathfinding 3D, cama/baú.
