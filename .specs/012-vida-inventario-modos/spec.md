# Spec 012 — Vida, inventário e modos

> O QUÊ e o PORQUÊ. Parte 2 (Criaturas) — contrato em `docs/prompts/parte-2-criaturas.md` §4.5.

## Intenção

Dar ao jogador **estado de sobrevivência**: vida (HP), inventário com
quantidades e dois **modos** (Sobrevivência e Criativo) — tudo como **lógica pura
e determinística**, testável no Node. Além disso, estender o save v2 com um campo
**opcional `game`** para guardar esse estado, **sem quebrar** os saves da Parte 1.

## Por que agora

A Parte 1 é um sandbox: não há dano, quantidade de bloco nem consequência. Mobs
(013), combate/comida (014) e HUD (015) precisam de um contrato único para
"quanta vida tenho", "quanto tenho de cada coisa" e "estou no Criativo?". Esta
feature fixa esse contrato antes de qualquer UI ou IA depender dele.

## Escopo

### Faz parte
- **`src/game/stats.js`** (novo, puro): `MAX_HP`, `fallDamage`, `createStats`
  (dano, invulnerabilidade, regeneração, morte, respawn, abates, modo, JSON).
- **`src/game/inventory.js`** (novo, puro): hotbar de 10 slots com quantidades,
  seleção, consumo, kit inicial, modo, JSON. Lê `HOTBAR_SLOTS`, `STARTER_KIT`,
  `MAX_STACK` de `items.js` — **não duplica** nenhum deles.
- **`src/world/persistence.js`**: `serializeChunks/deserializeChunks/saveWorld/
  loadWorld` aceitam e devolvem o campo opcional `game`. **`VERSION` continua 2**
  e a chave continua `voxelcraft.save.v2`.

### NÃO faz parte
- Ligar isto ao `main.js`, às teclas `1`–`9`/`0`, ao clique e ao HUD (integrador;
  features 014/015).
- Aplicar o dano de queda (o `controls.js` da 010 mede a distância; aqui só existe
  a função `fallDamage`).
- Perder itens ao morrer, múltiplos slots de save, persistir mobs, crafting.

## Contrato

Constantes de regra vivem em `stats.js` (`MAX_HP`, `HEALTH`, `MODE`); tudo o que
é item/hotbar vem de `items.js`. Unidades: HP **inteiro** (1 coração = 2 HP),
tempo em segundos.

### `stats.js`

```
MAX_HP = 20
HEALTH = { FALL_SAFE_DISTANCE: 3, INVULN_TIME: 0.5, RESPAWN_INVULN: 1.5,
           REGEN_DELAY: 8, REGEN_INTERVAL: 4, REGEN_AMOUNT: 1 }
MODE = { SURVIVAL: 'survival', CREATIVE: 'creative' };  isMode(m)
fallDamage(distance) -> number
createStats({ mode = 'survival' }?) -> {
  hp, maxHp, mode, dead, kills, sinceDamage, invuln, lastSource,
  damage(amount, { source }?) -> { applied, died },
  heal(amount) -> number, update(dt), addKill() -> number,
  respawn(), setMode(m) -> mode, toJSON(), fromJSON(o) -> boolean }
```

### `inventory.js`

```
createInventory({ mode = 'survival' }?) -> {
  selected, mode, select(i), cycle(dir), setMode(m), slot(i),
  count(i), getSelected(), addBlock(id, n = 1), addItem(id, n = 1),
  consumeSelected(), giveStarterKit(), toJSON(), fromJSON(o) -> boolean }
isPermanentItem(item) -> boolean     // a espada
```

### Formato do campo `game` no save (versionado)

Montado pelo integrador a partir de `stats.toJSON()` / `inventory.toJSON()`
(a função `makeGame` de `persistence.js` monta o envelope):

```jsonc
{
  "v": 1,                       // GAME_VERSION (persistence.js)
  "mode": "survival",           // "survival" | "creative" — modo da SESSÃO (vale em conflito)
  "seconds": 123.4,             // tempo de jogo total, em s (define dia/noite)
  "stats": { "v": 1, "mode": "survival", "hp": 14, "kills": 3 },
  "inventory": { "v": 1, "mode": "survival", "selected": 4,
                 "blocks": { "7": 8 }, "items": { "pork": 3 } }
}
```

Na leitura, `deserializeChunks` devolve `game` **normalizado**: `null` se ausente
ou irreconhecível (não é objeto, `v !== 1`); senão `{ v, mode, seconds, stats,
inventory }` onde cada campo inválido vira `null` (o integrador usa o padrão:
modo escolhido no menu, `START_SECONDS`, stats/inventário novos).

## Regras de negócio (decisões)

- **Dano inteiro:** `damage(amount)` arredonda para CIMA (`ceil`): dano > 0 nunca
  vira 0. `heal(amount)` arredonda para BAIXO (`floor`). O HP é sempre inteiro.
- **Regeneração:** só em Sobrevivência, vivo e `hp < maxHp`. O relógio de regen só
  corre depois de `REGEN_DELAY` s sem dano; a **primeira cura** vem
  `REGEN_INTERVAL` s depois disso (12 s após o dano) e as seguintes a cada 4 s.
  O resultado não depende do tamanho do `dt`.
- **Criativo em `stats`:** dano ignorado, HP sempre cheio. `setMode('creative')`
  reanima (`dead = false`) — nunca existe "morto no Criativo".
- **Criativo em `inventory`:** blocos e carne contam `Infinity`; nada se gasta;
  `addBlock/addItem` não fazem nada (devolvem 0) para o estoque real de
  Sobrevivência não crescer escondido. As contagens reais são preservadas ao
  alternar de modo.
- **Espada permanente:** `count` = `Infinity` em todo modo; `consumeSelected()`
  é `false` com ela selecionada (não é consumível); `addItem(SWORD)` devolve 0.
- **Kit inicial:** `giveStarterKit()` leva cada contagem ao **mínimo** do
  `STARTER_KIT` (`max(atual, kit)`): chamar duas vezes não duplica nem tira nada.
- **Save nunca ressuscita tela de morte:** `fromJSON` de `stats` não restaura
  `dead`; `hp` fora de `[1, maxHp]` (inclusive 0) é inválido e vira `maxHp`.

## Critérios de aceitação

**Stats**
1. `fallDamage`: 0 para `d <= 3`; `ceil(d - 3)` acima (3.01→1, 4→1, 4.5→2, 10→7,
   23→20); negativo/`NaN`/não-número → 0.
2. Estado inicial: `hp = maxHp = MAX_HP = 20`, `dead = false`, `kills = 0`,
   `invuln = 0`, modo padrão `survival`.
3. `damage` subtrai HP e devolve `{ applied, died: false }`; fracionário arredonda
   para cima; `<= 0`, `NaN` e não-número são ignorados (`applied: 0`).
4. **Invulnerabilidade:** após um dano válido, outro dano em `< 0.5 s` é ignorado;
   após `update(0.5)` volta a valer; cada dano válido reinicia `invuln` e
   `sinceDamage`.
5. `hp` nunca fica `< 0`; dano excessivo aplica só o HP restante (`applied`).
6. `died` é `true` **somente** na transição para 0 (`dead = true`); dano em
   jogador morto → `{ applied: 0, died: false }`.
7. **Criativo:** `damage` ignorado, HP cheio, `invuln` não dispara.
8. **Regeneração:** nenhuma cura antes de 12 s sem dano; +1 HP aos 12 s e a cada
   4 s depois; para em `maxHp`; novo dano zera o ciclo; nada em Criativo/morto;
   mesmo resultado com `dt` de 1/64 s, 0.5 s ou um único `update(20)`.
9. `respawn()`: `hp = maxHp`, `dead = false`, `invuln = 1.5`, `kills` e modo
   preservados; dano durante a invulnerabilidade de respawn é ignorado.
10. `setMode('creative')`: HP cheio e `dead = false`; modo inválido é ignorado;
    voltar a `survival` mantém o HP.
11. `heal`: devolve o que realmente curou, respeita `maxHp`, devolve 0 se morto ou
    valor inválido.
12. `toJSON → fromJSON` é identidade para `hp`, `kills` e `mode`; entradas inválidas
    são saneadas (hp inválido → `maxHp`; kills negativo/inválido → 0;
    não-objeto não altera nada e devolve `false`); `fromJSON` zera `dead`,
    `invuln` e `sinceDamage`.

**Inventário**
13. 10 slots (`HOTBAR_SLOTS.length`); `slot(i)` devolve o de `HOTBAR_SLOTS`, ou
    `null` fora de `0..9`.
14. `selected` começa em 0; `select` clampa inteiros fora do intervalo e ignora
    não-inteiros; `cycle(±1)` dá a volta nos dois sentidos; `cycle(0)`/`NaN` não
    mexem.
15. `count`: Sobrevivência começa em 0 (blocos e carne), espada `Infinity`;
    Criativo `Infinity` para blocos e carne; índice inválido → 0.
16. `getSelected()` devolve `{ index, kind, block, count }` (bloco) ou
    `{ index, kind, item, count }` (item), sem a chave que não se aplica.
17. `addBlock/addItem` devolvem quanto **realmente entrou**; respeitam
    `MAX_STACK` (parcial perto do teto, 0 no teto); id desconhecido, `n` inválido
    → 0; `n` fracionário → floor.
18. `consumeSelected`: Sobrevivência gasta 1 e devolve `true`, `false` se vazio
    (sem ficar negativo); Criativo devolve `true` sem gastar; espada → `false`.
19. `giveStarterKit` aplica exatamente o `STARTER_KIT` e é idempotente; não reduz
    contagem maior que a do kit.
20. Alternar para Criativo e voltar preserva as contagens reais.
21. `toJSON → fromJSON` é identidade; `fromJSON` descarta ids desconhecidos,
    clampa contagens a `[0, MAX_STACK]`, zera inválidas, normaliza `selected`.

**Persistência**
22. `serializeChunks` **sem** `game` produz exatamente o JSON do formato da
    Parte 1 (sem a chave `game`); **com** `game` grava o campo.
23. Round-trip puro: chunks idênticos byte a byte; `game` volta igual; sem `game`
    volta `null`.
24. **Fixture de save v2 da Parte 1** (string literal no formato antigo) carrega:
    `seed`, `player`, `chunks` corretos e `game === null`.
25. `game` corrompido (string, número, array, `v` errado, campos lixo) **nunca**
    derruba o load: chunks continuam válidos; irreconhecível → `null`, campos
    ruins → `null` por campo.
26. Base64 grande sobrevive: chunk cheio (todos os valores 0–255) e buffers de
    tamanhos não múltiplos de 3 e acima do limite do bloco interno de conversão.
27. Versão incompatível, JSON inválido e `chunks` malformado continuam
    devolvendo `null` (comportamento da Parte 1).
28. `saveWorld(world, player, game)` / `loadWorld()` fazem o ciclo completo com um
    `localStorage` simulado e nunca lançam se o storage falhar.

**Gerais**
29. Sem `Math.random()`, sem `console.log`, sem dependência nova; `node --test`
    passa e `vite build` segue verde.
