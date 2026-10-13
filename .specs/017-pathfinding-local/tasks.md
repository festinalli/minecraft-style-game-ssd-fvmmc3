# Tasks 017 — Pathfinding local

- [x] T1 — `pathfinding.js`: `findPath` puro (BFS, janela, limite de nós, desce até 2, sobe 1). Também exporta `searchPath`, que devolve `visited` para medir o teto.
- [x] T2 — `tests/pathfinding.test.js`: muro em U (com e sem abertura), ilha, determinismo, teto de nós, altura do corpo, coluna da queda, degrau de 1 e de 2, queda de 2 e de 3, propriedades em 60 mapas semeados (17 testes).
- [x] T3 — `ai.js`: `mob.path`, `pathT`, `pathGX`, `pathGZ` (em `initMob`); zumbi e creeper miram no waypoint de `ctx.nextStep`; passivos inalterados.
- [x] T4 — `manager.js`: `ctx.nextStep` com `free`/`ground` sobre `world.getBlock` e `collidesBox`; pés de outros mobs bloqueiam; replaneja a cada 0,5 s com orçamento de 2 planos por quadro (escalonamento).
- [x] T5 — Integração (`tests/manager.test.js`, 8 testes novos): U em 3 seeds chega em 2,92 s; ilha; alvo a 9 blocos; desvio de porco; creeper; passivos.
- [x] T6 — Custo (critério 5), medido com `t.diagnostic` em `tests/pathfinding.test.js`: `findPath` ≈ 0,08 ms por busca em campo e no pior caso (janela inteira), limite 0,3 ms. Ponta a ponta no gerenciador (15 mobs, 1200 quadros): média 0,06 ms por quadro, p99 0,5 ms.

## Critérios de aceitação (spec)

1. OK — zumbi atrás de muro em U de 3 blocos chega ao jogador em 2,92 s (jogador a 6 blocos) e em 5,65 s (a 9). Antes: nunca.
2. OK — ilha: o zumbi nunca entra em bloco nem na célula do jogador, e não bate pela cerca.
3. OK — nenhum caminho passa por bloco sólido nem pelos pés de outro mob.
4. OK — mesma seed e mesma sequência de ctx ⇒ mesmos caminhos.
5. OK — no máximo 700 células descobertas; média de `findPath` abaixo de 0,3 ms.
6. OK — `npm test` (511 testes) e `npm run build`.

## Limites conhecidos

- A janela (25 × 25) é centrada no ponto médio entre o mob e o alvo. Alvo a mais de 24 blocos em algum eixo não é planejado: o mob segue em linha reta. Na revisão, a janela centrada no mob (raio 8) deixava um zumbi que percebia o jogador a 21 blocos preso atrás do muro; por isso mudou (ADR 0016).
- Com `PATH.RADIUS = 12`, a janela tem 625 células, abaixo de `MAX_NODES = 700`: o teto não dispara nessa configuração (fica como rede de segurança).
- Se um replanejamento falha só porque o alvo saiu da janela, o caminho anterior segue enquanto o trecho restante for válido (evita oscilar na borda da janela).
