# Spec 015 — HUD, menu e sons

> O QUÊ e o PORQUÊ. Parte 2 (Criaturas), contrato do brief §4.7.

## Intenção

Dar ao jogo da Parte 2 a camada de **interface e áudio** que o faz parecer (e
soar) como um survival: **corações**, **hotbar de 10 slots com contagem**,
**relógio de dia/noite**, **flash de dano**, **avisos curtos** (toasts), **tela
de morte**, **menu com os dois modos** e **sons sintetizados**. Nada de arquivos
de imagem ou áudio: ícones são pixel art desenhada em código (SVG inline) e os
sons são osciladores + ruído filtrado com envelopes curtos (WebAudio).

## Por que agora

Vida, dano, mobs e inventário (012–014) só são jogáveis se o jogador **enxerga**
o estado (quanta vida, o que tem na mão, que horas são) e **ouve** o que
acontece (golpe, dano, creeper chiando). Sem HUD o survival é um jogo no escuro;
sem menu de modos não há como escolher Criativo; sem tela de morte o jogo vira
uma "tela morta" (critério-mãe do brief).

## Escopo

### Faz parte
- **Menu / pausa** (`index.html`): título VOXELCRAFT, subtítulo "Parte 2 ·
  Criaturas", botões grandes **Sobrevivência** e **Criativo**, **Novo mundo** e a
  tabela de controles atualizada. Mantém os ids usados pelo `main.js` da Parte 1.
- **Tela de morte**: "Você morreu", dias sobrevividos, abates e botão
  **Renascer**.
- **HUD** (`src/ui/hud.js`): `createHud()` + funções puras `heartsFor`,
  `phaseLabel`, `formatCount`.
- **Áudio** (`src/audio.js`): `createAudio()` com 12 sons procedurais.
- **Galeria** `dev/hud.html` para exercitar todos os estados do HUD no navegador.

### NÃO faz parte
- Música, sons posicionais 3D (o integrador atenua o `volume` por distância),
  slider de volume, persistência de mute.
- Barra de fome, XP, inventário em grade, tela de opções, controles de toque.
- Tradução para outros idiomas (textos fixos em PT-BR).
- Ligar o HUD ao jogo (`main.js`) — é do integrador.

## Critérios de aceitação

### Funções puras (testadas headless)
1. `heartsFor(hp, maxHp)` devolve **sempre 10** entradas `"full"|"half"|"empty"`,
   ordenadas cheio → meio → vazio; 2 HP = 1 coração; **HP ímpar ⇒ exatamente um
   meio coração**; `hp<=0`/inválido ⇒ tudo vazio; `hp>=maxHp` ⇒ tudo cheio; HP
   positivo nunca mostra tudo vazio; `maxHp` diferente de 20 é reescalado.
2. `phaseLabel(fase)` (fase em [0,1) como `phaseOf` de `time.js`) devolve
   `Amanhecer|Dia|Entardecer|Noite` nas quatro fases (0, 0.25, 0.5, 0.75), com
   _wrap_ fora de [0,1) e sem lançar com valores inválidos. É uma **ponte** para
   `phaseName` de `time.js` (os nomes e os limites das fases ficam num lugar só):
   varrendo o ciclo, "Noite" coincide exatamente com `isNight`.
3. `formatCount(n)`: `Infinity` ⇒ `"∞"`, `0` ⇒ `"0"`, `null`/inválido ⇒ `""`,
   inteiros como texto, acima do teto de pilha ⇒ `"999+"` (teto lido de
   `MAX_STACK`, sem copiar o número).

### HUD (`createHud`, testado com DOM falso + conferido na galeria)
4. **Corações**: 10 ícones pixelados (cheio/meio/vazio) a partir de `setHealth`;
   com `hp <= 4` os corações **tremem** (classe `low`), sem animação sob
   `prefers-reduced-motion`; a atualização é **incremental** (só toca nos
   corações que mudaram).
5. **Hotbar**: 10 slots com rótulos `1..9,0`; slot de bloco mostra um cubo na cor
   do bloco, slot de item mostra o ícone (espada e carne desenhadas em código);
   **contagem no canto** (`Infinity` em bloco ⇒ `∞`; `Infinity` em item
   permanente, como a espada, e `null` ⇒ sem número; `0` ⇒ slot esmaecido);
   selecionado destacado; o rótulo da tecla vem de `slot.label` (ou de
   `1..9,0` se faltar); chamar `setHotbar` com os mesmos dados **não reescreve o
   DOM**.
6. **Relógio**: texto `Dia N · <fase>` com ícone de sol (dia) ou lua (`night`).
   A fase `Dia` aparece como "Pleno dia" (para não ler "Dia 3 · Dia").
7. **Flash de dano**: vinheta vermelha que some em ~0,5 s; chamadas seguidas
   **reiniciam** o flash.
8. **Toasts**: empilhados no topo, somem sozinhos após `ms` (padrão 1800), no
   máximo 4 ao mesmo tempo (o mais antigo sai), texto sempre como texto (nunca
   HTML).
9. **Tela de morte**: `showDeath({days,kills})` mostra "Você morreu" com os
   números, foca "Renascer", esconde o menu e solta o pointer lock;
   `hideDeath()` desfaz; ambas são **idempotentes**.
10. `setInGame(bool)`: mira, hotbar, corações, relógio e `#hud` aparecem só em
    jogo; o menu (`#overlay`) aparece no estado inverso (o `main.js` integrado
    conta com isso: `setInGame(false)` "mostra o menu"). Se a tela de morte
    estiver aberta ela tem prioridade: o menu nunca a cobre (`body.dead`).
11. `bindMenu({onStart(mode), onNewWorld, onRespawn})`: `Sobrevivência` ⇒
    `onStart('survival')`, `Criativo` ⇒ `onStart('creative')`, `Novo mundo` ⇒
    `onNewWorld()`, `Renascer` ⇒ `onRespawn()`; os cliques **não borbulham** até o
    overlay; ligar de novo **substitui** os handlers (nunca dispara duas vezes).

12. **Extras aditivos ao contrato** (opcionais para o integrador): `setMode(mode)`
    põe `data-mode` no `<body>` (o CSS esconde os corações no Criativo, que não
    toma dano); `setMenuState({paused, mode})` marca no menu pausado o modo atual
    com "Continuar" e ajusta o subtítulo.

### index.html
13. Mantém `#app #overlay #crosshair #hud #fps #hotbar #new-world` (Parte 1) e
    acrescenta `#btn-survival #btn-creative #btn-new-world #death #btn-respawn
    #hearts #clock #toasts #damage-flash`. A tabela de controles lista: Olhar,
    Mover, Pular, Correr, Golpear/Quebrar, Colocar/Comer, Escolher item (1–9 e 0 /
    roda), Câmera 1ª/3ª pessoa (V), Voar (só Criativo), Pausar. Sem recursos
    externos (nenhum `http(s)://`).
14. Legível e sem rolagem horizontal em largura de celular (~375 px) e em
    desktop; foco visível nos botões; respeita `prefers-reduced-motion`.

### Áudio (`createAudio`, testado com `AudioContext` falso)
15. `SOUND_NAMES` é exatamente `hit hurt break place eat pig sheep zombie hiss
    explode death step`; todo nome tem receita válida (frequências > 0, envelope
    cabe na duração, duração total ≤ 2 s).
16. **Seguro no Node / sem AudioContext**: `createAudio()` não lança; `resume()`,
    `play()` e `setMuted()` viram no-op; nome desconhecido (inclusive `__proto__`,
    `constructor`, `undefined`) é ignorado sem erro.
17. O `AudioContext` só é criado no **primeiro `resume()`** (gesto do usuário);
    `play` antes disso não faz nada; `resume()` repetido não recria o contexto.
18. **Polifonia ≤ 12** vozes (a de fim mais próximo é cortada com fade); volume mestre baixo
    (0,35); `volume` limitado a [0,1]; `pitch` multiplica as frequências; cada
    chamada recebe uma **variação pequena de pitch** vinda de um `rng` semeado
    (nunca `Math.random()`); `setMuted(true)` silencia sem criar nós.
19. `npm run build` verde, nenhuma dependência nova, nenhum `console.log`.
