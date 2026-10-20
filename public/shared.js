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
  const MAX_PLAYERS = 7;   // máximo de jogadores na sala
  const MIN_PLAYERS = 2;   // a partida começa com 2 ou mais

  /* ===== VIDA E DANO (tudo em % da vida máxima) ===== */
  const MAX_HP = 5000;     // vida máxima = 100%
  const EXEC_MULT = 3;     // multiplicador do golpe corpo a corpo em quem está caído no chão
  const THROW_DMG = 10;    // % tirado por arma arremessada que acerta
  const DOOR_DMG = 10;     // % tirado por porta na cara
  const HEAL_PCT = 20;     // % da vida máxima que a cura devolve
  const HEAL_TIME = 2;     // segundos parado (e invulnerável) enquanto cura; a cura é ilimitada

  /* ---------------------------------------------------------------- ARMAS */
  const WEAPONS = {
    FISTS:   { name: 'MÃOS',    dmg: 5,  melee: true, range: 34, arc: 1.8, cd: 0.40, col: '#ffd7b0' },
    KNIFE:   { name: 'FACA',    dmg: 40, melee: true, range: 42, arc: 1.5, cd: 0.26, col: '#e6f1ff' },
    BAT:     { name: 'TACO',    dmg: 50, melee: true, range: 60, arc: 2.1, cd: 0.50, col: '#ffb35c' },
    KATANA:  { name: 'KATANA',  dmg: 70, melee: true, range: 70, arc: 2.3, cd: 0.40, col: '#9ff7ff' },
    PISTOL:  { name: 'PISTOLA', dmg: 35, ammo: 9,  cd: 0.27,  spread: 0.03, speed: 1150, pellets: 1, range: 1100, auto: false, col: '#6bf4ff' },
    SMG:     { name: 'SMG',     dmg: 12, ammo: 30, cd: 0.085, spread: 0.11, speed: 1100, pellets: 1, range: 900,  auto: true,  col: '#ff8ad8' },
    RIFLE:   { name: 'FUZIL',   dmg: 25, ammo: 24, cd: 0.15,  spread: 0.04, speed: 1400, pellets: 1, range: 1600, auto: true,  col: '#b9ff79' },
    SHOTGUN: { name: 'SHOTGUN', dmg: 15, ammo: 6,  cd: 0.80,  spread: 0.30, speed: 980,  pellets: 7, range: 440,  auto: false, col: '#ffc96b' }
  };
  const POOLS = {
    M: ['KNIFE', 'BAT', 'KATANA'],
    G: ['PISTOL', 'SMG', 'SHOTGUN'],
    R: ['KNIFE', 'BAT', 'KATANA', 'PISTOL', 'SMG', 'SHOTGUN', 'RIFLE']
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
