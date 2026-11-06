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
    { id: "minimal", name: "簡約白" },
    { id: "split", name: "左色塊" },
    { id: "dark", name: "黑底金屬" },
    { id: "center", name: "置中" }
  ];
  const ACCENTS = ["#0d0e10", "#2f5d8a", "#b23b2e", "#2f7a4f", "#8a5a2b", "#6b4fa0"];

  const blank = () => ({
    name: "", nameEn: "", title: "", company: "", companyEn: "",
    phone: "", email: "", lineId: "", website: "", address: "", slogan: "",
    logo: "", template: "minimal", accent: "#0d0e10", qr: "vcard", qrSide: "back", bleed: false
  });

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
  async function drawSide(cv, d, side) {
    const Q = await loadQRGen().catch(() => null);
    const g = cv.getContext("2d"), pad = d.bleed ? BLEED : 0;
    cv.width = W + pad * 2; cv.height = H + pad * 2;
    g.save(); g.translate(pad, pad);
    const logo = d.logo ? await loadImgSrc(d.logo).catch(() => null) : null;
    const qtext = qrText(d), qrHere = d.qrSide === side;
    const A = d.accent || "#0d0e10";
    const fill = c => { g.fillStyle = c; g.fillRect(-pad, -pad, W + pad * 2, H + pad * 2) };

    if (side === "back") {
      const dark = d.template === "dark";
      fill(dark ? "#0d0e10" : A);
      const fg = dark ? "#e8e9ec" : "#ffffff";
      if (dark) { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(255,255,255,.06)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H) }
      const hasQR = qrHere && qtext;
      const cx = hasQR ? W * 0.36 : W / 2;
      if (logo) { g.save(); roundRect(g, cx - 110, 120, 220, 220, 24); g.fillStyle = "#fff"; g.fill(); g.restore(); drawContain(g, logo, cx - 96, 134, 192, 192, 14) }
      const ty = logo ? 410 : 290;
      txt(g, d.company || d.companyEn, cx, ty, { size: 46, weight: 700, color: fg, maxW: hasQR ? 560 : 900, align: "center" });
      if (d.company && d.companyEn) txt(g, d.companyEn, cx, ty + 46, { size: 24, color: fg, maxW: hasQR ? 560 : 900, align: "center", track: 2 });
      if (d.slogan) txt(g, d.slogan, cx, ty + (d.companyEn ? 100 : 60), { size: 26, color: fg, maxW: hasQR ? 560 : 900, align: "center" });
      if (hasQR) {
        g.save(); roundRect(g, W - 380, H / 2 - 170, 300, 300, 18); g.fillStyle = "#fff"; g.fill(); g.restore();
        drawQR(g, Q, qtext, W - 368, H / 2 - 158, 276);
        txt(g, qrLabel(d), W - 230, H / 2 + 170, { size: 20, color: fg, align: "center", maxW: 300 });
      }
      g.restore(); return;
    }

    const qrSize = 190, hasQR = qrHere && qtext;
    if (d.template === "split") {
      fill("#ffffff");
      g.fillStyle = A; g.fillRect(-pad, -pad, W * 0.38 + pad, H + pad * 2);
      const lx = W * 0.19;
      if (logo) { g.save(); roundRect(g, lx - 90, 80, 180, 180, 20); g.fillStyle = "#fff"; g.fill(); g.restore(); drawContain(g, logo, lx - 80, 90, 160, 160, 12) }
      const ny = logo ? 350 : 270;
      txt(g, d.name || d.nameEn, lx, ny, { size: 64, weight: 800, color: "#fff", maxW: W * 0.34, align: "center" });
      if (d.name && d.nameEn) txt(g, d.nameEn, lx, ny + 44, { size: 26, color: "rgba(255,255,255,.85)", maxW: W * 0.34, align: "center", track: 2 });
      txt(g, d.title, lx, ny + (d.nameEn && d.name ? 92 : 56), { size: 26, color: "rgba(255,255,255,.92)", maxW: W * 0.34, align: "center" });
      const rx = W * 0.38 + 56, rw = W - rx - 56 - (hasQR ? qrSize + 24 : 0);
      txt(g, d.company, rx, 110, { size: 36, weight: 700, color: "#111", maxW: W - rx - 56 });
      if (d.companyEn) txt(g, d.companyEn, rx, 150, { size: 22, color: "#666", maxW: W - rx - 56, track: 1 });
      g.fillStyle = A; g.fillRect(rx, 180, 60, 4);
      contactBlock(g, d, rx, 250, rw, { size: 25, gap: 48 });
      if (hasQR) drawQR(g, Q, qtext, W - 56 - qrSize, H - 56 - qrSize, qrSize);
    } else if (d.template === "dark") {
      fill("#0d0e10");
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(255,255,255,.07)"); gr.addColorStop(.6, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const metal = g.createLinearGradient(0, 0, W, 0); metal.addColorStop(0, "#f2f3f5"); metal.addColorStop(.45, "#b9bdc3"); metal.addColorStop(.6, "#e6e8eb"); metal.addColorStop(1, "#9aa0a8");
      if (logo) drawContain(g, logo, W - 70 - 130, 60, 130, 130, 10);
      txt(g, d.name || d.nameEn, 70, 170, { size: 72, weight: 800, color: metal, maxW: W - 300 });
      if (d.name && d.nameEn) txt(g, d.nameEn, 70, 218, { size: 26, color: "#b9bdc3", maxW: W - 300, track: 3 });
      txt(g, [d.title, d.company].filter(Boolean).join("｜"), 70, d.nameEn && d.name ? 266 : 226, { size: 28, color: "#e8e9ec", maxW: W - 140 });
      g.fillStyle = metal; g.fillRect(70, 300, W - 140, 2);
      contactBlock(g, d, 70, 368, W - 140 - (hasQR ? qrSize + 30 : 0), { color: "#eef0f2", label: "#9aa0a8", size: 25, gap: 46 });
      if (hasQR) drawQR(g, Q, qtext, W - 70 - qrSize, H - 60 - qrSize, qrSize, "#0d0e10", "#eef0f2");
    } else if (d.template === "center") {
      fill("#ffffff");
      g.fillStyle = lighten(A, .9); g.fillRect(-pad, H - 150, W + pad * 2, 150 + pad);
      let y = 120;
      if (logo) { drawContain(g, logo, W / 2 - 60, 50, 120, 120, 10); y = 230 }
      txt(g, d.name || d.nameEn, W / 2, y + 40, { size: 70, weight: 800, color: "#111", maxW: W - 160, align: "center" });
      if (d.name && d.nameEn) txt(g, d.nameEn, W / 2, y + 86, { size: 26, color: "#666", maxW: W - 160, align: "center", track: 3 });
      txt(g, [d.title, d.company].filter(Boolean).join("｜"), W / 2, y + (d.nameEn && d.name ? 136 : 96), { size: 28, color: A, weight: 600, maxW: W - 160, align: "center" });
      const cs = contacts(d).slice(0, 4).map(([k, v]) => v);
      const line1 = cs.slice(0, 2).join("　"), line2 = cs.slice(2).join("　");
      txt(g, line1, W / 2, H - 92, { size: 24, color: "#222", maxW: W - (hasQR ? 360 : 120), align: "center" });
      txt(g, line2, W / 2, H - 52, { size: 24, color: "#222", maxW: W - (hasQR ? 360 : 120), align: "center" });
      if (hasQR) drawQR(g, Q, qtext, W - 40 - 130, H - 140, 130);
    } else {
      /* minimal */
      fill("#ffffff");
      g.fillStyle = A; g.fillRect(0, 0, 14, H);
      if (logo) drawContain(g, logo, W - 70 - 150, 56, 150, 110, 8);
      txt(g, d.name || d.nameEn, 80, 150, { size: 70, weight: 800, color: "#111", maxW: W - 320 });
      if (d.name && d.nameEn) txt(g, d.nameEn, 80, 196, { size: 26, color: "#666", maxW: W - 320, track: 2 });
      txt(g, d.title, 80, d.nameEn && d.name ? 244 : 204, { size: 28, color: A, weight: 600, maxW: W - 160 });
      txt(g, d.company, 80, 330, { size: 32, weight: 700, color: "#222", maxW: W - 160 });
      if (d.companyEn) txt(g, d.companyEn, 80, 366, { size: 20, color: "#777", maxW: W - 160, track: 1 });
      contactBlock(g, d, 80, d.companyEn ? 430 : 410, W - 160 - (hasQR ? qrSize + 30 : 0), { size: 24, gap: 40 });
      if (hasQR) drawQR(g, Q, qtext, W - 64 - qrSize, H - 56 - qrSize, qrSize);
    }
    if (hasQR && d.template !== "center") {
      const lab = qrLabel(d);
      txt(g, lab, d.template === "dark" ? W - 70 - qrSize / 2 : W - (d.template === "split" ? 56 : 64) - qrSize / 2, H - 22, { size: 16, color: d.template === "dark" ? "#9aa0a8" : "#888", align: "center", maxW: qrSize + 40 });
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
        <div class="hint" style="margin-top:4px">9 × 5.4 公分標準名片，300 dpi，可直接拿去印刷。</div>
      </div>
      <div class="legend">樣式</div>
      <div class="dz-tpl">${TEMPLATES.map(t => `<button type="button" class="ichip" data-tpl="${t.id}" aria-pressed="${d.template === t.id}">${t.name}</button>`).join("")}</div>
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
    const redraw = () => { clearTimeout(timer); timer = setTimeout(async () => { read(); warn(); await drawSide(cv, d, side) }, 90) };
    const drawLogo = () => { $("#dzLogo").innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="Logo">` : '<span style="font-size:.75rem">Logo</span>'; $("#dzLogoDel").hidden = !d.logo };
    drawLogo();
    $("#dzForm").addEventListener("input", redraw);
    $("#dzForm").addEventListener("change", redraw);
    $("#sheet").querySelectorAll("[data-side]").forEach(b => b.onclick = () => { side = b.dataset.side; $("#sheet").querySelectorAll("[data-side]").forEach(x => x.setAttribute("aria-pressed", x === b)); redraw() });
    $("#sheet").querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => { d.template = b.dataset.tpl; $("#sheet").querySelectorAll("[data-tpl]").forEach(x => x.setAttribute("aria-pressed", x === b)); redraw() });
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
    read(); warn(); await drawSide(cv, d, side);
  };
  /* for tests */
  window.__designer = { drawSide, vcardOf, qrText, W, H };
})();
