"""Real-plan dataset: choose the plans to transcribe, then turn the vision model's transcriptions into training rows.

    python real/build_real.py candidates     # -> real/candidates.jsonl (plans to read, with OCR hints)
    python real/build_real.py build          # data/real/raw*.jsonl -> data/real/{train,val,test}.jsonl + report
Silver plans (vision model) are kept only when they assemble into a valid plan, did not have to be stretched much to
fit the plot, and agree with the room sizes our OCR read from the same image. Gold plans (hand transcribed) are the
test set and are never trained on. The report also scores the vision model against the gold plans it was not shown.
"""
import glob, hashlib, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "real"))
import bands  # noqa: E402
from assemble import assemble, norm_type  # noqa: E402

INDIAN = re.compile(r"\+91|toilet|parking|balcony|vastu|pooja|puja|sit ?out|bhk", re.I)
PLOT = re.compile(r"(\d{2,3})\s*['’`´\-]?\s*(?:\d{1,2})?[\"”°*~]*\s*[xX×]\s*(\d{2,3})")
NUM = r"(\d{1,2})\s*['’`´\-]\s*(\d{1,2})?"
DIM = re.compile(NUM + r"[\"”°*~'’`´\-]*\s*[xX×*/]+\s*[\"”°*~'’`´\-/]*\s*" + NUM)
LABEL = re.compile(r"master|bed|bath|toilet|w\.?c\b|kitchen|lounge|tv|living|family|drawing|drg|dining|porch|garage|lawn|store|stair|dress|servant|lobby|entrance|passage", re.I)


def ocr_texts(row):
    t = row["ocr_text"]
    return t if isinstance(t, list) else []


def feet(f, i):
    return int(f) + (int(i) if i else 0) / 12


def ocr_pairs(texts):
    """(label text, a, b) for room labels followed by a printed size on the same or next line."""
    out = []
    for k, line in enumerate(texts):
        if not LABEL.search(line): continue
        for nxt in [line] + texts[k + 1:k + 2]:
            m = DIM.search(nxt)
            if m:
                a, b = feet(m[1], m[2]), feet(m[3], m[4])
                if 3 <= a <= 40 and 3 <= b <= 40: out.append((LABEL.search(line)[0].lower(), a, b))
                break
    return out


def candidates():
    rows = [json.loads(l) for l in open(ROOT / "data/clean/metadata.jsonl", encoding="utf-8")]
    out, skipped = [], Counter()
    for r in rows:
        texts = ocr_texts(r)
        blob = " ".join(texts)
        if INDIAN.search(blob): skipped["indian markers"] += 1; continue
        plot = None
        for t in texts:
            m = PLOT.search(t)
            if m and 15 <= int(m[1]) <= 120 and 25 <= int(m[2]) <= 250 and int(m[1]) <= int(m[2]): plot = [int(m[1]), int(m[2])]; break
        g = re.match(r"ft_(\d+)x(\d+)", r["group"])
        if not plot and g: plot = [int(g[1]), int(g[2])]
        mg = re.match(r"(\d+)_marla", r["group"])
        labels = [f"{l.upper()} {round(a * 2) / 2:g}x{round(b * 2) / 2:g}" for l, a, b in ocr_pairs(texts)]
        out.append({"id": r["id"], "image": r["image"], "plot": plot, "marla": int(mg[1]) if mg else None, "labels": labels})
    # plans with more printed sizes first: they are the easiest to read and to check
    out.sort(key=lambda c: (-len(c["labels"]), c["id"]))
    with open(ROOT / "real/candidates.jsonl", "w", encoding="utf-8", newline="\n") as f:
        for c in out: f.write(json.dumps(c) + "\n")
    print(f"{len(out)} candidates ({sum(1 for c in out if c['plot'])} with a printed plot size, "
          f"{sum(1 for c in out if len(c['labels']) >= 2)} with 2+ printed room sizes); skipped {dict(skipped)}")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def from_compact(js, plot=None):
    """Compact JSON from the vision model -> room list for assemble(). Also handles what it often writes instead:
    one flat list of rooms (rows are rebuilt from the widths: a new row starts when the widths reach the plot width) and
    washrooms listed as rooms of their own (they become the washroom of the bedroom, or else the room, next to them)."""
    W = (plot or js.get("plot") or [0])[0]
    raw = js.get("rows", [])
    if raw and all(isinstance(x, list) and x and isinstance(x[0], str) for x in raw):      # flat list of rooms
        rows, cur, acc = [], [], 0.0
        for x in raw:
            cur.append(x); acc += _num(x[1]) or 0 if len(x) > 1 else 0
            if W and acc >= 0.85 * float(W): rows.append(cur); cur, acc = [], 0.0
        if cur: rows.append(cur)
        raw = rows
    out_rows, baths = [], []
    for ri, row in enumerate(raw, 1):
        items = []
        for x in row if isinstance(row, list) else []:
            if not isinstance(x, list) or len(x) < 3: continue
            w, d = _num(x[1]), _num(x[2])
            if not w or not d or w <= 0 or d <= 0: continue
            it = {"t": norm_type(x[0], keep_bath=True), "w": w, "d": d}
            if len(x) >= 6 and _num(x[3]) and _num(x[4]): it["bath"] = (_num(x[3]), _num(x[4]), str(x[5]))
            items.append(it)
        for k, it in enumerate(items):                             # standalone washroom -> washroom of its neighbour
            if it["t"] != "bath": continue
            nbrs = [j for j in (k - 1, k + 1) if 0 <= j < len(items) and items[j]["t"] not in {"bath"} | bands.OPEN and "bath" not in items[j]]
            nbrs.sort(key=lambda j: items[j]["t"] not in bands.BEDS)
            if nbrs:
                j = nbrs[0]
                items[j]["w"] += it["w"]
                items[j]["bath"] = (it["w"], it["d"], "L" if j > k else "R")
            it["drop"] = True
        rr = []
        for it in items:
            if it.get("drop"): continue
            rr.append({"t": it["t"], "w": it["w"], "d": it["d"]})
            if "bath" in it:
                bw, bd, side = it["bath"]
                baths.append({"row": ri, "col": len(rr), "w": bw, "d": bd, "side": side})
        out_rows.append(rr)
    return {"plot": plot or js["plot"], "rows": out_rows, "baths": baths}


def parse_json(text):
    """The first JSON object in the text; code fences are ignored and an answer cut off by the length limit is closed
    after its last complete room."""
    i = text.find("{")
    if i < 0: return None
    t = text[i:].replace("```", "")
    t = t[: t.rfind("}") + 1] if t.rfind("}") > 0 else t
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    body = text[i:].replace("```", "")
    for cut in [m.end() for m in re.finditer(r"\]", body)][::-1][:40]:   # try ending after each of the last closing brackets
        part, stack, instr, esc = body[:cut], [], False, False
        for ch in part:
            if instr:
                esc = (ch == "\\" and not esc); instr = not (ch == '"' and not esc) if not esc or ch != '"' else instr
                continue
            if ch == '"': instr = True
            elif ch in "[{": stack.append("]" if ch == "[" else "}")
            elif ch in "]}" and stack: stack.pop()
        try:
            js = json.loads(part + "".join(reversed(stack)))
            if isinstance(js, dict) and js.get("rows"): return js
        except json.JSONDecodeError:
            continue
    return None


TYPE_OF = {"master": "master", "bed": "bed", "bath": "bath", "toilet": "bath", "kitchen": "kitchen", "lounge": "lounge", "tv": "lounge",
           "living": "lounge", "family": "lounge", "drawing": "drawing", "drg": "drawing", "dining": "dining", "porch": "porch", "garage": "porch"}


def agreement(rooms, labels):
    """Share of OCR'd printed sizes that the transcription reproduces (same kind of room, both sides within 1.5 ft)."""
    have = [(norm_type(r["t"]), r["w"], r["d"]) for row in rooms["rows"] for r in row] + [("bath", b["w"], b["d"]) for b in rooms["baths"]]
    ok = n = 0
    for lab in labels:
        m = re.match(r"([A-Z.]+) ([\d.]+)x([\d.]+)", lab)
        if not m: continue
        t = TYPE_OF.get(m[1].lower().strip("."))
        if not t: continue
        a, b = float(m[2]), float(m[3])
        n += 1
        same = {"bed": {"bed", "master"}, "master": {"bed", "master"}}.get(t, {t})
        ok += any(ty in same and ((abs(w - a) <= 1.5 and abs(d - b) <= 1.5) or (abs(w - b) <= 1.5 and abs(d - a) <= 1.5)) for ty, w, d in have)
    return (ok / n if n else None), n


def read_jsonl(path):
    """Rows of a JSON-lines file; a line cut off when a process was killed mid-write is skipped."""
    out = []
    for l in open(path, encoding="utf-8"):
        try:
            out.append(json.loads(l))
        except json.JSONDecodeError:
            pass
    return out


def encodable(text):
    """Every number must be a token the model knows: 0.5 to 150 on the 0.5 ft grid (no 'BATHS 0', no 30.25 ft plots)."""
    return all(0.5 <= float(v) <= 150 and float(v) * 2 == int(float(v) * 2) for v in re.findall(r"\d+(?:\.\d+)?", text))


def row_of(plan, source, pid):
    txt = bands.serialize(plan)
    head, comp = txt.split("\n", 1)
    return {"prompt": head, "completion": comp, "plot": [plan["plot"]["w"], plan["plot"]["d"]], "beds": plan["beds"], "baths": plan["baths"],
            "focus": plan["focus"], "source": source, "id": pid, "score": round(bands.score(bands.check(plan)), 3)}


def gold_accuracy(raw, gold):
    """Vision model vs hand transcription, on gold plans it was not shown as examples."""
    from extract_vlm import EXAMPLE_IDS
    res = []
    for gid, g in gold.items():
        if gid in EXAMPLE_IDS or gid not in raw: continue
        js = parse_json(raw[gid]["text"])
        if not js or "rows" not in js: res.append({"id": gid, "parsed": False}); continue
        v = from_compact(js)
        gt = Counter(norm_type(r["t"]) for row in g["rooms"]["rows"] for r in row if norm_type(r["t"]) not in bands.OPEN)
        vt = Counter(norm_type(r["t"]) for row in v["rows"] for r in row if norm_type(r["t"]) not in bands.OPEN)
        inter = sum((gt & vt).values())
        f1 = 2 * inter / (sum(gt.values()) + sum(vt.values()) or 1)
        gb = gt["bed"] + gt["master"]; vb = vt["bed"] + vt["master"]
        res.append({"id": gid, "parsed": True, "room_type_f1": round(f1, 2), "beds_right": gb == vb, "rows": (len(g["rooms"]["rows"]), len(v["rows"]))})
    return res


def build():
    out = ROOT / "data/real"; out.mkdir(parents=True, exist_ok=True)
    cands = {c["id"]: c for c in (json.loads(l) for l in open(ROOT / "real/candidates.jsonl", encoding="utf-8"))}
    gold = {g["id"]: g for g in (json.loads(l) for l in open(ROOT / "real/gold.jsonl", encoding="utf-8"))}
    raw = {}
    for f in sorted(glob.glob(str(out / "raw*.jsonl"))):
        for r in read_jsonl(f): raw[r["id"]] = r
    why, silver = Counter(), []
    for pid, r in raw.items():
        if pid in gold: continue                                  # gold plans are the test set
        js = parse_json(r["text"])
        if not js: why["not JSON"] += 1; continue
        if "skip" in js or "rows" not in js or "plot" not in js: why["skipped by the model"] += 1; continue
        plot = js.get("plot")
        ok = lambda p: isinstance(p, list) and len(p) == 2 and all(_num(v) for v in p) and 15 <= float(p[0]) <= 120 and 25 <= float(p[1]) <= 150
        if not ok(plot) and isinstance(plot, list) and len(plot) == 2 and ok(plot[::-1]): plot = plot[::-1]
        if not ok(plot): plot = cands.get(pid, {}).get("plot")                       # fall back to the printed plot size
        if not ok(plot): why["plot size not readable"] += 1; continue
        try:
            rooms = from_compact(js, [float(plot[0]), float(plot[1])])
            plan, info = assemble(rooms)
        except Exception as e:                                    # malformed numbers etc.
            why[f"assemble error"] += 1; continue
        if plan is None: why[info] += 1; continue
        cs = bands.check(plan)
        errs = [c[1] for c in cs if c[0] == "err"]
        if errs: why["invalid: " + errs[0]] += 1; continue
        if plan["beds"] < 1: why["no bedroom"] += 1; continue
        if plan["baths"] < 1: why["no washroom"] += 1; continue
        if not encodable(bands.serialize(plan)): why["numbers the model has no token for"] += 1; continue
        if info["stretch"] > 0.35: why["sizes far from the plot size"] += 1; continue
        ag, n = agreement(rooms, cands.get(pid, {}).get("labels", []))
        if ag is not None and n >= 2 and ag < 0.4: why["disagrees with printed sizes"] += 1; continue
        row = row_of(plan, "silver", pid); row["agreement"] = ag; row["stretch"] = info["stretch"]
        silver.append(row)
    test = []
    for gid, g in gold.items():
        plan, info = assemble(g["rooms"])
        if plan and not any(c[0] == "err" for c in bands.check(plan)) and encodable(bands.serialize(plan)):
            test.append(row_of(plan, "gold", gid))
        else:
            print(f"gold plan {gid} left out of the test set: {info if plan is None else 'invalid'}")
    # silver plans held out: 10% to choose the fine-tuning checkpoint (val), another 10% only to report (test_silver)
    part = lambda r: int(hashlib.md5(r["id"].encode()).hexdigest(), 16) % 10
    val = [r for r in silver if part(r) == 0]
    test_silver = [r for r in silver if part(r) == 1]
    train = [r for r in silver if part(r) >= 2]
    for name, rows in (("train", train), ("val", val), ("test", test), ("test_silver", test_silver)):
        with open(out / f"{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for r in rows: f.write(json.dumps(r) + "\n")
    acc = gold_accuracy(raw, gold)
    rep = {"read": len(raw), "kept_silver": len(silver), "train": len(train), "val": len(val), "test_silver": len(test_silver), "test_gold": len(test),
           "rejected": dict(why.most_common()), "vision_model_vs_gold": acc,
           "silver_mean_score": round(sum(r["score"] for r in silver) / max(1, len(silver)), 3),
           "silver_beds": dict(Counter(r["beds"] for r in silver)), "silver_marla": dict(Counter(round(r["plot"][0] * r["plot"][1] / 225) for r in silver))}
    (out / "report.json").write_text(json.dumps(rep, indent=1))
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    {"candidates": candidates, "build": build}[sys.argv[1] if len(sys.argv) > 1 else "build"]()
