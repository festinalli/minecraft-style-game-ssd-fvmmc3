# Spec 006 — Mundo infinito (streaming de chunks)

> O QUÊ e o PORQUÊ. Pivô arquitetural (ver ADR 0006).

## Intenção

Tornar o mundo **virtualmente infinito** no plano horizontal: em vez de um mapa
finito carregado de uma vez, o terreno é dividido em **chunks** gerados e
exibidos **sob demanda** ao redor do jogador, e descarregados quando ficam longe.

## Por que agora

Era a peça que faltava pro "Minecraft de verdade": explorar sem parede invisível.
As features anteriores (edição, física, textura, save, hotbar) já estão sólidas e
serão adaptadas ao novo modelo de mundo.

## Escopo

### Faz parte
- Mundo dividido em **chunks** (coluna finita em Y, infinito em X/Z).
- **Geração determinística** por coordenada global: mesma seed ⇒ mesmo mundo
  infinito.
- **Streaming:** chunks dentro de um raio do jogador ganham malha; fora do raio,
  a malha é descarregada. Carregamento **incremental** (orçado por frame) pra não
  travar.
- **Face culling correto nas bordas** entre chunks (vizinho gerado sob demanda).
- Edição, colisão e save **adaptados** a chunks:
  - editar rebuilda só o chunk afetado (e o vizinho, se a borda mudou);
  - colisão consulta blocos por coordenada global (gera sob demanda);
  - save guarda **apenas os chunks modificados** (+ seed e posição).

### NÃO faz parte
- Geração de biomas/estruturas (árvores, cavernas) — segue terreno por altura.
- LOD/meshing greedy; multithreading (web workers).
- Altura infinita (Y continua finito).

## Critérios de aceitação

1. Andar numa direção revela terreno novo continuamente; não há borda/parede.
2. Chunks distantes são descarregados (a malha some), mantendo a performance.
3. O terreno é **determinístico**: a mesma seed gera o mesmo mundo, e revisitar
   um lugar mostra o mesmo terreno (salvo edições).
4. Quebrar/colocar funciona em qualquer chunk; a borda entre chunks atualiza
   corretamente (sem buracos nem faces sobrando).
5. Gravidade/colisão funcionam em qualquer chunk, inclusive recém-revelado.
6. Recarregar a página mantém as **edições** (chunks modificados persistem) e a
   posição; chunks não tocados são regenerados da seed.
7. O carregamento é incremental (sem congelar vários segundos ao cruzar chunks).
8. Conversões de coordenada (global↔chunk/local), geração e save por chunk são
   **verificáveis** por teste headless; `npm run build` OK.
