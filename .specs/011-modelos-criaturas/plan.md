# Plan 011 — Modelos das criaturas

> O COMO. Derivado da spec 011.

## Módulos

### `src/entities/skins.js` — PURO (sem Three.js, roda no Node)
- **Tabela de partes** por tipo (`RIGS`): cada parte é uma caixa em **pixels de
  modelo** (1 bloco ≈ 16 px): `{ name, parent?, size:[w,h,d], center:[x,y,z],
  pivot?:[x,y,z] }`. Y para cima desde os pés; **+Z = frente**; **+X = esquerda do
  próprio personagem** (a mão direita fica em −X).
- **Layout da textura** (`skinLayout(kind)`): empacotamento em prateleiras
  (largura 64) de uma "cruz" por caixa, como o Minecraft: `top, bottom, right(−X),
  front(+Z), left(+X), back(−Z)`; região da caixa = `(2d+2w) × (d+h)`.
- **Pintura** (`skinPixels(kind, variant)`): um pintor por tipo escreve RGBA
  determinístico (ruído via `makeRng(seed)` com seed derivada de kind/variant).
  Tipos: `pig`, `sheep` (4 lãs), `zombie`, `creeper`, `avatar`.
- Ovelha: variantes lidas de `MOB_DEFS.sheep.variants` (sem número duplicado).

### `src/entities/model.js` — Three.js, SEM DOM
- `skinTexture(kind, variant)`: `THREE.DataTexture` (RGBA/UnsignedByte,
  `NearestFilter`, `SRGBColorSpace`, sem mipmaps), **cache** `kind:variant`.
- Construtor de View: para cada parte, `BoxGeometry` com UVs reescritos pelo
  retângulo de cada face (s,t calculados da posição do vértice ⇒ orientação
  verificável por teste). Pivôs aninhados (`THREE.Group` por parte animada).
- Hierarquia: `object` (pés; yaw/posição do caller) → `pose` (tombar ao morrer) →
  `body` (inchar/respirar) → `fit` (escala e centralização derivadas da hitbox)
  → pivôs/partes.
- **Escala da hitbox:** `fit.scale = height / alturaBrutaDoRig` (altura da
  hitbox vem de `MOB_DEFS[kind].height` ou `PLAYER.height`); centraliza o bbox
  bruto em XZ e põe o ponto mais baixo em y=0. Nada de número de hitbox copiado.
- **Material próprio por View:** `MeshStandardMaterial` (roughness alta) clonado
  de uma base; `map` = textura compartilhada. Tudo que é visual vai em
  `emissive` (hurt/fuse/burning) e `color` (escurecer ao morrer).
- `update(dt, s)` sem alocar: lê `s` com defaults, acumula `phase`, `t`,
  `flashPhase`; suaviza amplitude do andar; aplica poses.
- Partículas de fogo: pool de 8 cubos criado **preguiçosamente** na 1ª vez que
  `burning` liga; posições recalculadas por fórmula (sem alocar por frame).
- Item na mão (avatar): grupos prontos (`sword`, `pork`, bloco colorido) presos ao
  pivô do braço direito; `holding` só alterna `visible`/cor.

### `dev/mobs.html` + `dev/mobs.js`
Cena simples (chão, luzes dia/noite), fileira com avatar, zumbi, creeper, porco e
ovelha + fileira com as 4 ovelhas; câmera orbitando (arrastar gira, roda dá
zoom); botões liga/desliga por estado, ciclar ovelha, item do avatar, hitbox
wireframe e painel de skins. Parâmetros iniciais por `location.hash`
(`#cam=front&walk=1`) para facilitar captura de tela automatizada. Vite só builda
`index.html`, então a galeria fica fora do build de produção.

## Decisões técnicas
- **Duas camadas** (`skins` puro × `model` com Three) para testar pixels e
  layout sem GPU e manter `model.js` curto. Ver ADR 0010.
- UVs derivados da geometria (e não de uma tabela de índices do `BoxGeometry`):
  sobrevive a mudança de versão do Three e é testável.
- Textura única por (kind, variant) compartilhada; geometria/material por View
  (clonar material é o que permite o flash independente por mob).

## Validação (mapeia critérios)
- `tests/model.test.js`: skins (crit. 1–2), instanciação (3), bboxes vs hitbox
  (4), orientação e UVs (5), update sem NaN em todas as combinações (6),
  andar/pose neutra (7), estados visuais (8), item na mão (9), dispose (10).
- Galeria + capturas de tela no navegador embutido (crit. 11), `npm run build`
  (crit. 12).
