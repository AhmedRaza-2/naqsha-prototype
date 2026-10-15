"""Stage A - supervised training of the layout transformer on synthetic band-format plans.

Single GPU / CPU:   python ml/train.py --epochs 16 --mirror --out runs/sft
Both Kaggle T4s:    torchrun --nproc_per_node=2 ml/train.py --epochs 16 --mirror --bs 256 --lr 1.5e-3 --out runs/sft
Speed features: fp16 mixed precision (--no-amp to disable), the whole tokenised dataset lives on the GPU (no per-step CPU
batching), per-batch padding trimming, and PyTorch DistributedDataParallel when launched with torchrun
(each GPU trains on its own slice of every batch and gradients are averaged = data parallelism).
Writes <out>/model.pt, history.json (loss + samples/s per epoch) and loss.png.

Fine-tuning on real plans (after the synthetic pre-training):
    python ml/train.py --init runs/rl_v9/model.pt --extra data/real/train.jsonl --extra-mult 20         --extra-val data/real/val.jsonl --select extra --epochs 4 --lr 3e-4 --out runs/ft_real
--extra rows are repeated --extra-mult times and mixed with the synthetic training set (so the model keeps what it
learned there); --extra-val reports the loss on held-out real plans every epoch, and --select extra keeps the
checkpoint with the lowest real-plan loss.
"""
import argparse, json, math, os, random, sys, time
from pathlib import Path

import torch
import torch.distributed as dist
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402


MAX_LEN = 256


def read(path, limit=None, mirror=False):
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    rows = rows[:limit] if limit else rows
    ex = [L.make_example(r["prompt"], r["completion"]) for r in rows]
    keep = [len(e[0]) <= MAX_LEN for e in ex]                  # plans longer than the model's context are skipped
    rows = [r for r, k in zip(rows, keep) if k]
    ex = [e for e, k in zip(ex, keep) if k]
    if mirror:                                              # augmentation: left-right mirrored copy of every plan
        for r in rows:
            ex.append(L.make_example(r["prompt"], L.mirror_text(r["prompt"], r["completion"])))
    return ex


def to_tensors(ex, dev):
    """List of (ids, loss_start) -> padded id matrix, loss mask and lengths, all resident on the device."""
    T = max(len(i) for i, _ in ex)
    X = torch.full((len(ex), T), L.PAD, dtype=torch.long)
    M = torch.zeros(len(ex), T, dtype=torch.bool)           # True where the loss counts (completion + EOS)
    lens = torch.tensor([len(i) for i, _ in ex])
    for r, (ids, s) in enumerate(ex):
        X[r, :len(ids)] = torch.tensor(ids)
        M[r, s:len(ids)] = True
    return X.to(dev), M.to(dev), lens.to(dev)


def get_batch(data, idx):
    X, M, lens = data
    T = int(lens[idx].max())                                # trim padding to the longest sequence in this batch
    return X[idx, :T], M[idx, :T]


def loss_fn(model, x, m, amp):
    with torch.autocast(device_type=x.device.type, dtype=torch.float16, enabled=amp):
        logits = model(x[:, :-1])
    tgt, mk = x[:, 1:], m[:, 1:]
    return F.cross_entropy(logits[mk].float(), tgt[mk])


@torch.no_grad()
def evaluate(model, data, amp, bs=512):
    model.eval()
    tot, n = 0.0, 0
    for i in range(0, data[0].shape[0], bs):
        x, m = get_batch(data, torch.arange(i, min(i + bs, data[0].shape[0]), device=data[0].device))
        k = m[:, 1:].sum().item()
        tot += loss_fn(model, x, m, amp).item() * k
        n += k
    return tot / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/synth")
    ap.add_argument("--out", default="runs/sft")
    ap.add_argument("--epochs", type=int, default=16)
    ap.add_argument("--bs", type=int, default=256, help="global batch size (split across GPUs)")
    ap.add_argument("--lr", type=float, default=1.5e-3)
    ap.add_argument("--d", type=int, default=256)
    ap.add_argument("--layers", type=int, default=6)
    ap.add_argument("--heads", type=int, default=8)
    ap.add_argument("--dropout", type=float, default=0.1)
    ap.add_argument("--mirror", action="store_true", help="add mirrored copies of the training plans")
    ap.add_argument("--no-amp", action="store_true", help="disable fp16 mixed precision")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--init", default=None, help="start from this checkpoint (fine-tuning) instead of random weights")
    ap.add_argument("--extra", action="append", default=[], help="extra training rows, repeatable; 'file*k' repeats that file k times")
    ap.add_argument("--extra-mult", type=int, default=1, help="repeat the extra rows this many times")
    ap.add_argument("--extra-val", default=None, help="held-out real plans: loss reported every epoch")
    ap.add_argument("--select", choices=["val", "extra"], default="val", help="keep the checkpoint with the best synthetic or real loss")
    a = ap.parse_args()

    ddp = "RANK" in os.environ and torch.cuda.is_available()
    if ddp:
        dist.init_process_group("nccl")
        rank, world, local = dist.get_rank(), dist.get_world_size(), int(os.environ["LOCAL_RANK"])
        torch.cuda.set_device(local)
        dev = torch.device("cuda", local)
    else:
        rank, world, dev = 0, 1, L.device()
    amp = dev.type == "cuda" and not a.no_amp
    random.seed(a.seed + rank); torch.manual_seed(a.seed + rank)      # different dropout masks per GPU
    main_proc = rank == 0
    out = Path(a.out)
    if main_proc: out.mkdir(parents=True, exist_ok=True)

    ex = read(f"{a.data}/train.jsonl", a.limit, a.mirror)
    n_extra = 0
    for f in a.extra:
        path, _, k = f.partition("*")
        ext = read(path, None, a.mirror) * (int(k) if k else a.extra_mult)
        ex += ext; n_extra += len(ext)
    tr = to_tensors(ex, dev)
    va = to_tensors(read(f"{a.data}/val.jsonl", a.limit), dev)
    xv = to_tensors(read(a.extra_val), dev) if a.extra_val else None
    N = tr[0].shape[0]
    core = L.load(a.init, dev) if a.init else L.LayoutLM(a.d, a.layers, a.heads, 256, a.dropout).to(dev)
    model = torch.nn.parallel.DistributedDataParallel(core, device_ids=[dev.index]) if ddp else core
    pb = max(1, a.bs // world)                              # per-GPU batch
    steps_per_epoch = N // (pb * world)
    steps = a.epochs * steps_per_epoch
    if main_proc:
        print(f"device={dev} gpus={world} amp={amp} params={sum(p.numel() for p in core.parameters()) / 1e6:.2f}M "
              f"train={N} (real rows incl. repeats: {n_extra}) val={va[0].shape[0]} real_val={xv[0].shape[0] if xv else 0} "
              f"init={a.init or 'random'} global_bs={pb * world} steps/epoch={steps_per_epoch}", flush=True)
        if xv: print({"epoch": 0, "val_loss": evaluate(core, va, amp), "real_val_loss": evaluate(core, xv, amp)}, flush=True)
    opt = torch.optim.AdamW(core.parameters(), lr=a.lr, betas=(0.9, 0.95), weight_decay=0.1, fused=dev.type == "cuda")
    warm = max(1, steps // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1, s / steps))))
    scaler = torch.amp.GradScaler("cuda", enabled=amp)

    hist, best = [], 1e9
    for ep in range(1, a.epochs + 1):
        model.train()
        g = torch.Generator().manual_seed(a.seed * 1000 + ep)                    # same permutation on every GPU
        perm = torch.randperm(N, generator=g).to(dev)[: steps_per_epoch * pb * world].view(steps_per_epoch, world, pb)
        if dev.type == "cuda": torch.cuda.synchronize()
        t0, tot = time.time(), torch.zeros((), device=dev)
        for s in range(steps_per_epoch):
            x, m = get_batch(tr, perm[s, rank])                                   # each GPU takes its own slice of the batch
            loss = loss_fn(model, x, m, amp)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(core.parameters(), 1.0)
            scaler.step(opt); scaler.update(); sched.step()
            tot += loss.detach()
        if dev.type == "cuda": torch.cuda.synchronize()
        sec = time.time() - t0
        tl = tot / steps_per_epoch
        if ddp: dist.all_reduce(tl); tl /= world
        if main_proc:
            v = evaluate(core, va, amp)
            rv = evaluate(core, xv, amp) if xv else None
            hist.append({"epoch": ep, "train_loss": tl.item(), "val_loss": v, **({"real_val_loss": rv} if xv else {}), "sec": round(sec, 1),
                         "samples_per_sec": round(steps_per_epoch * pb * world / sec)})
            print(hist[-1], flush=True)
            key = rv if a.select == "extra" and xv else v
            if key < best:
                best = key
                L.save(core, out / "model.pt", {"val_loss": v, "real_val_loss": rv, "args": vars(a)})
            (out / "history.json").write_text(json.dumps(hist, indent=1))
        if ddp: dist.barrier()
    if main_proc:
        try:
            import matplotlib; matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            plt.plot([h["train_loss"] for h in hist], label="train"); plt.plot([h["val_loss"] for h in hist], label="val (unseen plot sizes)")
            if xv: plt.plot([h["real_val_loss"] for h in hist], label="real plans (held out)")
            plt.xlabel("epoch"); plt.ylabel("cross-entropy"); plt.legend(); plt.savefig(out / "loss.png", dpi=120)
        except Exception as e:
            print("no plot:", e)
        print(f"best {'real' if a.select == 'extra' and xv else 'val'} loss", round(best, 4))
    if ddp: dist.destroy_process_group()


if __name__ == "__main__":
    main()
