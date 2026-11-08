// Интеграционные тесты: настоящий сервер + настоящая PostgreSQL + несколько WebSocket-клиентов.
// Запуск: DATABASE_URL=postgres://... npm test
process.env.NODE_ENV = 'test';
process.env.AUTO_SPAWN = 'false'; // цели создаём вручную, чтобы тесты были предсказуемыми
process.env.MATCH_MS = '600000'; //  длинный матч, чтобы не закончился во время тестов

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const db = require('../src/db');
const { createServer } = require('../src/server');

let app;

// ---------- вспомогательный клиент ----------

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const api = {
    ws,
    inbox,
    opened: new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    // ждать сообщение, подходящее под условие (в том числе уже пришедшее)
    wait(pred, ms = 3000) {
      const found = inbox.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    async hello(extra = {}) {
      await api.opened;
      api.send({ type: 'hello', name: 'Тестер', ...extra });
      return api.wait((m) => m.type === 'welcome');
    },
    close: () => new Promise((r) => {
      ws.once('close', r);
      ws.close();
    }),
  };
  return api;
}

const isEvent = (name, pred = () => true) => (m) => m.type === 'event' && m.event === name && pred(m.data);

function get(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  await db.init();
  await db.query('TRUNCATE events, targets, match_scores, matches, players RESTART IDENTITY CASCADE');
  app = await createServer({ port: 0 });
});

after(async () => {
  await app.close();
  await db.pool.end();
});

describe('подключение и синхронизация', () => {
  test('новый игрок получает токен и полное состояние; по токену узнаётся снова', async () => {
    const a = client(app.port);
    const w1 = await a.hello({ name: 'Макс' });
    assert.equal(w1.you.name, 'Макс');
    assert.equal(w1.token.length, 64);
    assert.equal(w1.snapshot.match.status, 'running');
    await a.close();

    const again = client(app.port);
    const w2 = await again.hello({ token: w1.token });
    assert.equal(w2.you.id, w1.you.id);
    assert.equal(w2.token, undefined); // новый токен не выдаётся
    await again.close();
  });

  test('событие доходит до всех игроков с одинаковым номером seq', async () => {
    const a = client(app.port);
    const b = client(app.port);
    await a.hello({ name: 'A' });
    await b.hello({ name: 'B' });
    const t = await app.game.spawnTarget({ x: 0.5, y: 0.5, kind: 'normal' });
    const ea = await a.wait(isEvent('target.spawned', (d) => d.target.id === t.id));
    const eb = await b.wait(isEvent('target.spawned', (d) => d.target.id === t.id));
    assert.equal(ea.seq, eb.seq);
    await Promise.all([a.close(), b.close()]);
  });
});

describe('конкурентный доступ к одной цели', () => {
  test('двое кликают одновременно: цель получает один, второй — conflict с именем победителя', async () => {
    const a = client(app.port);
    const b = client(app.port);
    await a.hello({ name: 'Быстрый' });
    await b.hello({ name: 'Медленный' });
    const t = await app.game.spawnTarget({ x: 0.3, y: 0.3, kind: 'gold', lifeMs: 10_000 });

    // оба сообщения уходят без ожидания — сервер получает их почти одновременно
    a.send({ type: 'claim', actionId: 'a1', targetId: t.id, x: 0.3, y: 0.3 });
    b.send({ type: 'claim', actionId: 'b1', targetId: t.id, x: 0.3, y: 0.3 });
    const ra = await a.wait((m) => m.type === 'claim.result' && m.actionId === 'a1');
    const rb = await b.wait((m) => m.type === 'claim.result' && m.actionId === 'b1');

    const results = [ra, rb];
    assert.equal(results.filter((r) => r.ok).length, 1, 'ровно один успешный захват');
    const loser = results.find((r) => !r.ok);
    assert.equal(loser.reason, 'conflict');
    assert.ok(loser.by.name);
    assert.ok(loser.lateMs >= 0);

    // в БД цель принадлежит победителю, очки начислены один раз
    const { rows } = await db.query('SELECT claimed_by, version FROM targets WHERE id = $1', [t.id]);
    assert.equal(rows[0].version, 1);
    const claimed = await a.wait(isEvent('target.claimed', (d) => d.targetId === t.id));
    assert.equal(rows[0].claimed_by, claimed.data.by.id);
    assert.equal(claimed.data.points, 5);

    // повторный клик победителя не засчитывается второй раз
    const winner = ra.ok ? a : b;
    winner.send({ type: 'claim', actionId: 'again', targetId: t.id, x: 0.3, y: 0.3 });
    const dup = await winner.wait((m) => m.type === 'claim.result' && m.actionId === 'again');
    assert.equal(dup.reason, 'duplicate');
    await Promise.all([a.close(), b.close()]);
  });

  test('10 игроков одновременно — ровно один победитель', async () => {
    const players = Array.from({ length: 10 }, () => client(app.port));
    await Promise.all(players.map((p, i) => p.hello({ name: `P${i}` })));
    const t = await app.game.spawnTarget({ x: 0.6, y: 0.6, lifeMs: 10_000 });
    players.forEach((p, i) => p.send({ type: 'claim', actionId: `c${i}`, targetId: t.id, x: 0.6, y: 0.6 }));
    const res = await Promise.all(players.map((p, i) => p.wait((m) => m.type === 'claim.result' && m.actionId === `c${i}`)));
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal(res.filter((r) => r.reason === 'conflict').length, 9);
    await Promise.all(players.map((p) => p.close()));
  });

  test('промах и исчезнувшая цель отклоняются', async () => {
    const a = client(app.port);
    await a.hello();
    const t = await app.game.spawnTarget({ x: 0.2, y: 0.2, lifeMs: 150 });
    a.send({ type: 'claim', actionId: 'miss', targetId: t.id, x: 0.9, y: 0.9 });
    assert.equal((await a.wait((m) => m.actionId === 'miss')).reason, 'miss');
    await a.wait(isEvent('target.expired', (d) => d.targetId === t.id));
    a.send({ type: 'claim', actionId: 'late', targetId: t.id, x: 0.2, y: 0.2 });
    assert.equal((await a.wait((m) => m.actionId === 'late')).reason, 'expired');
    await a.close();
  });
});

describe('потеря соединения и восстановление', () => {
  test('после переподключения сервер досылает пропущенные события, счёт сохраняется', async () => {
    const a = client(app.port);
    const b = client(app.port);
    const wa = await a.hello({ name: 'Остался' });
    const wb = await b.hello({ name: 'Отвалился' });
    const t0 = await app.game.spawnTarget({ x: 0.4, y: 0.4 });
    const seen = await b.wait(isEvent('target.spawned', (d) => d.target.id === t0.id));
    await b.close(); // «пропал интернет»

    // пока B офлайн: появилась цель, A её забрал
    const t1 = await app.game.spawnTarget({ x: 0.7, y: 0.7, lifeMs: 10_000 });
    a.send({ type: 'claim', actionId: 'x', targetId: t1.id, x: 0.7, y: 0.7 });
    assert.ok((await a.wait((m) => m.actionId === 'x')).ok);

    // B возвращается с тем же токеном и номером последнего события
    const b2 = client(app.port);
    const w = await b2.hello({ token: wb.token, lastSeq: seen.seq });
    assert.equal(w.you.id, wb.you.id);
    const types = w.missed.events.map((e) => e.type);
    assert.ok(types.includes('target.spawned'));
    assert.ok(types.includes('target.claimed'));
    assert.ok(w.missed.events.every((e) => e.seq > seen.seq));
    assert.ok(w.snapshot.scores.some((s) => s.id === wa.you.id && s.points >= 1));
    await Promise.all([a.close(), b2.close()]);
  });

  test('клик, сделанный офлайн, после переподключения проверяется по-честному', async () => {
    const a = client(app.port);
    const b = client(app.port);
    await a.hello({ name: 'A' });
    const wb = await b.hello({ name: 'B' });
    const t = await app.game.spawnTarget({ x: 0.5, y: 0.8, lifeMs: 10_000 });
    await b.wait(isEvent('target.spawned', (d) => d.target.id === t.id));
    await b.close();

    a.send({ type: 'claim', actionId: 'first', targetId: t.id, x: 0.5, y: 0.8 });
    await a.wait((m) => m.actionId === 'first');

    const b2 = client(app.port);
    await b2.hello({ token: wb.token });
    b2.send({ type: 'claim', actionId: 'queued', targetId: t.id, x: 0.5, y: 0.8, queued: true });
    const r = await b2.wait((m) => m.actionId === 'queued');
    assert.equal(r.reason, 'conflict');
    await Promise.all([a.close(), b2.close()]);
  });
});

describe('сохранение между запусками', () => {
  test('после перезапуска сервера матч, счёт и цели восстанавливаются из БД', async () => {
    const a = client(app.port);
    const w = await a.hello({ name: 'Постоянный' });
    const t = await app.game.spawnTarget({ x: 0.1, y: 0.9, lifeMs: 30_000 });
    const before = await app.game.snapshot();
    await a.close();

    await app.close(); //                              «выключили» сервер
    app = await createServer({ port: 0 }); //          и запустили снова

    const a2 = client(app.port);
    const w2 = await a2.hello({ token: w.token });
    assert.equal(w2.you.id, w.you.id); //                          игрок тот же
    assert.equal(w2.snapshot.match.id, before.match.id); //        матч продолжается
    assert.ok(w2.snapshot.targets.some((x) => x.id === t.id)); //   цель на месте
    assert.deepEqual(
      w2.snapshot.scores.map((s) => [s.id, s.points]),
      before.scores.map((s) => [s.id, s.points]),
    );
    await a2.close();
  });
});

describe('проверка входящих данных и HTTP', () => {
  test('битый JSON, действие без hello, неизвестный тип', async () => {
    const a = client(app.port);
    await a.opened;
    a.send('{oops');
    assert.equal((await a.wait((m) => m.type === 'error')).code, 'bad_json');
    a.send({ type: 'claim', actionId: '1', targetId: '00000000-0000-0000-0000-000000000000' });
    assert.ok(await a.wait((m) => m.code === 'no_hello'));
    await a.hello();
    a.send({ type: 'fly' });
    assert.ok(await a.wait((m) => m.code === 'unknown_type'));
    a.send({ type: 'claim', actionId: '2', targetId: 'not-a-uuid' });
    assert.ok(await a.wait((m) => m.code === 'bad_request'));
    await a.close();
  });

  test('HTTP: главная страница, health, 405, защита от выхода из папки', async () => {
    const home = await get(app.port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /Кто быстрее/);
    assert.equal((await get(app.port, '/health')).status, 200);
    const post = await get(app.port, '/', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.ok([403, 404].includes((await get(app.port, '/../package.json')).status));
    assert.ok([403, 404].includes((await get(app.port, '/%2e%2e/package.json')).status));
  });
});
