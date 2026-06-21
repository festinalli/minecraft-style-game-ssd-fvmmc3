# Plan 005 — Salvar / carregar mundo

> O COMO. Derivado da spec 005.

## Arquitetura

Novo módulo **`src/world/persistence.js`**:
- **PURO:** `serializeWorld(blocks, seed, player)` ↔ `deserializeWorld(str)`.
  Bytes do `Uint8Array` em base64 (`btoa`/`atob`, disponíveis no browser e no
  Node 22 → testável headless).
- **Browser:** `saveWorld/loadWorld/clearWorld/hasSave` sobre `localStorage`.

`main.js` orquestra:
```
voxels = generateWorld(SEED)
saved = loadWorld()
if saved compatível (mesma seed e mesmo tamanho): voxels.data.set(saved.data); spawn = saved.player
build mesh; spawn (do save, ou caindo sobre a superfície)
autosave: debounce após edição; ao 'unlock'; no 'beforeunload'
```

## Contratos

### `src/world/persistence.js`
```js
// PURO
serializeWorld(blocks: Uint8Array, seed: number, player: {x,y,z}): string
deserializeWorld(str): { seed, len, player, data: Uint8Array } | null

// Browser (localStorage, chave 'voxelcraft.save.v1')
saveWorld(voxels, seed, player): boolean
loadWorld(): {seed,len,player,data} | null
clearWorld(): void
hasSave(): boolean
```
Formato: `{ v, seed, len, player, blocks(base64) }`. `deserializeWorld` devolve
`null` se JSON inválido ou `v` diferente da versão atual.

## Decisões técnicas
- **Snapshot do mundo inteiro** (um blob) no `localStorage`, não por chunk:
  coerente com o mundo finito atual; persistência por chunk fica para a 006.
- **Compatibilidade defensiva:** confere `v` (versão) e tamanho do array antes
  de aplicar; incompatível ⇒ ignora e gera mundo novo (nunca lança).
- **Autosave debounced** (após edição) + nos eventos `unlock`/`beforeunload`
  para capturar a posição do jogador sem salvar a cada frame.

## Riscos / mitigação
- *Save grande / cota do localStorage* → mundo finito (~100 KB); `try/catch` no
  save retorna `false` em vez de quebrar.
- *Corromper sessão com save velho* → versionamento + checagem de tamanho.

## Validação (mapeia critérios)
- Teste headless: round-trip exato de `serialize→deserialize` (bytes, seed,
  player) e rejeição de versão/JSON inválido (crit. 5, 4).
- `npm run build` (crit. 6). Manual: editar→recarregar, "Novo mundo" (crit. 1–3).
