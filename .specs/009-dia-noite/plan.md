# Plan 009 — Dia e noite

> O COMO. Derivado da spec 009.

## Modelo

Tudo deriva de dois números: a **fase** `p = (seconds / DAY_LENGTH) mod 1` e a
**elevação do sol** `e = sin(2π·p)` (1 = zênite, 0 = horizonte, -1 = nadir).

| Grandeza        | Fórmula (sm = smoothstep)                                           |
|-----------------|---------------------------------------------------------------------|
| `dayFactor`     | `sm(-0.30, 0.15, e)` — claridade geral do céu / luz difusa          |
| `nightFactor`   | `1 - dayFactor`                                                     |
| `starAlpha`     | `nightFactor²`                                                      |
| `twilight`      | `(1 - clamp(|e|/0.30, 0, 1)²)²` — pico no horizonte, suave nas pontas |
| `sunIntensity`  | `1.6 · sm(0, 0.30, e)` (zero com o sol abaixo do horizonte)         |
| `moonIntensity` | `0.60 · sm(0, 0.30, -e)` (extra aditivo; zero com a lua abaixo)     |
| `hemiIntensity` | `lerp(0.22, 0.70, dayFactor)`                                       |
| `ambientIntensity` | `lerp(0.14, 0.25, dayFactor)`                                    |
| `skyColor`      | `lerp(NOITE, DIA, dayFactor)` e depois `lerp(·, CREPÚSCULO, 0.75·twilight)` |
| `fogColor`      | `= skyColor`                                                        |

Crepúsculo: rosado (amanhecer, `cos(2πp) > 0`) ou laranja (entardecer), com
mistura suave `sm(-0.5, 0.5, cos(2πp))`. Cores interpoladas em sRGB (valores de
display, como o hex do jogo); `sky.js` converte ao aplicar na `Color` do Three.

Direções: o sol gira em torno do eixo `n = (0, -sin t, cos t)` (órbita inclinada
`t = 0.35 rad` em relação ao plano XY): `sun(p) = (cos θ, sin θ·cos t,
sin θ·sin t)`, `θ = 2πp`. Já é unitário. `moon = -sun`.

## Mudanças por módulo

### `src/game/time.js` (novo, PURO)
- Constantes: `DAY_LENGTH`, `START_SECONDS`, `ORBIT_TILT`, `ORBIT_AXIS`.
- `phaseOf`, `dayNumber`, `isNight`, `phaseName` (rótulo do HUD:
  Amanhecer/Dia/Entardecer/Noite), `createSkyState()` e
  `skyState(seconds, out?)` (o `out` opcional evita alocação por frame).
- `isNight` e `skyState.nightFactor` usam a MESMA função interna ⇒ igualdade
  exata (`isNight === nightFactor >= 0.5`).
- Entrada não finita (`NaN`) é tratada como `START_SECONDS` (não envenena a cena).

### `src/game/sky.js` (novo, Three.js sem DOM)
- `createSky(scene, { sun, hemi, ambient })`:
  - cria um `Group` ("sky") com: `stars` (`Points`, 300 pontos, `makeRng(seed)`),
    `sunMesh` e `moonMesh` (`PlaneGeometry` + `MeshBasicMaterial` + `DataTexture`
    16×16 `NearestFilter`), todos com `fog:false`, `depthWrite:false`,
    `frustumCulled=false`; adiciona o grupo à cena.
  - captura as cores iniciais das luzes como "cores de dia" (o integrador
    continua dono da configuração de dia).
  - `update(seconds, cameraPos)`: sem alocações (escalares/objetos de trabalho
    pré-criados):
    1. `skyState(seconds, estado)`;
    2. `scene.background` (cria `Color` se preciso) e `scene.fog.color` ←
       `setRGB(..., SRGBColorSpace)`;
    3. luzes: intensidade da direcional = `sunIntensity + moonIntensity`;
       direção = a mais forte (sol/lua); posição = `cameraPos + dir·80`; **alvo =
       `cameraPos`** (+ `target.updateMatrixWorld()`), senão a direção deriva
       com a posição do jogador; cor do sol → quente no crepúsculo → azulada
       (lua) à noite; hemisfério/ambiente com tom azulado à noite;
    4. grupo centrado na câmera; sol/lua em `dir · 90` com orientação
       `qÓrbita · qBase` (quadrado voltado para a câmera e girando com o céu);
       visíveis só com `dir.y > -0.12`; sol esquenta de cor no crepúsculo;
    5. estrelas: `quaternion = qÓrbita`, `opacity = starAlpha`, invisíveis se
       `starAlpha < 0.01`.
  - `dispose()`: remove o grupo da cena e libera geometrias, materiais e
    texturas (idempotente).

## Decisões técnicas
- **Função pura do tempo** (ADR 0008): sem estado oculto ⇒ teste trivial, save
  de uma linha, "pular a noite" = somar segundos.
- **Distâncias do céu menores que a `far` da câmera** (`SUN_DISTANCE = 90`,
  `STAR_RADIUS = 100`; câmera atual: `far = 128`). Raio ~300 do brief ficaria
  cortado pelo plano `far` — desvio registrado.
- Alvo da luz direcional na câmera: o alvo padrão fica na origem e faria a
  direção da luz mudar conforme o jogador anda.

## Validação (mapeia critérios)
- `tests/time.test.js`: fases, `dayNumber`, `isNight` × `nightFactor`, cores e
  luzes nos 4 instantes-chave, continuidade (0.5 s, 2 dias), periodicidade,
  direções, `phaseName`, `out`, pureza (`Math.random` proibido).
- `tests/sky.test.js`: cena no Node, 20 instantes sem erro, `background` dia ≠
  noite, neblina, luz direcional, sol/lua/estrelas (posição, orientação,
  visibilidade, opacidade), estrelas reprodutíveis, `dispose`.
- `npm run build`.
