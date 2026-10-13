"""Stage B - reinforcement learning with the rule checker as the reward (group-relative policy gradient, GRPO-style).

For each training prompt the model samples G plans; each plan is scored by the validator (tools/bands.py).
Plans better than their group's average get their tokens pushed up, worse ones pushed down; a KL penalty to the
frozen Stage-A model keeps the output realistic.

    python ml/rl.py --init runs/sft/model.pt --out runs/rl --steps 300
"""
import argparse, copy, json, os, random, sys, time
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402


def token_logprobs(model, prompts, comps):
    """log p(token | prefix) for every generated token. comps: list of id lists (EOS-terminated or full length)."""
    dev = next(model.parameters()).device
    seqs = []
    for p, c in zip(prompts, comps):
        c = list(c)
        if L.EOS in c: c = c[:c.index(L.EOS) + 1]
        else: c = [t for t in c if t != L.PAD]
        pre = [L.BOS] + L.encode(p) + [L.NL]
        seqs.append((pre, c))
    T = max(len(a) + len(b) for a, b in seqs)
    x = torch.full((len(seqs), T), L.PAD, dtype=torch.long)
    m = torch.zeros(len(seqs), T, dtype=torch.bool)
    for r, (a, b) in enumerate(seqs):
        x[r, :len(a) + len(b)] = torch.tensor(a + b)
        m[r, len(a):len(a) + len(b)] = True
    x, m = x.to(dev), m.to(dev)
    with torch.autocast(device_type=dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
        logits = model(x[:, :-1])
    lp = F.log_softmax(logits.float(), -1).gather(2, x[:, 1:].unsqueeze(2)).squeeze(2)
    return lp, m[:, 1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", required=True)
    ap.add_argument("--data", default="data/synth")
    ap.add_argument("--out", default="runs/rl")
    ap.add_argument("--steps", type=int, default=300)
    ap.add_argument("--prompts", type=int, default=32, help="prompts per step")
    ap.add_argument("--workers", type=int, default=0, help="CPU processes for reward scoring (0 = number of cores)")
    ap.add_argument("--group", type=int, default=8, help="samples per prompt")
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--beta", type=float, default=0.02, help="KL weight")
    ap.add_argument("--temp", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed)
    import multiprocessing as mp
    workers = a.workers or (os.cpu_count() or 1)
    pool = mp.Pool(workers) if workers > 1 else None                       # started before CUDA is initialised (safe to fork)
    dev = L.device()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    pol = L.load(a.init)
    ref = copy.deepcopy(pol).eval()
    for p in ref.parameters(): p.requires_grad_(False)
    opt = torch.optim.AdamW(pol.parameters(), lr=a.lr, weight_decay=0.0)
    prompts_all = sorted({json.loads(l)["prompt"] for l in open(f"{a.data}/train.jsonl", encoding="utf-8")})
    hist = []
    for step in range(1, a.steps + 1):
        t0 = time.time()
        ps = [p for p in random.sample(prompts_all, a.prompts) for _ in range(a.group)]
        pol.eval()
        comps = pol.sample(ps, temperature=a.temp)
        t_s = time.time()
        scored = pool.starmap(L.reward, zip(ps, comps), chunksize=8) if pool else [L.reward(p, c) for p, c in zip(ps, comps)]
        t_score = time.time() - t_s
        rs = torch.tensor([r[0] for r in scored], device=dev).view(a.prompts, a.group)
        adv = ((rs - rs.mean(1, keepdim=True)) / (rs.std(1, keepdim=True) + 1e-4)).view(-1)
        pol.train()
        lp, m = token_logprobs(pol, ps, comps)
        with torch.no_grad():
            rlp, _ = token_logprobs(ref, ps, comps)
        kl = (torch.exp(rlp - lp) - (rlp - lp) - 1)                        # k3 estimator of KL(policy || ref), per token
        per_tok = -(adv.unsqueeze(1) * lp) + a.beta * kl
        loss = (per_tok * m).sum() / m.sum()
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(pol.parameters(), 1.0)
        opt.step()
        h = {"step": step, "reward": rs.mean().item(), "perfect": (rs == 1).float().mean().item(), "zero": (rs == 0).float().mean().item(),
             "kl": ((kl * m).sum() / m.sum()).item(), "sec": round(time.time() - t0, 1), "score_sec": round(t_score, 2)}
        hist.append(h)
        if step % 10 == 0 or step == 1: print(h, flush=True)
        if step % 50 == 0 or step == a.steps:
            L.save(pol, out / "model.pt", {"rl_steps": step, "args": vars(a)})
            (out / "history.json").write_text(json.dumps(hist, indent=1))
    try:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 2, figsize=(9, 3))
        ax[0].plot([h["reward"] for h in hist]); ax[0].set_title("mean reward (rule score)"); ax[0].set_xlabel("RL step")
        ax[1].plot([h["perfect"] for h in hist]); ax[1].set_title("share of perfect plans"); ax[1].set_xlabel("RL step")
        fig.tight_layout(); fig.savefig(out / "rl.png", dpi=120)
    except Exception as e:
        print("no plot:", e)


if __name__ == "__main__":
    main()
