'use strict';
/* ==========================================================================
   7 SHADOWS — controles de toque (celular / tablet)
   Esquerda: joystick de movimento · Direita: stick de mira (empurrar = atirar)
   Botões: rasteira, pegar, jogar, curar, trocar arma · slots do inventário tocáveis
   Usa as variáveis globais do game.js (keys, mouse, edge, pred, cam, Z, W, H…).
   ========================================================================== */
(() => {
  if (typeof IS_TOUCH === 'undefined' || !IS_TOUCH) return;
  document.body.classList.add('touch');

  const mk = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const R = 58;            // raio do stick (px)
  const DEAD = 0.22;       // zona morta do movimento
  const FIRE = 0.5;        // quanto empurrar o stick de mira para atirar

  /* ------------------------------------------------------------- DOM */
  const tc = mk('div', null, document.body); tc.id = 'tc';
  const zoneL = mk('div', 'tc-zone', tc), zoneR = mk('div', 'tc-zone', tc);
  zoneL.id = 'tcL'; zoneR.id = 'tcR';
  const ghostL = mk('div', 'tc-ghost', tc, '<i></i>'), ghostR = mk('div', 'tc-ghost aim', tc, '<i></i>');
  ghostL.id = 'tcGL'; ghostR.id = 'tcGR';
  const baseL = mk('div', 'tc-base', tc, '<i></i>'), baseR = mk('div', 'tc-base aim', tc, '<i></i>');
  const knobL = baseL.firstChild, knobR = baseR.firstChild;
  const btns = mk('div', 'tc-btns', tc);
  const top = mk('div', 'tc-top', tc);
  const rot = mk('div', null, document.body, '<div><b>GIRE O CELULAR</b><small>O jogo é na horizontal</small></div>'); rot.id = 'tcRot';

  const holds = {};   // botões segurados: id -> true
  function button(id, label, cls, down, up) {
    const b = mk('button', 'tc-btn ' + (cls || ''), btns, '<span>' + label + '</span>'); b.type = 'button'; b.dataset.id = id;
    const press = e => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch { } b.classList.add('on'); holds[id] = e.pointerId; initAudio(); down && down(); };
    const release = e => { if (holds[id] == null) return; e.preventDefault(); delete holds[id]; b.classList.remove('on'); up && up(); };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
    return b;
  }
  button('sl', 'RASTEIRA', 'big', () => { edge.sl = true; });
  button('th', 'JOGAR', '', () => { edge.th = true; keys.f = true; }, () => { keys.f = false; });
  button('pk', 'PEGAR', '', () => { edge.pk = true; });
  button('hl', 'CURAR', '', () => { edge.hl = true; });
  button('sw', 'TROCAR', '', () => { edge.sw = true; });
  const bLock = button('lk', 'MIRA', 'lock', () => { keys.c = true; }, () => { keys.c = false; });   // Dragão Dourado: travar mira

  // pausa e tela cheia
  const bPause = mk('button', 'tc-sys', top, '<b>II</b>'); bPause.type = 'button'; bPause.setAttribute('aria-label', 'Pausar');
  bPause.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); setPaused(true); });
  const canFs = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (canFs && !navigator.standalone) {
    const bFs = mk('button', 'tc-sys', top, '<b>⛶</b>'); bFs.type = 'button'; bFs.setAttribute('aria-label', 'Tela cheia');
    bFs.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const d = document, el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
      Promise.resolve(p).then(() => { try { screen.orientation.lock('landscape'); } catch { } }).catch(() => { });
    });
  }

  /* --------------------------------------------------------- STICKS */
  const L = { id: null, ox: 0, oy: 0 };                         // movimento
  const A = { id: null, ox: 0, oy: 0, firing: false, t0: 0, moved: 0 };   // mira
  let tAim = null;                                              // ângulo de mira atual (rad)
  let tapUntil = 0;

  const place = (base, x, y) => { base.style.transform = `translate(${x}px,${y}px)`; base.classList.add('on'); };
  const knob = (k, dx, dy) => { k.style.transform = `translate(${dx}px,${dy}px)`; };

  function setMove(nx, ny) {
    const m = Math.hypot(nx, ny);
    if (m < DEAD) { keys.w = keys.a = keys.s = keys.d = false; return; }
    keys.d = nx > 0.38; keys.a = nx < -0.38; keys.s = ny > 0.38; keys.w = ny < -0.38;
    if (!(keys.w || keys.a || keys.s || keys.d)) { if (Math.abs(nx) > Math.abs(ny)) { keys.d = nx > 0; keys.a = nx < 0; } else { keys.s = ny > 0; keys.w = ny < 0; } }
    if (A.id == null) tAim = Math.atan2(ny, nx);   // sem mirar: o personagem olha para onde anda
  }
  function endMove() { L.id = null; baseL.classList.remove('on'); ghostL.style.opacity = ''; keys.w = keys.a = keys.s = keys.d = false; }

  zoneL.addEventListener('pointerdown', e => {
    if (L.id != null) return; e.preventDefault(); initAudio();
    L.id = e.pointerId; L.ox = e.clientX; L.oy = e.clientY; try { zoneL.setPointerCapture(e.pointerId); } catch { }
    place(baseL, L.ox, L.oy); knob(knobL, 0, 0); ghostL.style.opacity = '0';
  });
  zoneL.addEventListener('pointermove', e => {
    if (e.pointerId !== L.id) return; e.preventDefault();
    let dx = e.clientX - L.ox, dy = e.clientY - L.oy, d = Math.hypot(dx, dy);
    if (d > R * 1.5) { const k = (d - R * 1.5) / d; L.ox += dx * k; L.oy += dy * k; place(baseL, L.ox, L.oy); dx = e.clientX - L.ox; dy = e.clientY - L.oy; d = Math.hypot(dx, dy); }   // a base acompanha o dedo
    const c = d > R ? R / d : 1; knob(knobL, dx * c, dy * c);
    setMove(dx / R, dy / R);
  });
  const upL = e => { if (e.pointerId === L.id) endMove(); };
  zoneL.addEventListener('pointerup', upL); zoneL.addEventListener('pointercancel', upL);

  function endAim() {
    if (A.id == null) return;
    const quick = performance.now() - A.t0 < 220 && A.moved < 14;
    A.id = null; baseR.classList.remove('on'); baseR.classList.remove('fire'); ghostR.style.opacity = '';
    mouse.down = false; A.firing = false;
    if (quick && !canSpec()) { edge.fp = true; mouse.down = true; tapUntil = performance.now() + 90; }   // toque rápido = um tiro/golpe para onde olha
  }
  zoneR.addEventListener('pointerdown', e => {
    if (A.id != null) return; e.preventDefault(); initAudio();
    if (canSpec()) { specStep(1); return; }    // espectando: toque troca de jogador
    A.id = e.pointerId; A.ox = e.clientX; A.oy = e.clientY; A.t0 = performance.now(); A.moved = 0; A.firing = false;
    try { zoneR.setPointerCapture(e.pointerId); } catch { }
    place(baseR, A.ox, A.oy); knob(knobR, 0, 0); ghostR.style.opacity = '0';
  });
  zoneR.addEventListener('pointermove', e => {
    if (e.pointerId !== A.id) return; e.preventDefault();
    let dx = e.clientX - A.ox, dy = e.clientY - A.oy, d = Math.hypot(dx, dy);
    A.moved = Math.max(A.moved, d);
    if (d > R * 1.5) { const k = (d - R * 1.5) / d; A.ox += dx * k; A.oy += dy * k; place(baseR, A.ox, A.oy); dx = e.clientX - A.ox; dy = e.clientY - A.oy; d = Math.hypot(dx, dy); }
    const c = d > R ? R / d : 1; knob(knobR, dx * c, dy * c);
    if (d > 8) tAim = Math.atan2(dy, dx);
    const fire = d / R >= FIRE;
    if (fire && !A.firing) { A.firing = true; mouse.down = true; edge.fp = true; }
    else if (!fire && A.firing) { A.firing = false; mouse.down = false; }
    baseR.classList.toggle('fire', fire);
  });
  const upR = e => { if (e.pointerId === A.id) endAim(); };
  zoneR.addEventListener('pointerup', upR); zoneR.addEventListener('pointercancel', upR);

  /* ----------------------------------------- slots do inventário (toque) */
  for (const [i, n] of [[0, 1], [1, 2]]) {
    const s = $('slot' + i);
    s.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); edge.ss = n; });
  }

  /* ------------------------------------------------ textos para toque */
  const skip = $('introSkip'); if (skip) skip.innerHTML = 'Toque para pular';
  const sh = document.querySelector('#spectate .sh'); if (sh) sh.textContent = 'toque p/ trocar';

  /* ----------------------------------- aplica a mira + mostra/esconde */
  let wasOn = false;
  function releaseAll() {
    endMove(); if (A.id != null) { A.id = null; baseR.classList.remove('on'); ghostR.style.opacity = ''; }
    A.firing = false; mouse.down = false; keys.f = false; keys.c = false;
    for (const k in holds) delete holds[k];
    tc.querySelectorAll('.tc-btn.on').forEach(b => b.classList.remove('on'));
  }
  function loop(now) {
    requestAnimationFrame(loop);
    const hud = $('hud');
    const inGame = !!mode && $('menu').classList.contains('hidden') && $('opts').classList.contains('hidden');
    const portrait = innerHeight > innerWidth;
    document.body.classList.toggle('tcRot', inGame && portrait);
    if (inGame && portrait && !paused) setPaused(true);
    const on = inGame && !paused && !hud.classList.contains('hidden') && !hud.classList.contains('inlobby') && !portrait;
    if (on !== wasOn) { wasOn = on; tc.classList.toggle('on', on); if (!on) releaseAll(); }
    document.body.classList.toggle('tcPlay', on);
    if (!on) return;
    bLock.classList.toggle('hidden', !isDragon());
    if (tapUntil && now > tapUntil) { tapUntil = 0; if (A.id == null) mouse.down = false; }
    if (tAim != null) {   // transforma o ângulo do stick numa posição de "mouse" ao redor do personagem
      const px = W / 2 + (pred.x - cam.x) * Z, py = H / 2 + (pred.y - cam.y) * Z;
      mouse.x = px + Math.cos(tAim) * 220; mouse.y = py + Math.sin(tAim) * 220;
    }
  }
  requestAnimationFrame(loop);

  /* ---------------------------------------- evita gestos do navegador */
  const stop = e => { if (document.body.classList.contains('tcPlay')) e.preventDefault(); };
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); if (mode && !paused) setPaused(true); } });
})();
