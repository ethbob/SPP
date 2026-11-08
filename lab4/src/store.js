// Все SQL-запросы игры в одном месте
const crypto = require('crypto');
const db = require('./db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const COLORS = ['#e6493a', '#2f7de1', '#2fa35a', '#d9952b', '#8b55d6', '#d6458f', '#1aa3a3', '#7a8a1f', '#c75b2b', '#4459c9'];

const toPlayer = (r) => ({ id: r.id, name: r.name, color: r.color });

// ---------- игроки ----------

async function findPlayerByToken(token) {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const { rows } = await db.query(
    'UPDATE players SET last_seen_at = now() WHERE token_hash = $1 RETURNING *',
    [sha256(token)],
  );
  return rows[0] || null;
}

async function createPlayer(name) {
  const token = crypto.randomBytes(32).toString('hex'); // 64 символа
  const { rows } = await db.query(
    `INSERT INTO players (token_hash, name, color)
     VALUES ($1, $2, '#000000') RETURNING *`,
    [sha256(token), name],
  );
  // цвет по id — у соседних игроков разные цвета
  const color = COLORS[(rows[0].id - 1) % COLORS.length];
  await db.query('UPDATE players SET color = $1 WHERE id = $2', [color, rows[0].id]);
  return { player: { ...rows[0], color }, token };
}

async function renamePlayer(id, name) {
  const { rows } = await db.query('UPDATE players SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
  return rows[0];
}

async function leaderboard(limit = 10) {
  const { rows } = await db.query(
    `SELECT id, name, color, total_points, total_hits, best_reaction_ms, matches_played
       FROM players WHERE total_points > 0
      ORDER BY total_points DESC, best_reaction_ms ASC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    ...toPlayer(r),
    points: r.total_points,
    hits: r.total_hits,
    bestReactionMs: r.best_reaction_ms,
    matches: r.matches_played,
  }));
}

// ---------- матчи ----------

async function lastRunningMatch() {
  const { rows } = await db.query("SELECT * FROM matches WHERE status = 'running' ORDER BY id DESC LIMIT 1");
  return rows[0] || null;
}

async function createMatch(durationMs) {
  const { rows } = await db.query(
    "INSERT INTO matches (ends_at) VALUES (now() + make_interval(secs => $1)) RETURNING *",
    [durationMs / 1000],
  );
  return rows[0];
}

async function matchScores(matchId) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.color, s.points, s.hits
       FROM match_scores s JOIN players p ON p.id = s.player_id
      WHERE s.match_id = $1 ORDER BY s.points DESC, s.hits DESC`,
    [matchId],
  );
  return rows.map((r) => ({ ...toPlayer(r), points: r.points, hits: r.hits }));
}

async function finishMatch(matchId) {
  const results = await matchScores(matchId);
  const winnerId = results[0]?.points > 0 ? results[0].id : null;
  await db.query(
    "UPDATE matches SET status = 'finished', finished_at = now(), winner_id = $1 WHERE id = $2",
    [winnerId, matchId],
  );
  await db.query(
    'UPDATE players SET matches_played = matches_played + 1 WHERE id IN (SELECT player_id FROM match_scores WHERE match_id = $1)',
    [matchId],
  );
  return { results, winnerId };
}

// ---------- цели ----------

async function insertTarget(t, matchId) {
  await db.query(
    `INSERT INTO targets (id, match_id, kind, x, y, r, points, spawned_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0))`,
    [t.id, matchId, t.kind, t.x, t.y, t.r, t.points, t.spawnedAt, t.expiresAt],
  );
}

async function activeTargets(matchId) {
  const { rows } = await db.query(
    'SELECT * FROM targets WHERE match_id = $1 AND claimed_by IS NULL AND expires_at > now()',
    [matchId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    x: r.x,
    y: r.y,
    r: r.r,
    points: r.points,
    spawnedAt: r.spawned_at.getTime(),
    expiresAt: r.expires_at.getTime(),
  }));
}

/**
 * Захват цели в одной транзакции.
 * UPDATE … WHERE claimed_by IS NULL — оптимистичная блокировка на уровне БД:
 * если цель уже кто-то забрал, строка не обновится, и захват не засчитается.
 */
async function claimTarget({ targetId, matchId, playerId, claimedAt, reactionMs, points }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE targets SET claimed_by = $1, claimed_at = to_timestamp($2 / 1000.0), reaction_ms = $3, version = version + 1
        WHERE id = $4 AND claimed_by IS NULL RETURNING version`,
      [playerId, claimedAt, reactionMs, targetId],
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      const { rows } = await db.query('SELECT claimed_by, claimed_at FROM targets WHERE id = $1', [targetId]);
      return { ok: false, claimedBy: rows[0]?.claimed_by, claimedAt: rows[0]?.claimed_at?.getTime() };
    }
    await client.query(
      `INSERT INTO match_scores (match_id, player_id, points, hits) VALUES ($1, $2, $3, 1)
       ON CONFLICT (match_id, player_id) DO UPDATE SET points = match_scores.points + $3, hits = match_scores.hits + 1`,
      [matchId, playerId, points],
    );
    await client.query(
      `UPDATE players SET total_points = total_points + $2, total_hits = total_hits + 1,
              best_reaction_ms = LEAST(COALESCE(best_reaction_ms, $3), $3)
        WHERE id = $1`,
      [playerId, points, reactionMs],
    );
    await client.query('COMMIT');
    return { ok: true, version: upd.rows[0].version };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- журнал событий ----------

async function appendEvent(matchId, type, payload) {
  const { rows } = await db.query(
    'INSERT INTO events (match_id, type, payload) VALUES ($1, $2, $3) RETURNING seq, created_at',
    [matchId, type, payload],
  );
  return { seq: Number(rows[0].seq), time: rows[0].created_at.getTime() };
}

async function eventsAfter(seq, limit) {
  const { rows } = await db.query(
    'SELECT seq, type, payload, created_at FROM events WHERE seq > $1 ORDER BY seq LIMIT $2',
    [seq, limit + 1],
  );
  return {
    tooMany: rows.length > limit, // пропущено слишком много — клиенту хватит снимка
    events: rows.slice(0, limit).map((r) => ({ seq: Number(r.seq), type: r.type, data: r.payload, time: r.created_at.getTime() })),
  };
}

async function lastSeq() {
  const { rows } = await db.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM events');
  return Number(rows[0].seq);
}

module.exports = {
  toPlayer,
  findPlayerByToken,
  createPlayer,
  renamePlayer,
  leaderboard,
  lastRunningMatch,
  createMatch,
  matchScores,
  finishMatch,
  insertTarget,
  activeTargets,
  claimTarget,
  appendEvent,
  eventsAfter,
  lastSeq,
};
