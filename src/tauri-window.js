/* ============================================================
 * 便签台 · Tauri v2 桌面集成层（构建时注入，勿手改于产物）
 * 窗口模型：
 *   ?w=daemon  隐藏守护窗：全量数据权威、提醒调度、托盘动作、为每张未归档便签开/关窗
 *   ?w=card&id 单卡窗：无边框、原生拖动(startDragging)、📌=alwaysOnTop、窗口几何独立存档
 * 数据：与网页版同一个 localStorage(STORE_KEY)；单卡窗写入采用 read-merge-write
 * ============================================================ */
(() => {
  const T = window.__TAURI__;
  if (!T) return;                                  // 纯浏览器/线上版：整层旁路
  const qs = new URLSearchParams(location.search);
  const MODE = qs.get('w');                        // 'daemon' | 'card' | null
  const MID = qs.get('id') || '';
  const focusFirst = qs.get('focus') === '1';
  const EV = T.event, WIN = T.window, CORE = T.core;
  const cur = WIN.getCurrentWindow();
  const WK = pid => 'sticky-win:' + pid;           // 物理屏幕几何（逻辑px）
  const LS = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  let applyStoreSync = function () {};              // 模式块覆写
  /* WebView2 跨窗 storage 事件在部分隔离模式不触发 → 轻量轮询兜底（本地数据，代价可忽略） */
  let _raw = localStorage.getItem(STORE_KEY);
  addEventListener('storage', e => { if (e.key === STORE_KEY) onRemoteStore(); });
  setInterval(() => { const r = localStorage.getItem(STORE_KEY); if (r !== _raw) onRemoteStore(); }, 2500);
  function onRemoteStore() { _raw = localStorage.getItem(STORE_KEY); applyStoreSync(); }

  /* 原生通知：base 内联使用 new Notification(...)——构造器猴补丁转接 Tauri 通知插件 */
  const TAURINotification = function (title, opts) {
    CORE.invoke('plugin:notification|notify', { title, body: (opts && opts.body) || '', tag: (opts && opts.tag) || 'sticky' }).catch(() => {});
    this.onclick = null; this.close = function () {};
  };
  TAURINotification.permission = 'granted';
  TAURINotification.requestPermission = () => Promise.resolve('granted');
  window.Notification = TAURINotification;

  /* ---------- 开窗（两端可用） ---------- */
  async function ensureCardWindow(n, focus) {
    if (!n || n.archived) return;
    const label = 'card-' + n.id;
    try {
      const ex = WIN.WebviewWindow.getByLabel(label);
      if (ex) { if (focus) { await ex.unminimize().catch(() => {}); await ex.show().catch(() => {}); await ex.setFocus().catch(() => {}); } return; }
    } catch (e) {}
    const g = LS.get(WK(n.id)) || {};
    const logicalH = n.collapsed ? 38 : Math.max(60, g.wh || n.h || 240);
    try {
      const w = new WIN.WebviewWindow(label, Object.assign({
        url: 'index.html?w=card&id=' + n.id + (focus ? '&focus=1' : ''),
        title: plainTitle(n.text) || '便签',
        width: Math.max(140, g.ww || n.w || 260), height: logicalH,
        x: g.wx, y: g.wy,
        decorations: false, transparent: false, shadow: false,
        resizable: true, maximizable: false, minimizable: true, closable: true,
        alwaysOnTop: !!n.pinned, skipTaskbar: false, visible: false, focus: false,
      }, (g.wx !== undefined && g.wy !== undefined) ? { x: g.wx, y: g.wy } : {}));
      w.once('tauri://error', () => {});
    } catch (e) { console.warn('spawn card window failed', e); }
  }

  /* ---------- 卡片几何独立档：窗口位置/尺寸 ↔ sticky-win:<id> ---------- */
  async function persistGeo() {
    if (MODE !== 'card') return;
    try {
      const [p, s, f] = [await cur.outerPosition(), await cur.outerSize(), (await cur.scaleFactor().catch(() => 1)) || 1];
      LS.set(WK(MID), { wx: Math.round(p.x / f), wy: Math.round(p.y / f), ww: Math.round(s.width / f), wh: Math.round(s.height / f) });
    } catch (e) {}
  }

  /* ================= 单卡窗模式 ================= */
  if (MODE === 'card') {
    document.documentElement.dataset.w = 'card';
    const mine0 = getNote(MID);
    if (!mine0) { cur.destroy().catch(() => {}); return; }
    /* 远端数据变化 → 同步本卡 chrome（编辑中不打断） */
    applyStoreSync = function () {
      const d = LS.get(STORE_KEY); if (!d || !d.notes) return;
      const mine = d.notes.find(n => n.id === MID);
      if (!mine) { cur.destroy().catch(() => {}); return; }
      state.notes = [mine];
      try { syncChrome(mine); if (mine.remindAt) syncMD(mine); } catch (e) {}
    };
    /* 隐藏墙面 UI：工具栏/底架/帮助入口（卡片即窗口） */
    const st = document.createElement('style');
    st.textContent = 'html[data-w="card"] .bar:not(#toolbar .bar){}' +
      'html[data-w="card"] #toolbar,html[data-w="card"] #shelf{display:none!important}' +
      'html[data-w="card"] .canvas{inset:0!important}' +
      'html[data-w="card"] .note{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none;max-height:none;border-radius:10px;box-shadow:none}' +
      '.note{user-select:text}';
    document.head.appendChild(st);
    state.notes = [mine0]; state.edges = [];
    renderAll();
    drawEdges = noopDraw; function noopDraw() {}

    /* 原生标题栏拖动：接管自绘 dragify */
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

    /* 单卡写入：read-merge-write，绝不覆盖他卡 */
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
      } catch (e) { try { toast('保存失败：存储配额不足', { warn: true }); } catch (e2) {} }
    };

    /* 结构操作 → 转发 daemon（新建/复制）；本卡可自处理：归档/删除/恢复 */
    const _create = createNote; createNote = function () { EV.emit('win:new', MID).catch(() => {}); };
    const _dup = duplicateNote; duplicateNote = function (n) { EV.emit('win:dup', (n && n.id) || n).catch(() => {}); };
    document.getElementById('btn-new') && document.getElementById('btn-new').addEventListener('click', e => { e.stopImmediatePropagation(); e.preventDefault(); EV.emit('win:new', MID).catch(() => {}); }, true);
    const _pinOrig = togglePin; togglePin = function (m) { const on = _pinOrig(m); cur.setAlwaysOnTop(!!on).catch(() => {}); return on; };
    const _foldOrig = toggleFold; toggleFold = async function (m) {
      _foldOrig(m);
      try {
        const g = LS.get(WK(MID)) || {};
        const w = Math.max(140, g.ww || m.w || 260);
        await cur.setSize(new WIN.LogicalSize(w, m.collapsed ? 38 : Math.max(60, g.whRestore || m.hExp || m.h || 240)));
      } catch (e) {}
      persistGeo();
    };
    /* 记录折叠前高度，供展开时恢复 */
    addEventListener('input', () => { const n2 = state.notes[0]; if (n2 && !n2.collapsed) { const g = LS.get(WK(MID)) || {}; if (g.wh) { g.whRestore = g.wh; LS.set(WK(MID), g); } } }, true);
    const _archOrig = archiveOne; archiveOne = function (id) { const r = _archOrig(id); saveNow(); if (id === MID) setTimeout(() => cur.destroy().catch(() => {}), 80); return r; };
    const _delOrig = deleteNote; deleteNote = function (id) { const r = _delOrig(id); saveNow(); if (id === MID) setTimeout(() => cur.destroy().catch(() => {}), 80); return r; };
    const _restOrig = restoreOne; restoreOne = function (id) { const r = _restOrig(id); (async () => { const n2 = getNote(id); if (n2) await ensureCardWindow(n2, true); await persistGeo().catch(()=>{}); })(); return r; };
    restoreAllArch = function () { /* 由 daemon 处理 */ EV.emit('win:restoreall', MID).catch(() => {}); };
    /* Alt+F4 / 系统关闭 → 归档本卡（不留孤儿窗口） */
    let closing = false;
    (async () => { try {
      await WIN.getCurrentWindow().onCloseRequested(async api => {
        if (closing) return; closing = true;
        try { api.preventDefault(); } catch (e) {}
        try { _archOrig(MID); saveNow(); } catch (e) {}
        await cur.destroy().catch(() => {});
      });
    } catch (e) {} })();
    /* 开屏即同步置顶态与尺寸，完成首帧后再显形（防闪现整墙） */
    (async () => { try { await cur.setAlwaysOnTop(!!(getNote(MID) && getNote(MID).pinned)); await cur.show(); if (focusFirst) await cur.setFocus(); } catch (e) { await cur.show().catch(() => {}); } })();
    return;
  }

  /* ================= 守护窗模式 ================= */
  if (MODE === 'daemon') {
    applyStoreSync = function () {
      try { load(); renderAll(); ensureWindows(); } catch (e) {}
    };
    /* 隐藏兜底：conf 已 visible:false；某些平台误显则移屏外 */
    (async () => { try {
      if (await cur.isVisible().catch(() => false)) {
        await cur.setPosition(new WIN.PhysicalPosition(-32000, -32000)).catch(() => {});
        await cur.setSize(new WIN.PhysicalSize(1, 1)).catch(() => {});
      }
    } catch (e) {} })();
    const _crDaemon = createNote;
    createNote = function () { const n = _crDaemon(); ensureCardWindow(n, true); return n; };
    const _dupDaemon = duplicateNote;
    duplicateNote = function (src) { const n = _dupDaemon(src); if (n) ensureCardWindow(getNote(n.id || n), true); return n; };
    const _restoreDaemon = restoreOne;
    restoreOne = function (id) { const r = _restoreDaemon(id); const n2 = getNote(id); if (n2) ensureCardWindow(n2, true); return r; };
    async function ensureWindows() {
      for (const n of wallNotes()) ensureCardWindow(n, false);
    }
    EV.listen('win:new', () => { createNote(); });
    EV.listen('win:dup', e => { const src = getNote(e.payload); if (src) duplicateNote(src); });
    EV.listen('win:restoreall', () => { restoreAllArch(); toast && toast('已全部放回墙面'); });
    setTimeout(ensureWindows, 400);            // 开机恢复窗口布局
    /* daemon 保存即权威全量写，但同步写窗口几何档（卡片消失时清理） */
    const _snD = saveNow;
    saveNow = function () {
      _snD();
      try {
        _raw = localStorage.getItem(STORE_KEY);
        const ids = new Set((LS.get(STORE_KEY).notes || []).map(n => 'sticky-win:' + n.id));
        Object.keys(localStorage).filter(k => k.startsWith('sticky-win:')).forEach(k => { if (!ids.has(k)) localStorage.removeItem(k); });
      } catch (e) {}
    };
  }
})();
