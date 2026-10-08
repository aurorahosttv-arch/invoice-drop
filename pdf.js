/* Invoice Drop – tiny PDF writer: one JPEG per page, no libraries. */
(function (global) {
  'use strict';
  function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

  // pages: [{ jpeg: Uint8Array, width, height }]  -> Uint8Array (PDF)
  function build(pages) {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offsets = [];
    const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { offsets[n] = len; push(n + ' 0 obj\n'); body(); push('\nendobj\n'); };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const nPages = pages.length;
    const pageObj = (i) => 3 + i * 3, contObj = (i) => 4 + i * 3, imgObj = (i) => 5 + i * 3;
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Count ' + nPages + ' /Kids [' + pages.map((_, i) => pageObj(i) + ' 0 R').join(' ') + '] >>'));
    pages.forEach((p, i) => {
      const W = 595.28, H = +(W * p.height / p.width).toFixed(2); // A4 width, keep aspect
      obj(pageObj(i), () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im' + i + ' ' + imgObj(i) + ' 0 R >> >> /Contents ' + contObj(i) + ' 0 R >>'));
      const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im' + i + ' Do Q';
      obj(contObj(i), () => push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));
      obj(imgObj(i), () => { push('<< /Type /XObject /Subtype /Image /Width ' + p.width + ' /Height ' + p.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n'); push(p.jpeg); push('\nendstream'); });
    });
    const total = 3 + nPages * 3;
    const xref = len;
    let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function canvasToPage(canvas, quality) {
    const url = canvas.toDataURL('image/jpeg', quality || 0.72);
    return { jpeg: b64ToBytes(url.split(',')[1]), width: canvas.width, height: canvas.height };
  }

  function bytesToB64(bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  global.MiniPDF = { build, canvasToPage, bytesToB64, b64ToBytes };
})(window);
