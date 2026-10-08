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

  /* ---------------- Demo backend (in-memory, per device) ---------------- */
  const Demo = (function () {
    const USERS = {
      DEMO: { name: 'David', role: 'admin', books: ['props', 'ml'] },
      DEMOB: { name: 'Brother', role: 'approver', books: ['ml'] },
      DEMOH: { name: 'Housekeeper', role: 'staff', books: ['ml'] },
    };
    const load = () => { try { return JSON.parse(localStorage.getItem('id.demo') || '{"up":[],"rb":[]}'); } catch (e) { return { up: [], rb: [] }; } };
    const save = (s) => { try { localStorage.setItem('id.demo', JSON.stringify(s)); } catch (e) { /* ignore */ } };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function handle(b) {
      await sleep(350);
      const u = USERS[String(b.key).toUpperCase()];
      if (!u) throw new Error('Unknown access code (demo codes: DEMO, DEMOB, DEMOH)');
      const s = load();
      const canApprove = u.role !== 'staff';
      if (b.action === 'me') {
        const pend = s.rb.filter(r => r.status === 'Pending');
        return { ok: true, name: u.name, role: u.role, books: u.books, canApprove, demo: true,
          owedToMe: pend.filter(r => r.person === u.name).reduce((a, r) => a + r.amount, 0),
          pendingCount: canApprove ? pend.length : undefined };
      }
      if (b.action === 'upload') {
        if (u.books.indexOf(b.book) < 0) throw new Error('No access to this book');
        const amount = Number(String(b.amount || '').replace(',', '.')) || 0;
        const personal = b.book === 'ml' && b.paidBy === 'personal';
        if (personal && !(amount > 0)) throw new Error('Amount is required when you paid personally');
        if (!b.force && amount > 0) {
          const d = s.up.find(x => x.amount === amount && (!b.supplier || !x.supplier || x.supplier.toLowerCase() === String(b.supplier).toLowerCase()));
          if (d) return { ok: true, duplicate: true, match: d };
        }
        const prefix = b.book === 'props' ? 'P' : 'ML';
        const id = prefix + '-' + String(s.up.filter(x => x.book === b.book).length + 1).padStart(4, '0');
        const item = { id, at: new Date().toISOString(), by: u.name, book: b.book, property: b.book === 'props' ? ({ V: 'Valletta', G: 'Gzira' }[b.property] || 'Unknown') : '',
          paidBy: personal ? 'Personal (' + u.name + ')' : 'Company', amount: amount || null, supplier: b.supplier || '', note: b.note || '', url: '', status: 'New' };
        s.up.unshift(item);
        if (personal) s.rb.unshift({ id, date: item.at, person: u.name, amount, supplier: b.supplier || '', receipt: '', status: 'Pending', paidOn: '', paidBy: '', method: '' });
        save(s);
        return { ok: true, id, fileName: id + '.pdf', url: '', reimbursable: personal };
      }
      if (b.action === 'recent') return { ok: true, items: s.up.filter(x => u.books.indexOf(x.book) >= 0 && (canApprove || x.by === u.name)).slice(0, b.limit || 30) };
      if (b.action === 'reimbursements') {
        const items = s.rb.filter(r => canApprove || r.person === u.name);
        const totals = {}; items.filter(r => r.status === 'Pending').forEach(r => { totals[r.person] = (totals[r.person] || 0) + r.amount; });
        items.sort((a, z) => (a.status === z.status ? 0 : a.status === 'Pending' ? -1 : 1));
        return { ok: true, items, totals };
      }
      if (b.action === 'markPaid') {
        if (!canApprove) throw new Error('Only David or his brother can mark items as paid');
        const ids = [].concat(b.ids || []); let total = 0;
        s.rb.forEach(r => { if (ids.indexOf(r.id) >= 0 && r.status === 'Pending') { r.status = 'Paid'; r.paidOn = new Date().toISOString(); r.paidBy = u.name; r.method = b.method; total += r.amount; } });
        save(s);
        return { ok: true, paid: ids, total };
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
