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
    return firstImg(n.html) ? "صورة اللوحة" : "ملاحظة جديدة";
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
        e.innerHTML = '<b>مافي ملاحظات للحين</b>اكتب أول وحدة، أو صوّر اللوحة وتنحفظ هنا على طول.<br><button class="btn btn-ink" id="emptyCam">صوّر اللوحة</button>';
      }
      list.appendChild(e);
      const ec = $("emptyCam");
      if (ec) ec.onclick = quickCamera;
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
  function shrink(source, w, h) {
    const max = 1800;
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
        head.textContent = "صورة اللوحة " + new Date().toLocaleDateString(LOCALE, { day: "numeric", month: "long" });
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
  function openCamera() {
    unlockAudio();
    $("camera").hidden = false;
    startCamera();
  }
  function closeCamera() {
    stopStream();
    $("camera").hidden = true;
  }
  function quickCamera() {
    newNote(false);
    openCamera();
  }

  $("tCam").onclick = openCamera;
  $("btnQuickCam").onclick = quickCamera;
  $("camClose").onclick = closeCamera;
  $("camFallback").onclick = () => $("fileCapture").click();
  $("camFlip").onclick = () => { facing = facing === "environment" ? "user" : "environment"; startCamera(); };
  $("camShot").onclick = () => {
    const v = $("camVideo");
    if (!stream || !v.videoWidth) { $("fileCapture").click(); return; }
    const fl = $("camFlash");
    fl.classList.add("go");
    requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove("go")));
    const src = shrink(v, v.videoWidth, v.videoHeight);
    closeCamera();
    insertPhoto(src);
    toast("انلصقت الصورة في الملاحظة");
  };

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
    remDlg.showModal();
  }

  $("remQuick").onclick = (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    const now = new Date();
    let t;
    switch (c.dataset.q) {
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
    await persist(n);
    remDlg.close();
    renderMeta();
    renderList();
    toast("تمام، بذكرك " + fmtWhen(t));
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
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }
  init();
})();
