/* 名片盒 CardBox — live card scanner
   Shows the camera with a business-card-shaped frame. Each frame is checked for
   (1) straight card edges lying on the frame, (2) a steady hand and (3) a sharp image.
   When all three hold for about half a second, the area inside the frame is captured
   automatically. After a capture it waits until the view changes (card flipped or swapped)
   before capturing again, so the back side or the next card is taken without tapping. */
(function () {
  "use strict";
  const RATIO = 90 / 54;            // Taiwan standard card
  const MARGIN = 0.14;              // analysis area around the frame, as a share of the frame
  const AW = 220;                   // analysis width in pixels

  /* ---------- image analysis (pure functions, also used by tests) ---------- */
  function toGray(id) {
    const { data, width: w, height: h } = id, g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
    return { g, w, h };
  }
  /* finds the card's four edges anywhere inside the frame (it doesn't have to touch the frame lines),
     checks the shape is card-like, and returns where the card is so the photo can be cropped to it */
  function analyze(id, ratio) {
    const { g, w, h } = toGray(id);
    const fx0 = Math.round(w * MARGIN / (1 + 2 * MARGIN)), fx1 = w - fx0;
    const fy0 = Math.round(h * MARGIN / (1 + 2 * MARGIN)), fy1 = h - fy0;
    const fw = fx1 - fx0, fh = fy1 - fy0, outX = Math.max(3, Math.round(fw * .07)), outY = Math.max(3, Math.round(fh * .09));
    const at = (x, y) => g[y * w + x];
    const rowEdge = y => { let s = 0, n = 0; for (let x = fx0 + fw * .22 | 0; x < fx1 - fw * .22; x++) { s += Math.abs(at(x, y + 1) - at(x, y - 1)); n++ } return s / n };
    const colEdge = x => { let s = 0, n = 0; for (let y = fy0 + fh * .25 | 0; y < fy1 - fh * .25; y++) { s += Math.abs(at(x + 1, y) - at(x - 1, y)); n++ } return s / n };
    /* typical detail level, to tell a real card border from texture */
    let sum = 0, cnt = 0, lap = 0, lap2 = 0, lc = 0;
    for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
      sum += Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1)); cnt += 2;
      if (x > fx0 + 4 && x < fx1 - 4 && y > fy0 + 4 && y < fy1 - 4) { const l = 4 * at(x, y) - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1); lap += l; lap2 += l * l; lc++ }
    }
    const base = sum / cnt, sharp = lc ? lap2 / lc - (lap / lc) ** 2 : 0, thr = Math.max(9, base * 2.2);
    /* walk inward from outside the frame line; the first strong straight line is the card's border */
    const scan = (from, to, step, f, limit) => { let best = 0, pos = -1;
      for (let v = from; step > 0 ? v <= to : v >= to; v += step) { if (v < 1 || v > limit - 2) continue; const e = f(v); if (e > best) { best = e; pos = v } if (best >= thr && e < best * .6) break }
      return best >= thr ? [best, pos] : [best, -1] };
    const depthX = Math.round(fw * .3), depthY = Math.round(fh * .3);
    const [top, topAt] = scan(fy0 - outY, fy0 + depthY, 1, rowEdge, h);
    const [bottom, botAt] = scan(fy1 + outY, fy1 - depthY, -1, rowEdge, h);
    const [left, leftAt] = scan(fx0 - outX, fx0 + depthX, 1, colEdge, w);
    const [right, rightAt] = scan(fx1 + outX, fx1 - depthX, -1, colEdge, w);
    const sides = { top, bottom, left, right };
    const found = [topAt, botAt, leftAt, rightAt].map(v => v >= 0), strong = found.filter(Boolean).length;
    /* a straight, level border sits at the same place at both of its ends; a tilted card doesn't */
    const segRow = (y, a, b) => { let s = 0, n = 0; for (let x = a | 0; x < b; x++) { s += Math.abs(at(x, y + 1) - at(x, y - 1)); n++ } return s / n };
    const segCol = (x, a, b) => { let s = 0, n = 0; for (let y = a | 0; y < b; y++) { s += Math.abs(at(x + 1, y) - at(x - 1, y)); n++ } return s / n };
    /* both ends of a border must light up at the border's position (±2 px); on a tilted card only the middle does */
    const near = (pos, f, lim) => { let m = 0; for (let v = pos - 2; v <= pos + 2; v++) if (v >= 1 && v <= lim - 2) m = Math.max(m, f(v)); return m };
    const level = (pos, horiz, full) => {
      if (pos < 0) return false;
      const need = full * .4;
      if (horiz) { const x0 = Math.max(fx0, (leftAt >= 0 ? leftAt : fx0)), x1 = Math.min(fx1, (rightAt >= 0 ? rightAt : fx1)), dw = x1 - x0;
        return near(pos, y => segRow(y, x0 + dw * .08, x0 + dw * .28), h) >= need && near(pos, y => segRow(y, x1 - dw * .28, x1 - dw * .08), h) >= need }
      const y0 = Math.max(fy0, (topAt >= 0 ? topAt : fy0)), y1 = Math.min(fy1, (botAt >= 0 ? botAt : fy1)), dh = y1 - y0;
      return near(pos, x => segCol(x, y0 + dh * .1, y0 + dh * .3), w) >= need && near(pos, x => segCol(x, y1 - dh * .3, y1 - dh * .1), w) >= need;
    };
    const straight = level(topAt, true, top) && level(botAt, true, bottom) && level(leftAt, false, left) && level(rightAt, false, right);
    const L = leftAt >= 0 ? leftAt : fx0, Rr = rightAt >= 0 ? rightAt : fx1, T = topAt >= 0 ? topAt : fy0, B = botAt >= 0 ? botAt : fy1;
    const dw = Rr - L, dh = B - T, want = ratio || fw / fh;
    const shapeOk = dw > fw * .6 && dh > fh * .6 && Math.abs((dw / dh) / want - 1) < .2;
    let inner = 0, outer = 0, ni = 0, no = 0;
    for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) { const v = at(x, y), inside = x > L && x < Rr && y > T && y < B; if (inside) { inner += v; ni++ } else { outer += v; no++ } }
    const contrast = Math.abs(inner / Math.max(1, ni) - outer / Math.max(1, no));
    return { sides, base, thr, strong, sharp, contrast, shapeOk, straight, aligned: strong === 4 && shapeOk && straight,
      rect: { x: L / w, y: T / h, w: dw / w, h: dh / h } };
  }
  function tiny(id) { // 32×20 thumbnail for motion detection
    const { g, w, h } = toGray(id), out = new Float32Array(32 * 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 32; x++) out[y * 32 + x] = g[Math.floor(y * h / 20) * w + Math.floor(x * w / 32)];
    return out;
  }
  const diff = (a, b) => { if (!a || !b) return 255; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length };

  /* ---------- camera screen ---------- */
  window.openScanner = function ({ onCapture, onClose } = {}) {
    let cardRect = null, vertical = false, stream = null, raf = 0, timer = 0, steadyRun = 0, prevTiny = null, armed = true, armRef = null, shots = 0, closed = false, lastShot = 0;
    const ui = document.createElement("div"); ui.className = "scan-ui";
    ui.innerHTML = `<video playsinline muted autoplay></video>
      <div class="scan-guide" aria-hidden="true"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><svg class="scan-prog" preserveAspectRatio="none"><rect x="1.5" y="1.5" rx="14" ry="14"></rect></svg></div>
      <div class="scan-flash"></div>
      <div class="scan-top"><button type="button" class="scan-txt" data-a="close">取消</button><b class="scan-count" hidden></b><button type="button" class="scan-txt" data-a="rotate">直式名片</button></div>
      <div class="scan-msg" role="status">正在開啟相機…</div>
      <div class="scan-bar"><button type="button" class="scan-done" data-a="close">完成</button><button type="button" class="scan-shutter" data-a="shot" aria-label="手動拍照"></button><span class="scan-hint">對準後會自動拍</span></div>`;
    document.body.appendChild(ui);
    const video = ui.querySelector("video"), guide = ui.querySelector(".scan-guide"), msg = ui.querySelector(".scan-msg"), prog = ui.querySelector(".scan-prog rect");
    const ac = document.createElement("canvas"), ag = ac.getContext("2d", { willReadFrequently: true });
    const say = t => { if (msg.textContent !== t) msg.textContent = t };

    function layout() {
      const W = ui.clientWidth, H = ui.clientHeight, r = vertical ? 1 / RATIO : RATIO;
      let gw = Math.min(W * .88, (H - 260) * r), gh = gw / r;
      if (gh > H - 260) { gh = H - 260; gw = gh * r }
      Object.assign(guide.style, { width: gw + "px", height: gh + "px", left: (W - gw) / 2 + "px", top: Math.max(70, (H - gh) / 2 - 30) + "px" });
      const svg = guide.querySelector("svg"); svg.setAttribute("viewBox", `0 0 ${gw} ${gh}`);
      prog.setAttribute("width", gw - 3); prog.setAttribute("height", gh - 3);
      const per = 2 * (gw + gh); prog.style.strokeDasharray = per; prog.style.strokeDashoffset = per; prog.dataset.per = per;
    }
    /* frame rectangle in video pixels (the video is shown with object-fit: cover) */
    function guideInVideo(extra = 0) {
      const vw = video.videoWidth, vh = video.videoHeight, W = ui.clientWidth, H = ui.clientHeight;
      const s = Math.max(W / vw, H / vh), ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
      const r = guide.getBoundingClientRect(), u = ui.getBoundingClientRect();
      const x = (r.left - u.left - ox) / s, y = (r.top - u.top - oy) / s, w = r.width / s, h = r.height / s;
      return { x: x - w * extra, y: y - h * extra, w: w * (1 + 2 * extra), h: h * (1 + 2 * extra) };
    }
    function setProgress(p) { prog.style.strokeDashoffset = (+prog.dataset.per) * (1 - p) }

    function capture(manual) {
      if (!video.videoWidth) return;
      const G = guideInVideo(0.02), C = !manual && cardRect ? { x: cardRect.x - cardRect.w * .015, y: cardRect.y - cardRect.h * .02, w: cardRect.w * 1.03, h: cardRect.h * 1.04 } : null;
      const R = C || G, cv = document.createElement("canvas");
      const sx = Math.max(0, R.x), sy = Math.max(0, R.y), sw = Math.min(video.videoWidth - sx, R.w), sh = Math.min(video.videoHeight - sy, R.h);
      cv.width = Math.round(sw); cv.height = Math.round(sh);
      cv.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      cv.toBlob(b => { if (b && !closed) onCapture && onCapture(b, { vertical, manual }) }, "image/jpeg", .92);
      shots++; lastShot = Date.now(); armed = false; armRef = prevTiny; steadyRun = 0; setProgress(0);
      const c = ui.querySelector(".scan-count"); c.hidden = false; c.textContent = `已拍 ${shots} 張`;
      ui.classList.add("flash"); setTimeout(() => ui.classList.remove("flash"), 180);
      try { navigator.vibrate && navigator.vibrate(30) } catch (e) { }
      guide.classList.remove("ok"); say(shots === 1 ? "拍好了！翻到背面或換下一張，會再自動拍" : `拍好了（${shots} 張）。換下一張，或按「完成」`);
    }

    function tick() {
      if (closed) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const R = guideInVideo(MARGIN); ac.width = AW; ac.height = Math.max(40, Math.round(AW * R.h / R.w));
        ag.drawImage(video, R.x, R.y, R.w, R.h, 0, 0, ac.width, ac.height);
        const id = ag.getImageData(0, 0, ac.width, ac.height);
        const a = analyze(id, vertical ? 1 / RATIO : RATIO), t = tiny(id), move = diff(t, prevTiny); prevTiny = t;
        const steady = move < 8, sharp = a.sharp > 55;
        if (a.aligned) cardRect = { x: R.x + a.rect.x * R.w, y: R.y + a.rect.y * R.h, w: a.rect.w * R.w, h: a.rect.h * R.h };
        if (!armed) {
          /* wait until the view has clearly changed since the last shot */
          if (diff(t, armRef) > 16 && Date.now() - lastShot > 900) { armed = true; say("把下一張名片放進框內") }
        } else if (!a.aligned) { cardRect = null; steadyRun = 0; setProgress(0); guide.classList.remove("ok"); say(a.strong >= 3 && !a.straight ? "名片有點歪，拿正一點" : a.strong >= 2 ? "整張名片都要在框內" : "把名片放進框內") }
        else if (!sharp) { steadyRun = 0; setProgress(0); guide.classList.add("ok"); say("有點模糊，拿穩一點或離遠一點對焦") }
        else if (!steady) { steadyRun = Math.max(0, steadyRun - 1); setProgress(steadyRun / 5); guide.classList.add("ok"); say("對準了，保持不動…") }
        else { steadyRun++; guide.classList.add("ok"); setProgress(Math.min(1, steadyRun / 5)); say("對準了，保持不動…"); if (steadyRun >= 5) capture(false) }
      }
      timer = setTimeout(() => { raf = requestAnimationFrame(tick) }, 90);
    }

    function close() {
      if (closed) return; closed = true; clearTimeout(timer); cancelAnimationFrame(raf);
      try { stream && stream.getTracks().forEach(t => t.stop()) } catch (e) { }
      removeEventListener("resize", layout); ui.remove(); onClose && onClose(shots);
    }
    ui.addEventListener("click", e => {
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      if (a === "close") close();
      else if (a === "shot") capture(true);
      else if (a === "rotate") { vertical = !vertical; e.target.textContent = vertical ? "橫式名片" : "直式名片"; layout(); steadyRun = 0 }
    });
    addEventListener("resize", layout);
    layout();
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then(async s => {
        if (closed) { s.getTracks().forEach(t => t.stop()); return true }
        stream = s; video.srcObject = s; try { await video.play() } catch (e) { }
        /* ask for continuous focus where the phone supports it */
        try { const tr = s.getVideoTracks()[0], cap = tr.getCapabilities ? tr.getCapabilities() : {}; if (cap.focusMode && cap.focusMode.includes("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }) } catch (e) { }
        say("把名片放進框內"); tick(); return true;
      })
      .catch(err => { close(); throw err });
  };
  window.__scanner = { analyze, tiny, diff, MARGIN, RATIO };
})();
