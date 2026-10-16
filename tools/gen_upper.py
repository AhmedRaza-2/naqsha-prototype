"""First floors of two-storey houses, written as slicing trees inside the ground floor's built box (tools/tree.py).

The stairs come up where the ground floor's stairs are, so the box is first cut at the stairs: the band the stairs sit
in (as deep as the stairs), then the bands in front of and behind it. A family lounge is the hub, at the landing: a band
just behind or in front of the stairs, or the wider piece beside the stairs. Bedrooms (each with its washroom) sit in a
band that opens onto the lounge, beside the stairs, or beside the lounge on wide houses. Depth the bedrooms do not need
is left as an open terrace (the ground floor's roof), at the front or the back, as in most Pakistani houses.

    python tools/gen_upper.py probe        # how often a ground floor with stairs gets a first floor that passes
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bands, tree  # noqa: E402

r5 = lambda v: round(v * 2) / 2


def R(t, bath=None):
    return {"k": "room", "t": t, **({"bath": bath} if bath else {})}


def cuts(k, parts):
    """parts: [(size, node)] -> one node; the last size is implicit."""
    parts = [(s, n) for s, n in parts if s > 0.01]
    merged = []                                             # neighbouring terraces are one terrace
    for s, n in parts:
        if merged and n.get("t") == "terrace" and merged[-1][1].get("t") == "terrace": merged[-1] = (merged[-1][0] + s, merged[-1][1])
        else: merged.append((s, n))
    parts = merged
    if len(parts) == 1: return parts[0][1]
    return {"k": k, "sizes": [r5(s) for s, _ in parts[:-1]], "kids": [n for _, n in parts]}


def box_and_stairs(ground):
    """(box {x,y,w,d} on the plot, stairs {x,y,w,d} inside the box) of a ground floor, or None without stairs."""
    rects = tree.to_rects(ground)
    mains = [r for r in rects if r["t"] not in bands.OPEN and "parent" not in r]
    st = next((r for r in mains if r["t"] == "stairs"), None)
    if st is None: return None
    x0, y0 = min(r["x"] for r in mains), min(r["y"] for r in mains)
    x1, y1 = max(r["x"] + r["w"] for r in mains), max(r["y"] + r["d"] for r in mains)
    box = {"x": x0, "y": y0, "w": round(x1 - x0, 2), "d": round(y1 - y0, 2)}
    up = {"x": round(st["x"] - x0, 2), "y": round(st["y"] - y0, 2), "w": st["w"], "d": st["d"]}
    return box, up


def bed_bath(w, d, side, rng):
    return [4.5 if w < 11.5 else rng.choice([5, 5.5]), min(rng.choice([6.5, 7, 7.5]), d - 4), side]


def row_of_rooms(width, depth, n, rng, outer_open):
    """n rooms side by side across a band: list of (width, kind) with kind 'bed' (bedroom slot) or 'terrace' / 'study'
    for spare width. Bedrooms 11-16 ft wide."""
    if n <= 0: return [(width, "terrace" if outer_open else "study")]
    ws = [r5(rng.uniform(11.5, 15.5)) for _ in range(n)]
    spare = width - sum(ws)
    if spare < 0:
        ws = [r5(width / n)] * (n - 1) + [width - r5(width / n) * (n - 1)]
        if min(ws) < 11: return None
        return [(w, "bed") for w in ws]
    if spare < 6:                                           # a little spare width: the bedrooms are wider
        ws[-1] += spare
        return [(w, "bed") for w in ws]
    out = [(w, "bed") for w in ws]
    kind = "study" if spare <= 13 and (not outer_open or rng.random() < 0.5) else "terrace"
    out.insert(rng.choice([0, len(out)]), (spare, kind))  # at an end of the row, never between two rooms
    return out


def upper(ground, rng, beds, baths):
    """A first floor for `ground` (a slicing-tree plan with stairs): plan dict or None."""
    bs = box_and_stairs(ground)
    if bs is None: return None
    box, up = bs
    bw, bd = box["w"], box["d"]
    f, k = up["y"], round(bd - up["y"] - up["d"], 2)
    left, right = up["x"], round(bw - up["x"] - up["w"], 2)
    if 0.01 < left < 4.5 or 0.01 < right < 4.5: return None             # a sliver beside the stairs
    if 0.01 < f < 3 or 0.01 < k < 3: return None
    hubs = (["back"] if k >= 10 else []) + (["front"] if f >= 10 else []) + (["mid"] if max(left, right) >= 9 else [])
    if not hubs: return None
    hub = rng.choice(hubs)
    slots = []                                              # bedroom slots: [node, width, depth]; filled in at the end

    def bed_slot(w, d):
        n = R("bed"); slots.append([n, w, d]); return n

    def side_piece(w, d, kind):
        if w <= 0.01: return None
        if kind == "lounge": return R("lounge")
        if w >= 11 and d >= 11: return bed_slot(w, d)
        return R("store" if rng.random() < 0.5 else "study") if w >= 6 else R("store")

    # the stairs band: [left] stairs [right]
    lounge_side = None
    if hub == "mid": lounge_side = "L" if left >= right else "R"
    mid = cuts("V", [(left, side_piece(left, up["d"], "lounge" if lounge_side == "L" else None)), (up["w"], R("stairs")),
                     (right, side_piece(right, up["d"], "lounge" if lounge_side == "R" else None))])

    # where the lounge is across the box: bedrooms beyond the stairs band must overlap it to open onto it
    reach = [None]
    if hub == "mid":
        reach[0] = (0, left) if lounge_side == "L" else (bw - right, bw)

    def hub_band(hd):
        """The lounge across the band, over the stairs; on wide houses a bedroom beside it (the far side)."""
        if bw <= 34:
            reach[0] = (0, bw)
            return [(bw, R("lounge"))]
        sx0, sx1 = up["x"], up["x"] + up["w"]
        lw = r5(max(rng.uniform(17, 23), (sx1 + 1) if sx0 + sx1 < bw else (bw - sx0 + 1)))
        rest = bw - lw
        if rest < 11: reach[0] = (0, bw); return [(bw, R("lounge"))]
        if rng.random() < 0.5:                              # a hall beside the lounge: the rooms behind open onto it
            reach[0] = (0, bw)
            hall = R("passage")
            return [(lw, R("lounge")), (rest, hall)] if sx0 + sx1 < bw else [(rest, hall), (lw, R("lounge"))]
        far = bed_slot(rest, hd)
        if sx0 + sx1 < bw:                                  # stairs on the left: lounge on the left
            reach[0] = (0, lw); return [(lw, R("lounge")), (rest, far)]
        reach[0] = (rest, bw); return [(rest, far), (lw, R("lounge"))]

    def side(depth, with_hub):
        """Bands on one side of the stairs band, nearest first: [(depth, node)]. Bedrooms that could not reach the
        lounge are not drawn: that depth stays open terrace."""
        if depth <= 0.01: return []
        out = []
        if with_hub:
            hd = r5(rng.uniform(10.5, 13.5))
            rem = depth - hd
            if rem < 3: hd, rem = depth, 0
            out.append((hd, cuts("V", hub_band(hd))))
            depth = rem
            if depth <= 0.01: return out
        lounge_next = with_hub or hub == "mid"
        if depth >= 12 and lounge_next and len(slots) < beds + 1:
            dd = min(depth, r5(rng.uniform(12.5, 16)))
            if depth - dd < 3: dd = depth
            a, b = reach[0]
            if b - a >= bw - 8: a, b = 0, bw                 # a room at the end still shares 3+ ft of wall with the lounge
            span = b - a
            want = max(1, min(round(span / 13.5), beds - len(slots)))
            row = row_of_rooms(span, dd, want, rng, True)
            if row is None: return None
            parts = [(w, bed_slot(w, dd) if kind == "bed" else R(kind)) for w, kind in row]
            parts = ([(a, R("terrace"))] if a > 0.01 else []) + parts + ([(bw - b, R("terrace"))] if bw - b > 0.01 else [])
            out.append((dd, cuts("V", parts)))
            depth -= dd
        if depth > 0.01:
            if depth < 3: return None
            out.append((depth, R("terrace")))
        return out

    front = side(f, hub == "front")
    back = side(k, hub == "back")
    if front is None or back is None: return None
    bands_ = front[::-1] + [(up["d"], mid)] + back
    local = cuts("H", bands_)

    # bedrooms: as many slots as asked become bedrooms (master = the biggest), the rest studies or terrace
    if len(slots) < beds: return None
    slots.sort(key=lambda s: -s[1] * s[2])
    for i, (node, w, d) in enumerate(slots):
        if i < beds:
            node["t"] = "master" if i == 0 else "bed"
            node["bath"] = bed_bath(w, d, rng.choice("LR"), rng)
        else:
            node["t"] = "study"
    extra = baths - beds
    if extra < 0 or extra > 1: return None
    if extra:                                                # a common washroom off the lounge
        lounges = []
        def find(n):
            if n["k"] == "room":
                if n["t"] == "lounge": lounges.append(n)
            else:
                for c in n["kids"]: find(c)
        find(local)
        if not lounges: return None
        lounges[0]["bath"] = [rng.choice([4.5, 5]), 6, rng.choice("LR")]
    W, D = ground["plot"]["w"], ground["plot"]["d"]
    plan = {"plot": {"w": W, "d": D}, "floor": 1, "box": box, "up": up, "beds": beds, "baths": baths,
            "tree": tree.wrap(W, D, box, local)}
    return plan


def _probe():
    import json
    from collections import Counter
    rows = [json.loads(l) for l in open("data/pk12/train.jsonl", encoding="utf-8")]
    rng = random.Random(1)
    ground = [r for r in rows if "stairs" in r["completion"]]
    rng.shuffle(ground)
    by, fails = Counter(), Counter()
    for r in ground[:600]:
        g = tree.parse(r["prompt"] + "\n" + r["completion"])
        fam = r["style"]
        by[(fam, "tried")] += 1
        for _ in range(20):
            beds = rng.randint(1, 4)
            p = upper(g, rng, beds, beds + rng.choice([0, 1]))
            if p is None: continue
            cs = tree.check(p, beds)
            if tree.score(cs) == 1:
                by[(fam, "ok")] += 1
                break
            fails.update(c[1] for c in cs if c[0] != "ok")
    for fam in sorted({k[0] for k in by}):
        print(f"{fam:9s} {by[(fam, 'ok')]}/{by[(fam, 'tried')]} ground floors got a perfect first floor")
    print("most common failures:", fails.most_common(6))


if __name__ == "__main__":
    if sys.argv[1:] == ["probe"]: _probe()
    elif sys.argv[1:2] == ["show"]:
        import json
        rows = [json.loads(l) for l in open("data/pk12/train.jsonl", encoding="utf-8") if "stairs" in l]
        rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
        r = rng.choice(rows)
        g = tree.parse(r["prompt"] + "\n" + r["completion"])
        for _ in range(50):
            p = upper(g, rng, 2, 3)
            if p: break
        print(r["prompt"]); print(tree.serialize(p) if p else "no first floor")
        if p:
            for c in tree.check(p, 2): print(" ", c)
