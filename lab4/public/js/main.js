// Точка входа клиента: связывает соединение, состояние, отрисовку и интерфейс
import { storage } from './storage.js';
import { Connection } from './connection.js';
import { GameState } from './state.js';
import { Renderer } from './render.js';
import { ui } from './ui.js';

const state = new GameState();
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const pending = new Map(); // actionId → claim, отправленные и ещё без ответа
let queue = storage.get('queue', []); // клики, сделанные без связи (переживают перезагрузку вкладки)
let wasOnline = false;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const conn = new Connection({
  url: wsUrl,
  onOpen: () => {
    // представляемся: токен из localStorage + номер последнего увиденного события
    conn.send({ type: 'hello', token: storage.get('token'), name: storage.get('name'), lastSeq: state.lastSeq || null });
  },
  onMessage: handleMessage,
  onStatus: (s, attempt) => {
    if (s === 'connecting') ui.status('connecting', attempt ? `Переподключение (попытка ${attempt})…` : 'Подключение…');
    if (s === 'offline') {
      ui.status('offline', 'Нет связи');
      // клики, на которые не пришёл ответ, повторим после переподключения
      // (сервер не засчитает один клик дважды — ответит «duplicate»)
      for (const c of pending.values()) queue.push({ ...c, queued: true });
      pending.clear();
      saveQueue();
    }
    ui.offline(wasOnline && s !== 'online', queue.length);
  },
});

const renderer = new Renderer(document.getElementById('canvas'), state, conn);

function saveQueue() {
  storage.set('queue', queue);
  renderer.queued = new Set(queue.map((q) => q.targetId));
  renderer.pending = new Set([...pending.values()].map((c) => c.targetId));
}

// ---------- сообщения сервера ----------

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      return onWelcome(msg);
    case 'event':
      return onEvent(msg);
    case 'claim.result':
      return onClaimResult(msg);
    case 'presence':
      state.online = msg.online;
      return ui.online(state.online, state.you?.id);
    case 'error':
      console.warn('Сервер:', msg);
      if (msg.code === 'bad_name') ui.toast(msg.message, 'bad');
      return undefined;
    default:
      return undefined;
  }
}

function onWelcome(msg) {
  if (msg.token) storage.set('token', msg.token);
  state.you = msg.you;
  storage.set('you', msg.you);
  storage.set('name', msg.you.name);

  // Что произошло, пока нас не было
  if (msg.missed) {
    const { events, tooMany } = msg.missed;
    if (tooMany) {
      ui.feed('Связь восстановлена. Пропущено много событий — загружено актуальное состояние.', 'info');
    } else if (events.length) {
      const claims = events.filter((e) => e.type === 'target.claimed' && e.data.by.id !== msg.you.id).length;
      const matches = events.filter((e) => e.type === 'match.ended').length;
      if (events.some((e) => e.type === 'match.resumed')) {
        ui.feed('Сервер перезапускался — матч продолжился с сохранённого места.', 'info');
      }
      ui.feed(
        `Связь восстановлена. Пока вас не было: событий — ${events.length}, целей забрали другие — ${claims}` +
          (matches ? `, завершилось матчей — ${matches}` : '') + '.',
        'info',
      );
    } else if (wasOnline) {
      ui.feed('Связь восстановлена, ничего не пропущено.', 'info');
    }
  }

  state.applySnapshot(msg.snapshot);
  state.online = msg.online;
  wasOnline = true;
  ui.status('online', 'Онлайн');
  refreshPanels();

  // Отправляем клики, накопленные без связи. Сервер проверит каждый:
  // цель могла исчезнуть или её уже забрал кто-то другой.
  if (queue.length) {
    ui.feed(`Отправляем клики из очереди: ${queue.length}.`, 'info');
    const toSend = queue;
    queue = [];
    for (const c of toSend) sendClaim(c);
  }
  saveQueue();
  ui.offline(false, 0);
}

function onEvent(msg) {
  // цель до удаления из состояния — чтобы нарисовать вспышку на её месте
  const target = msg.event === 'target.claimed' ? state.targets.get(msg.data.targetId) : null;
  if (!state.applyEvent(msg)) return; // уже видели
  const d = msg.data;
  const meId = state.you?.id;
  switch (msg.event) {
    case 'target.claimed': {
      if (target) renderer.addEffect({ type: 'pop', x: target.x, y: target.y, r: target.r, color: d.by.color, text: `+${d.points} ${d.by.id === meId ? 'вы' : d.by.name}` });
      if (d.by.id !== meId && d.points >= 5) ui.feed(`${d.by.name} поймал(а) золотую цель +${d.points} (${d.reactionMs} мс)`);
      break;
    }
    case 'match.started':
      ui.feed(`Матч #${d.match.id} начался!`, 'info');
      break;
    case 'match.ended': {
      const w = d.results[0];
      ui.feed(w && w.points > 0 ? `Матч #${d.matchId} окончен. Победитель: ${w.name} (${w.points} оч.)` : `Матч #${d.matchId} окончен.`, 'info');
      fetch('/api/leaderboard')
        .then((r) => r.json())
        .then((list) => {
          state.leaderboard = list;
          ui.leaderboard(list, meId);
        })
        .catch(() => {});
      break;
    }
    case 'match.resumed':
      ui.feed('Сервер перезапустился — матч продолжается с сохранённого места.', 'info');
      break;
    default:
      break;
  }
  refreshPanels();
}

function onClaimResult(r) {
  const c = pending.get(r.actionId);
  pending.delete(r.actionId);
  saveQueue();
  const late = c?.queued ? ' (клик был сделан без связи)' : '';
  if (r.ok) {
    ui.toast(`+${r.points} · ${r.reactionMs} мс`, 'good');
    return;
  }
  if (c) renderer.addEffect({ type: 'reject', x: c.x, y: c.y, duration: 600 });
  switch (r.reason) {
    case 'conflict': {
      const who = r.by?.name || 'другой игрок';
      const ms = Number.isFinite(r.lateMs) ? ` на ${r.lateMs} мс` : '';
      ui.toast(`Не успели: ${who} быстрее${ms}`, 'bad');
      ui.feed(`Конфликт: цель забрал(а) ${who} раньше вас${ms}${late}`, 'bad');
      break;
    }
    case 'expired':
      ui.toast('Цель уже исчезла', 'bad');
      if (c?.queued) ui.feed(`Клик из очереди отклонён: цель исчезла${late}`, 'bad');
      break;
    case 'miss':
      ui.toast('Мимо', 'bad');
      break;
    case 'rate_limited':
      ui.toast('Слишком часто кликаете', 'bad');
      break;
    default:
      break; // duplicate / no_match — молча
  }
}

// ---------- клики ----------

function sendClaim(c) {
  if (conn.send({ type: 'claim', ...c })) {
    pending.set(c.actionId, c);
  } else {
    queue.push({ ...c, queued: true }); // нет связи — в очередь
    ui.offline(true, queue.length);
  }
}

document.getElementById('canvas').addEventListener('pointerdown', (e) => {
  if (state.match?.status !== 'running') return;
  const { x, y } = renderer.toField(e);
  const t = renderer.hitTest(x, y);
  if (!t) {
    renderer.addEffect({ type: 'miss', x, y, duration: 300 });
    return;
  }
  const already = [...pending.values(), ...queue].some((c) => c.targetId === t.id);
  if (already) return;
  sendClaim({ actionId: newId(), targetId: t.id, x, y });
  saveQueue();
});

// ---------- интерфейс ----------

function refreshPanels() {
  const meId = state.you?.id;
  ui.me(state.you);
  ui.scores(state.scores, meId);
  ui.online(state.online, meId);
  ui.leaderboard(state.leaderboard, meId);
  ui.myPoints(state.myPoints());
}

setInterval(() => {
  ui.matchbar(state.match, conn.serverNow());
  ui.breakOverlay(state.match, conn.serverNow(), state.you?.id);
}, 200);

const dialog = document.getElementById('name-dialog');
const nameInput = document.getElementById('name-input');

document.getElementById('me').addEventListener('click', () => {
  nameInput.value = state.you?.name || storage.get('name', '');
  dialog.showModal();
});

document.getElementById('name-form').addEventListener('submit', () => {
  const name = nameInput.value.trim();
  if (!name) return;
  storage.set('name', name);
  if (state.you) {
    conn.send({ type: 'rename', name });
    state.you = { ...state.you, name };
    ui.me(state.you);
  } else {
    conn.connect(); // первый вход
  }
});

// для автотестов в браузере: http://…/?debug открывает доступ к состоянию из консоли
if (new URLSearchParams(location.search).has('debug')) window.__game = { state, renderer, conn };

// ---------- старт ----------

refreshPanels(); // показываем последнее сохранённое состояние ещё до подключения
if (storage.get('token') || storage.get('name')) {
  conn.connect();
} else {
  dialog.showModal(); // первый визит — спрашиваем имя
}
