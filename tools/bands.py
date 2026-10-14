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


FOCUS_VALUES = ("balanced", "bedrooms", "lounge", "kitchen")
# typical share of the built area taken by bedrooms (by bedroom count) in balanced plans; "bigger bedrooms" = 4 points above
BED_BASE = {2: 0.42, 3: 0.43, 4: 0.50, 5: 0.55, 6: 0.57}
BED_BASE_SMALL = {1: 0.24, 2: 0.40}          # plots up to 6 marla (compact layout: the porch and drawing room take the front row)


def rule_for(W, D):
    """Indicative setbacks (same numbers as js/layout.js). Verify against CDA/LDA/RDA/DHA before building."""
    m = W * D / MARLA
    if m <= 6: return dict(front=5, rear=4, side=0, cover=75, label="up to 6 marla")     # car porch beside the drawing room is the rest of the front open space
    if m <= 8.5: return dict(front=10, rear=4, side=3, cover=70, label="6-8 marla")
    if m <= 14: return dict(front=12, rear=5, side=3, cover=65, label="8-14 marla")
    return dict(front=20, rear=7, side=5, cover=60, label="kanal and above")


def max_beds(W, D):
    """Most bedrooms that fit on one floor, found by probing the generator (matches maxBeds in the landing page and
    planner). 0 = the plot is too small or narrow for a single-floor house after setbacks."""
    marla, rule = W * D / MARLA, rule_for(W, D)
    if marla <= 6:                                                   # compact layout: 2 rows need 21.5 ft, 3 rows about 33
        if D - rule["front"] - rule["rear"] < 21.5: return 0
        return 2 if (W >= 24 and D >= 42) or (W >= 22 and D >= 48) else 1
    Bw = W - 2 * rule["side"]
    if Bw < 19: return 0
    return 2 if Bw < 26 else 3 if Bw < 32 else 4 if Bw < 44 else 6


def min_beds(W, D):
    """One bedroom is offered only on plots up to 6 marla (the compact layout)."""
    return 1 if W * D / MARLA <= 6 else 2


def max_baths(W, D, beds):
    """Washrooms: one per bedroom plus a guest washroom, plus a common one off the lounge above 6 marla."""
    return beds + (1 if W * D / MARLA <= 6 else 2)


# ---------------------------------------------------------------- text form
def serialize(plan):
    """Text form. The last room of every band has no width and the last band has depth 'rest': they are whatever is
    left of the plot, so the sums are exact by construction (a language model cannot be trusted to add)."""
    lines = [prompt_for(plan["plot"]["w"], plan["plot"]["d"], plan["beds"], plan.get("baths"), plan.get("focus"))]
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


def prompt_for(W, D, beds, baths=None, focus=None):
    """The request the model is conditioned on. baths = total washrooms, focus = which rooms to make bigger."""
    s = f"PLOT {W:g}x{D:g} BEDS {beds}"
    if baths is not None: s += f" BATHS {baths}"
    if focus: s += f" FOCUS {focus}"
    return s


_ROOM = re.compile(r"^([a-z]+)(?: ([\d.]+))?(?: \+bath ([\d.]+)x([\d.]+) ([LR]))?$")


def parse(text):
    """Text -> plan dict. Raises ValueError on any malformed line (a model output that fails here is invalid).
    Implicit widths/depth are resolved to the remainder (may come out <= 0, which check() reports as an error)."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    m = re.match(r"^PLOT ([\d.]+)x([\d.]+) BEDS (\d+)(?: BATHS (\d+))?(?: FOCUS ([a-z]+))?$", lines[0]) if lines else None
    if not m:
        raise ValueError("bad header")
    W, D = float(m[1]), float(m[2])
    plan = {"plot": {"w": W, "d": D}, "beds": int(m[3]), "bands": []}
    if m[4] is not None: plan["baths"] = int(m[4])
    if m[5] is not None: plan["focus"] = m[5]
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
    nbath = sum(1 for b in plan["bands"] for r in b["rooms"] if r.get("bath"))
    if plan.get("baths") is not None and nbath != plan["baths"]: add("err", "bath count", f"asked for {plan['baths']}, plan has {nbath}"); errs += 1
    if plan.get("focus") not in (None, *FOCUS_VALUES): add("err", "focus value", str(plan.get("focus"))); errs += 1
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
    if plan.get("focus") in ("bedrooms", "lounge", "kitchen"):
        built = sum(r["w"] * r["d"] for r in mains)
        share = lambda ts: sum(r["w"] * r["d"] for r in mains if r["t"] in ts) / built
        f = plan["focus"]
        base = BED_BASE_SMALL if W * D / MARLA <= 6 else BED_BASE
        got, need = ((share({"bed", "master"}), base.get(nb, 0.57) + 0.04) if f == "bedrooms"
                     else (share({"lounge"}), 0.20) if f == "lounge" else (share({"kitchen"}), 0.10))
        add("ok" if got >= need else "warn", "bigger " + f, f"{got:.0%} of built area, wanted {need:.0%}")
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


def _overlap(a0, a1, b0, b1):
    return min(a1, b1) - max(a0, b0)


def _grid(rng, lo, hi):
    """A random length on the 0.5 ft grid in [lo, hi], or None when the range is empty."""
    a, b = -int(-lo * 2 // 1), int(hi * 2 // 1)
    return None if b < a else rng.randint(a, b) / 2


def generate_small(W, D, beds, rng, baths=None, focus="balanced", tries=40):
    """Compact layout for plots up to 6 marla, modelled on real 3-6 marla houses (for example Zameen's 25x50 plans: an
    11x15 garage beside a 12x12 drawing room, a 20x11 lounge with the stairs, 11x14 bedrooms with 5x8 baths, a 7x14
    kitchen and a 4-5 ft back yard). The car porch sits beside the drawing room in the front row and is the front open
    space, so only a short lawn strip is left in front of the house. Three rows (front / lounge / bedrooms) when the
    plot is deep enough, else two rows and one bedroom. The kitchen gets its window from the porch (behind it), the back
    yard or the front lawn. Widths are drawn from the ranges the plot allows; up to `tries` arrangements are tried."""
    if beds not in (1, 2): return None
    if baths is None: baths = beds + 1
    if not (beds <= baths <= beds + 2): return None
    for _ in range(tries):
        plan = _small_once(W, D, beds, rng, baths, focus)
        if plan: return plan
    return None


def _small_once(W, D, beds, rng, baths, focus):
    rule = rule_for(W, D)
    u = rng.uniform
    pick = lambda lo, hi: _grid(rng, lo, hi)
    r5 = lambda v: round(v * 2) / 2
    down = lambda v: int(v * 2 // 1) / 2
    up = lambda v: -int(-v * 2 // 1) / 2
    guest, common = baths >= beds + 1, baths >= beds + 2
    front_d = rule["front"]
    depth = D - front_d - rule["rear"]                               # the most the rooms can take
    three = depth >= 31 and (beds == 2 or rng.random() < 0.5)
    if beds == 2 and not three: return None
    porch = W >= 27 or (W >= 24 and rng.random() < (0.7 if three else 0.35))
    if three:
        opts = (["porch"] if porch and beds == 2 else []) + (["back"] if beds == 1 or W >= 29 else []) + (["front"] if not porch and beds == 2 else [])
    else:
        opts = ["back"] + ([] if porch else ["front"])
    if not opts: return None
    if focus == "lounge" and len(opts) > 1 and "porch" in opts: opts.remove("porch")    # keep the kitchen out of the lounge row
    kpos = rng.choice(opts)
    kx = r5(u(2, 3)) if focus == "kitchen" else 0.0                   # a bigger kitchen is wider

    # front row, entrance side on the left: [porch | kitchen] lobby [stairs] drawing
    pw = pick(9, 11) if porch else 0.0
    lw = pick(4.5, 5.5 if W >= 24 else 5)
    kf = 0.0
    if kpos == "front":
        kf = pick(6.5, min(8 + kx, W - pw - lw - 9))
        if kf is None: return None
    lob0 = pw + kf
    dw = W - lob0 - lw
    sf = pick(3.5, 4) if dw > 15.5 or (dw >= 14 and rng.random() < 0.4) else 0.0     # stair hall beside the entrance
    dw -= sf
    if not (9 <= dw <= 16): return None
    front = ([{"t": "porch", "w": pw}] if porch else []) + ([{"t": "kitchen", "w": kf}] if kf else []) + [{"t": "lobby", "w": lw}] \
        + ([{"t": "stairs", "w": sf}] if sf else []) + [{"t": "drawing", "w": dw}]

    # row depths: rooms about 11-14 ft deep like the real plans, tighter on tight plots; spare depth becomes back yard.
    # 'bigger X' gives the row that holds X the depth the other rows can spare; a narrow drawing room needs a deeper row
    slack = depth - (31 if three else 21.5)
    if slack < 0: return None
    g = lambda lo, span: r5(lo + u(0, max(0.0, min(span, slack * 0.45))))
    f_min = max(10.5, up(112 / dw))
    f = f_min if focus == "bedrooms" else max(g(10.5, 2.5), f_min)
    m = (10.0 if focus == "bedrooms" else r5(u(12, 13.5)) if focus == "lounge" else g(10, 2)) if three else 0.0
    b_want = 17.0 if focus == "bedrooms" else r5(u(11.5, 14) if three else u(12.5, 15))
    built_max = (rule["cover"] / 100 * W * D + pw * f) / W         # the porch is open, so it buys built depth
    b = min(b_want, down(D - front_d - rule["rear"] - f - m), down(built_max - f - m))
    if b < (10.5 if three else 11): return None
    rear = D - front_d - f - m - b

    def bed_bath(r, d, side):
        """Attached bath that leaves the room its minimum net area; a lone bedroom too small for 'master' is a 'bed'."""
        for t in ([r["t"], "bed"] if beds == 1 else [r["t"]]):
            for bb in ([4.5 if r["w"] < 11.5 else rng.choice([5, 5.5]), min(rng.choice([6.5, 7, 7.5]), d - 3)], [4.5, min(6.5, d - 3)]):
                if r["w"] * d - bb[0] * bb[1] >= MINSZ[t][0] + 0.5:
                    r["t"] = t
                    return bb + [side]
        return None

    if three:
        mid, km = [], 0.0
        if kpos == "porch":                                          # kitchen behind the porch: its window opens onto it
            km = pick(7, min(pw, (8 if focus == "lounge" else 9.5 + kx), lob0 + lw - 3.5))
            if km is None: return None
            mid.append({"t": "kitchen", "w": km})
        sw = pick(3.5, 4) if W >= 24 and not sf and focus != "lounge" and rng.random() < 0.6 else 0.0   # stairs rising from the lounge
        lounge_w = W - km - sw
        mid.append({"t": "lounge", "w": lounge_w})
        if sw: mid.append({"t": "stairs", "w": sw})
        l0, l1 = km, W - sw
        if lounge_w < 9 or _overlap(lob0, lob0 + lw, l0, l1) < 3.5: return None
        # back row: bedrooms (and the kitchen on wide or one-bedroom plots), each opening onto the lounge
        kb = 0.0
        if kpos == "back":
            kb = pick(max(7, W - 15 if beds == 1 else 7), (10.5 if beds == 1 else 9) + kx)
            if kb is None: return None
        rest = W - kb
        if beds == 2:
            a = pick(max(10, rest - 16), min(16, rest - 10))
            if a is None: return None
            ws = [a, rest - a]
        else:
            ws = [rest]
        if min(ws) < 10 or max(ws) > 16: return None
        kind = ["master", "bed"] if beds == 2 else ["master"]
        if beds == 2 and rng.random() < 0.5: kind.reverse(); ws.reverse()
        back = [{"t": t, "w": w} for t, w in zip(kind, ws)]
        if kb:
            back.insert(rng.choice([0, len(back)]), {"t": "kitchen", "w": kb})
        x = 0.0
        for r in back:
            if _overlap(x, x + r["w"], l0, l1) < 3.5: return None
            x += r["w"]
        shared = rng.random() < 0.7                                  # baths back to back on the shared wall (one plumbing stack)
        beds_back = [r for r in back if r["t"] in BEDS]
        for i, r in enumerate(beds_back):
            side = ("R" if i == 0 else "L") if shared else ("L" if i == 0 else "R")
            if len(beds_back) == 1:                                  # next to the kitchen: one wet wall
                ki = next((j for j, q in enumerate(back) if q["t"] == "kitchen"), None)
                side = ("L" if ki < back.index(r) else "R") if ki is not None else rng.choice("LR")
            r["bath"] = bed_bath(r, b, side)
            if r["bath"] is None: return None
        rows = [(f, front), (m, mid), (b, back)]
        lounge, lounge_d = mid[1] if km else mid[0], m
    else:
        # two rows, one bedroom: the lounge sits behind the lobby, the bedroom (and the kitchen) beside it
        kb = 0.0
        if kpos == "back":
            kb = pick(6.5, (7 if focus == "lounge" else 8.5) + kx)
        hi_b = 11 if focus == "lounge" else 14 if focus == "bedrooms" else 13
        lo_b = 12 if focus == "bedrooms" else 10
        if kb:
            order = rng.choice([["kitchen", "lounge", "master"], ["master", "lounge", "kitchen"]])
            bw_ = pick(lo_b, min(hi_b, W - kb - 8.5))
        else:                                                        # the lounge must reach 3.5 ft past the lobby's near edge
            order = rng.choice([["lounge", "master"], ["master", "lounge"]])
            bw_ = pick(lo_b, min(hi_b, W - max(8.5, lob0 + 3.5) if order[0] == "lounge" else lob0 + lw - 3.5))
        if bw_ is None: return None
        width = {"kitchen": kb, "lounge": W - kb - bw_, "master": bw_}
        back = [{"t": t, "w": width[t]} for t in order]
        x = 0.0
        for r in back:
            if r["t"] == "lounge" and (r["w"] < 8.5 or _overlap(x, x + r["w"], lob0, lob0 + lw) < 3.5): return None
            x += r["w"]
        bed = next(r for r in back if r["t"] == "master")
        bed["bath"] = bed_bath(bed, b, "L" if order.index("master") == 0 else "R")          # on the outer wall, door side free
        if bed["bath"] is None: return None
        rows = [(f, front), (b, back)]
        lounge, lounge_d = next(r for r in back if r["t"] == "lounge"), b

    drawing = front[-1]
    lounge_bath = lambda: [4.5, min(rng.choice([6, 6.5]), lounge_d - 3), rng.choice("LR")]
    lounge_fits = lambda bb: lounge["w"] >= 10 and lounge["w"] * lounge_d - bb[0] * bb[1] >= 102
    if guest:                                                        # guest washroom in the drawing room's back corner
        gb = [4.5, min(rng.choice([6, 6.5]), f - 3), "R"]
        if dw * f - gb[0] * gb[1] >= 112: drawing["bath"] = gb
        elif not common and lounge_fits(lb := lounge_bath()): lounge["bath"] = lb       # small drawing room: off the lounge instead
        else: return None
    if common:                                                       # common washroom off the lounge
        lb = lounge_bath()
        if lounge.get("bath") or not lounge_fits(lb): return None
        lounge["bath"] = lb

    plan = {"plot": {"w": W, "d": D}, "beds": beds, "baths": baths, "focus": focus,
            "bands": [{"d": front_d, "rooms": [{"t": "lawn", "w": W}]}] + [{"d": d_, "rooms": rs} for d_, rs in rows]
            + [{"d": rear, "rooms": [{"t": "void", "w": W}]}]}
    return mirror(plan) if rng.random() < 0.5 else plan


def generate(W, D, beds, rng, baths=None, focus="balanced"):
    """One randomised Pakistani-style layout: lawn / front band (drawing, lobby, guest beds) / middle band
    (kitchen, dining, lounge) / back band (bedrooms) / rear setback. Mirrors js/layout.js with jitter.
    baths = total washrooms (bedrooms + 0..2: attached to every bedroom, plus a guest bath, plus a common bath off the
    lounge). focus = which rooms get more of the built area (balanced / bedrooms / lounge / kitchen).
    Plots up to 6 marla use the compact layout (generate_small)."""
    if W * D / MARLA <= 6:
        return generate_small(W, D, beds, rng, baths, focus)
    rule = rule_for(W, D)
    s = rule["side"]
    Bw = W - 2 * s
    rear = max(rule["rear"], -(-(D - rule["front"] - rule["cover"] / 100 * W * D / Bw) * 2 // 1) / 2)   # more yard if over the coverage limit
    max_built = 46 if focus in ("bedrooms", "lounge") else 42        # real plans: rooms 13-15 ft deep, so houses are about 40 ft deep
    rear = max(rear, D - rule["front"] - max_built)                   # spare length becomes a back yard
    Bd = D - rule["front"] - rear
    narrow = Bw < 26
    k = 2 if Bw < 32 else 3 if Bw < 44 else 4                              # bedrooms in the back row: about 11-15 ft wide each (extra bedrooms go to the front row)
    nbeds = max(2, min(beds, 3 if narrow else k + 2))
    back, extra = min(nbeds, k), nbeds - min(nbeds, k)
    u = rng.uniform
    if baths is None: baths = nbeds + 1
    if not (nbeds <= baths <= nbeds + 2): return None
    guest, common = baths >= nbeds + 1, baths >= nbeds + 2
    if focus == "bedrooms": f, m = u(0.19, 0.25), u(0.19, 0.25)          # deep back band = bigger bedrooms
    elif focus == "lounge": f, m = u(0.21, 0.27), u(0.38, 0.44)          # deep middle band = bigger hall
    elif focus == "kitchen": f, m = u(0.22, 0.28), u(0.31, 0.37)
    else: f, m = u(0.27, 0.33), u(0.30, 0.37)                          # rooms about 13-15 ft deep, like the real plans
    depths = _split(Bd, [{"wt": f}, {"wt": m}, {"wt": 1 - f - m}])

    # front band
    lobby_w = round(min(8, max(5, Bw * 0.2)) * u(0.85, 1.2) * 2) / 2
    kinds = ["bed"] * extra + ["drawing"]
    pos = rng.choice(["left", "right"] + (["middle"] if extra else []))
    items = [{"k": k_, "wt": u(1.0, 1.25)} for k_ in kinds]
    lob = {"k": "lobby", "fixed": lobby_w}
    avail = Bw - lobby_w - extra * 10.5                                   # width left for the drawing room
    stairs_w = round(min(9.5, avail - u(14.5, 16.5)) * 2) / 2 if (not narrow and avail > 18.5) else 0
    if stairs_w >= 6:                                                      # stair hall: real drawing rooms are about 12-16 ft wide
        lob = {"k": "entry", "fixed": lobby_w + stairs_w}                  # lobby and stairs are placed together below
    else:
        stairs_w = 0
    if pos == "left": items = [lob] + items
    elif pos == "right": items = items + [lob]
    else: items.insert(rng.randint(1, len(items) - 1), lob)
    wid = _split(Bw, items)
    lob_i = next(i for i, it in enumerate(items) if it["k"] in ("lobby", "entry"))
    front = []
    for it, w in zip(items, wid):
        if it["k"] == "entry":                                             # lobby next to the stairs, stairs on the side away from the drawing room
            lw, sw = w - stairs_w, stairs_w
            pair = [{"t": "lobby", "w": lw}, {"t": "stairs", "w": sw}]
            front += pair if pos in ("left",) or (pos == "middle" and rng.random() < 0.5) else pair[::-1]
        else:
            front.append({"t": it["k"], "w": w})
    lob_i = next(i for i, r in enumerate(front) if r["t"] == "lobby")
    wid = [r["w"] for r in front]

    # back band: widths depend on the middle row (see make_back), so it is built inside the arrangement search below
    def make_back(left_ext, right_ext):
        """Bedrooms left to right. The widest (master) goes at the end with more kitchen/court below it, and the end bedrooms
        are made wide enough to overhang that non-living part by 3.5 ft, so every bedroom can open onto the lounge or dining room."""
        n = back
        master_left = left_ext > right_ext or (left_ext == right_ext and rng.random() < 0.5)
        wts_b = [u(1.15, 1.4)] + [u(0.9, 1.1) for _ in range(n - 1)]           # master first
        widths = _split(Bw, [{"wt": w} for w in wts_b])
        names = ["master"] + ["bed"] * (n - 1)
        if not master_left: names.reverse(); widths.reverse()
        up = lambda v: -(-v * 2 // 1) / 2                                        # round up to the 0.5 ft grid
        need_l = up(left_ext + 3.5) if left_ext > 0 else 0
        need_r = up(right_ext + 3.5) if right_ext > 0 else 0
        w0 = max(widths[0], need_l)
        if n == 2:
            w1 = Bw - w0
            ws = [w0, w1]
        else:
            w_last = max(widths[-1], need_r)
            mids = _split(Bw - w0 - w_last, [{"wt": 1}] * (n - 2))
            ws = [w0] + mids + [w_last]
        if abs(sum(ws) - Bw) > 0.01 or min(ws) < 8.5 or ws[-1] < need_r: return None
        return [{"t": t, "w": w} for t, w in zip(names, ws)]

    # middle band
    court = s == 0 or rng.random() < 0.2     # light well: the only window source for the kitchen on plots with no side yards
    for _ in range(60):
        mid = ["kitchen", "dining", "lounge"] + (["courtyard"] if court else [])
        rng.shuffle(mid)
        if narrow or rng.random() < 0.28: mid.remove("dining")
        kw, lw = (u(0.30, 0.40), u(0.40, 0.50)) if focus == "kitchen" else (u(0.20, 0.26), u(0.52, 0.62)) if focus == "lounge" else (u(0.24, 0.32), u(0.42, 0.54))
        wts = {"kitchen": kw, "dining": u(0.26, 0.34), "lounge": lw} if "dining" in mid else {"kitchen": min(kw + 0.08, 0.46) if focus != "lounge" else u(0.26, 0.32), "lounge": u(0.62, 0.72) if focus != "kitchen" else u(0.54, 0.62)}
        wts["courtyard"] = 0.0
        cw = round(u(4, 5.5) * 2) / 2
        mw = _split(Bw, [{"fixed": cw} if t == "courtyard" else {"wt": wts[t]} for t in mid])
        pairs = list(zip(mid, mw))
        ext = lambda seq: next((i for i, (t, _) in enumerate(seq) if t in ("lounge", "dining")), len(seq))
        li, ri = ext(pairs), ext(pairs[::-1])
        backb = make_back(sum(w for _, w in pairs[:li]), sum(w for _, w in pairs[::-1][:ri]))
        if backb is None: continue
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
        big = Bw >= 38
        r["bath"] = [4.5 if r["w"] < 11 else rng.choice([5.5, 6] if big else [5, 5.5]), min(rng.choice([7.5, 8, 8.5] if big else [7, 7.5, 8]), depths[2] - 3), sd]
    for i, r in enumerate(front):
        if r["t"] in ("bed", "drawing"):
            if r["t"] == "drawing" and not guest: continue                   # no guest washroom requested
            away = "L" if i > lob_i else "R"
            r["bath"] = ([4.5 if r["w"] < 11 else 5, min(rng.choice([6.5, 7]), depths[0] - 3), away] if r["t"] == "bed"
                         else [4.5, min(rng.choice([6, 6.5, 7]), depths[0] - 3), away])

    if common:                                                              # common washroom, entered from the lounge
        lo = next(r for r in middle if r["t"] == "lounge")
        if lo["w"] < 11: return None
        lo["bath"] = [rng.choice([4.5, 5]), min(rng.choice([6, 6.5, 7]), depths[1] - 3), rng.choice("LR")]

    pad = [{"t": "void", "w": s}] if s else []
    front_row = [{"t": "lawn", "w": W}]
    if W >= 25 and rule["front"] >= 8 and rng.random() < 0.75:             # car porch in front of the entrance side
        pw = round(min(11, W * 0.4) * u(0.9, 1.05) * 2) / 2
        cx = s + sum(wid[:lob_i]) + wid[lob_i] / 2                          # centre of the lobby across the plot
        x0 = min(max(round((cx - pw / 2) * 2) / 2, 0), W - pw)
        front_row = [r for r in ({"t": "lawn", "w": x0}, {"t": "porch", "w": pw}, {"t": "lawn", "w": W - x0 - pw}) if r["w"] > 0]
    bands = [{"d": rule["front"], "rooms": front_row}]
    for d_, rooms in zip(depths, (front, middle, backb)):
        bands.append({"d": d_, "rooms": pad + rooms + pad})
    bands.append({"d": rear, "rooms": [{"t": "void", "w": W}]})
    return {"plot": {"w": W, "d": D}, "beds": nbeds, "baths": baths, "focus": focus, "bands": bands}


WIDTHS = [20, 22, 24, 25, 26, 27, 28, 30, 30, 32, 33, 35, 35, 36, 38, 40, 42, 45, 50, 50, 55, 60]


# the plot sizes people actually type (marla presets and their usual shapes): oversampled, and never held out of training
STANDARD = [(20, 34), (25, 36), (25, 45), (30, 45), (30, 52), (30, 60), (35, 65), (38, 59), (40, 68), (40, 80), (45, 95), (50, 90), (55, 100)]
SIZE_BINS = {"small": (3, 6), "mid": (6, 14), "large": (14, 45)}      # marla
SIZE_MIX = {"small": 0.22, "mid": 0.43, "large": 0.35}                 # share of plots per bin, so small plots are not drowned out


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
        std = [(w, d) for w, d in STANDARD if size_bin is None or SIZE_BINS[size_bin][0] < w * d / MARLA <= SIZE_BINS[size_bin][1]]
        W, D = rng.choice(std) if std and rng.random() < 0.3 else sample_plot(rng, size_bin)
        cap, lo = max_beds(W, D), min_beds(W, D)
        if cap == 0: continue                                                  # too small for a single floor: the form refuses it
        beds = rng.randint(lo, cap if lo == 1 or rng.random() < 0.7 else 6)       # mostly counts a single floor can hold
        if lo == 1 and cap == 2 and rng.random() < 0.5: beds = 2               # small plots: 2 bedrooms is the usual request
        baths = min(beds + rng.choice([0, 1, 1, 2]), max_baths(W, D, beds))   # a guest washroom is the usual case
        focus = rng.choices(FOCUS_VALUES, [0.4, 0.2, 0.2, 0.2])[0]
        for _ in range(12):
            plan = generate(W, D, beds, rng, baths, focus)
            if plan is None or plan["beds"] != beds:         # generator clamps; only keep what was actually asked for
                continue
            cs = check(plan, plan["beds"])
            if score(cs) >= min_score: break
            rej.update(failed(cs))
        else:
            infeasible[(W, D, beds, baths, focus)] += 1
            continue
        txt = serialize(plan)
        if txt in seen: continue
        seen.add(txt)
        if size_bin: got[size_bin] += 1
        rows.append({"prompt": prompt_for(W, D, plan["beds"], baths, focus), "baths": baths, "focus": focus, "completion": txt.split("\n", 1)[1], "plot": [W, D], "beds": plan["beds"],
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
        plots = [p for p in plots if p not in STANDARD] + [p for p in plots if p in STANDARD]     # standard sizes go last: they stay in training
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
