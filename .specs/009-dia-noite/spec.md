# Spec 009 — Ciclo de dia e noite

> O QUÊ e o PORQUÊ. Parte 2 do Voxelcraft (ver `docs/prompts/parte-2-criaturas.md`).

## Intenção

Um **ciclo de dia e noite** contínuo: o céu, a neblina e as luzes mudam suavemente
ao longo de `DAY_LENGTH` segundos; um **sol** e uma **lua** quadrados atravessam
o céu; **estrelas** aparecem à noite. O tempo do jogo é um simples número de
segundos; tudo o mais é **função pura** dele.

## Por que agora

O loop de sobrevivência depende de ter um "entardecer" (zumbis e creepers
passam a nascer, o jogador se abriga) e um "amanhecer" (zumbis queimam, a
população hostil some). Sem um relógio do mundo e um céu que o mostre, a Parte 2
não tem ritmo. Tornar o tempo uma função pura torna o ciclo testável sem
navegador e trivial de salvar (basta persistir `seconds`).

## Escopo

### Faz parte
- **`src/game/time.js` (novo, PURO — sem Three.js, sem DOM):**
  `DAY_LENGTH = 360` s, `START_SECONDS = 0.05 * DAY_LENGTH` (manhã), `phaseOf`,
  `dayNumber`, `isNight`, `skyState` (+ extras aditivos: `phaseName`,
  `createSkyState`, constantes da órbita).
- **Fases do dia:** `0` amanhecer, `0.25` meio-dia, `0.5` pôr do sol,
  `0.75` meia-noite.
- **`skyState(seconds)`**: cor do céu, cor da neblina (acompanha o céu), direção
  do sol e da lua (unitárias), intensidades das 3 luzes, `nightFactor` e
  `starAlpha`.
  - Dia: céu `0x87b7e8` (a cor atual do jogo); luzes iguais às do `main.js`
    atual (sol 1.6, hemisfério 0.7, ambiente 0.25).
  - Crepúsculo laranja/rosado nas transições (rosado ao amanhecer, laranja ao
    entardecer).
  - Noite: céu azul muito escuro (~`0x0a0f24`); sol 0, hemisfério ~0.22,
    ambiente ~0.14. **Noite jogável:** dá para ver silhuetas, nunca preto total.
  - Todas as transições são **suaves** (sem saltos).
  - `isNight(s) === (nightFactor >= 0.5)`; `starAlpha ≈ nightFactor²`.
  - O sol nasce em `+X` e se põe em `-X` (arco no plano XY com leve inclinação
    em Z); a lua é exatamente oposta.
- **`src/game/sky.js` (novo, Three.js SEM DOM):** `createSky(scene, { sun,
  hemi, ambient })` → `{ update(seconds, cameraPos), dispose() }`.
  - `update` ajusta `scene.background` (cria uma `Color` se não for), `scene.fog.color`
    (se houver neblina) e as intensidades/cores das 3 luzes.
  - A luz direcional vira a **lua** à noite (fraca, azulada) e fica a
    `cameraPos + dir * 80`, com o alvo na câmera (direção correta em qualquer
    ponto do mundo).
  - **Sol e lua** quadrados e achatados, estilo Minecraft (`PlaneGeometry` +
    `MeshBasicMaterial` com `DataTexture` de pixels, `fog:false`,
    `depthWrite:false`, `frustumCulled=false`), centrados na câmera e voltados
    para ela; **estrelas** (`THREE.Points`, 300 pontos numa esfera, posições por
    `rng` semeado) cuja opacidade segue `starAlpha`; o conjunto gira com o tempo.
  - Instancia e roda no Node (sem canvas/DOM).

### NÃO faz parte
- Relógio/HUD de dia (feature 015), spawn por dia/noite (013), persistência do
  tempo (012 — o integrador salva `seconds` no campo `game`).
- Nuvens, chuva, fases da lua, sombras dinâmicas, luz por bloco (tocha).
- Interação com `main.js`: quem chama `sky.update(...)` a cada frame é o
  integrador.

## Critérios de aceitação

1. `phaseOf` devolve `[0,1)` e é periódica em `DAY_LENGTH` (inclusive para tempo
   negativo); `0`, `.25`, `.5`, `.75` correspondem a amanhecer, meio-dia, pôr do
   sol, meia-noite.
2. `dayNumber` começa em 1, vira exatamente em `DAY_LENGTH` (e em múltiplos).
3. `isNight(s) === (skyState(s).nightFactor >= 0.5)` para todo `s` amostrado;
   `nightFactor` e `starAlpha` ficam em `[0,1]`.
4. Ao meio-dia: céu `0x87b7e8`, luzes 1.6 / 0.7 / 0.25, `nightFactor = 0`. À
   meia-noite: sol 0, hemisfério ~0.22, ambiente ~0.14, céu ~`0x0a0f24`,
   `starAlpha = 1`. `START_SECONDS` reproduz o visual atual do jogo.
5. **Continuidade:** amostrando de 0.5 em 0.5 s por dois dias, nenhum canal de
   cor, intensidade, direção, `nightFactor` ou `starAlpha` salta acima de um
   limite pequeno (derivado da taxa máxima de variação).
6. `sunDir`/`moonDir` são unitários; sol em `+X` ao amanhecer e em `-X` ao pôr
   do sol; lua `= -sol`; neblina = cor do céu.
7. Crepúsculo: nos instantes `0` e `0.5` a cor do céu é quente (vermelho
   dominante sobre o azul), diferente do dia e da noite.
8. `createSky` instancia num `THREE.Scene` no Node; `update` roda em 20 instantes
   sem erro; `scene.background` muda entre dia e noite; a neblina o acompanha;
   a luz direcional aponta para a direção certa a partir da câmera, mesmo longe
   da origem; sol/lua ficam centrados na câmera, voltados para ela e só visíveis
   quando acima do horizonte; estrelas só aparecem à noite; `dispose` remove tudo.
9. Nada usa `Math.random()`; as estrelas são reprodutíveis.
10. `npm run build` conclui sem erros e `node --test tests/time.test.js
    tests/sky.test.js` passa.
