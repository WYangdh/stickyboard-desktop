/* ============================================================
 * 便签台 · Tauri v2 桌面集成层 v2（构建时注入 dist-web/index.html）
 * 本版关键：开窗走底层命令 create_webview_window；daemon 带 diagbar 错误日志与「便签墙管理」面板
 * ============================================================ */
(() => {
  const T = window.__TAURI__;
  if (!T) return;
  const qs = new URLSearchParams(location.search);
  const MODE = qs.get('w');
  const MID = qs.get('id') || '';
  const FOCUS_FIRST = qs.get('focus') === '1';
  const EV = T.event, WIN = T.window, CORE = T.core;
  const cur = WIN.getCurrentWindow();
  const invoke = (cmd, args) => CORE.invoke(cmd, args || {});
  const WK = pid => 'sticky-win:' + pid;
  const LS = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- 错误病历本（daemon 可见窗口顶部红条） ---------- */
  const LOGS = [];
  function lg(s) { if (LOGS.length < 30) LOGS.push(String(s).slice(0, 150)); paintLogs(); }
  addEventListener('error', e => lg('ERR ' + ((e && e.message) || String(e))));
  function paintLogs() {
    if (MODE !== 'daemon') return;
    let b = document.getElementById('diagbar');
    if (!b) {
      b = document.createElement('div'); b.id = 'diagbar';
      b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#1c1e26;color:#ff8a80;font:11px/1.6 Consolas,monospace;padding:6px 10px;max-height:45%;overflow:auto;display:none;pointer-events:none';
      (document.body || document.documentElement).appendChild(b);
    }
    b.textContent = LOGS.length ? 'daemon 日志：\n' + LOGS.join('\n') : '';
    cur.isVisible().then(v => { b.style.display = v && LOGS.length ? 'block' : 'none'; }).catch(() => {});
  }

  /* ---------- 共享：跨窗同步（storage 事件 + 轮询双保险） ---------- */
  let applyStoreSync = function () {};
  let _raw = localStorage.getItem(STORE_KEY);
  function onRemoteStore() { _raw = localStorage.getItem(STORE_KEY); try { applyStoreSync(); } catch (e) { lg(e); } }
  addEventListener('storage', e => { if (e.key === STORE_KEY) onRemoteStore(); });
  setInterval(() => { const r = localStorage.getItem(STORE_KEY); if (r !== _raw) onRemoteStore(); }, 2500);

  /* ---------- 原生通知（猴补丁接 base 内联 new Notification） ---------- */
  function TAURINotification(title, opts) {
    invoke('plugin:notification|notify', { title, body: (opts && opts.body) || '', tag: (opts && opts.tag) || 'sticky' }).catch(e => lg('notify ' + e));
    this.onclick = null; this.close = function () {};
  }
  TAURINotification.permission = 'granted';
  TAURINotification.requestPermission = () => Promise.resolve('granted');
  window.Notification = TAURINotification;

  /* ---------- 卡片窗口：底层命令创建 ---------- */
  async function allLabels() {
    try { const ws = await invoke('plugin:webview|get_all_webviews'); return (ws || []).map(w => w.label); }
    catch (e) { return null; }
  }
  async function ensureCardWindow(n, focus) {
    if (!n || n.archived) return;
    const label = 'card-' + n.id;
    const known = await allLabels();
    if (known && known.indexOf(label) >= 0) {
      if (focus) { invoke('plugin:window|unminimize', { label }).catch(() => {}); invoke('plugin:window|show', { label }).catch(() => {}); invoke('plugin:window|set_focus', { label }).catch(() => {}); }
      return;
    }
    const g = LS.get(WK(n.id)) || {};
    const opts = {
      label, url: 'index.html?w=card&id=' + n.id + (focus ? '&focus=1' : ''),
      title: (plainTitle(n.text) || '便签').slice(0, 60),
      width: Math.max(140, g.ww || n.w || 260),
      height: n.collapsed ? 40 : Math.max(60, g.wh || n.h || 240),
      decorations: false, transparent: false, shadow: false,
      resizable: true, maximizable: false, minimizable: true, closable: true,
      alwaysOnTop: !!n.pinned, skipTaskbar: false, focus: !!focus,
    };
    if (g.wx !== undefined && g.wy !== undefined) { opts.x = g.wx; opts.y = g.wy; }
    try { await invoke('plugin:webview|create_webview_window', { options: opts }); }
    catch (e) { lg('spawn ' + label + ': ' + e); }
  }

  /* 窗口几何持久化 */
  async function persistGeo() {
    if (MODE !== 'card') return;
    try {
      const p = await cur.outerPosition(), s = await cur.outerSize(), f = (await cur.scaleFactor()) || 1;
      LS.set(WK(MID), { wx: Math.round(p.x / f), wy: Math.round(p.y / f), ww: Math.round(s.width / f), wh: Math.round(s.height / f) });
    } catch (e) {}
  }

  /* ================= 单卡窗 ================= */
  if (MODE === 'card') {
    document.documentElement.dataset.w = 'card';
    const mine0 = getNote(MID);
    if (!mine0) { cur.destroy().catch(() => {}); return; }
    applyStoreSync = function () {
      const d = LS.get(STORE_KEY); if (!d || !d.notes) return;
      const mine = d.notes.find(n => n.id === MID);
      if (!mine) { cur.destroy().catch(() => {}); return; }
      state.notes = [mine];
      try { syncChrome(mine); if (mine.remindAt) syncMD(mine); } catch (e) {}
    };
    const st = document.createElement('style');
    st.textContent = 'html[data-w="card"] #toolbar,html[data-w="card"] #shelf{display:none!important}'
      + 'html[data-w="card"] .canvas{inset:0!important}'
      + 'html[data-w="card"] .note{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none;max-height:none;border-radius:10px;box-shadow:none}';
    document.head.appendChild(st);
    state.notes = [mine0]; state.edges = [];
    renderAll();
    const q = noteEls.get(MID)._q;
    q.grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      if (e.target.closest('.note-menu,.note-fold,.note-pin-btn,.note-theme-btn,.note-save-btn')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      cur.startDragging().catch(() => {});
    }, true);
    let geoT = null;
    const queueGeo = () => { clearTimeout(geoT); geoT = setTimeout(persistGeo, 420); };
    (async () => { try { await cur.listen('tauri://moved', queueGeo); await cur.listen('tauri://resized', queueGeo); } catch (e) {} })();
    queueGeo();
    saveNow = function () {
      clearTimeout(saveTimer); saveTimer = null;
      try {
        const d = LS.get(STORE_KEY) || { schema: 4, notes: [], theme: null, edges: [], syntax: 'off' };
        if (!Array.isArray(d.notes)) d.notes = [];
        const mine = state.notes[0]; if (!mine) return;
        let hit = false;
        d.notes = d.notes.map(n => { if (n.id === mine.id) { hit = true; return JSON.parse(JSON.stringify(mine)); } return n; });
        if (!hit) d.notes.push(JSON.parse(JSON.stringify(mine)));
        LS.set(STORE_KEY, d);
      } catch (e) { try { toast('保存失败', { warn: true }); } catch (e2) {} }
    };
    createNote = function () { EV.emit('win:new', MID).catch(() => {}); };
    duplicateNote = function (n) { EV.emit('win:dup', (n && n.id) || n).catch(() => {}); };
    document.getElementById('btn-new') && document.getElementById('btn-new').addEventListener('click', e => { e.stopImmediatePropagation(); e.preventDefault(); EV.emit('win:new', MID).catch(() => {}); }, true);
    const _pinOrig = togglePin;
    togglePin = function (m) { const on = _pinOrig(m); cur.setAlwaysOnTop(!!on).catch(() => {}); return on; };
    const _foldOrig = toggleFold;
    toggleFold = async function (m) {
      _foldOrig(m);
      try {
        const g = LS.get(WK(MID)) || {};
        const w = Math.max(140, g.ww || m.w || 260);
        await cur.setSize(new WIN.LogicalSize(w, m.collapsed ? 40 : Math.max(60, g.whRestore || m.hExp || m.h || 240)));
      } catch (e) {}
      persistGeo();
    };
    const _archOrig = archiveOne;
    archiveOne = function (id) { const r = _archOrig(id); saveNow(); if (id === MID) setTimeout(() => cur.destroy().catch(() => {}), 80); return r; };
    const _delOrig = deleteNote;
    deleteNote = function (id) { const r = _delOrig(id); saveNow(); if (id === MID) setTimeout(() => cur.destroy().catch(() => {}), 80); return r; };
    const _restOrig = restoreOne;
    restoreOne = function (id) { const r = _restOrig(id); (async () => { try { const n2 = getNote(id); if (n2) await ensureCardWindow(n2, true); } catch (e) {} })(); return r; };
    restoreAllArch = function () { EV.emit('win:restoreall', MID).catch(() => {}); };
    let closing = false;
    (async () => {
      try { await WIN.getCurrentWindow().onCloseRequested(async api => {
        if (closing) return; closing = true;
        try { api.preventDefault(); } catch (e) {}
        try { _archOrig(MID); saveNow(); } catch (e) {}
        await cur.destroy().catch(() => {});
      }); } catch (e) {}
    })();
    (async () => {
      try { await cur.setAlwaysOnTop(!!(getNote(MID) && getNote(MID).pinned)); } catch (e) {}
      try { await cur.show(); if (FOCUS_FIRST) await cur.setFocus(); } catch (e) {}
      try { const n3 = getNote(MID); if (n3 && n3.collapsed) { const g0 = LS.get(WK(MID)) || {}; await cur.setSize(new WIN.LogicalSize(Math.max(140, g0.ww || n3.w || 260), 40)); } } catch (e) {}
    })();
    return;
  }

  /* ================= 守护窗 ================= */
  if (MODE === 'daemon') {
    applyStoreSync = function () { load(); renderAll(); ensureWindows(); paintLogs(); };
    const _crD = createNote;
    createNote = function () {
      try { const n = _crD(); ensureCardWindow(n, true); return n; }
      catch (e) { lg('createNote ' + e); }
    };
    const _dupD = duplicateNote;
    duplicateNote = function (src) { try { const r = _dupD(src); return r; } catch (e) { lg('dup ' + e); } };
    const _rpD = restoreOne;
    restoreOne = function (id) { const r = _rpD(id); const m = getNote(id); if (m) ensureCardWindow(m, true); return r; };
    async function ensureWindows() { for (const n of wallNotes()) await ensureCardWindow(n, false); }
    EV.listen('tray-new', () => createNote());
    EV.listen('tray-restore', () => restoreAllArch());
    EV.listen('win:new', () => createNote());
    EV.listen('win:dup', e => { const s = getNote(e.payload); if (s) duplicateNote(s); });
    (async () => { try { await cur.onCloseRequested(a => { a.preventDefault(); cur.hide().catch(() => {}); }); } catch (e) {} })();
    setTimeout(() => { ensureWindows().catch(e => lg('boot ' + e)); paintLogs(); }, 500);
    paintLogs();
  }
})();