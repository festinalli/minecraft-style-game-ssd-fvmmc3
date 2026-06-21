# ADR 0004 — Física: colisão por eixo + modo voo preservado

- **Status:** Aceito
- **Data:** 2026-06-21

## Contexto

A feature 003 adiciona gravidade, colisão e pulo. Duas decisões:
(a) como resolver colisão; (b) o que fazer com o voo livre que a feature 001
oferecia.

## Decisão

1. **Colisão por eixo com revert + substep.** O movimento de cada frame é
   aplicado eixo a eixo (X, depois Z, depois Y), subdividido em passos de no
   máximo `MAX_STEP`; o passo que colidir é revertido e aquele eixo para. Sem
   "snap" ao bloco.
2. **Voo vira um modo alternável** pela tecla `F` (em vez de ser o padrão). O
   padrão passa a ser andar com gravidade; o voo continua disponível, agora
   também com colisão.

## Consequências

- **Positivo:** implementação simples e sem travamentos; o substep evita
  tunneling nas velocidades atuais; a promessa de voo da feature 001 é mantida.
- **Negativo:** o revert puro pode parecer levemente "grudento" ao deslizar em
  paredes (sem o deslize suave de um snap). Aceitável agora; pode virar snap
  numa feature de polish.
- A lógica de colisão fica numa função pura (`collidesAABB`) testável headless.
