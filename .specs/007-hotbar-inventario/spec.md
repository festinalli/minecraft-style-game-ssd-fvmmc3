# Spec 007 — Hotbar / inventário

> O QUÊ e o PORQUÊ.

## Intenção

Ampliar a paleta de construção: mais tipos de bloco e uma **hotbar** mais
completa, com seleção por número e pela **roda do mouse**. Construir fica mais
expressivo.

## Por que agora

Já dá pra construir/destruir, com física, textura e save. O limitador agora é a
variedade: só 4 blocos. Mais blocos + seleção fluida aumentam muito o que dá
pra fazer, com custo baixo (reaproveita atlas e hotbar existentes).

## Escopo

### Faz parte
- **Novos blocos** colocáveis: madeira (tronco), folhas, tábuas, pedregulho.
- **Hotbar de 8 slots** (`1`–`8`), com o slot selecionado destacado.
- Seleção também pela **roda do mouse** (cicla os slots).
- Correção da **orientação das texturas** nas faces (V alinhado ao "para cima"
  do mundo), pra grama/madeira aparecerem com topo/lateral corretos.

### NÃO faz parte
- Inventário com grade/arrastar, quantidades/limites, craft.
- Coletar bloco ao quebrar (drops).
- Blocos com comportamento especial (folhas que decaem, etc.).

## Critérios de aceitação

1. Há **8 tipos** de bloco selecionáveis na hotbar; teclas `1`–`8` selecionam.
2. A **roda do mouse** cicla a seleção (pra frente e pra trás), com wrap-around.
3. O slot selecionado fica visivelmente destacado e reflete a seleção atual.
4. Os novos blocos podem ser **colocados e quebrados** como os antigos.
5. Texturas aparecem **na orientação certa** (ex.: faixa de grama no topo da
   face lateral, não rotacionada).
6. O mapeamento (bloco, face) → tile do atlas continua **verificável** e os UVs
   ficam dentro do tile correto.
7. `npm run build` conclui sem erros e os testes headless seguem passando.
