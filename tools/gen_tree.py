"""More Pakistani layout families, written directly as slicing trees (tools/tree.py).

The rows-of-rooms generator (bands.generate) has one arrangement: drawing + entrance in front, kitchen + lounge in the
middle, bedrooms at the back. These families add common real arrangements so the model sees more than one structure:

  corridor  a corridor runs from the entrance lobby along one side; drawing room, kitchen and lounge are stacked
            beside it and two bedrooms share the back row (one off the lounge, one at the end of the corridor).
            Narrow 6-14 marla plots (25-35 ft wide), the case the rows layout handles worst.
  wing      a central corridor from the lobby: public rooms (drawing, lounge, dining, kitchen) on one side and a
            private wing of bedrooms on the other. 10 marla and up.

Every room keeps a window on a side yard, the lawn or the back yard, and every room opens onto the corridor, the lobby
or the lounge, so plans can pass all the rule checks; bands.check_rects decides.

    python tools/gen_tree.py probe        # acceptance per plot size and family
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bands, tree  # noqa: E402

FAMILIES = ("corridor", "wing")


def R(t, bath=None):
    return {"k": "room", "t": t, **({"bath": bath} if bath else {})}


def H(sizes, kids):
    return {"k": "H", "sizes": [round(s * 2) / 2 for s in sizes], "kids": kids}


def V(sizes, kids):
    return {"k": "V", "sizes": [round(s * 2) / 2 for s in sizes], "kids": kids}


def split(total, weights):
    """Lengths on the 0.5 ft grid in proportion to weights; the last one takes the rounding."""
    s = sum(weights)
    out, acc = [], 0.0
    for w in weights[:-1]:
        v = round(total * w / s * 2) / 2
        out.append(v); acc += v
    out.append(round((total - acc) * 2) / 2)
    return out


def frame(W, D, rng, focus):
    """Setbacks and the built box: (rule, side, front depth, built width, built depth, rear depth) or None."""
    rule = bands.rule_for(W, D)
    s = rule["side"]
    if s == 0: return None                                 # these families need side yards for windows
    Bw = W - 2 * s
    rear = rule["rear"] + rng.choice([0, 0.5, 1, 1.5])
    max_built = (rule["cover"] / 100 * W * D) / Bw
    Bd = min(D - rule["front"] - rear, round(max_built * 2) // 2 / 1)
    rear = D - rule["front"] - Bd
    if Bd < 30: return None
    return rule, s, rule["front"], Bw, Bd, rear


def front_row(W, rule, rng, lobby_center):
    """Front lawn, with a car porch in front of the entrance on wider plots (like the rows layout)."""
    if W >= 25 and rng.random() < 0.75:
        pw = round(min(11, W * 0.4) * rng.uniform(0.9, 1.05) * 2) / 2
        x0 = min(max(round((lobby_center - pw / 2) * 2) / 2, 0), W - pw)
        parts = [(t, w) for t, w in (("lawn", x0), ("porch", pw), ("lawn", W - x0 - pw)) if w > 0]
        if len(parts) > 1: return V([w for _, w in parts[:-1]], [R(t) for t, _ in parts])
    return R("lawn")


def wrap(W, D, beds, baths, focus, rule, s, front, Bw, Bd, rear, core, lobby_center, rng):
    body = V([s, Bw], [R("void"), core, R("void")])
    plan = {"plot": {"w": W, "d": D}, "beds": beds, "baths": baths, "focus": focus,
            "tree": H([front, Bd], [front_row(W, rule, rng, s + lobby_center), body, R("void")])}
    return tree.mirror(plan) if rng.random() < 0.5 else plan


def bed_bath(w, d, side, rng):
    return [4.5 if w < 11.5 else rng.choice([5, 5.5]), min(rng.choice([7, 7.5, 8]), d - 3), side]


def corridor(W, D, beds, rng, baths, focus):
    f = frame(W, D, rng, focus)
    if not f or beds != 2: return None
    rule, s, front, Bw, Bd, rear = f
    if not (18 <= Bw <= 29): return None
    u = rng.uniform
    c = round(u(4.5, 5) * 2) / 2                            # corridor width (the lobby in it needs 4.5 ft)
    cw = Bw - c                                             # rooms column
    back = round(u(12, 14) + (1.5 if focus == "bedrooms" else 0), 1)
    upper = Bd - back
    if upper < 30: return None
    lob = round(u(6, 8) * 2) / 2
    kw = {"kitchen": 1.6, "lounge": 0.8}.get(focus, 1.0)
    lw = {"lounge": 1.5, "kitchen": 0.9}.get(focus, 1.0)
    dd, kd, ld = split(upper, [1.15, 0.85 * kw, 1.15 * lw])            # drawing, kitchen, lounge depths
    if min(dd, ld) < 10.5 or kd < 8: return None
    guest, common = baths >= beds + 1, baths >= beds + 2
    drawing = R("drawing", [4.5, min(6.5, dd - 3), "L"] if guest else None)
    lounge = R("lounge", [5, min(6.5, ld - 3), "L"] if common else None)
    rooms_col = H([dd, kd], [drawing, R("kitchen"), lounge])
    pass_col = H([lob], [R("lobby"), R("passage")])
    top = V([cw], [rooms_col, pass_col])                               # corridor on the right (mirrored half the time)
    a = round(u(0.45, 0.55) * Bw * 2) / 2                              # back row: bed under the lounge | bed at the corridor end
    if a > cw - 3.5 or Bw - a < c + 6: return None
    b1, b2 = R("master"), R("bed")
    b1["bath"] = bed_bath(a, back, "L", rng)
    b2["bath"] = bed_bath(Bw - a, back, "R", rng)
    core = H([upper], [top, V([a], [b1, b2])])
    return wrap(W, D, beds, baths, focus, rule, s, front, Bw, Bd, rear, core, cw + c / 2, rng)


def wing(W, D, beds, rng, baths, focus):
    f = frame(W, D, rng, focus)
    if not f or not (2 <= beds <= 5): return None
    rule, s, front, Bw, Bd_max, rear = f
    if Bw < 29: return None
    u = rng.uniform
    r5 = lambda v: round(v * 2) / 2
    c = r5(u(4.5, 5.5))                                    # corridor width (the lobby in it needs 4.5 ft)
    avail = Bw - c
    pw_ = avail * u(0.5, 0.58) * {"bedrooms": 0.8, "lounge": 1.08, "kitchen": 1.04}.get(focus, 1.0)
    pw_ = r5(min(max(pw_, 12.5, avail - 22), avail - 11))  # public wing width; the bedroom wing is 11-22 ft wide
    bw_ = avail - pw_                                      # private wing width
    if not (12.5 <= pw_ <= 30 and 11 <= bw_ <= 22): return None
    # private wing, front to back: rooms a big house adds near the entrance (stairs, study, store), then the bedrooms.
    # Bedrooms 13-16 ft deep (deeper for bigger bedrooms) leave the outer wall a window beside the washroom corner.
    lo, hi = (14.5, 17) if focus == "bedrooms" else (13, 15.5)
    bdep = [r5(u(lo, hi)) for _ in range(beds)]
    if sum(bdep) > Bd_max:                                 # tight plot: share what there is
        bdep = split(Bd_max, [1.0] * beds)
        if min(bdep) < 13: return None
    room = Bd_max - sum(bdep)
    extras = []
    for t, a, b in rng.sample([("stairs", 8, 10), ("study", 10, 13), ("store", 6, 8)], 3):
        if room < a + 4 or focus == "bedrooms" or (room < 20 and rng.random() < 0.25): continue   # else back yard or bedrooms
        d_ = r5(u(a, min(b, room)))
        extras.append((t, d_)); room -= d_
    if room > 4:                                           # spare depth makes the bedrooms bigger, up to 17-18 ft
        for k in range(beds):
            add = min(room, (18 if focus == "bedrooms" else 17) - bdep[k]); bdep[k] += add; room -= add
    Bd = Bd_max - r5(room)                                 # the rest is back yard (more of it on deep plots)
    rear += Bd_max - Bd
    if Bd < 30: return None
    guest, common = baths >= beds + 1, baths >= beds + 2
    # public wing, front to back: drawing, lounge, (dining), kitchen
    use_dining = Bd >= 50 and rng.random() < 0.6
    kw = {"kitchen": 1.5}.get(focus, 1.0)
    lw = {"lounge": 1.5}.get(focus, 1.0)
    names = ["drawing", "lounge"] + (["dining"] if use_dining else []) + ["kitchen"]
    weights = {"drawing": 1.1, "lounge": 1.35 * lw, "dining": 0.8, "kitchen": 0.85 * kw}
    depths = split(Bd, [weights[n] for n in names])
    mins = {"drawing": 11, "lounge": 12, "dining": 8, "kitchen": 8.5}
    if any(d < mins[n] for n, d in zip(names, depths)): return None
    pub = []
    for n, d in zip(names, depths):
        bath = None
        if n == "drawing" and guest: bath = [4.5, min(6.5, d - 3), "L"]
        if n == "lounge" and common: bath = [5, min(6.5, d - 3), "L"]
        pub.append(R(n, bath))
    public = H(depths[:-1], pub)
    lob = r5(u(6, 9))
    passage = H([lob], [R("lobby"), R("passage")])
    big = rng.randrange(beds)
    priv = [R(t) for t, _ in extras]
    for k in range(beds):
        r = R("master" if k == big else "bed")
        r["bath"] = bed_bath(bw_, bdep[k], "R", rng)
        r["bath"][1] = min(r["bath"][1], bdep[k] - 5.5)     # the washroom is on the outer wall: leave a window beside it
        priv.append(r)
    sizes = [d_ for _, d_ in extras] + bdep
    private = H(sizes[:-1], priv)
    core = V([pw_, c], [public, passage, private])
    return wrap(W, D, beds, baths, focus, rule, s, front, Bw, Bd, rear, core, pw_ + c / 2, rng)


def generate(W, D, beds, rng, baths=None, focus="balanced", family=None):
    baths = beds + 1 if baths is None else baths
    fam = family or rng.choice(FAMILIES)
    return {"corridor": corridor, "wing": wing}[fam](W, D, beds, rng, baths, focus)


def _probe():
    plots = [(25, 55), (25, 60), (27, 55), (28, 60), (30, 50), (30, 60), (32, 60), (35, 65), (38, 59), (40, 80), (45, 95), (50, 90)]
    print(f"{'plot':7s} {'family':9s} " + " ".join(f"{b}b" .rjust(6) for b in range(2, 6)))
    for W, D in plots:
        for fam in FAMILIES:
            cells = []
            for beds in range(2, 6):
                rng = random.Random(5)
                ok = tries = 0
                fails = {}
                for _ in range(200):
                    p = generate(W, D, beds, rng, beds + 1, "balanced", fam)
                    if p is None: continue
                    tries += 1
                    cs = tree.check(p, beds)
                    if tree.score(cs) == 1.0: ok += 1
                    else:
                        for c in cs:
                            if c[0] != "ok": fails[c[1]] = fails.get(c[1], 0) + 1
                cells.append(f"{ok:>3}/{tries:<3}")
                if fails and beds == 2: worst = max(fails, key=fails.get)
            print(f"{W}x{D:<4d} {fam:9s} " + " ".join(cells))


if __name__ == "__main__":
    if sys.argv[1:] == ["probe"]: _probe()
    elif sys.argv[1:2] == ["show"]:
        W, D, beds, fam = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
        rng = random.Random(int(sys.argv[6]) if len(sys.argv) > 6 else 1)
        for _ in range(200):
            p = generate(W, D, beds, rng, beds + 1, "balanced", fam)
            if p: break
        print(tree.serialize(p))
        for c in tree.check(p, beds): print(" ", c)
