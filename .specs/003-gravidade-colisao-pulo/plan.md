# Plan 003 — Gravidade, colisão e pulo

> O COMO. Derivado da spec 003.

## Arquitetura

- Novo módulo **`src/player/collision.js`** (PURO, testável headless): dimensões
  do jogador + `collidesAABB(voxels, x, y, z)` que diz se o AABB do jogador
  (centrado no olho `x,y,z`) sobrepõe algum bloco sólido.
- **`src/player/controls.js`** reescrito: além do pointer lock + input, agora
  integra velocidade vertical, gravidade, pulo, modo voo e **resolução de
  colisão por eixo** usando `collidesAABB`.

```
controls.update(dt):
  1. direção horizontal (yaw) × input WASD → vetor move
  2. moveAxis('x', dx); moveAxis('z', dz)      // bloqueia por eixo
  3. se voo: dy por Espaço/Shift; senão: velY -= g·dt; dy = velY·dt
  4. moveAxis('y', dy); se bloqueou descendo → onGround, velY=0
```

## Contratos

### `src/player/collision.js`
```js
export const PLAYER = { halfWidth: 0.3, height: 1.8, eye: 1.62 };
// true se o corpo do jogador (olho em x,y,z) colide com bloco sólido
export function collidesAABB(voxels, x, y, z): boolean
```
Conversão para voxel coerente com world.js: `vx = floor(worldX + offsetX)`,
`vy = floor(worldY)`, `vz = floor(worldZ + offsetZ)`.

### `src/player/controls.js`
```js
export function createControls(camera, domElement, voxels):
  { controls, update(dt) }
```
- `moveAxis(axis, amount)`: subdivide em passos ≤ `MAX_STEP` (anti-tunneling);
  a cada passo testa `collidesAABB`; se colide, reverte o passo e para o eixo.
- `F` (keydown único) alterna `flyMode`.
- `Espaço`: em voo sobe; andando, pula se `onGround`.

## Constantes (fonte única em controls.js)
- `WALK_SPEED=6`, `RUN_MULT=1.8`, `FLY_SPEED=14`, `FLY_VERTICAL=12`
- `GRAVITY=28`, `JUMP_SPEED=9`, `MAX_STEP=0.2`

## Decisões técnicas
- **Resolução por eixo com revert** (em vez de "snap" ao bloco): simples e sem
  travamento; suficiente nas velocidades atuais com substep anti-tunneling.
- **Voo preservado** (tecla F): a feature 001 prometia voo; mantemos como modo.
  Registrado em ADR 0004.
- **Spawn caindo**: olho começa alguns blocos acima da superfície; gravidade faz
  pousar (valida critério 1 visualmente).

## Validação (mapeia critérios)
- Teste headless de `collidesAABB`: dentro de bloco = true; em ar livre = false;
  caixa sobre superfície sem sobrepor = false (crit. 7, 1–2).
- `npm run build` (crit. 8). Manual: cair, parede, pular, voo (crit. 1–6).
