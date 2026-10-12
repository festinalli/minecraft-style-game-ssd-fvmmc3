// Gerenciador de mobs (feature 013): dono das criaturas vivas. Junta a IA
// (`ai.js`, que só decide) com a física genérica (`physics.js`) e o mundo, e
// cuida de spawn/despawn, dano, morte, queima ao sol e explosão de creeper.
//
// HEADLESS quando `scene === null` (é assim que os testes e o `game.js`
// rodam); com `scene`, cada mob ganha uma View (`makeView(kind, {variant})`)
// posicionada em (pos, yaw) e atualizada a cada quadro.
//
// Convenções: Y para cima; `pos` de mob e do jogador = centro dos PÉS; tempo em
// segundos; HP inteiro. Aleatoriedade SÓ pelo `rng` injetado (nunca
// `Math.random`): mesma seed + mesma sequência de `ctx` ⇒ mesmos eventos.

import { BLOCK, isSolid } from '../blocks.js';
import { WORLD_HEIGHT, chunkCoord, chunkKey } from '../world/world.js';
import { dayNumber, isNight } from '../game/time.js';
import { PLAYER } from '../player/collision.js';
import { MOB_DEFS, MOB_KINDS, SPAWN } from './mobs.js';
import { KNOCK_CUTOFF, KNOCK_TAU, canStepUp, collidesBox, createBody, stepBody } from './physics.js';
import { STATE, VOICE, initMob, isTargetable, think } from './ai.js';
import { createMobView } from './model.js';

// --- Constantes de feitio (não são balanceamento de combate; esse é de mobs.js) ---
const MAX_DT = 0.1; // um quadro travado não pode "teleportar" a simulação
const HURT_HOP = 4; // b/s para cima ao ser golpeado no chão (sensação do golpe)
const EXPOSURE_EVERY = 0.25; // s entre reavaliações de "estou sob o céu?"
const GROUP_SPREAD = 2.5; // raio (blocos) em que um grupo se espalha
const POPULATE_ATTEMPTS = 60; // tentativas de `populate` antes de desistir
const STUCK_FRACTION = 0.25; // andou menos que isso do pretendido ⇒ "bloqueado"
const SEP_SPEED = 2; // b/s de afastamento entre dois corpos totalmente sobrepostos (cai a 0 ao se tocarem)
const LOS_STEP = 0.2; // blocos entre amostras da linha de visão
const TAU = Math.PI * 2;

const NO_EVENTS = Object.freeze([]);
const HOSTILE_KINDS = MOB_KINDS.filter((k) => MOB_DEFS[k].hostile);
const PASSIVE_KINDS = MOB_KINDS.filter((k) => !MOB_DEFS[k].hostile);

/**
 * @param {object} opts
 * @param {import('../world/world.js').World} opts.world
 * @param {ReturnType<import('../rng.js').makeRng>} opts.rng
 * @param {import('three').Scene|null} [opts.scene]  null = headless (sem Views)
 * @param {(kind:string, o?:{variant?:number}) => object} [opts.makeView]
 */
export function createMobManager({ world, rng, scene = null, makeView = createMobView }) {
  /** @type {Map<number, object>} id → Mob */
  const mobs = new Map();
  let nextId = 1;
  let pending = []; // eventos à espera do próximo `update` (dano feito fora dele)
  let spawnAcc = 0;
  let disposed = false;

  // Objetos reutilizados (zero alocação por quadro).
  const thinkCtx = { player: null, seconds: 0, events: pending, los: lineClear };
  const active = []; // mobs simulados neste quadro (reutilizada)
  const viewState = { speed: 0, hurt: 0, fuse: 0, burning: false, attack: 0, dying: 0 };
  const stepOut = { hitX: false, hitZ: false, hitCeiling: false, landed: false, impactVy: 0 };
  const stepOpts = { out: stepOut };

  /** O segmento a→b não atravessa nenhum bloco sólido? (amostras a cada `LOS_STEP`; extremos de fora) */
  function lineClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / LOS_STEP));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (isSolid(world.getBlock(Math.floor(ax + dx * t), Math.floor(ay + dy * t), Math.floor(az + dz * t)))) return false;
    }
    return true;
  }

  function flush() {
    if (pending.length === 0) return NO_EVENTS;
    const out = pending;
    pending = [];
    return out;
  }

  // -------------------------------------------------------------------------
  // Criar / remover
  // -------------------------------------------------------------------------

  function removeMob(mob) {
    mobs.delete(mob.id);
    if (mob.view) {
      mob.view.dispose();
      mob.view = null;
    }
  }

  function syncView(mob, dt, hSpeed) {
    const v = mob.view;
    if (!v) return;
    const p = mob.body.pos;
    v.object.position.set(p.x, p.y, p.z);
    v.object.rotation.y = mob.yaw;
    viewState.speed = hSpeed;
    viewState.hurt = mob.hurtT;
    viewState.fuse = mob.fuse;
    viewState.burning = mob.burning;
    viewState.attack = mob.attackT;
    viewState.dying = mob.dying;
    v.update(dt, viewState);
  }

  /**
   * Cria um mob. `y` = altura dos PÉS (cai com a gravidade se estiver no ar).
   * @param {string} kind
   * @param {{variant?: number}} [opts] cor da lã (ovelha); sorteada se omitida
   */
  function spawn(kind, x, y, z, opts) {
    const def = MOB_DEFS[kind];
    if (!def) throw new Error(`Criatura desconhecida: "${kind}" (esperado: ${MOB_KINDS.join(', ')})`);
    let variant = opts && Number.isInteger(opts.variant) ? opts.variant : -1;
    if (def.variants) variant = variant >= 0 ? variant % def.variants : rng.int(def.variants);
    else variant = 0;

    const id = nextId++;
    const mob = {
      id,
      kind,
      def,
      body: createBody({ x, y, z, halfW: def.halfW, height: def.height }),
      yaw: rng.range(-Math.PI, Math.PI),
      hp: def.maxHp,
      variant,
      dead: false,
      hurtT: 0,
      dying: 0,
      burning: false,
      kx: 0, // knockback horizontal atual (b/s), decai
      kz: 0,
      pushing: false, // o último passo bateu numa parede (aciona o teste de degrau)
      sepX: 0, // velocidade extra de afastamento de outros corpos (b/s), recalculada a cada quadro
      sepZ: 0,
      exposeT: (id % 5) * 0.05, // reavaliações de céu escalonadas
      exposed: false,
      burnAcc: 0,
      view: null,
    };
    initMob(mob, def, rng);
    mobs.set(id, mob);
    if (scene) {
      mob.view = makeView(kind, { variant });
      scene.add(mob.view.object);
      syncView(mob, 0, 0);
    }
    return mob;
  }

  // -------------------------------------------------------------------------
  // Dano e morte
  // -------------------------------------------------------------------------

  function rollDrops(def) {
    const drops = [];
    for (const d of def.drops) {
      const n = d.min + rng.int(d.max - d.min + 1);
      if (n > 0) drops.push({ item: d.item, count: n });
    }
    return drops;
  }

  function soundAt(name, mob) {
    const p = mob.body.pos;
    pending.push({ type: 'sound', name, x: p.x, y: p.y + mob.def.height * 0.5, z: p.z });
  }

  /**
   * Núcleo do dano. O dano SEMPRE vale; o empurrão e o flash vermelho só
   * acontecem fora da janela de imunidade (`hurtT > 0` = ainda piscando).
   * `quiet` (queimadura): sem som, sem fuga, sem empurrão.
   */
  function hurtMob(mob, amount, fromX, fromZ, knock, byPlayer, quiet) {
    if (mob.dead || !(amount > 0)) return { killed: false, drops: [] };
    const p = mob.body.pos;
    mob.hp = Math.max(0, mob.hp - amount);

    if (!quiet) {
      mob.hurtBy = Number.isFinite(fromX) && Number.isFinite(fromZ) ? { x: fromX, z: fromZ } : { x: p.x, z: p.z };
    }
    if (mob.hurtT <= 0) {
      mob.hurtT = 1;
      if (knock > 0) {
        const dx = p.x - fromX;
        const dz = p.z - fromZ;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 1e-6) {
          mob.kx = (dx / len) * knock;
          mob.kz = (dz / len) * knock;
        }
        if (mob.body.onGround) {
          mob.body.vel.y = HURT_HOP;
          mob.body.onGround = false;
        }
      }
    }

    if (mob.hp > 0) {
      if (!quiet) soundAt(VOICE[mob.kind] ?? 'hurt', mob);
      return { killed: false, drops: [] };
    }

    // morreu
    mob.dead = true;
    mob.state = STATE.DYING;
    mob.burning = false;
    mob.fuse = 0;
    mob.wish.x = 0;
    mob.wish.z = 0;
    mob.speed = 0;
    const drops = rollDrops(mob.def);
    soundAt('death', mob);
    pending.push({ type: 'mob-died', mob, drops, byPlayer });
    return { killed: true, drops };
  }

  /**
   * Golpe do jogador (ou de qualquer um de fora). `knock` em b/s, a partir de
   * (fromX, fromZ). Os drops sorteados voltam em `drops` E vão no evento
   * `mob-died` (que sai no próximo `update`): o host deve creditá-los UMA vez
   * (pelo retorno daqui).
   * @returns {{killed:boolean, drops:Array<{item:string,count:number}>}}
   */
  function damage(mob, amount, opts) {
    if (mobs.get(mob.id) !== mob) return { killed: false, drops: [] }; // já removido (despawn, explosão)
    const o = opts || {};
    return hurtMob(mob, amount, o.fromX, o.fromZ, o.knock || 0, true, false);
  }

  // -------------------------------------------------------------------------
  // Queima ao sol
  // -------------------------------------------------------------------------

  /** Nenhum bloco sólido na altura da cabeça nem acima, na coluna do mob. */
  function isSkyExposed(mob) {
    const p = mob.body.pos;
    const above = Math.floor(p.y + mob.def.height) + 1;
    return world.surfaceY(Math.floor(p.x), Math.floor(p.z)) <= above;
  }

  function burn(mob, dt, daylight) {
    const def = mob.def;
    if (!def.burnsInDaylight || !daylight) {
      mob.burning = false;
      mob.burnAcc = 0;
      return;
    }
    mob.exposeT -= dt;
    if (mob.exposeT <= 0) {
      mob.exposeT = EXPOSURE_EVERY;
      mob.exposed = isSkyExposed(mob);
    }
    mob.burning = mob.exposed;
    if (!mob.burning) {
      mob.burnAcc = 0;
      return;
    }
    mob.burnAcc += def.burnDps * dt;
    if (mob.burnAcc >= 1) {
      const whole = Math.floor(mob.burnAcc);
      mob.burnAcc -= whole;
      hurtMob(mob, whole, NaN, NaN, 0, false, true);
    }
  }

  // -------------------------------------------------------------------------
  // Explosão de creeper
  // -------------------------------------------------------------------------

  function explode(mob, player) {
    const def = mob.def;
    const p = mob.body.pos;
    const cx = p.x;
    const cy = p.y + def.height * 0.5;
    const cz = p.z;

    // 1) buraco: toda célula cujo CENTRO cai dentro de carveRadius (nunca y < 1)
    const r = def.carveRadius;
    const r2 = r * r;
    const blocks = [];
    const x0 = Math.floor(cx - r);
    const x1 = Math.floor(cx + r);
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(cy + r));
    const z0 = Math.floor(cz - r);
    const z1 = Math.floor(cz + r);
    for (let x = x0; x <= x1; x++) {
      const ddx = x + 0.5 - cx;
      for (let y = y0; y <= y1; y++) {
        const ddy = y + 0.5 - cy;
        for (let z = z0; z <= z1; z++) {
          const ddz = z + 0.5 - cz;
          if (ddx * ddx + ddy * ddy + ddz * ddz > r2) continue;
          if (world.getBlock(x, y, z) === BLOCK.AIR) continue;
          world.setBlock(x, y, z, BLOCK.AIR); // marca o chunk como modificado
          blocks.push({ x, y, z });
        }
      }
    }
    pending.push({ type: 'explosion', x: cx, y: cy, z: cz, radius: def.blastRadius, blocks });

    // 2) dano ao jogador pela distância ao CENTRO da explosão
    if (isTargetable(player)) {
      const pp = player.pos;
      const d = Math.sqrt(
        (pp.x - cx) * (pp.x - cx) + (pp.y + PLAYER.height * 0.5 - cy) * (pp.y + PLAYER.height * 0.5 - cy) + (pp.z - cz) * (pp.z - cz)
      );
      if (d < def.blastRadius) {
        pending.push({
          type: 'hurt-player',
          amount: Math.ceil(def.blastDamage * (1 - d / def.blastRadius)),
          source: def.kind,
          fromX: cx,
          fromZ: cz,
          knock: def.knockback,
          knockUp: def.knockbackUp,
        });
      }
    }

    // 3) dano (e empurrão) aos outros mobs na área
    for (const other of mobs.values()) {
      if (other === mob || other.dead) continue;
      const q = other.body.pos;
      const qy = q.y + other.def.height * 0.5;
      const d = Math.sqrt((q.x - cx) * (q.x - cx) + (qy - cy) * (qy - cy) + (q.z - cz) * (q.z - cz));
      if (d >= def.blastRadius) continue;
      hurtMob(other, Math.ceil(def.blastDamage * (1 - d / def.blastRadius)), cx, cz, def.knockback, false, false);
    }

    // 4) o creeper some (sem animação de corpo) e conta como morto
    mob.hp = 0;
    mob.dead = true;
    mob.state = STATE.DYING;
    pending.push({ type: 'mob-died', mob, drops: [], byPlayer: false });
    removeMob(mob);
  }

  // -------------------------------------------------------------------------
  // Movimento
  // -------------------------------------------------------------------------

  function turn(mob, dt) {
    let tx = mob.wish.x;
    let tz = mob.wish.z;
    if (tx === 0 && tz === 0) {
      tx = mob.face.x;
      tz = mob.face.z;
      if (tx === 0 && tz === 0) return;
    }
    let d = Math.atan2(tx, tz) - mob.yaw;
    d -= TAU * Math.round(d / TAU); // menor giro, em [-π, π]
    const max = mob.def.turnRate * dt;
    mob.yaw += d > max ? max : d < -max ? -max : d;
    mob.yaw -= TAU * Math.round(mob.yaw / TAU);
  }

  /**
   * `wish` vira velocidade horizontal (+ knockback exponencial, como o do
   * jogador), pulo automático, `stepBody`, e mede se o mob está preso.
   * @returns {number} velocidade horizontal real (b/s), para a View
   */
  function moveBody(mob, dt, canAct) {
    const def = mob.def;
    const body = mob.body;
    const vel = body.vel;
    const pos = body.pos;
    const wx = mob.wish.x;
    const wz = mob.wish.z;

    let vx = wx * mob.speed;
    let vz = wz * mob.speed;
    const knocked = mob.kx !== 0 || mob.kz !== 0;
    let f = 1;
    if (knocked) {
      // v(t) = k·e^(−t/τ): usa a velocidade MÉDIA do quadro, que torna o
      // deslocamento total independente do FPS (igual ao jogador).
      f = Math.exp(-dt / KNOCK_TAU);
      const avg = (KNOCK_TAU * (1 - f)) / dt;
      vx += mob.kx * avg;
      vz += mob.kz * avg;
    }
    if (canAct) {
      vx += mob.sepX;
      vz += mob.sepZ;
    }
    vel.x = vx;
    vel.z = vz;

    if (canAct && body.onGround && (wx !== 0 || wz !== 0)) {
      // degrau de 1 bloco (só testa quando bateu no quadro anterior) ou pulinho pedido pela IA
      if (mob.wantJump || (mob.pushing && canStepUp(world, body, wx, wz))) {
        vel.y = def.jumpSpeed;
        body.onGround = false;
      }
    }

    const px = pos.x;
    const pz = pos.z;
    stepBody(world, body, dt, stepOpts);
    mob.pushing = stepOut.hitX || stepOut.hitZ;

    if (knocked) {
      if (stepOut.hitX) mob.kx = 0;
      if (stepOut.hitZ) mob.kz = 0;
      mob.kx *= f;
      mob.kz *= f;
      if (mob.kx * mob.kx + mob.kz * mob.kz < KNOCK_CUTOFF * KNOCK_CUTOFF) {
        mob.kx = 0;
        mob.kz = 0;
      }
    }

    const mx = pos.x - px;
    const mz = pos.z - pz;
    const moved = Math.sqrt(mx * mx + mz * mz);
    const want = mob.speed * dt;
    if (canAct && !knocked && want > 0 && moved < want * STUCK_FRACTION) mob.blockedT += dt;
    else mob.blockedT = 0;
    return moved / dt;
  }

  /**
   * Afastamento suave entre corpos que se sobrepõem (sem isso, 3 zumbis que
   * chegam juntos viram um só, e porcos nascidos no mesmo ponto ficam empilhados).
   * Lê as posições do INÍCIO do quadro para todos (a ordem da lista não importa)
   * e guarda a velocidade extra em `sepX/sepZ`. O(n²) sobre ≤ ~20 mobs.
   */
  function separate(list) {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      list[i].sepX = 0;
      list[i].sepZ = 0;
    }
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (a.dead) continue;
      const pa = a.body.pos;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (b.dead) continue;
        const pb = b.body.pos;
        const min = a.def.halfW + b.def.halfW; // caixas se tocam a esta distância (em X ou Z)
        let dx = pa.x - pb.x;
        let dz = pa.z - pb.z;
        if (dx >= min || dx <= -min || dz >= min || dz <= -min) continue;
        if (Math.abs(pa.y - pb.y) >= Math.min(a.def.height, b.def.height)) continue; // um em cima do outro
        let d = Math.sqrt(dx * dx + dz * dz);
        if (d >= min) continue;
        if (d < 1e-6) {
          // exatamente no mesmo ponto: direção determinística a partir dos ids
          const th = a.id * 2.399963 + b.id;
          dx = Math.cos(th);
          dz = Math.sin(th);
          d = 1;
          const k0 = SEP_SPEED;
          a.sepX += dx * k0;
          a.sepZ += dz * k0;
          b.sepX -= dx * k0;
          b.sepZ -= dz * k0;
          continue;
        }
        const k = (SEP_SPEED * (1 - d / min)) / d;
        a.sepX += dx * k;
        a.sepZ += dz * k;
        b.sepX -= dx * k;
        b.sepZ -= dz * k;
      }
    }
  }

  function simulate(mob, dt, ctx, daylight) {
    const def = mob.def;
    if (mob.hurtT > 0) mob.hurtT = Math.max(0, mob.hurtT - dt / def.hurtTime);

    burn(mob, dt, daylight);
    if (mob.dead) return; // morreu queimado: o corpo é tratado no próximo quadro

    thinkCtx.player = ctx.player;
    think(mob, def, thinkCtx, rng, dt);
    if (mob.state === STATE.EXPLODE) {
      explode(mob, ctx.player);
      return;
    }
    const hSpeed = moveBody(mob, dt, true);
    turn(mob, dt);
    syncView(mob, dt, hSpeed);
  }

  function stepCorpse(mob, dt) {
    const def = mob.def;
    if (mob.hurtT > 0) mob.hurtT = Math.max(0, mob.hurtT - dt / def.hurtTime);
    mob.dying += dt / def.corpseTime;
    if (mob.dying >= 1) {
      mob.dying = 1;
      removeMob(mob);
      return;
    }
    mob.wish.x = 0;
    mob.wish.z = 0;
    mob.speed = 0;
    moveBody(mob, dt, false); // o corpo ainda escorrega pelo knockback e cai
    syncView(mob, dt, 0);
  }

  // -------------------------------------------------------------------------
  // Spawn / população
  // -------------------------------------------------------------------------

  function pickKind(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += MOB_DEFS[list[i]].spawn.weight;
    let r = rng.next() * total;
    for (let i = 0; i < list.length; i++) {
      r -= MOB_DEFS[list[i]].spawn.weight;
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  /**
   * Altura dos pés onde `def` pode nascer na coluna (bx, bz), ou -1: chunk já
   * gerado (opcional), bloco de suporte em `spawn.on` (copa de árvore e tronco
   * não servem), 2 blocos de ar acima e o corpo cabendo.
   */
  function columnFeetY(def, bx, bz, requireLoaded) {
    if (requireLoaded && !world.chunks.has(chunkKey(chunkCoord(bx), chunkCoord(bz)))) return -1;
    const top = world.surfaceY(bx, bz); // 1º bloco livre acima do topo sólido
    if (top < 1 || top + 2 > WORLD_HEIGHT) return -1;
    if (!def.spawn.on.includes(world.getBlock(bx, top - 1, bz))) return -1;
    if (collidesBox(world, bx + 0.5, top, bz + 0.5, def.halfW, def.height)) return -1;
    return top;
  }

  /**
   * Mobs vivos de um grupo (hostis ou passivos) que ainda existem para valer:
   * até `despawnDist` do jogador (mais longe somem no mesmo quadro). É a conta
   * dos tetos de população — nunca há mais que o teto de vivos de um grupo.
   */
  function countAlive(hostile, pp) {
    const r2 = SPAWN.despawnDist * SPAWN.despawnDist;
    let n = 0;
    for (const m of mobs.values()) {
      if (m.dead || m.def.hostile !== hostile) continue;
      const dx = m.body.pos.x - pp.x;
      const dz = m.body.pos.z - pp.z;
      if (dx * dx + dz * dz <= r2) n++;
    }
    return n;
  }

  /** Um grupo de `kind` a uma distância sorteada em [minD, maxD] do jogador. Devolve quantos nasceram. */
  function spawnGroup(kind, pp, minD, maxD, requireLoaded, room) {
    const def = MOB_DEFS[kind];
    const a = rng.angle();
    const d = rng.range(minD, maxD);
    const gx = pp.x + Math.cos(a) * d;
    const gz = pp.z + Math.sin(a) * d;
    const g = def.spawn.group;
    const size = Math.min(room, g[0] + rng.int(g[1] - g[0] + 1));
    let made = 0;
    for (let i = 0; i < size; i++) {
      let x = gx;
      let z = gz;
      if (i > 0) {
        x += rng.range(-GROUP_SPREAD, GROUP_SPREAD);
        z += rng.range(-GROUP_SPREAD, GROUP_SPREAD);
      }
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      const ex = bx + 0.5 - pp.x;
      const ez = bz + 0.5 - pp.z;
      if (ex * ex + ez * ez < minD * minD) continue; // nunca perto demais do jogador
      const y = columnFeetY(def, bx, bz, requireLoaded);
      if (y < 0) continue;
      spawn(kind, bx + 0.5, y, bz + 0.5);
      made++;
    }
    return made;
  }

  function trySpawning(dt, ctx) {
    spawnAcc += dt;
    if (spawnAcc < SPAWN.tryInterval) return;
    spawnAcc -= SPAWN.tryInterval;
    const player = ctx.player;
    const pp = player.pos;

    if (isTargetable(player) && isNight(ctx.seconds)) {
      const cap = Math.min(SPAWN.hostileCapMax, SPAWN.hostileCapBase + dayNumber(ctx.seconds));
      const have = countAlive(true, pp);
      if (have < cap) spawnGroup(pickKind(HOSTILE_KINDS), pp, SPAWN.minDist, SPAWN.maxDist, true, cap - have);
    }
    const havePassive = countAlive(false, pp);
    if (havePassive < SPAWN.passiveCap) {
      spawnGroup(pickKind(PASSIVE_KINDS), pp, SPAWN.minDist, SPAWN.maxDist, true, SPAWN.passiveCap - havePassive);
    }
  }

  /**
   * População inicial de passivos (início do jogo e depois do respawn):
   * completa até `SPAWN.initialPassive` entre `initialMinDist` e
   * `initialMaxDist`. Gera os chunks que precisar (é a carga inicial).
   * `_seconds` é aceito pelo contrato do brief e reservado.
   */
  function populate(playerPos, _seconds) {
    if (disposed) return;
    let need = SPAWN.initialPassive - countAlive(false, playerPos);
    for (let tries = 0; need > 0 && tries < POPULATE_ATTEMPTS; tries++) {
      need -= spawnGroup(pickKind(PASSIVE_KINDS), playerPos, SPAWN.initialMinDist, SPAWN.initialMaxDist, false, need);
    }
  }

  // -------------------------------------------------------------------------
  // Quadro
  // -------------------------------------------------------------------------

  /**
   * Avança todos os mobs `dt` s e devolve os eventos do quadro.
   * @param {number} dt
   * @param {{player:{pos:{x:number,y:number,z:number},alive?:boolean,mode?:string}, seconds:number}} ctx
   * @returns {Array<object>} `NO_EVENTS` (congelado, vazio) quando nada aconteceu
   */
  function update(dt, ctx) {
    thinkCtx.events = pending;
    if (disposed || !(dt > 0) || !ctx) return flush();
    if (dt > MAX_DT) dt = MAX_DT;
    thinkCtx.seconds = ctx.seconds;
    const pp = ctx.player && ctx.player.pos ? ctx.player.pos : null;

    if (pp) trySpawning(dt, ctx);

    const daylight = !isNight(ctx.seconds);
    const sim2 = SPAWN.simRadius * SPAWN.simRadius;
    const despawn2 = SPAWN.despawnDist * SPAWN.despawnDist;
    const far2 = SPAWN.daylightDespawnDist * SPAWN.daylightDespawnDist;
    // "por segundo" independente do FPS: 1 − (1 − p)^dt
    const dayGone = daylight ? 1 - Math.pow(1 - SPAWN.daylightDespawnChance, dt) : 0;

    active.length = 0;
    for (const mob of mobs.values()) {
      // Buraco até o fundo (saves antigos): quem cai no vazio some em vez de cair para sempre.
      if (mob.body.pos.y < SPAWN.voidY) {
        removeMob(mob);
        continue;
      }
      if (pp) {
        const dx = mob.body.pos.x - pp.x;
        const dz = mob.body.pos.z - pp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > despawn2) {
          removeMob(mob);
          continue;
        }
        if (d2 > sim2) continue; // congelado: longe demais para valer a simulação
        if (daylight && !mob.dead && mob.def.hostile && d2 > far2 && rng.chance(dayGone)) {
          removeMob(mob);
          continue;
        }
      }
      active.push(mob);
    }
    separate(active);
    for (let i = 0; i < active.length; i++) {
      const mob = active[i];
      if (mob.dead) stepCorpse(mob, dt);
      else simulate(mob, dt, ctx, daylight);
    }
    active.length = 0; // não segura referências a mobs removidos
    return flush();
  }

  // -------------------------------------------------------------------------
  // Raycast
  // -------------------------------------------------------------------------

  let t0 = 0;
  let t1 = 0;
  // Recorta [t0, t1] pelo "slab" [lo, hi] de um eixo; false se o raio erra.
  function slab(o, d, lo, hi) {
    if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) {
      const s = a;
      a = b;
      b = s;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    return t0 <= t1;
  }

  /**
   * Raio contra a AABB exata de cada mob VIVO. `dir` não precisa ser unitária.
   * O host compara `distance` com a do bloco mirado (não golpear através de parede).
   * @returns {{mob:object, distance:number, point:{x:number,y:number,z:number}}|null}
   */
  function raycast(origin, dir, maxDist) {
    let dx = dir.x;
    let dy = dir.y;
    let dz = dir.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-9) || !(maxDist >= 0)) return null;
    dx /= len;
    dy /= len;
    dz /= len;
    let best = null;
    let bestT = maxDist;
    for (const mob of mobs.values()) {
      if (mob.dead) continue;
      const p = mob.body.pos;
      const hw = mob.def.halfW;
      t0 = 0;
      t1 = bestT;
      if (
        slab(origin.x, dx, p.x - hw, p.x + hw) &&
        slab(origin.y, dy, p.y, p.y + mob.def.height) &&
        slab(origin.z, dz, p.z - hw, p.z + hw) &&
        (best === null || t0 < bestT)
      ) {
        best = mob;
        bestT = t0;
      }
    }
    if (!best) return null;
    return {
      mob: best,
      distance: bestT,
      point: { x: origin.x + dx * bestT, y: origin.y + dy * bestT, z: origin.z + dz * bestT },
    };
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  /** Mobs vivos (opcionalmente de um tipo). Corpos em animação de morte não contam. */
  function count(kind) {
    let n = 0;
    for (const m of mobs.values()) if (!m.dead && (kind === undefined || m.kind === kind)) n++;
    return n;
  }

  function clear() {
    for (const m of [...mobs.values()]) removeMob(m);
    pending = [];
    thinkCtx.events = pending;
    spawnAcc = 0;
  }

  /** Remove só os hostis (modo Criativo, respawn). */
  function clearHostiles() {
    for (const m of [...mobs.values()]) if (m.def.hostile) removeMob(m);
  }

  function dispose() {
    clear();
    disposed = true;
  }

  return { mobs, count, spawn, update, raycast, damage, populate, clear, clearHostiles, dispose };
}
