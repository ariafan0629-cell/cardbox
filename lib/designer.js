/* 設計我的名片 — 名片盒 CardBox
   Draws a 90 × 54 mm business card (front + back) at 300 dpi on a canvas,
   saves the design on this phone (and in the cloud when signed in),
   and exports print-ready PNGs and a contact file (.vcf). */
(function () {
  "use strict";
  const W = 1063, H = 638;                       // 90 × 54 mm at 300 dpi
  const BLEED = 35;                              // 3 mm bleed for print shops
  const LS = "cardbox.mycard";
  const FONT = '"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",system-ui,sans-serif';

  const TEMPLATES = [
    { id: "minimal", name: "簡約白" }, { id: "split", name: "左色塊" }, { id: "dark", name: "黑底金屬" }, { id: "center", name: "置中" },
    { id: "band", name: "上方色帶" }, { id: "diagonal", name: "斜切" }, { id: "frame", name: "雙框線" }, { id: "bottomBar", name: "底部色條" },
    { id: "circle", name: "大圓" }, { id: "editorial", name: "粗體大字" }
  ];
  const ACCENTS = ["#0d0e10", "#2f5d8a", "#b23b2e", "#2f7a4f", "#8a5a2b", "#6b4fa0"];

  const blank = () => ({
    name: "", nameEn: "", title: "", company: "", companyEn: "",
    phone: "", email: "", lineId: "", website: "", address: "", slogan: "",
    logo: "", template: "minimal", accent: "#0d0e10", qr: "vcard", qrSide: "back", bleed: false,
    deco: "none", decoPos: "tr", decoStr: "mid", decoSide: "both"
  });

  /* sample text shown in previews only while a field is still empty (never exported) */
  const SAMPLE = { name: "王小明", nameEn: "Kevin Wang", title: "職稱", company: "公司名稱", companyEn: "Company Name",
    phone: "0912-345-678", email: "name@example.com", lineId: "line.id", website: "www.example.com", address: "", slogan: "一句話介紹自己" };
  const withSample = d => { const o = { ...d }; for (const k in SAMPLE) if (!String(o[k] || "").trim()) o[k] = SAMPLE[k]; return o };
  let qrLib = null;
  function loadQRGen() {
    if (qrLib) return qrLib;
    qrLib = new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = "lib/qrcode-gen.min.js";
      sc.onload = () => { try { window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"]; res(window.qrcode) } catch (e) { rej(e) } };
      sc.onerror = () => { qrLib = null; rej(new Error("qr")) };
      document.head.appendChild(sc);
    });
    return qrLib;
  }

  /* ---------- data ---------- */
  function vcardOf(d) {
    const e = v => String(v || "").replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const L = ["BEGIN:VCARD", "VERSION:3.0", `FN:${e(d.name || d.nameEn)}`, `N:${e(d.name || d.nameEn)};;;;`];
    if (d.nameEn && d.name) L.push(`X-PHONETIC-FIRST-NAME:${e(d.nameEn)}`);
    if (d.company || d.companyEn) L.push(`ORG:${e(d.company || d.companyEn)}`);
    if (d.title) L.push(`TITLE:${e(d.title)}`);
    if (d.phone) L.push(`TEL;TYPE=CELL:${e(d.phone)}`);
    if (d.email) L.push(`EMAIL:${e(d.email)}`);
    if (d.website) L.push(`URL:${e(webUrl(d.website))}`);
    if (d.lineId) L.push(`URL;TYPE=LINE:${e(lineUrl(d.lineId))}`);
    if (d.address) L.push(`ADR;TYPE=WORK:;;${e(d.address)};;;;`);
    L.push("END:VCARD");
    return L.join("\r\n");
  }
  const webUrl = w => /^https?:\/\//i.test(w) ? w : "https://" + w;
  const lineUrl = id => /^https?:\/\//i.test(id) ? id : "https://line.me/R/ti/p/" + (id.startsWith("@") ? id : "~" + id);
  function qrText(d) {
    if (d.qr === "line" && d.lineId) return lineUrl(d.lineId);
    if (d.qr === "web" && d.website) return webUrl(d.website);
    if (d.qr === "vcard" && (d.name || d.nameEn)) return vcardOf(d);
    return "";
  }

  async function loadDesign() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(LS) || "null") } catch (e) { }
    if (cloud && F) {
      try { const s = await F.getDoc(cref("profile", "mycard")); if (s.exists()) d = s.data() } catch (e) { }
    }
    return Object.assign(blank(), d || {});
  }
  async function saveDesign(d) {
    try { localStorage.setItem(LS, JSON.stringify(d)) } catch (e) { }
    if (cloud && F) bg(F.setDoc(cref("profile", "mycard"), JSON.parse(JSON.stringify(d))));
  }

  /* ---------- drawing helpers ---------- */
  function fit(g, text, maxW, size, weight = 400, min = 18) {
    let s = size; g.font = `${weight} ${s}px ${FONT}`;
    while (s > min && g.measureText(text).width > maxW) { s -= 2; g.font = `${weight} ${s}px ${FONT}` }
    return s;
  }
  function txt(g, text, x, y, { size = 30, weight = 400, color = "#111", maxW = 9999, align = "left", base = "alphabetic", min = 16, track = 0 } = {}) {
    if (!text) return 0;
    fit(g, text, maxW, size, weight, min);
    g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
    if (track && "letterSpacing" in g) g.letterSpacing = track + "px";
    g.fillText(text, x, y);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    return parseInt(g.font) || size;
  }
  function loadImgSrc(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src }) }
  function drawContain(g, img, x, y, w, h, round = 0) {
    const r = Math.min(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    g.save(); if (round) { roundRect(g, x, y, w, h, round); g.clip() }
    g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath() }
  function drawQR(g, Q, text, x, y, size, dark = "#0d0e10", light = "#ffffff") {
    if (!text || !Q) return false;
    let q; for (const lvl of ["M", "L"]) { try { q = Q(0, lvl); q.addData(text); q.make(); break } catch (e) { q = null } }
    if (!q) return false;
    const n = q.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
    g.fillStyle = light; g.fillRect(x, y, size, size);
    g.fillStyle = dark;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c))
      g.fillRect(Math.floor(x + (c + quiet) * cell), Math.floor(y + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    return true;
  }
  function contacts(d) {
    return [["手機", d.phone], ["Email", d.email], ["LINE", d.lineId], ["網站", d.website && d.website.replace(/^https?:\/\/(www\.)?/, "")], ["地址", d.address]].filter(x => x[1]);
  }
  function contactBlock(g, d, x, y, maxW, { color = "#222", label = "#777", size = 26, gap = 40 } = {}) {
    contacts(d).forEach(([k, v], i) => {
      const yy = y + i * gap;
      txt(g, k, x, yy, { size: 18, weight: 600, color: label, maxW: 80, track: 1 });
      txt(g, v, x + 86, yy, { size, color, maxW: maxW - 86, min: 16 });
    });
    return contacts(d).length * gap;
  }
  const lighten = (hex, a) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255; const m = v => Math.round(v + (255 - v) * a); return `rgb(${m(r)},${m(g)},${m(b)})` };

  /* ---------- the four designs ---------- */
  /* ---------- decorations (lines & geometric shapes) ---------- */
  const DECOS = [
    { id: "none", name: "無" }, { id: "lines", name: "細線條" }, { id: "stripes", name: "粗斜紋" }, { id: "dots", name: "點陣" },
    { id: "triangles", name: "三角幾何" }, { id: "waves", name: "波浪" }, { id: "arcs", name: "同心圓" }, { id: "grid", name: "方格" },
    { id: "hex", name: "蜂巢" }, { id: "corner", name: "角框" }, { id: "confetti", name: "幾何散點" }
  ];
  const DECO_POS = [{ id: "tr", name: "右上" }, { id: "br", name: "右下" }, { id: "bl", name: "左下" }, { id: "full", name: "滿版" }];
  const DECO_STR = [{ id: "low", name: "淡", a: .14 }, { id: "mid", name: "中", a: .28 }, { id: "high", name: "濃", a: .5 }];
  const DECO_SIDE = [{ id: "both", name: "兩面" }, { id: "front", name: "正面" }, { id: "back", name: "反面" }];
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  function decoRegion(pos) {
    return pos === "br" ? { x: W * .5, y: H * .42, w: W * .5, h: H * .58, cx: W, cy: H }
      : pos === "bl" ? { x: 0, y: H * .45, w: W * .55, h: H * .55, cx: 0, cy: H }
        : pos === "full" ? { x: 0, y: 0, w: W, h: H, cx: W, cy: 0 }
          : { x: W * .5, y: 0, w: W * .5, h: H * .58, cx: W, cy: 0 };
  }
  function drawDeco(g, d, side, onDark) {
    const kind = d.deco || "none"; if (kind === "none") return;
    if ((d.decoSide || "both") !== "both" && d.decoSide !== side) return;
    const alpha = (DECO_STR.find(x => x.id === d.decoStr) || DECO_STR[1]).a * (onDark ? 1.15 : 1);
    const col = onDark ? "#ffffff" : (d.accent || "#0d0e10");
    const R = decoRegion(d.decoPos || "tr"), rnd = rng(17);
    g.save(); g.globalAlpha = Math.min(1, alpha); g.strokeStyle = col; g.fillStyle = col;
    if (kind !== "corner") { g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip() }
    const span = Math.hypot(R.w, R.h);
    if (kind === "lines" || kind === "stripes") {
      const gap = kind === "lines" ? 26 : 52; g.lineWidth = kind === "lines" ? 3 : 20;
      for (let k = -span; k < span * 2; k += gap) { g.beginPath(); g.moveTo(R.x + k, R.y); g.lineTo(R.x + k - R.h, R.y + R.h); g.stroke() }
    } else if (kind === "dots") {
      for (let y = R.y + 18; y < R.y + R.h; y += 30) for (let x = R.x + 18 + ((y / 30 | 0) % 2) * 15; x < R.x + R.w; x += 30) {
        const fade = d.decoPos === "full" ? 1 : 1 - Math.hypot(x - R.cx, y - R.cy) / (span * 1.05); if (fade <= 0) continue;
        g.beginPath(); g.arc(x, y, 3 + 4 * fade, 0, 7); g.fill()
      }
    } else if (kind === "triangles") {
      const s = 70, h = s * .866;
      for (let r = 0; r * h < R.h + h; r++) for (let c = -1; c * s < R.w + s; c++) {
        const x = R.x + c * s + (r % 2) * s / 2, y = R.y + r * h, up = (c + r) % 2 === 0, v = rnd();
        if (v < .35) continue;
        g.beginPath(); if (up) { g.moveTo(x, y + h); g.lineTo(x + s / 2, y); g.lineTo(x + s, y + h) } else { g.moveTo(x, y); g.lineTo(x + s, y); g.lineTo(x + s / 2, y + h) } g.closePath();
        if (v > .72) g.fill(); else { g.lineWidth = 2; g.stroke() }
      }
    } else if (kind === "waves") {
      g.lineWidth = 3;
      for (let i = 0; i < 14; i++) { g.beginPath(); for (let x = R.x - 10; x <= R.x + R.w + 10; x += 8) { const y = R.y + 20 + i * 26 + Math.sin((x / R.w) * Math.PI * 3 + i * .5) * 12; x === R.x - 10 ? g.moveTo(x, y) : g.lineTo(x, y) } g.stroke() }
    } else if (kind === "arcs") {
      g.lineWidth = 4; for (let r = 40; r < span * 1.2; r += 34) { g.beginPath(); g.arc(R.cx, R.cy, r, 0, Math.PI * 2); g.stroke() }
    } else if (kind === "grid") {
      g.lineWidth = 1.6; for (let x = R.x; x <= R.x + R.w; x += 40) { g.beginPath(); g.moveTo(x, R.y); g.lineTo(x, R.y + R.h); g.stroke() }
      for (let y = R.y; y <= R.y + R.h; y += 40) { g.beginPath(); g.moveTo(R.x, y); g.lineTo(R.x + R.w, y); g.stroke() }
    } else if (kind === "hex") {
      const r = 34, hw = r * Math.sqrt(3); g.lineWidth = 2.4;
      for (let row = 0; row * r * 1.5 < R.h + r * 2; row++) for (let col = -1; col * hw < R.w + hw; col++) {
        const cx = R.x + col * hw + (row % 2) * hw / 2, cy = R.y + row * r * 1.5;
        g.beginPath(); for (let k = 0; k < 6; k++) { const an = Math.PI / 6 + k * Math.PI / 3; const px = cx + r * Math.cos(an), py = cy + r * Math.sin(an); k ? g.lineTo(px, py) : g.moveTo(px, py) } g.closePath(); g.stroke()
      }
    } else if (kind === "corner") {
      g.globalAlpha = Math.min(1, alpha * 2.2); g.lineWidth = 6; const m = 34, L = 90;
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); g.stroke() });
    } else if (kind === "confetti") {
      for (let i = 0; i < (d.decoPos === "full" ? 70 : 34); i++) {
        const x = R.x + rnd() * R.w, y = R.y + rnd() * R.h, sz = 8 + rnd() * 18, t = rnd(), rot = rnd() * 6.28;
        g.save(); g.translate(x, y); g.rotate(rot); g.lineWidth = 3;
        if (t < .33) { g.beginPath(); g.arc(0, 0, sz / 2, 0, 7); rnd() > .5 ? g.fill() : g.stroke() }
        else if (t < .66) { rnd() > .5 ? g.fillRect(-sz / 2, -sz / 2, sz, sz) : g.strokeRect(-sz / 2, -sz / 2, sz, sz) }
        else { g.beginPath(); g.moveTo(0, -sz / 2); g.lineTo(sz / 2, sz / 2); g.lineTo(-sz / 2, sz / 2); g.closePath(); rnd() > .5 ? g.fill() : g.stroke() }
        g.restore();
      }
    }
    g.restore();
  }

  /* ---------- the ten designs ---------- */
  async function drawSide(cv, d, side) {
    const Q = await loadQRGen().catch(() => null);
    const g = cv.getContext("2d"), pad = d.bleed ? BLEED : 0;
    cv.width = W + pad * 2; cv.height = H + pad * 2;
    g.save(); g.translate(pad, pad);
    const logo = d.logo ? await loadImgSrc(d.logo).catch(() => null) : null;
    const qtext = qrText(d), qrHere = d.qrSide === side;
    const A = d.accent || "#0d0e10", T = d.template;
    const fill = c => { g.fillStyle = c; g.fillRect(-pad, -pad, W + pad * 2, H + pad * 2) };
    const nm = d.name || d.nameEn, en = d.name && d.nameEn ? d.nameEn : "";
    const roleLine = [d.title, d.company].filter(Boolean).join("｜");
    const logoBox = (x, y, s, r = 18) => { if (!logo) return; g.save(); roundRect(g, x, y, s, s, r); g.fillStyle = "#fff"; g.fill(); g.restore(); drawContain(g, logo, x + s * .07, y + s * .07, s * .86, s * .86, r * .6) };

    if (side === "back") {
      const paper = T === "frame" || T === "editorial", dark = T === "dark";
      fill(dark ? "#0d0e10" : paper ? "#ffffff" : A);
      if (dark) { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(255,255,255,.06)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H) }
      if (T === "frame") { g.strokeStyle = A; g.lineWidth = 3; g.strokeRect(30, 30, W - 60, H - 60); g.lineWidth = 1; g.strokeRect(44, 44, W - 88, H - 88) }
      drawDeco(g, d, side, !paper);
      const fg = paper ? "#111" : dark ? "#e8e9ec" : "#ffffff", sub = paper ? A : fg;
      const hasQR = qrHere && qtext, cx = hasQR ? W * 0.36 : W / 2, mw = hasQR ? 560 : 900;
      if (logo) logoBox(cx - 110, 120, 220, 24);
      const ty = logo ? 410 : 290;
      txt(g, d.company || d.companyEn, cx, ty, { size: 46, weight: 700, color: fg, maxW: mw, align: "center" });
      if (d.company && d.companyEn) txt(g, d.companyEn, cx, ty + 46, { size: 24, color: sub, maxW: mw, align: "center", track: 2 });
      if (d.slogan) txt(g, d.slogan, cx, ty + (d.companyEn ? 100 : 60), { size: 26, color: fg, maxW: mw, align: "center" });
      if (hasQR) {
        g.save(); roundRect(g, W - 380, H / 2 - 170, 300, 300, 18); g.fillStyle = "#fff"; g.fill(); if (paper) { g.strokeStyle = "#ddd"; g.lineWidth = 2; g.stroke() } g.restore();
        drawQR(g, Q, qtext, W - 368, H / 2 - 158, 276);
        txt(g, qrLabel(d), W - 230, H / 2 + 170, { size: 20, color: paper ? "#666" : fg, align: "center", maxW: 300 });
      }
      g.restore(); return;
    }

    const qrSize = 190, hasQR = qrHere && qtext;
    let qrPos = null, qrLabelColor = "#888";
    if (T === "split") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      g.fillStyle = A; g.fillRect(-pad, -pad, W * 0.38 + pad, H + pad * 2);
      const lx = W * 0.19;
      if (logo) logoBox(lx - 90, 80, 180, 20);
      const ny = logo ? 350 : 270;
      txt(g, nm, lx, ny, { size: 64, weight: 800, color: "#fff", maxW: W * 0.34, align: "center" });
      if (en) txt(g, en, lx, ny + 44, { size: 26, color: "rgba(255,255,255,.85)", maxW: W * 0.34, align: "center", track: 2 });
      txt(g, d.title, lx, ny + (en ? 92 : 56), { size: 26, color: "rgba(255,255,255,.92)", maxW: W * 0.34, align: "center" });
      const rx = W * 0.38 + 56, rw = W - rx - 56 - (hasQR ? qrSize + 24 : 0);
      txt(g, d.company, rx, 110, { size: 36, weight: 700, color: "#111", maxW: W - rx - 56 });
      if (d.companyEn) txt(g, d.companyEn, rx, 150, { size: 22, color: "#666", maxW: W - rx - 56, track: 1 });
      g.fillStyle = A; g.fillRect(rx, 180, 60, 4);
      contactBlock(g, d, rx, 250, rw, { size: 25, gap: 48 });
      qrPos = [W - 56 - qrSize, H - 56 - qrSize];
    } else if (T === "dark") {
      fill("#0d0e10");
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(255,255,255,.07)"); gr.addColorStop(.6, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      drawDeco(g, d, side, true);
      const metal = g.createLinearGradient(0, 0, W, 0); metal.addColorStop(0, "#f2f3f5"); metal.addColorStop(.45, "#b9bdc3"); metal.addColorStop(.6, "#e6e8eb"); metal.addColorStop(1, "#9aa0a8");
      if (logo) drawContain(g, logo, W - 70 - 130, 60, 130, 130, 10);
      txt(g, nm, 70, 170, { size: 72, weight: 800, color: metal, maxW: W - 300 });
      if (en) txt(g, en, 70, 218, { size: 26, color: "#b9bdc3", maxW: W - 300, track: 3 });
      txt(g, roleLine, 70, en ? 266 : 226, { size: 28, color: "#e8e9ec", maxW: W - 140 });
      g.fillStyle = metal; g.fillRect(70, 300, W - 140, 2);
      contactBlock(g, d, 70, 368, W - 140 - (hasQR ? qrSize + 30 : 0), { color: "#eef0f2", label: "#9aa0a8", size: 25, gap: 46 });
      qrPos = [W - 70 - qrSize, H - 60 - qrSize]; qrLabelColor = "#9aa0a8";
    } else if (T === "center") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      g.fillStyle = lighten(A, .9); g.fillRect(-pad, H - 150, W + pad * 2, 150 + pad);
      let y = 120;
      if (logo) { drawContain(g, logo, W / 2 - 60, 50, 120, 120, 10); y = 230 }
      txt(g, nm, W / 2, y + 40, { size: 70, weight: 800, color: "#111", maxW: W - 160, align: "center" });
      if (en) txt(g, en, W / 2, y + 86, { size: 26, color: "#666", maxW: W - 160, align: "center", track: 3 });
      txt(g, roleLine, W / 2, y + (en ? 136 : 96), { size: 28, color: A, weight: 600, maxW: W - 160, align: "center" });
      const cs = contacts(d).slice(0, 4).map(([k, v]) => v);
      txt(g, cs.slice(0, 2).join("　"), W / 2, H - 92, { size: 24, color: "#222", maxW: W - (hasQR ? 360 : 120), align: "center" });
      txt(g, cs.slice(2).join("　"), W / 2, H - 52, { size: 24, color: "#222", maxW: W - (hasQR ? 360 : 120), align: "center" });
      if (hasQR) drawQR(g, Q, qtext, W - 40 - 130, H - 140, 130);
    } else if (T === "band") {
      fill("#ffffff");
      g.fillStyle = A; g.fillRect(-pad, -pad, W + pad * 2, 230 + pad);
      g.save(); g.beginPath(); g.rect(0, 0, W, 230); g.clip(); drawDeco(g, { ...d, decoPos: "full" }, side, true); g.restore();
      if (logo) logoBox(W - 70 - 150, 40, 150, 18);
      txt(g, nm, 70, 132, { size: 68, weight: 800, color: "#fff", maxW: W - 320 });
      if (en) txt(g, en, 70, 182, { size: 26, color: "rgba(255,255,255,.85)", maxW: W - 320, track: 2 });
      txt(g, roleLine, 70, 296, { size: 30, weight: 700, color: A, maxW: W - 140 });
      if (d.companyEn) txt(g, d.companyEn, 70, 332, { size: 20, color: "#777", maxW: W - 140, track: 1 });
      contactBlock(g, d, 70, 400, W - 140 - (hasQR ? qrSize + 30 : 0), { size: 24, gap: 42 });
      qrPos = [W - 64 - qrSize, H - 50 - qrSize];
    } else if (T === "diagonal") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      g.fillStyle = A; g.beginPath(); g.moveTo(W * .66, -pad); g.lineTo(W + pad, -pad); g.lineTo(W + pad, H + pad); g.lineTo(W * .48, H + pad); g.closePath(); g.fill();
      g.fillStyle = lighten(A, .55); g.beginPath(); g.moveTo(W * .62, -pad); g.lineTo(W * .66, -pad); g.lineTo(W * .48, H + pad); g.lineTo(W * .44, H + pad); g.closePath(); g.fill();
      if (logo) logoBox(W - 60 - 150, 50, 150, 18);
      txt(g, nm, 70, 150, { size: 68, weight: 800, color: "#111", maxW: W * .5 });
      if (en) txt(g, en, 70, 196, { size: 26, color: "#666", maxW: W * .5, track: 2 });
      txt(g, d.title, 70, en ? 244 : 204, { size: 28, color: A, weight: 600, maxW: W * .5 });
      txt(g, d.company, 70, 318, { size: 30, weight: 700, color: "#222", maxW: W * .52 });
      if (d.companyEn) txt(g, d.companyEn, 70, 352, { size: 20, color: "#777", maxW: W * .52, track: 1 });
      contactBlock(g, d, 70, 412, W * .44, { size: 23, gap: 40 });
      if (hasQR) { g.save(); roundRect(g, W - 60 - 210, H - 50 - 210, 210, 210, 14); g.fillStyle = "#fff"; g.fill(); g.restore(); drawQR(g, Q, qtext, W - 60 - 200, H - 50 - 200, 190) }
    } else if (T === "frame") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      g.strokeStyle = A; g.lineWidth = 3; g.strokeRect(30, 30, W - 60, H - 60); g.lineWidth = 1; g.strokeRect(44, 44, W - 88, H - 88);
      let y = 150; if (logo) { drawContain(g, logo, W / 2 - 50, 70, 100, 100, 8); y = 230 }
      txt(g, nm, W / 2, y + 30, { size: 64, weight: 800, color: "#111", maxW: W - 220, align: "center" });
      if (en) txt(g, en, W / 2, y + 74, { size: 24, color: "#666", maxW: W - 220, align: "center", track: 4 });
      txt(g, roleLine, W / 2, y + (en ? 122 : 84), { size: 26, color: A, weight: 600, maxW: W - 220, align: "center" });
      g.fillStyle = A; g.fillRect(W / 2 - 40, y + (en ? 148 : 110), 80, 2);
      const cs = contacts(d).slice(0, 4).map(([k, v]) => v), mw = W - (hasQR ? 400 : 200);
      txt(g, cs.slice(0, 2).join("　"), W / 2, H - 120, { size: 23, color: "#222", maxW: mw, align: "center" });
      txt(g, cs.slice(2).join("　"), W / 2, H - 84, { size: 23, color: "#222", maxW: mw, align: "center" });
      if (hasQR) drawQR(g, Q, qtext, W - 64 - 120, H - 64 - 120, 120);
    } else if (T === "bottomBar") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      const by = H - 210; g.fillStyle = A; g.fillRect(-pad, by, W + pad * 2, 210 + pad);
      if (logo) drawContain(g, logo, W - 70 - 140, 60, 140, 110, 8);
      txt(g, nm, 70, 160, { size: 80, weight: 800, color: "#111", maxW: W - 320 });
      if (en) txt(g, en, 70, 210, { size: 26, color: "#666", maxW: W - 320, track: 2 });
      txt(g, roleLine, 70, en ? 262 : 222, { size: 28, color: A, weight: 700, maxW: W - 140 });
      const cs = contacts(d), cw = (W - 140 - (hasQR ? 190 : 0)) / 2;
      cs.forEach(([k, v], i) => { const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3; txt(g, k, 70 + col * cw, by + 58 + row * 46, { size: 16, weight: 600, color: "rgba(255,255,255,.7)", maxW: 70 }); txt(g, v, 70 + col * cw + 76, by + 58 + row * 46, { size: 23, color: "#fff", maxW: cw - 90 }) });
      if (hasQR) { g.save(); roundRect(g, W - 60 - 170, by + 20, 170, 170, 12); g.fillStyle = "#fff"; g.fill(); g.restore(); drawQR(g, Q, qtext, W - 60 - 162, by + 28, 154) }
    } else if (T === "circle") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      const ccx = W * .86, ccy = H * .5, cr = 330;
      g.fillStyle = A; g.beginPath(); g.arc(ccx, ccy, cr, 0, 7); g.fill();
      g.strokeStyle = lighten(A, .5); g.lineWidth = 3; g.beginPath(); g.arc(ccx, ccy, cr + 22, 0, 7); g.stroke();
      if (hasQR) { g.save(); roundRect(g, ccx - 120 - 40, ccy - 105, 210, 210, 14); g.fillStyle = "#fff"; g.fill(); g.restore(); drawQR(g, Q, qtext, ccx - 150, ccy - 95, 190); if (logo) drawContain(g, logo, 70, 52, 90, 90, 8) }
      else if (logo) { g.fillStyle = "#fff"; g.beginPath(); g.arc(ccx - 40, ccy, 110, 0, 7); g.fill(); g.save(); g.beginPath(); g.arc(ccx - 40, ccy, 96, 0, 7); g.clip(); drawContain(g, logo, ccx - 136, ccy - 96, 192, 192); g.restore() }
      const ty = hasQR && logo ? 210 : 160;
      txt(g, nm, 70, ty, { size: 68, weight: 800, color: "#111", maxW: W * .48 });
      if (en) txt(g, en, 70, ty + 46, { size: 26, color: "#666", maxW: W * .48, track: 2 });
      txt(g, roleLine, 70, ty + (en ? 94 : 54), { size: 26, color: A, weight: 600, maxW: W * .5 });
      contactBlock(g, d, 70, ty + (en ? 170 : 130), W * .48, { size: 23, gap: 40 });
    } else if (T === "editorial") {
      fill("#ffffff"); drawDeco(g, d, side, false);
      txt(g, d.company, W - 70, 84, { size: 24, weight: 700, color: "#111", maxW: W * .45, align: "right" });
      if (d.title) txt(g, d.title, W - 70, 118, { size: 22, color: A, maxW: W * .45, align: "right" });
      if (logo) drawContain(g, logo, 70, 50, 90, 90, 8);
      txt(g, nm, 66, 300, { size: 128, weight: 900, color: "#111", maxW: W - 140, min: 40 });
      if (en) txt(g, en.toUpperCase(), 72, 350, { size: 24, weight: 600, color: "#555", maxW: W - 140, track: 6 });
      g.fillStyle = A; g.fillRect(70, en ? 384 : 340, W - 140, 10);
      const cs = contacts(d).map(([k, v]) => v), mw = W - 140 - (hasQR ? 180 : 0);
      txt(g, cs.slice(0, 2).join("  /  "), 70, H - 108, { size: 24, color: "#222", maxW: mw });
      txt(g, cs.slice(2).join("  /  "), 70, H - 66, { size: 24, color: "#222", maxW: mw });
      if (hasQR) drawQR(g, Q, qtext, W - 70 - 150, H - 40 - 150, 150);
    } else {
      /* minimal */
      fill("#ffffff"); drawDeco(g, d, side, false);
      g.fillStyle = A; g.fillRect(0, 0, 14, H);
      if (logo) drawContain(g, logo, W - 70 - 150, 56, 150, 110, 8);
      txt(g, nm, 80, 150, { size: 70, weight: 800, color: "#111", maxW: W - 320 });
      if (en) txt(g, en, 80, 196, { size: 26, color: "#666", maxW: W - 320, track: 2 });
      txt(g, d.title, 80, en ? 244 : 204, { size: 28, color: A, weight: 600, maxW: W - 160 });
      txt(g, d.company, 80, 330, { size: 32, weight: 700, color: "#222", maxW: W - 160 });
      if (d.companyEn) txt(g, d.companyEn, 80, 366, { size: 20, color: "#777", maxW: W - 160, track: 1 });
      contactBlock(g, d, 80, d.companyEn ? 430 : 410, W - 160 - (hasQR ? qrSize + 30 : 0), { size: 24, gap: 40 });
      qrPos = [W - 64 - qrSize, H - 56 - qrSize];
    }
    if (hasQR && qrPos) {
      drawQR(g, Q, qtext, qrPos[0], qrPos[1], qrSize, "#0d0e10", T === "dark" ? "#eef0f2" : "#ffffff");
      txt(g, qrLabel(d), qrPos[0] + qrSize / 2, H - 22, { size: 16, color: qrLabelColor, align: "center", maxW: qrSize + 40 });
    }
    g.restore();
  }
  const qrLabel = d => ({ line: "掃描加 LINE", web: "掃描看網站", vcard: "掃描存聯絡人" })[d.qr] || "";

  /* ---------- export ---------- */
  async function shareFiles(files, title) {
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title }); return "shared" } catch (e) { if (e.name === "AbortError") return "cancel" }
    }
    for (const f of files) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await new Promise(r => setTimeout(r, 300));
    }
    return "downloaded";
  }
  async function exportPNG(d) {
    const out = [];
    for (const side of ["front", "back"]) {
      const cv = document.createElement("canvas"); await drawSide(cv, d, side);
      const b = await new Promise(r => cv.toBlob(r, "image/png"));
      out.push(new File([b], `我的名片-${side === "front" ? "正面" : "反面"}${d.bleed ? "-含出血" : ""}.png`, { type: "image/png" }));
    }
    return out;
  }

  /* ---------- the designer screen ---------- */
  window.openDesigner = async function () {
    const d = await loadDesign();
    let side = "front", timer = null;
    const f = (id, label, ph = "", type = "text", extra = "") => `<label class="f">${label}<input id="dz_${id}" type="${type}" value="${esc(d[id])}" placeholder="${esc(ph)}" autocomplete="off" ${extra}></label>`;
    openSheet(`<div class="sheet-head"><h2>設計我的名片</h2><button class="x" type="button" data-close aria-label="關閉">×</button></div>
      <div class="dz-preview">
        <div class="dz-side" role="tablist"><button type="button" data-side="front" aria-pressed="true">正面</button><button type="button" data-side="back" aria-pressed="false">反面</button></div>
        <canvas id="dzCanvas" aria-label="名片預覽"></canvas>
        <div class="hint" style="margin-top:4px">9 × 5.4 公分標準名片，300 dpi，可直接拿去印刷。<span id="dzSampleNote" hidden>目前是範例文字，填好資料後會換成你的。</span></div>
      </div>
      <div class="legend">樣式（${TEMPLATES.length} 種，左右滑動）</div>
      <div class="dz-gallery">${TEMPLATES.map(t => `<button type="button" class="dz-thumb" data-tpl="${t.id}" aria-pressed="${d.template === t.id}"><canvas width="212" height="128" aria-hidden="true"></canvas><span>${t.name}</span></button>`).join("")}</div>
      <div class="legend">素材</div>
      <div class="dz-tpl">${DECOS.map(x => `<button type="button" class="ichip" data-deco="${x.id}" aria-pressed="${d.deco === x.id}">${x.name}</button>`).join("")}</div>
      <div class="dz-deco-opts" id="dzDecoOpts"${d.deco === "none" ? " hidden" : ""}>
        <div class="dz-opt"><span>位置</span>${DECO_POS.map(x => `<button type="button" class="ichip sm" data-dpos="${x.id}" aria-pressed="${d.decoPos === x.id}">${x.name}</button>`).join("")}</div>
        <div class="dz-opt"><span>濃淡</span>${DECO_STR.map(x => `<button type="button" class="ichip sm" data-dstr="${x.id}" aria-pressed="${d.decoStr === x.id}">${x.name}</button>`).join("")}</div>
        <div class="dz-opt"><span>放在</span>${DECO_SIDE.map(x => `<button type="button" class="ichip sm" data-dside="${x.id}" aria-pressed="${d.decoSide === x.id}">${x.name}</button>`).join("")}</div>
      </div>
      <div class="legend">主色</div>
      <div class="dz-colors">${ACCENTS.map(c => `<button type="button" class="dz-sw" data-color="${c}" style="background:${c}" aria-label="顏色 ${c}" aria-pressed="${d.accent === c}"></button>`).join("")}<label class="dz-sw dz-custom" aria-label="自訂顏色"><input id="dz_accent" type="color" value="${esc(d.accent)}"></label></div>
      <form id="dzForm" novalidate style="margin-top:4px">
        <div class="av-pick">
          <div class="av-circle dz-logo" id="dzLogo"></div>
          <div style="display:grid;gap:6px;min-width:0">
            <div class="legend" style="margin:0">Logo 或照片</div>
            <div class="pick-btns" style="margin:0"><span class="btn filebtn">選圖片<input id="dzLogoPick" type="file" accept="image/*" aria-label="選 Logo"></span><button class="btn" type="button" id="dzLogoDel">移除</button></div>
          </div>
        </div>
        <div class="row">${f("name", "姓名")}${f("nameEn", "英文名", "例如：Kevin Wang")}</div>
        <div class="row">${f("title", "職稱")}${f("company", "公司")}</div>
        ${f("companyEn", "公司英文名", "例如：CardBox Studio")}
        <div class="row">${f("phone", "手機", "", "tel")}${f("email", "Email", "", "email", 'autocapitalize="off"')}</div>
        <div class="row">${f("lineId", "LINE ID", "", "text", 'autocapitalize="off"')}${f("website", "網站", "例如：www.example.com", "text", 'autocapitalize="off"')}</div>
        ${f("address", "地址")}
        ${f("slogan", "一句話介紹（印在反面）", "例如：讓每一次見面都留下好印象")}
        <div class="row">
          <label class="f">QR Code 內容<select id="dz_qr">
            <option value="vcard"${d.qr === "vcard" ? " selected" : ""}>電子名片（掃了直接存聯絡人）</option>
            <option value="line"${d.qr === "line" ? " selected" : ""}>LINE 加好友</option>
            <option value="web"${d.qr === "web" ? " selected" : ""}>網站</option>
            <option value="none"${d.qr === "none" ? " selected" : ""}>不要 QR Code</option></select></label>
          <label class="f">QR Code 位置<select id="dz_qrSide">
            <option value="back"${d.qrSide === "back" ? " selected" : ""}>印在反面</option>
            <option value="front"${d.qrSide === "front" ? " selected" : ""}>印在正面</option></select></label>
        </div>
        <label class="dz-check"><input id="dz_bleed" type="checkbox"${d.bleed ? " checked" : ""}> 印刷用：四邊加 3 mm 出血（印刷廠通常會要求）</label>
        <div class="ai-hint" id="dzWarn" hidden></div>
        <div class="actions">
          <button class="btn primary" type="button" id="dzSave">儲存設計</button>
          <button class="btn metal" type="button" id="dzPng">存成圖片（正反面）</button>
          <button class="btn" type="button" id="dzVcf">分享電子名片</button>
        </div>
      </form>`);
    const cv = $("#dzCanvas");
    const read = () => {
      ["name", "nameEn", "title", "company", "companyEn", "phone", "email", "lineId", "website", "address", "slogan"].forEach(k => d[k] = $("#dz_" + k).value.trim());
      d.qr = $("#dz_qr").value; d.qrSide = $("#dz_qrSide").value; d.bleed = $("#dz_bleed").checked;
    };
    const warn = () => {
      const w = [];
      if (d.qr === "line" && !d.lineId) w.push("QR Code 選了 LINE，但還沒填 LINE ID。");
      if (d.qr === "web" && !d.website) w.push("QR Code 選了網站，但還沒填網站。");
      if (!d.name && !d.nameEn) w.push("還沒填姓名。");
      $("#dzWarn").hidden = !w.length; $("#dzWarn").textContent = w.join(" ");
    };
    /* template gallery: each preview is drawn with your own details */
    let thumbTimer = null, thumbJob = 0;
    const off = document.createElement("canvas");
    const drawThumbs = async () => {
      const job = ++thumbJob;
      for (const b of $("#sheet").querySelectorAll(".dz-thumb")) {
        if (job !== thumbJob || !b.isConnected) return;
        await drawSide(off, { ...withSample(d), template: b.dataset.tpl, bleed: false }, side);
        const tc = b.querySelector("canvas"), tg = tc.getContext("2d"); tg.imageSmoothingQuality = "high"; tg.clearRect(0, 0, tc.width, tc.height); tg.drawImage(off, 0, 0, tc.width, tc.height);
        await new Promise(r => setTimeout(r, 0));
      }
    };
    const queueThumbs = () => { clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 500) };
    const preview = () => { const empty = !d.name && !d.nameEn; $("#dzSampleNote").hidden = !empty; return drawSide(cv, empty ? withSample(d) : d, side) };
    const redraw = (thumbs = true) => { clearTimeout(timer); timer = setTimeout(async () => { read(); warn(); await preview(); if (thumbs) queueThumbs() }, 90) };
    const drawLogo = () => { $("#dzLogo").innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="Logo">` : '<span style="font-size:.75rem">Logo</span>'; $("#dzLogoDel").hidden = !d.logo };
    drawLogo();
    $("#dzForm").addEventListener("input", redraw);
    $("#dzForm").addEventListener("change", redraw);
    $("#sheet").querySelectorAll("[data-side]").forEach(b => b.onclick = () => { side = b.dataset.side; $("#sheet").querySelectorAll("[data-side]").forEach(x => x.setAttribute("aria-pressed", x === b)); redraw() });
    $("#sheet").querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => { d.template = b.dataset.tpl; $("#sheet").querySelectorAll("[data-tpl]").forEach(x => x.setAttribute("aria-pressed", x === b)); redraw(false) });
    const pick = (attr, key, after) => $("#sheet").querySelectorAll(`[data-${attr}]`).forEach(b => b.onclick = () => {
      d[key] = b.dataset[attr]; $("#sheet").querySelectorAll(`[data-${attr}]`).forEach(x => x.setAttribute("aria-pressed", x === b)); after && after(); redraw() });
    pick("deco", "deco", () => { $("#dzDecoOpts").hidden = d.deco === "none" });
    pick("dpos", "decoPos"); pick("dstr", "decoStr"); pick("dside", "decoSide");
    const setColor = c => { d.accent = c; $("#dz_accent").value = c; $("#sheet").querySelectorAll("[data-color]").forEach(x => x.setAttribute("aria-pressed", x.dataset.color === c)); redraw() };
    $("#sheet").querySelectorAll("[data-color]").forEach(b => b.onclick = () => setColor(b.dataset.color));
    $("#dz_accent").addEventListener("input", e => setColor(e.target.value));
    $("#dzLogoPick").onchange = async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      const cut = await cropImage(file, { title: "裁切 Logo 或照片" }); if (!cut) return;
      const small = await shrink(cut, 600, .9);
      d.logo = await toDataURL(small); drawLogo(); redraw();
    };
    $("#dzLogoDel").onclick = () => { d.logo = ""; drawLogo(); redraw() };
    $("#dzSave").onclick = async () => { read(); await saveDesign(d); toast(cloud ? "已儲存，其他裝置也看得到" : "已儲存") };
    $("#dzPng").onclick = async () => {
      read(); if (!d.name && !d.nameEn) { toast("先填姓名"); $("#dz_name").focus(); return }
      const b = $("#dzPng"); b.disabled = true; b.textContent = "產生中…";
      try { await saveDesign(d); const r = await shareFiles(await exportPNG(d), "我的名片"); if (r === "downloaded") toast("已下載正反面圖片"); }
      catch (e) { toast("圖片產生失敗，請再試一次") }
      finally { b.disabled = false; b.textContent = "存成圖片（正反面）" }
    };
    $("#dzVcf").onclick = async () => {
      read(); if (!d.name && !d.nameEn) { toast("先填姓名"); $("#dz_name").focus(); return }
      const file = new File([vcardOf(d)], `${d.name || d.nameEn}.vcf`, { type: "text/vcard" });
      const r = await shareFiles([file], `${d.name || d.nameEn} 的電子名片`);
      if (r === "downloaded") toast("已下載電子名片檔");
    };
    read(); warn(); await preview(); drawThumbs();
    const cur = $("#sheet").querySelector('.dz-thumb[aria-pressed="true"]'); if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
  };
  /* for tests */
  window.__designer = { drawSide, vcardOf, qrText, W, H };
})();
