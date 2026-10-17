"""Hand-transcribed real plans (real/hand/*.json, see real/TRANSCRIBE.md) -> data/real13/{train,test}.jsonl.

    python real/build_hand.py
A transcription is used when it assembles into a plan (real/assemble.py), had to be stretched at most 35% to fit the
plot, has a bedroom and a washroom, and, where our OCR read 3 or more printed room sizes from the same image, reproduces
at least half of them. About one plan in five (chosen by id, so the split never changes) and the 9 earlier gold plans
are the test set: never trained on, used to measure how real the model's plans are. Plans that break a design rule of
our checker (for example a house with no drawing room) are real all the same: they stay in the test set but are left
out of training, so the model is not taught plans the planner would reject. First floors are written to
first_floors.jsonl for later use.
"""
import glob, hashlib, json, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools")); sys.path.insert(0, str(ROOT / "real"))
import bands, tree  # noqa: E402
from assemble import assemble  # noqa: E402
from build_real import agreement, encodable  # noqa: E402


def main():
    labels = {c["id"]: c.get("labels", []) for c in map(json.loads, open(ROOT / "real/candidates.jsonl", encoding="utf-8"))}
    gold = [json.loads(l) for l in open(ROOT / "real/gold.jsonl", encoding="utf-8")]
    why, rows, firsts = Counter(), [], []
    files = sorted(glob.glob(str(ROOT / "real/hand/*.json")))
    for f in files:
        js = json.loads(Path(f).read_text(encoding="utf-8"))
        pid = js["id"]
        if js.get("skip"): why["skipped: " + js["skip"].split(":")[0][:40]] += 1; continue
        plan, info = assemble(js["rooms"])
        if plan is None: why[info] += 1; continue
        if info["stretch"] > 0.35: why["sizes far from the plot"] += 1; continue
        if plan["beds"] < 1 or plan["baths"] < 1: why["no bedroom or washroom"] += 1; continue
        ag, n = agreement(js["rooms"], labels.get(pid, []))
        if ag is not None and n >= 3 and ag < 0.5: why["disagrees with printed sizes"] += 1; continue
        tp = tree.from_bands(plan)
        head, comp = tree.serialize(tp).split("\n", 1)
        if not encodable(head + " " + comp): why["numbers the model has no token for"] += 1; continue
        cs = tree.check(tp, plan["beds"])
        errs = [c[1] for c in cs if c[0] == "err"]
        rows.append({"prompt": head, "completion": comp, "plot": [plan["plot"]["w"], plan["plot"]["d"]], "beds": plan["beds"],
                     "baths": plan["baths"], "focus": plan["focus"], "source": "hand", "id": pid, "score": round(tree.score(cs), 3),
                     "rule_errors": errs, "agreement": ag, "stretch": info["stretch"], "note": js.get("note", "")})
        if js.get("first_floor"):
            fp, finfo = assemble(js["first_floor"])
            if fp: firsts.append({"id": pid, "plan": bands.serialize(fp), "stretch": finfo["stretch"]})
    test_part = lambda pid: int(hashlib.md5(pid.encode()).hexdigest(), 16) % 5 == 0
    test = [r for r in rows if test_part(r["id"])]
    train = [r for r in rows if not test_part(r["id"]) and not r["rule_errors"]]
    for g in gold:                                                 # the earlier gold plans stay in the test set
        plan, info = assemble(g["rooms"])
        if plan is None: continue
        tp = tree.from_bands(plan)
        head, comp = tree.serialize(tp).split("\n", 1)
        test.append({"prompt": head, "completion": comp, "plot": [plan["plot"]["w"], plan["plot"]["d"]], "beds": plan["beds"],
                     "baths": plan["baths"], "focus": plan["focus"], "source": "gold", "id": g["id"], "score": round(tree.score(tree.check(tp)), 3)})
    out = ROOT / "data/real13"
    out.mkdir(parents=True, exist_ok=True)
    for name, rs in (("train", train), ("test", test), ("first_floors", firsts)):
        with open(out / f"{name}.jsonl", "w", encoding="utf-8", newline="\n") as fh:
            for r in rs: fh.write(json.dumps(r) + "\n")
    m = lambda r: r["plot"][0] * r["plot"][1] / 225
    rep = {"transcription files": len(files), "usable plans": len(rows), "train": len(train), "test": len(test),
           "left out of training for a design rule": sum(1 for r in rows if r["rule_errors"] and not test_part(r["id"])),
           "design rules broken": dict(Counter(e for r in rows for e in r["rule_errors"])), "not used": dict(why.most_common()),
           "first floors": len(firsts), "by size": dict(Counter("<=6" if m(r) <= 6 else "6-10" if m(r) <= 10 else "10-14" if m(r) <= 14 else ">14" for r in rows)),
           "beds": dict(sorted(Counter(r["beds"] for r in rows).items())),
           "mean agreement": round(sum(r["agreement"] for r in rows if r["agreement"] is not None) / max(1, sum(r["agreement"] is not None for r in rows)), 2)}
    (out / "report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
