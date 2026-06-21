# ADR 0003 — Edição por raycast e rebuild da malha inteira

- **Status:** Aceito
- **Data:** 2026-06-21

## Contexto

A feature 002 adiciona quebrar/colocar blocos. Duas decisões surgem:
(a) como mirar o bloco; (b) como atualizar a geometria após a edição.

## Decisão

1. **Mira por `THREE.Raycaster`** a partir do centro da tela contra a malha do
   mundo, com alcance limitado (`REACH = 8`). O ponto de impacto + a normal da
   face determinam o bloco atingido (remover) e o vizinho (colocar).
2. **Rebuild da malha inteira** (`buildWorldMesh`) após cada edição, em vez de
   editar buffers incrementalmente.

## Consequências

- **Positivo:** simples e correto; reaproveita 100% do pipeline de face culling
  existente; mundo finito pequeno (~30k tris) torna o rebuild barato.
- **Negativo:** não escala para mundos grandes/streaming — aí o rebuild deveria
  ser por chunk afetado. Quando a feature 006 (streaming de chunks) chegar, a
  geometria será dividida por chunk e o rebuild passará a ser localizado.
- A lógica de conversão impacto→voxel foi isolada em `resolveTarget` (função
  pura) para ser testável sem WebGL.
