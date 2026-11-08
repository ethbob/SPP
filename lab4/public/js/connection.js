// WebSocket-соединение с автоматическим переподключением.
// При обрыве: статус «нет связи» → попытки переподключиться с растущей паузой
// (0.5 с, 1 с, 2 с … до 10 с). Браузерные события online/offline ускоряют реакцию.
export class Connection {
  constructor({ url, onOpen, onMessage, onStatus }) {
    this.url = url;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.attempt = 0;
    this.retryTimer = null;
    this.rtt = null; //       задержка туда-обратно, мс
    this.clockOffset = 0; //  serverTime − localTime: время целей считаем по часам сервера

    window.addEventListener('online', () => this.reconnectNow());
    window.addEventListener('offline', () => this.ws?.close());
    // пинг каждые 5 секунд: измеряем задержку и замечаем «тихо умершее» соединение
    setInterval(() => this.ping(), 5000);
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.onStatus('connecting', this.attempt);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.lastPong = Date.now();

    ws.onopen = () => {
      this.attempt = 0;
      this.onOpen();
      this.ping();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        this.lastPong = Date.now();
        this.rtt = Date.now() - msg.t;
        this.clockOffset = msg.serverNow + this.rtt / 2 - Date.now();
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onStatus('offline', this.attempt);
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  scheduleReconnect() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(10_000, 500 * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  reconnectNow() {
    if (this.isOpen || this.ws?.readyState === WebSocket.CONNECTING) return;
    this.attempt = 0;
    this.connect();
  }

  send(msg) {
    if (!this.isOpen) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  ping() {
    if (!this.isOpen) return;
    // если ответа на пинг нет 12 секунд — соединение мёртвое, переподключаемся
    if (Date.now() - this.lastPong > 12_000) {
      this.ws.close();
      return;
    }
    this.send({ type: 'ping', t: Date.now() });
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }
}
