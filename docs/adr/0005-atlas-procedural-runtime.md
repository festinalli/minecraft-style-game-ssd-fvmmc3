# ADR 0005 — Atlas de texturas procedural em runtime

- **Status:** Aceito (substitui o ADR 0002 quanto à aparência)
- **Data:** 2026-06-21

## Contexto

O ADR 0002 adiou texturas e usou cores sólidas na v1. A feature 004 traz
texturas. Poderíamos (a) adicionar arquivos de imagem (PNG) ao repo, ou (b)
gerar as texturas em runtime.

## Decisão

Gerar um **atlas de texturas proceduralmente em runtime**, desenhando os tiles
num `<canvas>` (ruído por pixel a partir das cores base dos blocos) e usando o
resultado como `THREE.CanvasTexture` com filtro **nearest**.

O layout do atlas (tile por bloco/face e UVs) fica num módulo **puro**,
separado da geração da imagem, para continuar testável headless.

## Consequências

- **Positivo:** o repositório segue 100% texto/código (sem binários); fácil de
  versionar e revisar; visual pixelado coerente com o gênero.
- **Negativo:** texturas são "geradas", não artísticas — menos detalhe que um
  pack real. Trocar por um atlas de arquivo no futuro é simples: basta carregar
  uma imagem em vez de gerar o canvas, mantendo o mesmo layout de UVs.
- O `vertex color` deixou de carregar a cor do bloco (agora vem da textura) e
  passou a carregar só o **sombreamento por face** (cinza), que multiplica o map.
- Substitui o ADR 0002 no que diz respeito à aparência dos blocos.
