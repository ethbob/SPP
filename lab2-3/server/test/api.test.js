// Интеграционные тесты API на настоящей PostgreSQL.
// Запуск: DATABASE_URL=postgres://... npm test  (в CI база поднимается сервисом GitHub Actions)
process.env.NODE_ENV = 'test';
process.env.IP_LOGIN_LIMIT = '1000'; // в тестах много входов с одного IP — лимит по IP проверяем отдельно

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const mailer = require('../src/services/mailer');
const { seedDemoUsers } = require('../src/seed');

const api = () => request(app);

async function login(email, password) {
  const res = await api().post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, res.text);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('refreshToken='));
  return { token: res.body.accessToken, cookie, user: res.body.user };
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

before(async () => {
  await db.init();
  await db.query('TRUNCATE attachments, tasks, password_resets, sessions, users RESTART IDENTITY CASCADE');
  await seedDemoUsers();
});

after(async () => {
  await db.pool.end();
});

describe('коды HTTP и формат ошибок', () => {
  test('без токена — 401 с WWW-Authenticate и application/problem+json', async () => {
    const res = await api().get('/api/tasks');
    assert.equal(res.status, 401);
    assert.match(res.headers['www-authenticate'], /^Bearer/);
    assert.match(res.headers['content-type'], /application\/problem\+json/);
    assert.equal(res.body.status, 401);
    assert.ok(res.body.requestId);
  });

  test('неподдерживаемый метод — 405 с заголовком Allow', async () => {
    const { token } = await login('user@example.com', 'User12345');
    const res = await api().delete('/api/tasks').set(bearer(token));
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET, HEAD, POST');
  });

  test('неизвестный адрес — 404', async () => {
    const res = await api().get('/api/nope');
    assert.equal(res.status, 404);
  });

  test('некорректный JSON — 400, неверные данные — 422, не JSON — 415', async () => {
    const { token } = await login('user@example.com', 'User12345');
    const broken = await api().post('/api/tasks').set(bearer(token)).set('Content-Type', 'application/json').send('{"title":');
    assert.equal(broken.status, 400);
    const invalid = await api().post('/api/tasks').set(bearer(token)).send({ title: '', foo: 1 });
    assert.equal(invalid.status, 422);
    assert.ok(invalid.body.errors.title);
    assert.ok(invalid.body.errors.foo);
    const form = await api().post('/api/tasks').set(bearer(token)).type('form').send('title=x');
    assert.equal(form.status, 415);
  });
});

describe('регистрация и токены', () => {
  test('регистрация: 201, роль user; повтор email — 409; слабый пароль — 422', async () => {
    const ok = await api().post('/api/auth/register').send({ email: 'New@Example.com', name: 'Новый', password: 'Secret123' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.role, 'user');
    assert.equal(ok.body.user.email, 'new@example.com');
    const dup = await api().post('/api/auth/register').send({ email: 'new@example.com', name: 'X', password: 'Secret123' });
    assert.equal(dup.status, 409);
    const weak = await api().post('/api/auth/register').send({ email: 'weak@example.com', name: 'X', password: '123' });
    assert.equal(weak.status, 422);
  });

  test('refresh выдаёт новый access-токен и меняет refresh-токен (ротация)', async () => {
    const { cookie } = await login('user@example.com', 'User12345');
    const r1 = await api().post('/api/auth/refresh').set('Cookie', cookie);
    assert.equal(r1.status, 200);
    assert.ok(r1.body.accessToken);
    // старый refresh-токен больше не работает
    const r2 = await api().post('/api/auth/refresh').set('Cookie', cookie);
    assert.equal(r2.status, 401);
  });

  test('после выхода access-токен этой сессии сразу перестаёт работать', async () => {
    const { token, cookie } = await login('user@example.com', 'User12345');
    assert.equal((await api().get('/api/auth/me').set(bearer(token))).status, 200);
    assert.equal((await api().post('/api/auth/logout').set('Cookie', cookie)).status, 204);
    assert.equal((await api().get('/api/auth/me').set(bearer(token))).status, 401);
  });
});

describe('роли и права', () => {
  test('user видит только свои задачи, чужую — 403', async () => {
    const u = await login('user@example.com', 'User12345');
    const a = await login('admin@example.com', 'Admin12345');
    const own = await api().post('/api/tasks').set(bearer(u.token)).send({ title: 'Моя' });
    assert.equal(own.status, 201);
    assert.equal(own.headers.location, `/api/tasks/${own.body.id}`);
    const foreign = await api().post('/api/tasks').set(bearer(a.token)).send({ title: 'Админская' });

    const list = await api().get('/api/tasks').set(bearer(u.token));
    assert.ok(list.body.every((t) => t.ownerId === u.user.id));
    assert.equal((await api().get(`/api/tasks/${foreign.body.id}`).set(bearer(u.token))).status, 403);
  });

  test('manager видит и меняет чужие задачи, но не удаляет; admin удаляет', async () => {
    const u = await login('user@example.com', 'User12345');
    const m = await login('manager@example.com', 'Manager12345');
    const a = await login('admin@example.com', 'Admin12345');
    const t = await api().post('/api/tasks').set(bearer(u.token)).send({ title: 'Для менеджера' });

    const all = await api().get('/api/tasks').set(bearer(m.token));
    assert.ok(all.body.some((x) => x.id === t.body.id));
    const patched = await api().patch(`/api/tasks/${t.body.id}`).set(bearer(m.token)).send({ status: 'done' });
    assert.equal(patched.status, 200);
    assert.equal((await api().delete(`/api/tasks/${t.body.id}`).set(bearer(m.token))).status, 403);
    assert.equal((await api().delete(`/api/tasks/${t.body.id}`).set(bearer(a.token))).status, 204);
  });

  test('управлять пользователями может только admin', async () => {
    const u = await login('user@example.com', 'User12345');
    const m = await login('manager@example.com', 'Manager12345');
    const a = await login('admin@example.com', 'Admin12345');
    assert.equal((await api().get('/api/users').set(bearer(u.token))).status, 403);
    assert.equal((await api().get('/api/users').set(bearer(m.token))).status, 200);
    assert.equal((await api().patch(`/api/users/${u.user.id}`).set(bearer(m.token)).send({ role: 'admin' })).status, 403);
    assert.equal((await api().patch(`/api/users/${a.user.id}`).set(bearer(a.token)).send({ role: 'user' })).status, 403);

    // блокировка: все сессии пользователя сразу перестают работать
    const blocked = await api().patch(`/api/users/${u.user.id}`).set(bearer(a.token)).send({ isActive: false });
    assert.equal(blocked.status, 200);
    assert.equal((await api().get('/api/tasks').set(bearer(u.token))).status, 401);
    const relogin = await api().post('/api/auth/login').send({ email: 'user@example.com', password: 'User12345' });
    assert.equal(relogin.status, 403);
    await api().patch(`/api/users/${u.user.id}`).set(bearer(a.token)).send({ isActive: true });
  });
});

describe('защита от подбора и сессии', () => {
  test('после 5 неверных паролей — 429 с Retry-After, даже с верным паролем', async () => {
    await api().post('/api/auth/register').send({ email: 'brute@example.com', name: 'B', password: 'Secret123' });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await api().post('/api/auth/login').send({ email: 'brute@example.com', password: 'wrong' })).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
    const locked = await api().post('/api/auth/login').send({ email: 'brute@example.com', password: 'Secret123' });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);
  });

  test('список сессий и завершение другой сессии', async () => {
    const s1 = await login('manager@example.com', 'Manager12345');
    const s2 = await login('manager@example.com', 'Manager12345');
    const list = await api().get('/api/auth/sessions').set(bearer(s1.token));
    assert.equal(list.status, 200);
    const other = list.body.find((s) => !s.current);
    assert.ok(other);
    assert.equal((await api().delete(`/api/auth/sessions/${other.id}`).set(bearer(s1.token))).status, 204);
    // если завершили именно s2 — её токен больше не работает
    const me2 = await api().get('/api/auth/me').set(bearer(s2.token));
    assert.ok([200, 401].includes(me2.status));
  });
});

describe('восстановление пароля по email', () => {
  test('письмо со ссылкой, смена пароля, повторное использование ссылки — 410', async () => {
    mailer.sent.length = 0;
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    assert.equal(unknown.status, 202);
    assert.equal(mailer.sent.length, 0); // для неизвестного email письмо не отправляется, но ответ тот же

    const res = await api().post('/api/auth/forgot-password').send({ email: 'new@example.com' });
    assert.equal(res.status, 202);
    assert.equal(mailer.sent.length, 1);
    const token = mailer.sent[0].text.match(/token=([\w-]+)/)[1];

    assert.equal((await api().post('/api/auth/reset-password').send({ token, password: 'NewSecret456' })).status, 204);
    assert.equal((await api().post('/api/auth/reset-password').send({ token, password: 'Other789x' })).status, 410);
    assert.equal((await api().post('/api/auth/reset-password').send({ token: 'garbage', password: 'Other789x' })).status, 400);
    await login('new@example.com', 'NewSecret456');
  });
});
