"""Band format for house layouts: the model's output language, the validator (= RL reward) and a synthetic generator.

A layout is a stack of rows ("bands") from the road (front) to the back of the plot. Each band has one depth and a
left-to-right list of rooms with widths, so a plan tiles the plot with no gaps or overlaps by construction.

  {"plot": {"w": 30, "d": 55}, "beds": 3,
   "bands": [{"d": 10, "rooms": [{"t": "lawn", "w": 30}]},
             {"d": 14, "rooms": [{"t": "void", "w": 3}, {"t": "drawing", "w": 12, "bath": [4.5, 6.5, "L"]}, ...]}, ...]}

`bath: [w, d, side]` is a bath in the back corner of the room (side L/R = which corner), like the web app.
Text form (what the language model reads and writes), road first:

  PLOT 30x55 BEDS 3
  10: lawn 30
  14: void 3 | drawing 12 +bath 4.5x6.5 L | lobby 6 | kitchen 6 | void 3
  ...

    python tools/bands.py gen --n 30000                     # synthetic dataset -> data/synth/
    python tools/bands.py show data/synth/train.jsonl 6     # render a few samples to data/synth/preview
    python tools/bands.py check some_plan.json
"""
import argparse, json, random, re, sys
from collections import Counter
from pathlib import Path

MARLA = 225
OPEN = {"lawn", "void", "porch", "courtyard", "garage", "balcony"}      # unbuilt / not enclosed
BEDS = {"bed", "master"}
TYPES = OPEN | BEDS | {"bath", "kitchen", "lounge", "drawing", "dining", "stairs", "store", "lobby", "passage",
                       "prayer", "study", "servant", "dress", "other"}


def rule_for(W, D):
    """Indicative setbacks (same numbers as js/layout.js). Verify against CDA/LDA/RDA/DHA before building."""
    m = W * D / MARLA
    if m <= 6: return dict(front=8, rear=4, side=0, cover=75, label="up to 6 marla")
    if m <= 8.5: return dict(front=10, rear=4, side=3, cover=70, label="6-8 marla")
    if m <= 14: return dict(front=12, rear=5, side=3, cover=65, label="8-14 marla")
    return dict(front=20, rear=7, side=5, cover=60, label="kanal and above")


def max_beds(W, D):
    Bw = W - 2 * rule_for(W, D)["side"]
    return 3 if Bw < 26 else (3 if Bw < 40 else 4) + 2


# ---------------------------------------------------------------- text form
def serialize(plan):
    """Text form. The last room of every band has no width and the last band has depth 'rest': they are whatever is
    left of the plot, so the sums are exact by construction (a language model cannot be trusted to add)."""
    lines = [f"PLOT {plan['plot']['w']:g}x{plan['plot']['d']:g} BEDS {plan['beds']}"]
    nb = len(plan["bands"])
    for bi, b in enumerate(plan["bands"]):
        toks = []
        for ri, r in enumerate(b["rooms"]):
            t = r["t"] if ri == len(b["rooms"]) - 1 else f"{r['t']} {r['w']:g}"
            if r.get("bath"):
                bw, bd, side = r["bath"]
                t += f" +bath {bw:g}x{bd:g} {side}"
            toks.append(t)
        lines.append(("rest" if bi == nb - 1 else f"{b['d']:g}") + ": " + " | ".join(toks))
    return "\n".join(lines)


def prompt_for(W, D, beds):
    return f"PLOT {W:g}x{D:g} BEDS {beds}"


_ROOM = re.compile(r"^([a-z]+)(?: ([\d.]+))?(?: \+bath ([\d.]+)x([\d.]+) ([LR]))?$")


def parse(text):
    """Text -> plan dict. Raises ValueError on any malformed line (a model output that fails here is invalid).
    Implicit widths/depth are resolved to the remainder (may come out <= 0, which check() reports as an error)."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    m = re.match(r"^PLOT ([\d.]+)x([\d.]+) BEDS (\d+)$", lines[0]) if lines else None
    if not m:
        raise ValueError("bad header")
    W, D = float(m[1]), float(m[2])
    plan = {"plot": {"w": W, "d": D}, "beds": int(m[3]), "bands": []}
    used_d = 0.0
    for li, ln in enumerate(lines[1:]):
        h = re.match(r"^([\d.]+|rest): (.+)$", ln)
        if not h:
            raise ValueError(f"bad band line: {ln}")
        toks = h[2].split(" | ")
        rooms, used_w = [], 0.0
        for ti, tok in enumerate(toks):
            rm = _ROOM.match(tok.strip())
            if not rm:
                raise ValueError(f"bad room: {tok}")
            if rm[2] is None and ti != len(toks) - 1:
                raise ValueError(f"missing width: {tok}")
            r = {"t": rm[1], "w": float(rm[2]) if rm[2] else round(W - used_w, 2)}
            used_w += r["w"]
            if rm[3]:
                r["bath"] = [float(rm[3]), float(rm[4]), rm[5]]
            rooms.append(r)
        if h[1] == "rest":
            if li != len(lines) - 2:
                raise ValueError("'rest' depth only allowed on the last band")
            d = round(D - used_d, 2)
        else:
            d = float(h[1])
        used_d += d
        plan["bands"].append({"d": d, "rooms": rooms})
    return plan


def mirror(plan):
    """Left-right mirror (augmentation): reverse each band and flip bath corners."""
    p = json.loads(json.dumps(plan))
    for b in p["bands"]:
        b["rooms"].reverse()
        for r in b["rooms"]:
            if r.get("bath"):
                r["bath"][2] = "L" if r["bath"][2] == "R" else "R"
    return p


# ---------------------------------------------------------------- geometry
def to_rects(plan):
    """Band plan -> absolute rectangles (feet, origin front-left, y grows toward the back). Baths get parent=index."""
    rooms, y = [], 0.0
    for bi, b in enumerate(plan["bands"]):
        x = 0.0
        for r in b["rooms"]:
            rooms.append(dict(i=len(rooms), t=r["t"], name=r["t"], x=x, y=y, w=r["w"], d=b["d"], band=bi, bath=r.get("bath")))
            x += r["w"]
        y += b["d"]
    out = list(rooms)
    for r in rooms:
        if r["bath"]:
            bw, bd, side = r["bath"]
            out.append(dict(i=len(out), t="bath", name="bath", parent=r["i"], band=r["band"], bath=None,
                            x=r["x"] + r["w"] - bw if side == "R" else r["x"], y=r["y"] + r["d"] - bd, w=bw, d=bd))
    return out


def to_annotation(plan, pid="x"):
    """Rectangles in the older absolute annotation format (for render_plan / plan_schema)."""
    rects = to_rects(plan)
    return {"id": pid, "plot": plan["plot"], "rooms": [{k: r[k] for k in ("t", "name", "x", "y", "w", "d")} | {"type": r["t"]} for r in rects]}


def _shared(a, b):
    e = 0.01
    for p, q in ((a, b), (b, a)):
        if abs(p["x"] + p["w"] - q["x"]) < e:
            lo, hi = max(p["y"], q["y"]), min(p["y"] + p["d"], q["y"] + q["d"])
            if hi - lo > 0.5: return ("v", q["x"], lo, hi)
        if abs(p["y"] + p["d"] - q["y"]) < e:
            lo, hi = max(p["x"], q["x"]), min(p["x"] + p["w"], q["x"] + q["w"])
            if hi - lo > 0.5: return ("h", q["y"], lo, hi)
    return None


PREF = {"lobby": ["lounge", "dining"], "drawing": ["lobby", "lounge"], "kitchen": ["dining", "lounge", "lobby"],
        "dining": ["lounge", "kitchen"]}
BED_FRONT = ["drawing", "lobby", "lounge"]
BED_BACK = ["lounge", "dining", "lobby", "drawing", "kitchen"]
OTHER = ["lounge", "passage", "lobby", "dining"]
MINSZ = {"bed": (95, 9), "master": (110, 9), "drawing": (110, 9), "lounge": (100, 8), "kitchen": (55, 6.5),
         "lobby": (20, 4.5), "dining": (70, 7)}
WINDOW_W = {"kitchen": 3.5, "bed": 4, "master": 4, "lobby": 3}


def _links(rects, mains, y0):
    links = []
    for r in mains:
        if r["t"] == "lounge":
            continue
        if r["t"] in BEDS:
            prefs = BED_FRONT if abs(r["y"] - y0) < 0.01 else BED_BACK
        else:
            prefs = PREF.get(r["t"], OTHER)
        pick = None
        for t in prefs:
            for q in mains:
                if q["t"] == t:
                    s = _shared(r, q)
                    if s and s[3] - s[2] >= 3.2:
                        pick = q
                        break
            if pick: break
        if pick: links.append((r["i"], pick["i"]))
    for b in rects:
        if b["t"] == "bath": links.append((b["i"], b["parent"]))
    return links


def _has_window(r, rects):
    """Does the room have an exterior (open-side) wall long enough for a window, ignoring the bath corner?"""
    need = WINDOW_W.get(r["t"], 5) + 1.0
    bath = next((b for b in rects if b["t"] == "bath" and b["parent"] == r["i"]), None)
    opens = [o for o in rects if o["t"] in OPEN]
    edges = [("h", r["y"], r["x"], r["x"] + r["w"], "front"), ("h", r["y"] + r["d"], r["x"], r["x"] + r["w"], "back"),
             ("v", r["x"], r["y"], r["y"] + r["d"], "l"), ("v", r["x"] + r["w"], r["y"], r["y"] + r["d"], "r")]
    for o_, c, lo, hi, nm in edges:
        if r["t"] == "lobby" and nm == "front":
            continue
        ivs = []
        for o in opens:
            if o_ == "h":
                touch = abs(o["y"] + o["d"] - c) < 0.01 if nm == "front" else abs(o["y"] - c) < 0.01
                a, b = max(lo, o["x"]), min(hi, o["x"] + o["w"])
            else:
                touch = abs(o["x"] + o["w"] - c) < 0.01 if nm == "l" else abs(o["x"] - c) < 0.01
                a, b = max(lo, o["y"]), min(hi, o["y"] + o["d"])
            if touch and b - a > 0: ivs.append((a, b))
        for a, b in ivs:
            segs = [(a, b)]
            if bath:
                cut = None
                if o_ == "h" and (abs(bath["y"] - c) < 0.01 or abs(bath["y"] + bath["d"] - c) < 0.01):
                    cut = (bath["x"] - 0.5, bath["x"] + bath["w"] + 0.5)
                if o_ == "v" and (abs(bath["x"] - c) < 0.01 or abs(bath["x"] + bath["w"] - c) < 0.01):
                    cut = (bath["y"] - 0.5, bath["y"] + bath["d"] + 0.5)
                if cut: segs = [(a, min(b, cut[0])), (max(a, cut[1]), b)]
            if any(e - s >= need for s, e in segs): return True
    return False


# ---------------------------------------------------------------- validator
def check(plan, beds=None):
    """-> list of (level, name, detail). level: 'err' = broken (reject), 'warn' = rule not met, 'ok'.
    Geometry/structure errs come first; rule checks (the soft ones) only run when the plan is structurally sound."""
    out = []
    add = lambda lvl, n, d="": out.append((lvl, n, d))
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    beds = beds if beds is not None else plan.get("beds")
    errs = 0
    if not plan["bands"]:
        return [("err", "no bands", "")]
    for bi, b in enumerate(plan["bands"]):
        sw = sum(r["w"] for r in b["rooms"])
        if abs(sw - W) > 0.26: add("err", "band width", f"band {bi}: widths sum to {sw:g}, plot is {W:g}"); errs += 1
        if b["d"] <= 0: add("err", "band depth", f"band {bi}: non-positive"); errs += 1
        for r in b["rooms"]:
            if r["t"] not in TYPES or r["t"] == "bath": add("err", "room type", f"unknown/illegal type {r['t']}"); errs += 1
            if r["w"] <= 0: add("err", "room width", f"{r['t']} non-positive"); errs += 1
            if r.get("bath"):
                bw, bd, _ = r["bath"]
                if bw > r["w"] - 1 or bd > b["d"] - 2: add("err", "bath fit", f"bath {bw}x{bd} too big for {r['t']}"); errs += 1
    sd = sum(b["d"] for b in plan["bands"])
    if abs(sd - D) > 0.26: add("err", "plot depth", f"band depths sum to {sd:g}, plot is {D:g}"); errs += 1
    types = Counter(r["t"] for b in plan["bands"] for r in b["rooms"])
    nb = types["bed"] + types["master"]
    for need in ("kitchen", "drawing", "lobby"):
        if not types[need]: add("err", f"missing {need}"); errs += 1
    if beds is not None and nb != beds: add("err", "bed count", f"asked for {beds}, plan has {nb}"); errs += 1
    if errs:
        return out

    rule = rule_for(W, D)
    rects = to_rects(plan)
    mains = [r for r in rects if r["t"] not in OPEN and r["t"] != "bath"]
    byi = {r["i"]: r for r in rects}
    x0, x1 = min(r["x"] for r in mains), max(r["x"] + r["w"] for r in mains)
    y0, y1 = min(r["y"] for r in mains), max(r["y"] + r["d"] for r in mains)
    ok_set = y0 >= rule["front"] - 0.01 and D - y1 >= rule["rear"] - 0.01 and x0 >= rule["side"] - 0.01 and W - x1 >= rule["side"] - 0.01
    add("ok" if ok_set else "warn", "setbacks", f"front {y0:g}/{rule['front']} rear {D - y1:g}/{rule['rear']} sides {x0:g},{W - x1:g}/{rule['side']}")
    cov = sum(r["w"] * r["d"] for r in mains) / (W * D) * 100
    add("ok" if cov <= rule["cover"] + 0.01 else "warn", "coverage", f"{cov:.0f}% (limit {rule['cover']}%)")

    small = []
    for r in mains:
        if r["t"] in MINSZ:
            net = r["w"] * r["d"] - (r["bath"][0] * r["bath"][1] if r["bath"] else 0)
            if net < MINSZ[r["t"]][0] or min(r["w"], r["d"]) < MINSZ[r["t"]][1]: small.append(r["t"])
    add("warn" if small else "ok", "min room sizes", ",".join(small))
    nobath = [r["t"] for r in mains if r["t"] in BEDS and not r["bath"]]
    add("warn" if nobath else "ok", "attached baths", f"{len(nobath)} bedroom(s) without")
    lob = next(r for r in mains if r["t"] == "lobby")
    faces = abs(lob["y"] - y0) < 0.01 and any(o["t"] in OPEN and abs(o["y"] + o["d"] - lob["y"]) < 0.01
                                              and min(o["x"] + o["w"], lob["x"] + lob["w"]) - max(o["x"], lob["x"]) >= 3 for o in rects)
    add("ok" if faces else "warn", "entrance on road side")

    links = _links(rects, mains, y0)
    adj = {}
    for a, b in links + [(-1, lob["i"])]:
        adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)

    def bfs(blocked=lambda i: False):
        seen, q = {-1}, [-1]
        while q:
            n = q.pop()
            for m in adj.get(n, []):
                if m not in seen and not blocked(m): seen.add(m); q.append(m)
        return seen

    lost = [r["t"] for r in rects if r["t"] not in OPEN and r["i"] not in bfs()]
    add("warn" if lost else "ok", "every room reachable", ",".join(lost))
    is_bed = lambda i: byi[i]["t"] in BEDS or (byi[i]["t"] == "bath" and byi[byi[i]["parent"]]["t"] in BEDS)
    guest = bfs(is_bed)
    add("ok" if any(r["t"] == "drawing" and r["i"] in guest for r in mains) else "warn", "guest privacy")
    kit = [r for r in mains if r["t"] == "kitchen"]
    bk = any((a in {k["i"] for k in kit} and is_bed(b)) or (b in {k["i"] for k in kit} and is_bed(a)) for a, b in links)
    add("warn" if bk else "ok", "bedroom not opening into kitchen")
    add("ok" if any(_has_window(k, rects) for k in kit) else "warn", "kitchen ventilation")
    dark = [r["t"] for r in mains if r["t"] in BEDS | {"drawing"} and not _has_window(r, rects)]
    add("warn" if dark else "ok", "natural light", ",".join(dark))
    return out


def score(checks):
    """Reward in [0,1]: 0 if broken, else fraction of rule checks passed."""
    if any(c[0] == "err" for c in checks): return 0.0
    return sum(c[0] == "ok" for c in checks) / len(checks)


def failed(checks):
    return [c[1] for c in checks if c[0] != "ok"]


# ---------------------------------------------------------------- synthetic generator
def _split(total, items):
    """items: [{'wt':..} | {'fixed':..}] -> lengths on a 0.5 ft grid summing exactly to total."""
    fixed = sum(i.get("fixed", 0) for i in items)
    wsum = sum(i["wt"] for i in items if "fixed" not in i)
    acc = prev = 0.0
    out = []
    for n, it in enumerate(items):
        acc += it["fixed"] if "fixed" in it else (total - fixed) * it["wt"] / wsum
        end = total if n == len(items) - 1 else round(acc * 2) / 2
        out.append(end - prev)
        prev = end
    return out


def generate(W, D, beds, rng):
    """One randomised Pakistani-style layout: lawn / front band (drawing, lobby, guest beds) / middle band
    (kitchen, dining, lounge) / back band (bedrooms) / rear setback. Mirrors js/layout.js with jitter."""
    rule = rule_for(W, D)
    s = rule["side"]
    Bw = W - 2 * s
    rear = max(rule["rear"], -(-(D - rule["front"] - rule["cover"] / 100 * W * D / Bw) * 2 // 1) / 2)   # more yard if over the coverage limit
    rear = max(rear, D - rule["front"] - 46)         # houses are not >46 ft deep: spare length becomes a back yard
    Bd = D - rule["front"] - rear
    narrow = Bw < 26
    k = 2 if narrow else 3 if Bw < 40 else 4
    nbeds = max(2, min(beds, 3 if narrow else k + 2))
    back, extra = min(nbeds, k), nbeds - min(nbeds, k)
    u = rng.uniform
    f, m = u(0.22, 0.32), u(0.25, 0.36)
    depths = _split(Bd, [{"wt": f}, {"wt": m}, {"wt": 1 - f - m}])

    # front band
    lobby_w = round(min(8, max(5, Bw * 0.2)) * u(0.85, 1.2) * 2) / 2
    kinds = ["bed"] * extra + ["drawing"]
    pos = rng.choice(["left", "right"] + (["middle"] if extra else []))
    items = [{"k": k_, "wt": u(1.0, 1.25)} for k_ in kinds]
    lob = {"k": "lobby", "fixed": lobby_w}
    if pos == "left": items = [lob] + items
    elif pos == "right": items = items + [lob]
    else: items.insert(rng.randint(1, len(items) - 1), lob)
    wid = _split(Bw, items)
    lob_i = next(i for i, it in enumerate(items) if it["k"] == "lobby")
    front = [{"t": it["k"], "w": w} for it, w in zip(items, wid)]

    # back band
    names = ["master"] + ["bed"] * (back - 1)
    wts_b = [u(1.15, 1.4)] + [u(0.9, 1.1) for _ in range(back - 1)]
    if rng.random() < 0.5: names.reverse(); wts_b.reverse()
    backb = [{"t": t, "w": w} for t, w in zip(names, _split(Bw, [{"wt": w} for w in wts_b]))]


    # middle band
    court = s == 0 or rng.random() < 0.2     # light well: the only window source for the kitchen on plots with no side yards
    for _ in range(60):
        mid = ["kitchen", "dining", "lounge"] + (["courtyard"] if court else [])
        rng.shuffle(mid)
        if narrow or rng.random() < 0.28: mid.remove("dining")
        wts = {"kitchen": u(0.2, 0.3), "dining": u(0.22, 0.3), "lounge": u(0.42, 0.56)} if "dining" in mid else {"kitchen": u(0.28, 0.38), "lounge": u(0.62, 0.72)}
        wts["courtyard"] = 0.0
        cw = round(u(4, 5.5) * 2) / 2
        mw = _split(Bw, [{"fixed": cw} if t == "courtyard" else {"wt": wts[t]} for t in mid])
        a, b_ = sum(wid[:lob_i]), sum(wid[:lob_i + 1])
        edge, ok_lobby, pos_ = 0.0, False, {}
        for i, (t, w) in enumerate(zip(mid, mw)):
            pos_[t] = i
            if t in ("lounge", "dining") and min(b_, edge + w) - max(a, edge) >= 3.5: ok_lobby = True
            edge += w
        spans, e2 = [], 0.0
        for t, w in zip(mid, mw):
            if t in ("lounge", "dining"): spans.append((e2, e2 + w))
            e2 += w
        be, ok_beds = 0.0, True
        for r in backb:
            if not any(min(be + r["w"], hi) - max(be, lo) >= 3.2 for lo, hi in spans): ok_beds = False
            be += r["w"]
        ok_dine = "dining" not in pos_ or abs(pos_["dining"] - pos_["lounge"]) == 1
        k_i = pos_["kitchen"]
        ok_kit = (court and abs(k_i - pos_["courtyard"]) == 1) or (s > 0 and k_i in (0, len(mid) - 1))
        if ok_lobby and ok_dine and ok_kit and ok_beds: break
    else:
        return None                          # no arrangement satisfies the wall-adjacency constraints
    middle = [{"t": t, "w": w} for t, w in zip(mid, mw)]

    # baths: back-band bedrooms alternate corners so neighbours share a plumbing wall; front rooms away from the lobby
    side0 = rng.choice("LR")
    flip = {"L": "R", "R": "L"}
    for i, r in enumerate(backb):
        sd = side0 if i % 2 == 0 else flip[side0]
        r["bath"] = [4.5 if r["w"] < 11 else rng.choice([5, 5.5]), min(rng.choice([7, 7.5, 8]), depths[2] - 3), sd]
    for i, r in enumerate(front):
        if r["t"] in ("bed", "drawing"):
            away = "L" if i > lob_i else "R"
            r["bath"] = ([4.5 if r["w"] < 11 else 5, min(rng.choice([6.5, 7]), depths[0] - 3), away] if r["t"] == "bed"
                         else [4.5, min(rng.choice([6, 6.5, 7]), depths[0] - 3), away])

    pad = [{"t": "void", "w": s}] if s else []
    bands = [{"d": rule["front"], "rooms": [{"t": "lawn", "w": W}]}]
    for d_, rooms in zip(depths, (front, middle, backb)):
        bands.append({"d": d_, "rooms": pad + rooms + pad})
    bands.append({"d": rear, "rooms": [{"t": "void", "w": W}]})
    return {"plot": {"w": W, "d": D}, "beds": nbeds, "bands": bands}


WIDTHS = [20, 22, 24, 25, 26, 27, 28, 30, 30, 32, 33, 35, 35, 36, 38, 40, 42, 45, 50, 50, 55, 60]


SIZE_BINS = {"small": (3, 6), "mid": (6, 14), "large": (14, 45)}      # marla
SIZE_MIX = {"small": 0.15, "mid": 0.45, "large": 0.40}                 # share of plots per bin, so small plots are not drowned out


def sample_plot(rng, size_bin=None):
    lo, hi = SIZE_BINS[size_bin] if size_bin else (3, 45)
    while True:
        W = rng.choice(WIDTHS)
        D = round(W * rng.uniform(1.3, 2.4))
        if lo < W * D / MARLA <= hi and D <= 130: return W, D


def build(n, seed=0, min_score=1.0):
    """n valid, distinct (prompt, layout) pairs. Accepts layouts that pass >= min_score of the rule checks;
    plot sizes follow SIZE_MIX so every size range is represented."""
    rng = random.Random(seed)
    seen, rows, tried, rej, infeasible = set(), [], 0, Counter(), Counter()
    quota = {k: round(n * v) for k, v in SIZE_MIX.items()}             # hard per-size quotas, not just sampling weights
    got = Counter()
    while len(rows) < n:
        tried += 1
        open_bins = [k for k in quota if got[k] < quota[k]]
        size_bin = rng.choice(open_bins) if open_bins else None
        W, D = sample_plot(rng, size_bin)
        beds = rng.randint(2, 6)
        for _ in range(12):
            plan = generate(W, D, beds, rng)
            if plan is None or plan["beds"] != beds:         # generator clamps; only keep what was actually asked for
                continue
            cs = check(plan, plan["beds"])
            if score(cs) >= min_score: break
            rej.update(failed(cs))
        else:
            infeasible[(W, D, beds)] += 1
            continue
        txt = serialize(plan)
        if txt in seen: continue
        seen.add(txt)
        if size_bin: got[size_bin] += 1
        rows.append({"prompt": prompt_for(W, D, plan["beds"]), "completion": txt.split("\n", 1)[1], "plot": [W, D], "beds": plan["beds"],
                     "score": round(score(cs), 3), "failed": failed(cs)})
    return rows, tried, rej


def _build_chunk(args):
    n, seed, min_score = args
    return build(n, seed, min_score)


def build_parallel(n, workers=1, seed=0, min_score=1.0):
    """Same as build() but spread over `workers` processes (each plan is independent -> near-linear speedup).
    Every worker gets its own seed; results are merged and de-duplicated."""
    if workers <= 1:
        return build(n, seed, min_score)
    from multiprocessing import Pool
    per = -(-int(n * 1.03) // workers)                                  # small surplus: duplicates across workers get dropped
    with Pool(workers) as pool:
        parts = pool.map(_build_chunk, [(per, seed * 1000 + w, min_score) for w in range(workers)])
    seen, rows, tried, rej = set(), [], 0, Counter()
    for r_, t_, j_ in parts:
        tried += t_; rej.update(j_)
        for r in r_:
            k = r["prompt"] + r["completion"]
            if k not in seen: seen.add(k); rows.append(r)
    return rows[:n], tried, rej


def split_by_plot(rows, seed=0):
    """Hold out whole plot sizes for val/test so the model is judged on layouts for sizes it never saw."""
    rng = random.Random(seed)
    val, test = set(), set()
    for lo, hi in SIZE_BINS.values():                           # stratified: every size range gets held-out plot sizes
        plots = sorted({tuple(r["plot"]) for r in rows if lo < r["plot"][0] * r["plot"][1] / MARLA <= hi})
        rng.shuffle(plots)
        nv, nt = max(3, len(plots) // 20), max(4, len(plots) // 12)
        val.update(plots[:nv]); test.update(plots[nv:nv + nt])
    parts = {"train": [], "val": [], "test": []}
    for r in rows:
        p = tuple(r["plot"])
        parts["val" if p in val else "test" if p in test else "train"].append(r)
    return parts


# ---------------------------------------------------------------- CLI
def _cmd_bench(a):
    """Parallel speedup of synthetic data generation: time for n plans with 1..workers processes."""
    import time
    base = None
    print(f"{'workers':>8} {'seconds':>9} {'speedup':>8} {'efficiency':>11}")
    for w in a.workers:
        t0 = time.time()
        rows, _, _ = build_parallel(a.n, w, 0, a.min_score)
        t = time.time() - t0
        base = base or t
        print(f"{w:>8} {t:>9.1f} {base / t:>8.2f} {base / t / w:>10.0%}", flush=True)


def _cmd_gen(a):
    import time
    t0 = time.time()
    rows, tried, rej = build_parallel(a.n, a.workers, a.seed, a.min_score)
    print(f"generated in {time.time() - t0:.0f}s with {a.workers} worker(s)")
    parts = split_by_plot(rows)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for name, rs in parts.items():
        with open(out / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for r in rs: f.write(json.dumps(r) + "\n")
    print(f"{len(rows)} layouts from {tried} tries (acceptance {len(rows) / tried:.0%})")
    print({k: len(v) for k, v in parts.items()}, "| distinct plot sizes:", len({tuple(r['plot']) for r in rows}))
    print("most common rejections:", rej.most_common(6))
    print("prompt-token estimate per row ~", sum(len(r["completion"]) for r in rows) // len(rows) // 3, "tokens")


def _cmd_show(a):
    from render_plan import render
    rows = [json.loads(l) for l in open(a.file, encoding="utf-8")][: a.k]
    out = Path(a.file).parent / "preview"; out.mkdir(exist_ok=True)
    for i, r in enumerate(rows):
        plan = parse(r["prompt"] + "\n" + r["completion"])
        render(to_annotation(plan, f"s{i}"), out / f"s{i}.png")
        print(r["prompt"], "->", out / f"s{i}.png")


def _cmd_check(a):
    plan = json.loads(Path(a.file).read_text(encoding="utf-8")) if a.file.endswith(".json") else parse(Path(a.file).read_text(encoding="utf-8"))
    cs = check(plan)
    for c in cs: print(f"{c[0]:5s} {c[1]:32s} {c[2]}")
    print("score", round(score(cs), 3))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen"); g.add_argument("--n", type=int, default=30000); g.add_argument("--seed", type=int, default=0)
    g.add_argument("--min-score", type=float, default=1.0); g.add_argument("--out", default="data/synth")
    g.add_argument("--workers", type=int, default=1); g.set_defaults(fn=_cmd_gen)
    bn = sub.add_parser("bench"); bn.add_argument("--n", type=int, default=1500); bn.add_argument("--min-score", type=float, default=1.0)
    bn.add_argument("--workers", type=int, nargs="+", default=[1, 2, 4, 8]); bn.set_defaults(fn=_cmd_bench)
    s = sub.add_parser("show"); s.add_argument("file"); s.add_argument("k", type=int, nargs="?", default=6); s.set_defaults(fn=_cmd_show)
    c = sub.add_parser("check"); c.add_argument("file"); c.set_defaults(fn=_cmd_check)
    args = ap.parse_args()
    sys.path.insert(0, str(Path(__file__).parent))
    args.fn(args)
