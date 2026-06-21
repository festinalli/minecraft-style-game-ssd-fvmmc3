# Spec 002 — Quebrar e colocar blocos

> O QUÊ e o PORQUÊ. Sem código, sem solução.

## Intenção

Dar ao jogador a mecânica central do Minecraft: **mirar um bloco e interagir** —
remover com o botão esquerdo, colocar um bloco novo com o botão direito. O mundo
deixa de ser só paisagem e vira algo **editável**.

## Por que agora

É o próximo passo jogável mais valioso após ter mundo + câmera (feature 001).
Construir/destruir é o coração do gênero e desbloqueia features futuras
(salvar mundo só faz sentido se o mundo muda).

## Escopo

### Faz parte
- **Mira por raycast** a partir do centro da tela (para onde a câmera olha),
  com **alcance limitado** (algumas unidades).
- **Realce** (contorno) do bloco atualmente mirado.
- **Botão esquerdo**: remove o bloco mirado.
- **Botão direito**: coloca um bloco na face mirada (na posição vazia adjacente).
- **Seleção de tipo de bloco** pelo teclado (`1`–`4`: grama, terra, pedra, areia),
  com indicação visual de qual está selecionado.
- Atualização correta da malha após cada edição (faces expostas recalculadas).
- Não permitir colocar bloco **dentro do próprio jogador**.

### NÃO faz parte (fica pra depois)
- Persistência das edições (salvar/carregar) → feature 005.
- Física/queda de blocos, água, gravidade → feature 003.
- Animação/tempo de quebra, durabilidade, ferramentas.
- Inventário com quantidades limitadas → feature 007 (aqui blocos são infinitos).

## Critérios de aceitação

1. Com o mouse travado, ao olhar para um bloco a até ~8 blocos de distância, um
   **contorno** aparece destacando esse bloco; some quando não há bloco na mira.
2. **Clique esquerdo** remove o bloco mirado e a malha atualiza imediatamente
   (as faces que ficaram expostas passam a aparecer).
3. **Clique direito** coloca um bloco do tipo selecionado na face mirada; a malha
   atualiza imediatamente.
4. Teclas `1`–`4` trocam o tipo a colocar; a HUD mostra o tipo selecionado.
5. Não é possível colocar um bloco na célula onde o jogador está.
6. O menu de contexto do navegador **não** abre ao clicar com o botão direito
   durante o jogo.
7. `npm run build` conclui sem erros.
8. A conversão "ponto de impacto → coordenada de bloco" é correta para remover
   (bloco atingido) e para colocar (vizinho na direção da face) — verificável.
