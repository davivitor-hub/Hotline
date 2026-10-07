const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
const W = 800, H = 600;

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function updateRoomPhysics(room) {
  if (!room.gameStarted || room.players.length < 2) return;

  let b = room.bola;
  b.x += b.vx;
  b.y += b.vy;

  // Colisão Teto/Chão
  if (b.y <= 10 || b.y >= H - 10) {
    b.vy *= -1;
    b.y = Math.max(10, Math.min(H - 10, b.y));
  }

  // Colisão Raquete P1 (Esquerda)
  if (b.x <= 45 && b.x >= 24 && b.y >= room.j1Y - 4 && b.y <= room.j1Y + 100 && b.vx < 0) {
    b.vx = Math.min(Math.abs(b.vx) * 1.05 + 0.1, 15);
    b.vy += (b.y - room.j1Y - 50) / 18;
    b.x = 45;
  }

  // Colisão Raquete P2 (Direita)
  if (b.x >= 755 && b.x <= 776 && b.y >= room.j2Y - 4 && b.y <= room.j2Y + 100 && b.vx > 0) {
    b.vx = -Math.min(Math.abs(b.vx) * 1.05 + 0.1, 15);
    b.vy += (b.y - room.j2Y - 50) / 18;
    b.x = 755;
  }

  // Ponto P2
  if (b.x < -20) {
    room.pontosJ2++;
    resetBall(room, 1);
  }

  // Ponto P1
  if (b.x > W + 20) {
    room.pontosJ1++;
    resetBall(room, -1);
  }
}

function resetBall(room, dir) {
  room.bola = {
    x: W / 2,
    y: H / 2,
    vx: 7 * dir,
    vy: (Math.random() - 0.5) * 6
  };
}

// Loop de jogo do servidor (60 FPS)
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.gameStarted && room.players.length === 2) {
      updateRoomPhysics(room);
      io.to(roomId).emit('state', {
        p1: room.j1Y,
        p2: room.j2Y,
        score1: room.pontosJ1,
        score2: room.pontosJ2,
        ball: room.bola,
        running: true
      });
    }
  }
}, 1000 / 60);

io.on('connection', (socket) => {
  socket.on('rooms:list', () => {
    const publicRooms = Object.values(rooms)
      .filter(r => r.public && r.players.length < 2)
      .map(r => ({ code: r.id, name: r.name, players: r.players.length }));
    socket.emit('rooms:update', publicRooms);
  });

  socket.on('room:create', (data = {}) => {
    let roomId = data.code || generateRoomId();
    while (rooms[roomId]) {
      roomId = generateRoomId();
    }

    rooms[roomId] = {
      id: roomId,
      name: data.name || `Sala ${roomId}`,
      public: data.public !== undefined ? data.public : true,
      players: [socket.id],
      j1Y: 250,
      j2Y: 250,
      pontosJ1: 0,
      pontosJ2: 0,
      bola: { x: 400, y: 300, vx: 7, vy: 2 },
      gameStarted: false
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerNum = 1;

    socket.emit('room:created', { code: roomId, name: rooms[roomId].name, player: 1 });
  });

  socket.on('room:join', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('room:error', 'Sala não encontrada!');
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('room:error', 'Sala cheia!');
      return;
    }

    room.players.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerNum = 2;
    room.gameStarted = true;

    socket.emit('room:joined', { code: roomId, player: 2 });

    io.to(roomId).emit('match:start', {
      p1: room.j1Y,
      p2: room.j2Y,
      score1: room.pontosJ1,
      score2: room.pontosJ2,
      ball: room.bola,
      running: true
    });
  });

  socket.on('paddle:set', (y) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    if (socket.playerNum === 1) room.j1Y = y;
    else if (socket.playerNum === 2) room.j2Y = y;
  });

  socket.on('room:leave', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });

  function leaveRoom(s) {
    const roomId = s.roomId;
    if (roomId && rooms[roomId]) {
      io.to(roomId).emit('room:closed');
      delete rooms[roomId];
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});