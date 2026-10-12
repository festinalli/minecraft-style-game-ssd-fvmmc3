# Spec 011 — Modelos das criaturas

> O QUÊ e o PORQUÊ.

## Intenção

Dar **rosto e corpo** aos personagens da Parte 2: porco, ovelha (4 cores), zumbi,
creeper e o **avatar do jogador**. Cada criatura é um boneco de **caixas** no
estilo voxel (inconfundível à distância), com **skin procedural** e animações de
andar, ferido, inchar, queimar, golpear e morrer. Sem nenhum arquivo de imagem.

## Por que agora

As features 013 (IA/manager) e 016 (terceira pessoa) precisam de um `View` pronto
para pendurar na cena. Sem modelo, os mobs seriam caixas cinzas e o jogador
nunca se veria. O contrato (§4.4 do brief) fixa a API para que IA, manager e
câmera trabalhem em paralelo.

## Escopo

### Faz parte
- `src/entities/skins.js` (PURO, sem Three.js): tabela de partes (caixas) de cada
  criatura, empacotamento da textura (layout em cruz estilo Minecraft) e pintura
  dos pixels RGBA (`skinPixels`, `skinLayout`).
- `src/entities/model.js` (Three.js, **sem DOM**): `createMobView(kind, {variant})`,
  `createAvatarView()`, `skinPixels` re-exportado; `THREE.DataTexture`
  (NearestFilter, sRGB) em **cache por (kind, variant)**.
- Animações via `view.update(dt, s)`: andar, respirar, ferido (flash vermelho),
  inchar + piscar (creeper), queimar (tom laranja + partículas), golpear
  (zumbi/avatar), morrer (tomba + afunda + escurece), item na mão do avatar.
- Escala/posições **derivadas de `MOB_DEFS[kind]`** (halfW, height) — nenhum
  número de hitbox é copiado — e do `PLAYER` (avatar).
- **Galeria de verificação visual** `dev/mobs.html` + `dev/mobs.js` (fora do
  build de produção).
- Testes headless (`tests/model.test.js`) e ADR 0010.

### NÃO faz parte
- IA, física, spawn, dano (features 010, 012, 013, 014).
- Som, HUD, mão em primeira pessoa (015/016) — o item na mão do **avatar** (3ª
  pessoa) faz parte; a mão de 1ª pessoa não.
- Arquivos de imagem/áudio; qualquer dependência nova.
- Persistir mobs ou skins.

## Contrato (brief §4.4 — não muda)

```js
skinPixels(kind, variant) -> { width, height, data: Uint8Array /* RGBA */ }
createMobView(kind, { variant = 0 } = {}) -> View
createAvatarView() -> View
// View = { object: THREE.Group, update(dt, s), dispose() }
// s = { speed, hurt, fuse, burning, attack, dying, sprinting?, holding? }
```

Orientação (lei): **frente = +Z local**, origem nos **pés**; o caller faz
`object.rotation.y = yaw` e `object.position = pos dos pés`.

## Critérios de aceitação

1. `skinPixels` é **determinístico** (duas chamadas ⇒ bytes idênticos), devolve
   `data.length === width*height*4`, e **todo texel de toda face usada** por uma
   caixa tem alfa 255 (nenhum buraco transparente onde o modelo é visível).
2. As **4 variantes da ovelha** geram skins diferentes entre si (cor média da lã
   distinta); `variant` fora de 0..3 normaliza em vez de quebrar; para tipos sem
   variante o `variant` é ignorado.
3. `createMobView` instancia `pig`, `sheep`, `zombie`, `creeper`; kind
   desconhecido lança erro claro; `createAvatarView` instancia o jogador. A View
   tem `object` (Group), `update` e `dispose`.
4. **Hitbox:** com a pose neutra, a altura do modelo fica a ±5% de
   `MOB_DEFS[kind].height` (avatar: `PLAYER.height`); o pé está em y=0; o modelo
   é centrado em XZ; a maior extensão horizontal fica entre 0,85× e 1,12× a
   largura da hitbox (zumbi, por causa dos braços estendidos, até 1,25×; o
   desvio fica documentado no ADR).
5. **Orientação +Z:** o focinho do porco tem o maior `z` da cabeça; os braços do
   zumbi apontam para +Z; o rosto do creeper/zumbi/porco/ovelha/avatar está
   mapeado na face +Z da cabeça (UVs da face frontal caem no retângulo "front"
   da skin e o rosto pintado está nele).
6. `update(dt, s)` roda com **todos** os estados (inclusive `s` ausente, campos
   `undefined`, `dt=0`) sem produzir `NaN` em nenhuma matriz; o jogo atual não
   precisa passar todos os campos.
7. **Andar:** parado ⇒ pose neutra (pernas e braços em 0, à parte respiração
   mínima); a amplitude e a frequência do balanço crescem com `speed`; a fase é
   acumulada internamente.
8. **Estados visuais** (mensuráveis): `hurt` ⇒ emissivo vermelho proporcional;
   `fuse` (só creeper) ⇒ escala XZ vai de 1 a ~1,25 e o branco pisca em pulsos
   cada vez mais rápidos; `burning` ⇒ emissivo laranja pulsante + partículas;
   `attack` 0→0,5→0 ⇒ braço faz arco (zumbi/avatar) com pico em 0,5 e volta ao
   repouso; `dying` 0..1 ⇒ tomba até 90°, afunda um pouco e escurece.
9. `holding` do avatar: `null` (nada), `'sword'`, `'pork'` ou número (cor hex de
   bloco) mostra o item na mão **direita**; trocar de item não aloca por frame.
10. `dispose()` é **idempotente**, libera só geometrias/materiais próprios da View
    e **não** destrói a textura compartilhada (outra View do mesmo tipo continua
    renderizando).
11. A **galeria** `dev/mobs.html` mostra todos os personagens lado a lado, com
    botões para andar, ferido, inchar, queimar, atacar, morrer, ciclar ovelha por
    variante, e **não** entra em `npm run build`.
12. `npm run build` verde e `node --test tests/model.test.js` verde.
