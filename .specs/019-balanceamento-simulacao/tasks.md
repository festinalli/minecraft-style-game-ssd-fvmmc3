# Tasks 019 — Balanceamento por simulação

- [x] T1 — `src/balance/targets.js`: faixas-alvo (fonte única).
- [x] T2 — `src/balance/scenarios.js`: bot do jogador e os 5 cenários com 50 seeds.
- [x] T3 — `tests/balance.test.js`: faixas como asserts; determinismo (duas execuções iguais).
- [x] T4 — `scripts/balance.mjs` + script `balance` no `package.json`.
- [x] T5 — Medir os números atuais; ajustar só em `mobs.js`/`items.js` se alguma faixa falhar, registrando cada mudança aqui.

## Medição inicial (código atual da branch, antes de qualquer ajuste)

Média de 50 seeds fixas (1..50). `npm run balance`:

| métrica        | média        | faixa-alvo       | ok            |
|----------------|--------------|------------------|---------------|
| zumbiSolo      | 5,62 s       | [4, 8] s         | ok            |
| zumbiRevidando | 100%         | [100%, 100%]     | ok            |
| doisZumbis     | 16% (8/50)   | [20%, 60%]       | FORA DA FAIXA |
| creeperDano    | 7 HP         | [4, 8] HP        | ok            |
| carneCura      | 6 HP         | [6, 6] HP        | ok            |

## Ajustes de número

1. **`src/entities/mobs.js` · `zombie.aggroRange`: 20 → 21 blocos.**
   - Motivo: com dois zumbis nascendo no anel natural (`SPAWN.minDist` = 20 a `SPAWN.maxDist` = 34),
     quase nenhum zumbi chegava a 20 blocos do jogador em 30 s de passeio, então a morte ficava
     abaixo da faixa. Pelo diagnóstico, só a percepção (`aggroRange`) move a métrica; a velocidade
     de passeio quase não move (`walkSpeed` 1,3 → 16%; 1,4 → 18%).
   - Varredura antes de decidir (só em memória, sem editar arquivo): `aggroRange` 20 → 16%;
     21 → 30%; 22 → 46%; 24 → 64%. Escolhido o menor passo que entra na faixa.
   - Métrica `doisZumbis`: **16% → 30%** (15/50). As outras quatro métricas não mudaram
     (zumbiSolo 5,62 s; zumbiRevidando 100%; creeperDano 7 HP; carneCura 6 HP).
   - Efeito colateral de jogo: zumbi que nasce a 20 blocos agora já percebe o jogador
     (antes só a 20 exatos). É o efeito pretendido do ajuste.
   - Sensibilidade: a métrica é íngreme em `aggroRange` (±1 bloco ≈ ±14 pontos). Com 50 seeds,
     a fração tem ruído de uns ±6 pontos percentuais.

## Observações da medição (não viraram ajuste)

- `creeperDano` mede **7 HP**, não os 6 HP que o comentário de `blastDamage` em `mobs.js` diz
  ("parado a 2,5: 6 HP"). Motivo: o creeper começa a inflar a 2,5 blocos, mas chega a ~2,45 antes,
  porque anda 0,05 bloco por quadro até cruzar o limite. O dano sai `ceil(16·(1 − 2,45/4))` = 7.
  Ainda cai na faixa [4, 8]. O comentário ficou desatualizado; a regra da tarefa era mexer só em
  números, então ele não foi tocado.
- `zumbiSolo` (5,62 s) inclui a aproximação do zumbi, que nasce a 4–8 blocos (`ENCOUNTER`). Sem
  aproximação, o piso teórico é 4 s (5 golpes de 4 HP a cada 1,0 s). O limite inferior da faixa
  coincide com esse piso, então a métrica depende da distância inicial escolhida no cenário.
- Os cenários rodam à meia-noite do dia 1 em mundo de pedregulho: zumbi não queima e não há spawn
  natural (nenhum `spawn.on` inclui pedregulho).
