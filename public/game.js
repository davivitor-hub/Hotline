'use strict';
/* ==========================================================================
   7 SHADOWS — cliente
   Online 1v1 (servidor autoritativo + predição/reconciliação) ou treino vs bot
   (a mesma simulação roda localmente). Estilo Hotline Miami: um tiro = morte.
   ========================================================================== */
const { TILE, PR, CS, WEAPONS, MAPS, Level, Game, Bot, stepMove, stepMotion, SLIDE_TIME, SLIDE_CD, ITEM_EXT, canMove, angDiff, DOWN_TIME, MAX_HP, HEAL_PCT, HEAL_TIME, HEAL_SLOW, MAX_PLAYERS, MIN_PLAYERS, randomColor, SPEAR_THROW_MIN, SPEAR_THROW_MAX, itemDist, PICK_R, DOOR_HT } = Shared;
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
  MONKEY: { c: '#b28cff', n: 'Macaco' }, WOLF: { c: '#9fb4c8', n: 'Lobo' },
  DRAGON: { c: '#ffcf3a', n: 'Dragão Dourado', secret: true }
};

/* --------------------------------------------------------------- CONFIG */
function loadCfg() { try { return JSON.parse(localStorage.getItem('7shadows') || localStorage.getItem('neonduel') || '{}'); } catch { return {}; } }
const cfg = Object.assign({ name: '', skin: 'ROOSTER', secret: false, diff: 'NORMAL', music: true, track: 'hidrogenio', vol: 0.6, sfx: true, shake: true, crt: false }, loadCfg());
function saveCfg() { try { localStorage.setItem('7shadows', JSON.stringify(cfg)); } catch { } }
if (!SKINS[cfg.skin] || (SKINS[cfg.skin].secret && !cfg.secret)) cfg.skin = 'ROOSTER';

/* ---------------------------------------------------------------- ESTADO */
const cv = $('game'); let ctx = cv.getContext('2d', { alpha: false });   // let: os ícones do inventário desenham as armas num canvas temporário
let dpr = 1, S = 1, Z = 1, W = innerWidth, H = innerHeight;
let mode = null, ws = null, myId = null, local = null, paused = false, pingMs = 0, pingTimer = null;
let level = null, mapId, round = -1, snap = null, snapAt = 0, buf = [], pending = [], seq = 0, first = true;
let pred = { x: 0, y: 0 }, cam = { x: 0, y: 0 }, camInit = false, pslide = { t: 0, a: 0, cd: 0 };   // pslide = estado previsto da rasteira (Shift)
let keys = {}, mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, right: false }, edge = { fp: false, pk: false, th: false, hl: false, sw: false, ss: 0, sl: false };
let shake = 0, zoomKick = 0, hitstop = 0, goUntil = 0;
let fx = { parts: [], lights: [], slashes: [], corpses: [], pops: [], flash: 0, red: 0 };
// predição dos MEUS tiros (online): o tiro aparece na hora do clique; quando o do servidor chega, ele é escondido para não duplicar
let pbul = [], pshots = [], hiddenB = new Set(), knownB = new Set(), gotShot = 0, pcd = 0, pbuf = 0;
let anim = {}, levelCv = null, wallCv = null, decal = null, dctx = null, roofCv = null, roofA = [];   // roofA = opacidade atual de cada teto (1 = fechado, 0 = você está dentro)
const INTERP = () => (mode === 'local' ? 34 : 50);   // online: snapshots a 60 Hz → ~3 amostras de buffer

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight;
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
    musG = ac.createGain(); musG.gain.value = 0; musG.connect(master);
    sfxG = ac.createGain(); sfxG.gain.value = 0.55; sfxG.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextT = ac.currentTime + 0.1; setInterval(schedule, 50); applyMusic();
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

/* Garante a aba "Músicas" mesmo se o index.html/style.css forem de uma versão antiga */
(function ensureMusicUI() {
  if ($('tabMusic') && $('tabBtnMusic') && $('trackList') && $('volRange') && $('nowPlaying')) return;
  const panel = document.querySelector('#menu .panel'); if (!panel) return;
  if (!document.getElementById('musicCss')) { const st = document.createElement('style'); st.id = 'musicCss'; st.textContent = "/* abas do menu */\n.tabs{display:flex;gap:0;margin:0 0 18px;border-bottom:3px solid var(--violet)}\n.tab{flex:1;padding:10px 12px;font:400 1rem var(--display);letter-spacing:.5px;color:#c9b3e0;background:transparent;border:0;border-bottom:5px solid transparent;margin-bottom:-3px;cursor:pointer}\n.tab:hover{color:var(--cyan)}\n.tab[aria-selected=\"true\"]{color:var(--yellow);border-bottom-color:var(--pink);background:rgba(255,46,151,.12)}\n.mtip{margin:0 0 12px;color:#ffd1ea;font-weight:600}\n.mtip.small{margin:14px 0 0;font-size:.9rem;color:#c9b3e0}\n#trackList{display:grid;gap:8px}\n.track{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;text-align:left;color:var(--white);background:#0b0214;border:2px solid var(--violet);cursor:pointer;font:inherit}\n.track:hover{border-color:var(--cyan)}\n.track[aria-pressed=\"true\"]{border-color:var(--yellow);background:#2b0a44;box-shadow:4px 4px 0 var(--pink)}\n.track .ic{flex:none;display:grid;place-items:center;width:34px;height:34px;border:2px solid var(--cyan);color:var(--cyan);font:400 .9rem var(--display)}\n.track[aria-pressed=\"true\"] .ic{background:var(--yellow);border-color:var(--yellow);color:var(--ink)}\n.track .tx{flex:1;min-width:0;display:grid}\n.track b{font:400 1.05rem var(--display);color:var(--cyan);letter-spacing:.3px}\n.track[aria-pressed=\"true\"] b{color:var(--yellow)}\n.track small{color:#c9b3e0;font-weight:600;font-size:.9rem}\n.vol{display:flex;align-items:center;gap:12px;margin-top:14px;font-weight:700;color:var(--cyan)}\n.vol input{flex:1;accent-color:var(--pink)}\n#nowPlaying{position:absolute;right:16px;bottom:18px;padding:6px 14px;background:rgba(20,4,31,.85);border:3px solid var(--cyan);box-shadow:-4px 4px 0 var(--pink);font:400 .85rem var(--display);color:var(--cyan)}\n#nowPlaying span{color:var(--yellow)}\n\n@media (max-width:640px){#nowPlaying{right:8px;bottom:8px;font-size:.7rem}}\n"; document.head.appendChild(st); }
  if (!$('tabPlay')) {
    const kids = Array.from(panel.children).filter(el => el.tagName !== 'H1' && !el.classList.contains('tag'));
    const wrap = document.createElement('div'); wrap.id = 'tabPlay'; wrap.setAttribute('role', 'tabpanel');
    const tag = panel.querySelector('.tag'); (tag ? tag.after(wrap) : panel.appendChild(wrap));
    for (const el of kids) wrap.appendChild(el);
    const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = '<button id="tabBtnPlay" class="tab" role="tab" aria-selected="true" type="button">Jogar</button><button id="tabBtnMusic" class="tab" role="tab" aria-selected="false" type="button">Músicas</button>';
    wrap.before(tabs);
  }
  if (!$('tabMusic')) {
    const m = document.createElement('div'); m.id = 'tabMusic'; m.setAttribute('role', 'tabpanel'); m.className = 'hidden';
    m.innerHTML = '<p class="mtip">Escolha a trilha da partida. Toque numa faixa para ouvir.</p><div id="trackList"></div><label class="vol">Volume <input type="range" id="volRange" min="0" max="100" step="1"></label><p class="mtip small">Durante a partida, aperte <kbd>N</kbd> para trocar de faixa e <kbd>M</kbd> para mutar.</p>';
    $('tabPlay').after(m);
  }
  if (!$('nowPlaying')) { const n = document.createElement('div'); n.id = 'nowPlaying'; n.className = 'hidden'; const hud = $('hud'); if (hud) hud.appendChild(n); }
})();

/* ------------------------------------------------------------ TRILHAS
   Todos os nomes giram em torno da AURA. 'file: null' = sintetizador original do jogo. */
const TRACKS = [
  { id: 'hidrogenio', name: 'Aura de Hidrogênio', sub: 'Eletrônica pesada e acelerada', file: ['music/aura-hidrogenio.mp3', 'aura-hidrogenio.mp3', 'M_O_O_N__-__Hydrogen___Hotline_Miami_Soundtrack__MP3_160K_.mp3', 'music/M_O_O_N__-__Hydrogen___Hotline_Miami_Soundtrack__MP3_160K_.mp3'] },
  { id: 'tribunal',   name: 'Aura do Tribunal',   sub: 'Tensão de quem vai ser julgado', file: ['music/aura-tribunal.mp3', 'aura-tribunal.mp3', 'Apollo_Justice__Ace_Attorney__Soundtrack_-_Trial_MP3_160K_.mp3', 'music/Apollo_Justice__Ace_Attorney__Soundtrack_-_Trial_MP3_160K_.mp3'] },
  { id: 'sombria',    name: 'Aura Sombria',       sub: 'Escura, fria e silenciosa', file: ['music/aura-sombria.mp3', 'aura-sombria.mp3', 'Apollo_Justice__Ace_Attorney__Soundtrack_-_Solitary_Confinement___Darkness_Theme_MP3_160K_.mp3', 'music/Apollo_Justice__Ace_Attorney__Soundtrack_-_Solitary_Confinement___Darkness_Theme_MP3_160K_.mp3'] },
  { id: 'chorona',    name: 'Aura Chorona',       sub: 'Rock pesado de quem chora e luta', file: ['music/aura-chorona.mp3', 'aura-chorona.mp3', 'Devil_May_Cry_3_-_Devils_Never_Cry_MP3_160K_.mp3', 'music/Devil_May_Cry_3_-_Devils_Never_Cry_MP3_160K_.mp3'] }
];
if (!TRACKS.some(t => t.id === cfg.track)) cfg.track = TRACKS[0].id;
if (!(cfg.vol >= 0 && cfg.vol <= 1)) cfg.vol = 0.6;
const curTrack = () => TRACKS.find(t => t.id === cfg.track) || TRACKS[0];
const bgm = new Audio(); bgm.loop = false; bgm.preload = 'none';   // sem loop: quando acaba, começa a próxima faixa
let bgmLoaded = null, musicOn = false, bgmTry = 0;
// se o arquivo não for achado, tenta o próximo caminho possível (pasta music/, raiz, nome original)
bgm.addEventListener('error', () => {
  const t = curTrack(); if (!t.file || bgmLoaded !== t.id) return;
  if (++bgmTry < t.file.length) { bgm.src = t.file[bgmTry]; if (musicOn) { const pr = bgm.play(); if (pr && pr.catch) pr.catch(() => { }); } }
  else { bgmLoaded = null; $('nowPlaying').innerHTML = '⚠ arquivo de música não encontrado'; $('nowPlaying').classList.remove('hidden'); status('Música não encontrada: ' + t.file[0]); }
});
function applyMusic() {
  const t = curTrack();
  bgm.volume = cfg.music ? cfg.vol : 0;
  if (musG) musG.gain.value = (cfg.music && musicOn && !t.file) ? 0.17 * cfg.vol / 0.6 : 0;
}
function playTrack() {
  const t = curTrack(); musicOn = true;
  if (t.file) {
    if (bgmLoaded !== t.id) { bgmTry = 0; bgm.src = t.file[0]; bgmLoaded = t.id; }
    const pr = bgm.play(); if (pr && pr.catch) pr.catch(() => { });
  } else bgm.pause();
  applyMusic(); refreshTracks();
}
// acabou a faixa: toca a próxima que tem arquivo (o synth original é infinito, então fica de fora do revezamento)
bgm.addEventListener('ended', () => {
  if (!musicOn) return;
  const files = TRACKS.filter(t => t.file), i = files.findIndex(t => t.id === cfg.track);
  const nx = files[(i + 1) % files.length];
  if (nx.id === cfg.track) { bgm.currentTime = 0; const pr = bgm.play(); if (pr && pr.catch) pr.catch(() => { }); return; }
  cfg.track = nx.id; saveCfg(); playTrack();
});
function stopTrack() { musicOn = false; bgm.pause(); applyMusic(); refreshTracks(); }
function pickTrack(id) {
  cfg.track = id; saveCfg();
  if (!cfg.music) { cfg.music = true; $('optMusic').checked = true; }
  initAudio(); playTrack();
}
function nextTrack() {
  const i = TRACKS.findIndex(t => t.id === cfg.track);
  cfg.track = TRACKS[(i + 1) % TRACKS.length].id; saveCfg(); playTrack();
}
function refreshTracks() {
  for (const b of $('trackList').children) {
    const on = b.dataset.id === cfg.track;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.querySelector('.ic').textContent = on && musicOn && cfg.music ? '❚❚' : '▶';
  }
  const np = $('nowPlaying');
  np.innerHTML = '♪ <span>' + curTrack().name + '</span>';
  np.classList.toggle('hidden', !(mode && musicOn && cfg.music));
}
// voz de dano: toca uma vez por vez (sem loop); não reinicia enquanto ainda está tocando
const hurtSnd = new Audio('voice-mx-damage-m-1.mp3');
hurtSnd.preload = 'auto'; hurtSnd.loop = false; hurtSnd.volume = 0.9;
function playHurt() {
  if (!cfg.sfx) return;
  if (!hurtSnd.paused && !hurtSnd.ended) return;
  try { hurtSnd.currentTime = 0; const pr = hurtSnd.play(); if (pr && pr.catch) pr.catch(() => { }); } catch { }
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
    case 'REVOLVER': nz(d, t, 0.2, 1 * v, 'bandpass', 1200); osc(d, 'square', 150, t, 0.16, 0.55 * v, 45); break;
    case 'SNIPER': nz(d, t, 0.5, 1.3 * v, 'lowpass', 2400); osc(d, 'sawtooth', 90, t, 0.45, 0.7 * v, 24); osc(d, 'square', 1400, t, 0.05, 0.4 * v, 300); break;
    case 'MINIGUN': nz(d, t, 0.05, 0.7 * v, 'bandpass', 2000); osc(d, 'square', 140, t, 0.05, 0.3 * v, 70); break;
    case 'SHOTGUN': nz(d, t, 0.32, 1.2 * v, 'lowpass', 1400); osc(d, 'sawtooth', 110, t, 0.28, 0.6 * v, 32); break;
    case 'swing': nz(d, t, 0.13, 0.35 * v, 'highpass', 1400); break;
    case 'kill': osc(d, 'sine', 120, t, 0.3, 0.9 * v, 30); nz(d, t, 0.22, 0.7 * v, 'lowpass', 900); break;
    case 'down': osc(d, 'sine', 90, t, 0.2, 0.7 * v, 40); break;
    case 'hit': osc(d, 'triangle', 300, t, 0.1, 0.5 * v, 120); break;
    case 'door': nz(d, t, 0.18, 0.7 * v, 'lowpass', 500); osc(d, 'sine', 70, t, 0.18, 0.5 * v, 40); break;
    case 'swap': nz(d, t, 0.05, 0.22 * v, 'highpass', 2600); osc(d, 'square', 380, t, 0.06, 0.2 * v, 720); break;
    case 'pick': osc(d, 'square', 600, t, 0.07, 0.25 * v, 950); break;
    case 'click': osc(d, 'square', 1600, t, 0.025, 0.25 * v); break;
    case 'throw': nz(d, t, 0.2, 0.3 * v, 'bandpass', 900); break;
    case 'wall': nz(d, t, 0.05, 0.25 * v, 'highpass', 3000); break;
    case 'go': osc(d, 'sawtooth', 220, t, 0.35, 0.4, 660); osc(d, 'square', 330, t, 0.35, 0.2, 990); break;
    case 'end': osc(d, 'triangle', 440, t, 0.4, 0.4, 220); break;
    case 'tick': osc(d, 'square', 880, t, 0.06, 0.2); break;
    case 'unlock': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { osc(d, 'triangle', f, t + i * 0.09, 0.6, 0.35); osc(d, 'sine', f * 2, t + i * 0.09, 0.5, 0.12); }); nz(d, t, 0.5, 0.25, 'highpass', 5000); break;
    case 'heal': osc(d, 'sine', 520, t, 0.25, 0.5 * v, 1040); osc(d, 'triangle', 780, t + 0.08, 0.25, 0.35 * v, 1560); break;
  }
}

/* ---------------------------------------------------------------- MENU/UI */
const skinsEl = $('skins');
function buildSkins() {
  skinsEl.textContent = '';
  for (const k in SKINS) {
    if (SKINS[k].secret && !cfg.secret) continue;   // personagem secreto: só aparece depois de desbloqueado
    const b = document.createElement('button');
    b.className = 'skin' + (SKINS[k].secret ? ' legend' : ''); b.dataset.skin = k; b.type = 'button';
    b.innerHTML = `<i style="background:${SKINS[k].c}"></i>${SKINS[k].n}`;
    b.onclick = () => { cfg.skin = k; saveCfg(); refreshSkins(); };
    skinsEl.appendChild(b);
  }
  refreshSkins();
}
function refreshSkins() { for (const b of skinsEl.children) b.setAttribute('aria-pressed', b.dataset.skin === cfg.skin ? 'true' : 'false'); }
buildSkins();
$('nameInput').value = cfg.name; $('diffSel').value = cfg.diff;
$('optMusic').checked = cfg.music; $('optSfx').checked = cfg.sfx; $('optShake').checked = cfg.shake; $('optCrt').checked = cfg.crt;
document.body.classList.toggle('nocrt', !cfg.crt);
$('optMusic').onchange = e => { cfg.music = e.target.checked; applyMusic(); refreshTracks(); saveCfg(); };
$('optSfx').onchange = e => { cfg.sfx = e.target.checked; saveCfg(); };
$('optShake').onchange = e => { cfg.shake = e.target.checked; saveCfg(); };
$('optCrt').onchange = e => { cfg.crt = e.target.checked; document.body.classList.toggle('nocrt', !cfg.crt); saveCfg(); };
$('nameInput').oninput = e => { cfg.name = e.target.value; saveCfg(); };
$('diffSel').onchange = e => { cfg.diff = e.target.value; saveCfg(); };
$('btnCreateRoom').onclick = () => { initAudio(); startOnline({ mode: 'create' }); };
const roomCodeOf = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
$('roomInput').oninput = e => { e.target.value = roomCodeOf(e.target.value); };
$('roomInput').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') $('btnJoinRoom').click(); };
$('btnJoinRoom').onclick = () => {
  const code = roomCodeOf($('roomInput').value);
  if (code.length !== 4) return status('Digite o código de 4 letras da sala.');
  initAudio(); startOnline({ mode: 'code', room: code });
};
// link de convite: ?sala=ABCD já preenche o código
{ const q = roomCodeOf(new URLSearchParams(location.search).get('sala')); if (q.length === 4) { $('roomInput').value = q; status('Convite para a sala ' + q + ': toque em Entrar.'); } }
$('btnBot').onclick = () => { initAudio(); startLocal(cfg.diff); };
$('btnResume').onclick = () => setPaused(false);
$('btnLeave').onclick = () => { closeAll(); showMenu(''); };
$('btnStart').onclick = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'start' })); };
$('btnLobbyLeave').onclick = () => { closeAll(); showMenu(''); };
$('lobbyCode').onclick = () => {
  if (!roomCode) return;
  const link = location.origin + location.pathname + '?sala=' + roomCode;
  const done = () => { const sm = $('lobbyCode').querySelector('small'); if (sm) sm.textContent = 'LINK COPIADO!'; };
  try { navigator.clipboard.writeText(link).then(done, () => { }); } catch { }
};
const status = t => { $('status').textContent = t; };
function showMenu(msg) { stopTrack(); $('menu').classList.remove('hidden'); $('pause').classList.add('hidden'); $('lobby').classList.add('hidden'); $('hud').classList.add('hidden'); $('banner').classList.add('hidden'); status(msg || ''); }
function hideMenu() { playTrack(); $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); }
function setPaused(p) {
  if (!mode) return; paused = p; $('pause').classList.toggle('hidden', !p);
  if (p) { keys = {}; mouse.down = false; mouse.right = false; }
}

/* remove o texto "ngc" do menu (partida rápida) — varre textos e atributos do menu/sala */
(function stripNgc() {
  const re = /\s*[·•|:–—-]?\s*\bngc\b\s*/gi;
  for (const rootId of ['menu', 'lobby']) {
    const root = $(rootId); if (!root) continue;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      if (!/\bngc\b/i.test(n.nodeValue)) continue;
      n.nodeValue = n.nodeValue.replace(re, ' ').replace(/\s{2,}/g, ' ').trim();
      const p = n.parentElement;
      if (!n.nodeValue && p && !p.children.length && !['BUTTON', 'LABEL', 'SUMMARY'].includes(p.tagName)) p.remove();
    }
    for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(a); if (v && /\bngc\b/i.test(v)) el.setAttribute(a, v.replace(re, ' ').trim());
    }
  }
})();

/* abas do menu */
function showTab(which) {
  const m = which === 'music';
  $('tabPlay').classList.toggle('hidden', m); $('tabMusic').classList.toggle('hidden', !m);
  $('tabBtnPlay').setAttribute('aria-selected', m ? 'false' : 'true'); $('tabBtnMusic').setAttribute('aria-selected', m ? 'true' : 'false');
}
$('tabBtnPlay').onclick = () => showTab('play');
$('tabBtnMusic').onclick = () => showTab('music');
for (const t of TRACKS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'track'; b.dataset.id = t.id;
  b.innerHTML = '<span class="ic">▶</span><span class="tx"><b></b><small></small></span>';
  b.querySelector('b').textContent = t.name; b.querySelector('small').textContent = t.sub;
  b.onclick = () => { if (cfg.track === t.id && musicOn && cfg.music) stopTrack(); else pickTrack(t.id); };
  $('trackList').appendChild(b);
}
$('volRange').value = Math.round(cfg.vol * 100);
$('volRange').oninput = e => { cfg.vol = e.target.value / 100; saveCfg(); applyMusic(); };
refreshTracks();
const playerName = () => (cfg.name || '').trim() || 'Jogador';

/* ------------------------------------------------------------ CONEXÃO */
function closeAll() {
  if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { } ws = null; }
  clearInterval(pingTimer); local = null; mode = null; snap = null; level = null; mapId = undefined; round = -1; buf = []; pending = [];
  paused = false; camInit = false; resetFx(); $('pause').classList.add('hidden');
}
let roomCode = '';
function startOnline(opt = { mode: 'quick' }) {
  closeAll(); mode = 'online'; roomCode = ''; status('Conectando ao servidor…');
  try { ws = new WebSocket(SERVER_URL); } catch { mode = null; return status('Endereço do servidor inválido.'); }
  const sock = ws;
  sock.onopen = () => {
    sock.send(JSON.stringify({ type: 'join', name: playerName(), skin: cfg.skin, mode: opt.mode, room: opt.room || '' }));
    pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'ping', t: performance.now() })); }, 2000);
  };
  sock.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') myId = m.id;
    else if (m.type === 'joined') { roomCode = m.room || ''; hideMenu(); }
    else if (m.type === 'full') { closeAll(); showMenu('A sala está cheia (' + MAX_PLAYERS + ' jogadores).'); }
    else if (m.type === 'noroom') { closeAll(); showMenu('Sala não encontrada. Confira o código.'); }
    else if (m.type === 'busy') { closeAll(); showMenu('O servidor está com o máximo de salas abertas. Tente de novo em instantes.'); }
    else if (m.type === 's') onSnapshot(m);
    else if (m.type === 'pong') pingMs = Math.round(performance.now() - m.t);
  };
  sock.onerror = () => { if (mode === 'online' && !snap) status('Falha de conexão. O servidor está ligado?'); };
  sock.onclose = () => { const had = !!snap; closeAll(); showMenu(had ? 'Conexão perdida com o servidor.' : 'Não foi possível conectar. O servidor pode estar iniciando, tente de novo em 30 s.'); };
}
function startLocal(diff) {
  closeAll(); mode = 'local'; myId = 'me';
  const g = new Game({ autoStart: true });
  const me = g.addPlayer('me', playerName(), cfg.skin);
  const keysSk = Object.keys(SKINS).filter(k => k !== cfg.skin);
  const bot = g.addPlayer('bot', 'BOT ' + ({ EASY: 'fácil', NORMAL: 'normal', HARD: 'difícil' }[diff] || ''), keysSk[Math.floor(Math.random() * keysSk.length)]);
  bot.bot = true;
  local = { g, me, bot: new Bot(g, bot.slot, diff), t: 0 };
  hideMenu();
}
function sendInput(inp) {
  if (mode === 'online') { if (ws && ws.readyState === 1) ws.send(JSON.stringify(inp)); }
  else if (local) { local.me.ack = inp.seq; local.g.applyInput(local.me, inp, inp.dt); }
}

/* ------------------------------------------------------------- SNAPSHOT */
/* ------------------------------------------------------------- ESPECTAR
   Quem morreu (ou entrou com a rodada em andamento) acompanha os jogadores vivos. A / D troca de jogador. */
let specId = null;
const canSpec = () => { const me = snap && myState(); return !!(snap && level && me && !me.al && ['countdown', 'live', 'over', 'matchover'].includes(snap.ph)); };
const specList = () => foesOf().filter(f => f.al).sort((a, b) => a.sl - b.sl);
function specTarget() {
  if (!canSpec()) { specId = null; return null; }
  const l = specList();
  let t = l.find(f => f.id === specId);
  if (!t) {
    const old = snap.pl.find(p => p.id === specId);
    t = (old && l.find(f => f.sl > old.sl)) || l[0] || old || null;   // alvo caiu: vai pro próximo vivo; sem vivos, fica onde estava
  }
  specId = t ? t.id : null; return t;
}
function specStep(dir) {
  const l = specList(); if (l.length < 2) return;
  const i = l.findIndex(f => f.id === specId);
  specId = l[(i + dir + l.length) % l.length].id;
}
const myState = () => (snap ? snap.pl.find(p => p.id === myId) : null);
const foesOf = () => (snap ? snap.pl.filter(p => p.id !== myId) : []);
// adversário em destaque no HUD: maior pontuação (empate: prefere o vivo)
const enemyState = () => { let b = null; for (const p of foesOf()) if (!b || p.sc > b.sc || (p.sc === b.sc && p.al && !b.al)) b = p; return b; };
// cor da jaqueta: cada jogador recebe uma cor aleatória (vem do servidor em p.cl; se faltar, sorteia aqui e mantém)
let colorMap = {};
const jacketOf = (id) => colorMap[id] || '#ff2e97';

function resetFx() {
  fx = { parts: [], lights: [], slashes: [], corpses: [], pops: [], flash: 0, red: 0 };
  pbul = []; pshots = []; hiddenB.clear(); knownB = new Set(); gotShot = 0; pcd = 0; pbuf = 0;
  if (dctx && decal) dctx.clearRect(0, 0, decal.width, decal.height);
}
/* ------------------------------------------------- CASA: pisos, paredes e móveis */
const PAL = {
  wood: ['#b57e48', '#ab7440'], carpet: ['#8b6a8c', '#836284'], tile: ['#d6e8ea', '#c4dadd'],
  ktile: ['#efe8d6', '#ddd4bb'], sand: ['#e2c78f', '#dbbf86'], stone: ['#cdb88e', '#c3ad80'], grass: ['#54964a', '#4e8d44'], deck: ['#c9a06a', '#bd945d'], path: ['#bdb7aa', '#b2ac9e'],
  sidewalk: ['#bdb8ae', '#b4afa5'], road: ['#3f424a', '#3b3e46'], laneh: ['#3f424a', '#3b3e46'], lanev: ['#3f424a', '#3b3e46'], zebrah: ['#3f424a', '#3b3e46'], zebrav: ['#3f424a', '#3b3e46']
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
  } else if (kind === 'sand') {
    for (let i = 0; i < 9; i++) { const r1 = hash(x * 11 + i, y), r2 = hash(x, y * 11 + i); c.fillStyle = r1 < .5 ? 'rgba(255,245,210,.35)' : 'rgba(150,110,50,.18)'; c.fillRect(X + r1 * (T - 3) + 1, Y + r2 * (T - 3) + 1, 2, 2); }
    if (hash(x * 3 + 1, y * 5 + 2) > .8) { c.strokeStyle = 'rgba(150,110,50,.2)'; c.lineWidth = 1.5; c.beginPath(); c.arc(X + T / 2, Y + T + 6, 20 + hash(x, y) * 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
  } else if (kind === 'stone') {
    c.fillStyle = 'rgba(90,60,25,.25)'; c.fillRect(X, Y + T - 1.5, T, 1.5); c.fillRect(X + T - 1.5, Y, 1.5, T);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(X, Y, T, 1);
  } else if (kind === 'sidewalk') {
    c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(X + T - 1.5, Y, 1.5, T); c.fillRect(X, Y + T - 1.5, T, 1.5);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(X, Y, T, 1);
    if (hash(x * 3, y * 7) > .86) { c.fillStyle = 'rgba(0,0,0,.07)'; c.fillRect(X + 6 + hash(x, y) * 24, Y + 6 + hash(y, x) * 24, 10, 6); }
  } else if (kind === 'road' || kind === 'laneh' || kind === 'lanev' || kind === 'zebrah' || kind === 'zebrav') {
    for (let i = 0; i < 5; i++) { const r1 = hash(x * 13 + i, y), r2 = hash(x, y * 13 + i); c.fillStyle = r1 < .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.14)'; c.fillRect(X + r1 * (T - 3), Y + r2 * (T - 3), 2, 2); }
    c.fillStyle = kind === 'zebrah' || kind === 'zebrav' ? 'rgba(240,240,236,.88)' : '#f0cf48';
    if (kind === 'laneh') c.fillRect(X + 11, Y + T / 2 - 1.5, 28, 3);
    else if (kind === 'lanev') c.fillRect(X + T / 2 - 1.5, Y + 11, 3, 28);
    else if (kind === 'zebrah') for (let i = 0; i < 4; i++) c.fillRect(X + 3, Y + 4 + i * 12, T - 6, 6);
    else if (kind === 'zebrav') for (let i = 0; i < 4; i++) c.fillRect(X + 4 + i * 12, Y + 3, 6, T - 6);
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
  box(c, w, h) { rrect(c, 3, 3, w - 6, h - 6, 4, '#8a6a4a', OUT); },
  palm(c, w, h) {
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 1;
    c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(cx + 5, cy + 6, R * .9, R * .8, 0, 0, TAU); c.fill();
    for (let i = 0; i < 9; i++) {
      c.save(); c.translate(cx, cy); c.rotate(i * TAU / 9 + .2);
      c.fillStyle = i & 1 ? '#2d8a3e' : '#3aa24c'; c.strokeStyle = 'rgba(10,50,20,.7)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(R * .5, -R * .28, R, -R * .04); c.quadraticCurveTo(R * .5, R * .2, 0, 0); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = 'rgba(20,80,30,.8)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(R * .95, -R * .03); c.stroke(); c.restore();
    }
    dot(c, cx, cy, 7, '#7a5230', OUT, 1.5); dot(c, cx - 2, cy - 2, 2, '#c99a62'); dot(c, cx + 4, cy + 3, 3, '#4a2c14');
  },
  oasis(c, w, h) {
    rrect(c, 0, 0, w, h, 44, '#e9d4a0', OUT, 2); rrect(c, 8, 8, w - 16, h - 16, 38, '#2fb8d8', '#17829f', 2.5);
    const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(120,230,245,.55)'); g.addColorStop(1, 'rgba(20,110,150,0)'); c.fillStyle = g; c.fillRect(8, 8, w - 16, h - 16);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2;
    for (let k = 0; k < 4; k++) { const y = 34 + k * (h - 68) / 3; c.beginPath(); c.moveTo(24, y); for (let x = 24; x <= w - 24; x += 6) c.lineTo(x, y + Math.sin(x / 10 + k * 1.7) * 3); c.stroke(); }
    for (const [x, y, r] of [[40, 40, 9], [w - 48, h - 44, 11], [w - 36, 50, 7]]) { dot(c, x, y, r, '#3f9a4a', '#1f5a28', 1.5); dot(c, x, y, r * .35, '#ff9ac0'); }
    for (const [x, y, r] of [[22, h - 30, 7], [w - 26, 26, 6]]) dot(c, x, y, r, '#a89a80', OUT, 1.2);
  },
  crate(c, w, h) {
    rrect(c, 3, 3, w - 6, h - 6, 3, '#b98550', OUT); rrect(c, 7, 7, w - 14, h - 14, 2, '#d6a86a', 'rgba(60,30,10,.55)', 1.5);
    c.strokeStyle = 'rgba(90,55,20,.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(8, 8); c.lineTo(w - 8, h - 8); c.moveTo(w - 8, 8); c.lineTo(8, h - 8); c.stroke();
  },
  pipes(c, w, h) {
    c.save(); if (h > w) { c.translate(w, 0); c.rotate(Math.PI / 2); const t = w; w = h; h = t; }
    rrect(c, 1, 1, w - 2, h - 2, 4, '#3a3f48', OUT); const n = 4, th = (h - 8) / n;
    for (let i = 0; i < n; i++) { const y = 4 + i * th; rrect(c, 4, y + 1, w - 8, th - 2, th / 2.4, '#aeb6bf', 'rgba(20,24,30,.8)', 1.2); c.fillStyle = 'rgba(255,255,255,.45)'; c.fillRect(8, y + 3, w - 16, 2); dot(c, w - 8, y + th / 2, th / 2 - 2, '#6a727c', OUT, 1); }
    c.fillStyle = '#2a2d33'; c.fillRect(w * .28, 2, 4, h - 4); c.fillRect(w * .68, 2, 4, h - 4); c.restore();
  },
  barrel(c, w, h) {
    dot(c, w / 2, h / 2, 18, '#8a3a2a', OUT, 1.8); dot(c, w / 2, h / 2, 13, '#a24a36');
    c.strokeStyle = 'rgba(30,10,6,.6)'; c.lineWidth = 2; c.beginPath(); c.arc(w / 2, h / 2, 9, 0, TAU); c.stroke(); dot(c, w / 2 - 4, h / 2 - 4, 3, 'rgba(255,255,255,.35)');
  },
  stall(c, w, h) {
    rrect(c, 2, 4, w - 4, h - 8, 3, '#7a5230', OUT); const n = Math.round(w / 12);
    for (let i = 0; i < n; i++) { c.fillStyle = i & 1 ? '#f4ead0' : '#d0463c'; c.fillRect(3 + i * (w - 6) / n, 5, (w - 6) / n, h - 10); }
    c.strokeStyle = OUT; c.lineWidth = 1.2; c.strokeRect(3, 5, w - 6, h - 10);
    for (const [x, col] of [[.25, '#e8b14a'], [.5, '#6cc070'], [.75, '#ff8a5a']]) dot(c, w * x, h / 2, 5, col, OUT, 1);
  },
  car(c, w, h, f) {
    const col = (f && f.col) || '#d0463c';
    c.save(); if (h > w) { c.translate(w, 0); c.rotate(Math.PI / 2); const t = w; w = h; h = t; }
    rrect(c, 2, 6, w - 4, h - 8, 11, 'rgba(0,0,0,.25)');
    rrect(c, 3, 4, w - 6, h - 8, 11, col, OUT, 1.8);
    rrect(c, w * .27, 8, w * .42, h - 16, 7, 'rgba(25,35,50,.92)');
    rrect(c, w * .33, 11, w * .30, h - 22, 5, col, 'rgba(0,0,0,.35)', 1);
    rrect(c, w * .68, 9, 5, h - 18, 2, 'rgba(150,215,240,.85)');
    rrect(c, w - 8, 8, 4, 7, 2, '#fff3a8'); rrect(c, w - 8, h - 15, 4, 7, 2, '#fff3a8');
    rrect(c, 4, 8, 3, 7, 1, '#c0202a'); rrect(c, 4, h - 15, 3, 7, 1, '#c0202a');
    c.restore();
  },
  bus(c, w, h, f) {
    const col = (f && f.col) || '#e8a02a';
    c.save(); if (h > w) { c.translate(w, 0); c.rotate(Math.PI / 2); const t = w; w = h; h = t; }
    rrect(c, 2, 4, w - 4, h - 7, 8, 'rgba(0,0,0,.25)'); rrect(c, 2, 3, w - 4, h - 7, 8, col, OUT, 1.8);
    c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(4, h / 2 - 2, w - 8, 4);
    const n = Math.floor((w - 34) / 24); for (let i = 0; i < n; i++) rrect(c, 10 + i * 24, 8, 17, h - 18, 2, 'rgba(35,55,75,.92)');
    rrect(c, w - 17, 7, 9, h - 16, 3, '#9ad8f0', OUT, 1); rrect(c, w - 6, 8, 3, 7, 1, '#fff3a8'); rrect(c, w - 6, h - 15, 3, 7, 1, '#fff3a8');
    rrect(c, 3, 8, 3, 7, 1, '#c0202a'); rrect(c, 3, h - 15, 3, 7, 1, '#c0202a');
    c.restore();
  },
  lamp(c, w, h) {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 24); g.addColorStop(0, 'rgba(255,232,150,.4)'); g.addColorStop(1, 'rgba(255,232,150,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    dot(c, w / 2, h / 2, 9, '#3a3f48', OUT, 1.5); dot(c, w / 2, h / 2, 5, '#ffe9a0'); dot(c, w / 2 - 1, h / 2 - 1, 2, '#fff');
  },
  dumpster(c, w, h) {
    rrect(c, 3, 5, w - 6, h - 10, 4, '#2f6b4a', OUT); rrect(c, 6, 8, w - 12, h - 16, 3, '#3d8a60', 'rgba(0,0,0,.4)', 1);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; for (let x = 14; x < w - 8; x += 14) { c.beginPath(); c.moveTo(x, 9); c.lineTo(x, h - 9); c.stroke(); }
  },
  fountain(c, w, h) {
    rrect(c, 0, 0, w, h, w / 2, '#d5cfc0', OUT, 2.5); rrect(c, 8, 8, w - 16, h - 16, (w - 16) / 2, '#35b9e6', '#1a86ad', 2.5);
    const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(130,235,250,.6)'); g.addColorStop(1, 'rgba(20,110,150,0)'); c.fillStyle = g; c.fillRect(8, 8, w - 16, h - 16);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2; for (const r of [w * .3, w * .22]) { c.beginPath(); c.arc(w / 2, h / 2, r, 0, TAU); c.stroke(); }
    dot(c, w / 2, h / 2, 17, '#d8d2c4', OUT, 2); dot(c, w / 2, h / 2, 10, '#8fe2f5', 'rgba(20,110,150,.7)', 1.5); dot(c, w / 2 - 3, h / 2 - 3, 3, '#fff');
  },
  sandbags(c, w, h) {
    const n = Math.max(2, Math.round(w / 22));
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) rrect(c, 3 + i * (w - 6) / n, 4 + r * (h - 8) / 2, (w - 6) / n - 2, (h - 8) / 2 - 1, 6, r ? '#c8ad78' : '#d4ba84', OUT, 1.2);
  }
};
function drawFurn(c, f, T) {
  const w = f.w * T, h = f.h * T;
  c.save(); c.translate((f.x + f.w / 2) * T, (f.y + f.h / 2) * T);
  if (f.r) c.rotate(Math.PI);
  c.translate(-w / 2, -h / 2); (FURN[f.k] || FURN.box)(c, w, h, f); c.restore();
}
function drawRug(c, r, T) {
  const x = r.x * T + 4, y = r.y * T + 4, w = r.w * T - 8, h = r.h * T - 8;
  rrect(c, x, y, w, h, 8, r.col, OUT, 1.5);
  rrect(c, x + 6, y + 6, w - 12, h - 12, 5, null, 'rgba(255,255,255,.6)', 2.5);
  rrect(c, x + 13, y + 13, w - 26, h - 26, 3, null, 'rgba(0,0,0,.18)', 2);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.5;
  for (let i = 0; i < w; i += 7) { c.beginPath(); c.moveTo(x + i, y - 3); c.lineTo(x + i, y); c.moveTo(x + i, y + h); c.lineTo(x + i, y + h + 3); c.stroke(); }
}

// TETO da construção (estilo Goose Goose Duck): desenhado uma vez; no render ele some (fade) quando o jogador está dentro
function drawRoof(c, r, T, g) {
  const x = r.x * T, y = r.y * T, w = r.w * T, h = r.h * T;
  c.save();
  rrect(c, x - 3, y - 2, w + 8, h + 9, 6, 'rgba(0,0,0,.3)');                        // sombra do beiral
  rrect(c, x, y, w, h, 4, r.col, 'rgba(25,14,8,.85)', 2.5);
  c.save(); c.beginPath(); c.rect(x + 2, y + 2, w - 4, h - 4); c.clip();
  const row = 16;
  for (let ty = 0; ty < h; ty += row) {
    c.fillStyle = (ty / row) & 1 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.07)'; c.fillRect(x, y + ty, w, row);
    c.fillStyle = 'rgba(0,0,0,.24)'; c.fillRect(x, y + ty + row - 1.5, w, 1.5);
    for (let tx = (ty / row) & 1 ? 8 : 0; tx < w; tx += row) c.fillRect(x + tx, y + ty, 1.2, row - 1.5);
  }
  c.fillStyle = 'rgba(0,0,0,.28)'; if (w >= h) c.fillRect(x, y + h / 2 - 4, w, 8); else c.fillRect(x + w / 2 - 4, y, 8, h);   // cumeeira
  c.fillStyle = 'rgba(255,255,255,.22)'; if (w >= h) c.fillRect(x, y + h / 2 - 4, w, 2); else c.fillRect(x + w / 2 - 4, y, 2, h);
  c.restore();
  for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) if (g[ty][tx] === 2 && (tx === r.x || ty === r.y || tx === r.x + r.w - 1 || ty === r.y + r.h - 1)) c.clearRect(tx * T - 1, ty * T - 1, T + 2, T + 2);   // só as portas da FACHADA ficam visíveis por fora; portas internas (banheiro etc.) continuam sob o teto
  c.restore();
}

function buildStatic() {
  const m = level.m, th = m.theme, T = 50, K = TILE / T, g = m.g, W = level.W, H = level.H;   // pisos/móveis são desenhados em 50px por tile e escalados (K) para o TILE real
  levelCv = document.createElement('canvas'); levelCv.width = W * TILE; levelCv.height = H * TILE;
  const c = levelCv.getContext('2d'); c.scale(K, K);
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
  wallCv = document.createElement('canvas'); wallCv.width = W * TILE; wallCv.height = H * TILE;
  const wc = wallCv.getContext('2d'); wc.scale(K, K);
  wc.lineCap = 'square';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === 1) {
    const X = x * T, Y = y * T, hedge = th.hedge && border(x, y);
    wc.fillStyle = hedge ? '#2f6b2a' : th.wall; wc.fillRect(X, Y, T, T);
    if (th.brick && !hedge) { wc.fillStyle = 'rgba(90,60,25,.2)'; wc.fillRect(X, Y + T / 2 - .5, T, 1); wc.fillRect(X + ((y & 1) ? T * .25 : T * .75), Y, 1, T / 2); wc.fillRect(X + ((y & 1) ? T * .75 : T * .25), Y + T / 2, 1, T / 2); }
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
  roofCv = null; roofA = [];
  if (m.roofs && m.roofs.length) {
    roofCv = document.createElement('canvas'); roofCv.width = W * TILE; roofCv.height = H * TILE;
    const rc = roofCv.getContext('2d'); rc.scale(K, K);
    for (const r of m.roofs) drawRoof(rc, r, T, g);
    roofA = m.roofs.map(() => 1);
  }
  decal = document.createElement('canvas'); decal.width = W * TILE; decal.height = H * TILE; dctx = decal.getContext('2d');
}
function newRound(s) {
  mapId = s.map; round = s.rd; buf = []; pending = []; first = true; resetFx(); pslide = { t: 0, a: 0, cd: 0 };
  if (s.map) { level = new Level(s.map); buildStatic(); } else { level = null; levelCv = null; roofCv = null; roofA = []; }
}
function onSnapshot(s) {
  const now = performance.now();
  if (s.map !== mapId || s.rd !== round) newRound(s);
  snap = s; snapAt = now;
  { const cm = {}; for (const p of s.pl) cm[p.id] = p.cl || colorMap[p.id] || randomColor([...Object.values(cm), ...Object.values(colorMap)]); colorMap = cm; }
  gotShot = 0;
  for (const e of s.ev) handleEvent(e, now);
  if (mode === 'online') {
    const mp = s.pl.find(p => p.id === myId), ids = new Set();
    for (const b of s.b) { ids.add(b[0]); if (mp && b[5] === mp.sl && !knownB.has(b[0]) && gotShot > 0) hiddenB.add(b[0]); }
    knownB = ids; for (const id of hiddenB) if (!ids.has(id)) hiddenB.delete(id);
  }
  if (level) {
    const open = new Map(s.dr.map(e => [e[0], e]));
    for (const d of level.doors) {
      const e = open.get(d.i);
      if (e) { if (d.latched) level.setLatched(d, false); d.phi = e[1]; d.w = e[2]; }
      else if (!d.latched) level.setLatched(d, true);
    }
  }
  buf.push({ t: now, pl: s.pl }); if (buf.length > 30) buf.shift();
  const me = s.pl.find(p => p.id === myId);
  if (me && level) {
    while (pending.length && pending[0].seq <= (s.ack || 0)) pending.shift();
    const t = { x: me.x, y: me.y }, S = { t: me.sd || 0, a: me.sa || 0, cd: me.sq || 0 };
    if (canMove(s.ph, me.al, me.dn, me.hz > 0)) for (const p of pending) stepMotion(level, t, S, p.k, p.a, p.sl, p.dt, p.sm, p.can);
    pslide = S;
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
      if (!e.pred && e.by === myId && mode === 'online' && pshots.length) { pshots.shift(); gotShot++; break; }   // já mostrei esse tiro na hora do clique
      sfx(e.w, e.x, e.y);
      const wdx = WEAPONS[e.w], mz = (wdx && wdx.muz) || 30, mx = e.x + Math.cos(e.a) * mz, my = e.y + Math.sin(e.a) * mz;
      fx.lights.push({ x: mx, y: my, t: e.w === 'SNIPER' ? 0.14 : 0.08, r: e.w === 'SNIPER' ? 260 : 170, c: e.w === 'SNIPER' ? '255,120,150' : '255,225,130' });
      for (let i = 0; i < (e.w === 'SNIPER' ? 9 : 4); i++) fx.parts.push({ k: 's', x: mx, y: my, vx: Math.cos(e.a + (Math.random() - .5)) * 300, vy: Math.sin(e.a + (Math.random() - .5)) * 300, life: 0.08, sz: 6, col: '#ffe9a0' });
      const ca = e.a + Math.PI / 2 + (Math.random() - .5);
      fx.parts.push({ k: 'c', x: e.x, y: e.y, vx: Math.cos(ca) * 120, vy: Math.sin(ca) * 120, rot: Math.random() * 6, vr: 20, life: 0.5 });
      animOf(e.by).recoil = 1;
      addShake(e.by === myId ? ({ SNIPER: 9, SHOTGUN: 7, REVOLVER: 5, RIFLE: 4, MINIGUN: 1.8 }[e.w] || 2.5) : 1.2);
      break;
    }
    case 'swap': sfx('swap', e.x, e.y); break;
    case 'slide': {   // começou a rasteira: poeira para trás
      sfx('swing', e.x, e.y);
      for (let i = 0; i < 10; i++) { const a = e.a + Math.PI + (Math.random() - .5) * 1.5, sp = 120 + Math.random() * 180; fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, sz: 4, col: '#d9cfb4' }); }
      break;
    }
    case 'trip': {    // rasteira acertou
      sfx('down', e.x, e.y); addShake(e.by === myId || e.id === myId ? 7 : 3); addPop(e.x, e.y - 24, 'RASTEIRA!', '#e2a93b');
      for (let i = 0; i < 10; i++) fx.parts.push({ k: 's', x: e.x, y: e.y, vx: (Math.random() - .5) * 300, vy: (Math.random() - .5) * 300, life: 0.25, sz: 4, col: '#fff6a0' });
      break;
    }
    case 'swing': {
      const st = animOf(e.by); st.sw0 = now; st.sw = e.w; st.punch *= -1;
      sfx('swing', e.x, e.y);
      fx.slashes.push({ x: e.x, y: e.y, a: e.a, t: 1, w: e.w, by: e.by, dir: st.punch, t0: now });
      break;
    }
    case 'kill': {
      sfx('kill', e.x, e.y);
      const big = e.how === 'exec' || e.how === 'blade';
      addBlood(e.x, e.y, e.a, big ? 80 : 50, big ? 420 : 330);
      bloodPool(e.x, e.y, e.a, big);
      fx.corpses.push({ x: e.x, y: e.y, a: e.a, sk: e.sk, vx: Math.cos(e.a) * (big ? 30 : 160), vy: Math.sin(e.a) * (big ? 30 : 160), mine: e.id === myId, col: jacketOf(e.id, e.id === myId) });
      addShake(big ? 13 : 9); fx.flash = 0.35; hitstop = 0.09; zoomKick = 0.06;
      if (e.id === myId) fx.red = 0.6;
      break;
    }
    case 'down': {
      sfx('down', e.x, e.y); addShake(5);
      for (let i = 0; i < 8; i++) fx.parts.push({ k: 's', x: e.x, y: e.y, vx: (Math.random() - .5) * 260, vy: (Math.random() - .5) * 260, life: 0.25, sz: 4, col: '#fff6a0' });
      break;
    }
    case 'door': sfx('door', e.x, e.y); addShake(e.hit ? 8 : 2.5); break;
    case 'slam': sfx('door', e.x, e.y); addShake(2.5); break;
    case 'thit':
      sfx(e.bl ? 'kill' : 'hit', e.x, e.y); addShake(e.bl ? 7 : 3);
      if (e.bl) addPop(e.x, e.y - 22, 'LÂMINA!', '#ff2e4d');
      else if (e.cb) addPop(e.x, e.y - 22, 'CABO', '#ffe600');
      else if (e.pw) addPop(e.x, e.y - 22, 'LANÇA ' + e.pw + '%', e.pw >= 80 ? '#ff2e4d' : '#ffe600');
      break;
    case 'hurt': // levou dano (sem morrer)
      sfx('hit', e.x, e.y); addBlood(e.x, e.y, e.a, 10, 220);
      addShake(e.id === myId ? 4 : 1.5); if (e.id === myId) { fx.red = Math.max(fx.red, 0.25); playHurt(); }
      break;
    case 'wall':
      for (let i = 0; i < 3; i++) fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(e.a + Math.PI + (Math.random() - .5) * 2) * 220, vy: Math.sin(e.a + Math.PI + (Math.random() - .5) * 2) * 220, life: 0.14, sz: 5, col: '#9ff7ff' });
      if (Math.random() < 0.35) sfx('wall', e.x, e.y);
      break;
    case 'heal':
      sfx('heal', e.x, e.y);
      for (let i = 0; i < 14; i++) { const a = Math.random() * TAU; fx.parts.push({ k: 's', x: e.x + Math.cos(a) * 10, y: e.y + Math.sin(a) * 10, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 120, life: 0.5, sz: 4, col: '#7dff8a' }); }
      fx.lights.push({ x: e.x, y: e.y, t: 0.3, r: 120, c: '90,255,140' });
      break;
    case 'hstart': sfx('click', e.x, e.y); fx.lights.push({ x: e.x, y: e.y, t: 0.25, r: 90, c: '90,255,140' }); break;
    case 'pick': sfx('pick', e.x, e.y); break;
    case 'click': sfx('click', e.x, e.y); break;
    case 'throw': sfx('throw', e.x, e.y); break;
    case 'go': goUntil = now + 900; sfx('go'); break;
    case 'end': sfx('end'); break;
  }
}
function addPop(x, y, s, col) { fx.pops.push({ x, y, s, col, t: 0.9 }); }
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
  if (['w', 'a', 's', 'd', 'e', 'f', 'q', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === 'shift') lockStep();   // Shift (Dragão, segurando C): troca o alvo; com um só inimigo, destrava a mira/câmera
  if (canSpec()) { if (k === 'a' || k === 'arrowleft') specStep(-1); else if (k === 'd' || k === 'arrowright') specStep(1); }
  const map = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' };
  keys[map[k] || k] = true;
  if (k === 'e') edge.pk = true;
  if (k === 'f') edge.sl = true;   // F = rasteira
  if (k === 'q') edge.hl = true;
  if (k === '1') edge.ss = 1;
  if (k === '2') edge.ss = 2;
  if (k === 'm') { cfg.music = !cfg.music; applyMusic(); $('optMusic').checked = cfg.music; refreshTracks(); saveCfg(); }
  if (k === 'n') nextTrack();
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); const map = { arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd' }; keys[map[k] || k] = false; });
addEventListener('blur', () => { keys = {}; mouse.down = false; mouse.right = false; });
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => {
  if (!mode || paused) return; initAudio();
  if (e.button === 0) { if (canSpec()) specStep(1); mouse.down = true; edge.fp = true; }
  if (e.button === 2) { e.preventDefault(); edge.th = true; mouse.right = true; }
});
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.right = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
// scroll do mouse: troca a arma da mão pela do outro espaço do inventário
let wheelAcc = 0, wheelAt = 0;
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (!mode || paused || canSpec()) return;
  const now = performance.now();
  if (now - wheelAt > 250) wheelAcc = 0;
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  if (Math.abs(wheelAcc) >= 40 && now - wheelAt > 180) { wheelAcc = 0; wheelAt = now; edge.sw = true; }   // trava: touchpad não fica trocando sem parar
}, { passive: false });

const mouseAngle = () => Math.atan2(mouse.y - (H / 2 + (pred.y - cam.y) * Z), mouse.x - (W / 2 + (pred.x - cam.x) * Z));
// Dragão Dourado: mira automática. Trava no inimigo vivo mais próximo (prefere quem está à vista) e adianta o tiro.
function enemyVel(id) {
  const n = buf.length; if (n < 2) return { x: 0, y: 0 };
  const a = buf[n - 2], b = buf[n - 1], pa = a.pl.find(q => q.id === id), pb = b.pl.find(q => q.id === id), dt = (b.t - a.t) / 1000;
  if (!pa || !pb || dt < 0.001) return { x: 0, y: 0 };
  const vx = (pb.x - pa.x) / dt, vy = (pb.y - pa.y) / dt, l = Math.hypot(vx, vy), m = l > 260 ? 260 / l : 1;
  return { x: vx * m, y: vy * m };
}
// Dragão Dourado: segure ESPAÇO para travar a mira no inimigo vivo mais próximo (prefere quem está à vista).
// Sem ESPAÇO a mira é o mouse normal. Usa a skin escolhida localmente, então funciona também online.
const isDragon = () => cfg.skin === 'DRAGON' && !!cfg.secret;
// SHIFT (com ESPAÇO apertado) troca o alvo da mira: passa pro próximo inimigo vivo, na ordem dos slots. Soltar o ESPAÇO volta ao automático.
let lockId = null, lockOff = false;
function nearestFoe() {
  let best = null, bs = Infinity;
  for (const f of foesOf()) {
    if (!f.al) continue;
    const d = Math.hypot(f.x - pred.x, f.y - pred.y), sc = d + (level.los(pred.x, pred.y, f.x, f.y) ? 0 : 1600);
    if (sc < bs) { bs = sc; best = f; }
  }
  return best;
}
function lockStep() {
  const me = myState();
  if (!me || !me.al || !isDragon() || !keys['c'] || !level) return;
  const l = foesOf().filter(f => f.al).sort((a, b) => a.sl - b.sl);
  if (l.length < 2) { lockId = null; lockOff = true; sfx('tick'); return; }   // só um alvo: Shift solta a mira e a câmera (volta ao pressionar C de novo)
  const cur = (lockId && l.find(f => f.id === lockId)) || nearestFoe();
  const i = cur ? l.findIndex(f => f.id === cur.id) : -1;
  lockId = l[(i + 1) % l.length].id;
  sfx('tick');
}
function aimBotPoint(me) {
  if (!keys['c']) { lockId = null; lockOff = false; }
  if (lockOff || !me || !me.al || !isDragon() || !keys['c'] || !level) return null;
  let best = lockId ? foesOf().find(f => f.id === lockId && f.al) : null;
  if (!best) { lockId = null; best = nearestFoe(); }
  if (!best) return null;
  // posição desenhada do inimigo (interpolada): é nela que a mira fica centralizada
  const ie = interpEnemy(best.id) || { x: best.x, y: best.y };
  const wd = me.w ? WEAPONS[me.w] : null, v = enemyVel(best.id), d = Math.hypot(best.x - pred.x, best.y - pred.y);
  // adianta o tiro: tempo de voo + ida e volta da rede (online), pois o servidor decide o acerto
  const t = wd && !wd.melee ? Math.min(0.8, d / wd.speed + (mode === 'online' ? pingMs / 1000 : 0)) : 0;
  return { x: best.x + v.x * t, y: best.y + v.y * t, dx: ie.x, dy: ie.y, nm: best.nm };
}
function aimAngle() {
  const t = aimBotPoint(myState());
  return t ? Math.atan2(t.y - pred.y, t.x - pred.x) : mouseAngle();
}

function doStep() {
  if (mode === 'local' && local) {
    // monta e aplica a entrada do jogador, depois bot + tick
    if (snap && level) stepInput();
    local.bot.think(STEP); local.g.tick(STEP);
    if (++local.t > 0) { const s = local.g.snapshot(); s.ack = local.me.ack; local.g.events = []; onSnapshot(s); }
    return;
  }
  if (snap && level) stepInput();
}
function stepInput() {
  const k = (keys.w ? 1 : 0) | (keys.a ? 2 : 0) | (keys.s ? 4 : 0) | (keys.d ? 8 : 0);
  const inp = { type: 'input', seq: ++seq, dt: STEP, k, a: +aimAngle().toFixed(3), f: mouse.down ? 1 : 0, fp: edge.fp ? 1 : 0, pk: edge.pk ? 1 : 0, th: edge.th ? 1 : 0, hl: edge.hl ? 1 : 0, sw: edge.sw ? 1 : 0, sl: edge.sl ? 1 : 0, ss: edge.ss, tc: mouse.right ? 1 : 0 };
  edge.fp = edge.pk = edge.th = edge.hl = edge.sw = edge.sl = false; edge.ss = 0;
  const me = myState(), sm = me && me.hz > 0 ? HEAL_SLOW : 1;
  const can = !!me && snap.ph === 'live' && me.al && !me.dn && !(me.hz > 0) && !(me.ch >= 0);   // mesmas regras do servidor para iniciar a rasteira
  if (me && canMove(snap.ph, me.al, me.dn, me.hz > 0)) stepMotion(level, pred, pslide, k, inp.a, inp.sl, STEP, sm, can);
  pending.push({ seq: inp.seq, dt: STEP, k, sm, a: inp.a, sl: inp.sl, can }); if (pending.length > 120) pending.shift();
  predictShots(inp);
  sendInput(inp);
}
// Tiro previsto: replica a regra do servidor (cooldown, clique guardado 0.16 s, automática segurada, munição) e mostra clarão, som, recuo e a bala NA HORA.
function predictShots(inp) {
  if (mode !== 'online' || !snap || !level) return;
  const nowT = performance.now();
  while (pshots.length && nowT - pshots[0] > 700) pshots.shift();   // o servidor não confirmou: descarta
  if (snap.ph !== 'live') return;
  const me = myState(); if (!me || !me.al || me.dn || me.hz > 0 || me.ch >= 0) return;
  pcd -= STEP; pbuf -= STEP;
  if (inp.pk || inp.sw || inp.ss || inp.th || inp.hl) { pcd = Math.max(pcd, 0.25); pbuf = 0; return; }   // trocou/pegou/jogou/curou: espera o servidor
  if (inp.fp) pbuf = 0.16;
  const wd = me.w ? WEAPONS[me.w] : null;
  if (!wd || wd.melee || me.am - pshots.length <= 0) return;
  if (!(pcd <= 0 && (pbuf > 0 || (inp.f && wd.auto)))) return;
  pbuf = 0; pcd = wd.cd;
  const a = inp.a; let mz = wd.muz || 12;
  if (!level.los(pred.x, pred.y, pred.x + Math.cos(a) * mz, pred.y + Math.sin(a) * mz)) mz = 8;
  const sx = pred.x + Math.cos(a) * mz, sy = pred.y + Math.sin(a) * mz;
  for (let i = 0; i < wd.pellets; i++) {
    const aa = a + (Math.random() - 0.5) * 2 * wd.spread, sp = wd.speed * (wd.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
    pbul.push({ x: sx, y: sy, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: wd.range / sp });
  }
  pshots.push(nowT);
  handleEvent({ t: 'shot', by: myId, w: me.w, x: pred.x, y: pred.y, a, pred: 1 }, nowT);
}

/* ------------------------------------------------------------------ DESENHO */
const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
const rr = (x, y, w, h, f) => { ctx.fillStyle = f; ctx.fillRect(x, y, w, h); };

// peça com contorno (desenha a arma de verdade em vez de retângulos soltos)
function part(pts, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.stroke();
}
function ring(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 0.8; ctx.stroke(); }
const WD = '#6b4a2a', WL = '#8b6238';   // madeira
const MD = '#262a34', MM = '#3b4150', ML = '#69728a';   // metal escuro / médio / claro
function drawWeaponSprite(type) {
  const w = WEAPONS[type];
  switch (type) {
    case 'PISTOL':
      part([-1, 2.4, 4.8, 2.4, 3.4, 9, -2.4, 9], '#1c1f27');                                   // cabo
      part([-2.5, -3, 14, -3, 16, -1.6, 16, 1.8, 14, 2.6, -2.5, 2.6], MM);                      // ferrolho
      rr(-1.5, -2.6, 14, 1, ML); rr(4, -0.8, 6, 0.9, w.col);                                    // brilho + faixa
      rr(14, -1.3, 2.4, 2.6, MD); rr(-1.6, -4.3, 1.8, 1.4, MD); rr(12.6, -4.3, 1.6, 1.4, MD);   // cano + miras
      ctx.strokeStyle = MD; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(4, 3, 2.6, 0, Math.PI); ctx.stroke(); break;
    case 'REVOLVER':
      part([-3.4, 2.2, 2, 2.2, 0.6, 9.8, -4.8, 9.2], WD);                                       // cabo de madeira
      part([-3.6, -3.4, 3, -3.4, 3, 2.6, -3.6, 2.6], MM);                                       // armação
      part([-3.6, -3.4, -1.6, -5.6, -0.6, -3.4], MD);                                           // cão
      part([3, -2.6, 18, -2.6, 18, 0.8, 3, 0.8], MM); rr(4, -2.6, 13, 0.9, ML);                 // cano + trilho
      rr(3, 0.8, 11, 1.8, MD);                                                                  // haste do ejetor
      ring(2.4, -0.2, 3.6, 3.7, ML); for (let i = 0; i < 4; i++) { const t = i * 1.57; ctx.fillStyle = MD; ctx.fillRect(2.4 + Math.cos(t) * 2 - .6, -0.2 + Math.sin(t) * 2 - .6, 1.2, 1.2); }
      rr(17, -3.6, 1.6, 1.6, w.col); break;
    case 'SMG':
      part([5, 3, 10.4, 3, 9.6, 14, 5.8, 14], MD); rr(5.8, 12, 3.8, 1.6, w.col);                // carregador
      part([-1.6, 3, 3, 3, 1.8, 9.4, -3.2, 9.4], '#1c1f27');                                    // cabo
      part([-6, -3.4, 17, -3.4, 19, -2, 19, 3, -6, 3], MM);                                     // corpo
      part([19, -2.6, 25, -2.6, 25, 2.6, 19, 2.6], MD); for (let i = 0; i < 3; i++) rr(20 + i * 1.8, -1, 1, 2, w.col);   // cano ventilado
      rr(-4, -4.4, 16, 1.2, ML); rr(-5, 0.4, 20, 0.9, w.col);                                    // trilho + faixa
      ctx.strokeStyle = MD; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-6, -1.4); ctx.lineTo(-11, -1.4); ctx.lineTo(-11, 2.2); ctx.lineTo(-6, 2.2); ctx.stroke(); break;   // coronha de arame
    case 'RIFLE':
      part([-15, -3, -6, -2.8, -6, 3.2, -14, 5.4], WD); rr(-14, -2.4, 7, 0.9, WL);              // coronha
      part([4, 3, 10.4, 3, 11.6, 11, 6.2, 11], MD);                                              // carregador curvo
      part([-6, -3.8, 17, -3.8, 17, 3.2, -6, 3.2], MM); rr(-5, -3.2, 21, 1, ML);                 // receptor
      part([17, -3.2, 29, -3.2, 29, 3.2, 17, 3.2], WD); rr(17, -2.6, 12, 0.9, WL);              // guarda-mão
      rr(29, -1.3, 7, 2.6, MD); rr(34, -2.2, 3, 4.4, MM);                                        // cano + freio
      rr(-2, -5.6, 9, 1.8, MD); rr(24, -5, 1.8, 1.6, MD); rr(-5, 0.6, 12, 0.9, w.col); break;    // mira + alça
    case 'SHOTGUN':
      part([-16, -2.8, -6, -2.4, -6, 3, -15, 5.2], WD); rr(-15, -2.2, 8, 0.9, WL);              // coronha
      part([-6, -3.6, 8, -3.6, 8, 3, -6, 3], MM);                                                // receptor
      rr(8, -3.6, 28, 2.8, MD); rr(8, -3.6, 28, 0.9, ML);                                        // cano
      rr(8, 0.4, 24, 2.6, MM);                                                                   // tubo do carregador
      part([14, -0.6, 26, -0.6, 26, 4.6, 14, 4.6], WD); for (let i = 0; i < 4; i++) rr(15.5 + i * 2.6, 0.4, 0.8, 3.2, 'rgba(0,0,0,.35)');   // empunhadura deslizante
      rr(34, -4.2, 2.4, 1.4, w.col); rr(36, -3.6, 1.2, 6, MD); break;
    case 'SNIPER':
      part([-20, -3, -9, -3.4, -9, 4, -19, 6.6], '#2f3b2a'); rr(-19, -2.4, 9, 1, '#44563c');     // coronha
      part([-9, -3.6, 15, -3.6, 15, 3.2, -9, 3.2], MM); rr(-8, -3, 22, 1, ML);                   // receptor
      rr(15, -1.5, 33, 3, MD); rr(15, -1.5, 33, 0.9, ML);                                         // cano longo
      part([45, -2.6, 51, -2.6, 51, 2.6, 45, 2.6], MM); rr(46.4, -2.6, 1, 5.2, MD); rr(48.4, -2.6, 1, 5.2, MD);   // freio de boca
      part([-1, -8.4, 17, -8.4, 17, -4.4, -1, -4.4], '#12141a'); rr(0, -7.6, 16, 0.9, ML);        // luneta
      rr(2, -4.4, 2, 1.2, MD); rr(12, -4.4, 2, 1.2, MD);
      ring(17.6, -6.4, 1.6, 2.2, w.col); ring(-1.6, -6.4, 1.2, 1.8, '#7ad4ff');                   // lentes
      ctx.strokeStyle = MD; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(26, 1.4); ctx.lineTo(22, 8); ctx.moveTo(30, 1.4); ctx.lineTo(34, 8); ctx.stroke();   // bipé
      rr(-2, 3.2, 1.6, 3.6, ML); ring(-1.2, 7.4, 1.8, 1.8, ML);                                    // ferrolho
      part([3, 3.2, 9, 3.2, 9, 6.4, 3, 6.4], MD); rr(-12, -0.4, 6, 0.9, w.col); break;
    case 'MINIGUN':
      part([-6, -5.6, 11, -5.6, 11, 5.6, -6, 5.6], '#2c2f3a'); rr(-5, -4.8, 15, 1, ML); rr(-5, 2, 15, 1.2, w.col);   // carcaça
      part([-6, 5.6, 8, 5.6, 8, 13, -6, 13], '#4a5030'); rr(-5, 8, 13, 0.9, 'rgba(0,0,0,.4)'); rr(-5, 10.4, 13, 0.9, 'rgba(0,0,0,.4)');   // caixa de munição
      rr(11, -5, 30, 2.4, MM); rr(11, -1.2, 30, 2.4, MD); rr(11, 2.6, 30, 2.4, MM);              // 3 canos
      part([21, -5.6, 24, -5.6, 24, 5.6, 21, 5.6], ML); part([35, -5.6, 38, -5.6, 38, 5.6, 35, 5.6], ML);   // braçadeiras
      part([-1, -9.8, 3, -9.8, 3, -5.6, -1, -5.6], MD);                                           // alça
      rr(40, -4.4, 2, 9, w.col); break;
    case 'KNIFE':
      rr(-3.6, -2, 9, 4, '#2b1c1c'); for (let i = 0; i < 3; i++) rr(-2 + i * 2.6, -2, 0.8, 4, 'rgba(255,255,255,.18)');
      part([5, -4.2, 7, -4.2, 7, 4.2, 5, 4.2], ML);                                               // guarda
      part([7, -2.8, 20, -2.6, 27, 0.4, 20, 2.2, 7, 2.8], '#dfe9f5'); rr(8, -0.3, 14, 0.7, '#9fb2c8'); rr(8, -2.4, 12, 0.7, '#fff'); break;
    case 'MACHETE':
      rr(-4, -2.2, 12, 4.4, '#2a1a10'); for (let i = 0; i < 3; i++) rr(-2.6 + i * 3, -2.2, 0.8, 4.4, 'rgba(255,255,255,.15)');
      part([8, -3.4, 9.8, -3.4, 9.8, 3.4, 8, 3.4], ML);
      part([9.8, -2.4, 36, -3.8, 43, -1.8, 43, 2.4, 9.8, 2.8], '#cfd8d2'); rr(10, -2.2, 31, 1.2, '#8c978f'); rr(11, 1.6, 30, 0.8, w.col); break;
    case 'BAT':
      part([-4, -1.8, 12, -1.8, 12, 1.8, -4, 1.8], '#8a5a2c'); for (let i = 0; i < 4; i++) rr(-3 + i * 3, -1.8, 0.8, 3.6, 'rgba(0,0,0,.35)');
      part([12, -2.2, 33, -3.8, 42, -3.4, 43, 0, 42, 3.4, 33, 3.8, 12, 2.2], '#c58a4a'); rr(14, -2.4, 26, 1, '#e6b97c');
      for (let i = 0; i < 3; i++) rr(30 + i * 4, -3.4, 0.9, 6.8, 'rgba(60,30,10,.4)'); break;
    case 'KATANA':
      rr(-7, -2, 16, 4, '#1c1020'); for (let i = 0; i < 4; i++) { ctx.fillStyle = '#6c2a82'; ctx.beginPath(); ctx.moveTo(-5 + i * 4, 0); ctx.lineTo(-3 + i * 4, -2); ctx.lineTo(-1 + i * 4, 0); ctx.lineTo(-3 + i * 4, 2); ctx.fill(); }
      ring(10.2, 0, 1.8, 4.8, '#ffd23f');                                                          // tsuba
      part([11.5, -1.5, 50, -1.2, 55, 0.7, 50, 1.2, 11.5, 1.5], '#e8fbff'); rr(12, -0.2, 40, 0.5, '#7fb6c4'); rr(12, -1.2, 36, 0.6, '#fff'); break;
    case 'SPEAR':
      rr(-9, -1.3, 62, 2.6, '#7a5430'); rr(-9, -1.3, 62, 0.8, WL); rr(-11, -2, 3, 4, ML);          // haste + conteira
      for (let i = 0; i < 3; i++) rr(34 + i * 2.4, -1.5, 1.2, 3, '#3a2410');                      // amarração
      rr(49, -2.2, 3, 4.4, '#ff2e4d');                                                             // fita
      part([52, -3.8, 72, 0, 52, 3.8, 55, 0], '#eaf2ff'); rr(55, -0.3, 14, 0.6, '#9fb2c8'); break;
  }
}
/* ---------- personagem estilo Hotline Miami: jaqueta, jeans, tênis e máscara de animal ---------- */
const OL = 'rgba(12,4,18,.92)', SKIN_TONE = '#f0c39a', JEANS = '#34508f', HAIR = '#3a2415';
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, k = c => Math.max(0, Math.min(255, Math.round(c * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
function shape(pts, fill, lw = 1.8) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
}
function blob(x, y, rx, ry, fill, lw = 1.8) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  if (lw) { ctx.strokeStyle = OL; ctx.lineWidth = lw; ctx.stroke(); }
}
// braço com manga da jaqueta, punho claro e mão
function limb(x1, y1, x2, y2, jacket) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OL; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = jacket; ctx.lineWidth = 5.4; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const cx = x1 + (x2 - x1) * 0.62, cy = y1 + (y2 - y1) * 0.62;
  ctx.strokeStyle = '#efe6d0'; ctx.lineWidth = 5.6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1 + (x2 - x1) * 0.78, y1 + (y2 - y1) * 0.78); ctx.stroke();   // punho
}
const hand = (x, y) => blob(x, y, 3.6, 3.4, SKIN_TONE, 1.6);

function drawHead(skin) {
  const c = (SKINS[skin] || SKINS.ROOSTER).c, dk = shade(c, 0.62), lt = shade(c, 1.22);
  blob(-2.4, 0, 9.6, 10.4, HAIR, 1.8);                          // cabelo aparecendo atrás da máscara
  // orelhas (atrás da máscara)
  if (skin === 'BEAR' || skin === 'MONKEY') {
    const r = skin === 'BEAR' ? 4.4 : 5.2;
    for (const s of [-1, 1]) { blob(-1.5, s * 9.2, r, r, c); blob(-1, s * 9.2, r * 0.5, r * 0.5, skin === 'BEAR' ? '#d9b48c' : '#f3c6d6', 0); }
  }
  if (skin === 'TIGER') for (const s of [-1, 1]) { shape([-1.5, s * 5.5, -6, s * 13, 3, s * 9], c); shape([-2, s * 7.5, -4.6, s * 11.2, 1, s * 9], '#2a1200', 0.01); }
  if (skin === 'DRAGON') for (const s of [-1, 1]) { shape([0, s * 6, -8, s * 9, -16, s * 16, -9, s * 5.4], '#fff2b8', 1.6); shape([-1, s * 7, -7, s * 9.4, -12, s * 13.4, -7, s * 7], '#e8a82a', 0.01); }
  if (skin === 'WOLF') for (const s of [-1, 1]) { shape([0, s * 5, -4, s * 14, 5, s * 8.5], c); shape([0.5, s * 7, -2.6, s * 12, 3, s * 8.8], '#3a4656', 0.01); }
  // máscara
  blob(0, 0, 9.6, 9.8, c, 2.1);
  ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 9.4, 9.6, 0, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(-8, 0, 8, 12, 0, 0, TAU); ctx.fill();        // sombra atrás
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(1, -6, 6, 3, -0.3, 0, TAU); ctx.fill(); // brilho
  ctx.restore();
  if (skin === 'ROOSTER') {
    blob(-3.2, 0, 3.8, 3.5, '#ff2e4d'); blob(1.2, 0, 3.4, 3.1, '#ff3b57'); blob(5, 0, 2.7, 2.4, '#ff5a70');        // crista
    shape([8, -3.6, 16, 0, 8, 3.6, 9.4, 0], '#ff9a2b', 1.6); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(9.4, 0); ctx.lineTo(15, 0); ctx.stroke();
    blob(9.5, 0, 1.8, 2.4, '#e0152f', 1);
  }
  if (skin === 'TIGER') {
    ctx.strokeStyle = '#2a1200'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(-7, -4.6); ctx.lineTo(-2, -2.8); ctx.moveTo(-7.4, -0.8); ctx.lineTo(-2, 0); ctx.moveTo(-7, 4.6); ctx.lineTo(-2, 2.8);
    ctx.moveTo(-3, -8.2); ctx.lineTo(0, -6.2); ctx.moveTo(-3, 8.2); ctx.lineTo(0, 6.2); ctx.stroke();
    blob(6.4, 0, 3.8, 5.2, '#fff0d8', 1.2); shape([9.2, -1.6, 11.6, 0, 9.2, 1.6], '#ff6f9a', 1);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(9, -2); ctx.lineTo(13.5, -4.2); ctx.moveTo(9, 2); ctx.lineTo(13.5, 4.2); ctx.moveTo(9, 0); ctx.lineTo(14, 0); ctx.stroke();
  }
  if (skin === 'BEAR') { blob(7, 0, 4.4, 4.6, '#d9b48c', 1.4); blob(10.4, 0, 1.8, 1.5, '#120808', 0); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10.4, 1.4); ctx.lineTo(10.4, 3); ctx.stroke(); }
  if (skin === 'MONKEY') {
    blob(4.8, -2.8, 3.8, 4, '#ecdcff', 1.2); blob(4.8, 2.8, 3.8, 4, '#ecdcff', 1.2); blob(7.6, 0, 3.4, 4.2, '#ecdcff', 1.2);
    ctx.strokeStyle = 'rgba(60,20,80,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(8.2, 0, 2.2, -1, 1); ctx.stroke(); blob(10, -1, .7, .7, '#2a1030', 0); blob(10, 1, .7, .7, '#2a1030', 0);
  }
  if (skin === 'WOLF') {
    shape([2, -4.8, 15.2, -1.8, 15.2, 1.8, 2, 4.8], '#e8f0f8', 1.6); blob(15, 0, 1.9, 1.7, '#0c0c12', 0);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(14, 0); ctx.stroke();
    for (const s of [-1, 1]) shape([-2, s * 9, -7, s * 11.2, -4, s * 7.4], '#dfe8f2', 1);   // tufos de pelo
  }
  if (skin === 'DRAGON') {
    for (let i = 0; i < 4; i++) shape([-8 + i * 3.2, 0, -6.2 + i * 3.2, -2.2, -4.4 + i * 3.2, 0, -6.2 + i * 3.2, 2.2], i & 1 ? '#ff9a1f' : '#ff6a1a', 1);   // crista de escamas
    blob(7.2, 0, 4.4, 4.8, shade(c, 0.92), 1.4); blob(10.4, -1.6, 1, 1, '#2a1200', 0); blob(10.4, 1.6, 1, 1, '#2a1200', 0);                     // focinho
    shape([8.6, -3.6, 10.6, -4.4, 10, -2.6], '#fff', 0.8); shape([8.6, 3.6, 10.6, 4.4, 10, 2.6], '#fff', 0.8);                                   // presas
    ctx.strokeStyle = 'rgba(120,60,0,.55)'; ctx.lineWidth = 0.9; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-4 + i * 3.2, 0, 3.6, -1.2, 1.2); ctx.stroke(); }   // escamas
  }
  // olhos: buracos escuros com olhar branco
  for (const s of [-1, 1]) { blob(3.8, s * 3.7, 2.7, 3, '#0b0710', 0); blob(4.4, s * 3.7, 1.6, 2, '#fff', 0); blob(5, s * 3.7, 0.95, 1.2, '#000', 0); }
  if (skin === 'DRAGON') for (const s of [-1, 1]) { blob(4.4, s * 3.7, 1.7, 2.2, '#ff5a1f', 0); blob(5, s * 3.7, 0.6, 1.5, '#200800', 0); }
}
// tronco visto de cima: ombros largos, jaqueta com gola, costura e listra nas costas
function drawBody(skin, jacket, flat) {
  if (flat) {
    for (const s of [-1, 1]) { blob(-12, s * 5.2, 7, 3.8, JEANS, 1.6); blob(-18.5, s * 5.2, 3.6, 3, '#f4f1ea', 1.4); }   // pernas e tênis de quem caiu
    blob(0, 0, 11.5, 15.5, jacket, 2); blob(-1, 0, 6, 11, shade(jacket, 0.8), 0);
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-8, 0, 11, -0.9, 0.9); ctx.stroke(); return;
  }
  blob(0, 0, 9.4, 15.4, jacket, 2);
  for (const s of [-1, 1]) blob(0.5, s * 12, 5.6, 5.4, shade(jacket, 0.88), 1.6);               // ombros
  ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 8.6, 14.8, 0, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-10, -16, 7, 32);                                  // sombra das costas
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(1, -7, 6, 3, -0.2, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#efe6d0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5.2, -14); ctx.lineTo(-5.2, 14); ctx.stroke();   // listra da jaqueta nas costas
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(2, 0); ctx.stroke();      // costura central
  blob(3.4, 0, 3, 6, '#efe6d0', 1.4);                                                                                              // gola
}

/* ---------- animação do golpe corpo a corpo (estilo Hotline Miami) ----------
   preparação (puxa para trás) -> varrida rápida com leve passada do corpo -> acompanha o golpe e volta ao repouso.
   O sentido alterna a cada golpe (ida e volta), como o taco/faca do jogo original. */
const SWDUR = { FISTS: 200, KNIFE: 230, MACHETE: 270, BAT: 340, KATANA: 300, SPEAR: 300 };
const swDur = t => SWDUR[t] || 240;
const lerpN = (a, b, t) => a + (b - a) * t;
function swingAng(sp, arc, dir) {
  const rest = -0.6, a0 = -dir * arc / 2, wind = a0 - dir * 0.45, a1 = dir * arc / 2, over = a1 + dir * 0.18;
  if (sp < 0.16) { const t = sp / 0.16; return lerpN(rest, wind, 1 - (1 - t) * (1 - t)); }
  if (sp < 0.6) { const t = (sp - 0.16) / 0.44; return lerpN(wind, over, 1 - Math.pow(1 - t, 3)); }
  const t = (sp - 0.6) / 0.4; return lerpN(over, rest, t * t * (3 - 2 * t));
}
// quanto o corpo avança durante o golpe (0 -> 1 -> 0), forte na hora da varrida
// comprimento do braço que golpeia (px locais): dobrado no repouso -> estica atrás na preparação -> estica tudo na varrida -> recolhe
function swingArm(sp) {
  if (sp < 0.16) return lerpN(10.2, 17, sp / 0.16);
  if (sp < 0.6) { const t = (sp - 0.16) / 0.44; return lerpN(17, 25, 1 - Math.pow(1 - t, 3)); }
  const t = (sp - 0.6) / 0.4; return lerpN(25, 10.2, t * t * (3 - 2 * t));
}
const swingLunge = sp => (sp < 0.12 ? -0.25 * (sp / 0.12) : Math.sin(Math.min(1, (sp - 0.12) / 0.6) * Math.PI) * 1);
function drawPlayer(p, x, y, ang, isMe, now) {
  const st = animOf(p.id);
  if (!st.lx && !st.ly) { st.lx = x; st.ly = y; }
  const moved = Math.hypot(x - st.lx, y - st.ly);
  if (st.la === undefined) { st.la = ang; st.mv = 0; }
  // pernas giram para a direção em que o boneco ANDA (independente da mira); parado, voltam para a mira
  if (moved > 0.25 && moved < 40) { st.la += angDiff(Math.atan2(y - st.ly, x - st.lx), st.la) * 0.35; st.mv += (1 - st.mv) * 0.3; }
  else { st.la += angDiff(ang, st.la) * 0.12; st.mv *= 0.78; }
  st.walk += Math.min(moved, 8) * 0.17; st.lx = x; st.ly = y;
  const sliding = isMe ? (pslide.t > 0 && p.al !== 0) : p.sd > 0, sAng = isMe ? pslide.a : p.sa;
  if (sliding) { st.la = sAng; st.mv = 1; if (!paused && Math.random() < 0.7) fx.parts.push({ k: 's', x: x - Math.cos(sAng) * 14, y: y - Math.sin(sAng) * 14, vx: -Math.cos(sAng) * 60 + (Math.random() - .5) * 90, vy: -Math.sin(sAng) * 60 + (Math.random() - .5) * 90, life: 0.22, sz: 3, col: '#cfc6a8' }); }
  st.recoil = Math.max(0, st.recoil - 0.12);
  const jacket = jacketOf(p.id, isMe);
  ctx.save(); ctx.translate(x, y); ctx.scale(CS, CS);
  if (isMe) { ctx.strokeStyle = 'rgba(0,229,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke(); }
  if (level && level.waterAt(x, y)) {   // dentro da piscina: sem sombra, ondas se abrindo em volta dos pés
    ctx.save(); ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const t = ((now / 650 + i / 3) % 1); ctx.globalAlpha = (1 - t) * 0.7; ctx.strokeStyle = '#e8fbff'; ctx.beginPath(); ctx.ellipse(0, 4, 12 + t * 17, 9 + t * 12, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  } else { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(2, 4, 16, 13, 0, 0, TAU); ctx.fill(); }
  if (p.sk === 'DRAGON' && !p.dn) {   // aura dourada pulsante do personagem lendário
    const pu = 0.75 + 0.25 * Math.sin(now / 260); ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(0, 0, 6, 0, 0, 36); ag.addColorStop(0, `rgba(255,200,60,${0.38 * pu})`); ag.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, 36, 0, TAU); ctx.fill(); ctx.restore();
  }
  const healing = p.hz > 0 && !p.dn;
  if (healing) {   // aura verde pulsante + cruzes subindo (por baixo do boneco)
    const pu = 0.5 + 0.5 * Math.sin(now / 130), pr = 1 - Math.max(0, Math.min(1, p.hz / HEAL_TIME));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(0, 0, 4, 0, 0, 34); hg.addColorStop(0, `rgba(60,255,150,${0.28 + 0.2 * pu})`); hg.addColorStop(1, 'rgba(60,255,150,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.fillStyle = '#7dffb4'; ctx.shadowColor = '#2dff8a'; ctx.shadowBlur = 8;
    for (let i = 0; i < 4; i++) {
      const t = ((now / 700 + i / 4) % 1), px2 = Math.sin(i * 2.4 + 1) * 17, py2 = 6 - t * 38; ctx.globalAlpha = Math.sin(t * Math.PI) * 0.95;
      ctx.fillRect(px2 - 1.2, py2 - 4, 2.4, 8); ctx.fillRect(px2 - 4, py2 - 1.2, 8, 2.4);
    }
    ctx.restore();
  }
  if (sliding) {   // riscos de velocidade atrás de quem desliza
    ctx.save(); ctx.rotate(sAng); ctx.strokeStyle = 'rgba(235,228,205,.55)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const [oy, len] of [[-9, 24], [0, 34], [9, 20]]) { ctx.beginPath(); ctx.moveTo(-14, oy); ctx.lineTo(-14 - len, oy); ctx.stroke(); }
    ctx.restore();
  }
  ctx.rotate(ang);
  if (healing) ctx.scale(0.94, 0.94);   // agachadinho enquanto se cura
  if (sliding) ctx.scale(1.08, 0.86);   // corpo baixo e esticado na rasteira
  const swW = st.sw || 'FISTS', swSp = Math.min(1, (now - st.sw0) / swDur(p.w || 'FISTS')), swOn = swSp < 1;
  if (swOn && !p.dn && (!p.w || (WEAPONS[p.w] && WEAPONS[p.w].melee))) ctx.translate(swingLunge(swSp) * (p.w === 'SPEAR' ? 5 : p.w ? 8 : 6), 0);   // passada do corpo
  if (p.dn) {
    ctx.globalAlpha = 0.95; drawBody(p.sk, jacket, true); ctx.translate(-3, 0); drawHead(p.sk); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(CS, CS);
    const k = 1 - Math.max(0, p.dt) / DOWN_TIME;
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.fillStyle = '#fff6a0'; for (let i = 0; i < 3; i++) { const a = now / 180 + i * 2.1; ctx.fillRect(Math.cos(a) * 18 - 2, Math.sin(a) * 8 - 26, 4, 4); }
    ctx.restore(); return;
  }
  // pernas estilo Hotline Miami: uma vai para frente e a outra para TRÁS, alternando; o pé que vem à frente levanta um pouco
  ctx.save(); ctx.rotate(angDiff(st.la, ang)); ctx.lineCap = 'round';
  const stp = sliding ? 10 : Math.sin(st.walk) * 10 * st.mv;   // na rasteira: uma perna esticada à frente, a outra atrás
  for (const [s, o] of [[-1, stp], [1, -stp]]) {
    const fxp = 1.5 + o * 1.5, lift = 1 + Math.max(0, o) / 10 * 0.2;
    ctx.strokeStyle = OL; ctx.lineWidth = 8.4; ctx.beginPath(); ctx.moveTo(-1, s * 3.6); ctx.lineTo(fxp - 2, s * 5.2); ctx.stroke();
    ctx.strokeStyle = JEANS; ctx.lineWidth = 5.8; ctx.beginPath(); ctx.moveTo(-1, s * 3.6); ctx.lineTo(fxp - 2, s * 5.2); ctx.stroke();
    blob(fxp + 2.5, s * 5.2, 5.6 * lift, 4 * lift, '#f4f1ea', 1.6); ctx.fillStyle = '#d62a45'; ctx.fillRect(fxp + 0, s * 5.2 - 0.7, 4.8, 1.4);   // tênis + faixa
  }
  ctx.restore();
  const sp = swSp, swinging = swOn; let twist = 0;
  const wt = p.w, wd = wt ? WEAPONS[wt] : null, melee = !wt || wd.melee;
  // braços + arma
  if (healing) {
    // cura: segura um kit médico com as duas mãos junto ao peito, arma guardada de lado
    const pu = Math.sin(now / 130) * 0.5 + 0.5, hb = Math.sin(now / 150) * 1.1;
    if (wt) { ctx.save(); ctx.translate(-1, 12); ctx.rotate(2.5); ctx.scale(0.8, 0.8); drawWeaponSprite(wt); ctx.restore(); }
    limb(0, 10, 11 + hb, 4.8, jacket); limb(0, -10, 11 + hb, -4.8, jacket);
    ctx.save(); ctx.translate(14 + hb, 0); ctx.rotate(Math.sin(now / 240) * 0.08);
    shape([-5.5, -4.5, 5.5, -4.5, 5.5, 4.5, -5.5, 4.5], '#f4f1ea', 1.5);
    ctx.fillStyle = `rgb(${Math.round(30 + 60 * pu)},${Math.round(200 + 55 * pu)},${Math.round(110 + 40 * pu)})`; ctx.fillRect(-1.2, -3.4, 2.4, 6.8); ctx.fillRect(-3.4, -1.2, 6.8, 2.4);
    ctx.restore();
    hand(11 + hb, 4.8); hand(11 + hb, -4.8);
    twist = Math.sin(now / 260) * 0.07;   // respiração
  } else if (!wt) {
    // soco: a mão que bate puxa para trás, dispara para frente cruzando a mira e volta; a outra fica de guarda
    const side = st.punch, bump = swinging ? Math.sin(Math.min(1, Math.max(0, (sp - 0.18) / 0.82)) * Math.PI) : 0;
    const ext = swinging ? (sp < 0.18 ? -5 * (sp / 0.18) : lerpN(-5, 0, (sp - 0.18) / 0.82) + 30 * Math.pow(bump, 0.7)) : 0, cross = bump * 5;
    limb(0, side * 10, 10 + ext, side * (6.5 - cross), jacket); limb(0, -side * 10, 9 - bump * 3, -side * 7.5, jacket);
    hand(12 + ext, side * (6.5 - cross)); hand(10.5 - bump * 3, -side * 7.5);
    if (swinging) twist = -side * bump * 0.28;
  } else if (melee) {
    const spear = wt === 'SPEAR', arc = wd.arc, dir = st.punch || 1, a = spear ? 0 : (swinging ? swingAng(sp, arc, dir) : -0.6);
    // lança: puxa o braço, estoca para frente e recolhe
    const thrust = spear && swinging ? (sp < 0.2 ? -9 * (sp / 0.2) : lerpN(-9, 0, (sp - 0.2) / 0.8) + 38 * Math.sin(Math.min(1, (sp - 0.2) / 0.5) * Math.PI / 2) * (sp < 0.7 ? 1 : 1 - (sp - 0.7) / 0.3)) : 0;
    const chg = spear && p.ch > 0 ? p.ch : 0, lunge = thrust - chg * 12, hy = spear ? 5 : 8;
    if (swinging && !spear) {
      // golpe como no Hotline Miami: o braço INTEIRO gira a partir do ombro (estica atrás, varre, estica ao máximo, recolhe) e a arma segue em linha com ele
      const bl = sp < 0.12 ? sp / 0.12 : sp > 0.85 ? (1 - sp) / 0.15 : 1, ha = lerpN(-0.2, a, bl), len = lerpN(10.2, swingArm(sp), bl);
      const hx = Math.cos(ha) * len, hy2 = 10 + Math.sin(ha) * len, cnt = Math.sin(Math.min(1, sp / 0.7) * Math.PI);
      twist = (a + 0.6) * 0.42;   // tronco gira junto com a varrida
      limb(0, -10, 9 - cnt * 3, -7.5 + cnt * 1.5, jacket); hand(10.5 - cnt * 3, -7.5 + cnt * 1.5);   // braço de trás recua
      limb(0, 10, hx, hy2, jacket);
      ctx.save(); ctx.translate(hx, hy2); ctx.rotate(a); drawWeaponSprite(wt); hand(1, 0); ctx.restore();
    } else {
      limb(0, 10, 10 + lunge, hy, jacket);
      ctx.save(); ctx.translate(10 + lunge, hy); ctx.rotate(a); drawWeaponSprite(wt); hand(1, 0); ctx.restore();
      limb(0, -10, 9, -7.5, jacket); hand(10.5, -7.5);
    }
  } else {
    const back = st.recoil * 4;
    const fx2 = { PISTOL: 15, REVOLVER: 15, SMG: 24, RIFLE: 26, SHOTGUN: 28, SNIPER: 32, MINIGUN: 28 }[wt] || 22, small = wt === 'PISTOL' || wt === 'REVOLVER';
    const fy = small ? -2 : -3, by = wt === 'MINIGUN' ? 6 : 3;
    limb(0, 10, 15 - back, by, jacket); limb(0, -10, fx2 - back, fy, jacket);
    ctx.save(); ctx.translate(8 - back, 0); drawWeaponSprite(wt); ctx.restore();
    hand(15 - back, by); hand(fx2 - back, fy);
  }
  ctx.save(); ctx.rotate(Math.sin(st.walk) * 0.07 * st.mv + twist);   // o tronco balança de leve a cada passo (e gira junto com o golpe)
  drawBody(p.sk, jacket, false);
  drawBackWeapon(p);   // a outra arma do inventário fica nas costas
  ctx.save(); ctx.translate(2.5, 0); ctx.scale(0.8, 0.8); drawHead(p.sk); ctx.restore();
  ctx.restore();
  ctx.restore();
}
// arma do outro espaço do inventário, pendurada nas costas (alça + arma na diagonal, reduzida se for comprida)
function drawBackWeapon(p) {
  const bw = p.iv && p.iv[1 - (p.se | 0)]; if (!bw) return;
  const type = bw[0], e = ITEM_EXT[type] || [8, 30], len = (e[0] + e[1]) / CS, s = Math.max(0.42, Math.min(0.85, 36 / len)), cA = (e[1] - e[0]) / 2 / CS;
  ctx.save();
  ctx.strokeStyle = 'rgba(18,14,10,.8)'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-3, -8.5); ctx.lineTo(1, 8.5); ctx.stroke();   // alça
  ctx.translate(-7, 0); ctx.rotate(2.2); ctx.scale(s, s); ctx.translate(-cA, 0);
  drawWeaponSprite(type);
  ctx.restore();
}
function drawCorpse(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.scale(CS, CS); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(2, 4, 18, 14, 0, 0, TAU); ctx.fill();
  drawBody(c.sk, c.col || (c.mine ? '#10c6e8' : '#ff2e97'), true);
  ctx.fillStyle = 'rgba(160,10,35,.85)'; circle(2, 0, 7); circle(-4, 5, 4);
  ctx.translate(-4, 0); drawHead(c.sk);
  ctx.fillStyle = 'rgba(160,10,35,.7)'; circle(1, 2, 5);
  ctx.restore();
}
function drawDoor(d) {
  const T = TILE, a = d.o === 'h' ? d.phi : Math.PI / 2 - d.phi;
  ctx.save(); ctx.translate(d.hx, d.hy); ctx.rotate(a);
  const ht = DOOR_HT;
  ctx.fillStyle = '#8b5a2b'; ctx.fillRect(0, -ht, T - 2, ht * 2);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(2, -ht + 1.5, T - 8, 2.4);
  ctx.strokeStyle = '#4a2e14'; ctx.lineWidth = 1.8; ctx.strokeRect(0, -ht, T - 2, ht * 2);
  ctx.fillStyle = '#f3d27a'; ctx.beginPath(); ctx.arc(T - 11, 0, 2.6, 0, TAU); ctx.fill();   // maçaneta
  ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(2, 0, 3.8, 0, TAU); ctx.fill();      // dobradiça
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
  if (fx.parts.length > 700) fx.parts.splice(0, fx.parts.length - 700);   // teto de partículas
  for (const l of fx.lights) l.t -= d; fx.lights = fx.lights.filter(l => l.t > 0);
  fx.slashes = fx.slashes.filter(s => performance.now() - s.t0 < swDur(s.w) + 40);
  if (pbul.length && level) {
    const foes = foesOf().filter(f => f.al).map(f => interpEnemy(f.id) || f);
    for (const b of pbul) {
      b.life -= dt; const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 6));
      for (let i = 0; i < n && b.life > 0; i++) {
        b.x += b.vx * dt / n; b.y += b.vy * dt / n;
        if (level.solidAt(b.x, b.y) || level.doorAt(b.x, b.y, 1.5)) { b.life = 0; break; }
        for (const f of foes) if (Math.hypot(f.x - b.x, f.y - b.y) < PR) { b.life = 0; break; }
      }
    }
    pbul = pbul.filter(b => b.life > 0);
  }
  for (const q of fx.pops) q.t -= d; fx.pops = fx.pops.filter(q => q.t > 0);
  if (level) for (const dr of level.doors) level.stepDoor(dr, dt);
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

const FOG = 'rgba(8,6,16,0)'; // removida a camada escura de névoa
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

// desenha só o pedaço visível de uma camada gigante (mapa grande = muito menos pixels por quadro)
function blitView(cvs, x0, y0, w, h) {
  const sx = Math.max(0, Math.floor(x0)), sy = Math.max(0, Math.floor(y0)), ex = Math.min(cvs.width, Math.ceil(x0 + w)), ey = Math.min(cvs.height, Math.ceil(y0 + h));
  if (ex > sx && ey > sy) ctx.drawImage(cvs, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
}
function render(now, dt) {
  if (!mode || !snap || !level || !levelCv) { drawIdle(now); updateHud(now); return; }
  updateFx(dt);
  const me = myState(), alive = !me || me.al;
  Z = S * (1 + zoomKick);
  // câmera
  const look = keys[' '] ? 0.85 : 0.33, maxL = keys[' '] ? 520 : 290;
  const spec = me && !me.al ? specTarget() : null;   // espectando alguém?
  const lkc = me && me.al ? aimBotPoint(me) : null;
  let ox = lkc ? (lkc.dx - pred.x) * 0.5 : (mouse.x - W / 2) / Z * look, oy = lkc ? (lkc.dy - pred.y) * 0.5 : (mouse.y - H / 2) / Z * look; const ol = Math.hypot(ox, oy);
  if (ol > maxL) { ox *= maxL / ol; oy *= maxL / ol; }
  let tx = pred.x + ox, ty = pred.y + oy;
  if (spec) { const ie = interpEnemy(spec.id) || { x: spec.x, y: spec.y }; tx = ie.x; ty = ie.y; }
  if (!camInit) { cam.x = tx; cam.y = ty; camInit = true; } else { const k = Math.min(1, dt * 9); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; }
  const sx = (Math.random() - .5) * shake, sy = (Math.random() - .5) * shake;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = level.m.theme.out; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * (W / 2 - (cam.x + sx) * Z), dpr * (H / 2 - (cam.y + sy) * Z));
  const vhw = W / Z / 2 + 40, vhh = H / Z / 2 + 40, vx0 = cam.x - vhw, vx1 = cam.x + vhw, vy0 = cam.y - vhh, vy1 = cam.y + vhh;
  const inView = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;   // fora da tela não desenha
  blitView(levelCv, vx0, vy0, vx1 - vx0, vy1 - vy0); blitView(decal, vx0, vy0, vx1 - vx0, vy1 - vy0);
  for (const d of level.doors) if (inView(d.hx, d.hy, TILE)) drawDoor(d);
  for (const c of fx.corpses) if (inView(c.x, c.y, 80)) drawCorpse(c);

  // itens no chão
  let near = null, nd = PICK_R;
  for (const it of snap.it) {
    const [, x, y, type, , rot, thrown] = it;
    if (!inView(x, y, 140)) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.shadowColor = WEAPONS[type].col; ctx.shadowBlur = thrown ? 6 : 12; ctx.scale(CS * 1.05, CS * 1.05); if (thrown && type === 'SPEAR') ctx.translate(-55, 0); drawWeaponSprite(type); ctx.restore();
    if (!thrown && me && me.al) { const d = itemDist(type, x, y, rot, pred.x, pred.y); if (d < nd) { nd = d; near = it; } }
  }
  if (near) {
    const t = (WEAPONS[near[3]].name + (near[4] ? ' · ' + near[4] : '')).toUpperCase();
    ctx.save(); ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(t).width, bw = tw + 38, bx = near[1] - bw / 2, by = near[2] - 48;
    rrect(ctx, bx, by, bw, 22, 2, 'rgba(11,12,10,.9)', 'rgba(226,169,59,.9)', 1.2);
    rrect(ctx, bx + 3, by + 3, 16, 16, 2, '#e2a93b'); ctx.fillStyle = '#14120c'; ctx.textAlign = 'center'; ctx.fillText('E', bx + 11, by + 11.5);
    ctx.fillStyle = '#e8e6d8'; ctx.textAlign = 'left'; ctx.fillText(t, bx + 25, by + 11.5); ctx.restore();
  }
  // mira a laser de quem segura o sniper
  const laser = (px, py, pa) => {
    const mz = WEAPONS.SNIPER.muz, x0 = px + Math.cos(pa) * mz, y0 = py + Math.sin(pa) * mz, len = level.ray(x0, y0, pa, 2600);
    const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len); g.addColorStop(0, 'rgba(255,60,90,.55)'); g.addColorStop(1, 'rgba(255,60,90,.12)');
    ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len); ctx.stroke();
    ctx.fillStyle = 'rgba(255,70,100,.9)'; ctx.shadowColor = '#ff3c5a'; ctx.shadowBlur = 10; circle(x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len, 3); ctx.restore();
  };
  for (const f of foesOf()) if (f.al && !f.dn && f.w === 'SNIPER') { const ie = interpEnemy(f.id) || { x: f.x, y: f.y, a: f.a }; laser(ie.x, ie.y, ie.a); }
  if (me && me.al && !me.dn && me.w === 'SNIPER') laser(pred.x, pred.y, aimAngle());
  // balas
  const age = Math.min(0.06, (now - snapAt) / 1000);
  ctx.lineCap = 'round';
  for (const b of snap.b) {
    if (hiddenB.has(b[0])) continue;   // é uma bala minha: já estou desenhando a prevista
    if (!inView(b[1], b[2], 130)) continue;
    const x = b[1] + b[3] * age, y = b[2] + b[4] * age, l = Math.hypot(b[3], b[4]) || 1, snipe = l > 2000, tl = snipe ? 110 : Math.min(42, l * 0.032);
    ctx.strokeStyle = snipe ? '#ffd0da' : '#fff3a8'; ctx.lineWidth = snipe ? 4 : 2.8; ctx.shadowColor = snipe ? '#ff5a7a' : '#ffd23f'; ctx.shadowBlur = snipe ? 14 : 8;
    ctx.beginPath(); ctx.moveTo(x - b[3] / l * tl, y - b[4] / l * tl); ctx.lineTo(x, y); ctx.stroke();
  }
  for (const b of pbul) {
    const l = Math.hypot(b.vx, b.vy) || 1, snipe = l > 2000, tl = snipe ? 110 : Math.min(42, l * 0.032);
    ctx.strokeStyle = snipe ? '#ffd0da' : '#fff3a8'; ctx.lineWidth = snipe ? 4 : 2.8; ctx.shadowColor = snipe ? '#ff5a7a' : '#ffd23f'; ctx.shadowBlur = snipe ? 14 : 8;
    ctx.beginPath(); ctx.moveTo(b.x - b.vx / l * tl, b.y - b.vy / l * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // paredes antes dos personagens: evita que a camada de paredes cubra o sprite
  blitView(wallCv, vx0, vy0, vx1 - vx0, vy1 - vy0);

  // jogadores
  // Sem névoa no mapa, todos os adversários vivos são sempre desenhados.
  for (const f of foesOf()) {
    if (!f.al) continue;
    const ie = interpEnemy(f.id) || { x: f.x, y: f.y, a: f.a };
    if (!inView(ie.x, ie.y, 160) && !(spec && f.id === spec.id)) continue;
    if (spec && f.id === spec.id) { ctx.save(); ctx.strokeStyle = jacketOf(f.id); ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 220); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(ie.x, ie.y, 36, 0, TAU); ctx.stroke(); ctx.restore(); }
    drawPlayer(f, ie.x, ie.y, ie.a, false, now); drawHpBar(ie.x, ie.y, f.hp ?? MAX_HP, false); drawName(ie.x, ie.y, f.nm, f.id);   // barras de cura e de carga da lança só aparecem para o próprio jogador
  }
  if (me && me.al) { drawPlayer(me, pred.x, pred.y, aimAngle(), true, now); drawHpBar(pred.x, pred.y, me.hp ?? MAX_HP, true); drawName(pred.x, pred.y, me.nm, me.id); drawHealBar(pred.x, pred.y, me.hz, now); drawChargeBar(pred.x, pred.y, me.ch); }

  // efeitos
  for (const p of fx.parts) {
    if (p.k === 'b') { ctx.fillStyle = '#b3122f'; circle(p.x, p.y, p.sz); }
    else if (p.k === 's') { ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke(); }
    else if (p.k === 'c') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#ffd86b'; ctx.fillRect(-2, -1, 4, 2); ctx.restore(); }
  }
  for (const s of fx.slashes) {
    const wd = WEAPONS[s.w];
    if (!wd || s.w === 'FISTS') continue;
    const sp = Math.min(1, (performance.now() - s.t0) / swDur(s.w)), fade = Math.max(0, 1 - Math.max(0, sp - 0.35) / 0.65);
    if (fade <= 0 || sp < 0.1) continue;
    const pp = s.by === myId ? pred : (interpEnemy(s.by) || s), L = swingLunge(sp) * (s.w === 'SPEAR' ? 5 : 8) * CS;
    ctx.save(); ctx.translate(pp.x + Math.cos(s.a) * L, pp.y + Math.sin(s.a) * L); ctx.rotate(s.a);
    ctx.shadowColor = wd.col; ctx.shadowBlur = 14; ctx.lineCap = 'round';
    if (s.w === 'SPEAR') {   // estocada: rastro reto saindo da ponta
      const tip = wd.range * (0.55 + 0.45 * Math.sin(Math.min(1, sp / 0.5) * Math.PI / 2)), g = ctx.createLinearGradient(wd.range * 0.25, 0, tip, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, wd.col);
      ctx.globalAlpha = fade * 0.85; ctx.strokeStyle = g; ctx.lineWidth = 5 * fade + 1; ctx.beginPath(); ctx.moveTo(wd.range * 0.25, 0); ctx.lineTo(tip, 0); ctx.stroke();
    } else {                 // varrida: meia-lua que acompanha a ponta da arma e some
      const arc = wd.arc, dir = s.dir || 1;
      const head = swingAng(Math.min(sp, 0.62), arc, dir), tail = head - dir * Math.min(1.5, arc * 0.7) * (0.35 + 0.65 * Math.min(1, sp / 0.45));
      const r1 = wd.range * 0.95, r0 = wd.range * 0.5, a0 = Math.min(head, tail), a1 = Math.max(head, tail);
      ctx.globalAlpha = fade * 0.55; ctx.fillStyle = wd.col; ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = fade * 0.95; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.stroke();
    }
    ctx.restore();
  }
  // tetos: cobrem tudo que está dentro da casa (jogadores, armas, tiros) e somem quando EU estou dentro (ou a câmera, se estou espectando)
  if (roofCv) {
    const rs = level.m.roofs, vx = me && me.al ? pred.x : cam.x, vy = me && me.al ? pred.y : cam.y, pad = 14;
    ctx.shadowBlur = 0;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i], x0 = r.x * TILE, y0 = r.y * TILE, w0 = r.w * TILE, h0 = r.h * TILE, inside = vx >= x0 && vx < x0 + w0 && vy >= y0 && vy < y0 + h0;
      roofA[i] += ((inside ? 0 : 1) - roofA[i]) * Math.min(1, dt * 9);
      if (roofA[i] < 0.02) continue;
      const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad), sw = Math.min(roofCv.width - sx, w0 + pad * 2), sh = Math.min(roofCv.height - sy, h0 + pad * 2);
      ctx.globalAlpha = roofA[i]; ctx.drawImage(roofCv, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    ctx.globalAlpha = 1;
  }
  for (const q of fx.pops) {
    const k = 1 - q.t / 0.9; ctx.save(); ctx.globalAlpha = Math.min(1, q.t * 3);
    ctx.font = '400 20px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = q.col;
    ctx.strokeText(q.s, q.x, q.y - k * 26); ctx.fillText(q.s, q.x, q.y - k * 26); ctx.restore();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const l of fx.lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r); g.addColorStop(0, `rgba(${l.c},${Math.min(1, l.t * 9) * 0.6})`); g.addColorStop(1, `rgba(${l.c},0)`);
    ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // Névoa escura desativada; personagens permanecem visíveis.

  // tela
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  if (fx.red > 0) { ctx.fillStyle = `rgba(255,20,60,${fx.red * 0.35})`; ctx.fillRect(0, 0, W, H); }
  if (!paused && me && me.al) drawCrosshair(me);
  updateHud(now);
}
// nome do jogador acima do boneco (só no online)
function drawName(x, y, name, id) {
  if (!name) return;
  ctx.save(); ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10,0,20,.95)'; ctx.fillStyle = jacketOf(id);   // nome na cor do personagem
  ctx.strokeText(name, x, y - 51); ctx.fillText(name, x, y - 51); ctx.restore();
}
function drawHpBar(x, y, hp, mine) {
  const k = Math.max(0, Math.min(1, hp / MAX_HP)), w = 44;
  ctx.fillStyle = 'rgba(8,9,8,.88)'; ctx.fillRect(x - w / 2 - 1.5, y - 49, w + 3, 7);
  ctx.fillStyle = k > 0.3 ? (mine ? '#93aa5c' : '#c4372c') : '#e2a93b'; ctx.fillRect(x - w / 2, y - 47.5, w * k, 4);
  ctx.fillStyle = 'rgba(8,9,8,.9)'; for (let i = 1; i < 4; i++) ctx.fillRect(x - w / 2 + w * i / 4 - 0.5, y - 47.5, 1, 4);
}
// barra de cura: barra verde carregando acima da cabeça
function drawHealBar(x, y, hz, now) {
  if (!(hz > 0)) return;
  const k = Math.max(0, Math.min(1, 1 - hz / HEAL_TIME)), w = 56;
  ctx.save();
  ctx.fillStyle = 'rgba(10,0,20,.9)'; ctx.fillRect(x - w / 2 - 2, y - 84, w + 4, 11);
  ctx.fillStyle = '#7dff8a'; ctx.fillRect(x - w / 2, y - 82, w * k, 7);
  ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#7dff8a';
  ctx.strokeText('CURANDO', x, y - 89); ctx.fillText('CURANDO', x, y - 89);
  ctx.restore();
}
// barra de força do arremesso da lança: quanto mais segura, mais dano (mostra o % que vai tirar)
function drawChargeBar(x, y, ch) {
  if (!(ch >= 0)) return;
  const w = 56, pct = Math.round(SPEAR_THROW_MIN + (SPEAR_THROW_MAX - SPEAR_THROW_MIN) * ch);
  ctx.save();
  ctx.fillStyle = 'rgba(10,0,20,.9)'; ctx.fillRect(x - w / 2 - 2, y - 84, w + 4, 11);
  ctx.fillStyle = `hsl(${Math.round(55 - 55 * ch)},100%,55%)`; ctx.fillRect(x - w / 2, y - 82, w * ch, 7);
  ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
  const t = ch >= 1 ? 'LANÇA MÁXIMA' : 'LANÇA ' + pct + '%'; ctx.strokeText(t, x, y - 89); ctx.fillText(t, x, y - 89);
  ctx.restore();
}
function drawCrosshair(me) {
  const wt = me.w, wd = wt ? WEAPONS[wt] : null, empty = wd && !wd.melee && me.am <= 0;
  const lk = aimBotPoint(me); let cx = mouse.x, cy = mouse.y;
  if (lk) { cx = W / 2 + (lk.dx - cam.x) * Z; cy = H / 2 + (lk.dy - cam.y) * Z; }   // ESPAÇO: mira centrada no inimigo
  ctx.save(); ctx.translate(cx, cy); if (lk) ctx.rotate(performance.now() / 900);
  const col = empty ? '#c4372c' : '#e8e6d8'; ctx.lineCap = 'butt';
  for (const lw of [4, 1.6]) {   // mira tática: quatro traços com vão no centro + ponto
    ctx.strokeStyle = lw === 4 ? 'rgba(0,0,0,.6)' : col; ctx.lineWidth = lw; ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(dx * 6, dy * 6); ctx.lineTo(dx * 14, dy * 14); }
    ctx.stroke();
  }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, TAU); ctx.fill(); ctx.restore();
  if (lk && lk.nm) { ctx.save(); ctx.font = '700 13px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#e2a93b'; ctx.strokeText(lk.nm, cx, cy + 30); ctx.fillText(lk.nm, cx, cy + 30); ctx.restore(); }
}

/* -------------------------------------------------------------------- HUD */
const hudCache = {};
function setHp(id, hp) {
  const p = Math.max(0, Math.round((hp ?? MAX_HP) / MAX_HP * 100));
  setText(id + 't', p + '%');
  if (hudCache[id + 'w'] !== p) { hudCache[id + 'w'] = p; $(id).style.width = p + '%'; $(id).parentNode.classList.toggle('low', p <= 30); }
}
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
let bannerKey = '', rosterKey = '', lobbyKey = '';
// sala de espera online: lista de conectados e botão Iniciar (só o anfitrião)
function updateLobby() {
  const show = mode === 'online' && snap.ph === 'lobby';
  $('lobby').classList.toggle('hidden', !show || paused);
  $('hud').classList.toggle('inlobby', show);
  if (!show) { lobbyKey = ''; return; }
  const isHost = snap.host === myId, n = snap.pl.length, can = isHost && n >= MIN_PLAYERS;
  const key = [snap.host, myId, ...snap.pl.map(p => p.id + ':' + p.nm + ':' + p.sk + ':' + p.cl)].join('|');
  if (key !== lobbyKey) {
    lobbyKey = key;
    $('lobbyCount').textContent = `${n}/${MAX_PLAYERS} conectados`;
    { const lc = $('lobbyCode'); lc.textContent = roomCode; const sm = document.createElement('small'); sm.textContent = 'CÓDIGO DA SALA · toque para copiar o link'; lc.appendChild(sm); }
    const el = $('lobbyList'); el.textContent = '';
    const list = [...snap.pl].sort((a, b) => a.sl - b.sl);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = list[i], row = document.createElement('div');
      if (!p) { row.className = 'lrow empty'; const d0 = document.createElement('i'), n0 = document.createElement('span'); n0.textContent = 'Vaga aberta…'; row.append(d0, n0); el.appendChild(row); continue; }
      row.className = 'lrow' + (p.id === myId ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = p.cl || (SKINS[p.sk] || SKINS.ROOSTER).c;
      const nm = document.createElement('span'); nm.textContent = p.nm + (p.id === myId ? ' (você)' : ''); nm.style.color = p.cl || '';
      row.append(dot, nm);
      if (p.id === snap.host) { const tag = document.createElement('em'); tag.textContent = 'anfitrião'; row.appendChild(tag); }
      el.appendChild(row);
    }
  }
  $('btnStart').disabled = !can;
  setText('lobbyHint', can ? 'Todos prontos? Aperte Iniciar.' : isHost ? `Precisa de pelo menos ${MIN_PLAYERS} jogadores para iniciar.` : 'Aguardando o anfitrião iniciar a partida…');
}
// lista de todos os jogadores com pontuação (vivo / caído)
function updateRoster() {
  const key = snap.rd + '#' + snap.pl.map(p => [p.id, p.nm, p.sc, p.al, p.sl, Math.round(p.hp / MAX_HP * 100)].join(':')).join('|');
  if (key === rosterKey) return; rosterKey = key;
  const el = $('roster'); el.textContent = '';
  const head = document.createElement('div'); head.className = 'rhead'; head.textContent = snap.rd ? `Rodada ${snap.rd} · primeiro a 5` : 'Sala'; el.appendChild(head);
  for (const p of [...snap.pl].sort((a, b) => b.sc - a.sc || a.sl - b.sl)) {
    const row = document.createElement('div'); row.className = 'rrow' + (p.al ? '' : ' dead') + (p.id === myId ? ' me' : '');
    const dot = document.createElement('i'); dot.style.background = jacketOf(p.id, p.id === myId);
    const nm = document.createElement('span'); nm.textContent = p.nm; nm.style.color = jacketOf(p.id);
    const hpv = document.createElement('small'); hpv.textContent = p.al ? Math.max(0, Math.round(p.hp / MAX_HP * 100)) + '%' : '✖';
    const sc = document.createElement('b'); sc.textContent = String(p.sc);
    row.append(dot, nm, hpv, sc); el.appendChild(row);
  }
}
/* ---- inventário (2 espaços) ---- */
const iconCache = {};
function weaponIcon(type) {   // desenha o sprite da arma num canvas temporário, recorta as sobras e devolve uma imagem
  if (iconCache[type]) return iconCache[type];
  const c = document.createElement('canvas'); c.width = 360; c.height = 130;
  const old = ctx; ctx = c.getContext('2d');
  try { ctx.setTransform(3, 0, 0, 3, 110, 65); drawWeaponSprite(type); } finally { ctx = old; }
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return (iconCache[type] = '');
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return (iconCache[type] = o.toDataURL());
}
const slotEls = [0, 1].map(i => { const el = $('slot' + i); return { el, img: el.querySelector('img'), name: el.querySelector('.sn'), ammo: el.querySelector('.sa') }; });
const slotKey = ['', ''];
function updateInv(me) {
  $('invBar').classList.toggle('hidden', !me || !me.al);
  if (!me || !me.al) return;
  const iv = me.iv || [0, 0];
  for (let i = 0; i < 2; i++) {
    const s = iv[i], act = me.se === i, key = (s ? s[0] + ':' + s[1] : '-') + '|' + act;
    if (slotKey[i] === key) continue;
    slotKey[i] = key;
    const E = slotEls[i], wd = s ? WEAPONS[s[0]] : null, gun = !!wd && !wd.melee;
    E.el.classList.toggle('active', act); E.el.classList.toggle('empty', !s);
    E.el.style.setProperty('--wc', wd ? wd.col : 'transparent');
    if (s) { const src = weaponIcon(s[0]); if (E.img.getAttribute('src') !== src) E.img.src = src; }
    E.name.textContent = wd ? wd.name : (act ? 'MÃOS' : 'VAZIO');
    E.ammo.textContent = gun ? `${s[1]} / ${wd.ammo}` : '';
    E.ammo.classList.toggle('low', gun && s[1] <= Math.ceil(wd.ammo * 0.25));
  }
}
// painel de vitais (canto inferior esquerdo): vida segmentada, cura e recarga da rasteira
let vit = null;
function ensureVitals() {
  if (vit) return vit;
  const hud = $('hud'); if (!hud) return null;
  const el = document.createElement('div'); el.id = 'vitals'; el.className = 'hidden';
  el.innerHTML = '<canvas class="v-face" width="112" height="112"></canvas><div class="v-main">' +
    '<div class="v-top"><span class="v-name"></span><span class="v-tag">EM PÉ</span></div>' +
    '<div class="v-hp"><i class="v-ghost"></i><i class="v-fill"></i></div>' +
    '<div class="v-heal"><i></i></div>' +
    '<div class="v-row"><b class="v-num">100</b><span class="v-unit">% VIDA</span>' +
    '</div>' +
    '<div class="v-cd"><i></i></div></div>';
  hud.appendChild(el);
  vit = { el, face: el.querySelector('.v-face'), name: el.querySelector('.v-name'), tag: el.querySelector('.v-tag'), fill: el.querySelector('.v-fill'), ghost: el.querySelector('.v-ghost'),
    heal: el.querySelector('.v-heal'), healI: el.querySelector('.v-heal i'), num: el.querySelector('.v-num'), cdI: el.querySelector('.v-cd i'), c: {} };
  return vit;
}
// rosto da máscara no painel de vida: reaproveita drawHead() num canvas próprio (mesma troca de ctx dos ícones de arma)
function drawFace(cvs, skin, jacket) {
  const old = ctx; ctx = cvs.getContext('2d');
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.setTransform(3.9, 0, 0, 3.9, cvs.width / 2, cvs.height / 2 + 4); ctx.rotate(-Math.PI / 2);
    ctx.translate(-5, 0);
    drawHead(SKINS[skin] ? skin : 'ROOSTER');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = jacket || '#e2a93b'; ctx.fillRect(0, cvs.height - 6, cvs.width, 6);   // faixa na cor da jaqueta
  } finally { ctx = old; }
}
function updateVitals(me) {
  const V = ensureVitals(); if (!V) return;
  const show = !!me && me.al && snap.ph !== 'lobby';
  if (V.c.show !== show) { V.c.show = show; V.el.classList.toggle('hidden', !show); }
  if (!show) return;
  const pct = Math.max(0, Math.round((me.hp ?? MAX_HP) / MAX_HP * 100)), st = pct <= 30 ? 'low' : pct <= 60 ? 'mid' : 'ok';
  if (V.c.pct !== pct) { V.c.pct = pct; V.fill.style.width = pct + '%'; V.ghost.style.width = pct + '%'; V.num.textContent = pct; }
  if (V.c.st !== st) { V.c.st = st; V.el.classList.remove('ok', 'mid', 'low'); V.el.classList.add(st); V.tag.textContent = st === 'low' ? 'CRÍTICO' : st === 'mid' ? 'FERIDO' : 'EM PÉ'; }
  const nm = me.nm || ''; if (V.c.nm !== nm) { V.c.nm = nm; V.name.textContent = nm; }
  const fk = (me.sk || 'ROOSTER') + '|' + jacketOf(me.id);   // retrato da máscara: redesenha só quando muda
  if (V.c.fk !== fk) { V.c.fk = fk; drawFace(V.face, me.sk, jacketOf(me.id)); }
  const hz = me.hz > 0 ? Math.round((1 - me.hz / HEAL_TIME) * 100) : -1;
  if (V.c.hz !== hz) { V.c.hz = hz; V.heal.classList.toggle('on', hz >= 0); if (hz >= 0) V.healI.style.width = hz + '%'; }
  const ready = pslide.cd <= 0, cd = ready ? 100 : Math.round((1 - pslide.cd / SLIDE_CD) * 100);
  if (V.c.cd !== cd) { V.c.cd = cd; V.cdI.style.width = cd + '%'; }
  if (V.c.rd !== ready) { V.c.rd = ready; V.el.classList.toggle('cooling', !ready); }
}
function updateHud(now) {
  if (!snap) return;
  const me = myState();
  updateLobby();
  setText('pingTxt', mode === 'online' ? `${pingMs} ms · ${snap.pl.length}/${MAX_PLAYERS} jogadores` : 'treino · offline');
  updateRoster();
  if (me) {
    updateInv(me);
    updateVitals(me);
    { const sp = canSpec() ? specTarget() : null; $('spectate').classList.toggle('hidden', !sp); if (sp) { setText('specName', sp.nm); $('specName').style.color = jacketOf(sp.id); } }

  }
  // banner
  let t = '', s = '', cls = '';
  const mySlot = me ? me.sl : 0;
  switch (snap.ph) {
    case 'waiting': t = 'Aguardando'; s = `Esperando jogadores (${snap.pl.length}/${MAX_PLAYERS}). A partida começa com ${MIN_PLAYERS} ou mais.`; break;
    case 'countdown': t = String(Math.max(1, Math.ceil(snap.tm))); s = `Rodada ${snap.rd} · ${MAPS[snap.map] ? MAPS[snap.map].name : ''}`; break;
    case 'live': if (now < goUntil) t = 'Vai!'; break;
    case 'over':
      if (snap.win === -1) { t = 'Empate'; s = 'Todos caíram.'; }
      else if (snap.win === mySlot) { t = 'Rodada sua'; cls = 'win'; s = 'Prepare-se para a próxima.'; }
      else { const w = snap.pl.find(p => p.sl === snap.win); t = 'Você morreu'; cls = 'lose'; s = (w ? w.nm + ' venceu a rodada. ' : '') + 'Prepare-se para a próxima.'; }
      break;
    case 'matchover':
      if (snap.win === mySlot) { t = 'Vitória!'; cls = 'win'; } else { t = 'Derrota'; cls = 'lose'; }
      { const w = snap.pl.find(p => p.sl === snap.win); s = `${w ? w.nm + ' venceu a partida · ' : ''}${mode === 'online' ? 'voltando para a sala…' : 'nova partida em instantes'}`; } break;
  }
  const res = snap.ph === 'matchover' ? [...snap.pl].sort((a, b) => b.sc - a.sc || (b.kl | 0) - (a.kl | 0) || a.sl - b.sl).map(p => p.id + ':' + p.nm + ':' + p.sc + ':' + (p.kl | 0)).join('|') : '';
  const key = t + '|' + s + '|' + cls + '|' + res;
  const b = $('banner');
  if (key !== bannerKey) {
    bannerKey = key;
    if (!t) b.classList.add('hidden');
    else {
      b.classList.remove('hidden', 'win', 'lose'); if (cls) b.classList.add(cls);
      $('bTitle').textContent = t; $('bSub').textContent = s;
      const rl = $('bResults'); rl.textContent = '';
      if (snap.ph === 'matchover') {   // fim da partida: abates de cada jogador
        const hd = document.createElement('div'); hd.className = 'rr rh'; hd.innerHTML = '<span>JOGADOR</span><span>ABATES</span>'; rl.appendChild(hd);
        for (const p of [...snap.pl].sort((a, b) => b.sc - a.sc || (b.kl | 0) - (a.kl | 0) || a.sl - b.sl)) {
          const row = document.createElement('div'); row.className = 'rr' + (p.sl === snap.win ? ' w' : '');
          const nm = document.createElement('span'); nm.textContent = p.nm; nm.style.color = jacketOf(p.id);
          const kl = document.createElement('b'); kl.textContent = String(p.kl | 0);
          row.append(nm, kl); rl.appendChild(row);
        }
      }
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

/* ------------------------------------------------ ABERTURA: cavaleiro mascarado atravessando a noite
   Tudo desenhado em canvas (sem arquivos). ESPAÇO (ou Enter / clique no aviso) pula direto para o menu. */
const introEl = $('intro'), icv = $('introCv'), ic = icv.getContext('2d');
let iW = 0, iH = 0, iD = 1, introOn = true, introT = 0, introLast = performance.now(), sunCv = null, sunR = 0, introDust = [];
const INTRO_LEN = 15.5, iC01 = x => Math.max(0, Math.min(1, x)), iEase = x => { x = iC01(x); return x * x * (3 - 2 * x); };
function iResize() { iD = Math.min(window.devicePixelRatio || 1, 2); iW = innerWidth; iH = innerHeight; icv.width = Math.floor(iW * iD); icv.height = Math.floor(iH * iD); sunCv = null; }
addEventListener('resize', iResize); iResize();

function buildSun(r) {
  sunR = r; sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = Math.ceil(r * 2);
  const c = sunCv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, r * 2);
  g.addColorStop(0, '#ffe600'); g.addColorStop(0.55, '#ff7a59'); g.addColorStop(1, '#ff2e97');
  c.fillStyle = g; c.beginPath(); c.arc(r, r, r, 0, TAU); c.fill();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) c.fillRect(0, r + i * (r / 8), r * 2, (2 + i * 1.6) * r / 90);   // faixas do sol
}
const hillY = (u, base, amp, f1, f2) => base - (Math.sin(u * f1) * amp + Math.sin(u * f2 + 1.7) * amp * 0.5 + Math.sin(u * f1 * 3.1) * amp * 0.12);
function hillLayer(off, base, amp, f1, f2, col, trees, S) {
  ic.beginPath(); ic.moveTo(0, iH);
  for (let x = 0; x <= iW + 6; x += 6) ic.lineTo(x, hillY(x + off, base, amp, f1, f2));
  ic.lineTo(iW, iH); ic.closePath(); ic.fillStyle = col; ic.fill();
  if (!trees) return;
  const step = 64 * S;   // pinheiros em silhueta
  for (let wx = Math.floor(off / step) * step; wx < off + iW + step; wx += step) {
    const k = hash(Math.round(wx / step), 7); if (k < 0.45) continue;
    const u = wx + k * 20 * S, sx = u - off, y = hillY(u, base, amp, f1, f2), th = (34 + k * 46) * S;
    ic.fillStyle = col; ic.beginPath();
    ic.moveTo(sx, y - th); ic.lineTo(sx + th * 0.26, y - th * 0.35); ic.lineTo(sx + th * 0.14, y - th * 0.35); ic.lineTo(sx + th * 0.32, y); ic.lineTo(sx - th * 0.32, y);
    ic.lineTo(sx - th * 0.14, y - th * 0.35); ic.lineTo(sx - th * 0.26, y - th * 0.35); ic.closePath(); ic.fill();
  }
}

const H_FILL = '#0e0618', H_RIM = 'rgba(255,70,170,.8)';
function horseLeg(c, hx, hy, ph, rear) {
  const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
  const a1 = Math.PI / 2 - 0.85 * sw * (rear ? 0.9 : 1), l1 = 38, l2 = 40;
  const kx = hx + Math.cos(a1) * l1, ky = hy + Math.sin(a1) * l1;
  const a2 = a1 + (rear ? -(0.35 + lift * 0.9) : (0.1 + lift * 1.25));
  const ex = kx + Math.cos(a2) * l2, ey = ky + Math.sin(a2) * l2;
  for (const [col, lw] of [[H_RIM, 9.5], [H_FILL, 7]]) { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.moveTo(hx, hy); c.lineTo(kx, ky); c.lineTo(ex, ey); c.stroke(); }
  c.fillStyle = H_FILL; c.beginPath(); c.ellipse(ex + 2, ey + 1, 6, 4, 0, 0, TAU); c.fill(); c.strokeStyle = H_RIM; c.lineWidth = 1; c.stroke();
  return [ex, ey];
}
function drawRider(c, g, t) {
  c.lineJoin = 'round'; c.lineCap = 'round';
  const wob = (k, a, p = 0) => Math.sin(t * k + p) * a;
  const fill = (path, col = H_FILL, rim = true) => { c.fillStyle = col; c.fill(path); if (rim) { c.strokeStyle = H_RIM; c.lineWidth = 1.3; c.stroke(path); } };
  // pernas de trás (mais escuras, ficam atrás do corpo)
  const hooves = [horseLeg(c, -38, 14, g + 3.0, true), horseLeg(c, 44, 14, g + 0.5, false)];
  // cauda
  c.strokeStyle = H_RIM; c.lineWidth = 12; c.beginPath(); c.moveTo(-60, -10); c.bezierCurveTo(-92, -6 + wob(9, 8), -112, 16 + wob(8, 10, 1), -134, 40 + wob(7, 14, 2)); c.stroke();
  c.strokeStyle = H_FILL; c.lineWidth = 9; c.stroke();
  // corpo
  let p = new Path2D(); p.ellipse(0, 0, 64, 27, 0, 0, TAU); fill(p);
  p = new Path2D(); p.ellipse(-40, 3, 29, 27, 0, 0, TAU); fill(p);
  p = new Path2D(); p.ellipse(41, -2, 26, 27, 0, 0, TAU); fill(p);
  // pescoço e cabeça
  p = new Path2D(); p.moveTo(30, -26); p.quadraticCurveTo(62, -36, 92, -64); p.lineTo(106, -50); p.quadraticCurveTo(72, -10, 48, 16); p.closePath(); fill(p);
  p = new Path2D(); p.ellipse(110, -50, 25, 11, 0.62, 0, TAU); fill(p);
  p = new Path2D(); p.moveTo(94, -66); p.lineTo(99, -86); p.lineTo(107, -68); p.closePath(); fill(p);
  c.fillStyle = '#ff9ad0'; c.beginPath(); c.arc(112, -56, 2.1, 0, TAU); c.fill();
  // crina ao vento
  c.strokeStyle = H_FILL; c.lineWidth = 4;
  for (let i = 0; i < 9; i++) { const u = i / 8, px = 36 + u * 58, py = -28 - u * 36; c.beginPath(); c.moveTo(px, py); c.lineTo(px - 16 + wob(14, 4, i), py + 6 + wob(11, 3, i * 2)); c.stroke(); }
  // perna da frente, mais perto (desenhada por cima)
  hooves.push(horseLeg(c, 50, 14, g, false), horseLeg(c, -32, 14, g + 2.2, true));

  // capa (cor do jogador) esvoaçando
  p = new Path2D(); p.moveTo(2, -62); p.bezierCurveTo(-34, -64 + wob(12, 6), -78, -52 + wob(10, 10, 1), -118, -34 + wob(9, 12, 2));
  p.bezierCurveTo(-84, -26 + wob(11, 8, 3), -40, -30, -4, -34); p.closePath();
  c.fillStyle = '#10c6e8'; c.fill(p); c.strokeStyle = 'rgba(8,2,18,.85)'; c.lineWidth = 1.5; c.stroke(p);
  // perna do cavaleiro
  c.strokeStyle = 'rgba(8,2,18,.9)'; c.lineWidth = 10.5; c.beginPath(); c.moveTo(2, -30); c.lineTo(24, -8); c.lineTo(16, 14); c.stroke();
  c.strokeStyle = '#34508f'; c.lineWidth = 7.5; c.stroke();
  c.fillStyle = '#f4f1ea'; c.beginPath(); c.ellipse(19, 16, 7, 4, 0, 0, TAU); c.fill();
  // tronco inclinado para a frente
  c.save(); c.translate(6, -46); c.rotate(0.38);
  c.fillStyle = '#10c6e8'; c.strokeStyle = 'rgba(8,2,18,.9)'; c.lineWidth = 1.8; c.beginPath(); c.ellipse(0, 0, 11, 20, 0, 0, TAU); c.fill(); c.stroke();
  c.strokeStyle = '#efe6d0'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, -15); c.lineTo(-6, 15); c.stroke(); c.restore();
  // braço segurando as rédeas
  c.strokeStyle = 'rgba(8,2,18,.9)'; c.lineWidth = 8; c.beginPath(); c.moveTo(14, -56); c.lineTo(38, -42); c.lineTo(60, -36); c.stroke();
  c.strokeStyle = '#10c6e8'; c.lineWidth = 5.4; c.stroke();
  c.fillStyle = '#f0c39a'; c.beginPath(); c.arc(62, -35, 3.6, 0, TAU); c.fill();
  c.strokeStyle = '#ffd23f'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(62, -35); c.quadraticCurveTo(92, -26, 118, -40); c.stroke();
  // cachecol vermelho voando
  c.strokeStyle = '#ff2e4d'; c.lineWidth = 5; c.beginPath(); c.moveTo(10, -64); c.bezierCurveTo(-12, -62 + wob(15, 4), -30, -70 + wob(13, 6, 1), -52, -58 + wob(11, 8, 2)); c.stroke();
  // cabeça com máscara de galo
  c.fillStyle = '#ffd23f'; c.strokeStyle = 'rgba(8,2,18,.95)'; c.lineWidth = 2; c.beginPath(); c.arc(16, -74, 11, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#ff2e4d'; for (const [bx, by, br] of [[8, -84, 4.4], [14, -87, 4.8], [20, -85, 4]]) { c.beginPath(); c.arc(bx, by, br, 0, TAU); c.fill(); c.stroke(); }
  c.fillStyle = '#ff9a2b'; c.beginPath(); c.moveTo(25, -78); c.lineTo(38, -73); c.lineTo(25, -69); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#0b0710'; c.beginPath(); c.ellipse(20, -77, 2.6, 3, 0, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(20.8, -77, 1.2, 0, TAU); c.fill();
  return hooves;
}

function drawIntro(t, dt) {
  const W = iW, H = iH, S = Math.max(0.7, Math.min(1.6, H / 720)), speed = 300 * S, sc = t * speed;
  const gy = H * 0.86, horizon = H * 0.78;
  ic.setTransform(iD, 0, 0, iD, 0, 0);
  // câmera: aproximação lenta
  const z = 1 + iC01(t / INTRO_LEN) * 0.07;
  ic.setTransform(iD * z, 0, 0, iD * z, iD * W * 0.38 * (1 - z), iD * H * 0.62 * (1 - z));
  // céu
  let g = ic.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#0a0214'); g.addColorStop(0.28, '#14041f'); g.addColorStop(0.58, '#3a0a5e'); g.addColorStop(0.82, '#b3126b'); g.addColorStop(1, '#ff7a59');
  ic.fillStyle = g; ic.fillRect(-40, -40, W + 80, H + 80);
  for (let i = 0; i < 110; i++) {   // estrelas
    const sx = hash(i, 3) * W, sy = hash(i, 5) * horizon * 0.62, tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(i, 9) * 3) + i);
    ic.fillStyle = `rgba(255,255,255,${0.25 + 0.7 * tw * (1 - sy / horizon)})`; ic.fillRect(sx, sy, 1.6, 1.6);
  }
  // sol de faixas
  const R = H * 0.2; if (!sunCv || Math.abs(sunR - R) > 1) buildSun(R);
  const sxn = W * 0.7, syn = H * 0.5;
  g = ic.createRadialGradient(sxn, syn, R * 0.6, sxn, syn, R * 2.4); g.addColorStop(0, 'rgba(255,90,140,.45)'); g.addColorStop(1, 'rgba(255,90,140,0)');
  ic.fillStyle = g; ic.fillRect(sxn - R * 2.4, syn - R * 2.4, R * 4.8, R * 4.8);
  ic.drawImage(sunCv, sxn - R, syn - R);
  // linhas de velocidade
  ic.strokeStyle = 'rgba(255,220,240,.18)'; ic.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) { const ly = hash(i, 11) * horizon, len = (60 + hash(i, 13) * 140) * S, lx = W - (((t * (700 + hash(i, 17) * 600) * S) + hash(i, 19) * W * 2) % (W * 1.6)) + 80; ic.beginPath(); ic.moveTo(lx, ly); ic.lineTo(lx + len, ly); ic.stroke(); }
  // colinas em paralaxe
  hillLayer(sc * 0.06, H * 0.62, H * 0.07, 0.004, 0.011, '#2a0b46', false, S);
  hillLayer(sc * 0.18, H * 0.70, H * 0.045, 0.006, 0.017, '#1d0735', true, S);
  hillLayer(sc * 0.45, H * 0.77, H * 0.03, 0.007, 0.02, '#12041f', true, S);
  // chão
  g = ic.createLinearGradient(0, horizon + 4, 0, H); g.addColorStop(0, '#1a0430'); g.addColorStop(1, '#07010d');
  ic.fillStyle = g; ic.fillRect(-40, horizon + 4, W + 80, H);
  ic.strokeStyle = 'rgba(255,46,151,.55)'; ic.lineWidth = 2; ic.beginPath(); ic.moveTo(-40, horizon + 5); ic.lineTo(W + 40, horizon + 5); ic.stroke();
  // capim rápido no chão
  ic.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const depth = hash(i, 23), y = horizon + 12 + depth * (H - horizon - 12), sp = speed * (0.9 + depth * 1.6), x = (((hash(i, 29) * (W + 240)) - t * sp) % (W + 240) + (W + 240)) % (W + 240) - 120, h = (6 + depth * 18) * S;
    ic.strokeStyle = depth > 0.6 ? 'rgba(255,70,170,.5)' : 'rgba(0,229,255,.28)'; ic.lineWidth = 1 + depth * 1.6;
    ic.beginPath(); ic.moveTo(x, y); ic.lineTo(x - 3 * S, y - h); ic.stroke();
  }
  // cavalo e cavaleiro
  const rx = W * 0.36 + Math.sin(t * 0.7) * 14 * S, gait = t * 11, hoofLift = Math.abs(Math.sin(gait)) * 5;
  ic.save(); ic.translate(rx, gy - 92 * S - hoofLift * S); ic.scale(S * 1.12, S * 1.12);
  ic.fillStyle = 'rgba(0,0,0,.35)';
  ic.save(); ic.translate(0, 92 + hoofLift); ic.scale(1, 0.16); ic.beginPath(); ic.arc(0, 0, 90, 0, TAU); ic.fill(); ic.restore();   // sombra
  ic.rotate(Math.sin(gait + 0.6) * 0.03);
  drawRider(ic, gait, t);
  ic.restore();
  // poeira dos cascos
  for (let i = 0; i < 2; i++) introDust.push({ x: rx - 50 * S + (Math.random() - 0.5) * 60 * S, y: gy - 2 * S, vx: -speed * (0.8 + Math.random() * 0.4), vy: -(8 + Math.random() * 40) * S, life: 0.7 + Math.random() * 0.5, max: 1.2, r: (4 + Math.random() * 7) * S });
  for (const d of introDust) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.r += 9 * dt * S; }
  introDust = introDust.filter(d => d.life > 0);
  for (const d of introDust) { ic.fillStyle = `rgba(255,150,210,${Math.max(0, d.life / d.max) * 0.28})`; ic.beginPath(); ic.arc(d.x, d.y, d.r, 0, TAU); ic.fill(); }

  // ---- por cima de tudo (sem câmera) ----
  ic.setTransform(iD, 0, 0, iD, 0, 0);
  const vg = ic.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,0,16,.6)');
  ic.fillStyle = vg; ic.fillRect(0, 0, W, H);
  ic.textAlign = 'center'; ic.textBaseline = 'middle';
  const line = (txt, t0, t1, y) => {
    const a = iEase((t - t0) / 0.6) * (1 - iEase((t - (t1 - 0.6)) / 0.6)); if (a <= 0) return;
    ic.save(); ic.globalAlpha = a; ic.font = `700 ${Math.round(Math.max(18, H * 0.042))}px Rajdhani, sans-serif`; if ('letterSpacing' in ic) ic.letterSpacing = '8px';
    ic.lineWidth = 5; ic.strokeStyle = 'rgba(0,0,0,.85)'; ic.strokeText(txt, W / 2, y + (1 - a) * 10); ic.fillStyle = '#ffd1ea'; ic.fillText(txt, W / 2, y + (1 - a) * 10); ic.restore();
  };
  line('A NOITE CAIU.', 2.4, 4.8, H * 0.27);
  line('E UM SÓ VAI SAIR DE PÉ.', 5.0, 7.2, H * 0.27);
  // título
  const k = iEase((t - 7.4) / 0.5);
  if (k > 0) {
    const cx = W / 2, cy = H * 0.3, fs = Math.min(W * 0.1, H * 0.14), sc2 = 1 + (1 - k) * 0.9;
    ic.save(); ic.translate(cx, cy + Math.sin(t * 2) * 3); ic.scale(sc2, sc2); ic.globalAlpha = k;
    ic.font = `400 ${fs}px Bungee, Impact, sans-serif`; ic.lineJoin = 'round';
    ic.fillStyle = '#7a2cff'; ic.fillText('7', 5, -fs * 0.55 + 5);
    ic.fillStyle = '#00e5ff'; ic.shadowColor = '#00e5ff'; ic.shadowBlur = 30; ic.fillText('7', 0, -fs * 0.55); ic.shadowBlur = 0;
    ic.fillStyle = '#ffe600'; ic.fillText('SHADOWS', 5, fs * 0.55 + 5);
    ic.fillStyle = '#ff2e97'; ic.shadowColor = '#ff2e97'; ic.shadowBlur = 30; ic.fillText('SHADOWS', 0, fs * 0.55); ic.shadowBlur = 0;
    ic.restore();
    const a2 = iEase((t - 8.6) / 0.8);
    if (a2 > 0) { ic.save(); ic.globalAlpha = a2; ic.font = `700 ${Math.round(Math.max(16, H * 0.034))}px Rajdhani, sans-serif`; ic.fillStyle = '#ffe600'; ic.lineWidth = 4; ic.strokeStyle = '#000'; const s2 = 'Entre pela porta e faça a sua jogada.'; ic.strokeText(s2, cx, H * 0.3 + fs * 1.35); ic.fillText(s2, cx, H * 0.3 + fs * 1.35); ic.restore(); }
  }
  if (t >= 7.4 && t < 7.85) { ic.fillStyle = `rgba(255,255,255,${(1 - (t - 7.4) / 0.45) * 0.7})`; ic.fillRect(0, 0, W, H); }
  // faixas de cinema
  const bar = H * 0.09 * iEase(t / 1.2); ic.fillStyle = '#000'; ic.fillRect(0, 0, W, bar); ic.fillRect(0, H - bar, W, bar);
  // fade de entrada e de saída
  const fade = Math.max(1 - iC01(t / 1.2), iC01((t - (INTRO_LEN - 0.9)) / 0.9));
  if (fade > 0) { ic.fillStyle = `rgba(0,0,0,${fade})`; ic.fillRect(0, 0, W, H); }
}
function introFrame(now) {
  if (!introOn) return;
  requestAnimationFrame(introFrame);
  const dt = Math.min(0.05, (now - introLast) / 1000); introLast = now; introT += dt;
  drawIntro(introT, dt);
  if (introT >= INTRO_LEN) endIntro();
}
function endIntro() {
  if (!introOn) return; introOn = false;
  const m = $('menu'); m.classList.remove('hidden'); m.classList.add('enter');
  introEl.classList.add('out'); setTimeout(() => introEl.classList.add('hidden'), 750);
}
addEventListener('keydown', e => { if (introOn && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); endIntro(); } }, true);
addEventListener('keyup', e => { if (e.key === ' ' && performance.now() - introSkipAt < 400) e.preventDefault(); });
let introSkipAt = 0;
$('introSkip').onclick = () => { introSkipAt = performance.now(); endIntro(); };
introLast = performance.now(); requestAnimationFrame(introFrame);

/* ------------------------------------------------ MENU: música e personagem secreto */
$('btnMusic').onclick = () => showTab('music');
$('btnMusicBack').onclick = () => showTab('play');

// explosão de partículas douradas ao desbloquear
const mfx = $('menuFx'), mctx = mfx.getContext('2d');
let mfW = 0, mfH = 0, bursts = [], mfRun = false, mfLast = 0;
function mfResize() { mfW = mfx.width = innerWidth; mfH = mfx.height = innerHeight; }
addEventListener('resize', mfResize); mfResize();
function menuBurst() {
  const cx = mfW / 2, cy = mfH * 0.4;
  for (let i = 0; i < 140; i++) { const a = Math.random() * TAU, sp = 90 + Math.random() * 520; bursts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.2 + Math.random() * 1.2, max: 2.4, r: 1.5 + Math.random() * 3, col: Math.random() < 0.5 ? '255,230,0' : Math.random() < 0.5 ? '255,46,151' : '0,229,255' }); }
  if (!mfRun) { mfRun = true; mfLast = performance.now(); requestAnimationFrame(menuBurstLoop); }
}
function menuBurstLoop(now) {
  const dt = Math.min(0.05, (now - mfLast) / 1000); mfLast = now;
  mctx.clearRect(0, 0, mfW, mfH); mctx.globalCompositeOperation = 'lighter';
  for (const b of bursts) {
    b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 220 * dt; b.vx *= Math.pow(0.35, dt);
    const r = b.r * 4, g = mctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r); g.addColorStop(0, `rgba(${b.col},${Math.max(0, b.life / b.max) * 0.9})`); g.addColorStop(1, `rgba(${b.col},0)`);
    mctx.fillStyle = g; mctx.fillRect(b.x - r, b.y - r, r * 2, r * 2);
  }
  mctx.globalCompositeOperation = 'source-over';
  bursts = bursts.filter(b => b.life > 0);
  if (bursts.length) requestAnimationFrame(menuBurstLoop); else { mfRun = false; mctx.clearRect(0, 0, mfW, mfH); }
}

// Sequência secreta no menu: W, A, S, D e depois ESPAÇO
const SECRET = ['w', 'a', 's', 'd', ' '];
let secIdx = 0, secAt = 0, swallowSpace = false, unlockTimer = 0;
function secDots() { [...$('seqDots').children].forEach((d, i) => d.classList.toggle('on', i < secIdx)); }
function unlockSecret() {
  cfg.secret = true; cfg.skin = 'DRAGON'; saveCfg(); buildSkins();
  initAudio(); sfx('unlock'); menuBurst();
  const u = $('unlock'); u.classList.remove('show'); void u.offsetWidth; u.classList.add('show');
  clearTimeout(unlockTimer); unlockTimer = setTimeout(() => u.classList.remove('show'), 4500);
}
addEventListener('keydown', e => {
  if (mode || introOn || $('menu').classList.contains('hidden') || e.repeat) return;
  const tg = e.target && e.target.tagName;
  if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, now = performance.now();
  if (now - secAt > 2500) secIdx = 0;
  secAt = now;
  if (k === SECRET[secIdx]) secIdx++; else secIdx = k === SECRET[0] ? 1 : 0;
  secDots();
  if (secIdx === SECRET.length) {
    secIdx = 0; if (e.key === ' ') { e.preventDefault(); swallowSpace = true; }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setTimeout(secDots, 700); unlockSecret();
  }
});
addEventListener('keyup', e => { if (swallowSpace && e.key === ' ') { e.preventDefault(); swallowSpace = false; } });

// Esc: só pausa quando o menu inicial NÃO está aberto
addEventListener('keydown', e => {
  if (e.key === 'Escape' && mode && $('menu').classList.contains('hidden')) { e.preventDefault(); setPaused(!paused); }
}, true);
