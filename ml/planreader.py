"""Plan reader: a U-Net CNN that looks at a floor-plan image and labels every pixel (wall, door/window, kitchen, bedroom ...).

    python ml/planreader.py train --data data/planreader --out runs/planreader --epochs 60
    python ml/planreader.py eval  --ckpt runs/planreader/model.pt --data data/planreader      (test split: per-class IoU)
    python ml/planreader.py export --ckpt runs/planreader/model.pt --out runs/planreader/planreader.onnx
    python ml/planreader.py read  --ckpt runs/planreader/model.pt --image plan.png             (rooms found in one image)

Data: CubiCasa5k (real/cubicasa_masks.py), 256 x 256 letterboxed images, 11 classes. Network: encoder-decoder with skip
connections (U-Net, Ronneberger et al. 2015), 4 down/up steps, bilinear upsampling, batch norm, 4.4 M parameters at width 24.
Loss: cross entropy with class weights (walls and doors are thin, background is huge) plus soft Dice. AdamW, one-cycle schedule,
mixed precision, flips / 90-degree turns / brightness and blur as augmentation (a plan is still a plan turned or photographed).
Metric: IoU per class and mean IoU on the held-out test plans.
"""
import argparse, json, math, sys, time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "real"))
NAMES = ["background", "wall", "door/window", "outdoor", "kitchen", "living/dining", "bedroom", "bathroom", "hall/entrance", "storage", "other room"]
NC = len(NAMES)


def block(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class UNet(nn.Module):
    def __init__(self, width=24, classes=NC, depth=4):
        super().__init__()
        ch = [width * 2 ** k for k in range(depth + 1)]                  # 24, 48, 96, 192, 384
        self.cfg = {"width": width, "classes": classes, "depth": depth}
        self.enc = nn.ModuleList([block(3, ch[0])] + [block(ch[k], ch[k + 1]) for k in range(depth)])
        self.dec = nn.ModuleList([block(ch[k + 1] + ch[k], ch[k]) for k in reversed(range(depth))])
        self.head = nn.Conv2d(ch[0], classes, 1)

    def forward(self, x):
        skips = []
        for k, e in enumerate(self.enc):
            x = e(x if k == 0 else F.max_pool2d(x, 2))
            skips.append(x)
        x = skips.pop()
        for d in self.dec:
            s = skips.pop()
            x = d(torch.cat([F.interpolate(x, size=s.shape[-2:], mode="bilinear", align_corners=False), s], 1))
        return self.head(x)


MEAN, STD = 0.5, 0.5


def prep(x):                                                             # uint8 [B, H, W, 3] -> float [B, 3, H, W] in about [-1, 1]
    return (x.permute(0, 3, 1, 2).float() / 255 - MEAN) / STD


def augment(x, y):
    """x uint8 [B, H, W, 3], y uint8 [B, H, W] on the GPU: random turn / flip of the whole batch element, brightness, contrast, blur, noise."""
    out_x, out_y = [], []
    for i in range(x.shape[0]):
        a, b = x[i], y[i]
        k = int(torch.randint(0, 4, ()))
        if k: a, b = torch.rot90(a, k, (0, 1)), torch.rot90(b, k, (0, 1))
        if torch.rand(()) < 0.5: a, b = a.flip(1), b.flip(1)
        out_x.append(a); out_y.append(b)
    x, y = torch.stack(out_x), torch.stack(out_y)
    f = prep(x)
    B = f.shape[0]
    f = f * (1 + (torch.rand(B, 1, 1, 1, device=f.device) - 0.5) * 0.5) + (torch.rand(B, 1, 1, 1, device=f.device) - 0.5) * 0.5     # contrast, brightness
    blur = torch.rand(B, device=f.device) < 0.3
    if blur.any(): f[blur] = F.avg_pool2d(F.pad(f[blur], (1, 1, 1, 1), mode="replicate"), 3, 1)                                      # a soft photo
    f = f + torch.randn_like(f) * 0.03 * (torch.rand(B, 1, 1, 1, device=f.device) < 0.5)
    return f, y.long()


def dice_loss(logits, y):
    p = logits.softmax(1)
    oh = F.one_hot(y, NC).permute(0, 3, 1, 2).float()
    inter = (p * oh).sum((0, 2, 3)); den = p.sum((0, 2, 3)) + oh.sum((0, 2, 3))
    present = oh.sum((0, 2, 3)) > 0
    return 1 - ((2 * inter + 1) / (den + 1))[present].mean()


@torch.no_grad()
def evaluate(model, x, y, dev, bs=64):
    model.eval()
    inter = torch.zeros(NC); union = torch.zeros(NC); correct = 0; total = 0
    for i in range(0, len(x), bs):
        xb = prep(torch.from_numpy(x[i:i + bs]).to(dev)); yb = torch.from_numpy(y[i:i + bs]).to(dev).long()
        with torch.autocast(device_type=dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
            p = model(xb).argmax(1)
        correct += (p == yb).sum().item(); total += yb.numel()
        for c in range(NC):
            a, b = p == c, yb == c
            inter[c] += (a & b).sum().item(); union[c] += (a | b).sum().item()
    iou = torch.where(union > 0, inter / union.clamp(min=1), torch.full((NC,), float("nan")))
    return {"pixel_acc": correct / total, "mIoU": float(np.nanmean(iou.numpy())), "iou": {NAMES[c]: round(float(iou[c]), 4) for c in range(NC)}}


def load(path, dev=None):
    ck = torch.load(path, map_location=dev or "cpu", weights_only=False)
    m = UNet(**ck["cfg"]); m.load_state_dict(ck["state"])
    return m.to(dev or "cpu").eval()


def train(a):
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    d = Path(a.data)
    tr, va = np.load(d / "train.npz"), np.load(d / "val.npz")
    xt, yt, xv, yv = tr["x"], tr["y"], va["x"], va["y"]
    if a.limit: xt, yt = xt[: a.limit], yt[: a.limit]
    print(f"train {len(xt)}  val {len(xv)}  device {dev}", flush=True)
    freq = np.bincount(yt.ravel(), minlength=NC).astype(np.float64); freq /= freq.sum()
    w = torch.tensor(1 / np.sqrt(freq + 1e-4), dtype=torch.float32); w = (w / w.mean()).to(dev)            # thin walls and doors count for more than empty background
    model = UNet(a.width).to(dev)
    print("parameters", sum(p.numel() for p in model.parameters()), flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    steps = a.epochs * math.ceil(len(xt) / a.bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps, pct_start=0.15)
    scaler = torch.cuda.amp.GradScaler(enabled=dev.type == "cuda")
    xg, yg = torch.from_numpy(xt), torch.from_numpy(yt)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    best, hist = -1, []
    for ep in range(1, a.epochs + 1):
        model.train(); t0 = time.time(); tot = 0; n = 0
        perm = torch.randperm(len(xg))
        for i in range(0, len(perm) - a.bs + 1, a.bs):
            idx = perm[i:i + a.bs]
            xb, yb = augment(xg[idx].to(dev), yg[idx].to(dev))
            with torch.autocast(device_type=dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
                lg = model(xb)
            loss = F.cross_entropy(lg.float(), yb, weight=w) + dice_loss(lg.float(), yb)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
            tot += loss.item(); n += 1
        r = evaluate(model, xv, yv, dev)
        hist.append({"epoch": ep, "loss": round(tot / n, 4), "val_mIoU": round(r["mIoU"], 4), "val_acc": round(r["pixel_acc"], 4), "sec": round(time.time() - t0, 1)})
        print(hist[-1], flush=True)
        if r["mIoU"] > best:
            best = r["mIoU"]
            torch.save({"cfg": model.cfg, "state": model.state_dict(), "val": r, "epoch": ep}, out / "model.pt")
    (out / "history.json").write_text(json.dumps(hist, indent=1))
    try:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 2, figsize=(9, 3))
        ax[0].plot([h["loss"] for h in hist]); ax[0].set_title("training loss"); ax[0].set_xlabel("epoch")
        ax[1].plot([h["val_mIoU"] for h in hist]); ax[1].set_title("validation mean IoU"); ax[1].set_xlabel("epoch")
        fig.tight_layout(); fig.savefig(out / "curves.png", dpi=120)
    except Exception as e:
        print("no plot:", e)
    print("best val mIoU", round(best, 4))


def evaluate_cli(a):
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    m = load(a.ckpt, dev)
    te = np.load(Path(a.data) / "test.npz")
    r = evaluate(m, te["x"], te["y"], dev)
    r["parameters"] = sum(p.numel() for p in m.parameters())
    base = np.bincount(te["y"].ravel(), minlength=NC); r["baseline_all_background_pixel_acc"] = round(float(base[0] / base.sum()), 4)
    print(json.dumps(r, indent=1))
    if a.out: Path(a.out).write_text(json.dumps(r, indent=1))


def export(a):
    m = load(a.ckpt)
    x = torch.zeros(1, 3, 256, 256)
    torch.onnx.export(m, x, a.out, input_names=["image"], output_names=["logits"], opset_version=17, dynamo=False,
                      dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}})
    import onnxruntime as ort
    s = ort.InferenceSession(a.out)
    xs = torch.randn(2, 3, 256, 256)
    d = np.abs(s.run(None, {"image": xs.numpy()})[0] - m(xs).detach().numpy()).max()
    print(f"exported {a.out} ({Path(a.out).stat().st_size / 1e6:.1f} MB), max |logit diff| vs PyTorch {d:.5f}")


def read(a):
    """One image -> the rooms found: class, size share and bounding box (in 256-pixel units)."""
    from PIL import Image
    from scipy import ndimage
    m = load(a.ckpt)
    im = Image.open(a.image).convert("RGB"); k = 256 / max(im.size)
    nw, nh = round(im.size[0] * k), round(im.size[1] * k)
    canvas = Image.new("RGB", (256, 256), (255, 255, 255)); canvas.paste(im.resize((nw, nh)), ((256 - nw) // 2, (256 - nh) // 2))
    with torch.no_grad(): p = m(prep(torch.from_numpy(np.asarray(canvas)[None].copy()))).argmax(1)[0].numpy()
    for c in range(3, NC):
        lab, n = ndimage.label(p == c)
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if len(ys) > 120: print(NAMES[c], "x", xs.min(), xs.max(), "y", ys.min(), ys.max(), "area", len(ys))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train"); t.add_argument("--data", default="data/planreader"); t.add_argument("--out", default="runs/planreader")
    t.add_argument("--epochs", type=int, default=60); t.add_argument("--bs", type=int, default=32); t.add_argument("--lr", type=float, default=2e-3)
    t.add_argument("--width", type=int, default=24); t.add_argument("--limit", type=int, default=None)
    e = sub.add_parser("eval"); e.add_argument("--ckpt", required=True); e.add_argument("--data", default="data/planreader"); e.add_argument("--out", default=None)
    x = sub.add_parser("export"); x.add_argument("--ckpt", required=True); x.add_argument("--out", required=True)
    r = sub.add_parser("read"); r.add_argument("--ckpt", required=True); r.add_argument("--image", required=True)
    a = ap.parse_args()
    {"train": train, "eval": evaluate_cli, "export": export, "read": read}[a.cmd](a)
