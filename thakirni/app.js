/* ذكرني */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LOCALE = "ar-u-nu-latn-ca-gregory";
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;

  /* ---------- التخزين (IndexedDB) ---------- */
  const store = (() => {
    let dbp = null;
    const mem = new Map();
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res) => {
        try {
          const rq = indexedDB.open("thakirni", 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore("notes", { keyPath: "id" });
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => res(null);
        } catch { res(null); }
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const db = await open();
      if (!db) return fn(null);
      return new Promise((res, rej) => {
        const t = db.transaction("notes", mode);
        const s = t.objectStore("notes");
        const out = fn(s);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
      });
    }
    return {
      all: () => tx("readonly", (s) => (s ? s.getAll() : { result: [...mem.values()] })),
      put: (n) => tx("readwrite", (s) => (s ? s.put(n) : mem.set(n.id, n))),
      del: (id) => tx("readwrite", (s) => (s ? s.delete(id) : mem.delete(id))),
    };
  })();

  /* ---------- الحالة ---------- */
  let notes = [];
  let current = null;
  let query = "";
  let savedRange = null;
  let saveTimer = null;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function textOf(html) {
    const d = document.createElement("div");
    d.innerHTML = html.replace(/<(div|h2|li|p|br)[^>]*>/gi, "\n$&");
    return d.textContent.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  function firstImg(html) {
    const m = /<img[^>]+src="([^"]+)"/.exec(html);
    return m ? m[1] : null;
  }
  function titleOf(n) {
    const lines = textOf(n.html);
    if (lines[0]) return lines[0];
    return firstImg(n.html) ? "صورة" : "ملاحظة جديدة";
  }
  function isEmpty(n) { return !textOf(n.html).length && !firstImg(n.html); }

  /* ---------- التواريخ ---------- */
  const fmtTime = (t) => new Date(t).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  function dayDiff(t) {
    const a = new Date(); a.setHours(0, 0, 0, 0);
    const b = new Date(t); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / DAY);
  }
  function fmtShort(t) {
    const d = dayDiff(t);
    if (d === 0) return fmtTime(t);
    if (d === -1) return "أمس";
    if (d > -7 && d < 0) return new Date(t).toLocaleDateString(LOCALE, { weekday: "long" });
    return new Date(t).toLocaleDateString(LOCALE, { day: "numeric", month: "numeric", year: "numeric" });
  }
  function fmtLong(t) {
    return new Date(t).toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" }) + "، " + fmtTime(t);
  }
  function fmtWhen(t) {
    const d = dayDiff(t);
    const time = fmtTime(t);
    if (d === 0) return "اليوم " + time;
    if (d === 1) return "بكرة " + time;
    if (d === -1) return "أمس " + time;
    return new Date(t).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" }) + " " + time;
  }
  function fmtIn(t) {
    const m = Math.round((t - Date.now()) / MIN);
    if (m <= 0) return "الحين";
    if (m < 60) return m === 1 ? "بعد دقيقة" : m === 2 ? "بعد دقيقتين" : `بعد ${m} دقيقة`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) {
      const hs = h === 1 ? "ساعة" : h === 2 ? "ساعتين" : `${h} ساعات`;
      return "بعد " + hs + (r ? ` و${r} دقيقة` : "");
    }
    const days = Math.round(m / 1440);
    return days === 1 ? "بعد يوم" : days === 2 ? "بعد يومين" : `بعد ${days} أيام`;
  }

  /* ---------- رسالة سريعة ---------- */
  let toastT;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 2600);
  }

  /* ---------- القائمة ---------- */
  function sorted() {
    return [...notes].sort((a, b) => b.updated - a.updated);
  }
  function renderList() {
    const list = $("list");
    const q = query.trim().toLowerCase();
    const items = sorted().filter((n) => !q || textOf(n.html).join(" ").toLowerCase().includes(q));
    list.innerHTML = "";

    const total = notes.filter((n) => !isEmpty(n) || n === current).length;
    $("count").textContent = total === 0 ? "مافي ملاحظات" : total === 1 ? "ملاحظة وحدة" : total === 2 ? "ملاحظتين" : `${total} ملاحظات`;

    if (!items.length) {
      const e = document.createElement("div");
      e.className = "empty";
      if (q) {
        e.innerHTML = "<b>ما لقيت شي</b>جرّب كلمة ثانية.";
      } else {
        e.innerHTML = 'صوّر أي شي أو اكتب اللي تبي وأذكرك فيه.<span class="empty-hint"><i class="dot-sky"></i>الكاميرا السماوية تحوّل الصورة لكلام<br><i class="dot-ink"></i>الكاميرا السودا تخليها صورة</span>';
      }
      list.appendChild(e);
      updateBadge();
      return;
    }

    const pinned = items.filter((n) => n.pinned);
    const rest = items.filter((n) => !n.pinned);
    if (pinned.length) list.appendChild(group("المثبّتة", pinned));
    if (rest.length) list.appendChild(group(pinned.length ? "الملاحظات" : "", rest));
    updateBadge();
  }
  function group(title, arr) {
    const frag = document.createDocumentFragment();
    if (title) {
      const h = document.createElement("div");
      h.className = "group-title";
      h.textContent = title;
      frag.appendChild(h);
    }
    const g = document.createElement("div");
    g.className = "group";
    for (const n of arr) {
      const b = document.createElement("button");
      b.className = "item" + (current && current.id === n.id ? " active" : "");
      const lines = textOf(n.html);
      const img = firstImg(n.html);
      const main = document.createElement("div");
      main.className = "item-main";
      const t = document.createElement("div");
      t.className = "item-title";
      t.textContent = titleOf(n);
      const sub = document.createElement("div");
      sub.className = "item-sub";
      sub.innerHTML = `<span class="when"></span><span class="snip"></span>`;
      sub.firstChild.textContent = fmtShort(n.updated);
      sub.lastChild.textContent = lines[1] || (img && lines.length ? "فيها صورة" : "ما فيها كلام زيادة");
      main.append(t, sub);
      if (n.reminder) {
        const r = document.createElement("div");
        r.className = "item-bell";
        r.innerHTML = '<svg><use href="#i-bell"/></svg><span></span>';
        r.lastChild.textContent = fmtWhen(n.reminder.at) + (n.reminder.repeat === "daily" ? " · كل يوم" : "");
        main.appendChild(r);
      }
      b.appendChild(main);
      if (img) {
        const im = document.createElement("img");
        im.className = "thumb";
        im.src = img;
        im.alt = "";
        b.appendChild(im);
      }
      b.onclick = () => openNote(n.id);
      g.appendChild(b);
    }
    frag.appendChild(g);
    return frag;
  }

  /* ---------- المحرر ---------- */
  const body = $("body");

  function setView(v) { $("app").dataset.view = v; }

  async function cleanup(n) {
    if (n && n !== current && isEmpty(n) && !n.reminder) {
      notes = notes.filter((x) => x !== n);
      await store.del(n.id);
      renderList();
    }
  }

  async function openNote(id) {
    flushSave();
    const prev = current;
    const next = notes.find((n) => n.id === id);
    if (!next) return;
    current = next;
    if (prev !== next) cleanup(prev);
    body.innerHTML = current.html;
    $("paneEmpty").hidden = true;
    $("editor").hidden = false;
    savedRange = null;
    renderMeta();
    renderList();
    setView("note");
  }

  function newNote(focus = true) {
    flushSave();
    const prev = current;
    const now = Date.now();
    const n = { id: uid(), html: "", created: now, updated: now, pinned: false, reminder: null };
    notes.push(n);
    current = n;
    body.innerHTML = "";
    $("paneEmpty").hidden = true;
    $("editor").hidden = false;
    savedRange = null;
    renderMeta();
    renderList();
    setView("note");
    if (focus) body.focus(); // لازم يكون مباشر عشان كيبورد الآيفون يطلع
    cleanup(prev);
    return n;
  }

  function closeNote() {
    flushSave();
    const prev = current;
    current = null;
    cleanup(prev);
    $("editor").hidden = true;
    $("paneEmpty").hidden = false;
    setView("list");
    renderList();
  }

  function renderMeta() {
    if (!current) return;
    $("edDate").textContent = fmtLong(current.updated);
    $("btnPin").classList.toggle("on", !!current.pinned);
    $("btnPin").setAttribute("aria-pressed", current.pinned ? "true" : "false");
    const chip = $("edReminder");
    if (current.reminder) {
      chip.hidden = false;
      chip.lastChild.textContent = fmtWhen(current.reminder.at) + (current.reminder.repeat === "daily" ? " · كل يوم" : "");
    } else chip.hidden = true;
    $("tAlarm").classList.toggle("on", !!current.reminder);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 350);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!current) return;
    const html = body.innerHTML;
    if (html === current.html) return;
    current.html = html;
    current.updated = Date.now();
    store.put(current);
    renderMeta();
    renderList();
  }
  async function persist(n) { await store.put(n); }

  // أول سطر يصير عنوان، فلازم يكون داخل div
  const BLOCK = "div,h2,ul,ol,.ph";
  function wrapLeadingText() {
    const f = body.firstChild;
    if (!f || (f.nodeType === 1 && f.matches(BLOCK))) return;
    const sel = window.getSelection();
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    const node = r && r.startContainer, off = r && r.startOffset;
    const div = document.createElement("div");
    while (body.firstChild && !(body.firstChild.nodeType === 1 && body.firstChild.matches(BLOCK))) div.appendChild(body.firstChild);
    body.insertBefore(div, body.firstChild);
    if (node && div.contains(node)) {
      const nr = document.createRange();
      nr.setStart(node, off);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
    }
  }
  try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch {}

  body.addEventListener("input", () => {
    if (body.innerHTML === "<br>" || body.innerHTML === "<div><br></div>") body.innerHTML = "";
    else wrapLeadingText();
    scheduleSave();
  });

  // نحفظ مكان المؤشر عشان نحط الصورة مكانه
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });

  // اللصق: صور أو نص عادي بس
  body.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.items].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
    e.preventDefault();
    if (files.length) {
      files.forEach((f) => fileToPhoto(f).then(insertPhoto));
      return;
    }
    const text = cd.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });

  // صح على المهام + فتح الصور
  body.addEventListener("click", (e) => {
    const img = e.target.closest(".ph img");
    if (img) { openViewer(img); return; }
    const li = e.target.closest("ul.checklist > li");
    if (li) {
      const r = li.getBoundingClientRect();
      const x = e.clientX;
      const inBox = getComputedStyle(li).direction === "rtl" ? x > r.right - 32 : x < r.left + 32;
      if (inBox) {
        li.classList.toggle("done");
        scheduleSave();
      }
    }
  });

  function selectionInBody() {
    const sel = window.getSelection();
    return sel.rangeCount && body.contains(sel.anchorNode);
  }
  function restoreSel() {
    body.focus();
    if (savedRange && !selectionInBody()) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  $("tTitle").onclick = () => {
    restoreSel();
    const sel = window.getSelection();
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const inH = node && node.closest("h2");
    document.execCommand("formatBlock", false, inH ? "div" : "h2");
    scheduleSave();
  };
  $("tCheck").onclick = () => {
    restoreSel();
    document.execCommand("insertUnorderedList");
    const sel = window.getSelection();
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const ul = node && node.closest("ul");
    if (ul && body.contains(ul)) ul.classList.add("checklist");
    scheduleSave();
  };

  /* ---------- الصور ---------- */
  function fileToPhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const src = shrink(im, im.naturalWidth, im.naturalHeight);
        URL.revokeObjectURL(url);
        res(src);
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
      im.src = url;
    });
  }
  function shrink(source, w, h, max = 1800) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.84);
  }

  function insertPhoto(src) {
    if (!current) return;
    const wrap = document.createElement("div");
    wrap.className = "ph";
    wrap.contentEditable = "false";
    const img = document.createElement("img");
    img.src = src;
    img.alt = "صورة";
    wrap.appendChild(img);
    const after = document.createElement("div");
    after.appendChild(document.createElement("br"));

    let placed = false;
    if (savedRange && body.contains(savedRange.startContainer)) {
      // نحطها بعد السطر اللي فيه المؤشر
      let block = savedRange.startContainer;
      while (block && block.parentNode !== body) block = block.parentNode;
      if (block && block !== body) {
        block.after(wrap, after);
        placed = true;
      }
    }
    if (!placed) {
      if (!body.innerHTML.trim()) {
        const head = document.createElement("div");
        head.textContent = "صورة " + new Date().toLocaleDateString(LOCALE, { day: "numeric", month: "long" });
        body.appendChild(head);
      }
      body.append(wrap, after);
    }
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(after, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
    flushSave();
    requestAnimationFrame(() => wrap.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  $("tImage").onclick = () => $("filePick").click();
  $("filePick").onchange = async (e) => {
    for (const f of e.target.files) {
      try { insertPhoto(await fileToPhoto(f)); } catch { toast("ما قدرت أفتح الصورة"); }
    }
    e.target.value = "";
  };
  $("fileCapture").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    closeCamera();
    if (!current) newNote(false);
    if (camMode === "text") { readText(f); return; }
    try { insertPhoto(await fileToPhoto(f)); toast("انلصقت الصورة"); } catch { toast("ما قدرت أفتح الصورة"); }
  };

  /* ---------- الكاميرا ---------- */
  let stream = null;
  let facing = "environment";

  async function startCamera() {
    stopStream();
    $("camMsg").hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camError("المتصفح هذا ما يدعم الكاميرا المباشرة.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      const v = $("camVideo");
      v.srcObject = stream;
      v.style.transform = facing === "user" ? "scaleX(-1)" : "";
      await v.play().catch(() => {});
    } catch (err) {
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      camError(denied
        ? "ما عطيتني إذن الكاميرا. تقدر تسمح لها من إعدادات المتصفح، أو تفتح كاميرا الجوال من هنا."
        : "ما قدرت أشغّل الكاميرا. جرّب كاميرا الجوال بدالها.");
    }
  }
  function camError(msg) {
    $("camMsgText").textContent = msg;
    $("camMsg").hidden = false;
  }
  function stopStream() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  // camMode: "photo" = تنحط الصورة نفسها، "text" = تنقرا وتصير كلام
  let camMode = "photo";
  function openCamera(mode = "photo") {
    unlockAudio();
    camMode = mode;
    const cam = $("camera");
    cam.classList.toggle("mode-text", mode === "text");
    cam.classList.toggle("mode-photo", mode !== "text");
    $("camHint").innerHTML = mode === "text"
      ? "وجّه الكاميرا على الكلام، وبحوّله لك <b>كتابة</b>"
      : "وجّه الكاميرا واضغط الزر، وتنحط <b>صورة</b>";
    cam.hidden = false;
    startCamera();
  }
  function closeCamera() {
    stopStream();
    $("camera").hidden = true;
  }
  function quickCamera(mode) {
    newNote(false);
    openCamera(mode);
  }

  $("tCam").onclick = () => openCamera("photo");
  $("tText").onclick = () => openCamera("text");
  $("btnQuickCam").onclick = () => quickCamera("photo");
  $("btnQuickText").onclick = () => quickCamera("text");
  $("camClose").onclick = closeCamera;
  $("camFallback").onclick = () => $("fileCapture").click();
  $("camFlip").onclick = () => { facing = facing === "environment" ? "user" : "environment"; startCamera(); };
  $("camShot").onclick = () => {
    const v = $("camVideo");
    if (!stream || !v.videoWidth) { $("fileCapture").click(); return; }
    const fl = $("camFlash");
    fl.classList.add("go");
    requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove("go")));
    if (camMode === "text") {
      const c = ocrCanvas(v, v.videoWidth, v.videoHeight);
      closeCamera();
      readText(c);
      return;
    }
    const src = shrink(v, v.videoWidth, v.videoHeight);
    closeCamera();
    insertPhoto(src);
    toast("انلصقت الصورة في الملاحظة");
  };

  /* ---------- تحويل الصورة لكلام (Tesseract) ---------- */
  let ocrWorker = null;
  let ocrJob = 0;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const sc = document.createElement("script");
      sc.src = src;
      sc.onload = res;
      sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  function readingUI(title, pct, sub, failed) {
    $("reading").hidden = false;
    $("reading").classList.toggle("failed", !!failed);
    if (title) $("readTitle").textContent = title;
    $("readBar").style.width = Math.round((pct || 0) * 100) + "%";
    $("readSub").textContent = sub || "";
    $("readCancel").textContent = failed ? "سكّر" : "إلغاء";
    $("readRetry").hidden = !failed;
  }
  function timeout(p, ms, what) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
  }
  async function getWorker(job) {
    if (ocrWorker) return ocrWorker;
    await timeout(loadScript("ocr/tesseract.min.js"), 30000, "ما تحمّل ملف القراية");
    const base = new URL("ocr/", location.href).href;
    // المكتبة أحياناً تعلّق بدل ما تعطي خطأ، فنمسك الخطأ بأنفسنا
    let fail;
    const failed = new Promise((_, rej) => (fail = rej));
    const w = await timeout(Promise.race([failed, Tesseract.createWorker(["ara", "eng"], 1, {
      workerPath: base + "worker.min.js",
      workerBlobURL: false,
      corePath: base + "core",
      langPath: base + "lang",
      logger: (m) => {
        if (job !== ocrJob) return;
        if (m.status === "recognizing text") return;
        else readingUI("أجهّز القراية…", m.progress * 0.9, "أول مرة بس تاخذ شوي، بعدها تصير أسرع");
      },
      errorHandler: (e) => fail(e instanceof Error ? e : new Error(String(e))),
    })]), 120000, "التجهيز طوّل كثير");
    await w.setParameters({
      tessedit_pageseg_mode: "3",
      tessedit_char_blacklist: "|\\§©®™¢£¥¤¦¬¨`^~_{}[]<>«»“”„•·¶†‡",
      preserve_interword_spaces: "1",
    });
    ocrWorker = w;
    return w;
  }

  // نجهز الصورة للقراية: نصغرها، ونخليها أبيض وأسود حسب الإضاءة حول كل نقطة،
  // فالخلفية والرسومات تصير بيضا والكلام يبقى أسود. ولو الخلفية غامقة (سبورة) نعكسها.
  function ocrCanvas(source, w, h) {
    return { adaptive: prepCanvas(source, w, h, true), gray: prepCanvas(source, w, h, false) };
  }
  function prepCanvas(source, w, h, adaptive) {
    const k = Math.min(1, 2000 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(source, 0, 0, W, H);
    const im = ctx.getImageData(0, 0, W, H);
    const d = im.data;
    const g = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0; i < g.length; i++) {
      const v = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
      g[i] = v;
      sum += v;
    }
    if (sum / g.length < 110) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
    if (!adaptive) {
      for (let i = 0; i < g.length; i++) { const o = i * 4; d[o] = d[o + 1] = d[o + 2] = g[i]; d[o + 3] = 255; }
      ctx.putImageData(im, 0, 0);
      return c;
    }
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += g[y * W + x];
        I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(Math.min(W, H) / 40));
    for (let y = 0; y < H; y++) {
      const y1 = Math.max(0, y - r), y2 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x1 = Math.max(0, x - r), x2 = Math.min(W, x + r + 1);
        const mean = (I[y2 * (W + 1) + x2] - I[y1 * (W + 1) + x2] - I[y2 * (W + 1) + x1] + I[y1 * (W + 1) + x1]) / ((x2 - x1) * (y2 - y1));
        const v = g[y * W + x] < mean * 0.85 ? 0 : 255;
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }
  function fileToCanvas(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { const c = ocrCanvas(im, im.naturalWidth, im.naturalHeight); URL.revokeObjectURL(url); res(c); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("ما انفتحت الصورة")); };
      im.src = url;
    });
  }

  // ناخذ بس الكلمات اللي القراية متأكدة منها، ونشيل الرموز والخربطة اللي تجي من الرسومات والخلفية
  const JUNK_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu;
  const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  function goodWord(w, lineConf) {
    const t = (w.text || "").replace(BIDI, "").replace(JUNK_EDGES, "");
    if (!t) return null;
    const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters / t.length < 0.7) return null;                  // أغلبها رموز
    if (/(.)\1{2,}/u.test(t) && !/\p{N}/u.test(t)) return null; // حرف مكرر مثل lll
    if (/^\p{Script=Latin}$/u.test(t) && !/^[aAI]$/.test(t)) return null; // حرف إنجليزي لحاله
    const arabic = /\p{Script=Arabic}/u.test(t);
    let need = arabic ? 58 : 65;
    if (letters <= 2) need = /^\p{N}+$/u.test(t) ? 65 : 75;    // الكلمات القصيرة أكثر شي يطلع غلط
    // السطر كله واضح؟ نثق بكلماته حتى لو وحدة منها درجتها أقل
    if (lineConf >= 75 && letters >= 2) need = Math.min(need, 40);
    return w.confidence >= need ? t : null;
  }
  function cleanResult(data) {
    const out = [];
    let score = 0;
    for (const b of data.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          const all = l.words || [];
          let kept = all.map((w) => ({ t: goodWord(w, l.confidence), c: w.confidence })).filter((x) => x.t);
          // أطراف السطر أكثر مكان تطلع فيه زيادات من حواف الصورة والرسومات
          const shaky = (x) => x.t.length <= 2 && x.c < (/^\p{N}+$/u.test(x.t) ? 80 : 90);
          while (kept.length > 1 && shaky(kept[0])) kept.shift();
          while (kept.length > 1 && shaky(kept[kept.length - 1])) kept.pop();
          const words = kept.map((x) => x.t);
          if (!words.length) continue;
          const chars = words.join("").length;
          if (chars < 2) continue;
          // سطر أغلبه خربطة وفيه كلمة قصيرة وحدة صح بالصدفة
          if (all.length >= 4 && words.length / all.length < 0.3 && chars < 6) continue;
          out.push(words.join(" "));
          score += chars;
        }
      }
    }
    return { lines: out, score };
  }

  let lastOcrSrc = null;
  async function readText(src) {
    const job = ++ocrJob;
    readingUI("أجهّز القراية…", 0.02, "");
    try {
      const canvases = src instanceof Blob ? await fileToCanvas(src) : src;
      lastOcrSrc = canvases;
      const w = await getWorker(job);
      if (job !== ocrJob) return;
      // نقرا الصورة بطريقتين وناخذ اللي طلع منها كلام أكثر
      let best = { lines: [], score: 0 };
      const passes = [canvases.adaptive, canvases.gray];
      for (let n = 0; n < passes.length; n++) {
        readingUI("أقرا الكلام…", n / passes.length, passes.length > 1 ? `المحاولة ${n + 1} من ${passes.length}` : "");
        const { data } = await timeout(w.recognize(passes[n], {}, { text: true, blocks: true }), 90000, "القراية طوّلت كثير");
        if (job !== ocrJob) return;
        const r = cleanResult(data);
        if (r.score > best.score) best = r;
      }
      $("reading").hidden = true;
      const lines = best.lines;
      if (!lines.length) { toast("ما لقيت كلام واضح، قرّب الكاميرا وجرّب مرة ثانية"); return; }
      insertLines(lines);
      toast("تحوّلت لكلام، عدّل اللي تبي");
    } catch (err) {
      if (job !== ocrJob) return;
      // نرمي الـ worker عشان المحاولة الجاية تبدأ من جديد
      if (ocrWorker) { const w = ocrWorker; ocrWorker = null; w.terminate().catch(() => {}); }
      const why = (err && (err.message || String(err))) || "خطأ";
      const offline = navigator.onLine === false;
      readingUI("ما زبطت القراية", 0, offline ? "أول مرة تحتاج نت عشان تتجهز القراية." : "السبب:\n\u2068" + why + "\u2069", true);
    }
  }
  $("readCancel").onclick = async () => {
    ocrJob++;
    $("reading").hidden = true;
    if (ocrWorker && !$("reading").classList.contains("failed")) {
      const w = ocrWorker; ocrWorker = null; try { await w.terminate(); } catch {}
    }
  };
  $("readRetry").onclick = () => { if (lastOcrSrc) readText(lastOcrSrc); };

  function insertLines(lines) {
    if (!current) return;
    const frag = document.createDocumentFragment();
    let last = null;
    for (const l of lines) {
      const d = document.createElement("div");
      d.textContent = l;
      frag.appendChild(d);
      last = d;
    }
    let placed = false;
    if (savedRange && body.contains(savedRange.startContainer)) {
      let block = savedRange.startContainer;
      while (block && block.parentNode !== body) block = block.parentNode;
      if (block && block !== body) {
        const empty = !block.textContent.trim() && !block.querySelector("img");
        if (empty) block.replaceWith(frag); else block.after(frag);
        placed = true;
      }
    }
    if (!placed) body.appendChild(frag);
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
    flushSave();
    requestAnimationFrame(() => last.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  /* ---------- عرض الصورة ---------- */
  let viewing = null;
  function openViewer(img) {
    viewing = img;
    $("viewerImg").src = img.src;
    $("viewerSave").href = img.src;
    $("viewer").hidden = false;
  }
  $("viewerClose").onclick = () => { $("viewer").hidden = true; viewing = null; };
  $("viewerDel").onclick = () => {
    if (viewing) {
      const ph = viewing.closest(".ph");
      if (ph) ph.remove();
      flushSave();
    }
    $("viewer").hidden = true;
    viewing = null;
    toast("انحذفت الصورة");
  };

  /* ---------- الأصوات (Web Audio) ---------- */
  let actx = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function unlockAudio() {
    const a = audio();
    if (!a) return;
    const b = a.createBuffer(1, 1, 22050);
    const s = a.createBufferSource();
    s.buffer = b;
    s.connect(a.destination);
    s.start(0);
  }
  function tone(a, freq, start, dur, type = "sine", vol = 0.35) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(a.destination);
    o.start(start);
    o.stop(start + dur + 0.05);
  }
  const SOUNDS = {
    bell(a, t) {
      [0, 0.45].forEach((d) => {
        tone(a, 1318.5, t + d, 1.1, "sine", 0.32);
        tone(a, 2637, t + d, 0.6, "sine", 0.08);
        tone(a, 659.25, t + d, 1.2, "triangle", 0.12);
      });
      return 1.6;
    },
    beep(a, t) {
      for (let i = 0; i < 4; i++) tone(a, 1046.5, t + i * 0.16, 0.1, "square", 0.12);
      return 1.0;
    },
    soft(a, t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, f, t + i * 0.22, 0.9, "triangle", 0.25));
      return 1.9;
    },
  };
  function playOnce(name) {
    const a = audio();
    if (!a) return 1;
    return (SOUNDS[name] || SOUNDS.bell)(a, a.currentTime + 0.02);
  }
  let loopT = null;
  function startLoop(name) {
    stopLoop();
    const run = () => {
      const len = playOnce(name);
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      loopT = setTimeout(run, len * 1000 + 350);
    };
    run();
  }
  function stopLoop() {
    clearTimeout(loopT);
    loopT = null;
    if (navigator.vibrate) navigator.vibrate(0);
  }
  ["pointerdown", "keydown", "touchend"].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { once: true, passive: true })
  );

  /* ---------- نافذة المنبه ---------- */
  const remDlg = $("remDlg");
  let remFor = null;
  let remState = { repeat: "none", sound: "bell" };

  const pad = (n) => String(n).padStart(2, "0");
  function toInputs(t) {
    const d = new Date(t);
    $("remDate").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $("remTime").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromInputs() {
    const dv = $("remDate").value, tv = $("remTime").value;
    if (!dv || !tv) return null;
    const [y, m, d] = dv.split("-").map(Number);
    const [hh, mm] = tv.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  }
  function setSeg(id, v) {
    $(id).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  }
  function updatePreview() {
    const t = fromInputs();
    const p = $("remPreview");
    if (!t) { p.textContent = ""; return; }
    if (t <= Date.now() && remState.repeat === "none") { p.textContent = "هالوقت راح، اختر وقت جاي."; return; }
    p.textContent = "بذكرك " + fmtWhen(nextAt(t, remState.repeat)) + " (" + fmtIn(nextAt(t, remState.repeat)) + ")";
  }
  function nextAt(t, repeat) {
    if (repeat === "daily") while (t <= Date.now()) t += DAY;
    return t;
  }

  function openReminder(note) {
    unlockAudio();
    remFor = note;
    const r = note.reminder;
    remState = { repeat: r ? r.repeat : "none", sound: r ? r.sound : "bell" };
    let t = r ? r.at : Date.now() + 60 * MIN;
    if (!r) { const d = new Date(t); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); t = d.getTime(); }
    toInputs(t);
    setSeg("remRepeat", remState.repeat);
    setSeg("remSound", remState.sound);
    $("remQuick").querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
    $("remRemove").hidden = !r;
    $("remSave").textContent = r ? "عدّل المنبه" : "ثبّت المنبه";
    updatePreview();
    renderOutside();
    remDlg.showModal();
  }

  $("remQuick").onclick = (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const now = new Date();
    let t;
    switch (c.dataset.q) {
      case "1m": t = Date.now() + 1 * MIN; break;
      case "10m": t = Date.now() + 10 * MIN; break;
      case "1h": t = Date.now() + 60 * MIN; break;
      case "tonight": { const d = new Date(now); d.setHours(21, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); t = d.getTime(); break; }
      case "tomorrow": { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); t = d.getTime(); break; }
    }
    toInputs(t);
    $("remQuick").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c));
    updatePreview();
  };
  ["remDate", "remTime"].forEach((id) => $(id).addEventListener("input", () => {
    $("remQuick").querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
    updatePreview();
  }));
  $("remRepeat").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    remState.repeat = b.dataset.v; setSeg("remRepeat", b.dataset.v); updatePreview();
  };
  $("remSound").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    remState.sound = b.dataset.v; setSeg("remSound", b.dataset.v); playOnce(b.dataset.v);
  };
  $("remCancel").onclick = () => remDlg.close();
  remDlg.addEventListener("click", (e) => { if (e.target === remDlg) remDlg.close(); });

  /* ---------- تقويم الجوال: يرن حتى لو الموقع مسكّر ---------- */
  // وين يرن المنبه لو الموقع مسكّر: منبه الساعة (عن طريق الاختصارات)، أو التقويم، أو ولا شي
  const OUT_KEY = "thakirni-outside", CLOCK_KEY = "thakirni-clock-ready";
  const store2 = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  let outside = store2.get(OUT_KEY) || (store2.get(CLOCK_KEY) ? "clock" : "cal");
  function renderOutside() {
    setSeg("remOutside", outside);
    const h = $("outsideHint");
    if (outside === "clock") {
      h.innerHTML = store2.get(CLOCK_KEY)
        ? "منبه حقيقي في تطبيق الساعة، يرن بصوت عالي لين تطفيه."
        : 'يحتاج تجهيز مرة وحدة. <button type="button" id="clockHow">جهّزه الحين</button>';
      const how = $("clockHow");
      if (how) how.onclick = () => clockDlg.showModal();
    } else if (outside === "cal") {
      h.textContent = 'تنبيه من تقويم الجوال في وقته. لما تطلع لك شاشة التقويم اضغط "إضافة".';
    } else {
      h.textContent = "يرن بس والموقع مفتوح.";
    }
  }
  $("remOutside").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    outside = b.dataset.v;
    store2.set(OUT_KEY, outside);
    renderOutside();
  };

  const clockDlg = $("clockDlg");
  const SITE = location.href.split("#")[0].split("?")[0];
  function runClock(at, label) {
    const d = new Date(at);
    const hhmm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const q = new URLSearchParams({ name: "ذكرني", input: "text", text: hhmm, "x-success": SITE });
    location.href = "shortcuts://x-callback-url/run-shortcut?" + q.toString().replace(/\+/g, "%20");
  }
  $("clockClose").onclick = () => clockDlg.close();
  $("clockTest").onclick = () => runClock(Date.now() + 60 * 1000, "تجربة");
  $("clockDone").onclick = () => {
    store2.set(CLOCK_KEY, "1");
    outside = "clock";
    store2.set(OUT_KEY, outside);
    clockDlg.close();
    renderOutside();
    toast("تمام، المنبهات الجاية بتنحط في تطبيق الساعة");
  };
  clockDlg.addEventListener("click", (e) => { if (e.target === clockDlg) clockDlg.close(); });

  function icsDate(t) {
    return new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  function icsText(v) {
    return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  // سطور ملف التقويم لازم ما تزيد عن 75 بايت، فنقسمها بدون ما نقطع حرف عربي
  function icsFold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const parts = [];
    let cur = "", size = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (size + b > limit) { parts.push(cur); cur = ""; size = 0; limit = 74; }
      cur += ch;
      size += b;
    }
    parts.push(cur);
    return parts.join("\r\n ");
  }
  function makeIcs(n) {
    const title = titleOf(n);
    const rest = textOf(n.html).slice(1).join("\n");
    const at = n.reminder.at;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Thakirni//AR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + n.id + "@thakirni",
      "DTSTAMP:" + icsDate(Date.now()),
      "DTSTART:" + icsDate(at),
      "DTEND:" + icsDate(at + 15 * MIN),
      "SUMMARY:" + icsText(title),
      "DESCRIPTION:" + icsText((rest ? rest + "\n\n" : "") + "من ذكرني: " + location.href.split("#")[0]),
      "URL:" + location.href.split("#")[0],
    ];
    if (n.reminder.repeat === "daily") lines.push("RRULE:FREQ=DAILY");
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + icsText(title),
      "TRIGGER:PT0S",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    );
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }
  function addToCalendar(n) {
    const ics = makeIcs(n);
    // لو ملف التخزين شغّال نفتح التقويم كرابط عادي، والآيفون يطلع شاشة الإضافة
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(ics))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      location.href = "event.ics?d=" + b64;
      return;
    }
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "thakirni.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }

  $("remForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let t = fromInputs();
    if (!t) return;
    if (t <= Date.now() && remState.repeat === "none") { toast("هالوقت راح، اختر وقت جاي"); return; }
    t = nextAt(t, remState.repeat);
    const n = remFor;
    if (!n) return;
    if (n === current) flushSave();
    n.reminder = { at: t, repeat: remState.repeat, sound: remState.sound };
    if (isEmpty(n) && n === current) {
      body.innerHTML = "<div>تذكير</div>";
      n.html = body.innerHTML;
    }
    n.updated = Date.now();
    // منبه الساعة ما ينفع لأكثر من يوم أو للتكرار اليومي، فهذي تروح للتقويم
    let mode = outside;
    if (mode === "clock" && !store2.get(CLOCK_KEY)) mode = "cal";
    if (mode === "clock" && (remState.repeat === "daily" || t - Date.now() > 23 * 60 * MIN)) mode = "cal";
    const saving = persist(n); // نبدأ الحفظ قبل ما نطلع من الصفحة
    remDlg.close();
    renderMeta();
    renderList();
    // لازم نفتح الساعة أو التقويم وقت الضغطة نفسها، قبل أي انتظار، وإلا الآيفون يمنعه
    if (mode === "clock") { runClock(t, titleOf(n)); toast("بيفتح الاختصارات ويحط المنبه في الساعة"); }
    else if (mode === "cal") { addToCalendar(n); toast("اضغط \"إضافة\" في التقويم عشان يرن حتى لو الموقع مسكّر"); }
    else toast("تمام، بذكرك " + fmtWhen(t));
    await saving;
    askNotifyIfNeeded();
  });
  $("remRemove").onclick = async () => {
    if (!remFor) return;
    remFor.reminder = null;
    await persist(remFor);
    remDlg.close();
    renderMeta();
    renderList();
    toast("انشال المنبه");
  };

  $("tAlarm").onclick = () => { flushSave(); if (current) openReminder(current); };
  $("edReminder").onclick = () => { if (current) openReminder(current); };

  /* ---------- قائمة المنبهات ---------- */
  const alarmsDlg = $("alarmsDlg");
  function upcoming() {
    return notes.filter((n) => n.reminder).sort((a, b) => a.reminder.at - b.reminder.at);
  }
  function updateBadge() {
    const c = upcoming().length;
    const b = $("alarmBadge");
    b.hidden = c === 0;
    b.textContent = c;
  }
  function renderAlarms() {
    const box = $("alarmsList");
    box.innerHTML = "";
    const arr = upcoming();
    if (!arr.length) {
      box.innerHTML = '<div class="empty"><b>مافي منبهات</b>افتح أي ملاحظة واضغط على "منبه"، أو سوّ واحد جديد من هنا.</div>';
      return;
    }
    for (const n of arr) {
      const row = document.createElement("button");
      row.className = "alarm-row";
      row.innerHTML = '<span class="alarm-time"></span><span class="alarm-info"><b></b><span></span></span>';
      row.querySelector(".alarm-time").textContent = fmtTime(n.reminder.at);
      row.querySelector("b").textContent = titleOf(n);
      row.querySelector(".alarm-info span").textContent =
        fmtWhen(n.reminder.at).replace(" " + fmtTime(n.reminder.at), "") + " · " + fmtIn(n.reminder.at) + (n.reminder.repeat === "daily" ? " · كل يوم" : "");
      row.onclick = () => { alarmsDlg.close(); openNote(n.id); };
      box.appendChild(row);
    }
  }
  $("btnAlarms").onclick = () => { renderAlarms(); alarmsDlg.showModal(); };
  $("alarmsClose").onclick = () => alarmsDlg.close();
  alarmsDlg.addEventListener("click", (e) => { if (e.target === alarmsDlg) alarmsDlg.close(); });
  $("alarmsNew").onclick = async () => {
    alarmsDlg.close();
    const n = newNote(false);
    body.innerHTML = "<div>تذكير</div>";
    flushSave();
    openReminder(n);
  };

  /* ---------- التنبيهات ---------- */
  const NOTIFY_KEY = "thakirni-notify-later";
  function askNotifyIfNeeded() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    let later = false;
    try { later = localStorage.getItem(NOTIFY_KEY) === "1"; } catch {}
    if (!later) $("notifyBar").hidden = false;
  }
  $("btnNotifyOn").onclick = async () => {
    $("notifyBar").hidden = true;
    try {
      const p = await Notification.requestPermission();
      toast(p === "granted" ? "تمام، التنبيهات شغالة" : "ما انفعلت، بس المنبه بيرن وانت فاتح الموقع");
    } catch {}
  };
  $("btnNotifyLater").onclick = () => {
    $("notifyBar").hidden = true;
    try { localStorage.setItem(NOTIFY_KEY, "1"); } catch {}
  };
  async function sysNotify(title, bodyText, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body: bodyText, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", requireInteraction: true, renotify: true };
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) { reg.showNotification(title, opts); return; }
    } catch {}
    try { new Notification(title, opts); } catch {}
  }

  /* ---------- الرنين ---------- */
  let ringing = null;
  const queue = [];

  function checkDue() {
    const now = Date.now();
    for (const n of notes) {
      if (n.reminder && n.reminder.at <= now && !queue.includes(n) && ringing !== n) queue.push(n);
    }
    if (!ringing && queue.length) ring(queue.shift());
  }

  function ring(n) {
    ringing = n;
    const late = Date.now() - n.reminder.at > 2 * MIN;
    $("ringLabel").textContent = late ? "فاتك هالتذكير" : "حان الوقت";
    $("ringTime").textContent = fmtTime(late ? n.reminder.at : Date.now());
    $("ringTitle").textContent = titleOf(n);
    $("ring").hidden = false;
    startLoop(n.reminder.sound || "bell");
    sysNotify("ذكرني: " + titleOf(n), late ? "فاتك هالتذكير الساعة " + fmtTime(n.reminder.at) : "حان الوقت", "rem-" + n.id);
    document.title = "• " + titleOf(n);
  }

  async function endRing(snooze) {
    const n = ringing;
    stopLoop();
    $("ring").hidden = true;
    document.title = "ذكرني";
    ringing = null;
    if (!n || !n.reminder) { checkDue(); return; }
    if (snooze) {
      n.reminder.at = Date.now() + 5 * MIN;
      toast("بذكرك بعد 5 دقايق");
    } else if (n.reminder.repeat === "daily") {
      n.reminder.at = nextAt(n.reminder.at, "daily");
    } else {
      n.reminder = null;
    }
    await persist(n);
    if (n === current) renderMeta();
    renderList();
    setTimeout(checkDue, 400);
  }
  $("ringStop").onclick = () => endRing(false);
  $("ringSnooze").onclick = () => endRing(true);
  $("ringOpen").onclick = async () => { const n = ringing; await endRing(false); if (n) openNote(n.id); };

  /* ---------- الأزرار العامة ---------- */
  $("btnNew").onclick = () => newNote(true);
  $("btnBack").onclick = closeNote;
  $("btnDone").onclick = () => {
    flushSave();
    body.blur();
    if (window.matchMedia("(max-width: 879px)").matches) closeNote();
    else toast("انحفظت");
  };
  $("btnPin").onclick = async () => {
    if (!current) return;
    flushSave();
    current.pinned = !current.pinned;
    await persist(current);
    renderMeta();
    renderList();
    toast(current.pinned ? "ثبّتها فوق" : "شلت التثبيت");
  };
  $("btnDelete").onclick = async () => {
    if (!current) return;
    if (!isEmpty(current) && !confirm("متأكد تبي تحذفها؟")) return;
    const id = current.id;
    notes = notes.filter((n) => n.id !== id);
    await store.del(id);
    current = null;
    $("editor").hidden = true;
    $("paneEmpty").hidden = false;
    setView("list");
    renderList();
    toast("انحذفت");
  };
  $("search").addEventListener("input", (e) => { query = e.target.value; renderList(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("camera").hidden) closeCamera();
      else if (!$("viewer").hidden) $("viewerClose").click();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushSave();
    else checkDue();
  });
  window.addEventListener("pagehide", flushSave);

  /* ---------- البداية ---------- */
  async function init() {
    try { notes = (await store.all()) || []; } catch { notes = []; }
    notes = notes.filter((n) => !isEmpty(n) || n.reminder);
    renderList();
    if (notes.some((n) => n.reminder)) askNotifyIfNeeded();
    checkDue();
    setInterval(checkDue, 1000);
    setInterval(() => { if (current) $("edDate").textContent = fmtLong(current.updated); }, 30 * 1000);
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
    }
  }
  init();
})();
