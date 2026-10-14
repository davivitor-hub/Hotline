/* ==========================================================================
   NEON DUEL — simulação compartilhada
   Roda no servidor (Node) E no navegador (modo treino vs bot + predição).
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 50, PR = 14, SPEED = 235, WIN_SCORE = 5, DOWN_TIME = 1.7;

  /* ---------------------------------------------------------------- ARMAS */
  const WEAPONS = {
    FISTS:   { name: 'MÃOS',    melee: true, range: 34, arc: 1.8, cd: 0.40, kill: false, col: '#ffd7b0' },
    KNIFE:   { name: 'FACA',    melee: true, range: 42, arc: 1.5, cd: 0.26, kill: true,  col: '#e6f1ff' },
    BAT:     { name: 'TACO',    melee: true, range: 60, arc: 2.1, cd: 0.50, kill: true,  col: '#ffb35c' },
    KATANA:  { name: 'KATANA',  melee: true, range: 70, arc: 2.3, cd: 0.40, kill: true,  col: '#9ff7ff' },
    PISTOL:  { name: 'PISTOLA', ammo: 9,  cd: 0.27,  spread: 0.03, speed: 1150, pellets: 1, range: 1100, auto: false, col: '#6bf4ff' },
    SMG:     { name: 'SMG',     ammo: 30, cd: 0.085, spread: 0.11, speed: 1100, pellets: 1, range: 900,  auto: true,  col: '#ff8ad8' },
    RIFLE:   { name: 'FUZIL',   ammo: 24, cd: 0.15,  spread: 0.04, speed: 1400, pellets: 1, range: 1600, auto: true,  col: '#b9ff79' },
    SHOTGUN: { name: 'SHOTGUN', ammo: 6,  cd: 0.80,  spread: 0.30, speed: 980,  pellets: 7, range: 440,  auto: false, col: '#ffc96b' }
  };
  const POOLS = {
    M: ['KNIFE', 'BAT', 'KATANA'],
    G: ['PISTOL', 'SMG', 'SHOTGUN'],
    R: ['KNIFE', 'BAT', 'KATANA', 'PISTOL', 'SMG', 'SHOTGUN', 'RIFLE']
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

  /* ----------------------------------------------------------------- MAPAS
     Todos os mapas são simétricos (rotação de 180°) => 1v1 justo.
     Tudo que se define é espelhado automaticamente. 1 = parede, 2 = porta.   */
  const MAPS = {}, MAP_IDS = [];
  function buildMap(id, name, theme, def) {
    const W = 32, H = 20, g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill(0));
    const set = (x, y, v) => { g[y][x] = v; g[H - 1 - y][W - 1 - x] = v; };
    const rect = (x1, y1, x2, y2, v = 1) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, v); };
    const spawn = [], wp = []; let pair = 0;
    def({
      rect,
      spawn: (x, y) => { spawn[0] = [x, y]; spawn[1] = [W - 1 - x, H - 1 - y]; },
      weapon: (x, y, k) => { wp.push({ x, y, k, pair }); wp.push({ x: W - 1 - x, y: H - 1 - y, k, pair }); pair++; }
    });
    MAPS[id] = { id, name, theme, W, H, g, spawn, wp };
    MAP_IDS.push(id);
  }

  buildMap('OFFICE', 'ESCRITÓRIO', { a: '#00e5ff', b: '#ff2e97', f1: '#1a1530', f2: '#1f1938' }, m => {
    m.rect(0, 0, 31, 0); m.rect(0, 0, 0, 19);
    m.rect(10, 0, 10, 19);                   // parede esquerda do corredor
    m.rect(10, 4, 10, 4, 2); m.rect(10, 14, 10, 14, 2);
    m.rect(10, 9, 10, 10, 0);                // abertura
    m.rect(1, 9, 9, 9); m.rect(5, 9, 5, 9, 2);
    m.rect(14, 4, 15, 5);                    // coberturas no corredor
    m.rect(13, 9, 14, 9);
    m.spawn(4, 4);
    m.weapon(2, 6, 'M'); m.weapon(8, 2, 'G'); m.weapon(8, 15, 'R');
    m.weapon(2, 17, 'M'); m.weapon(14, 1, 'G'); m.weapon(12, 10, 'R');
  });

  buildMap('CLUB', 'CASA NOTURNA', { a: '#ff2e97', b: '#ffe600', f1: '#241030', f2: '#2c1438' }, m => {
    m.rect(0, 0, 31, 0); m.rect(0, 0, 0, 19);
    m.rect(8, 6, 23, 6); m.rect(8, 6, 8, 13);   // prédio central
    m.rect(15, 6, 15, 6, 2); m.rect(8, 9, 8, 9, 2);
    m.rect(8, 11, 8, 11, 0);
    m.rect(13, 9, 14, 9);                       // cobertura interna
    m.rect(3, 3, 4, 4); m.rect(12, 2, 13, 3); m.rect(3, 14, 3, 16);
    m.spawn(2, 9);
    m.weapon(2, 5, 'M'); m.weapon(5, 10, 'G'); m.weapon(10, 8, 'R');
    m.weapon(13, 4, 'R'); m.weapon(6, 17, 'M'); m.weapon(11, 16, 'G');
  });

  /* ---------------------------------------------------------------- NÍVEL */
  class Level {
    constructor(id) {
      const m = MAPS[id];
      this.id = id; this.m = m; this.W = m.W; this.H = m.H;
      this.g = m.g.map(r => r.slice());
      this.doors = [];
      for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.g[y][x] === 2) {
        const h = m.g[y][x - 1] === 1 && m.g[y][x + 1] === 1;
        this.doors.push({ i: this.doors.length, x, y, o: h ? 'h' : 'v', open: false, dir: 1, openAt: 0 });
      }
    }
    solid(tx, ty) { return tx < 0 || ty < 0 || tx >= this.W || ty >= this.H || this.g[ty][tx] !== 0; }
    solidAt(px, py) { return this.solid(Math.floor(px / TILE), Math.floor(py / TILE)); }
    openDoor(d, dir) { d.open = true; d.dir = dir; this.g[d.y][d.x] = 0; }
    push(p, r) {
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      for (let j = ty - 1; j <= ty + 1; j++) for (let i = tx - 1; i <= tx + 1; i++) {
        if (!this.solid(i, j)) continue;
        const rx = i * TILE, ry = j * TILE;
        const cx = Math.max(rx, Math.min(p.x, rx + TILE)), cy = Math.max(ry, Math.min(p.y, ry + TILE));
        const ddx = p.x - cx, ddy = p.y - cy, d2 = ddx * ddx + ddy * ddy;
        if (d2 < r * r) {
          if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += ddx * k; p.y += ddy * k; }
          else {
            const l = p.x - rx, rr = rx + TILE - p.x, t = p.y - ry, b = ry + TILE - p.y, mn = Math.min(l, rr, t, b);
            if (mn === l) p.x = rx - r; else if (mn === rr) p.x = rx + TILE + r; else if (mn === t) p.y = ry - r; else p.y = ry + TILE + r;
          }
        }
      }
    }
    los(x1, y1, x2, y2) {
      const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 8);
      for (let i = 1; i < n; i++) { const t = i / n; if (this.solidAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false; }
      return true;
    }
    ray(x, y, a, max) {
      const cx = Math.cos(a), cy = Math.sin(a);
      for (let d = 0; d < max; d += 5) {
        if (this.solidAt(x + cx * d, y + cy * d)) {
          let lo = Math.max(0, d - 5), hi = d;
          for (let i = 0; i < 3; i++) { const m = (lo + hi) / 2; if (this.solidAt(x + cx * m, y + cy * m)) hi = m; else lo = m; }
          return hi;
        }
      }
      return max;
    }
  }

  function canMove(phase, alive, down) { return !!alive && !down && (phase === 'live' || phase === 'over' || phase === 'matchover'); }

  // k = bitmask: W=1 A=2 S=4 D=8
  function stepMove(level, p, k, dt) {
    let dx = ((k & 8) ? 1 : 0) - ((k & 2) ? 1 : 0), dy = ((k & 4) ? 1 : 0) - ((k & 1) ? 1 : 0);
    if (!dx && !dy) return null;
    const l = Math.hypot(dx, dy); dx /= l; dy /= l;
    const mx = dx * SPEED * dt, my = dy * SPEED * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 6));
    for (let i = 0; i < n; i++) { p.x += mx / n; p.y += my / n; level.push(p, PR); }
    return { dx, dy };
  }

  /* ----------------------------------------------------------------- JOGO */
  class Game {
    constructor() {
      this.players = [null, null]; this.phase = 'waiting'; this.timer = 0; this.round = 0;
      this.mapIdx = -1; this.level = null; this.bullets = []; this.items = []; this.events = []; this.nid = 1; this.winner = -1;
    }
    get count() { return this.players.filter(Boolean).length; }
    byId(id) { return this.players.find(p => p && p.id === id) || null; }

    addPlayer(id, name, skin) {
      const slot = !this.players[0] ? 0 : (!this.players[1] ? 1 : -1);
      if (slot < 0) return null;
      const p = { id, slot, name: String(name || 'JOGADOR').slice(0, 14), skin: skin || 'ROOSTER', x: 0, y: 0, angle: 0, alive: true, down: false, downT: 0,
        weapon: null, cd: 0, swing: 0, buf: 0, fire: false, budget: 0.3, ack: 0, score: 0, bot: false };
      this.players[slot] = p;
      if (this.count === 2) this.startMatch(); else this.phase = 'waiting';
      return p;
    }
    removePlayer(id) {
      const p = this.byId(id); if (!p) return;
      this.players[p.slot] = null;
      for (const q of this.players) if (q) q.score = 0;
      this.phase = 'waiting'; this.level = null; this.bullets = []; this.items = []; this.round = 0; this.mapIdx = -1;
    }
    startMatch() { for (const p of this.players) if (p) p.score = 0; this.round = 0; this.startRound(); }
    startRound() {
      this.round++;
      this.mapIdx = this.mapIdx < 0 ? Math.floor(Math.random() * MAP_IDS.length) : (this.mapIdx + 1) % MAP_IDS.length;
      this.level = new Level(MAP_IDS[this.mapIdx]);
      this.bullets = []; this.items = []; this.winner = -1;
      this.players.forEach((p, i) => {
        if (!p) return;
        const s = this.level.m.spawn[i];
        p.x = (s[0] + 0.5) * TILE; p.y = (s[1] + 0.5) * TILE; p.angle = i ? Math.PI : 0;
        p.alive = true; p.down = false; p.downT = 0; p.weapon = null; p.cd = 0; p.swing = 0; p.buf = 0; p.fire = false;
      });
      const types = {};
      for (const w of this.level.m.wp) {
        if (!types[w.pair]) types[w.pair] = pick(POOLS[w.k]);
        this.addItem(types[w.pair], (w.x + 0.5) * TILE, (w.y + 0.5) * TILE);
      }
      this.phase = 'countdown'; this.timer = 2.8;
      this.events.push({ t: 'round' });
    }
    addItem(type, x, y, vx = 0, vy = 0, ammo) {
      const it = { id: this.nid++, x, y, type, ammo: ammo === undefined ? (WEAPONS[type].ammo || 0) : ammo, rot: Math.random() * 6.28, vx, vy, thrown: false, owner: null, t: 0, spin: 0 };
      this.items.push(it); return it;
    }

    /* entrada de um jogador (cliente ou bot) */
    applyInput(p, inp, dt) {
      if (!p || !inp || !this.level) return;
      if (Number.isFinite(inp.a)) p.angle = inp.a;
      p.fire = !!inp.f;
      if (inp.fp) p.buf = 0.16;
      if (this.phase === 'live' && p.alive && !p.down) {
        if (inp.pk) this.pickup(p);
        if (inp.th) this.throwWeapon(p);
      }
      if (canMove(this.phase, p.alive, p.down)) {
        const dd = Math.min(dt, 0.05, p.budget);
        if (dd > 0) {
          p.budget -= dd;
          const r = stepMove(this.level, p, inp.k | 0, dd);
          if (r) this.tryDoors(p, r.dx, r.dy);
        }
      }
    }

    tick(dt) {
      for (const p of this.players) {
        if (!p) continue;
        p.cd -= dt; p.swing -= dt; p.buf -= dt; p.budget = Math.min(0.3, p.budget + dt);
        if (p.down) { p.downT -= dt; if (p.downT <= 0) p.down = false; }
      }
      if (this.phase === 'waiting' || !this.level) return;
      if (this.phase === 'countdown') {
        this.timer -= dt;
        if (this.timer <= 0) { this.phase = 'live'; this.events.push({ t: 'go' }); }
      } else if (this.phase === 'live') {
        for (const p of this.players) {
          if (!p || !p.alive || p.down) continue;
          const w = p.weapon ? WEAPONS[p.weapon.type] : WEAPONS.FISTS;
          if (p.cd <= 0 && (p.buf > 0 || (p.fire && w.auto))) { p.buf = 0; this.attack(p); }
        }
      }
      this.updateBullets(dt); this.updateItems(dt);
      if (this.phase === 'live') this.evalRound();
      else if (this.phase === 'over' || this.phase === 'matchover') {
        this.timer -= dt;
        if (this.timer <= 0) { if (this.phase === 'matchover') this.startMatch(); else this.startRound(); }
      }
    }

    evalRound() {
      const a = this.players.filter(p => p && p.alive);
      if (a.length === 2) return;
      if (a.length === 0) { this.winner = -1; this.phase = 'over'; this.timer = 2.4; this.events.push({ t: 'end', w: -1 }); return; }
      const w = a[0]; w.score++; this.winner = w.slot;
      if (w.score >= WIN_SCORE) { this.phase = 'matchover'; this.timer = 5; } else { this.phase = 'over'; this.timer = 2.6; }
      this.events.push({ t: 'end', w: w.slot });
    }

    attack(p) {
      const wd = p.weapon ? WEAPONS[p.weapon.type] : WEAPONS.FISTS;
      const o = this.players[1 - p.slot];
      if (wd.melee) {
        p.cd = wd.cd; p.swing = 0.2;
        this.events.push({ t: 'swing', by: p.id, w: p.weapon ? p.weapon.type : 'FISTS', x: p.x, y: p.y, a: p.angle });
        if (o && o.alive) {
          const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
          if (d <= wd.range + PR) {
            const aa = Math.atan2(dy, dx);
            if ((Math.abs(angDiff(aa, p.angle)) <= wd.arc / 2 || d < PR * 1.6) && this.level.los(p.x, p.y, o.x, o.y)) {
              if (o.down || wd.kill) this.kill(o, p, o.down ? 'exec' : 'melee', aa);
              else this.knockdown(o, DOWN_TIME, aa);
            }
          }
        }
        return;
      }
      if (p.weapon.ammo <= 0) { p.cd = 0.3; this.events.push({ t: 'click', by: p.id, x: p.x, y: p.y }); return; }
      p.weapon.ammo--; p.cd = wd.cd;
      const sx = p.x + Math.cos(p.angle) * 8, sy = p.y + Math.sin(p.angle) * 8;
      for (let i = 0; i < wd.pellets; i++) {
        const a = p.angle + (Math.random() - 0.5) * 2 * wd.spread;
        const sp = wd.speed * (wd.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
        this.bullets.push({ id: this.nid++, x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: p.id, life: wd.range / sp });
      }
      this.events.push({ t: 'shot', by: p.id, w: p.weapon.type, x: p.x, y: p.y, a: p.angle });
    }

    kill(v, by, how, a) {
      if (!v.alive || this.phase !== 'live') return;
      v.alive = false; v.down = false; v.fire = false;
      this.dropWeapon(v, Math.cos(a) * 120, Math.sin(a) * 120);
      this.events.push({ t: 'kill', id: v.id, x: v.x, y: v.y, a, how, by: by ? by.id : null, sk: v.skin });
    }
    knockdown(p, dur, a) {
      if (!p.alive || p.down) return;
      p.down = true; p.downT = dur; p.fire = false;
      this.dropWeapon(p, Math.cos(a) * 220, Math.sin(a) * 220);
      this.events.push({ t: 'down', id: p.id, x: p.x, y: p.y, a });
    }
    dropWeapon(p, vx = 0, vy = 0) {
      if (!p.weapon) return;
      this.addItem(p.weapon.type, p.x, p.y, vx * 0.5 + (Math.random() - 0.5) * 60, vy * 0.5 + (Math.random() - 0.5) * 60, p.weapon.ammo);
      p.weapon = null;
    }
    pickup(p) {
      let best = null, bd = 46;
      for (const it of this.items) { if (it.thrown) continue; const d = Math.hypot(it.x - p.x, it.y - p.y); if (d < bd) { bd = d; best = it; } }
      if (!best) return;
      const old = p.weapon;
      p.weapon = { type: best.type, ammo: best.ammo };
      this.items.splice(this.items.indexOf(best), 1);
      if (old) this.addItem(old.type, p.x, p.y, 0, 0, old.ammo);
      this.events.push({ t: 'pick', by: p.id, w: best.type, x: p.x, y: p.y });
    }
    throwWeapon(p) {
      if (!p.weapon) return;
      const a = p.angle; let sx = p.x + Math.cos(a) * 18, sy = p.y + Math.sin(a) * 18;
      if (!this.level.los(p.x, p.y, sx, sy)) { sx = p.x; sy = p.y; }
      const it = this.addItem(p.weapon.type, sx, sy, Math.cos(a) * 820, Math.sin(a) * 820, p.weapon.ammo);
      it.thrown = true; it.owner = p.id; it.t = 0.45; it.spin = 22;
      p.weapon = null; p.cd = Math.max(p.cd, 0.25);
      this.events.push({ t: 'throw', by: p.id, x: p.x, y: p.y });
    }

    tryDoors(p, dx, dy) {
      for (const d of this.level.doors) {
        if (d.open) continue;
        const rx = d.x * TILE, ry = d.y * TILE;
        const cx = Math.max(rx, Math.min(p.x, rx + TILE)), cy = Math.max(ry, Math.min(p.y, ry + TILE));
        if (Math.hypot(p.x - cx, p.y - cy) > PR + 2.5) continue;
        const vx = rx + TILE / 2 - p.x, vy = ry + TILE / 2 - p.y, l = Math.hypot(vx, vy) || 1;
        if ((dx * vx + dy * vy) / l < 0.35) continue;
        this.openDoor(d, p);
      }
    }
    openDoor(d, p) {
      const cx = (d.x + 0.5) * TILE, cy = (d.y + 0.5) * TILE;
      const dir = d.o === 'h' ? (p.y < cy ? 1 : -1) : (p.x < cx ? 1 : -1);
      this.level.openDoor(d, dir);
      let rx, ry, rw, rh;
      if (d.o === 'h') { rx = d.x * TILE - 6; rw = TILE + 12; rh = TILE * 2; ry = dir > 0 ? d.y * TILE : (d.y - 1) * TILE; }
      else { ry = d.y * TILE - 6; rh = TILE + 12; rw = TILE * 2; rx = dir > 0 ? d.x * TILE : (d.x - 1) * TILE; }
      const o = this.players[1 - p.slot];
      let hit = false;
      if (o && o.alive && !o.down && o.x > rx - PR && o.x < rx + rw + PR && o.y > ry - PR && o.y < ry + rh + PR) {
        this.knockdown(o, DOWN_TIME, d.o === 'h' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI)); hit = true;
      }
      this.events.push({ t: 'door', i: d.i, dir, x: cx, y: cy, hit });
    }

    updateBullets(dt) {
      const out = [];
      for (const b of this.bullets) {
        const sp = Math.hypot(b.vx, b.vy), n = Math.max(1, Math.ceil(sp * dt / 6));
        let dead = false;
        for (let s = 0; s < n && !dead; s++) {
          const px = b.x, py = b.y;
          b.x += b.vx * dt / n; b.y += b.vy * dt / n;
          if (this.level.solidAt(b.x, b.y)) { dead = true; this.events.push({ t: 'wall', x: px, y: py, a: Math.atan2(b.vy, b.vx) }); break; }
          for (const p of this.players) {
            if (!p || !p.alive || p.id === b.owner) continue;
            if (Math.hypot(p.x - b.x, p.y - b.y) < PR + 1) { dead = true; this.kill(p, this.byId(b.owner), 'bullet', Math.atan2(b.vy, b.vx)); break; }
          }
        }
        b.life -= dt;
        if (!dead && b.life > 0) out.push(b);
      }
      this.bullets = out;
    }

    updateItems(dt) {
      for (const it of this.items) {
        if (it.thrown) {
          const sp = Math.hypot(it.vx, it.vy), n = Math.max(1, Math.ceil(sp * dt / 8));
          const sx = it.vx * dt / n, sy = it.vy * dt / n; let stop = false;
          for (let s = 0; s < n && !stop; s++) {
            const nx = it.x + sx, ny = it.y + sy;
            if (this.level.solidAt(nx, ny)) { stop = true; it.vx *= -0.15; it.vy *= -0.15; break; }
            it.x = nx; it.y = ny;
            for (const p of this.players) {
              if (!p || !p.alive || p.id === it.owner) continue;
              if (Math.hypot(p.x - it.x, p.y - it.y) < PR + 8) {
                if (!p.down) this.knockdown(p, DOWN_TIME, Math.atan2(it.vy, it.vx));
                this.events.push({ t: 'thit', x: it.x, y: it.y });
                stop = true; it.vx *= -0.1; it.vy *= -0.1; break;
              }
            }
          }
          it.rot += it.spin * dt; it.t -= dt;
          if (stop || it.t <= 0) { it.thrown = false; it.owner = null; it.vx *= 0.25; it.vy *= 0.25; it.spin = 0; }
        } else if (it.vx || it.vy) {
          const nx = it.x + it.vx * dt, ny = it.y + it.vy * dt;
          if (!this.level.solidAt(nx, it.y)) it.x = nx; else it.vx = 0;
          if (!this.level.solidAt(it.x, ny)) it.y = ny; else it.vy = 0;
          const f = Math.pow(0.02, dt); it.vx *= f; it.vy *= f;
          if (Math.abs(it.vx) + Math.abs(it.vy) < 4) { it.vx = 0; it.vy = 0; }
          it.rot += (it.vx + it.vy) * 0.002;
        }
      }
    }

    snapshot() {
      const r1 = v => Math.round(v * 10) / 10;
      return {
        type: 's', ph: this.phase, tm: Math.max(0, +this.timer.toFixed(2)), rd: this.round,
        map: this.level ? this.level.id : null, win: this.winner,
        pl: this.players.filter(Boolean).map(p => ({
          id: p.id, sl: p.slot, nm: p.name, sk: p.skin, sc: p.score, x: r1(p.x), y: r1(p.y), a: Math.round(p.angle * 100) / 100,
          al: p.alive ? 1 : 0, dn: p.down ? 1 : 0, dt: +Math.max(0, p.downT).toFixed(2),
          w: p.weapon ? p.weapon.type : 0, am: p.weapon ? p.weapon.ammo : 0, bot: p.bot ? 1 : 0
        })),
        b: this.bullets.map(b => [b.id, r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
        it: this.items.map(i => [i.id, r1(i.x), r1(i.y), i.type, i.ammo, Math.round(i.rot * 100) / 100, i.thrown ? 1 : 0]),
        dr: this.level ? this.level.doors.filter(d => d.open).map(d => [d.i, d.dir]) : [],
        ev: this.events
      };
    }
  }

  /* ------------------------------------------------------------------ BOT */
  function bfs(L, sx, sy, gx, gy) {
    const W = L.W, H = L.H, prev = new Int16Array(W * H).fill(-1), start = sy * W + sx, goal = gy * W + gx;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H || gx < 0 || gy < 0 || gx >= W || gy >= H) return [];
    const q = [start]; prev[start] = start;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi]; if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (prev[k] >= 0 || L.g[ny][nx] === 1) continue;
        prev[k] = c; q.push(k);
      }
    }
    if (prev[goal] < 0) return [];
    const path = []; let c = goal;
    while (c !== start) { path.push([c % W, (c / W) | 0]); c = prev[c]; }
    return path.reverse();
  }

  class Bot {
    constructor(game, slot, diff) {
      this.g = game; this.slot = slot;
      const D = { EASY: { turn: 3.2, react: 0.55, acc: 0.14 }, NORMAL: { turn: 5.5, react: 0.32, acc: 0.07 }, HARD: { turn: 9, react: 0.16, acc: 0.03 } };
      this.d = D[diff] || D.NORMAL;
      this.ang = slot ? Math.PI : 0; this.path = []; this.pathT = 0; this.seen = 0; this.noise = 0; this.noiseT = 0;
      this.st = 1; this.stT = 0; this.pkCd = 0; this.thCd = 0;
    }
    think(dt) {
      const g = this.g, me = g.players[this.slot], en = g.players[1 - this.slot];
      if (!me || !en) return;
      const idle = { k: 0, a: this.ang, f: 0, fp: 0, pk: 0, th: 0 };
      if (g.phase !== 'live' || !me.alive || me.down || !g.level) { g.applyInput(me, idle, dt); return; }
      const L = g.level, D = this.d, T = TILE;
      const dx = en.x - me.x, dy = en.y - me.y, dist = Math.hypot(dx, dy) || 1;
      const los = en.alive && L.los(me.x, me.y, en.x, en.y);
      this.seen = los ? this.seen + dt : 0;
      this.noiseT -= dt; if (this.noiseT <= 0) { this.noiseT = 0.4; this.noise = (Math.random() - 0.5) * D.acc * 2; }
      this.stT -= dt; if (this.stT <= 0) { this.stT = 0.5 + Math.random() * 1.2; this.st = Math.random() < 0.5 ? -1 : 1; }
      this.pkCd -= dt; this.thCd -= dt;

      const wd = me.weapon ? WEAPONS[me.weapon.type] : WEAPONS.FISTS;
      const hasGun = !!me.weapon && !wd.melee && me.weapon.ammo > 0;
      const hasMelee = !!me.weapon && wd.melee;
      const emptyGun = !!me.weapon && !wd.melee && me.weapon.ammo <= 0;
      const armed = hasGun || hasMelee;

      // 1) procurar arma
      let item = null;
      if (!armed || (hasMelee && !los)) {
        let bd = 1e9;
        for (const it of g.items) {
          const iw = WEAPONS[it.type];
          if (it.thrown || (!iw.melee && it.ammo <= 0)) continue;
          const d = Math.hypot(it.x - me.x, it.y - me.y), gunB = iw.melee ? 0 : 140, sc = d - gunB;
          if ((!armed || (gunB > 0 && d < 220)) && sc < bd) { bd = sc; item = it; }
        }
      }
      let goal, pk = 0, fire = 0, fp = 0, th = 0, strafe = 0, back = 0, approach = true, pref = 280;
      if (item) {
        goal = { x: item.x, y: item.y };
        if (Math.hypot(item.x - me.x, item.y - me.y) < 34 && this.pkCd <= 0) { pk = 1; this.pkCd = 0.5; }
      } else goal = { x: en.x, y: en.y };

      // 2) mira
      let wantAng = this.ang;
      if (en.alive && los) wantAng = Math.atan2(dy, dx) + this.noise;
      const err = Math.abs(angDiff(wantAng, this.ang));

      // 3) combate
      if (en.alive && !item) {
        if (en.down && los && dist < wd.range + PR + 6) { if (err < 0.6 && me.cd <= 0) fp = 1; }
        else if (hasGun && los) {
          pref = me.weapon.type === 'SHOTGUN' ? 170 : (me.weapon.type === 'PISTOL' ? 330 : 280);
          if (dist < pref * 0.6) { approach = false; back = 1; }
          else if (dist < pref * 1.3) { approach = false; strafe = 1; }
          if (this.seen > D.react && err < 0.1) { if (wd.auto) fire = 1; else if (me.cd <= 0) fp = 1; }
        } else if (los && dist < wd.range + PR + 4 && err < 0.7 && me.cd <= 0 && this.seen > D.react * 0.5) fp = 1;
      }
      if (emptyGun && los && dist < 400 && !en.down && this.thCd <= 0 && err < 0.2) { th = 1; this.thCd = 1; }

      // 4) movimento
      let mx = 0, my = 0;
      if (strafe) {
        mx = (-dy / dist) * this.st; my = (dx / dist) * this.st;
        if (dist > pref * 1.05) { mx += dx / dist * 0.5; my += dy / dist * 0.5; }
      } else if (back) { mx = -dx / dist; my = -dy / dist; }
      else if (approach) {
        const direct = L.los(me.x, me.y, goal.x, goal.y);
        let tx = goal.x, ty = goal.y;
        if (!direct) {
          const mtx = Math.floor(me.x / T), mty = Math.floor(me.y / T);
          this.pathT -= dt;
          if (this.pathT <= 0) { this.pathT = 0.25; this.path = bfs(L, mtx, mty, Math.floor(goal.x / T), Math.floor(goal.y / T)); }
          while (this.path.length && this.path[0][0] === mtx && this.path[0][1] === mty) this.path.shift();
          if (this.path.length) { tx = (this.path[0][0] + 0.5) * T; ty = (this.path[0][1] + 0.5) * T; }
        }
        const vx = tx - me.x, vy = ty - me.y, l = Math.hypot(vx, vy);
        if (l > 6) { mx = vx / l; my = vy / l; }
      }
      if (!(en.alive && los) && (mx || my)) wantAng = Math.atan2(my, mx);

      const m = D.turn * dt;
      this.ang += Math.max(-m, Math.min(m, angDiff(wantAng, this.ang)));
      let k = 0;
      if (mx > 0.3) k |= 8; if (mx < -0.3) k |= 2; if (my > 0.3) k |= 4; if (my < -0.3) k |= 1;
      g.applyInput(me, { k, a: this.ang, f: fire, fp, pk, th }, dt);
    }
  }

  return { TILE, PR, SPEED, WIN_SCORE, DOWN_TIME, WEAPONS, MAPS, MAP_IDS, Level, Game, Bot, stepMove, canMove, angDiff };
});
