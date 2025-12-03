import csv
import json
import base64
from collections import defaultdict

STOPS_CSV      = "stops.txt"
TRIPS_CSV      = "trips.txt"
ROUTES_CSV     = "routes.txt"
STOP_TIMES_CSV = "stop_times.txt"

OUTPUT_JSON    = "all_trips.json"

ROUTE_FILTER   = None 
LATLON_SCALE   = 50_000

WINDOW_START_HOUR = 9
WINDOW_END_HOUR   = 18
WINDOW_START_SEC  = WINDOW_START_HOUR * 3600
WINDOW_END_SEC    = WINDOW_END_HOUR * 3600

def hms_to_sec(hms: str) -> int:
    h, m, s = hms.split(":")
    return int(h)*3600 + int(m)*60 + int(s)

def norm_hex(s: str) -> str:
    s = (s or "").strip()
    if not s: return "#084C8D"
    if s.startswith("#"): return "#" + s[1:].upper()
    return "#" + s.upper()

def zigzag_encode(n: int) -> int:
    return (n << 1) ^ (n >> 31)

def varint_encode(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)

def pack_stream(int_values) -> bytes:
    out = bytearray()
    prev = 0
    for v in int_values:
        delta = v - prev
        prev = v
        out.extend(varint_encode(zigzag_encode(delta)))
    return bytes(out)

def lerp(a: float, b: float, u: float) -> float:
    return a + (b - a) * u

print("Loading routes...")
routes = {}
with open(ROUTES_CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rid = r["route_id"]
        if ROUTE_FILTER is not None and rid != ROUTE_FILTER:
            continue
        routes[rid] = {
            "short_name": r.get("route_short_name","") or "",
            "color":      norm_hex(r.get("route_color","")),
        }

print("Loading trips...")
trip_to = {}
with open(TRIPS_CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        rid = r["route_id"]
        if ROUTE_FILTER is not None and rid != ROUTE_FILTER:
            continue
        if rid not in routes:
            continue
        trip_to[r["trip_id"]] = {
            "route_id": rid,
            "headsign": r.get("trip_headsign","") or ""
        }

print("Loading stops...")
stops = {}
with open(STOPS_CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        try:
            stops[r["stop_id"]] = (float(r["stop_lat"]), float(r["stop_lon"]))
        except Exception:
            pass

print("Loading stop_times...")
per_trip = defaultdict(list)
hourly_by_stop = defaultdict(lambda: [0]*24)

with open(STOP_TIMES_CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        tid = r["trip_id"]
        if tid not in trip_to:
            continue
        try:
            t_arr = hms_to_sec(r["arrival_time"])
            t_dep = hms_to_sec(r["departure_time"])
            seq   = int(r["stop_sequence"])
        except Exception:
            continue

        sid = r["stop_id"]

        per_trip[tid].append({"seq": seq, "t_arr": t_arr, "t_dep": t_dep, "stop_id": sid})

        if sid in stops and WINDOW_START_SEC <= t_dep < WINDOW_END_SEC:
            hr = max(0, min(23, t_dep // 3600))
            hourly_by_stop[sid][hr] += 1

print("Building hour-chunked trips...")
trips_by_hour = {h: [] for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR)}

def clip_and_encode_trip_to_hour(trip_id, route_id, headsign, rows, hour):
    start = hour * 3600
    end   = start + 3600
    raw = []

    for a, b in zip(rows, rows[1:]):
        t0, t1 = a["t_dep"], b["t_arr"]
        if t1 <= t0: continue
        s0, s1 = a["stop_id"], b["stop_id"]
        if s0 not in stops or s1 not in stops: continue
        lat0, lon0 = stops[s0]
        lat1, lon1 = stops[s1]

        if t1 <= start or t0 >= end: continue
        ta = max(t0, start)
        tb = min(t1, end)
        if tb <= ta: continue

        u_a = (ta - t0) / (t1 - t0)
        u_b = (tb - t0) / (t1 - t0)
        aLat = lerp(lat0, lat1, u_a)
        aLon = lerp(lon0, lon1, u_a)
        bLat = lerp(lat0, lat1, u_b)
        bLon = lerp(lon0, lon1, u_b)

        raw.append((int(ta), int(tb), aLat, aLon, bLat, bLon))

    if not raw:
        return None

    T_stream, P_stream = [], []
    q = LATLON_SCALE
    for (ta, tb, aLat, aLon, bLat, bLon) in raw:
        T_stream.extend([ta, tb])
        P_stream.extend([
            int(round(aLat * q)), int(round(aLon * q)),
            int(round(bLat * q)), int(round(bLon * q)),
        ])

    T_b64 = base64.b64encode(pack_stream(T_stream)).decode("ascii")
    P_b64 = base64.b64encode(pack_stream(P_stream)).decode("ascii")

    return {
        "trip_id": trip_id,
        "route_id": route_id,
        "headsign": headsign,
        "segments_packed": {"t": T_b64, "p": P_b64, "n": len(raw)}
    }

for tid, rows in per_trip.items():
    rows.sort(key=lambda x: x["seq"])
    info = trip_to[tid]

    for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR):
        trip_h = clip_and_encode_trip_to_hour(tid, info["route_id"], info["headsign"], rows, h)
        if trip_h is not None:
            trips_by_hour[h].append(trip_h)

stops_hourly = []
for sid, vec in hourly_by_stop.items():
    if sid in stops:
        lat, lon = stops[sid]
        stops_hourly.append({"stop_id": sid, "lat": lat, "lon": lon, "hourly": vec})

print("Writing combined JSON file...")
output = {
    "meta": {
        "q": LATLON_SCALE,
        "window": {
            "start_hour": WINDOW_START_HOUR,
            "end_hour": WINDOW_END_HOUR
        }
    },
    "routes": routes,
    "stops_hourly": stops_hourly,
    "trips_by_hour": [
        {"hour": h, "trips": trips_by_hour[h]}
        for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR)
    ]
}

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

print(f"Done. Wrote {OUTPUT_JSON}")
