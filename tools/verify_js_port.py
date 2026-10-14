"""Check that js/bands.js scores plans exactly like tools/bands.py.
    python tools/verify_js_port.py        (needs node)
Builds ~600 plans (valid, flawed and broken), scores them in Python, then asks node to score the same texts."""
import json, random, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands  # noqa: E402

rng = random.Random(5)
texts = []
for src in ("data/synth_v1_loose/train.jsonl", "data/synth/train.jsonl", "data/synth_v6/train.jsonl", "data/synth_v7/train.jsonl", "data/synth_v8/train.jsonl"):
    if not (ROOT / src).exists(): continue                 # flawed + perfect plans
    rows = [json.loads(l) for l in open(ROOT / src, encoding="utf-8")]
    texts += [r["prompt"] + "\n" + r["completion"] for r in rng.sample(rows, 250)]
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

expected = []
for t in texts:
    try:
        plan = bands.parse(t)
        cs = bands.check(plan, plan["beds"])
        expected.append({"ok": True, "score": round(bands.score(cs), 6), "failed": sorted(c[1] for c in cs if c[0] != "ok")})
    except Exception:
        expected.append({"ok": False})
tmp = Path(tempfile.mkdtemp()) / "vectors.json"
tmp.write_text(json.dumps({"texts": texts, "expected": expected}))
r = subprocess.run(["node", str(ROOT / "tools" / "verify_js_port.mjs"), str(tmp)], capture_output=True, text=True, cwd=str(ROOT))
print(r.stdout.strip() or r.stderr.strip()[:800])
sys.exit(r.returncode)
