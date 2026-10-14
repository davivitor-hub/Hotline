/* NEON DUEL — servidor autoritativo (HTTP estático + WebSocket)
   Uso: npm install && npm start   (porta via process.env.PORT, padrão 3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const S = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const SKINS = ['ROOSTER', 'TIGER', 'BEAR', 'MONKEY', 'WOLF'];

const server = http.createServer((req, res) => {
  let u = '/';
  try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch { }
  if (u === '/health') { res.writeHead(200); return res.end('ok'); }
  if (u === '/') u = '/index.html';
  const file = path.join(PUB, path.normalize(u));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 2048 });
const game = new S.Game();
const clients = new Map();
let nextId = 1;
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

wss.on('connection', ws => {
  const c = { ws, id: 'p' + (nextId++), p: null, msgs: 0 };
  clients.set(ws, c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'welcome', id: c.id });

  ws.on('message', raw => {
    if (++c.msgs > 400) return;               // limite de mensagens por segundo
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.type === 'join') {
      if (c.p) return;
      if (game.count >= 2) return send(ws, { type: 'full' });
      const skin = SKINS.includes(m.skin) ? m.skin : 'ROOSTER';
      c.p = game.addPlayer(c.id, String(m.name || '').replace(/[<>]/g, ''), skin);
      send(ws, { type: 'joined', id: c.id });
    } else if (m.type === 'input' && c.p) {
      const seq = Number(m.seq), dt = Number(m.dt), a = Number(m.a);
      if (!Number.isFinite(seq) || !Number.isFinite(dt) || !Number.isFinite(a)) return;
      if (seq > c.p.ack) c.p.ack = seq;
      game.applyInput(c.p, { k: m.k | 0, a, f: m.f ? 1 : 0, fp: m.fp ? 1 : 0, pk: m.pk ? 1 : 0, th: m.th ? 1 : 0 }, Math.max(0, Math.min(0.05, dt)));
    } else if (m.type === 'ping') {
      send(ws, { type: 'pong', t: m.t });
    }
  });

  ws.on('close', () => {
    if (c.p) game.removePlayer(c.id);
    clients.delete(ws);
  });
});

function broadcast() {
  const snap = game.snapshot();
  game.events = [];
  for (const [ws, c] of clients) {
    if (!c.p || ws.readyState !== 1) continue;
    snap.ack = c.p.ack;
    ws.send(JSON.stringify(snap));
  }
}

// loop fixo de 60 Hz, snapshots a 30 Hz
let last = Date.now(), acc = 0, tickN = 0;
const DT = 1 / 60;
setInterval(() => {
  const now = Date.now();
  acc += Math.min(0.25, (now - last) / 1000); last = now;
  while (acc >= DT) { game.tick(DT); acc -= DT; if (++tickN % 2 === 0) broadcast(); }
}, 8);

setInterval(() => { for (const c of clients.values()) c.msgs = 0; }, 1000);
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 15000);

server.listen(PORT, () => console.log(`NEON DUEL rodando em http://localhost:${PORT}`));
