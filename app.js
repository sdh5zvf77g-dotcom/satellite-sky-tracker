/**
 * SatSky – High-end offline-capable satellite sky tracker
 * Verified SGP4 core • Search • Filters • Pass predictions • IndexedDB cache
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DB_NAME = "satsky-v2";
const STORE = "catalog";

let observer = { lat: 18.7883, lon: 98.9853, alt: 0.3 };
let allSats = [];          // full loaded catalog with satrec
let visible = [];
let filterType = "all";
let minEl = 5;
let searchQ = "";
let dataSource = "bundled";
let updateTimer = null;

/* ---------- IndexedDB helpers ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e);
  });
}
async function saveCatalog(list) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ list, ts: Date.now() }, "latest");
  } catch (_) {}
}
async function loadCachedCatalog() {
  try {
    const db = await openDB();
    return new Promise(res => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("latest");
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch (_) { return null; }
}

/* ---------- Core orbital ---------- */
function buildRecords(rawList) {
  const out = [];
  for (const s of rawList) {
    try {
      const satrec = satellite.twoline2satrec(s.tle1, s.tle2);
      if (satrec && satrec.error === 0) {
        out.push({ ...s, satrec });
      }
    } catch (_) {}
  }
  return out;
}

function lookAngles(satrec, date, obs) {
  try {
    const gmst = satellite.gstime(date);
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const gd = { longitude: obs.lon * DEG2RAD, latitude: obs.lat * DEG2RAD, height: obs.alt };
    const la = satellite.ecfToLookAngles(gd, ecf);
    return {
      az: la.azimuth * RAD2DEG,
      el: la.elevation * RAD2DEG,
      range: la.rangeSat
    };
  } catch (_) { return null; }
}

function azDir(az) {
  const d = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}

/* ---------- Pass prediction (simple next rising) ---------- */
function nextPass(sat, hoursAhead = 12) {
  const now = new Date();
  const step = 60 * 1000; // 1 min
  let lastEl = -90;
  for (let t = 0; t < hoursAhead * 3600 * 1000; t += step) {
    const d = new Date(now.getTime() + t);
    const la = lookAngles(sat.satrec, d, observer);
    if (!la) continue;
    if (lastEl < 0 && la.el >= 10) {
      return { time: d, maxEl: la.el, az: la.az };
    }
    lastEl = la.el;
  }
  return null;
}

/* ---------- UI helpers ---------- */
function setStatus(msg, kind = "info") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + kind;
}
function setSource(src) {
  dataSource = src;
  document.getElementById("source-badge").textContent =
    src === "live" ? "Live data" : src === "cache" ? "Cached" : "Bundled core";
  document.getElementById("source-badge").className = "badge " + (src === "live" ? "online" : "offline");
}

/* ---------- Main update ---------- */
function refreshVisible() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toUTCString().replace("GMT","UTC");

  let list = allSats;
  if (filterType !== "all") list = list.filter(s => s.type === filterType);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || String(s.norad).includes(q));
  }

  visible = [];
  for (const s of list) {
    const la = lookAngles(s.satrec, now, observer);
    if (la && la.el >= minEl) {
      visible.push({ ...s, ...la });
    }
  }
  visible.sort((a, b) => b.el - a.el);

  renderList();
  renderSky();
  document.getElementById("vis-count").textContent = visible.length;
  document.getElementById("total-count").textContent = allSats.length;
}

function renderList() {
  const box = document.getElementById("list");
  if (visible.length === 0) {
    box.innerHTML = `<div class="empty">No satellites above ${minEl}° with current filters.<br>
      Try lowering the elevation filter or clearing search.</div>`;
    return;
  }
  const show = visible.slice(0, 60);
  box.innerHTML = show.map(s => `
    <div class="card" data-norad="${s.norad}">
      <div class="card-top">
        <span class="name">${s.name}</span>
        <span class="type">${s.type}</span>
      </div>
      <div class="metrics">
        <div><span class="lbl">El</span><span class="val">${s.el.toFixed(1)}°</span></div>
        <div><span class="lbl">Az</span><span class="val">${s.az.toFixed(0)}° ${azDir(s.az)}</span></div>
        <div><span class="lbl">Range</span><span class="val">${Math.round(s.range)} km</span></div>
      </div>
    </div>`).join("");
}

function renderSky() {
  const c = document.getElementById("sky");
  const ctx = c.getContext("2d");
  const w = c.width, h = c.height, cx = w/2, cy = h/2, r = Math.min(cx,cy)-16;

  ctx.fillStyle = "#070b14";
  ctx.fillRect(0,0,w,h);

  // elevation rings
  ctx.strokeStyle = "#1a2744";
  ctx.lineWidth = 1;
  [0,30,60,90].forEach(el => {
    const rad = r * (1 - el/90);
    ctx.beginPath(); ctx.arc(cx,cy,rad,0,Math.PI*2); ctx.stroke();
  });

  // cardinals
  ctx.fillStyle = "#6b8cce";
  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy-r-4);
  ctx.fillText("S", cx, cy+r+14);
  ctx.fillText("E", cx+r+11, cy+4);
  ctx.fillText("W", cx-r-11, cy+4);

  // cross
  ctx.beginPath();
  ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy);
  ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r);
  ctx.stroke();

  // sats
  const toShow = visible.slice(0, 40);
  toShow.forEach(s => {
    const rad = r * (1 - s.el/90);
    const x = cx + rad * Math.sin(s.az * DEG2RAD);
    const y = cy - rad * Math.cos(s.az * DEG2RAD);
    const col = s.type === "Space Station" ? "#ff6b6b" :
                s.type === "Starlink" ? "#ffe66d" :
                s.type === "Navigation" ? "#a29bfe" :
                s.type === "Science" || s.type === "Bright" ? "#4ecdc4" : "#74b9ff";
    ctx.beginPath();
    ctx.arc(x,y, s.type==="Space Station"?7:4.5, 0, Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
    if (s.el > 40 || s.type === "Space Station") {
      ctx.fillStyle = "#e8eef8";
      ctx.font = "10px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(s.name.split(/[\s(]/)[0], x+8, y+3);
    }
  });

  // zenith
  ctx.beginPath(); ctx.arc(cx,cy,2.5,0,Math.PI*2);
  ctx.fillStyle = "#fff"; ctx.fill();
}

/* ---------- Pass panel ---------- */
function updatePasses() {
  const key = allSats.filter(s => s.type === "Space Station" || s.name.includes("ISS") || s.name.includes("HST"));
  const box = document.getElementById("passes");
  if (key.length === 0) { box.innerHTML = ""; return; }
  let html = "";
  key.slice(0,4).forEach(s => {
    const p = nextPass(s, 18);
    if (p) {
      const t = p.time.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
      html += `<div class="pass-row"><span class="pn">${s.name}</span>
        <span class="pt">${t}</span>
        <span class="pe">${p.maxEl.toFixed(0)}° ${azDir(p.az)}</span></div>`;
    }
  });
  box.innerHTML = html || "<div class='empty-sm'>No rising passes in the next 18 h for tracked stations.</div>";
}

/* ---------- Loading paths ---------- */
async function loadBundled() {
  setStatus("Loading core catalog…");
  allSats = buildRecords(window.SAT_DATA.BUNDLED);
  setSource("bundled");
  setStatus(`Core ready – ${allSats.length} satellites`);
  refreshVisible();
  updatePasses();
}

async function tryLive() {
  setStatus("Trying live Celestrak data…");
  const groups = ["stations", "visual"];
  let collected = [];
  let ok = 0;
  for (const g of groups) {
    try {
      const info = window.SAT_DATA.groups[g];
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(info.url, { cache: "no-store", mode: "cors", signal: controller.signal });
      clearTimeout(to);
      if (!resp.ok) throw new Error(resp.status);
      const text = await resp.text();
      const parsed = window.SAT_DATA.parseTLE(text, info.type);
      collected = collected.concat(parsed);
      ok++;
    } catch (e) {
      console.warn("Live group failed", g, e);
    }
  }
  if (ok > 0 && collected.length > 5) {
    allSats = buildRecords(collected);
    setSource("live");
    setStatus(`Live data loaded – ${allSats.length} satellites`);
    await saveCatalog(collected);
    refreshVisible();
    updatePasses();
    return true;
  }
  return false;
}

async function tryCache() {
  const cached = await loadCachedCatalog();
  if (cached && cached.list && cached.list.length > 5) {
    allSats = buildRecords(cached.list);
    setSource("cache");
    const age = Math.round((Date.now() - cached.ts) / 3600000);
    setStatus(`Using cached catalog (${age}h old) – ${allSats.length} sats`);
    refreshVisible();
    updatePasses();
    return true;
  }
  return false;
}

/* ---------- Location ---------- */
function getLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: (pos.coords.altitude||0)/1000 };
        document.getElementById("loc").textContent = `${observer.lat.toFixed(3)}°, ${observer.lon.toFixed(3)}°`;
        resolve();
      },
      () => {
        document.getElementById("loc").textContent = "Default (Chiang Mai)";
        resolve();
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
    );
  });
}

/* ---------- Init ---------- */
async function init() {
  // Event bindings
  document.getElementById("search").addEventListener("input", e => {
    searchQ = e.target.value.trim();
    refreshVisible();
  });
  document.getElementById("type-filter").addEventListener("change", e => {
    filterType = e.target.value;
    refreshVisible();
  });
  document.getElementById("el-filter").addEventListener("input", e => {
    minEl = Number(e.target.value);
    document.getElementById("el-val").textContent = minEl + "°";
    refreshVisible();
  });
  document.getElementById("btn-refresh").addEventListener("click", async () => {
    await getLoc();
    refreshVisible();
    updatePasses();
  });
  document.getElementById("btn-live").addEventListener("click", async () => {
    const ok = await tryLive();
    if (!ok) setStatus("Live fetch failed – still using current catalog", "warn");
  });

  await getLoc();

  // Reliable start: bundled core first, then try improve with cache/live
  await loadBundled();
  // Best-effort improvements (non-blocking)
  tryCache().then(ok => { if (ok) refreshVisible(); });
  // Live is available via the button


  updateTimer = setInterval(() => {
    refreshVisible();
  }, 5000);

  // canvas size
  const sky = document.getElementById("sky");
  function size() {
    const s = Math.min(sky.parentElement.clientWidth - 12, 340);
    sky.width = s; sky.height = s;
    renderSky();
  }
  window.addEventListener("resize", size);
  size();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
document.addEventListener("DOMContentLoaded", init);
