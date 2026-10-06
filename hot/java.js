// ==========================================
// CONFIGURAÇÕES GLOBAIS E ESTADO DO JOGO
// ==========================================
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;
const TILE_SIZE = 40;

let canvas, ctx;
let gameState = 'MENU'; // MENU, PLAYING, PAUSED, GAMEOVER, CLEAR
let optionsReturnState = 'main';

let score = 0;
let combo = 0;
let comboTimer = 0;
let currentFloor = 1;
let screenShake = 0;
let enableShake = true;
let difficulty = 'NORMAL';

let keys = {};
let mouse = { x: 0, y: 0, worldX: 0, worldY: 0, down: false, rightDown: false };

let frameCount = 0;
let fpsTimer = performance.now();
let lastTime = performance.now();

// AUDIO SYNTHESIZER (Web Audio API - Estilo Synthwave Hotline)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSound(freq, duration, type = 'square', rampDownFreq = null) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (rampDownFreq) {
      osc.frequency.exponentialRampToValueAtTime(rampDownFreq, audioCtx.currentTime + duration);
    }
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

// ARMAS COM FÍSICA E ATRIBUTOS HOTLINE
const WEAPONS = {
  FISTS: { name: 'FISTS', ammo: Infinity, rate: 220, speed: 0, damage: 1, type: 'MELEE' },
  PISTOL: { name: 'PISTOL', ammo: 12, rate: 180, speed: 22, damage: 1, type: 'GUN', spread: 0.05 },
  SHOTGUN: { name: 'SHOTGUN', ammo: 6, rate: 600, speed: 18, damage: 1, type: 'GUN', spread: 0.25, pellets: 7 },
  RIFLE: { name: 'MAC-10', ammo: 30, rate: 70, speed: 24, damage: 1, type: 'GUN', spread: 0.12 },
  BAT: { name: 'BASEBALL BAT', ammo: Infinity, rate: 350, speed: 0, damage: 1, type: 'MELEE' }
};

// MÁSCARAS / SKINS COM BÔNUS ROGUELIKE
const SKINS = {
  ROOSTER: { name: 'RICHARD (ROOSTER)', color: '#e74c3c', speedMult: 1.0, bonus: 'Standard Mask' },
  TIGER: { name: 'TONY (TIGER)', color: '#e67e22', speedMult: 1.2, bonus: 'Lethal Fists & Speed' },
  BEAR: { name: 'MARK (BEAR)', color: '#3498db', speedMult: 0.95, bonus: 'Tank Resistance' },
  MONKEY: { name: 'RAMI (MONKEY)', color: '#9b59b6', speedMult: 1.3, bonus: 'Extreme Speed' }
};
let selectedSkin = 'ROOSTER';

// ESTADO DO MAPA PROCEDURAL (ROGUELIKE)
let currentMap = [];
let mapWidth = 35;
let mapHeight = 25;
let doors = [];

// ENTIDADES E EFEITOS
let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
let player = null;
let enemies = [];
let bullets = [];
let particles = [];
let bloodDecals = [];
let droppedWeapons = [];

// ==========================================
// GERADOR PROCEDURAL DE MAPAS (BSPTREE ROGUELIKE)
// ==========================================
function generateProceduralMap(cols, rows) {
  let grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  let rooms = [];

  class Leaf {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.w = w; this.h = h;
      this.leftChild = null; this.rightChild = null;
      this.room = null;
    }

    split() {
      if (this.leftChild || this.rightChild) return false;
      let splitH = Math.random() > 0.5;
      if (this.w / this.h >= 1.25) splitH = false;
      else if (this.h / this.w >= 1.25) splitH = true;

      let max = (splitH ? this.h : this.w) - 6;
      if (max < 6) return false;

      let split = Math.floor(Math.random() * (max - 6)) + 6;
      if (splitH) {
        this.leftChild = new Leaf(this.x, this.y, this.w, split);
        this.rightChild = new Leaf(this.x, this.y + split, this.w, this.h - split);
      } else {
        this.leftChild = new Leaf(this.x, this.y, split, this.h);
        this.rightChild = new Leaf(this.x + split, this.y, this.w - split, this.h);
      }
      return true;
    }

    createRooms() {
      if (this.leftChild || this.rightChild) {
        if (this.leftChild) this.leftChild.createRooms();
        if (this.rightChild) this.rightChild.createRooms();
        if (this.leftChild && this.rightChild) {
          let lRoom = this.leftChild.getRoom();
          let rRoom = this.rightChild.getRoom();
          if (lRoom && rRoom) createCorridor(lRoom, rRoom);
        }
      } else {
        let rw = Math.floor(Math.random() * (this.w - 4)) + 4;
        let rh = Math.floor(Math.random() * (this.h - 4)) + 4;
        let rx = Math.floor(Math.random() * (this.w - rw - 1)) + this.x + 1;
        let ry = Math.floor(Math.random() * (this.h - rh - 1)) + this.y + 1;
        this.room = { x: rx, y: ry, w: rw, h: rh };
        rooms.push(this.room);
        for (let r = ry; r < ry + rh; r++) {
          for (let c = rx; c < rx + rw; c++) {
            grid[r][c] = 0;
          }
        }
      }
    }

    getRoom() {
      if (this.room) return this.room;
      let lRoom = this.leftChild ? this.leftChild.getRoom() : null;
      let rRoom = this.rightChild ? this.rightChild.getRoom() : null;
      if (!lRoom) return rRoom;
      if (!rRoom) return lRoom;
      return Math.random() > 0.5 ? lRoom : rRoom;
    }
  }

  function createCorridor(r1, r2) {
    let p1 = { x: Math.floor(r1.x + r1.w / 2), y: Math.floor(r1.y + r1.h / 2) };
    let p2 = { x: Math.floor(r2.x + r2.w / 2), y: Math.floor(r2.y + r2.h / 2) };

    if (Math.random() > 0.5) {
      for (let x = Math.min(p1.x, p2.x); x <= Math.max(p1.x, p2.x); x++) grid[p1.y][x] = 0;
      for (let y = Math.min(p1.y, p2.y); y <= Math.max(p1.y, p2.y); y++) grid[y][p2.x] = 0;
    } else {
      for (let y = Math.min(p1.y, p2.y); y <= Math.max(p1.y, p2.y); y++) grid[y][p1.x] = 0;
      for (let x = Math.min(p1.x, p2.x); x <= Math.max(p1.x, p2.x); x++) grid[p2.y][x] = 0;
    }
  }

  let root = new Leaf(0, 0, cols, rows);
  let leaves = [root];
  let didSplit = true;

  while (didSplit) {
    didSplit = false;
    for (let i = 0; i < leaves.length; i++) {
      let l = leaves[i];
      if (!l.leftChild && !l.rightChild) {
        if (l.w > 10 || l.h > 10 || Math.random() > 0.25) {
          if (l.split()) {
            leaves.push(l.leftChild);
            leaves.push(l.rightChild);
            didSplit = true;
          }
        }
      }
    }
  }
  root.createRooms();

  // GERAR PORTAS NOS ACESSOS DE SALAS
  doors = [];
  rooms.forEach(r => {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (grid[r.y - 1][x] === 0 && grid[r.y][x] === 0) doors.push({ x: x * TILE_SIZE + 20, y: r.y * TILE_SIZE, angle: 0, open: false });
    }
  });

  return { grid, rooms };
}

// ==========================================
// CLASSES DO JOGO
// ==========================================
class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.baseSpeed = 3.8;
    this.angle = 0;
    this.weapon = WEAPONS.FISTS;
    this.ammo = Infinity;
    this.lastShot = 0;
    this.alive = true;
  }

  update() {
    if (!this.alive) return;

    let dx = 0, dy = 0;
    if (keys['w'] || keys['W'] || keys['ArrowUp']) dy -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) dy += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    const speed = this.baseSpeed * SKINS[selectedSkin].speedMult;
    this.moveWithCollision(dx * speed, dy * speed);

    this.angle = Math.atan2(mouse.worldY - this.y, mouse.worldX - this.x);

    if (mouse.down) this.shoot();
  }

  moveWithCollision(vx, vy) {
    let nextX = this.x + vx;
    if (!checkWallCollision(nextX, this.y, this.radius)) this.x = nextX;
    let nextY = this.y + vy;
    if (!checkWallCollision(this.x, nextY, this.radius)) this.y = nextY;
  }

  shoot() {
    const now = performance.now();
    if (now - this.lastShot < this.weapon.rate) return;
    
    if (this.weapon.type === 'GUN' && this.ammo <= 0) {
      playSound(120, 0.05, 'sawtooth');
      return;
    }

    this.lastShot = now;

    if (this.weapon.type === 'MELEE') {
      triggerScreenShake(3);
      playSound(220, 0.08, 'sawtooth', 80);
      enemies.forEach(e => {
        const dist = Math.hypot(e.x - this.x, e.y - this.y);
        if (dist < 48) e.kill(this.angle);
      });
    } else {
      triggerScreenShake(6);
      playSound(150, 0.12, 'square', 40);
      this.ammo--;
      updateHUD();

      // Alerta sonoro para inimigos
      enemies.forEach(e => {
        if (Math.hypot(e.x - this.x, e.y - this.y) < 400) e.state = 'CHASE';
      });

      const count = this.weapon.pellets || 1;
      for (let i = 0; i < count; i++) {
        const spreadAngle = this.angle + (Math.random() - 0.5) * this.weapon.spread;
        bullets.push(new Bullet(this.x, this.y, spreadAngle, this.weapon.speed, true));
      }
    }
  }

  pickupWeapon() {
    for (let i = droppedWeapons.length - 1; i >= 0; i--) {
      const w = droppedWeapons[i];
      if (Math.hypot(w.x - this.x, w.y - this.y) < 35) {
        if (this.weapon.type !== 'MELEE') this.throwWeapon();
        this.weapon = WEAPONS[w.type];
        this.ammo = w.ammo;
        droppedWeapons.splice(i, 1);
        playSound(450, 0.08, 'triangle');
        updateHUD();
        break;
      }
    }
  }

  throwWeapon() {
    if (this.weapon.type === 'MELEE') return;
    droppedWeapons.push(new DroppedWeapon(this.x, this.y, this.weapon.name, this.ammo, this.angle, true));
    this.weapon = WEAPONS.FISTS;
    this.ammo = Infinity;
    playSound(300, 0.05, 'sine');
    updateHUD();
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Sombra do Jogador
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(3, 3, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Corpo
    ctx.fillStyle = SKINS[selectedSkin].color;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Arma/Braços
    ctx.fillStyle = '#111';
    ctx.fillRect(0, -3, 18, 6);
    ctx.restore();
  }
}

class Enemy {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.speed = difficulty === 'HARDCORE' ? 3.2 : 2.4;
    this.alive = true;
    this.angle = Math.random() * Math.PI * 2;
    this.state = 'PATROL';
    this.patrolTimer = Math.floor(Math.random() * 100);
    this.hasGun = Math.random() > 0.4;
    this.lastShot = 0;
  }

  update() {
    if (!this.alive || !player || !player.alive) return;

    const distToPlayer = Math.hypot(player.x - this.x, player.y - this.y);

    if (distToPlayer < 320 && hasLineOfSight(this.x, this.y, player.x, player.y)) {
      this.state = 'CHASE';
    }

    if (this.state === 'CHASE') {
      this.angle = Math.atan2(player.y - this.y, player.x - this.x);
      
      if (this.hasGun && distToPlayer < 220 && distToPlayer > 80) {
        // Dispara se tiver linha de visão clara
        const now = performance.now();
        if (now - this.lastShot > 800) {
          this.lastShot = now;
          playSound(100, 0.1, 'sawtooth');
          bullets.push(new Bullet(this.x, this.y, this.angle + (Math.random() - 0.5) * 0.1, 14, false));
        }
      } else {
        const vx = Math.cos(this.angle) * this.speed;
        const vy = Math.sin(this.angle) * this.speed;
        if (!checkWallCollision(this.x + vx, this.y, this.radius)) this.x += vx;
        if (!checkWallCollision(this.x, this.y + vy, this.radius)) this.y += vy;
      }

      if (distToPlayer < 18) killPlayer();
    } else {
      // Patrulha Aleatória
      this.patrolTimer--;
      if (this.patrolTimer <= 0) {
        this.angle = Math.random() * Math.PI * 2;
        this.patrolTimer = Math.floor(Math.random() * 120) + 60;
      }
      const vx = Math.cos(this.angle) * (this.speed * 0.4);
      const vy = Math.sin(this.angle) * (this.speed * 0.4);
      if (!checkWallCollision(this.x + vx, this.y + vy, this.radius)) {
        this.x += vx;
        this.y += vy;
      }
    }
  }

  kill(angle) {
    if (!this.alive) return;
    this.alive = false;
    playSound(70, 0.25, 'sawtooth', 30);
    addScore(100);

    // Sangramento Ultra-Violento
    for (let i = 0; i < 30; i++) {
      const spd = Math.random() * 8 + 2;
      const spreadAngle = angle + (Math.random() - 0.5) * 1.2;
      bloodDecals.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(spreadAngle) * spd,
        vy: Math.sin(spreadAngle) * spd,
        radius: Math.random() * 5 + 2,
        life: 1.0
      });
    }

    if (this.hasGun) {
      const types = ['PISTOL', 'SHOTGUN', 'RIFLE'];
      const chosen = types[Math.floor(Math.random() * types.length)];
      droppedWeapons.push(new DroppedWeapon(this.x, this.y, chosen, WEAPONS[chosen].ammo, Math.random() * Math.PI * 2));
    }

    checkLevelClear();
  }

  draw() {
    if (!this.alive) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.fillStyle = '#ff2a6d';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, -2, 14, 4);
    ctx.restore();
  }
}

class Bullet {
  constructor(x, y, angle, speed, isPlayer) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.alive = true;
    this.isPlayer = isPlayer;
    this.angle = angle;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;

    if (checkWallCollision(this.x, this.y, 2)) {
      this.alive = false;
      createSparks(this.x, this.y);
      return;
    }

    if (this.isPlayer) {
      enemies.forEach(e => {
        if (e.alive && Math.hypot(e.x - this.x, e.y - this.y) < e.radius) {
          e.kill(this.angle);
          this.alive = false;
        }
      });
    } else {
      if (player && player.alive && Math.hypot(player.x - this.x, player.y - this.y) < player.radius) {
        killPlayer();
        this.alive = false;
      }
    }
  }

  draw() {
    ctx.save();
    ctx.fillStyle = this.isPlayer ? '#00f0ff' : '#ff007f';
    ctx.shadowBlur = 8;
    ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class DroppedWeapon {
  constructor(x, y, type, ammo, angle = 0, isThrown = false) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.ammo = ammo;
    this.angle = angle;
    this.isThrown = isThrown;
    this.throwSpeed = isThrown ? 16 : 0;
  }

  update() {
    if (this.isThrown && this.throwSpeed > 0) {
      const vx = Math.cos(this.angle) * this.throwSpeed;
      const vy = Math.sin(this.angle) * this.throwSpeed;

      if (checkWallCollision(this.x + vx, this.y + vy, 8)) {
        this.throwSpeed = 0;
        this.isThrown = false;
      } else {
        this.x += vx;
        this.y += vy;
        this.throwSpeed *= 0.88;

        enemies.forEach(e => {
          if (e.alive && Math.hypot(e.x - this.x, e.y - this.y) < e.radius + 8) {
            e.kill(this.angle);
            this.throwSpeed = 0;
            this.isThrown = false;
          }
        });

        if (this.throwSpeed < 1) this.isThrown = false;
      }
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ff007f';
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#ff007f';
    ctx.fillRect(-10, -3, 20, 6);
    ctx.restore();
  }
}

// ==========================================
// FUNÇÕES AUXILIARES E LÓGICA DO JOGO
// ==========================================
function checkWallCollision(x, y, radius) {
  const minCol = Math.floor((x - radius) / TILE_SIZE);
  const maxCol = Math.floor((x + radius) / TILE_SIZE);
  const minRow = Math.floor((y - radius) / TILE_SIZE);
  const maxRow = Math.floor((y + radius) / TILE_SIZE);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (r >= 0 && r < mapHeight && c >= 0 && c < mapWidth) {
        if (currentMap[r][c] === 1) return true;
      }
    }
  }
  return false;
}

function hasLineOfSight(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 12);
  for (let i = 0; i <= steps; i++) {
    const px = x1 + (x2 - x1) * (i / steps);
    const py = y1 + (y2 - y1) * (i / steps);
    if (checkWallCollision(px, py, 2)) return false;
  }
  return true;
}

function createSparks(x, y) {
  for (let i = 0; i < 6; i++) {
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      life: 1.0,
      color: '#00f0ff'
    });
  }
}

function triggerScreenShake(amount) {
  if (enableShake) screenShake = amount;
}

function addScore(pts) {
  combo++;
  comboTimer = 180;
  score += pts * combo;

  const comboEl = document.getElementById('combo-display');
  document.getElementById('combo-count').innerText = `${combo}x`;
  comboEl.classList.remove('scale-0');
  comboEl.classList.add('scale-100');
  updateHUD();
}

function killPlayer() {
  if (!player || !player.alive) return;
  player.alive = false;
  gameState = 'GAMEOVER';
  playSound(40, 0.5, 'sawtooth', 10);

  const overlay = document.getElementById('overlay-msg');
  document.getElementById('overlay-title').innerText = 'VOCÊ MORREU';
  document.getElementById('overlay-sub').innerText = "PRESSIONE 'R' PARA REINICIAR O RUN";
  document.getElementById('overlay-detail').classList.add('hidden');
  overlay.classList.remove('opacity-0', 'pointer-events-none');
}

function checkLevelClear() {
  const aliveEnemies = enemies.filter(e => e.alive);
  if (aliveEnemies.length === 0) {
    gameState = 'CLEAR';
    playSound(600, 0.3, 'sine', 900);
    const overlay = document.getElementById('overlay-msg');
    document.getElementById('overlay-title').innerText = 'FASE LIMPA!';
    document.getElementById('overlay-sub').innerText = "PRESSIONE 'R' PARA AVANÇAR O ANDAR";
    document.getElementById('overlay-detail').classList.remove('hidden');
    overlay.classList.remove('opacity-0', 'pointer-events-none');
  }
}

function loadLevel(floorIndex) {
  currentFloor = floorIndex;
  const mapData = generateProceduralMap(mapWidth, mapHeight);
  currentMap = mapData.grid;
  
  enemies = [];
  bullets = [];
  particles = [];
  bloodDecals = [];
  droppedWeapons = [];

  const startRoom = mapData.rooms[0];
  player = new Player((startRoom.x + startRoom.w / 2) * TILE_SIZE, (startRoom.y + startRoom.h / 2) * TILE_SIZE);

  // Spawna Inimigos nas Salas Restantes
  for (let i = 1; i < mapData.rooms.length; i++) {
    const rm = mapData.rooms[i];
    const enemyCount = Math.floor(Math.random() * 2) + 1 + Math.floor(currentFloor / 2);
    for (let e = 0; e < enemyCount; e++) {
      const ex = (rm.x + 1 + Math.random() * (rm.w - 2)) * TILE_SIZE;
      const ey = (rm.y + 1 + Math.random() * (rm.h - 2)) * TILE_SIZE;
      enemies.push(new Enemy(ex, ey));
    }
  }

  updateHUD();
}

function updateHUD() {
  document.getElementById('stage-val').innerText = currentFloor;
  document.getElementById('score-val').innerText = score;
  if (player) {
    document.getElementById('weapon-display').innerText = player.weapon.name;
    document.getElementById('ammo-display').innerText = player.weapon.type === 'GUN' ? `AMMO: ${player.ammo}` : 'AMMO: INF';
  }
}

// ==========================================
// LOOP PRINCIPAL DO JOGO
// ==========================================
function gameLoop(now) {
  const dt = now - lastTime;
  lastTime = now;

  frameCount++;
  if (now - fpsTimer >= 1000) {
    document.getElementById('fps-val').innerText = `${frameCount} FPS`;
    frameCount = 0;
    fpsTimer = now;
  }

  if (gameState === 'PLAYING') {
    if (comboTimer > 0) {
      comboTimer--;
      if (comboTimer <= 0) {
        combo = 0;
        document.getElementById('combo-display').classList.remove('scale-100');
        document.getElementById('combo-display').classList.add('scale-0');
      }
    }

    if (player) player.update();

    if (player) {
      camera.targetX = player.x - CANVAS_WIDTH / 2;
      camera.targetY = player.y - CANVAS_HEIGHT / 2;
      camera.x += (camera.targetX - camera.x) * 0.1;
      camera.y += (camera.targetY - camera.y) * 0.1;
    }

    enemies.forEach(e => e.update());
    bullets.forEach(b => b.update());
    bullets = bullets.filter(b => b.alive);

    droppedWeapons.forEach(w => w.update());

    // Atualiza projeção do sangue no chão
    bloodDecals.forEach(b => {
      if (b.vx) {
        b.x += b.vx;
        b.y += b.vy;
        b.vx *= 0.82;
        b.vy *= 0.82;
      }
    });

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;
    });
    particles = particles.filter(p => p.life > 0);

    if (screenShake > 0) screenShake *= 0.85;
  }

  // Renderização
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.save();

  if (screenShake > 0.5) {
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
  }

  ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));

  // Renderiza Mapa Neon
  for (let r = 0; r < mapHeight; r++) {
    for (let c = 0; c < mapWidth; c++) {
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;
      if (currentMap[r][c] === 1) {
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = '#05050d';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Renderiza Sangue Persistente
  bloodDecals.forEach(b => {
    ctx.fillStyle = '#88002d';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  // Renderiza Entidades
  droppedWeapons.forEach(w => w.draw());
  enemies.forEach(e => e.draw());
  if (player) player.draw();
  bullets.forEach(b => b.draw());

  // Renderiza Partículas
  particles.forEach(p => {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    ctx.globalAlpha = 1.0;
  });

  ctx.restore();
  requestAnimationFrame(gameLoop);
}

// ==========================================
// CONTROLES E MENUS
// ==========================================
function startGame() {
  initAudio();
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('ui-layer').classList.remove('hidden');
  gameState = 'PLAYING';
  score = 0;
  loadLevel(1);
}

function resumeGame() {
  document.getElementById('pause-menu').classList.add('hidden');
  gameState = 'PLAYING';
}

function restartCurrentLevel() {
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('overlay-msg').classList.add('opacity-0', 'pointer-events-none');
  gameState = 'PLAYING';
  if (player && !player.alive) score = 0;
  loadLevel(gameState === 'GAMEOVER' ? 1 : currentFloor);
}

function quitToMainMenu() {
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('ui-layer').classList.add('hidden');
  document.getElementById('overlay-msg').classList.add('opacity-0', 'pointer-events-none');
  document.getElementById('main-menu').classList.remove('hidden');
  gameState = 'MENU';
}

function openOptionsMenu(fromState) {
  optionsReturnState = fromState;
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('options-menu').classList.remove('hidden');
}

function closeOptionsMenu() {
  document.getElementById('options-menu').classList.add('hidden');
  if (optionsReturnState === 'pause') {
    document.getElementById('pause-menu').classList.remove('hidden');
  } else {
    document.getElementById('main-menu').classList.remove('hidden');
  }
}

function openSelectSkin() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('skin-menu').classList.remove('hidden');
}

function setSkin(skinKey) {
  selectedSkin = skinKey;
  backToMainMenu();
}

function backToMainMenu() {
  document.getElementById('skin-menu').classList.add('hidden');
  document.getElementById('main-menu').classList.remove('hidden');
}

function changeDifficulty(val) { difficulty = val; }
function toggleCRT(checked) { document.getElementById('crt-layer').style.display = checked ? 'block' : 'none'; }
function toggleShake(checked) { enableShake = checked; }

// EVENT LISTENERS
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === 'e' || e.key === 'E') {
      if (player && gameState === 'PLAYING') player.pickupWeapon();
    }
    if (e.key === 'r' || e.key === 'R') {
      if (gameState === 'GAMEOVER') restartCurrentLevel();
      else if (gameState === 'CLEAR') {
        document.getElementById('overlay-msg').classList.add('opacity-0', 'pointer-events-none');
        gameState = 'PLAYING';
        loadLevel(currentFloor + 1);
      }
    }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (gameState === 'PLAYING') {
        gameState = 'PAUSED';
        document.getElementById('pause-menu').classList.remove('hidden');
      } else if (gameState === 'PAUSED') {
        resumeGame();
      }
    }
  });

  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.worldX = mouse.x + camera.x;
    mouse.worldY = mouse.y + camera.y;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) {
      mouse.rightDown = true;
      if (player && gameState === 'PLAYING') player.throwWeapon();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rightDown = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  requestAnimationFrame(gameLoop);
});