# 🔁 Loop de Desenvolvimento (SDD + modelo Karpathy)

> Como evoluímos o Voxelcraft: uma feature pequena por volta, sempre verificada.

## 🎯 Goal do loop (north star)

**Um Minecraft jogável no navegador**: explorar, **construir e destruir** um
mundo de blocos, com física básica, persistência e visual reconhecível —
publicável como página estática.

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

Legenda: ✅ feito · 🔨 em progresso · ⏳ planejado
