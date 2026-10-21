/* ==========================================================================
   7 SHADOWS — simulação compartilhada
   Roda no servidor (Node) E no navegador (modo treino vs bot + predição).
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 72, PR = 18, CS = 1.35, SPEED = 290, WIN_SCORE = 5, DOWN_TIME = 1.7;
  const MAX_PLAYERS = 7;   // máximo de jogadores na sala
  const MIN_PLAYERS = 2;   // a partida começa com 2 ou mais

  /* ===== VIDA E DANO (tudo em % da vida máxima) ===== */
  const MAX_HP = 5000;     // vida máxima = 100%
  const EXEC_MULT = 3;     // multiplicador do golpe corpo a corpo em quem está caído no chão
  const THROW_DMG = 10;    // % tirado por arma arremessada que acerta
  const DOOR_DMG = 0;      // % tirado por porta na cara (como no Hotline Miami: só derruba/atordoa)
  const HEAL_PCT = 20;     // % da vida máxima que a cura devolve
  const HEAL_TIME = 1.5;   // segundos de cura (o boneco anda devagar); a cura é ilimitada e pode ser cancelada
  const HEAL_SLOW = 0.3;   // multiplicador da velocidade de movimento enquanto cura
  const SWAP_TIME = 0.2;      // segundos para sacar a outra arma do inventário (2 espaços)
  const BLADE_CHANCE = 0.5;   // chance de a LÂMINA acertar quando faca/machete/katana são arremessadas: mata na hora (senão acerta o cabo)
  // Lâmina arremessada: só a MACHETE mata na hora (BLADE_CHANCE); faca e katana acertando a lâmina tiram só uma fatia da vida.
  // (a lança arremessada já chega a 100% quando carregada no máximo: SPEAR_THROW_MAX)
  const BLADE_KILL = { MACHETE: true };
  const BLADE_DMG = { KNIFE: 35, KATANA: 50 };   // % de vida tirada pela lâmina de quem não mata na hora
  // Atordoamento (s) de quem leva uma arma arremessada: corpo a corpo não atordoa (só o taco), armas de fogo 1 s
  const THROW_DOWN = {
    KNIFE: 0, MACHETE: 0, KATANA: 0, SPEAR: 0,    // corpo a corpo: sem atordoamento
    BAT: 1.5, MINIGUN: 1.5,
    PISTOL: 0.5,
    SMG: 1, REVOLVER: 1, RIFLE: 1, SHOTGUN: 1, SNIPER: 1
  };
  // Peso (kg aprox.) de cada arma: define o alcance do arremesso. Mais leve = voa mais longe; mais pesada = cai perto.
  const WEIGHT = { FISTS: 0, KNIFE: 0.4, PISTOL: 1, MACHETE: 1, KATANA: 1.1, REVOLVER: 1.3, SPEAR: 1.5, BAT: 1.6, SMG: 2.2, RIFLE: 3.5, SHOTGUN: 3.8, SNIPER: 5, MINIGUN: 9 };
  const throwFactor = type => 1.4 / (1 + 0.25 * (WEIGHT[type] || 1));   // multiplicador da velocidade (e portanto do alcance) do arremesso
  const SPEAR_CHARGE = 1.1;   // segundos segurando o arremesso para a lança chegar na força máxima
  const SPEAR_THROW_MIN = 20, SPEAR_THROW_MAX = 100;   // % de vida tirada pela lança arremessada: toque rápido -> segurando até o fim
  /* ===== PORTAS (física) ===== */
  const DOOR_HT = 5;     // meia espessura da folha da porta
  const WATER_SLOW = 0.5;  // multiplicador da velocidade dentro da piscina
  const DOOR_LIM = 1.52;   // abertura máxima (rad, ~87°) para cada lado
  const DOOR_DAMP = 3.6;   // atrito da dobradiça (1/s)

  /* ---------------------------------------------------------------- ARMAS */
  // muz = distância do centro do personagem até a ponta do cano (para o tiro sair da ponta da arma)
  const WEAPONS = {
    FISTS:   { name: 'MÃOS',    dmg: 5,  melee: true, range: 52, arc: 2.0, cd: 0.40, col: '#ffd7b0' },
    KNIFE:   { name: 'FACA',    dmg: 40, melee: true, blade: true, range: 70, arc: 1.7, cd: 0.26, col: '#e6f1ff' },
    MACHETE: { name: 'MACHETE', dmg: 55, melee: true, blade: true, range: 90, arc: 2.2, cd: 0.34, col: '#b9ff79' },
    BAT:     { name: 'TACO',    dmg: 50, melee: true, range: 98, arc: 2.4, cd: 0.50, col: '#ffb35c' },
    KATANA:  { name: 'KATANA',  dmg: 70, melee: true, blade: true, range: 116, arc: 2.6, cd: 0.40, col: '#9ff7ff' },
    SPEAR:   { name: 'LANÇA',   dmg: 60, melee: true, jav: true, range: 148, arc: 0.95, cd: 0.55, col: '#ffd9a0' },
    PISTOL:  { name: 'PISTOLA', dmg: 35, ammo: 9,  cd: 0.27,  spread: 0.03, speed: 1150, pellets: 1, range: 1100, auto: false, col: '#6bf4ff', muz: 32 },
    REVOLVER:{ name: 'REVÓLVER',dmg: 55, ammo: 6,  cd: 0.60,  spread: 0.02, speed: 1300, pellets: 1, range: 1100, auto: false, col: '#ffcf5a', muz: 34 },
    SMG:     { name: 'SMG',     dmg: 12, ammo: 30, cd: 0.085, spread: 0.11, speed: 1100, pellets: 1, range: 900,  auto: true,  col: '#ff8ad8', muz: 44 },
    RIFLE:   { name: 'FUZIL',   dmg: 25, ammo: 24, cd: 0.15,  spread: 0.04, speed: 1400, pellets: 1, range: 1600, auto: true,  col: '#b9ff79', muz: 58 },
    SHOTGUN: { name: 'SHOTGUN', dmg: 15, ammo: 6,  cd: 0.80,  spread: 0.30, speed: 980,  pellets: 7, range: 440,  auto: false, col: '#ffc96b', muz: 58 },
    SNIPER:  { name: 'SNIPER',  dmg: 85, ammo: 4,  cd: 1.15,  spread: 0.004, speed: 2800, pellets: 1, range: 3400, auto: false, col: '#ff5a7a', muz: 78 },
    MINIGUN: { name: 'MINIGUN', dmg: 7,  ammo: 120, cd: 0.055, spread: 0.18, speed: 1050, pellets: 1, range: 800,  auto: true,  col: '#ffb02e', muz: 68 }
  };
  // Raridade: quanto menor o peso, mais difícil da arma aparecer
  const RARITY = {
    KNIFE: 10, BAT: 10, PISTOL: 10,                 // comuns
    MACHETE: 6, SPEAR: 6, SMG: 6,                   // incomuns
    KATANA: 3, SHOTGUN: 3, RIFLE: 3, REVOLVER: 3,   // raras
    SNIPER: 1.2, MINIGUN: 0.8                       // épicas
  };
  const RARITY_KEYS = Object.keys(RARITY);
  for (const k of RARITY_KEYS) RARITY[k] = Math.pow(RARITY[k], 0.6);   // achata os pesos: sorteio bem mais variado
  const RARITY_TOTAL = RARITY_KEYS.reduce((a, k) => a + RARITY[k], 0);
  function rollWeapon() {
    let r = Math.random() * RARITY_TOTAL;
    for (const k of RARITY_KEYS) { r -= RARITY[k]; if (r <= 0) return k; }
    return RARITY_KEYS[0];
  }
  // Cor aleatória por jogador: sorteia um matiz que não seja parecido com o dos outros
  function hslHex(h, sat, l) {
    h = ((h % 360) + 360) % 360; sat /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const x = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + x(f(0)) + x(f(8)) + x(f(4));
  }
  function hexHue(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function randomColor(used) {
    const hues = (used || []).filter(Boolean).map(hexHue);
    let best = 0, bestD = -1;
    for (let i = 0; i < 24; i++) {
      const h = Math.random() * 360;
      const dist = hues.reduce((m, u) => Math.min(m, Math.abs(((h - u + 540) % 360) - 180)), 180);
      if (dist > bestD) { bestD = dist; best = h; }
      if (dist >= 40) break;
    }
    return hslHex(best, 72 + Math.random() * 23, 52 + Math.random() * 8);
  }
  // Hitbox das armas no chão: em vez de um círculo no centro, é o COMPRIMENTO da arma (cabo -> ponta) + uma folga.
  // ext = [trás, frente] do sprite (px do mundo, já com a escala do desenho). Armas compridas (lança, sniper, katana) agora são fáceis de pegar.
  const ITEM_EXT = { PISTOL: [4, 23], REVOLVER: [7, 26], SMG: [12, 42], RIFLE: [14, 60], SHOTGUN: [14, 62], SNIPER: [17, 82], MINIGUN: [9, 60],
    KNIFE: [6, 38], MACHETE: [6, 61], BAT: [6, 61], KATANA: [10, 78], SPEAR: [16, 102] };
  const PICK_R = 46;   // folga (px) ao redor da arma
  // distância de (px,py) até a arma deitada no chão (segmento cabo -> ponta, girado por rot)
  function itemDist(type, ix, iy, rot, px, py) {
    const e = ITEM_EXT[type] || [8, 30], c = Math.cos(rot), s = Math.sin(rot);
    return segDist(px, py, ix - c * e[0], iy - s * e[0], ix + c * e[1], iy + s * e[1]);
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

  /* ----------------------------------------------------------------- MAPAS
     Todos os mapas são simétricos (rotação de 180°) => 1v1 justo.
     Tudo que se define é espelhado automaticamente. 1 = parede, 2 = porta.   */
  const MAPS = {}, MAP_IDS = [];
  // Tiles: 0 = livre, 1 = parede, 2 = porta, 3 = móvel (sólido, só muda o desenho).
  function buildMap(id, name, theme, def) {
    const W = 32, H = 20, g = [], fl = [];
    for (let y = 0; y < H; y++) { g.push(new Array(W).fill(0)); fl.push(new Array(W).fill(theme.base)); }
    const set = (x, y, v) => { g[y][x] = v; g[H - 1 - y][W - 1 - x] = v; };
    const rect = (x1, y1, x2, y2, v = 1) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, v); };
    const spawn = [], wp = [], furn = [], rugs = [], circ = [], rnd = []; let pair = 0;
    // móveis redondos (árvore, vaso, churrasqueira) colidem como CÍRCULO, não como o quadrado inteiro; a piscina (tile 4) é água: dá pra andar, mais devagar
    const ROUND = { tree: f => Math.min(f.w, f.h) / 2 - 0.05, plant: () => 0.36, bbq: () => 0.38, palm: () => 0.34, barrel: () => 0.36 };
    const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    def({
      rect,
      // cada chamada cria 2 pontos de nascimento (o ponto e o seu espelho de 180°)
      spawn: (x, y) => { spawn.push([x, y], [W - 1 - x, H - 1 - y]); },
      weapon: (x, y, k) => { wp.push({ x, y, k, pair }); wp.push({ x: W - 1 - x, y: H - 1 - y, k, pair }); pair++; },
      // móvel sólido (w x h tiles). O espelho de 180° é criado automaticamente.
      furn: (x, y, w, h, k, o = {}) => {
        const a = Object.assign({ x, y, w, h, k, r: 0 }, o), b = Object.assign({}, a, { x: W - x - w, y: H - y - h, r: 2 });
        furn.push(a); if (!same(a, b)) furn.push(b);
        for (const f of (same(a, b) ? [a] : [a, b])) {
          const rf = ROUND[f.k];
          if (rf) circ.push({ x: (f.x + f.w / 2) * TILE, y: (f.y + f.h / 2) * TILE, r: rf(f) * TILE });
          for (let j = f.y; j < f.y + f.h; j++) for (let i = f.x; i < f.x + f.w; i++) { g[j][i] = (f.k === 'pool' || f.k === 'oasis') ? 4 : 3; if (rf) rnd.push(j * W + i); }
        }
      },
      // tapete (decoração sem colisão)
      rug: (x, y, w, h, col) => {
        const a = { x, y, w, h, col }, b = { x: W - x - w, y: H - y - h, w, h, col };
        rugs.push(a); if (!same(a, b)) rugs.push(b);
      },
      // tipo de piso de uma região
      floor: (x1, y1, x2, y2, kind) => { for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) { fl[y][x] = kind; fl[H - 1 - y][W - 1 - x] = kind; } }
    });
    MAPS[id] = { id, name, theme, W, H, g, fl, spawn, wp, furn, rugs, circ, rnd };
    MAP_IDS.push(id);
  }

  // ---- CASA: quartos, banheiro e sala/cozinha no meio.
  buildMap('HOUSE', 'CASA', { base: 'wood', wall: '#efe4cf', wallTop: '#fbf4e4', edge: '#5a4632', out: '#1c2128' }, m => {
    m.rect(0, 0, 31, 0); m.rect(0, 0, 0, 19);          // paredes externas
    m.rect(10, 1, 10, 18);                             // divisória esquerda da sala
    m.rect(1, 9, 9, 9);                                // divisória quarto / banheiro
    m.rect(10, 4, 10, 4, 2); m.rect(10, 14, 10, 14, 2); m.rect(5, 9, 5, 9, 2);   // portas
    m.rect(10, 9, 10, 10, 0);                          // passagem larga
    // pisos
    m.floor(1, 1, 9, 8, 'carpet');                     // quarto
    m.floor(1, 10, 9, 18, 'tile');                     // banheiro
    m.floor(11, 1, 20, 5, 'ktile');                    // cozinha
    // QUARTO
    m.rug(3, 4, 5, 3, '#b8574a');
    m.furn(1, 1, 2, 3, 'bed'); m.furn(3, 1, 1, 1, 'nightstand');
    m.furn(5, 1, 3, 1, 'wardrobe'); m.furn(9, 1, 1, 1, 'plant');
    m.furn(8, 8, 2, 1, 'desk');
    // BANHEIRO
    m.rug(3, 13, 5, 3, '#6fb8b4');
    m.furn(1, 10, 3, 1, 'tub'); m.furn(8, 10, 1, 1, 'toilet'); m.furn(9, 10, 1, 1, 'sink');
    m.furn(1, 18, 1, 1, 'washer'); m.furn(2, 18, 1, 1, 'washer'); m.furn(6, 18, 3, 1, 'shelf');
    m.furn(9, 18, 1, 1, 'plant'); m.furn(5, 14, 2, 1, 'bench');
    // SALA + COZINHA
    m.rug(12, 8, 8, 4, '#3f5f8a');
    m.furn(11, 1, 3, 1, 'counter'); m.furn(14, 1, 1, 1, 'fridge');
    m.furn(13, 4, 2, 2, 'dining');
    m.furn(14, 7, 4, 1, 'sofa');
    m.furn(15, 9, 2, 2, 'coffee');
    m.furn(11, 7, 1, 2, 'bookshelf');
    m.furn(11, 17, 1, 1, 'plant'); m.furn(20, 8, 1, 1, 'plant');
    m.spawn(4, 5); m.spawn(17, 3); m.spawn(4, 12); m.spawn(3, 16);
    m.weapon(3, 7, 'M'); m.weapon(2, 16, 'M');
    m.weapon(8, 3, 'G'); m.weapon(12, 6, 'G');
    m.weapon(8, 16, 'R'); m.weapon(13, 10, 'R');
    m.weapon(7, 12, 'G'); m.weapon(17, 5, 'R');
  });

  // ---- CASA COM QUINTAL: casa no meio, jardim com piscina em volta.
  buildMap('YARD', 'CASA COM QUINTAL', { base: 'grass', wall: '#efe4cf', wallTop: '#fbf4e4', edge: '#5a4632', out: '#142418', hedge: true }, m => {
    m.rect(0, 0, 31, 0); m.rect(0, 0, 0, 19);          // cerca viva
    m.rect(8, 6, 23, 6); m.rect(8, 6, 8, 13);          // paredes da casa
    m.rect(15, 6, 15, 6, 2); m.rect(8, 9, 8, 9, 2);    // portas
    m.rect(8, 11, 8, 11, 0);                           // passagem
    m.floor(9, 7, 22, 12, 'wood');
    m.floor(15, 1, 16, 5, 'path'); m.floor(2, 2, 6, 5, 'deck');
    // casa
    m.rug(12, 8, 8, 4, '#a34a5e');
    m.furn(10, 7, 1, 1, 'fridge'); m.furn(11, 7, 3, 1, 'counter');
    m.furn(9, 7, 1, 1, 'plant');
    m.furn(12, 10, 4, 1, 'sofa'); m.furn(13, 12, 2, 1, 'tv');
    // quintal
    m.furn(3, 3, 3, 2, 'pool'); m.furn(12, 2, 2, 2, 'tree');
    m.furn(3, 14, 1, 3, 'hedge'); m.furn(8, 15, 1, 1, 'bbq');
    m.spawn(2, 9); m.spawn(10, 3); m.spawn(2, 16); m.spawn(10, 10);
    m.weapon(2, 5, 'M'); m.weapon(5, 10, 'G'); m.weapon(10, 8, 'R');
    m.weapon(13, 4, 'R'); m.weapon(6, 17, 'M'); m.weapon(11, 16, 'G');
    m.weapon(10, 12, 'G'); m.weapon(7, 2, 'R');
  });

  // ---- AURA AREIUDA: vila de arenito com oásis no centro (inspirada em Oasis/Dust). Só a metade esquerda é desenhada; o resto é o espelho de 180°.
  buildMap('DESERT', 'AURA AREIUDA', { base: 'sand', wall: '#d9b878', wallTop: '#efd9a8', edge: '#6b4e28', out: '#2a1d0e', brick: true }, m => {
    const rows = [
      '################',
      '#....#....#.....',
      '#....#....#..#..',
      '#....#.......#..',
      '#....#....#..#..',
      '#.........#.....',
      '#.........#.....',
      '####D###.##.....',
      '#...............',
      '#...............',
      '#..###...#......',
      '#........#......',
      '#........#......',
      '#...............',
      '###D###.........',
      '#.....#....###..',
      '#.....#.........',
      '#...............',
      '#.....#.........',
      '################'
    ];
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { if (r[x] === '#') m.rect(x, y, x, y, 1); else if (r[x] === 'D') m.rect(x, y, x, y, 2); } });
    m.floor(1, 1, 9, 6, 'stone'); m.floor(1, 15, 5, 18, 'stone');
    m.furn(14, 8, 4, 4, 'oasis');                                   // oásis no centro (água: dá pra atravessar, mais devagar)
    m.furn(1, 1, 1, 1, 'crate'); m.furn(1, 2, 1, 1, 'crate'); m.furn(6, 1, 2, 1, 'pipes');
    m.furn(9, 2, 1, 1, 'barrel'); m.furn(9, 5, 1, 1, 'barrel'); m.furn(2, 5, 2, 1, 'sandbags');
    m.furn(2, 8, 2, 1, 'stall'); m.furn(6, 8, 1, 1, 'crate'); m.furn(6, 9, 1, 1, 'crate');
    m.furn(11, 5, 2, 2, 'palm'); m.furn(12, 8, 2, 2, 'palm'); m.furn(14, 12, 2, 2, 'palm'); m.furn(8, 15, 2, 2, 'palm');
    m.furn(10, 13, 1, 1, 'barrel'); m.furn(11, 13, 1, 1, 'barrel');
    m.furn(1, 12, 2, 1, 'pipes'); m.furn(9, 17, 2, 1, 'sandbags');
    m.furn(7, 15, 1, 1, 'crate'); m.furn(7, 16, 1, 1, 'crate');
    m.furn(1, 18, 2, 1, 'pipes'); m.furn(5, 15, 1, 1, 'crate'); m.furn(5, 18, 1, 1, 'barrel');
    m.spawn(3, 3); m.spawn(12, 3); m.spawn(4, 16); m.spawn(11, 10);
  });

  // menor distância de um ponto (cx,cy) ao segmento (ax,ay)-(bx,by)
  function segDist(cx, cy, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
  }

  /* ---------------------------------------------------------------- NÍVEL */
  class Level {
    constructor(id) {
      const m = MAPS[id];
      this.id = id; this.m = m; this.W = m.W; this.H = m.H; this.circ = m.circ; this.rnd = new Set(m.rnd);
      this.g = m.g.map(r => r.slice());
      this.doors = [];
      for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.g[y][x] === 2) {
        const h = m.g[y][x - 1] === 1 && m.g[y][x + 1] === 1;
        this.doors.push({ i: this.doors.length, x, y, o: h ? 'h' : 'v', latched: true, phi: 0, w: 0, by: null,
          hx: h ? x * TILE : (x + 0.5) * TILE, hy: h ? (y + 0.5) * TILE : y * TILE });
      }
    }
    // tiles: 0 livre, 1 parede, 2 porta, 3 móvel sólido, 4 água (livre, mais lenta). Móvel redondo: o tile só vale como sólido dentro do círculo.
    solid(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
      const v = this.g[ty][tx];
      return v !== 0 && v !== 4 && !(v === 3 && this.rnd.has(ty * this.W + tx));
    }
    solidAt(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      if (this.solid(tx, ty)) return true;
      if (this.rnd.size && this.rnd.has(ty * this.W + tx)) for (const c of this.circ) if (Math.hypot(px - c.x, py - c.y) < c.r) return true;
      return false;
    }
    waterAt(px, py) { const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE); return tx >= 0 && ty >= 0 && tx < this.W && ty < this.H && this.g[ty][tx] === 4; }
    // ---- portas com física: a folha gira em torno da dobradiça (phi = ângulo, w = velocidade angular).
    // Fechada = "travada" (tile sólido). Destravada = folha solta que balança, empurra e pode ser fechada de novo.
    doorEnd(d) { const a = d.o === 'h' ? d.phi : Math.PI / 2 - d.phi; return [d.hx + Math.cos(a) * TILE, d.hy + Math.sin(a) * TILE]; }
    doorDist(d, x, y) { const e = this.doorEnd(d); return segDist(x, y, d.hx, d.hy, e[0], e[1]); }
    doorAt(x, y, r) { for (const d of this.doors) if (!d.latched && this.doorDist(d, x, y) < DOOR_HT + r) return true; return false; }
    doorHit(x, y, r) { for (const d of this.doors) if (!d.latched && this.doorDist(d, x, y) < DOOR_HT + r) return d; return null; }
    setLatched(d, v) { d.latched = v; this.g[d.y][d.x] = v ? 2 : 0; if (v) { d.phi = 0; d.w = 0; } }
    kickDoor(d, dir, w) { this.setLatched(d, false); d.phi = dir * 0.14; d.w = dir * w; }
    stepDoor(d, dt) {
      if (d.latched) return;
      d.phi += d.w * dt; d.w *= Math.exp(-DOOR_DAMP * dt);
      if (d.phi > DOOR_LIM) { d.phi = DOOR_LIM; if (d.w > 0) d.w = -d.w * 0.25; }
      else if (d.phi < -DOOR_LIM) { d.phi = -DOOR_LIM; if (d.w < 0) d.w = -d.w * 0.25; }
      if (Math.abs(d.w) < 0.04) d.w = 0;
    }
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
      this.pushCircles(p, r);
    }
    pushCircles(p, r) {
      for (const c of this.circ) {
        const dx = p.x - c.x, dy = p.y - c.y, rr = c.r + r;
        if (dx * dx + dy * dy < rr * rr) { const d = Math.hypot(dx, dy) || 1e-3; p.x = c.x + dx / d * rr; p.y = c.y + dy / d * rr; }
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

  function canMove(phase, alive, down, healing) { return !!alive && !down && (phase === 'live' || phase === 'over' || phase === 'matchover'); }

  // k = bitmask: W=1 A=2 S=4 D=8
  function stepMove(level, p, k, dt, sm = 1) {   // sm = multiplicador de velocidade (curando = HEAL_SLOW)
    let dx = ((k & 8) ? 1 : 0) - ((k & 2) ? 1 : 0), dy = ((k & 4) ? 1 : 0) - ((k & 1) ? 1 : 0);
    if (!dx && !dy) return null;
    const l = Math.hypot(dx, dy); dx /= l; dy /= l;
    if (level.waterAt(p.x, p.y)) sm *= WATER_SLOW;   // piscina: anda mais devagar
    const mx = dx * SPEED * sm * dt, my = dy * SPEED * sm * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 6));
    for (let i = 0; i < n; i++) { p.x += mx / n; p.y += my / n; level.push(p, PR); }
    return { dx, dy };
  }

  /* ----------------------------------------------------------------- JOGO */
  class Game {
    // autoStart: true => começa sozinho com 2+ jogadores (treino); false => sala com botão Iniciar (online)
    constructor(opts = {}) {
      this.autoStart = !!opts.autoStart;
      this.mapPref = MAPS[opts.map] ? opts.map : null;   // fase escolhida (null = aleatória a cada rodada)
      this.players = new Array(MAX_PLAYERS).fill(null); this.phase = this.autoStart ? 'waiting' : 'lobby'; this.timer = 0; this.round = 0;
      this.mapIdx = -1; this.level = null; this.bullets = []; this.items = []; this.events = []; this.nid = 1; this.winner = -1;
    }
    get count() { return this.players.filter(Boolean).length; }
    byId(id) { return this.players.find(p => p && p.id === id) || null; }

    addPlayer(id, name, skin) {
      const slot = this.players.findIndex(q => !q);
      if (slot < 0) return null;
      const p = { id, slot, name: String(name || 'JOGADOR').slice(0, 14), skin: skin || 'ROOSTER', color: randomColor(this.players.filter(Boolean).map(q => q.color)), x: 0, y: 0, angle: 0, alive: true, down: false, downT: 0, hp: MAX_HP,
        inv: [null, null], sel: 0, swcd: 0, cd: 0, swing: 0, buf: 0, fire: false, budget: 0.3, ack: 0, score: 0, bot: false, spawnIdx: -1, healT: 0, charging: false, chg: 0, tc: false, dcd: 0 };
      // inventário de 2 espaços: `weapon` continua sendo a arma NA MÃO (o espaço selecionado), então todo o resto do código funciona igual
      Object.defineProperty(p, 'weapon', { get() { return this.inv[this.sel]; }, set(v) { this.inv[this.sel] = v; }, enumerable: false, configurable: true });
      this.players[slot] = p;
      if (this.phase === 'waiting' || this.phase === 'lobby' || !this.level) {
        if (!this.autoStart) this.phase = 'lobby';                       // espera o anfitrião apertar Iniciar
        else if (this.count >= MIN_PLAYERS) this.startMatch(); else this.phase = 'waiting';
      } else if (this.phase === 'countdown') {
        // ainda na contagem: entra normalmente na rodada
        this.spawnPlayer(p, this.nextSpawn());
      } else {
        // rodada em andamento: assiste até a próxima rodada
        const s = this.level.m.spawn[0];
        p.x = (s[0] + 0.5) * TILE; p.y = (s[1] + 0.5) * TILE; p.alive = false;
      }
      return p;
    }
    removePlayer(id) {
      const p = this.byId(id); if (!p) return;
      this.players[p.slot] = null;
      if (this.count < MIN_PLAYERS) {
        // sem adversários: volta para a sala de espera
        for (const q of this.players) if (q) { q.score = 0; q.alive = true; q.hp = MAX_HP; q.down = false; q.healT = 0; q.inv = [null, null]; q.sel = 0; q.swcd = 0; }
        this.phase = this.autoStart ? 'waiting' : 'lobby'; this.level = null; this.bullets = []; this.items = []; this.round = 0; this.mapIdx = -1;
      }
    }
    // anfitrião = jogador conectado há mais tempo (menor slot); só ele inicia a partida
    hostId() { const p = this.players.find(Boolean); return p ? p.id : null; }
    requestStart(id) {
      if (this.autoStart || this.phase !== 'lobby') return false;
      if (id !== this.hostId() || this.count < MIN_PLAYERS) return false;
      this.startMatch(); return true;
    }
    toLobby() {
      for (const q of this.players) if (q) { q.score = 0; q.alive = true; q.hp = MAX_HP; q.down = false; q.downT = 0; q.healT = 0; q.inv = [null, null]; q.sel = 0; q.swcd = 0; q.fire = false; }
      this.phase = 'lobby'; this.level = null; this.bullets = []; this.items = []; this.round = 0; this.mapIdx = -1; this.winner = -1;
    }
    nextSpawn() { return this.players.reduce((m, q) => (q && q.spawnIdx > m ? q.spawnIdx : m), -1) + 1; }
    spawnPlayer(p, idx) {
      const sp = this.level.m.spawn, s = sp[idx % sp.length];
      p.spawnIdx = idx;
      p.x = (s[0] + 0.5) * TILE; p.y = (s[1] + 0.5) * TILE;
      p.angle = Math.atan2(this.level.H * TILE / 2 - p.y, this.level.W * TILE / 2 - p.x);
      p.alive = true; p.hp = MAX_HP; p.down = false; p.downT = 0; p.inv = [null, null]; p.sel = 0; p.swcd = 0; p.cd = 0; p.swing = 0; p.buf = 0; p.fire = false; p.healT = 0; p.charging = false; p.chg = 0; p.tc = false; p.dcd = 0;
    }
    startMatch() { for (const p of this.players) if (p) p.score = 0; this.round = 0; this.startRound(); }
    startRound() {
      this.round++;
      this.mapIdx = this.mapPref ? MAP_IDS.indexOf(this.mapPref) : Math.floor(Math.random() * MAP_IDS.length);   // fase escolhida, ou sorteada a cada rodada
      this.level = new Level(MAP_IDS[this.mapIdx]);
      this.bullets = []; this.items = []; this.winner = -1;
      let idx = 0;
      for (const p of this.players) if (p) this.spawnPlayer(p, idx++);
      // armas totalmente aleatórias a cada rodada: posições sorteadas em qualquer chão livre (sempre em PARES espelhados = justo),
      // quantidade de 4 a 9 pares, tipo sorteado por raridade em cada par e leve deslocamento dentro do tile
      const L = this.level, sp = L.m.spawn, cand = [];
      for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
        if (L.g[y][x] !== 0) continue;
        if (sp.some(s => Math.hypot(s[0] - x, s[1] - y) < 1.8)) continue;   // não nasce em cima de quem acabou de nascer
        cand.push([x, y]);
      }
      const want = 4 + Math.floor(Math.random() * 6), placed = [];
      for (let tries = 0; tries < 400 && placed.length < want && cand.length; tries++) {
        const [x, y] = pick(cand), mx = L.W - 1 - x, my = L.H - 1 - y;
        if (placed.some(q => Math.hypot(q[0] - x, q[1] - y) < 2.2 || Math.hypot(q[0] - mx, q[1] - my) < 2.2)) continue;
        if (Math.hypot(x - mx, y - my) < 1.5) continue;
        placed.push([x, y]);
      }
      for (const [x, y] of placed) {
        const type = rollWeapon(), jx = (Math.random() - 0.5) * 24, jy = (Math.random() - 0.5) * 24;
        this.addItem(type, (x + 0.5) * TILE + jx, (y + 0.5) * TILE + jy);
        this.addItem(type, (L.W - x - 0.5) * TILE - jx, (L.H - y - 0.5) * TILE - jy);
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
      p.fire = !!inp.f; p.tc = !!inp.tc;
      if (inp.fp) p.buf = 0.16;
      // cancelar a cura: apertar cura de novo, atacar, arremessar, pegar arma ou trocar de arma (não recebe a vida)
      let healCanceled = false;
      if (p.healT > 0 && this.phase === 'live' && (inp.hl || inp.fp || inp.th || inp.pk || inp.sw || inp.ss)) { this.cancelHeal(p); healCanceled = true; }
      if (this.phase === 'live' && p.alive && !p.down && !(p.healT > 0)) {
        if (inp.pk) this.pickup(p);
        if (inp.sw) this.swapTo(p, 1 - p.sel);              // scroll do mouse: alterna entre as 2 armas
        else if (inp.ss) this.swapTo(p, (inp.ss | 0) - 1);  // teclas 1 / 2: escolhe o espaço direto
        if (inp.th) this.startThrow(p);
        if (inp.hl && !healCanceled) this.heal(p);
      }
      if (canMove(this.phase, p.alive, p.down, p.healT > 0)) {
        const dd = Math.min(dt, 0.05, p.budget);
        if (dd > 0) {
          p.budget -= dd;
          const r = stepMove(this.level, p, inp.k | 0, dd, p.healT > 0 ? HEAL_SLOW : 1);
          if (r) { this.tryDoors(p, r.dx, r.dy); this.doorContact(p, dd); }
        }
      }
      if ((inp.fp || inp.f) && !(p.healT > 0)) this.tryFire(p);   // o tiro sai na hora que o clique chega, sem esperar o próximo tick
    }

    tick(dt) {
      for (const p of this.players) {
        if (!p) continue;
        p.cd -= dt; p.swcd -= dt; p.swing -= dt; p.buf -= dt; p.dcd -= dt; p.budget = Math.min(0.3, p.budget + dt);
        if (p.charging) {   // lança: enquanto segura o botão de arremesso a força sobe; soltou = arremessa
          if (!p.alive || p.down || p.healT > 0 || !p.weapon || p.weapon.type !== 'SPEAR' || this.phase !== 'live') { p.charging = false; p.chg = 0; }
          else {
            p.chg = Math.min(SPEAR_CHARGE, p.chg + dt);
            if (!p.tc) { const c = p.chg / SPEAR_CHARGE; p.charging = false; p.chg = 0; this.throwWeapon(p, c); }
          }
        }
        if (p.alive && !p.inv[p.sel] && p.inv[1 - p.sel]) p.sel = 1 - p.sel;   // largou/arremessou/perdeu a arma da mão: saca a outra sozinho
        if (p.down) { p.downT -= dt; if (p.downT <= 0) p.down = false; }
        if (p.healT > 0) {
          if (!p.alive || p.down || this.phase !== 'live') p.healT = 0;
          else {
            p.healT -= dt;
            if (p.healT <= 0) {
              p.healT = 0;
              p.hp = Math.min(MAX_HP, p.hp + MAX_HP * HEAL_PCT / 100);
              this.events.push({ t: 'heal', id: p.id, x: p.x, y: p.y, hp: Math.round(p.hp) });
            }
          }
        }
      }
      if (this.phase === 'waiting' || !this.level) return;
      for (const d of this.level.doors) this.stepDoor(d, dt);
      for (const p of this.players) if (p && p.alive) this.doorContact(p, dt);
      if (this.phase === 'countdown') {
        this.timer -= dt;
        if (this.timer <= 0) { this.phase = 'live'; this.events.push({ t: 'go' }); }
      } else if (this.phase === 'live') {
        for (const p of this.players) this.tryFire(p);
      }
      this.updateBullets(dt); this.updateItems(dt);
      if (this.phase === 'live') this.evalRound();
      else if (this.phase === 'over' || this.phase === 'matchover') {
        this.timer -= dt;
        if (this.timer <= 0) { if (this.phase === 'matchover') { if (this.autoStart) this.startMatch(); else this.toLobby(); } else this.startRound(); }
      }
    }

    evalRound() {
      const a = this.players.filter(p => p && p.alive);
      if (a.length >= 2) return;
      if (a.length === 0) { this.winner = -1; this.phase = 'over'; this.timer = 2.4; this.events.push({ t: 'end', w: -1 }); return; }
      const w = a[0]; w.score++; this.winner = w.slot;
      if (w.score >= WIN_SCORE) { this.phase = 'matchover'; this.timer = 5; } else { this.phase = 'over'; this.timer = 2.6; }
      this.events.push({ t: 'end', w: w.slot });
    }

    // dispara se der (cooldown pronto + clique guardado ou arma automática segurada). Chamado a cada tick E logo quando a entrada chega (menos atraso).
    tryFire(p) {
      if (!p || !p.alive || p.down || p.healT > 0 || p.charging || this.phase !== 'live') return;
      const w = p.weapon ? WEAPONS[p.weapon.type] : WEAPONS.FISTS;
      if (p.cd <= 0 && (p.buf > 0 || (p.fire && w.auto))) { p.buf = 0; this.attack(p); }
    }
    attack(p) {
      const wd = p.weapon ? WEAPONS[p.weapon.type] : WEAPONS.FISTS;
      if (wd.melee) {
        p.cd = wd.cd; p.swing = 0.2;
        this.events.push({ t: 'swing', by: p.id, w: p.weapon ? p.weapon.type : 'FISTS', x: p.x, y: p.y, a: p.angle });
        // o golpe atinge todos os adversários dentro do arco
        for (const o of this.players) {
          if (!o || o === p || !o.alive) continue;
          const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
          if (d > wd.range + PR) continue;
          const aa = Math.atan2(dy, dx);
          const tol = wd.arc / 2 + Math.asin(Math.min(1, PR * 0.75 / Math.max(d, 1)));   // alvo grande = mais fácil de acertar de raspão
          if ((Math.abs(angDiff(aa, p.angle)) <= tol || d < PR * 1.6) && this.level.los(p.x, p.y, o.x, o.y)) {
            if (o.down) this.hurt(o, p, wd.dmg * EXEC_MULT, 'exec', aa);
            else { this.hurt(o, p, wd.dmg, 'melee', aa); if (wd.knock) this.knockdown(o, DOWN_TIME, aa); }
          }
        }
        return;
      }
      if (p.weapon.ammo <= 0) { p.cd = 0.3; this.events.push({ t: 'click', by: p.id, x: p.x, y: p.y }); return; }
      p.weapon.ammo--; p.cd = wd.cd;
      let mz = wd.muz || 12;
      // se a ponta do cano atravessar uma parede (encostado nela), o tiro sai do corpo
      if (!this.level.los(p.x, p.y, p.x + Math.cos(p.angle) * mz, p.y + Math.sin(p.angle) * mz)) mz = 8;
      const sx = p.x + Math.cos(p.angle) * mz, sy = p.y + Math.sin(p.angle) * mz;
      for (let i = 0; i < wd.pellets; i++) {
        const a = p.angle + (Math.random() - 0.5) * 2 * wd.spread;
        const sp = wd.speed * (wd.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
        this.bullets.push({ id: this.nid++, x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: p.id, w: p.weapon.type, life: wd.range / sp });
      }
      this.events.push({ t: 'shot', by: p.id, w: p.weapon.type, x: p.x, y: p.y, a: p.angle });
    }

    // Tira `pct`% da vida máxima. Se zerar, mata.
    hurt(v, by, pct, how, a) {
      if (!v.alive || this.phase !== 'live') return false;
      v.hp = Math.max(0, v.hp - MAX_HP * pct / 100);
      this.events.push({ t: 'hurt', id: v.id, x: v.x, y: v.y, a, hp: Math.round(v.hp), by: by ? by.id : null });
      if (v.hp <= 0) this.kill(v, by, how, a);
      return true;
    }
    kill(v, by, how, a) {
      if (!v.alive || this.phase !== 'live') return;
      v.alive = false; v.down = false; v.fire = false; v.charging = false;
      this.dropAll(v, Math.cos(a) * 120, Math.sin(a) * 120);
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
    // ao morrer, as duas armas do inventário caem no chão
    dropAll(p, vx = 0, vy = 0) {
      this.dropWeapon(p, vx, vy);
      const o = p.inv[1 - p.sel];
      if (o) {
        this.addItem(o.type, p.x, p.y, -vx * 0.4 + (Math.random() - 0.5) * 90, -vy * 0.4 + (Math.random() - 0.5) * 90, o.ammo);
        p.inv[1 - p.sel] = null;
      }
    }
    // troca a arma da mão por a do outro espaço (precisa ter arma lá)
    swapTo(p, idx) {
      if (idx !== 0 && idx !== 1) return false;
      if (idx === p.sel || p.swcd > 0 || !p.inv[idx]) return false;
      p.sel = idx; p.swcd = SWAP_TIME; p.cd = Math.max(p.cd, SWAP_TIME);
      p.buf = 0; p.fire = false; p.charging = false; p.chg = 0;
      this.events.push({ t: 'swap', by: p.id, w: p.inv[idx].type, x: p.x, y: p.y });
      return true;
    }
    // Cura ilimitada: por HEAL_TIME s o jogador anda devagar (HEAL_SLOW); ao fim recebe HEAL_PCT% da vida máxima. Pode ser cancelada.
    cancelHeal(p) {
      if (!(p.healT > 0)) return false;
      p.healT = 0;
      this.events.push({ t: 'hcancel', id: p.id, x: p.x, y: p.y });
      return true;
    }
    heal(p) {
      if (!p.alive || p.down || p.healT > 0 || p.hp >= MAX_HP) return false;
      p.healT = HEAL_TIME; p.fire = false; p.buf = 0; p.charging = false; p.chg = 0;
      this.events.push({ t: 'hstart', id: p.id, x: p.x, y: p.y });
      return true;
    }
    pickup(p) {
      let best = null, bd = PICK_R;
      for (const it of this.items) {
        if (it.thrown) continue;
        const d = itemDist(it.type, it.x, it.y, it.rot, p.x, p.y);
        if (d < bd && this.level.los(p.x, p.y, it.x, it.y)) { bd = d; best = it; }   // não pega arma do outro lado da parede
      }
      if (!best) return false;
      // mão ocupada e o outro espaço livre -> guarda no espaço livre e já saca a nova; os dois cheios -> troca com a da mão
      const target = (p.inv[p.sel] && !p.inv[1 - p.sel]) ? 1 - p.sel : p.sel;
      const old = p.inv[target];
      p.inv[target] = { type: best.type, ammo: best.ammo }; p.sel = target; p.charging = false; p.chg = 0;
      this.items.splice(this.items.indexOf(best), 1);
      if (old) this.addItem(old.type, p.x, p.y, 0, 0, old.ammo);
      this.events.push({ t: 'pick', by: p.id, w: best.type, x: p.x, y: p.y });
      return true;
    }
    // Arremessar: a lança precisa ser CARREGADA (segura o botão, solta para lançar); as outras armas saem na hora.
    startThrow(p) {
      if (!p.weapon) return;
      if (WEAPONS[p.weapon.type].jav) { p.charging = true; p.chg = 0; p.fire = false; }
      else this.throwWeapon(p);
    }
    throwWeapon(p, charge = 0) {
      if (!p.weapon) return;
      const type = p.weapon.type, jav = !!WEAPONS[type].jav, a = p.angle;
      let sx = p.x + Math.cos(a) * 24, sy = p.y + Math.sin(a) * 24;
      if (!this.level.los(p.x, p.y, sx, sy)) { sx = p.x; sy = p.y; }
      const sp = (jav ? 900 + 600 * charge : 820) * throwFactor(type);   // alcance depende do peso da arma
      const it = this.addItem(type, sx, sy, Math.cos(a) * sp, Math.sin(a) * sp, p.weapon.ammo);
      it.thrown = true; it.owner = p.id; it.t = jav ? 0.45 + 0.45 * charge : 0.45; it.spin = jav ? 0 : 22; it.pow = charge;
      if (jav) it.rot = a;                       // a lança voa reta, com a ponta para frente
      p.weapon = null; p.charging = false; p.chg = 0; p.cd = Math.max(p.cd, 0.25);
      this.events.push({ t: 'throw', by: p.id, x: p.x, y: p.y });
    }

    tryDoors(p, dx, dy) {
      for (const d of this.level.doors) {
        if (!d.latched) continue;
        const rx = d.x * TILE, ry = d.y * TILE;
        const cx = Math.max(rx, Math.min(p.x, rx + TILE)), cy = Math.max(ry, Math.min(p.y, ry + TILE));
        if (Math.hypot(p.x - cx, p.y - cy) > PR + 2.5) continue;
        const vx = rx + TILE / 2 - p.x, vy = ry + TILE / 2 - p.y, l = Math.hypot(vx, vy) || 1;
        if ((dx * vx + dy * vy) / l < 0.35) continue;
        this.openDoor(d, p);
      }
    }
    // porta fechada que alguém empurra: destrava e recebe um chute para o lado oposto ao de quem empurrou
    openDoor(d, p, w = 6) {
      const cx = (d.x + 0.5) * TILE, cy = (d.y + 0.5) * TILE;
      const dir = d.o === 'h' ? (p.y < cy ? 1 : -1) : (p.x < cx ? 1 : -1);
      this.level.kickDoor(d, dir, w); d.by = p.id;
      this.events.push({ t: 'door', i: d.i, dir, x: cx, y: cy, hit: false });
    }
    doorBlocked(d) {   // tem alguém dentro do vão? então a porta não pode travar
      const rx = d.x * TILE, ry = d.y * TILE;
      for (const q of this.players) {
        if (!q || !q.alive) continue;
        const cx = clamp(q.x, rx, rx + TILE), cy = clamp(q.y, ry, ry + TILE);
        if (Math.hypot(q.x - cx, q.y - cy) < PR + 1) return true;
      }
      return false;
    }
    // Tiro numa porta destravada: empurra a folha (torque pelo componente do tiro perpendicular à porta). Não trava nem fecha de vez.
    shotDoor(d, b) {
      const e = this.level.doorEnd(d), dx = e[0] - d.hx, dy = e[1] - d.hy;
      const t = clamp(((b.x - d.hx) * dx + (b.y - d.hy) * dy) / (TILE * TILE), 0, 1);
      const tx = d.o === 'h' ? -dy / TILE : dy / TILE, ty = d.o === 'h' ? dx / TILE : -dx / TILE;   // sentido em que a porta gira com phi crescente
      const vt = b.vx * tx + b.vy * ty;                                    // velocidade do tiro no sentido do giro
      d.w = clamp(d.w + vt * 0.0035 * Math.max(0.3, t), -4.5, 4.5);        // longe da dobradiça = mais alavanca
      d.nl = 0.8;                                                          // por 0.8 s a porta não trava sozinha
      d.by = b.owner;
    }
    stepDoor(d, dt) {
      if (d.latched) return;
      const old = d.phi, L = this.level;
      L.stepDoor(d, dt);
      if (d.nl > 0) { d.nl -= dt; return; }   // acabou de levar tiro: segue balançando, sem travar
      const crossed = old * d.phi < 0, near = Math.abs(d.phi) < 0.1 && Math.abs(d.w) < 3.5;
      if (!crossed && !near) return;
      if (!this.doorBlocked(d)) {                 // chegou no batente: trava (e bate, se veio rápido)
        const v = Math.abs(d.w); L.setLatched(d, true);
        if (v > 1.5) this.events.push({ t: 'slam', i: d.i, x: (d.x + 0.5) * TILE, y: (d.y + 0.5) * TILE });
      } else if (crossed) { d.phi = 0; d.w = 0; }  // alguém no vão: a porta para no batente
    }
    // contato porta x jogador. Porta parada CEDE ao empurrão (e sai balançando); porta em velocidade EMPURRA e machuca quem estiver no caminho.
    doorContact(p, dt) {
      const L = this.level;
      if (!L || !p.alive) return;
      let touched = false;
      for (const d of L.doors) {
        if (d.latched) continue;
        for (let pass = 0; pass < 3; pass++) {
          const e = L.doorEnd(d), dx = e[0] - d.hx, dy = e[1] - d.hy;
          const t = clamp(((p.x - d.hx) * dx + (p.y - d.hy) * dy) / (TILE * TILE), 0, 1);
          const cx = d.hx + dx * t, cy = d.hy + dy * t, vx = p.x - cx, vy = p.y - cy, dist = Math.hypot(vx, vy);
          const pen = PR + DOOR_HT - dist;
          if (pen <= 0.05) break;
          touched = true;
          let nx, ny;
          if (dist > 1e-3) { nx = vx / dist; ny = vy / dist; } else { nx = -dy / TILE; ny = dx / TILE; }
          const rho = Math.max(t * TILE, 1);
          const tx = d.o === 'h' ? -dy / TILE : dy / TILE, ty = d.o === 'h' ? dx / TILE : -dx / TILE;   // sentido em que a porta gira com phi crescente
          const tn = tx * nx + ty * ny, vn = d.w * rho * tn;     // vn > 0: a porta está vindo contra o jogador
          if (vn > 60) {
            p.x += nx * pen; p.y += ny * pen;
            if (vn > 110 && p.dcd <= 0 && !p.down && d.by !== p.id && this.phase === 'live') {   // não machuca quem mexeu na porta por último
              p.dcd = 0.6;
              const by = d.by && d.by !== p.id ? this.byId(d.by) : null, da = Math.atan2(ny, nx);
              if (DOOR_DMG > 0) this.hurt(p, by, DOOR_DMG, 'door', da);
              this.knockdown(p, DOWN_TIME, da);      // porta na cara = atordoado no chão
              this.events.push({ t: 'door', i: d.i, dir: 0, x: p.x, y: p.y, hit: true });
            }
            if (d.by !== p.id) d.w *= 0.8;          // quem fechou a porta não a freia contra si mesmo
          } else if (Math.abs(tn) > 0.25 && rho > 8) {
            const dphi = clamp(-pen / (rho * tn), -0.6, 0.6);
            const np = clamp(d.phi + dphi, -DOOR_LIM, DOOR_LIM), real = np - d.phi;
            d.phi = np; if (dt > 0) d.w = clamp(real / dt * 0.85, -8, 8);
            d.by = p.id;
            if (Math.abs(real) < 1e-4) { p.x += nx * pen; p.y += ny * pen; }   // porta no limite: funciona como parede
          } else { p.x += nx * pen; p.y += ny * pen; }
        }
      }
      if (touched) L.push(p, PR);
    }

    updateBullets(dt) {
      const out = [];
      for (const b of this.bullets) {
        const sp = Math.hypot(b.vx, b.vy), n = Math.max(1, Math.ceil(sp * dt / 6));
        let dead = false;
        for (let s = 0; s < n && !dead; s++) {
          const px = b.x, py = b.y;
          b.x += b.vx * dt / n; b.y += b.vy * dt / n;
          {   // porta fechada (parada) levando tiro: destrava e abre um pouco para o lado oposto ao de quem atirou
            const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
            const ld = this.level.doors.find(d => d.latched && d.x === tx && d.y === ty);
            if (ld) {
              const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
              const dir = ld.o === 'h' ? (py < cy ? 1 : -1) : (px < cx ? 1 : -1);
              this.level.kickDoor(ld, dir, 2.5); ld.nl = 0.8; ld.by = b.owner;
              this.events.push({ t: 'door', i: ld.i, dir, x: cx, y: cy, hit: false });
            }
          }
          if (this.level.solidAt(b.x, b.y)) { dead = true; this.events.push({ t: 'wall', x: px, y: py, a: Math.atan2(b.vy, b.vx) }); break; }
          { const dh = this.level.doorHit(b.x, b.y, 1.5); if (dh) this.shotDoor(dh, b); }
          if (this.level.doorAt(b.x, b.y, 1.5)) { dead = true; this.events.push({ t: 'wall', x: px, y: py, a: Math.atan2(b.vy, b.vx) }); break; }   // porta destravada também barra tiro
          for (const p of this.players) {
            if (!p || !p.alive || p.id === b.owner) continue;
            if (segDist(p.x, p.y, px, py, b.x, b.y) < PR) { dead = true; this.hurt(p, this.byId(b.owner), WEAPONS[b.w].dmg, 'bullet', Math.atan2(b.vy, b.vx)); break; }
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
            {   // arma arremessada bate na porta: porta fechada destrava e abre; porta solta leva um empurrão (mais pesada = empurra mais)
              const wgt = WEIGHT[it.type] || 1, tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
              const ld = this.level.doors.find(d => d.latched && d.x === tx && d.y === ty);
              if (ld) {
                const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE, dir = ld.o === 'h' ? (it.y < cy ? 1 : -1) : (it.x < cx ? 1 : -1);
                this.level.kickDoor(ld, dir, Math.min(8, 3.5 + wgt * 0.7)); ld.nl = 0.8; ld.by = it.owner;
                this.events.push({ t: 'door', i: ld.i, dir, x: cx, y: cy, hit: false });
                stop = true; it.vx *= -0.15; it.vy *= -0.15; break;
              }
              const dh = this.level.doorHit(nx, ny, 3);
              if (dh) { const m = 0.6 + wgt * 0.3; this.shotDoor(dh, { x: nx, y: ny, vx: it.vx * m, vy: it.vy * m, owner: it.owner }); this.events.push({ t: 'door', i: dh.i, dir: 0, x: nx, y: ny, hit: false }); }
            }
            if (this.level.solidAt(nx, ny) || this.level.doorAt(nx, ny, 3)) { stop = true; it.vx *= -0.15; it.vy *= -0.15; break; }
            it.x = nx; it.y = ny;
            for (const p of this.players) {
              if (!p || !p.alive || p.id === it.owner) continue;
              if (Math.hypot(p.x - it.x, p.y - it.y) < PR + 10) {
                const wd = WEAPONS[it.type], ang = Math.atan2(it.vy, it.vx);
                let pct = THROW_DMG, how = 'throw', bl = 0, cb = 0, pw = 0;
                if (wd.blade) {                       // pontiaguda arremessada: sorte decide se acerta a LÂMINA (morte) ou o CABO (pancada comum)
                  if (Math.random() < BLADE_CHANCE) {
                    if (BLADE_KILL[it.type]) { pct = 100; how = 'blade'; bl = 1; }       // só a machete é hit kill
                    else pct = BLADE_DMG[it.type] || THROW_DMG;                           // faca/katana: lâmina machuca, não mata na hora
                  } else cb = 1;
                } else if (wd.jav) {                  // lança: dano cresce com o tempo que o jogador segurou
                  pct = Math.round(SPEAR_THROW_MIN + (SPEAR_THROW_MAX - SPEAR_THROW_MIN) * (it.pow || 0)); how = 'spear'; pw = pct;
                }
                this.hurt(p, this.byId(it.owner), pct, how, ang);
                { const td = it.type in THROW_DOWN ? THROW_DOWN[it.type] : 1; if (!bl && td > 0 && p.alive && !p.down) this.knockdown(p, td, ang); }
                this.events.push({ t: 'thit', x: it.x, y: it.y, bl, cb, pw });
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
        map: this.level ? this.level.id : null, win: this.winner, host: this.hostId(),
        pl: this.players.filter(Boolean).map(p => ({
          id: p.id, sl: p.slot, nm: p.name, sk: p.skin, cl: p.color, sc: p.score, x: r1(p.x), y: r1(p.y), a: Math.round(p.angle * 100) / 100,
          hp: Math.round(p.hp), hz: +Math.max(0, p.healT).toFixed(2), al: p.alive ? 1 : 0, dn: p.down ? 1 : 0, dt: +Math.max(0, p.downT).toFixed(2),
          w: p.weapon ? p.weapon.type : 0, am: p.weapon ? p.weapon.ammo : 0, se: p.sel, iv: p.inv.map(x => x ? [x.type, x.ammo] : 0), bot: p.bot ? 1 : 0, ch: p.charging ? +(p.chg / SPEAR_CHARGE).toFixed(2) : -1
        })),
        b: this.bullets.map(b => [b.id, r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), (this.byId(b.owner) || { slot: -1 }).slot]),   // [5] = slot de quem atirou (o cliente usa para não duplicar o tiro previsto)
        it: this.items.map(i => [i.id, r1(i.x), r1(i.y), i.type, i.ammo, Math.round(i.rot * 100) / 100, i.thrown ? 1 : 0]),
        dr: this.level ? this.level.doors.filter(d => !d.latched).map(d => [d.i, Math.round(d.phi * 1000) / 1000, Math.round(d.w * 100) / 100]) : [],
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
        if (prev[k] >= 0 || L.g[ny][nx] === 1 || L.g[ny][nx] === 3) continue;
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
      this.st = 1; this.stT = 0; this.pkCd = 0; this.thCd = 0; this.hlCd = 0; this.swCd = 0;
    }
    think(dt) {
      const g = this.g, me = g.players[this.slot];
      if (!me) return;
      // alvo: o adversário vivo mais próximo (se não houver vivo, o mais próximo qualquer)
      let en = null, bestD = Infinity;
      for (const q of g.players) {
        if (!q || q === me) continue;
        const dd = Math.hypot(q.x - me.x, q.y - me.y) + (q.alive ? 0 : 1e6);
        if (dd < bestD) { bestD = dd; en = q; }
      }
      if (!en) return;
      const idle = { k: 0, a: this.ang, f: 0, fp: 0, pk: 0, th: 0 };
      if (g.phase !== 'live' || !me.alive || me.down || !g.level) { g.applyInput(me, idle, dt); return; }
      const L = g.level, D = this.d, T = TILE;
      const dx = en.x - me.x, dy = en.y - me.y, dist = Math.hypot(dx, dy) || 1;
      const los = en.alive && L.los(me.x, me.y, en.x, en.y);
      this.seen = los ? this.seen + dt : 0;
      this.noiseT -= dt; if (this.noiseT <= 0) { this.noiseT = 0.4; this.noise = (Math.random() - 0.5) * D.acc * 2; }
      this.stT -= dt; if (this.stT <= 0) { this.stT = 0.5 + Math.random() * 1.2; this.st = Math.random() < 0.5 ? -1 : 1; }
      this.pkCd -= dt; this.thCd -= dt; this.hlCd -= dt; this.swCd -= dt;

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
          pref = { SHOTGUN: 190, PISTOL: 330, REVOLVER: 350, SNIPER: 650, MINIGUN: 320, SMG: 260 }[me.weapon.type] || 290;
          if (dist < pref * 0.6) { approach = false; back = 1; }
          else if (dist < pref * 1.3) { approach = false; strafe = 1; }
          if (this.seen > D.react && err < 0.1) { if (wd.auto) fire = 1; else if (me.cd <= 0) fp = 1; }
        } else if (los && dist < wd.range + PR + 4 && err < 0.7 && me.cd <= 0 && this.seen > D.react * 0.5) fp = 1;
      }
      const alt = me.inv[1 - me.sel];
      let sw = 0;
      if (emptyGun && alt && this.swCd <= 0) { sw = 1; this.swCd = 0.6; }   // pente vazio: saca a outra arma
      else if (emptyGun && !alt && los && dist < 400 && !en.down && this.thCd <= 0 && err < 0.2) { th = 1; this.thCd = 1; }

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
      // bot se cura quando a vida baixa de 40%, sem inimigo à vista e com intervalo entre curas
      const hl = me.hp <= MAX_HP * 0.4 && !los && this.hlCd <= 0 ? 1 : 0;
      if (hl) this.hlCd = 6;
      g.applyInput(me, { k, a: this.ang, f: fire, fp, pk, th, hl, sw }, dt);
    }
  }

  return { TILE, PR, CS, SPEED, WIN_SCORE, DOWN_TIME, MAX_HP, HEAL_PCT, HEAL_TIME, HEAL_SLOW, WATER_SLOW, BLADE_CHANCE, WEIGHT, throwFactor, SPEAR_CHARGE, SPEAR_THROW_MIN, SPEAR_THROW_MAX, DOOR_HT, DOOR_LIM, MAX_PLAYERS, MIN_PLAYERS, randomColor, WEAPONS, itemDist, PICK_R, MAPS, MAP_IDS, Level, Game, Bot, stepMove, canMove, angDiff };
});
