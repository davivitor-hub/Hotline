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
// Várias salas ao mesmo tempo: cada sala tem um código de 4 letras, o seu próprio Game e a sua lista de jogadores.
const rooms = new Map();
const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS) || 40);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sem 0/O/1/I para não confundir
const SKINS = ['ROOSTER', 'TIGER', 'BEAR', 'MONKEY', 'WOLF', 'HIPPO', 'FISH', 'DRAGON'];

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
    let n = 0; for (const r of rooms.values()) n += r.game.count;
    return res.end(`ok · ${rooms.size} sala(s) · ${n} jogador(es) · cada sala de ${S.MIN_PLAYERS} a ${S.MAX_PLAYERS}`);
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

// Latência: sem compressão por mensagem (deflate adiciona atraso e CPU) e sem Nagle (TCP_NODELAY) em todo socket.
server.on('connection', (sock) => sock.setNoDelay(true));
const wss = new WebSocket.Server({ server, maxPayload: 2048, perMessageDeflate: false });
const clients = new Map();
let nextId = 1;

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
// pub = sala pública (entra na "partida rápida"); privada só entra quem tem o código
function createRoom(pub, map) {
  const room = { code: newCode(), pub: !!pub, game: new S.Game({ map }), clients: new Set() };
  rooms.set(room.code, room);
  console.log(`sala ${room.code} criada (${room.pub ? 'pública' : 'privada'}); salas: ${rooms.size}`);
  return room;
}
function dropIfEmpty(room) {
  if (room && room.game.count === 0 && rooms.get(room.code) === room) {
    rooms.delete(room.code);
    console.log(`sala ${room.code} fechada; salas: ${rooms.size}`);
  }
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (err) {
      console.error('Falha ao enviar WebSocket:', err.message);
    }
  }
}

wss.on('connection', (ws) => {
  const c = { ws, id: 'p' + nextId++, p: null, room: null, msgs: 0 };
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
      // mode: 'quick' (partida rápida), 'create' (sala privada nova) ou 'code' (entrar numa sala pelo código)
      const mode = m.mode === 'create' || m.mode === 'code' ? m.mode : 'quick';
      let room = null;
      if (mode === 'code') {
        const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        room = rooms.get(code);
        if (!room) return send(ws, { type: 'noroom' });
      } else if (mode === 'quick') {
        // prefere a sala pública mais cheia que ainda está na espera (junta o pessoal)
        room = [...rooms.values()]
          .filter((r) => r.pub && r.game.phase === 'lobby' && r.game.count > 0 && r.game.count < S.MAX_PLAYERS)
          .sort((a, b) => b.game.count - a.game.count)[0] || null;
      }
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'busy' });
        room = createRoom(mode === 'quick', mode === 'create' && S.MAPS[m.map] ? m.map : null);
      }
      if (room.game.count >= S.MAX_PLAYERS) return send(ws, { type: 'full' });

      const skin = SKINS.includes(m.skin) ? m.skin : 'ROOSTER';
      const name = String(m.name || 'JOGADOR').replace(/[<>]/g, '').slice(0, 14);
      c.p = room.game.addPlayer(c.id, name, skin);

      if (!c.p) {
        dropIfEmpty(room);
        send(ws, { type: 'full' });
        return;
      }

      c.room = room;
      room.clients.add(ws);
      send(ws, { type: 'joined', id: c.id, slot: c.p.slot, room: room.code });
      console.log(`${name} entrou (${c.id}) na sala ${room.code}; jogadores na sala: ${room.game.count}/${S.MAX_PLAYERS}`);
      return;
    }

    if (!c.p || !c.room) {
      if (m.type === 'ping') send(ws, { type: 'pong', t: m.t });
      return;
    }
    const game = c.room.game;

    if (m.type === 'input') {
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
        hl: m.hl ? 1 : 0,
        tc: m.tc ? 1 : 0,                                // segurando o botão de arremesso (carga da lança)
        sw: m.sw ? 1 : 0,                                // scroll: alterna de arma
        sl: m.sl ? 1 : 0,                                // Shift: rasteira
        ss: Math.max(0, Math.min(2, Number(m.ss) | 0))   // teclas 1/2: escolhe o espaço
      }, Math.max(0, Math.min(0.05, dt)));
      return;
    }

    if (m.type === 'start') {
      if (!game.requestStart(c.id)) send(ws, { type: 'error', message: 'Só o anfitrião inicia, com 2 ou mais jogadores.' });
      else console.log(`${c.id} iniciou a partida na sala ${c.room.code} com ${game.count} jogadores`);
      return;
    }

    if (m.type === 'ping') send(ws, { type: 'pong', t: m.t });
  });

  ws.on('close', () => {
    const room = c.room;
    if (c.p && room) {
      room.game.removePlayer(c.id);
      room.clients.delete(ws);
      console.log(`${c.id} saiu da sala ${room.code}; jogadores na sala: ${room.game.count}/${S.MAX_PLAYERS}`);
      dropIfEmpty(room);
    }
    clients.delete(ws);
  });
});

function broadcast(room) {
  const game = room.game;
  const snap = game.snapshot();
  game.events = [];

  // Serializa uma única vez por sala e só anexa o ack de cada cliente (evita N× JSON.stringify a 60 Hz).
  const base = JSON.stringify(snap).slice(0, -1) + ',"room":"' + room.code + '"';
  for (const ws of room.clients) {
    const c = clients.get(ws);
    if (!c || !c.p || ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(base + ',"ack":' + (c.p.ack | 0) + '}'); } catch (err) {
      console.error('Falha ao enviar snapshot:', err.message);
    }
  }
}

// Loop fixo de 60 Hz para TODAS as salas; snapshots a 60 Hz (SNAP_EVERY=2 volta para 30 Hz se a banda do host for curta).
const SNAP_EVERY = Math.max(1, Number(process.env.SNAP_EVERY) || 1);
let last = Date.now();
let acc = 0;
let tickN = 0;
const DT = 1 / 60;

setInterval(() => {
  const now = Date.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;

  while (acc >= DT) {
    const snapNow = ++tickN % SNAP_EVERY === 0;
    for (const room of rooms.values()) {
      room.game.tick(DT);
      if (snapNow) broadcast(room);
    }
    acc -= DT;
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
