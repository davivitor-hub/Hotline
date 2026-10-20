/* NEON DUEL — servidor autoritativo (HTTP estático + WebSocket)
   Render: npm install && npm start
   Estrutura esperada:
     server.js
     package.json
     public/index.html
     public/shared.js
     public/ (demais arquivos do jogo)
*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const S = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.resolve(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};
const SKINS = ['ROOSTER', 'TIGER', 'BEAR', 'MONKEY', 'WOLF'];

if (!S || typeof S.Game !== 'function') {
  throw new Error('public/shared.js não exporta Game corretamente. Verifique o arquivo compartilhado.');
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }

  if (pathname === '/') pathname = '/index.html';

  // Resolve e valida o caminho para impedir acesso fora da pasta public.
  const file = path.resolve(PUB, '.' + pathname);
  if (file !== PUB && !file.startsWith(PUB + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      return res.end(err.code === 'ENOENT' ? '404 - Arquivo não encontrado' : 'Erro interno');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 2048 });
const game = new S.Game();
const clients = new Map();
let nextId = 1;

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (err) {
      console.error('Falha ao enviar WebSocket:', err.message);
    }
  }
}

wss.on('connection', (ws) => {
  const c = { ws, id: 'p' + nextId++, p: null, msgs: 0 };
  clients.set(ws, c);
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (err) => console.warn('WebSocket do cliente:', err.message));
  send(ws, { type: 'welcome', id: c.id });

  ws.on('message', (raw) => {
    if (++c.msgs > 400) {
      if (c.msgs === 401) send(ws, { type: 'error', message: 'Limite de mensagens excedido.' });
      return;
    }

    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;

    if (m.type === 'join') {
      if (c.p) return;
      if (game.count >= S.MAX_PLAYERS) return send(ws, { type: 'full' });

      const skin = SKINS.includes(m.skin) ? m.skin : 'ROOSTER';
      const name = String(m.name || 'JOGADOR').replace(/[<>]/g, '').slice(0, 14);
      c.p = game.addPlayer(c.id, name, skin);

      if (!c.p) {
        send(ws, { type: 'full' });
        return;
      }

      send(ws, { type: 'joined', id: c.id, slot: c.p.slot });
      console.log(`${name} entrou (${c.id}); jogadores: ${game.count}/${S.MAX_PLAYERS}`);
      return;
    }

    if (m.type === 'input' && c.p) {
      const seq = Number(m.seq);
      const dt = Number(m.dt);
      const a = Number(m.a);
      if (!Number.isFinite(seq) || !Number.isFinite(dt) || !Number.isFinite(a)) return;

      if (seq > c.p.ack) c.p.ack = seq;
      game.applyInput(c.p, {
        k: Number(m.k) | 0,
        a,
        f: m.f ? 1 : 0,
        fp: m.fp ? 1 : 0,
        pk: m.pk ? 1 : 0,
        th: m.th ? 1 : 0,
        hl: m.hl ? 1 : 0
      }, Math.max(0, Math.min(0.05, dt)));
      return;
    }

    if (m.type === 'start' && c.p) {
      if (!game.requestStart(c.id)) send(ws, { type: 'error', message: 'Só o anfitrião inicia, com 2 ou mais jogadores.' });
      else console.log(`${c.id} iniciou a partida com ${game.count} jogadores`);
      return;
    }

    if (m.type === 'ping') send(ws, { type: 'pong', t: m.t });
  });

  ws.on('close', () => {
    if (c.p) {
      game.removePlayer(c.id);
      console.log(`${c.id} saiu; jogadores: ${game.count}/${S.MAX_PLAYERS}`);
    }
    clients.delete(ws);
  });
});

function broadcast() {
  const snap = game.snapshot();
  game.events = [];

  for (const [ws, c] of clients) {
    if (!c.p || ws.readyState !== WebSocket.OPEN) continue;
    // Cria um objeto por cliente para não compartilhar/mutar o mesmo snapshot.
    send(ws, { ...snap, ack: c.p.ack });
  }
}

// Loop fixo de 60 Hz; snapshots enviados a 30 Hz.
let last = Date.now();
let acc = 0;
let tickN = 0;
const DT = 1 / 60;

setInterval(() => {
  const now = Date.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;

  while (acc >= DT) {
    game.tick(DT);
    acc -= DT;
    if (++tickN % 2 === 0) broadcast();
  }
}, 8);

setInterval(() => {
  for (const c of clients.values()) c.msgs = 0;
}, 1000);

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, 15000);

server.on('error', (err) => {
  console.error('Erro HTTP:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NEON DUEL rodando na porta ${PORT}`);
});

function shutdown() {
  console.log('Encerrando servidor...');
  for (const ws of wss.clients) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
