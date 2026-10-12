# Plan 015 — HUD, menu e sons

> O COMO. Derivado da spec 015.

## Mudanças por módulo

### `index.html` (HTML + CSS, dono único)
- **Estrutura** (ordem = camadas): `#app` · `#damage-flash` · `#crosshair` ·
  `#hud` (FPS) · `#clock` · `#toasts` · `#hearts` · `#hotbar` · `#overlay` (menu) ·
  `#death`.
- `#overlay` ganha `.menu-panel` (título, subtítulo, `.modes` com os dois botões
  grandes, `#new-world` > `#btn-new-world`, tabela `.controls` em `<dl>`).
  `#new-world` virou um **invólucro** (`display: contents`) do botão
  `#btn-new-world`: o `main.js` da Parte 1 (que escuta `#new-world`) continua
  funcionando pelo _bubbling_, e o `bindMenu` liga direto no botão.
- Os botões de modo ficam dentro do `#overlay`: no `main.js` da Parte 1 o clique
  borbulha até o overlay e trava o mouse (comportamento antigo preservado).
  Slots `.slot` antigos (cor inline + `<span>` com o número) continuam desenhando.
- **CSS**: tokens em `:root` (`--slot`, `--hotbar-w`, `--heart` calculados a
  partir da largura da tela ⇒ 10 slots cabem em 375 px); estilo "blocado" sutil
  (bordas duras, bisel interno por `box-shadow`, sombras de texto sem desfoque);
  `@media (prefers-reduced-motion)` desliga tremor/animações; `body.dead
  #overlay {display:none}` impede o menu de aparecer por cima da tela de morte;
  `#overlay` entra com um _delay_ de 0,1 s para não piscar entre `hideDeath()` e
  o `lock` do mouse; menu e tela de morte rolam (`margin:auto` no painel) em
  telas baixas, sem cortar o conteúdo.

### `src/ui/hud.js`
- **Puro (sem DOM, importável no Node)**: `heartsFor`, `isLowHealth`,
  `phaseLabel`, `clockLabel`, `formatCount`, `countText`, `slotKeyLabel`,
  `deathSummary`, `cssColor`, `shadeColor`, e os geradores de SVG `heartSvg`,
  `itemIconSvg`, `blockIconSvg`, `sunSvg`, `moonSvg`. A pixel art é uma **grade de
  texto + paleta** convertida em `<rect>` (corridas horizontais agrupadas).
- `phaseLabel(fase)` **não** tem tabela própria de fases: delega a `phaseName` de
  `time.js` (`fase × DAY_LENGTH` segundos), a única fonte dos nomes e dos limites
  (inclusive a noite, igual a `isNight`). Só o texto exibido é nosso ("Dia" ⇒
  "Pleno dia").
- Dependências internas: `items.js` (`ITEM`, `MAX_STACK`) e `time.js`
  (`DAY_LENGTH`, `phaseName`); nenhum número de balanceamento é copiado.
- **`createHud({ doc })`** (padrão `document`; injetável para teste): `ensure(id)`
  reaproveita o elemento do `index.html` ou cria um de reserva. Guarda o último
  estado de cada peça (corações, slots, relógio) e só mexe no DOM quando algo
  mudou — o integrador pode chamar `setHealth/setHotbar/setClock` todo frame.
- Extras (aditivos ao contrato): `setMode(mode)` (esconde corações no Criativo),
  `setMenuState({paused, mode})` (marca o modo atual e mostra "Continuar").
- `setInGame(bool)` alterna as peças de jogo **e** o `#overlay` (inverso) — o
  `main.js` integrado depende disso ("`setInGame(false)` mostra o menu"). A tela de
  morte tem prioridade via `body.dead`; `showDeath` também chama
  `document.exitPointerLock()` na 1ª vez (sem soltar o mouse não dá para clicar em
  "Renascer"), foca o botão e é idempotente (o handler de `unlock` chama de novo).
- `flashDamage()` reinicia a animação CSS (remove classe → _reflow_ → adiciona).
- `toast()` usa `textContent`, `setTimeout` (fade de 250 ms) e teto de 4.
- `bindMenu()` registra os `addEventListener` uma única vez e lê os handlers de
  um objeto mutável (religar troca os handlers, não duplica).

### `src/audio.js`
- **Receitas** (dados puros, congelados): lista de camadas `osc`/`noise` com
  frequência inicial→final (rampa exponencial), filtro opcional (low/high/band
  com varredura), vibrato opcional, atraso e envelope ADSR `[a, d, s, r]`, mais
  `vary` (variação de pitch) e `level` (ganho de mixagem da voz). Os `level`s
  foram calibrados renderizando cada som num `OfflineAudioContext` e medindo o
  pico (sem eles os sons de ruído filtrado — passo, quebrar, golpe — saíam ~10×
  mais baixos que a explosão): picos finais entre 0,11 e 0,45.
- **Motor**: `createAudio({ contextFactory, rng })`. Contexto criado no primeiro
  `resume()`; grafo `voz → master(0,35) → compressor leve → destino`; um buffer de
  ruído branco de 2 s (semente fixa) reaproveitado por todas as vozes.
- `play(name, {volume, pitch})`: valida nome (`Object.hasOwn`), mudo, estado do
  contexto; calcula `pitch × (1 ± vary)` com o `rng` injetado; agenda nós; registra
  a voz com seu instante de fim. Antes de agendar, descarta vozes terminadas e, se
  houver 12, corta a de fim mais próximo (fade de 60 ms para não estalar).
- Sem `AudioContext` (Node) a fábrica devolve `null` e tudo vira no-op.
  `activeVoices()` é um extra para diagnóstico e testes.

### `dev/hud.html` + `dev/hud.js`
- A galeria **busca o `index.html` real** (`fetch`), injeta o `<style>` e o
  markup do HUD e chama `createHud()` — uma só fonte de verdade para o visual.
- Painel lateral recolhível (`?panel=0` começa recolhido) com botões para: vida
  0–20, hotbar (kit Sobrevivência / Criativo / vazio), 4 fases do relógio, flash,
  toasts, morte, menu, modo, fundo (dia/noite/neve/caverna) e um botão por som.
  Só existe em desenvolvimento (não entra no `npm run build`).

## Decisões técnicas
- **Pixel art em grade de texto → SVG inline** (e não PNG/canvas): zero binários,
  escala nítida em qualquer tamanho (`shape-rendering: crispEdges`), testável no
  Node como string. Ver ADR 0013.
- **Receitas de som como dados** (e não código imperativo por som): dá para
  validar no Node (frequências, envelopes, durações) sem ter áudio.
- **`label` do slot = rótulo da tecla** (o integrador passa `String((i+1)%10)`);
  se faltar, o HUD calcula `slotKeyLabel(i)`.
- **Item permanente (`Infinity`) não mostra número**; bloco com `Infinity` (Criativo)
  mostra `∞`.
- `phaseLabel` recebe a **fase** (0..1), não segundos; "Dia" no relógio aparece
  como "Pleno dia" para não ler "Dia 3 · Dia".

## Validação (mapeia critérios)
- `tests/hud.test.js`: critérios 1–3 (puras), 4–12 (DOM falso + timers
  simulados), 13–14 (lê `index.html` do disco: ids, controles, sem URL externa,
  `prefers-reduced-motion`, tamanho do slot).
- `tests/audio.test.js`: critérios 15–18 (`AudioContext` falso que registra nós,
  parâmetros e estado).
- Manual na galeria (`npx vite --port 5182` ⇒ `/dev/hud.html`): 4, 5, 6, 7, 8, 9,
  10 e 14 (screenshots em desktop e 375 px, console sem erros) e a leitura dos
  picos de cada som (`OfflineAudioContext`).
- `npm run build` com `outDir` próprio (critério 19).
