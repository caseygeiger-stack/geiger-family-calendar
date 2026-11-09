// Geiger Family Calendar server.
// Serves the web app, stores family data, and fetches Apple Calendar (iCloud .ics) feeds and weather.
// Storage: Postgres when DATABASE_URL is set (e.g. a free Neon database), otherwise a local JSON file
// (good for running on a Raspberry Pi at home).

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const ical = require("node-ical");

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.FAMILY_PASSCODE || "";
const TZ = process.env.FAMILY_TZ || "America/Indiana/Indianapolis";
const COLLECTIONS = new Set(["members", "events", "chores", "meals", "groceries", "school", "countdowns", "board", "feeds", "settings"]);
// Household and weather location come from the environment (set by the Pi installer), so no family details live in the code.
const DEFAULT_LOCATION = process.env.FAMILY_LAT && process.env.FAMILY_LON
  ? { label: process.env.FAMILY_TOWN || "Home", lat: Number(process.env.FAMILY_LAT), lon: Number(process.env.FAMILY_LON) }
  : null;
const PALETTE = ["#f26b6b", "#4f8ff7", "#a879f2", "#3fbf8a", "#f5a524", "#2fc3d1", "#ef6fb4", "#9aa86a"];
const DEFAULT_MEMBERS = String(process.env.FAMILY_MEMBERS || "").split(",").map((n) => n.trim()).filter(Boolean)
  .map((name, i) => [name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "member" + i, name, PALETTE[i % PALETTE.length]]);

if (!PASSCODE) console.warn("FAMILY_PASSCODE is not set: the app is open to anyone with the link.");

// ---------------- Storage ----------------
function makeStore() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false }, max: 3 });
    return {
      async init() {
        await pool.query(`create table if not exists docs (
          collection text not null, id text not null, data jsonb not null,
          updated_at timestamptz not null default now(), primary key (collection, id))`);
      },
      async all() {
        const r = await pool.query("select collection, id, data from docs");
        return r.rows;
      },
      async get(c, id) {
        const r = await pool.query("select data from docs where collection=$1 and id=$2", [c, id]);
        return r.rows[0] ? r.rows[0].data : null;
      },
      async put(c, id, data) {
        await pool.query(`insert into docs (collection, id, data) values ($1,$2,$3)
          on conflict (collection, id) do update set data=excluded.data, updated_at=now()`, [c, id, data]);
      },
      async del(c, id) { await pool.query("delete from docs where collection=$1 and id=$2", [c, id]); },
    };
  }
  const file = process.env.DATA_FILE || path.join(__dirname, "data", "family-data.json");
  let data = {};
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(data));
    fs.renameSync(file + ".tmp", file);
  };
  return {
    async init() { try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; } },
    async all() { return Object.entries(data).flatMap(([c, docs]) => Object.entries(docs).map(([id, d]) => ({ collection: c, id, data: d }))); },
    async get(c, id) { return (data[c] && data[c][id]) || null; },
    async put(c, id, d) { (data[c] ||= {})[id] = d; save(); },
    async del(c, id) { if (data[c]) { delete data[c][id]; save(); } },
  };
}
const store = makeStore();
const BUILD = String(Date.now()); // changes on every restart/update so open screens reload the new app
let version = Date.now(); // bumps on every write so clients can skip unchanged polls

// ---------------- Auth ----------------
const token = PASSCODE ? crypto.createHmac("sha256", PASSCODE).update("geiger-family-calendar").digest("hex") : "";
function readCookie(req, name) {
  const m = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
const TRUST_LOCALHOST = process.env.TRUST_LOCALHOST === "1";
function authed(req) {
  if (!PASSCODE) return true;
  // On the Raspberry Pi the TV's own browser connects over loopback, so it never needs the passcode.
  if (TRUST_LOCALHOST && !req.headers["x-forwarded-for"] && /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || "")) return true;
  const t = readCookie(req, "fam");
  return t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

app.post("/api/login", (req, res) => {
  const given = String((req.body && req.body.passcode) || "");
  const ok = !PASSCODE || (given.length === PASSCODE.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASSCODE)));
  if (!ok) return res.status(401).json({ error: "That passcode isn't right." });
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", `fam=${token}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 5}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "login" })));

// ---------------- Data API ----------------
const validId = (s) => typeof s === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(s);
function checkCol(req, res) {
  if (!COLLECTIONS.has(req.params.col)) { res.status(404).json({ error: "Unknown list" }); return false; }
  if (req.params.id !== undefined && !validId(req.params.id)) { res.status(400).json({ error: "Bad id" }); return false; }
  return true;
}
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out;
}

app.get("/api/state", async (req, res, next) => {
  try {
    if (req.query.since && Number(req.query.since) === version) return res.json({ version, build: BUILD, unchanged: true });
    const rows = await store.all();
    const out = {};
    for (const c of COLLECTIONS) out[c] = [];
    for (const r of rows) if (out[r.collection]) out[r.collection].push({ id: r.id, ...r.data });
    res.json({ version, build: BUILD, tz: TZ, data: out });
  } catch (e) { next(e); }
});
app.post("/api/:col", async (req, res, next) => {
  try {
    if (!checkCol(req, res) || !isObj(req.body)) return res.headersSent || res.status(400).json({ error: "Bad data" });
    const id = crypto.randomBytes(8).toString("hex");
    await store.put(req.params.col, id, req.body); version++;
    res.json({ id, version });
  } catch (e) { next(e); }
});
app.put("/api/:col/:id", async (req, res, next) => {
  try {
    if (!checkCol(req, res) || !isObj(req.body)) return res.headersSent || res.status(400).json({ error: "Bad data" });
    await store.put(req.params.col, req.params.id, req.body); version++;
    if (req.params.col === "feeds" || req.params.col === "settings") clearExternalCache();
    res.json({ version });
  } catch (e) { next(e); }
});
app.patch("/api/:col/:id", async (req, res, next) => {
  try {
    if (!checkCol(req, res) || !isObj(req.body)) return res.headersSent || res.status(400).json({ error: "Bad data" });
    const cur = (await store.get(req.params.col, req.params.id)) || {};
    await store.put(req.params.col, req.params.id, merge(cur, req.body)); version++;
    res.json({ version });
  } catch (e) { next(e); }
});
app.delete("/api/:col/:id", async (req, res, next) => {
  try {
    if (!checkCol(req, res)) return;
    await store.del(req.params.col, req.params.id); version++;
    if (req.params.col === "feeds") clearExternalCache();
    res.json({ version });
  } catch (e) { next(e); }
});

// ---------------- Weather + Apple Calendar feeds ----------------
const cache = new Map();
function clearExternalCache() { cache.clear(); }
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  try { const value = await fn(); cache.set(key, { at: Date.now(), value }); return value; }
  catch (e) { if (hit) return hit.value; throw e; }
}
async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "family-calendar" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function weather() {
  const loc = (await store.get("settings", "location")) || DEFAULT_LOCATION;
  if (!loc) return null;
  return cached("weather:" + loc.lat + "," + loc.lon, 20 * 60 * 1000, async () => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(TZ)}&forecast_days=8`;
    const w = await getJSON(u);
    const days = {};
    w.daily.time.forEach((d, i) => (days[d] = { code: w.daily.weather_code[i], hi: Math.round(w.daily.temperature_2m_max[i]), lo: Math.round(w.daily.temperature_2m_min[i]), rain: w.daily.precipitation_probability_max[i] }));
    return { label: loc.label, now: { temp: Math.round(w.current.temperature_2m), code: w.current.weather_code, isDay: !!w.current.is_day }, days };
  });
}

app.get("/api/geocode", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [] });
  try {
    const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&countryCode=US`);
    res.json({ results: (g.results || []).map((r) => ({ label: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}`, lat: r.latitude, lon: r.longitude })) });
  } catch { res.status(502).json({ error: "Couldn't look that place up right now." }); }
});

// Wall-clock date/time of an instant in the family's time zone.
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function local(d) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const pad = (n) => String(n).padStart(2, "0");
const ymdLocalGetters = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymdUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function occurrence(ev, start, feed, floating) {
  const allDay = start.dateOnly || ev.datetype === "date" || (ev.start && ev.start.dateOnly);
  let date, time = "";
  if (allDay) date = floating ? ymdUTC(start) : ymdLocalGetters(start);
  else if (floating) { date = ymdUTC(start); time = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`; }
  else ({ date, time } = local(start));
  return { title: String(ev.summary && ev.summary.val !== undefined ? ev.summary.val : ev.summary || "Busy"), date, time, who: feed.who ? [feed.who] : [], feed: feed.id, external: true };
}

async function feedEvents(feed) {
  const url = String(feed.url || "").trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) return [];
  return cached("feed:" + url, 15 * 60 * 1000, async () => {
    const r = await fetch(url, { headers: { "User-Agent": "family-calendar" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Calendar link returned ${r.status}`);
    const data = ical.sync.parseICS(await r.text());
    const from = new Date(Date.now() - 2 * 86400000), to = new Date(Date.now() + 45 * 86400000);
    const out = [];
    for (const ev of Object.values(data)) {
      if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
      if (ev.status === "CANCELLED") continue;
      if (!ev.rrule) {
        if (ev.start <= to && (ev.end || ev.start) >= from) out.push(occurrence(ev, ev.start, feed, false));
        continue;
      }
      // rrule.js returns "floating" dates (UTC fields = wall-clock time) when the rule carries a TZID.
      const floating = false; // node-ical returns real instants for TZID rules (DST-adjusted)
      for (const d of ev.rrule.between(new Date(from.getTime() - 86400000), new Date(to.getTime() + 86400000), true)) {
        const key = floating ? ymdUTC(d) : (ev.start.dateOnly ? ymdLocalGetters(d) : local(d).date);
        if (ev.exdate && Object.keys(ev.exdate).some((k) => k.slice(0, 10) === key)) continue;
        const override = ev.recurrences && Object.entries(ev.recurrences).find(([k]) => k.slice(0, 10) === key);
        if (override) { if (override[1].status !== "CANCELLED") out.push(occurrence(override[1], override[1].start, feed, false)); continue; }
        if (ev.start.dateOnly) d.dateOnly = true;
        out.push(occurrence(ev, d, feed, floating));
      }
    }
    return out;
  });
}

app.get("/api/external", async (req, res) => {
  const result = { weather: null, events: [], feedErrors: [] };
  try { result.weather = await weather(); } catch (e) { result.weatherError = "Weather is unavailable right now."; }
  const rows = (await store.all()).filter((r) => r.collection === "feeds");
  await Promise.all(rows.map(async (r) => {
    try { result.events.push(...(await feedEvents({ id: r.id, ...r.data }))); }
    catch (e) { result.feedErrors.push({ id: r.id, name: r.data.name || "Calendar", error: String(e.message || e) }); }
  }));
  res.json(result);
});

// ---------------- Static app ----------------
app.use(express.static(path.join(__dirname, "public"), { maxAge: 0 }));
app.get(["/tv", "/"], (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Something went wrong saving that. Try again." }); });

(async () => {
  await store.init();
  // First run: add the household so the app starts ready to use.
  const existing = (await store.all()).filter((r) => r.collection === "members");
  if (!existing.length) for (const [i, [id, name, color]] of DEFAULT_MEMBERS.entries()) await store.put("members", id, { name, color, order: i + 1 });
  app.listen(PORT, () => console.log(`Family calendar on http://localhost:${PORT}`));
})();
