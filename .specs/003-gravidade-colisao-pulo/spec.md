# Spec 003 — Gravidade, colisão e pulo

> O QUÊ e o PORQUÊ.

## Intenção

Transformar a câmera "fantasma" (voo livre) num **personagem físico**: ele cai
por gravidade, **não atravessa blocos** (colisão), anda pelo chão e **pula**.
É o que faz o mundo parecer sólido e dá peso à exploração.

## Por que agora

Construir/destruir (002) já existe; sem física, o mundo ainda é etéreo. Colisão
+ gravidade são pré-requisito pra sensação de "estar no mundo" e pra futuras
mecânicas (cair, ficar preso, plataformas).

## Escopo

### Faz parte
- **Gravidade** puxando o jogador pra baixo até pousar em chão sólido.
- **Colisão AABB** do jogador contra os blocos (não atravessa em X, Y, Z).
- **Pulo** com `Espaço` quando está no chão.
- **Modo voo** alternável (tecla `F`) que desliga a gravidade e volta ao
  comportamento de subir/descer (preserva a feature 001), ainda com colisão.
- Spawn caindo de uma pequena altura sobre o terreno.

### NÃO faz parte
- Dano de queda, fôlego, nado/água (feature futura).
- Agachar, correr com stamina.
- Física de blocos (areia caindo, etc.).

## Critérios de aceitação

1. Ao iniciar (modo andar), o jogador **cai e pousa** sobre o terreno, parando
   sobre a superfície (sem afundar nem flutuar).
2. Andar contra uma parede de blocos **não** atravessa: o movimento horizontal
   é bloqueado naquele eixo, mas continua livre nos outros.
3. `Espaço` no chão faz **pular**; no ar não há pulo duplo.
4. `F` alterna **modo voo**: gravidade desliga, `Espaço`/`Shift` sobem/descem;
   `F` de novo religa a gravidade.
5. Em modo voo, o jogador também **não atravessa** blocos.
6. Sem tunneling em velocidade normal (movimento é subdividido em passos).
7. A detecção de colisão (AABB × grade de voxels) é **verificável** por teste.
8. `npm run build` conclui sem erros.
