'use strict';
/* ==========================================================================
   NEON DUEL — cliente
   Online 1v1 (servidor autoritativo + predição/reconciliação) ou treino vs bot
   (a mesma simulação roda localmente). Estilo Hotline Miami: um tiro = morte.
   ========================================================================== */
const { TILE, PR, WEAPONS, MAPS, Level, Game, Bot, stepMove, canMove, angDiff, DOWN_TIME, MAX_HP } = Shared;
const $ = id => document.getElementById(id);

// Mesma origem quando servido pelo Render (ou localhost); senão aponta para o Render.
const RENDER_HOST = 'hotline-m6gx.onrender.com';
const SAME_ORIGIN = location.protocol.startsWith('http') && (location.hostname === RENDER_HOST || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const SERVER_URL = SAME_ORIGIN ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : 'wss://' + RENDER_HOST;
// Acorda o servidor do Render (plano gratuito dorme) assim que a página abre.
if (!SAME_ORIGIN) { try { fetch('https://' + RENDER_HOST + '/health', { mode: 'no-cors' }); } catch { } }

const STEP = 1 / 60, TAU = Math.PI * 2;
const SKINS = {
  ROOSTER: { c: '#ffd23f', n: 'Galo' }, TIGER: { c: '#ff8a2b', n: 'Tigre' }, BEAR: { c: '#a9794f', n: 'Urso' },
  MONKEY: { c: '#b28cff', n: 'Macaco' }, WOLF: { c: '#9fb4c8', n: 'Lobo' }
};

/* --------------------------------------------------------------- CONFIG */
function loadCfg() { try { return JSON.parse(localStorage.getItem('neonduel') || '{}'); } catch { return {}; } }
const cfg = Object.assign({ name: '', skin: 'ROOSTER', diff: 'NORMAL', music: true, sfx: true, shake: true, crt: false }, loadCfg());
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
let anim = {}, levelCv = null, wallCv = null, decal = null, dctx = null;
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
/* ------------------------------------------------- CASA: pisos, paredes e móveis */
const PAL = {
  wood: ['#b57e48', '#ab7440'], carpet: ['#8b6a8c', '#836284'], tile: ['#d6e8ea', '#c4dadd'],
  ktile: ['#efe8d6', '#ddd4bb'], grass: ['#54964a', '#4e8d44'], deck: ['#c9a06a', '#bd945d'], path: ['#bdb7aa', '#b2ac9e']
};
const OUT = 'rgba(40,24,10,.7)';
function hash(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function rrect(c, x, y, w, h, r, fill, stroke, lw) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
function dot(c, x, y, r, fill, stroke, lw) {
  c.beginPath(); c.arc(x, y, r, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
}
function floorTile(c, kind, x, y, T) {
  const X = x * T, Y = y * T, pl = PAL[kind] || PAL.wood;
  c.fillStyle = pl[(x + y) & 1]; c.fillRect(X, Y, T, T);
  if (kind === 'wood') {
    for (let i = 0; i < 4; i++) {
      const py = Y + i * 12.5, r = hash(x, y * 4 + i);
      c.fillStyle = r < .5 ? `rgba(255,255,255,${.02 + r * .06})` : `rgba(0,0,0,${.02 + (r - .5) * .08})`; c.fillRect(X, py, T, 12.5);
      c.fillStyle = 'rgba(60,30,10,.35)'; c.fillRect(X, py + 11.5, T, 1);
      c.fillRect(X + r * (T - 2) + 1, py, 1, 11.5);
    }
  } else if (kind === 'tile' || kind === 'ktile') {
    c.fillStyle = pl[1]; c.fillRect(X, Y, T / 2, T / 2); c.fillRect(X + T / 2, Y + T / 2, T / 2, T / 2);
    c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(X, Y, T, 1.5); c.fillRect(X, Y, 1.5, T); c.fillRect(X + T / 2, Y, 1, T); c.fillRect(X, Y + T / 2, T, 1);
  } else if (kind === 'carpet') {
    for (let i = 0; i < 8; i++) { c.fillStyle = hash(x * 9 + i, y) < .5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)'; c.fillRect(X + hash(x, y * 9 + i) * (T - 3), Y + hash(x * 5 + i, y * 3) * (T - 3), 3, 3); }
  } else if (kind === 'grass') {
    c.lineWidth = 1.5; c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const px = X + 3 + hash(x * 7 + i, y) * (T - 6), py = Y + 6 + hash(x, y * 7 + i) * (T - 8);
      c.strokeStyle = i & 1 ? '#3f7d37' : '#6bb35a'; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 1, py - 4); c.stroke();
    }
    if (hash(x * 3, y * 5) > .93) { const fx = X + 8 + hash(x, y) * (T - 16), fy = Y + 8 + hash(y, x) * (T - 16); dot(c, fx, fy, 2.2, hash(x, y * 2) < .5 ? '#fff3a8' : '#ffb3d1'); }
    c.lineCap = 'butt';
  } else if (kind === 'deck') {
    for (let i = 0; i < 5; i++) { c.fillStyle = i & 1 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)'; c.fillRect(X + i * 10, Y, 10, T); c.fillStyle = 'rgba(60,30,10,.35)'; c.fillRect(X + i * 10 + 9, Y, 1, T); }
  } else if (kind === 'path') {
    for (let i = 0; i < 4; i++) rrect(c, X + (i & 1) * 25 + 2, Y + (i >> 1) * 25 + 2, 21, 21, 5, 'rgba(255,255,255,.12)', 'rgba(70,60,50,.3)', 1);
  }
}

const FURN = {
  bed(c, w, h) {
    rrect(c, 2, 2, w - 4, h - 4, 6, '#7a4a24', OUT);
    rrect(c, 7, 7, w - 14, h - 14, 5, '#f4efe6', OUT, 1);
    rrect(c, 7, h * .36, w - 14, h * .64 - 7, 5, '#3f6fb5', OUT, 1);
    c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 2; c.beginPath(); c.moveTo(12, h * .36 + 10); c.lineTo(w - 12, h * .36 + 10); c.stroke();
    const pw = (w - 26) / 2; rrect(c, 10, 10, pw, 20, 6, '#fff', OUT, 1); rrect(c, 14 + pw, 10, pw, 20, 6, '#fff', OUT, 1);
  },
  nightstand(c, w, h) { rrect(c, 4, 4, w - 8, h - 8, 3, '#8a5a30', OUT); dot(c, w / 2, h / 2, 10, '#f5d36b', OUT, 1); dot(c, w / 2, h / 2, 4, '#fff6c4'); },
  wardrobe(c, w, h) {
    rrect(c, 2, 3, w - 4, h - 6, 3, '#6b4423', OUT); rrect(c, 5, 6, w - 10, h - 12, 2, 'rgba(255,255,255,.07)');
    const n = Math.round(w / 50); c.strokeStyle = OUT; c.lineWidth = 1.5;
    for (let i = 1; i < n; i++) { c.beginPath(); c.moveTo(i * w / n, 4); c.lineTo(i * w / n, h - 4); c.stroke(); }
    for (let i = 0; i < n; i++) { c.fillStyle = '#e0c070'; c.fillRect((i + .5) * w / n - 6, h - 12, 3, 5); c.fillRect((i + .5) * w / n + 3, h - 12, 3, 5); }
  },
  desk(c, w, h) {
    rrect(c, 2, 5, w - 4, h - 10, 3, '#a5703a', OUT);
    rrect(c, w * .14, 10, 36, 24, 2, '#2b2f3a', OUT, 1); rrect(c, w * .14 + 3, 13, 30, 14, 1, '#6bd7ff');
    dot(c, w * .72, h / 2, 6.5, '#fff', OUT, 1); dot(c, w * .72, h / 2, 4, '#7a4a24');
  },
  sofa(c, w, h) {
    rrect(c, 1, 2, w - 2, h - 4, 7, '#8f3d4a', OUT);
    rrect(c, 4, 4, w - 8, 14, 5, '#a64a58', OUT, 1);
    const n = Math.max(1, Math.round(w / 50)), cw = (w - 22) / n;
    for (let i = 0; i < n; i++) rrect(c, 11 + i * cw, 20, cw - 3, h - 26, 4, '#b95b6a', OUT, 1);
    rrect(c, 1, 2, 9, h - 4, 5, '#7d3340', OUT, 1); rrect(c, w - 10, 2, 9, h - 4, 5, '#7d3340', OUT, 1);
  },
  dining(c, w, h) {
    for (const [x, y, cw, ch] of [[w / 2 - 12, 1, 24, 9], [w / 2 - 12, h - 10, 24, 9], [1, h / 2 - 12, 9, 24], [w - 10, h / 2 - 12, 9, 24]]) rrect(c, x, y, cw, ch, 3, '#9a6a3a', OUT, 1);
    rrect(c, 10, 10, w - 20, h - 20, 7, '#c9905a', OUT);
    for (const [x, y] of [[.3, .3], [.7, .3], [.3, .7], [.7, .7]]) { dot(c, w * x, h * y, 9, '#f7f7f7', OUT, 1); dot(c, w * x, h * y, 5, '#e1e1e1'); }
    dot(c, w / 2, h / 2, 6, '#4aa36a'); dot(c, w / 2, h / 2, 3, '#ff6aa2');
  },
  coffee(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 8, '#5e4026', OUT);
    rrect(c, 9, 9, w - 18, h - 18, 5, 'rgba(165,228,242,.8)', 'rgba(255,255,255,.7)', 1.5);
    rrect(c, 17, 19, 24, 16, 2, '#d05050', OUT, 1); dot(c, w - 28, h - 26, 6.5, '#fff', OUT, 1); dot(c, w - 28, h - 26, 3.5, '#6b3b1a');
  },
  counter(c, w, h) {
    rrect(c, 0, 2, w, h - 4, 2, '#5c4a3a', OUT);
    rrect(c, 2, 4, w - 4, h - 14, 2, '#dcd9d2', OUT, 1);
    c.fillStyle = '#7a5f48'; c.fillRect(2, h - 9, w - 4, 5);
    for (let i = 0; i < Math.round(w / 50); i++) {
      const cx = i * 50 + 25, k = i % 3;
      if (k === 0) for (const [dx, dy] of [[-9, -2], [9, -2], [-9, 14], [9, 14]]) { dot(c, cx + dx, 12 + dy / 1.8, 5, '#2a2a2a', '#555', 1); }
      else if (k === 1) { rrect(c, cx - 17, 9, 34, 22, 4, '#aab7c4', OUT, 1); dot(c, cx, 22, 3.5, '#7e8a96'); c.fillStyle = '#8c98a4'; c.fillRect(cx - 2, 5, 4, 6); }
      else rrect(c, cx - 13, 11, 26, 18, 2, '#d9a066', OUT, 1);
    }
  },
  fridge(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 5, '#e8eef2', OUT); c.strokeStyle = OUT; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(5, h * .6); c.lineTo(w - 5, h * .6); c.stroke();
    rrect(c, w - 12, h * .6 + 4, 4, 12, 2, '#8c98a4'); rrect(c, w - 12, h * .6 - 16, 4, 12, 2, '#8c98a4');
  },
  tv(c, w, h) {
    rrect(c, 1, 4, w - 2, h - 8, 3, '#3a2b20', OUT);
    rrect(c, w * .1, h / 2 - 6, w * .8, 12, 2, '#101218', OUT, 1); rrect(c, w * .1 + 3, h / 2 - 3, w * .8 - 6, 6, 1, '#2a8aa8');
    dot(c, 10, h - 11, 3, '#9aa5ad'); dot(c, w - 10, h - 11, 3, '#9aa5ad');
  },
  bookshelf(c, w, h) {
    rrect(c, 2, 2, w - 4, h - 4, 3, '#6b4423', OUT); rrect(c, 6, 6, w - 12, h - 12, 2, '#3d2814');
    const cols = ['#e05a5a', '#e8c14a', '#4a9fd8', '#6cc070', '#b46cd8', '#f0f0f0'], horiz = w >= h, L = horiz ? w - 16 : h - 16, n = Math.floor(L / 7);
    for (let i = 0; i < n; i++) { c.fillStyle = cols[i % cols.length]; if (horiz) c.fillRect(8 + i * 7, 8, 5, h - 16); else c.fillRect(8, 8 + i * 7, w - 16, 5); }
  },
  plant(c, w, h) {
    dot(c, w / 2, h / 2, 17, '#9a5a30', OUT, 1.5); dot(c, w / 2, h / 2, 13, '#4a2c18');
    for (let i = 0; i < 9; i++) { c.save(); c.translate(w / 2, h / 2); c.rotate(i * TAU / 9); c.fillStyle = i & 1 ? '#2f9a4a' : '#3fb85c'; c.beginPath(); c.ellipse(11, 0, 11, 5, 0, 0, TAU); c.fill(); c.restore(); }
    dot(c, w / 2, h / 2, 4, '#5ad47a');
  },
  tub(c, w, h) {
    rrect(c, 2, 3, w - 4, h - 6, 12, '#f4f7f8', OUT); rrect(c, 8, 8, w - 16, h - 16, 10, '#bfe6f2', 'rgba(60,120,140,.6)', 1.5);
    dot(c, 16, h / 2, 4, '#9aa5ad'); dot(c, w * .55, h * .4, 3, 'rgba(255,255,255,.8)'); dot(c, w * .65, h * .6, 2, 'rgba(255,255,255,.8)');
  },
  toilet(c, w, h) {
    rrect(c, 10, 3, w - 20, 12, 3, '#f4f7f8', OUT);
    c.beginPath(); c.ellipse(w / 2, h * .64, 14, 16, 0, 0, TAU); c.fillStyle = '#f4f7f8'; c.fill(); c.strokeStyle = OUT; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.ellipse(w / 2, h * .66, 8.5, 10.5, 0, 0, TAU); c.fillStyle = '#d4ebf3'; c.fill();
  },
  sink(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 5, '#e8eef2', OUT);
    c.beginPath(); c.ellipse(w / 2, h / 2 + 3, 14, 12, 0, 0, TAU); c.fillStyle = '#cfe3ea'; c.fill(); c.strokeStyle = OUT; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = '#9aa5ad'; c.fillRect(w / 2 - 2, 6, 4, 8); dot(c, w / 2, h / 2 + 3, 2, '#7e8a96');
  },
  washer(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 5, '#eef1f4', OUT); rrect(c, 6, 6, w - 12, 8, 2, '#cfd6dc'); dot(c, w - 12, 10, 2.5, '#4a9fd8');
    dot(c, w / 2, h / 2 + 7, 14, '#8fb3c8', OUT, 1.5); dot(c, w / 2, h / 2 + 7, 9, '#6e95ad'); dot(c, w / 2 - 3, h / 2 + 4, 3, 'rgba(255,255,255,.6)');
  },
  shelf(c, w, h) {
    rrect(c, 2, 5, w - 4, h - 10, 3, '#9a6a3a', OUT);
    const cs = ['#6fb8b4', '#f2f2f2', '#e89ab8', '#f5d36b'], n = Math.round(w / 25);
    for (let i = 0; i < n; i++) rrect(c, 7 + i * (w - 14) / n, 10, (w - 14) / n - 3, h - 20, 2, cs[i % 4], OUT, 1);
  },
  bench(c, w, h) {
    rrect(c, 3, 8, w - 6, h - 16, 3, '#b98550', OUT); c.strokeStyle = 'rgba(60,30,10,.45)'; c.lineWidth = 1;
    for (let x = 14; x < w - 6; x += 12) { c.beginPath(); c.moveTo(x, 9); c.lineTo(x, h - 9); c.stroke(); }
  },
  pool(c, w, h) {
    rrect(c, 0, 0, w, h, 6, '#ece6d6', OUT, 2); rrect(c, 6, 6, w - 12, h - 12, 4, '#27b8e0', '#118aa8', 2);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2;
    for (let k = 0; k < 3; k++) { const y = 18 + k * (h - 36) / 2; c.beginPath(); c.moveTo(14, y); for (let x = 14; x <= w - 14; x += 6) c.lineTo(x, y + Math.sin(x / 9 + k * 2) * 3); c.stroke(); }
    dot(c, w - 28, h - 26, 9, null, '#ff5a5a', 4); dot(c, w - 28, h - 26, 9, null, '#fff', 1.5);
  },
  tree(c, w, h) {
    const R = Math.min(w, h) / 2 - 2; dot(c, w / 2, h / 2, R, '#2b7733', OUT, 2);
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; dot(c, w / 2 + Math.cos(a) * R * .55, h / 2 + Math.sin(a) * R * .55, R * .48, i & 1 ? '#37913f' : '#2f8338'); }
    dot(c, w / 2 - R * .2, h / 2 - R * .2, R * .35, '#4fb054'); dot(c, w / 2 + R * .15, h / 2 + R * .1, 4, '#e0453a'); dot(c, w / 2 - R * .35, h / 2 + R * .3, 4, '#e0453a');
  },
  hedge(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 12, '#2f7a2e', OUT);
    const n = Math.round(Math.max(w, h) / 16);
    for (let i = 0; i < n; i++) { const t = (i + .5) / n; dot(c, w > h ? t * w : w / 2, w > h ? h / 2 : t * h, 9, i & 1 ? '#3b8f3a' : '#43a043'); }
  },
  bbq(c, w, h) {
    rrect(c, 8, 28, w - 16, 16, 3, '#2a2d33', OUT, 1); dot(c, w / 2, h / 2 - 4, 17, '#2a2d33', OUT, 1.5); dot(c, w / 2, h / 2 - 4, 13, '#4a4f58');
    c.strokeStyle = '#8a8f98'; c.lineWidth = 1.2; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(w / 2 - 11, h / 2 - 4 + i * 4); c.lineTo(w / 2 + 11, h / 2 - 4 + i * 4); c.stroke(); }
    dot(c, w / 2, h / 2 - 4, 4, 'rgba(255,122,43,.8)');
  },
  box(c, w, h) { rrect(c, 3, 3, w - 6, h - 6, 4, '#8a6a4a', OUT); }
};
function drawFurn(c, f, T) {
  const w = f.w * T, h = f.h * T;
  c.save(); c.translate((f.x + f.w / 2) * T, (f.y + f.h / 2) * T);
  if (f.r) c.rotate(Math.PI);
  c.translate(-w / 2, -h / 2); (FURN[f.k] || FURN.box)(c, w, h); c.restore();
}
function drawRug(c, r, T) {
  const x = r.x * T + 4, y = r.y * T + 4, w = r.w * T - 8, h = r.h * T - 8;
  rrect(c, x, y, w, h, 8, r.col, OUT, 1.5);
  rrect(c, x + 6, y + 6, w - 12, h - 12, 5, null, 'rgba(255,255,255,.6)', 2.5);
  rrect(c, x + 13, y + 13, w - 26, h - 26, 3, null, 'rgba(0,0,0,.18)', 2);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5;
  for (let i = 0; i < w; i += 7) { c.beginPath(); c.moveTo(x + i, y - 3); c.lineTo(x + i, y); c.moveTo(x + i, y + h); c.lineTo(x + i, y + h + 3); c.stroke(); }
}

function buildStatic() {
  const m = level.m, th = m.theme, T = TILE, g = m.g, W = level.W, H = level.H;
  levelCv = document.createElement('canvas'); levelCv.width = W * T; levelCv.height = H * T;
  const c = levelCv.getContext('2d');
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || g[y][x] === 1;
  const border = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1;
  // pisos
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] === 1) continue;
    floorTile(c, g[y][x] === 2 ? 'wood' : m.fl[y][x], x, y, T);
    if (g[y][x] === 2) { c.fillStyle = '#6e4a28'; c.fillRect(x * T, y * T, T, T); c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(x * T + 4, y * T + 4, T - 8, T - 8); }
  }
  for (const r of m.rugs) drawRug(c, r, T);
  // paredes (sem brilho nem sombra): camada própria, desenhada por cima da névoa
  wallCv = document.createElement('canvas'); wallCv.width = W * T; wallCv.height = H * T;
  const wc = wallCv.getContext('2d');
  wc.lineCap = 'square';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === 1) {
    const X = x * T, Y = y * T, hedge = th.hedge && border(x, y);
    wc.fillStyle = hedge ? '#2f6b2a' : th.wall; wc.fillRect(X, Y, T, T);
    if (hedge) for (let i = 0; i < 4; i++) dot(wc, X + 8 + hash(x * 4 + i, y) * (T - 16), Y + 8 + hash(x, y * 4 + i) * (T - 16), 9, i & 1 ? '#3d8a36' : '#357c30');
    const ex = [];
    if (!wall(x, y - 1)) ex.push([X, Y + 1.5, X + T, Y + 1.5, 0, 3]);
    if (!wall(x, y + 1)) ex.push([X, Y + T - 1.5, X + T, Y + T - 1.5, 0, -3]);
    if (!wall(x - 1, y)) ex.push([X + 1.5, Y, X + 1.5, Y + T, 3, 0]);
    if (!wall(x + 1, y)) ex.push([X + T - 1.5, Y, X + T - 1.5, Y + T, -3, 0]);
    for (const [x1, y1, x2, y2, ox, oy] of ex) {
      wc.strokeStyle = hedge ? '#1d4d1c' : th.edge; wc.lineWidth = 3; wc.beginPath(); wc.moveTo(x1, y1); wc.lineTo(x2, y2); wc.stroke();
      if (!hedge) { wc.strokeStyle = th.wallTop; wc.lineWidth = 2; wc.beginPath(); wc.moveTo(x1 + ox * 1.6, y1 + oy * 1.6); wc.lineTo(x2 + ox * 1.6, y2 + oy * 1.6); wc.stroke(); }
    }
  }
  wc.lineCap = 'butt';
  // móveis
  for (const f of m.furn) drawFurn(c, f, T);
  decal = document.createElement('canvas'); decal.width = W * T; decal.height = H * T; dctx = decal.getContext('2d');
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
    case 'hurt': // levou dano (sem morrer)
      sfx('hit', e.x, e.y); addBlood(e.x, e.y, e.a, 10, 220);
      addShake(e.id === myId ? 4 : 1.5); if (e.id === myId) fx.red = Math.max(fx.red, 0.25);
      break;
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
  ctx.fillStyle = '#8b5a2b'; ctx.fillRect(0, -3.5, T - 2, 7);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(2, -2, T - 8, 2);
  ctx.strokeStyle = '#4a2e14'; ctx.lineWidth = 1.5; ctx.strokeRect(0, -3.5, T - 2, 7);
  ctx.fillStyle = '#f3d27a'; ctx.beginPath(); ctx.arc(T - 9, 0, 2, 0, TAU); ctx.fill();
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

const FOG = 'rgba(8,6,16,.42)'; // escuridão fora da linha de visão (0 = sem névoa)
function drawVision() {
  const x = pred.x, y = pred.y, N = 300, R = 1100, vw = W / Z, vh = H / Z;
  ctx.beginPath(); ctx.rect(cam.x - vw / 2 - 60, cam.y - vh / 2 - 60, vw + 120, vh + 120);
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, d = level.ray(x, y, a, R), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = FOG; ctx.fill('evenodd');
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

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = level.m.theme.out; ctx.fillRect(0, 0, W, H);
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
    if (enemyVisible) { drawPlayer(en, ie.x, ie.y, ie.a, false, now); drawHpBar(ie.x, ie.y, en.hp ?? MAX_HP, false); }
  }
  if (me && me.al) { drawPlayer(me, pred.x, pred.y, aimAngle(), true, now); drawHpBar(pred.x, pred.y, me.hp ?? MAX_HP, true); }

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
  ctx.drawImage(wallCv, 0, 0);

  // tela
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  if (fx.red > 0) { ctx.fillStyle = `rgba(255,20,60,${fx.red * 0.35})`; ctx.fillRect(0, 0, W, H); }
  if (!paused && me && me.al) drawCrosshair(me);
  updateHud(now);
}
function drawHpBar(x, y, hp, mine) {
  const k = Math.max(0, Math.min(1, hp / MAX_HP)), w = 44;
  ctx.fillStyle = 'rgba(10,0,20,.85)'; ctx.fillRect(x - w / 2 - 1.5, y - 37, w + 3, 8);
  ctx.fillStyle = k > 0.3 ? (mine ? '#00e5ff' : '#ff2e97') : '#ffe600'; ctx.fillRect(x - w / 2, y - 35.5, w * k, 5);
}
function drawCrosshair(me) {
  const wt = me.w, wd = wt ? WEAPONS[wt] : null, empty = wd && !wd.melee && me.am <= 0;
  ctx.save(); ctx.translate(mouse.x, mouse.y); ctx.strokeStyle = empty ? '#ff2e97' : '#ffe600'; ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.moveTo(-15, 0); ctx.lineTo(-5, 0); ctx.moveTo(5, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, -5); ctx.moveTo(0, 5); ctx.lineTo(0, 15); ctx.stroke(); ctx.restore();
}

/* -------------------------------------------------------------------- HUD */
const hudCache = {};
function setHp(id, hp) {
  const p = Math.max(0, Math.round((hp ?? MAX_HP) / MAX_HP * 100));
  setText(id + 't', p + '%');
  if (hudCache[id + 'w'] !== p) { hudCache[id + 'w'] = p; $(id).style.width = p + '%'; $(id).parentNode.classList.toggle('low', p <= 30); }
}
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
let bannerKey = '';
function updateHud(now) {
  if (!snap) return;
  const me = myState(), en = enemyState();
  if (me) { setText('s1n', me.nm); setText('s1v', String(me.sc)); }
  setText('s2n', en ? en.nm : '—'); setText('s2v', en ? String(en.sc) : '0');
  setHp('hp1', me ? me.hp : MAX_HP); setHp('hp2', en ? en.hp : MAX_HP);
  setText('rdTxt', snap.rd ? `Rodada ${snap.rd}` : 'Sala'); 
  setText('pingTxt', mode === 'online' ? `${pingMs} ms` : 'treino · offline');
  if (me) {
    const wd = me.w ? WEAPONS[me.w] : null;
    setText('wName', (wd ? wd.name : 'Mãos') + ' · ' + (wd ? wd.dmg : WEAPONS.FISTS.dmg) + '%' + (wd && wd.pellets > 1 ? ' x' + wd.pellets : ''));
    setText('wAmmo', wd && !wd.melee ? String(me.am) : '');
    $('wAmmo').classList.toggle('low', !!wd && !wd.melee && me.am <= 2);
    let hint = '';
    if (!me.al) hint = '';
    else if (wd && !wd.melee && me.am <= 0) hint = 'Vazia: arremesse com o botão direito';
    else if (wd) hint = 'Botão direito arremessa';
    else hint = 'Soco derruba; golpe no chão dá dano extra';
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
