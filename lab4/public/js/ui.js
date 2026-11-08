// Обновление панелей интерфейса (обычный DOM, без фреймворков)
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const playerRow = (p, value, meId) =>
  `<li class="${p.id === meId ? 'me' : ''}"><span class="swatch" style="background:${esc(p.color)}"></span>` +
  `<span class="name">${esc(p.name)}${p.id === meId ? ' (вы)' : ''}</span><span class="val">${value}</span></li>`;

export const ui = {
  status(state, text) {
    $('status').dataset.state = state;
    $('status-text').textContent = text;
  },

  me(you) {
    if (!you) return;
    $('me-name').textContent = you.name;
    $('me-color').style.background = you.color;
  },

  scores(list, meId) {
    $('scores').innerHTML = list.length
      ? list.map((p) => playerRow(p, `${p.points} оч.`, meId)).join('')
      : '<li class="empty">Пока никто не набрал очков</li>';
  },

  online(list, meId) {
    $('online-count').textContent = list.length;
    $('online').innerHTML = list.map((p) => playerRow(p, '', meId)).join('');
  },

  leaderboard(list, meId) {
    $('leaderboard').innerHTML = list.length
      ? list.map((p) => playerRow(p, `${p.points} оч.${p.bestReactionMs ? ` · ${p.bestReactionMs} мс` : ''}`, meId)).join('')
      : '<li class="empty">Нет данных</li>';
  },

  myPoints(n) {
    $('my-points').textContent = n;
  },

  // Таймер и полоска матча; вызывается несколько раз в секунду
  matchbar(match, serverNow) {
    const fill = $('match-progress');
    if (!match) return;
    if (match.status === 'running') {
      const left = Math.max(0, match.endsAt - serverNow);
      const total = match.endsAt - match.startedAt;
      $('match-title').textContent = `Матч #${match.id}`;
      $('match-timer').textContent = fmt(left);
      fill.style.width = `${(left / total) * 100}%`;
    } else {
      $('match-title').textContent = 'Перерыв';
      $('match-timer').textContent = fmt(Math.max(0, match.nextStartAt - serverNow));
      fill.style.width = '0%';
    }
  },

  breakOverlay(match, serverNow, meId) {
    const el = $('break-overlay');
    const show = match?.status === 'break';
    el.classList.toggle('hidden', !show);
    if (!show) return;
    $('next-in').textContent = Math.max(0, Math.ceil((match.nextStartAt - serverNow) / 1000));
    const results = match.results || [];
    const html = results.length
      ? results.slice(0, 5).map((p, i) => `<li>${i === 0 ? '🏆' : `${i + 1}.`} <span class="swatch" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.id === meId ? ' (вы)' : ''}<b>${p.points}</b></li>`).join('')
      : '<li>Никто не набрал очков</li>';
    if ($('results').dataset.key !== String(match.id)) {
      $('results').innerHTML = html;
      $('results').dataset.key = String(match.id);
    }
  },

  offline(show, queueSize) {
    $('offline-banner').classList.toggle('hidden', !show);
    $('queue-info').textContent = queueSize ? `В очереди кликов: ${queueSize}.` : '';
  },

  feed(text, cls = '') {
    const li = document.createElement('li');
    li.className = cls;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.textContent = `${time} ${text}`;
    const feed = $('feed');
    feed.prepend(li);
    while (feed.children.length > 40) feed.lastChild.remove();
  },

  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    $('toasts').append(el);
    setTimeout(() => el.remove(), 1800);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  },
};

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
