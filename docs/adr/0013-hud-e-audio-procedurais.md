# ADR 0013 — HUD e áudio procedurais (sem arquivos)

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

A Parte 2 precisa de interface (corações, hotbar com contagem, relógio, tela de
morte, menu) e de sons (golpe, dano, creeper, explosão…). As opções óbvias são
arquivos: PNGs para ícones/corações e `.ogg`/`.mp3` para os sons. O brief proíbe
arquivos de imagem e áudio no repositório ("skins, atlas e sons são procedurais"),
exige lógica pura testável no Node e traz uma lição do ADR 0005: texturas
geradas em código mantêm o repo 100% texto e fáceis de revisar.

## Decisão

1. **Ícones = pixel art em grade de texto + paleta, convertida em SVG inline.**
   Coração (cheio/meio/vazio), espada, carne, sol e lua são arrays de strings;
   `gridToSvg` agrupa corridas horizontais em `<rect>` (`crispEdges`). O cubo do
   bloco é um SVG isométrico com 3 tons derivados da cor em `BLOCK_COLOR`. Nada
   de canvas nem de binário; o resultado é uma _string_, testável no Node.
2. **A lógica do HUD é pura e separada do DOM.** `heartsFor`, `phaseLabel`,
   `formatCount`, `countText`, `clockLabel` etc. não tocam em `document`;
   `createHud({ doc })` recebe o documento (injetável) e só escreve no DOM quando o
   estado mudou, para o jogo poder atualizá-lo todo frame. `phaseLabel` é só uma
   ponte para `phaseName` de `time.js` (única fonte das fases do dia).
3. **O visual mora em `index.html`** (HTML + CSS, sem folha externa). A galeria de
   desenvolvimento (`dev/hud.html`) **busca o `index.html` real** em vez de copiar
   o CSS, então não existem duas verdades para a aparência.
4. **Sons = receitas de dados interpretadas por um motor WebAudio.** Cada som é uma
   lista de camadas (oscilador ou ruído branco, filtro com varredura, vibrato,
   envelope ADSR curto) mais `vary` e `level`. O `AudioContext` só nasce no 1º
   `resume()` (gesto do usuário); volume mestre 0,35 + compressor leve; no máximo
   12 vozes (corta a de fim mais próximo); pitch com variação pequena vinda de um
   `rng` semeado (`src/rng.js`), nunca `Math.random()`. Sem `AudioContext` (Node)
   tudo vira no-op.

## Consequências

- **Positivo:** repositório continua só texto; HUD e áudio testáveis headless
  (`tests/hud.test.js`, `tests/audio.test.js`, com DOM e `AudioContext` falsos);
  receitas validáveis sem ouvir nada (frequências > 0, envelope cabe na duração);
  os níveis de mixagem foram medidos renderizando cada som num
  `OfflineAudioContext`; trocar um ícone ou um som é editar uma grade/receita.
- **Negativo:** pixel art feita à mão em texto é menos expressiva que um pack
  desenhado, e sons sintetizados soam "de 8 bits" — caráter, não realismo. Quem
  quiser áudio gravado depois só precisa trocar o motor mantendo `play(name,
  {volume, pitch})`. O ajuste fino do timbre é subjetivo e depende de ouvir no
  navegador (não foi possível ouvir no ambiente de desenvolvimento automatizado).
- **Acoplamento aceito:** `hud.js` importa `time.js` e `items.js` (módulos puros)
  em vez de copiar nomes de fase e o teto de pilha — "uma verdade por fato".
- O `main.js` integrado precisa saber que `setInGame(false)` mostra o menu e que
  `showDeath` solta o pointer lock (documentado na spec 015).
