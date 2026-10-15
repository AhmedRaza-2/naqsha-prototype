"""Coverage as the planner drafts: for every request the form can produce, sample 12 plans split over the layout families
that fit the plot (one STYLE tag per family; models without STYLE get untagged prompts), keep the valid ones, pick three
the way js/model.js does (best of each family first, then best overall) and report
  answered  : requests with at least one valid plan
  perfect   : requests with a plan that passes every check
  3 cards   : requests where three valid layouts can be shown
  arrangements on the cards : distinct macro arrangements among the (up to) three picked layouts (evaluate.skeleton)
  difference on the cards   : mean share of the plot that differs between two picked layouts (evaluate.layout_distance)
    python ml/coverage_styles.py --onnx runs/v11/layout.onnx
"""
import argparse, itertools, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402
from onnx_check import sample  # noqa: E402
from coverage import PLOTS, beds_allowed  # noqa: E402
import evaluate as E  # noqa: E402
bands = L.bands


def families_for(w, d, beds):
    """Same as familiesFor in js/modelplans.js."""
    marla = w * d / 225
    if marla <= 6: return ["compact"]
    side = 3 if marla <= 14 else 5
    Bw = w - 2 * side
    fams = ["rows"]
    if 18 <= Bw <= 29 and beds == 2: fams.append("corridor")
    if Bw >= 29 and 2 <= beds <= 5: fams.append("wing")
    return fams


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--styles", choices=["auto", "off"], default="auto", help="off = untagged prompts (older models)")
    a = ap.parse_args()
    sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    vocab_size = sess.get_outputs()[0].shape[-1]
    knows_styles = a.styles == "auto" and isinstance(vocab_size, int) and vocab_size > L.VOCAB.index("STYLE")
    rng = np.random.default_rng(1)
    rows = []
    fam_valid = defaultdict(lambda: [0, 0])
    fam_real = defaultdict(int)
    families_on_cards = 0
    for w, d in PLOTS:
        st = dict(tot=0, got=0, perfect=0, three=0, arr=0, diff=[])
        for beds in beds_allowed(w, d):
            for baths in range(beds, bands.max_baths(w, d, beds) + 1):
                for focus in bands.FOCUS_VALUES:
                    base = bands.prompt_for(w, d, beds, baths, focus)
                    styles = families_for(w, d, beds) if knows_styles else [None]
                    per = max(1, round(a.n / len(styles)))
                    good = []
                    for s in styles:
                        prompt = base + (f" STYLE {s}" if s else "")
                        for ids in sample(sess, [prompt] * per, max_new=170, rng=rng):
                            r, _ = L.reward(prompt, ids)
                            if s: fam_valid[s][1] += 1; fam_valid[s][0] += r > 0
                            if r > 0:
                                text = L.ids_to_plan_text(prompt, ids)
                                real = s and L.tree.family_of(L.parse_plan(text)[0])        # what was drawn, not what was asked
                                if s: fam_real[(s, real)] += 1
                                good.append((r, real, text))
                    good.sort(key=lambda g: -g[0])
                    picked = []
                    for s in styles:
                        best = next((g for g in good if g[1] == s and g not in picked), None)
                        if best and len(picked) < 3: picked.append(best)
                    for g in good:
                        if len(picked) < 3 and g not in picked and g[2] not in [p[2] for p in picked]: picked.append(g)
                    st["tot"] += 1
                    st["got"] += bool(good)
                    st["perfect"] += any(g[0] == 1.0 for g in good)
                    st["three"] += len(picked) == 3
                    families_on_cards += len({p[1] for p in picked})
                    if picked:
                        st["arr"] += len({E.skeleton(p[2]) for p in picked})
                        st["diff"] += [E.layout_distance(E.grid_of(p[2]), E.grid_of(q[2])) for p, q in itertools.combinations(picked, 2)]
        rows.append((f"{w}x{d}", round(w * d / 225, 1), st))
    print(f"{'plot':8s} {'marla':>6s} {'requests':>9s} {'answered':>9s} {'perfect':>8s} {'3 cards':>8s} {'arrangements':>13s} {'difference':>11s}")
    for name, marla, s in rows:
        print(f"{name:8s} {marla:>6} {s['tot']:>9} {s['got']:>9} {s['perfect']:>8} {s['three']:>8} "
              f"{s['arr'] / max(1, s['got']):>13.2f} {np.mean(s['diff']) if s['diff'] else 0:>11.3f}")
    T = lambda k: sum(s[k] for _, _, s in rows)
    alld = [x for _, _, s in rows for x in s["diff"]]
    print(f"\ntotal {T('tot')} requests: {T('got')} answered, {T('perfect')} with a perfect plan, {T('three')} with three cards; "
          f"{T('arr') / max(1, T('got')):.2f} arrangements per request on the cards, difference {np.mean(alld):.3f}")
    if fam_real:
        print(f"families per request on the cards: {families_on_cards / T('tot'):.2f}")
        print("asked -> drawn (valid samples): " + ", ".join(f"{a}->{b} {n}" for (a, b), n in sorted(fam_real.items())))
    if fam_valid:
        print("valid samples per family: " + ", ".join(f"{k} {v[0]}/{v[1]} ({100 * v[0] / v[1]:.0f}%)" for k, v in fam_valid.items()))


if __name__ == "__main__":
    main()
