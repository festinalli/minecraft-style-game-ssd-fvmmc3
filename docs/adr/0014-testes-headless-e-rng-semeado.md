# ADR 0014 — Testes headless com `node:test` e RNG semeado

- **Status:** Aceito
- **Data:** 2026-10-11

## Contexto

Até a Parte 1 a verificação era "build + jogar". A Parte 2 acrescenta IA,
spawn, dano e física de entidades: lógica que quebra de forma sutil e que não
se confere olhando a tela. Além disso, a constitution proíbe `Math.random()`
na geração de mundo.

## Decisão

1. **`node:test`** (embutido no Node) roda `tests/**/*.test.js` com `npm test`.
   Nenhuma dependência nova. Módulos de lógica não tocam DOM; os que usam
   Three.js sem DOM (World, modelos com `DataTexture`, gerenciador de mobs
   sem `scene`) também rodam no Node.
2. **Toda aleatoriedade de gameplay** (IA, spawn, drops) vem de um `rng`
   **injetado** (`src/rng.js`, mulberry32). Os testes passam seeds fixas; em
   runtime o `main.js` semeia com `seed do mundo ⊕ relógio` só para variar as
   partidas. O **terreno** continua puramente determinístico pela seed do mundo.
3. Um **gancho de playtest** (`window.__vc`) existe apenas sob
   `import.meta.env.DEV` e é removido do build de produção.

## Consequências

- **Positivo:** regressões de física/IA/save pegas sem abrir o navegador;
  simulações reproduzíveis (mesma seed ⇒ mesma sequência de eventos).
- **Negativo:** a lógica precisa ser mantida separada de DOM/render; o que é
  visual (modelos, HUD, câmera) ainda exige conferência no navegador.
