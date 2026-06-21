# Spec 001 — Mundo voxel + câmera em primeira pessoa

> O QUÊ e o PORQUÊ. Sem código, sem solução. Só intenção e critérios.

## Intenção

Dar ao jogador um **mundo de blocos navegável**: ao abrir o jogo, ele vê um
terreno voxel gerado proceduralmente e consegue andar e olhar em volta em
primeira pessoa. Esta é a fundação sobre a qual todas as features futuras
(quebrar/colocar blocos, inventário, salvar mundo) serão construídas.

## Por que agora

Sem um mundo renderizado e uma câmera controlável, nenhuma outra mecânica pode
ser vista ou testada. É o menor passo que entrega algo "sentível" e prova que o
pipeline de render + geração de mundo funciona a 60 FPS.

## Escopo

### Faz parte
- Geração procedural e **determinística** de um terreno de blocos (varia em
  altura — colinas suaves).
- Diferentes tipos de bloco visíveis por altura (ex.: grama no topo, terra
  abaixo, pedra no fundo).
- Câmera em **primeira pessoa** com:
  - olhar com o mouse (pointer lock);
  - movimento **WASD** no plano;
  - subir/descer (voo livre) — ainda sem gravidade/colisão.
- Tela inicial simples ("clique para jogar") e indicação de controles.
- Iluminação básica para dar volume aos blocos.

### NÃO faz parte (fica pra depois)
- Quebrar ou colocar blocos.
- Gravidade, colisão e pulo.
- Múltiplos chunks com streaming infinito.
- Texturas/atlas (usaremos cores sólidas por enquanto).
- Salvar/carregar mundo, inventário, multiplayer.

## Critérios de aceitação

1. Ao rodar `npm run dev` e abrir o navegador, aparece uma tela inicial pedindo
   um clique.
2. Após o clique, o mouse é capturado e mover o mouse gira a câmera.
3. `W/A/S/D` movem a câmera na direção correspondente à direção do olhar
   (no plano horizontal); `Espaço` sobe e `Shift` desce.
4. `Esc` libera o mouse e volta à tela de "pausa".
5. O terreno é **o mesmo toda vez** que se roda com a mesma seed (determinístico).
6. O terreno tem variação de altura visível e pelo menos 3 tipos de bloco
   distinguíveis por cor.
7. Roda fluido (alvo: ~60 FPS) num notebook comum para o tamanho de mundo
   definido no plano.
8. `npm run build` conclui sem erros e gera artefato estático.
