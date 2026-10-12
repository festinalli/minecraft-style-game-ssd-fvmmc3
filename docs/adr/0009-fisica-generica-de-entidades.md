# ADR 0009 — Física genérica de entidades (jogador e mobs no mesmo código)

- **Status:** Aceito (estende o ADR 0004; não o substitui)
- **Data:** 2026-10-11

## Contexto

O ADR 0004 resolveu colisão e gravidade só para o jogador, dentro de
`controls.js` (que depende de Three.js e do DOM, logo não roda em teste
headless). A Parte 2 coloca ~18 criaturas no mundo: todas precisam de gravidade,
colisão e anti-tunneling, e o jogador precisa de distância de queda (dano) e
knockback. Copiar o `moveAxis` em cada mob duplicaria a "verdade" da colisão.

## Decisão

1. **Um módulo puro, `src/entities/physics.js`**, é a única implementação de
   colisão e movimento: `collidesBox`, `createBody`, `stepBody`, `canStepUp`,
   `GRAVITY`. Só usa `world.getBlock` e `isSolid` (sem Three.js, sem DOM).
2. **Mesmo algoritmo do ADR 0004**: eixo a eixo (X, Z, Y), passos de no máximo
   0,2 bloco, revert do passo que colide, sem "snap". O jogador passa a usar o
   mesmo `stepBody` dos mobs; a trajetória antiga é preservada (testada contra
   uma cópia da integração antiga, a 1e-9).
3. **`collidesAABB` vira um adaptador** olho → pés sobre `collidesBox`.
4. **Jogador em função pura** (`stepPlayer` + `createPlayerState`, knock, voo,
   queda) no próprio `physics.js`; `controls.js` fica só com eventos e a ligação
   câmera ↔ corpo. Assim a API nova (`onLand`, `knock`, `setFlyAllowed`,
   `teleport`, `resetFall`) é testável sem navegador.
5. **Corpo preso é impossível**: se a caixa já nasce sobreposta a blocos, o
   `stepBody` a empurra para cima, de aresta em aresta, até liberar.
6. **Queda medida pelo pico**: `peakY − pouso`, filtrada por
   `LAND_MIN_DISTANCE` (0,25 > `MAX_STEP`) para ignorar a "tremida" de
   assentamento que o revert deixa depois de um pouso.
7. **Knockback** com decaimento exponencial (constante de tempo 0,25 s),
   integrado de forma exata por quadro (deslocamento independente do FPS).
8. **`impactVy` é a velocidade vertical com sinal** (negativa no pouso).

## Consequências

- **Positivo:** uma verdade para a colisão; mobs e jogador se comportam igual;
  a física inteira roda no `node --test`; o jogo da Parte 1 não muda de
  sensação (andar 6, correr ×1,8, voo 14/12, pulo 9, gravidade 28).
- **Negativo:** o revert deixa o corpo até 0,2 bloco acima do chão e `onGround`
  pode piscar por alguns quadros após um pouso forte; quem consome `landed`
  (que é literal) deve filtrar, como `stepPlayer` faz. A colisão de borda
  continua inclusiva (encostar exatamente na aresta de um bloco conta).
- **Registrado:** as constantes de movimento do jogador (`MOVE`) saíram de
  `controls.js` para `physics.js`; `controls.js` não tem mais constante de
  gravidade. Um "snap" ao chão (que eliminaria a tremida) fica para uma feature
  de polimento e exigiria rever o teste de regressão.
