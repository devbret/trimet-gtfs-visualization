const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView(
  [45.52, -122.67],
  12,
);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

const playBtn = document.getElementById("playpause");
const timeInp = document.getElementById("time");
const speedSel = document.getElementById("speed");
const trailSel = document.getElementById("trailSeconds");
const timeLbl = document.getElementById("timeLabel");

const statActive = document.getElementById("statActive");
const statTripsHour = document.getElementById("statTripsHour");
const statPercent = document.getElementById("statPercent");
const statHourWindow = document.getElementById("statHourWindow");
const statRoutesLive = document.getElementById("statRoutesLive");
const clearSpotlightBtn = document.getElementById("clearSpotlight");
const windowStartLbl = document.getElementById("windowStart");
const windowEndLbl = document.getElementById("windowEnd");

let START_HOUR = 9;
let END_HOUR = 18;
let START_SEC = START_HOUR * 3600;
let END_SEC_EXCL = END_HOUR * 3600;
let END_SEC = END_SEC_EXCL - 1;

function applyWindow(win) {
  if (win && Number.isFinite(win.start_hour) && Number.isFinite(win.end_hour)) {
    START_HOUR = win.start_hour | 0;
    END_HOUR = win.end_hour | 0;
  }
  START_SEC = START_HOUR * 3600;
  END_SEC_EXCL = END_HOUR * 3600;
  END_SEC = END_SEC_EXCL - 1;

  timeInp.min = START_SEC;
  timeInp.max = END_SEC;
  if (+timeInp.value < START_SEC) timeInp.value = START_SEC;
  if (+timeInp.value > END_SEC) timeInp.value = END_SEC;

  timeInp.style.setProperty("--hours", END_HOUR - START_HOUR);
  windowStartLbl.textContent = fmt(START_SEC).slice(0, 5);
  windowEndLbl.textContent = fmt(END_SEC).slice(0, 5);
}

applyWindow(null);

let isPlaying = false;
let simTime = +timeInp.value;
let lastRAF = null,
  lastTick = null;

function fmt(sec) {
  sec = Math.max(0, Math.min(86399, Math.floor(sec)));
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
function currentHour(t) {
  return Math.floor(t / 3600);
}
function fmtHourWindow(h) {
  const start = h * 3600;
  const end = start + 3599;
  return `${fmt(start).slice(0, 5)}-${fmt(end).slice(0, 5)}`;
}

function setSimTime(t) {
  const prevTime = simTime;
  const prevHour = currentHour(simTime);
  simTime = Math.max(START_SEC, Math.min(END_SEC, t));
  const nextHour = currentHour(simTime);

  timeInp.value = Math.floor(simTime);
  timeLbl.textContent = fmt(simTime);
  timeInp.style.setProperty(
    "--progress",
    `${((simTime - START_SEC) / (END_SEC - START_SEC)) * 100}%`,
  );

  if (simTime < prevTime) resetTrails();

  if (nextHour !== prevHour) {
    rebuildLayersForHour(nextHour);
  }
  renderVehicles();

  if (simTime >= END_SEC) {
    isPlaying = false;
    setPlayingUI(false);
    stopLoop();
  }
}

function setPlayingUI(playing) {
  playBtn.classList.toggle("playing", playing);
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

timeInp.addEventListener("input", () => setSimTime(+timeInp.value));
playBtn.addEventListener("click", () => {
  if (!isPlaying && simTime >= END_SEC) {
    setSimTime(START_SEC);
  }
  isPlaying = !isPlaying;
  setPlayingUI(isPlaying);
  if (isPlaying) startLoop();
  else stopLoop();
});

function startLoop() {
  lastTick = performance.now();
  lastRAF = requestAnimationFrame(tick);
}
function stopLoop() {
  if (lastRAF) cancelAnimationFrame(lastRAF);
  lastRAF = null;
  lastTick = null;
}
function tick(ts) {
  const speed = +speedSel.value;
  if (lastTick != null) {
    const dt = (ts - lastTick) / 1000;
    setSimTime(simTime + dt * speed);
  }
  lastTick = ts;
  lastRAF = requestAnimationFrame(tick);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function varintDecode(bytes, idxRef) {
  let x = 0,
    s = 0;
  while (idxRef.i < bytes.length) {
    const b = bytes[idxRef.i++];
    x |= (b & 0x7f) << s;
    if ((b & 0x80) === 0) break;
    s += 7;
  }
  return x >>> 0;
}
function zigzagDecode(u) {
  return (u >>> 1) ^ -(u & 1);
}
function unpackStream(b64) {
  const bytes = b64ToBytes(b64);
  const out = [];
  const idx = { i: 0 };
  let prev = 0;
  while (idx.i < bytes.length) {
    const u = varintDecode(bytes, idx);
    const dz = zigzagDecode(u);
    const v = prev + dz;
    out.push(v);
    prev = v;
  }
  return out;
}
function interp(a, b, t) {
  return a + (b - a) * t;
}

function findActiveSegment(t0, t1, time) {
  let lo = 0,
    hi = t0.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t0[mid] <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 && time <= t1[ans] ? ans : -1;
}

let ROUTES = {};
let Q = 50000;
let spotlightRoute = null;

function panelColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 110) {
    const k = ((110 - lum) / 110) * 0.6;
    r = Math.round(r + (255 - r) * k);
    g = Math.round(g + (255 - g) * k);
    b = Math.round(b + (255 - b) * k);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

const HOUR_CACHE = new Map();
let CURRENT_HOUR = null;

const TRAIL_CHUNKS = 5;

let markers = [];
let trailData = [];
let trailPolys = [];

fetch("all_trips.json")
  .then((r) => {
    if (!r.ok) {
      throw new Error(`Failed to load all_trips.json (HTTP ${r.status})`);
    }
    return r.json();
  })
  .then((bundle) => {
    ROUTES = bundle.routes || {};
    Q = bundle.meta && bundle.meta.q ? bundle.meta.q : Q;
    applyWindow(bundle.meta && bundle.meta.window);

    const tb = Array.isArray(bundle.trips_by_hour) ? bundle.trips_by_hour : [];

    for (const entry of tb) {
      const h = entry.hour | 0;
      const trips = entry.trips || [];

      for (const trip of trips) {
        const sp = trip.segments_packed;
        if (!sp) continue;

        const T = unpackStream(sp.t);
        const P = unpackStream(sp.p);
        const n = sp.n | 0;

        const t0 = new Int32Array(n);
        const t1 = new Int32Array(n);
        const lat0 = new Int32Array(n);
        const lon0 = new Int32Array(n);
        const lat1 = new Int32Array(n);
        const lon1 = new Int32Array(n);

        for (let j = 0; j < n; j++) {
          t0[j] = T[2 * j];
          t1[j] = T[2 * j + 1];
          lat0[j] = P[4 * j];
          lon0[j] = P[4 * j + 1];
          lat1[j] = P[4 * j + 2];
          lon1[j] = P[4 * j + 3];
        }
        trip._seg = { t0, t1, lat0, lon0, lat1, lon1 };
      }

      HOUR_CACHE.set(h, { trips });
    }

    setSimTime(START_SEC);
    const h0 = currentHour(simTime);
    rebuildLayersForHour(h0);
    renderVehicles();
  })
  .catch((err) => {
    console.error(err);
    statRoutesLive.innerHTML =
      '<div class="subtle">Could not load all_trips.json. Run app.py to generate it, then reload.</div>';
  });

function clearLayers() {
  for (const m of markers) map.removeLayer(m);
  for (const polys of trailPolys) {
    if (polys) for (const p of polys) map.removeLayer(p);
  }
  markers = [];
  trailPolys = [];
  trailData = [];
}

function resetTrails() {
  for (let i = 0; i < trailData.length; i++) trailData[i] = [];
  for (const polys of trailPolys) {
    if (polys) for (const p of polys) p.setLatLngs([]);
  }
}

function ensureTrailPolys(i, col) {
  if (trailPolys[i]) return trailPolys[i];
  const polys = [];
  for (let c = 0; c < TRAIL_CHUNKS; c++) {
    const alpha = (c + 1) / TRAIL_CHUNKS;
    polys.push(
      L.polyline([], { weight: 3, opacity: 0.2 * alpha, color: col }).addTo(
        map,
      ),
    );
  }
  trailPolys[i] = polys;
  return polys;
}

function rebuildLayersForHour(h) {
  const prevEntry = CURRENT_HOUR != null ? HOUR_CACHE.get(CURRENT_HOUR) : null;
  const prevTrails = new Map();
  if (prevEntry) {
    prevEntry.trips.forEach((trip, i) => {
      if (trailData[i] && trailData[i].length) {
        prevTrails.set(trip.trip_id, trailData[i]);
      }
    });
  }

  CURRENT_HOUR = h;
  clearLayers();
  const entry = HOUR_CACHE.get(h);
  if (!entry) return;
  const trips = entry.trips;

  markers = trips.map((trip) => {
    const r = ROUTES[trip.route_id] || {};
    const col = r.color || "#084C8D";
    const m = L.circleMarker([0, 0], {
      radius: 4,
      weight: 1,
      opacity: 0,
      fillOpacity: 0,
      color: col,
      fillColor: col,
    }).addTo(map);

    m.bindTooltip(
      () => {
        const rname = r.short_name ? `${r.short_name} - ` : "";
        return `${rname}${trip.headsign || ""}<br>Trip ${trip.trip_id}`;
      },
      { sticky: true },
    );
    return m;
  });

  trailData = trips.map((trip) => prevTrails.get(trip.trip_id) || []);
  trailPolys = trips.map(() => null);

  statHourWindow.textContent = fmtHourWindow(h);
}

const STATS_INTERVAL_MS = 250;
let statsLastApplied = 0;
let statsPending = null;
let statsTimer = null;

function updateActivity(stats) {
  statsPending = stats;
  const elapsed = performance.now() - statsLastApplied;
  if (elapsed >= STATS_INTERVAL_MS) {
    applyActivity();
  } else if (!statsTimer) {
    statsTimer = setTimeout(applyActivity, STATS_INTERVAL_MS - elapsed);
  }
}

function applyActivity() {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  statsLastApplied = performance.now();
  if (!statsPending) return;
  const { activeCount, tripsCount, byRoute } = statsPending;

  statActive.textContent = activeCount;
  statTripsHour.textContent = tripsCount;
  const pct = tripsCount > 0 ? (activeCount / tripsCount) * 100 : 0;
  statPercent.textContent = `${pct.toFixed(1)}%`;

  clearSpotlightBtn.hidden = spotlightRoute == null;

  statRoutesLive.innerHTML = "";
  const entries = Object.entries(byRoute);
  entries.sort((a, b) => b[1] - a[1]);

  const topN = 12;
  const top = entries.slice(0, topN);
  const maxCount = top.length ? top[0][1] : 0;

  for (const [rid, count] of top) {
    const r = ROUTES[rid] || {};
    const col = panelColor(r.color || "#084C8D");
    const short = r.short_name || rid;

    const row = document.createElement("div");
    row.className = "route-row";
    row.dataset.rid = rid;
    if (spotlightRoute != null) {
      row.classList.add(rid === spotlightRoute ? "spotlit" : "dimmed");
    }
    row.title =
      rid === spotlightRoute
        ? "Click to clear spotlight"
        : "Click to spotlight this route";

    const name = document.createElement("div");
    name.className = "route-name";
    name.textContent = short;

    const bar = document.createElement("div");
    bar.className = "route-bar";
    const fill = document.createElement("span");
    fill.style.width = maxCount ? `${(count / maxCount) * 100}%` : "0%";
    fill.style.background = col;
    bar.appendChild(fill);

    const c = document.createElement("div");
    c.className = "route-count";
    c.textContent = count;

    row.appendChild(name);
    row.appendChild(bar);
    row.appendChild(c);
    statRoutesLive.appendChild(row);
  }

  if (entries.length === 0) {
    statRoutesLive.innerHTML =
      '<div class="subtle">No active vehicles at this moment.</div>';
  }
}

function renderVehicles() {
  if (CURRENT_HOUR == null) return;
  const entry = HOUR_CACHE.get(CURRENT_HOUR);
  if (!entry) return;
  const { trips } = entry;
  const trailSeconds = +trailSel.value;

  let activeCount = 0;
  const byRoute = Object.create(null);

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    const seg = trip._seg;
    if (!seg) {
      markers[i].setStyle({ opacity: 0, fillOpacity: 0 });
      continue;
    }

    const { t0, t1, lat0, lon0, lat1, lon1 } = seg;
    const r = ROUTES[trip.route_id] || {};
    const col = r.color || "#084C8D";

    let found = false,
      lat = null,
      lon = null;

    const j = findActiveSegment(t0, t1, simTime);
    if (j >= 0) {
      const ta = t0[j],
        tb = t1[j];
      const u = tb > ta ? (simTime - ta) / (tb - ta) : 0;
      const aLat = lat0[j] / Q,
        aLon = lon0[j] / Q;
      const bLat = lat1[j] / Q,
        bLon = lon1[j] / Q;
      lat = interp(aLat, bLat, u);
      lon = interp(aLon, bLon, u);
      found = true;
    }

    if (found && lat != null) {
      activeCount++;
      byRoute[trip.route_id] = (byRoute[trip.route_id] || 0) + 1;

      const dim = spotlightRoute != null && trip.route_id !== spotlightRoute;

      markers[i].setLatLng([lat, lon]);
      markers[i].setStyle({
        opacity: dim ? 0.2 : 1,
        fillOpacity: dim ? 0.12 : 0.9,
        color: col,
        fillColor: col,
      });

      if (trailSeconds > 0) {
        trailData[i].push({ t: simTime, lat, lon });
        const tmin = simTime - trailSeconds;
        while (trailData[i].length && trailData[i][0].t < tmin)
          trailData[i].shift();

        const pts = trailData[i];
        const polys = ensureTrailPolys(i, col);
        if (pts.length > 1) {
          for (let c = 0; c < TRAIL_CHUNKS; c++) {
            polys[c].setStyle({
              opacity: 0.2 * ((c + 1) / TRAIL_CHUNKS) * (dim ? 0.15 : 1),
            });
            const a = Math.floor((c * (pts.length - 1)) / TRAIL_CHUNKS);
            const b = Math.floor(((c + 1) * (pts.length - 1)) / TRAIL_CHUNKS);
            if (b <= a) {
              polys[c].setLatLngs([]);
              continue;
            }
            polys[c].setLatLngs(pts.slice(a, b + 1).map((p) => [p.lat, p.lon]));
          }
        } else {
          for (const p of polys) p.setLatLngs([]);
        }
      } else {
        if (trailPolys[i]) for (const p of trailPolys[i]) p.setLatLngs([]);
        trailData[i] = [];
      }
    } else {
      markers[i].setStyle({ opacity: 0, fillOpacity: 0 });
    }
  }

  updateActivity({
    activeCount,
    tripsCount: trips.length,
    byRoute,
  });
}

trailSel.addEventListener("change", renderVehicles);
speedSel.addEventListener("change", renderVehicles);

statRoutesLive.addEventListener("click", (e) => {
  const row = e.target.closest(".route-row");
  if (!row) return;
  spotlightRoute = spotlightRoute === row.dataset.rid ? null : row.dataset.rid;
  renderVehicles();
  applyActivity();
});

clearSpotlightBtn.addEventListener("click", () => {
  spotlightRoute = null;
  renderVehicles();
  applyActivity();
});
