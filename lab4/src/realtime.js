// WebSocket-слой: протокол сообщений между браузером и сервером.
//
// Клиент → сервер:
//   { type: 'hello', token?, name?, lastSeq? }          представиться (token из localStorage)
//   { type: 'claim', actionId, targetId, x, y, queued? } кликнул по цели
//   { type: 'rename', name }                             сменить имя
//   { type: 'ping', t }                                  замер задержки и сверка часов
// Сервер → клиент:
//   { type: 'welcome', you, token?, snapshot, online, missed }  полное состояние + пропущенные события
//   { type: 'event', seq, event, time, data }                   событие игры (у всех одинаковый порядок)
//   { type: 'claim.result', actionId, targetId, ok, ... }       ответ именно этому игроку
//   { type: 'presence', online }                                кто сейчас в игре
//   { type: 'pong', t, serverNow }
//   { type: 'error', code, message }
const { WebSocketServer } = require('ws');
const config = require('./config');
const log = require('./logger');
const store = require('./store');

const UUID_RE = /^[0-9a-f-]{36}$/i;

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return name || null;
}

function attachRealtime(server, getGame) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.limits.maxMessageBytes });
  const clients = new Set(); // соединения, прошедшие hello

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  // Список игроков онлайн (один игрок может быть открыт в нескольких вкладках)
  const online = () => {
    const map = new Map();
    for (const ws of clients) if (ws.player) map.set(ws.player.id, store.toPlayer(ws.player));
    return [...map.values()];
  };
  const broadcastPresence = () => broadcast({ type: 'presence', online: online() });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.claims = []; // времена последних кликов — для ограничения частоты
    ws.ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // кто не представился за 10 секунд — отключаем
    const helloTimer = setTimeout(() => {
      if (!ws.player) ws.close(4001, 'hello timeout');
    }, 10_000);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', code: 'bad_json', message: 'Сообщение должно быть JSON' });
      }
      try {
        await handle(ws, msg);
      } catch (err) {
        log.error('ws.handler_failed', { type: msg?.type, err: err.message });
        send(ws, { type: 'error', code: 'server_error', message: 'Ошибка сервера' });
      }
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      if (clients.delete(ws)) {
        log.info('player.disconnected', { playerId: ws.player.id, code });
        broadcastPresence();
      }
    });
  });

  async function handle(ws, msg) {
    const game = getGame();

    if (msg.type === 'hello') {
      let player = await store.findPlayerByToken(msg.token);
      let token;
      if (!player) {
        const created = await store.createPlayer(cleanName(msg.name) || 'Игрок');
        player = created.player;
        token = created.token; // новый токен — клиент сохранит его в localStorage
        log.info('player.created', { playerId: player.id, name: player.name });
      }
      ws.player = player;
      clients.add(ws);

      // Досылка пропущенного: клиент говорит, какое событие видел последним
      let missed = null;
      if (Number.isInteger(msg.lastSeq) && msg.lastSeq > 0) {
        missed = await store.eventsAfter(msg.lastSeq, config.limits.resyncEvents);
      }
      send(ws, {
        type: 'welcome',
        you: store.toPlayer(player),
        ...(token && { token }),
        snapshot: await game.snapshot(),
        online: online(),
        missed,
      });
      log.info('player.connected', {
        playerId: player.id,
        ip: ws.ip,
        resumed: Boolean(missed),
        missedEvents: missed?.events.length ?? 0,
      });
      broadcastPresence();
      return;
    }

    if (!ws.player) return send(ws, { type: 'error', code: 'no_hello', message: 'Сначала отправьте hello' });

    switch (msg.type) {
      case 'claim': {
        const { actionId, targetId, x, y, queued } = msg;
        if (typeof actionId !== 'string' || actionId.length > 64 || typeof targetId !== 'string' || !UUID_RE.test(targetId)) {
          return send(ws, { type: 'error', code: 'bad_request', message: 'Некорректный claim' });
        }
        // не больше N кликов в секунду
        const now = Date.now();
        ws.claims = ws.claims.filter((t) => t > now - 1000);
        if (ws.claims.length >= config.limits.claimsPerSecond) {
          log.warn('claim.rate_limited', { playerId: ws.player.id });
          return send(ws, { type: 'claim.result', actionId, targetId, ok: false, reason: 'rate_limited' });
        }
        ws.claims.push(now);
        const okNum = (v) => typeof v === 'number' && v >= 0 && v <= 1;
        const result = await game.claim(ws.player, {
          targetId,
          x: okNum(x) ? x : undefined,
          y: okNum(y) ? y : undefined,
          queued: queued === true,
        });
        if (!result.ok) log.info('claim.rejected', { playerId: ws.player.id, targetId, reason: result.reason, lateMs: result.lateMs, queued: queued === true });
        return send(ws, { type: 'claim.result', actionId, targetId, ...result });
      }

      case 'rename': {
        const name = cleanName(msg.name);
        if (!name) return send(ws, { type: 'error', code: 'bad_name', message: 'Имя: от 1 до 24 символов' });
        const player = await store.renamePlayer(ws.player.id, name);
        for (const c of clients) if (c.player.id === player.id) c.player = player;
        await game.renamed(player);
        broadcastPresence();
        return;
      }

      case 'ping':
        return send(ws, { type: 'pong', t: msg.t, serverNow: Date.now() });

      default:
        return send(ws, { type: 'error', code: 'unknown_type', message: `Неизвестный тип ${msg.type}` });
    }
  }

  // Проверка живых соединений: если клиент пропал без закрытия (ноутбук уснул), отключаем его
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);
  heartbeat.unref();

  return {
    broadcast,
    close: () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
    clientCount: () => clients.size,
  };
}

module.exports = { attachRealtime };
