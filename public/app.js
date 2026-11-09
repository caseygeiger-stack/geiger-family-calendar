(() => {
  const COLORS = ["#4f8ff7", "#f26b6b", "#3fbf8a", "#f5a524", "#a879f2", "#ef6fb4", "#2fc3d1", "#9aa86a"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmtTime = (t) => { if (!t) return "All day"; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${pad(m)}${ap}` : `${h}${ap}`; };
  const isTV = () => location.pathname.replace(/\/$/, "") === "/tv";

  const state = { members: [], events: [], chores: [], meals: {}, note: "", groceries: [], school: [], countdowns: [], feeds: [], location: null, ext: [], weather: null, feedErrors: [], loaded: false };
  let version = 0, build = "";

  // ---------- Server ----------
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    if (r.status === 401) { showLogin(); throw { code: "login" }; }
    if (!r.ok) throw { code: "server", message: (await r.json().catch(() => ({}))).error };
    return r.json();
  }
  const db = {
    add: (col, data) => api("POST", `/api/${col}`, data),
    set: (col, id, data) => api("PUT", `/api/${col}/${encodeURIComponent(id)}`, data),
    update: (col, id, data) => api("PATCH", `/api/${col}/${encodeURIComponent(id)}`, data),
    del: (col, id) => api("DELETE", `/api/${col}/${encodeURIComponent(id)}`),
  };
  function apply(data) {
    const byOrder = (k) => (a, b) => (a[k] || 0) - (b[k] || 0);
    state.members = data.members.slice().sort(byOrder("order"));
    state.events = data.events;
    state.chores = data.chores.slice().sort(byOrder("created"));
    state.meals = Object.fromEntries(data.meals.map((m) => [m.id, m.dinner]));
    state.note = (data.board.find((b) => b.id === "note") || {}).text || "";
    state.groceries = data.groceries;
    state.school = data.school.slice().sort(byOrder("created"));
    state.countdowns = data.countdowns;
    state.feeds = data.feeds;
    state.location = data.settings.find((s) => s.id === "location") || null;
  }
  let failures = 0;
  async function refresh() {
    try {
      const r = await api("GET", `/api/state?since=${version}`);
      failures = 0;
      if (build && r.build && r.build !== build) { location.reload(); return; }
      build = r.build || build;
      if (!r.unchanged) { version = r.version; apply(r.data); state.loaded = true; render(); }
      setStatus("Up to date");
    } catch (e) {
      if (e.code === "login") return;
      if (++failures >= 2) setStatus("Can't reach the calendar right now. Retrying…");
    }
  }
  async function refreshExternal() {
    try {
      const r = await api("GET", "/api/external");
      state.ext = r.events || []; state.weather = r.weather; state.feedErrors = r.feedErrors || [];
      render();
    } catch (_) {}
  }
  async function write(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await refresh(); return true; }
    catch (e) { if (e.code !== "login") toast(e.message || "That didn't save. Check the connection and try again."); return false; }
  }

  // ---------- Helpers ----------
  const memberMap = () => Object.fromEntries(state.members.map((m) => [m.id, m]));
  function eventsOn(dateStr) {
    const wd = parse(dateStr).getDay();
    const mine = state.events.filter((e) => e.date === dateStr || (e.weekly && dateStr >= e.date && parse(e.date).getDay() === wd));
    const ext = state.ext.filter((e) => e.date === dateStr);
    return mine.concat(ext).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }
  const choresOn = (dateStr) => state.chores.filter((c) => !c.days || !c.days.length || c.days.includes(parse(dateStr).getDay()));
  const schoolOn = (dateStr) => state.school.filter((x) => (x.days || []).includes(parse(dateStr).getDay()));
  const daysUntil = (ds) => Math.round((parse(ds) - parse(ymd(new Date()))) / 86400000);
  function wxIcon(code, isDay = true) {
    if (code === 0) return isDay ? "☀️" : "🌙";
    if (code <= 2) return isDay ? "🌤️" : "☁️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code >= 51 && code <= 67) return "🌧️";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄️";
    if (code >= 80 && code <= 82) return "🌦️";
    if (code >= 95) return "⛈️";
    return "🌡️";
  }

  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }
  function setStatus(msg) { $("syncline").textContent = msg; $("tvStatus").textContent = msg === "Up to date" ? "" : msg; }

  // ---------- TV ----------
  function renderClock() {
    const n = new Date(); let h = n.getHours(); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
    $("tvClock").innerHTML = `${h}:${pad(n.getMinutes())}<span class="ampm">${ap}</span>`;
    $("tvDate").textContent = `${DOW_LONG[n.getDay()]}, ${MON[n.getMonth()]} ${n.getDate()}`;
  }
  const tags = (ids, mm) => (ids || []).map((id) => mm[id]).filter(Boolean)
    .map((m) => `<span class="tag" style="--c:${esc(m.color)}">${esc(m.name)}</span>`).join("");

  function renderTV() {
    const mm = memberMap(), today = new Date(), T = ymd(today), w = state.weather;
    renderClock();
    const wt = w && w.days[T];
    $("tvWx").innerHTML = w && w.now ? `<span class="ico">${wxIcon(w.now.code, w.now.isDay)}</span><span class="temp tabular">${w.now.temp}°</span>${wt ? `<span class="hl tabular">High ${wt.hi}°<br>Low ${wt.lo}°${wt.rain >= 30 ? `<br>${wt.rain}% rain` : ""}</span>` : ""}` : "";
    $("tvNote").hidden = !state.note; $("tvNoteText").textContent = state.note || "";
    const cds = state.countdowns.filter((c) => daysUntil(c.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
    $("tvCount").innerHTML = cds.map((c) => { const n = daysUntil(c.date); return `<div class="cd"><span class="num tabular">${n === 0 ? "🎉" : n}</span><span class="what">${n === 0 ? "Today: " : n === 1 ? "day until " : "days until "}${esc(c.title)}</span></div>`; }).join("");
    const groc = state.groceries.filter((g) => !g.done).sort((a, b) => (a.created || 0) - (b.created || 0));
    $("tvGroc").innerHTML = `<span class="lbl">Grocery list${groc.length ? ` · ${groc.length}` : ""}</span>${groc.length ? `<div class="items">${groc.slice(0, 18).map((g) => `<span class="gi">${esc(g.item)}</span>`).join("")}${groc.length > 18 ? `<span class="gi quiet">+${groc.length - 18} more</span>` : ""}</div>` : `<div class="quiet">Nothing on the list.</div>`}`;

    const evs = eventsOn(T), chores = choresOn(T), sc = schoolOn(T);
    $("tvToday").innerHTML = `
      <h2>Today</h2>
      <div>${evs.length ? evs.map((e) => `<div class="ev"><span class="t tabular">${fmtTime(e.time)}</span><span class="n">${esc(e.title)}</span><div class="who">${tags(e.who, mm)}</div></div>`).join("") : `<div class="quiet">Nothing on the calendar today.</div>`}</div>
      ${sc.length ? `<div><span class="lbl">School today</span><div class="school">${sc.map((x) => `<div>${tags([x.who], mm)}<span>${esc(x.text)}</span></div>`).join("")}</div></div>` : ""}
      <div><span class="lbl">Dinner tonight</span><div class="dinner">${state.meals[T] ? esc(state.meals[T]) : `<span class="quiet">Not planned yet</span>`}</div></div>
      ${chores.length ? `<div><span class="lbl">Chores</span><div class="chorelist">${chores.map((c) => {
        const m = mm[c.who], done = !!(c.done && c.done[T]);
        return `<button type="button" class="chore${done ? " done" : ""}" data-chore="${esc(c.id)}" style="--c:${esc(m ? m.color : "#93a0b5")}"><span class="box">${done ? "✓" : ""}</span><span class="cn">${esc(c.title)}${m ? ` <span class="quiet">· ${esc(m.name)}</span>` : ""}</span></button>`;
      }).join("")}</div></div>` : ""}`;
    let week = "";
    for (let i = 1; i <= 6; i++) {
      const d = addDays(today, i), ds = ymd(d), list = eventsOn(ds), dw = w && w.days[ds];
      week += `<div class="day"><div><div class="dn">${i === 1 ? "Tomorrow" : DOW[d.getDay()]}</div><div class="dd">${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}</div>${dw ? `<div class="dwx tabular">${wxIcon(dw.code)} ${dw.hi}° / ${dw.lo}°</div>` : ""}</div>
        ${list.length ? list.map((e) => { const c = (e.who || []).map((id) => mm[id]).filter(Boolean); return `<div class="mini${e.external ? " ext" : ""}" style="--c:${esc(c.length === 1 ? c[0].color : c.length ? "#ffc857" : "#93a0b5")}"><div class="t tabular">${fmtTime(e.time)}</div><div class="n">${esc(e.title)}</div></div>`; }).join("") : `<div class="quiet">Free day</div>`}
        <div class="meal"><span class="lbl">Dinner</span>${state.meals[ds] ? esc(state.meals[ds]) : `<span class="quiet">—</span>`}</div></div>`;
    }
    $("tvWeek").innerHTML = week;
  }
  $("tvToday").addEventListener("click", (e) => { const b = e.target.closest("[data-chore]"); if (b) toggleChore(b.dataset.chore); });

  // ---------- Edit ----------
  let evWho = new Set(), chDays = new Set(), scDays = new Set(), memColor = COLORS[0];
  function renderEdit() {
    const s = state, mm = memberMap(), T = ymd(new Date());
    $("feedBanner").hidden = !s.feedErrors.length;
    $("feedBanner").textContent = s.feedErrors.length ? `Couldn't load ${s.feedErrors.map((f) => f.name).join(", ")}. Check the link under Settings.` : "";
    const memOpts = s.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
    $("evWho").innerHTML = s.members.length ? s.members.map((m) => `<button type="button" class="chip" data-who="${esc(m.id)}" aria-pressed="${evWho.has(m.id)}" style="--c:${esc(m.color)}"><span class="dot" style="--c:${esc(m.color)}"></span>${esc(m.name)}</button>`).join("") : `<span class="empty">Add family members to tag who's involved.</span>`;
    keepSelect("chWho", `<option value="">Anyone</option>` + memOpts);
    keepSelect("scWho", memOpts);
    keepSelect("feedWho", `<option value="">Whole family</option>` + memOpts);
    $("chDays").innerHTML = DOW.map((d, i) => `<button type="button" class="chip" data-day="${i}" aria-pressed="${chDays.has(i)}">${d}</button>`).join("");
    $("scDays").innerHTML = DOW.map((d, i) => `<button type="button" class="chip" data-sday="${i}" aria-pressed="${scDays.has(i)}">${d}</button>`).join("");

    let html = "";
    for (let i = 0; i < 30; i++) {
      const ds = ymd(addDays(new Date(), i)), list = eventsOn(ds);
      if (!list.length) continue;
      const d = parse(ds);
      html += `<div class="dayhead">${i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${DOW_LONG[d.getDay()]}, ${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}`}</div>`;
      html += list.map((e) => {
        const who = (e.who || []).map((id) => mm[id] && esc(mm[id].name)).filter(Boolean).join(", ");
        const feed = e.external && s.feeds.find((f) => f.id === e.feed);
        return `<div class="item"><div class="grow"><div><b>${esc(e.title)}</b></div><div class="meta tabular">${fmtTime(e.time)}${e.weekly ? " · every week" : ""}${who ? " · " + who : ""}${feed ? ` · from ${esc(feed.name)}` : ""}</div></div>${e.external ? "" : `<button class="btn small danger" type="button" data-delev="${esc(e.id)}">Delete</button>`}</div>`;
      }).join("");
    }
    $("evList").innerHTML = html || `<div class="empty">No events in the next 30 days. Add one above.</div>`;

    const todays = choresOn(T);
    $("chToday").innerHTML = todays.length ? todays.map((c) => { const done = !!(c.done && c.done[T]); const m = mm[c.who]; return `<div class="item"><button class="check" type="button" aria-pressed="${done}" aria-label="Mark ${esc(c.title)} done" data-togg="${esc(c.id)}">${done ? "✓" : ""}</button><div class="grow">${esc(c.title)}<div class="meta">${m ? esc(m.name) : "Anyone"}</div></div></div>`; }).join("") : `<div class="empty">No chores due today.</div>`;
    $("chAll").innerHTML = s.chores.length ? s.chores.map((c) => { const m = mm[c.who]; return `<div class="item"><span class="dot" style="--c:${esc(m ? m.color : "#93a0b5")}"></span><div class="grow">${esc(c.title)}<div class="meta">${m ? esc(m.name) : "Anyone"} · ${c.days && c.days.length ? c.days.slice().sort().map((d) => DOW[d]).join(", ") : "Every day"}</div></div><button class="btn small danger" type="button" data-delch="${esc(c.id)}">Delete</button></div>`; }).join("") : `<div class="empty">No chores yet.</div>`;

    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.meal;
    $("mealList").innerHTML = Array.from({ length: 7 }, (_, i) => { const d = addDays(new Date(), i), ds = ymd(d); return `<div class="mealrow"><label class="d" for="meal-${ds}">${i === 0 ? "Tonight" : DOW_LONG[d.getDay()]}</label><input type="text" id="meal-${ds}" data-meal="${ds}" value="${esc(focused === ds ? document.activeElement.value : s.meals[ds] || "")}" placeholder="What's for dinner?"></div>`; }).join("");
    if (focused) { const el = $("meal-" + focused); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }

    const gs = s.groceries.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.created || 0) - (b.created || 0));
    $("grList").innerHTML = gs.length ? gs.map((g) => `<div class="item"><button class="check" type="button" aria-pressed="${!!g.done}" aria-label="Got ${esc(g.item)}" data-grt="${esc(g.id)}">${g.done ? "✓" : ""}</button><div class="grow" style="${g.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(g.item)}</div></div>`).join("") : `<div class="empty">The list is empty.</div>`;
    $("grClear").hidden = !s.groceries.some((g) => g.done);

    $("scList").innerHTML = s.school.length ? s.school.map((x) => { const m = mm[x.who]; return `<div class="item"><span class="dot" style="--c:${esc(m ? m.color : "#93a0b5")}"></span><div class="grow">${esc(x.text)}<div class="meta">${m ? esc(m.name) : ""} · ${(x.days || []).slice().sort().map((d) => DOW[d]).join(", ")}</div></div><button class="btn small danger" type="button" data-delsc="${esc(x.id)}">Delete</button></div>`; }).join("") : `<div class="empty">Nothing yet. Add things like library day or early release.</div>`;
    const cl = s.countdowns.slice().sort((a, b) => a.date.localeCompare(b.date));
    $("cdList").innerHTML = cl.length ? cl.map((c) => { const n = daysUntil(c.date); return `<div class="item"><div class="grow"><b>${esc(c.title)}</b><div class="meta tabular">${n < 0 ? "Passed" : n === 0 ? "Today!" : `${n} day${n === 1 ? "" : "s"} to go`}</div></div><button class="btn small danger" type="button" data-delcd="${esc(c.id)}">Delete</button></div>`; }).join("") : `<div class="empty">No countdowns yet.</div>`;

    $("memColors").innerHTML = COLORS.map((c) => `<button type="button" class="sw" style="--c:${c}" data-color="${c}" aria-pressed="${c === memColor}" aria-label="Color ${c}"></button>`).join("");
    $("memList").innerHTML = s.members.length ? s.members.map((m) => `<div class="item"><span class="dot" style="--c:${esc(m.color)}"></span><div class="grow"><b>${esc(m.name)}</b></div><button class="btn small danger" type="button" data-delmem="${esc(m.id)}">Remove</button></div>`).join("") : `<div class="empty">Nobody added yet.</div>`;
    if (document.activeElement !== $("noteText")) $("noteText").value = s.note || "";

    $("feedList").innerHTML = s.feeds.map((f) => { const m = mm[f.who]; const err = s.feedErrors.find((x) => x.id === f.id); return `<div class="item"><span class="dot" style="--c:${esc(m ? m.color : "#ffc857")}"></span><div class="grow"><b>${esc(f.name)}</b><div class="meta">${m ? esc(m.name) : "Whole family"}${err ? ` · <span class="err">Couldn't load: ${esc(err.error)}</span>` : ""}</div></div><button class="btn small danger" type="button" data-delfeed="${esc(f.id)}">Remove</button></div>`; }).join("");
    const w = s.weather;
    const place = (s.location && s.location.label) || (w && w.label);
    $("locNow").textContent = place ? `Showing weather for ${place}.` : "No weather location yet. Search for your town below.";
  }
  function keepSelect(id, html) { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some((o) => o.value === v)) el.value = v; }

  $("tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", b === t));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
  });
  let locResults = [];
  document.addEventListener("click", (e) => {
    const t = e.target;
    const w = t.closest("[data-who]"); if (w) { const id = w.dataset.who; evWho.has(id) ? evWho.delete(id) : evWho.add(id); w.setAttribute("aria-pressed", evWho.has(id)); return; }
    const d = t.closest("[data-day]"); if (d) { const i = +d.dataset.day; chDays.has(i) ? chDays.delete(i) : chDays.add(i); d.setAttribute("aria-pressed", chDays.has(i)); return; }
    const sd = t.closest("[data-sday]"); if (sd) { const i = +sd.dataset.sday; scDays.has(i) ? scDays.delete(i) : scDays.add(i); sd.setAttribute("aria-pressed", scDays.has(i)); return; }
    const c = t.closest("[data-color]"); if (c) { memColor = c.dataset.color; document.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", b === c)); return; }
    const del = [["delev", "events", "Event deleted"], ["delch", "chores", "Chore deleted"], ["delmem", "members", "Removed"], ["delsc", "school", "Deleted"], ["delcd", "countdowns", "Deleted"], ["delfeed", "feeds", "Calendar removed"]];
    for (const [attr, col, msg] of del) { const b = t.closest(`[data-${attr}]`); if (b) { write(() => db.del(col, b.dataset[attr]), msg).then(() => col === "feeds" && refreshExternal()); return; } }
    const tg = t.closest("[data-togg]"); if (tg) { toggleChore(tg.dataset.togg); return; }
    const gt = t.closest("[data-grt]"); if (gt) { const g = state.groceries.find((x) => x.id === gt.dataset.grt); if (g) write(() => db.update("groceries", g.id, { done: !g.done })); return; }
    const lr = t.closest("[data-loc]"); if (lr) { const r = locResults[+lr.dataset.loc]; write(() => db.set("settings", "location", r), `Weather set to ${r.label}`).then(() => { $("locResults").innerHTML = ""; refreshExternal(); }); return; }
  });
  function toggleChore(id) {
    const c = state.chores.find((x) => x.id === id); if (!c) return;
    const T = ymd(new Date()), now = !(c.done && c.done[T]);
    write(() => db.update("chores", id, { done: { [T]: now } }), now ? "Nice work!" : null);
  }
  const onSubmit = (id, fn) => $(id).addEventListener("submit", (e) => { e.preventDefault(); fn(); });
  onSubmit("evForm", async () => {
    const title = $("evTitle").value.trim(), date = $("evDate").value; if (!title || !date) return;
    if (await write(() => db.add("events", { title, date, time: $("evTime").value || "", who: [...evWho], weekly: $("evWeekly").checked, created: Date.now() }), "Added to the calendar")) {
      $("evTitle").value = ""; $("evTime").value = ""; $("evWeekly").checked = false; evWho = new Set(); renderEdit();
    }
  });
  onSubmit("chForm", async () => {
    const title = $("chTitle").value.trim(); if (!title) return;
    if (await write(() => db.add("chores", { title, who: $("chWho").value, days: [...chDays].sort(), done: {}, created: Date.now() }), "Chore added")) { $("chTitle").value = ""; chDays = new Set(); renderEdit(); }
  });
  onSubmit("memForm", async () => {
    const name = $("memName").value.trim(); if (!name) return;
    if (await write(() => db.add("members", { name, color: memColor, order: Date.now() }), `${name} added`)) { $("memName").value = ""; }
  });
  onSubmit("grForm", async () => {
    const item = $("grItem").value.trim(); if (!item) return;
    if (await write(() => db.add("groceries", { item, done: false, created: Date.now() }))) { $("grItem").value = ""; $("grItem").focus(); }
  });
  $("grClear").addEventListener("click", async () => {
    for (const g of state.groceries.filter((x) => x.done)) if (!(await write(() => db.del("groceries", g.id)))) break;
  });
  onSubmit("scForm", async () => {
    const text = $("scText").value.trim(); if (!text) return;
    if (!scDays.size) { toast("Pick at least one day"); return; }
    if (await write(() => db.add("school", { who: $("scWho").value, text, days: [...scDays].sort(), created: Date.now() }), "Added")) { $("scText").value = ""; scDays = new Set(); renderEdit(); }
  });
  onSubmit("cdForm", async () => {
    const title = $("cdTitle").value.trim(), date = $("cdDate").value; if (!title || !date) return;
    if (await write(() => db.add("countdowns", { title, date }), "Countdown added")) { $("cdTitle").value = ""; $("cdDate").value = ""; }
  });
  $("mealList").addEventListener("change", (e) => {
    const ds = e.target.dataset.meal; if (!ds) return;
    const v = e.target.value.trim();
    if ((state.meals[ds] || "") === v) return;
    write(() => (v ? db.set("meals", ds, { dinner: v }) : db.del("meals", ds)), "Dinner saved");
  });
  onSubmit("noteForm", () => write(() => db.set("board", "note", { text: $("noteText").value.trim() }), "Note posted"));
  $("noteClear").addEventListener("click", () => { $("noteText").value = ""; write(() => db.set("board", "note", { text: "" }), "Note cleared"); });
  onSubmit("feedForm", async () => {
    const name = $("feedName").value.trim(), url = $("feedUrl").value.trim();
    if (!/^(webcal|https):\/\//i.test(url)) { toast("Paste the link that starts with webcal://"); return; }
    if (await write(() => db.add("feeds", { name, url, who: $("feedWho").value }), "Calendar added")) { $("feedName").value = ""; $("feedUrl").value = ""; refreshExternal(); }
  });
  onSubmit("locForm", async () => {
    const q = $("locQ").value.trim(); if (!q) return;
    try {
      const r = await api("GET", `/api/geocode?q=${encodeURIComponent(q)}`);
      locResults = r.results;
      $("locResults").innerHTML = locResults.length ? locResults.map((x, i) => `<div class="item"><div class="grow">${esc(x.label)}</div><button class="btn small" type="button" data-loc="${i}">Use this</button></div>`).join("") : `<div class="empty">No matches. Try just the town name.</div>`;
    } catch (e) { if (e.code !== "login") toast(e.message || "Couldn't search right now."); }
  });

  // ---------- Login ----------
  let started = false;
  function showLogin() { $("login").hidden = false; setTimeout(() => $("pass").focus(), 50); }
  onSubmit("loginForm", async () => {
    $("loginErr").hidden = true;
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: $("pass").value }) });
    if (!r.ok) { $("loginErr").textContent = "That passcode isn't right. Try again."; $("loginErr").hidden = false; return; }
    $("login").hidden = true; $("pass").value = ""; start();
  });

  // ---------- Views ----------
  let wake = null;
  async function keepAwake() { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (_) {} }
  function render() { if (!state.loaded) return; isTV() ? renderTV() : renderEdit(); }
  function route() {
    const tv = isTV();
    $("tv").hidden = !tv; $("edit").hidden = tv;
    document.title = tv ? "Family board" : "Geiger Family Calendar";
    if (tv) keepAwake();
    render();
  }
  $("toTv").addEventListener("click", () => { history.pushState(null, "", "/tv"); route(); });
  $("tvEdit").addEventListener("click", () => { history.pushState(null, "", "/"); route(); });
  window.addEventListener("popstate", route);
  $("tvFull").addEventListener("click", async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); } catch (_) {} keepAwake(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if (isTV()) keepAwake(); refresh(); } });
  let barT;
  document.addEventListener("pointermove", () => { if (!isTV()) return; $("tv").classList.add("show-bar"); clearTimeout(barT); barT = setTimeout(() => $("tv").classList.remove("show-bar"), 4000); });

  let lastDay = ymd(new Date());
  function start() {
    if (started) { refresh(); refreshExternal(); return; }
    started = true;
    refresh(); refreshExternal();
    setInterval(refresh, 8000);
    setInterval(refreshExternal, 10 * 60 * 1000);
    setInterval(() => {
      const d = ymd(new Date());
      if (d !== lastDay) { lastDay = d; render(); refreshExternal(); }
      else if (isTV()) renderClock();
    }, 15000);
  }
  $("evDate").value = ymd(new Date());
  route();
  start();
})();
