"""Check that js/bands.js scores plans exactly like tools/bands.py.
    python tools/verify_js_port.py        (needs node)
Builds ~600 plans (valid, flawed and broken), scores them in Python, then asks node to score the same texts."""
import json, random, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402
import tree  # noqa: E402

rng = random.Random(5)
texts = []
for src in ("data/synth_v1_loose/train.jsonl", "data/synth/train.jsonl", "data/synth_v6/train.jsonl", "data/synth_v7/train.jsonl", "data/synth_v8/train.jsonl", "data/synth_v9/train.jsonl", "data/synth_v9/test.jsonl"):
    if not (ROOT / src).exists(): continue                 # flawed + perfect plans
    rows = [json.loads(l) for l in open(ROOT / src, encoding="utf-8")]
    texts += [r["prompt"] + "\n" + r["completion"] for r in rng.sample(rows, 250)]
gold = ROOT / "real/gold.jsonl"                                                             # real plans: entrances without a lobby
if gold.exists():
    sys.path.insert(0, str(ROOT / "real"))
    from assemble import assemble
    for l in open(gold, encoding="utf-8"):
        p, _ = assemble(json.loads(l)["rooms"])
        if p: texts.append(bands.serialize(p))
for t in rng.sample(texts, 100):                                                           # deliberately broken variants
    lines = t.split("\n")
    k = rng.randrange(1, len(lines))
    mode = rng.choice(["drop_room", "widen", "bad_type", "swap_bands"])
    if mode == "drop_room" and " | " in lines[k]:
        parts = lines[k].split(" | "); parts.pop(rng.randrange(len(parts))); lines[k] = " | ".join(parts)
    elif mode == "widen":
        lines[k] = lines[k].replace("|", "| ", 1).replace("  ", " ", 1).replace(": ", ": 1", 1)
    elif mode == "bad_type":
        lines[k] = lines[k].replace("kitchen", "bath", 1).replace("drawing", "garbage", 1)
    else:
        if len(lines) > 3: lines[1], lines[2] = lines[2], lines[1]
    texts.append("\n".join(lines))

# slicing-tree plans: the new Pakistani families, world (ResPlan) plans, real plans, and broken variants of them
trees = []
for src, k in (("data/pk11/test.jsonl", 300), ("data/world11/val.jsonl", 150), ("data/real11/test.jsonl", 20)):
    if not (ROOT / src).exists(): continue
    rows = [json.loads(l) for l in open(ROOT / src, encoding="utf-8")]
    trees += [r["prompt"] + "\n" + r["completion"] for r in rng.sample(rows, min(k, len(rows)))]
for t in rng.sample(trees, min(80, len(trees))):
    head, body = t.split("\n", 1)
    mode = rng.choice(["size", "type", "bracket", "bath"])
    if mode == "size": body = body.replace(" 1", " 9", 1)
    elif mode == "type": body = body.replace("kitchen", "garbage", 1).replace("drawing", "bath", 1)
    elif mode == "bracket": body = body.replace("]", "", 1)
    else: body = body.replace("+bath 4.5x", "+bath 14.5x", 1)
    trees.append(head + "\n" + body)
texts += trees


def is_tree(t):
    body = t.split("\n", 1)[1].lstrip() if "\n" in t else ""
    return body[:1] in ("H", "V") or (bool(body) and ":" not in body)


expected = []
for t in texts:
    try:
        mod = tree if is_tree(t) else bands
        plan = mod.parse(t)
        cs = mod.check(plan, plan["beds"])
        expected.append({"ok": True, "score": round(bands.score(cs), 6), "failed": sorted(c[1] for c in cs if c[0] != "ok")})
    except Exception:
        expected.append({"ok": False})
tmp = Path(tempfile.mkdtemp()) / "vectors.json"
tmp.write_text(json.dumps({"texts": texts, "expected": expected}))
r = subprocess.run(["node", str(ROOT / "tools" / "verify_js_port.mjs"), str(tmp)], capture_output=True, text=True, cwd=str(ROOT))
print(r.stdout.strip() or r.stderr.strip()[:800])
sys.exit(r.returncode)
