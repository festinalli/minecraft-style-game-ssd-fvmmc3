// Regras do jogo da Parte 2 (SEM DOM, SEM câmera): junta tempo, vida, inventário
// e criaturas, e traduz o que acontece em EVENTOS para o host (main.js) tocar
// som, atualizar HUD, empurrar o jogador e reconstruir malhas.
//
// Tudo aqui roda no Node: é o que os testes de "loop jogável" exercitam.

import { DAY_LENGTH, START_SECONDS, dayNumber, isNight } from './time.js';
import { MODE, createStats, fallDamage, isMode } from './stats.js';
import { GAME_VERSION } from '../world/persistence.js';
import { createInventory } from './inventory.js';
import { createMobManager } from '../entities/manager.js';
import { COMBAT, DAMAGE, FOOD, ITEM, ITEM_LABEL, MELEE_REACH, blockDrop } from './items.js';
import { MOB_DEFS } from '../entities/mobs.js';

const NO_EVENTS = Object.freeze([]);

/**
 * @param {object} opts
 * @param {import('../world/world.js').World} opts.world
 * @param {ReturnType<import('../rng.js').makeRng>} opts.rng
 * @param {import('three').Scene|null} [opts.scene]   null = headless (sem Views)
 * @param {Function} [opts.makeView]
 * @param {'survival'|'creative'} [opts.mode]
 * @param {object|null} [opts.saved]  objeto `game` vindo do save (ou null)
 */
export function createGame({ world, rng, scene = null, makeView, mode = MODE.SURVIVAL, saved = null }) {
  const stats = createStats({ mode });
  const inventory = createInventory({ mode });
  const mobs = createMobManager({ world, rng, scene, ...(makeView ? { makeView } : {}) });

  let seconds = START_SECONDS;
  let eatCd = 0;
  let attackCd = 0;
  let isNewGame = true;

  function applySave(obj) {
    if (!obj || obj.v !== GAME_VERSION) return false;
    // O modo do envelope vale em caso de conflito com o de stats/inventory (spec 012):
    // aplica antes E depois dos fromJSON, que também carregam um `mode` próprio.
    const applyMode = () => {
      if (isMode(obj.mode)) {
        stats.setMode(obj.mode);
        inventory.setMode(obj.mode);
      }
    };
    applyMode();
    if (Number.isFinite(obj.seconds) && obj.seconds >= 0) seconds = obj.seconds;
    if (obj.stats) stats.fromJSON(obj.stats);
    if (obj.inventory) inventory.fromJSON(obj.inventory);
    applyMode();
    return true;
  }

  if (saved && applySave(saved)) {
    isNewGame = false;
  } else if (mode === MODE.SURVIVAL) {
    inventory.giveStarterKit();
  }

  function pushSound(out, name, x, y, z) {
    out.push({ type: 'sound', name, x, y, z });
  }

  // ---- Dano ao jogador (única porta de entrada) ----
  function hurtPlayer(out, amount, source, fromX, fromZ, knock, knockUp) {
    const r = stats.damage(amount, { source });
    if (r.applied <= 0) return;
    out.push({
      type: 'player-hurt',
      amount: r.applied,
      source,
      knock: knock ? { fromX, fromZ, strength: knock, up: knockUp ?? 0 } : null,
    });
    if (r.died) out.push({ type: 'player-died', cause: source });
  }

  return {
    stats,
    inventory,
    mobs,

    get seconds() {
      return seconds;
    },
    get day() {
      return dayNumber(seconds);
    },
    get night() {
      return isNight(seconds);
    },
    get mode() {
      return stats.mode;
    },
    get isNewGame() {
      return isNewGame;
    },

    /** Ajusta o relógio do mundo (testes, playtest e futuros comandos). */
    setSeconds(s) {
      if (Number.isFinite(s) && s >= 0) seconds = s;
    },

    /** Troca de modo sem perder o mundo (o que mudou é regra, não dado). */
    setMode(m) {
      if (!isMode(m)) return;
      if (m === stats.mode) return;
      stats.setMode(m);
      inventory.setMode(m);
      if (m === MODE.CREATIVE) mobs.clearHostiles();
    },

    /** Povoa o mundo com animais ao iniciar/renascer. */
    populate(playerFeet) {
      mobs.populate(playerFeet, seconds);
    },

    /**
     * Avança o jogo em `dt` s. `player.pos` = centro dos PÉS.
     * @returns {Array} eventos para o host
     */
    update(dt, player) {
      const out = [];
      if (!stats.dead) {
        seconds += dt;
        stats.update(dt);
      }
      if (eatCd > 0) eatCd -= dt;
      if (attackCd > 0) attackCd -= dt;

      const events = mobs.update(dt, {
        player: { pos: player.pos, alive: !stats.dead, mode: stats.mode },
        seconds,
      });
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.type) {
          case 'hurt-player':
            hurtPlayer(out, e.amount, e.source, e.fromX, e.fromZ, e.knock, e.knockUp);
            break;
          case 'explosion':
          case 'sound':
          case 'mob-died':
            out.push(e);
            break;
          default:
            break;
        }
      }
      return out.length ? out : NO_EVENTS;
    },

    /** O jogador pousou depois de cair `distance` blocos. */
    onLand(distance) {
      const out = [];
      if (stats.mode !== MODE.SURVIVAL || stats.dead) return NO_EVENTS;
      const dmg = fallDamage(distance);
      if (dmg > 0) hurtPlayer(out, dmg, 'fall', 0, 0, 0, 0);
      return out.length ? out : NO_EVENTS;
    },

    /**
     * Clique esquerdo: tenta golpear uma criatura na mira.
     * @param {{origin:{x,y,z}, dir:{x,y,z}, blockDistance:number}} ray  dir unitário
     * @returns {{hit:boolean, events:Array}} hit=true => o clique foi consumido
     */
    attack(ray) {
      const out = [];
      if (stats.dead) return { hit: false, events: NO_EVENTS };
      const target = mobs.raycast(ray.origin, ray.dir, MELEE_REACH);
      // Não golpeia através de paredes: o bloco mirado tem que estar mais longe.
      if (!target || target.distance >= ray.blockDistance) return { hit: false, events: NO_EVENTS };
      // Criatura na mira mas golpe ainda recarregando: o clique é consumido
      // (não quebra o bloco atrás dela), porém sem dano.
      if (attackCd > 0) return { hit: true, events: NO_EVENTS };
      attackCd = COMBAT.ATTACK_COOLDOWN;

      const sel = inventory.getSelected();
      const damage = sel.kind === 'item' && sel.item === ITEM.SWORD ? DAMAGE.SWORD : DAMAGE.FIST;
      const res = mobs.damage(target.mob, damage, {
        fromX: ray.origin.x,
        fromZ: ray.origin.z,
        knock: COMBAT.KNOCK,
      });
      pushSound(out, 'hit', target.point.x, target.point.y, target.point.z);
      if (res.killed) {
        stats.addKill();
        for (const d of res.drops) {
          const got = inventory.addItem(d.item, d.count);
          if (got > 0) out.push({ type: 'toast', text: `+${got} ${ITEM_LABEL[d.item] ?? d.item}` });
        }
      }
      return { hit: true, events: out.length ? out : NO_EVENTS };
    },

    /** Bloco quebrado pelo jogador: devolve o drop (só em Sobrevivência). */
    onBlockBroken(block) {
      if (stats.mode !== MODE.SURVIVAL) return NO_EVENTS;
      inventory.addBlock(blockDrop(block), 1);
      return NO_EVENTS;
    },

    /** Bloco que pode ser colocado agora (id) ou null. */
    getHeldBlock() {
      const sel = inventory.getSelected();
      if (sel.kind !== 'block' || sel.count <= 0) return null;
      return sel.block;
    },

    /** Gasta 1 unidade ao colocar. */
    onBlockPlaced() {
      inventory.consumeSelected();
    },

    /** Clique direito com item na mão (carne: comer). */
    useItem() {
      const out = [];
      const sel = inventory.getSelected();
      if (stats.dead || sel.kind !== 'item' || sel.item !== ITEM.PORK) return NO_EVENTS;
      if (eatCd > 0 || stats.hp >= stats.maxHp || sel.count <= 0) return NO_EVENTS;
      if (!inventory.consumeSelected()) return NO_EVENTS;
      const healed = stats.heal(FOOD.PORK_HEAL);
      eatCd = FOOD.EAT_COOLDOWN;
      out.push({ type: 'sound', name: 'eat', x: 0, y: 0, z: 0, local: true });
      if (healed > 0) out.push({ type: 'toast', text: `+${healed / 2} ♥` });
      return out;
    },

    /**
     * Renasce: vida cheia, hostis limpos. O host reposiciona o jogador.
     * Se morreu de noite, o relógio pula para o amanhecer seguinte: renascer no
     * escuro com zumbis a caminho vira laço de morte.
     */
    respawn() {
      stats.respawn();
      mobs.clearHostiles();
      if (isNight(seconds)) seconds = (Math.floor(seconds / DAY_LENGTH) + 1) * DAY_LENGTH + START_SECONDS;
    },

    /** Dados para `saveWorld(world, player, game)`. */
    toJSON() {
      return {
        v: GAME_VERSION,
        mode: stats.mode,
        seconds,
        stats: stats.toJSON(),
        inventory: inventory.toJSON(),
      };
    },

    /** Resumo para a tela de morte. */
    summary() {
      return { days: dayNumber(seconds), kills: stats.kills };
    },

    /** Para inspeção/HUD. */
    mobDef(kind) {
      return MOB_DEFS[kind];
    },

    dispose() {
      mobs.dispose();
    },
  };
}
