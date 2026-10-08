/* Invoice Drop – app logic */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem('id.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem('id.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const eur = (n) => '€' + (Number(n) || 0).toFixed(2);
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = {
    me: null,
    pages: [],          // [{canvas, thumb}]
    file: null,         // uploaded PDF/image {b64, mime, name}
    cur: null,          // page being edited {src, quad, warped, filter, rot}
    book: store.get('book', null),
    prop: store.get('prop', 'V'),
    paid: 'company',
    selected: new Set(),
  };

  /* ---------------- navigation ---------------- */
  function show(id) {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + id));
    $('#tabbar').hidden = !(id === 'home' || id === 'activity');
    $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === id));
    window.scrollTo(0, 0);
  }
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms || 2600); }
  function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busy-text').textContent = text; }
  function sheet(html) {
    $('#sheet').innerHTML = html; $('#sheet').hidden = false; $('#scrim').hidden = false;
    return $('#sheet');
  }
  function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; }
  $('#scrim').addEventListener('click', closeSheet);

  /* ---------------- startup ---------------- */
  async function start() {
    const m = location.hash.match(/k=([A-Za-z0-9]+)/);
    if (m) localStorage.setItem('id.key', m[1].toUpperCase());
    if (!localStorage.getItem('id.key')) return show('setup');
    try {
      busy(true, 'Loading…');
      S.me = await API.call('me');
      store.set('me', S.me);
    } catch (e) {
      const cached = store.get('me', null);
      if (e.offline && cached) { S.me = cached; toast('Offline – uploads will wait'); }
      else { busy(false); localStorage.removeItem('id.key'); $('#setup-error').textContent = e.message; return show('setup'); }
    } finally { busy(false); }
    renderHome();
    show('home');
    flushQueue();
  }

  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#setup-code').value.trim().toUpperCase();
    if (!code) return;
    localStorage.setItem('id.key', code);
    $('#setup-error').textContent = '';
    start();
  });

  /* ---------------- home ---------------- */
  function renderHome() {
    const me = S.me;
    const h = new Date().getHours();
    $('#home-hello').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', ' + me.name;
    $('#home-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#btn-profile').textContent = me.name.charAt(0);
    $('#demo-banner').hidden = !API.demo;
    $('#tab-reimb').textContent = me.canApprove ? 'Reimbursements' : 'My money';
    const card = $('#card-balance');
    card.classList.remove('attention');
    if (me.books.indexOf('ml') < 0) { card.hidden = true; }
    else if (me.canApprove) {
      card.hidden = false;
      const n = me.pendingCount || 0;
      card.classList.toggle('attention', n > 0);
      card.innerHTML = n ? '<div><div class="lbl">To reimburse</div><div class="amt">' + n + ' receipt' + (n > 1 ? 's' : '') + '</div></div><button class="btn primary" data-go="reimb">Review</button>'
                         : '<div><div class="lbl">Reimbursements</div><div class="amt">All paid</div></div>';
      $('#nav-dot').hidden = !n;
    } else {
      card.hidden = false;
      const owed = me.owedToMe || 0;
      card.classList.toggle('attention', owed > 0);
      card.innerHTML = '<div><div class="lbl">' + (owed ? 'Owed to you' : 'Nothing owed to you') + '</div><div class="amt">' + eur(owed) + '</div></div>' +
        (owed ? '<button class="btn ghost" data-go="reimb">Details</button>' : '');
    }
    // iOS install hint
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone && !store.get('installHintSeen', false)) {
      const b = $('#install-banner');
      b.hidden = false;
      b.innerHTML = 'Tip: tap <b>Share</b> then <b>Add to Home Screen</b> to install the app. <button class="link" id="hint-x">OK</button>';
      $('#hint-x').onclick = () => { store.set('installHintSeen', true); b.hidden = true; };
    }
  }
  $('#card-balance').addEventListener('click', (e) => { if (e.target.closest('[data-go="reimb"]')) openActivity('reimb'); });
  $('#btn-profile').addEventListener('click', () => {
    const s = sheet('<h2>' + esc(S.me.name) + '</h2><p class="muted">' + (S.me.role === 'admin' ? 'Full access' : S.me.role === 'approver' ? 'Mistral Loom · can approve' : 'Mistral Loom') + (API.demo ? ' · demo' : '') + '</p>' +
      '<button class="btn ghost block" id="sh-signout">Sign out of this phone</button><button class="btn primary block" id="sh-close">Close</button>');
    s.querySelector('#sh-close').onclick = closeSheet;
    s.querySelector('#sh-signout').onclick = () => { localStorage.removeItem('id.key'); location.hash = ''; location.reload(); };
  });
  $$('#tabbar button').forEach(b => b.addEventListener('click', () => b.dataset.go === 'home' ? (refreshMe(), show('home')) : openActivity()));

  async function refreshMe() { try { S.me = await API.call('me'); store.set('me', S.me); renderHome(); } catch (e) { /* offline: keep */ } }

  /* ---------------- capture ---------------- */
  $('#btn-scan').addEventListener('click', () => { resetDoc(); $('#in-camera').click(); });
  $('#btn-upload').addEventListener('click', () => { resetDoc(); $('#in-file').click(); });
  $('#pages-add').addEventListener('click', () => $('#in-camera').click());
  $('#crop-retake').addEventListener('click', () => $('#in-camera').click());

  function resetDoc() { S.pages = []; S.file = null; S.cur = null; }

  $('#in-camera').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await openImage(f); });
  $('#in-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.type === 'application/pdf') {
      if (f.size > 20 * 1024 * 1024) return toast('That PDF is over 20 MB');
      busy(true, 'Reading file…');
      const b64 = await fileToB64(f);
      busy(false);
      S.file = { b64, mime: 'application/pdf', name: f.name };
      return openDetails();
    }
    await openImage(f);
  });

  function fileToB64(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); }); }

  async function loadImage(file) {
    // createImageBitmap honours EXIF orientation in modern browsers
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const s = Math.min(1, 2600 / Math.max(w, h)); // cap memory on phones
    const c = Scanner.makeCanvas(Math.round(w * s), Math.round(h * s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  async function openImage(file) {
    busy(true, 'Finding the page…');
    try {
      const src = await loadImage(file);
      await new Promise(r => setTimeout(r, 0));
      const det = Scanner.detectQuad(src);
      S.cur = { src, quad: det.quad, found: det.found, filter: store.get('filter', 'scan'), rot: 0 };
      show('crop');
      requestAnimationFrame(drawCrop);
      if (!det.found) toast('Drag the corners to the edges of the page');
    } catch (e) {
      console.error(e); toast('Could not open that image');
    } finally { busy(false); }
  }

  /* ---------------- crop editor ---------------- */
  let view = { scale: 1, ox: 0, oy: 0 };
  function drawCrop() {
    const c = $('#crop-canvas'), stage = $('#crop-stage'), src = S.cur.src;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const scale = Math.min(sw / src.width, sh / src.height);
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const ox = (sw - c.width) / 2, oy = (sh - c.height) / 2;
    view = { scale, ox, oy };
    const svg = $('#crop-svg'); svg.setAttribute('width', sw); svg.setAttribute('height', sh);
    placeHandles();
  }
  function placeHandles() {
    const pts = S.cur.quad.map(p => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale }));
    $$('.handle').forEach((h, i) => { h.style.left = pts[i].x + 'px'; h.style.top = pts[i].y + 'px'; });
    $('#crop-poly').setAttribute('points', pts.map(p => p.x + ',' + p.y).join(' '));
  }
  $$('.handle').forEach(h => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const i = +h.dataset.i; const rect = $('#crop-stage').getBoundingClientRect();
      const move = (ev) => {
        const x = (ev.clientX - rect.left - view.ox) / view.scale, y = (ev.clientY - rect.top - view.oy) / view.scale;
        S.cur.quad[i] = { x: Math.max(0, Math.min(S.cur.src.width, x)), y: Math.max(0, Math.min(S.cur.src.height, y)) };
        placeHandles();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  });
  window.addEventListener('resize', () => { if ($('#v-crop').classList.contains('on')) drawCrop(); if ($('#v-preview').classList.contains('on')) drawPreview(); });
  $('#crop-full').addEventListener('click', () => { const s = S.cur.src; S.cur.quad = [{ x: 0, y: 0 }, { x: s.width, y: 0 }, { x: s.width, y: s.height }, { x: 0, y: s.height }]; placeHandles(); });
  $('#crop-cancel').addEventListener('click', () => { S.cur = null; S.pages.length ? showPages() : show('home'); });
  $('#crop-next').addEventListener('click', () => {
    busy(true, 'Straightening…');
    setTimeout(() => {
      try {
        S.cur.warped = Scanner.warp(S.cur.src, S.cur.quad, 1600);
        S.cur.rot = 0;
        show('preview'); drawPreview();
      } finally { busy(false); }
    }, 30);
  });

  /* ---------------- preview / filters ---------------- */
  function currentPageCanvas() {
    return Scanner.rotate(Scanner.enhance(S.cur.warped, S.cur.filter), S.cur.rot);
  }
  function drawPreview() {
    $('#prev-num').textContent = S.pages.length + 1;
    $$('#prev-filters .chip').forEach(c => c.classList.toggle('on', c.dataset.f === S.cur.filter));
    const out = currentPageCanvas();
    S.cur.out = out;
    const c = $('#prev-canvas'); const stage = c.parentElement;
    const scale = Math.min(stage.clientWidth / out.width, stage.clientHeight / out.height, 1);
    c.width = Math.round(out.width * scale); c.height = Math.round(out.height * scale);
    c.getContext('2d').drawImage(out, 0, 0, c.width, c.height);
  }
  $('#prev-filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    S.cur.filter = b.dataset.f; store.set('filter', S.cur.filter); drawPreview();
  });
  $('#prev-rotate').addEventListener('click', () => { S.cur.rot = (S.cur.rot + 1) % 4; drawPreview(); });
  $('#prev-back').addEventListener('click', () => { show('crop'); requestAnimationFrame(drawCrop); });
  $('#prev-keep').addEventListener('click', () => {
    const canvas = S.cur.out || currentPageCanvas();
    S.pages.push({ canvas, thumb: canvas.toDataURL('image/jpeg', 0.5) });
    S.cur = null;
    showPages();
  });

  /* ---------------- pages tray ---------------- */
  function showPages() {
    const n = S.pages.length;
    if (!n) return show('home');
    $('#pages-count').textContent = n; $('#pages-s').textContent = n > 1 ? 's' : '';
    $('#thumbs').innerHTML = S.pages.map((p, i) => '<div class="thumb"><img src="' + p.thumb + '" alt=""><span class="n">' + (i + 1) + '</span><button class="x" data-i="' + i + '" aria-label="Remove page">✕</button></div>').join('');
    show('pages');
  }
  $('#thumbs').addEventListener('click', (e) => { const b = e.target.closest('.x'); if (!b) return; S.pages.splice(+b.dataset.i, 1); showPages(); });
  $('#pages-cancel').addEventListener('click', () => {
    const s = sheet('<h2>Discard this scan?</h2><p class="muted">The pages have not been saved.</p><button class="btn primary block" id="sh-yes">Discard</button><button class="btn ghost block" id="sh-no">Keep editing</button>');
    s.querySelector('#sh-no').onclick = closeSheet;
    s.querySelector('#sh-yes').onclick = () => { closeSheet(); resetDoc(); show('home'); };
  });
  $('#pages-done').addEventListener('click', openDetails);

  /* ---------------- details ---------------- */
  function openDetails() {
    const me = S.me;
    if (!S.book || me.books.indexOf(S.book) < 0) S.book = me.books.indexOf('ml') >= 0 && me.books.length === 1 ? 'ml' : me.books[0];
    S.paid = 'company';
    $('#det-amount').value = ''; $('#det-supplier').value = ''; $('#det-note').value = ''; $('#det-error').textContent = '';
    $('#f-book').hidden = me.books.length < 2;
    $('#suppliers').innerHTML = store.get('suppliers', []).map(s => '<option value="' + esc(s) + '">').join('');
    const sum = $('#det-summary');
    if (S.file) sum.innerHTML = '<div class="pdf">PDF</div><div><b>' + esc(S.file.name) + '</b><div class="muted">Ready to upload</div></div>';
    else sum.innerHTML = '<img src="' + S.pages[0].thumb + '" alt=""><div><b>' + S.pages.length + ' page' + (S.pages.length > 1 ? 's' : '') + '</b><div class="muted">Saved as one PDF</div></div>';
    syncDetails();
    show('details');
  }
  function syncDetails() {
    $$('#seg-book button').forEach(b => b.classList.toggle('on', b.dataset.v === S.book));
    $$('#seg-prop button').forEach(b => b.classList.toggle('on', b.dataset.v === S.prop));
    $$('#seg-paid button').forEach(b => b.classList.toggle('on', b.dataset.v === S.paid));
    $('#f-prop').hidden = S.book !== 'props';
    $('#f-paid').hidden = S.book !== 'ml';
    const required = S.book === 'ml' && S.paid === 'personal';
    $('#amount-opt').textContent = required ? '(needed for your refund)' : '(optional)';
  }
  $('#seg-book').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.book = b.dataset.v; syncDetails(); });
  $('#seg-prop').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.prop = b.dataset.v; syncDetails(); });
  $('#seg-paid').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.paid = b.dataset.v; syncDetails(); if (S.paid === 'personal') $('#det-amount').focus(); });
  ['#det-amount', '#det-supplier', '#det-note'].forEach(id => $(id).addEventListener('input', () => { $('#det-error').textContent = ''; }));
  $('#det-back').addEventListener('click', () => (S.file ? (resetDoc(), show('home')) : showPages()));

  $('#det-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#det-error').textContent = '';
    const amountRaw = $('#det-amount').value.trim().replace(',', '.');
    const amount = amountRaw ? Number(amountRaw) : 0;
    if (amountRaw && !(amount > 0)) return ($('#det-error').textContent = 'Please enter the amount as a number, e.g. 24.50');
    if (S.book === 'ml' && S.paid === 'personal' && !(amount > 0)) return ($('#det-error').textContent = 'Please enter how much you paid, so we can pay you back.');
    busy(true, 'Preparing PDF…');
    await new Promise(r => setTimeout(r, 30));
    let file;
    try {
      if (S.file) file = { b64: S.file.b64, mime: S.file.mime };
      else {
        const pdf = MiniPDF.build(S.pages.map(p => MiniPDF.canvasToPage(p.canvas, 0.65)));
        file = { b64: MiniPDF.bytesToB64(pdf), mime: 'application/pdf' };
      }
    } catch (err) { busy(false); return ($('#det-error').textContent = 'Could not build the PDF: ' + err.message); }
    const payload = {
      book: S.book, property: S.book === 'props' ? S.prop : '', paidBy: S.book === 'ml' ? S.paid : 'company',
      amount: amount || '', supplier: $('#det-supplier').value.trim(), note: $('#det-note').value.trim(), file,
    };
    store.set('book', S.book); store.set('prop', S.prop);
    if (payload.supplier) { const list = store.get('suppliers', []).filter(s => s.toLowerCase() !== payload.supplier.toLowerCase()); list.unshift(payload.supplier); store.set('suppliers', list.slice(0, 30)); }
    await send(payload, false);
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const sameDoc = (it, payload) => it.by === S.me.name && it.book === payload.book &&
    Math.abs((Number(it.amount) || 0) - (Number(payload.amount) || 0)) < 0.005 &&
    String(it.supplier || '').toLowerCase() === String(payload.supplier || '').toLowerCase();
  const isRecentMine = (m) => m && m.by === S.me.name && (Date.now() - new Date(m.at).getTime()) < 15 * 60 * 1000;

  // After an error, check whether the upload actually reached Drive (it sometimes does).
  async function checkLanded(payload, since) {
    for (let i = 0; i < 2; i++) {
      await sleep(2500);
      try {
        const { items } = await API.call('recent', { limit: 10 });
        const hit = items.find(it => sameDoc(it, payload) && new Date(it.at).getTime() >= since - 60000);
        if (hit) return hit;
      } catch (e) { /* keep trying */ }
    }
    return null;
  }

  async function send(payload, force) {
    busy(true, 'Uploading…');
    const started = Date.now();
    try {
      const r = await API.call('upload', Object.assign({}, payload, { force }));
      busy(false);
      if (r.duplicate) {
        const m = r.match;
        if (isRecentMine(m)) {
          // Most likely the same scan sent twice (e.g. after a connection hiccup)
          const s = sheet('<h2>Already saved</h2><p class="muted">You saved this a few minutes ago as ' + esc(m.id) + ' (' + eur(m.amount) + (m.supplier ? ', ' + esc(m.supplier) : '') + '). There is nothing more to do.</p>' +
            '<button class="btn primary block" id="sh-ok">OK</button><button class="btn ghost block" id="sh-anyway">No, this is a different invoice</button>');
          s.querySelector('#sh-ok').onclick = () => { closeSheet(); resetDoc(); show('home'); refreshMe(); };
          s.querySelector('#sh-anyway').onclick = () => { closeSheet(); send(payload, true); };
          return;
        }
        const s = sheet('<h2>Already uploaded?</h2><p class="muted">' + esc(m.by) + ' uploaded ' + eur(m.amount) + (m.supplier ? ' from ' + esc(m.supplier) : '') + ' on ' + fmtDate(m.at) + ' (' + esc(m.id) + ').</p>' +
          '<button class="btn primary block" id="sh-anyway">It\'s a different invoice, upload</button><button class="btn ghost block" id="sh-cancel">Cancel, it\'s the same</button>');
        s.querySelector('#sh-cancel').onclick = () => { closeSheet(); resetDoc(); show('home'); toast('Not uploaded'); };
        s.querySelector('#sh-anyway').onclick = () => { closeSheet(); send(payload, true); };
        return;
      }
      done(r, payload);
    } catch (err) {
      busy(false);
      if (err.offline) {
        try { await API.Queue.add({ payload, at: Date.now() }); done(null, payload, true); }
        catch (e2) { $('#det-error').textContent = 'No connection and could not save on this phone. Try again.'; }
        return;
      }
      busy(true, 'Checking it arrived…');
      const hit = await checkLanded(payload, started);
      busy(false);
      if (hit) return done({ id: hit.id, reimbursable: /^Personal/.test(hit.paidBy || '') }, payload);
      $('#det-error').textContent = 'Not saved: ' + err.message + '. Please tap Save again.';
    }
  }

  function done(r, payload, queued) {
    const where = payload.book === 'props' ? "David's Properties · " + ({ V: 'Valletta', G: 'Gzira', U: 'Unsorted' }[payload.property] || '') : 'Mistral Loom';
    $('#done-tick').classList.toggle('queued', !!queued);
    $('#done-title').textContent = queued ? 'Saved on this phone' : 'Saved';
    let text = queued ? 'No connection right now. It will upload automatically next time you open the app.' : where + (r && r.id ? ' · ' + r.id : '');
    if (!queued && r && r.reimbursable) text += '\nAdded to your reimbursements: ' + eur(payload.amount);
    $('#done-text').textContent = text;
    $('#done-text').style.whiteSpace = 'pre-line';
    resetDoc();
    show('done');
    refreshMe();
  }
  $('#done-again').addEventListener('click', () => { resetDoc(); $('#in-camera').click(); show('home'); });
  $('#done-home').addEventListener('click', () => show('home'));

  /* ---------------- offline queue ---------------- */
  async function flushQueue() {
    let items = [];
    try { items = await API.Queue.all(); } catch (e) { return; }
    const b = $('#queue-banner');
    if (!items.length) { b.hidden = true; return; }
    b.hidden = false; b.textContent = 'Uploading ' + items.length + ' saved scan' + (items.length > 1 ? 's' : '') + '…';
    let left = items.length;
    for (const it of items) {
      try {
        const r = await API.call('upload', Object.assign({}, it.payload, { force: false }));
        if (r.duplicate && !isRecentMine(r.match)) await API.call('upload', Object.assign({}, it.payload, { force: true }));
        await API.Queue.remove(it.qid); left--;
      }
      catch (e) { if (e.offline) break; await API.Queue.remove(it.qid); left--; toast('A saved scan failed: ' + e.message, 5000); }
    }
    b.textContent = left ? left + ' scan' + (left > 1 ? 's' : '') + ' waiting for connection' : 'All saved scans uploaded';
    if (!left) setTimeout(() => { b.hidden = true; }, 3000);
    refreshMe();
  }
  window.addEventListener('online', flushQueue);

  /* ---------------- activity ---------------- */
  let actTab = 'uploads';
  async function openActivity(tab) {
    if (tab) actTab = tab;
    show('activity');
    $$('#seg-act button').forEach(b => b.classList.toggle('on', b.dataset.v === actTab));
    $('#act-uploads').hidden = actTab !== 'uploads';
    $('#act-reimb').hidden = actTab !== 'reimb';
    $('#pay-bar').hidden = true;
    if (actTab === 'uploads') loadUploads(); else loadReimb();
  }
  $('#seg-act').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openActivity(b.dataset.v); });

  async function loadUploads() {
    const el = $('#act-uploads');
    el.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const { items } = await API.call('recent', { limit: 40 });
      if (!items.length) { el.innerHTML = '<div class="empty">Nothing uploaded yet.</div>'; return; }
      el.innerHTML = items.map(it => {
        const where = it.book === 'props' ? it.property : 'Mistral Loom';
        const personal = /^Personal/.test(it.paidBy || '');
        const tag = it.url ? 'a' : 'div';
        return '<' + tag + ' class="row"' + (it.url ? ' href="' + esc(it.url) + '" target="_blank" rel="noopener"' : '') + '><div class="main"><div class="t">' + esc(it.supplier || 'Invoice') + (personal ? '<span class="pill">Refund</span>' : '') + '</div>' +
          '<div class="s">' + fmtDate(it.at) + ' · ' + esc(it.by) + ' · ' + esc(where) + '</div></div><div class="a">' + (it.amount ? eur(it.amount) : '') + '</div></' + tag + '>';
      }).join('');
    } catch (e) { el.innerHTML = '<div class="empty">' + esc(e.offline ? 'You are offline.' : e.message) + '</div>'; }
  }

  async function loadReimb() {
    const el = $('#act-reimb');
    el.innerHTML = '<div class="empty">Loading…</div>';
    S.selected.clear();
    try {
      const { items, totals } = await API.call('reimbursements');
      const approver = S.me.canApprove;
      const pending = items.filter(i => i.status === 'Pending'), paid = items.filter(i => i.status !== 'Pending');
      let html = '';
      const people = Object.keys(totals);
      if (approver) {
        html += people.length ? '<div class="totals">' + people.map(p => '<div class="card balance attention"><div><div class="lbl">Owed to ' + esc(p) + '</div><div class="amt">' + eur(totals[p]) + '</div></div><button class="btn primary" data-all="' + esc(p) + '">Select all</button></div>').join('') + '</div>'
          : '<div class="card balance"><div><div class="lbl">Reimbursements</div><div class="amt">All paid</div></div></div>';
      } else {
        const mine = totals[S.me.name] || 0;
        html += '<div class="card balance' + (mine ? ' attention' : '') + '"><div><div class="lbl">Owed to you</div><div class="amt">' + eur(mine) + '</div></div></div>';
      }
      if (pending.length) html += '<div class="group-title">Waiting</div>' + pending.map(r => rowR(r, approver)).join('');
      if (paid.length) html += '<div class="group-title">Paid</div>' + paid.slice(0, 30).map(r => rowR(r, false)).join('');
      if (!items.length) html += '<div class="empty">Receipts you paid yourself will appear here.</div>';
      el.innerHTML = html;
      el.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { pending.filter(r => r.person === b.dataset.all).forEach(r => S.selected.add(r.id)); syncSel(pending); });
      el.querySelectorAll('.row.selectable').forEach(row => row.onclick = (e) => { if (e.target.closest('a')) return; const id = row.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); syncSel(pending); });
      S.pendingItems = pending;
      syncSel(pending);
    } catch (e) { el.innerHTML = '<div class="empty">' + esc(e.offline ? 'You are offline.' : e.message) + '</div>'; }
  }
  function rowR(r, selectable) {
    const sub = r.status === 'Pending' ? fmtDate(r.date) + (S.me.canApprove ? ' · ' + esc(r.person) : '')
      : 'Paid ' + fmtDate(r.paidOn) + (r.method ? ' · ' + esc(r.method) : '') + (r.paidBy ? ' · by ' + esc(r.paidBy) : '');
    return '<div class="row ' + (selectable ? 'selectable' : '') + (r.status !== 'Pending' ? ' paid' : '') + '" data-id="' + esc(r.id) + '">' + (selectable ? '<span class="check"></span>' : '') +
      '<div class="main"><div class="t">' + esc(r.supplier || 'Receipt') + (r.status === 'Pending' ? '<span class="pill">Waiting</span>' : '<span class="pill paid">Paid</span>') + '</div><div class="s">' + sub +
      (r.receipt ? ' · <a href="' + esc(r.receipt) + '" target="_blank" rel="noopener">receipt</a>' : '') + '</div></div><div class="a">' + eur(r.amount) + '</div></div>';
  }
  function syncSel(pending) {
    $$('#act-reimb .row.selectable').forEach(r => r.classList.toggle('sel', S.selected.has(r.dataset.id)));
    const total = pending.filter(r => S.selected.has(r.id)).reduce((a, r) => a + r.amount, 0);
    $('#pay-bar').hidden = !S.selected.size;
    $('#btn-pay').textContent = 'Mark paid · ' + eur(total);
  }

  $('#btn-pay').addEventListener('click', () => {
    const items = (S.pendingItems || []).filter(r => S.selected.has(r.id));
    const total = items.reduce((a, r) => a + r.amount, 0);
    const people = Array.from(new Set(items.map(r => r.person))).join(', ');
    let method = store.get('payMethod', 'Cash'); let proof = null;
    const s = sheet('<h2>Paid ' + esc(people) + ' ' + eur(total) + '?</h2><p class="muted">' + items.length + ' receipt' + (items.length > 1 ? 's' : '') + '</p>' +
      '<div class="chips" id="sh-methods">' + ['Cash', 'Revolut', 'Bank transfer', 'Other'].map(m => '<button class="chip' + (m === method ? ' on' : '') + '" data-m="' + m + '">' + m + '</button>').join('') + '</div>' +
      '<button class="btn ghost block" id="sh-proof">Attach proof of payment (optional)</button>' +
      '<button class="btn primary block big" id="sh-confirm">Confirm paid</button>');
    s.querySelector('#sh-methods').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; method = b.dataset.m; s.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); };
    s.querySelector('#sh-proof').onclick = () => {
      const inp = $('#in-proof');
      inp.onchange = async () => {
        const f = inp.files[0]; inp.value = ''; if (!f) return;
        if (f.type === 'application/pdf') proof = { b64: await fileToB64(f), mime: 'application/pdf' };
        else { const c = await loadImage(f); const sc = Scanner.makeCanvas(Math.round(c.width * Math.min(1, 1600 / Math.max(c.width, c.height))), Math.round(c.height * Math.min(1, 1600 / Math.max(c.width, c.height)))); sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height); proof = { b64: sc.toDataURL('image/jpeg', 0.75).split(',')[1], mime: 'image/jpeg' }; }
        s.querySelector('#sh-proof').textContent = '✓ Proof attached';
      };
      inp.click();
    };
    s.querySelector('#sh-confirm').onclick = async () => {
      store.set('payMethod', method);
      closeSheet(); busy(true, 'Saving…');
      try {
        const r = await API.call('markPaid', { ids: items.map(i => i.id), method, proof });
        busy(false); toast('Marked ' + eur(r.total) + ' as paid');
        refreshMe(); loadReimb();
      } catch (e) { busy(false); toast(e.message, 4000); }
    };
  });

  /* ---------------- service worker ---------------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  start();
})();
