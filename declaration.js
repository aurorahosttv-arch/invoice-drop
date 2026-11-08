/* Invoice Drop – ProVinci Expense Declaration builder
 * Builds ONE self-contained PDF: the declaration page(s) followed by every receipt.
 * Each line on the declaration is an internal link to its receipt page, so the links keep
 * working after the PDF is downloaded, emailed or uploaded to another Drive.
 */
(function (global) {
  'use strict';
  const NAVY = [0.122, 0.165, 0.267];
  const LINK = [0.10, 0.36, 0.85];
  const GREY = [0.92, 0.92, 0.92];
  const LINE = [0.80, 0.80, 0.80];
  const A4 = [595.28, 841.89];

  function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function money(n) { return '€ ' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  async function build(data, logoBytes) {
    const L = global.PDFLib;
    const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFNumber } = L;
    const col = (c) => rgb(c[0], c[1], c[2]);
    const doc = await PDFDocument.create();
    doc.setTitle('Expense Declaration - ' + data.header.concerning);
    doc.setAuthor(data.header.claimant);
    doc.setSubject(data.header.companyName);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let logo = null;
    try { if (logoBytes) logo = await doc.embedPng(logoBytes); } catch (e) { logo = null; }

    // keep only characters the standard font can draw
    const safe = (s) => Array.from(String(s == null ? '' : s)).map(ch => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
    const fit = (s, f, size, w) => { s = safe(s); if (f.widthOfTextAtSize(s, size) <= w) return s; while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > w) s = s.slice(0, -1); return s + '…'; };

    /* ---------------- declaration pages ---------------- */
    const [W, H] = A4;
    const X0 = 60, X1 = W - 60;
    const cols = [{ k: 'n', w: 26 }, { k: 'date', w: 62, t: 'Date' }, { k: 'desc', w: 178, t: 'Description' }, { k: 'amt', w: 74, t: 'Amount' }, { k: 'com', w: X1 - X0 - 26 - 62 - 178 - 74, t: 'Comments' }];
    const ROW = 22;
    const linkSpots = []; // { page, rect, lineIndex }
    const pages = [];

    function frame(first) {
      const p = doc.addPage(A4);
      pages.push(p);
      let y = H - 50;
      if (logo) { const lw = first ? 140 : 100; const lh = lw * logo.height / logo.width; p.drawImage(logo, { x: X0, y: y - lh - 10, width: lw, height: lh }); }
      const c = data.header.company || [];
      if (first) {
        c.forEach((t, i) => { const f = i < 4 ? bold : font; const sz = i < 4 ? 8.5 : 8; const tw = f.widthOfTextAtSize(safe(t), sz); p.drawText(safe(t), { x: X1 - tw, y: y - 10 - i * 11, size: sz, font: f, color: col(NAVY) }); });
        y -= 10 + c.length * 11 + 6;
      } else {
        const t = 'Expense Declaration - ' + data.header.concerning + ' (continued)';
        const tw = bold.widthOfTextAtSize(safe(t), 9); p.drawText(safe(t), { x: X1 - tw, y: y - 30, size: 9, font: bold, color: col(NAVY) });
        y -= 50;
      }
      p.drawRectangle({ x: X0, y: y, width: X1 - X0, height: 3, color: col(NAVY) });
      p.drawRectangle({ x: 0, y: 0, width: W, height: 30, color: col(NAVY) });
      return { p, y: y - 20 };
    }

    let { p, y } = frame(true);
    const title = 'EXPENSE DECLARATION';
    y -= 30;
    p.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 13)) / 2, y, size: 13, font: bold });
    y -= 40;
    const kv = [['Company Name:', data.header.companyName], ['Name of Claimant:', data.header.claimant], ['Date:', data.header.date]];
    kv.forEach(([k, v]) => { p.drawText(k, { x: X0, y, size: 10.5, font }); p.drawText(safe(v), { x: X0 + 120, y, size: 10.5, font }); y -= 15; });
    y -= 12;
    p.drawText('Refund concerning', { x: X0, y, size: 10.5, font });
    p.drawText(fit(data.header.concerning, bold, 10.5, X1 - X0 - 120), { x: X0 + 120, y, size: 10.5, font: bold });
    y -= 30;

    function tableHeader() {
      p.drawRectangle({ x: X0, y: y - ROW, width: X1 - X0, height: ROW, color: col(GREY), borderColor: col(LINE), borderWidth: 0.6 });
      let x = X0;
      cols.forEach(c => { if (c.t) p.drawText(c.t, { x: x + 6, y: y - ROW + 7, size: 10, font }); x += c.w; });
      y -= ROW;
    }
    function rowBox(fillTotal) {
      p.drawRectangle({ x: X0, y: y - ROW, width: X1 - X0, height: ROW, borderColor: col(LINE), borderWidth: 0.6, color: fillTotal ? undefined : undefined });
      let x = X0; cols.slice(0, -1).forEach(c => { x += c.w; p.drawLine({ start: { x, y }, end: { x, y: y - ROW }, thickness: 0.6, color: col(LINE) }); });
    }
    tableHeader();
    let total = 0;
    data.lines.forEach((ln, i) => {
      if (y - ROW < 80) { ({ p, y } = frame(false)); tableHeader(); }
      rowBox();
      let x = X0;
      const nTxt = String(ln.n || i + 1);
      p.drawText(nTxt, { x: x + cols[0].w - 6 - font.widthOfTextAtSize(nTxt, 10), y: y - ROW + 7, size: 10, font }); x += cols[0].w;
      p.drawText(safe(ln.date), { x: x + 6, y: y - ROW + 7, size: 10, font }); x += cols[1].w;
      const d = fit(ln.description, font, 10, cols[2].w - 12);
      const hasFile = !!ln.b64;
      p.drawText(d, { x: x + 6, y: y - ROW + 7, size: 10, font, color: hasFile ? col(LINK) : rgb(0, 0, 0) });
      if (hasFile) {
        const dw = font.widthOfTextAtSize(d, 10);
        p.drawLine({ start: { x: x + 6, y: y - ROW + 5.5 }, end: { x: x + 6 + dw, y: y - ROW + 5.5 }, thickness: 0.6, color: col(LINK) });
        linkSpots.push({ page: p, rect: [x + 2, y - ROW + 2, x + 10 + dw, y - 2], line: i });
      }
      x += cols[2].w;
      p.drawText(money(ln.amount), { x: x + 6, y: y - ROW + 7, size: 10, font }); x += cols[3].w;
      p.drawText(fit(ln.comment, font, 9, cols[4].w - 12), { x: x + 6, y: y - ROW + 7, size: 9, font });
      total += Number(ln.amount) || 0;
      y -= ROW;
    });
    if (y - ROW < 80) ({ p, y } = frame(false));
    rowBox();
    p.drawText('TOTAL', { x: X0 + cols[0].w + 6, y: y - ROW + 7, size: 10.5, font: bold });
    p.drawText(money(total), { x: X0 + cols[0].w + cols[1].w + cols[2].w + 6, y: y - ROW + 7, size: 10.5, font: bold });
    y -= ROW + 18;
    if (y > 100) p.drawText('Receipts are attached on the following pages. Click a description to jump to its receipt.', { x: X0, y, size: 8, font, color: rgb(0.43, 0.44, 0.46) });

    /* ---------------- receipts ---------------- */
    const targets = [];
    const firstRef = pages[0].ref;
    for (let i = 0; i < data.lines.length; i++) {
      const ln = data.lines[i];
      const label = 'Receipt ' + (ln.n || i + 1) + '  ·  ' + ln.date + '  ·  ' + ln.description + '  ·  ' + money(ln.amount);
      let first = null;
      try {
        if (!ln.b64) throw new Error('missing');
        const bytes = b64ToBytes(ln.b64);
        if (/pdf/.test(ln.mime)) {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const copied = await doc.copyPages(src, src.getPageIndices());
          copied.forEach((cp, k) => { doc.addPage(cp); if (k === 0) first = cp; });
        } else {
          const img = /png/.test(ln.mime) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const pg = doc.addPage(A4);
          const maxW = W - 60, maxH = H - 90;
          const s = Math.min(maxW / img.width, maxH / img.height);
          pg.drawImage(img, { x: (W - img.width * s) / 2, y: (H - 50 - img.height * s), width: img.width * s, height: img.height * s });
          first = pg;
        }
      } catch (e) {
        const pg = doc.addPage(A4);
        pg.drawText('Receipt could not be embedded automatically.', { x: 60, y: H - 120, size: 12, font: bold });
        pg.drawText(safe('Original file: ' + (ln.fileName || 'not found')), { x: 60, y: H - 140, size: 10, font });
        first = pg;
      }
      // stamp
      const { width: pw, height: ph } = first.getSize();
      const sz = 8;
      const t = fit(label, bold, sz, pw - 40);
      const tw = bold.widthOfTextAtSize(t, sz);
      first.drawRectangle({ x: 12, y: ph - 24, width: tw + 16, height: 16, color: rgb(1, 1, 1), opacity: 0.92, borderColor: col(NAVY), borderWidth: 0.6 });
      first.drawText(t, { x: 20, y: ph - 19, size: sz, font: bold, color: col(NAVY) });
      addLink(first, [12, ph - 24, 12 + tw + 16, ph - 8], firstRef); // stamp jumps back to the declaration
      targets[i] = first.ref;
    }
    linkSpots.forEach(s => addLink(s.page, s.rect, targets[s.line]));

    function addLink(page, rect, destRef) {
      if (!destRef) return;
      const annot = doc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
        Dest: [destRef, PDFName.of('XYZ'), null, null, null],
      });
      const ref = doc.context.register(annot);
      let annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
      annots.push(ref);
    }

    return doc.save();
  }

  let libPromise = null;
  function ensureLib() {
    if (global.PDFLib) return Promise.resolve();
    if (!libPromise) libPromise = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'pdf-lib.min.js?v=4'; s.onload = res; s.onerror = () => { libPromise = null; rej(new Error('Could not load the PDF tool')); }; document.head.appendChild(s); });
    return libPromise;
  }
  async function loadLogo() {
    try { const r = await fetch('icons/provinci-logo.png'); return new Uint8Array(await r.arrayBuffer()); } catch (e) { return null; }
  }

  global.Declaration = { build, ensureLib, loadLogo };
})(window);
