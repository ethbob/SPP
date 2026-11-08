// Сборка сервера: HTTP (статические файлы) + WebSocket (/ws) на одном порту
const http = require('http');
const config = require('./config');
const log = require('./logger');
const db = require('./db');
const { Game } = require('./game');
const { handleHttp } = require('./http');
const { attachRealtime } = require('./realtime');

async function createServer({ port = config.port } = {}) {
  await db.init();

  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      log.error('http.failed', { err: err.message });
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  let game;
  const realtime = attachRealtime(server, () => game);
  game = new Game({ broadcast: realtime.broadcast });
  await game.start();

  await new Promise((resolve) => server.listen(port, resolve));
  const actualPort = server.address().port;
  log.info('app.started', { port: actualPort });

  return {
    port: actualPort,
    game,
    realtime,
    async close() {
      game.stop();
      realtime.close();
      await new Promise((resolve) => server.close(resolve));
      await game.chain; // дождаться записи последних событий
    },
  };
}

module.exports = { createServer };
