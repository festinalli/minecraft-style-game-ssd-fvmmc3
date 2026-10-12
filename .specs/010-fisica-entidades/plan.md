# Plan 010 — Física de entidades

> O COMO. Derivado da spec 010.

## Arquitetura

```
src/entities/physics.js   PURO (usa só world.getBlock + blocks.isSolid)
  ├─ colisão genérica:  collidesBox
  ├─ corpo:             createBody, stepBody, canStepUp   ← mobs usam isto
  └─ jogador (puro):    createPlayerState, stepPlayer, toggleFly, allowFly,
                        knockPlayer, teleportPlayer, resetPlayerFall
src/player/collision.js   PLAYER + collidesAABB (olho→pés) → delega a collidesBox
src/player/controls.js    FINO: eventos de teclado/mouse → input; câmera ↔ corpo
```

Dependências: `controls.js → physics.js`, `collision.js → physics.js`.
`physics.js` **não** importa `collision.js` nem Three.js (sem ciclo, roda no
Node). A altura do olho (`PLAYER.eye`) só aparece em `controls.js` e
`collision.js`: o corpo vive em **pés**, a câmera = pés + `eye`.

## Contratos

### `physics.js` (brief §4.3 — não muda)
```js
export const GRAVITY = 28;
export function collidesBox(world, x, feetY, z, halfW, height): boolean;
export function createBody({ x, y, z, halfW, height }): Body;
//   Body = { pos:{x,y,z}, vel:{x,y,z}, halfW, height, onGround }   (pos = PÉS)
export function stepBody(world, body, dt, opts?): { hitX, hitZ, landed, impactVy };
export function canStepUp(world, body, dirX, dirZ): boolean;
```
Extras (aditivos, não quebram o contrato): `MAX_STEP`, `STEP_REACH`,
`LAND_MIN_DISTANCE`, `KNOCK_TAU`, `MOVE`; `opts = { gravity = true, out }`;
resultado com `hitCeiling`; `canStepUp(..., reach = STEP_REACH)`.

### `stepBody(world, body, dt, opts)` — ordem fixa
1. **Desencalhar:** se a caixa já colide, sobe até a próxima aresta de bloco
   (`floor(y) + 1`) repetidamente até liberar (teto de `MAX_UNSTICK`
   iterações); zera `vel.y` negativa. X/Z não mudam.
2. `vel.y > 0` ⇒ `onGround = false` (subindo não é "no chão").
3. Gravidade: `vel.y -= GRAVITY * dt` (Euler semi-implícito, igual à Parte 1).
4. Mover **X, depois Z, depois Y** com `moveAxis`: subdivide em passos
   ≤ `MAX_STEP` (0,2), testa `collidesBox` a cada passo, **reverte** o passo que
   colide e para aquele eixo (sem "snap" — ADR 0004). Eixo bloqueado ⇒
   `vel[eixo] = 0` e `hitX`/`hitZ`.
5. Y bloqueado descendo ⇒ `onGround = true`; `landed = true` só se não estava no
   chão no início (`impactVy = vel.y` antes de zerar, negativo). Y bloqueado
   subindo ⇒ `hitCeiling`. Y livre ⇒ `onGround = false`.

O chamador é dono da velocidade horizontal (a IA define `vel.x/z` a cada
quadro; o jogador soma andar + knock). Zero alocação no caminho feliz;
`opts.out` reaproveita o objeto de resultado.

### `canStepUp(world, body, dirX, dirZ, reach = 0.3)`
Direção normalizada; `px,pz` = centro do corpo deslocado `reach` à frente.
`true` sse: (1) a caixa em `px,pz` na altura atual **colide** (há o que subir),
(2) a caixa em `px,pz` elevada **1 bloco** **não** colide (degrau de 1 com
altura livre — para o zumbi são 2 blocos livres acima do degrau; para o porco,
1) e (3) a caixa no lugar atual elevada 1 bloco não colide (cabe a cabeça ao
subir). Predicado geométrico: o chamador confere `onGround`. `STEP_REACH` (0,3) é maior
que `MAX_STEP` (0,2): quem foi bloqueado por uma parede ficou a menos de um
passo dela, então o degrau sempre cai dentro do alcance. Com o alcance padrão a
condição (3) é implicada pela (2); ela só pesa com `reach` maior.

### Jogador (puro, em `physics.js`)
```js
createPlayerState(body)  → { body, flying, flyAllowed, kx, kz, peakY }
stepPlayer(world, st, input, dt, out?)
  → { hitX, hitZ, landed, impactVy, hitCeiling, fall }
//   input = { moveX, moveZ /* unitário ou 0 */, run, up, down, jump }
```
- Horizontal: `vel.x = moveX * hSpeed + kx` (mesma expressão da Parte 1; somar
  `0` não altera o resultado). Voo: `vel.y = ±FLY_VERTICAL`, sem gravidade,
  `onGround = false`, sem `landed`.
- Pulo: `input.jump && !flying && onGround` ⇒ `vel.y = MOVE.jump`.
- **Knock:** `knockPlayer` define `kx,kz` = vetor horizontal normalizado ×
  força (o golpe novo substitui o anterior) e, se `up > 0`, `vel.y = up`,
  `onGround = false` e zera a referência de queda. A cada quadro
  `k *= exp(-dt / KNOCK_TAU)` (`KNOCK_TAU = 0.25 s`); abaixo de 0,05 b/s vira 0;
  parede em X/Z zera o eixo.
- **Queda:** `peakY` = maior Y dos pés desde que saiu do chão; no chão e em voo
  acompanha `pos.y`. No pouso, `fall = peakY − pos.y` se ≥ `LAND_MIN_DISTANCE`
  (0,25), senão 0. O limiar existe por causa da colisão por revert: depois de um
  pouso o corpo fica a < `MAX_STEP` do chão e "tremula" até assentar (alguns
  `landed` de distância < 0,2). Sem filtro, `onLand` dispararia várias vezes.
- `teleportPlayer(st, x, feetY, z)`: pés, `vel = 0`, `k = 0`,
  `onGround = false`, `peakY = feetY`.

### `controls.js`
`createControls(camera, domElement, world, { onLand }?)` → `{ controls, update,
knock, setFlyAllowed, isFlying, isOnGround, teleport, resetFall, body }`.
- `body.pos` = `camera.position − eye`. A câmera é reescrita a cada `update`;
  se alguém a moveu por fora (ex.: `main.js` da Parte 1), o corpo adota a
  posição como `teleport` (sem velocidade, sem queda acumulada).
- Teclas: `F` → `toggleFly` (no-op se voo proibido); `Espaço` → pulo (pedido de
  1 quadro, consumido em `update`) ou, em voo, `up`.
- `update(dt)`: sem pointer lock não faz nada (igual à Parte 1). Caso contrário
  monta `input` (direção do olhar → `moveX/moveZ`), chama `stepPlayer`, escreve
  a câmera e dispara `onLand(fall)` quando `fall > 0`.

## Decisões técnicas
- **Revert por passo, sem snap** (ADR 0004 mantido) para a trajetória do jogador
  ficar idêntica à da Parte 1; custo: o filtro `LAND_MIN_DISTANCE` na queda.
- **Colisão de borda inclusiva** herdada (`floor(max)`): encostar *exatamente*
  na aresta conta como colisão. Mantém `collidesAABB` idêntico ao antigo.
- **Tracker de queda no estado do jogador**, não no `Body`: o contrato do corpo
  fica enxuto e os mobs não pagam por isso.
- `impactVy` com sinal (negativo) — é uma velocidade; magnitude = `-impactVy`.
- ADR 0009 registra a decisão (física genérica compartilhada jogador/mobs).

## Validação (mapeia critérios)
- `tests/physics.test.js` (mundo real da seed 1337 + mundos planos montados com
  `world.setBlock`): crit. 2 (colisão por eixo, equivalência com a cópia da
  função antiga), 3 e 4 (gravidade, pouso, `dt` grande, deslize), 5
  (`canStepUp` + simulação de pulo do zumbi), 6 (desencalhar), 7 (regressão
  contra cópia da integração antiga), 8 (queda), 9 (knock), 10 (voo/teleport),
  1 (varredura do código-fonte).
- `createControls` com DOM falso (listeners capturados) prova a API final.
- `npm run build` (crit. 11). Manual (humano): andar, pular, voo, cair de 5+
  blocos e ver o pouso.
