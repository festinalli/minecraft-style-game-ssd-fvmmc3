# Spec 004 — Texturas (atlas)

> O QUÊ e o PORQUÊ.

## Intenção

Trocar as cores sólidas dos blocos (ADR 0002) por **texturas** com cara
"pixelada" de Minecraft, deixando o mundo visualmente reconhecível: grama por
cima e terra na lateral, pedra granulada, areia, etc.

## Por que agora

Render, edição e física já funcionam. O próximo salto de qualidade percebida é
visual. É barato fazer agora porque o pipeline de malha já existe — só
precisamos de UVs + um material com textura.

## Escopo

### Faz parte
- **Atlas de texturas gerado proceduralmente** em runtime (canvas) — sem
  arquivos de imagem no repositório.
- Texturas distintas por tipo de bloco: grama (topo/lateral diferentes), terra,
  pedra, areia.
- **UVs por face** na malha apontando para o tile correto do atlas.
- Filtro **nearest** (pixelado, sem borrão) e sombreamento direcional por face
  mantido (faces de cima mais claras).

### NÃO faz parte
- Texturas de arquivo/import de packs externos.
- Transparência, animação (água/lava), mipmaps.
- Ambient occlusion.

## Critérios de aceitação

1. Os blocos aparecem **texturizados** (não mais cor chapada); a grama tem
   topo verde e laterais de terra com faixa verde.
2. A textura é **pixelada** (filtro nearest), sem desfoque.
3. O sombreamento por face (topo mais claro) continua perceptível.
4. O atlas é gerado em runtime; **nenhum arquivo de imagem** é adicionado ao repo.
5. A geração de UVs é **determinística e verificável** (mesmo bloco/face ⇒ mesmo
   tile do atlas).
6. `npm run build` conclui sem erros e os testes headless de mundo continuam
   passando (a geometria agora também tem atributo `uv`).
