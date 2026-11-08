// Игровая логика. Сервер — единственный источник правды: клиент только присылает
// «я кликнул по цели X», а решает, кому она достанется, только сервер.
const crypto = require('crypto');
const config = require('./config');
const log = require('./logger');
const store = require('./store');

// Виды целей: меньше и быстрее — дороже
const KINDS = {
  normal: { r: 0.045, points: 1, lifeMs: [2200, 3400], weight: 70 },
  small: { r: 0.028, points: 2, lifeMs: [1700, 2600], weight: 22 },
  gold: { r: 0.034, points: 5, lifeMs: [1200, 1700], weight: 8 },
};

const rand = (a, b) => a + Math.random() * (b - a);
function pickKind() {
  let n = Math.random() * 100;
  for (const [name, k] of Object.entries(KINDS)) {
    if ((n -= k.weight) < 0) return name;
  }
  return 'normal';
}

class Game {
  /** @param {{ broadcast: (msg: object) => void }} opts */
  constructor({ broadcast }) {
    this.broadcast = broadcast;
    this.match = null; //        { id, status: 'running'|'break', startedAt, endsAt, nextStartAt }
    this.targets = new Map(); // активные цели: id → цель
    this.recent = new Map(); //  недавно забранные цели — чтобы объяснить проигравшему, кто успел раньше
    this.scores = new Map(); //  очки текущего матча: playerId → { id, name, color, points, hits }
    this.timers = new Set();
    this.chain = Promise.resolve(); // события записываются строго по очереди, чтобы seq шёл по порядку
    this.stopped = false;
  }

  // ---------- таймеры ----------

  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) Promise.resolve(fn()).catch((err) => log.error('game.timer_failed', { err: err.message }));
    }, Math.max(0, ms));
    this.timers.add(t);
    return t;
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ---------- журнал событий ----------

  // Записать событие в БД (получить seq) и разослать всем
  emit(type, data) {
    const matchId = this.match?.id ?? null;
    this.chain = this.chain
      .then(async () => {
        const { seq, time } = await store.appendEvent(matchId, type, data);
        this.broadcast({ type: 'event', seq, event: type, time, data });
      })
      .catch((err) => log.error('game.event_failed', { type, err: err.message }));
    return this.chain;
  }

  // ---------- жизненный цикл матча ----------

  // Запуск: продолжаем незавершённый матч из БД или начинаем новый
  async start() {
    const running = await store.lastRunningMatch();
    if (running && running.ends_at.getTime() > Date.now() + 1000) {
      this.match = {
        id: running.id,
        status: 'running',
        startedAt: running.started_at.getTime(),
        endsAt: running.ends_at.getTime(),
      };
      for (const s of await store.matchScores(running.id)) this.scores.set(s.id, s);
      for (const t of await store.activeTargets(running.id)) this.addTarget(t);
      this.later(this.match.endsAt - Date.now(), () => this.endMatch());
      this.scheduleSpawn();
      log.info('match.resumed', { matchId: running.id, leftMs: this.match.endsAt - Date.now(), targets: this.targets.size });
      await this.emit('match.resumed', { matchId: running.id });
    } else {
      if (running) {
        this.match = { id: running.id, status: 'running' };
        await this.endMatch({ startNext: false });
      }
      await this.startMatch();
    }
  }

  async startMatch() {
    const row = await store.createMatch(config.game.matchMs);
    this.match = { id: row.id, status: 'running', startedAt: row.started_at.getTime(), endsAt: row.ends_at.getTime() };
    this.targets.clear();
    this.scores.clear();
    log.info('match.started', { matchId: row.id });
    await this.emit('match.started', { match: this.matchInfo() });
    this.later(this.match.endsAt - Date.now(), () => this.endMatch());
    this.scheduleSpawn();
  }

  async endMatch({ startNext = true } = {}) {
    if (!this.match || this.match.status !== 'running') return;
    const matchId = this.match.id;
    const { results, winnerId } = await store.finishMatch(matchId);
    for (const t of this.targets.values()) clearTimeout(t.timer);
    this.targets.clear();
    this.match = { id: matchId, status: 'break', nextStartAt: Date.now() + config.game.breakMs, results: results.slice(0, 10) };
    log.info('match.ended', { matchId, winnerId, players: results.length });
    await this.emit('match.ended', { matchId, winnerId, results: results.slice(0, 10), nextStartAt: this.match.nextStartAt });
    if (startNext) this.later(config.game.breakMs, () => this.startMatch());
  }

  matchInfo() {
    return { ...this.match };
  }

  // ---------- цели ----------

  scheduleSpawn() {
    if (!config.game.autoSpawn) return;
    const [a, b] = config.game.spawnEveryMs;
    this.later(rand(a, b), async () => {
      if (this.match?.status !== 'running') return;
      if (this.targets.size < config.game.maxTargets) await this.spawnTarget();
      this.scheduleSpawn();
    });
  }

  addTarget(t) {
    t.timer = this.later(t.expiresAt - Date.now(), () => this.expireTarget(t.id));
    this.targets.set(t.id, t);
  }

  // Новая цель в случайном месте (в тестах можно задать параметры явно)
  async spawnTarget(opts = {}) {
    if (this.match?.status !== 'running') return null;
    const kindName = opts.kind || pickKind();
    const kind = KINDS[kindName];
    const now = Date.now();
    const t = {
      id: crypto.randomUUID(),
      kind: kindName,
      r: kind.r,
      x: opts.x ?? rand(kind.r, 1 - kind.r),
      y: opts.y ?? rand(kind.r, 1 - kind.r),
      points: kind.points,
      spawnedAt: now,
      expiresAt: now + (opts.lifeMs ?? rand(...kind.lifeMs)),
    };
    await store.insertTarget(t, this.match.id);
    this.addTarget(t);
    await this.emit('target.spawned', { target: publicTarget(t) });
    return publicTarget(t);
  }

  async expireTarget(id) {
    const t = this.targets.get(id);
    if (!t || t.claimedBy) return;
    this.targets.delete(id);
    this.recent.set(id, { expired: true, at: Date.now() });
    this.later(10_000, () => this.recent.delete(id));
    await this.emit('target.expired', { targetId: id });
  }

  /**
   * Попытка захватить цель. Разрешение конфликтов:
   *  1) Node.js обрабатывает сообщения по одному. Проверка «цель свободна» и пометка «занята»
   *     идут подряд без await — второй игрок, чьё сообщение пришло на миллисекунду позже,
   *     уже увидит цель занятой и получит отказ «conflict».
   *  2) В БД захват — UPDATE … WHERE claimed_by IS NULL (оптимистичная блокировка),
   *     это защищает даже при нескольких экземплярах сервера.
   */
  async claim(player, { targetId, x, y, queued = false }) {
    const now = Date.now();
    if (this.match?.status !== 'running') return { ok: false, reason: 'no_match' };

    const t = this.targets.get(targetId);
    if (!t) {
      const r = this.recent.get(targetId);
      if (r?.claimedBy) return conflictResult(r, player, now);
      return { ok: false, reason: 'expired' }; // цель исчезла (часто — пока игрок был офлайн)
    }
    if (t.claimedBy) return conflictResult(t, player, now);

    // промах: клик не попал в круг (клиент мог ошибиться или схитрить)
    if (typeof x === 'number' && typeof y === 'number' && Math.hypot(x - t.x, y - t.y) > t.r * 1.2) {
      return { ok: false, reason: 'miss' };
    }

    // ↓ атомарно для этого процесса: ни одного await между проверкой и пометкой
    t.claimedBy = player.id;
    t.claimedByName = player.name;
    t.claimedAt = now;
    clearTimeout(t.timer);
    const reactionMs = now - t.spawnedAt;

    const res = await store.claimTarget({
      targetId,
      matchId: this.match.id,
      playerId: player.id,
      claimedAt: now,
      reactionMs,
      points: t.points,
    });
    if (!res.ok) {
      // БД не дала захватить — значит, кто-то успел через другой экземпляр сервера
      t.claimedBy = res.claimedBy;
      t.claimedAt = res.claimedAt;
      log.warn('claim.db_conflict', { targetId, playerId: player.id });
      return conflictResult(t, player, now);
    }

    this.targets.delete(targetId);
    this.recent.set(targetId, { claimedBy: player.id, claimedByName: player.name, claimedAt: now });
    this.later(10_000, () => this.recent.delete(targetId));

    const s = this.scores.get(player.id) || { id: player.id, name: player.name, color: player.color, points: 0, hits: 0 };
    s.points += t.points;
    s.hits += 1;
    this.scores.set(player.id, s);

    log.info('target.claimed', { targetId, playerId: player.id, points: t.points, reactionMs, queued });
    await this.emit('target.claimed', {
      targetId,
      by: { id: player.id, name: player.name, color: player.color },
      points: t.points,
      reactionMs,
      score: { points: s.points, hits: s.hits },
    });
    return { ok: true, points: t.points, reactionMs };
  }

  // Игрок сменил имя — обновляем его в таблице очков матча
  renamed(player) {
    const s = this.scores.get(player.id);
    if (s) s.name = player.name;
    return this.emit('player.renamed', { player: store.toPlayer(player) });
  }

  // Полное состояние для нового или переподключившегося клиента
  async snapshot() {
    return {
      serverNow: Date.now(),
      match: this.matchInfo(),
      targets: [...this.targets.values()].filter((t) => !t.claimedBy).map(publicTarget),
      scores: [...this.scores.values()].sort((a, b) => b.points - a.points),
      leaderboard: await store.leaderboard(),
      lastSeq: await store.lastSeq(),
    };
  }
}

const publicTarget = (t) => ({
  id: t.id,
  kind: t.kind,
  x: t.x,
  y: t.y,
  r: t.r,
  points: t.points,
  spawnedAt: t.spawnedAt,
  expiresAt: t.expiresAt,
});

// Отказ из-за конфликта: кто забрал и на сколько миллисекунд раньше
function conflictResult(t, player, now) {
  if (t.claimedBy === player.id) return { ok: false, reason: 'duplicate' }; // повтор своего же клика
  return {
    ok: false,
    reason: 'conflict',
    by: t.claimedByName ? { id: t.claimedBy, name: t.claimedByName } : { id: t.claimedBy },
    lateMs: t.claimedAt ? now - t.claimedAt : null,
  };
}

module.exports = { Game, KINDS };
