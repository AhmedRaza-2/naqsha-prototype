"""Tokenizer + small GPT-style transformer for band-format house layouts (written from scratch in PyTorch).

Sequence = [BOS] PLOT 30 x 55 BEDS 3 \\n 10 : lawn 30 \\n ... [EOS]   (word-level, vocabulary ~330)
The prompt is everything up to the first newline; the loss is computed on what comes after it.
"""
import math, re, sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import bands  # noqa: E402  (validator / parser used for evaluation and as the RL reward)

# ---------------------------------------------------------------- tokenizer
NUMS = [f"{v / 2:g}" for v in range(1, 301)]                       # 0.5 .. 150 on the 0.5 ft grid
WORDS = ["PLOT", "BEDS", "BATHS", "FOCUS", "rest", "bath", "L", "R", "balanced", "bedrooms"] + sorted(bands.TYPES - {"bath"})
PUNCT = ["\n", ":", "|", "+", "x"]
VOCAB = ["<pad>", "<bos>", "<eos>"] + PUNCT + WORDS + NUMS
STOI = {t: i for i, t in enumerate(VOCAB)}
PAD, BOS, EOS, NL = STOI["<pad>"], STOI["<bos>"], STOI["<eos>"], STOI["\n"]


def _split_x(text):
    """Protect the multiplication 'x' (between digits) so it becomes its own token 'X' instead of part of a word."""
    return re.sub(r"(?<=\d)x(?=\d)", " X ", text)


def encode(text):
    toks = re.findall(r"\d+(?:\.\d+)?|[A-Za-z]+|[:|+\n]", _split_x(text))
    return [STOI["x" if t == "X" else t] for t in toks]


def decode(ids):
    out, prev = [], None
    for i in ids:
        if i in (PAD, BOS):
            continue
        if i == EOS:
            break
        t = VOCAB[i]
        if prev is None or prev == "\n":
            sep = ""
        elif t == ":" or t == "x" or prev == "x" or prev == "+":
            sep = ""
        else:
            sep = " "
        if t == "\n":
            sep = ""
        out.append(sep + t)
        prev = t
    return "".join(out)


def make_example(prompt, completion):
    """-> (ids, loss_start). Loss covers the completion and EOS, not the prompt."""
    p = [BOS] + encode(prompt) + [NL]
    return p + encode(completion) + [EOS], len(p)


# ---------------------------------------------------------------- model
class Block(nn.Module):
    def __init__(self, d, heads, drop):
        super().__init__()
        self.h = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv, self.proj = nn.Linear(d, 3 * d), nn.Linear(d, d)
        self.mlp = nn.Sequential(nn.Linear(d, 4 * d), nn.GELU(), nn.Linear(4 * d, d))
        self.drop = nn.Dropout(drop)

    def forward(self, x, past=None):
        """past = (k, v) of the tokens already processed (generation); then x is the single new token."""
        B, T, C = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(B, T, 3, self.h, C // self.h).permute(2, 0, 3, 1, 4)
        if past is not None:
            k, v = torch.cat([past[0], k], 2), torch.cat([past[1], v], 2)
        a = F.scaled_dot_product_attention(q, k, v, is_causal=past is None).transpose(1, 2).reshape(B, T, C)
        x = x + self.drop(self.proj(a))
        return x + self.drop(self.mlp(self.ln2(x))), (k, v)


class LayoutLM(nn.Module):
    def __init__(self, d=256, layers=6, heads=8, max_len=256, drop=0.1):
        super().__init__()
        self.cfg = dict(d=d, layers=layers, heads=heads, max_len=max_len, drop=drop)
        self.tok, self.pos = nn.Embedding(len(VOCAB), d), nn.Embedding(max_len, d)
        self.blocks = nn.ModuleList(Block(d, heads, drop) for _ in range(layers))
        self.ln = nn.LayerNorm(d)
        self.head = nn.Linear(d, len(VOCAB), bias=False)
        self.head.weight = self.tok.weight                        # weight tying
        self.drop = nn.Dropout(drop)
        self.apply(self._init)

    @staticmethod
    def _init(m):
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, 0, 0.02)
        if isinstance(m, nn.Linear) and m.bias is not None:
            nn.init.zeros_(m.bias)

    def forward(self, ids, past=None, return_past=False):
        """Training: forward(ids) -> logits. Generation: pass `past` (list of per-layer (k, v)) and only the new token."""
        T, off = ids.shape[1], (past[0][0].shape[2] if past else 0)
        x = self.drop(self.tok(ids) + self.pos(torch.arange(off, off + T, device=ids.device)))
        presents = []
        for i, b in enumerate(self.blocks):
            x, kv = b(x, past[i] if past else None)
            presents.append(kv)
        logits = self.head(self.ln(x))
        return (logits, presents) if return_past else logits

    @torch.no_grad()
    def sample(self, prompts, temperature=1.0, top_k=0, max_new=200):
        """Autoregressive sampling for a list of prompt strings -> list of completion strings."""
        dev = next(self.parameters()).device
        starts = [[BOS] + encode(p) + [NL] for p in prompts]
        # group by prompt length so every row in a batch has an aligned prefix
        order = sorted(range(len(starts)), key=lambda i: len(starts[i]))
        res = [None] * len(starts)
        i = 0
        while i < len(order):
            j = i
            while j < len(order) and len(starts[order[j]]) == len(starts[order[i]]): j += 1
            idx = order[i:j]
            x = torch.tensor([starts[k] for k in idx], device=dev)
            n0 = x.shape[1]
            done = torch.zeros(len(idx), dtype=torch.bool, device=dev)
            past, inp = None, x                                          # key/value cache: after the first pass feed only the new token
            with torch.autocast(device_type=dev.type, dtype=torch.float16, enabled=dev.type == "cuda"):
                for _ in range(min(max_new, self.cfg["max_len"] - n0)):
                    logits, past = self(inp, past, return_past=True)
                    logits = logits[:, -1].float() / max(temperature, 1e-4)
                    if top_k:
                        v, _ = logits.topk(top_k)
                        logits[logits < v[:, [-1]]] = -float("inf")
                    nxt = torch.multinomial(F.softmax(logits, -1), 1) if temperature > 0 else logits.argmax(-1, keepdim=True)
                    nxt[done] = PAD
                    x = torch.cat([x, nxt], 1)
                    inp = nxt
                    done |= nxt.squeeze(1) == EOS
                    if done.all(): break
            for r, k in enumerate(idx):
                res[k] = x[r, n0:].tolist()
            i = j
        return res                                                   # token ids after the prompt (EOS/PAD terminated)


def ids_to_plan_text(prompt, completion_ids):
    return prompt + "\n" + decode(completion_ids)


def reward(prompt, completion_ids):
    """Rule-checker reward in [0,1]; 0 if the text does not even parse. Returns (reward, failed_check_names)."""
    try:
        plan = bands.parse(ids_to_plan_text(prompt, completion_ids))
        cs = bands.check(plan, plan["beds"])
    except Exception:
        return 0.0, ["unparseable"]
    return bands.score(cs), bands.failed(cs)


def device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def save(model, path, extra=None):
    torch.save({"cfg": model.cfg, "state": model.state_dict(), **(extra or {})}, path)


def load(path, map_location=None):
    ck = torch.load(path, map_location=map_location or device(), weights_only=False)
    m = LayoutLM(**ck["cfg"])
    m.load_state_dict(ck["state"])
    return m.to(map_location or device())
