/* Invoice Drop – document scanner (no external libraries)
 * detectQuad(canvas)            -> [{x,y} x4] corners (TL, TR, BR, BL) in canvas pixels
 * warp(srcCanvas, quad, maxSide) -> new canvas, perspective-corrected
 * enhance(canvas, mode)          -> new canvas ('scan' | 'bw' | 'original')
 */
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function downscale(src, maxSide) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = makeCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { canvas: c, scale: s };
  }

  function boxBlur(a, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function otsu(a) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < a.length; i++) hist[Math.max(0, Math.min(255, a[i] | 0))]++;
    const total = a.length; let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
  function triArea(a, b, c) { return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2; }

  // Largest-area quadrilateral with vertices on the convex hull.
  function maxQuad(hull) {
    let h = hull;
    if (h.length > 60) { const step = h.length / 60; h = []; for (let i = 0; i < 60; i++) h.push(hull[Math.floor(i * step)]); }
    const n = h.length;
    if (n < 4) return null;
    let best = -1, quad = null;
    for (let i = 0; i < n; i++) {
      for (let k = i + 2; k < n; k++) {
        let bj = -1, aj = -1;
        for (let j = i + 1; j < k; j++) { const a = triArea(h[i], h[j], h[k]); if (a > aj) { aj = a; bj = j; } }
        let bl = -1, al = -1;
        for (let l = k + 1; l < n + i; l++) { const p = h[l % n]; if (l % n === i) continue; const a = triArea(h[i], p, h[k]); if (a > al) { al = a; bl = l % n; } }
        if (bj < 0 || bl < 0) continue;
        if (aj + al > best) { best = aj + al; quad = [h[i], h[bj], h[k], h[bl]]; }
      }
    }
    return quad;
  }

  function orderCorners(q) {
    const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
    const sorted = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    // start from the corner closest to top-left (smallest x+y)
    let start = 0; for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
    return [0, 1, 2, 3].map(i => sorted[(start + i) % 4]); // TL, TR, BR, BL (clockwise in screen coords)
  }

  function defaultQuad(w, h) {
    const m = 0.06;
    return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];
  }

  /* ---------- detection ---------- */
  function detectQuad(src) {
    const W = src.width, H = src.height;
    try {
      const { canvas, scale } = downscale(src, 360);
      const w = canvas.width, h = canvas.height;
      const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      // "paperness": bright and unsaturated
      const p = new Float32Array(w * h);
      for (let i = 0, j = 0; i < p.length; i++, j += 4) {
        const r = d[j], g = d[j + 1], b = d[j + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        p[i] = Math.max(0, (0.299 * r + 0.587 * g + 0.114 * b) - 0.8 * (mx - mn));
      }
      const blurred = boxBlur(p, w, h, 2);
      const thr = otsu(blurred);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = blurred[i] > thr ? 1 : 0;

      // connected components (4-neighbour), keep the best one
      const label = new Int32Array(w * h); let best = null; let next = 1;
      const stack = new Int32Array(w * h);
      for (let s = 0; s < mask.length; s++) {
        if (!mask[s] || label[s]) continue;
        let top = 0; stack[top++] = s; label[s] = next;
        let area = 0, sx = 0, sy = 0, touch = 0;
        while (top) {
          const i = stack[--top]; const x = i % w, y = (i / w) | 0;
          area++; sx += x; sy += y;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch++;
          if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
          if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
          if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
          if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
        }
        const cx = sx / area / w - 0.5, cy = sy / area / h - 0.5;
        const score = area * (1 - Math.min(0.6, Math.hypot(cx, cy))) * (touch > (w + h) * 0.8 ? 0.3 : 1);
        if (!best || score > best.score) best = { id: next, area, score };
        next++;
      }
      if (!best || best.area < w * h * 0.08) return { quad: defaultQuad(W, H), found: false };

      // boundary points of the component
      const pts = [];
      for (let y = 0; y < h; y++) {
        let first = -1, last = -1;
        for (let x = 0; x < w; x++) if (label[y * w + x] === best.id) { if (first < 0) first = x; last = x; }
        if (first >= 0) { pts.push({ x: first, y }); pts.push({ x: last + 1, y }); }
      }
      const hull = convexHull(pts);
      const q = maxQuad(hull);
      if (!q) return { quad: defaultQuad(W, H), found: false };
      const quadArea = polyArea(q);
      // reject if the quad is a poor fit for the region (e.g. irregular blob)
      if (quadArea < w * h * 0.08 || best.area / quadArea < 0.75) return { quad: defaultQuad(W, H), found: false };
      const ordered = orderCorners(q).map(pt => ({ x: Math.max(0, Math.min(W, pt.x / scale)), y: Math.max(0, Math.min(H, pt.y / scale)) }));
      return { quad: ordered, found: true };
    } catch (e) {
      console.warn('detect failed', e);
      return { quad: defaultQuad(W, H), found: false };
    }
  }

  /* ---------- perspective warp ---------- */
  // Solve homography mapping unit-square-ish dst rect -> src quad
  function homography(src, dst) {
    // returns H such that src = H * dst
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x: X, y: Y } = dst[i], { x, y } = src[i];
      A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.push(x);
      A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.push(y);
    }
    // Gaussian elimination
    const n = 8;
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const hm = b.map((v, i) => v / A[i][i]);
    return [hm[0], hm[1], hm[2], hm[3], hm[4], hm[5], hm[6], hm[7], 1];
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function warp(src, quad, maxSide) {
    maxSide = maxSide || 1800;
    // pull corners 0.6% towards the centre so no background sliver survives
    const qcx = quad.reduce((a, p) => a + p.x, 0) / 4, qcy = quad.reduce((a, p) => a + p.y, 0) / 4;
    quad = quad.map(p => ({ x: p.x + (qcx - p.x) * 0.012, y: p.y + (qcy - p.y) * 0.012 }));
    const [tl, tr, br, bl] = quad;
    let ow = Math.max(dist(tl, tr), dist(bl, br));
    let oh = Math.max(dist(tl, bl), dist(tr, br));
    const s = Math.min(1, maxSide / Math.max(ow, oh));
    ow = Math.max(1, Math.round(ow * s)); oh = Math.max(1, Math.round(oh * s));
    const Hm = homography(quad, [{ x: 0, y: 0 }, { x: ow, y: 0 }, { x: ow, y: oh }, { x: 0, y: oh }]);

    const sctx = src.getContext('2d', { willReadFrequently: true });
    const sd = sctx.getImageData(0, 0, src.width, src.height).data;
    const SW = src.width, SH = src.height;
    const out = makeCanvas(ow, oh);
    const octx = out.getContext('2d');
    const img = octx.createImageData(ow, oh);
    const od = img.data;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const X = x + 0.5, Y = y + 0.5;
        const den = Hm[6] * X + Hm[7] * Y + 1;
        let sx = (Hm[0] * X + Hm[1] * Y + Hm[2]) / den - 0.5;
        let sy = (Hm[3] * X + Hm[4] * Y + Hm[5]) / den - 0.5;
        if (sx < 0) sx = 0; if (sy < 0) sy = 0; if (sx > SW - 1.001) sx = SW - 1.001; if (sy > SH - 1.001) sy = SH - 1.001;
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
        const o = (y * ow + x) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
          const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          od[o + c] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  /* ---------- enhancement ---------- */
  function rotate(src, quarterTurns) {
    const t = ((quarterTurns % 4) + 4) % 4;
    if (!t) return src;
    const c = makeCanvas(t % 2 ? src.height : src.width, t % 2 ? src.width : src.height);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(t * Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  function enhance(src, mode) {
    if (mode === 'original') return src;
    const w = src.width, h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const px = d.data;
    // Background (paper) brightness map from a small, heavily blurred copy of the luminance
    const small = downscale(src, 96);
    const sw = small.canvas.width, sh = small.canvas.height;
    const sdat = small.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const lum = new Float32Array(sw * sh);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = Math.max(sdat[j], sdat[j + 1], sdat[j + 2]);
    // dilate (max filter) to remove text, then blur
    const dil = new Float32Array(lum.length);
    const R = 3;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = Math.min(sh - 1, Math.max(0, y + dy)); for (let dx = -R; dx <= R; dx++) { const xx = Math.min(sw - 1, Math.max(0, x + dx)); const v = lum[yy * sw + xx]; if (v > m) m = v; } }
      dil[y * sw + x] = m;
    }
    const bg = boxBlur(dil, sw, sh, 4);
    const fx = sw / w, fy = sh / h;
    for (let y = 0; y < h; y++) {
      const by = Math.min(sh - 1, y * fy);
      const y0 = by | 0, y1 = Math.min(sh - 1, y0 + 1), ty = by - y0;
      for (let x = 0; x < w; x++) {
        const bx = Math.min(sw - 1, x * fx);
        const x0 = bx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = bx - x0;
        const b = (bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x1] * tx) * (1 - ty) + (bg[y1 * sw + x0] * (1 - tx) + bg[y1 * sw + x1] * tx) * ty;
        const k = 255 / Math.max(40, b);
        const i = (y * w + x) * 4;
        if (mode === 'bw') {
          const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * k / 255; // 0..1, paper ~1
          let v = (l - 0.55) / 0.33; v = v < 0 ? 0 : v > 1 ? 1 : v;
          v = v * v * (3 - 2 * v); // smoothstep keeps edges soft
          const o = 255 * v;
          px[i] = px[i + 1] = px[i + 2] = o;
        } else {
          for (let c = 0; c < 3; c++) {
            let v = px[i + c] * k / 255;           // paper -> ~1
            v = (v - 0.12) / 0.83;                 // contrast stretch
            v = v < 0 ? 0 : v > 1 ? 1 : v;
            px[i + c] = 255 * Math.pow(v, 1.15);
          }
        }
      }
    }
    const out = makeCanvas(w, h);
    out.getContext('2d').putImageData(d, 0, 0);
    return out;
  }

  global.Scanner = { detectQuad, warp, enhance, rotate, defaultQuad, makeCanvas };
})(window);
