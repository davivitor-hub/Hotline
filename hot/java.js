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
let currentFloor = 0;
let screenShake = 0;
let enableShake = true;
let difficulty = 'NORMAL';

let keys = {};
let mouse = { x: 0, y: 0, worldX: 0, worldY: 0, down: false, rightDown: false };

let frameCount = 0;
let fpsTimer = performance.now();
let lastTime = performance.now();

// AUDIO SYNTHESIZER (Web Audio API)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSound(freq, duration, type = 'square') {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

// CONFIGURAÇÃO DE ARMAS
const WEAPONS = {
  FISTS: { name: 'FISTS', ammo: Infinity, rate: 250, speed: 0, damage: 1, type: 'MELEE' },
  PISTOL: { name: 'PISTOL', ammo: 12, rate: 220, speed: 18, damage: 1, type: 'GUN', spread: 0.04 },
  SHOTGUN: { name: 'SHOTGUN', ammo: 6, rate: 650, speed: 15, damage: 1, type: 'GUN', spread: 0.22, pellets: 6 },
  RIFLE: { name: 'RIFLE', ammo: 24, rate: 90, speed: 20, damage: 1, type: 'GUN', spread: 0.08 }
};

// CONFIGURAÇÃO DE SKINS
const SKINS = {
  ROOSTER: { name: 'RICHARD', color: '#e74c3c', speedMult: 1.0 },
  TIGER: { name: 'TONY', color: '#e67e22', speedMult: 1.15 },
  BEAR: { name: 'MARK', color: '#3498db', speedMult: 0.95 },
  MONKEY: { name: 'RAMI', color: '#9b59b6', speedMult: 1.25 }
};
let selectedSkin = 'ROOSTER';

// MAPAS DE FASE (1 = Parede, 0 = Chão)
const MAP_LEVELS = [
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
    [1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1,1,1,0,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ],
  [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
    [1,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
    [1,1,0,1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ]
];

// ENTIDADES E OBJETOS DO JOGO
let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
let player = null;
let enemies = [];
let bullets = [];
let particles = [];
let bloodDecals = [];
let droppedWeapons = [];

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

    let dx = 0;
    let dy = 0;
    if (keys['w'] || keys['W'] || keys['ArrowUp']) dy -= 1;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) dy += 1;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= 1;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    const currentSpeed = this.baseSpeed * SKINS[selectedSkin].speedMult;
    this.moveWithCollision(dx * currentSpeed, dy * currentSpeed);

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
      playSound(150, 0.05, 'sawtooth');
      return;
    }

    this.lastShot = now;

    if (this.weapon.type === 'MELEE') {
      triggerScreenShake(3);
      playSound(200, 0.08, 'sine');
      enemies.forEach(e => {
        const dist = Math.hypot(e.x - this.x, e.y - this.y);
        if (dist < 45) e.kill(this.angle);
      });
    } else {
      triggerScreenShake(6);
      playSound(100, 0.15, 'sawtooth');
      this.ammo--;
      updateHUD();

      // Alerta inimigos próximos com o som do tiro
      enemies.forEach(e => {
        if (Math.hypot(e.x - this.x, e.y - this.y) < 350) {
          e.state = 'CHASE';
        }
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
        playSound(400, 0.08, 'triangle');
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

    ctx.fillStyle = SKINS[selectedSkin].color;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, -2, 16, 4);
    ctx.restore();
  }
}

class Enemy {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.speed = difficulty === 'HARDCORE' ? 3.0 : 2.2;
    this.alive = true;
    this.angle = Math.random() * Math.PI * 2;
    this.state = 'PATROL';
    this.lastShot = 0;
  }

  update() {
    if (!this.alive || !player || !player.alive) return;

    const distToPlayer = Math.hypot(player.x - this.x, player.y - this.y);

    if (distToPlayer < 280 && hasLineOfSight(this.x, this.y, player.x, player.y)) {
      this.state = 'CHASE';
    }

    if (this.state === 'CHASE') {
      this.angle = Math.atan2(player.y - this.y, player.x - this.x);
      const vx = Math.cos(this.angle) * this.speed;
      const vy = Math.sin(this.angle) * this.speed;

      if (!checkWallCollision(this.x + vx, this.y, this.radius)) this.x += vx;
      if (!checkWallCollision(this.x, this.y + vy, this.radius)) this.y += vy;

      if (distToPlayer < 20) killPlayer();
    }
  }

  kill(angle) {
    if (!this.alive) return;
    this.alive = false;
    playSound(80, 0.2, 'sawtooth');
    addScore(100);

    for (let i = 0; i < 20; i++) {
      bloodDecals.push({
        x: this.x + (Math.random() - 0.5) * 30,
        y: this.y + (Math.random() - 0.5) * 30,
        radius: Math.random() * 6 + 2
      });
    }

    if (Math.random() > 0.4) {
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

    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

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
    }
  }

  draw() {
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fill();
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
    this.throwSpeed = isThrown ? 12 : 0;
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
        this.throwSpeed *= 0.9;

        enemies.forEach(e => {
          if (e.alive && Math.hypot(e.x - this.x, e.y - this.y) < e.radius + 8) {
            e.kill(this.angle);
            this.throwSpeed = 0;
            this.isThrown = false;
          }
        });

        if (this.throwSpeed < 1) {
          this.throwSpeed = 0;
          this.isThrown = false;
        }
      }
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#00f0ff';
    ctx.fillRect(-10, -3, 20, 6);
    ctx.restore();
  }
}

// ==========================================
// FUNÇÕES AUXILIARES E LÓGICA DO JOGO
// ==========================================
function checkWallCollision(x, y, radius) {
  const map = MAP_LEVELS[currentFloor];
  if (!map) return false;

  const minCol = Math.floor((x - radius) / TILE_SIZE);
  const maxCol = Math.floor((x + radius) / TILE_SIZE);
  const minRow = Math.floor((y - radius) / TILE_SIZE);
  const maxRow = Math.floor((y + radius) / TILE_SIZE);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (r >= 0 && r < map.length && c >= 0 && c < map[r].length) {
        if (map[r][c] === 1) return true;
      }
    }
  }
  return false;
}

function hasLineOfSight(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / 10);
  for (let i = 0; i <= steps; i++) {
    const px = x1 + (x2 - x1) * (i / steps);
    const py = y1 + (y2 - y1) * (i / steps);
    if (checkWallCollision(px, py, 2)) return false;
  }
  return true;
}

function createSparks(x, y) {
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: 1.0,
      color: '#ffaa00'
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
  playSound(50, 0.4, 'sawtooth');

  const overlay = document.getElementById('overlay-msg');
  document.getElementById('overlay-title').innerText = 'VOCÊ MORREU';
  document.getElementById('overlay-sub').innerText = "PRESSIONE 'R' PARA TENTAR NOVAMENTE";
  document.getElementById('overlay-detail').classList.add('hidden');
  overlay.classList.remove('opacity-0', 'pointer-events-none');
}

function checkLevelClear() {
  const aliveEnemies = enemies.filter(e => e.alive);
  if (aliveEnemies.length === 0) {
    gameState = 'CLEAR';
    playSound(600, 0.3, 'sine');
    const overlay = document.getElementById('overlay-msg');
    document.getElementById('overlay-title').innerText = 'FASE LIMPA!';
    document.getElementById('overlay-sub').innerText = "PRESSIONE 'R' PARA A PRÓXIMA FASE";
    document.getElementById('overlay-detail').classList.remove('hidden');
    overlay.classList.remove('opacity-0', 'pointer-events-none');
  }
}

function loadLevel(floorIndex) {
  currentFloor = floorIndex % MAP_LEVELS.length;
  enemies = [];
  bullets = [];
  particles = [];
  bloodDecals = [];
  droppedWeapons = [];

  player = new Player(100, 100);

  if (currentFloor === 0) {
    enemies.push(new Enemy(300, 120));
    enemies.push(new Enemy(500, 250));
    enemies.push(new Enemy(700, 150));
  } else {
    enemies.push(new Enemy(200, 200));
    enemies.push(new Enemy(400, 100));
    enemies.push(new Enemy(600, 250));
    enemies.push(new Enemy(800, 200));
  }

  updateHUD();
}

function updateHUD() {
  document.getElementById('stage-val').innerText = currentFloor + 1;
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

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.05;
    });
    particles = particles.filter(p => p.life > 0);

    if (screenShake > 0) screenShake *= 0.85;
  }

  // Renderização do Canvas
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.save();

  if (screenShake > 0.5) {
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
  }

  ctx.translate(-Math.floor(camera.x), -Math.floor(camera.y));

  // Renderiza Mapa
  const map = MAP_LEVELS[currentFloor];
  if (map) {
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;
        if (map[r][c] === 1) {
          ctx.fillStyle = '#222';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#444';
          ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = '#111';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  // Renderiza Sangue e Decalques
  bloodDecals.forEach(b => {
    ctx.fillStyle = '#880000';
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
// AÇÕES DOS MENUS E EVENTOS
// ==========================================
function startGame() {
  initAudio();
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('ui-layer').classList.remove('hidden');
  gameState = 'PLAYING';
  score = 0;
  loadLevel(0);
}

function resumeGame() {
  document.getElementById('pause-menu').classList.add('hidden');
  gameState = 'PLAYING';
}

function restartCurrentLevel() {
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('overlay-msg').classList.add('opacity-0', 'pointer-events-none');
  gameState = 'PLAYING';
  loadLevel(currentFloor);
}

function quitToMainMenu() {
  document.getElementById('pause-menu').classList.add('hidden');
  document.getElementById('ui-layer').classList.add('hidden');
  document.getElementById('overlay-msg').classList.add('opacity-0', 'pointer-events-none');
  document.getElementById('main-menu').classList.remove('hidden');
  gameState = 'MENU';
}

function openSelectLevel() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('level-menu').classList.remove('hidden');
}

function selectLevelAndStart(level) {
  initAudio();
  document.getElementById('level-menu').classList.add('hidden');
  document.getElementById('ui-layer').classList.remove('hidden');
  gameState = 'PLAYING';
  score = 0;
  loadLevel(level);
}

function openSelectSkin() {
  document.getElementById('main-menu').classList.add('hidden');
  document.getElementById('skin-menu').classList.remove('hidden');
}

function setSkin(skinKey) {
  selectedSkin = skinKey;
  backToMainMenu();
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

function backToMainMenu() {
  document.getElementById('level-menu').classList.add('hidden');
  document.getElementById('skin-menu').classList.add('hidden');
  document.getElementById('main-menu').classList.remove('hidden');
}

function changeDifficulty(val) { difficulty = val; }
function toggleCRT(checked) { document.getElementById('crt-layer').style.display = checked ? 'block' : 'none'; }
function toggleShake(checked) { enableShake = checked; }

// ==========================================
// INICIALIZAÇÃO DE EVENTOS
// ==========================================
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