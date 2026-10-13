"""Export a trained layout model to ONNX so it can run in the browser (onnxruntime-web, open source, no server).

    python ml/export_onnx.py --ckpt runs/rl_v5/model.pt --out models/layout
Writes  models/layout.onnx  (int8-quantised, small download)  and  models/vocab.json  (tokens the JS sampler needs).
The graph decodes ONE token per call with a key/value cache (ids, pos, past_k, past_v -> logits, k, v); the browser
feeds the prompt token by token, then samples, appends and repeats.
"""
import argparse, json, sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layoutlm as L  # noqa: E402


class Step(torch.nn.Module):
    """One decoding step with a key/value cache: (token, position, past keys, past values) -> (logits, new keys, new values).
    Prompt tokens are fed one at a time too, so the graph never needs a causal mask and the browser stays fast."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, ids, pos, past_k, past_v):             # ids [B,1]  pos [1]  past_* [layers,B,heads,P,head_dim]
        m = self.m
        x = m.tok(ids) + m.pos(pos)
        ks, vs = [], []
        for i, b in enumerate(m.blocks):
            x, (k, v) = b(x, (past_k[i], past_v[i]))
            ks.append(k); vs.append(v)
        return m.head(m.ln(x))[:, -1, :], torch.stack(ks), torch.stack(vs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", default="models/layout")
    ap.add_argument("--no-quant", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    model = L.load(a.ckpt, map_location="cpu").eval()
    wrapper = Step(model).eval()
    cfg = model.cfg
    Ln, H, hd = cfg["layers"], cfg["heads"], cfg["d"] // cfg["heads"]
    ids = torch.tensor([[L.BOS]]); pos = torch.tensor([0])
    pk = torch.zeros(Ln, 1, H, 3, hd); pv = torch.zeros(Ln, 1, H, 3, hd)         # example past of length 3 (axis is dynamic)
    pos = torch.tensor([3])
    fp32 = out.with_suffix(".fp32.onnx")
    torch.onnx.export(wrapper, (ids, pos, pk, pv), str(fp32), input_names=["ids", "pos", "past_k", "past_v"],
                      output_names=["logits", "k", "v"], opset_version=17, dynamo=False,
                      dynamic_axes={"ids": {0: "batch"}, "past_k": {1: "batch", 3: "past"}, "past_v": {1: "batch", 3: "past"},
                                    "logits": {0: "batch"}, "k": {1: "batch", 3: "total"}, "v": {1: "batch", 3: "total"}})

    final = fp32
    if not a.no_quant:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        final = out.with_suffix(".onnx")
        quantize_dynamic(str(fp32), str(final), weight_type=QuantType.QInt8)
        fp32.unlink()
    else:
        final = fp32.rename(out.with_suffix(".onnx"))

    # check: decode a whole prompt token by token with the ONNX graph and compare with the PyTorch model
    import onnxruntime as ort
    sess = ort.InferenceSession(str(final), providers=["CPUExecutionProvider"])
    seq = [L.BOS] + L.encode("PLOT 30x60 BEDS 3") + [L.NL] + L.encode("10: lawn") + [L.NL] + L.encode("12: void 3 | drawing 20")
    ref = model(torch.tensor([seq]))[0].detach().numpy()                        # [T, V]
    k = np.zeros((Ln, 1, H, 0, hd), np.float32); v = np.zeros((Ln, 1, H, 0, hd), np.float32)
    worst, agree = 0.0, 0
    for t, tok in enumerate(seq):
        lg, k, v = sess.run(None, {"ids": np.array([[tok]], np.int64), "pos": np.array([t], np.int64), "past_k": k, "past_v": v})
        worst = max(worst, float(np.abs(ref[t] - lg[0]).max())); agree += int(ref[t].argmax() == lg[0].argmax())
    print(f"exported {final}  {final.stat().st_size / 1e6:.1f} MB   max|logit diff| {worst:.3f}   top-1 agrees on {agree}/{len(seq)} positions")

    vocab = {"tokens": L.VOCAB, "bos": L.BOS, "eos": L.EOS, "pad": L.PAD, "nl": L.NL, "max_len": model.cfg["max_len"]}
    (out.parent / "vocab.json").write_text(json.dumps(vocab))
    print("wrote", out.parent / "vocab.json")


if __name__ == "__main__":
    main()
