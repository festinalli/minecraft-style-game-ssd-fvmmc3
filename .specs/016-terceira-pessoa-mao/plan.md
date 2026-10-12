# Plan 016 — Terceira pessoa e mão

- **`src/player/hand.js`** (novo): grupo filho da câmera da cabeça; materiais
  com `depthTest: false` e `renderOrder` alto para nunca cortar em paredes.
- **Câmeras**: `camera` = cabeça (lógica, movida por PointerLockControls e usada
  para raycast); `viewCam` = câmera de render em 3ª pessoa (posição = cabeça
  recuada; orientação copiada).
- **Avatar**: `createAvatarView()` (feature 011); `rotation.y = yawCabeça + π`
  (a câmera olha para −Z local, o modelo tem a frente em +Z).
- Recuo: passos de 0,2 bloco para trás até `getBlock != AIR`.
