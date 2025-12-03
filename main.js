const map = L.map("map", { zoomControl: true }).setView([45.52, -122.67], 12);
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
const statSpeedTrails = document.getElementById("statSpeedTrails");
const statRoutesLive = document.getElementById("statRoutesLive");

const START_HOUR = 9;
const END_HOUR = 18;
const START_SEC = START_HOUR * 3600;
const END_SEC_EXCL = END_HOUR * 3600;
const END_SEC = END_SEC_EXCL - 1;

timeInp.min = START_SEC;
timeInp.max = END_SEC;
if (+timeInp.value < START_SEC) timeInp.value = START_SEC;
if (+timeInp.value > END_SEC) timeInp.value = END_SEC;

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
  return `${fmt(start).slice(0, 5)}–${fmt(end).slice(0, 5)}`;
}

function setSimTime(t) {
  const prevHour = currentHour(simTime);
  simTime = Math.max(START_SEC, Math.min(END_SEC, t));
  const nextHour = currentHour(simTime);

  timeInp.value = Math.floor(simTime);
  timeLbl.textContent = fmt(simTime);

  if (nextHour !== prevHour) {
    rebuildLayersForHour(nextHour);
    renderVehicles();
  } else {
    renderVehicles();
  }

  if (simTime >= END_SEC) {
    isPlaying = false;
    playBtn.textContent = "Play";
    stopLoop();
  }
}

timeInp.addEventListener("input", () => setSimTime(+timeInp.value));
playBtn.addEventListener("click", () => {
  if (!isPlaying && simTime >= END_SEC) {
    setSimTime(START_SEC);
  }
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? "Pause" : "Play";
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
  while (true) {
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

let ROUTES = {};
let Q = 100000;

const HOUR_CACHE = new Map();
let CURRENT_HOUR = null;

let markers = [];
let trailData = [];
let trailLayers = [];

fetch("all_trips.json")
  .then((r) => r.json())
  .then((bundle) => {
    ROUTES = bundle.routes || {};
    Q = bundle.meta && bundle.meta.q ? bundle.meta.q : Q;

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
  });

function clearLayers() {
  for (const m of markers) map.removeLayer(m);
  for (const lg of trailLayers) map.removeLayer(lg);
  markers = [];
  trailLayers = [];
  trailData = [];
}

function rebuildLayersForHour(h) {
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
        const rname = r.short_name ? `${r.short_name} — ` : "";
        return `${rname}${trip.headsign || ""}<br>Trip ${trip.trip_id}`;
      },
      { sticky: true }
    );
    return m;
  });

  trailData = trips.map(() => []);
  trailLayers = trips.map(() => L.layerGroup().addTo(map));

  statHourWindow.textContent = fmtHourWindow(h);
}

function updateActivity({ activeCount, tripsCount, byRoute }) {
  statActive.textContent = activeCount;
  statTripsHour.textContent = tripsCount;
  const pct = tripsCount > 0 ? (activeCount / tripsCount) * 100 : 0;
  statPercent.textContent = `${pct.toFixed(1)}%`;

  const speed = speedSel.value;
  const trails = trailSel.options[trailSel.selectedIndex].textContent;
  statSpeedTrails.textContent = `x${speed} / ${trails}`;

  statRoutesLive.innerHTML = "";
  const entries = Object.entries(byRoute);
  entries.sort((a, b) => b[1] - a[1]);

  const topN = 12;
  for (const [rid, count] of entries.slice(0, topN)) {
    const r = ROUTES[rid] || {};
    const col = r.color || "#084C8D";
    const short = r.short_name || rid;

    const row = document.createElement("div");
    row.className = "route-row";

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = col;

    const name = document.createElement("div");
    name.className = "route-name";
    name.textContent = short;

    const c = document.createElement("div");
    c.className = "route-count";
    c.textContent = count;

    row.appendChild(sw);
    row.appendChild(name);
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

    for (let j = 0; j < t0.length; j++) {
      const ta = t0[j],
        tb = t1[j];
      if (simTime >= ta && simTime <= tb) {
        const u = (simTime - ta) / (tb - ta);
        const aLat = lat0[j] / Q,
          aLon = lon0[j] / Q;
        const bLat = lat1[j] / Q,
          bLon = lon1[j] / Q;
        lat = interp(aLat, bLat, u);
        lon = interp(aLon, bLon, u);
        found = true;
        break;
      }
    }

    if (found && lat != null) {
      activeCount++;
      byRoute[trip.route_id] = (byRoute[trip.route_id] || 0) + 1;

      markers[i].setLatLng([lat, lon]);
      markers[i].setStyle({
        opacity: 1,
        fillOpacity: 0.9,
        color: col,
        fillColor: col,
      });

      if (trailSeconds > 0) {
        trailData[i].push({ t: simTime, lat, lon });
        const tmin = simTime - trailSeconds;
        while (trailData[i].length && trailData[i][0].t < tmin)
          trailData[i].shift();

        trailLayers[i].clearLayers();
        const pts = trailData[i];
        if (pts.length > 1) {
          const chunks = 5;
          for (let c = 0; c < chunks; c++) {
            const a = Math.floor((c * (pts.length - 1)) / chunks);
            const b = Math.floor(((c + 1) * (pts.length - 1)) / chunks);
            if (b <= a) continue;
            const latlngs = pts.slice(a, b + 1).map((p) => [p.lat, p.lon]);
            const alpha = (c + 1) / chunks;
            L.polyline(latlngs, {
              weight: 3,
              opacity: 0.2 * alpha,
              color: col,
            }).addTo(trailLayers[i]);
          }
        }
      } else {
        trailLayers[i].clearLayers();
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
