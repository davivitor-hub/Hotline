'use strict';
/* ==========================================================================
   7 SHADOWS — controles de toque (celular / tablet)
   Esquerda: analógico de movimento · Direita: analógico de mira (empurrar = atirar)
   A MIRA só muda com o analógico direito: andar não mexe nela.
   Botões: ativa, pegar, jogar, curar, trocar arma · slots do inventário tocáveis
   Tela "Ajustar controles": arrastar cada controle, tamanho, opacidade e analógico fixo/flutuante.
   Usa as variáveis globais do game.js (keys, mouse, edge, pred, cam, Z, W, H, cfg…).
   ========================================================================== */
(() => {
  if (typeof IS_TOUCH === 'undefined' || !IS_TOUCH) return;
  document.body.classList.add('touch');

  const mk = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const BASE_R = 58;       // raio do analógico no tamanho 100% (px)
  const DEAD = 0.22;       // zona morta do movimento
  const FIRE = 0.5;        // quanto empurrar o analógico de mira para atirar
  const SZ_MIN = 0.5, SZ_MAX = 2;

  /* controles que podem ser ajustados: sticks são círculos de 116 px; botões têm w x h (px) no tamanho 100% */
  const ITEMS = [
    { id: 'mv',  name: 'MOVER',        label: 'MOVER',    stick: true },
    { id: 'aim', name: 'MIRAR / ATIRAR', label: 'MIRAR',  stick: true, aim: true },
    { id: 'sl',  name: 'ATIVA',        label: 'ATIVA',    w: 96,  h: 56, fs: 0.78 },
    { id: 'th',  name: 'JOGAR',        label: 'JOGAR',    w: 56,  h: 56, fs: 0.62 },
    { id: 'pk',  name: 'PEGAR',        label: 'PEGAR',    w: 56,  h: 56, fs: 0.62 },
    { id: 'hl',  name: 'CURAR',        label: 'CURAR',    w: 56,  h: 56, fs: 0.62 },
    { id: 'sw',  name: 'TROCAR ARMA',  label: 'TROCAR',   w: 56,  h: 56, fs: 0.62 }
  ];
  const itemOf = id => ITEMS.find(i => i.id === id);
  // u = escala padrão da tela (celular pequeno ~0.85, celular grande ~1, tablet/PC até 1.6); s = ajuste do jogador (100% = padrão da tela)
  const uScale = () => Math.max(0.85, Math.min(1.6, Math.min(innerWidth, innerHeight * 1.9) / 760));
  const half = (it, s) => { const k = s * uScale(); return it.stick ? [BASE_R * k, BASE_R * k] : [it.w * k / 2, it.h * k / 2]; };

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

  // sonda: lê as áreas seguras (notch) em px
  const probe = mk('div', null, document.body);
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;padding:var(--st) var(--sr) var(--sb) var(--sl)';
  const insets = () => { const s = getComputedStyle(probe); return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 }; };

  const holds = {};   // botões segurados: id -> pointerId
  const nodes = {};   // botões reais: id -> elemento
  function button(id, label, cls, down, up) {
    const b = mk('button', 'tc-btn ' + (cls || ''), btns, '<span>' + label + '</span>'); b.type = 'button'; b.dataset.id = id;
    const press = e => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch { } b.classList.add('on'); holds[id] = e.pointerId; initAudio(); down && down(); };
    const release = e => { if (holds[id] == null) return; e.preventDefault(); delete holds[id]; b.classList.remove('on'); up && up(); };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
    nodes[id] = b;
    return b;
  }
  const ACT = {
    sl: [() => { edge.sl = true; }],
    th: [() => { edge.th = true; keys.f = true; }, () => { keys.f = false; }],
    pk: [() => { edge.pk = true; }],
    hl: [() => { edge.hl = true; }],
    sw: [() => { edge.sw = true; }]
  };
  for (const it of ITEMS) if (!it.stick) button(it.id, it.label, '', ...ACT[it.id]);

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

  /* ---------------------------------------------------- LAYOUT SALVO
     Cada controle guarda o centro como fração da tela (x, y: 0..1) e um fator de tamanho (s).
     Só o que o jogador mudou é salvo; o resto segue o padrão (ancorado nas bordas). */
  function defaults() {
    const W_ = innerWidth, H_ = innerHeight, n = insets(), u = uScale(), m = 10 * u, g = 8 * u, b = 56 * u;
    const rx = W_ - n.r - m, by = H_ - n.b - m, c1 = rx - b / 2, c0 = c1 - b - g, cb = rx - 60 * u;
    const y1 = by - b / 2, y2 = y1 - (b + g), y3 = y2 - (b + g);
    const px = {
      mv: [n.l + 112 * u, H_ - n.b - 146 * u], aim: [W_ - n.r - 226 * u, H_ - n.b - 146 * u],
      hl: [c0, y1], sw: [c1, y1],
      th: [c0, y2], pk: [c1, y2],
      sl: [cb, y3]
    };
    const d = {};
    for (const id in px) d[id] = { x: px[id][0] / W_, y: px[id][1] / H_, s: 1 };
    return d;
  }
  function layout() {
    const d = defaults(), t = (cfg.touch && typeof cfg.touch === 'object') ? cfg.touch : {}, it = (t.it && typeof t.it === 'object') ? t.it : {};
    const out = { op: clampN(t.op, 0.3, 1, 1), fixed: t.fixed === undefined ? true : !!t.fixed, it: {} };   // analógicos travados no lugar por padrão
    for (const id in d) {
      const o = it[id];
      out.it[id] = (o && Number.isFinite(+o.x) && Number.isFinite(+o.y))
        ? { x: clampN(o.x, 0, 1, d[id].x), y: clampN(o.y, 0, 1, d[id].y), s: clampN(o.s, SZ_MIN, SZ_MAX, 1) }
        : d[id];
    }
    return out;
  }

  /* ----------------------------------------------- APLICA O LAYOUT */
  const home = {};          // centro (px) e escala de cada analógico: home.mv / home.aim
  let fixedMode = false, specNow = false;
  const rad = id => BASE_R * (home[id] ? home[id].k : 1);
  function applyZones() {
    for (const [z, id] of [[zoneL, 'mv'], [zoneR, 'aim']]) {
      const h = home[id];
      if (fixedMode && h && !(id === 'aim' && specNow)) {   // fixo: só toca na área em volta do analógico (espectando: a metade toda troca de jogador)
        const r = BASE_R * h.k * 1.7;
        Object.assign(z.style, { left: (h.x - r) + 'px', top: (h.y - r) + 'px', width: (r * 2) + 'px', height: (r * 2) + 'px', right: 'auto', bottom: 'auto', borderRadius: '50%' });
      } else for (const p of ['left', 'top', 'width', 'height', 'right', 'bottom', 'borderRadius']) z.style[p] = '';
    }
  }
  function applyLayout() {
    const Lt = layout(), W_ = innerWidth, H_ = innerHeight, u = uScale();
    tc.style.setProperty('--op', Lt.op);
    fixedMode = Lt.fixed;
    for (const it of ITEMS) {
      const v = Lt.it[it.id], x = v.x * W_, y = v.y * H_, k = v.s * u;
      if (it.stick) {
        const g = it.id === 'mv' ? ghostL : ghostR, b = it.id === 'mv' ? baseL : baseR;
        g.style.setProperty('--k', k); b.style.setProperty('--k', k);
        g.style.transform = `translate(${x}px,${y}px)`;
        home[it.id] = { x, y, k };
      } else {
        const b = nodes[it.id];
        b.style.left = x + 'px'; b.style.top = y + 'px';
        b.style.width = (it.w * k) + 'px'; b.style.height = (it.h * k) + 'px'; b.style.fontSize = (it.fs * k) + 'rem';
      }
    }
    applyZones();
  }

  /* --------------------------------------------------------- STICKS */
  const L = { id: null, ox: 0, oy: 0 };                                           // movimento
  const A = { id: null, ox: 0, oy: 0, sx: 0, sy: 0, firing: false, t0: 0, moved: 0 };   // mira
  let tAim = null;      // ângulo de mira (rad): só o analógico direito muda
  let tapUntil = 0, lastRd = -2;

  const place = (base, x, y) => { base.style.transform = `translate(${x}px,${y}px)`; base.classList.add('on'); };
  const knob = (k, dx, dy) => { k.style.transform = `translate(${dx}px,${dy}px)`; };

  function setMove(nx, ny) {
    const m = Math.hypot(nx, ny);
    if (m < DEAD) { keys.w = keys.a = keys.s = keys.d = false; return; }
    keys.d = nx > 0.38; keys.a = nx < -0.38; keys.s = ny > 0.38; keys.w = ny < -0.38;
    if (!(keys.w || keys.a || keys.s || keys.d)) { if (Math.abs(nx) > Math.abs(ny)) { keys.d = nx > 0; keys.a = nx < 0; } else { keys.s = ny > 0; keys.w = ny < 0; } }
    // a mira NÃO acompanha mais o movimento: só o analógico direito mexe nela
  }
  function endMove() { L.id = null; baseL.classList.remove('on'); ghostL.style.opacity = ''; keys.w = keys.a = keys.s = keys.d = false; }

  function moveL(e) {
    const R = rad('mv');
    let dx = e.clientX - L.ox, dy = e.clientY - L.oy, d = Math.hypot(dx, dy);
    if (!fixedMode && d > R * 1.5) { const k = (d - R * 1.5) / d; L.ox += dx * k; L.oy += dy * k; place(baseL, L.ox, L.oy); dx = e.clientX - L.ox; dy = e.clientY - L.oy; d = Math.hypot(dx, dy); }   // flutuante: a base acompanha o dedo
    const c = d > R ? R / d : 1; knob(knobL, dx * c, dy * c);
    setMove(dx / R, dy / R);
  }
  zoneL.addEventListener('pointerdown', e => {
    if (L.id != null) return; e.preventDefault(); initAudio();
    L.id = e.pointerId; try { zoneL.setPointerCapture(e.pointerId); } catch { }
    if (fixedMode && home.mv) { L.ox = home.mv.x; L.oy = home.mv.y; } else { L.ox = e.clientX; L.oy = e.clientY; }
    place(baseL, L.ox, L.oy); knob(knobL, 0, 0); ghostL.style.opacity = '0';
    if (fixedMode) moveL(e);
  });
  zoneL.addEventListener('pointermove', e => { if (e.pointerId !== L.id) return; e.preventDefault(); moveL(e); });
  const upL = e => { if (e.pointerId === L.id) endMove(); };
  zoneL.addEventListener('pointerup', upL); zoneL.addEventListener('pointercancel', upL);

  function endAim() {
    if (A.id == null) return;
    const quick = performance.now() - A.t0 < 220 && A.moved < 14;
    A.id = null; baseR.classList.remove('on'); baseR.classList.remove('fire'); ghostR.style.opacity = '';
    mouse.down = false; A.firing = false;
    if (quick && !canSpec()) { edge.fp = true; mouse.down = true; tapUntil = performance.now() + 90; }   // toque rápido = um tiro/golpe para onde olha
  }
  function moveA(e) {
    const R = rad('aim');
    let dx = e.clientX - A.ox, dy = e.clientY - A.oy, d = Math.hypot(dx, dy);
    A.moved = Math.max(A.moved, Math.hypot(e.clientX - A.sx, e.clientY - A.sy));
    if (!fixedMode && d > R * 1.5) { const k = (d - R * 1.5) / d; A.ox += dx * k; A.oy += dy * k; place(baseR, A.ox, A.oy); dx = e.clientX - A.ox; dy = e.clientY - A.oy; d = Math.hypot(dx, dy); }
    const c = d > R ? R / d : 1; knob(knobR, dx * c, dy * c);
    if (d > 8) tAim = Math.atan2(dy, dx);
    const fire = d / R >= FIRE;
    if (fire && !A.firing) { A.firing = true; mouse.down = true; edge.fp = true; }
    else if (!fire && A.firing) { A.firing = false; mouse.down = false; }
    baseR.classList.toggle('fire', fire);
  }
  zoneR.addEventListener('pointerdown', e => {
    if (A.id != null) return; e.preventDefault(); initAudio();
    if (canSpec()) { specStep(1); return; }    // espectando: toque troca de jogador
    A.id = e.pointerId; A.sx = e.clientX; A.sy = e.clientY; A.t0 = performance.now(); A.moved = 0; A.firing = false;
    try { zoneR.setPointerCapture(e.pointerId); } catch { }
    if (fixedMode && home.aim) { A.ox = home.aim.x; A.oy = home.aim.y; } else { A.ox = e.clientX; A.oy = e.clientY; }
    place(baseR, A.ox, A.oy); knob(knobR, 0, 0); ghostR.style.opacity = '0';
    if (fixedMode) moveA(e);
  });
  zoneR.addEventListener('pointermove', e => { if (e.pointerId !== A.id) return; e.preventDefault(); moveA(e); });
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

  /* ====================================================================
     TELA "AJUSTAR CONTROLES"
     ==================================================================== */
  const ed = mk('div', 'hidden', document.body);
  ed.id = 'tcEdit';
  ed.innerHTML =
    '<div class="te-grid"></div><div class="te-stage"></div>' +
    '<div class="te-bar">' +
      '<div class="te-row"><b id="teName"></b><input id="teSize" type="range" min="50" max="200" step="5" aria-label="Tamanho"><output id="teSizeV"></output></div>' +
      '<div class="te-row"><span>OPACIDADE</span><input id="teOp" type="range" min="30" max="100" step="5" aria-label="Opacidade"><output id="teOpV"></output></div>' +
      '<label class="te-chk"><input id="teFixed" type="checkbox"> TRAVAR ANALÓGICOS NO LUGAR</label>' +
      '<div class="te-acts"><button id="teReset" type="button">PADRÃO</button><button id="teCancel" type="button">CANCELAR</button><button id="teSave" type="button" class="pri">SALVAR</button></div>' +
    '</div>' +
    '<div class="te-hint">Arraste os controles · toque num para mudar o tamanho</div>' +
    '<div class="te-rot"><div><b>GIRE O CELULAR</b><small>Ajuste os controles na horizontal</small><button id="teBack" type="button">Voltar</button></div></div>';
  const stage = ed.querySelector('.te-stage'), bar = ed.querySelector('.te-bar');
  const teName = ed.querySelector('#teName'), teSize = ed.querySelector('#teSize'), teSizeV = ed.querySelector('#teSizeV');
  const teOp = ed.querySelector('#teOp'), teOpV = ed.querySelector('#teOpV'), teFixed = ed.querySelector('#teFixed');
  const enodes = {};
  let draft = null, sel = 'mv', drag = null;

  // mantém o controle dentro da tela e fora da barra de ferramentas
  function fit(id) {
    const it = itemOf(id), v = draft.it[id], W_ = innerWidth, H_ = innerHeight, n = insets(), [hw, hh] = half(it, v.s);
    let x = Math.max(n.l + hw, Math.min(W_ - n.r - hw, v.x * W_)), y = Math.max(n.t + hh, Math.min(H_ - n.b - hh, v.y * H_));   // respeita o notch / barra do sistema
    const br = bar.getBoundingClientRect();
    if (br.width && x + hw > br.left && x - hw < br.right && y - hh < br.bottom + 4) y = Math.min(H_ - hh, br.bottom + 4 + hh);
    v.x = x / W_; v.y = y / H_;
  }
  function placeNodes() {
    const W_ = innerWidth, H_ = innerHeight;
    for (const it of ITEMS) {
      const v = draft.it[it.id], n = enodes[it.id], [hw, hh] = half(it, v.s);
      n.style.left = (v.x * W_) + 'px'; n.style.top = (v.y * H_) + 'px';
      n.style.width = (hw * 2) + 'px'; n.style.height = (hh * 2) + 'px';
      n.style.fontSize = (it.stick ? 0.62 : it.fs * v.s * uScale()) + 'rem';
      n.style.opacity = it.id === sel ? 1 : Math.max(0.45, draft.op);
      n.classList.toggle('sel', it.id === sel);
    }
  }
  function syncEditor() {
    const it = itemOf(sel), v = draft.it[sel];
    teName.textContent = it.name;
    teSize.value = Math.round(v.s * 100); teSizeV.textContent = Math.round(v.s * 100) + '%';
    teOp.value = Math.round(draft.op * 100); teOpV.textContent = Math.round(draft.op * 100) + '%';
    teFixed.checked = !!draft.fixed;
  }
  function onNodeDown(e) {
    e.preventDefault();
    const n = e.currentTarget, id = n.dataset.id, v = draft.it[id];
    sel = id; drag = { pid: e.pointerId, id, dx: e.clientX - v.x * innerWidth, dy: e.clientY - v.y * innerHeight };
    try { n.setPointerCapture(e.pointerId); } catch { }
    syncEditor(); placeNodes();
  }
  function onNodeMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    const v = draft.it[drag.id];
    v.x = (e.clientX - drag.dx) / innerWidth; v.y = (e.clientY - drag.dy) / innerHeight;
    fit(drag.id); placeNodes();
  }
  const onNodeUp = e => { if (drag && e.pointerId === drag.pid) drag = null; };

  function buildNodes() {
    stage.textContent = '';
    for (const it of ITEMS) {
      const n = mk('div', 'te-node' + (it.stick ? ' stick' : '') + (it.aim ? ' aim' : ''), stage, it.stick ? '<i></i><span>' + it.label + '</span>' : '<span>' + it.label + '</span>');
      n.dataset.id = it.id; enodes[it.id] = n;
      n.addEventListener('pointerdown', onNodeDown); n.addEventListener('pointermove', onNodeMove);
      n.addEventListener('pointerup', onNodeUp); n.addEventListener('pointercancel', onNodeUp);
    }
  }
  function openEditor() {
    draft = JSON.parse(JSON.stringify(layout())); sel = 'mv'; drag = null;
    buildNodes(); ed.classList.remove('hidden');
    if (innerWidth > innerHeight) for (const it of ITEMS) fit(it.id);
    syncEditor(); placeNodes();
  }
  function closeEditor() { ed.classList.add('hidden'); draft = null; drag = null; }
  function saveEditor() {
    const d = defaults(), it = {};
    for (const id in d) {   // só salva o que saiu do padrão
      const v = draft.it[id], q = d[id];
      if (Math.abs(v.x - q.x) > 0.002 || Math.abs(v.y - q.y) > 0.002 || Math.abs(v.s - 1) > 0.001) it[id] = { x: +v.x.toFixed(4), y: +v.y.toFixed(4), s: +v.s.toFixed(2) };
    }
    cfg.touch = { op: +draft.op.toFixed(2), fixed: !!draft.fixed, it };
    saveCfg(); applyLayout(); syncOptFixed(); closeEditor();
  }
  teSize.oninput = () => { draft.it[sel].s = clampN(teSize.value / 100, SZ_MIN, SZ_MAX, 1); fit(sel); placeNodes(); syncEditor(); };
  teOp.oninput = () => { draft.op = clampN(teOp.value / 100, 0.3, 1, 1); placeNodes(); syncEditor(); };
  teFixed.onchange = () => { draft.fixed = teFixed.checked; };
  ed.querySelector('#teReset').onclick = () => { draft = { op: 1, fixed: true, it: defaults() }; if (innerWidth > innerHeight) for (const it of ITEMS) fit(it.id); syncEditor(); placeNodes(); };
  ed.querySelector('#teCancel').onclick = closeEditor;
  ed.querySelector('#teBack').onclick = closeEditor;
  ed.querySelector('#teSave').onclick = saveEditor;
  for (const id of ['btnTouchEdit', 'btnTouchPause']) { const b = $(id); if (b) b.onclick = openEditor; }

  // atalho em Opções: travar os analógicos no lugar sem abrir a tela de ajuste
  const optFixed = $('optTouchFixed');
  function syncOptFixed() { if (optFixed) optFixed.checked = layout().fixed; }
  if (optFixed) optFixed.onchange = () => {
    if (!cfg.touch || typeof cfg.touch !== 'object') cfg.touch = {};
    cfg.touch.fixed = optFixed.checked; saveCfg(); applyLayout();
  };
  syncOptFixed();

  addEventListener('resize', () => {
    applyLayout();
    if (draft && innerWidth > innerHeight) { for (const it of ITEMS) fit(it.id); placeNodes(); }
  });

  /* ----------------------------------- aplica a mira + mostra/esconde */
  let wasOn = false;
  function releaseAll() {
    endMove(); if (A.id != null) { A.id = null; baseR.classList.remove('on'); ghostR.style.opacity = ''; }
    A.firing = false; mouse.down = false; keys.f = false;
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
    { const m0 = myState(), showSl = !!(m0 && hasActive(m0.sk)); if (nodes.sl && nodes.sl.dataset.vis !== String(showSl)) { nodes.sl.dataset.vis = String(showSl); nodes.sl.style.display = showSl ? '' : 'none'; } }   // ATIVA: gorila (explosão) e Shadow 4 (gancho)
    if (tapUntil && now > tapUntil) { tapUntil = 0; if (A.id == null) mouse.down = false; }
    // mira: começa olhando para onde o servidor posicionou o boneco na rodada e depois só o analógico direito muda
    if (round !== lastRd) { lastRd = round; tAim = null; }
    if (tAim == null) { const m = myState(); if (m && Number.isFinite(m.a)) tAim = m.a; }
    const sp = canSpec(); if (sp !== specNow) { specNow = sp; applyZones(); }
    if (tAim != null) {   // transforma o ângulo do analógico numa posição de "mouse" ao redor do personagem
      const px = W / 2 + (pred.x - cam.x) * Z, py = H / 2 + (pred.y - cam.y) * Z;
      mouse.x = px + Math.cos(tAim) * 220; mouse.y = py + Math.sin(tAim) * 220;
    }
  }
  applyLayout();
  requestAnimationFrame(loop);

  /* ---------------------------------------- evita gestos do navegador */
  const stop = e => { if (document.body.classList.contains('tcPlay')) e.preventDefault(); };
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); if (mode && !paused) setPaused(true); } });
})();
