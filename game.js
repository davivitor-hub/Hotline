'use strict';
/* ==========================================================================
   NEON DUEL — cliente
   Online 1v1 (servidor autoritativo + predição/reconciliação) ou treino vs bot
   (a mesma simulação roda localmente). Estilo Hotline Miami: um tiro = morte.
   ========================================================================== */
const { TILE, PR, WEAPONS, MAPS, Level, Game, Bot, stepMove, canMove, angDiff, DOWN_TIME } = Shared;
const $ = id => document.getElementById(id);

// Se hospedar o cliente separado do servidor, troque por 'wss://SEU-SERVIDOR.onrender.com'
const SERVER_URL = (location.protocol === 'http:' || location.protocol === 'https:')
  ? ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host) : 'ws://localhost:3000';

const STEP = 1 / 60, TAU = Math.PI * 2;
const SKINS = {
  ROOSTER: { c: '#ffd23f', n: 'Galo' }, TIGER: { c: '#ff8a2b', n: 'Tigre' }, BEAR: { c: '#a9794f', n: 'Urso' },
  MONKEY: { c: '#b28cff', n: 'Macaco' }, WOLF: { c: '#9fb4c8', n: 'Lobo' }
};

/* --------------------------------------------------------------- CONFIG */
function loadCfg() { try { return JSON.parse(localStorage.getItem('neonduel') || '{}'); } catch { return {}; } }
const cfg = Object.assign({ name: '', skin: 'ROOSTER', diff: 'NORMAL', music: true, sfx: true, shake: true, crt: true }, loadCfg());
function saveCfg() { try { localStorage.setItem('neonduel', JSON.stringify(cfg)); } catch { } }

/* ---------------------------------------------------------------- ESTADO */
const cv = $('game'), ctx = cv.getContext('2d', { alpha: false });
let dpr = 1, S = 1, Z = 1, W = innerWidth, H = innerHeight;
let mode = null, ws = null, myId = null, local = null, paused = false, pingMs = 0, pingTimer = null;
let level = null, mapId, round = -1, snap = null, snapAt = 0, buf = [], pending = [], seq = 0, first = true;
let pred = { x: 0, y: 0 }, cam = { x: 0, y: 0 }, camInit = false;
let keys = {}, mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false }, edge = { fp: false, pk: false, th: false };
let shake = 0, zoomKick = 0, hitstop = 0, goUntil = 0;
let fx = { parts: [], lights: [], slashes: [], corpses: [], flash: 0, red: 0 };
let anim = {}, levelCv = null, decal = null, dctx = null;
const INTERP = () => (mode === 'local' ? 40 : 100);

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
  cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
  S = Math.max(0.7, Math.min(1.6, H / 780));
}
addEventListener('resize', resize); resize();

/* ------------------------------------------------------------------ ÁUDIO */
let ac = null, master, musG, sfxG, noiseBuf, nextT = 0, step16 = 0;
function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    musG = ac.createGain(); musG.gain.value = cfg.music ? 0.17 : 0; musG.connect(master);
    sfxG = ac.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextT = ac.currentTime + 0.1; setInterval(schedule, 50);
  } catch { ac = null; }
}
function osc(dest, type, f, t, d, v, f2) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + d + 0.02);
}
function nz(dest, t, d, v, type, f) {
  const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; fl.type = type; fl.frequency.value = f;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5, d + 0.05);
}
const BASS = [55, 0, 55, 55, 0, 55, 0, 55, 65.41, 0, 65.41, 65.41, 0, 65.41, 0, 65.41, 49, 0, 49, 49, 0, 49, 0, 49, 58.27, 0, 58.27, 58.27, 0, 58.27, 0, 73.42];
const ARP = [1, 1.5, 2, 3, 2, 1.5, 2, 1.5];
function schedule() {
  if (!ac) return;
  while (nextT < ac.currentTime + 0.2) {
    const i = step16 % 32, t = nextT;
    if (i % 4 === 0) { osc(musG, 'sine', 150, t, 0.16, 1, 40); }
    if (i % 8 === 4) nz(musG, t, 0.12, 0.45, 'highpass', 1500);
    if (i % 4 === 2) nz(musG, t, 0.04, 0.22, 'highpass', 7000);
    if (BASS[i]) osc(musG, 'sawtooth', BASS[i], t, 0.14, 0.55);
    if (BASS[i - (i % 8)] && i % 2 === 0) osc(musG, 'square', BASS[i - (i % 8)] * 4 * ARP[(i / 2) % 8], t, 0.09, 0.12);
    nextT += 60 / 122 / 4; step16++;
  }
}
function sfx(n, x, y) {
  if (!ac || !cfg.sfx) return;
  let v = 1;
  if (x !== undefined) { v = Math.max(0, 1 - Math.hypot(x - cam.x, y - cam.y) / 1500); if (v < 0.05) return; }
  const t = ac.currentTime, d = sfxG;
  switch (n) {
    case 'PISTOL': nz(d, t, 0.12, 0.9 * v, 'bandpass', 1800); osc(d, 'square', 200, t, 0.1, 0.4 * v, 60); break;
    case 'SMG': nz(d, t, 0.08, 0.8 * v, 'bandpass', 2200); osc(d, 'square', 170, t, 0.07, 0.35 * v, 70); break;
    case 'RIFLE': nz(d, t, 0.15, 1 * v, 'bandpass', 1400); osc(d, 'sawtooth', 130, t, 0.12, 0.45 * v, 50); break;
    case 'SHOTGUN': nz(d, t, 0.32, 1.2 * v, 'lowpass', 1400); osc(d, 'sawtooth', 110, t, 0.28, 0.6 * v, 32); break;
    case 'swing': nz(d, t, 0.13, 0.35 * v, 'highpass', 1400); break;
    case 'kill': osc(d, 'sine', 120, t, 0.3, 0.9 * v, 30); nz(d, t, 0.22, 0.7 * v, 'lowpass', 900); break;
    case 'down': osc(d, 'sine', 90, t, 0.2, 0.7 * v, 40); break;
    case 'hit': osc(d, 'triangle', 300, t, 0.1, 0.5 * v, 120); break;
    case 'door': nz(d, t, 0.18, 0.7 * v, 'lowpass', 500); osc(d, 'sine', 70, t, 0.18, 0.5 * v, 40); break;
    case 'pick': osc(d, 'square', 600, t, 0.07, 0.25 * v, 950); break;
    case 'click': osc(d, 'square', 1600, t, 0.025, 0.25 * v); break;
    case 'throw': nz(d, t, 0.2, 0.3 * v, 'bandpass', 900); break;
    case 'wall': nz(d, t, 0.05, 0.25 * v, 'highpass', 3000); break;
    case 'go': osc(d, 'sawtooth', 220, t, 0.35, 0.4, 660); osc(d, 'square', 330, t, 0.35, 0.2, 990); break;
    case 'end': osc(d, 'triangle', 440, t, 0.4, 0.4, 220); break;
    case 'tick': osc(d, 'square', 880, t, 0.06, 0.2); break;
  }
}

/* ---------------------------------------------------------------- MENU/UI */
const skinsEl = $('skins');
for (const k in SKINS) {
  const b = document.createElement('button');
  b.className = 'skin'; b.dataset.skin = k; b.type = 'button';
  b.innerHTML = `<i style="background:${SKINS[k].c}"></i>${SKINS[k].n}`;
  b.onclick = () => { cfg.skin = k; saveCfg(); refreshSkins(); };
  skinsEl.appendChild(b);
}
function refreshSkins() { for (const b of skinsEl.children) b.setAttribute('aria-pressed', b.dataset.skin === cfg.skin ? 'true' : 'false'); }
refreshSkins();
$('nameInput').value = cfg.name; $('diffSel').value = cfg.diff;
$('optMusic').checked = cfg.music; $('optSfx').checked = cfg.sfx; $('optShake').checked = cfg.shake; $('optCrt').checked = cfg.crt;
document.body.classList.toggle('nocrt', !cfg.crt);
$('optMusic').onchange = e => { cfg.music = e.target.checked; if (musG) musG.gain.value = cfg.music ? 0.17 : 0; saveCfg(); };
$('optSfx').onchange = e => { cfg.sfx = e.target.checked; saveCfg(); };
$('optShake').onchange = e => { cfg.shake = e.target.checked; saveCfg(); };
$('optCrt').onchange = e => { cfg.crt = e.target.checked; document.body.classList.toggle('nocrt', !cfg.crt); saveCfg(); };
$('nameInput').oninput = e => { cfg.name = e.target.value; saveCfg(); };
$('diffSel').onchange = e => { cfg.diff = e.target.value; saveCfg(); };
$('btnOnline').onclick = () => { initAudio(); startOnline(); };
$('btnBot').onclick = () => { initAudio(); startLocal(cfg.diff); };
$('btnResume').onclick = () => setPaused(false);
$('btnLeave').onclick = () => { closeAll(); showMenu(''); };
const status = t => { $('status').textContent = t; };
function showMenu(msg) { $('menu').classList.remove('hidden'); $('pause').classList.add('hidden'); $('hud').classList.add('hidden'); $('banner').classList.add('hidden'); status(msg || ''); }
function hideMenu() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); }
function setPaused(p) {
  if (!mode) return; paused = p; $('pause').classList.toggle('hidden', !p);
  if (p) { keys = {}; mouse.down = false; }
}
const playerName = () => (cfg.name || '').trim() || 'Jogador';

/* ------------------------------------------------------------ CONEXÃO */
function closeAll() {
  if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { } ws = null; }
  clearInterval(pingTimer); local = null; mode = null; snap = null; level = null; mapId = undefined; round = -1; buf = []; pending = [];
  paused = false; camInit = false; resetFx(); $('pause').classList.add('hidden');
}
function startOnline() {
  closeAll(); mode = 'online'; status('Conectando ao servidor…');
  try { ws = new WebSocket(SERVER_URL); } catch { mode = null; return status('Endereço do servidor inválido.'); }
  const sock = ws;
  sock.onopen = () => {
    sock.send(JSON.stringify({ type: 'join', name: playerName(), skin: cfg.skin }));
    pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'ping', t: performance.now() })); }, 2000);
  };
  sock.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') myId = m.id;
    else if (m.type === 'joined') hideMenu();
    else if (m.type === 'full') { closeAll(); showMenu('A sala está cheia (2 jogadores). Tente de novo em instantes.'); }
    else if (m.type === 's') onSnapshot(m);
    else if (m.type === 'pong') pingMs = Math.round(performance.now() - m.t);
  };
  sock.onerror = () => { if (mode === 'online' && !snap) status('Falha de conexão. O servidor está ligado?'); };
  sock.onclose = () => { const had = !!snap; closeAll(); showMenu(had ? 'Conexão perdida com o servidor.' : 'Não foi possível conectar. O servidor pode estar iniciando, tente de novo em 30 s.'); };
}
function startLocal(diff) {
  closeAll(); mode = 'local'; myId = 'me';
  const g = new Game();
  const me = g.addPlayer('me', playerName(), cfg.skin);
  const keysSk = Object.keys(SKINS).filter(k => k !== cfg.skin);
  const bot = g.addPlayer('bot', 'BOT ' + ({ EASY: 'fácil', NORMAL: 'normal', HARD: 'difícil' }[diff] || ''), keysSk[Math.floor(Math.random() * keysSk.length)]);
  bot.bot = true;
  local = { g, me, bot: new Bot(g, 1, diff), t: 0 };
  hideMenu();
}
function sendInput(inp) {
  if (mode === 'online') { if (ws && ws.readyState === 1) ws.send(JSON.stringify(inp)); }
  else if (local) { local.me.ack = inp.seq; local.g.applyInput(local.me, inp, inp.dt); }
}

/* ------------------------------------------------------------- SNAPSHOT */
const myState = () => (snap ? snap.pl.find(p => p.id === myId) : null);
const enemyState = () => (snap ? snap.pl.find(p => p.id !== myId) : null);

function resetFx() {
  fx = { parts: [], lights: [], slashes: [], corpses: [], flash: 0, red: 0 };
  if (dctx && decal) dctx.clearRect(0, 0, decal.width, decal.height);
}
function buildStatic() {
  const th = level.m.theme, T = TILE, g = level.m.g;
  levelCv = document.createElement('canvas'); levelCv.width = level.W * T; levelCv.height = level.H * T;
  const c = levelCv.getContext('2d');
  const wall = (x, y) => x < 0 || y < 0 || x >= level.W || y >= level.H || g[y][x] === 1;
  for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) {
    if (wall(x, y)) continue;
    c.fillStyle = ((x + y) & 1) ? th.f1 : th.f2; c.fillRect(x * T, y * T, T, T);
    c.strokeStyle = 'rgba(255,255,255,.025)'; c.strokeRect(x * T + .5, y * T + .5, T - 1, T - 1);
  }
  for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) if (g[y][x] === 1) {
    c.fillStyle = '#09030f'; c.fillRect(x * T, y * T, T, T);
    c.fillStyle = 'rgba(255,255,255,.035)'; c.fillRect(x * T + 5, y * T + 5, T - 10, T - 10);
  }
  c.shadowColor = th.a; c.shadowBlur = 12; c.strokeStyle = th.a; c.lineWidth = 2; c.beginPath();
  for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) if (g[y][x] === 1) {
    const X = x * T, Y = y * T;
    if (!wall(x, y - 1)) { c.moveTo(X, Y + 1); c.lineTo(X + T, Y + 1); }
    if (!wall(x, y + 1)) { c.moveTo(X, Y + T - 1); c.lineTo(X + T, Y + T - 1); }
    if (!wall(x - 1, y)) { c.moveTo(X + 1, Y); c.lineTo(X + 1, Y + T); }
    if (!wall(x + 1, y)) { c.moveTo(X + T - 1, Y); c.lineTo(X + T - 1, Y + T); }
  }
  c.stroke();
  decal = document.createElement('canvas'); decal.width = level.W * T; decal.height = level.H * T; dctx = decal.getContext('2d');
}
function newRound(s) {
  mapId = s.map; round = s.rd; buf = []; pending = []; first = true; resetFx();
  if (s.map) { level = new Level(s.map); buildStatic(); } else { level = null; levelCv = null; }
}
function onSnapshot(s) {
  const now = performance.now();
  if (s.map !== mapId || s.rd !== round) newRound(s);
  snap = s; snapAt = now;
  for (const e of s.ev) handleEvent(e, now);
  if (level) for (const [i, dir] of s.dr) { const d = level.doors[i]; if (d && !d.open) { level.openDoor(d, dir); d.openAt = now - 1000; } }
  buf.push({ t: now, pl: s.pl }); if (buf.length > 30) buf.shift();
  const me = s.pl.find(p => p.id === myId);
  if (me && level) {
    while (pending.length && pending[0].seq <= (s.ack || 0)) pending.shift();
    const t = { x: me.x, y: me.y };
    if (canMove(s.ph, me.al, me.dn)) for (const p of pending) stepMove(level, t, p.k, p.dt);
    const err = Math.hypot(t.x - pred.x, t.y - pred.y);
    if (first || err > 40) { pred.x = t.x; pred.y = t.y; first = false; }
    else { pred.x += (t.x - pred.x) * 0.35; pred.y += (t.y - pred.y) * 0.35; }
  }
}
function interpEnemy(id) {
  const rt = performance.now() - INTERP();
  let a = null, b = null;
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1] || null; break; }
  if (!a) a = buf[0];
  if (!a) return null;
  const pa = a.pl.find(q => q.id === id); if (!pa) return null;
  if (!b) return { x: pa.x, y: pa.y, a: pa.a };
  const pb = b.pl.find(q => q.id === id) || pa, f = Math.max(0, Math.min(1, (rt - a.t) / Math.max(1, b.t - a.t)));
  return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, a: pa.a + angDiff(pb.a, pa.a) * f };
}

/* ---------------------------------------------------------------- EVENTOS */
const animOf = id => anim[id] || (anim[id] = { walk: 0, lx: 0, ly: 0, sw0: -1e9, sw: 'FISTS', recoil: 0, punch: 1 });
function addShake(v) { if (cfg.shake) shake = Math.min(18, shake + v); }
function handleEvent(e, now) {
  switch (e.t) {
    case 'shot': {
      sfx(e.w, e.x, e.y);
      const mx = e.x + Math.cos(e.a) * 28, my = e.y + Math.sin(e.a) * 28;
      fx.lights.push({ x: mx, y: my, t: 0.08, r: 170, c: '255,225,130' });
      for (let i = 0; i < 4; i++) fx.parts.push({ k: 's', x: mx, y: my, vx: Math.cos(e.a + (Math.random() - .5)) * 300, vy: Math.sin(e.a + (Math.random() - .5)) * 300, life: 0.08, sz: 6, col: '#ffe9a0' });
      const ca = e.a + Math.PI / 2 + (Math.random() - .5);
      fx.parts.push({ k: 'c', x: e.x, y: e.y, vx: Math.cos(ca) * 120, vy: Math.sin(ca) * 120, rot: Math.random() * 6, vr: 20, life: 0.5 });
      animOf(e.by).recoil = 1;
      addShake(e.by === myId ? (e.w === 'SHOTGUN' ? 7 : e.w === 'RIFLE' ? 4 : 2.5) : 1.2);
      break;
    }
    case 'swing': {
      const st = animOf(e.by); st.sw0 = now; st.sw = e.w; st.punch *= -1;
      sfx('swing', e.x, e.y);
      fx.slashes.push({ x: e.x, y: e.y, a: e.a, t: 0.2, w: e.w });
      break;
    }
    case 'kill': {
      sfx('kill', e.x, e.y);
      const big = e.how === 'exec';
      addBlood(e.x, e.y, e.a, big ? 80 : 50, big ? 420 : 330);
      bloodPool(e.x, e.y, e.a, big);
      fx.corpses.push({ x: e.x, y: e.y, a: e.a, sk: e.sk, vx: Math.cos(e.a) * (big ? 30 : 160), vy: Math.sin(e.a) * (big ? 30 : 160), mine: e.id === myId });
      addShake(big ? 13 : 9); fx.flash = 0.35; hitstop = 0.09; zoomKick = 0.06;
      if (e.id === myId) fx.red = 0.6;
      break;
    }
    case 'down': {
      sfx('down', e.x, e.y); addShake(5);
      for (let i = 0; i < 8; i++) fx.parts.push({ k: 's', x: e.x, y: e.y, vx: (Math.random() - .5) * 260, vy: (Math.random() - .5) * 260, life: 0.25, sz: 4, col: '#fff6a0' });
      break;
    }
    case 'door': {
      if (level) { const d = level.doors[e.i]; if (d && !d.open) { level.openDoor(d, e.dir); d.openAt = now; } }
      sfx('door', e.x, e.y); addShake(e.hit ? 8 : 2.5);
      break;
    }
    case 'thit': sfx('hit', e.x, e.y); addShake(3); break;
    case 'wall':
      for (let i = 0; i < 3; i++) fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(e.a + Math.PI + (Math.random() - .5) * 2) * 220, vy: Math.sin(e.a + Math.PI + (Math.random() - .5) * 2) * 220, life: 0.14, sz: 5, col: '#9ff7ff' });
      if (Math.random() < 0.35) sfx('wall', e.x, e.y);
      break;
    case 'pick': sfx('pick', e.x, e.y); break;
    case 'click': sfx('click', e.x, e.y); break;
    case 'throw': sfx('throw', e.x, e.y); break;
    case 'go': goUntil = now + 900; sfx('go'); break;
    case 'end': sfx('end'); break;
  }
}
function addBlood(x, y, a, n, spd) {
  for (let i = 0; i < n; i++) {
    const aa = a + (Math.random() - .5) * 1.5, s = spd * (0.2 + Math.random());
    fx.parts.push({ k: 'b', x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life: 0.35 + Math.random() * 0.5, sz: 1.5 + Math.random() * 3.5 });
  }
}
function stamp(x, y, r, a = 0.85) {
  if (!dctx) return;
  dctx.fillStyle = `rgba(${150 + Math.random() * 70 | 0},8,${30 + Math.random() * 25 | 0},${a})`;
  dctx.beginPath(); dctx.arc(x, y, r, 0, TAU); dctx.fill();
}
function bloodPool(x, y, a, big) {
  const n = big ? 22 : 14;
  for (let i = 0; i < n; i++) stamp(x + (Math.random() - .5) * 40, y + (Math.random() - .5) * 40, 4 + Math.random() * (big ? 14 : 10), 0.7);
  for (let i = 0; i < (big ? 12 : 8); i++) {
    const d = 20 + Math.random() * 110; stamp(x + Math.cos(a) * d + (Math.random() - .5) * 24, y + Math.sin(a) * d + (Math.random() - .5) * 24, 1.5 + Math.random() * 4);
  }
}

/* ---------------------------------------------------------------- ENTRADA */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'escape') return;
  if (!mode || paused) return;
  if (['w', 'a', 's', 'd', 'e', 'f', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  const map = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' };
  keys[map[k] || k] = true;
  if (k === 'e') edge.pk = true;
  if (k === 'f') edge.th = true;
  if (k === 'm') { cfg.music = !cfg.music; if (musG) musG.gain.value = cfg.music ? 0.17 : 0; $('optMusic').checked = cfg.music; saveCfg(); }
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); const map = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }; keys[map[k] || k] = false; });
addEventListener('blur', () => { keys = {}; mouse.down = false; });
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => {
  if (!mode || paused) return; initAudio();
  if (e.button === 0) { mouse.down = true; edge.fp = true; }
  if (e.button === 2) { e.preventDefault(); edge.th = true; }
});
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());

const aimAngle = () => Math.atan2(mouse.y - (H / 2 + (pred.y - cam.y) * Z), mouse.x - (W / 2 + (pred.x - cam.x) * Z));

function doStep() {
  if (mode === 'local' && local) {
    // monta e aplica a entrada do jogador, depois bot + tick
    if (snap && level) stepInput();
    local.bot.think(STEP); local.g.tick(STEP);
    if (++local.t % 2 === 0) { const s = local.g.snapshot(); s.ack = local.me.ack; local.g.events = []; onSnapshot(s); }
    return;
  }
  if (snap && level) stepInput();
}
function stepInput() {
  const k = (keys.w ? 1 : 0) | (keys.a ? 2 : 0) | (keys.s ? 4 : 0) | (keys.d ? 8 : 0);
  const inp = { type: 'input', seq: ++seq, dt: STEP, k, a: +aimAngle().toFixed(3), f: mouse.down ? 1 : 0, fp: edge.fp ? 1 : 0, pk: edge.pk ? 1 : 0, th: edge.th ? 1 : 0 };
  edge.fp = edge.pk = edge.th = false;
  const me = myState();
  if (me && canMove(snap.ph, me.al, me.dn)) stepMove(level, pred, k, STEP);
  pending.push({ seq: inp.seq, dt: STEP, k }); if (pending.length > 120) pending.shift();
  sendInput(inp);
}

/* ------------------------------------------------------------------ DESENHO */
const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
const rr = (x, y, w, h, f) => { ctx.fillStyle = f; ctx.fillRect(x, y, w, h); };

function drawWeaponSprite(type) {
  const w = WEAPONS[type];
  switch (type) {
    case 'PISTOL': rr(-2, -2.5, 14, 5, '#2b2f3a'); rr(-2, 0, 5, 7, '#2b2f3a'); rr(10, -1.5, 5, 3, w.col); break;
    case 'SMG': rr(-4, -3, 22, 6, '#2b2f3a'); rr(2, 2, 5, 9, '#1c1f27'); rr(18, -1.5, 6, 3, w.col); break;
    case 'RIFLE': rr(-8, -3, 34, 6, '#2b2f3a'); rr(-13, -3.5, 6, 7, '#4a3a2a'); rr(6, 2, 5, 8, '#1c1f27'); rr(26, -1.5, 8, 3, w.col); break;
    case 'SHOTGUN': rr(-8, -3, 36, 6, '#5a4026'); rr(8, -2.5, 12, 5, '#2b2f3a'); rr(28, -2, 6, 4, w.col); break;
    case 'KNIFE': rr(-2, -2, 8, 4, '#3b2a2a'); ctx.fillStyle = '#e6f1ff'; ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(24, 0); ctx.lineTo(6, 2.5); ctx.fill(); break;
    case 'BAT': rr(-2, -2, 40, 4.5, '#c58a4a'); rr(28, -3.4, 12, 6.8, '#d99a55'); break;
    case 'KATANA': rr(-4, -2, 14, 4, '#2a1020'); rr(9, -3.5, 2.5, 7, '#ffd23f'); rr(11, -1.3, 40, 2.6, '#cffaff'); break;
  }
}
function drawHead(skin) {
  const c = (SKINS[skin] || SKINS.ROOSTER).c;
  ctx.fillStyle = c;
  if (skin === 'BEAR' || skin === 'MONKEY') { circle(-1, -8.5, skin === 'BEAR' ? 3.6 : 4.4); circle(-1, 8.5, skin === 'BEAR' ? 3.6 : 4.4); }
  if (skin === 'TIGER' || skin === 'WOLF') {
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-1, s * 5); ctx.lineTo(-5, s * 12); ctx.lineTo(3, s * 8); ctx.closePath(); ctx.fill(); }
  }
  ctx.fillStyle = c; circle(0, 0, 9.5);
  ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, TAU); ctx.stroke();
  if (skin === 'ROOSTER') {
    ctx.fillStyle = '#ff2e4d'; circle(-3, 0, 3.4); circle(1, 0, 3); circle(4.5, 0, 2.4);
    ctx.fillStyle = '#ff9a2b'; ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(15, 0); ctx.lineTo(8, 3); ctx.fill();
  }
  if (skin === 'TIGER') { ctx.strokeStyle = '#2a1200'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-1, -2); ctx.moveTo(-6, 4); ctx.lineTo(-1, 2); ctx.moveTo(-2, 0); ctx.lineTo(4, 0); ctx.stroke(); }
  if (skin === 'BEAR') { ctx.fillStyle = '#d9b48c'; circle(7, 0, 3.8); ctx.fillStyle = '#000'; circle(9.5, 0, 1.4); }
  if (skin === 'MONKEY') { ctx.fillStyle = '#e7d4ff'; ctx.beginPath(); ctx.ellipse(5, 0, 5, 6, 0, 0, TAU); ctx.fill(); }
  if (skin === 'WOLF') { ctx.fillStyle = '#e4edf6'; ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(14, 0); ctx.lineTo(4, 4); ctx.fill(); ctx.fillStyle = '#000'; circle(13, 0, 1.5); }
  ctx.fillStyle = '#fff'; circle(4, -3.6, 1.8); circle(4, 3.6, 1.8); ctx.fillStyle = '#000'; circle(4.6, -3.6, 1); circle(4.6, 3.6, 1);
}
function drawBody(skin, jacket, flat) {
  ctx.fillStyle = jacket; ctx.beginPath(); ctx.ellipse(0, 0, flat ? 11 : 7.5, flat ? 15 : 13, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawPlayer(p, x, y, ang, isMe, now) {
  const st = animOf(p.id);
  if (!st.lx && !st.ly) { st.lx = x; st.ly = y; }
  st.walk += Math.hypot(x - st.lx, y - st.ly) * 0.14; st.lx = x; st.ly = y;
  st.recoil = Math.max(0, st.recoil - 0.12);
  const jacket = isMe ? '#10c6e8' : '#ff2e97';
  ctx.save(); ctx.translate(x, y);
  if (isMe) { ctx.strokeStyle = 'rgba(0,229,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(2, 4, 16, 13, 0, 0, TAU); ctx.fill();
  ctx.rotate(ang);
  if (p.dn) {
    ctx.globalAlpha = 0.92; drawBody(p.sk, jacket, true); ctx.translate(-3, 0); drawHead(p.sk); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.save(); ctx.translate(x, y);
    const k = 1 - Math.max(0, p.dt) / DOWN_TIME;
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.fillStyle = '#fff6a0'; for (let i = 0; i < 3; i++) { const a = now / 180 + i * 2.1; ctx.fillRect(Math.cos(a) * 18 - 2, Math.sin(a) * 8 - 26, 4, 4); }
    ctx.restore(); return;
  }
  // pés
  const sw = Math.sin(st.walk) * 5; ctx.fillStyle = '#0d0714'; circle(sw, -6, 4); circle(-sw, 6, 4);
  const sp = Math.min(1, (now - st.sw0) / 200), swinging = sp < 1;
  const wt = p.w, wd = wt ? WEAPONS[wt] : null, melee = !wt || wd.melee;
  const skinC = (SKINS[p.sk] || SKINS.ROOSTER).c;
  // braços + arma
  if (!wt) {
    const side = st.punch, ext = swinging ? Math.sin(sp * Math.PI) * 16 : 0;
    ctx.strokeStyle = jacket; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, side * 9); ctx.lineTo(10 + (swinging ? ext : 0), side * 6); ctx.moveTo(0, -side * 9); ctx.lineTo(9, -side * 7); ctx.stroke();
    ctx.fillStyle = skinC; circle(12 + ext, side * 6, 3.6); circle(10, -side * 7, 3.6);
  } else if (melee) {
    const arc = wd.arc, a = swinging ? (-arc / 2 + sp * arc) : -0.6;
    ctx.strokeStyle = jacket; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(10, 8); ctx.stroke();
    ctx.save(); ctx.translate(10, 8); ctx.rotate(a); drawWeaponSprite(wt); ctx.fillStyle = skinC; circle(1, 0, 3.4); ctx.restore();
    ctx.strokeStyle = jacket; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, -7); ctx.stroke(); ctx.fillStyle = skinC; circle(10, -7, 3.4);
  } else {
    const back = st.recoil * 4;
    ctx.strokeStyle = jacket; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(15 - back, 3); ctx.moveTo(0, -9); ctx.lineTo(wt === 'PISTOL' ? 15 - back : 22 - back, wt === 'PISTOL' ? -2 : -3); ctx.stroke();
    ctx.save(); ctx.translate(8 - back, 0); drawWeaponSprite(wt); ctx.restore();
    ctx.fillStyle = skinC; circle(15 - back, 3, 3.4); circle(wt === 'PISTOL' ? 15 - back : 22 - back, wt === 'PISTOL' ? -2 : -3, 3.4);
  }
  drawBody(p.sk, jacket, false);
  drawHead(p.sk);
  ctx.restore();
}
function drawCorpse(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(2, 4, 18, 14, 0, 0, TAU); ctx.fill();
  drawBody(c.sk, c.mine ? '#10c6e8' : '#ff2e97', true);
  ctx.fillStyle = 'rgba(160,10,35,.85)'; circle(2, 0, 7); circle(-4, 5, 4);
  ctx.translate(-4, 0); drawHead(c.sk);
  ctx.fillStyle = 'rgba(160,10,35,.7)'; circle(1, 2, 5);
  ctx.restore();
}
function drawDoor(d, now) {
  const T = TILE;
  let hx, hy, a0, a1;
  if (d.o === 'h') { hx = d.x * T; hy = (d.y + 0.5) * T; a0 = 0; a1 = d.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { hx = (d.x + 0.5) * T; hy = d.y * T; a0 = Math.PI / 2; a1 = d.dir > 0 ? 0 : Math.PI; }
  let ang = a0;
  if (d.open) { const p = Math.min(1, (now - d.openAt) / 260), e = 1 - Math.pow(1 - p, 3); ang = a0 + (a1 - a0) * e; }
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  ctx.shadowColor = level.m.theme.b; ctx.shadowBlur = 10;
  ctx.fillStyle = '#2a1230'; ctx.fillRect(0, -3.5, T - 2, 7);
  ctx.strokeStyle = level.m.theme.b; ctx.lineWidth = 2; ctx.strokeRect(0, -3.5, T - 2, 7);
  ctx.restore();
}

function updateFx(dt) {
  const d = hitstop > 0 ? dt * 0.3 : dt; hitstop -= dt;
  for (const p of fx.parts) {
    p.life -= d; p.x += p.vx * d; p.y += p.vy * d;
    if (p.k === 'b') {
      const f = Math.pow(0.04, d); p.vx *= f; p.vy *= f;
      if (level && level.solidAt(p.x, p.y)) { p.x -= p.vx * d; p.y -= p.vy * d; p.vx = p.vy = 0; p.life = 0; }
      if (p.life <= 0) stamp(p.x, p.y, p.sz * 0.9);
    } else if (p.k === 'c') {
      const f = Math.pow(0.1, d); p.vx *= f; p.vy *= f; p.rot += p.vr * d; p.vr *= f;
      if (p.life <= 0 && dctx) { dctx.fillStyle = '#d8b04a'; dctx.fillRect(p.x - 1.5, p.y - 1, 3, 2); }
    }
  }
  fx.parts = fx.parts.filter(p => p.life > 0);
  for (const l of fx.lights) l.t -= d; fx.lights = fx.lights.filter(l => l.t > 0);
  for (const s of fx.slashes) s.t -= d; fx.slashes = fx.slashes.filter(s => s.t > 0);
  for (const c of fx.corpses) {
    if (Math.abs(c.vx) + Math.abs(c.vy) > 8) {
      c.x += c.vx * d; c.y += c.vy * d;
      if (level && level.solidAt(c.x, c.y)) { c.x -= c.vx * d; c.y -= c.vy * d; c.vx = c.vy = 0; }
      const f = Math.pow(0.03, d); c.vx *= f; c.vy *= f; stamp(c.x, c.y, 5, 0.5);
    }
  }
  fx.flash = Math.max(0, fx.flash - d * 2.4); fx.red = Math.max(0, fx.red - d * 0.9);
  zoomKick = Math.max(0, zoomKick - dt * 0.35); shake = Math.max(0, shake - dt * 42);
}

function drawVision() {
  const x = pred.x, y = pred.y, N = 300, R = 1100, vw = W / Z, vh = H / Z;
  ctx.beginPath(); ctx.rect(cam.x - vw / 2 - 60, cam.y - vh / 2 - 60, vw + 120, vh + 120);
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, d = level.ray(x, y, a, R), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = 'rgba(5,1,12,.82)'; ctx.fill('evenodd');
}

function drawIdle(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14041f'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,229,255,.08)'; ctx.lineWidth = 1; ctx.beginPath();
  const o = (now / 40) % 60;
  for (let x = -60 + o; x < W; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -60 + o; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

function render(now, dt) {
  if (!mode || !snap || !level || !levelCv) { drawIdle(now); updateHud(now); return; }
  updateFx(dt);
  const me = myState(), en = enemyState(), alive = !me || me.al;
  Z = S * (1 + zoomKick);
  // câmera
  const look = keys[' '] ? 0.85 : 0.33, maxL = keys[' '] ? 520 : 290;
  let ox = (mouse.x - W / 2) / Z * look, oy = (mouse.y - H / 2) / Z * look; const ol = Math.hypot(ox, oy);
  if (ol > maxL) { ox *= maxL / ol; oy *= maxL / ol; }
  const tx = pred.x + ox, ty = pred.y + oy;
  if (!camInit) { cam.x = tx; cam.y = ty; camInit = true; } else { const k = Math.min(1, dt * 9); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; }
  const sx = (Math.random() - .5) * shake, sy = (Math.random() - .5) * shake;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#07020d'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * (W / 2 - (cam.x + sx) * Z), dpr * (H / 2 - (cam.y + sy) * Z));
  ctx.drawImage(levelCv, 0, 0); ctx.drawImage(decal, 0, 0);
  for (const d of level.doors) drawDoor(d, now);
  for (const c of fx.corpses) drawCorpse(c);

  // itens no chão
  let near = null, nd = 46;
  for (const it of snap.it) {
    const [, x, y, type, , rot, thrown] = it;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.shadowColor = WEAPONS[type].col; ctx.shadowBlur = thrown ? 6 : 12; ctx.scale(1.15, 1.15); drawWeaponSprite(type); ctx.restore();
    if (!thrown && me && me.al) { const d = Math.hypot(x - pred.x, y - pred.y); if (d < nd) { nd = d; near = it; } }
  }
  if (near) {
    ctx.save(); ctx.font = '700 15px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ffe600';
    const t = `E · ${WEAPONS[near[3]].name}${near[4] ? ' (' + near[4] + ')' : ''}`; ctx.strokeText(t, near[1], near[2] - 24); ctx.fillText(t, near[1], near[2] - 24); ctx.restore();
  }
  // balas
  const age = Math.min(0.06, (now - snapAt) / 1000);
  ctx.lineCap = 'round';
  for (const b of snap.b) {
    const x = b[1] + b[3] * age, y = b[2] + b[4] * age, l = Math.hypot(b[3], b[4]) || 1, tl = Math.min(38, l * 0.03);
    ctx.strokeStyle = '#fff3a8'; ctx.lineWidth = 2.4; ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(x - b[3] / l * tl, y - b[4] / l * tl); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // jogadores
  let enemyVisible = false;
  if (en && en.al) {
    const ie = interpEnemy(en.id) || { x: en.x, y: en.y, a: en.a };
    enemyVisible = !alive || (Math.hypot(ie.x - pred.x, ie.y - pred.y) < 1100 && level.los(pred.x, pred.y, ie.x, ie.y));
    if (enemyVisible) drawPlayer(en, ie.x, ie.y, ie.a, false, now);
  }
  if (me && me.al) drawPlayer(me, pred.x, pred.y, aimAngle(), true, now);

  // efeitos
  for (const p of fx.parts) {
    if (p.k === 'b') { ctx.fillStyle = '#b3122f'; circle(p.x, p.y, p.sz); }
    else if (p.k === 's') { ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke(); }
    else if (p.k === 'c') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#ffd86b'; ctx.fillRect(-2, -1, 4, 2); ctx.restore(); }
  }
  for (const s of fx.slashes) {
    const wd = WEAPONS[s.w], k = 1 - s.t / 0.2; ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
    ctx.strokeStyle = wd.col; ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = 3; ctx.shadowColor = wd.col; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(0, 0, wd.range * 0.85, -wd.arc / 2 + k * wd.arc - 0.5, -wd.arc / 2 + k * wd.arc); ctx.stroke(); ctx.restore();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const l of fx.lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r); g.addColorStop(0, `rgba(${l.c},${Math.min(1, l.t * 9) * 0.6})`); g.addColorStop(1, `rgba(${l.c},0)`);
    ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (me && me.al) drawVision();

  // tela
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  if (fx.red > 0) { ctx.fillStyle = `rgba(255,20,60,${fx.red * 0.35})`; ctx.fillRect(0, 0, W, H); }
  if (!paused && me && me.al) drawCrosshair(me);
  updateHud(now);
}
function drawCrosshair(me) {
  const wt = me.w, wd = wt ? WEAPONS[wt] : null, empty = wd && !wd.melee && me.am <= 0;
  ctx.save(); ctx.translate(mouse.x, mouse.y); ctx.strokeStyle = empty ? '#ff2e97' : '#ffe600'; ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.moveTo(-15, 0); ctx.lineTo(-5, 0); ctx.moveTo(5, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, -5); ctx.moveTo(0, 5); ctx.lineTo(0, 15); ctx.stroke(); ctx.restore();
}

/* -------------------------------------------------------------------- HUD */
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
let bannerKey = '';
function updateHud(now) {
  if (!snap) return;
  const me = myState(), en = enemyState();
  if (me) { setText('s1n', me.nm); setText('s1v', String(me.sc)); }
  setText('s2n', en ? en.nm : '—'); setText('s2v', en ? String(en.sc) : '0');
  setText('rdTxt', snap.rd ? `Rodada ${snap.rd}` : 'Sala'); 
  setText('pingTxt', mode === 'online' ? `${pingMs} ms` : 'treino · offline');
  if (me) {
    const wd = me.w ? WEAPONS[me.w] : null;
    setText('wName', wd ? wd.name : 'Mãos');
    setText('wAmmo', wd && !wd.melee ? String(me.am) : '');
    $('wAmmo').classList.toggle('low', !!wd && !wd.melee && me.am <= 2);
    let hint = '';
    if (!me.al) hint = '';
    else if (wd && !wd.melee && me.am <= 0) hint = 'Vazia: arremesse com o botão direito';
    else if (wd) hint = 'Botão direito arremessa';
    else hint = 'Soco derruba; ataque no chão mata';
    setText('wHint', hint);
  }
  // banner
  let t = '', s = '', cls = '';
  const mySlot = me ? me.sl : 0;
  switch (snap.ph) {
    case 'waiting': t = 'Aguardando'; s = 'Esperando um adversário entrar na sala…'; break;
    case 'countdown': t = String(Math.max(1, Math.ceil(snap.tm))); s = `Rodada ${snap.rd} · ${MAPS[snap.map] ? MAPS[snap.map].name : ''}`; break;
    case 'live': if (now < goUntil) t = 'Vai!'; break;
    case 'over':
      if (snap.win === -1) { t = 'Empate'; s = 'Os dois caíram.'; }
      else if (snap.win === mySlot) { t = 'Rodada sua'; cls = 'win'; s = 'Prepare-se para a próxima.'; }
      else { t = 'Você morreu'; cls = 'lose'; s = 'Prepare-se para a próxima.'; }
      break;
    case 'matchover':
      if (snap.win === mySlot) { t = 'Vitória!'; cls = 'win'; } else { t = 'Derrota'; cls = 'lose'; }
      s = `${me ? me.sc : 0} a ${en ? en.sc : 0} · nova partida em instantes`; break;
  }
  const key = t + '|' + s + '|' + cls;
  const b = $('banner');
  if (key !== bannerKey) {
    bannerKey = key;
    if (!t) b.classList.add('hidden');
    else {
      b.classList.remove('hidden', 'win', 'lose'); if (cls) b.classList.add(cls);
      $('bTitle').textContent = t; $('bSub').textContent = s;
      const h = $('bTitle'); h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
      if (snap.ph === 'countdown') sfx('tick');
    }
  }
}

/* ------------------------------------------------------------------- LOOP */
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (mode && !paused) { acc += dt; let n = 0; while (acc >= STEP && n < 5) { doStep(); acc -= STEP; n++; } if (n >= 5) acc = 0; }
  render(now, paused ? 0 : dt);
}
requestAnimationFrame(frame);

// Esc: só pausa quando o menu inicial NÃO está aberto
addEventListener('keydown', e => {
  if (e.key === 'Escape' && mode && $('menu').classList.contains('hidden')) { e.preventDefault(); setPaused(!paused); }
}, true);
