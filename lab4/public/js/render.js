// Отрисовка поля на <canvas> через requestAnimationFrame (≈60 кадров в секунду)
const KIND_COLORS = { normal: '#4c8dff', small: '#b06cff', gold: '#ffb020' };

export class Renderer {
  constructor(canvas, state, conn) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    this.conn = conn;
    this.effects = []; //  вспышки, всплывающие очки, промахи
    this.pending = new Set(); // цели, по которым мы кликнули и ждём ответа сервера
    this.queued = new Set(); //  клики, сделанные без связи
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.size = Math.min(this.canvas.width, this.canvas.height);
  }

  // координаты поля — от 0 до 1, чтобы у всех игроков было одинаково при любом размере экрана
  toPx(v) {
    return v * this.size;
  }

  addEffect(e) {
    this.effects.push({ ...e, start: performance.now() });
  }

  frame(now) {
    const { ctx } = this;
    const S = this.size;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // сетка-фон
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const p = (i / 10) * S;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }

    const serverNow = this.conn.serverNow();
    const running = this.state.match?.status === 'running';

    for (const t of this.state.targets.values()) {
      const total = t.expiresAt - t.spawnedAt;
      const left = t.expiresAt - serverNow;
      if (left <= 0) continue;
      const age = serverNow - t.spawnedAt;
      const appear = Math.min(1, Math.max(0.2, age / 140)); // появление с увеличением
      const x = this.toPx(t.x);
      const y = this.toPx(t.y);
      const r = this.toPx(t.r) * appear;
      const color = KIND_COLORS[t.kind] || KIND_COLORS.normal;

      ctx.save();
      if (!running) ctx.globalAlpha = 0.3;
      if (t.kind === 'gold') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 24;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // кольцо оставшегося времени
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(2, r * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, r + ctx.lineWidth, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / total));
      ctx.stroke();

      // очки внутри
      ctx.fillStyle = t.kind === 'gold' ? '#2b1a00' : '#fff';
      ctx.font = `700 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${t.points}`, x, y + 1);

      // мы кликнули и ждём ответа сервера / клик в очереди без связи
      if (this.pending.has(t.id) || this.queued.has(t.id)) {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = this.queued.has(t.id) ? '#ff5a5f' : '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    this.drawEffects(now);
    requestAnimationFrame((t) => this.frame(t));
  }

  drawEffects(now) {
    const { ctx } = this;
    this.effects = this.effects.filter((e) => now - e.start < (e.duration || 700));
    for (const e of this.effects) {
      const p = (now - e.start) / (e.duration || 700);
      const x = this.toPx(e.x);
      const y = this.toPx(e.y);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      if (e.type === 'pop') {
        // захват: расходящееся кольцо цвета игрока и «+N Имя»
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, this.toPx(e.r) * (1 + p * 1.2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = e.color;
        ctx.font = `700 ${Math.round(this.size * 0.032)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(e.text, x, y - this.toPx(e.r) - 10 - p * 30);
      } else if (e.type === 'miss') {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6 + p * 16, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'reject') {
        // конфликт: красный крестик там, где мы не успели
        const s = this.size * 0.025;
        ctx.strokeStyle = '#ff5a5f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s);
        ctx.lineTo(x - s, y + s);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Какая цель под точкой клика (ближайшая, с небольшим запасом)
  hitTest(nx, ny) {
    const serverNow = this.conn.serverNow();
    let best = null;
    let bestD = Infinity;
    for (const t of this.state.targets.values()) {
      if (t.expiresAt <= serverNow) continue;
      const d = Math.hypot(nx - t.x, ny - t.y);
      if (d <= t.r * 1.1 && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  // Клик → координаты поля 0..1
  toField(event) {
    const rect = this.canvas.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height);
    return { x: (event.clientX - rect.left) / side, y: (event.clientY - rect.top) / side };
  }
}
