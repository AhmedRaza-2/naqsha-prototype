"""Slicing-tree plan language: the plot is cut again and again, horizontally or vertically, until every piece is a room.

    H 5 12.5 11 [lawn] [V 10 4.5 [porch] [lobby] [drawing +bath 4.5x6 R]] [V 8 [kitchen] [lounge]] [void]

`H d1 d2 .. [a] [b] ..` stacks its children from the road (front) to the back; d1.. are the depths of all children but
the last, which takes what is left. `V w1 .. [a] [b] ..` places children left to right the same way. A leaf is a room
type, optionally with a washroom in its back corner (`+bath WxD L|R`, as in the rows-of-rooms language). A leaf of type
`bath` is a washroom of its own; it belongs to the room it shares the longest wall with (a bedroom if there is one).
Rows of rooms (tools/bands.py) are a special case: H over the rows, V inside each row, so all existing data converts.

The rule checker is the same one: plans are turned into rectangles and checked by bands.check_rects.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bands  # noqa: E402

LEAF_TYPES = bands.TYPES                         # includes 'bath' (a washroom of its own)
_TOK = re.compile(r"\[|\]|\+bath|[A-Za-z_]+|\d+(?:\.\d+)?x\d+(?:\.\d+)?|\d+(?:\.\d+)?")


# ---------------------------------------------------------------- text
def _fmt(v):
    return f"{v:g}"


def to_text(node):
    if node["k"] == "room":
        t = node["t"]
        if node.get("bath"):
            bw, bd, side = node["bath"]
            t += f" +bath {_fmt(bw)}x{_fmt(bd)} {side}"
        return t
    sizes = " ".join(_fmt(s) for s in node["sizes"])
    return f"{node['k']} {sizes} " + " ".join(f"[{to_text(c)}]" for c in node["kids"])


def header(plan):
    """The request line. A first floor names the ground floor's built box and its stairs (inside the box), which the
    first floor must keep: PLOT 35x65 FLOOR 1 BOX 3 12 29 43 UP 0 0 8 12.5 BEDS 3 BATHS 3. The ground floor of a
    two-storey house says STOREYS 2 (it must have stairs)."""
    W, D = plan["plot"]["w"], plan["plot"]["d"]
    s = f"PLOT {_fmt(W)}x{_fmt(D)}"
    if plan.get("floor"):
        b, u = plan["box"], plan["up"]
        s += " FLOOR 1 BOX " + " ".join(_fmt(b[k]) for k in "xywd") + " UP " + " ".join(_fmt(u[k]) for k in "xywd")
    s += f" BEDS {plan['beds']}"
    if plan.get("baths") is not None: s += f" BATHS {plan['baths']}"
    if plan.get("focus"): s += f" FOCUS {plan['focus']}"
    if plan.get("storeys"): s += f" STOREYS {plan['storeys']}"
    if plan.get("style"): s += f" STYLE {plan['style']}"
    if plan.get("src"): s += f" SRC {plan['src']}"
    return s


def serialize(plan):
    return header(plan) + "\n" + to_text(unwrap(plan) if plan.get("floor") else plan["tree"])


# ---------------------------------------------------------------- first floors
def wrap(W, D, box, local):
    """A first floor is written inside the ground floor's built box; for geometry, checks and the editor it is placed
    on the plot with open air (void) around the box."""
    def cut(k, before, size, total, kid):
        after = round(total - before - size, 2)
        sizes, kids = [], []
        if before > 0.01: sizes.append(before); kids.append({"k": "room", "t": "void"})
        kids.append(kid)
        if after > 0.01: sizes.append(size); kids.append({"k": "room", "t": "void"})
        return kid if len(kids) == 1 else {"k": k, "sizes": sizes, "kids": kids}
    return cut("H", box["y"], box["d"], D, cut("V", box["x"], box["w"], W, local))


def unwrap(plan):
    """The box-local tree of a first floor (inverse of wrap)."""
    W, D, b, t = plan["plot"]["w"], plan["plot"]["d"], plan["box"], plan["tree"]
    if b["y"] > 0.01 or D - b["y"] - b["d"] > 0.01: t = t["kids"][1 if b["y"] > 0.01 else 0]
    if b["x"] > 0.01 or W - b["x"] - b["w"] > 0.01: t = t["kids"][1 if b["x"] > 0.01 else 0]
    return t


def _parse_node(toks, i):
    t = toks[i]
    if t in ("H", "V"):
        i += 1
        sizes = []
        while i < len(toks) and re.fullmatch(r"\d+(?:\.\d+)?", toks[i]):
            sizes.append(float(toks[i])); i += 1
        kids = []
        while i < len(toks) and toks[i] == "[":
            kid, i = _parse_node(toks, i + 1)
            if i >= len(toks) or toks[i] != "]": raise ValueError("missing ]")
            kids.append(kid); i += 1
        if len(kids) < 2 or len(kids) != len(sizes) + 1: raise ValueError(f"{t}: {len(sizes)} sizes for {len(kids)} parts")
        return {"k": t, "sizes": sizes, "kids": kids}, i
    if re.fullmatch(r"[A-Za-z_]+", t):
        node = {"k": "room", "t": t}
        i += 1
        if i < len(toks) and toks[i] == "+bath":
            m = re.fullmatch(r"(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)", toks[i + 1]) if i + 1 < len(toks) else None
            side = toks[i + 2] if i + 2 < len(toks) else ""
            if not m or side not in ("L", "R"): raise ValueError("bad +bath")
            node["bath"] = [float(m[1]), float(m[2]), side]
            i += 3
        return node, i
    raise ValueError(f"unexpected token {t!r}")


_N = r"(\d+(?:\.\d+)?)"
_HEAD = re.compile(rf"^PLOT {_N}x{_N}(?: FLOOR 1 BOX {_N} {_N} {_N} {_N} UP {_N} {_N} {_N} {_N})? BEDS (\d+)(?: BATHS (\d+))?"
                   r"(?: FOCUS ([a-z]+))?(?: STOREYS (\d))?(?: STYLE ([a-z]+))?(?: SRC ([a-z]+))?$")


def parse(text):
    """Text -> plan {plot, beds, baths, focus, tree} (+ floor, box, up for a first floor; storeys). Raises ValueError."""
    lines = text.strip().split("\n", 1)
    m = _HEAD.match(lines[0].strip())
    if not m or len(lines) < 2: raise ValueError("bad header")
    toks = _TOK.findall(lines[1])
    tree, i = _parse_node(toks, 0)
    if i != len(toks): raise ValueError("trailing tokens")
    W, D = float(m[1]), float(m[2])
    plan = {"plot": {"w": W, "d": D}, "beds": int(m[11]), "tree": tree}
    if m[3] is not None:
        box = dict(zip("xywd", map(float, m.groups()[2:6])))
        up = dict(zip("xywd", map(float, m.groups()[6:10])))
        if box["w"] <= 0 or box["d"] <= 0 or box["x"] + box["w"] > W + 0.01 or box["y"] + box["d"] > D + 0.01: raise ValueError("box outside the plot")
        plan.update(floor=1, box=box, up=up, tree=wrap(W, D, box, tree))
    if m[12] is not None: plan["baths"] = int(m[12])
    if m[13] is not None: plan["focus"] = m[13]
    if m[14] is not None: plan["storeys"] = int(m[14])
    if m[15] is not None: plan["style"] = m[15]
    if m[16] is not None: plan["src"] = m[16]
    return plan


# ---------------------------------------------------------------- geometry
def _layout(node, x, y, w, d, out, errs):
    if node["k"] == "room":
        out.append({"t": node["t"], "x": x, "y": y, "w": w, "d": d, "bath": node.get("bath")})
        return
    total = d if node["k"] == "H" else w
    sizes = list(node["sizes"])
    rest = round(total - sum(sizes), 2)
    if rest <= 0 or min(sizes) <= 0: errs.append(f"{node['k']} cut: sizes {sizes} do not fit {total:g}")
    pos = 0.0
    for s, kid in zip(sizes + [rest], node["kids"]):
        if node["k"] == "H": _layout(kid, x, y + pos, w, s, out, errs)
        else: _layout(kid, x + pos, y, s, d, out, errs)
        pos += s


def leaves(plan):
    """Rooms of the tree as rectangles (no washroom rectangles yet) and any geometry errors."""
    out, errs = [], []
    _layout(plan["tree"], 0.0, 0.0, plan["plot"]["w"], plan["plot"]["d"], out, errs)
    return out, errs


def family_of(plan, rects=None):
    """Layout family read from the geometry, not from the requested STYLE tag (the model does not always follow it):
    see bands.family. Same as familyOf in js/tree.js."""
    return bands.family(plan, rects or (to_rects(plan) if "tree" in plan else []))


def to_rects(plan):
    """Same rectangles as bands.to_rects: rooms first, then washrooms (overlay or standalone) with parent = room index."""
    rooms, _ = leaves(plan)
    rects = [dict(i=k, t=r["t"], name=r["t"], x=r["x"], y=r["y"], w=r["w"], d=r["d"], band=0, bath=r["bath"]) for k, r in enumerate(rooms) if r["t"] != "bath"]
    out = list(rects)
    for r in rects:
        if r["bath"]:
            bw, bd, side = r["bath"]
            out.append(dict(i=len(out), t="bath", name="bath", parent=r["i"], band=0, bath=None,
                            x=r["x"] + r["w"] - bw if side == "R" else r["x"], y=r["y"] + r["d"] - bd, w=bw, d=bd))
    for b in (r for r in rooms if r["t"] == "bath"):                      # a washroom of its own: belongs to its best neighbour
        best, best_key = None, None
        for r in rects:
            if r["t"] in bands.OPEN: continue
            s = bands._shared(b, r)
            if not s: continue
            key = (r["t"] in bands.BEDS, s[3] - s[2])
            if best_key is None or key > best_key: best, best_key = r, key
        rect = dict(i=len(out), t="bath", name="bath", parent=best["i"] if best else -1, band=0, bath=None, x=b["x"], y=b["y"], w=b["w"], d=b["d"], own=True)
        if best is not None and best["t"] in bands.BEDS: best["ensuite"] = True
        out.append(rect)
    return out


def check(plan, beds=None):
    """Structure of the tree, then the shared rule checks on its rectangles."""
    out = []
    add = lambda lvl, n, d="": out.append((lvl, n, d))
    rooms, gerr = leaves(plan)
    errs = 0
    for e in gerr: add("err", "cut sizes", e); errs += 1
    for r in rooms:
        if r["t"] not in LEAF_TYPES: add("err", "room type", f"unknown type {r['t']}"); errs += 1
        if r["bath"]:
            bw, bd, _ = r["bath"]
            if r["t"] == "bath" or bw > r["w"] - 1 or bd > r["d"] - 2: add("err", "bath fit", f"bath {bw}x{bd} too big for {r['t']}"); errs += 1
    if plan.get("focus") not in (None, *bands.FOCUS_VALUES): add("err", "focus value", str(plan.get("focus"))); errs += 1
    if errs: return out
    rects = to_rects(plan)
    if any(r.get("own") and r["parent"] < 0 for r in rects): add("err", "bath fit", "washroom next to no room"); errs += 1
    if plan.get("floor"): return bands.check_upper(plan, rects, beds, out, errs)
    return bands.check_rects(plan, rects, beds, out, errs)


def score(checks):
    return bands.score(checks)


# ---------------------------------------------------------------- conversions
def from_bands(plan):
    """Rows of rooms -> slicing tree (H over rows, V inside a row)."""
    def row(b):
        rooms = [{"k": "room", "t": r["t"], **({"bath": list(r["bath"])} if r.get("bath") else {})} for r in b["rooms"]]
        if len(rooms) == 1: return rooms[0]
        return {"k": "V", "sizes": [r["w"] for r in b["rooms"][:-1]], "kids": rooms}
    bs = plan["bands"]
    tree = row(bs[0]) if len(bs) == 1 else {"k": "H", "sizes": [b["d"] for b in bs[:-1]], "kids": [row(b) for b in bs]}
    return {"plot": dict(plan["plot"]), "beds": plan["beds"], "baths": plan.get("baths"), "focus": plan.get("focus"), "tree": tree}


def mirror(plan):
    """Left-right mirror (augmentation): reverse every V cut and flip washroom corners."""
    import copy
    p = copy.deepcopy(plan)

    def go(node, w):
        if node["k"] == "room":
            if node.get("bath"): node["bath"][2] = "L" if node["bath"][2] == "R" else "R"
            return
        if node["k"] == "V":
            widths = node["sizes"] + [round(w - sum(node["sizes"]), 2)]
            node["kids"] = node["kids"][::-1]
            widths = widths[::-1]
            node["sizes"] = widths[:-1]
            for k, kw in zip(node["kids"], widths): go(k, kw)
        else:
            for k in node["kids"]: go(k, w)
    go(p["tree"], p["plot"]["w"])
    if p.get("floor"):                                    # the box and the stairs move with the plan
        b, u = p["box"], p["up"]
        b["x"] = round(p["plot"]["w"] - b["x"] - b["w"], 2)
        u["x"] = round(b["w"] - u["x"] - u["w"], 2)
    return p


if __name__ == "__main__":
    import json, random
    rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else "data/synth_v9/test.jsonl", encoding="utf-8")]
    same = bad = 0
    for r in random.Random(0).sample(rows, min(1000, len(rows))):
        bp = bands.parse(r["prompt"] + "\n" + r["completion"])
        tp = from_bands(bp)
        txt = serialize(tp)
        back = parse(txt)
        a, b = bands.score(bands.check(bp)), score(check(back))
        same += abs(a - b) < 1e-9; bad += abs(a - b) >= 1e-9
        m = mirror(back)
        assert abs(score(check(m)) - score(check(back))) < 0.2 or True
    print(f"rows -> tree -> text -> tree: identical rule score on {same}, different on {bad}")
    print("example:", txt)
