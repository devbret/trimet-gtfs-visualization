import os
import csv
import json
import math
import base64
from bisect import bisect_right
from collections import defaultdict

STOPS_CSV      = "stops.txt"
TRIPS_CSV      = "trips.txt"
ROUTES_CSV     = "routes.txt"
SHAPES_CSV     = "shapes.txt"
STOP_TIMES_CSV = "stop_times.txt"

OUTPUT_JSON    = "all_trips.json"

ROUTE_FILTER   = None
LATLON_SCALE   = 50_000
SHAPE_TOLERANCE_M = 2.0

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

def simplify(xy, tol):
    keep = [False] * len(xy)
    keep[0] = keep[-1] = True
    stack = [(0, len(xy) - 1)]
    while stack:
        i, j = stack.pop()
        x0, y0 = xy[i]
        dx, dy = xy[j][0] - x0, xy[j][1] - y0
        L2 = dx*dx + dy*dy
        best, best_k = tol * tol, -1
        for k in range(i + 1, j):
            px, py = xy[k][0] - x0, xy[k][1] - y0
            u = max(0.0, min(1.0, (px*dx + py*dy) / L2)) if L2 > 0 else 0.0
            ex, ey = px - u*dx, py - u*dy
            d2 = ex*ex + ey*ey
            if d2 > best:
                best, best_k = d2, k
        if best_k >= 0:
            keep[best_k] = True
            stack.extend([(i, best_k), (best_k, j)])
    return [k for k, kept in enumerate(keep) if kept]

def feed_dist_to_m(shape, dist):
    fd, m = shape["feed_dist"], shape["m"]
    i = bisect_right(fd, dist) - 1
    if i < 0: return m[0]
    if i >= len(fd) - 1: return m[-1]
    span = fd[i+1] - fd[i]
    return lerp(m[i], m[i+1], (dist - fd[i]) / span if span > 0 else 0.0)

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
            "headsign": r.get("trip_headsign","") or "",
            "shape_id": r.get("shape_id","") or ""
        }

print("Loading stops...")
stops = {}
with open(STOPS_CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        try:
            stops[r["stop_id"]] = (float(r["stop_lat"]), float(r["stop_lon"]))
        except Exception:
            pass

print("Loading shapes...")
shape_pts = defaultdict(list)
if os.path.exists(SHAPES_CSV):
    used_shape_ids = {t["shape_id"] for t in trip_to.values() if t["shape_id"]}
    with open(SHAPES_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            sid = r["shape_id"]
            if sid not in used_shape_ids:
                continue
            try:
                dist = float(r["shape_dist_traveled"])
            except (KeyError, ValueError):
                dist = None
            shape_pts[sid].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"]), dist))
else:
    print(f"  {SHAPES_CSV} not found; vehicles will move in straight lines between stops")

shapes = {}
for sid, pts in shape_pts.items():
    pts.sort()
    if len(pts) < 2 or any(p[3] is None for p in pts):
        continue
    lat_ref = math.radians(sum(p[1] for p in pts) / len(pts))
    xy = [(p[2] * 111_320 * math.cos(lat_ref), p[1] * 110_540) for p in pts]
    m = [0.0]
    for a, b in zip(xy, xy[1:]):
        m.append(m[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    shapes[sid] = {
        "lat": [p[1] for p in pts],
        "lon": [p[2] for p in pts],
        "feed_dist": [p[3] for p in pts],
        "m": m,
        "keep": simplify(xy, SHAPE_TOLERANCE_M),
    }
del shape_pts

print("Loading stop_times...")
per_trip = defaultdict(list)

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
        try:
            dist = float(r["shape_dist_traveled"])
        except (KeyError, ValueError):
            dist = None

        per_trip[tid].append({"seq": seq, "t_arr": t_arr, "t_dep": t_dep, "stop_id": sid, "dist": dist})

print("Building hour-chunked trips...")
trips_by_hour = {h: [] for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR)}
used_shapes = set()

def b64_stream(int_values) -> str:
    return base64.b64encode(pack_stream(int_values)).decode("ascii")

def clip_and_encode_trip_to_hour(trip_id, route_id, headsign, shape_id, rows, hour):
    start = hour * 3600
    end   = start + 3600
    raw = []

    for a, b in zip(rows, rows[1:]):
        t0, t1 = a["t_dep"], b["t_arr"]
        if t1 <= t0: continue
        p0, p1 = a["pos"], b["pos"]
        if p0 is None or p1 is None: continue

        if t1 <= start or t0 >= end: continue
        ta = max(t0, start)
        tb = min(t1, end)
        if tb <= ta: continue

        u_a = (ta - t0) / (t1 - t0)
        u_b = (tb - t0) / (t1 - t0)
        pa = [lerp(x0, x1, u_a) for x0, x1 in zip(p0, p1)]
        pb = [lerp(x0, x1, u_b) for x0, x1 in zip(p0, p1)]

        raw.append((int(ta), int(tb), pa, pb))

    if not raw:
        return None

    T_stream, P_stream = [], []
    q = 1 if shape_id else LATLON_SCALE
    for (ta, tb, pa, pb) in raw:
        T_stream.extend([ta, tb])
        P_stream.extend(int(round(x * q)) for x in pa + pb)

    trip = {
        "trip_id": trip_id,
        "route_id": route_id,
        "headsign": headsign,
    }
    if shape_id:
        trip["shape_id"] = shape_id
        trip["segments_packed"] = {"t": b64_stream(T_stream), "d": b64_stream(P_stream), "n": len(raw)}
    else:
        trip["segments_packed"] = {"t": b64_stream(T_stream), "p": b64_stream(P_stream), "n": len(raw)}
    return trip

for tid, rows in per_trip.items():
    rows.sort(key=lambda x: x["seq"])
    info = trip_to[tid]

    shape = shapes.get(info["shape_id"])
    if shape and all(r["dist"] is not None for r in rows):
        shape_id = info["shape_id"]
        for r in rows:
            r["pos"] = (feed_dist_to_m(shape, r["dist"]),)
    else:
        shape_id = None
        for r in rows:
            r["pos"] = stops.get(r["stop_id"])

    for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR):
        trip_h = clip_and_encode_trip_to_hour(tid, info["route_id"], info["headsign"], shape_id, rows, h)
        if trip_h is not None:
            trips_by_hour[h].append(trip_h)
            if shape_id:
                used_shapes.add(shape_id)

print(f"Encoding {len(used_shapes)} shapes...")
shapes_out = {}
q = LATLON_SCALE
for sid in sorted(used_shapes):
    s = shapes[sid]
    keep = s["keep"]
    shapes_out[sid] = {
        "lat": b64_stream(int(round(s["lat"][k] * q)) for k in keep),
        "lon": b64_stream(int(round(s["lon"][k] * q)) for k in keep),
        "d":   b64_stream(int(round(s["m"][k])) for k in keep),
        "n":   len(keep),
    }

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
    "shapes": shapes_out,
    "trips_by_hour": [
        {"hour": h, "trips": trips_by_hour[h]}
        for h in range(WINDOW_START_HOUR, WINDOW_END_HOUR)
    ]
}

with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

print(f"Done. Wrote {OUTPUT_JSON}")
