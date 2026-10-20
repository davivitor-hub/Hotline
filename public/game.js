'use strict';
/* ==========================================================================
   NEON DUEL — cliente
   Online 1v1 (servidor autoritativo + predição/reconciliação) ou treino vs bot
   (a mesma simulação roda localmente). Estilo Hotline Miami: um tiro = morte.
   ========================================================================== */
const { TILE, PR, WEAPONS, MAPS, Level, Game, Bot, stepMove, canMove, angDiff, DOWN_TIME, MAX_HP, HEAL_PCT, HEAL_TIME, MAX_PLAYERS, MIN_PLAYERS } = Shared;
const $ = id => document.getElementById(id);

// Mesma origem quando servido pelo Render (ou localhost); senão aponta para o Render.
const RENDER_HOST = 'hotline-m6gx.onrender.com';
const SAME_ORIGIN = location.protocol.startsWith('http') && (location.hostname === RENDER_HOST || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const SERVER_URL = SAME_ORIGIN ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host : 'wss://' + RENDER_HOST;
// Acorda o servidor do Render (plano gratuito dorme) assim que a página abre.
if (!SAME_ORIGIN) { try { fetch('https://' + RENDER_HOST + '/health', { mode: 'no-cors' }); } catch { } }

const STEP = 1 / 60, TAU = Math.PI * 2;
const ZOOM = 1;        // escala geral da câmera (boneco + mapa); 1 = original
const CHAR_SCALE = 1.4; // escala só do boneco (desenho); o mapa e a colisão não mudam
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
let keys = {}, mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false }, edge = { fp: false, pk: false, th: false, hl: false };
let shake = 0, zoomKick = 0, hitstop = 0, goUntil = 0;
let fx = { parts: [], lights: [], slashes: [], corpses: [], flash: 0, red: 0 };
let anim = {}, levelCv = null, wallCv = null, decal = null, dctx = null;
const INTERP = () => (mode === 'local' ? 40 : 100);
