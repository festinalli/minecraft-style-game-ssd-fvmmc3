# Plan 012 — Vida, inventário e modos

> O COMO. Derivado da spec 012.

## Mudanças por módulo

### `src/game/stats.js` (novo, PURO — sem DOM, sem Three)
- Exporta `MAX_HP`, `HEALTH` (constantes de regra), `MODE`/`isMode`, `fallDamage`
  e `createStats`.
- Estado num único objeto `s`; os métodos fecham sobre `s` (não usam `this`), então
  funcionam destacados (`const { damage } = stats`). Campos são lidos como dados
  simples (`stats.hp`) por HUD/IA.
- **Dano:** guarda → `dead || creative || invuln > 0 || amount inválido` devolve
  `{ applied: 0, died: false }`. Senão `applied = min(hp, ceil(amount))`,
  `invuln = INVULN_TIME`, `sinceDamage = 0`, zera o acumulador de regen e marca
  `dead` na transição para 0.
- **Regeneração independente do `dt`:** `update(dt)` soma `dt` em `sinceDamage` e
  só alimenta o acumulador com a parte do `dt` que passou do `REGEN_DELAY`
  (`min(dt, sinceDamage - REGEN_DELAY)`); a cada `REGEN_INTERVAL` acumulado cura
  `REGEN_AMOUNT`. Um `dt` grande (aba em segundo plano) cura em laço limitado
  pelo HP faltante.
- **`invuln`** tem tolerância de ponto flutuante (`1e-9`) para `5 × 0.1 s`
  realmente zerar.
- **JSON:** `{ v: 1, mode, hp, kills }`. `fromJSON` sanea campo a campo e nunca
  restaura `dead`.

### `src/game/inventory.js` (novo, PURO)
- Importa `HOTBAR_SLOTS`, `STARTER_KIT`, `MAX_STACK`, `ITEM` de `items.js` e
  `MODE/isMode` de `stats.js` (uma verdade para os modos).
- Contagens reais num `Uint16Array(HOTBAR_SLOTS.length)` (sem alocação por
  operação). Mapas `bloco → slot` e `item → slot` calculados uma vez no carregamento
  do módulo a partir de `HOTBAR_SLOTS`.
- "Permanente" (`isPermanentItem`): hoje só a espada. É regra do inventário (o
  comentário de `STARTER_KIT` já a trata assim); fica em `inventory.js` porque
  `items.js` é de outro dono — candidato a migrar para lá.
- `count(i)`: permanente → `Infinity`; Criativo → `Infinity` (blocos e carne);
  senão a contagem real. `consumeSelected` e `add*` seguem a spec.
- **JSON:** `{ v: 1, mode, selected, blocks: { "<id>": n }, items: { "<id>": n } }`,
  só contagens `> 0`. Indexado por **id**, não por posição, para sobreviver a uma
  reordenação futura da hotbar. `fromJSON` lê só ids que existem na hotbar
  (descartando o resto), `floor` + clamp `[0, MAX_STACK]`.

### `src/world/persistence.js`
- `VERSION = 2` e `KEY = 'voxelcraft.save.v2'` **inalterados**.
- Novo: `GAME_VERSION = 1`, `makeGame({ mode, seconds, stats, inventory })`
  (monta o envelope) e `sanitizeGame(raw)` (puro; normaliza na leitura).
- `serializeChunks(entries, seed, player, game?)`: acrescenta `game` ao objeto
  **somente** se `game != null`; sem ele o JSON é byte-idêntico ao da Parte 1.
- `deserializeChunks(str)`: mesma validação de antes (endurecida só para `chunks`
  nulo/array/valor não-string), mais `game: sanitizeGame(obj.game)`. O parse de
  `game` é isolado: nada nele pode fazer o load devolver `null`.
- `saveWorld(world, player, game?)` repassa `game`; `loadWorld()` devolve o
  objeto completo (inclui `game`). `clearWorld`/`hasSave` intactos.

## Decisões técnicas
- **Sem bump de versão do save.** Campo opcional aditivo mantém saves antigos
  carregando e saves novos legíveis por um build antigo (que ignora `game`).
  Ver `docs/adr/0011-modos-e-save-compativel.md`.
- **Estado de modo duplicado de propósito:** `game.mode` (sessão) e o `mode`
  dentro de `stats`/`inventory` (para o `toJSON/fromJSON` de cada um ser
  autossuficiente). Em conflito vale `game.mode` — o integrador reaplica
  `setMode(game.mode)` depois dos `fromJSON`.
- **`ceil` no dano / `floor` na cura:** mantêm o HP inteiro sem nunca zerar um
  dano > 0 nem curar além do oferecido.

## Uso esperado pelo integrador (referência, não faz parte desta feature)

```js
const stats = createStats({ mode });            // novo jogo
const inv = createInventory({ mode });
if (mode === MODE.SURVIVAL) inv.giveStarterKit();
// carregar
const g = loadWorld()?.game;
if (g) { stats.fromJSON(g.stats); inv.fromJSON(g.inventory);
         if (g.mode) { stats.setMode(g.mode); inv.setMode(g.mode); } }
// salvar
saveWorld(world, player, makeGame({ mode: stats.mode, seconds,
          stats: stats.toJSON(), inventory: inv.toJSON() }));
```

## Validação (mapeia critérios)
- `tests/stats.test.js` → critérios 1–12; `tests/inventory.test.js` → 13–21;
  `tests/persistence.test.js` → 22–28.
- `node --test` completo e `npx vite build --outDir ../out-jogador` → critério 29.
