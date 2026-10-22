/* 7 SHADOWS — navegação do menu estilo console: ↑/↓ escolhem, Enter confirma, Esc volta, ←/→ trocam a máscara */
(() => {
  const $ = id => document.getElementById(id), menu = $('menu');
  if (!menu) return;
  const open = () => !menu.classList.contains('hidden');
  const tick = () => { try { if (typeof ac !== 'undefined' && ac) sfx('tick'); } catch { } };
  const items = () => [...menu.querySelectorAll('#tabPlay:not(.hidden) .dc-btn:not(.dc-static), #tabMusic:not(.hidden) .track, #tabMusic:not(.hidden) .dc-back')];
  addEventListener('keydown', e => {
    if (!open() || e.ctrlKey || e.metaKey || e.altKey) return;
    try { if ((typeof mode !== 'undefined' && mode) || (typeof introOn !== 'undefined' && introOn)) return; } catch { }
    const tg = e.target && e.target.tagName;
    if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
    if (!$('roomCfg').classList.contains('hidden') || !$('opts').classList.contains('hidden')) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      const l = items(); if (!l.length) return;
      e.preventDefault();
      const i = l.indexOf(document.activeElement);
      const n = i < 0 ? (k === 'ArrowDown' ? 0 : l.length - 1) : (i + (k === 'ArrowDown' ? 1 : -1) + l.length) % l.length;
      l[n].focus(); tick();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const a = document.activeElement;
      if (!a || !a.classList.contains('skin')) return;
      const s = [...menu.querySelectorAll('#skins .skin')], i = s.indexOf(a);
      e.preventDefault(); s[(i + (k === 'ArrowRight' ? 1 : -1) + s.length) % s.length].focus(); tick();
    } else if (k === 'Escape' && !$('tabMusic').classList.contains('hidden')) {
      e.preventDefault(); $('btnMusicBack').click(); tick();
    }
  });
})();
