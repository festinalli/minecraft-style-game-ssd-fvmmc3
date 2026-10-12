# ADR 0008 — Dia e noite como função pura do tempo

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A Parte 2 precisa de um ciclo de dia e noite: o céu, a neblina e as luzes mudam;
sol, lua e estrelas aparecem; zumbis/creepers dependem de "é noite?"; o HUD
mostra o dia; o save precisa guardar "que horas são". Um relógio com estado
espalhado (cor atual, fase atual, flag `isNight` mutável) vira fonte de bugs
(dessincronia entre céu, spawn e HUD) e é difícil de testar sem navegador.

## Decisão

1. **O tempo do jogo é um número: `seconds`.** `src/game/time.js` (PURO: sem
   Three.js, DOM ou estado) deriva TUDO dele: `phaseOf`, `dayNumber`, `isNight`,
   `phaseName` e `skyState(seconds)` (cores do céu/neblina, direções do sol e da
   lua, intensidades das luzes, `nightFactor`, `starAlpha`). Salvar o jogo é
   salvar `seconds`; "pular a noite" é somar segundos.
2. **Um único modelo:** fase `p = (seconds / DAY_LENGTH) mod 1` e elevação do sol
   `e = sin(2πp)`. `nightFactor = 1 - smoothstep(-0.30, 0.15, e)`;
   `isNight(s) === (nightFactor >= 0.5)` com igualdade exata (mesma função
   interna). Intensidades e cores são `lerp`/`smoothstep` de `e`: **contínuas**,
   sem saltos (testado amostrando de 0,5 em 0,5 s por 2 dias).
3. **`DAY_LENGTH = 360 s`, início em 0,05 do dia (manhã).** Dia = valores do
   `main.js` da Parte 1 (céu `0x87b7e8`, sol 1.6, hemisfério 0.7, ambiente 0.25);
   noite = céu `~0x0a0f24`, sol 0, hemisfério 0.22, ambiente 0.14 — **jogável**,
   nunca preto total —, mais uma luz da lua (a direcional vira lua, azulada, até
   0.6). Crepúsculo rosado (amanhecer) / laranja (entardecer) como um "pico"
   suave no horizonte.
4. **`src/game/sky.js` é só o adaptador Three.js** (sem DOM): `createSky(scene,
   {sun, hemi, ambient})` → `{ update(seconds, cameraPos), dispose() }` aplica o
   `skyState` na cena e move sol/lua/estrelas centrados na câmera. Texturas são
   `DataTexture` (sem canvas) e as estrelas usam o `rng` semeado ⇒ instancia no
   Node e é testada de verdade.
5. **O alvo da luz direcional acompanha a câmera.** O alvo padrão fica na
   origem; com a luz em `câmera + dir·80` a direção efetiva (posição − alvo)
   derivaria conforme o jogador anda. `update` fixa o alvo na câmera e atualiza
   sua `matrixWorld` (ele não está na cena).
6. **Distâncias do céu < `far` da câmera.** Sol/lua a 90 e estrelas a 100 blocos
   (câmera atual: `far = 128`). O raio ~300 sugerido no brief seria cortado pelo
   frustum e o céu não apareceria.

## Consequências

- **Positivo:** testável sem navegador; spawn, HUD e céu leem a mesma função (não
  dessincronizam); save trivial; ajustar o ritmo do dia é mudar uma constante.
  Zero alocação por frame (`skyState(seconds, out)` reaproveita o objeto e
  `update` usa objetos de trabalho pré-criados).
- **Negativo / ressalvas:**
  - O integrador precisa chamar `sky.update(seconds, camera.position)` a cada
    frame e avançar `seconds` (`+= dt`); sem isso o céu fica parado.
  - `isNight` é "noite de verdade" (`nightFactor >= 0.5`): vira cerca de 4°
    abaixo do horizonte, e não exatamente no pôr do sol.
  - Cores são interpoladas em sRGB (como os hex do jogo), não em espaço linear;
    por isso a transição dia→crepúsculo passa por um tom rosado-acinzentado antes
    de ficar laranja. É intencional (visual de entardecer) e barato.
  - Sem nuvens, fases da lua ou sombras dinâmicas (fora de escopo).
