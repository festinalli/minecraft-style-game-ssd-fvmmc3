# Spec 005 — Salvar / carregar mundo

> O QUÊ e o PORQUÊ.

## Intenção

Fazer o mundo **persistir entre sessões**: as edições do jogador (blocos
quebrados/colocados) e sua posição são salvas localmente e recarregadas ao
voltar. Construir deixa de ser efêmero.

## Por que agora

Quebrar/colocar (002) só tem valor duradouro se o que você constrói não some ao
recarregar a página. É a contrapartida natural da edição.

## Escopo

### Faz parte
- **Salvar** automaticamente no `localStorage` (após editar; ao pausar; ao sair).
- **Carregar** o mundo salvo ao iniciar, se compatível (mesma seed e dimensões).
- Restaurar a **posição do jogador**.
- Botão **"Novo mundo"** na tela inicial para descartar o save e recomeçar.
- **Versionamento** do formato: saves de versão incompatível são ignorados (cai
  no mundo gerado), sem quebrar.

### NÃO faz parte
- Múltiplos slots de save / nomear mundos.
- Salvar em arquivo/baixar; sincronização em nuvem.
- Persistência por chunk (só fará sentido com mundo infinito — feature 006).

## Critérios de aceitação

1. Editar o mundo e **recarregar a página** mantém as edições.
2. A posição do jogador é restaurada ao recarregar.
3. Clicar **"Novo mundo"** apaga o save e gera o mundo do zero.
4. Um save de **versão/dimensão incompatível** é descartado silenciosamente; o
   jogo inicia com o mundo gerado (sem erro).
5. **serialize/deserialize** do mundo é **round-trip exato** e verificável
   (mesmos bytes de volta).
6. `npm run build` conclui sem erros.
