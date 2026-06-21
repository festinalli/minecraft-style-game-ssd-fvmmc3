# ADR 0002 — Cores sólidas (sem texturas) na v1

- **Status:** Aceito
- **Data:** 2026-06-21

## Contexto

Minecraft é reconhecível pelas texturas dos blocos. Texturas exigem um pipeline
de assets (atlas, UVs, carregamento, filtragem `nearest` para o look pixelado).
A feature 001 ("Mundo voxel + câmera") foca em provar render + navegação.

## Decisão

Na v1, blocos usam **cores sólidas por tipo** (vertex colors), com faces
superiores levemente mais claras para dar leitura de volume. Nada de texturas.

## Consequências

- **Positivo:** elimina pipeline de assets agora; mantém a feature pequena e
  focada; ainda dá leitura clara de relevo e tipos de bloco.
- **Negativo:** visual menos "Minecraft". Texturas/atlas viram uma feature
  futura própria (`.specs/<feature>/`), que provavelmente trocará
  `vertexColors` por UVs + material com `map`.
