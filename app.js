(() => {
  "use strict";

  const APP_VERSION = "1.3.1";
  const BOARD_ID = "pspl-proposer";
  const DEFAULT_SITE = "https://mitchellshen.github.io/pspl-proposer/";
  const DEFAULT_REPO = "https://github.com/mitchellshen/pspl-proposer";
  const NASA_API = "https://science.nasa.gov/wp-json/wp/v2/topic";
  const GG_API = "https://api.grants.gov/v1/api/search2";
  const IS_FILE = location.protocol === "file:";

  // ---------- small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const clampInt = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
  const scoreOf = (o) => clampInt(o.a, 3) + clampInt(o.r, 3) + clampInt(o.t, 2);
  const fitOf = (s) => (s >= 6 ? "High" : s >= 4 ? "Medium" : "Low");
  const todayLocal = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const isoDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  function daysLeft(o) { const d = parseDay(o.due); return d ? Math.round((d - todayLocal()) / 864e5) : null; }
  const fmtDay = (d, withYear) => d.toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  const str = (v, n = 2000) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const nowIso = () => new Date().toISOString();
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
  const maxStr = (a, b) => (String(a || "") >= String(b || "") ? a : b) || null;
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const shortUrl = (u) => String(u || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");

  const STATUS = { open: "Open", step2: "Step-2 only", expected: "Expected", unknown: "Unknown", archived: "Archived" };
  const DIVISIONS = ["Heliophysics", "Planetary", "Astrophysics", "Earth Science", "Cross-division", "Exploration", "Technology", "Other"];
  const LETTER_DIV = { A: "Earth Science", B: "Heliophysics", C: "Planetary", D: "Astrophysics", E: "Other", F: "Cross-division" };
  const MAIN_LETTERS = new Set(["B", "C", "F"]);
  const OPEN = new Set(["open", "step2"]);
  const LATER = new Set(["expected", "unknown"]);
  const TABS = ["opportunities", "capabilities", "method"];
  const OPP_FIELDS = ["abbr", "element", "title", "division", "sid", "status", "prevStatus", "statusNote", "due", "dueLabel", "a", "r", "t", "brings", "bringsText", "gaps", "says", "action", "notes", "sources", "flag", "origin", "createdAt", "updatedAt"];
  const CAP_FIELDS = ["kind", "category", "name", "evidence", "maturity", "source", "owner", "confirmed", "order", "updatedAt"];

  // ---------- storage ----------
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
  function probeStorage() {
    try { const k = "pspl-proposer:probe"; localStorage.setItem(k, "1"); const ok = localStorage.getItem(k) === "1"; localStorage.removeItem(k); return ok; } catch (e) { return false; }
  }
  const K_CHANGES = "pspl-proposer:changes:" + BOARD_ID;
  const K_REVIEW = "pspl-proposer:review:" + BOARD_ID;
  const K_LASTGOOD = "pspl-proposer:lastgood:" + BOARD_ID;
  const K_PREFS = "pspl-proposer:prefs";

  // ---------- the shared board (board.json on the site) ----------
  function normalizeBoard(d) {
    if (!isObj(d) || !isObj(d.opps) || !isObj(d.caps)) return null;
    const out = Object.assign({}, d);
    out.opps = {};
    for (const [k, v] of Object.entries(d.opps)) if (isObj(v)) out.opps[k] = v;
    out.caps = {};
    for (const [k, v] of Object.entries(d.caps)) if (isObj(v)) out.caps[k] = v;
    out.nasa = isObj(d.nasa) ? Object.assign({}, d.nasa) : {};
    out.nasa.reviewed = isObj(out.nasa.reviewed) ? out.nasa.reviewed : {};
    out.nasa.blogs = Array.isArray(out.nasa.blogs) ? out.nasa.blogs : [];
    out.site = safeUrl(d.site) || DEFAULT_SITE;
    out.repo = safeUrl(d.repo) || DEFAULT_REPO;
    return out;
  }
  let BASE = normalizeBoard({ opps: {}, caps: {} });
  function siteUrl() {
    if (!IS_FILE) return new URL(".", location.href).href;
    const cached = normalizeBoard(store.get(K_LASTGOOD, null));
    return (cached && cached.site) || DEFAULT_SITE;
  }
  const boardUrl = () => new URL("board.json", siteUrl()).href;
  function repoSlug() {
    const m = /github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(BASE.repo || "");
    return m ? m[1] + "/" + m[2].replace(/\.git$/i, "") : "mitchellshen/pspl-proposer";
  }
  const editUrl = () => "https://github.com/" + repoSlug() + "/edit/main/board.json";
  const apiBoardUrl = () => "https://api.github.com/repos/" + repoSlug() + "/contents/board.json?ref=main";
  async function fetchBoard() {
    // Same-origin credentials so a privately published Pages site (GitHub Enterprise Cloud)
    // gets the visitor's sign-in; a public site and saved copies are unaffected.
    const raw = await getJson(boardUrl() + "?t=" + Date.now(), { credentials: "same-origin" });
    const board = normalizeBoard(raw);
    if (!board) throw shapeError();
    return { raw, board };
  }
  async function loadBoard() {
    try {
      const { raw, board } = await fetchBoard();
      store.set(K_LASTGOOD, raw);
      return { board, from: "site" };
    } catch (e) {
      // A file that arrives but can't be read points at a bad commit, not at the network.
      const broken = e instanceof SyntaxError || !!(e && (e.shape || e.http === 404));
      const cached = normalizeBoard(store.get(K_LASTGOOD, null));
      if (cached) return { board: cached, from: "cache", broken };
      return { board: null, from: "none", broken };
    }
  }

  // ---------- state ----------
  const S = {
    loaded: false, loadFrom: "", loadBroken: false,
    opps: new Map(), caps: new Map(), storageOk: true,
    tab: "opportunities", fit: "all", q: "", capQ: "", theme: "auto", editMode: false,
    expanded: new Set(), editingOpp: null, editingCap: null, addingCap: false, archOpen: false, otherOpen: false,
    flashCap: null, flashOpp: null,
    proposals: new Map(),
    add: { reviewKey: null, reviewStamp: null, result: null },
    review: { items: [], checkedAt: null, status: null, blogs: [] },
    checking: false, publish: null,
  };
  const E = () => S.editMode && S.loaded;

  // ---------- this browser's unpublished changes ----------
  const emptyChanges = () => ({ opps: {}, caps: {}, reviewed: {}, meta: {} });
  let CH = emptyChanges();
  const stampOf = (d) => (d && typeof d.updatedAt === "string" ? d.updatedAt : "");

  function loadChanges() {
    const c = store.get(K_CHANGES, null);
    const out = emptyChanges();
    if (!isObj(c)) return out;
    for (const kind of ["opps", "caps"]) {
      const src = isObj(c[kind]) ? c[kind] : {};
      for (const [id, doc] of Object.entries(src)) {
        if (!isObj(doc)) continue;
        const base = BASE[kind][id];
        if (base && stampOf(base) >= stampOf(doc)) continue;
        if (!base && doc._deleted) continue;
        out[kind][id] = doc;
      }
    }
    const rev = isObj(c.reviewed) ? c.reviewed : {};
    for (const [k, v] of Object.entries(rev)) {
      const b = BASE.nasa.reviewed[k];
      if (typeof v === "string" && !(typeof b === "string" && b >= v)) out.reviewed[k] = v;
    }
    const m = isObj(c.meta) ? c.meta : {};
    if (typeof m.maintainer === "string" && m.maintainer !== (BASE.maintainer || "") && String(m.maintainerAt || "") > String(BASE.savedAt || "")) {
      out.meta.maintainer = m.maintainer;
      out.meta.maintainerAt = m.maintainerAt;
    }
    if (typeof m.checkedOn === "string" && m.checkedOn > String(BASE.checkedOn || "")) {
      out.meta.checkedOn = m.checkedOn;
      out.meta.checkedVia = str(m.checkedVia, 80);
    }
    return out;
  }
  function rebuild() {
    const opps = new Map(Object.entries(BASE.opps));
    for (const [id, d] of Object.entries(CH.opps)) { if (d && d._deleted) opps.delete(id); else if (d) opps.set(id, d); }
    const caps = new Map(Object.entries(BASE.caps));
    for (const [id, d] of Object.entries(CH.caps)) { if (d && d._deleted) caps.delete(id); else if (d) caps.set(id, d); }
    S.opps = opps;
    S.caps = caps;
  }
  function persist() {
    if (!store.set(K_CHANGES, CH)) S.storageOk = false;
    S.publish = null;
    rebuild();
    renderAll();
  }
  function changeCounts() {
    const c = { opps: Object.keys(CH.opps).length, caps: Object.keys(CH.caps).length, reviewed: Object.keys(CH.reviewed).length, settings: typeof CH.meta.maintainer === "string" ? 1 : 0 };
    c.total = c.opps + c.caps + c.reviewed + c.settings;
    return c;
  }
  const maintainerName = () => str(typeof CH.meta.maintainer === "string" ? CH.meta.maintainer : BASE.maintainer, 80);

  function putOpp(id, data) {
    const d = Object.assign({}, data, { updatedAt: nowIso() });
    delete d._deleted;
    CH.opps[id] = d;
    persist();
  }
  function patchOpp(id, patch) { const cur = S.opps.get(id); if (cur) putOpp(id, Object.assign({}, cur, patch)); }
  function removeOpp(id) {
    if (BASE.opps[id]) CH.opps[id] = { _deleted: true, updatedAt: nowIso() };
    else delete CH.opps[id];
    persist();
  }
  function putCap(id, data) {
    const d = Object.assign({}, data, { updatedAt: nowIso() });
    delete d._deleted;
    CH.caps[id] = d;
    persist();
  }
  function patchCap(id, patch) { const cur = S.caps.get(id); if (cur) putCap(id, Object.assign({}, cur, patch)); }
  function removeCap(id) {
    if (BASE.caps[id]) CH.caps[id] = { _deleted: true, updatedAt: nowIso() };
    else delete CH.caps[id];
    persist();
  }
  function reviewedStamp(key) {
    if (typeof CH.reviewed[key] === "string") return CH.reviewed[key];
    const b = BASE.nasa.reviewed[key];
    return typeof b === "string" ? b : null;
  }
  function markReviewed(items) {
    if (!E()) return;
    for (const it of items) CH.reviewed[it.key] = it.modified || it.stamp || nowIso();
    persist();
  }

  // ---------- publishing: a new board.json for the repository ----------
  function canon(doc, fields) {
    const out = {};
    for (const f of fields) if (doc[f] !== undefined) out[f] = doc[f];
    for (const k of Object.keys(doc).sort(byCode)) if (!(k in out) && k !== "_deleted") out[k] = doc[k];
    return out;
  }
  function sortedDocs(map, fields, cmp) {
    const out = {};
    for (const id of Object.keys(map).sort(cmp)) out[id] = canon(map[id], fields);
    return out;
  }
  function sortObj(o) { const out = {}; for (const k of Object.keys(o).sort(byCode)) out[k] = o[k]; return out; }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // The latest board.json on the main branch. GitHub's API is read first because the
  // site itself can lag a few minutes behind a commit; publishing on top of a stale copy
  // would quietly drop someone else's change.
  async function fetchLatest() {
    try {
      const board = normalizeBoard(await getJson(apiBoardUrl(), { headers: { Accept: "application/vnd.github.raw+json" } }));
      if (board) return { board, fresh: true };
    } catch (e) { /* fall back to the site's copy */ }
    try { return { board: (await fetchBoard()).board, fresh: true }; } catch (e) { return { board: BASE, fresh: false }; }
  }
  function resetPublishUi() {
    const ta = $("#publishText");
    ta.hidden = true;
    ta.value = "";
    $("#copyMsg").textContent = "";
  }
  async function publishChanges() {
    if (!S.loaded) return;
    const btn = $("#publishBtn");
    btn.disabled = true;
    btn.textContent = "Preparing…";
    const { board: base, fresh } = await fetchLatest();
    btn.disabled = false;
    btn.textContent = "Publish changes";
    const opps = Object.assign({}, base.opps);
    const caps = Object.assign({}, base.caps);
    let older = 0;
    let applied = 0;
    for (const [kind, target] of [["opps", opps], ["caps", caps]]) {
      for (const [id, d] of Object.entries(CH[kind])) {
        const b = base[kind][id];
        if (b && stampOf(b) >= stampOf(d)) { if (stampOf(b) > stampOf(d)) older++; continue; }
        if (d._deleted) { if (b) { delete target[id]; applied++; } continue; }
        target[id] = d;
        applied++;
      }
    }
    const reviewed = Object.assign({}, base.nasa.reviewed);
    for (const [k, v] of Object.entries(CH.reviewed)) {
      if (typeof reviewed[k] === "string" && reviewed[k] >= v) continue;
      reviewed[k] = v;
      applied++;
    }
    let maintainer = str(base.maintainer, 80);
    if (typeof CH.meta.maintainer === "string" && CH.meta.maintainer !== maintainer && String(CH.meta.maintainerAt || "") > String(base.savedAt || "")) {
      maintainer = CH.meta.maintainer;
      applied++;
    }
    const blogMap = new Map();
    for (const b of base.nasa.blogs.concat(S.review.blogs || [])) if (b && Number.isFinite(b.id)) blogMap.set(b.id, str(b.label, 20));
    const localCheck = CH.meta.checkedOn && CH.meta.checkedOn > String(base.checkedOn || "");
    const checkedOn = maxStr(base.checkedOn, CH.meta.checkedOn);
    const cd = parseDay(checkedOn);
    const data = {
      format: "pspl-proposer/1", boardId: BOARD_ID, app: APP_VERSION, savedAt: nowIso(),
      site: base.site, repo: base.repo,
      maintainer,
      checkedOn,
      checkNote: localCheck && cd ? "Last checked " + fmtDay(cd, true) + " with Check NASA now (" + (CH.meta.checkedVia || "NASA") + ")." : (base.checkNote || ""),
      nasa: { floor: base.nasa.floor || null, blogs: [...blogMap].map(([id, label]) => ({ id, label })).sort((x, y) => x.id - y.id), reviewed: sortObj(reviewed) },
      opps: sortedDocs(opps, OPP_FIELDS, byCode),
      caps: sortedDocs(caps, CAP_FIELDS, (a, b) => capKey(a) - capKey(b) || byCode(a, b)),
    };
    S.publish = { json: JSON.stringify(data, null, 2) + "\n", older, applied, fresh, opps: Object.keys(opps).length, caps: Object.keys(caps).length };
    resetPublishUi();
    renderBand();
    requestAnimationFrame(() => { const b = $("#copyBoardBtn"); if (b && !$("#publishSteps").hidden) b.focus(); });
  }

  // ---------- prefs (per person, per computer) ----------
  function restorePrefs() {
    const p = store.get(K_PREFS, {}) || {};
    if (TABS.includes(p.tab)) S.tab = p.tab;
    if (["all", "high", "medium", "low"].includes(p.fit)) S.fit = p.fit;
    if (["auto", "light", "dark"].includes(p.theme)) S.theme = p.theme;
    S.editMode = p.editMode === true;
    const hs = (location.hash || "").slice(1);
    if (TABS.includes(hs)) S.tab = hs;
    applyTheme();
  }
  function savePrefs() { store.set(K_PREFS, { tab: S.tab, fit: S.fit, theme: S.theme, editMode: S.editMode }); }
  function applyTheme() {
    const r = document.documentElement;
    if (S.theme === "auto") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", S.theme);
  }

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 4500);
  }

  // ---------- NASA check ----------
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DATE_SRC = "\\b(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}))\\b";
  const DUE_RE = /\b(due|deadline|notices? of intent|NOIs?|step-?[12]|close date)\b/i;

  function datesIn(s) {
    const re = new RegExp(DATE_SRC, "gi");
    const out = [];
    let m;
    while ((m = re.exec(String(s || "")))) {
      const d = m[1] ? new Date(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]) : new Date(+m[6], +m[4] - 1, +m[5]);
      if (!isNaN(d)) out.push(d);
    }
    return out;
  }
  function dueSentences(text) {
    const sents = String(text || "").match(/[^.!?]+(?:[.!?]+|$)/g) || [];
    const out = [];
    for (const s0 of sents) {
      const s = s0.trim();
      if (s.length < 12 || !DUE_RE.test(s) || !datesIn(s).length) continue;
      out.push(s.length > 240 ? s.slice(0, 237) + "\u2026" : s);
      if (out.length >= 3) break;
    }
    return out;
  }
  function dueGuessFrom(sentences) {
    const today = todayLocal();
    const ds = sentences.flatMap(datesIn).filter((d) => d >= today).sort((a, b) => a - b);
    return ds.length ? isoDay(ds[0]) : null;
  }
  function htmlText(html) {
    try {
      const doc = new DOMParser().parseFromString("<!doctype html><body>" + String(html || ""), "text/html");
      return (doc.body.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    } catch (e) { return ""; }
  }
  const codeOf = (s) => { const m = /\b([A-F])\.(\d{1,2}[A-Z]?)\b/.exec(String(s || "")); return m ? m[1] + "." + m[2] : ""; };

  async function getJson(url, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(url, Object.assign({ credentials: "omit", cache: "no-store", signal: ctl.signal }, opts || {}));
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.http = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  function shapeError() { const e = new Error("unexpected answer"); e.shape = true; return e; }

  function nasaItem(p, blogs) {
    if (!p || typeof p !== "object" || !Number.isFinite(p.id)) return null;
    const title = htmlText(p.title && p.title.rendered);
    if (!title) return null;
    const text = htmlText(p.content && p.content.rendered);
    const date = String(p.date || "");
    const modified = String(p.modified || date);
    const sentences = dueSentences(text);
    const code = codeOf(title);
    return {
      key: "wp:" + p.id, source: "nasa", title,
      link: safeUrl(p.link) || "https://science.nasa.gov/?p=" + p.id,
      date, modified, stamp: modified > date ? modified : date,
      roses: blogs.get(p.parent) || "", code, letter: code ? code[0] : "",
      sentences, dueGuess: dueGuessFrom(sentences), excerpt: text.slice(0, 260), text: text.slice(0, 4000),
    };
  }
  async function fetchNasa(floor) {
    const blogs = new Map();
    for (const b of BASE.nasa.blogs.concat(S.review.blogs || [])) {
      if (b && Number.isFinite(b.id)) blogs.set(b.id, str(b.label, 20));
    }
    try {
      const y = todayLocal().getFullYear();
      const slugs = [y - 1, y, y + 1, y + 2].map((n) => "roses-" + n).join(",");
      const found = await getJson(NASA_API + "?slug=" + slugs + "&per_page=20");
      if (Array.isArray(found)) {
        for (const p of found) {
          const m = /\/researchers\/solicitations\/roses-(\d{4})\/?$/.exec(String((p && p.link) || ""));
          if (m && Number.isFinite(p.id)) blogs.set(p.id, "ROSES-" + m[1].slice(2));
        }
      }
    } catch (e) {
      if (!blogs.size) throw e;
    }
    if (!blogs.size) throw shapeError();
    const posts = await getJson(NASA_API + "?parent=" + [...blogs.keys()].join(",") + "&per_page=50&orderby=date&order=desc");
    if (!Array.isArray(posts)) throw shapeError();
    const items = [];
    for (const p of posts) {
      const it = nasaItem(p, blogs);
      if (it && it.stamp.slice(0, 10) >= floor) items.push(it);
    }
    return { items, blogs: [...blogs].map(([id, label]) => ({ id, label })) };
  }

  function findHits(res) {
    const c = [res && res.data && res.data.oppHits, res && res.oppHits, res && res.data && res.data.hits, res && Array.isArray(res.data) ? res.data : null];
    for (const x of c) if (Array.isArray(x)) return x;
    return null;
  }
  function parseUsDate(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ""));
    if (m) return isoDay(new Date(+m[3], +m[1] - 1, +m[2]));
    const d = parseDay(String(s || ""));
    return d ? isoDay(d) : "";
  }
  function ggItem(x) {
    if (!x || typeof x !== "object") return null;
    const number = str(x.number || x.opportunityNumber, 80);
    const title = str(x.title || x.opportunityTitle, 300);
    if (!number || !title) return null;
    const agency = str(x.agencyCode || x.agency || x.agencyName, 120);
    if (!/NASA/i.test(agency) && !/^(NNH|NNX|80)/i.test(number)) return null;
    const open = parseUsDate(x.openDate || x.postDate);
    const close = parseUsDate(x.closeDate);
    const closeD = parseDay(close);
    const code = codeOf(title);
    const rm = /ROSES[\s-]*(?:20)?(\d{2})\b/i.exec(title);
    const id = x.id != null ? String(x.id) : "";
    return {
      key: "gg:" + number, source: "gg", number, title,
      link: id ? "https://www.grants.gov/search-results-detail/" + encodeURIComponent(id) : "https://www.grants.gov/search-grants?keywords=" + encodeURIComponent(number),
      date: open, modified: open, stamp: open,
      roses: rm ? "ROSES-" + rm[1] : "", code, letter: code ? code[0] : "",
      sentences: closeD ? ["Grants.gov close date: " + fmtDay(closeD, true) + ". For ROSES elements this can be when ROSES closes rather than the proposal deadline."] : [],
      dueGuess: closeD && closeD >= todayLocal() ? close : null, excerpt: number + (agency ? " \u00B7 " + agency : ""), text: "",
    };
  }
  async function postGrants(body) {
    try {
      return await getJson(GG_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      if (e && (e.http || e.name === "AbortError")) throw e;
      return await getJson(GG_API, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
    }
  }
  async function fetchGrants(floor) {
    const sids = new Set([...S.opps.values()].map((o) => str(o.sid, 80)).filter(Boolean));
    const hits = new Map();
    for (const keyword of ["ROSES", "NASA"]) {
      const list = findHits(await postGrants({ keyword, oppStatuses: "forecasted|posted", rows: 100 }));
      if (!list) throw shapeError();
      for (const x of list) {
        const it = ggItem(x);
        if (it && !hits.has(it.number)) hits.set(it.number, it);
      }
    }
    return [...hits.values()].filter((it) => !sids.has(it.number) && it.stamp && it.stamp >= floor);
  }
  function fetchErr(e, name) {
    if (e && e.name === "AbortError") return name + " took too long to answer.";
    if (e && e.http) return name + " answered with an error (" + e.http + ").";
    if (e && e.shape) return name + " answered in a form this page doesn't recognize.";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "You appear to be offline.";
    return name + " couldn't be reached from this browser.";
  }

  async function checkNasa() {
    if (S.checking || !S.loaded) return;
    S.checking = true;
    renderHeader();
    renderOpps();
    const floor = String(BASE.nasa.floor || isoDay(new Date(Date.now() - 45 * 864e5))).slice(0, 10);
    const [rn, rg] = await Promise.allSettled([fetchNasa(floor), fetchGrants(floor)]);
    const status = {};
    let items = [];
    let blogs = S.review.blogs || [];
    if (rn.status === "fulfilled") {
      items = rn.value.items;
      blogs = rn.value.blogs;
      status.nasa = { ok: true };
    } else status.nasa = { ok: false, msg: fetchErr(rn.reason, "NASA's ROSES blog") };
    if (rg.status === "fulfilled") {
      for (const g of rg.value) {
        const twin = g.code && g.roses ? items.find((it) => it.source === "nasa" && it.code === g.code && it.roses === g.roses) : null;
        if (twin) twin.also = { label: "Grants.gov listing", url: g.link };
        else items.push(g);
      }
      status.gg = { ok: true };
    } else status.gg = { ok: false, msg: fetchErr(rg.reason, "Grants.gov") };
    S.review = { items, checkedAt: nowIso(), status, blogs };
    store.set(K_REVIEW, S.review);
    if (E() && (status.nasa.ok || status.gg.ok)) {
      CH.meta.checkedOn = isoDay(todayLocal());
      CH.meta.checkedVia = [status.nasa.ok ? "NASA's ROSES blog" : null, status.gg.ok ? "Grants.gov" : null].filter(Boolean).join(" and ");
      if (!store.set(K_CHANGES, CH)) S.storageOk = false;
    }
    S.checking = false;
    if (S.tab !== "opportunities") setTab("opportunities");
    renderAll();
    const n = reviewItems().length;
    if (!status.nasa.ok && !status.gg.ok) toast("Couldn't reach NASA or Grants.gov from this browser. Check your connection and try again.");
    else if (!n) toast("Checked NASA: nothing new to review.");
    else toast("Checked NASA: " + plural(n, "post", "posts") + " to review.");
  }

  function matchOpp(it) {
    for (const [id, o] of S.opps) {
      const el = String(o.element || "");
      if (it.code && it.roses && el.includes(it.roses) && new RegExp("(^|\\s)" + escRe(it.code) + "(?![\\w.])").test(el)) return id;
      if (it.number && o.sid && String(o.sid) === it.number) return id;
      const ab = String(o.abbr || "");
      if (ab.length >= 3 && new RegExp("(^|[^\\w-])" + escRe(ab) + "(?![\\w-])").test(it.title)) return id;
    }
    return null;
  }
  function reviewItems() {
    const out = [];
    for (const it of S.review.items) {
      const r = reviewedStamp(it.key);
      const mod = String(it.modified || it.stamp || "");
      if (r && !(mod && r < mod)) continue;
      out.push(Object.assign({}, it, { updated: !!r, match: matchOpp(it) }));
    }
    return out;
  }
  function loadReview() {
    const r = store.get(K_REVIEW, null);
    if (r && Array.isArray(r.items)) {
      S.review = {
        items: r.items.filter((it) => it && typeof it.key === "string" && typeof it.title === "string"),
        checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : null,
        status: isObj(r.status) ? r.status : null,
        blogs: Array.isArray(r.blogs) ? r.blogs : [],
      };
    }
  }

  // ---------- rendering: shared ----------
  function focusKey() { const a = document.activeElement; return a && a.dataset ? a.dataset.fk || null : null; }
  function restoreFocus(fk) {
    if (!fk) return;
    const el = document.querySelector('[data-fk="' + fk.replace(/["\\]/g, "\\$&") + '"]');
    if (el && el !== document.activeElement && !el.disabled) el.focus({ preventScroll: true });
  }
  function focusFirst(sel) {
    requestAnimationFrame(() => { const el = document.querySelector(sel + " input, " + sel + " select, " + sel + " textarea"); if (el) el.focus(); });
  }
  const emptyBox = (title, body) => h("div", { class: "empty" }, h("b", { text: title }), body);
  function confirmButton(label, confirmLabel, action, fk) {
    let armed = false;
    let timer = 0;
    const b = h("button", { class: "btn ghost danger", type: "button", "data-fk": fk }, label);
    b.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        b.textContent = confirmLabel;
        b.classList.add("armed");
        timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove("armed"); }, 4000);
        return;
      }
      clearTimeout(timer);
      action();
    });
    return b;
  }
  function chip(cid) {
    const c = S.caps.get(cid);
    return h("span", { class: "chip" + (c ? "" : " missing"), title: c ? c.name : "Not in the capability register", text: cid });
  }
  function sourceLink(src) {
    if (!src) return "Not set";
    const url = safeUrl(src.url);
    return url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: src.label || url }) : (src.label || "Not set");
  }
  const isNew = (o) => {
    if (o.flag !== "new") return false;
    const t = Date.parse(o.createdAt || "");
    return !Number.isFinite(t) || Date.now() - t < 21 * 864e5;
  };

  function renderAll() {
    renderHeader();
    renderNotice();
    renderBand();
    renderTabs();
    renderOpps();
    renderCaps();
    renderMethod();
  }

  function setStat(id, value, cls) {
    const el = document.getElementById(id);
    el.textContent = String(value);
    el.classList.toggle("urgent", cls === "urgent");
  }
  function renderHeader() {
    const ready = S.loaded;
    const live = [...S.opps.values()].filter((o) => o.status !== "archived");
    const openNow = live.filter((o) => OPEN.has(o.status) && (daysLeft(o) ?? 0) >= 0).length;
    const soon = live.filter((o) => { const d = daysLeft(o); return OPEN.has(o.status) && d != null && d >= 0 && d <= 30; }).length;
    setStat("st-open", ready ? openNow : "\u2014");
    setStat("st-soon", ready ? soon : "\u2014", ready && soon > 0 ? "urgent" : null);
    setStat("st-high", ready ? live.filter((o) => scoreOf(o) >= 6).length : "\u2014");
    setStat("st-conf", ready ? [...S.caps.values()].filter((c) => !c.confirmed).length : "\u2014");
    const nRev = ready ? reviewItems().length : 0;
    $("#st-review-wrap").hidden = nRev === 0;
    setStat("st-review", nRev);
    const parts = [];
    if (S.checking) parts.push("Checking NASA now");
    else if (ready) {
      const checkedOn = parseDay(E() ? maxStr(BASE.checkedOn, CH.meta.checkedOn) : BASE.checkedOn);
      const year = todayLocal().getFullYear();
      if (checkedOn) parts.push("NASA checked " + fmtDay(checkedOn, checkedOn.getFullYear() !== year));
      const pub = new Date(BASE.savedAt || "");
      if (!isNaN(pub)) parts.push("board published " + fmtDay(pub, pub.getFullYear() !== year));
    }
    const el = $("#checked");
    el.textContent = parts.join(" \u00B7 ").replace(/^./, (c) => c.toUpperCase());
    el.classList.toggle("live", S.checking);
    const btn = $("#checkNowBtn");
    btn.disabled = S.checking || !ready;
    btn.textContent = S.checking ? "Checking\u2026" : "Check NASA now";
    const eb = $("#editBtn");
    eb.disabled = !ready;
    eb.setAttribute("aria-pressed", String(S.editMode));
    $("#addCallBtn").hidden = !E();
  }

  function renderNotice() {
    const parts = [];
    if (IS_FILE) {
      parts.push(["This is a downloaded copy. Open the shared board at ", h("a", { href: BASE.site, text: shortUrl(BASE.site) }), " instead, so you always see the latest."]);
    }
    if (S.loadFrom === "cache") {
      const pub = new Date(BASE.savedAt || "");
      const kept = "this shows the copy this browser kept" + (isNaN(pub) ? "" : " from " + fmtDay(pub, true)) + ".";
      parts.push([S.loadBroken
        ? "The published board couldn't be read, so " + kept + " The latest change to board.json on GitHub probably needs fixing or reverting."
        : "Couldn't load the latest board, so " + kept + " Reload the page to try again."]);
    }
    $("#noticeBand").hidden = !parts.length;
    $("#noticeText").replaceChildren(...parts.flatMap((p, i) => (i ? [" "].concat(p) : p)));
  }

  function renderBand() {
    const c = changeCounts();
    const show = S.loaded && (c.total > 0 || (!S.storageOk && S.editMode));
    const pub = show ? S.publish : null;
    $("#changesBand").hidden = !show;
    $("#publishPanel").hidden = !pub;
    if (!show) return;
    const p = $("#changesText");
    if (c.total === 0) {
      p.textContent = "This browser isn't keeping changes for this page, so publish anything you change before you close it.";
    } else {
      const bits = [];
      if (c.opps) bits.push(plural(c.opps, "call", "calls"));
      if (c.caps) bits.push(plural(c.caps, "capability row", "capability rows"));
      if (c.reviewed) bits.push(plural(c.reviewed, "NASA post reviewed", "NASA posts reviewed"));
      if (c.settings) bits.push("the maintainer's name");
      p.textContent = "Changed in this browser only: " + bits.join(", ") + ". Nobody else sees " + (c.total === 1 ? "it" : "these") + " until " + (c.total === 1 ? "it's" : "they're") + " published." +
        (S.storageOk ? "" : " This browser won't keep " + (c.total === 1 ? "it" : "them") + " after you close the page.");
    }
    $("#publishBtn").hidden = c.total === 0 || !!pub;
    $("#discardBtn").hidden = c.total === 0;
    if (!pub) return;
    const notes = [];
    if (!pub.applied) notes.push("Everything you changed here is already published, or older than the published version, so there's nothing new to publish. Discard your changes to clear this band.");
    else notes.push("The new board is ready: " + plural(pub.opps, "call", "calls") + " and " + plural(pub.caps, "capability row", "capability rows") + ", with your changes added to the latest published version.");
    if (pub.older) notes.push(plural(pub.older, "of your changes is", "of your changes are") + " older than what's already published, so the published version was kept.");
    if (!pub.fresh) notes.push("The latest published board couldn't be read just now, so this builds on the copy you loaded earlier. If someone has published since then, reload and publish again so their changes aren't lost.");
    $("#publishSummary").textContent = notes.join(" ");
    $("#publishSteps").hidden = !pub.applied;
    $("#publishAlt").hidden = !pub.applied;
    $("#editLink").href = editUrl();
    $("#maintainerBand").textContent = maintainerName() || "whoever looks after the board";
  }

  function renderTabs() {
    for (const t of TABS) {
      const b = document.getElementById("tab-" + t);
      const p = document.getElementById("panel-" + t);
      const on = S.tab === t;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      p.hidden = !on;
    }
    $("#n-opps").textContent = S.loaded ? String([...S.opps.values()].filter((o) => o.status !== "archived").length) : "";
    $("#n-caps").textContent = S.loaded ? String(S.caps.size) : "";
    for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.fit === S.fit));
  }
  function setTab(t, focus) {
    if (!TABS.includes(t)) return;
    S.tab = t;
    savePrefs();
    renderTabs();
    if (focus) document.getElementById("tab-" + t).focus();
  }

  function renderMethod() {
    const site = IS_FILE ? BASE.site : siteUrl();
    const link = $("#siteLink");
    link.href = site;
    link.textContent = shortUrl(site);
    const who = maintainerName();
    $("#maintainerInline").textContent = who || "whoever looks after the board";
    $("#set-theme").value = S.theme;
    $("#maintainerBox").hidden = !E();
    const input = $("#set-maintainer");
    if (document.activeElement !== input) input.value = who;
    const note = str(BASE.checkNote, 600);
    const fresher = E() && CH.meta.checkedOn && CH.meta.checkedOn > String(BASE.checkedOn || "");
    const cd = parseDay(CH.meta.checkedOn);
    $("#checkNote").textContent = fresher && cd ? "You last checked NASA on " + fmtDay(cd, true) + "; that goes into the next publish." + (note ? " The published board says: " + note : "") : note;
    $("#checkNote").hidden = !$("#checkNote").textContent;
    const pub = new Date(BASE.savedAt || "");
    $("#fileInfo").replaceChildren(
      "PSPL Proposer " + APP_VERSION + ". " + (S.loaded && !isNaN(pub) ? "The board was last published " + fmtDay(pub, true) + " at " + fmtTime(BASE.savedAt) + ". " : "") + "Code and history: ",
      h("a", { href: BASE.repo, target: "_blank", rel: "noopener noreferrer", text: shortUrl(BASE.repo) }), ".");
  }

  // ---------- rendering: calls ----------
  let oppNodes = new Map();
  function haystack(o) {
    return [o.abbr, o.element, o.title, o.division, o.sid, (o.brings || []).join(" "), o.bringsText, o.gaps, o.says, o.action, o.notes, STATUS[o.status], o.statusNote].join(" ").toLowerCase();
  }
  const byDue = (x, y) => ((daysLeft(x) ?? 1e9) - (daysLeft(y) ?? 1e9)) || scoreOf(y) - scoreOf(x);
  const byScore = (x, y) => scoreOf(y) - scoreOf(x) || String(x.abbr || x.title).localeCompare(String(y.abbr || y.title));

  function renderOpps() {
    const fk = focusKey();
    const nodes = new Map();
    $("#lanes").replaceChildren(...buildLanes(nodes));
    oppNodes = nodes;
    restoreFocus(fk);
  }
  function buildLanes(nodes) {
    if (!S.loaded) {
      if (S.loadFrom !== "none") return [emptyBox("Loading the board\u2026", "Each call shows its fit, what PSPL brings, the gaps and the next deadline.")];
      return [emptyBox("Couldn't load the board.", S.loadBroken
        ? ["The published board.json couldn't be read, so the latest change to it on GitHub probably has a mistake. Whoever looks after the board can fix or revert that commit in ",
          h("a", { href: BASE.repo + "/commits/main/board.json", target: "_blank", rel: "noopener noreferrer", text: "the board's history" }), "; the page works again a few minutes later."]
        : "Check your connection and reload the page.")];
    }
    const out = [];
    const rl = reviewLane();
    if (rl) out.push(rl);
    const all = [...S.opps].map(([id, o]) => Object.assign({ id }, o));
    if (!all.length) {
      out.push(emptyBox("No calls on the board yet.", E() ? "Add the first one with Add a call, or press Check NASA now." : "Calls appear here once they're published."));
      return out;
    }
    const q = S.q.trim().toLowerCase();
    const vis = all.filter((o) => (S.fit === "all" || fitOf(scoreOf(o)).toLowerCase() === S.fit) && (!q || haystack(o).includes(q)));
    const open = vis.filter((o) => OPEN.has(o.status)).sort(byDue);
    const later = vis.filter((o) => LATER.has(o.status)).sort(byScore);
    const arch = vis.filter((o) => !OPEN.has(o.status) && !LATER.has(o.status)).sort(byScore);
    out.push(lane("Open now", "Soonest deadline first", open, nodes, "No open calls match this filter."));
    out.push(lane("Expected and not yet released", "Highest score first", later, nodes, "No expected calls match this filter."));
    if (arch.length) {
      const d = h("details", { class: "lane", open: S.archOpen },
        h("summary", { class: "lane-head" }, h("h2", null, "Archived", h("span", { class: "count", text: String(arch.length) })), h("span", { class: "lane-note", text: "Calls set aside or past their deadline" })),
        h("div", { class: "list" }, arch.map((o) => oppRow(o, nodes))));
      d.addEventListener("toggle", () => { S.archOpen = d.open; });
      out.push(d);
    }
    return out;
  }
  function lane(title, note, list, nodes, emptyText) {
    return h("section", { class: "lane" },
      h("div", { class: "lane-head" }, h("h2", null, title, h("span", { class: "count", text: String(list.length) })), h("p", { class: "lane-note", text: note })),
      list.length ? h("div", { class: "list" }, list.map((o) => oppRow(o, nodes))) : h("p", { class: "quiet-line", text: emptyText }));
  }

  // To review
  function reviewLane() {
    if (!S.review.checkedAt && !S.checking) return null;
    const items = reviewItems().sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
    const main = items.filter((it) => !it.letter || MAIN_LETTERS.has(it.letter));
    const other = items.filter((it) => it.letter && !MAIN_LETTERS.has(it.letter));
    const st = S.review.status || {};
    const when = S.checking ? "Checking now" : S.review.checkedAt ? "Checked " + fmtDay(new Date(S.review.checkedAt), false) + " at " + fmtTime(S.review.checkedAt) : "";
    const statusLine = h("div", { class: "src-status" },
      st.nasa ? h("span", { class: st.nasa.ok ? null : "bad", text: st.nasa.ok ? "NASA's ROSES blog: read" : st.nasa.msg }) : null,
      st.gg ? h("span", { class: st.gg.ok ? null : "bad", text: st.gg.ok ? "Grants.gov: read" : st.gg.msg + " The NASA blog still covers ROSES." }) : null);
    let otherNode = null;
    if (other.length) {
      otherNode = h("details", { class: "sub-lane", open: S.otherOpen },
        h("summary", null, h("span", { class: "sub-title", text: "Other divisions" }), h("span", { text: plural(other.length, "post", "posts") + " for Earth science, astrophysics or biological and physical sciences" })),
        h("div", { class: "list" }, other.map(reviewCard)),
        E() ? h("div", { class: "review-actions" }, h("button", { class: "btn ghost", type: "button", onclick: () => markReviewed(other) }, "Mark these reviewed")) : null);
      otherNode.addEventListener("toggle", () => { S.otherOpen = otherNode.open; });
    }
    return h("section", { class: "lane review" },
      h("div", { class: "lane-head" }, h("h2", null, "To review", h("span", { class: "count", text: String(items.length) })), h("p", { class: "lane-note", text: when })),
      statusLine,
      items.length && !E() ? h("p", { class: "view-hint", text: "These posts aren't on the board or reviewed yet. Choose Edit at the top to add the ones that fit and mark the rest reviewed." }) : null,
      main.length ? h("div", { class: "list" }, main.map(reviewCard)) : h("p", { class: "quiet-line", text: other.length ? "Nothing new for heliophysics, planetary or cross-division calls." : (S.checking ? "Reading NASA\u2026" : "Nothing new since the last review.") }),
      otherNode,
      E() && main.length > 1 ? h("div", { class: "review-actions" }, h("button", { class: "btn ghost", type: "button", onclick: () => markReviewed(main) }, "Mark all reviewed")) : null);
  }
  function reviewCard(it) {
    const o = it.match ? S.opps.get(it.match) : null;
    const d = parseDay(String(it.date || "").slice(0, 10));
    const meta = [
      d ? fmtDay(d, true) : "",
      it.updated ? "Changed since it was reviewed" : "",
      o ? "On the board as " + (o.abbr || o.title) : (it.letter ? LETTER_DIV[it.letter] : ""),
    ].filter(Boolean).join(" \u00B7 ");
    const detail = it.sentences && it.sentences.length
      ? h("ul", { class: "rv-sent" }, it.sentences.map((s) => h("li", { text: s })))
      : (it.excerpt ? h("p", { class: "rv-sent", text: it.excerpt + (it.excerpt.length >= 260 ? "\u2026" : "") }) : null);
    const actions = [];
    if (o) actions.push(h("button", { class: "btn", type: "button", onclick: () => gotoOpp(it.match) }, "Show " + (o.abbr || "call")));
    else if (E()) actions.push(h("button", { class: "btn", type: "button", onclick: () => openAdd(prefillFrom(it)) }, "Add to board"));
    if (E()) actions.push(h("button", { class: "btn ghost", type: "button", onclick: () => markReviewed([it]) }, "Mark reviewed"));
    return h("article", { class: "rv" },
      h("div", { class: "sign" }, h("span", { class: "abbr", text: it.code || (it.source === "gg" ? "Listing" : "Notice") }), h("span", { class: "element", text: [it.roses, it.source === "gg" ? "Grants.gov" : "NASA blog"].filter(Boolean).join(" \u00B7 ") })),
      h("div", { class: "main" },
        h("a", { class: "rv-title", href: safeUrl(it.link) || "#", target: "_blank", rel: "noopener noreferrer", text: it.title }),
        h("div", { class: "opp-meta", text: meta }),
        detail,
        it.also && safeUrl(it.also.url) ? h("a", { class: "rv-also", href: it.also.url, target: "_blank", rel: "noopener noreferrer", text: it.also.label }) : null),
      actions.length ? h("div", { class: "rv-actions" }, actions) : null);
  }
  function prefillFrom(it) {
    let title = String(it.title || "")
      .replace(/^Amendment\s+\d+[A-Z]?\s*:\s*/i, "")
      .replace(/^(New Opportunity|Corrections? to|Correction)\s*:?\s*/i, "")
      .replace(/^ROSES[-\s]?\d{2,4}\s*:?\s*/i, "");
    if (it.code) title = title.replace(new RegExp("^" + escRe(it.code) + "\\s*:?\\s*"), "");
    return {
      title: title.trim() || it.title, abbr: "", element: [it.roses, it.code].filter(Boolean).join(" "),
      division: it.letter ? LETTER_DIV[it.letter] : "Heliophysics", status: "open",
      due: it.dueGuess || "", dueLabel: it.sentences && it.sentences[0] ? it.sentences[0].slice(0, 200) : "",
      source: it.link, text: it.text || it.excerpt || "", reviewKey: it.key, reviewStamp: it.modified || it.stamp,
    };
  }

  function whenBlock(o) {
    const dl = daysLeft(o);
    if (dl === null) {
      const later = LATER.has(o.status);
      return h("div", { class: "when" },
        h("span", { class: "tminus quiet", text: later ? "TBD" : "Open" }),
        h("span", { class: "date", text: o.status === "unknown" ? "Timing unknown" : later ? "Not yet released" : "No fixed date" }));
    }
    const d = parseDay(o.due);
    let big;
    let cls = "tminus";
    if (dl > 0) { big = "T\u2212" + dl + "\u2009d"; if (dl <= 21) cls += " urgent"; }
    else if (dl === 0) { big = "Today"; cls += " urgent"; }
    else { big = "Passed"; cls += " quiet"; }
    return h("div", { class: "when" },
      h("span", { class: cls, title: dl > 0 ? dl + " days until the next deadline" : "", text: big }),
      h("span", { class: "date", text: fmtDay(d, d.getFullYear() !== todayLocal().getFullYear()) }));
  }
  function toggleOpp(id) {
    if (S.expanded.has(id)) { S.expanded.delete(id); if (S.editingOpp === id) S.editingOpp = null; }
    else S.expanded.add(id);
    renderOpps();
  }
  function gotoOpp(id) {
    if (!S.opps.has(id)) return;
    S.q = "";
    $("#oppSearch").value = "";
    S.fit = "all";
    const o = S.opps.get(id);
    if (o && o.status === "archived") S.archOpen = true;
    S.expanded.add(id);
    S.flashOpp = id;
    setTab("opportunities");
    renderOpps();
    requestAnimationFrame(() => { const el = document.getElementById("opp-" + id); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); });
    setTimeout(() => { S.flashOpp = null; const el = document.getElementById("opp-" + id); if (el) el.classList.remove("flash"); }, 1800);
  }

  function oppRow(o, nodes) {
    const prev = oppNodes.get(o.id);
    if (S.editingOpp === o.id && prev && prev.querySelector("form.opp-form")) { nodes.set(o.id, prev); return prev; }
    const s = scoreOf(o);
    const fit = fitOf(s);
    const open = S.expanded.has(o.id);
    const head = h("div", {
      class: "opp-head", role: "button", tabindex: "0", "aria-expanded": String(open), "data-fk": "head:" + o.id,
      onclick: () => toggleOpp(o.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpp(o.id); } },
    },
      h("div", { class: "sign" }, h("span", { class: "abbr", text: o.abbr || "Call" }), o.element ? h("span", { class: "element", text: o.element }) : null),
      h("div", { class: "main" },
        h("div", { class: "opp-title" }, o.title || "Untitled call",
          isNew(o) ? h("span", { class: "pill new", text: "New" }) : null,
          o.status === "step2" ? h("span", { class: "pill", text: "Step-2 only" }) : null,
          CH.opps[o.id] ? h("span", { class: "pill mine", title: "Changed in this browser and not yet published", text: "Changed here" }) : null),
        h("div", { class: "opp-meta", text: [o.division, o.statusNote].filter(Boolean).join(" \u00B7 ") }),
        (o.brings && o.brings.length) ? h("div", { class: "chips" }, o.brings.map(chip)) : null),
      whenBlock(o),
      h("div", { class: "fitbox" }, h("span", { class: "fit " + fit.toLowerCase(), text: fit }), h("span", { class: "score", text: s + " / 8" })));
    const art = h("article", { class: "opp" + (open ? " is-open" : "") + (S.flashOpp === o.id ? " flash" : ""), id: "opp-" + o.id }, head);
    if (open) art.append(S.editingOpp === o.id && E() ? oppForm(o) : oppBody(o));
    nodes.set(o.id, art);
    return art;
  }

  const fact = (label, text) => h("div", { class: "fact" }, h("h3", { text: label }), h("p", { text }));
  const factNode = (label, node) => h("div", { class: "fact" }, h("h3", { text: label }), node);

  function oppBody(o) {
    const d = parseDay(o.due);
    const ids = o.brings || [];
    const sources = (o.sources || []).filter((x) => x && safeUrl(x.url));
    const facts = h("div", { class: "facts" },
      fact("What's due", [o.dueLabel, d ? fmtDay(d, true) : null].filter(Boolean).join(" \u00B7 ") || "Not set"),
      factNode("PSPL brings", h("div", null,
        ids.length ? h("div", { class: "brings-list" }, ids.map((cid) => {
          const c = S.caps.get(cid);
          return h("button", { class: "capref", type: "button", title: "Show in the register", "data-fk": "cap:" + o.id + ":" + cid, onclick: (e) => { e.stopPropagation(); gotoCap(cid); } }, h("b", { text: cid }), c ? c.name : "Not in the register");
        })) : null,
        h("p", { text: o.bringsText || (ids.length ? "" : "Nothing matched yet.") }))),
      fact("Gaps and partners", o.gaps || "None noted."),
      o.says ? factNode("What NASA asks for", h("p", { class: "says", text: "\u201C" + o.says + "\u201D" })) : null,
      fact("Next action", o.action || "None set."),
      o.notes ? fact("Notes", o.notes) : null,
      sources.length ? factNode("Sources", h("div", { class: "sources" }, sources.map((x) => h("a", { href: safeUrl(x.url), target: "_blank", rel: "noopener noreferrer", text: x.label || x.url })))) : null,
      o.sid ? factNode("Solicitation ID", h("p", { class: "mono", text: o.sid })) : null);
    const side = h("div", { class: "side" }, scorer(o), E() ? proposalNode(o) : null, actionsNode(o));
    return h("div", { class: "opp-body" }, facts, side);
  }

  function bumpScore(id, key, delta) {
    if (!E()) return;
    const o = S.opps.get(id);
    if (!o) return;
    const max = key === "t" ? 2 : 3;
    const cur = clampInt(o[key], max);
    const v = Math.max(0, Math.min(max, cur + delta));
    if (v !== cur) patchOpp(id, { [key]: v });
  }
  function scorer(o) {
    const editable = E();
    const dial = (key, name, help, max) => {
      const v = clampInt(o[key], max);
      const value = h("output", { "aria-label": name, text: v + "/" + max });
      return h("div", { class: "dial" },
        h("span", { class: "dial-name" }, name, h("small", { text: help })),
        editable
          ? h("span", { class: "stepper" },
            h("button", { type: "button", "aria-label": "Lower " + name.toLowerCase(), "data-fk": key + "-:" + o.id, disabled: v <= 0, onclick: () => bumpScore(o.id, key, -1) }, "\u2212"),
            value,
            h("button", { type: "button", "aria-label": "Raise " + name.toLowerCase(), "data-fk": key + "+:" + o.id, disabled: v >= max, onclick: () => bumpScore(o.id, key, 1) }, "+"))
          : h("span", { class: "stepper readonly" }, value));
    };
    const s = scoreOf(o);
    const fit = fitOf(s);
    return h("div", { class: "scorer" },
      dial("a", "Alignment", "Science and tech overlap", 3),
      dial("r", "Readiness", "Could we write it now?", 3),
      dial("t", "Timing", "Lead time to the deadline", 2),
      h("div", { class: "scoreline" }, h("span", null, "Score ", h("b", { text: String(s) }), " of 8"), h("span", { class: "fit " + fit.toLowerCase(), text: fit })),
      h("p", { class: "hint", text: "High 6\u20138 \u00B7 Medium 4\u20135 \u00B7 Low 0\u20133" }));
  }

  function proposalNode(o) {
    const p = S.proposals.get(o.id);
    if (!p) return null;
    if (p.status === "ask") {
      const promptId = "rp-prompt-" + o.id;
      const replyId = "rp-reply-" + o.id;
      const reply = h("textarea", { id: replyId, rows: 4, placeholder: "Paste the reply here", "data-fk": "rp-reply:" + o.id }, p.reply || "");
      reply.addEventListener("input", () => { p.reply = reply.value; });
      const ta = h("textarea", { id: promptId, rows: 4, readonly: true }, p.prompt);
      return h("div", { class: "proposal" },
        h("h3", { class: "label", text: "Rescore with AI" }),
        h("p", { text: "Copy this prompt into an AI assistant such as Copilot, ChatGPT or Claude, then paste its reply below." }),
        h("label", { class: "sr", for: promptId, text: "Prompt for the AI assistant" }), ta,
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", onclick: async () => { const ok = await copyText(p.prompt, ta); toast(ok ? "Prompt copied." : "Press Ctrl+C (Cmd+C on a Mac) to copy the selected prompt."); } }, "Copy prompt")),
        h("label", { class: "sr", for: replyId, text: "The AI assistant's reply" }), reply,
        p.error ? h("p", { class: "error-line", text: p.error }) : null,
        h("div", { class: "row" },
          h("button", { class: "btn primary", type: "button", onclick: () => readRescore(o.id) }, "Use this reply"),
          h("button", { class: "btn ghost", type: "button", onclick: () => { S.proposals.delete(o.id); renderOpps(); } }, "Cancel")));
    }
    const d = p.data;
    const s = d.a + d.r + d.t;
    const fit = fitOf(s);
    return h("div", { class: "proposal" },
      h("h3", { class: "label", text: "Suggested rescore" }),
      h("div", { class: "row" }, h("span", { class: "fit " + fit.toLowerCase(), text: fit }), h("span", { class: "mono", text: "A" + d.a + " R" + d.r + " T" + d.t + " = " + s + "/8" })),
      d.brings.length ? h("div", { class: "chips" }, d.brings.map(chip)) : null,
      d.bringsText ? h("p", { text: d.bringsText }) : null,
      d.gaps ? h("p", null, h("b", { text: "Gaps: " }), d.gaps) : null,
      d.action ? h("p", null, h("b", { text: "Next: " }), d.action) : null,
      d.notes ? h("p", null, h("b", { text: "Notes: " }), d.notes) : null,
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", onclick: () => applyProposal(o.id) }, "Apply"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { S.proposals.delete(o.id); renderOpps(); } }, "Discard")));
  }

  function actionsNode(o) {
    if (!E()) return null;
    const p = S.proposals.get(o.id);
    return h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", "data-fk": "edit:" + o.id, onclick: () => { S.editingOpp = o.id; S.expanded.add(o.id); renderOpps(); focusFirst("#opp-" + o.id + " form"); } }, "Edit"),
      h("button", { class: "btn", type: "button", "data-fk": "rescore:" + o.id, disabled: !!p, onclick: () => startRescore(o.id) }, "Rescore with AI"),
      o.status === "archived"
        ? h("button", { class: "btn ghost", type: "button", onclick: () => setStatus(o.id, OPEN.has(o.prevStatus) || LATER.has(o.prevStatus) ? o.prevStatus : "expected", null) }, "Restore")
        : h("button", { class: "btn ghost", type: "button", onclick: () => setStatus(o.id, "archived", o.status) }, "Archive"),
      confirmButton("Delete", "Confirm delete", () => deleteOpp(o.id), "del:" + o.id));
  }

  function fieldsFor(prefix) {
    const id = (name) => prefix + "-" + name;
    return {
      input: (name, value, opts = {}) => h("input", { id: id(name), name, type: opts.type || "text", value: value ?? "", maxlength: opts.maxlength, placeholder: opts.placeholder }),
      area: (name, value, rows) => h("textarea", { id: id(name), name, rows: rows || 3 }, value ?? ""),
      select: (name, options, value, labels) => h("select", { id: id(name), name }, options.map((v) => h("option", { value: v, selected: v === value }, labels ? labels[v] : v))),
    };
  }
  const field = (label, control, help, full) => h("label", { class: full ? "full" : null }, h("span", { text: label }), control, help ? h("span", { class: "help", text: help }) : null);

  function oppForm(o) {
    const F = fieldsFor("of-" + o.id);
    const divisions = DIVISIONS.includes(o.division) || !o.division ? DIVISIONS : [o.division, ...DIVISIONS];
    const form = h("form", { class: "form opp-form", novalidate: true },
      field("Short name", F.input("abbr", o.abbr, { maxlength: 24 }), "e.g. SSF"),
      field("Element or call number", F.input("element", o.element, { maxlength: 60 }), "e.g. ROSES-25 B.8"),
      field("Call name", F.input("title", o.title, { maxlength: 200 }), null, true),
      field("Division", F.select("division", divisions, o.division || "Heliophysics")),
      field("Solicitation ID", F.input("sid", o.sid, { maxlength: 80 })),
      field("Status", F.select("status", Object.keys(STATUS), o.status || "expected", STATUS)),
      field("Status note", F.input("statusNote", o.statusNote, { maxlength: 120 }), "e.g. Added Oct 8, 2026"),
      field("Next deadline", F.input("due", o.due, { type: "date" })),
      field("What's due", F.input("dueLabel", o.dueLabel, { maxlength: 200 }), "e.g. Step-1 proposal"),
      field("Capability IDs it uses", F.input("brings", (o.brings || []).join(", "), { maxlength: 200 }), "Comma-separated, e.g. C1, C8", true),
      field("What PSPL brings", F.area("bringsText", o.bringsText, 3), null, true),
      field("Gaps and partners", F.area("gaps", o.gaps, 3), null, true),
      field("What NASA asks for", F.input("says", o.says, { maxlength: 200 }), "A short quote from the call", true),
      field("Next action", F.area("action", o.action, 2), null, true),
      field("Notes", F.area("notes", o.notes, 3), null, true),
      field("Sources", F.area("sources", (o.sources || []).map((x) => (x.label ? x.label + " | " : "") + x.url).join("\n"), 3), "One per line: label | link", true),
      h("div", { class: "form-actions" },
        h("button", { class: "btn primary", type: "submit" }, "Save changes"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { S.editingOpp = null; renderOpps(); } }, "Cancel")));
    form.addEventListener("submit", (e) => { e.preventDefault(); saveOppForm(o.id, form); });
    return h("div", { class: "opp-body edit" }, form);
  }
  function parseIds(s) {
    return [...new Set(String(s || "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[CG]\d{1,3}$/.test(x)))];
  }
  function parseSources(raw) {
    const out = [];
    for (const line of String(raw || "").split(/\n+/)) {
      const t = line.trim();
      if (!t) continue;
      const i = t.lastIndexOf("|");
      const label = i >= 0 ? t.slice(0, i).trim() : "";
      const url = (i >= 0 ? t.slice(i + 1) : t).trim();
      if (!safeUrl(url)) continue;
      out.push({ label: str(label, 120) || url.replace(/^https?:\/\//i, "").split("/")[0], url: url.slice(0, 600) });
      if (out.length >= 8) break;
    }
    return out;
  }
  function saveOppForm(id, form) {
    const fd = new FormData(form);
    const g = (k, n) => str(fd.get(k), n || 2000);
    const base = S.opps.get(id) || {};
    const data = Object.assign({}, base, {
      abbr: g("abbr", 24), element: g("element", 60), title: g("title", 200), division: g("division", 40), sid: g("sid", 80),
      status: STATUS[g("status")] ? g("status") : "expected", statusNote: g("statusNote", 120),
      due: parseDay(fd.get("due")) ? String(fd.get("due")) : null, dueLabel: g("dueLabel", 200),
      brings: parseIds(fd.get("brings")), bringsText: g("bringsText", 800), gaps: g("gaps", 800), says: g("says", 200),
      action: g("action", 600), notes: g("notes", 1200), sources: parseSources(fd.get("sources")),
    });
    if (!data.title) { toast("Give the call a name before saving."); return; }
    S.editingOpp = null;
    putOpp(id, data);
    toast("Saved in this browser. Publish to share it.");
  }
  function setStatus(id, status, prev) {
    patchOpp(id, { status, prevStatus: prev || null });
    toast(status === "archived" ? "Archived. Find it under Archived." : "Restored.");
  }
  function deleteOpp(id) {
    S.expanded.delete(id);
    S.proposals.delete(id);
    removeOpp(id);
    toast("Deleted in this browser. Publish to share it.");
  }

  // ---------- AI suggestions ----------
  function registerText() {
    return capsSorted().map((c) => [c.id, c.kind === "gap" ? "GAP" : "CAP", c.category, c.name, c.evidence, c.maturity].map((x) => str(x, 400)).join(" | ")).join("\n");
  }
  const RUBRIC = [
    "alignment 0-3: how directly the call's science or technology goals match PSPL's capabilities (3 core strength, 2 solid partial match, 1 tangential, 0 unrelated).",
    "readiness 0-3: whether PSPL could write a competitive proposal with what the register shows today (3 ready now, 2 needs modest work, 1 needs major new work or partners, 0 not credible yet).",
    "timing 0-2: 0 if the next deadline is under about 3 weeks away or new proposers can no longer enter; 1 if about 3-6 weeks away or unknown; 2 if months away or not yet released.",
  ].join("\n");
  const INTRO = "You are scoring one NASA solicitation for the Princeton Space Physics Laboratory (PSPL), a university lab that builds, calibrates and flies space-plasma instruments and analyzes heliophysics and dust data.";
  const SHAPE = '{"alignment":2,"readiness":1,"timing":2,"brings":["C1","C8"],"bringsText":"1-2 sentences on what PSPL brings","gaps":"1-2 sentences on what is missing and what kind of partner fills it; cite GAP ids when one applies","says":"verbatim quote of at most 15 words from the call text stating what NASA asks for, or an empty string","action":"one concrete next step for PSPL","notes":"eligibility limits, review format or anything to check, or an empty string"}';
  function promptFor(info, intro) {
    const dl = info.due ? Math.round((parseDay(info.due) - todayLocal()) / 864e5) : null;
    return [
      INTRO, intro || "", "", "Today is " + isoDay(todayLocal()) + ".", "",
      "PSPL CAPABILITY REGISTER (CAP = capability PSPL has; GAP = known gap PSPL would need a partner for). Fields: id | type | category | capability | evidence | maturity",
      registerText(), "",
      "THE CALL",
      "Name: " + (info.title || ""),
      "Short name / element: " + [info.abbr, info.element].filter(Boolean).join(" "),
      "Division: " + (info.division || "not given"),
      "Status: " + (STATUS[info.status] || "not given") + (info.statusNote ? " (" + info.statusNote + ")" : ""),
      "Next deadline: " + (info.due ? info.due + " (" + dl + " days from today)" : "not set"),
      "What's due: " + (info.dueLabel || "not given"),
      info.says ? "What NASA asks for: " + info.says : "",
      info.gaps ? "Earlier gaps note: " + info.gaps : "",
      info.notes ? "Earlier notes: " + info.notes : "",
      info.text ? "Call text:\n<<<\n" + info.text + "\n>>>" : "",
      "", "SCORE IT (whole numbers)", RUBRIC, "",
      "Reply with only one JSON object in this shape:", SHAPE, "",
      "Rules: list only CAP ids from the register in brings; GAP ids go in gaps. Do not claim anything the register does not show. If the call text is thin, say so in notes and score conservatively.",
    ].filter((x, i, arr) => !(x === "" && arr[i - 1] === "")).join("\n");
  }
  function parseLoose(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch (e) { /* keep looking */ }
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* keep looking */ } }
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* give up */ } }
    return null;
  }
  function cleanProposal(x, withSays) {
    if (!isObj(x)) return null;
    if (x.alignment == null && x.readiness == null && x.timing == null) return null;
    const capIds = new Set([...S.caps.keys()].filter((k) => k.startsWith("C")));
    const brings = Array.isArray(x.brings) ? [...new Set(x.brings.map((v) => String(v).trim().toUpperCase()).filter((v) => capIds.has(v)))] : [];
    let says = "";
    if (withSays) {
      const w = str(x.says, 300).replace(/^["\u201C]+|["\u201D]+$/g, "").split(" ").filter(Boolean);
      says = w.length > 15 ? w.slice(0, 15).join(" ") + "\u2026" : w.join(" ");
    }
    return {
      a: clampInt(x.alignment, 3), r: clampInt(x.readiness, 3), t: clampInt(x.timing, 2), brings,
      bringsText: str(x.bringsText, 800), gaps: str(x.gaps, 800), says, action: str(x.action, 600), notes: str(x.notes, 800),
    };
  }
  async function copyText(text, ta) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      if (ta) { ta.focus(); ta.select(); }
      return false;
    }
  }
  function startRescore(id) {
    const o = S.opps.get(id);
    if (!o || !E()) return;
    S.proposals.set(id, { status: "ask", prompt: promptFor(o, "The register may have changed since this call was last scored, so rescore it from PSPL's notes below."), reply: "", error: "" });
    renderOpps();
    requestAnimationFrame(() => { const ta = document.getElementById("rp-prompt-" + id); if (ta) ta.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
  }
  function readRescore(id) {
    const p = S.proposals.get(id);
    if (!p) return;
    const d = cleanProposal(parseLoose(p.reply), false);
    if (!d) { p.error = "That reply doesn't contain the scores. Paste the assistant's whole reply, including the part in braces { }."; renderOpps(); return; }
    S.proposals.set(id, { status: "ready", data: d });
    renderOpps();
  }
  function applyProposal(id) {
    const p = S.proposals.get(id);
    if (!p || p.status !== "ready") return;
    const d = p.data;
    S.proposals.delete(id);
    patchOpp(id, { a: d.a, r: d.r, t: d.t, brings: d.brings, bringsText: d.bringsText, gaps: d.gaps, action: d.action, notes: d.notes || (S.opps.get(id) || {}).notes || "" });
    toast("Applied the suggested scores. Publish to share them.");
  }

  // ---------- add a call ----------
  function readAddForm() {
    const v = (id) => document.getElementById(id).value || "";
    return {
      title: str(v("a-title"), 200), abbr: str(v("a-abbr"), 24), element: str(v("a-element"), 60), division: v("a-division"),
      status: STATUS[v("a-status")] ? v("a-status") : "expected", due: parseDay(v("a-due")) ? v("a-due") : null,
      dueLabel: str(v("a-duelabel"), 200), source: str(v("a-source"), 600), text: v("a-text").trim().slice(0, 30000),
    };
  }
  function openAdd(prefill) {
    if (!E()) return;
    setTab("opportunities");
    $("#addForm").reset();
    $("#a-prompt").value = "";
    $("#a-reply").value = "";
    $("#a-aimsg").textContent = "";
    $("#a-copied").textContent = "";
    $("#aiBox").hidden = true;
    S.add = { reviewKey: null, reviewStamp: null, result: null };
    if (prefill) {
      const set = (id, val) => { if (val != null) document.getElementById(id).value = val; };
      set("a-title", prefill.title); set("a-abbr", prefill.abbr); set("a-element", prefill.element);
      if (DIVISIONS.includes(prefill.division)) set("a-division", prefill.division);
      set("a-status", prefill.status); set("a-due", prefill.due || ""); set("a-duelabel", prefill.dueLabel);
      set("a-source", prefill.source); set("a-text", prefill.text);
      S.add.reviewKey = prefill.reviewKey || null;
      S.add.reviewStamp = prefill.reviewStamp || null;
    }
    renderAddResult();
    $("#addPanel").hidden = false;
    $("#addPanel").scrollIntoView({ block: "start", behavior: "smooth" });
    requestAnimationFrame(() => $("#a-title").focus({ preventScroll: true }));
  }
  function closeAdd() { $("#addPanel").hidden = true; S.add = { reviewKey: null, reviewStamp: null, result: null }; }
  function showAiBox() {
    const info = readAddForm();
    if (!info.title) { toast("Give the call a name first."); $("#a-title").focus(); return; }
    $("#a-prompt").value = promptFor(info, "");
    $("#aiBox").hidden = false;
    $("#a-copied").textContent = "";
    $("#a-aimsg").textContent = "";
    $("#a-prompt").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function readAiReply() {
    const d = cleanProposal(parseLoose($("#a-reply").value), true);
    if (!d) { $("#a-aimsg").textContent = "That reply doesn't contain the scores. Paste the assistant's whole reply, including the part in braces { }."; return; }
    $("#a-aimsg").textContent = "";
    S.add.result = d;
    renderAddResult();
  }
  function bumpPreview(key, delta) {
    const r = S.add.result;
    if (!r) return;
    const max = key === "t" ? 2 : 3;
    r[key] = Math.max(0, Math.min(max, r[key] + delta));
    renderAddResult();
  }
  function renderAddResult() {
    const host = $("#addResult");
    const r = S.add.result;
    if (!r) { host.replaceChildren(); return; }
    const s = r.a + r.r + r.t;
    const fit = fitOf(s);
    const dial = (key, name, max) => h("div", { class: "dial" },
      h("span", { class: "dial-name", text: name }),
      h("span", { class: "stepper" },
        h("button", { type: "button", "aria-label": "Lower " + name.toLowerCase(), "data-fk": "pv" + key + "-", disabled: r[key] <= 0, onclick: () => bumpPreview(key, -1) }, "\u2212"),
        h("output", { text: r[key] + "/" + max }),
        h("button", { type: "button", "aria-label": "Raise " + name.toLowerCase(), "data-fk": "pv" + key + "+", disabled: r[key] >= max, onclick: () => bumpPreview(key, 1) }, "+")));
    const fk = focusKey();
    host.replaceChildren(h("div", { class: "preview" },
      h("div", { class: "facts" },
        h("h3", { class: "label", text: "Suggested by the AI assistant" }),
        factNode("PSPL brings", h("div", null,
          r.brings.length ? h("div", { class: "brings-list" }, r.brings.map((cid) => { const c = S.caps.get(cid); return h("span", { class: "capref" }, h("b", { text: cid }), c ? c.name : ""); })) : null,
          h("p", { text: r.bringsText || "Nothing in the register matched." }))),
        fact("Gaps and partners", r.gaps || "None noted."),
        r.says ? factNode("What NASA asks for", h("p", { class: "says", text: "\u201C" + r.says + "\u201D" })) : null,
        fact("Next action", r.action || "None suggested."),
        r.notes ? fact("Notes", r.notes) : null),
      h("div", { class: "side" },
        h("div", { class: "scorer" },
          dial("a", "Alignment", 3), dial("r", "Readiness", 3), dial("t", "Timing", 2),
          h("div", { class: "scoreline" }, h("span", null, "Score ", h("b", { text: String(s) }), " of 8"), h("span", { class: "fit " + fit.toLowerCase(), text: fit }))),
        h("div", { class: "actions" },
          h("button", { class: "btn primary", type: "button", onclick: saveNewCall }, "Add to board"),
          h("button", { class: "btn ghost", type: "button", onclick: () => { S.add.result = null; renderAddResult(); } }, "Discard suggestion")))));
    restoreFocus(fk);
  }
  function saveNewCall() {
    if (!E()) return;
    const info = readAddForm();
    if (!info.title) { toast("Give the call a name first."); $("#a-title").focus(); return; }
    const r = S.add.result;
    const dl = info.due ? Math.round((parseDay(info.due) - todayLocal()) / 864e5) : null;
    const now = nowIso();
    const initials = info.title.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.length > 2).map((w) => w[0].toUpperCase()).join("").slice(0, 6);
    const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = {
      abbr: info.abbr || initials || "Call", element: info.element, title: info.title, division: info.division, sid: "",
      status: info.status, statusNote: "Added " + fmtDay(todayLocal(), true), due: info.due, dueLabel: info.dueLabel,
      a: r ? r.a : 1, r: r ? r.r : 1, t: r ? r.t : (dl == null ? 2 : dl <= 21 ? 0 : dl <= 45 ? 1 : 2),
      brings: r ? r.brings : [], bringsText: r ? r.bringsText : "", gaps: r ? r.gaps : "", says: r ? r.says : "",
      action: r ? r.action : "", notes: r ? r.notes : "",
      sources: safeUrl(info.source) ? [{ label: "Call page", url: info.source }] : [],
      flag: "new", origin: r ? "ai" : "manual", createdAt: now,
    };
    if (S.add.reviewKey) CH.reviewed[S.add.reviewKey] = S.add.reviewStamp || now;
    S.expanded.add(id);
    if (!r) S.editingOpp = id;
    closeAdd();
    putOpp(id, data);
    toast(r ? "Added with the suggested scores. Publish to share it." : "Added. Fill in what PSPL brings, the gaps and the scores, then save.");
    requestAnimationFrame(() => { const el = document.getElementById("opp-" + id); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); if (!r) focusFirst("#opp-" + id + " form"); });
  }

  // ---------- register ----------
  let capNodes = new Map();
  function capKey(id) { const m = /^([CG])(\d+)$/.exec(id); return m ? (m[1] === "C" ? 0 : 1e4) + +m[2] : 2e4; }
  function capsSorted() { return [...S.caps].map(([id, c]) => Object.assign({ id }, c)).sort((x, y) => capKey(x.id) - capKey(y.id) || byCode(x.id, y.id)); }
  function usageIndex() {
    const m = new Map();
    const add = (k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
    for (const o of S.opps.values()) {
      if (o.status === "archived") continue;
      const tag = o.abbr || o.title || "Call";
      for (const cid of o.brings || []) add(cid, tag);
      for (const g of String(o.gaps || "").match(/\bG\d{1,3}\b/g) || []) add(g, tag);
    }
    return m;
  }
  const capHay = (c) => [c.id, c.category, c.name, c.evidence, c.maturity, c.source && c.source.label, c.owner].join(" ").toLowerCase();

  function renderCaps() {
    const fk = focusKey();
    const nodes = new Map();
    $("#capList").replaceChildren(...buildCaps(nodes));
    capNodes = nodes;
    restoreFocus(fk);
    const caps = [...S.caps.values()];
    const nCap = caps.filter((c) => c.kind !== "gap").length;
    $("#capSummary").textContent = S.loaded && caps.length ? nCap + " capabilities \u00B7 " + (caps.length - nCap) + " known gaps \u00B7 " + caps.filter((c) => c.confirmed).length + " of " + caps.length + " confirmed" : "";
    $("#addCap").hidden = !E();
    $("#capIntroView").hidden = E();
    $("#capIntroEdit").hidden = !E();
  }
  function buildCaps(nodes) {
    if (!S.loaded) return [emptyBox(S.loadFrom === "none" ? "Couldn't load the register." : "Loading the register\u2026", S.loadFrom === "none" ? "Check your connection and reload the page." : "Each row is something PSPL has, or a known gap that needs a partner.")];
    const out = [];
    if (S.addingCap && E()) {
      const prev = capNodes.get("__new");
      const node = prev && prev.querySelector("form.cap-form") ? prev : capForm(null);
      nodes.set("__new", node);
      out.push(node);
    }
    const list = capsSorted();
    if (!list.length && !S.addingCap) {
      out.push(emptyBox("The register is empty.", E() ? "Add what PSPL has, such as flight heritage, lab facilities and expertise, with Add capability." : "Rows appear here once they're published."));
      return out;
    }
    const q = S.capQ.trim().toLowerCase();
    const vis = list.filter((c) => !q || capHay(c).includes(q));
    if (!vis.length && list.length) out.push(h("p", { class: "quiet-line", text: "No rows match this search." }));
    const used = usageIndex();
    for (const c of vis) out.push(capRow(c, used, nodes));
    return out;
  }
  function capRow(c, used, nodes) {
    const prev = capNodes.get(c.id);
    if (S.editingCap === c.id && E() && prev && prev.querySelector("form.cap-form")) { nodes.set(c.id, prev); return prev; }
    if (S.editingCap === c.id && E()) { const f = capForm(c); nodes.set(c.id, f); return f; }
    const gap = c.kind === "gap";
    const u = used.get(c.id) || [];
    const confirmed = E()
      ? h("label", { class: "confirm" },
        h("input", { type: "checkbox", id: "cf-" + c.id, "data-fk": "cf:" + c.id, checked: !!c.confirmed, onchange: (e) => patchCap(c.id, { confirmed: !!e.target.checked }) }),
        "Confirmed")
      : h("p", { class: "confirm-text" + (c.confirmed ? " yes" : ""), text: c.confirmed ? "Confirmed" : "Not confirmed yet" });
    const row = h("article", { class: "cap" + (gap ? " gap" : "") + (S.flashCap === c.id ? " flash" : ""), id: "cap-" + c.id },
      h("div", { class: "cap-id", text: c.id }),
      h("div", { class: "cap-main" },
        h("div", { class: "cap-cat", text: gap ? "Known gap" + (c.category && c.category !== "Gap (inferred)" ? " \u00B7 " + c.category : "") : (c.category || "Capability") }),
        h("div", { class: "cap-name" }, c.name || "Unnamed", CH.caps[c.id] ? h("span", { class: "pill mine", text: "Changed here" }) : null),
        c.evidence ? h("p", { class: "cap-ev", text: c.evidence }) : null,
        h("p", { class: "cap-used", text: u.length ? (gap ? "Flagged in: " : "Used by: ") + u.join(", ") : (gap ? "Not flagged in any call" : "Not used by any call yet") })),
      h("div", { class: "cap-side" },
        h("dl", { class: "kv" },
          h("dt", { text: "Maturity" }), h("dd", { text: c.maturity || "Not set" }),
          h("dt", { text: "Source" }), h("dd", null, sourceLink(c.source)),
          h("dt", { text: "Owner" }), h("dd", { text: c.owner || "Not set" })),
        confirmed,
        E() ? h("div", null, h("button", { class: "btn ghost", type: "button", "data-fk": "cedit:" + c.id, onclick: () => { S.editingCap = c.id; renderCaps(); focusFirst("#cap-" + c.id + " form"); } }, "Edit")) : null));
    nodes.set(c.id, row);
    return row;
  }
  function capForm(c) {
    const isNew = !c;
    const F = fieldsFor(isNew ? "cf-new" : "cfe-" + c.id);
    const src = (c && c.source) || {};
    const form = h("form", { class: "form cap-form", novalidate: true },
      isNew ? field("Type", F.select("kind", ["cap", "gap"], "cap", { cap: "Capability PSPL has", gap: "Known gap (needs a partner)" })) : null,
      field("Category", F.input("category", c ? c.category : "", { maxlength: 60 }), "e.g. Facility, Flight heritage, Science"),
      field("Capability", F.input("name", c ? c.name : "", { maxlength: 200 }), null, true),
      field("Evidence or heritage", F.area("evidence", c ? c.evidence : "", 3), "What shows PSPL has it: missions, specs, papers", true),
      field("Maturity", F.input("maturity", c ? c.maturity : "", { maxlength: 60 }), "e.g. Flight-proven, Operational, TRL 4"),
      field("Owner or contact", F.input("owner", c ? c.owner : "", { maxlength: 80 })),
      field("Source label", F.input("srcLabel", src.label || "", { maxlength: 120 })),
      field("Source link", F.input("srcUrl", src.url || "", { type: "url", maxlength: 600 })),
      h("div", { class: "form-actions" },
        h("button", { class: "btn primary", type: "submit" }, isNew ? "Add to register" : "Save changes"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { if (isNew) S.addingCap = false; else S.editingCap = null; renderCaps(); } }, "Cancel"),
        isNew ? null : confirmButton("Delete row", "Confirm delete", () => { S.editingCap = null; removeCap(c.id); toast("Deleted " + c.id + " in this browser. Calls that listed it now show it as missing."); }, "cdel:" + c.id)));
    form.addEventListener("submit", (e) => { e.preventDefault(); saveCapForm(c, form); });
    return h("article", { class: "cap editing" + (c && c.kind === "gap" ? " gap" : ""), id: isNew ? "cap-new" : "cap-" + c.id },
      h("div", { class: "cap-main" }, h("div", { class: "cap-cat", text: isNew ? "New row" : "Editing " + c.id }), form));
  }
  function nextCapId(kind) {
    const prefix = kind === "gap" ? "G" : "C";
    let max = 0;
    const ids = new Set([...Object.keys(BASE.caps), ...Object.keys(CH.caps), ...S.caps.keys()]);
    for (const id of ids) { const m = new RegExp("^" + prefix + "(\\d+)$").exec(id); if (m) max = Math.max(max, +m[1]); }
    return prefix + (max + 1);
  }
  function saveCapForm(c, form) {
    const fd = new FormData(form);
    const g = (k, n) => str(fd.get(k), n || 1000);
    const name = g("name", 200);
    if (!name) { toast("Name the capability before saving."); return; }
    const url = safeUrl(g("srcUrl", 600));
    const label = g("srcLabel", 120);
    const source = label || url ? Object.assign({ label: label || url.replace(/^https?:\/\//i, "").split("/")[0] }, url ? { url } : {}) : null;
    const fields = { category: g("category", 60), name, evidence: g("evidence", 800), maturity: g("maturity", 60), owner: g("owner", 80), source };
    if (c) {
      S.editingCap = null;
      patchCap(c.id, fields);
      toast("Saved " + c.id + " in this browser. Publish to share it.");
      return;
    }
    const kind = fd.get("kind") === "gap" ? "gap" : "cap";
    const id = nextCapId(kind);
    S.addingCap = false;
    putCap(id, Object.assign({ kind }, fields, { confirmed: false, order: Date.now() }));
    toast("Added " + id + " in this browser. Publish to share it.");
  }
  function gotoCap(cid) {
    S.capQ = "";
    $("#capSearch").value = "";
    S.flashCap = cid;
    setTab("capabilities");
    renderCaps();
    requestAnimationFrame(() => { const el = document.getElementById("cap-" + cid); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); });
    setTimeout(() => { S.flashCap = null; const el = document.getElementById("cap-" + cid); if (el) el.classList.remove("flash"); }, 1800);
  }

  // ---------- CSV export ----------
  const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rows) => "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  function exportCsv(kind) {
    if (!S.loaded) return;
    let rows;
    if (kind === "opps") {
      rows = [["Short name", "Element", "Call", "Division", "Solicitation ID", "Status", "Status note", "Next deadline", "What's due", "Days left", "Alignment", "Readiness", "Timing", "Score", "Fit", "Capability IDs", "What PSPL brings", "Gaps and partners", "What NASA asks for", "Next action", "Notes", "Sources"]];
      const list = [...S.opps.values()].sort((x, y) => (OPEN.has(y.status) - OPEN.has(x.status)) || byScore(x, y));
      for (const o of list) {
        const s = scoreOf(o);
        rows.push([o.abbr, o.element, o.title, o.division, o.sid, STATUS[o.status] || o.status, o.statusNote, o.due || "", o.dueLabel, daysLeft(o) ?? "", clampInt(o.a, 3), clampInt(o.r, 3), clampInt(o.t, 2), s, fitOf(s), (o.brings || []).join(" "), o.bringsText, o.gaps, o.says, o.action, o.notes, (o.sources || []).map((x) => x.url).join(" ")]);
      }
    } else {
      rows = [["ID", "Type", "Category", "Capability", "Evidence", "Maturity", "Source", "Source link", "Owner", "Confirmed"]];
      for (const c of capsSorted()) rows.push([c.id, c.kind === "gap" ? "Known gap" : "Capability", c.category, c.name, c.evidence, c.maturity, c.source && c.source.label, c.source && c.source.url, c.owner, c.confirmed ? "Yes" : "No"]);
    }
    const name = (kind === "opps" ? "PSPL calls " : "PSPL capabilities ") + isoDay(todayLocal()) + ".csv";
    downloadBlob(new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }), name);
    toast("Saved " + name + " to your Downloads folder.");
  }

  // ---------- wiring ----------
  function setEditMode(on) {
    S.editMode = !!on;
    savePrefs();
    if (!S.editMode) {
      closeAdd();
      S.editingOpp = null;
      S.editingCap = null;
      S.addingCap = false;
      S.proposals.clear();
    }
    renderAll();
    toast(S.editMode
      ? "Edit mode is on in this browser. Your changes stay here until you publish them."
      : "Edit mode is off." + (changeCounts().total ? " Your unpublished changes are still listed in the gold band." : ""));
  }
  function bindStatic() {
    $("#a-division").replaceChildren(...DIVISIONS.map((d) => h("option", { value: d, selected: d === "Heliophysics" }, d)));
    for (const t of TABS) document.getElementById("tab-" + t).addEventListener("click", () => setTab(t));
    $(".tabs [role=tablist]").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(S.tab);
      setTab(TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length], true);
    });
    for (const b of document.querySelectorAll(".seg button")) {
      b.addEventListener("click", () => { S.fit = b.dataset.fit; savePrefs(); renderTabs(); renderOpps(); });
    }
    $("#oppSearch").addEventListener("input", (e) => { S.q = e.target.value; renderOpps(); });
    $("#capSearch").addEventListener("input", (e) => { S.capQ = e.target.value; renderCaps(); });
    $("#checkNowBtn").addEventListener("click", checkNasa);
    $("#addCallBtn").addEventListener("click", () => openAdd(null));
    $("#addClose").addEventListener("click", closeAdd);
    $("#addForm").addEventListener("submit", (e) => { e.preventDefault(); saveNewCall(); });
    $("#a-ai").addEventListener("click", showAiBox);
    $("#a-copy").addEventListener("click", async () => {
      const ok = await copyText($("#a-prompt").value, $("#a-prompt"));
      $("#a-copied").textContent = ok ? "Copied." : "Press Ctrl+C (Cmd+C on a Mac) to copy the selected prompt.";
    });
    $("#a-read").addEventListener("click", readAiReply);
    $("#addCap").addEventListener("click", () => { if (!E()) return; S.addingCap = true; S.capQ = ""; $("#capSearch").value = ""; renderCaps(); focusFirst("#cap-new form"); });
    $("#exportOpps").addEventListener("click", () => exportCsv("opps"));
    $("#exportCaps").addEventListener("click", () => exportCsv("caps"));
    $("#publishBtn").addEventListener("click", publishChanges);
    $("#editBtn").addEventListener("click", () => { if (S.loaded) setEditMode(!S.editMode); });
    $("#publishClose").addEventListener("click", () => { S.publish = null; resetPublishUi(); renderBand(); $("#publishBtn").focus(); });
    $("#copyBoardBtn").addEventListener("click", async () => {
      if (!S.publish) return;
      const ta = $("#publishText");
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(S.publish.json); ok = true; }
      } catch (e) { ok = false; }
      if (ok) {
        ta.hidden = true;
        $("#copyMsg").textContent = "Copied. Next, open board.json on GitHub.";
      } else {
        ta.value = S.publish.json;
        ta.hidden = false;
        ta.focus();
        ta.select();
        $("#copyMsg").textContent = "Your browser blocked copying, so the new board is selected below. Press Ctrl+C (Cmd+C on a Mac).";
      }
    });
    $("#downloadBoardBtn").addEventListener("click", () => {
      if (!S.publish) return;
      downloadBlob(new Blob([S.publish.json], { type: "application/json" }), "board.json");
      toast("Saved board.json to your Downloads folder.");
    });
    let armed = false;
    let armTimer = 0;
    const discard = $("#discardBtn");
    discard.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        discard.textContent = "Confirm discard";
        discard.classList.add("armed");
        armTimer = setTimeout(() => { armed = false; discard.textContent = "Discard my changes"; discard.classList.remove("armed"); }, 4000);
        return;
      }
      clearTimeout(armTimer);
      armed = false;
      discard.textContent = "Discard my changes";
      discard.classList.remove("armed");
      const keep = { checkedOn: CH.meta.checkedOn, checkedVia: CH.meta.checkedVia };
      CH = emptyChanges();
      if (keep.checkedOn) Object.assign(CH.meta, keep);
      S.editingOpp = null;
      S.editingCap = null;
      S.proposals.clear();
      persist();
      toast("Discarded. You're back to the published board.");
    });
    $("#set-maintainer-save").addEventListener("click", () => {
      if (!E()) return;
      const v = str($("#set-maintainer").value, 80);
      if (v === maintainerName()) { toast("No change to save."); return; }
      CH.meta.maintainer = v;
      CH.meta.maintainerAt = nowIso();
      persist();
      toast("Saved the name in this browser. It goes out with the next publish.");
    });
    $("#set-theme").addEventListener("change", (e) => { S.theme = e.target.value; savePrefs(); applyTheme(); });
  }

  async function init() {
    document.getElementById("app").replaceChildren(document.getElementById("app-shell").content.cloneNode(true));
    S.storageOk = probeStorage();
    restorePrefs();
    bindStatic();
    renderAll();
    const res = await loadBoard();
    if (res.board) {
      BASE = res.board;
      S.loaded = true;
    }
    S.loadFrom = res.from;
    S.loadBroken = !!res.broken;
    CH = S.storageOk && S.loaded ? loadChanges() : emptyChanges();
    if (S.storageOk && S.loaded) store.set(K_CHANGES, CH);
    loadReview();
    rebuild();
    renderAll();
  }

  init();
})();
