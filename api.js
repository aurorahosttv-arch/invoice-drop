/* Invoice Drop – API client (+ demo backend when no URL is configured) */
(function (global) {
  'use strict';
  const URL_ = global.INVOICE_DROP_API || '';
  const demo = !/^https:\/\/script\.google\.com\//.test(URL_);

  async function call(action, payload) {
    const key = localStorage.getItem('id.key') || '';
    const body = Object.assign({ key, action }, payload || {});
    if (demo) return Demo.handle(body);
    let res;
    try {
      res = await fetch(URL_, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
    } catch (e) {
      const err = new Error('No connection'); err.offline = true; throw err;
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('Unexpected server response'); }
    if (!data.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  /* ---------------- Demo backend (in-memory, per device; mirrors the real one) ---------------- */
  const Demo = (function () {
    const USERS = {
      DEMO: { name: 'David', role: 'admin', books: ['props', 'ml', 'pv'] },
      DEMOB: { name: 'Eric', role: 'approver', books: ['ml'] },
      DEMOH: { name: 'Fiorentina', role: 'staff', books: ['ml'] },
    };
    const load = () => { try { const s = JSON.parse(localStorage.getItem('id.demo2') || 'null'); if (s && s.up) { s.ev = s.ev || [{ id: 'EV-01', name: 'Medtech World Malta 2026', status: 'Open' }, { id: 'EV-02', name: 'MEDICA 2026', status: 'Open' }]; s.files = s.files || {}; return s; } return { up: [], files: {}, ev: [{ id: 'EV-01', name: 'Medtech World Malta 2026', status: 'Open' }, { id: 'EV-02', name: 'MEDICA 2026', status: 'Open' }] }; } catch (e) { return { up: [], files: {}, ev: [] }; } };
    const save = (s) => { try { localStorage.setItem('id.demo2', JSON.stringify(s)); } catch (e) { /* ignore */ } };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const sum = (rows) => Math.round(rows.reduce((a, r) => a + (r.amount || 0), 0) * 100) / 100;
    const today = () => new Date().toISOString().slice(0, 10);
    async function handle(b) {
      await sleep(300);
      const u = USERS[String(b.key).toUpperCase()];
      if (!u) throw new Error('Unknown access code (demo codes: DEMO, DEMOB, DEMOH)');
      const s = load();
      const canApprove = u.role !== 'staff';
      const mineBooks = s.up.filter(x => u.books.indexOf(x.book) >= 0);
      const open = mineBooks.filter(x => x.payment === 'Not paid' || x.payment === 'To reimburse');
      if (b.action === 'me') {
        const out = { ok: true, name: u.name, role: u.role, books: u.books, canApprove, demo: true,
          owedToMe: sum(open.filter(r => r.payment === 'To reimburse' && r.paidBy === u.name)) };
        if (canApprove) out.outstanding = { count: open.length, total: sum(open), overdue: open.filter(r => r.payment === 'Not paid' && r.due && r.due < today()).length };
        return out;
      }
      const pvOk = u.books.indexOf('pv') >= 0;
      const evSum = () => s.ev.map(e => { const mine = s.up.filter(r => r.book === 'pv' && r.event === e.id); const claim = mine.filter(r => r.payment === 'To reimburse' || r.payment === 'Reimbursed');
        return Object.assign({}, e, { receipts: mine.length, claimCount: claim.length, claimTotal: sum(claim), openCount: mine.filter(r => r.payment === 'To reimburse').length, openTotal: sum(mine.filter(r => r.payment === 'To reimburse')), companyPaid: sum(mine.filter(r => r.payment === 'Paid')), folder: '', sheet: '' }); });
      if (b.action === 'events') { if (!pvOk) throw new Error('No access'); return { ok: true, events: evSum(), types: ['Flights', 'Hotel', 'Restaurant', 'Taxi', 'Tickets', 'Parking', 'Other'] }; }
      if (b.action === 'createEvent') {
        if (!pvOk) throw new Error('No access');
        if (s.ev.some(e => e.name.toLowerCase() === String(b.name).toLowerCase())) throw new Error('An event with this name already exists');
        const ev = { id: 'EV-' + String(s.ev.length + 1).padStart(2, '0'), name: b.name, status: 'Open' }; s.ev.push(ev); save(s); return { ok: true, event: ev };
      }
      if (b.action === 'declarationData') {
        let lines, concerning;
        if (b.event) { const ev = s.ev.find(e => e.id === b.event); lines = s.up.filter(r => r.book === 'pv' && r.event === b.event && r.payment !== 'Paid'); concerning = ev.name; }
        else { lines = s.up.filter(r => r.id === b.id); concerning = (lines[0].supplier ? lines[0].supplier + ' – ' : '') + lines[0].type; }
        if (!lines.length) throw new Error('No personally paid receipts to declare yet');
        lines = lines.slice().sort((a, z) => (a.receiptDate < z.receiptDate ? -1 : 1));
        const d = new Date();
        return { ok: true, header: { company: ['PROVINCI SABEAIR B.V.', 'Prinses Margrietplantsoen 33,', '2595AM, The Hague', 'The Netherlands', '+31 641707512', 'info@provinci-medtech.com', 'www.veressplus.com'], companyName: 'ProVinci Sabeair B.V.', claimant: 'David Cefai',
          date: d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'long' }) + ' ' + d.getFullYear(), concerning },
          lines: lines.map((r, i) => ({ n: i + 1, id: r.id, date: r.receiptDate.slice(8, 10) + '/' + r.receiptDate.slice(5, 7) + '/' + r.receiptDate.slice(2, 4), description: r.type + (r.supplier ? ' – ' + r.supplier : ''), amount: r.amount, comment: r.note, fileName: r.id + '.pdf', mime: (s.files[r.id] || {}).mime || '', b64: (s.files[r.id] || {}).b64 || '' })) };
      }
      if (b.action === 'saveDeclaration') {
        window.__lastDeclaration = b.pdf.b64;
        if (b.event) { const ev = s.ev.find(e => e.id === b.event); ev.status = 'Declared'; ev.declaration = 'about:blank'; save(s); return { ok: true, url: '', name: 'Expense Declaration - ' + ev.name + '.pdf' }; }
        s.up.forEach(r => { if (r.id === b.id) r.declaration = 'Expense Declaration'; }); save(s); return { ok: true, url: '', name: 'Expense Declaration - ' + b.id + '.pdf' };
      }
      if (b.action === 'upload' && b.book === 'pv') {
        if (!pvOk) throw new Error('No access to this book');
        const personal = b.payment !== 'company'; const amount = Number(String(b.amount || '').replace(',', '.')) || 0;
        if (personal && !(amount > 0)) throw new Error('Amount is required when you paid personally');
        const id = 'PV-' + String(s.up.filter(x => x.book === 'pv').length + 1).padStart(4, '0');
        const ev = s.ev.find(e => e.id === b.event);
        if (ev && ev.status === 'Declared') ev.status = 'Open';
        s.up.unshift({ id, at: new Date().toISOString(), by: u.name, book: 'pv', property: '', payment: personal ? 'To reimburse' : 'Paid', amount, supplier: b.supplier || '', note: b.note || '', url: '',
          paidBy: personal ? u.name : 'ProVinci', event: ev ? ev.id : 'One-off', receiptDate: b.receiptDate, type: b.type, settledOn: '', settledBy: '', method: '' });
        s.files[id] = b.file; save(s);
        return { ok: true, id, fileName: id + '.pdf', url: '', status: personal ? 'To reimburse' : 'Paid', event: ev ? ev.name : 'One-off' };
      }
      if (b.action === 'upload') {
        if (u.books.indexOf(b.book) < 0) throw new Error('No access to this book');
        let pay = u.role === 'staff' ? 'personal' : (b.payment || 'paid');
        if (b.book === 'props' && pay === 'personal') pay = 'paid';
        const status = pay === 'unpaid' ? 'Not paid' : pay === 'personal' ? 'To reimburse' : 'Paid';
        const amount = Number(String(b.amount || '').replace(',', '.')) || 0;
        if (status !== 'Paid' && !(amount > 0)) throw new Error('Amount is required');
        if (!b.force && amount > 0) {
          const d = s.up.find(x => x.book === b.book && x.amount === amount && (!b.supplier || !x.supplier || x.supplier.toLowerCase() === String(b.supplier).toLowerCase()));
          if (d) return { ok: true, duplicate: true, match: d };
        }
        const prefix = b.book === 'props' ? 'P' : 'ML';
        const id = prefix + '-' + String(s.up.filter(x => x.book === b.book).length + 1).padStart(4, '0');
        s.up.unshift({ id, at: new Date().toISOString(), by: u.name, book: b.book, property: b.book === 'props' ? ({ V: 'Valletta', G: 'Gzira' }[b.property] || 'Unknown') : '',
          payment: status, amount, supplier: b.supplier || '', note: b.note || '', url: '', due: status === 'Not paid' ? (b.dueDate || '') : '',
          paidBy: status === 'To reimburse' ? u.name : status === 'Paid' && b.book === 'ml' ? 'Company' : '', settledOn: '', settledBy: '', method: '' });
        save(s);
        return { ok: true, id, fileName: id + '.pdf', url: '', status };
      }
      if (b.action === 'recent') return { ok: true, items: mineBooks.filter(x => canApprove || x.by === u.name).slice(0, b.limit || 30) };
      if (b.action === 'outstanding') {
        let items = open, settled = mineBooks.filter(x => x.settledOn);
        if (!canApprove) { items = items.filter(r => r.paidBy === u.name); settled = settled.filter(r => r.paidBy === u.name && r.payment === 'Reimbursed'); }
        const reimburse = {}; items.filter(r => r.payment === 'To reimburse').forEach(r => { reimburse[r.paidBy] = (reimburse[r.paidBy] || 0) + r.amount; });
        items = items.slice().sort((a, z) => (a.payment === z.payment ? 0 : a.payment === 'Not paid' ? -1 : 1));
        return { ok: true, items, events: pvOk ? evSum() : undefined, settled: settled.sort((a, z) => (a.settledOn < z.settledOn ? 1 : -1)), totals: { unpaid: sum(items.filter(r => r.payment === 'Not paid')), reimburse } };
      }
      if (b.action === 'settle') {
        if (!canApprove) throw new Error('Only David or Eric can close outstanding items');
        const ids = [].concat(b.ids || []); let total = 0; const done = [];
        s.up.forEach(r => {
          if (ids.indexOf(r.id) < 0) return;
          if (b.kind === 'paid' && r.payment === 'Not paid') {
            if (r.book === 'ml' && b.via === 'personal') { r.payment = 'To reimburse'; r.paidBy = u.name; r.method = 'Paid personally'; }
            else { r.payment = 'Paid'; r.paidBy = r.book === 'ml' ? 'Company' : u.name; r.settledOn = new Date().toISOString(); r.settledBy = u.name; r.method = b.method || ''; }
          } else if (b.kind === 'reimbursed' && r.payment === 'To reimburse') {
            r.payment = 'Reimbursed'; r.settledOn = new Date().toISOString(); r.settledBy = u.name; r.method = b.method || '';
          } else return;
          total += r.amount; done.push(r.id);
        });
        if (!done.length) throw new Error('These items are already closed or were not found');
        s.ev.forEach(e => { const mine = s.up.filter(r => r.event === e.id); if (mine.length && !mine.some(r => r.payment === 'To reimburse') && mine.some(r => r.payment === 'Reimbursed')) e.status = 'Reimbursed'; });
        save(s);
        return { ok: true, done, total };
      }
      throw new Error('Unknown action');
    }
    return { handle };
  })();

  /* ---------------- Offline queue (IndexedDB) ---------------- */
  const Queue = (function () {
    let dbp;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open('invoice-drop', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'qid', autoIncrement: true });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const d = await db();
      return new Promise((res, rej) => { const t = d.transaction('q', mode); const st = t.objectStore('q'); const out = fn(st); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
    }
    return {
      add: (item) => tx('readwrite', st => st.add(item)),
      all: () => tx('readonly', st => st.getAll()),
      remove: (qid) => tx('readwrite', st => st.delete(qid)),
    };
  })();

  global.API = { call, demo, Queue };
})(window);
