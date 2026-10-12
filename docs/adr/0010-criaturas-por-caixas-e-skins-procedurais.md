# ADR 0010 — Criaturas por caixas e skins procedurais

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A Parte 2 coloca personagens no mundo (porco, ovelha, zumbi, creeper e o avatar
do jogador). O projeto não tem arquivos de imagem (ADR 0005: atlas procedural),
roda no navegador com Three.js como única dependência, e a lógica precisa ser
testável no Node sem DOM nem GPU. Até 18 mobs vivos ao mesmo tempo a 60 FPS, e a
hitbox de cada criatura mora só em `mobs.js` (uma verdade por fato).

## Decisão

1. **Bonecos de caixas** (`BoxGeometry`), estilo voxel, ~16 texels por bloco. Cada
   criatura é uma árvore de partes (pivôs `THREE.Group`) com caixas de proporção
   fixa, definidas em pixels de modelo em `src/entities/skins.js`.
2. **Skins procedurais em pixels RGBA** (`skinPixels(kind, variant)`), geradas por
   pintores determinísticos (ruído por `makeRng` com seed derivada de
   `kind:variant`) e viradas em `THREE.DataTexture` (`NearestFilter`, sRGB, sem
   mipmap). Nada de `canvas`/DOM: o mesmo código roda no Node (testes) e no
   navegador. Layout em "cruz" do Minecraft por caixa, empacotado em prateleiras;
   pernas/braços simétricos compartilham a região.
3. **UVs derivados da posição do vértice** (face pela normal, `s,t` vistos de fora)
   em vez de uma tabela de índices do `BoxGeometry`: a orientação (frente = +Z,
   sem espelhar) é verificável por teste e independe da versão do Three.
4. **Escala derivada da hitbox:** o `View` mede a caixa do rig na pose neutra e
   aplica `escala = height / alturaMedida` (uniforme, texels quadrados), com os
   pés em y=0 e o corpo centrado em XZ. `height`/`halfW` vêm de `MOB_DEFS[kind]`
   (avatar: `PLAYER`); nenhum número é copiado. Os braços estendidos do zumbi
   ficam de fora da centralização (o tronco fica no centro da hitbox).
5. **Posse dos recursos:** textura por `(kind, variant)` em cache de módulo,
   compartilhada; geometrias e material são **da View** (o material é clonado para
   o flash por mob ser independente). `dispose()` é idempotente e nunca toca na
   textura compartilhada (`disposeSharedSkins()` existe para hot reload).
6. **Estados visuais sem alocar por frame:** `hurt`/`fuse`/`burning` viram `emissive`
   do material próprio; `dying` escurece (`color`) e tomba o grupo `pose` pela
   aresta lateral dos pés até 90°; `fuse` escala o grupo `body` (XZ até 1,25x) e
   pisca branco com frequência crescente (fase acumulada); o fogo é um pool de 8
   cubos criado só na primeira vez que queima e pendurado na árvore só enquanto
   queima; o item da mão do avatar fica pendurado só enquanto está selecionado.
7. **Contrato de orientação único:** frente = +Z local, origem nos pés, o caller faz
   `rotation.y = yaw` e `position = pés`; a mão direita do personagem é −X.
8. **Galeria de verificação** `dev/mobs.html` (Vite dev; fora do build de
   produção, que só builda `index.html`) com botões por estado, hitbox em
   wireframe e painel de skins.

## Consequências

- **Positivo:** zero arquivo de imagem; skins e layout testáveis headless; trocar
  a hitbox em `mobs.js` redimensiona o modelo sozinho; 5 criaturas × 1 material
  clonado por View mantêm o custo de draw call baixo (6–9 meshes por mob).
- **Positivo:** UV e orientação são provados por teste (rosto em +Z, focinho e
  braços para frente, mão direita em −X), o que evita o clássico modelo "de
  costas" na integração com IA e câmera.
- **Negativo / desvios:**
  - o zumbi tem os braços estendidos para a frente, então a maior extensão
    horizontal fica ~1,17x a largura da hitbox (teste aceita até 1,25x); o corpo
    em si cabe em ±10% da hitbox. Os demais tipos ficam entre 0,87x e 1,08x.
  - O porco e a ovelha são mais curtos que os do Minecraft para caber na hitbox
    quadrada de `mobs.js`.
  - Cada View cria suas próprias geometrias (6–9 `BoxGeometry` pequenas);
    instanciar/descartar mobs com frequência alta custa um pouco mais do que
    compartilhar geometrias, em troca de um `dispose` simples e sem refcount.
- **Reversível:** trocar as skins por atlas pintados à mão só exige substituir
  `skinPixels`, já que o resto consome `{ width, height, data }`.
