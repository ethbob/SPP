// Состояние игры на клиенте. Меняется только снимком (snapshot) и событиями сервера.
// Последний снимок и номер события сохраняются в localStorage: после обрыва связи
// или перезагрузки вкладки игра показывается сразу, а сервер досылает пропущенное.
import { storage } from './storage.js';

export class GameState {
  constructor() {
    this.you = storage.get('you');
    this.match = null;
    this.targets = new Map();
    this.scores = [];
    this.leaderboard = [];
    this.online = [];
    this.lastSeq = storage.get('lastSeq', 0);
    this.saveTimer = null;

    const cached = storage.get('snapshot');
    if (cached) this.applySnapshot(cached, { fromCache: true });
  }

  applySnapshot(s, { fromCache = false } = {}) {
    this.match = s.match;
    this.targets = new Map(s.targets.map((t) => [t.id, t]));
    this.scores = s.scores;
    this.leaderboard = s.leaderboard;
    if (!fromCache) {
      this.lastSeq = s.lastSeq;
      this.persist();
    }
  }

  // Применить событие; возвращает false, если оно уже было (дубликат после переподключения)
  applyEvent(e) {
    if (e.seq <= this.lastSeq) return false;
    this.lastSeq = e.seq;
    const d = e.data;
    switch (e.event) {
      case 'match.started':
        this.match = d.match;
        this.targets.clear();
        this.scores = [];
        break;
      case 'match.ended':
        this.match = { id: d.matchId, status: 'break', nextStartAt: d.nextStartAt, results: d.results };
        this.targets.clear();
        break;
      case 'target.spawned':
        this.targets.set(d.target.id, d.target);
        break;
      case 'target.expired':
        this.targets.delete(d.targetId);
        break;
      case 'target.claimed': {
        this.targets.delete(d.targetId);
        const row = this.scores.find((s) => s.id === d.by.id);
        if (row) Object.assign(row, d.score, { name: d.by.name });
        else this.scores.push({ ...d.by, ...d.score });
        this.scores.sort((a, b) => b.points - a.points);
        break;
      }
      case 'player.renamed':
        for (const list of [this.scores, this.leaderboard]) {
          const p = list.find((x) => x.id === d.player.id);
          if (p) p.name = d.player.name;
        }
        break;
      default:
        break;
    }
    this.persistSoon();
    return true;
  }

  myPoints() {
    return this.scores.find((s) => s.id === this.you?.id)?.points ?? 0;
  }

  snapshotForCache() {
    return {
      match: this.match,
      targets: [...this.targets.values()],
      scores: this.scores,
      leaderboard: this.leaderboard,
      lastSeq: this.lastSeq,
    };
  }

  persist() {
    storage.set('lastSeq', this.lastSeq);
    storage.set('snapshot', this.snapshotForCache());
  }

  // события идут часто — сохраняем не чаще раза в секунду
  persistSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 1000);
  }
}
