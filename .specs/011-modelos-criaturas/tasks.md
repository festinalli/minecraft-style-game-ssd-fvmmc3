# Tasks 011 — Modelos das criaturas

- [x] T1 — `skins.js`: tabela de partes de cada tipo + `skinLayout` (empacotamento).
- [x] T2 — `skins.js`: pintores de skin (`pig`, `sheep` x4, `zombie`, `creeper`, `avatar`) + `skinPixels`.
- [x] T3 — `model.js`: cache de `DataTexture` + construção de View (UVs por face, hierarquia, fit pela hitbox).
- [x] T4 — `model.js`: `update` — andar, respirar, ferido, inchar/piscar, queimar (+ partículas).
- [x] T5 — `model.js`: `update` — atacar, morrer, item na mão do avatar; `dispose` idempotente.
- [x] T6 — `dev/mobs.html` + `dev/mobs.js`: galeria com botões de estado.
- [x] T7 — `tests/model.test.js` (skins, instanciação, bbox x hitbox, orientação, estados, dispose).
- [x] T8 — Revisão visual: 1ª carga da galeria no navegador embutido (WebGL real); depois, com o painel oculto, rasterizador por software (fora do repo) sobre as Views reais + leitura de pixels WebGL; console limpo.
- [x] T9 — ADR 0010 + `npm run build` verde (galeria fora do build) + marcar tasks.
