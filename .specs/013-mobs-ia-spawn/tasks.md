# Tasks 013 — Mobs: IA, spawn e despawn

- [x] T1 — `mobs.js`: `SPAWN.daylightDespawnDist` (aditivo; promove o "24" do comentário).
- [x] T2 — `ai.js`: `AI`, `initMob`, passivo (`idle`/`wander`/`flee`) + vozes.
- [x] T3 — `ai.js`: zumbi (aggro com histerese, `chase`, `attack` com cooldown,
  desencalhar por lateralização).
- [x] T4 — `ai.js`: creeper (`chase`, `fuse` com início/abortar/decaimento,
  `explode`, hiss).
- [x] T5 — `manager.js`: mobs, `spawn`, `count`, `clear`/`clearHostiles`/`dispose`,
  física (velocidade desejada, pulo automático, knockback, `blockedT`, yaw),
  Views opcionais, congelar/despawn por distância.
- [x] T6 — `manager.js`: `damage` (knockback com imunidade, morte, drops, corpo),
  `raycast`, fila de eventos.
- [x] T7 — `manager.js`: queima de zumbi ao sol (abrigo impede) e explosão de
  creeper (blocos, dano ao jogador e a mobs).
- [x] T8 — `manager.js`: spawn/despawn por dia e noite (tetos, colunas válidas,
  grupos), despawn diurno, `populate`.
- [x] T8b — Jogabilidade além do brief: linha de visão do zumbi (`ctx.los` +
  `lineClear` no gerenciador: parede de 1 bloco abriga) e separação suave entre
  corpos (`separate`: sem mobs empilhados).
- [x] T9 — `tests/ai.test.js`.
- [x] T10 — `tests/manager.test.js` (física, porco, zumbi, queima, dano, creeper,
  população, despawn, raycast, determinismo, orçamento).
- [x] T11 — Playtest numérico headless do balanceamento (zumbi, creeper, fuga,
  queima) e registro dos achados.
- [x] T12 — ADR 0012 + build com `outDir` próprio + suíte inteira.
- [x] T13 — Integrador: ligar `game.update` ↔ eventos, `populate` no início e no
  respawn, descartar `mob-died.drops` (o `damage()` já entrega ao host), tocar
  `explosion` (o gerenciador **não** emite `sound 'explode'` à parte).
- [x] T14 — Validação manual no navegador — porco, ovelha, zumbi (perseguição, golpes,
  empurrão, queima ao sol) e creeper (pavio, explosão, cratera, dano) vistos e jogados.
