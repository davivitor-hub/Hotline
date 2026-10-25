'use strict';
/* ==========================================================================
   7 SHADOWS — cliente
   Online 1v1 (servidor autoritativo + predição/reconciliação) ou treino vs bot
   (a mesma simulação roda localmente). Estilo Hotline Miami: um tiro = morte.
   ========================================================================== */
const { TILE, PR, CS, WEAPONS, MAPS, Level, Game, Bot, stepMove, ITEM_EXT, canMove, angDiff, DOWN_TIME, MAX_HP, HEAL_PCT, HEAL_TIME, HEAL_SLOW, maxHpOf, healTimeOf, hasActive, cadMulOf, ACT_CD, activeCdOf, canHold, hasHook, hasDual, dualFwdOf, HOOK_RANGE, HOOK_STOP, MAX_PLAYERS, MIN_PLAYERS, randomColor, SPEAR_THROW_MIN, SPEAR_THROW_MAX, itemDist, itemDistOn, PICK_R, SW_REACH, isBottle, DOOR_HT, sanitizeRoomCfg } = Shared;
const $ = id => document.getElementById(id);
// celular/tablet: tela de toque sem mouse (ou ?touch=1 para testar no PC)
const IS_TOUCH = /[?&]touch=1/.test(location.search) || matchMedia('(hover:none) and (pointer:coarse)').matches;

// Servidor do jogo. Se a página vem de http(s), usa a mesma origem (qualquer domínio/VPS/localhost).
// Só preencha SERVER_HOST se o front-end ficar em outro lugar (ex.: 'meujogo.com.br').
const SERVER_HOST = '';
const SAME_ORIGIN = location.protocol.startsWith('http') && !SERVER_HOST;
const SERVER_URL = SAME_ORIGIN ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : 'wss://' + SERVER_HOST;
if (!SAME_ORIGIN && SERVER_HOST) { try { fetch('https://' + SERVER_HOST + '/health', { mode: 'no-cors' }); } catch { } }

const STEP = 1 / 60, TAU = Math.PI * 2;
const HOOK_FX_T = 260;   // ms que o gancho que errou leva para sumir
const BLAST_T = 450;   // ms que a onda de choque da ativa leva para abrir e sumir
const SKINS = {
  HERO: { c: '#8b5e34', n: 'Shadow 4' }, ROOSTER: { c: '#ffd23f', n: 'Galo' }, TIGER: { c: '#34343f', n: 'Shadow 7' }, BEAR: { c: '#a9794f', n: 'Urso' },
  MONKEY: { c: '#b28cff', n: 'Macaco' }, WOLF: { c: '#9fb4c8', n: 'Lobo' }, GORILLA: { c: '#3e4049', n: 'Shadow 2' }, FISH: { c: '#3fc8ff', n: 'Peixe' }
};

/* --------------------------------------------------------------- CONFIG */
function loadCfg() { try { return JSON.parse(localStorage.getItem('7shadows') || localStorage.getItem('neonduel') || '{}'); } catch { return {}; } }
const cfg = Object.assign({ name: '', skin: 'HERO', secret: false, diff: 'NORMAL', music: true, track: 'hidrogenio', vol: 0.6, sfx: true, shake: true, crt: false, shakeAmt: 1, kick: true, zoom: 1, ping: true, sfxVol: 1, binds: {}, room: null }, loadCfg());
cfg.room = sanitizeRoomCfg(cfg.room);   // últimas configurações de sala usadas (validadas)
function saveCfg() { try { localStorage.setItem('7shadows', JSON.stringify(cfg)); } catch { } }
const clampN = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d);
cfg.shakeAmt = clampN(cfg.shakeAmt, 0.1, 1.5, 1); cfg.zoom = clampN(cfg.zoom, 0.7, 1.4, 1); cfg.sfxVol = clampN(cfg.sfxVol, 0, 1, 1);
cfg.kick = cfg.kick !== false; cfg.ping = cfg.ping !== false;
if (cfg.skin === 'HIPPO') cfg.skin = 'GORILLA';   // o hipopótamo virou o gorila Shadow 2
if (!SKINS[cfg.skin]) cfg.skin = 'HERO';   // skin salva que não existe mais volta para o padrão

/* ---------------------------------------------------------------- ESTADO */
const cv = $('game'); let ctx = cv.getContext('2d', { alpha: false });   // let: os ícones do inventário desenham as armas num canvas temporário
let dpr = 1, S = 1, Z = 1, W = innerWidth, H = innerHeight;
let mode = null, ws = null, myId = null, local = null, paused = false, pingMs = 0, pingTimer = null;
let level = null, mapId, round = -1, snap = null, snapAt = 0, buf = [], pending = [], seq = 0, first = true;
let pred = { x: 0, y: 0 }, cam = { x: 0, y: 0 }, camInit = false;
let keys = {}, mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, right: false }, edge = { fp: false, pk: false, it: false, th: false, hl: false, sw: false, ss: 0, sl: false, em: false };
const roomMax = () => (snap && snap.cf ? snap.cf[2] : MAX_PLAYERS);   // vagas da sala (escolhidas na criação)
const roomWin = () => (snap && snap.cf ? snap.cf[0] : 5);            // rodadas para vencer
const fmtDur = s => (s % 60 === 0 ? (s / 60) + ' min' : s + ' s');
let shake = 0, zoomKick = 0, hitstop = 0, goUntil = 0;
let fx = { parts: [], lights: [], slashes: [], blasts: [], hooks: [], corpses: [], pops: [], flash: 0, red: 0 };
// predição dos MEUS tiros (online): o tiro aparece na hora do clique; quando o do servidor chega, ele é escondido para não duplicar
let pend2 = 0, pbul = [], pshots = [], hiddenB = new Set(), knownB = new Set(), gotShot = 0, pcd = 0, pbuf = 0;
let anim = {}, levelCv = null, wallCv = null, decal = null, dctx = null, roofCv = null, roofA = [], roomD = [], canA = {}, poolFurn = [], fountainFurn = [];   // roomD = escuridão atual de cada cômodo (0 = aceso, 1 = apagado, animada); roofA = opacidade atual de cada teto (1 = fechado, 0 = você está dentro)
const INTERP = () => (mode === 'local' ? 34 : 50);   // online: snapshots a 60 Hz → ~3 amostras de buffer

let dprCap = 1.5;   // teto da resolução interna (a qualidade dinâmica baixa isso se o FPS cair)
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, dprCap); W = innerWidth; H = innerHeight;
  cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
  S = Math.max(IS_TOUCH ? 0.4 : 0.7, Math.min(1.6, H / 780)) * cfg.zoom;
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
    sfxG = ac.createGain(); sfxG.gain.value = 0.55 * cfg.sfxVol; sfxG.connect(master);
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

/* ---- música do MENU (File Select): começa quando a abertura termina, em loop; para quando a partida começa e volta ao voltar pro menu.
   Sempre toca (não dá pra desativar). Fica fora da lista de trilhas da partida (não aparece na aba Músicas, não entra no revezamento, N não troca para ela). */
const MENU_MUSIC = ['music/file-select.mp3', 'file-select.mp3', 'Zelda__Ocarina_Of_Time_Music_-_File_SelectMP3_160K.mp3', 'music/Zelda__Ocarina_Of_Time_Music_-_File_SelectMP3_160K.mp3'];
const menuBgm = new Audio(), menuBgm2 = new Audio(), MENU_EL = [menuBgm, menuBgm2], MENU_XF = 4;   // dois players em revezamento: o fim de um some enquanto o começo do outro sobe (sem corte, não parece loop)
for (const el of MENU_EL) { el.loop = false; el.preload = 'auto'; }
let menuMusicOK = false, menuWant = false, menuTry = 0, menuGain = 1, menuFadeT = 0;
menuBgm.src = menuBgm2.src = MENU_MUSIC[0];
menuBgm.addEventListener('error', () => { if (++menuTry < MENU_MUSIC.length) menuBgm.src = menuBgm2.src = MENU_MUSIC[menuTry]; });
const menuPlay = el => { const pr = el.play(); if (pr && pr.catch) pr.catch(() => { }); };
function menuMix() {
  const base = Math.max(0.15, cfg.vol) * menuGain;   // não desliga pela opção Música nem pela tecla M (só o volume mexe, com piso)
  const both = MENU_EL.every(e => !e.paused);   // só há sobreposição durante a passagem de uma cópia para a outra
  for (const el of MENU_EL) {
    const d = el.duration, t = el.currentTime;
    const ok = Number.isFinite(d) && d > MENU_XF * 2;
    const f = !ok ? 1 : Math.min(both ? Math.min(1, t / MENU_XF) : 1, Math.max(0, (d - t) / MENU_XF));
    el.volume = Math.max(0, Math.min(1, base * f));
  }
}
setInterval(() => {
  if (!menuWant) return;
  const on = MENU_EL.filter(e => !e.paused), off = MENU_EL.filter(e => e.paused);
  if (!on.length) { menuPlay(menuBgm); return; }
  const a = on[0], d = a.duration;
  if (off.length && Number.isFinite(d) && d - a.currentTime < MENU_XF) { off[0].currentTime = 0; menuPlay(off[0]); }
  for (const e of MENU_EL) if (!e.paused && Number.isFinite(e.duration) && e.currentTime >= e.duration - 0.05) { e.pause(); e.currentTime = 0; }
  menuMix();
}, 100);
for (const el of MENU_EL) el.addEventListener('ended', () => { el.currentTime = 0; if (menuWant && MENU_EL.every(e => e.paused)) menuPlay(el); });   // tenta a pasta music/, a raiz e o nome original
function menuMusicPlay() {
  if (!menuMusicOK || musicOn || (menuWant && MENU_EL.some(e => !e.paused))) return;   // já tocando: não reinicia o fade
  menuWant = true; menuGain = 0; applyMusic();
  clearInterval(menuFadeT); menuFadeT = setInterval(() => { menuGain = Math.min(1, menuGain + 0.05); applyMusic(); if (menuGain >= 1) clearInterval(menuFadeT); }, 60);   // sobe o volume em ~1,2 s
}
function menuMusicStop() { menuWant = false; clearInterval(menuFadeT); for (const el of MENU_EL) { el.pause(); el.currentTime = 0; } }
// se o arquivo não for achado, tenta o próximo caminho possível (pasta music/, raiz, nome original)
bgm.addEventListener('error', () => {
  const t = curTrack(); if (!t.file || bgmLoaded !== t.id) return;
  if (++bgmTry < t.file.length) { bgm.src = t.file[bgmTry]; if (musicOn) { const pr = bgm.play(); if (pr && pr.catch) pr.catch(() => { }); } }
  else { bgmLoaded = null; $('nowPlaying').innerHTML = '⚠ arquivo de música não encontrado'; $('nowPlaying').classList.remove('hidden'); status('Música não encontrada: ' + t.file[0]); }
});
function applyMusic() {
  const t = curTrack();
  bgm.volume = cfg.music ? cfg.vol : 0;
  menuMix();
  if (menuWant) { if (MENU_EL.every(e => e.paused)) menuPlay(menuBgm); }
  else for (const el of MENU_EL) if (!el.paused) el.pause();
  if (musG) musG.gain.value = (cfg.music && musicOn && !t.file) ? 0.17 * cfg.vol / 0.6 : 0;
}
function playTrack() {
  const t = curTrack(); musicOn = true; menuMusicStop();
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
function stopTrack() { musicOn = false; bgm.pause(); applyMusic(); refreshTracks(); if (menuMusicOK && !$('menu').classList.contains('hidden')) menuMusicPlay(); }   // parou a prévia no menu: volta a música do menu
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
    case 'coin':   // peteleco + moeda girando no ar + plim ao cair na água
      osc(d, 'square', 1500, t, 0.03, 0.18 * v); osc(d, 'triangle', 1800, t + 0.12, 0.45, 0.2 * v, 2700);
      [2200, 2500, 2200, 2500, 2200].forEach((fq, i) => osc(d, 'sine', fq, t + 0.22 + i * 0.1, 0.05, 0.07 * v));
      nz(d, t + 0.77, 0.22, 0.35 * v, 'bandpass', 1500); osc(d, 'sine', 900, t + 0.77, 0.16, 0.3 * v, 420); break;
    // sons da fonte (só quem jogou a moeda escuta). Abençoados = brilhantes e subindo; amaldiçoados = graves e descendo; nada = sopro suave.
    case 'fx_spd': [784, 988, 1175, 1568, 1976].forEach((fq, i) => { osc(d, 'triangle', fq, t + i * 0.05, 0.28, 0.2); osc(d, 'sine', fq * 2, t + i * 0.05, 0.2, 0.06); }); nz(d, t, 0.3, 0.12, 'highpass', 4500); break;   // varrida de brilho (vento)
    case 'fx_arm': [523, 659, 784].forEach(fq => { osc(d, 'triangle', fq, t, 0.9, 0.17); osc(d, 'sine', fq / 2, t, 0.9, 0.12); }); osc(d, 'sine', 2093, t + 0.05, 0.5, 0.09); osc(d, 'sine', 3136, t + 0.12, 0.4, 0.05); break;   // acorde quente de escudo com sininho
    case 'fx_rof': for (let i = 0; i < 7; i++) osc(d, 'square', 600 + i * 130, t + i * 0.045, 0.05, 0.07); osc(d, 'triangle', 1568, t + 0.33, 0.35, 0.16); break;   // bolhinhas rápidas subindo + plim
    case 'fx_slow': [494, 415, 330, 247].forEach((fq, i) => osc(d, 'sine', fq, t + i * 0.14, 0.45, 0.22)); osc(d, 'triangle', 124, t, 0.8, 0.12, 82); nz(d, t, 0.5, 0.08, 'lowpass', 500); break;   // sino descendo, pesado
    case 'fx_frag': [2093, 1760, 1397].forEach((fq, i) => osc(d, 'triangle', fq, t + i * 0.06, 0.25, 0.1, fq * 0.7)); osc(d, 'sine', 110, t, 0.35, 0.28, 55); nz(d, t, 0.12, 0.2, 'highpass', 3500); break;   // vidro trincando + baque grave
    case 'fx_rus': osc(d, 'triangle', 440, t, 0.8, 0.2, 110); osc(d, 'sine', 466, t + 0.03, 0.8, 0.12, 116); osc(d, 'sine', 55, t, 0.8, 0.15); break;   // escorregada desafinada para baixo
    case 'fx_none': nz(d, t, 0.25, 0.12, 'lowpass', 900); osc(d, 'sine', 330, t, 0.3, 0.1, 220); break;   // sopro suave: nada aconteceu
    case 'power':   // quadro de energia baleado: estalo elétrico + faíscas + a casa "desligando" (queda grave) + três notinhas descendo
      nz(d, t, 0.1, 0.9 * v, 'highpass', 3500); osc(d, 'square', 1900, t, 0.09, 0.35 * v, 260);
      [0.07, 0.12, 0.2, 0.27].forEach(o => nz(d, t + o, 0.035, 0.4 * v, 'bandpass', 2600 + o * 4000));
      osc(d, 'sine', 90, t + 0.03, 0.3, 0.85 * v, 32);
      osc(d, 'sawtooth', 620, t + 0.1, 0.85, 0.22 * v, 45); osc(d, 'sine', 310, t + 0.1, 0.85, 0.35 * v, 30);
      [784, 587, 392].forEach((f, i) => osc(d, 'triangle', f, t + 0.16 + i * 0.13, 0.35, 0.22 * v, f * 0.92));
      break;
    case 'splash': nz(d, t, 0.3, 0.55 * v, 'bandpass', 1300); nz(d, t + 0.04, 0.22, 0.3 * v, 'highpass', 2800); osc(d, 'sine', 460, t, 0.14, 0.18 * v, 150); osc(d, 'sine', 300, t + 0.08, 0.12, 0.12 * v, 120); break;
    case 'dive': nz(d, t, 0.22, 0.5 * v, 'lowpass', 900); osc(d, 'sine', 420, t, 0.2, 0.3 * v, 120); [0.04, 0.1, 0.17].forEach((o, i) => osc(d, 'sine', 700 + i * 180, t + o, 0.07, 0.14 * v, 1100 + i * 200));   // glub + bolhinhas
    case 'surface': if (n === 'surface') { nz(d, t, 0.3, 0.5 * v, 'bandpass', 1600); nz(d, t + 0.05, 0.2, 0.28 * v, 'highpass', 3000); osc(d, 'sine', 300, t, 0.16, 0.18 * v, 640); } break;
    case 'drown': osc(d, 'sine', 260, t, 0.7, 0.5 * v, 60); [0, 0.1, 0.2, 0.32, 0.46].forEach((o, i) => osc(d, 'sine', 500 + i * 90, t + o, 0.09, 0.2 * v, 900 + i * 120)); nz(d, t, 0.5, 0.4 * v, 'lowpass', 700); break;
    case 'heal': osc(d, 'sine', 520, t, 0.25, 0.5 * v, 1040); osc(d, 'triangle', 780, t + 0.08, 0.25, 0.35 * v, 1560); break;
  }
}

/* ---------------------------------------------------------------- MENU/UI */
$('nameInput').value = cfg.name; $('diffSel').value = cfg.diff;
$('optMusic').checked = cfg.music; $('optSfx').checked = cfg.sfx; $('optShake').checked = cfg.shake; $('optCrt').checked = cfg.crt;
document.body.classList.toggle('nocrt', !cfg.crt);
$('optMusic').onchange = e => { cfg.music = e.target.checked; applyMusic(); refreshTracks(); saveCfg(); };
$('optSfx').onchange = e => { cfg.sfx = e.target.checked; saveCfg(); };
$('optShake').onchange = e => { cfg.shake = e.target.checked; saveCfg(); };
$('optCrt').onchange = e => { cfg.crt = e.target.checked; document.body.classList.toggle('nocrt', !cfg.crt); saveCfg(); };
$('nameInput').oninput = e => { cfg.name = e.target.value; saveCfg(); };
$('diffSel').onchange = e => { cfg.diff = e.target.value; saveCfg(); };
/* ---------------------------------------------------- CONFIG DA SALA */
const rc = { map: $('rcMap'), win: $('rcWin'), time: $('rcTime'), max: $('rcMax'), weap: $('rcWeap'), heal: $('rcHeal') };
(function buildRoomCfg() {
  const add = (sel, v, t) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; sel.appendChild(o); };
  add(rc.map, '', 'Aleatória');
  for (const id of Shared.MAP_IDS) add(rc.map, id, MAPS[id].name);
  for (const n of [1, 2, 3, 5, 7, 10]) add(rc.win, n, n === 1 ? '1 rodada' : n + ' rodadas');
  add(rc.time, 0, 'Sem limite');
  for (const s of [30, 60, 90, 120, 180, 300]) add(rc.time, s, fmtDur(s));
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) add(rc.max, n, n + ' jogadores');
  add(rc.weap, 0.5, 'Poucas'); add(rc.weap, 1, 'Normais'); add(rc.weap, 2, 'Muitas');
})();
function loadRoomCfg() {
  const r = cfg.room;
  rc.map.value = r.map; rc.win.value = String(r.winScore); rc.time.value = String(r.roundTime);
  rc.max.value = String(r.maxPlayers); rc.weap.value = String(r.weapons); rc.heal.checked = r.heal;
}
const readRoomCfg = () => sanitizeRoomCfg({ map: rc.map.value, winScore: rc.win.value, roundTime: rc.time.value, maxPlayers: rc.max.value, weapons: rc.weap.value, heal: rc.heal.checked });
function closeRoomCfg() { $('roomCfg').classList.add('hidden'); }
$('btnCreateRoom').onclick = () => { initAudio(); loadRoomCfg(); $('roomCfg').classList.remove('hidden'); };
$('btnRcBack').onclick = closeRoomCfg;
$('btnRcCreate').onclick = () => { cfg.room = readRoomCfg(); saveCfg(); closeRoomCfg(); startOnline({ mode: 'create', cfg: cfg.room }); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('roomCfg').classList.contains('hidden')) closeRoomCfg(); });
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
/* ---------------------------------------------------- CONFIG VS BOT */
const MAX_BOTS = MAX_PLAYERS - 1;   // o humano ocupa 1 vaga
const bc = { diff: $('bcDiff'), map: $('bcMap'), count: $('bcCount'), win: $('bcWin'), time: $('bcTime'), weap: $('bcWeap'), heal: $('bcHeal') };
(function buildBotCfg() {
  const add = (sel, v, t) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; sel.appendChild(o); };
  add(bc.diff, 'EASY', 'Fácil'); add(bc.diff, 'NORMAL', 'Normal'); add(bc.diff, 'HARD', 'Difícil');
  add(bc.map, '', 'Aleatória');
  for (const id of Shared.MAP_IDS) add(bc.map, id, MAPS[id].name);
  for (let n = 0; n <= MAX_BOTS; n++) add(bc.count, n, n === 0 ? '0 (treino livre)' : n === 1 ? '1 bot' : n + ' bots');
  for (const n of [1, 2, 3, 5, 7, 10]) add(bc.win, n, n === 1 ? '1 rodada' : n + ' rodadas');
  add(bc.time, 0, 'Sem limite');
  for (const s of [30, 60, 90, 120, 180, 300]) add(bc.time, s, fmtDur(s));
  add(bc.weap, 0.5, 'Poucas'); add(bc.weap, 1, 'Normais'); add(bc.weap, 2, 'Muitas');
})();
function sanitizeBotCfg(b) {
  b = b || {};
  const r = sanitizeRoomCfg({ map: b.map, winScore: b.winScore, roundTime: b.roundTime, weapons: b.weapons, heal: b.heal });
  const n = Number(b.count);
  return { diff: ['EASY', 'NORMAL', 'HARD'].includes(b.diff) ? b.diff : 'NORMAL', count: Number.isInteger(n) && n >= 0 && n <= MAX_BOTS ? n : 1,
    map: r.map, winScore: r.winScore, roundTime: r.roundTime, weapons: r.weapons, heal: r.heal };
}
cfg.bot = sanitizeBotCfg(cfg.bot || { diff: cfg.diff });
function loadBotCfg() {
  const r = cfg.bot;
  bc.diff.value = r.diff; bc.map.value = r.map; bc.count.value = String(r.count); bc.win.value = String(r.winScore);
  bc.time.value = String(r.roundTime); bc.weap.value = String(r.weapons); bc.heal.checked = r.heal;
  updBotNote();
}
const readBotCfg = () => sanitizeBotCfg({ diff: bc.diff.value, map: bc.map.value, count: bc.count.value, winScore: bc.win.value, roundTime: bc.time.value, weapons: bc.weap.value, heal: bc.heal.checked });
function updBotNote() { const z = bc.count.value === '0'; $('bcNote').textContent = z ? 'Com 0 bots você treina sozinho: a rodada não termina e o tempo máximo é ignorado.' : 'Se o tempo da rodada acabar, vence quem estiver com mais vida.'; bc.time.disabled = z; }
bc.count.onchange = updBotNote;
const closeBotCfg = () => $('botCfg').classList.add('hidden');
$('btnBot').onclick = () => { initAudio(); loadBotCfg(); $('botCfg').classList.remove('hidden'); };
$('btnBcBack').onclick = closeBotCfg;
$('btnBcStart').onclick = () => { cfg.bot = readBotCfg(); cfg.diff = cfg.bot.diff; $('diffSel').value = cfg.diff; saveCfg(); closeBotCfg(); startLocal(cfg.bot); };
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('botCfg').classList.contains('hidden')) closeBotCfg(); });
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
function showMenu(msg) { stopTrack(); menuMusicPlay(); $('menu').classList.remove('hidden'); $('pause').classList.add('hidden'); $('lobby').classList.add('hidden'); $('hud').classList.add('hidden'); $('banner').classList.add('hidden'); status(msg || ''); }
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
  const m = which === 'music', sh = which === 'shadows', shEl = $('tabShadows');
  $('tabPlay').classList.toggle('hidden', m || sh); $('tabMusic').classList.toggle('hidden', !m);
  if (shEl) { shEl.classList.toggle('hidden', !sh); if (sh) buildShadows(); }
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

/* --------------------------------------------------- OPÇÕES + TECLAS */
// o id de cada ação é a sua tecla padrão; cfg.binds guarda só o que o jogador trocou
const ACTIONS = [
  { id: 'w', label: 'Andar para cima' }, { id: 's', label: 'Andar para baixo' }, { id: 'a', label: 'Andar para a esquerda' }, { id: 'd', label: 'Andar para a direita' },
  { id: ' ', label: 'Ativa' }, { id: 'e', label: 'Pegar arma' }, { id: 'v', label: 'Interagir (garrafa / luz / fonte)' }, { id: 'f', label: 'Arremessar' }, { id: 'q', label: 'Curar' }, { id: 'g', label: 'Emote (dançar)' },
  { id: '1', label: 'Arma do espaço 1' }, { id: '2', label: 'Arma do espaço 2' },
  { id: 'shift', label: 'Soltar / estender a câmera' },
  { id: 'control', label: 'Apontar a arma p/ a cabeça (segurar) + clique' },
  { id: 'm', label: 'Mutar música' }, { id: 'n', label: 'Trocar de música' }
];
const KEYNAMES = { ' ': 'ESPAÇO', shift: 'SHIFT', control: 'CTRL', alt: 'ALT', tab: 'TAB', enter: 'ENTER', capslock: 'CAPS LOCK', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', backspace: 'BACKSPACE' };
const keyName = k => KEYNAMES[k] || k.toUpperCase();
const NOBIND = k => k === 'escape' || /^f\d{1,2}$/.test(k) || ['meta', 'os', 'contextmenu', 'dead', 'unidentified', 'process'].includes(k);
const bindOf = id => cfg.binds[id] || id;
let rev = {};
function rebuildRev() {
  rev = {};
  for (const a of ACTIONS) rev[bindOf(a.id)] = a.id;
  for (const [ak, id] of [['arrowup', 'w'], ['arrowleft', 'a'], ['arrowdown', 's'], ['arrowright', 'd']]) if (!(ak in rev)) rev[ak] = id;   // setas continuam andando
}
(function sanitizeBinds() {   // config antiga/corrompida: só aceita teclas válidas e sem repetição
  const b = (cfg.binds && typeof cfg.binds === 'object') ? cfg.binds : {}, out = {}, used = new Set();
  for (const a of ACTIONS) { const k = typeof b[a.id] === 'string' && b[a.id] ? b[a.id].toLowerCase() : a.id; if (NOBIND(k) || used.has(k)) { cfg.binds = {}; rebuildRev(); return; } used.add(k); if (k !== a.id) out[a.id] = k; }
  cfg.binds = out; rebuildRev();
})();
let capId = null;
function refreshKeys() {
  const list = $('keyList'); if (list) {
    list.textContent = '';
    for (const a of ACTIONS) {
      const row = document.createElement('div'); row.className = 'krow';
      const lb = document.createElement('span'); lb.textContent = a.label;
      const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'kbtn' + (capId === a.id ? ' cap' : '');
      bt.textContent = capId === a.id ? 'APERTE UMA TECLA…' : keyName(bindOf(a.id));
      bt.onclick = () => { capId = capId === a.id ? null : a.id; refreshKeys(); };
      row.append(lb, bt); list.appendChild(row);
    }
  }
  const k1 = $('slot0') && $('slot0').querySelector('.k'), k2 = $('slot1') && $('slot1').querySelector('.k');
  if (k1) k1.textContent = keyName(bindOf('1')); if (k2) k2.textContent = keyName(bindOf('2'));
  const hint = $('hintMusicKeys');
  if (hint) hint.innerHTML = 'Durante a partida, aperte <kbd>' + keyName(bindOf('n')) + '</kbd> para trocar de faixa e <kbd>' + keyName(bindOf('m')) + '</kbd> para mutar.';
}
function assignKey(id, k) {
  const old = bindOf(id), other = ACTIONS.find(a => a.id !== id && bindOf(a.id) === k);
  if (other) cfg.binds[other.id] = old;   // tecla já usada: as duas trocam de lugar
  cfg.binds[id] = k;
  for (const a of ACTIONS) if (cfg.binds[a.id] === a.id) delete cfg.binds[a.id];
  keys = {}; rebuildRev(); saveCfg();
}
// captura de tecla e Esc dentro das Opções (fase de captura: roda antes do resto do jogo)
addEventListener('keydown', e => {
  if ($('opts').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (capId !== null) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (k === 'escape') capId = null; else if (!NOBIND(k)) { assignKey(capId, k); capId = null; } else return;
    refreshKeys(); return;
  }
  if (k === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); closeOpts(); }
}, true);
function showOptTab(keysTab) {
  capId = null; $('optGeneral').classList.toggle('hidden', keysTab); $('optKeysPane').classList.toggle('hidden', !keysTab);
  $('otabGeneral').setAttribute('aria-selected', keysTab ? 'false' : 'true'); $('otabKeys').setAttribute('aria-selected', keysTab ? 'true' : 'false');
  if (keysTab) refreshKeys();
}
function openOpts() { initAudio(); showOptTab(false); $('opts').classList.remove('hidden'); }
function closeOpts() { capId = null; $('opts').classList.add('hidden'); }
$('btnOptions').onclick = openOpts; $('btnOptsPause').onclick = openOpts; $('btnOptsClose').onclick = closeOpts;
$('otabGeneral').onclick = () => showOptTab(false); $('otabKeys').onclick = () => showOptTab(true);
$('btnKeysReset').onclick = () => { cfg.binds = {}; keys = {}; capId = null; rebuildRev(); saveCfg(); refreshKeys(); };
function bindRange(id, get, set, fmt) {
  const el = $(id), out = $(id + 'V'); el.value = get();
  const show = () => { out.textContent = fmt(+el.value); }; show();
  el.oninput = () => { set(+el.value); show(); saveCfg(); };
}
const syncShake = () => { $('optShakeAmt').disabled = !cfg.shake; };
$('optShake').onchange = e => { cfg.shake = e.target.checked; if (!cfg.shake) shake = 0; syncShake(); saveCfg(); };
$('optKick').checked = cfg.kick; $('optKick').onchange = e => { cfg.kick = e.target.checked; saveCfg(); };
$('optPing').checked = cfg.ping; $('netHud').classList.toggle('hidden', !cfg.ping);
$('optPing').onchange = e => { cfg.ping = e.target.checked; $('netHud').classList.toggle('hidden', !cfg.ping); saveCfg(); };
bindRange('optShakeAmt', () => Math.round(cfg.shakeAmt * 100), v => { cfg.shakeAmt = v / 100; }, v => v + '%'); syncShake();
bindRange('optZoom', () => Math.round(cfg.zoom * 100), v => { cfg.zoom = v / 100; resize(); }, v => v + '%');
bindRange('optSfxVol', () => Math.round(cfg.sfxVol * 100), v => { cfg.sfxVol = v / 100; if (sfxG) sfxG.gain.value = 0.55 * cfg.sfxVol; }, v => v + '%');
bindRange('optVol', () => Math.round(cfg.vol * 100), v => { cfg.vol = v / 100; $('volRange').value = v; applyMusic(); }, v => v + '%');
$('volRange').oninput = e => { cfg.vol = e.target.value / 100; $('optVol').value = e.target.value; $('optVolV').textContent = e.target.value + '%'; saveCfg(); applyMusic(); };
refreshKeys();
refreshTracks();
const playerName = () => (cfg.name || '').trim() || 'Shadow 4';

/* ------------------------------------------------------------ CONEXÃO */
function closeAll() {
  if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { } ws = null; }
  clearInterval(pingTimer); local = null; mode = null; snap = null; level = null; mapId = undefined; round = -1; buf = []; pending = [];
  paused = false; camInit = false; resetFx(); $('pause').classList.add('hidden');
  $('roundTimer').classList.add('hidden');
}
let roomCode = '';
function startOnline(opt = { mode: 'quick' }) {
  closeAll(); mode = 'online'; roomCode = ''; status('Conectando ao servidor…');
  try { ws = new WebSocket(SERVER_URL); } catch { mode = null; return status('Endereço do servidor inválido.'); }
  const sock = ws;
  sock.onopen = () => {
    sock.send(JSON.stringify({ type: 'join', name: playerName(), skin: cfg.skin, mode: opt.mode, room: opt.room || '', cfg: opt.cfg || null }));
    pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'ping', t: performance.now() })); }, 2000);
  };
  sock.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') myId = m.id;
    else if (m.type === 'joined') { roomCode = m.room || ''; hideMenu(); }
    else if (m.type === 'full') { closeAll(); showMenu('A sala está cheia.'); }
    else if (m.type === 'noroom') { closeAll(); showMenu('Sala não encontrada. Confira o código.'); }
    else if (m.type === 'busy') { closeAll(); showMenu('O servidor está com o máximo de salas abertas. Tente de novo em instantes.'); }
    else if (m.type === 's') onSnapshot(m);
    else if (m.type === 'pong') pingMs = Math.round(performance.now() - m.t);
  };
  sock.onerror = () => { if (mode === 'online' && !snap) status('Falha de conexão. O servidor está ligado?'); };
  sock.onclose = () => { const had = !!snap; closeAll(); showMenu(had ? 'Conexão perdida com o servidor.' : 'Não foi possível conectar. O servidor pode estar iniciando, tente de novo em 30 s.'); };
}
function startLocal(o) {
  o = sanitizeBotCfg(o);
  closeAll(); mode = 'local'; myId = 'me';
  const g = new Game({ autoStart: true, map: o.map, winScore: o.winScore, roundTime: o.roundTime, maxPlayers: Math.max(MIN_PLAYERS, o.count + 1), weapons: o.weapons, heal: o.heal, solo: o.count === 0 });
  const me = g.addPlayer('me', playerName(), cfg.skin);
  const pool = Object.keys(SKINS).filter(k => k !== cfg.skin).sort(() => Math.random() - 0.5);
  const label = { EASY: 'fácil', NORMAL: 'normal', HARD: 'difícil' }[o.diff] || '';
  const bots = [];
  for (let i = 0; i < o.count; i++) {
    const p = g.addPlayer('bot' + i, 'BOT ' + (o.count > 1 ? (i + 1) + ' ' : '') + label, pool[i % pool.length]);
    if (!p) break;
    p.bot = true; bots.push(new Bot(g, p.slot, o.diff));
  }
  local = { g, me, bots, t: 0 };
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
  fx = { parts: [], lights: [], slashes: [], blasts: [], hooks: [], corpses: [], pops: [], flash: 0, red: 0 };
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
  pool(c, w, h) { /* a piscina é pixel art animada: desenhada em quadros por drawPool() */ },
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
  lounger(c, w, h) {   // espreguiçadeira (serve na horizontal e na vertical)
    c.save(); if (h > w) { c.translate(w, 0); c.rotate(Math.PI / 2); const t = w; w = h; h = t; }
    rrect(c, 3, 7, w - 6, h - 14, 7, '#f4f0e6', OUT, 1.6);
    rrect(c, 8, 11, w * .30, h - 22, 5, '#f2b640', OUT, 1);
    rrect(c, 8 + w * .30 + 4, 11, w - 16 - w * .30 - 4, h - 22, 5, '#3fa7d6', OUT, 1);
    c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(8 + w * .30 + 9, 15, w - 26 - w * .30, 2);
    c.restore();
  },
  patio(c, w, h) {   // mesa de jardim (visto de cima). O ombrelone em si é desenhado POR CIMA dos personagens (drawCanopy), para dar pra entrar debaixo dele.
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 2;
    c.fillStyle = 'rgba(0,0,0,.14)'; c.beginPath(); c.ellipse(cx + 4, cy + 5, R, R * .94, 0, 0, TAU); c.fill();   // sombra suave no chão
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + Math.PI / 4; dot(c, cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, 7, '#9a6b3a', OUT, 1.2); }   // cadeiras
    dot(c, cx, cy, 13, '#c99a62', OUT, 1.6); dot(c, cx, cy, 9, '#e8c78f'); dot(c, cx, cy, 3.2, '#8a5a30');
  },
  flowers(c, w, h) {   // canteiro de flores
    rrect(c, 3, 6, w - 6, h - 12, 9, '#8a5a30', OUT);
    rrect(c, 7, 10, w - 14, h - 20, 6, '#4a2c18');
    const cols = ['#ff7aa8', '#ffd84a', '#ffffff', '#b98cf0', '#ff8a4a'], n = Math.max(4, Math.round((w - 14) / 14)), seed = (w * 3 + h) | 0;
    for (let i = 0; i < n; i++) {
      const px = 12 + (i + .5) / n * (w - 24) + (hash(i, seed) - .5) * 6, py = h / 2 + (hash(seed, i) - .5) * (h - 30);
      dot(c, px - 5, py + 3, 4, '#2f9a4a'); dot(c, px + 5, py + 3, 4, '#3fb85c');
      dot(c, px, py, 5.5, cols[i % cols.length], 'rgba(40,20,10,.5)', 1); dot(c, px, py, 1.8, '#fff3a8');
    }
  },
  doghouse(c, w, h) {   // casinha de cachorro + tigela
    rrect(c, 3, 5, w * .62, h - 10, 4, '#b5523b', OUT, 1.8);
    c.fillStyle = 'rgba(0,0,0,.26)'; c.fillRect(3 + w * .31 - 2, 7, 4, h - 14);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(3 + w * .31 - 2, 7, 2, h - 14);
    dot(c, w * .82, h / 2, 9, '#d9d4c8', OUT, 1.2); dot(c, w * .82, h / 2, 6, '#c0392b'); dot(c, w * .82, h / 2, 3, '#7a4a2a');
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
  fountain(c, w, h, f) {   // fonte em pixel art: a base (quadro 0) vai no piso; a água animada é desenhada por drawFountain()
    c.save(); c.imageSmoothingEnabled = false;
    c.drawImage(fountainFrames(((f && f.w) || 3) * 10)[0], 0, 0, w, h);
    c.restore();
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
  // as portas (fachada e internas) ficam sob o teto: quem está fora da casa não as vê
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
  poolFurn = m.furn.filter(f => f.k === 'pool'); fountainFurn = m.furn.filter(f => f.k === 'fountain');
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
  mapId = s.map; round = s.rd; buf = []; pending = []; first = true; resetFx(); roomD = []; canA = {};
  if (s.map) { level = new Level(s.map); buildStatic(); } else { level = null; levelCv = null; roofCv = null; roofA = []; }
}
function onSnapshot(s) {
  const now = performance.now();
  if (s.map !== mapId || s.rd !== round) newRound(s);
  snap = s; snapAt = now;
  { const cm = {}; for (const p of s.pl) cm[p.id] = p.cl || colorMap[p.id] || randomColor([...Object.values(cm), ...Object.values(colorMap)]); colorMap = cm; }
  gotShot = 0; pend2 = 0;
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
    const t = { x: me.x, y: me.y, skin: me.sk, dualOn: !!me.dm, slowT: me.sn || 0, wt: me.w, fxSpd: me.fs || 1 };
    if (me.hk) { pending = []; pred.x = me.x; pred.y = me.y; first = false; }   // puxado pelo gancho: segue a posição do servidor
    else if (canMove(s.ph, me.al, me.dn, me.hz > 0)) for (const p of pending) stepMove(level, t, p.k, p.dt, p.sm);
    const err = Math.hypot(t.x - pred.x, t.y - pred.y);
    if (me.hk) { /* já posicionado acima */ }
    else if (first || err > 40) { pred.x = t.x; pred.y = t.y; first = false; }
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
function addShake(v) { if (cfg.shake) { const a = cfg.shakeAmt; shake = Math.min(18 * a, shake + v * a); } }
function handleEvent(e, now) {
  switch (e.t) {
    case 'shot': {
      if (!e.pred && e.by === myId && mode === 'online') {
        if (e.n && pend2 > 0) { pend2--; gotShot++; break; }   // 2º tiro da salva dupla: já mostrei os dois na hora do clique
        if (pshots.length) { pshots.shift(); gotShot++; if (e.dn) pend2++; break; }   // já mostrei esse tiro na hora do clique
      }
      sfx(e.w, e.x, e.y);
      if (e.w === 'ORB') { animOf(e.by).recoil = 0; addShake(e.by === myId ? 3 : 1); break; }   // soco do gorila: sem clarão de cano nem cápsula
      const wdx = WEAPONS[e.w], mz = ((wdx && wdx.muz) || 30) + (e.d || 0), mx = e.x + Math.cos(e.a) * mz, my = e.y + Math.sin(e.a) * mz;
      fx.lights.push({ x: mx, y: my, t: e.w === 'SNIPER' ? 0.14 : 0.08, r: e.w === 'SNIPER' ? 260 : 170, c: e.w === 'SNIPER' ? '255,120,150' : '255,225,130' });
      for (let i = 0; i < (e.w === 'SNIPER' ? 9 : 4); i++) fx.parts.push({ k: 's', x: mx, y: my, vx: Math.cos(e.a + (Math.random() - .5)) * 300, vy: Math.sin(e.a + (Math.random() - .5)) * 300, life: 0.08, sz: 6, col: '#ffe9a0' });
      const ca = e.a + Math.PI / 2 + (Math.random() - .5);
      fx.parts.push({ k: 'c', x: e.x, y: e.y, vx: Math.cos(ca) * 120, vy: Math.sin(ca) * 120, rot: Math.random() * 6, vr: 20, life: 0.5 });
      animOf(e.by).recoil = 1;
      addShake(e.by === myId ? ({ SNIPER: 9, SHOTGUN: 7, REVOLVER: 5, RIFLE: 4, MINIGUN: 1.8 }[e.w] || 2.5) : 1.2);
      break;
    }
    case 'swap': sfx('swap', e.x, e.y); break;
    case 'dualeq': sfx('swap', e.x, e.y); if (e.id === myId) addPop(e.x, e.y - 30, e.on ? 'DUPLA LIGADA' : 'DUPLA DESLIGADA', e.on ? '#ffd27a' : '#c9b3e0'); break;   // ATIVA do Shadow 7: liga / desliga o modo dupla
    case 'dualno': sfx('click', e.x, e.y); if (e.id === myId) addPop(e.x, e.y - 30, 'PRECISA DE 2 ARMAS DO MESMO TIPO', '#ff8aa8'); break;   // ativa do Shadow 7 recusada: não tem o par de armas
    case 'hookeq': sfx('swap', e.x, e.y); if (e.on && e.id === myId) addPop(e.x, e.y - 30, 'GANCHO NA MÃO', '#9fe6ff'); break;   // ATIVA do Shadow 4: saca / guarda o gancho
    case 'hook': {   // clique do Shadow 4: lança o gancho (errou = corda curta que some)
      sfx('swing', e.x, e.y); sfx('swap', e.x, e.y);
      if (e.miss) fx.hooks.push({ x: e.x, y: e.y, a: e.a, l: e.l > 0 ? e.l : 300, t0: now });
      else if (e.wall) { addPop(e.x, e.y - 30, 'GANCHO!', '#9fe6ff'); addShake(e.id === myId ? 2 : 1); }
      else { addPop(e.x, e.y - 30, 'PUXA!', '#9fe6ff'); addShake(e.id === myId ? 3 : 1.5); }
      break;
    }
    case 'shatter': {   // garrafa de vinho quebrou (bateu na parede): cacos de vidro, respingo de vinho e som
      sfx('glass', e.x, e.y);
      for (let i = 0; i < 16; i++) { const a = e.a + Math.PI + (Math.random() - .5) * 2.4, sp = 120 + Math.random() * 300; fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.25, sz: 3, col: Math.random() < 0.6 ? '#dff5e6' : '#8b1a2f' }); }
      if (dctx) { for (let i = 0; i < 7; i++) { dctx.fillStyle = 'rgba(110,18,42,.6)'; dctx.beginPath(); dctx.arc(e.x + Math.cos(e.a + Math.PI) * (6 + Math.random() * 26) + (Math.random() - .5) * 18, e.y + Math.sin(e.a + Math.PI) * (6 + Math.random() * 26) + (Math.random() - .5) * 18, 2 + Math.random() * 5, 0, TAU); dctx.fill(); } }
      fx.lights.push({ x: e.x, y: e.y, t: 0.12, r: 90, c: '210,255,225' });
      addPop(e.x, e.y - 24, 'QUEBROU!', '#cfe9d8'); addShake(e.by === myId ? 3 : 1.5);
      break;
    }
    case 'blast': {   // ATIVA: explosão em área em volta de quem sacrificou a vida
      sfx('kill', e.x, e.y); sfx('door', e.x, e.y);
      fx.blasts.push({ x: e.x, y: e.y, r: e.r, t0: now });
      fx.lights.push({ x: e.x, y: e.y, t: 0.35, r: e.r * 1.6, c: '255,70,50' });
      for (let i = 0; i < 28; i++) { const a = Math.random() * TAU, sp = 160 + Math.random() * 380; fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.28 + Math.random() * 0.2, sz: 4, col: Math.random() < 0.5 ? '#ff6a3c' : '#ffd27a' }); }
      addPop(e.x, e.y - 30, 'ATIVA ' + e.d, '#ff4a3c');
      addShake(e.id === myId ? 11 : 6);
      if (e.id === myId) fx.red = Math.max(fx.red, 0.3);
      break;
    }
    case 'swing': {
      const st = animOf(e.by); st.sw0 = now; st.sw = e.w; st.punch *= -1; st.dc = e.dc != null ? e.dc : -1;
      sfx('swing', e.x, e.y);
      fx.slashes.push({ x: e.x, y: e.y, a: e.a, t: 1, w: e.w, by: e.by, dir: st.punch, t0: now, dc: st.dc });
      break;
    }
    case 'kill': {
      if (e.how === 'drown') {   // afogado: sem sangue, só bolhas e o corpo boiando
        sfx('drown', e.x, e.y); addPop(e.x, e.y - 22, 'AFOGADO!', '#6fd8ff');
        for (let i = 0; i < 26; i++) { const a = Math.random() * TAU, v = 15 + Math.random() * 90; fx.parts.push({ k: 'o', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life: 0.7 + Math.random() * 0.9, sz: 2 + Math.random() * 4 }); }
        fx.corpses.push({ x: e.x, y: e.y, a: e.a, sk: e.sk, vx: 0, vy: 0, mine: e.id === myId, col: jacketOf(e.id, e.id === myId), dk: e.dk });
        addShake(4); if (e.id === myId) fx.red = 0.4;
        break;
      }
      sfx('kill', e.x, e.y);
      if (e.how === 'suicide') addPop(e.x, e.y - 22, 'SUICÍDIO', '#ff2e4d');
      const big = e.how === 'exec' || e.how === 'blade' || e.how === 'blast';
      addBlood(e.x, e.y, e.a, big ? 80 : 50, big ? 420 : 330);
      bloodPool(e.x, e.y, e.a, big);
      fx.corpses.push({ x: e.x, y: e.y, a: e.a, sk: e.sk, vx: Math.cos(e.a) * (big ? 30 : 160), vy: Math.sin(e.a) * (big ? 30 : 160), mine: e.id === myId, col: jacketOf(e.id, e.id === myId), dk: e.dk });
      addShake(big ? 13 : 9); if (cfg.kick) { fx.flash = 0.35; hitstop = 0.09; zoomKick = 0.06; }
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
      if (e.gl) addPop(e.x, e.y - 22, 'GARRAFA! 100%', '#ff2e4d');
      else if (e.bl) addPop(e.x, e.y - 22, 'LÂMINA!', '#ff2e4d');
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
    case 'coin': {   // jogou a moeda: ela cai na fonte no meio da animação (respingo) e o resultado sai no fim
      const mine = e.id === myId; if (mine) sfx('coin');
      const fo = fountainAim(e.x, e.y);
      if (fo) setTimeout(() => { splashFx(fo.x, fo.y, 0.7, !mine); fx.lights.push({ x: fo.x, y: fo.y, t: 0.3, r: 90, c: '255,226,122' }); }, Shared.COIN_T * 0.7 * 1000);
      break;
    }
    case 'coinr': {  // resultado do desejo: nada / buff / debuff (som e texto só para quem jogou; os outros só veem o brilho e o anel)
      const def = e.k >= 0 ? Shared.COIN_FX[e.k] : null, mine = e.id === myId;
      if (e.r === 1 && def) {
        if (mine) { sfx('fx_' + def.id); addPop(e.x, e.y - 44, 'VOCÊ FOI ABENÇOADO!', '#7dff8a', 3.2); addPop(e.x, e.y - 20, def.name, '#fff6a0', 3.2); }
        for (let i = 0; i < 16; i++) { const a = Math.random() * TAU; fx.parts.push({ k: 's', x: e.x + Math.cos(a) * 12, y: e.y + Math.sin(a) * 12, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70 - 110, life: 0.6, sz: 4, col: i & 1 ? '#7dff8a' : '#fff6a0' }); }
        fx.lights.push({ x: e.x, y: e.y, t: 0.35, r: 130, c: '120,255,160' });
      } else if (e.r === 2 && def) {
        if (mine) { sfx('fx_' + def.id); addPop(e.x, e.y - 44, 'VOCÊ FOI AMALDIÇOADO!', '#d98bff', 3.2); addPop(e.x, e.y - 20, def.name, '#ffb0e0', 3.2); }
        for (let i = 0; i < 14; i++) { const a = Math.random() * TAU; fx.parts.push({ k: 's', x: e.x + Math.cos(a) * 12, y: e.y + Math.sin(a) * 12, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 + 40, life: 0.6, sz: 4, col: i & 1 ? '#b05cff' : '#5b2a8a' }); }
        fx.lights.push({ x: e.x, y: e.y, t: 0.35, r: 120, c: '170,90,255' });
      } else if (mine) { sfx('fx_none'); addPop(e.x, e.y - 40, 'ACONTECEU ALGO...', '#c9d1d9', 3.2); }
      break;
    }
    case 'sw': sfx('click', e.x, e.y); break;   // interruptor
    case 'dive':   // mergulhou (on) ou subiu (off)
      sfx(e.on ? 'dive' : 'surface', e.x, e.y);
      for (let i = 0; i < (e.on ? 12 : 8); i++) { const a = Math.random() * TAU, v = 20 + Math.random() * 60; fx.parts.push({ k: 'o', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life: 0.5 + Math.random() * 0.6, sz: 2 + Math.random() * 3.5 }); }
      if (!e.on) for (let i = 0; i < 10; i++) { const a = Math.random() * TAU, v = 50 + Math.random() * 120; fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.2, sz: 3, col: '#d8f8ff' }); }
      break;
    case 'pwr':   // tiro no quadro de energia: faíscas, clarão e a casa apaga
      sfx('power', e.x, e.y); addShake(6);
      for (let i = 0; i < 22; i++) { const a = Math.random() * TAU, v = 90 + Math.random() * 260; fx.parts.push({ k: 's', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, sz: 4, col: Math.random() < 0.5 ? '#9ff7ff' : '#fff6a0' }); }
      fx.lights.push({ x: e.x, y: e.y, t: 0.4, r: 260, c: '150,220,255' });
      addPop(e.x, e.y - 30, 'ENERGIA CORTADA!', '#9ff7ff');
      break;
    case 'click': sfx('click', e.x, e.y); break;
    case 'throw': sfx('throw', e.x, e.y); break;
    case 'go': goUntil = now + 900; sfx('go'); break;
    case 'end': sfx('end'); break;
  }
}
function addPop(x, y, s, col, d = 0.9) { fx.pops.push({ x, y, s, col, t: d, d }); }
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
  const id = rev[k];   // tecla apertada -> ação (mapeamento configurável em Opções > Teclas)
  if (!id) return;
  e.preventDefault();
  if (e.repeat) return;
  if (canSpec()) { if (id === 'a') specStep(-1); else if (id === 'd') specStep(1); }
  keys[id] = true;
  if (id === 'e') edge.pk = true;
  if (id === 'v') edge.it = true;   // interagir: equipa a garrafa
  if (id === ' ' && (() => { const m = myState(); return m && hasActive(m.sk); })()) edge.sl = true;   // ativa (gorila: explosão · Shadow 4: gancho)
  if (id === 'f') edge.th = true;   // arremessar
  if (id === 'q') edge.hl = true;
  if (id === 'g') edge.em = true;   // emote: dançar
  if (id === '1') edge.ss = 1;
  if (id === '2') edge.ss = 2;
  if (id === 'm') { cfg.music = !cfg.music; applyMusic(); $('optMusic').checked = cfg.music; refreshTracks(); saveCfg(); }
  if (id === 'n') nextTrack();
});
addEventListener('keyup', e => { const id = rev[e.key.toLowerCase()]; if (id) keys[id] = false; });
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
function aimAngle() { return mouseAngle(); }

function doStep() {
  if (mode === 'local' && local) {
    // monta e aplica a entrada do jogador, depois bot + tick
    if (snap && level) stepInput();
    for (const b of local.bots) b.think(STEP);
    local.g.tick(STEP);
    if (++local.t > 0) { const s = local.g.snapshot(); s.ack = local.me.ack; local.g.events = []; onSnapshot(s); }
    return;
  }
  if (snap && level) stepInput();
}
function stepInput() {
  const k = (keys.w ? 1 : 0) | (keys.a ? 2 : 0) | (keys.s ? 4 : 0) | (keys.d ? 8 : 0);
  let aim = aimAngle();
  if (IS_TOUCH && (mouse.down || edge.fp) && level) {   // celular: com o gancho na mão, o disparo mira sozinho no adversário vivo mais perto que esteja à vista (difícil apontar o analógico com precisão)
    const m0 = myState();
    if (m0 && m0.al && hasHook(m0.sk) && m0.hm) {
      let bd = HOOK_RANGE;
      for (const f of foesOf()) {
        if (!f.al) continue;
        const d = Math.hypot(f.x - pred.x, f.y - pred.y);
        if (d < bd && level.los(pred.x, pred.y, f.x, f.y)) { bd = d; aim = Math.atan2(f.y - pred.y, f.x - pred.x); }
      }
    }
  }
  // distância da mira (cursor) em px do mundo: é até onde o gancho vai. No toque não há cursor de verdade, então vale o alcance máximo.
  const ad = IS_TOUCH ? HOOK_RANGE : Math.round(Math.hypot(mouse.x - (W / 2 + (pred.x - cam.x) * Z), mouse.y - (H / 2 + (pred.y - cam.y) * Z)) / Z);
  const inp = { type: 'input', seq: ++seq, dt: STEP, k, a: +aim.toFixed(3), ad, f: mouse.down ? 1 : 0, fp: edge.fp ? 1 : 0, pk: edge.pk ? 1 : 0, it: edge.it ? 1 : 0, th: edge.th ? 1 : 0, hl: edge.hl ? 1 : 0, sw: edge.sw ? 1 : 0, sl: edge.sl ? 1 : 0, ct: keys.control ? 1 : 0, em: edge.em ? 1 : 0, ss: edge.ss, tc: (mouse.right || keys.f) ? 1 : 0 };
  edge.fp = edge.pk = edge.it = edge.th = edge.hl = edge.sw = edge.sl = edge.em = false; edge.ss = 0;
  const me = myState(), sm = me && me.hz > 0 ? HEAL_SLOW : 1;
  if (me) { pred.skin = me.sk; pred.dualOn = !!me.dm; pred.slowT = me.sn || 0; pred.wt = me.w; pred.fxSpd = me.fs || 1; }
  const hooked = !!(me && me.hk);   // preso no gancho: o servidor move o boneco, a previsão só espera
  if (me && !hooked && canMove(snap.ph, me.al, me.dn, me.hz > 0)) stepMove(level, pred, k, STEP, sm);
  if (!hooked) { pending.push({ seq: inp.seq, dt: STEP, k, sm }); if (pending.length > 120) pending.shift(); }
  predictShots(inp);
  sendInput(inp);
}
// Tiro previsto: replica a regra do servidor (cooldown, clique guardado 0.16 s, automática segurada, munição) e mostra clarão, som, recuo e a bala NA HORA.
function predictShots(inp) {
  if (mode !== 'online' || !snap || !level) return;
  const nowT = performance.now();
  while (pshots.length && nowT - pshots[0] > 700) pshots.shift();   // o servidor não confirmou: descarta
  if (snap.ph !== 'live') return;
  const me = myState(); if (!me || !me.al || me.dn || me.dv || me.hz > 0 || me.ch >= 0 || inp.ct || me.su > 0.02) return;
  pcd -= STEP; pbuf -= STEP;
  if (inp.pk || inp.it || inp.sw || inp.ss || inp.th || inp.hl || inp.sl) { pcd = Math.max(pcd, 0.25); pbuf = 0; return; }   // trocou/pegou/jogou/curou: espera o servidor
  if (inp.fp) pbuf = 0.16;
  const wd = me.w ? WEAPONS[me.w] : null;
  if (!wd || wd.melee) return;
  // modo dupla do Shadow 7 (dm = 1): as duas armas do mesmo tipo atiram juntas, cada uma com os seus números, uma de cada lado
  const o = me.iv && me.iv[1 - (me.se | 0)], dual = me.dm === 1 && o && WEAPONS[o[0]];
  const guns = dual ? [{ type: me.w, ammo: me.am }, { type: o[0], ammo: o[1] }] : [{ type: me.w, ammo: me.am }];
  const loaded = guns.filter(q => q.ammo - pshots.length > 0);
  if (!loaded.length) return;
  if (!(pcd <= 0 && (pbuf > 0 || inp.f))) return;
  pbuf = 0; pcd = Math.max(...loaded.map(q => WEAPONS[q.type].cd)) * cadMulOf(me.sk, !!me.dm);
  const a = inp.a, cs = Math.cos(a), sn = Math.sin(a);
  guns.forEach((gun, gi) => {
    if (gun.ammo - pshots.length <= 0) return;
    const gw = WEAPONS[gun.type], fwd = dual ? dualFwdOf(gun.type) : 0;
    let off = dual ? (gi ? -1 : 1) * (fwd ? 8.5 : 5.5) : 0;
    if (off && !level.los(pred.x, pred.y, pred.x - sn * off, pred.y + cs * off)) off = 0;
    const ox = pred.x - sn * off, oy = pred.y + cs * off;
    let mz = (gw.muz || 12) + fwd, fw = fwd;
    if (!level.los(ox, oy, ox + cs * mz, oy + sn * mz)) mz = 8, fw = 0;
    const sx = ox + cs * mz, sy = oy + sn * mz;
    for (let i = 0; i < gw.pellets; i++) {
      const aa = a + (Math.random() - 0.5) * 2 * gw.spread, sp = gw.speed * (gw.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      pbul.push({ x: sx, y: sy, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: gw.range / sp });
    }
    handleEvent({ t: 'shot', by: myId, w: gun.type, x: ox, y: oy, a, d: fw ? Math.round(fw) : undefined, pred: 1 }, nowT);
  });
  pshots.push(nowT);
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
// Garrafa de vinho em pé em cima de uma mesa, vista de cima: sombra no tampo, ombro de vidro, gargalo, lacre vermelho e um reflexo.
function drawBottleOnTable(x, y, type) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(3.5, 4.5, 11, 10, 0, 0, TAU); ctx.fill();   // sombra no tampo
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#10241a';
  ctx.fillStyle = '#24472d'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); ctx.stroke();               // corpo
  ctx.fillStyle = '#2f5c3a'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();                              // ombro
  if (type === 'BROKEN') {   // quebrada: gargalo irregular com cacos
    ctx.fillStyle = '#cfe9d8'; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-2, -7); ctx.lineTo(1, -3); ctx.lineTo(5, -6); ctx.lineTo(6, 0); ctx.lineTo(3, 5); ctx.lineTo(-2, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#1f3a26'; ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, TAU); ctx.fill(); ctx.stroke();            // gargalo
    ctx.fillStyle = '#8b1a2f'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();                           // lacre
    ctx.fillStyle = '#d9a8b0'; ctx.beginPath(); ctx.arc(0, 0, 1.1, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 8, Math.PI * 1.15, Math.PI * 1.5); ctx.stroke();   // reflexo do vidro
  ctx.restore();
}
/* ---------- armas CORPO A CORPO em PIXEL ART (estilo da referência: contorno preto de 1px, 3 tons chapados, sem suavização) ----------
   Cada arma é desenhada de lado (cabo à esquerda, ponta à direita) numa grade de pixels; (cx,cy) = ponto da grade que cai na mão (x=0,y=0 local). */
const MK = { W: '#ffffff', M1: '#e9e9f1', M2: '#b8b8c6', M3: '#7e7e8e', M4: '#4a4a58',
  O1: '#f4b042', O2: '#d98a1c', O3: '#8e5210', R1: '#ff3030', R2: '#e00c0c', R3: '#8a0808', RH: '#ff9a9a',
  G1: '#8dffc0', G2: '#16e07a', G3: '#0e9a52', G4: '#08683a', P1: '#9a9da8', P2: '#62656f', P3: '#3a3c44', P4: '#1e1f25',
  N1: '#c08a54', N2: '#8b5e34', N3: '#5a3a1e', U1: '#a455c4', U2: '#6c2a82', U3: '#3e1650', Y1: '#ffe680', Y2: '#ffd23f', Y3: '#c9961c',
  B1: '#5aa56b', B2: '#24472d', B3: '#14291a', C1: '#fff7e0', C2: '#efe6d0', C3: '#cfc6a8', X: '#8b1a2f', XL: '#d9a8b0',
  S1: '#f2fff6', S2: '#bfe9cf', S3: '#7fc09a', PK: '#f5c6ee', BL: '#a9dcea' };
function mkMelee(w, h, cx, cy, draw) {
  const g = new Array(w * h).fill(null);
  const R = (x, y, ww, hh, c) => { for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < w && Y < h) g[Y * w + X] = c ? MK[c] : null; } };
  draw(R);
  const cv = document.createElement('canvas'); cv.width = w + 2; cv.height = h + 2; const q = cv.getContext('2d');
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? null : g[y * w + x];
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    let c = at(x, y);
    if (!c && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) c = '#000';   // contorno preto de 1px
    if (c) { q.fillStyle = c; q.fillRect(x + 1, y + 1, 1, 1); }
  }
  return { cv, ox: cx + 1, oy: cy + 1 };
}
const MELEE_DEF = {
  KNIFE: () => mkMelee(12, 3, 2, 1.5, R => {            // faca (sprite do autor): cabo laranja, guarda escura, lâmina cinza com brilho rosado
    R(0, 0, 4, 1, 'O2'); R(0, 1, 4, 1, 'O1'); R(2, 1, 2, 1, 'O2'); R(1, 2, 3, 1, 'O2');
    R(4, 0, 1, 3, 'M4');
    R(5, 0, 5, 1, 'M2'); R(10, 0, 1, 1, 'PK'); R(11, 0, 1, 1, 'M3');
    R(5, 1, 1, 1, 'M4'); R(6, 1, 1, 1, 'PK'); R(7, 1, 2, 1, 'M1'); R(9, 1, 1, 1, 'W'); R(10, 1, 1, 1, 'M3');
    R(5, 2, 1, 1, 'M2'); R(6, 2, 3, 1, 'M3'); R(9, 2, 1, 1, 'M2');
  }),
  MACHETE: () => mkMelee(33, 6, 3.5, 2, R => {          // machete (sprite do autor, imagem 3): cabo preto + lâmina larga cinza com fio serrilhado embaixo
    R(0, 0, 33, 1, 'P4');
    R(0, 1, 7, 1, 'P4'); R(0, 2, 7, 1, 'P3'); R(1, 3, 6, 1, 'P4');
    R(7, 1, 1, 4, 'P4');
    R(8, 1, 23, 3, 'M3'); R(9, 2, 1, 1, 'M1'); R(13, 2, 1, 1, 'M1'); R(15, 2, 1, 1, 'M1');
    R(31, 1, 2, 3, 'P4'); R(31, 1, 1, 2, 'M2');
    R(6, 4, 11, 1, 'P4');
    R(17, 4, 14, 1, 'M3'); for (const x of [18, 21, 23, 25, 28]) R(x, 4, 1, 1, 'M1');
    R(31, 4, 1, 1, 'P4'); R(17, 5, 14, 1, 'P3');
  }),
  AXE: () => mkMelee(34, 14, 4.5, 7.5, R => {           // machado (sprite do autor): cabo vermelho fino + cabeça cinza em bloco com ponta em cima
    R(0, 6, 28, 1, 'R3'); R(0, 7, 28, 1, 'R1'); R(0, 8, 28, 1, 'R3');
    R(8, 6, 1, 3, 'R3'); R(27, 6, 1, 3, 'R3'); R(12, 7, 2, 1, 'RH'); R(20, 7, 1, 1, 'RH'); R(0, 7, 8, 1, 'R2');
    R(28, 4, 6, 10, 'M2'); R(28, 4, 6, 1, 'M1'); R(33, 5, 1, 7, 'M1'); R(28, 5, 2, 7, 'M3');
    R(28, 12, 6, 1, 'W'); R(28, 13, 6, 1, 'M3');
    R(30, 0, 2, 4, 'M1'); R(30, 0, 2, 1, 'W');
  }),
  BAT: () => mkMelee(29, 5, 4.5, 1.5, R => {          // taco (sprite do autor): ponta cinza serrilhada À ESQUERDA = onde segura; corpo de madeira laranja com fundo redondo
    R(0, 0, 8, 1, 'M2'); R(0, 1, 8, 1, 'M3');                                            // pegada cinza
    R(0, 2, 1, 1, 'M4'); R(2, 2, 2, 1, 'M4'); R(5, 2, 2, 1, 'M4');                       // dentes serrilhados
    R(8, 0, 20, 1, 'O3'); R(8, 1, 20, 1, 'O2'); R(8, 2, 11, 1, 'O3');                    // madeira: borda de cima, laranja, borda de baixo (parte fina)
    R(19, 2, 9, 1, 'O1'); R(19, 3, 9, 1, 'O2'); R(19, 4, 9, 1, 'O3'); R(21, 1, 6, 1, 'O1');  // parte grossa com brilho
    R(28, 2, 1, 2, 'O3');                                                                // fundo redondo
  }),
  KATANA: () => mkMelee(41, 5, 4.5, 2.5, R => {         // katana: cabo roxo, tsuba dourada, lâmina clara
    for (let x = 0; x <= 10; x++) { R(x, 1, 1, 1, x % 2 ? 'U2' : 'U1'); R(x, 2, 1, 1, x % 2 ? 'U1' : 'U2'); R(x, 3, 1, 1, 'U3'); }
    R(0, 1, 1, 3, 'Y3');
    R(11, 0, 1, 5, 'Y2'); R(11, 0, 1, 1, 'Y1'); R(11, 4, 1, 1, 'Y3'); R(12, 1, 1, 3, 'Y3');
    R(13, 1, 27, 1, 'W'); R(13, 2, 25, 1, 'BL'); R(13, 1, 3, 2, 'Y3');
  }),
  SPEAR: () => mkMelee(56, 8, 7, 4, R => {              // lança: haste de madeira, fita vermelha, ponta de aço
    R(0, 3, 42, 1, 'N1'); R(0, 4, 42, 1, 'N2'); R(24, 3, 1, 2, 'N3'); R(27, 3, 1, 2, 'N3'); R(30, 3, 1, 2, 'N3'); R(0, 3, 2, 2, 'M4');
    R(38, 2, 3, 4, 'R2'); R(38, 2, 3, 1, 'R1'); R(38, 5, 3, 1, 'R3'); R(38, 6, 1, 1, 'R3');
    const span = k => k <= 41 ? [2, 5] : k <= 44 ? [1, 6] : k <= 47 ? [2, 5] : [3, 4];
    for (let k = 41; k <= 55; k++) { const [a, b] = span(k); for (let y = a; y <= b; y++) R(k, y, 1, 1, y === 3 ? 'W' : y === a ? 'M1' : y === b ? 'M3' : 'M2'); }
  }),
  WINE: () => mkMelee(26, 8, 5, 4, R => {               // garrafa de vinho
    R(0, 3, 2, 2, 'X'); R(2, 2, 1, 4, 'XL'); R(3, 3, 6, 1, 'B1'); R(3, 4, 6, 1, 'B2');
    R(9, 2, 1, 4, 'B2'); R(10, 1, 2, 6, 'B2');
    R(12, 1, 14, 1, 'B1'); R(12, 2, 14, 3, 'B2'); R(12, 5, 14, 2, 'B3'); R(25, 1, 1, 1, null); R(25, 6, 1, 1, null);
    R(15, 1, 8, 6, 'C2'); R(15, 1, 8, 1, 'C1'); R(15, 6, 8, 1, 'C3'); R(15, 3, 8, 2, 'X'); R(17, 3, 1, 1, 'C2'); R(20, 4, 1, 1, 'C2');
  }),
  BROKEN: () => mkMelee(21, 8, 5, 4, R => {             // garrafa quebrada: gargalo + cacos de vidro
    R(0, 3, 2, 2, 'X'); R(2, 2, 1, 4, 'XL'); R(3, 3, 6, 1, 'B1'); R(3, 4, 6, 1, 'B2');
    R(9, 2, 1, 4, 'B2'); R(10, 1, 2, 6, 'B2');
    R(12, 1, 3, 1, 'B1'); R(12, 2, 3, 3, 'B2'); R(12, 5, 3, 2, 'B3');
    R(15, 1, 4, 1, 'S1'); R(15, 2, 2, 1, 'S2'); R(15, 3, 4, 1, 'S1'); R(15, 4, 6, 1, 'S2'); R(15, 5, 2, 1, 'S2'); R(15, 6, 4, 1, 'S3');
  })
};
const meleePxCache = {};
function drawMeleePx(type) {
  const m = meleePxCache[type] || (meleePxCache[type] = MELEE_DEF[type]());
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(m.cv, -m.ox * PU, -m.oy * PU, m.cv.width * PU, m.cv.height * PU);
  ctx.imageSmoothingEnabled = sm;
}
function drawWeaponSprite(type) {
  const w = WEAPONS[type];
  if (MELEE_DEF[type]) { drawMeleePx(type); return; }   // corpo a corpo: pixel art
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
  }
}
/* ---------- personagem estilo Hotline Miami: jaqueta, jeans, tênis e máscara de animal ---------- */
const OL = 'rgba(12,4,18,.92)', SKIN_TONE = '#f0c39a', JEANS = '#34508f', HAIR = '#3a2415';
const shadeMemo = new Map();
function shade(col, f) {   // aceita '#rrggbb' ou 'rgb(r,g,b)'; resultado em cache (é chamado várias vezes por quadro)
  const key = col + '|' + f; let v = shadeMemo.get(key); if (v) return v;
  let r, g, b; const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(col || '');
  if (m) { r = +m[1]; g = +m[2]; b = +m[3]; } else { const n = parseInt(String(col || '#808080').slice(1), 16) || 0; r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  const k = c => Math.max(0, Math.min(255, Math.round(c * f)));
  v = `rgb(${k(r)},${k(g)},${k(b)})`; if (shadeMemo.size > 600) shadeMemo.clear(); shadeMemo.set(key, v); return v;
}
function shape(pts, fill, lw = 1.8) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = OL; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
}
function blob(x, y, rx, ry, fill, lw = 1.8) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  if (lw) { ctx.strokeStyle = OL; ctx.lineWidth = lw; ctx.stroke(); }
}
/* ---------- PIXEL ART ----------
   Tudo no personagem é desenhado numa grade de pixels (1 pixel = PU unidades locais), com contorno preto de 1px,
   cores chapadas em 3 tons e SEM suavização — o mesmo estilo da sua arte do Shadow 4.
   Peças fixas (tronco, cabeça, mão) viram sprites em cache; peças animadas (braços e pernas) são rasterizadas a cada quadro. */
const PU = 1.5, INK = '#000';
const DUAL_GUN_X = 24;   // Shadow 7 (dupla): onde a arma fica à frente do corpo (arma única fica em 8) — tem que bater com DUAL_FWD do shared.js
class PxBuf {
  constructor(w, h) { this.w = w; this.h = h; this.a = new Array(w * h).fill(null); this.n = []; }
  set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = y * this.w + x; if (this.a[i] === null) this.n.push(i); this.a[i] = c; }
  clear() { for (const i of this.n) this.a[i] = null; this.n.length = 0; }
  // contorno de 1px em volta da máscara + preenchimento (cor fixa ou função (x,y) => cor)
  paint(m, fill, ol = INK) {
    const x0 = Math.floor(m.b[0]) - 1, y0 = Math.floor(m.b[1]) - 1, x1 = Math.ceil(m.b[2]) + 1, y1 = Math.ceil(m.b[3]) + 1, w = x1 - x0 + 1;
    const ins = new Uint8Array(w * (y1 - y0 + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ins[(y - y0) * w + (x - x0)] = m.f(x, y) ? 1 : 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y - y0) * w + (x - x0);
      if (ins[i]) { const c = typeof fill === 'function' ? fill(x, y) : fill; if (c) this.set(x, y, c); }
      else if (ol && ((x > x0 && ins[i - 1]) || (x < x1 && ins[i + 1]) || (y > y0 && ins[i - w]) || (y < y1 && ins[i + w]))) this.set(x, y, ol);
    }
  }
  canvas() {
    const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; const q = c.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const v = this.a[y * this.w + x]; if (v) { q.fillStyle = v; q.fillRect(x, y, 1, 1); } }
    return c;
  }
}
const mkEll = (cx, cy, rx, ry) => ({ b: [cx - rx, cy - ry, cx + rx, cy + ry], f: (x, y) => { const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry; return dx * dx + dy * dy <= 1; } });
const mkSeg = (ax, ay, bx, by, r) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  return { b: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r], f: (x, y) => {
    const px = x + .5 - ax, py = y + .5 - ay, t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0, ex = px - dx * t, ey = py - dy * t; return ex * ex + ey * ey <= r * r;
  } };
};
const mkPoly = (p) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  return { b: [x0, y0, x1, y1], f: (x, y) => {
    const px = x + .5, py = y + .5; let ins = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > py) !== (p[j + 1] > py) && px < (p[j] - p[i]) * (py - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins;
    return ins;
  } };
};
const mkUnion = (ms) => ({ b: [Math.min(...ms.map(m => m.b[0])), Math.min(...ms.map(m => m.b[1])), Math.max(...ms.map(m => m.b[2])), Math.max(...ms.map(m => m.b[3]))], f: (x, y) => ms.some(m => m.f(x, y)) });
// sprite desenhado em "unidades de projeto" (as mesmas do desenho vetorial antigo): (ox,oy) = célula da origem, kx/ky = escala projeto -> unidades locais
class Spr extends PxBuf {
  constructor(w, h, ox, oy, kx, ky = kx) { super(w, h); this.ox = ox; this.oy = oy; this.kx = kx; this.ky = ky; }
  X(x) { return this.ox + x * this.kx / PU; } Y(y) { return this.oy + y * this.ky / PU; }
  // fill pode ser cor, função, ou {c,d,l}: cor base + tom escuro nas costas + brilho no topo
  shaded(f, m, cx, cy, rx, ry) { return (x, y) => { const nx = (x + .5 - cx) / rx, ny = (y + .5 - cy) / ry; return nx < -0.5 ? f.d : (ny < -0.45 && ny > -0.9 && Math.abs(nx - 0.1) < 0.55) ? f.l : f.c; }; }
  e(x, y, rx, ry, fill, ol = INK) {
    const cx = this.X(x), cy = this.Y(y), a = rx * this.kx / PU, b = ry * this.ky / PU;
    this.paint(mkEll(cx, cy, a, b), fill && fill.c ? this.shaded(fill, null, cx, cy, a, b) : fill, ol);
  }
  u(list, fill, ol = INK) { this.paint(mkUnion(list.map(([x, y, rx, ry]) => mkEll(this.X(x), this.Y(y), rx * this.kx / PU, ry * this.ky / PU))), fill, ol); }
  p(pts, fill, ol = INK) { this.paint(mkPoly(pts.map((v, i) => i & 1 ? this.Y(v) : this.X(v))), fill, ol); }
  l(x1, y1, x2, y2, fill, w = 1.2) { this.paint(mkSeg(this.X(x1), this.Y(y1), this.X(x2), this.Y(y2), Math.max(0.62, w * this.kx / PU / 2)), fill, null); }
  d(x, y, fill) { this.set(Math.floor(this.X(x)), Math.floor(this.Y(y)), fill); }
  arc(cx, cy, r, a0, a1, fill) { for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * i / 10; this.d(cx + Math.cos(a) * r, cy + Math.sin(a) * r, fill); } }
  curve(x0, y0, x1, y1, x2, y2, fill) { for (let i = 0; i <= 14; i++) { const t = i / 14, u = 1 - t; this.d(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2, fill); } }
  // repinta (só o que já é cor, sem contorno) as células cujo ponto de projeto passa no teste
  tint(test, fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const i = y * this.w + x, c = this.a[i]; if (c && c !== INK && test((x + .5 - this.ox) * PU / this.kx, (y + .5 - this.oy) * PU / this.ky)) this.a[i] = fn(c); } }
}
const sprCache = new Map();
function cached(key, build) { let v = sprCache.get(key); if (!v) { if (sprCache.size > 300) sprCache.clear(); v = build(); sprCache.set(key, v); } return v; }
function blitSpr(cv, ox, oy) { const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(cv, -ox * PU, -oy * PU, cv.width * PU, cv.height * PU); ctx.imageSmoothingEnabled = sm; }

// área de trabalho para as peças animadas (braços e pernas): rasteriza, desenha de uma vez com vizinho-mais-próximo
const SCN = 72, SCO = 36, scrCv = document.createElement('canvas'); scrCv.width = scrCv.height = SCN;
const scrQ = scrCv.getContext('2d'), scrB = new PxBuf(SCN, SCN);
function scrFlush() {
  scrQ.clearRect(0, 0, SCN, SCN);
  let last = null; for (const i of scrB.n) { const c = scrB.a[i]; if (c !== last) { scrQ.fillStyle = c; last = c; } scrQ.fillRect(i % SCN, (i / SCN) | 0, 1, 1); }
  scrB.clear(); blitSpr(scrCv, SCO, SCO);
}
// distância² e lado (para sombreado) de um ponto até um segmento — usado para pintar braço/perna do Shadow 4 em duas cores
const segInfo = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  const ex = px - (ax + dx * t), ey = py - (ay + dy * t);
  return { d: ex * ex + ey * ey, t, side: (ex * dy - ey * dx) / Math.sqrt(L2) };
};
// SHADOW 4 — braço do sprite: sai do ombro, o COTOVELO vai para fora do corpo e o antebraço segue até a mão.
// Braço (ombro→cotovelo) em ciano, antebraço (cotovelo→mão) em branco, tudo com contorno preto de 1px.
const armTonesC = new Map();
function armTones(col) {   // manga: mesmas três tonalidades do torso (sombra, base, realce)
  let t = armTonesC.get(col);
  if (!t) { t = { c: col, d: shade(col, 0.78), l: shade(col, 1.2) }; if (armTonesC.size > 200) armTonesC.clear(); armTonesC.set(col, t); }
  return t;
}
function heroArm(x1, y1, x2, y2, torso) {
  const sg = y1 < 0 ? -1 : 1, len = Math.hypot(x2 - x1, y2 - y1);
  const out = Math.max(3, Math.min(9.5, 10 - (len - 10) * 0.4));                                          // braço esticado = cotovelo menos aberto
  const ex = x1 + (x2 - x1) * 0.42, ey = y1 + (y2 - y1) * 0.42 + sg * out;   // cotovelo para FORA do ombro (a manga ciano fica à mostra)
  const P = v => v / PU + SCO, ax = P(x1), ay = P(y1), bx = P(ex), by = P(ey), cx = P(x2), cy = P(y2), tn = torso ? armTones(torso) : null;
  scrB.paint(mkUnion([mkSeg(ax, ay, bx, by, 2.3), mkSeg(bx, by, cx, cy, 2.0)]), (x, y) => {
    const px = x + .5, py = y + .5, A = segInfo(px, py, ax, ay, bx, by), B = segInfo(px, py, bx, by, cx, cy);
    if (A.d < B.d + 1.4) return A.side > 0.9 ? (tn ? tn.d : '#2c8fab') : A.side < -1.1 ? (tn ? tn.l : '#8fe6f4') : (tn ? tn.c : '#4fc7e0');   // manga: segue a cor do torso
    if (B.t > 0.82) return '#e3e9ee';                                                                   // punho
    return B.side > 0.8 ? '#c3ccd5' : '#ffffff';                                                        // antebraço branco (sombra embaixo)
  });
  scrFlush();
}
// SHADOW 4 — pernas do sprite: calça ciano com realce branco no meio e tênis branco GRANDE no fim da perna (bem à frente ou bem atrás, conforme a passada)
function heroLegs(stp) {
  for (const [s, o] of [[-1, stp], [1, -stp]]) {
    const hx = -1, hy = s * 4.2, ex = -4 + o * (o > 0 ? 2.8 : 1.9), ey = s * 5.2, ux = ex >= hx ? 1 : -1;   // quadril -> tornozelo
    const P = v => v / PU + SCO, ax = P(hx), ay = P(hy), bx = P(ex), by = P(ey);
    scrB.paint(mkSeg(ax, ay, bx, by, 3.3), (x, y) => {
      const I = segInfo(x + .5, y + .5, ax, ay, bx, by), d = I.side * s * ux;
      if (I.t > 0.8) return '#bff3fb';                         // barra da calça perto do tênis
      if (Math.abs(d) < 0.9 && I.t > 0.2 && I.t < 0.75) return '#ffffff';   // realce branco da calça
      return d > 1.4 ? '#2c8fab' : d < -1.4 ? '#8fe6f4' : '#4fc7e0';
    });
    const cx = P(ex + ux * 3.4), cy = P(ey), rx = 4 / PU, ry = 3.1 / PU;   // tênis branco, tamanho médio
    scrB.paint(mkEll(cx, cy, rx, ry), (x, y) => {
      const yy = y + .5 - cy;
      if (yy > ry * 0.62) return '#9aa6b0';                    // sola
      if (yy > ry * 0.1) return '#d3dae0';                     // sombra
      return (x + .5 - cx) * ux > rx * 0.45 ? '#e8edf1' : '#ffffff';   // bico + cabedal
    });
  }
  scrFlush();
}
// braço: manga (jaqueta ou pele no Shadow 4) com sombra num lado, punho e contorno preto
function limb(x1, y1, x2, y2, jacket) {
  heroArm(x1, y1, x2, y2, curHero ? heroJacket(jacket) : jacket); return;   // mesmo braço para TODOS os personagens; a manga usa a cor do torso (no Shadow 4 a jaqueta marrom da arte)
  const ax = x1 / PU + SCO, ay = y1 / PU + SCO, bx = x2 / PU + SCO, by = y2 / PU + SCO, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, L2 = L * L;
  const base = curHero ? '#d8ab87' : jacket, dk = curHero ? '#b68b69' : shade(jacket, .76), lt = curHero ? '#e6bf9b' : shade(jacket, 1.2);
  const cf = curHero ? '#44211b' : '#efe6d0', cf2 = curHero ? '#341813' : '#cfc6a8';
  scrB.paint(mkSeg(ax, ay, bx, by, 1.95), (x, y) => {
    const px = x + .5 - ax, py = y + .5 - ay, t = (px * dx + py * dy) / L2, side = (px * dy - py * dx) / L;
    if (t > 0.6 && t < 0.82) return side > 0.5 ? cf2 : cf;   // punho
    return side > 0.7 ? dk : side < -0.9 ? lt : base;
  });
  scrFlush();
}
function handSpr(hero) {
  return cached('hand|' + hero, () => {
    const S = new PxBuf(6, 6), base = hero ? '#ffd79f' : '#f0c39a', dk = hero ? '#e1b373' : '#d8a57a';
    S.paint(mkEll(3, 3, 2, 2), (x, y) => (x + y >= 6 ? dk : base)); return S.canvas();
  });
}
function hand(x, y) {
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(handSpr(true), Math.round(x / PU) * PU - 3 * PU, Math.round(y / PU) * PU - 3 * PU, 6 * PU, 6 * PU); ctx.imageSmoothingEnabled = sm;
}
// pernas estilo Hotline Miami: jeans + tênis branco com faixa vermelha (stp = quanto cada perna vai à frente/atrás)
// pernas de nado (bate-perna): pés alternando atrás do corpo, com espuma
function drawSwimKick(now, mv) {
  const f = Math.sin(now / 75), jn = curHero ? '#69d6e8' : JEANS;
  ctx.save(); ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const k = s * f, fx0 = -15 - Math.abs(k) * 2, fy0 = s * 4.2 + k * 3.2;
    ctx.strokeStyle = jn; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-2, s * 3.6); ctx.lineTo(fx0, fy0); ctx.stroke();
    ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.ellipse(fx0 - 2.2, fy0, 3.6, 2.6, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(240,253,255,.7)';
  for (let i = 0; i < 5; i++) { const t = ((now / 380 + i / 5) % 1); ctx.globalAlpha = (1 - t) * 0.75; ctx.beginPath(); ctx.arc(-18 - t * 12, Math.sin(i * 2.7 + now / 140) * 7, 1.6 + (1 - t) * 1.8, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function drawLegs(stp, sliding) {
  heroLegs(stp); return;   // mesmas pernas para TODOS os personagens
  // perna reta e grossa (calça clara com realce em cima e sombra embaixo) e, na ponta dela, um pé branco pequeno
  const jn = curHero ? '#69d6e8' : JEANS, jd = curHero ? '#3a97ad' : shade(JEANS, .7), jl = curHero ? '#b4f2fb' : shade(JEANS, 1.25);
  for (const [s, o] of [[-1, stp], [1, -stp]]) {
    const fxp = 1.5 + o * 2.0, lift = 1 + Math.max(0, o) / 10 * 0.2;
    const hx = -1, hy = s * 4, ex = fxp - 1, ey = s * 4.6;                 // quadril -> ponta da perna
    const ay = hy / PU + SCO;
    scrB.paint(mkSeg(hx / PU + SCO, ay, ex / PU + SCO, ey / PU + SCO, 3.7), (x, y) => { const d = (y + .5 - ay) * s; return d > 1.5 ? jd : d < -1.3 ? jl : jn; });   // perna
    const cx = (ex + 2.2) / PU + SCO, cy = (ey - s * 0.8) / PU + SCO, rx = 3.1 * lift / PU, ry = 2.5 * lift / PU;   // pé: pequeno, um pouco para dentro
    scrB.paint(mkEll(cx, cy, rx, ry), (x, y) => (y + .5 > cy + ry * 0.35 ? '#cfc9bd' : '#ffffff'));
    scrB.set(Math.floor(cx), Math.floor(cy), '#d62a45');                    // detalhe do tênis
  }
  scrFlush();
}

/* ---------- Shadow 4: pixel art do personagem (cores tiradas da arte original) ---------- */
const HERO_PAL = {"O": "#000000", "a": "#030303", "b": "#c7a02a", "c": "#b69120", "d": "#d2ab33", "e": "#e1b373", "f": "#ffd89d", "g": "#634d2e", "h": "#a27c4a", "R": "#e0152f", "r": "#ff3b57", "Y": "#ffd23f", "y": "#e8a82a", "B": "#ff9a2b", "W": "#ffffff", "E": "#0b0710", "n": "#5a3a1e", "m": "#8b5e34", "l": "#b98550", "k": "#efe0b8", "j": "#ffd23f", "Q": "#e8862a"};
const HERO_FRONT = ["OO......OO", "OnOOOOOOnO", "OmmmmmmmmO", "OmjjkkjjmO", "OmjOQQOjmO", "OmmkkkkmmO", "OnmmmmmmnO", ".OnmmmmnO.", "..OOOOOO.."];   // coruja de frente (retrato do HUD)
const HERO_HEAD = ["..OO........", ".OnnOOOOOO..", ".OnnmmmmmmO.", "OnnmmmkkjjkO", "OnnmmkkkjOkO", "OnnmmkkkkQQO", "OnnmmkkkkQQO", "OnnmmkkkjOkO", "OnnmmmkkjjkO", ".OnnmmmmmmO.", ".OnnOOOOOO..", "..OO........"];   // máscara de coruja vista de cima, olhando para a direita
const ROOSTER_HEAD = ["............", "...OOOOOO...", "..OyYYYYyO..", ".OyYYYYyEWO.", ".OYRRRRYYYO.", "OcrRrRrRrBBO", "OcrRrRrRrBBO", ".OYRRRRYyYO.", ".OyYYYYyEWO.", "..OYYYyYYO..", "...OOOOOO...", "............"];   // máscara de galo vista de cima
const HERO_SIDE = ["..On........", ".OnmOOOOO...", ".OnmmmmmmO..", "OnmmmmkkkkO.", "OnmmmmkjjkO.", "OnmmmmkjOkQO", "OnmmmmkkkQQO", "OnmmmmmkkkQO", ".OnmmmmmmmO.", "..OnmmmmmO..", "...OOOOOO..."];   // coruja de perfil (abertura)
const isHeroSk = k => k === 'HERO' || k === 'ROOSTER';
const pixCache = {};
function pix(key, rows) {   // grade de letras -> canvas pixel art (cacheado)
  if (pixCache[key]) return pixCache[key];
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; const q = c.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch !== '.' && HERO_PAL[ch]) { q.fillStyle = HERO_PAL[ch]; q.fillRect(x, y, 1, 1); } } });
  return (pixCache[key] = c);
}
function drawPixelHead(key, rows, s = 1.44) {   // desenha sem suavização, mesmo girando
  const c = pix(key, rows), sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, -c.width * s / 2 + 1, -c.height * s / 2, c.width * s, c.height * s);
  ctx.imageSmoothingEnabled = sm;
}
function heroJacket(col) {   // jaqueta marrom da arte, puxada um pouco para a cor do jogador (para distinguir quem é quem)
  if (!/^#[0-9a-f]{6}$/i.test(col || '')) return '#44211b';
  const n = parseInt(col.slice(1), 16), k = (v, t) => Math.round(v * 0.3 + t * 0.7);
  return `rgb(${k(n >> 16, 0x44)},${k((n >> 8) & 255, 0x21)},${k(n & 255, 0x1b)})`;
}
let curHero = false;   // o personagem que está sendo desenhado é o Shadow 4 (braços de pele, jeans escuro)

/* ---------- máscaras de animal em pixel art (mesmos desenhos de antes, agora rasterizados numa grade de pixels) ---------- */
const HEAD_N = 30, HEAD_C = 15;
function animalHead(skin, dark) {   // dark (só o TIGER): modo dupla ligado -> a máscara do Shadow 7 fica PRETA (pantera); normal = tigre laranja
  const TG = skin === 'TIGER' && !dark;
  return cached('head|' + skin + (skin === 'TIGER' ? (dark ? '|k' : '|t') : ''), () => {
    const c = TG ? '#e8892b' : (SKINS[skin] || SKINS.HERO).c, k = skin === 'GORILLA' ? 0.95 : 0.8, S = new Spr(HEAD_N, HEAD_N, HEAD_C, HEAD_C, k);
    const body = { c, d: shade(c, 0.7), l: shade(c, 1.22) };
    S.e(-2.4, 0, 9.6, 10.4, { c: HAIR, d: shade(HAIR, 0.7), l: shade(HAIR, 1.3) });   // cabelo aparecendo atrás da máscara
    // orelhas (atrás da máscara)
    if (skin === 'BEAR' || skin === 'MONKEY') { const r = skin === 'BEAR' ? 4.4 : 5.2; for (const s of [-1, 1]) { S.e(-1.5, s * (skin === 'BEAR' ? 10.6 : 11), r + 0.4, r + 0.4, c); S.e(-1, s * (skin === 'BEAR' ? 10.6 : 11), r * 0.5, r * 0.5, skin === 'BEAR' ? '#d9b48c' : '#f3c6d6', null); } }
    if (skin === 'TIGER') for (const s of [-1, 1]) { S.e(-2, s * 9.2, 3.6, 3.9, c); S.e(-1.4, s * 9.4, 1.9, 2.2, TG ? '#fff0da' : '#15151b', null); S.e(-0.6, s * 9.4, 1.0, 1.2, TG ? '#e79ab0' : '#6b4a5a', null); }   // orelhas pequenas e redondas
    if (skin === 'FISH') for (const s of [-1, 1]) { S.p([-1, s * 6, -9, s * 14, -4, s * 5.5], '#ff9a3c'); S.p([-2, s * 7, -7, s * 11.5, -4, s * 6.5], '#ffd08a', null); }
    if (skin === 'GORILLA') for (const s of [-1, 1]) { S.e(-2.2, s * 10.4, 2.8, 3.2, c); S.e(-2.1, s * 10.4, 1.3, 1.6, shade(c, 0.55), null); }   // orelhinhas escuras coladas na cabeça
    if (skin === 'WOLF') for (const s of [-1, 1]) { S.p([0, s * 5, -4, s * 14, 5, s * 8.5], c); S.p([0.5, s * 7, -2.6, s * 12, 3, s * 8.8], '#3a4656', null); }
    S.e(0, 0, 9.6, 9.8, body);   // máscara
    if (TG) {   // TIGRE: pelo laranja com listras pretas, focinho creme, nariz rosado, olhos âmbar
      const ST = '#1a1008';
      for (const sd of [-1, 1]) { S.l(-6.8, sd * 3.0, -1.6, sd * 2.4, ST, 1.4); S.l(1.4, sd * 8.9, 2.6, sd * 6.3, ST, 1.3); S.l(4.2, sd * 9.0, 4.8, sd * 7.1, ST, 1.2); }   // listras da testa e das bochechas
      S.l(-7, 0, -1.2, 0, ST, 1.4);                                                  // listra do meio
      S.e(6.8, 0, 4.0, 4.4, '#fff1dc');                                              // focinho creme
      S.e(8.2, -2.2, 1.6, 1.4, '#ffe3bd', null); S.e(8.2, 2.2, 1.6, 1.4, '#ffe3bd', null);   // bochechas do focinho
      S.p([9.2, -1.7, 11.8, 0, 9.2, 1.7], '#e0708a', null);                          // nariz rosado
      S.l(9.6, 0, 8, 0, '#3a2418', 1);                                               // boca
      for (const sd of [-1, 1]) S.e(3.0, sd * 5.5, 3.0, 3.3, '#f6d34a', null);       // olhos âmbar (a pupila escura é desenhada logo depois)
    }
    if (skin === 'TIGER' && !TG) {   // PANTERA (modo dupla): pelo preto, focinho mais claro, olhos amarelos brilhantes
      S.e(-2.4, 0, 3.6, 4.8, shade(c, 0.8), null);                                   // testa mais escura
      for (const sd of [-1, 1]) S.l(4.6, sd * 4.1, 9, sd * 3, shade(c, 0.6), 1.4);   // marcas do olho ao focinho
      S.e(6.8, 0, 4.0, 4.4, '#55525f');                                              // focinho cinza-escuro
      S.e(8.2, -2.2, 1.6, 1.4, '#4a4854', null); S.e(8.2, 2.2, 1.6, 1.4, '#4a4854', null);   // bochechas
      S.p([9.2, -1.7, 11.8, 0, 9.2, 1.7], '#c97a8a', null);                          // nariz rosado
      S.l(9.6, 0, 8, 0, '#15151b', 1);                                               // boca
      for (const sd of [-1, 1]) S.e(3.0, sd * 5.5, 3.0, 3.3, '#f2c230', null);       // olhos amarelos (a pupila escura é desenhada logo depois)
    }
    if (skin === 'BEAR') { S.e(7.2, 0, 4.4, 3.6, '#d9b48c'); S.e(10.6, 0, 1.8, 1.5, '#120808', null); S.l(10.4, 1.4, 10.4, 3.4, '#3a2418', 1); }
    if (skin === 'MONKEY') {
      S.u([[5.4, -2.2, 3.4, 3.2], [5.4, 2.2, 3.4, 3.2], [8, 0, 3.2, 3.6]], '#ecdcff'); S.arc(8.2, 0, 2.2, -1, 1, '#6a3c8c');
      S.d(10, -1, '#2a1030'); S.d(10, 1, '#2a1030');
    }
    if (skin === 'WOLF') {
      S.p([3, -3.8, 15.2, -1.8, 15.2, 1.8, 3, 3.8], '#e8f0f8'); S.e(15, 0, 1.9, 1.7, '#0c0c12', null); S.l(10, 0, 14, 0, '#8a97a8', 1);
      for (const s of [-1, 1]) S.p([-2, s * 9, -7, s * 11.2, -4, s * 7.4], '#dfe8f2');   // tufos de pelo
    }
    if (skin === 'FISH') {
      S.p([-9, 0, -14.5, -5.5, -12, 0, -14.5, 5.5], '#ff9a3c');   // cauda
      S.e(-1, 0, 3.8, 6.4, '#9fe6ff', null);                       // barriga clara
      for (let i = 0; i < 3; i++) S.arc(-6 + i * 3.4, 0, 3.6, -1.1, 1.1, '#00466e');   // escamas
      S.e(8.8, 0, 3.0, 3.0, shade(c, 1.1)); S.e(11, 0, 1.5, 1.8, '#ff6f9a');
    }
    if (skin === 'GORILLA') {
      S.e(-3.4, 0, 5.8, 2.8, shade(c, 1.4), null);                // crista no topo da cabeça (mais clara)
      S.e(7.4, 0, 4.8, 6.2, '#625c68');                           // focinho largo e achatado, cinza claro
      S.e(4.6, 0, 1.7, 7.6, shade(c, 0.5), null);                 // sobrancelha pesada
      S.d(10.6, -2.6, '#15121a'); S.d(10.6, 2.6, '#15121a'); S.d(10.0, -2.6, '#15121a'); S.d(10.0, 2.6, '#15121a');   // narinas
      S.curve(6.4, -5.4, 11, 0, 6.4, 5.4, '#2a1c30');             // boca
    }
    // olhos: buracos escuros com olhar branco (bem separados, para não virarem uma barra só)
    for (const s of [-1, 1]) {
      S.e(3.0, s * 5.5, 2.2, 2.5, '#0b0710', null);
      S.e(3.7, s * 5.5, 1.1, 1.5, '#fff', null); S.d(4.3, s * 5.5, '#000');
    }
    return S.canvas();
  });
}
function drawHead(skin, dark) {
  if (skin === 'HERO') { drawPixelHead('hero', HERO_HEAD); return; }
  if (skin === 'ROOSTER') { drawPixelHead('roost', ROOSTER_HEAD); return; }
  blitSpr(animalHead(SKINS[skin] ? skin : 'HERO', dark), HEAD_C, HEAD_C);
}

/* ---------- tronco visto de cima em pixel art: ombros largos, jaqueta com gola, costura e listra nas costas ---------- */
const BODY_W = 48, BODY_H = 52, BODY_OX = 24, BODY_OY = 26;
function bodySprite(skin, jacket, flat) {
  return cached('body|' + skin + '|' + jacket + '|' + (flat ? 1 : 0), () => {
    const hero = isHeroSk(skin), gor = skin === 'GORILLA', S = new Spr(BODY_W, BODY_H, BODY_OX, BODY_OY, gor ? 1.18 : 1, gor ? 1.32 : 1);   // gorila: ombros bem largos e corpão
    const jk = { c: jacket, d: shade(jacket, 0.78), l: shade(jacket, 1.2) };
    if (flat) {
      for (const s of [-1, 1]) { S.e(-12, s * 5.2, 7, 3.8, hero ? '#202d38' : JEANS); S.e(-18.5, s * 5.2, 3.6, 3, '#f4f1ea'); }   // pernas e tênis de quem caiu
      S.e(0, 0, 11.5, 15.5, jk); S.e(-1, 0, 6, 11, shade(jacket, 0.8), null);
      S.arc(-8, 0, 11, -0.9, 0.9, shade(jacket, 1.3));
      return S.canvas();
    }
    S.e(0, 0, 9.4, 15.4, jk);
    for (const s of [-1, 1]) S.e(0.5, s * 12, 5.6, 5.4, { c: shade(jacket, 0.88), d: shade(jacket, 0.68), l: jacket });   // ombros
    const inTorso = (x, y) => (x / 8.6) ** 2 + (y / 14.8) ** 2 <= 1;
    S.tint((x, y) => inTorso(x, y) && x < -3 && x > -10, c => shade(c, 0.8));                                                      // sombra das costas
    S.tint((x, y) => inTorso(x, y) && Math.abs(x + 5.2) <= 0.9 && Math.abs(y) < 14, () => (hero ? '#d89643' : '#efe6d0'));          // listra da jaqueta nas costas
    S.tint((x, y) => Math.abs(y) < 0.75 && x > -8 && x < 2, c => shade(c, 0.6));                                                    // costura central
    S.e(3.4, 0, 3, 6, hero ? { c: '#2d826b', d: '#1c735c', l: '#308b72' } : { c: '#efe6d0', d: '#cfc6a8', l: '#fffaf0' });         // gola
    return S.canvas();
  });
}
function drawBody(skin, jacket, flat) {
  if (isHeroSk(skin)) jacket = heroJacket(jacket);
  blitSpr(bodySprite(skin, jacket, flat), BODY_OX, BODY_OY);
}

/* ---------- animação do golpe corpo a corpo (estilo Hotline Miami) ----------
   preparação (puxa para trás) -> varrida rápida com leve passada do corpo -> acompanha o golpe e volta ao repouso.
   O sentido alterna a cada golpe (ida e volta), como o taco/faca do jogo original. */
const SWDUR = { FISTS: 200, KNIFE: 230, MACHETE: 270, AXE: 310, BAT: 340, KATANA: 300, SPEAR: 300, WINE: 260, BROKEN: 210 };
const swDur = t => SWDUR[t] || 240;
const dualSwMul = dc => dc === 2 ? 1.2 : dc >= 0 ? 0.8 : 1;   // Shadow 7 com 2 armas melee: golpes 0 e 1 mais rápidos, o cruzado (2) mais lento
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
  const coinFo = p.cn > 0 && !p.dn ? fountainAim(x, y) : null;   // jogando a moeda: o corpo vira para a fonte
  if (coinFo) ang = coinFo.a;
  if (!st.lx && !st.ly) { st.lx = x; st.ly = y; }
  const moved = Math.hypot(x - st.lx, y - st.ly);
  if (st.la === undefined) { st.la = ang; st.mv = 0; }
  // pernas giram para a direção em que o boneco ANDA (independente da mira); parado, voltam para a mira
  if (moved > 0.25 && moved < 40) { st.la += angDiff(Math.atan2(y - st.ly, x - st.lx), st.la) * 0.35; st.mv += (1 - st.mv) * 0.3; }
  else { st.la += angDiff(ang, st.la) * 0.12; st.mv *= 0.78; }
  st.walk += Math.min(moved, 8) * 0.17; st.lx = x; st.ly = y;
  st.recoil = Math.max(0, st.recoil - 0.12);
  const jacket = jacketOf(p.id, isMe); curHero = isHeroSk(p.sk);
  ctx.save(); ctx.translate(x, y); ctx.scale(CS, CS);
  if (isMe) { ctx.strokeStyle = 'rgba(0,229,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.stroke(); }
  if (p.fk > 0 && !p.dn) {   // buff (verde) / debuff (roxo): anel pulsando em volta do boneco
    const good = Shared.COIN_FX[p.fk - 1] && Shared.COIN_FX[p.fk - 1].good, pu = 0.5 + 0.5 * Math.sin(now / 160);
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = good ? `rgba(110,255,150,${0.35 + 0.3 * pu})` : `rgba(190,100,255,${0.35 + 0.3 * pu})`;
    ctx.beginPath(); ctx.arc(0, 0, 24 + pu * 2, 0, TAU); ctx.stroke(); ctx.restore();
  }
  const swimming = !!(level && level.waterAt(x, y)) && !p.dn;   // na água: sprite de NADO
  if (p.dv) {   // MERGULHADO: boneco quase transparente, escuro, soltando bolhas (de fora só dá pra ver as ondas e as bolhas)
    if (Math.random() < 0.07) fx.parts.push({ k: 'o', x: x + (Math.random() - .5) * 18, y: y + (Math.random() - .5) * 18, vx: (Math.random() - .5) * 16, vy: -10 - Math.random() * 14, life: 0.9 + Math.random() * 0.6, sz: 2 + Math.random() * 3 });
    ctx.fillStyle = 'rgba(8,60,110,.38)'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.fill();
  }
  { const inW = !!(level && level.waterAt(x, y)); if (st.inW === undefined) st.inW = inW; else if (st.inW !== inW && moved < 40) { st.inW = inW; splashFx(x, y, inW ? 1 : 0.6); } }
  if (level && level.waterAt(x, y)) {   // dentro da piscina: sem sombra, ondas se abrindo em volta dos pés
    ctx.save(); ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const t = ((now / 650 + i / 3) % 1); ctx.globalAlpha = (1 - t) * 0.7; ctx.strokeStyle = '#e8fbff'; ctx.beginPath(); ctx.ellipse(0, 4, 12 + t * 17, 9 + t * 12, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  } else { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(2, 4, 16, 13, 0, 0, TAU); ctx.fill(); }
  if (p.dv) ctx.globalAlpha = isMe ? 0.55 : 0.26;
  const healing = p.hz > 0 && !p.dn;
  if (healing) {   // aura verde pulsante + cruzes subindo (por baixo do boneco)
    const pu = 0.5 + 0.5 * Math.sin(now / 130), pr = 1 - Math.max(0, Math.min(1, p.hz / healTimeOf(p.sk)));
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
  ctx.rotate(ang);
  if (healing) ctx.scale(0.94, 0.94);   // agachadinho enquanto se cura
  const dancing = !!p.em && !p.dn && !healing;   // emote: dancinha (tudo preso ao relógio, então a galera dança no mesmo ritmo)
  if (dancing) { const bt = now / 230, pul = 1 + 0.05 * Math.abs(Math.sin(bt * 2)); ctx.rotate(Math.sin(bt) * 0.5); ctx.scale(pul, pul); }
  const swW = st.sw || 'FISTS', swSp = Math.min(1, (now - st.sw0) / (swDur(p.w || 'FISTS') * (p.dm === 1 ? dualSwMul(st.dc) : 1))), swOn = swSp < 1;
  if (swOn && !p.dn && (!p.w || (WEAPONS[p.w] && WEAPONS[p.w].melee))) ctx.translate(swingLunge(swSp) * (p.w === 'SPEAR' ? 5 : p.w ? 8 : 6), 0);   // passada do corpo
  if (p.dn) {
    ctx.globalAlpha = 0.95; drawBody(p.sk, jacket, true); ctx.translate(-3, 0); drawHead(p.sk, p.dk > 0); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(CS, CS);
    const k = 1 - Math.max(0, p.dt) / DOWN_TIME;
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.fillStyle = '#fff6a0'; for (let i = 0; i < 3; i++) { const a = now / 180 + i * 2.1; ctx.fillRect(Math.cos(a) * 18 - 2, Math.sin(a) * 8 - 26, 4, 4); }
    ctx.restore(); return;
  }
  // pernas estilo Hotline Miami: uma vai para frente e a outra para TRÁS, alternando; o pé que vem à frente levanta um pouco
  ctx.save(); ctx.rotate(angDiff(st.la, ang));
  if (swimming && !dancing) drawSwimKick(now, st.mv); else drawLegs(dancing ? Math.sin(now / 115) * 9 : Math.sin(st.walk) * 10 * st.mv);
  ctx.restore();
  const sp = swSp, swinging = swOn; let twist = 0;
  const swt = p.w, wt = p.su > 0.02 ? null : p.w, wd = wt ? WEAPONS[wt] : null, melee = !wt || wd.melee;
  const iv2 = p.dm === 1 && p.iv && p.iv[1 - (p.se | 0)], wt2 = (iv2 && iv2[0] && WEAPONS[iv2[0]]) ? iv2[0] : wt;   // arma da OUTRA mão no modo dupla (do mesmo tipo da principal, mas pode ser outro modelo)
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
  } else if (dancing) {
    // dancinha: mãos para o alto alternando ("levanta o teto"), arma guardada no quadril, tronco requebrando
    const a = Math.sin(now / 115), b2 = Math.abs(a);
    if (wt) { ctx.save(); ctx.translate(-1, 12); ctx.rotate(2.5); ctx.scale(0.8, 0.8); drawWeaponSprite(wt); ctx.restore(); }
    limb(0, 10, 9 + a * 9, 17 + b2 * 3, jacket); limb(0, -10, 9 - a * 9, -17 - b2 * 3, jacket);
    hand(10 + a * 9, 17.5 + b2 * 3); hand(10 - a * 9, -17.5 - b2 * 3);
    twist = a * 0.2;
  } else if (coinFo) {
    // MOEDA: puxa a mão para trás, peteleca a moeda em arco até o centro da fonte (gira no ar, sobe e cai) e volta a mão
    const u = 1 - p.cn, sm = v => v * v * (3 - 2 * v);
    const pull = u < 0.15 ? sm(u / 0.15) : 0, fl = u < 0.15 ? 0 : u < 0.3 ? sm((u - 0.15) / 0.15) : u < 0.42 ? 1 : Math.max(0, 1 - sm((u - 0.42) / 0.2));
    const hx = 8 - 2 * pull + 9 * fl, hy = 6 + 2 * pull - 4 * fl;   // mão direita (lado +y)
    if (wt) { ctx.save(); ctx.translate(-1, -12); ctx.rotate(-2.5); ctx.scale(0.8, 0.8); drawWeaponSprite(wt); ctx.restore(); }   // arma guardada no quadril esquerdo
    limb(0, 10, hx, hy, jacket); limb(0, -10, 9, -6, jacket);
    hand(9, -6); hand(hx, hy);
    const q = (u - 0.27) / 0.43;   // progresso do voo da moeda
    if (u < 0.27) { ctx.fillStyle = '#f7d154'; ctx.strokeStyle = '#8a6414'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(hx + 1, hy - 1.5, 3.2, 0, TAU); ctx.fill(); ctx.stroke(); }   // moeda na ponta do dedo
    else if (q < 1) {
      const dd = Math.max(20, coinFo.d), arc = Math.sin(q * Math.PI), lift = arc * (16 + dd * 0.18);
      const lx = 17 + (dd - 17) * q, ly = 2 * (1 - q), ex = lx - lift * Math.sin(ang), ey = ly - lift * Math.cos(ang);   // o "para cima" da tela, no referencial do boneco
      ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(lx, ly, 3 * (1 - arc * 0.3), 2.2 * (1 - arc * 0.3), 0, 0, TAU); ctx.fill(); ctx.restore();   // sombra no chão
      const flip = Math.max(0.18, Math.abs(Math.cos(q * Math.PI * 5))), sz = 3.6 * (1 + arc * 0.5);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(-ang); ctx.scale(flip, 1);   // gira (achata) mantendo a moeda na vertical da tela
      ctx.fillStyle = flip > 0.6 ? '#f7d154' : '#c99a2a'; ctx.strokeStyle = '#8a6414'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, sz, 0, TAU); ctx.fill(); ctx.stroke();
      if (flip > 0.5) { ctx.fillStyle = '#fff2a8'; ctx.fillRect(-sz * 0.45, -sz * 0.55, sz * 0.5, 1.4); }
      ctx.restore();
    }
    twist = 0;
  } else if (swt && p.su > 0.02) {
    // CTRL: os DOIS braços levam a arma (desenhada por cima do tronco, mais abaixo) da frente até a cabeça: uma mão no cabo, a outra mais à frente
    const u = p.su, e = u * u * (3 - 2 * u), ra = e * Math.PI / 2, dx = Math.cos(ra), dy = Math.sin(ra), gx = 12 - 9 * e, gy = -26 * e;
    const h1x = lerpN(10.5, gx + dx * 1.7, e), h1y = lerpN(-7.5, gy + dy * 1.7, e), h2x = lerpN(10, gx + dx * 7.6, e), h2y = lerpN(8, gy + dy * 7.6, e);
    limb(0, -10, h1x, h1y, jacket); limb(0, 10, h2x, h2y, jacket);
    hand(h1x, h1y); hand(h2x, h2y);
    twist = -e * 0.15;
  } else if (p.hm) {
    // gancho na mão (Shadow 4): segura o lançador com as duas mãos, apontado para a mira
    limb(0, 10, 14, 3, jacket); limb(0, -10, 21, -3, jacket);
    ctx.save(); ctx.translate(9, -1); drawHookGun(); ctx.restore();
    hand(14, 3); hand(21, -3);
  } else if (swimming && !wt && !swinging) {
    // NADO CRAWL: um braço estica à frente enquanto o outro puxa a água para trás, alternando; o tronco rola de leve
    const a1 = Math.sin(now / 230 + st.walk * 0.2);
    for (const [s, a] of [[1, a1], [-1, -a1]]) {
      const hx = 15 + a * 12, hy = s * (7.5 + (a < 0 ? -a * 5 : 0));
      limb(0, s * 10, hx, hy, jacket); hand(hx, hy);
      if (a > 0.85) { ctx.fillStyle = 'rgba(235,252,255,.85)'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(hx + 5 + i * 2.4, hy + (i - 1) * 2.6, 1.6, 0, TAU); ctx.fill(); } }   // respingo na mão que entra na água
    }
    twist = a1 * 0.16;
  } else if (!wt) {
    // soco: a mão que bate puxa para trás, dispara para frente cruzando a mira e volta; a outra fica de guarda
    const side = st.punch, bump = swinging ? Math.sin(Math.min(1, Math.max(0, (sp - 0.18) / 0.82)) * Math.PI) : 0;
    const ext = swinging ? (sp < 0.18 ? -5 * (sp / 0.18) : lerpN(-5, 0, (sp - 0.18) / 0.82) + 30 * Math.pow(bump, 0.7)) : 0, cross = bump * 5;
    limb(0, side * 10, 10 + ext, side * (6.5 - cross), jacket); limb(0, -side * 10, 9 - bump * 3, -side * 7.5, jacket);
    hand(12 + ext, side * (6.5 - cross)); hand(10.5 - bump * 3, -side * 7.5);
    if (swinging) twist = -side * bump * 0.28;
  } else if (melee) {
    const spearW = wt === 'SPEAR', dcs = p.dm === 1 && swinging && st.dc >= 0 ? st.dc : -1, spear = spearW && dcs !== 1, arc = spearW && dcs === 1 ? 1.9 : wd.arc * (dcs === 2 ? 1.5 : 1), dir = st.punch || 1, a = spear ? 0 : (swinging ? swingAng(sp, arc, dir) : -0.6);
    // lança: puxa o braço, estoca para frente e recolhe
    const thrust = spear && swinging ? (sp < 0.2 ? -9 * (sp / 0.2) : lerpN(-9, 0, (sp - 0.2) / 0.8) + 38 * Math.sin(Math.min(1, (sp - 0.2) / 0.5) * Math.PI / 2) * (sp < 0.7 ? 1 : 1 - (sp - 0.7) / 0.3)) : 0;
    const chg = spear && p.ch > 0 ? p.ch : 0, lunge = thrust - chg * 12, hy = spear ? 5 : 8;
    if (swinging && !spear) {
      // golpe como no Hotline Miami: o braço INTEIRO gira a partir do ombro (estica atrás, varre, estica ao máximo, recolhe) e a arma segue em linha com ele
      const bl = sp < 0.12 ? sp / 0.12 : sp > 0.85 ? (1 - sp) / 0.15 : 1, ha = lerpN(-0.2, a, bl), len = lerpN(10.2, swingArm(sp), bl);
      const hx = Math.cos(ha) * len, hy2 = 10 + Math.sin(ha) * len, cnt = Math.sin(Math.min(1, sp / 0.7) * Math.PI);
      if (p.dm === 1) {   // Shadow 7 no modo dupla: COMBO — golpe 0 = só o braço direito, 1 = só o esquerdo (o outro fica de guarda), 2 = CRUZADO: os dois braços varrem juntos com o corpo girando
        const stp = dcs >= 0 ? dcs : 0, both = true;   // as DUAS armas golpeiam em todo golpe
        twist = both ? (a + 0.6) * 0.5 : (a + 0.6) * 0.3 * (stp === 0 ? 1 : -1);
        for (const sd of [1, -1]) {
          const act = both || (stp === 0 ? sd === 1 : sd === -1);
          if (act) {
            limb(0, sd * 10, hx, sd * hy2, jacket);
            ctx.save(); ctx.translate(hx, sd * hy2); ctx.rotate(sd * a); ctx.scale(1, sd); drawWeaponSprite(sd === 1 ? wt : wt2); hand(1, 0); ctx.restore();
          } else {
            limb(0, sd * 10, 10, sd * hy, jacket);
            ctx.save(); ctx.translate(10, sd * hy); ctx.rotate(sd * -0.6); ctx.scale(1, sd); drawWeaponSprite(sd === 1 ? wt : wt2); hand(1, 0); ctx.restore();
          }
        }
      } else {
      twist = (a + 0.6) * 0.42;   // tronco gira junto com a varrida
      limb(0, -10, 9 - cnt * 3, -7.5 + cnt * 1.5, jacket); hand(10.5 - cnt * 3, -7.5 + cnt * 1.5);   // braço de trás recua
      limb(0, 10, hx, hy2, jacket);
      ctx.save(); ctx.translate(hx, hy2); ctx.rotate(a); drawWeaponSprite(wt); hand(1, 0); ctx.restore();
      }
    } else if (p.dm === 1) {   // Shadow 7 no modo dupla, em repouso (ou lança): uma arma em cada mão, espelhadas. Lança: estocada direita (0), esquerda (1) ou DUPLA (2)
      const stS = spear && swinging && dcs >= 0 ? dcs : -1;
      for (const sd of [1, -1]) {
        const act = stS < 0 || stS === 2 || (stS === 0 ? sd === 1 : sd === -1);
        const lg = act ? lunge * (stS === 2 ? 1.25 : 1) : -chg * 12;
        limb(0, sd * 10, 10 + lg, sd * hy, jacket);
        ctx.save(); ctx.translate(10 + lg, sd * hy); ctx.rotate(sd * a); ctx.scale(1, sd); drawWeaponSprite(sd === 1 ? wt : wt2); hand(1, 0); ctx.restore();
      }
    } else {
      limb(0, 10, 10 + lunge, hy, jacket);
      ctx.save(); ctx.translate(10 + lunge, hy); ctx.rotate(a); drawWeaponSprite(wt); hand(1, 0); ctx.restore();
      limb(0, -10, 9, -7.5, jacket); hand(10.5, -7.5);
    }
  } else {
    const back = st.recoil * 4;
    if (wt === 'PISTOL' || wt === 'REVOLVER') {
      // arma pequena: UMA mão só. O braço de tiro estica reto até o cabo; a outra mão fica recolhida junto ao corpo
      const K = 0.8, GY = 2.2, px = wt === 'PISTOL' ? 21 : 19, gx = px + (wt === 'PISTOL' ? 1.5 : -2) * K, gy = 5.7 * K + 0.3 + GY;   // arma menor (80%) e braço mais comprido; a mão fica no cabo
      if (p.dm === 1) {   // Shadow 7 no modo dupla: a segunda arma na outra mão, espelhada (pode ser outro modelo do mesmo tipo: pistola + revólver)
        const px2 = wt2 === 'PISTOL' ? 21 : 19, gx2 = px2 + (wt2 === 'PISTOL' ? 1.5 : -2) * K;
        limb(1.5, -11.5, gx2 - back, -gy, jacket);
        ctx.save(); ctx.translate(px2 - back, -GY); ctx.scale(K, -K); drawWeaponSprite(wt2); ctx.restore();
        hand(gx2 - back, -gy);
      } else { limb(1.5, -11.5, 9.5, -8.5, jacket); hand(11, -8.5); }          // mão livre recolhida, junto do ombro
      limb(1.5, 11.5, gx - back, gy, jacket);                                // braço de tiro: nasce no OMBRO e segue quase reto para frente
      ctx.save(); ctx.translate(px - back, GY); ctx.scale(K, K); drawWeaponSprite(wt); ctx.restore();
      hand(gx - back, gy);
    } else {
    if (p.dm === 1) {   // Shadow 7 no modo dupla: os DOIS braços esticados bem para frente, cada um com a sua arma paralela à mira (a de cima espelhada, cabo para fora)
      const DX = DUAL_GUN_X, DY = 6.5, HY = 11.5;
      for (const sd of [1, -1]) {
        limb(1.5, sd * 11.5, DX + 3 - back, sd * HY, jacket);
        ctx.save(); ctx.translate(DX - back, sd * DY); ctx.scale(1, sd); drawWeaponSprite(sd === 1 ? wt : wt2); ctx.restore();
        hand(DX + 3 - back, sd * HY);
      }
    } else {
    const fx2 = { PISTOL: 15, REVOLVER: 15, SMG: 24, RIFLE: 26, SHOTGUN: 28, SNIPER: 32, MINIGUN: 28 }[wt] || 22, small = wt === 'PISTOL' || wt === 'REVOLVER';
    const fy = small ? -2 : -3, by = wt === 'MINIGUN' ? 6 : 3;
    limb(1.5, 11.5, 15 - back, by, jacket); limb(1.5, -11.5, fx2 - back, fy, jacket);   // braços nascem nos ombros
    ctx.save(); ctx.translate(8 - back, 0); drawWeaponSprite(wt); ctx.restore();
    hand(15 - back, by); hand(fx2 - back, fy);
    }
    }
  }
  ctx.save(); ctx.rotate(Math.sin(st.walk) * 0.07 * st.mv + twist);   // o tronco balança de leve a cada passo (e gira junto com o golpe)
  drawBody(p.sk, jacket, false);
  drawBackWeapon(p);   // a outra arma do inventário fica nas costas
  if (swimming) {   // tronco dentro da água: véu azul por cima e espuma na linha d'água; só a cabeça fica de fora
    ctx.fillStyle = 'rgba(70,200,240,.34)'; ctx.beginPath(); ctx.ellipse(-2, 0, 14.5, 12.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(240,253,255,.75)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(-2, 0, 14.5, 12.5, 0, 0.5, 2.6 + Math.sin(now / 200) * 0.4); ctx.stroke();
  }
  ctx.save(); ctx.translate(2.5, 0); drawHead(p.sk, p.dk > 0); ctx.restore();
  if (swt && p.su > 0.02) {   // CTRL: a arma sai da frente e vai girando até apontar para a própria cabeça
    const u = p.su, e = u * u * (3 - 2 * u);
    ctx.save(); ctx.translate(12 - 9 * e, -26 * e); ctx.rotate(e * Math.PI / 2); ctx.scale(0.85, 0.85); drawWeaponSprite(swt); ctx.restore();
  }
  ctx.restore();
  ctx.restore();
  if (dancing) {   // notas musicais subindo da cabeça
    ctx.save(); ctx.translate(x, y); ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    const cols = ['#ff4fa8', '#4fe3ff', '#ffe14f'];
    for (let i = 0; i < 3; i++) {
      const t = (now / 1100 + i / 3) % 1, nx = Math.sin(i * 2.1 + t * 4) * 20, ny = -24 - t * 34;
      ctx.globalAlpha = Math.sin(t * Math.PI); ctx.fillStyle = cols[i]; const ch = i % 2 ? '♪' : '♫'; ctx.strokeText(ch, nx, ny); ctx.fillText(ch, nx, ny);
    }
    ctx.restore();
  }
}
// lançador de gancho do Shadow 4 (cores chapadas, mesmo estilo das armas)
function drawHookGun() {
  part([-2, 2.4, 3.6, 2.4, 2.4, 9, -3, 9], '#1c1f27');                                        // cabo
  part([-3, -3.2, 12, -3.2, 12, 2.6, -3, 2.6], MM); rr(-2, -3, 13, 1, ML);                     // corpo + brilho
  rr(5, -0.6, 5, 1, '#9fe6ff');                                                               // faixa
  ctx.strokeStyle = '#d9c6a0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(1.5, -0.2, 3.2, 0, TAU); ctx.stroke();   // corda enrolada
  rr(12, -1.6, 4, 3.2, MD);                                                                   // boca
  part([16, -1.2, 20, -4.6, 21.4, -3.4, 18.6, -0.4], '#c9d2dc'); part([16, 1.2, 20, 4.6, 21.4, 3.4, 18.6, 0.4], '#c9d2dc'); part([16, -0.9, 23, -0.9, 23, 0.9, 16, 0.9], '#c9d2dc');   // garra
}
// arma do outro espaço do inventário, pendurada nas costas (alça + arma na diagonal, reduzida se for comprida)
function drawBackWeapon(p) {
  const bw = p.iv && p.iv[1 - (p.se | 0)]; if (!bw || p.dm === 1) return;   // modo dupla: a outra arma está na mão, não nas costas
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
  ctx.translate(-4, 0); drawHead(c.sk, c.dk > 0);
  ctx.fillStyle = 'rgba(160,10,35,.7)'; circle(1, 2, 5);
  ctx.restore();
}
// OMBRELONE (copa por cima de tudo): quem está de fora vê a copa quase opaca; quem entra debaixo dela vê ela ficar bem transparente
function drawCanopy(cx, cy, R, al) {
  ctx.save(); ctx.globalAlpha = al; ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(4, 5, R, R * .94, 0, 0, TAU); ctx.fill();
  dot(ctx, 0, 0, R, '#f4ead0', OUT, 2);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i & 1 ? '#f4ead0' : '#e0533f'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R - 2, i * TAU / 8, (i + 1) * TAU / 8); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(70,24,12,.4)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i * TAU / 8) * (R - 2), Math.sin(i * TAU / 8) * (R - 2)); ctx.stroke(); }
  dot(ctx, 0, 0, 5, '#8a5a30', OUT, 1.2); dot(ctx, -1, -1, 1.8, '#d9b27a');
  ctx.restore();
}
// PISCINA EM PIXEL ART: 10x10 pixels por tile, 4 quadros de animação pré-desenhados (ondinhas, brilho e faíscas mudam a cada quadro) e ampliados sem suavização.
const POOL_W = ['#9aeaf6', '#66d6ef', '#3bb8e8', '#2796d6', '#1b74ba'], BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const poolCache = {};
// FONTE DOS DESEJOS — pixel art 10 px por tile, 4 quadros (ondas, respingos e esguicho do centro se mexem)
const fountainCache = {};
function fountainFrames(n) {
  if (fountainCache[n]) return fountainCache[n];
  const frames = [], R = n / 2 - 1.2, cx = n / 2, cy = n / 2, TAU2 = Math.PI * 2;
  const hsh = (a, b, c) => { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); };
  const WATER = ['#a6f0fc', '#5fd3f2', '#34aadf', '#2582c0', '#1c5f98'];
  const rW = R - 4.4, rB = rW * 0.27;   // rW = raio da água; rB = raio da bacia do centro
  for (let f = 0; f < 4; f++) {
    const cv = document.createElement('canvas'); cv.width = n; cv.height = n; const c = cv.getContext('2d');
    const px = (x, y, col) => { if (x < 0 || y < 0 || x >= n || y >= n) return; c.fillStyle = col; c.fillRect(x, y, 1, 1); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), lit = (-dx - dy) / (r * 1.4142 + 1e-6), rho = R - r;
      if (rho < 0) { if (Math.hypot(dx - 1.2, dy - 1.2) <= R) px(x, y, 'rgba(0,0,0,.24)'); continue; }   // sombra projetada
      if (rho < 1) { px(x, y, '#2b2733'); continue; }                                                     // contorno
      if (rho < 3.4) {                                                                                    // borda de pedra: duas fiadas, juntas desencontradas
        const ang = (Math.atan2(dy, dx) + Math.PI) / TAU2 * 14, course = rho < 2.2 ? 0 : 1, fr = (ang + course * 0.5) % 1;
        let col = lit > 0.25 ? '#f6f1e2' : lit > -0.35 ? '#ddd5c0' : '#bdb39c';
        if (course) col = lit > 0.25 ? '#fffaec' : lit > -0.35 ? '#e8e1ce' : '#c9bfa8';
        if (fr < 0.09) col = '#a59b84';
        px(x, y, col); continue;
      }
      if (rho < 4.4) { px(x, y, lit > 0 ? '#7c7766' : '#a9a28d'); continue; }                          // parede interna da bacia
      if (r > rB + 1.2) {                                                                                 // ÁGUA
        const d = (r - rB) / (rW - rB), t = d * 3.5, base = Math.floor(t), frac = t - base;
        let idx = frac > BAYER[(y & 3) * 4 + (x & 3)] / 16 ? base + 1 : base;
        if (rho < 6 && lit > 0.2) idx++;                                                                  // sombra da borda (cima/esquerda)
        { const rr = rB + 1.5 + (f / 4) * (rW - rB - 1.5); if (Math.abs(r - rr) < 0.6) idx -= 1; }   // ondas saindo do centro
        idx = Math.max(0, Math.min(4, idx));
        let col = WATER[idx];
        if (hsh(x, y, f) > 0.975) col = '#ffffff';                                                        // brilhinhos
        px(x, y, col); continue;
      }
      if (r > rB - 0.2) { px(x, y, '#2b2733'); continue; }                                                // contorno do pedestal
      if (r > rB - 1.8) { px(x, y, lit > 0.2 ? '#fffaec' : lit > -0.35 ? '#e4dcc7' : '#bdb39c'); continue; }   // topo do pedestal
      px(x, y, (f + x + y) & 2 ? '#8ae6f8' : '#b4f2fc');                                                   // bacia com água
    }
    // esguicho do centro + gotas caindo em volta
    const j = f & 1;
    px(Math.floor(cx), Math.floor(cy), '#ffffff'); px(Math.floor(cx) - 1, Math.floor(cy), '#ffffff'); px(Math.floor(cx), Math.floor(cy) - 1, '#ffffff'); px(Math.floor(cx) - 1, Math.floor(cy) - 1, '#e8fbff');
    px(Math.floor(cx) - 2 - j, Math.floor(cy) - 2 - j, '#d4f7ff'); px(Math.floor(cx) + 1 + j, Math.floor(cy) - 2 - j, '#d4f7ff'); px(Math.floor(cx) - 2 - j, Math.floor(cy) + 1 + j, '#d4f7ff'); px(Math.floor(cx) + 1 + j, Math.floor(cy) + 1 + j, '#d4f7ff');
    for (let k = 0; k < 8; k++) {
      const t = (f / 4 + (k & 1) * 0.5) % 1, a = k * TAU2 / 8 + 0.3, rad = rB + 1.6 + t * (rW - rB - 2.6);
      px(Math.floor(cx + Math.cos(a) * rad), Math.floor(cy + Math.sin(a) * rad), t < 0.5 ? '#ffffff' : '#d4f7ff');
    }
    frames.push(cv);
  }
  return fountainCache[n] = frames;
}
const FOUNTAIN_COIN_PER_W = 4;   // máximo de moedas desenhadas = 4 x largura da fonte em tiles (12 na pequena, 16 na grande)
function drawFountain(f, now, coins) {
  ctx.save(); ctx.imageSmoothingEnabled = false;
  const n = f.w * 10, fr = ((now / 230) | 0) & 3, X = f.x * TILE, Y = f.y * TILE, ps = f.w * TILE / n;
  ctx.drawImage(fountainFrames(n)[fr], X, Y, f.w * TILE, f.h * TILE);
  // moedas no fundo: só existem depois que alguém joga; posições fixas (iguais para todos) na região da água, alinhadas à grade da pixel art
  const R = n / 2 - 1.2, rW = R - 4.4, rB = rW * 0.27, m = Math.min(FOUNTAIN_COIN_PER_W * f.w, coins | 0);
  for (let k = 0; k < m; k++) {
    const a = ((0.5 + k * 0.7548776662) % 1) * Math.PI * 2, rad = rB + 2.6 + Math.sqrt((0.5 + k * 0.5698402909) % 1) * (rW - rB - 5), gx = Math.floor(n / 2 + Math.cos(a) * rad), gy = Math.floor(n / 2 + Math.sin(a) * rad);
    const gl = ((fr + k) & 3) === 0;   // brilho passando de moeda em moeda
    const P = (dx, dy, col) => { ctx.fillStyle = col; ctx.fillRect(X + (gx + dx) * ps, Y + (gy + dy) * ps, ps + 0.5, ps + 0.5); };
    P(0, 0, '#f2b92e'); P(1, 0, gl ? '#fff6c0' : '#ffe27a'); P(0, 1, '#b8821a'); P(1, 1, '#f2b92e');
  }
  ctx.restore();
}
// fonte mais próxima de (x,y): ângulo e distância até o centro (o boneco vira para ela ao jogar a moeda)
function fountainAim(x, y) {
  let best = null, bd = Infinity;
  for (const f of fountainFurn) { const fx = (f.x + f.w / 2) * TILE, fy = (f.y + f.h / 2) * TILE, d = Math.hypot(fx - x, fy - y); if (d < bd) { bd = d; best = { a: Math.atan2(fy - y, fx - x), d, x: fx, y: fy }; } }
  return best;
}
function poolFrames(gw, gh) {
  const key = gw + 'x' + gh; if (poolCache[key]) return poolCache[key];
  const R = 3, frames = [];
  const inRR = (x, y, k) => {
    const x0 = k, y0 = k, x1 = gw - 1 - k, y1 = gh - 1 - k, r = Math.max(0, R - k);
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const dx = Math.min(x - x0, x1 - x), dy = Math.min(y - y0, y1 - y);
    if (dx >= r || dy >= r) return true;
    return (r - dx - 0.5) ** 2 + (r - dy - 0.5) ** 2 <= r * r;
  };
  const hsh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  for (let f = 0; f < 4; f++) {
    const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh; const c = cv.getContext('2d');
    const px = (x, y, col) => { if (x < 0 || y < 0 || x >= gw || y >= gh) return; c.fillStyle = col; c.fillRect(x, y, 1, 1); };
    const idxAt = (x, y) => {
      const t = Math.max(0, Math.min(3.999, (x - 4) / (gw - 8) * 4)), base = Math.floor(t), fr = t - base;
      let i = fr > BAYER[(y & 3) * 4 + (x & 3)] / 16 ? base + 1 : base;
      if (inRR(x, y, 4) && !inRR(x, y, 6) && (y < gh / 2 || x < gw / 2) && (y - 4 < 2 || x - 4 < 2)) i++;   // sombra da borda (cima/esquerda) dentro da água
      return Math.max(0, Math.min(4, i));
    };
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (!inRR(x, y, 0)) continue;
      if (!inRR(x, y, 1)) { px(x, y, '#1b2a3a'); continue; }                                          // contorno
      if (!inRR(x, y, 3)) {                                                                            // borda de lajotas (2 px)
        const outer = !inRR(x, y, 2), top = y < gh / 2 && (y <= 2 || x > 3 && x < gw - 4), left = x < gw / 2;
        let col = outer ? ((y < 3 && y < gh / 2) || (x < 3 && x < gw / 2) ? '#faf6ea' : '#cbc1a6') : '#e9e2cf';
        const horiz = y < 4 || y >= gh - 4, vert = x < 4 || x >= gw - 4;
        if ((horiz && !vert && x % 6 === 0) || (vert && !horiz && y % 6 === 0)) col = '#b8ad90';       // juntas das lajotas
        px(x, y, col); continue;
      }
      if (!inRR(x, y, 4)) { px(x, y, '#1f5f92'); continue; }                                           // parede interna da piscina
      px(x, y, POOL_W[idxAt(x, y)]);                                                                   // água em degradê (raso -> fundo) com dithering
    }
    // ondinhas e brilho (mudam a cada quadro)
    for (let k = 0, y0 = 8; y0 < gh - 6; k++, y0 += 7) for (let x = 6; x < gw - 6; x++) {
      if (((x + f * 2 + k * 5) % 10) >= 3) continue;
      const y = y0 + ((((x + k) >> 1) + f) & 1), i = idxAt(x, y);
      px(x, y, ((x + k) % 10 === 0) ? '#dffaff' : POOL_W[Math.max(0, i - 1)]);
    }
    for (let y = 6; y < gh - 6; y++) for (let x = 6; x < gw - 6; x++) if ((x * 3 + y * 5 + f * 7) % 23 === 0) px(x, y, POOL_W[Math.max(0, idxAt(x, y) - 1)]);   // cáustica
    // raias no fundo (tracejadas) + marca de fim de raia
    for (const ly of [Math.round(gh / 3), Math.round(gh * 2 / 3)]) {
      for (let x = 16; x < gw - 8; x++) if (((x >> 1) & 1) === 0) px(x, ly, '#1b6aa8');
      for (let y = ly - 2; y <= ly + 2; y++) px(gw - 10, y, '#1b6aa8');
    }
    // degraus no lado raso (o mais perto da borda é o mais claro)
    const sy0 = Math.round(gh * .28), sy1 = Math.round(gh * .72);
    for (let y = sy0; y < sy1; y++) for (let x = 5; x < 17; x++) {
      const step = x < 9 ? 0 : x < 13 ? 1 : 2, edge = (x === 9 || x === 13 || x === 16 || y === sy0 || y === sy1 - 1);
      px(x, y, edge ? '#58b4c4' : ['#effcfb', '#cdf1f0', '#a8e4e8'][step]);
    }
    // escadinha de metal no canto de cima
    for (const lx of [gw - 20, gw - 15]) { for (let y = 1; y <= 7; y++) { px(lx, y, '#e3e9ee'); if (y > 3) px(lx + 1, y, '#8a96a2'); } }
    for (const ry of [5, 7]) for (let x = gw - 19; x < gw - 15; x++) px(x, ry, '#c3ccd4');
    // boia salva-vidas
    const bx = gw - 10, by = gh - 9;
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
      const d = Math.hypot(x, y); if (d > 4.3 || d < 1.5) continue;
      if (d > 3.6 || d < 2.2) { px(bx + x, by + y, '#5a1a1c'); continue; }
      const q = (Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 2)) + (f >> 1)) & 1;   // gira devagarinho com a água
      px(bx + x, by + y, q ? '#f6f6f6' : '#e5484d');
    }
    // faíscas de sol
    for (let i = 0; i < 9; i++) {
      if ((i + f) % 4 !== 0) continue;
      const x = 7 + Math.floor(hsh(i, 3) * (gw - 14)), y = 7 + Math.floor(hsh(i, 9) * (gh - 14));
      px(x, y, '#ffffff'); px(x - 1, y, '#dffaff'); px(x + 1, y, '#dffaff'); px(x, y - 1, '#dffaff'); px(x, y + 1, '#dffaff');
    }
    frames.push(cv);
  }
  return poolCache[key] = frames;
}
function drawPool(f, now) {
  const fr = poolFrames(f.w * 10, f.h * 10)[((now / 240) | 0) & 3];
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fr, f.x * TILE, f.y * TILE, f.w * TILE, f.h * TILE);
  ctx.restore();
}
function splashFx(x, y, k, quiet) {   // respingo ao entrar/sair da água
  if (!quiet) sfx('splash', x, y);
  for (let i = 0; i < 16 * k; i++) { const a = Math.random() * TAU, v = 60 + Math.random() * 170; fx.parts.push({ k: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.25, sz: 3, col: Math.random() < .5 ? '#d8f8ff' : '#8fe3ff' }); }
}
// Porta em PIXEL ART: sprite 35x5 (cada pixel = 2 unidades do mundo), montado uma vez e girado sem suavização
// porta da fachada = fica no contorno do teto (entrada da casa): aparece SEMPRE, por cima do teto
function isFacadeDoor(d) {
  if (d._fc !== undefined) return d._fc;
  let f = false;
  for (const r of (level.m.roofs || [])) {
    if (d.x < r.x || d.x >= r.x + r.w || d.y < r.y || d.y >= r.y + r.h) continue;
    if (d.x === r.x || d.x === r.x + r.w - 1 || d.y === r.y || d.y === r.y + r.h - 1) { f = true; break; }
  }
  return d._fc = f;
}
let doorSpr = null;
function makeDoorSprite() {
  const w = Math.round((TILE - 2) / 2), h = Math.round(DOOR_HT * 2 / 2), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d'), px = (x, y, col) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
  const rows = ['#b27a3e', '#8b5a2b', '#74481f'];   // luz, madeira, sombra
  for (let x = 0; x < w; x++) {
    px(x, 0, '#3a2310'); px(x, h - 1, '#3a2310');
    for (let y = 1; y < h - 1; y++) px(x, y, (x % 7 === 6) ? '#5a3716' : rows[Math.min(rows.length - 1, y - 1)]);   // tábuas
  }
  for (let y = 0; y < h; y++) { px(0, y, '#3a2310'); px(w - 1, y, '#3a2310'); }
  px(1, 1, '#f3d27a'); px(1, h - 2, '#f3d27a'); px(2, 1, '#c9a24a'); px(2, h - 2, '#c9a24a');   // dobradiças
  px(w - 5, (h - 1) >> 1, '#ffe9a0'); px(w - 4, (h - 1) >> 1, '#f3d27a');                         // maçaneta
  return cv;
}
function drawDoor(d) {
  const T = TILE, a = d.o === 'h' ? d.phi : Math.PI / 2 - d.phi, ht = DOOR_HT;
  if (!doorSpr) doorSpr = makeDoorSprite();
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.save(); ctx.translate(d.hx, d.hy); ctx.rotate(a);
  ctx.drawImage(doorSpr, 0, -ht, T - 2, ht * 2);
  ctx.restore(); ctx.imageSmoothingEnabled = sm;
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
  fx.blasts = fx.blasts.filter(b => performance.now() - b.t0 < BLAST_T);
  fx.hooks = fx.hooks.filter(h => performance.now() - h.t0 < HOOK_FX_T);
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
const VIS_N = 300, visD = new Float32Array(VIS_N), visCos = new Float32Array(VIS_N), visSin = new Float32Array(VIS_N);
for (let i = 0; i < VIS_N; i++) { visCos[i] = Math.cos(i / VIS_N * TAU); visSin[i] = Math.sin(i / VIS_N * TAU); }
let visX = NaN, visY = NaN, visLv = null, visDoors = 0;
function drawVision() {
  const x = pred.x, y = pred.y, N = VIS_N, R = 1100, vw = W / Z, vh = H / Z;
  ctx.beginPath(); ctx.rect(cam.x - vw / 2 - 60, cam.y - vh / 2 - 60, vw + 120, vh + 120);
  // os 300 raios só são recalculados quando o jogador se mexeu (ou uma porta mudou); parado, reaproveita o quadro anterior
  let dk = 0; for (const d of level.doors) dk += (d.phi || 0) * (d.i + 1) + (d.latched ? 0.001 * (d.i + 1) : 0);
  if (Math.abs(x - visX) > 0.4 || Math.abs(y - visY) > 0.4 || visLv !== level || Math.abs(dk - visDoors) > 1e-6) {
    for (let i = 0; i < N; i++) visD[i] = level.ray(x, y, i / N * TAU, R);
    visX = x; visY = y; visLv = level; visDoors = dk;
  }
  for (let i = 0; i < N; i++) {
    const d = visD[i], px = x + visCos[i] * d, py = y + visSin[i] * d;
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
  const look = keys.shift ? 0.85 : 0.33, maxL = keys.shift ? 520 : 290;   // SHIFT: solta/estende a câmera
  const spec = me && !me.al ? specTarget() : null;   // espectando alguém?
  let ox = (mouse.x - W / 2) / Z * look, oy = (mouse.y - H / 2) / Z * look; const ol = Math.hypot(ox, oy);
  if (ol > maxL) { ox *= maxL / ol; oy *= maxL / ol; }
  let tx = pred.x + ox, ty = pred.y + oy;
  if (spec) { const ie = interpEnemy(spec.id) || { x: spec.x, y: spec.y }; tx = ie.x; ty = ie.y; }
  if (!camInit) { cam.x = tx; cam.y = ty; camInit = true; } else { const k = Math.min(1, dt * 9); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; }
  const sx = (Math.random() - .5) * shake, sy = (Math.random() - .5) * shake;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = level.m.theme.out; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * (W / 2 - (cam.x + sx) * Z), dpr * (H / 2 - (cam.y + sy) * Z));
  const vhw = W / Z / 2 + 40, vhh = H / Z / 2 + 40, vx0 = cam.x - vhw, vx1 = cam.x + vhw, vy0 = cam.y - vhh, vy1 = cam.y + vhh;
  const inView = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;   // fora da tela não desenha
  blitView(levelCv, vx0, vy0, vx1 - vx0, vy1 - vy0);
  for (const f of poolFurn) if (inView((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE, f.w * TILE / 2 + 40)) drawPool(f, now);
  fountainFurn.forEach((f, i) => { if (inView((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE, f.w * TILE / 2 + 40)) drawFountain(f, now, snap.fc && snap.fc[i]); });
  blitView(decal, vx0, vy0, vx1 - vx0, vy1 - vy0);
  {   // porta dentro de uma construção com teto: só aparece para quem está dentro (acompanha o fade do teto, inclusive a folha aberta que sai do contorno)
    const rs = level.m.roofs || [];
    for (const d of level.doors) {
      if (!inView(d.hx, d.hy, TILE) || isFacadeDoor(d)) continue;
      let al = 1;
      for (let i = 0; i < rs.length; i++) { const r = rs[i]; if (d.x >= r.x && d.x < r.x + r.w && d.y >= r.y && d.y < r.y + r.h) { al = 1 - (roofA[i] === undefined ? 1 : roofA[i]); break; } }
      if (al < 0.02) continue;
      ctx.globalAlpha = al; drawDoor(d); ctx.globalAlpha = 1;
    }
  }
  for (const c of fx.corpses) if (inView(c.x, c.y, 80)) drawCorpse(c);

  // paredes antes dos personagens: evita que a camada de paredes cubra o sprite
  blitView(wallCv, vx0, vy0, vx1 - vx0, vy1 - vy0);
  // ESCURIDÃO DA CASA: cômodo com a luz apagada fica bem escuro e semitransparente (piso, móveis, paredes, portas, corpos e sangue ficam esmaecidos).
  // Itens no chão, tiros (com brilho) e o SEU boneco são desenhados depois, por cima da escuridão; adversários dentro de cômodo apagado ficam invisíveis.
  const DARK_A = 0.6;   // escuridão semitransparente: dá para ver o cômodo (piso, móveis, paredes), mas adversários lá dentro continuam invisíveis
  const loff = snap.lo | 0, lrooms = level.m.rooms || [];
  const darkAt = (x, y) => { for (let i = 0; i < lrooms.length; i++) if ((loff >> i) & 1) { const r = lrooms[i]; if (x >= r.x1 * TILE && x < (r.x2 + 1) * TILE && y >= r.y1 * TILE && y < (r.y2 + 1) * TILE) return true; } return false; };
  if (lrooms.length) {
    ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < lrooms.length; i++) {
      const target = (loff >> i) & 1; roomD[i] = (roomD[i] || 0) + (target - (roomD[i] || 0)) * Math.min(1, dt * 10);
      const a = roomD[i]; if (a < 0.02) continue;
      const r = lrooms[i], x0 = (r.x1 - 1) * TILE, y0 = (r.y1 - 1) * TILE, w0 = (r.x2 - r.x1 + 3) * TILE, h0 = (r.y2 - r.y1 + 3) * TILE;
      if (!inView(x0 + w0 / 2, y0 + h0 / 2, Math.max(w0, h0))) continue;
      ctx.fillStyle = `rgba(2,3,8,${DARK_A * a})`; ctx.fillRect(x0, y0, w0, h0);
    }
    ctx.restore();
  }
  // itens no chão
  let near = null, nd = PICK_R;
  for (const it of snap.it) {
    const [, x, y, type, , rot, thrown] = it;
    if (!inView(x, y, 140)) continue;
    const onTable = !thrown && level.onTable(x, y);
    if (onTable && (type === 'WINE' || type === 'BROKEN')) drawBottleOnTable(x, y, type);   // garrafa em pé em cima da mesa (objeto da casa, sem cara de arma)
    else {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      if (type === 'WINE' || type === 'BROKEN') { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2; }   // garrafa no chão: sombra suave, sem brilho colorido de arma
      else { ctx.shadowColor = WEAPONS[type].col; ctx.shadowBlur = thrown ? 6 : 12; }
      ctx.scale(CS * 1.05, CS * 1.05); if (thrown && type === 'SPEAR') ctx.translate(-55, 0); drawWeaponSprite(type); ctx.restore();
    }
    if (!thrown && me && me.al && canHold(me.sk, type) && !(isBottle(type) && onTable)) { const d = itemDistOn(level, type, x, y, rot, pred.x, pred.y); if (d < nd) { nd = d; near = it; } }
  }
  if (near) {
    const t = (WEAPONS[near[3]].name + (near[4] ? ' · ' + near[4] : '')).toUpperCase();
    ctx.save(); ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(t).width, bw = tw + 38, bx = near[1] - bw / 2, by = near[2] - 48;
    rrect(ctx, bx, by, bw, 22, 2, 'rgba(11,12,10,.9)', 'rgba(226,169,59,.9)', 1.2);
    rrect(ctx, bx + 3, by + 3, 16, 16, 2, '#e2a93b'); ctx.fillStyle = '#14120c'; ctx.textAlign = 'center'; ctx.fillText('E', bx + 11, by + 11.5);
    ctx.fillStyle = '#e8e6d8'; ctx.textAlign = 'left'; ctx.fillText(t, bx + 25, by + 11.5); ctx.restore();
  }
  // quem está dentro de uma casa não vê quem está fora (nem fora de outra casa): só enxerga quem está sob o mesmo teto
  const roofAt = (x, y) => { const rs = level.m.roofs || []; for (let i = 0; i < rs.length; i++) { const r = rs[i]; if (x >= r.x * TILE && x < (r.x + r.w) * TILE && y >= r.y * TILE && y < (r.y + r.h) * TILE) return i; } return -1; };
  const myRoof = roofAt(me && me.al ? pred.x : cam.x, me && me.al ? pred.y : cam.y);
  const hiddenFoe = f => myRoof >= 0 && roofAt(f.x, f.y) !== myRoof;
  // mira a laser de quem segura o sniper
  const laser = (px, py, pa) => {
    const mz = WEAPONS.SNIPER.muz, x0 = px + Math.cos(pa) * mz, y0 = py + Math.sin(pa) * mz, len = level.ray(x0, y0, pa, 2600);
    const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len); g.addColorStop(0, 'rgba(255,60,90,.55)'); g.addColorStop(1, 'rgba(255,60,90,.12)');
    ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len); ctx.stroke();
    ctx.fillStyle = 'rgba(255,70,100,.9)'; ctx.shadowColor = '#ff3c5a'; ctx.shadowBlur = 10; circle(x0 + Math.cos(pa) * len, y0 + Math.sin(pa) * len, 3); ctx.restore();
  };
  for (const f of foesOf()) if (f.al && !f.dn && f.w === 'SNIPER' && !hiddenFoe(f) && !darkAt(f.x, f.y)) { const ie = interpEnemy(f.id) || { x: f.x, y: f.y, a: f.a }; laser(ie.x, ie.y, ie.a); }
  if (me && me.al && !me.dn && me.w === 'SNIPER') laser(pred.x, pred.y, aimAngle());
  // balas
  const age = Math.min(0.06, (now - snapAt) / 1000);
  ctx.lineCap = 'round';
  for (const b of snap.b) {
    if (hiddenB.has(b[0])) continue;   // é uma bala minha: já estou desenhando a prevista
    if (!inView(b[1], b[2], 130)) continue;
    if (b[6]) { drawOrb(b[1] + b[3] * age, b[2] + b[4] * age, b[6], now); continue; }   // bola de energia do Shadow 2
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

  // jogadores
  // Sem névoa no mapa, todos os adversários vivos são sempre desenhados.
  for (const f of foesOf()) {
    if (!f.al || hiddenFoe(f) || darkAt(f.x, f.y)) continue;
    const ie = interpEnemy(f.id) || { x: f.x, y: f.y, a: f.a };
    if (!inView(ie.x, ie.y, 160) && !(spec && f.id === spec.id)) continue;
    if (spec && f.id === spec.id) { ctx.save(); ctx.strokeStyle = jacketOf(f.id); ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 220); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(ie.x, ie.y, 36, 0, TAU); ctx.stroke(); ctx.restore(); }
    drawPlayer(f, ie.x, ie.y, ie.a, false, now); if (!f.dv) { drawHpBar(ie.x, ie.y, f.hp ?? maxHpOf(f.sk), false, maxHpOf(f.sk)); drawName(ie.x, ie.y, f.nm, f.id); }   // barras de cura e de carga da lança só aparecem para o próprio jogador
  }
  // GANCHO do Shadow 4: corda do boneco até o alvo preso (e a corda curta de quem errou)
  for (const p of snap.pl) {
    if (!p.hk || !p.al) continue;
    if (p.hk < 0) {   // preso em parede/objeto: a corda vai até o ponto de ancoragem
      const A = p.id === myId ? { x: pred.x, y: pred.y } : (interpEnemy(p.id) || { x: p.x, y: p.y });
      drawHookRope(A.x, A.y, p.hx, p.hy, 0);
      continue;
    }
    const tg = snap.pl.find(q => q.sl === p.hk - 1); if (!tg || !tg.al) continue;
    const pos = (q, mineRaw) => q.id === myId ? { x: pred.x, y: pred.y } : (mineRaw ? { x: q.x, y: q.y } : (interpEnemy(q.id) || { x: q.x, y: q.y }));
    const A = pos(p, false), B = pos(tg, p.id === myId);   // quando EU puxo, o alvo vem da posição do servidor para a corda não "sobrar"
    drawHookRope(A.x, A.y, B.x, B.y, 1);
  }
  for (const h of fx.hooks) {
    const t = Math.min(1, (performance.now() - h.t0) / HOOK_FX_T), len = (h.l || 300) * (t < 0.5 ? t * 2 : 1), a = 1 - t;
    ctx.save(); ctx.globalAlpha = a; drawHookRope(h.x, h.y, h.x + Math.cos(h.a) * len, h.y + Math.sin(h.a) * len, 0); ctx.restore();
  }
  if (me && me.al) drawPlayer(me, pred.x, pred.y, aimAngle(), true, now);   // nome/vida do próprio jogador são desenhados depois dos tetos (camada final), para nada cobrir

  // efeitos
  for (const p of fx.parts) {
    if (p.k === 'b') { ctx.fillStyle = '#b3122f'; circle(p.x, p.y, p.sz); }
    else if (p.k === 'o') { ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.6) * 0.8; ctx.strokeStyle = '#dff8ff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(p.x - p.sz * 0.45, p.y - p.sz * 0.5, 1.3, 1.3); ctx.restore(); }
    else if (p.k === 's') { ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke(); }
    else if (p.k === 'c') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#ffd86b'; ctx.fillRect(-2, -1, 4, 2); ctx.restore(); }
  }
  for (const b of fx.blasts) {   // ATIVA: onda de choque que se abre e some
    const t = Math.min(1, (performance.now() - b.t0) / BLAST_T), r = b.r * (0.25 + 0.75 * (1 - Math.pow(1 - t, 3))), a = 1 - t;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r); g.addColorStop(0, `rgba(255,120,60,${0.4 * a})`); g.addColorStop(1, 'rgba(255,60,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = `rgba(255,230,190,${0.9 * a})`; ctx.lineWidth = 6 * a + 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  for (const s of fx.slashes) {
    const wd = WEAPONS[s.w];
    if (!wd || s.w === 'FISTS') continue;
    const sp = Math.min(1, (performance.now() - s.t0) / (swDur(s.w) * dualSwMul(s.dc))), fade = Math.max(0, 1 - Math.max(0, sp - 0.35) / 0.65);
    if (fade <= 0 || sp < 0.1) continue;
    const pp = s.by === myId ? pred : (interpEnemy(s.by) || s), L = swingLunge(sp) * (s.w === 'SPEAR' ? 5 : 8) * CS;
    ctx.save(); ctx.translate(pp.x + Math.cos(s.a) * L, pp.y + Math.sin(s.a) * L); ctx.rotate(s.a);
    ctx.shadowColor = wd.col; ctx.shadowBlur = 14; ctx.lineCap = 'round';
    if (s.w === 'SPEAR' && s.dc !== 1) {   // estocada: rastro reto saindo da ponta
      const RG = wd.range * (s.dc === 2 ? 1.3 : 1), tip = RG * (0.55 + 0.45 * Math.sin(Math.min(1, sp / 0.5) * Math.PI / 2)), g = ctx.createLinearGradient(RG * 0.25, 0, tip, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, wd.col);
      for (const off of (s.dc === 0 ? [7] : s.dc === 1 ? [-7] : s.dc === 2 ? [7, -7] : [0])) {   // dupla: o rastro sai da lança do lado que estocou
        ctx.globalAlpha = fade * 0.85; ctx.strokeStyle = g; ctx.lineWidth = 5 * fade + 1; ctx.beginPath(); ctx.moveTo(RG * 0.25, off); ctx.lineTo(tip, off); ctx.stroke();
      }
    } else {                 // varrida: meia-lua que acompanha a ponta da arma e some
      const fin = s.dc === 2, arc = s.w === 'SPEAR' ? 1.9 : wd.arc * (fin ? 1.5 : 1), rng = wd.range * (fin ? 1.2 : s.w === 'SPEAR' ? 0.85 : 1);   // lança dupla, 2º golpe = slash
      const both2 = fin || (s.dc >= 0 && s.w !== 'SPEAR');   // Shadow 7 com duas armas: rastro das duas
      for (const dir of (both2 ? [s.dir || 1, -(s.dir || 1)] : [s.dir || 1])) {
        const head = swingAng(Math.min(sp, 0.62), arc, dir), tail = head - dir * Math.min(1.5, arc * 0.7) * (0.35 + 0.65 * Math.min(1, sp / 0.45));
        const r1 = rng * 0.95, r0 = rng * 0.5, a0 = Math.min(head, tail), a1 = Math.max(head, tail);
        ctx.globalAlpha = fade * 0.55; ctx.fillStyle = wd.col; ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = fade * 0.95; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // INTERRUPTORES (a escuridão em si é desenhada mais cedo, logo depois das paredes)
  if (level.m.rooms && level.m.rooms.length) {
    const off = snap.lo | 0;
    ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // interruptores: plaquinha na parede (alavanca para cima = aceso). Apagado, ganha um brilhinho para dar pra achar no escuro.
    const swNear = me && me.al ? level.switchNear(pred.x, pred.y) : null;
    for (const s of level.m.switches) {
      const [sx, sy] = level.switchPos(s);
      if (!inView(sx, sy, 60)) continue;
      const on = !s.rooms.some(r => (off >> r) & 1), rot = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 }[s.face] || 0;
      if (!on) { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34); g.addColorStop(0, 'rgba(255,214,110,.38)'); g.addColorStop(1, 'rgba(255,214,110,0)'); ctx.fillStyle = g; ctx.fillRect(sx - 34, sy - 34, 68, 68); ctx.globalCompositeOperation = 'source-over'; }
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot);
      rrect(ctx, -3, -11, 6, 22, 2, '#f3ead6', '#5a4632', 1.2);
      rrect(ctx, -1.6, on ? -8 : 1, 3.2, 7, 1, on ? '#f2c94c' : '#7d828c');
      ctx.restore();
      if (swNear === s) {   // balãozinho com a tecla de interagir
        const t = keyName(bindOf('v')), nx = Math.cos(rot), ny = Math.sin(rot), bx = sx + nx * 34, by = sy + ny * 34;
        ctx.save(); ctx.font = '700 13px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText('LUZ').width, bw = tw + 14 + Math.max(16, ctx.measureText(t).width + 8);
        rrect(ctx, bx - bw / 2, by - 11, bw, 22, 2, 'rgba(11,12,10,.9)', 'rgba(226,169,59,.9)', 1.2);
        const kw = Math.max(16, ctx.measureText(t).width + 8); rrect(ctx, bx - bw / 2 + 3, by - 8, kw, 16, 2, '#e2a93b');
        ctx.fillStyle = '#14120c'; ctx.textAlign = 'center'; ctx.fillText(t, bx - bw / 2 + 3 + kw / 2, by + 0.5);
        ctx.fillStyle = '#e8e6d8'; ctx.textAlign = 'left'; ctx.fillText('LUZ', bx - bw / 2 + kw + 9, by + 0.5); ctx.restore();
      }
    }
    // QUADRO DE ENERGIA: caixa metálica na parede. Inteiro = LED verde (dá pra achar no escuro); baleado = chamuscado, LED apagado e faíscas de vez em quando.
    const pwm = snap.pw | 0, pns = level.m.panels || [];
    for (let i = 0; i < pns.length; i++) {
      const pn = pns[i], [px2, py2] = level.switchPos(pn);
      if (!inView(px2, py2, 60)) continue;
      const dead = (pwm >> i) & 1, rot = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 }[pn.face] || 0;
      if (!dead) { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(px2, py2, 0, px2, py2, 36); g.addColorStop(0, 'rgba(110,255,150,.30)'); g.addColorStop(1, 'rgba(110,255,150,0)'); ctx.fillStyle = g; ctx.fillRect(px2 - 36, py2 - 36, 72, 72); ctx.globalCompositeOperation = 'source-over'; }
      else if (Math.random() < dt * 2.5) { const a = Math.random() * TAU; fx.parts.push({ k: 's', x: px2, y: py2, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.2, sz: 3, col: '#9ff7ff' }); }
      ctx.save(); ctx.translate(px2, py2); ctx.rotate(rot);
      rrect(ctx, -6, -16, 11, 32, 2, dead ? '#3a3d42' : '#7b8088', '#1d2025', 1.5);
      rrect(ctx, -3, -13, 6, 26, 1, dead ? '#25272b' : '#4d535b');
      if (!dead) {   // raio amarelo + LED verde
        ctx.fillStyle = '#f2c94c'; ctx.beginPath(); ctx.moveTo(-1, -6); ctx.lineTo(2, -1); ctx.lineTo(0, -1); ctx.lineTo(2, 7); ctx.lineTo(-2, 1); ctx.lineTo(0, 1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6dff96'; ctx.beginPath(); ctx.arc(0, -10, 1.8, 0, TAU); ctx.fill();
      } else {       // buraco da bala e marca de queimado
        ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.arc(0, 1, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-3, -10); ctx.lineTo(1, -4); ctx.lineTo(-2, 3); ctx.lineTo(2, 10); ctx.stroke();
        ctx.fillStyle = '#5a1d1d'; ctx.beginPath(); ctx.arc(0, -10, 1.8, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  // ombrelones: a copa fica por cima dos personagens; transparente quando EU estou debaixo dela
  {
    const fs = level.m.furn, cvx = me && me.al ? pred.x : cam.x, cvy = me && me.al ? pred.y : cam.y;
    ctx.shadowBlur = 0;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i]; if (f.k !== 'patio') continue;
      const px = (f.x + f.w / 2) * TILE, py = (f.y + f.h / 2) * TILE, R = Math.min(f.w, f.h) * TILE / 2 - 2;
      if (!inView(px, py, R + 20)) continue;
      const under = Math.hypot(cvx - px, cvy - py) < R, tgt = under ? 0.3 : 0.96;
      canA[i] = (canA[i] === undefined ? tgt : canA[i]) + (tgt - (canA[i] === undefined ? tgt : canA[i])) * Math.min(1, dt * 9);
      drawCanopy(px, py, R, canA[i]);
    }
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
  for (const d of level.doors) if (isFacadeDoor(d) && inView(d.hx, d.hy, TILE)) drawDoor(d);   // portas de entrada: visíveis por fora, por cima do teto
  // barras de cura e de carga da lança do PRÓPRIO jogador: por cima de tetos/efeitos, com o estado do canvas zerado
  if (me && me.al) {
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    // (nome e barra de vida do próprio jogador não são mais desenhados sobre o boneco: ficam só no painel de vitais)
    drawHealBar(pred.x, pred.y, me.hz, now, healTimeOf(me.sk));
    drawAirBar(pred.x, pred.y, me.dv, me.ai === undefined ? 1 : me.ai, !!level.waterAt(pred.x, pred.y), now);
    drawChargeBar(pred.x, pred.y, me.ch);
    if (me.dm) {   // modo dupla do Shadow 7: mostra se as duas armas estão prontas ou se falta a arma igual
      const t = me.dm === 1 ? 'DUPLA · 2 ARMAS' : 'DUPLA · PEGUE 2 ARMAS DO MESMO TIPO';
      ctx.save(); ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = me.dm === 1 ? '#ffd27a' : '#c9b3e0';
      ctx.strokeText(t, pred.x, pred.y - 89); ctx.fillText(t, pred.x, pred.y - 89); ctx.restore();
    }
    if (me.hm) {   // gancho na mão: mostra se está pronto ou em recarga
      const cdl = me.sq || 0, t = cdl > 0 ? 'GANCHO ' + cdl.toFixed(1) + 's' : 'GANCHO · ' + (IS_TOUCH ? 'ATIRE' : 'CLIQUE');
      ctx.save(); ctx.font = '700 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = cdl > 0 ? '#c9b3e0' : '#9fe6ff';
      ctx.strokeText(t, pred.x, pred.y - 89); ctx.fillText(t, pred.x, pred.y - 89); ctx.restore();
    }
    ctx.restore();
  }
  for (const q of fx.pops) {
    const k = 1 - q.t / (q.d || 0.9); ctx.save(); ctx.globalAlpha = q.d > 0.9 ? Math.max(0, Math.min(1, q.t / 0.7, (q.d - q.t) / 0.2)) : Math.min(1, q.t * 3);
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
// bola de energia (soco do Shadow 2): núcleo ciano brilhante dentro de um anel pulsante
function drawOrb(x, y, r, now) {
  const pu = 1 + 0.05 * Math.sin(now / 70);
  ctx.save(); ctx.lineCap = 'butt';
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 24;
  ctx.strokeStyle = '#19e8ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * pu, 0, TAU); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0fb8ff'; circle(x, y, r * 0.66);
  ctx.fillStyle = '#25f0ff'; circle(x, y, r * 0.52);
  ctx.fillStyle = '#b8fdff'; circle(x - r * 0.14, y - r * 0.14, r * 0.2);
  ctx.restore();
}
// nome do jogador acima do boneco (só no online)
function drawName(x, y, name, id) {
  if (!name) return;
  ctx.save(); ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10,0,20,.95)'; ctx.fillStyle = jacketOf(id);   // nome na cor do personagem
  ctx.strokeText(name, x, y - 51); ctx.fillText(name, x, y - 51); ctx.restore();
}
// corda + garra do gancho do Shadow 4 (cor chapada, contorno preto, no mesmo estilo da pixel art)
function drawHookRope(x0, y0, x1, y1, claw) {
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const ex = x1 - ux * (claw ? PR * 0.6 : 0), ey = y1 - uy * (claw ? PR * 0.6 : 0);   // a garra prende na borda do alvo
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = OL; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = '#d9c6a0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = '#8b6a3a'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
  const nx = -uy, ny = ux, hx = ex + ux * 2, hy = ey + uy * 2;   // garra: três dentes
  ctx.strokeStyle = OL; ctx.lineWidth = 6;
  for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx + nx * 9 * k - ux * 6 * Math.abs(k), hy + ny * 9 * k - uy * 6 * Math.abs(k)); ctx.stroke(); }
  ctx.strokeStyle = '#c9d2dc'; ctx.lineWidth = 3;
  for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx + nx * 9 * k - ux * 6 * Math.abs(k), hy + ny * 9 * k - uy * 6 * Math.abs(k)); ctx.stroke(); }
  ctx.restore();
}
function drawHpBar(x, y, hp, mine, mx = MAX_HP) {
  const k = Math.max(0, Math.min(1, hp / mx)), w = 44;
  ctx.fillStyle = 'rgba(8,9,8,.88)'; ctx.fillRect(x - w / 2 - 1.5, y - 49, w + 3, 7);
  ctx.fillStyle = k > 0.3 ? (mine ? '#93aa5c' : '#c4372c') : '#e2a93b'; ctx.fillRect(x - w / 2, y - 47.5, w * k, 4);
  ctx.fillStyle = 'rgba(8,9,8,.9)'; for (let i = 1; i < 4; i++) ctx.fillRect(x - w / 2 + w * i / 4 - 0.5, y - 47.5, 1, 4);
}
// barra de cura: barra verde carregando acima da cabeça
// FÔLEGO: barra de ar aparece quando você está mergulhado ou ainda recuperando o ar (sem aviso de tecla)
function drawAirBar(x, y, dv, ai, inWater, now) {
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (dv || ai < 0.995) {
    const w = 56, k = Math.max(0, Math.min(1, ai)), low = k < 0.34, blink = low && dv && Math.sin(now / 90) > 0;
    ctx.fillStyle = 'rgba(4,16,34,.92)'; ctx.fillRect(x - w / 2 - 2, y - 66, w + 4, 11);
    ctx.fillStyle = blink ? '#ff5a5a' : low ? '#ffb34a' : '#6fdcff'; ctx.fillRect(x - w / 2, y - 64, w * k, 7);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x - w / 2, y - 64, w * k, 2);
    ctx.font = '700 11px Rajdhani, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = low && dv ? '#ff8a8a' : '#dff8ff';
    const t = dv ? (low ? 'SEM AR! SUBA (' + keyName(bindOf('v')) + ')' : 'AR') : 'AR'; ctx.strokeText(t, x, y - 74); ctx.fillText(t, x, y - 74);
  }
  ctx.restore();
}
function drawHealBar(x, y, hz, now, ht = HEAL_TIME) {
  if (!(hz > 0)) return;
  const k = Math.max(0, Math.min(1, 1 - hz / ht)), w = 56;
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
  const cx = mouse.x, cy = mouse.y;
  ctx.save(); ctx.translate(cx, cy);
  const col = empty ? '#c4372c' : '#e8e6d8'; ctx.lineCap = 'butt';
  for (const lw of [4, 1.6]) {   // mira tática: quatro traços com vão no centro + ponto
    ctx.strokeStyle = lw === 4 ? 'rgba(0,0,0,.6)' : col; ctx.lineWidth = lw; ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(dx * 6, dy * 6); ctx.lineTo(dx * 14, dy * 14); }
    ctx.stroke();
  }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, TAU); ctx.fill(); ctx.restore();
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
function cfgSummary(cf) {
  if (!cf) return '';
  const [win, time, , heal, weap, map] = cf;
  return [map && MAPS[map] ? 'Fase: ' + MAPS[map].name : 'Fase aleatória', 'Primeiro a ' + win, time ? 'Tempo: ' + fmtDur(time) + ' por rodada' : 'Sem limite de tempo',
    'Armas: ' + ({ 0.5: 'poucas', 1: 'normais', 2: 'muitas' }[weap] || 'normais'), 'Cura ' + (heal ? 'ligada' : 'desligada')].join(' · ');
}
function updateLobby() {
  const show = mode === 'online' && snap.ph === 'lobby';
  $('lobby').classList.toggle('hidden', !show || paused);
  $('hud').classList.toggle('inlobby', show);
  if (!show) { lobbyKey = ''; return; }
  const isHost = snap.host === myId, n = snap.pl.length, can = isHost && n >= MIN_PLAYERS;
  const key = [snap.host, myId, snap.cf ? snap.cf.join(',') : '', ...snap.pl.map(p => p.id + ':' + p.nm + ':' + p.sk + ':' + p.cl)].join('|');
  if (key !== lobbyKey) {
    lobbyKey = key;
    $('lobbyCount').textContent = `${n}/${roomMax()} conectados`;
    $('lobbyCfg').textContent = cfgSummary(snap.cf);
    { const lc = $('lobbyCode'); lc.textContent = roomCode; const sm = document.createElement('small'); sm.textContent = 'CÓDIGO DA SALA · toque para copiar o link'; lc.appendChild(sm); }
    const el = $('lobbyList'); el.textContent = '';
    const list = [...snap.pl].sort((a, b) => a.sl - b.sl);
    for (let i = 0; i < roomMax(); i++) {
      const p = list[i], row = document.createElement('div');
      if (!p) { row.className = 'lrow empty'; const d0 = document.createElement('i'), n0 = document.createElement('span'); n0.textContent = 'Vaga aberta…'; row.append(d0, n0); el.appendChild(row); continue; }
      row.className = 'lrow' + (p.id === myId ? ' me' : '');
      const dot = document.createElement('i'); dot.style.background = p.cl || (SKINS[p.sk] || SKINS.HERO).c;
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
  const key = snap.rd + '/' + roomWin() + '#' + snap.pl.map(p => [p.id, p.nm, p.sc, p.al, p.sl, Math.round(p.hp / MAX_HP * 100)].join(':')).join('|');
  if (key === rosterKey) return; rosterKey = key;
  const el = $('roster'); el.textContent = '';
  const head = document.createElement('div'); head.className = 'rhead'; head.textContent = snap.rd ? `Rodada ${snap.rd} · primeiro a ${roomWin()}` : 'Sala'; el.appendChild(head);
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
// painel de vitais (canto inferior esquerdo): vida segmentada, cura e recarga da ativa
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
function drawFace(cvs, skin, jacket, dark) {
  const old = ctx; ctx = cvs.getContext('2d');
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, cvs.width, cvs.height);
    if (skin === 'HERO') {   // Shadow 4: o rosto de frente, direto da sua arte
      const c = pix('front', HERO_FRONT), s = Math.max(1, Math.floor(Math.min((cvs.width - 6) / c.width, (cvs.height - 10) / c.height)));
      ctx.imageSmoothingEnabled = false; ctx.drawImage(c, Math.round((cvs.width - c.width * s) / 2), 3, c.width * s, c.height * s);
    } else {
      ctx.setTransform(4.9, 0, 0, 4.9, cvs.width / 2, cvs.height / 2 + 4); ctx.rotate(-Math.PI / 2);
      ctx.translate(-5, 0);
      drawHead(SKINS[skin] ? skin : 'HERO', dark);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = jacket || '#e2a93b'; ctx.fillRect(0, cvs.height - 6, cvs.width, 6);   // faixa na cor da jaqueta
  } finally { ctx = old; }
}
function updateVitals(me) {
  const V = ensureVitals(); if (!V) return;
  const show = !!me && me.al && snap.ph !== 'lobby';
  if (V.c.show !== show) { V.c.show = show; V.el.classList.toggle('hidden', !show); }
  if (!show) return;
  const mh = maxHpOf(me.sk), hpv = me.hp ?? mh;
  const pct = Math.max(0, Math.round(hpv / mh * 100)), num = Math.max(0, Math.round(hpv / MAX_HP * 100)), st = pct <= 30 ? 'low' : pct <= 60 ? 'mid' : 'ok';   // barra relativa à vida do personagem; número em % da vida base (gorila começa em 200)
  if (V.c.pct !== pct) { V.c.pct = pct; V.fill.style.width = pct + '%'; V.ghost.style.width = pct + '%'; }
  if (V.c.num !== num) { V.c.num = num; V.num.textContent = num; }
  if (V.c.st !== st) { V.c.st = st; V.el.classList.remove('ok', 'mid', 'low'); V.el.classList.add(st); V.tag.textContent = st === 'low' ? 'CRÍTICO' : st === 'mid' ? 'FERIDO' : 'EM PÉ'; }
  const nm = me.nm || ''; if (V.c.nm !== nm) { V.c.nm = nm; V.name.textContent = nm; }
  const fk = (me.sk || 'HERO') + '|' + jacketOf(me.id) + '|' + (me.dk > 0 ? 1 : 0);   // retrato da máscara: redesenha só quando muda
  if (V.c.fk !== fk) { V.c.fk = fk; drawFace(V.face, me.sk, jacketOf(me.id), me.dk > 0); }
  const hz = me.hz > 0 ? Math.round((1 - me.hz / healTimeOf(me.sk)) * 100) : -1;
  if (V.c.hz !== hz) { V.c.hz = hz; V.heal.classList.toggle('on', hz >= 0); if (hz >= 0) V.healI.style.width = hz + '%'; }
  const act = hasActive(me.sk); if (V.c.act !== act) { V.c.act = act; V.cdI.parentNode.style.display = act ? '' : 'none'; }   // gorila (explosão) e Shadow 4 (gancho) têm ativa
  const acd = me.sq || 0, ready = acd <= 0, cd = ready ? 100 : Math.round((1 - Math.min(1, acd / activeCdOf(me.sk))) * 100);
  if (V.c.cd !== cd) { V.c.cd = cd; V.cdI.style.width = cd + '%'; }
  if (V.c.rd !== ready) { V.c.rd = ready; V.el.classList.toggle('cooling', !ready); }
}
function updateHud(now) {
  if (!snap) return;
  const me = myState();
  updateLobby();
  setText('pingTxt', mode === 'online' ? `${pingMs} ms · ${snap.pl.length}/${roomMax()} jogadores` : 'treino · offline');
  updateRoster();
  {   // relógio da rodada (só com tempo máximo configurado)
    const rt = snap.ph === 'live' ? snap.rt : -1, el = $('roundTimer');
    if (rt >= 0) { const sec = Math.ceil(rt); setText('roundTimer', Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')); el.classList.remove('hidden'); el.classList.toggle('low', rt <= 10); }
    else el.classList.add('hidden');
  }
  if (me) {
    updateInv(me);
    updateVitals(me);
    { const sp = canSpec() ? specTarget() : null; $('spectate').classList.toggle('hidden', !sp); if (sp) { setText('specName', sp.nm); $('specName').style.color = jacketOf(sp.id); } }

  }
  // banner
  let t = '', s = '', cls = '';
  const mySlot = me ? me.sl : 0;
  switch (snap.ph) {
    case 'waiting': t = 'Aguardando'; s = `Esperando jogadores (${snap.pl.length}/${roomMax()}). A partida começa com ${MIN_PLAYERS} ou mais.`; break;
    case 'countdown': t = String(Math.max(1, Math.ceil(snap.tm))); s = `Rodada ${snap.rd} · ${MAPS[snap.map] ? MAPS[snap.map].name : ''}`; break;
    case 'live': if (now < goUntil) t = 'Vai!'; break;
    case 'over':
      if (snap.win === -1) { t = 'Empate'; s = snap.tu ? 'Tempo esgotado: vida igual, ninguém pontua.' : 'Todos caíram.'; }
      else if (snap.win === mySlot) { t = 'Rodada sua'; cls = 'win'; s = (snap.tu ? 'Tempo esgotado: você tinha mais vida. ' : '') + 'Prepare-se para a próxima.'; }
      else { const w = snap.pl.find(p => p.sl === snap.win); t = snap.tu ? 'Tempo esgotado' : 'Você morreu'; cls = 'lose'; s = (w ? w.nm + (snap.tu ? ' tinha mais vida. ' : ' venceu a rodada. ') : '') + 'Prepare-se para a próxima.'; }
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
let last = performance.now(), acc = 0, idleN = 0, fpsAcc = 0, fpsN = 0, qualCool = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // qualidade dinâmica: se a média de quadros ficar abaixo de ~48 fps por 2 s em partida, baixa a resolução interna (0,25 por vez, mínimo 0,75)
  if (mode && !paused && !document.hidden) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (qualCool > 0) qualCool--; else if (fps < 48 && dprCap > 0.75) { dprCap = Math.max(0.75, dprCap - 0.25); qualCool = 2; resize(); } }
  } else { fpsAcc = 0; fpsN = 0; }
  // menu/abertura cobrem o canvas por inteiro: não gasta GPU/CPU redesenhando o fundo a 60 fps
  if (!mode) { if (idleN++ % 30 === 0) drawIdle(now); return; }
  if (!paused) { acc += dt; let n = 0; while (acc >= STEP && n < 5) { doStep(); acc -= STEP; n++; } if (n >= 5) acc = 0; }
  render(now, paused ? 0 : dt);
}
requestAnimationFrame(frame);

/* ------------------------------------------------ ABERTURA / TELA DE TÍTULO (estilo "Press Start" de console)
   1) noite, lua grande e um cavaleiro cruzando a serra   2) clarão e o logo surge   3) "INICIAR JOGO" pisca e a cena fica em
   loop (anoitecer → dia → noite…) até o jogador apertar ESPAÇO (ou Enter / clique / toque). Tudo desenhado em canvas. */
const introEl = $('intro'), icv = $('introCv'), ic = icv.getContext('2d');
let iW = 0, iH = 0, iD = 1, introOn = true, introT = 0, introLast = performance.now(), introGo = -1, introSkipAt = 0, introDust = [], introShot = '';
let bootOn = true, bootDoneAt = 0;   // tela de carregamento (N64) na frente: a abertura e a música só começam quando ela acaba e o jogador aperta uma tecla
let sunCv = null, sunR = 0, moonCv = null, logoCv = null, logoFs = 0, logoW = 0, logoH = 0, shineCv = null;
const IT_CUT1 = 2.8,        // segundos: corte da serra (câmera 1) para o cavaleiro vindo do fundo (câmera 2)
  IT_FLASH = 6.0,           // segundos: clarão + surge o logo
  IT_PROMPT = 8.4,          // segundos: aparece "INICIAR JOGO"
  IT_GO = 0.55,             // duração do efeito ao apertar ESPAÇO
  IT_HOLD = 10.8, IT_FADE = 1.2; // cada câmera do loop: tempo + transição de cor para a próxima
const iC01 = x => Math.max(0, Math.min(1, x)), iEase = x => { x = iC01(x); return x * x * (3 - 2 * x); };
function iResize() { iD = Math.min(window.devicePixelRatio || 1, 1.5); iW = innerWidth; iH = innerHeight; icv.width = Math.floor(iW * iD); icv.height = Math.floor(iH * iD); sunCv = moonCv = logoCv = shineCv = null; }
addEventListener('resize', iResize); iResize();
try { if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('400 40px Bungee'), document.fonts.load('700 24px Rajdhani')]).then(() => { logoCv = null; }, () => { }); } catch { }

/* ---- cenários (cores) e mistura entre eles */
const iRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const iRgbS = a => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`, iRgba = (a, al) => `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`;
const iScenes = (() => {
  const mk = o => ({ sky: o.sky.map(iRgb), hill: o.hill.map(iRgb), gr: o.gr.map(iRgb), line: iRgb(o.line), g1: iRgb(o.g1), g2: iRgb(o.g2), rim: iRgb(o.rim), fill: iRgb(o.fill), dust: iRgb(o.dust), cloud: iRgb(o.cloud), ca: o.ca, st: o.st, moon: o.moon, sun: o.sun, dsun: o.dsun });
  return {
    dusk: mk({ sky: ['#0a0214', '#14041f', '#3a0a5e', '#b3126b', '#ff7a59'], hill: ['#2a0b46', '#1d0735', '#12041f'], gr: ['#1a0430', '#07010d'], line: '#ff2e97', g1: '#ff46aa', g2: '#00e5ff', rim: '#ff46aa', fill: '#0e0618', dust: '#ff96d2', cloud: '#ff7ab8', ca: 0.2, st: 0.9, moon: 0, sun: 1, dsun: 0 }),
    day: mk({ sky: ['#0b2a6e', '#1f5cc0', '#4a96e8', '#9bd6ff', '#ffe3b0'], hill: ['#2f5f9c', '#1d4375', '#0f2547'], gr: ['#13335c', '#06101f'], line: '#8fe8ff', g1: '#7ad8ff', g2: '#ffe27a', rim: '#a8e6ff', fill: '#0b1830', dust: '#cfeaff', cloud: '#ffffff', ca: 0.5, st: 0, moon: 0, sun: 0, dsun: 1 }),
    night: mk({ sky: ['#02010a', '#07052a', '#150a46', '#2e1670', '#5a2e96'], hill: ['#140b38', '#0b0626', '#05031a'], gr: ['#0a0524', '#030110'], line: '#7a5cff', g1: '#6a4ae0', g2: '#9fb8ff', rim: '#8f7cff', fill: '#04020c', dust: '#a89cff', cloud: '#7a6cff', ca: 0.16, st: 1, moon: 1, sun: 0, dsun: 0 })
  };
})();
const iSeq = [iScenes.dusk, iScenes.day, iScenes.night];
const iMix = (a, b, k) => Array.isArray(a) ? a.map((v, i) => iMix(v, b[i], k)) : a + (b - a) * k;
const iMixScene = (a, b, k) => { if (k <= 0) return a; const o = {}; for (const key in a) o[key] = iMix(a[key], b[key], k); return o; };

function buildSun(r) {
  sunR = r; sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = Math.ceil(r * 2);
  const c = sunCv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, r * 2);
  g.addColorStop(0, '#ffe600'); g.addColorStop(0.55, '#ff7a59'); g.addColorStop(1, '#ff2e97');
  c.fillStyle = g; c.beginPath(); c.arc(r, r, r, 0, TAU); c.fill();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) c.fillRect(0, r + i * (r / 8), r * 2, (2 + i * 1.6) * r / 90);   // faixas do sol
}
function buildMoon(r) {
  moonCv = document.createElement('canvas'); moonCv.width = moonCv.height = Math.ceil(r * 2);
  const c = moonCv.getContext('2d'), g = c.createRadialGradient(r * 0.8, r * 0.75, r * 0.1, r, r, r);
  g.addColorStop(0, '#fffdf0'); g.addColorStop(0.7, '#dcdcf4'); g.addColorStop(1, '#a9a8d6');
  c.fillStyle = g; c.beginPath(); c.arc(r, r, r, 0, TAU); c.fill();
  c.save(); c.beginPath(); c.arc(r, r, r, 0, TAU); c.clip();
  for (const [x, y, k, a] of [[0.62, 0.34, 0.2, 0.2], [0.34, 0.5, 0.26, 0.16], [0.58, 0.68, 0.17, 0.2], [0.78, 0.55, 0.1, 0.16], [0.4, 0.24, 0.1, 0.14], [0.25, 0.75, 0.12, 0.14]]) {
    c.fillStyle = `rgba(110,110,170,${a})`; c.beginPath(); c.arc(x * r * 2, y * r * 2, k * r, 0, TAU); c.fill();
  }
  c.restore();
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

let H_FILL = '#0e0618', H_RIM = 'rgba(255,70,170,.8)';   // mudam com o cenário
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
  // cabeça do personagem Loiro (pixel art de perfil)
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(pix('side', HERO_SIDE), 4, -85, 24, 22); c.restore();
  return hooves;
}

/* ---- cavalo + cavaleiro em 3D: malha de elipsoides e faixas, luz por face + brilho de contorno (rim) neon,
   projetados em perspectiva e pintados de trás pra frente no canvas 2D. Modelo: x = frente, y = cima, z = lado. Origem = centro do corpo; chão em y = -92. */
let H_FILLA = [14, 6, 24], H_RIMA = [255, 70, 170];
const R3_A = 34, R3_DUTY = 0.5, R3_W = 11;   // meia-passada, fração de apoio e velocidade do galope (rad/s)
const R3_FOOT = 2 * R3_A / (R3_DUTY * (TAU / R3_W));   // velocidade (un/s) do casco apoiado no chão: o cenário corre exatamente nisso
const R3_MESH = {};
// buffers reaproveitados a cada quadro (antes: um array novo por polígono + string de cor nova → coletor de lixo travando)
const R3_PV = new Float32Array(3 * 400), R3_NV = new Float32Array(3 * 400), R3_QMAX = 16000, R3_QD = new Float32Array(R3_QMAX * 9), R3_QC = new Array(R3_QMAX), R3_ORD = [];
const R3_COL = new Map();   // cache de strings 'rgb(r,g,b)' (cores quantizadas em passos de 4: o olho não vê, e o canvas reaproveita o parse)
function r3Rgb(r, g, b) { const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2); let v = R3_COL.get(k); if (!v) { v = `rgb(${(r >> 2) << 2},${(g >> 2) << 2},${(b >> 2) << 2})`; R3_COL.set(k, v); } return v; }
function r3Sph(nu, nv) {
  const k = nu * 100 + nv; if (R3_MESH[k]) return R3_MESH[k];
  const v = [];
  for (let j = 0; j <= nv; j++) { const a = Math.PI * j / nv; for (let i = 0; i <= nu; i++) { const b = TAU * i / nu; v.push(Math.cos(a), Math.sin(a) * Math.cos(b), Math.sin(a) * Math.sin(b)); } }
  return (R3_MESH[k] = { v, nu, nv, n: v.length / 3 });
}
const R3_HEX = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function drawRider3D(c, gait, t, yaw, pitch, o) {
  o = o || {}; const sil = !!o.sil, lo = !!o.lo;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), D = 900;
  const FA = H_FILLA, RA = H_RIMA, LX = -0.42, LY = 0.72, LZ = 0.55; let qn = 0;
  const wob = (k, a, p = 0) => Math.sin(t * k + p) * a;
  const st = (c0, rim, lit, emi) => ({ c: c0, rim, lit, emi: !!emi });
  const sHorse = st([FA[0] * 0.8 + RA[0] * 0.1, FA[1] * 0.8 + RA[1] * 0.1, FA[2] * 0.8 + RA[2] * 0.1], 0.95, 0.24),
    sCape = st([16, 198, 232], 0.3, 0.1), sPants = st([52, 80, 143], 0.28, 0.08), sBoot = st([244, 241, 234], 0.2, 0),
    sSkin = st([240, 195, 154], 0.2, 0.05), sScarf = st([255, 46, 77], 0.3, 0.1), sGold = st([255, 210, 63], 0, 0, true), sEye = st([255, 154, 208], 0, 0, true),
    sOwl = st(R3_HEX(HERO_PAL.m), 0.35, 0.08), sOwlD = st(R3_HEX(HERO_PAL.n), 0.3, 0.05), sFace = st(R3_HEX(HERO_PAL.k), 0.2, 0.05), sBeak = st(R3_HEX(HERO_PAL.Q), 0.2, 0.05), sOwlEye = st(R3_HEX(HERO_PAL.j), 0, 0, true);
  const SIL = 'rgb(3,1,10)';
  const shade = (s, nx, ny, nz) => {
    if (sil) return SIL;
    if (s.emi) return r3Rgb(s.c[0] | 0, s.c[1] | 0, s.c[2] | 0);
    const d = Math.max(0, nx * LX + ny * LY + nz * LZ), rm = Math.pow(1 - Math.max(0, nz), 2.2) * s.rim, a = 0.32 + 0.78 * d, e = rm + s.lit * d;
    const r = Math.min(255, s.c[0] * a + RA[0] * e), g = Math.min(255, s.c[1] * a + RA[1] * e), b = Math.min(255, s.c[2] * a + RA[2] * e);
    return r3Rgb(r | 0, g | 0, b | 0);
  };
  const V = [0, 0, 0], PV = R3_PV, NV = R3_NV;
  const vt = (x, y, z) => { const X = x * cy - z * sy, Z0 = x * sy + z * cy; V[0] = X; V[1] = y * cp - Z0 * sp; V[2] = y * sp + Z0 * cp; };
  const pushQ = (s, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nx, ny, nz) => {
    const k0 = D / (D - z0), k1 = D / (D - z1), k2 = D / (D - z2), k3 = D / (D - z3);
    if (qn >= R3_QMAX) return;
    const o9 = qn * 9, Dd = R3_QD; Dd[o9] = (z0 + z1 + z2 + z3) * 0.25; Dd[o9 + 1] = x0 * k0; Dd[o9 + 2] = -y0 * k0; Dd[o9 + 3] = x1 * k1; Dd[o9 + 4] = -y1 * k1; Dd[o9 + 5] = x2 * k2; Dd[o9 + 6] = -y2 * k2; Dd[o9 + 7] = x3 * k3; Dd[o9 + 8] = -y3 * k3;
    R3_QC[qn++] = shade(s, nx, ny, nz);
  };
  // elipsoide: centro, eixo (direção do raio maior), raios (ao longo do eixo, vertical no plano do eixo, lateral)
  const ell = (cx, cy_, cz, ax, ay, az, rx, ry, rz, s, big) => {
    let l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    let qx = 0, qy = 0, qz = 1; if (Math.abs(az) > 0.9) { qy = 1; qz = 0; }
    let bx = ay * qz - az * qy, by = az * qx - ax * qz, bz = ax * qy - ay * qx; l = Math.hypot(bx, by, bz) || 1; bx /= l; by /= l; bz /= l;
    const ex = ay * bz - az * by, ey = az * bx - ax * bz, ez = ax * by - ay * bx;
    const m = r3Sph(...(big ? (lo ? [8, 5] : [14, 9]) : (lo ? [6, 4] : [9, 6]))), U = m.v, n = m.n, nu = m.nu, nv = m.nv;
    for (let i = 0; i < n; i++) {
      const ux = U[i * 3], uy = U[i * 3 + 1], uz = U[i * 3 + 2], mx = rx * ux, my = ry * uy, mz = rz * uz;
      vt(cx + ax * mx + bx * my + ex * mz, cy_ + ay * mx + by * my + ey * mz, cz + az * mx + bz * my + ez * mz);
      PV[i * 3] = V[0]; PV[i * 3 + 1] = V[1]; PV[i * 3 + 2] = V[2];
      const gx = ux / rx, gy = uy / ry, gz = uz / rz;
      vt(ax * gx + bx * gy + ex * gz, ay * gx + by * gy + ey * gz, az * gx + bz * gy + ez * gz);   // normal (só rotação)
      const nl = Math.hypot(V[0], V[1], V[2]) || 1; NV[i * 3] = V[0] / nl; NV[i * 3 + 1] = V[1] / nl; NV[i * 3 + 2] = V[2] / nl;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = (j * (nu + 1) + i) * 3, b = a + 3, d = a + (nu + 1) * 3, e = d + 3;
      const nx = NV[a] + NV[b] + NV[e] + NV[d], ny = NV[a + 1] + NV[b + 1] + NV[e + 1] + NV[d + 1], nz = NV[a + 2] + NV[b + 2] + NV[e + 2] + NV[d + 2];
      if (nz < -0.15) continue;   // face de trás
      const q = 0.25; pushQ(s, PV[a], PV[a + 1], PV[a + 2], PV[b], PV[b + 1], PV[b + 2], PV[e], PV[e + 1], PV[e + 2], PV[d], PV[d + 1], PV[d + 2], nx * q, ny * q, nz * q);
    }
  };
  const cap = (x0, y0, z0, x1, y1, z1, r0, r1, s, big) => {   // "osso": elipsoide alongado entre dois pontos
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz) || 1, r = (r0 + r1) / 2;
    ell((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, dx, dy, dz, len / 2 + r * 0.55, r, r, s, big);
  };
  const ribbon = (A, B, s) => {   // faixa de dupla face (capa, cachecol)
    const P = [];
    for (let i = 0; i < A.length; i++) { vt(A[i][0], A[i][1], A[i][2]); const p = [V[0], V[1], V[2]]; vt(B[i][0], B[i][1], B[i][2]); P.push([p, [V[0], V[1], V[2]]]); }
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i][0], p1 = P[i][1], p2 = P[i + 1][1], p3 = P[i + 1][0];
      let nx = (p1[1] - p0[1]) * (p3[2] - p0[2]) - (p1[2] - p0[2]) * (p3[1] - p0[1]), ny = (p1[2] - p0[2]) * (p3[0] - p0[0]) - (p1[0] - p0[0]) * (p3[2] - p0[2]), nz = (p1[0] - p0[0]) * (p3[1] - p0[1]) - (p1[1] - p0[1]) * (p3[0] - p0[0]);
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      pushQ(s, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], nx, ny, nz);
    }
  };

  // ---- pernas do cavalo: passo com cascos que ficam parados no chão durante o apoio (IK de 2 ossos)
  const leg = (hx, hz, ph, rear) => {
    const hy = -14, u = (((ph / TAU) % 1) + 1) % 1; let fx, fy;
    if (u < R3_DUTY) { fx = R3_A - 2 * R3_A * (u / R3_DUTY); fy = 0; }
    else { const v = (u - R3_DUTY) / (1 - R3_DUTY), e = v * v * (3 - 2 * v); fx = -R3_A + 2 * R3_A * e; fy = (rear ? 15 : 22) * Math.sin(Math.PI * v); }
    const tx = hx + fx + 4, ty = hy - 73 + fy, L1 = 42;
    let dx = tx - hx, dy = ty - hy, d = Math.hypot(dx, dy); if (d > 83) { dx *= 83 / d; dy *= 83 / d; d = 83; }
    const aa = d / 2, h = Math.sqrt(Math.max(0, L1 * L1 - aa * aa)), ux = dx / d, uy = dy / d, dk = rear ? -1 : 1;
    const kx = hx + ux * aa - uy * dk * h, ky = hy + uy * aa + ux * dk * h, ex = hx + dx, ey = hy + dy;
    cap(hx, hy, hz, kx, ky, hz, rear ? 12 : 10.5, 6.5, sHorse, !lo);
    cap(kx, ky, hz, ex, ey + 2, hz, 5.2, 3.8, sHorse);
    ell(ex + 2, ey - 2, hz, 1, -0.25, 0, 7, 4.2, 4.6, sHorse);
  };
  const g = gait;
  leg(-38, -13, g + 3.0, true); leg(44, -13, g + 0.5, false);   // lado de lá
  // ---- corpo
  ell(0, 0, 0, 1, 0, 0, 62, 28, 21, sHorse, true);
  ell(38, 2, 0, 1, 0, 0, 30, 29, 21, sHorse, true);
  ell(-40, -1, 0, 1, 0, 0, 30, 28, 21, sHorse, true);
  cap(34, 18, 0, 92, 54, 0, 17, 11, sHorse, true);   // pescoço
  ell(112, 49, 0, 0.81, -0.58, 0, 27, 12, 10, sHorse, true);   // cabeça
  ell(126, 38, 0, 0.81, -0.58, 0, 12, 8.5, 8, sHorse);   // focinho
  for (const z of [-5.5, 5.5]) { ell(97, 70, z, 0.15, 1, 0, 10, 3.6, 3, sHorse); ell(110, 55, z * 1.6, 1, 0, 0, 2.4, 2.4, 2.4, sEye); }
  // crina ao vento
  for (let i = 0; i < 12; i++) { const u = i / 11, px = 34 + u * 58, py = 22 + u * 42; ell(px - 7 + wob(14, 3, i), py + 4 + wob(11, 2, i * 2), 0, -1, 0.35, 0, 11, 3.6, 3, sHorse); }
  // cauda: curva de Bézier ondulando
  { const p0 = [-60, 10], p1 = [-92, 6 - wob(9, 8)], p2 = [-112, -16 - wob(8, 10, 1)], p3 = [-134, -40 - wob(7, 14, 2)]; let px = p0[0], py = p0[1];
    for (let i = 1; i <= 10; i++) { const u = i / 10, w = 1 - u, x = w * w * w * p0[0] + 3 * w * w * u * p1[0] + 3 * w * u * u * p2[0] + u * u * u * p3[0], y = w * w * w * p0[1] + 3 * w * w * u * p1[1] + 3 * w * u * u * p2[1] + u * u * u * p3[1], z = wob(7, 4 * u, i);
      cap(px, py, z, x, y, z, 7.5 - u * 3.5, 6.5 - u * 3.5, sHorse); px = x; py = y; } }

  // ---- cavaleiro
  const hip = 30;
  ell(2, hip, 0, 1, 0, 0, 10, 8, 10, sPants);
  for (const z of [-1, 1]) { const zz = z * 23; cap(2, hip, z * 9, 24, 10, zz, 7.5, 6, sPants); cap(24, 10, zz, 16, -12, zz * 1.04, 6, 4.6, sPants); ell(20, -15, zz * 1.04, 1, 0, 0, 8, 4.5, 4.5, sBoot); }
  ell(6, 46, 0, 0.37, 0.93, 0, 20, 11, 9.5, sCape, true);   // tronco inclinado para a frente
  ell(14, 60, 0, 0.3, 0.2, 0, 9, 8, 14, sCape);   // ombros
  for (const z of [-1, 1]) { const zz = z * 10; cap(14, 57, zz, 38, 42, z * 14, 5.4, 4.6, sCape); cap(38, 42, z * 14, 60, 36, z * 8, 4.6, 3.6, sCape); ell(63, 35, z * 8, 1, 0, 0, 4, 3.6, 3.6, sSkin); cap(63, 35, z * 5, 120, 40, z * 5, 0.9, 0.9, sGold); }
  // cabeça (coruja)
  ell(17, 76, 0, 1, 0, 0, 12.5, 11.5, 11.5, sOwl, true);
  for (const z of [-1, 1]) { ell(23, 77, z * 6, 1, 0, 0, 5.5, 6, 3.2, sFace); ell(26, 78, z * 8, 1, 0, 0, 2.4, 2.6, 2.2, sOwlEye); ell(11, 88, z * 7, 0.2, 1, 0, 7, 3, 2.6, sOwlD); }
  ell(30, 73, 0, 1, -0.2, 0, 5.5, 3, 3, sBeak);
  // capa e cachecol: faixas ao vento
  { const A = [], M = [], B = [], n = 16;
    for (let i = 0; i < n; i++) { const s = i / (n - 1), x = 2 - s * 118, y = 62 - 26 * s + wob(10, 7, -s * 5) * s, zc = wob(7, 7, 1 - s * 4) * s, w = 8 + 12 * s; A.push([x, y, zc - w]); M.push([x, y + 5 * (1 - s * 0.4), zc]); B.push([x, y, zc + w]); }
    ribbon(A, M, sCape); ribbon(M, B, sCape); }
  { const A = [], B = [], n = 12;
    for (let i = 0; i < n; i++) { const s = i / (n - 1), x = 10 - s * 62, y = 64 - 6 * s + wob(13, 5, -s * 6) * s, zc = wob(9, 5, -s * 3) * s, w = 4 - s * 1.5; A.push([x, y, zc - w]); B.push([x, y, zc + w]); }
    ribbon(A, B, sScarf); }
  leg(50, 13, g, false); leg(-32, 13, g + 2.2, true);   // lado de cá (por cima)

  const O = R3_ORD, Dd = R3_QD; O.length = qn; for (let i = 0; i < qn; i++) O[i] = i;
  O.sort((p, q) => Dd[p * 9] - Dd[q * 9]);   // de trás pra frente
  c.lineJoin = 'round'; c.lineWidth = 0.8;
  let last = null;
  for (let i = 0; i < qn; i++) {
    const k = O[i], o9 = k * 9, col = R3_QC[k];
    if (col !== last) { c.fillStyle = col; c.strokeStyle = col; last = col; }   // só troca a cor quando muda (parse de cor é caro)
    c.beginPath(); c.moveTo(Dd[o9 + 1], Dd[o9 + 2]); c.lineTo(Dd[o9 + 3], Dd[o9 + 4]); c.lineTo(Dd[o9 + 5], Dd[o9 + 6]); c.lineTo(Dd[o9 + 7], Dd[o9 + 8]); c.closePath(); c.fill(); c.stroke();
  }
}

/* ---- logo "7 SHADOWS" pré-renderizado (brilho e relevo já embutidos) */
function buildLogo(fs) {
  const font = `400 ${fs}px Bungee, Impact, sans-serif`;
  const m = document.createElement('canvas').getContext('2d'); m.font = font;
  const tw = m.measureText('SHADOWS').width, w = Math.ceil(Math.max(tw, fs * 3) + fs * 1.4), h = Math.ceil(fs * 3.4);
  logoFs = fs; logoW = w; logoH = h;
  logoCv = document.createElement('canvas'); logoCv.width = Math.ceil(w * iD); logoCv.height = Math.ceil(h * iD);
  shineCv = document.createElement('canvas'); shineCv.width = logoCv.width; shineCv.height = logoCv.height;
  const c = logoCv.getContext('2d'); c.scale(iD, iD);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.font = font;
  const cx = w / 2, cy = h / 2, y1 = cy - fs * 0.55, y2 = cy + fs * 0.55, ex = Math.max(3, Math.round(fs * 0.05));
  // lâmina de luz entre as duas linhas
  const L = tw / 2 + fs * 0.35, lg = c.createLinearGradient(cx - L, 0, cx + L, 0);
  lg.addColorStop(0, 'rgba(0,229,255,0)'); lg.addColorStop(0.3, 'rgba(0,229,255,.9)'); lg.addColorStop(0.7, 'rgba(255,46,151,.9)'); lg.addColorStop(1, 'rgba(255,46,151,0)');
  c.save(); c.shadowColor = 'rgba(255,255,255,.8)'; c.shadowBlur = fs * 0.2; c.fillStyle = lg;
  c.beginPath(); c.moveTo(cx - L, cy); c.quadraticCurveTo(cx, cy - fs * 0.05, cx + L, cy); c.quadraticCurveTo(cx, cy + fs * 0.05, cx - L, cy); c.fill(); c.restore();
  const draw = (txt, y, front, back, glow) => {
    c.save(); c.shadowColor = glow; c.shadowBlur = fs * 0.34; c.strokeStyle = '#0a0214'; c.lineWidth = fs * 0.17; c.strokeText(txt, cx + ex * 0.5, y + ex * 0.5); c.restore();
    c.strokeStyle = '#0a0214'; c.lineWidth = fs * 0.17; c.strokeText(txt, cx + ex * 0.5, y + ex * 0.5);
    c.fillStyle = back; for (let i = ex; i >= 1; i--) c.fillText(txt, cx + i, y + i);   // relevo
    c.save(); c.shadowColor = glow; c.shadowBlur = fs * 0.18; c.fillStyle = front; c.fillText(txt, cx, y); c.restore();
    c.save(); c.beginPath(); c.rect(0, y - fs * 0.6, w, fs * 0.55); c.clip(); c.fillStyle = 'rgba(255,255,255,.3)'; c.fillText(txt, cx, y); c.restore();   // brilho no topo
  };
  draw('7', y1, '#00e5ff', '#7a2cff', 'rgba(0,229,255,.95)');
  draw('SHADOWS', y2, '#ff2e97', '#ffe600', 'rgba(255,46,151,.95)');
}

/* ---- cavaleiro distante, só silhueta (cena da serra) */
const riderCv = document.createElement('canvas'); riderCv.width = 300; riderCv.height = 220;
function drawRiderSil(t, gait) {
  const c = riderCv.getContext('2d'); c.clearRect(0, 0, 300, 220);
  c.save(); c.translate(160, 120); drawRider3D(c, gait, t, 0.25, 0.05, { sil: true, lo: true }); c.restore();
  c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(3,1,10,.96)'; c.fillRect(0, 0, 300, 220); c.globalCompositeOperation = 'source-over';
}

/* ---- céu, estrelas, nuvens, lua / sol */
function iSky(sc, t, W, H, horizon, S, post) {
  let g = ic.createLinearGradient(0, 0, 0, horizon);
  [0, 0.28, 0.58, 0.82, 1].forEach((p, i) => g.addColorStop(p, iRgbS(sc.sky[i])));
  ic.fillStyle = g; ic.fillRect(-60, -60, W + 120, H + 120);
  if (sc.st > 0.01) for (let i = 0; i < 110; i++) {   // estrelas
    const sx = hash(i, 3) * W, sy = hash(i, 5) * horizon * 0.62, tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(i, 9) * 3) + i);
    ic.fillStyle = `rgba(255,255,255,${(0.25 + 0.7 * tw * (1 - sy / horizon)) * sc.st})`; ic.fillRect(sx, sy, 1.6, 1.6);
  }
  // lua (noite): grande na abertura, menor no loop
  if (sc.moon > 0.01) {
    const mR = post ? H * 0.09 : H * 0.14, mx = post ? W * 0.8 : W * 0.64, my = post ? H * 0.26 : H * 0.3 - iC01(t / IT_FLASH) * H * 0.025;
    if (!moonCv) buildMoon(Math.ceil(H * 0.15));
    g = ic.createRadialGradient(mx, my, mR * 0.8, mx, my, mR * 3.4); g.addColorStop(0, `rgba(190,190,255,${0.4 * sc.moon})`); g.addColorStop(1, 'rgba(190,190,255,0)');
    ic.fillStyle = g; ic.fillRect(mx - mR * 3.4, my - mR * 3.4, mR * 6.8, mR * 6.8);
    ic.globalAlpha = sc.moon; ic.drawImage(moonCv, mx - mR, my - mR, mR * 2, mR * 2); ic.globalAlpha = 1;
  }
  // nuvens finas à deriva
  for (let i = 0; i < 6; i++) {
    const sp = (6 + hash(i, 31) * 10) * S, cx = ((hash(i, 37) * W * 1.6 + t * sp) % (W * 1.6)) - W * 0.4, cy = H * (0.14 + hash(i, 41) * 0.36), r = (90 + hash(i, 43) * 120) * S;
    for (let j = 0; j < 3; j++) {
      const rr = r * (0.7 + 0.3 * hash(i, 47 + j));
      ic.save(); ic.translate(cx + (j - 1) * r * 0.8, cy + (j === 1 ? -r * 0.06 : 0)); ic.scale(1, 0.16);
      const rg = ic.createRadialGradient(0, 0, 0, 0, 0, rr); rg.addColorStop(0, iRgba(sc.cloud, sc.ca)); rg.addColorStop(1, iRgba(sc.cloud, 0));
      ic.fillStyle = rg; ic.beginPath(); ic.arc(0, 0, rr, 0, TAU); ic.fill(); ic.restore();
    }
  }
  // sol de faixas (anoitecer)
  if (sc.sun > 0.01) {
    const R = H * 0.2; if (!sunCv || Math.abs(sunR - R) > 1) buildSun(R);
    const sx = W * 0.7, sy = H * 0.5;
    g = ic.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 2.4); g.addColorStop(0, `rgba(255,90,140,${0.45 * sc.sun})`); g.addColorStop(1, 'rgba(255,90,140,0)');
    ic.fillStyle = g; ic.fillRect(sx - R * 2.4, sy - R * 2.4, R * 4.8, R * 4.8);
    ic.globalAlpha = sc.sun; ic.drawImage(sunCv, sx - R, sy - R); ic.globalAlpha = 1;
  }
  // sol alto (dia)
  if (sc.dsun > 0.01) {
    const R = H * 0.065, sx = W * 0.76, sy = H * 0.3;
    g = ic.createRadialGradient(sx, sy, R * 0.5, sx, sy, R * 6); g.addColorStop(0, `rgba(255,236,160,${0.85 * sc.dsun})`); g.addColorStop(1, 'rgba(255,240,180,0)');
    ic.fillStyle = g; ic.fillRect(sx - R * 6, sy - R * 6, R * 12, R * 12);
    ic.globalAlpha = sc.dsun; ic.fillStyle = '#fff3b0'; ic.shadowColor = '#ffd25a'; ic.shadowBlur = R * 0.8; ic.beginPath(); ic.arc(sx, sy, R, 0, TAU); ic.fill(); ic.shadowBlur = 0; ic.globalAlpha = 1;
  }
}

/* ---- cena 1: serra à noite, um cavaleiro minúsculo cruza sob a lua */
function iRidge(sc, t, W, H, horizon, S) {
  const offB = 400 + t * 5 * S, offR = 1500 + t * 12 * S, bR = H * 0.69, aR = H * 0.045;
  hillLayer(offB, H * 0.6, H * 0.07, 0.004, 0.011, iRgbS(sc.hill[0]), false, S);
  hillLayer(offR, bR, aR, 0.0055, 0.015, iRgbS(sc.hill[1]), true, S);
  const k = 0.2 * S, x = W * (-0.12 + 1.24 * iC01((t - 0.4) / 2.7));
  if (x > -80 && x < W + 80) {
    const y = hillY(x + offR, bR, aR, 0.0055, 0.015), y2 = hillY(x + 4 + offR, bR, aR, 0.0055, 0.015), ang = Math.atan2(y2 - y, 4) * 0.8;
    drawRiderSil(t, t * 9);
    ic.save(); ic.translate(x, y + 2 * S); ic.rotate(ang); ic.drawImage(riderCv, -160 * k, -212 * k, 300 * k, 220 * k); ic.restore();
  }
  hillLayer(offR * 1.6, H * 0.78, H * 0.02, 0.007, 0.02, iRgbS(sc.hill[2]), true, S);
  ic.fillStyle = iRgbS(sc.hill[2]); ic.fillRect(-60, H * 0.79, W + 120, H);
}

/* ---- cena 2 (loop): cavalgada em paralaxe */
function iGallop(sc, t, dt, W, H, horizon, gy, S) {
  const speed = R3_FOOT * 1.12 * S, scroll = t * speed;   // o chão corre exatamente na velocidade dos cascos apoiados (sem patinar)
  ic.strokeStyle = iRgba(sc.dust, 0.18); ic.lineWidth = 1.2;   // linhas de velocidade
  for (let i = 0; i < 14; i++) { const ly = hash(i, 11) * horizon, len = (60 + hash(i, 13) * 140) * S, lx = W - (((t * (700 + hash(i, 17) * 600) * S) + hash(i, 19) * W * 2) % (W * 1.6)) + 80; ic.beginPath(); ic.moveTo(lx, ly); ic.lineTo(lx + len, ly); ic.stroke(); }
  hillLayer(scroll * 0.06, H * 0.62, H * 0.07, 0.004, 0.011, iRgbS(sc.hill[0]), false, S);
  hillLayer(scroll * 0.18, H * 0.70, H * 0.045, 0.006, 0.017, iRgbS(sc.hill[1]), true, S);
  hillLayer(scroll * 0.45, H * 0.77, H * 0.03, 0.007, 0.02, iRgbS(sc.hill[2]), true, S);
  let g = ic.createLinearGradient(0, horizon + 4, 0, H); g.addColorStop(0, iRgbS(sc.gr[0])); g.addColorStop(1, iRgbS(sc.gr[1]));
  ic.fillStyle = g; ic.fillRect(-60, horizon + 4, W + 120, H);
  ic.strokeStyle = iRgba(sc.line, 0.55); ic.lineWidth = 2; ic.beginPath(); ic.moveTo(-60, horizon + 5); ic.lineTo(W + 60, horizon + 5); ic.stroke();
  ic.lineCap = 'round';   // capim rápido no chão
  for (let i = 0; i < 46; i++) {
    const depth = hash(i, 23), y = horizon + 12 + depth * (H - horizon - 12), sp = speed * (0.4 + depth * 1.66), x = (((hash(i, 29) * (W + 240)) - t * sp) % (W + 240) + (W + 240)) % (W + 240) - 120, h = (6 + depth * 18) * S;
    ic.strokeStyle = depth > 0.6 ? iRgba(sc.g1, 0.5) : iRgba(sc.g2, 0.28); ic.lineWidth = 1 + depth * 1.6;
    ic.beginPath(); ic.moveTo(x, y); ic.lineTo(x - 3 * S, y - h); ic.stroke();
  }
  // cavalo e cavaleiro
  H_FILL = iRgbS(sc.fill); H_RIM = iRgba(sc.rim, 0.8); H_FILLA = sc.fill; H_RIMA = sc.rim;
  const rx = W * 0.25 + Math.sin(t * 0.7) * 14 * S, gait = t * R3_W, hoofLift = Math.abs(Math.sin(gait)) * 3;
  ic.save(); ic.translate(rx, gy - 92 * S - hoofLift * S); ic.scale(S * 1.12, S * 1.12);
  ic.fillStyle = 'rgba(0,0,0,.35)';
  ic.save(); ic.translate(0, 92 + hoofLift); ic.scale(1, 0.16); ic.beginPath(); ic.arc(0, 0, 90, 0, TAU); ic.fill(); ic.restore();   // sombra
  ic.rotate(Math.sin(gait + 0.6) * 0.03);
  drawRider3D(ic, gait, t, 0.42 + Math.sin(t * 0.45) * 0.22, 0.1);   // 3/4 de frente, câmera balança devagar
  ic.restore();
  // poeira dos cascos
  for (let i = 0; i < 2; i++) introDust.push({ x: rx - 50 * S + (Math.random() - 0.5) * 60 * S, y: gy - 2 * S, vx: -speed * (0.8 + Math.random() * 0.4), vy: -(8 + Math.random() * 40) * S, life: 0.7 + Math.random() * 0.5, max: 1.2, r: (4 + Math.random() * 7) * S, k: S });
  iDustDraw(sc, dt);
}
function iDustDraw(sc, dt) {
  for (const d of introDust) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.r += 9 * dt * d.k; }
  introDust = introDust.filter(d => d.life > 0);
  for (const d of introDust) { ic.fillStyle = iRgba(sc.dust, Math.max(0, d.life / d.max) * 0.28); ic.beginPath(); ic.arc(d.x, d.y, d.r, 0, TAU); ic.fill(); }
}

/* ---- câmera "vindo do fundo": o cavaleiro sai pequeno do horizonte e vem pela trilha direto para a câmera (perspectiva de verdade:
   tamanho e altura na tela ∝ 1/profundidade). Depois que chega, a câmera passa a acompanhá-lo e o cenário corre em direção a ela. */
const IT_ZFAR = 10, IT_ZNEAR = 1.1, IT_ZMIN = 0.4, IT_ZMAX = 18, IT_ZR = IT_ZMAX - IT_ZMIN;
const iItems = Array.from({ length: 62 }, (_, i) => ({ z0: IT_ZMIN + hash(i, 61) * IT_ZR, tree: i < 20, lat: i < 20 ? (hash(i, 67) < 0.5 ? -1 : 1) * (0.5 + hash(i, 71) * 1.4) : (hash(i, 67) - 0.5) * 3.4, h: hash(i, 79) }));
const iPathX = (z, cz, vx, xn, W) => { const s = IT_ZNEAR / z; return vx + (xn - vx) * s + W * 0.06 * s * (Math.sin((z + cz) * 0.6) - Math.sin((IT_ZNEAR + cz) * 0.6)); };
function iApproach(sc, t, ul, dt, W, H, horizon, gy, S, dir, dur) {
  const tr = IT_ZFAR - IT_ZNEAR;
  const travel = tr * ul / dur;   // velocidade constante no mundo: de longe parece lento, perto parece "explodir" em cima da câmera
  const zr = Math.max(IT_ZNEAR, IT_ZFAR - travel), cz = Math.max(0, travel - tr);
  const vx = dir > 0 ? W * 0.16 : W * 0.84, xn = dir > 0 ? W * 0.74 : W * 0.26, K = gy - horizon;
  const px = z => iPathX(z, cz, vx, xn, W), py = z => horizon + K * IT_ZNEAR / z;
  hillLayer(900 + t * 4 * S, H * 0.62, H * 0.07, 0.004, 0.011, iRgbS(sc.hill[0]), false, S);
  hillLayer(2100 + t * 9 * S, H * 0.70, H * 0.045, 0.006, 0.017, iRgbS(sc.hill[1]), true, S);
  hillLayer(300, H * 0.77, H * 0.03, 0.007, 0.02, iRgbS(sc.hill[2]), true, S);
  let g = ic.createLinearGradient(0, horizon + 4, 0, H); g.addColorStop(0, iRgbS(sc.gr[0])); g.addColorStop(1, iRgbS(sc.gr[1]));
  ic.fillStyle = g; ic.fillRect(-60, horizon + 4, W + 120, H);
  ic.strokeStyle = iRgba(sc.line, 0.55); ic.lineWidth = 2; ic.beginPath(); ic.moveTo(-60, horizon + 5); ic.lineTo(W + 60, horizon + 5); ic.stroke();
  // trilha em perspectiva
  const N = 30, zs = []; for (let k = 0; k <= N; k++) zs.push(IT_ZMAX * Math.pow(IT_ZMIN / IT_ZMAX, k / N));
  const hw = z => W * 0.16 * IT_ZNEAR / z;
  ic.beginPath();
  zs.forEach((z, k) => { const x = px(z) - hw(z), y = py(z); k ? ic.lineTo(x, y) : ic.moveTo(x, y); });
  for (let k = N; k >= 0; k--) { const z = zs[k]; ic.lineTo(px(z) + hw(z), py(z)); }
  ic.closePath(); ic.fillStyle = iRgba(sc.line, 0.2); ic.fill();
  ic.strokeStyle = iRgba(sc.line, 0.5); ic.lineWidth = 1.5;
  for (const sd of [-1, 1]) { ic.beginPath(); zs.forEach((z, k) => { const x = px(z) + sd * hw(z), y = py(z); k ? ic.lineTo(x, y) : ic.moveTo(x, y); }); ic.stroke(); }
  // árvores e capim que correm em direção à câmera (ordenados do fundo para frente; o cavaleiro entra no meio)
  const list = iItems.map(it => [IT_ZMIN + (((it.z0 - IT_ZMIN - cz) % IT_ZR) + IT_ZR) % IT_ZR, it]).sort((a, b) => b[0] - a[0]);
  const item = (z, it) => {
    const s = IT_ZNEAR / z, x = px(z) + it.lat * W * 0.5 * s, y = py(z); if (x < -200 || x > W + 200) return;
    ic.globalAlpha = iC01((IT_ZMAX - z) / 4);
    if (it.tree) {
      const th = (90 + it.h * 110) * S * s, col = iRgbS(sc.hill[2]);
      ic.fillStyle = col; ic.beginPath();
      ic.moveTo(x, y - th); ic.lineTo(x + th * 0.26, y - th * 0.35); ic.lineTo(x + th * 0.14, y - th * 0.35); ic.lineTo(x + th * 0.32, y); ic.lineTo(x - th * 0.32, y);
      ic.lineTo(x - th * 0.14, y - th * 0.35); ic.lineTo(x - th * 0.26, y - th * 0.35); ic.closePath(); ic.fill();
    } else {
      const h = (10 + it.h * 14) * S * s; ic.lineCap = 'round'; ic.strokeStyle = it.h > 0.5 ? iRgba(sc.g1, 0.55) : iRgba(sc.g2, 0.4); ic.lineWidth = Math.max(1, 2 * S * s);
      for (let b = -1; b <= 1; b++) { ic.beginPath(); ic.moveTo(x + b * 4 * S * s, y); ic.lineTo(x + b * 9 * S * s, y - h * (1 - Math.abs(b) * 0.25)); ic.stroke(); }
    }
    ic.globalAlpha = 1;
  };
  let i = 0; for (; i < list.length && list[i][0] > zr; i++) item(list[i][0], list[i][1]);
  // cavaleiro
  H_FILL = iRgbS(sc.fill); H_RIM = iRgba(sc.rim, 0.8); H_FILLA = sc.fill; H_RIMA = sc.rim;
  const sr = 1.232 * S / zr, rx = px(zr), ry = py(zr), gait = t * R3_W, lift = Math.abs(Math.sin(gait)) * 3 * sr;
  ic.save(); ic.translate(rx, ry); ic.fillStyle = 'rgba(0,0,0,.35)'; ic.scale(1, 0.16); ic.beginPath(); ic.arc(0, 0, 90 * sr, 0, TAU); ic.fill(); ic.restore();
  ic.save(); ic.translate(rx, ry - 92 * sr - lift); ic.scale(sr, sr); ic.rotate(Math.sin(gait + 0.6) * 0.03); drawRider3D(ic, gait, t, (dir > 0 ? 0.95 : Math.PI - 0.95) + Math.sin(t * 0.8) * 0.1 * dir, 0.07); ic.restore();
  for (let n = 0; n < 2; n++) introDust.push({ x: rx - dir * (30 + Math.random() * 40) * sr, y: ry - 2 * sr, vx: -dir * (40 + Math.random() * 80) * sr, vy: -(8 + Math.random() * 40) * sr, life: 0.6 + Math.random() * 0.5, max: 1.1, r: (4 + Math.random() * 7) * sr, k: sr });
  for (; i < list.length; i++) item(list[i][0], list[i][1]);
  iDustDraw(sc, dt);
}

/* ---- "INICIAR JOGO" (pisca suave; ao apertar, pisca rápido). Desenhado num canvas à parte para o pulso valer pro texto inteiro. */
let promptCv = null;
function iPrompt(t, W, H) {
  const a = iEase((t - IT_PROMPT) / 0.8); if (a <= 0) return;
  const going = introGo >= 0, fs = Math.round(Math.max(18, H * 0.048)), y = H * 0.51, txt = 'INICIAR JOGO';
  const pulse = going ? (((t - introGo) * 16 | 0) & 1 ? 1 : 0.3) : 0.6 + 0.4 * Math.sin(t * 3.6);
  const pw = Math.ceil(W * 0.8), ph = Math.ceil(fs * 2.6), px = Math.ceil(pw * iD), py = Math.ceil(ph * iD);
  if (!promptCv || promptCv.width !== px || promptCv.height !== py) { promptCv = document.createElement('canvas'); promptCv.width = px; promptCv.height = py; }
  const c = promptCv.getContext('2d'); c.setTransform(iD, 0, 0, iD, 0, 0); c.clearRect(0, 0, pw, ph);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.font = `400 ${fs}px Bungee, Impact, sans-serif`;
  const ls = fs * 0.16; if ('letterSpacing' in c) c.letterSpacing = ls + 'px';
  const cx = pw / 2 + ls / 2, cy = ph / 2, tw = c.measureText(txt).width;
  c.lineWidth = fs * 0.22; c.strokeStyle = 'rgba(8,0,18,.92)'; c.strokeText(txt, cx, cy);
  c.shadowColor = '#ff2e97'; c.shadowBlur = fs * 0.55 * iD; c.fillStyle = '#ffe600'; c.fillText(txt, cx, cy);
  c.shadowColor = '#00e5ff'; c.fillStyle = '#00e5ff';   // losangos nas pontas
  for (const s of [-1, 1]) { c.save(); c.translate(pw / 2 + s * (tw / 2 + fs * 0.95), cy); c.rotate(Math.PI / 4); c.fillRect(-fs * 0.17, -fs * 0.17, fs * 0.34, fs * 0.34); c.restore(); }
  ic.save(); ic.globalAlpha = a * pulse; ic.drawImage(promptCv, W / 2 - pw / 2, y - ph / 2, pw, ph); ic.restore();
  // dica da tecla
  ic.save(); ic.globalAlpha = a; ic.textAlign = 'center'; ic.textBaseline = 'middle'; ic.lineJoin = 'round';
  const hs = Math.round(Math.max(12, H * 0.028)); ic.font = `700 ${hs}px Rajdhani, sans-serif`;
  const hl = hs * 0.4; if ('letterSpacing' in ic) ic.letterSpacing = hl + 'px';
  const ht = IS_TOUCH ? 'TOQUE NA TELA' : 'APERTE  ESPAÇO';
  ic.lineWidth = 4; ic.strokeStyle = 'rgba(8,0,18,.9)'; ic.strokeText(ht, W / 2 + hl / 2, H * 0.575); ic.fillStyle = '#ffd1ea'; ic.fillText(ht, W / 2 + hl / 2, H * 0.575);
  ic.restore();
}

function drawIntro(t, dt) {
  const W = iW, H = iH, S = Math.max(0.7, Math.min(1.6, H / 720)), horizon = H * 0.78, gy = H * 0.86, post = t >= IT_FLASH;
  // câmeras (cortes): 1) serra à noite, cavaleiro pequeno cruzando  2) cavaleiro vindo do fundo  → clarão + logo →
  // loop: A) anoitecer, vindo do fundo (da direita)  B) dia, galope de lado  C) noite, vindo do fundo (da esquerda)
  let sc, z, ax, ay, shot, key, ul = 0, dir = 1, dur = 4.8, cut = -1;
  if (!post) {
    sc = iScenes.night;
    if (t < IT_CUT1) { shot = 'ridge'; key = 'r'; z = 1 + iC01(t / IT_CUT1) * 0.06; ax = W * 0.64; ay = H * 0.4; }   // aproximação lenta rumo à lua
    else { shot = 'app'; key = 'a0'; ul = t - IT_CUT1; dur = IT_FLASH - IT_CUT1 - 0.3; z = 1 + 0.05 * iC01(ul / dur); ax = W * 0.5; ay = H * 0.8; cut = ul; }
  } else {
    const u = t - IT_FLASH, per = IT_HOLD + IT_FADE, i = Math.floor(u / per) % 3, f = u % per;
    sc = iMixScene(iSeq[i], iSeq[(i + 1) % 3], f < IT_HOLD ? 0 : iEase((f - IT_HOLD) / IT_FADE));
    shot = i === 1 ? 'side' : 'app'; key = 'p' + i; ul = f; dir = i === 0 ? -1 : 1; if (u > 0.5) cut = f;
    z = 1 + 0.03 * (0.5 - 0.5 * Math.cos(f * 0.5)) + 0.12 * (1 - iEase(u / 1.8));
    if (shot === 'app') { ax = W * 0.5; ay = H * 0.8; } else { ax = W * 0.38; ay = H * 0.62; }
  }
  if (key !== introShot) { introShot = key; introDust = []; }
  if (introGo >= 0) z += iEase((t - introGo) / IT_GO) * 0.12;   // ao apertar: câmera avança
  ic.setTransform(iD * z, 0, 0, iD * z, iD * ax * (1 - z), iD * ay * (1 - z));
  iSky(sc, t, W, H, horizon, S, post);
  if (shot === 'ridge') iRidge(sc, t, W, H, horizon, S);
  else if (shot === 'app') iApproach(sc, t, ul, dt, W, H, horizon, gy, S, dir, dur);
  else iGallop(sc, t, dt, W, H, horizon, gy, S);

  // ---- por cima de tudo (sem câmera) ----
  ic.setTransform(iD, 0, 0, iD, 0, 0);
  if (cut >= 0 && cut < 0.35) { ic.fillStyle = `rgba(0,0,0,${(1 - cut / 0.35) * 0.8})`; ic.fillRect(0, 0, W, H); }   // piscada do corte de câmera
  const vg = ic.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,0,16,.6)');
  ic.fillStyle = vg; ic.fillRect(0, 0, W, H);
  if (post) {
    const u = t - IT_FLASH, cx = W / 2, cy = H * 0.27, fs = Math.min(W * 0.095, H * 0.125);
    if (!logoCv || Math.abs(logoFs - fs) > 0.5) buildLogo(fs);
    const k = iEase((u - 0.1) / 1.3), go = introGo >= 0 ? iEase((t - introGo) / IT_GO) : 0;
    if (k > 0) {
      const s1 = (1 + (1 - k) * 0.35) * (1 + go * 0.06), ly = cy + Math.sin(t * 2) * 3;
      ic.save(); ic.translate(cx, ly); ic.scale(s1, s1);
      if (k < 1) { ic.globalAlpha = k; ic.shadowColor = 'rgba(255,225,160,.95)'; ic.shadowBlur = (1 - k) * 70 + 6; }   // surge de dentro do brilho
      ic.drawImage(logoCv, -logoW / 2, -logoH / 2, logoW, logoH);
      ic.restore();
      if (k < 1) { ic.save(); ic.translate(cx, ly); ic.scale(1 + (1 - k) * 0.55, 1 + (1 - k) * 0.55); ic.globalCompositeOperation = 'lighter'; ic.globalAlpha = (1 - k) * 0.7; ic.shadowColor = 'rgba(255,200,120,1)'; ic.shadowBlur = 90 * (1 - k) + 10; ic.drawImage(logoCv, -logoW / 2, -logoH / 2, logoW, logoH); ic.restore(); }
      // reflexo que passa pelo logo de tempos em tempos
      const ph = (u - 2.2) % 5.5;
      if (u > 2.2 && ph < 1 && k >= 1) {
        const sx = shineCv.getContext('2d'), pw = shineCv.width, phh = shineCv.height, bx = (-0.25 + 1.5 * iEase(ph)) * pw, bw = pw * 0.14, skew = phh * 0.5;
        sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, pw, phh); sx.globalCompositeOperation = 'source-over'; sx.drawImage(logoCv, 0, 0);
        sx.globalCompositeOperation = 'source-atop';
        const sg = sx.createLinearGradient(bx - skew / 2, 0, bx - skew / 2 + bw, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.95)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        sx.fillStyle = sg; sx.beginPath(); sx.moveTo(bx, 0); sx.lineTo(bx + bw, 0); sx.lineTo(bx + bw - skew, phh); sx.lineTo(bx - skew, phh); sx.closePath(); sx.fill();
        ic.save(); ic.translate(cx, ly); ic.scale(s1, s1); ic.globalCompositeOperation = 'lighter'; ic.drawImage(shineCv, -logoW / 2, -logoH / 2, logoW, logoH); ic.restore();
      }
    }
    const a2 = iEase((u - 1.2) / 0.8);
    if (a2 > 0) {
      ic.save(); ic.globalAlpha = a2; ic.textAlign = 'center'; ic.textBaseline = 'middle'; ic.lineJoin = 'round';
      ic.font = `700 ${Math.round(Math.max(14, H * 0.03))}px Rajdhani, sans-serif`; if ('letterSpacing' in ic) ic.letterSpacing = '3px';
      const s2 = 'ENTRE PELA PORTA E FAÇA A SUA JOGADA.', sy = cy + logoH * 0.5 * 0.82;
      ic.lineWidth = 4; ic.strokeStyle = 'rgba(8,0,18,.92)'; ic.strokeText(s2, cx, sy); ic.fillStyle = '#ffe9a8'; ic.fillText(s2, cx, sy); ic.restore();
    }
    iPrompt(t, W, H);
  }
  // clarão: da cena da serra para o logo
  let fl = 0;
  if (t > IT_FLASH - 0.3 && t < IT_FLASH + 0.8) fl = (t < IT_FLASH ? iC01((t - (IT_FLASH - 0.3)) / 0.3) : 1 - iEase((t - IT_FLASH) / 0.8)) * 0.92;
  if (introGo >= 0) fl = Math.max(fl, iEase((t - introGo) / IT_GO * 1.4));   // ao apertar: clarão branco e entra no menu
  if (fl > 0) { ic.fillStyle = `rgba(255,255,255,${fl})`; ic.fillRect(0, 0, W, H); }
  // faixas de cinema
  const bar = H * 0.09 * iEase(t / 1.2); ic.fillStyle = '#000'; ic.fillRect(0, 0, W, bar); ic.fillRect(0, H - bar, W, bar);
  // fade de entrada
  const fade = 1 - iC01(t / 1.4);
  if (fade > 0) { ic.fillStyle = `rgba(0,0,0,${fade})`; ic.fillRect(0, 0, W, H); }
}
function introFrame(now) {
  if (!introOn) return;
  requestAnimationFrame(introFrame);
  if (bootOn) { introLast = now; return; }   // carregando: a animação espera
  const dt = Math.min(0.05, (now - introLast) / 1000); introLast = now; introT += dt;
  drawIntro(introT, dt);
  if (introGo >= 0 && introT - introGo >= IT_GO) endIntro();   // acabou o efeito: abre o menu
}
function endIntro() {
  if (!introOn) return; introOn = false; introSkipAt = performance.now(); try { introBgm.pause(); } catch { }
  const m = $('menu'); m.classList.remove('hidden'); m.classList.add('enter');
  introEl.classList.add('out'); setTimeout(() => introEl.classList.add('hidden'), 750);
}
// ESPAÇO / Enter / clique / toque. Na cena da serra, o primeiro aperto pula para o logo; com "INICIAR JOGO" na tela, entra no jogo.
function introPress() {
  if (!introOn || introGo >= 0 || bootOn || performance.now() - bootDoneAt < 700) return;   // o toque que fechou o carregamento não conta aqui
  try { initAudio(); } catch { }
  if (introT < IT_FLASH - 0.3) { introT = IT_FLASH - 0.3; return; }
  if (introT < IT_PROMPT) return;
  introGo = introT; try { sfx('go'); } catch { }
  menuMusicOK = true; menuMusicPlay();   // a música do menu entra junto com o clarão e sobe de volume já no menu
}
addEventListener('keydown', e => { if (introOn && !bootOn && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) introPress(); } }, true);
addEventListener('keyup', e => { if (e.key === ' ' && performance.now() - introSkipAt < 400) e.preventDefault(); });
$('introSkip').onclick = () => introPress();
introLast = performance.now(); requestAnimationFrame(introFrame);

/* ------------------------------------------------ ABERTURA: música (Castlevania — Stage 1)
   Toca durante a animação, em loop. O navegador bloqueia som antes do 1º toque/tecla: se for bloqueado, começa assim que o jogador interagir.
   Ao apertar INICIAR JOGO ela some em ~1,2 s enquanto a música do menu entra. Como a do menu, não depende da opção Música. */
const INTRO_MUSIC = ['music/dracula-x-stage1.mp3', 'dracula-x-stage1.mp3', 'Castlevania_Dracula_X_OST__Stage_1_BloodlinesMP3_160K.mp3', 'music/Castlevania_Dracula_X_OST__Stage_1_BloodlinesMP3_160K.mp3'];
const introBgm = new Audio(); introBgm.loop = true; introBgm.preload = 'auto';
let introMusTry = 0;
introBgm.src = INTRO_MUSIC[0];
introBgm.addEventListener('error', () => { if (++introMusTry < INTRO_MUSIC.length) introBgm.src = INTRO_MUSIC[introMusTry]; });
function introMusicVol() {
  const base = Math.max(0.15, cfg.vol);
  const f = introGo >= 0 ? Math.max(0, 1 - (introT - introGo) / (IT_GO * 0.9)) : Math.min(1, introT / 1.5);   // sobe no começo, some ao apertar
  return Math.max(0, Math.min(1, base * f));
}
function introMusicTick() {
  if (!introOn || bootOn) { introBgm.pause(); return; }
  introBgm.volume = introMusicVol();
  if (introBgm.paused && introBgm.volume > 0) { const pr = introBgm.play(); if (pr && pr.catch) pr.catch(() => { }); }
}
setInterval(introMusicTick, 100);   // se o autoplay foi bloqueado, o próximo toque/tecla (abaixo) libera
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => { if (introOn) introMusicTick(); }, true);
introMusicTick();

/* ------------------------------------------------ TELA DE CARREGAMENTO (estilo N64)
   Fundo preto, cubo 3D colorido girando com reflexo no chão, barra de progresso nas quatro cores. Espera as fontes, a página e as duas músicas
   (abertura e menu) carregarem — no mínimo ~2,8 s — e então pede "PRESSIONE QUALQUER TECLA". Esse toque libera o áudio do navegador:
   a tela some num clarão e a abertura começa do zero JUNTO com a música. */
(function bootScreen() {
  const ov = document.createElement('div'); ov.id = 'boot';
  ov.style.cssText = 'position:fixed;inset:0;z-index:60;background:#000;transition:opacity .5s ease;cursor:default;touch-action:manipulation;user-select:none;-webkit-user-select:none';
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  ov.appendChild(cv); document.body.appendChild(ov);
  const c = cv.getContext('2d'), touchDev = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let W = 0, H = 0, D = 1;
  const fit = () => { D = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * D); cv.height = Math.round(H * D); };
  fit(); addEventListener('resize', fit);

  // ---- progresso real: fontes, página e as duas músicas (cada item tem tempo máximo, para nunca travar)
  const wait = (arm, ms) => new Promise(res => { let d = false; const f = () => { if (!d) { d = true; res(); } }; try { arm(f); } catch { f(); } setTimeout(f, ms); });
  const audioReady = (el, ms) => wait(f => { if (el.readyState >= 3) return f(); el.addEventListener('canplay', f, { once: true }); el.addEventListener('error', f, { once: true }); }, ms);
  const tasks = [
    wait(f => (document.fonts && document.fonts.ready ? document.fonts.ready.then(f) : f()), 5000),
    wait(f => (document.readyState === 'complete' ? f() : addEventListener('load', f, { once: true })), 8000),
    audioReady(introBgm, 5000), audioReady(menuBgm, 5000)
  ];
  let real = 0; for (const p of tasks) p.then(() => { real++; });
  const T0 = performance.now(), MIN = 2.8;
  let shown = 0, ready = false, finishing = false, flashT = 0, last = T0, raf = 0;

  // ---- cubo 3D (cores do logo do console: vermelho, verde, azul, amarelo; topo e base em cinza)
  const COLS = ['#e53935', '#3fae49', '#2f7be8', '#f9c80e'];
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const FACES = [
    { n: [0, 0, -1], v: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]], c: 0 },
    { n: [0, 0, 1], v: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]], c: 2 },
    { n: [1, 0, 0], v: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]], c: 1 },
    { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]], c: 3 },
    { n: [0, -1, 0], v: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], c: -1 },
    { n: [0, 1, 0], v: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], c: -1 }
  ];
  function drawCube(cx, cy, s, ry, rx) {
    const cyA = Math.cos(ry), syA = Math.sin(ry), cxA = Math.cos(rx), sxA = Math.sin(rx), F = 6;
    const rot = (x, y, z) => { const x1 = x * cyA + z * syA, z1 = -x * syA + z * cyA; return [x1, y * cxA - z1 * sxA, y * sxA + z1 * cxA]; };
    const vis = [];
    for (const f of FACES) {
      const n = rot(...f.n); if (n[2] >= 0) continue;   // de costas para a câmera
      const pts = f.v.map(p => { const r = rot(...p), k = F / (F + r[2]); return [cx + r[0] * k * s, cy + r[1] * k * s, r[2]]; });
      vis.push({ f, n, pts, z: pts.reduce((a, p) => a + p[2], 0) / 4 });
    }
    vis.sort((a, b) => b.z - a.z);
    for (const q of vis) {
      const lam = Math.max(0, -q.n[0] * 0.45 - q.n[1] * 0.6 - q.n[2] * 0.66), br = 0.42 + 0.78 * lam;
      const base = q.f.c >= 0 ? rgb(COLS[q.f.c]) : [150, 156, 170];
      c.fillStyle = `rgb(${Math.min(255, base[0] * br) | 0},${Math.min(255, base[1] * br) | 0},${Math.min(255, base[2] * br) | 0})`;
      c.beginPath(); c.moveTo(q.pts[0][0], q.pts[0][1]); for (let i = 1; i < 4; i++) c.lineTo(q.pts[i][0], q.pts[i][1]); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = Math.max(1, s * 0.03); c.stroke();
      c.strokeStyle = `rgba(255,255,255,${0.1 + 0.3 * lam})`; c.lineWidth = Math.max(1, s * 0.02); c.beginPath(); c.moveTo(q.pts[0][0], q.pts[0][1]); c.lineTo(q.pts[1][0], q.pts[1][1]); c.stroke();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const el = (now - T0) / 1000, target = Math.min(real / tasks.length, el / MIN);
    shown += (target - shown) * Math.min(1, dt * 5); if (shown > 0.995 && target >= 1) shown = 1;
    if (!ready && shown >= 1 && el >= MIN) ready = true;

    const t = el, m = Math.min(W, H), s = m * (W < H ? 0.17 : 0.14);
    c.setTransform(D, 0, 0, D, 0, 0); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.37 + Math.sin(t * 2.2) * s * 0.07;
    // brilho atrás do cubo
    const gl = c.createRadialGradient(cx, cy, s * 0.3, cx, cy, s * 3.4); gl.addColorStop(0, 'rgba(120,150,255,.22)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    const spin = t * (ready ? 2.4 : 1.5), tilt = 0.55 + Math.sin(t * 0.9) * 0.28, floorY = cy + s * 1.95;
    // reflexo no chão
    c.save(); c.beginPath(); c.rect(0, floorY, W, H); c.clip(); c.translate(0, floorY * 2); c.scale(1, -1); c.globalAlpha = 0.16; drawCube(cx, cy, s, spin, tilt); c.restore();
    const fg = c.createLinearGradient(0, floorY, 0, floorY + s * 1.6); fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = fg; c.fillRect(0, floorY, W, s * 1.7);
    drawCube(cx, cy, s, spin, tilt);

    // título
    const fs = Math.max(22, Math.min(W * 0.085, m * 0.1));
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `400 ${fs}px Bungee, Impact, sans-serif`;
    c.shadowColor = 'rgba(120,150,255,.7)'; c.shadowBlur = 18; c.fillStyle = '#fff'; c.fillText('7 SHADOWS', cx, H * 0.665); c.shadowBlur = 0;

    // barra + texto
    const bw = Math.min(W * 0.72, 440), bh = Math.max(10, m * 0.022), bx = cx - bw / 2, by = H * 0.8;
    if (!ready) {
      const dots = '.'.repeat(1 + ((t * 2.5) | 0) % 3);
      c.font = `400 ${Math.max(13, fs * 0.38)}px Bungee, Impact, sans-serif`; c.fillStyle = '#cfd6ee'; c.textAlign = 'left'; c.fillText('CARREGANDO' + dots, bx, by - bh * 1.7);
      c.textAlign = 'right'; c.fillText(Math.round(shown * 100) + '%', bx + bw, by - bh * 1.7);
    }
    c.fillStyle = '#12141c'; c.strokeStyle = '#8b93ad'; c.lineWidth = 2; c.beginPath(); c.rect(bx, by, bw, bh); c.fill(); c.stroke();
    c.save(); c.beginPath(); c.rect(bx + 2, by + 2, Math.max(0, (bw - 4) * shown), bh - 4); c.clip();
    for (let i = 0; i < 4; i++) { c.fillStyle = COLS[i]; c.fillRect(bx + 2 + (bw - 4) * i / 4, by + 2, (bw - 4) / 4 + 1, bh - 4); }
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(bx, by + 2, bw, (bh - 4) * 0.4); c.restore();
    if (ready) {
      const blink = 0.55 + 0.45 * Math.sin(t * 5);
      c.textAlign = 'center'; c.font = `400 ${Math.max(14, fs * 0.42)}px Bungee, Impact, sans-serif`; c.globalAlpha = finishing ? 1 : blink; c.fillStyle = '#ffe14f';
      c.fillText(touchDev ? 'TOQUE NA TELA' : 'PRESSIONE QUALQUER TECLA', cx, by + bh * 3.4); c.globalAlpha = 1;
    }
    if (flashT) { c.fillStyle = `rgba(255,255,255,${Math.min(1, (now - flashT) / 180)})`; c.fillRect(0, 0, W, H); }
  }
  raf = requestAnimationFrame(frame);

  function finish() {
    if (finishing) return; finishing = true; flashT = performance.now();
    removeEventListener('keydown', onKey, true); removeEventListener('pointerdown', onPtr, true); removeEventListener('touchstart', onPtr, true);
    bootDoneAt = performance.now(); bootOn = false;
    try { initAudio(); } catch { }
    introT = 0; introLast = performance.now();   // abertura e música começam juntas, do zero
    try { introBgm.volume = 0; const pr = introBgm.play(); if (pr && pr.catch) pr.catch(() => { }); } catch { }   // o play() tem que sair DENTRO do toque (Safari); o volume sobe no tick
    introMusicTick();
    setTimeout(() => { ov.style.opacity = '0'; ov.style.pointerEvents = 'none'; }, 180);
    setTimeout(() => { cancelAnimationFrame(raf); ov.remove(); removeEventListener('resize', fit); }, 800);
  }
  const onKey = e => {
    e.stopImmediatePropagation();   // enquanto carrega, o jogo não recebe teclas
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key) || /^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow')) e.preventDefault();
    if (ready) finish();
  };
  const onPtr = e => { e.stopImmediatePropagation(); if (ready) finish(); };
  addEventListener('keydown', onKey, true); addEventListener('pointerdown', onPtr, true); addEventListener('touchstart', onPtr, { capture: true, passive: true });
})();

/* ------------------------------------------------ MENU: música */
$('btnMusic').onclick = () => showTab('music');
$('btnMusicBack').onclick = () => showTab('play');

/* ------------------------------------------------ MENU: Shadows (todos os personagens) */
function shadowInfo(k) {
  const st = (Shared.SKIN_STATS && Shared.SKIN_STATS[k]) || {}, L = [];
  const pct = v => Math.round(v * 100) + '%';
  L.push('Vida ' + pct(maxHpOf(k) / MAX_HP));
  if (Shared.speedMulOf(k) !== 1) L.push('Velocidade ' + pct(Shared.speedMulOf(k)));
  if (Shared.dmgTakenOf(k) !== 1) L.push('Dano de armas recebido ' + pct(Shared.dmgTakenOf(k)));
  if (st.healTime || st.healPct) L.push('Cura ' + Shared.healPctOf(k) + '% da vida em ' + String(healTimeOf(k)).replace('.', ',') + ' s');
  if (st.meleeOnly) L.push('Só empunha armas corpo a corpo');
  if (st.bladeKill) L.push('Lâmina arremessada que acerta a lâmina tira 100%');
  if (hasActive(k)) L.push('Ativa (Espaço): ' + (hasHook(k) ? 'gancho' : hasDual(k) ? 'segura 2 armas do mesmo tipo (ex.: pistola + revólver), uma em cada mão (de fogo: atiram juntas; corpo a corpo: combo direita, esquerda e cruzado; lança: estocada, slash e dupla estocada; garrafa: rajada de 4 e esmagada)' : 'explosão'));
  return L;
}
function buildShadows() {
  const box = $('shadowList'); if (!box) return;
  box.textContent = '';
  for (const k in SKINS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'shad'; b.dataset.skin = k;
    const cv = document.createElement('canvas'); cv.width = 112; cv.height = 112; cv.className = 'shad-face';
    try { drawFace(cv, k, SKINS[k].c); } catch { }
    const info = document.createElement('div'); info.className = 'shad-info';
    const nm = document.createElement('b'); nm.textContent = SKINS[k].n;
    const ul = document.createElement('ul');
    const lines = shadowInfo(k);
    if (lines.length === 1) lines.push('Sem passivas · estilo equilibrado');
    for (const t of lines) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
    const tag = document.createElement('em'); tag.className = 'shad-tag'; tag.textContent = 'EM USO';
    info.append(nm, ul); b.append(cv, info, tag);
    b.onclick = () => { cfg.skin = k; saveCfg(); refreshShadows(); try { if (ac) sfx('tick'); } catch { } };
    box.appendChild(b);
  }
  refreshShadows();
}
function refreshShadows() { const box = $('shadowList'); if (box) for (const b of box.children) b.setAttribute('aria-pressed', b.dataset.skin === cfg.skin ? 'true' : 'false'); }
$('btnShadows').onclick = () => showTab('shadows');
$('btnShadowsBack').onclick = () => showTab('play');

// Esc: só pausa quando o menu inicial NÃO está aberto
addEventListener('keydown', e => {
  if (e.key === 'Escape' && mode && $('menu').classList.contains('hidden') && $('opts').classList.contains('hidden')) { e.preventDefault(); setPaused(!paused); }
}, true);
