// =====================================================================
//  서버(/api/...)와 이야기하는 부분이에요.
//  app.js는 예전(Claude Artifact) 때와 같은 방식(db.collection(...).onSnapshot 등)으로
//  데이터를 다루고, 이 파일이 그것을 실제 서버 요청으로 바꿔 줘요.
// =====================================================================

const API = (() => {
  const TOKEN_KEY = "sc_tokens";        // 로그인 정보는 이 탭에서만 기억해요 (탭을 닫으면 로그아웃)
  let tokens = { teacher: null, council: null, councilRole: null, classes: {} };
  try { tokens = { ...tokens, ...JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "{}") }; } catch {}
  tokens.classes ||= {};

  function persist() { try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch {} }
  function authHeader() {
    const list = [tokens.teacher, tokens.council, ...Object.values(tokens.classes)].filter(Boolean);
    return list.length ? { authorization: "Bearer " + list.join(",") } : {};
  }
  async function req(method, path, data) {
    let res;
    try {
      res = await fetch("/api" + path, {
        method,
        headers: { ...(data !== undefined ? { "content-type": "application/json" } : {}), ...authHeader() },
        body: data !== undefined ? JSON.stringify(data) : undefined,
        cache: "no-store",
      });
    } catch {
      throw { code: "unavailable", message: "인터넷 연결을 확인해 주세요." };
    }
    let out = null;
    try { out = await res.json(); } catch {}
    if (!res.ok) {
      const code = res.status === 401 ? "wrong_password" : res.status === 403 ? "invalid_argument"
        : res.status === 413 ? "quota_exceeded" : res.status === 404 ? "not_found" : "unavailable";
      throw { code, status: res.status, message: out?.error || "요청을 처리하지 못했어요." };
    }
    return out;
  }
  async function login(kind, key, password) {
    const r = await req("POST", "/login", { kind, key, password });
    if (kind === "teacher") tokens.teacher = r.token;
    if (kind === "council") { tokens.council = r.token; tokens.councilRole = key; }
    if (kind === "class") tokens.classes[key] = r.token;
    persist();
    return r;
  }
  function logout(kind, key) {
    if (kind === "teacher") tokens.teacher = null;
    if (kind === "council") { tokens.council = null; tokens.councilRole = null; }
    if (kind === "class") delete tokens.classes[key];
    persist();
  }
  // 서버가 인정한 로그인만 남겨요 (비밀번호가 바뀌었거나 시간이 지난 것은 지워요).
  function syncScopes(scopes) {
    const s = new Set(scopes || []);
    let changed = false;
    if (tokens.teacher && !s.has("teacher")) { tokens.teacher = null; changed = true; }
    if (tokens.council && !s.has("council:" + tokens.councilRole)) { tokens.council = null; tokens.councilRole = null; changed = true; }
    for (const c of Object.keys(tokens.classes)) if (!s.has("class:" + c)) { delete tokens.classes[c]; changed = true; }
    if (changed) persist();
    return changed;
  }
  async function download(path, filename) {
    const res = await fetch("/api" + path, { headers: authHeader(), cache: "no-store" });
    if (!res.ok) throw { code: res.status === 403 ? "invalid_argument" : "unavailable" };
    const blob = await res.blob();
    saveBlob(blob, filename);
  }
  async function blobUrl(path) {
    const res = await fetch("/api" + path, { headers: authHeader() });
    if (!res.ok) throw { code: "unavailable" };
    return URL.createObjectURL(await res.blob());
  }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return {
    req, login, logout, syncScopes, download, blobUrl, saveBlob,
    limits: { attach: 8 * 1024 * 1024, image: 1200 * 1024, noticeImages: 6 },
    fileUrl: id => `/api/attach/${id}`,
    canChangeTeacherPassword: false,     // 교사 비밀번호는 Cloudflare 환경변수(ADMIN_PASSWORD)로 정해요
    get tokens() { return tokens; },
  };
})();

// ---------------------------------------------------------------------
//  예전 코드가 쓰던 db.collection(...) / db.doc(...) 모양을 그대로 흉내 내요.
//  - 처음 열 때와 그 뒤 15초마다(화면이 보일 때) 서버에서 전체 글을 받아 와요.
//  - 글을 쓰면 먼저 화면에 반영하고, 서버에 저장된 것이 확인될 때까지 지켜봐요.
//    (동시에 여러 명이 쓰다가 하나가 빠지면 자동으로 다시 보내요.)
// ---------------------------------------------------------------------
function makeDb(onMeta) {
  const POLL_MS = 15000;
  let server = {};                 // 서버에서 받은 글: { 모음이름: { id: 글 } }
  const pending = new Map();       // 아직 확인 안 된 쓰기: "모음/id" → {op, data, w, at, tries}
  const listeners = new Set();
  let timer = null, inflight = null, loadedOnce = false;

  const deepMerge = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])
        ? deepMerge(out[k], v) : v;
    }
    return out;
  };
  const freeze = o => (o && typeof o === "object" ? Object.freeze(o) : o);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function view(col) {
    const base = { ...(server[col] || {}) };
    for (const [key, p] of pending) {
      const [c, id] = key.split("/");
      if (c !== col) continue;
      if (p.op === "delete") delete base[id]; else base[id] = p.data;
    }
    return base;
  }
  function docSnap(id, data) {
    return { id, exists: data !== undefined, data: () => data, metadata: { fromCache: !loadedOnce, hasPendingWrites: false } };
  }
  function notify() {
    for (const l of listeners) {
      try {
        if (l.type === "doc") l.next(docSnap(l.id, view(l.col)[l.id]));
        else l.next(runQuery(l.q));
      } catch (e) { console.error(e); }
    }
  }
  function runQuery(q) {
    let docs = Object.entries(view(q.col)).map(([id, d]) => docSnap(id, d));
    for (const [f, op, v] of q.where) {
      docs = docs.filter(s => {
        const x = s.data()[f];
        switch (op) {
          case "==": return x === v; case "!=": return x !== v; case "<": return x < v; case "<=": return x <= v;
          case ">": return x > v; case ">=": return x >= v; case "in": return v.includes(x); case "not-in": return !v.includes(x);
          case "array-contains": return Array.isArray(x) && x.includes(v); default: return true;
        }
      });
    }
    if (q.order) {
      const [f, dir] = q.order;
      docs.sort((a, b) => {
        const x = a.data()[f], y = b.data()[f];
        if (x === y) return a.id < b.id ? -1 : 1;
        if (x === undefined) return 1; if (y === undefined) return -1;
        return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
      });
    } else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (q.limit) docs = docs.slice(0, q.limit);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: !loadedOnce, hasPendingWrites: pending.size > 0 } };
  }

  async function refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await API.req("GET", "/data");
        const dropped = API.syncScopes(r.scopes);
        const cols = {};
        for (const [c, o] of Object.entries(r.collections || {})) {
          cols[c] = {};
          for (const [id, d] of Object.entries(o)) cols[c][id] = freeze(d);
        }
        server = cols;
        loadedOnce = true;
        // 확인: 내가 쓴 것이 서버에 들어갔는지 보고, 빠졌으면 다시 보내요.
        const now = Date.now();
        for (const [key, p] of [...pending]) {
          const [c, id] = key.split("/");
          const s = server[c]?.[id];
          const done = p.op === "delete" ? s === undefined : (s && s._w === p.w);
          if (done) pending.delete(key);
          else if (now - p.at > 5000) {
            if (p.tries >= 4) { pending.delete(key); continue; }
            p.tries++; p.at = now;
            send(key, p).catch(() => {});
          }
        }
        onMeta && onMeta({ ok: true, pinStatus: r.pinStatus, scopes: r.scopes, dropped });
        notify();
      } catch (e) {
        onMeta && onMeta({ ok: false, error: e });
      } finally { inflight = null; }
    })();
    return inflight;
  }
  function schedule(ms = POLL_MS) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (document.visibilityState === "visible") await refresh();
      schedule();
    }, ms);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refresh(); schedule(); } });

  async function send(key, p) {
    const [col, id] = key.split("/");
    if (p.op === "delete") return API.req("DELETE", `/doc?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`);
    const r = await API.req("PUT", "/doc", { col, id, data: p.payload, w: p.w });
    if (r?.doc) { p.data = Object.freeze({ ...r.doc }); const { _w, ...rest } = r.doc; p.payload = rest; notify(); } // 사진·첨부는 서버가 따로 보관하고 주소만 남겨요
    return r;
  }
  async function write(col, id, op, data) {
    const key = `${col}/${id}`;
    const w = newId();
    const p = { op, payload: data, data: op === "delete" ? undefined : freeze({ ...data, _w: w }), w, at: Date.now(), tries: 0 };
    const prev = pending.get(key);
    pending.set(key, p);
    notify();
    try {
      await send(key, p);
      clearTimeout(timer); schedule(1500);   // 곧 다시 받아서 확인해요
    } catch (e) {
      if (pending.get(key) === p) { if (prev) pending.set(key, prev); else pending.delete(key); }
      notify();
      throw e;
    }
  }

  function docRef(col, id) {
    return {
      id, path: `${col}/${id}`,
      async get() { if (!loadedOnce) await refresh(); return docSnap(id, view(col)[id]); },
      set(data) { return write(col, id, "set", { ...data }); },
      update(patch) {
        const cur = view(col)[id];
        if (!cur) return Promise.reject({ code: "invalid_argument", message: "없는 글이에요." });
        const { _w, ...rest } = cur;
        return write(col, id, "set", deepMerge(rest, patch));
      },
      delete() { return write(col, id, "delete"); },
      onSnapshot(next, error) {
        const l = { type: "doc", col, id, next, error };
        listeners.add(l);
        if (loadedOnce) next(docSnap(id, view(col)[id]));
        return () => listeners.delete(l);
      },
    };
  }
  function query(col, q = { where: [], order: null, limit: 0 }) {
    const self = {
      where: (f, op, v) => query(col, { ...q, where: [...q.where, [f, op, v]] }),
      orderBy: (f, dir = "asc") => query(col, { ...q, order: [f, dir] }),
      limit: n => query(col, { ...q, limit: n }),
      async get() { if (!loadedOnce) await refresh(); return runQuery({ ...q, col }); },
      onSnapshot(next, error) {
        const l = { type: "query", q: { ...q, col }, next, error };
        listeners.add(l);
        if (loadedOnce) next(runQuery(l.q));
        return () => listeners.delete(l);
      },
    };
    return self;
  }
  function collection(col) {
    return {
      ...query(col), path: col,
      doc: id => docRef(col, id || newId()),
      async add(data) { const ref = docRef(col, newId()); await ref.set(data); return ref; },
    };
  }

  refresh().then(() => schedule());
  return {
    collection,
    doc(path) { const [c, id] = path.split("/"); return docRef(c, id); },
    refresh,
  };
}
