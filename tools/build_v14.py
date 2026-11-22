"""Dataset v14: more real layouts on top of v13.

    python tools/build_v14.py
  data/world_cc/{train,val}.jsonl  (real/cubicasa_convert.py)  -> data/world_cc11/  tagged SRC world, only numbers the model has tokens for
  data/real/{train,val,test_silver}.jsonl  (new vision readings, real/build_real.py build) -> data/real14/ as slicing trees
Training mixes these with data/pk13, data/world11, data/real11 and data/real13 (ml/run_v14.sh).
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import bands, tree  # noqa: E402
from build_v14_helpers import encodable  # noqa: E402


def main():
    n = {}
    if Path("data/world_cc/train.jsonl").exists():
        Path("data/world_cc11").mkdir(parents=True, exist_ok=True)
        for name in ("train", "val"):
            kept = 0
            with open(f"data/world_cc11/{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
                for l in open(f"data/world_cc/{name}.jsonl", encoding="utf-8"):
                    r = json.loads(l); r["prompt"] += " SRC world"
                    if not encodable(r["prompt"] + " " + r["completion"]): continue
                    f.write(json.dumps(r) + "\n"); kept += 1
            n[f"world_cc11/{name}"] = kept
    Path("data/real14").mkdir(parents=True, exist_ok=True)
    for name in ("train", "val", "test_silver"):
        src = Path(f"data/real/{name}.jsonl")
        if not src.exists(): continue
        kept = 0
        with open(f"data/real14/{name}.jsonl", "w", encoding="utf-8", newline="\n") as f:
            for l in open(src, encoding="utf-8"):
                r = json.loads(l)
                tp = tree.from_bands(bands.parse(r["prompt"] + "\n" + r["completion"]))
                head, comp = tree.serialize(tp).split("\n", 1)
                f.write(json.dumps({**r, "prompt": head, "completion": comp}) + "\n"); kept += 1
        n[f"real14/{name}"] = kept
    print(n)


if __name__ == "__main__":
    main()
