# Constitution — Princípios Inegociáveis

> Regras que valem pra tudo. Mudar isto é uma decisão de arquitetura (vira ADR).

## Stack e padrões fixos

- **Linguagem:** JavaScript (ES Modules). Sem TypeScript por enquanto (decisão
  reversível — viraria ADR se mudar).
- **Engine de render:** [Three.js](https://threejs.org/) (WebGL).
- **Bundler/dev server:** [Vite](https://vitejs.dev/).
- **Sem dependências de gameplay externas.** Ruído, física simples e geração de
  mundo são código próprio dentro de `src/`. Three.js é a única dependência de
  runtime.
- **Roda no navegador.** O artefato final é estático (HTML/JS), publicável em
  GitHub Pages sem servidor.

## O que NUNCA fazer

- Nunca renderizar um voxel como uma mesh individual por bloco. Sempre face
  culling em geometria agregada por chunk.
- Nunca usar aleatoriedade não-semeada na geração de mundo (quebra
  reprodutibilidade e testes).
- Nunca escrever código de feature antes de existir `spec.md` para ela.
- Nunca duplicar uma "verdade" (constante de gameplay, tamanho de chunk, etc.)
  em dois lugares. Defina uma vez e importe.
- Nunca editar o `README.md` da raiz do repositório (perfil pessoal do dono).

## Regras que valem pra tudo

1. **Determinismo:** mesma seed ⇒ mesmo mundo.
2. **Documentação viva:** spec/plan/tasks/ADR são atualizados no mesmo PR do
   código que descrevem. Uma verdade por fato.
3. **Pequenos passos:** features quebradas em tarefas verificáveis uma a uma
   (`tasks.md`), rastreáveis no PR.
4. **Performance primeiro no que é hot path:** geração e malha de mundo precisam
   rodar a 60 FPS num notebook comum.

## Convenções de gameplay (constantes canônicas)

> Fonte única: declaradas em código nos módulos indicados. Listadas aqui para
> referência humana — não duplicar valores em outros lugares.

- **Tamanho do chunk:** definido em `src/world/world.js` (`CHUNK_SIZE`).
- **Tipos de bloco e cores:** definidos em `src/blocks.js`.
- **Eixos:** Y é vertical (pra cima), seguindo a convenção do Three.js.
