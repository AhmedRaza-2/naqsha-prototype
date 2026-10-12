"""Stage 3: build the clean training dataset from verified.jsonl.

Layout (flat, no per-class folders - labels live in metadata, so you can filter/stratify any way you like):

  data/clean/
    images/<id>.<ext>      one file per accepted plan (id = perceptual hash)
    metadata.jsonl         one JSON record per plan (all fields below)
    train.jsonl val.jsonl test.jsonl     deterministic 84/8/8 split (test = 'strong' tier only)
    review/<id>.<ext>      near-misses (some plan evidence but failed the checks) for manual rescue
    summary.txt

Record fields: id, image, split, tier (strong|likely), group, plot_marla, source_url, query, rooms[],
n_dims, pk_markers[], n_floor_labels, multi_plan (True when several floor plans are on one sheet), ocr_text[].

    python tools/build_clean.py
"""
import json, re, shutil, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "data"
OUT = ROOT / "clean"
FLOOR_RE = re.compile(r"(ground|first|second|1st|2nd|top|roof|basement)\s*(floor|roof)?\s*plan", re.I)
MARLA_RE = re.compile(r"(\d{1,2}(?:\.\d)?)\s*[- ]?\s*marla", re.I)


def split_of(id_, tier):
    b = int(id_, 16) % 100
    if b < 8 and tier == "strong":
        return "test"
    if b < 16:
        return "val"
    return "train"


def plot_marla(rec):
    if rec.get("size"):
        return rec["size"]
    m = MARLA_RE.search(" ".join(rec.get("texts", [])))
    return float(m.group(1)) if m else None


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    recs = [json.loads(l) for l in (ROOT / "verified.jsonl").read_text(encoding="utf-8").splitlines() if l]
    shutil.rmtree(OUT, ignore_errors=True)
    (OUT / "images").mkdir(parents=True)
    (OUT / "review").mkdir()
    rows, review = [], 0
    for r in recs:
        src = ROOT / r["file"]
        if not src.exists():
            continue
        id_ = Path(r["file"]).stem
        if r.get("ok"):  # older verify runs did not store these fields; derive them from the stored OCR data
            if not r.get("tier"):
                r["tier"] = "strong" if len(r.get("rooms", [])) >= 4 and r.get("n_dims", 0) >= 2 else "likely"
            if "n_floor_labels" not in r:
                r["n_floor_labels"] = len(FLOOR_RE.findall(" ".join(r.get("texts", []))))
            rows.append({
                "id": id_, "image": f"images/{id_}{src.suffix}", "split": split_of(id_, r.get("tier")),
                "tier": r.get("tier"), "group": r.get("group") or f"{r.get('size')}_marla", "plot_marla": plot_marla(r),
                "source_url": r.get("url"), "query": r.get("query"), "rooms": r.get("rooms", []), "n_dims": r.get("n_dims", 0),
                "pk_markers": r.get("pk_markers", []), "n_floor_labels": r.get("n_floor_labels", 0),
                "multi_plan": r.get("n_floor_labels", 0) >= 2, "width": r.get("w"), "height": r.get("h"),
                "ocr_text": r.get("texts", []),
            })
            shutil.copy2(src, OUT / "images" / f"{id_}{src.suffix}")
        elif len(r.get("rooms", [])) >= 3 and not r.get("india_markers"):
            shutil.copy2(src, OUT / "review" / f"{id_}{src.suffix}")
            review += 1
    with (OUT / "metadata.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    for sp in ("train", "val", "test"):
        with (OUT / f"{sp}.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                if r["split"] == sp:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
    c = Counter(r["split"] for r in rows)
    lines = [f"clean plans: {len(rows)}   (train {c['train']}, val {c['val']}, test {c['test']})",
             f"tiers: {dict(Counter(r['tier'] for r in rows))}",
             f"multi-plan sheets (need splitting): {sum(r['multi_plan'] for r in rows)}",
             f"review pile (near-misses): {review}",
             "by group:"]
    lines += [f"  {g:28s} {n}" for g, n in sorted(Counter(r['group'] for r in rows).items())]
    (OUT / "summary.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
