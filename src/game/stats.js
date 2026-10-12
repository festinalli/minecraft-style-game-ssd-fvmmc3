// Vida do jogador: dano, invulnerabilidade, regeneração, morte e respawn.
// PURO (sem DOM, sem Three, sem aleatoriedade): roda no Node e é testado lá.
// Fonte única das regras de vida e dos MODOS de jogo (`MODE`).
//
// Unidades: HP inteiro (1 coração = 2 HP), tempo em segundos.

/** Vida máxima do jogador (10 corações). */
export const MAX_HP = 20;

/** Regras de vida. Balanceamento mora AQUI (e só aqui). */
export const HEALTH = {
  FALL_SAFE_DISTANCE: 3, // queda de até 3 blocos não machuca
  INVULN_TIME: 0.5, // s de imunidade após levar dano
  RESPAWN_INVULN: 1.5, // s de imunidade ao renascer
  REGEN_DELAY: 8, // s sem dano antes de a regeneração começar
  REGEN_INTERVAL: 4, // s entre curas (1ª cura: REGEN_DELAY + REGEN_INTERVAL)
  REGEN_AMOUNT: 1, // HP por cura
};

/** Modos de jogo. Valem para `stats`, `inventory` e para o save (`game.mode`). */
export const MODE = { SURVIVAL: 'survival', CREATIVE: 'creative' };

export function isMode(m) {
  return m === MODE.SURVIVAL || m === MODE.CREATIVE;
}

// Tolerância de ponto flutuante: 5 passos de 0.1 s têm de zerar 0.5 s.
const EPS = 1e-9;

/**
 * Dano de queda em HP: 0 até `FALL_SAFE_DISTANCE` blocos; depois `ceil(d - 3)`.
 * @param {number} distance blocos caídos
 * @returns {number}
 */
export function fallDamage(distance) {
  if (typeof distance !== 'number' || !(distance > HEALTH.FALL_SAFE_DISTANCE)) return 0;
  return Math.ceil(distance - HEALTH.FALL_SAFE_DISTANCE);
}

function isPlainObject(o) {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

/**
 * @param {{ mode?: string }} [opts]
 */
export function createStats({ mode = MODE.SURVIVAL } = {}) {
  // Acumula o tempo de regeneração (só corre depois do REGEN_DELAY).
  let regenAcc = 0;

  const s = {
    hp: MAX_HP,
    maxHp: MAX_HP,
    mode: isMode(mode) ? mode : MODE.SURVIVAL,
    dead: false,
    kills: 0,
    sinceDamage: 0, // s desde o último dano válido
    invuln: 0, // s restantes de imunidade
    lastSource: null, // origem do último dano válido (ex.: 'zombie', 'fall')

    /**
     * Aplica dano. Ignorado se morto, no Criativo ou durante a invulnerabilidade.
     * Arredonda para cima: dano > 0 nunca vira 0 (o HP é inteiro).
     * @param {number} amount HP
     * @param {{ source?: string }} [opts]
     * @returns {{ applied: number, died: boolean }}
     */
    damage(amount, opts) {
      if (s.dead || s.mode === MODE.CREATIVE || s.invuln > 0) return { applied: 0, died: false };
      if (typeof amount !== 'number' || !(amount > 0)) return { applied: 0, died: false };

      const applied = Math.min(s.hp, Math.ceil(amount));
      s.hp -= applied;
      s.invuln = HEALTH.INVULN_TIME;
      s.sinceDamage = 0;
      s.lastSource = opts?.source ?? null;
      regenAcc = 0;

      const died = s.hp <= 0;
      if (died) {
        s.hp = 0;
        s.dead = true;
      }
      return { applied, died };
    },

    /**
     * Cura (arredonda para baixo). Devolve o HP que realmente entrou.
     * @param {number} amount
     * @returns {number}
     */
    heal(amount) {
      if (s.dead || typeof amount !== 'number' || !(amount >= 1)) return 0;
      const healed = Math.min(s.maxHp - s.hp, Math.floor(amount));
      s.hp += healed;
      return healed;
    },

    /**
     * Avança o relógio: imunidade, tempo sem dano e regeneração.
     * Regeneração: +REGEN_AMOUNT a cada REGEN_INTERVAL, depois de REGEN_DELAY sem
     * dano. Só conta a parte do `dt` que passou do atraso, então o resultado não
     * depende do tamanho do passo.
     * @param {number} dt s
     */
    update(dt) {
      if (typeof dt !== 'number' || !(dt > 0) || !Number.isFinite(dt)) return;

      if (s.invuln > 0) {
        s.invuln -= dt;
        if (s.invuln <= EPS) s.invuln = 0;
      }
      s.sinceDamage += dt;

      if (s.mode !== MODE.SURVIVAL || s.dead || s.hp >= s.maxHp) {
        regenAcc = 0;
        return;
      }
      const eligible = Math.min(dt, s.sinceDamage - HEALTH.REGEN_DELAY);
      if (!(eligible > 0)) return;

      regenAcc += eligible;
      while (regenAcc >= HEALTH.REGEN_INTERVAL && s.hp < s.maxHp) {
        regenAcc -= HEALTH.REGEN_INTERVAL;
        s.hp = Math.min(s.maxHp, s.hp + HEALTH.REGEN_AMOUNT);
      }
      if (s.hp >= s.maxHp) regenAcc = 0;
    },

    /** Conta um abate. Devolve o total. */
    addKill() {
      s.kills += 1;
      return s.kills;
    },

    /** Renasce: vida cheia, vivo, imune por um instante. Mantém abates e modo. */
    respawn() {
      s.hp = s.maxHp;
      s.dead = false;
      s.invuln = HEALTH.RESPAWN_INVULN;
      s.sinceDamage = 0;
      regenAcc = 0;
    },

    /**
     * Troca o modo. Criativo: vida cheia e vivo (nunca "morto no Criativo").
     * Modo inválido é ignorado. Devolve o modo atual.
     * @param {string} m
     */
    setMode(m) {
      if (!isMode(m)) return s.mode;
      s.mode = m;
      if (m === MODE.CREATIVE) {
        s.hp = s.maxHp;
        s.dead = false;
        s.invuln = 0;
        regenAcc = 0;
      }
      return s.mode;
    },

    /** Estado persistente (o transitório — invuln, regen, dead — não entra). */
    toJSON() {
      return { v: 1, mode: s.mode, hp: s.hp, kills: s.kills };
    },

    /**
     * Restaura de um JSON, saneando cada campo. NUNCA restaura `dead`: o save não
     * ressuscita uma tela de morte (hp fora de [1, maxHp] vira maxHp).
     * Não-objeto: não altera nada e devolve false. O modo só muda se for válido.
     * @param {object} o
     * @returns {boolean}
     */
    fromJSON(o) {
      if (!isPlainObject(o)) return false;
      if (isMode(o.mode)) s.mode = o.mode;

      const hp = o.hp;
      s.hp = Number.isInteger(hp) && hp >= 1 && hp <= s.maxHp ? hp : s.maxHp;
      s.kills = Number.isFinite(o.kills) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(o.kills))) : 0;

      s.dead = false;
      s.invuln = 0;
      s.sinceDamage = 0;
      s.lastSource = null;
      regenAcc = 0;
      if (s.mode === MODE.CREATIVE) s.hp = s.maxHp;
      return true;
    },
  };

  return s;
}
