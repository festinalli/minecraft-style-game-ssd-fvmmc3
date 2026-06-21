# ADR 0001 — Stack web com Three.js + Vite

- **Status:** Aceito
- **Data:** 2026-06-21

## Contexto

Queremos um jogo estilo Minecraft (mundo de voxels) que seja fácil de mostrar e
distribuir, sem barreira de instalação para quem quer apenas jogar. O repositório
é um perfil pessoal no GitHub, então publicar como página estática (GitHub Pages)
é desejável.

Opções consideradas: Web/Three.js, C#/MonoGame, Python/Ursina, Unity.

## Decisão

Adotar **JavaScript (ES Modules) + Three.js + Vite**.

- Three.js abstrai WebGL e é maduro para render 3D.
- Vite dá dev server rápido e build estático.
- Artefato final é HTML/JS estático ⇒ publicável em GitHub Pages sem servidor.
- Zero instalação para o jogador (basta o navegador).

## Consequências

- **Positivo:** ciclo de feedback curto, fácil de compartilhar, sem assets
  pesados, alinhado a publicar no perfil.
- **Negativo:** menos alinhado à especialidade .NET do dono do repo; performance
  de voxel exige cuidado manual (face culling) por não ter engine de jogo
  dedicada.
- Three.js é a única dependência de runtime (ver `constitution.md`).
