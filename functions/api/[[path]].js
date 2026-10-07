// =====================================================================
//  우리 학교 학생자치회 — 서버 API (Cloudflare Pages Functions + KV)
//
//  이 파일 하나가 /api/... 로 들어오는 모든 요청을 처리해요.
//  필요한 설정 (Cloudflare Pages → Settings):
//    - KV 바인딩:   변수 이름 KV  → 만든 KV 네임스페이스 연결
//    - 환경변수:    ADMIN_PASSWORD  (교사 비밀번호, 필수)
//                   SESSION_SECRET  (로그인 서명용 긴 임의 문자열, 권장)
// =====================================================================

const GRADES = [{ g: 4, classes: 4 }, { g: 5, classes: 4 }, { g: 6, classes: 5 }];
const ALL_CLASSES = GRADES.flatMap(({ g, classes }) => Array.from({ length: classes }, (_, i) => `${g}-${i + 1}`));
const COUNCIL_ROLES = ["president", "vp6", "vp5"];

const COLLECTIONS = [
  "notices", "schoolMeetings", "meetings", "activities", "suggestions", "agendas",
  "sends", "exercise", "officers", "schoolAttendance", "pledges",
];
const TEACHER_ONLY = new Set(["notices", "schoolMeetings", "schoolAttendance", "officers", "pledges"]);

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const MAX_DOC_BYTES = 300 * 1024;          // 글 하나 최대 크기 (첨부 제외)
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;  // 첨부파일 하나 최대 크기
const MAX_NOTICE_IMAGES = 6;               // 안내 하나에 올릴 수 있는 사진 수
const TOKEN_HOURS = 12;                    // 로그인 유지 시간

const K = {
  db: "db",                 // 모든 글 (한 덩어리)
  pins: "cfg:pins",         // 반·전교임원 비밀번호 (해시)
  salt: "cfg:salt",
  backup: "backup:server",  // 서버 저장본
  backupMeta: "backup:meta",
  att: id => `att:${id}`,   // 첨부파일
};

// ---------------------------------------------------------------------
export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.KV) return json({ error: "KV 바인딩(KV)이 설정되지 않았어요. README의 설정 방법을 확인해 주세요." }, 500);
  const path = "/" + (params.path || []).join("/");
  const method = request.method;
  try {
    const auth = await readAuth(request, env);
    if (path === "/data" && method === "GET") return await getData(env, auth);
    if (path === "/me" && method === "GET") return json({ scopes: scopeList(auth), adminConfigured: !!env.ADMIN_PASSWORD });
    if (path === "/login" && method === "POST") return await login(request, env);
    if (path === "/doc" && method === "PUT") return await putDoc(request, env, auth);
    if (path === "/doc" && method === "DELETE") return await deleteDoc(request, env, auth);
    if (path === "/pins" && method === "PUT") return await putPin(request, env, auth);
    if (path.startsWith("/attach/") && method === "GET") return await getAttach(path.slice(8), env, auth);
    if (path === "/backup/meta" && method === "GET") return await backupMeta(env, auth);
    if (path === "/backup/save" && method === "POST") return await backupSave(env, auth);
    if (path === "/backup/file" && method === "GET") return await backupFile(env, auth);
    if (path === "/backup/restore" && method === "POST") return await backupRestore(request, env, auth);
    return json({ error: "없는 주소예요." }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요." }, 500);
  }
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
async function body(request, limit = 40 * 1024 * 1024) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > limit) throw new HttpError(413, "보내는 내용이 너무 커요.");
  try { return await request.json(); } catch { throw new HttpError(400, "요청 형식이 올바르지 않아요."); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------
// 저장소: 모든 글을 KV 키 "db" 하나에 { collections: { 이름: { id: 글 } }, rev } 로 저장해요.
async function loadDb(env) {
  const raw = await env.KV.get(K.db, "json");
  const db = raw && raw.collections ? raw : { collections: {}, rev: 0 };
  for (const c of COLLECTIONS) db.collections[c] ||= {};
  return db;
}
async function putWithRetry(env, key, value, opts) {
  for (let i = 0; i < 4; i++) {
    try { await env.KV.put(key, value, opts); return; }
    catch (e) { if (i === 3) throw e; await sleep(1100 + Math.random() * 400); } // KV는 같은 키를 1초에 한 번만 쓸 수 있어요
  }
}
async function mutateDb(env, fn) {
  const db = await loadDb(env);
  const result = await fn(db);
  db.rev = (db.rev || 0) + 1;
  db.updatedAt = Date.now();
  await putWithRetry(env, K.db, JSON.stringify(db));
  return { db, result };
}
async function loadPins(env) {
  const p = await env.KV.get(K.pins, "json");
  return { classes: p?.classes || {}, council: p?.council || {} };
}
async function getSalt(env) {
  let s = await env.KV.get(K.salt);
  if (!s) { s = randomId(24); await env.KV.put(K.salt, s); }
  return s;
}

// ---------------------------------------------------------------------
// 로그인 토큰 (서명된 문자열). 여러 개를 쉼표로 묶어 Authorization: Bearer a,b,c 로 보내요.
function secret(env) { return env.SESSION_SECRET || ("sc-" + (env.ADMIN_PASSWORD || "")); }
async function hmac(env, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return b64url(new Uint8Array(sig));
}
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlText(t) { return b64url(new TextEncoder().encode(t)); }
function unb64urlText(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }
function randomId(n = 16) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); }
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function makeToken(env, scope, pinHash) {
  const payload = b64urlText(JSON.stringify({ sc: scope, v: (pinHash || "").slice(0, 10), exp: Date.now() + TOKEN_HOURS * 3600e3 }));
  return payload + "." + await hmac(env, payload);
}
async function readAuth(request, env) {
  const auth = { teacher: false, classes: new Set(), council: null };
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return auth;
  const tokens = h.slice(7).split(",").map(s => s.trim()).filter(Boolean).slice(0, 20);
  if (!tokens.length) return auth;
  let pins = null;
  for (const t of tokens) {
    const [p, sig] = t.split(".");
    if (!p || !sig || !safeEqual(sig, await hmac(env, p))) continue;
    let d; try { d = JSON.parse(unb64urlText(p)); } catch { continue; }
    if (!d || d.exp < Date.now()) continue;
    if (d.sc === "teacher") { if (env.ADMIN_PASSWORD) auth.teacher = true; continue; }
    pins ||= await loadPins(env);
    const [kind, key] = String(d.sc).split(":");
    const cur = kind === "class" ? pins.classes[key] : kind === "council" ? pins.council[key] : undefined;
    if ((cur || "").slice(0, 10) !== d.v) continue; // 비밀번호가 바뀌면 예전 로그인은 풀려요
    if (kind === "class" && ALL_CLASSES.includes(key)) auth.classes.add(key);
    if (kind === "council" && COUNCIL_ROLES.includes(key)) auth.council = key;
  }
  return auth;
}
function scopeList(a) {
  const s = [];
  if (a.teacher) s.push("teacher");
  a.classes.forEach(c => s.push("class:" + c));
  if (a.council) s.push("council:" + a.council);
  return s;
}
function needTeacher(auth) { if (!auth.teacher) throw new HttpError(403, "교사 로그인이 필요해요."); }

async function login(request, env) {
  const { kind, key, password } = await body(request, 10000);
  const pw = String(password || "");
  if (kind === "teacher") {
    if (!env.ADMIN_PASSWORD) throw new HttpError(500, "ADMIN_PASSWORD 환경변수가 설정되지 않았어요. Cloudflare Pages 설정에서 넣어 주세요.");
    if (!safeEqual(await sha256(pw), await sha256(env.ADMIN_PASSWORD))) { await sleep(600); throw new HttpError(401, "비밀번호가 맞지 않아요."); }
    return json({ token: await makeToken(env, "teacher"), scope: "teacher" });
  }
  if (kind === "class" || kind === "council") {
    const valid = kind === "class" ? ALL_CLASSES.includes(key) : COUNCIL_ROLES.includes(key);
    if (!valid) throw new HttpError(400, "잘못된 대상이에요.");
    const pins = await loadPins(env);
    const stored = (kind === "class" ? pins.classes : pins.council)[key];
    if (stored) {
      const h = await sha256(`${await getSalt(env)}:${kind}:${key}:${pw}`);
      if (!safeEqual(h, stored)) { await sleep(600); throw new HttpError(401, "비밀번호가 맞지 않아요."); }
    }
    return json({ token: await makeToken(env, `${kind}:${key}`, stored), scope: `${kind}:${key}` });
  }
  throw new HttpError(400, "잘못된 요청이에요.");
}

// ---------------------------------------------------------------------
// 읽기: 전체 글 + 비밀번호가 정해진 곳 목록(참/거짓만). 비밀번호 자체는 절대 보내지 않아요.
async function getData(env, auth) {
  const [db, pins] = await Promise.all([loadDb(env), loadPins(env)]);
  const out = {};
  for (const c of COLLECTIONS) out[c] = db.collections[c];
  // 선생님께 보낸 자료는 교사와 보낸 전교임원 본인만 볼 수 있어요.
  if (!auth.teacher) {
    const mine = {};
    for (const [id, d] of Object.entries(out.sends)) if (auth.council && d.from === auth.council) mine[id] = d;
    out.sends = mine;
  }
  const pinStatus = { classes: {}, council: {} };
  for (const k of Object.keys(pins.classes)) pinStatus.classes[k] = true;
  for (const k of Object.keys(pins.council)) pinStatus.council[k] = true;
  return json({ rev: db.rev || 0, collections: out, pinStatus, scopes: scopeList(auth), serverTime: Date.now() });
}

// ---------------------------------------------------------------------
// 쓰기 권한 규칙
function classOpen(pins, cid) { return ALL_CLASSES.includes(cid) && !pins.classes[cid]; }
function classAllowed(auth, pins, cid) { return ALL_CLASSES.includes(cid) && (auth.classes.has(cid) || classOpen(pins, cid)); }

function checkWrite(auth, pins, col, oldDoc, data) {
  if (auth.teacher) return data;
  if (TEACHER_ONLY.has(col)) throw new HttpError(403, "선생님만 쓸 수 있어요.");
  const deny = () => { throw new HttpError(403, "이 곳에 쓸 권한이 없어요. 다시 로그인해 주세요."); };
  switch (col) {
    case "meetings":
    case "exercise":
      if (!classAllowed(auth, pins, data.classId)) deny();
      if (oldDoc && !classAllowed(auth, pins, oldDoc.classId)) deny();
      return data;
    case "activities": {
      const ok = cid => cid === "council" ? !!auth.council : classAllowed(auth, pins, cid);
      if (!ok(data.classId) || (oldDoc && !ok(oldDoc.classId))) deny();
      return data;
    }
    case "suggestions":
      // 건의는 누구나 낼 수 있지만, 고치기·답변은 선생님만 해요.
      if (oldDoc) deny();
      if (!ALL_CLASSES.includes(data.classId)) throw new HttpError(400, "학년과 반을 골라 주세요.");
      return { ...data, status: "new", reply: "" };
    case "agendas":
      if (!auth.council) deny();
      return data;
    case "sends":
      if (oldDoc || !auth.council || data.from !== auth.council) deny();
      return { ...data, status: "new", reply: "" };
  }
  deny();
}

async function putDoc(request, env, auth) {
  const { col, id, data, w } = await body(request);
  if (!COLLECTIONS.includes(col) || !ID_RE.test(String(id || ""))) throw new HttpError(400, "잘못된 주소예요.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "잘못된 내용이에요.");
  const pins = await loadPins(env);

  // 첨부파일은 따로 저장하고 글에는 이름·크기만 남겨요.
  let attachToStore = null;
  if (col === "sends" && data.attach && typeof data.attach.data === "string") {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(data.attach.data);
    if (!m) throw new HttpError(400, "첨부파일을 읽지 못했어요.");
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    if (bytes.length > MAX_ATTACH_BYTES) throw new HttpError(413, "첨부파일이 너무 커요.");
    const attId = randomId(20);
    attachToStore = { attId, bytes, name: String(data.attach.name || "file").slice(0, 200), type: String(data.attach.type || m[1] || "application/octet-stream").slice(0, 100) };
    data.attach = { id: attId, name: attachToStore.name, type: attachToStore.type, size: bytes.length };
  } else if (data.attach && data.attach.data) delete data.attach.data;

  // 안내(notices)의 사진: 여러 장을 따로 저장하고, 누구나 볼 수 있게 표시해요. (안내는 교사만 쓸 수 있어요)
  const imagesToStore = [];
  if (col === "notices" && Array.isArray(data.images)) {
    if (!auth.teacher) throw new HttpError(403, "선생님만 쓸 수 있어요.");
    if (data.images.length > MAX_NOTICE_IMAGES) throw new HttpError(400, `사진은 ${MAX_NOTICE_IMAGES}장까지 올릴 수 있어요.`);
    data.images = data.images.map(img => {
      if (img && typeof img.data === "string") {
        const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(img.data);
        if (!m) throw new HttpError(400, "사진 파일만 올릴 수 있어요.");
        const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        if (bytes.length > MAX_ATTACH_BYTES) throw new HttpError(413, "사진이 너무 커요.");
        const attId = randomId(20);
        const name = String(img.name || "photo.jpg").slice(0, 200);
        imagesToStore.push({ attId, bytes, name, type: m[1] });
        return { id: attId, name, type: m[1], size: bytes.length };
      }
      if (img && ID_RE.test(String(img.id || ""))) return { id: img.id, name: String(img.name || "photo").slice(0, 200), type: String(img.type || "image/jpeg").slice(0, 100), size: Number(img.size) || 0 };
      return null;
    }).filter(Boolean);
  }
  if (col === "notices" && data.links !== undefined) {
    data.links = (Array.isArray(data.links) ? data.links : []).slice(0, 10)
      .map(l => ({ url: String(l?.url || "").trim().slice(0, 500), label: String(l?.label || "").trim().slice(0, 100) }))
      .filter(l => /^https?:\/\//i.test(l.url));
  }

  const text = JSON.stringify(data);
  if (text.length > MAX_DOC_BYTES) throw new HttpError(413, "글이 너무 길어요.");

  const db0 = await loadDb(env);
  const checked = checkWrite(auth, pins, col, db0.collections[col][id], data);
  for (const im of imagesToStore) {
    await env.KV.put(K.att(im.attId), im.bytes, { metadata: { name: im.name, type: im.type, from: "", public: true, size: im.bytes.length } });
  }
  if (attachToStore) {
    await env.KV.put(K.att(attachToStore.attId), attachToStore.bytes, {
      metadata: { name: attachToStore.name, type: attachToStore.type, from: data.from || "", size: attachToStore.bytes.length },
    });
  }
  const stamp = String(w || randomId(10)).slice(0, 40);
  await mutateDb(env, db => {
    const old = db.collections[col][id];
    // 학생이 쓴 글을 다른 사람이 덮어쓰지 못하게 마지막 확인
    checkWrite(auth, pins, col, old, data);
    db.collections[col][id] = { ...checked, _w: stamp };
  });
  return json({ ok: true, w: stamp, attach: data.attach || null, doc: { ...checked, _w: stamp } });
}

async function deleteDoc(request, env, auth) {
  needTeacher(auth);
  const url = new URL(request.url);
  const col = url.searchParams.get("col"), id = url.searchParams.get("id");
  if (!COLLECTIONS.includes(col) || !ID_RE.test(String(id || ""))) throw new HttpError(400, "잘못된 주소예요.");
  await mutateDb(env, db => { delete db.collections[col][id]; });
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// 반·전교임원 비밀번호 (교사만)
async function putPin(request, env, auth) {
  needTeacher(auth);
  const { kind, key, password } = await body(request, 10000);
  const pins = await loadPins(env);
  const bucket = kind === "classes" ? pins.classes : kind === "council" ? pins.council : null;
  const valid = kind === "classes" ? ALL_CLASSES.includes(key) : COUNCIL_ROLES.includes(key);
  if (!bucket || !valid) throw new HttpError(400, "잘못된 대상이에요.");
  const pw = String(password || "").trim();
  if (pw) {
    if (pw.length > 30) throw new HttpError(400, "비밀번호는 30자까지 정할 수 있어요.");
    bucket[key] = await sha256(`${await getSalt(env)}:${kind === "classes" ? "class" : "council"}:${key}:${pw}`);
  } else delete bucket[key];
  await putWithRetry(env, K.pins, JSON.stringify({ ...pins, updatedAt: Date.now() }));
  return json({ ok: true, set: !!pw });
}

// ---------------------------------------------------------------------
// 첨부파일 내려받기 (교사, 또는 보낸 전교임원 본인 / 안내 사진은 누구나)
async function getAttach(id, env, auth) {
  if (!ID_RE.test(id)) throw new HttpError(400, "잘못된 주소예요.");
  const { value, metadata } = await env.KV.getWithMetadata(K.att(id), "arrayBuffer");
  if (!value) throw new HttpError(404, "파일을 찾을 수 없어요.");
  const isPublic = !!metadata?.public;
  if (!isPublic && !auth.teacher && !(auth.council && metadata?.from === auth.council)) throw new HttpError(403, "볼 수 있는 권한이 없어요.");
  const name = metadata?.name || "file";
  return new Response(value, {
    headers: {
      "content-type": metadata?.type || "application/octet-stream",
      "content-disposition": `${isPublic ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": isPublic ? "public, max-age=86400" : "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------
// 백업 (교사만)
function countDocs(collections) { return Object.values(collections || {}).reduce((n, o) => n + Object.keys(o || {}).length, 0); }

async function backupMeta(env, auth) {
  needTeacher(auth);
  return json(await env.KV.get(K.backupMeta, "json") || {});
}
async function backupSave(env, auth) {
  needTeacher(auth);
  const db = await loadDb(env);
  const savedAt = Date.now();
  await putWithRetry(env, K.backup, JSON.stringify({ savedAt, collections: db.collections }));
  const meta = await env.KV.get(K.backupMeta, "json") || {};
  meta.server = { savedAt, docCount: countDocs(db.collections) };
  await putWithRetry(env, K.backupMeta, JSON.stringify(meta));
  return json(meta);
}
async function attachmentIds(collections) {
  const ids = Object.values(collections?.sends || {}).map(d => d?.attach?.id);
  for (const n of Object.values(collections?.notices || {})) for (const im of (n?.images || [])) ids.push(im?.id);
  return ids.filter(id => id && ID_RE.test(id));
}
async function backupFile(env, auth) {
  needTeacher(auth);
  const db = await loadDb(env);
  const attachments = {};
  for (const id of await attachmentIds(db.collections)) {
    const { value, metadata } = await env.KV.getWithMetadata(K.att(id), "arrayBuffer");
    if (!value) continue;
    let s = ""; new Uint8Array(value).forEach(b => s += String.fromCharCode(b));
    attachments[id] = { ...metadata, data: btoa(s) };
  }
  const savedAt = Date.now();
  const meta = await env.KV.get(K.backupMeta, "json") || {};
  meta.file = { savedAt, docCount: countDocs(db.collections) };
  await putWithRetry(env, K.backupMeta, JSON.stringify(meta));
  return json({ app: "student-council", version: 2, savedAt, collections: db.collections, attachments });
}
async function backupRestore(request, env, auth) {
  needTeacher(auth);
  const req = await body(request);
  let src;
  if (req.from === "server") {
    src = await env.KV.get(K.backup, "json");
    if (!src) throw new HttpError(404, "서버에 저장된 백업이 없어요.");
  } else {
    src = req.data;
    if (!src || src.app !== "student-council" || !src.collections) throw new HttpError(400, "학생자치회 백업 파일이 아니에요.");
  }
  const collections = {};
  for (const c of COLLECTIONS) {
    const v = src.collections[c];
    collections[c] = {};
    // 예전(Artifact) 백업 파일은 [{id, data}] 배열 모양이라서 둘 다 받아요.
    if (Array.isArray(v)) v.forEach(d => { if (d && ID_RE.test(String(d.id)) && d.data && typeof d.data === "object") collections[c][d.id] = d.data; });
    else if (v && typeof v === "object") for (const [id, d] of Object.entries(v)) if (ID_RE.test(id) && d && typeof d === "object") collections[c][id] = d;
  }
  // 예전 백업의 첨부파일(글 안에 data로 들어 있던 것)은 따로 꺼내 저장해요.
  for (const d of Object.values(collections.sends)) {
    if (d.attach && typeof d.attach.data === "string") {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(d.attach.data);
      if (m && m[2]) {
        const bytes = Uint8Array.from(atob(m[3]), c => c.charCodeAt(0));
        const attId = randomId(20);
        await env.KV.put(K.att(attId), bytes, { metadata: { name: d.attach.name || "file", type: d.attach.type || m[1], from: d.from || "", size: bytes.length } });
        d.attach = { id: attId, name: d.attach.name || "file", type: d.attach.type || m[1], size: bytes.length };
      } else delete d.attach.data;
    }
  }
  if (src.attachments && typeof src.attachments === "object") {
    for (const [id, a] of Object.entries(src.attachments)) {
      if (!ID_RE.test(id) || !a?.data) continue;
      const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
      await env.KV.put(K.att(id), bytes, { metadata: { name: a.name || "file", type: a.type || "application/octet-stream", from: a.from || "", public: !!a.public, size: bytes.length } });
    }
  }
  // 예전 Artifact 백업에 들어 있던 비밀번호 기록(access)은 형식이 달라서 옮기지 않아요.
  await mutateDb(env, db => { db.collections = collections; });
  return json({ ok: true, docCount: countDocs(collections) });
}
