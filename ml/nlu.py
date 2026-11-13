"""The request reader: a small transformer that reads a typed or spoken house request ("we need four bedrooms, parking
for a couple of cars, plot thirty by sixty, do manzil") and marks what each number means and what the sentence asks for.

  python ml/nlu.py gen     -> data for training (made from templates: English and Roman Urdu, speech slips, typing slips)
  python ml/nlu.py train   -> trains, reports held-out accuracy, writes models/nlu.onnx + models/nlu.json

Word level: every word is the sum of hashed character n-gram vectors (so "barla", "marlah" and "marla" land close together
and a new spelling still reads), a 2-layer transformer encoder, a tag per word and a set of yes/no labels per sentence.
The same tokenizer and hashing are written again in js/nlu.js; ml/nlu.py check compares the two on the test set.
"""
import json, math, random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAGS = ['O', 'PLOT_W', 'PLOT_D', 'MARLA', 'KANAL', 'BEDS', 'BEDS_UP', 'BEDS_DOWN', 'BATHS', 'CARS', 'SB_FRONT', 'SB_REAR', 'SB_SIDE']
LABELS = ['floors_1', 'floors_2', 'porch_yes', 'porch_no', 'lawn_no', 'terrace_yes', 'terrace_no', 'omit_dining', 'omit_drawing', 'omit_study', 'omit_store',
          'focus_lounge', 'focus_bedrooms', 'focus_kitchen', 'stairs_none', 'up_drawing', 'style_modern', 'style_classic', 'style_spanish']
BUCKETS, GRAMS, MAXT, DIM = 8192, 20, 56, 64

# ---------------------------------------------------------------- tokenizer and hashing (mirrored in js/nlu.js)
def tokenize(text):
    t = text.lower().replace('×', ' x ').replace('✕', ' x ').replace('*', ' x ')
    t = re.sub(r'(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)', ' ', t)
    return re.findall(r'\d+(?:\.\d+)?|[a-z]+|\+', t)[:MAXT]

def fnv(s):
    h = 2166136261
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h

def grams(tok):
    if tok[0].isdigit():
        v = float(tok)
        out = ['<num>', '<n1>' if v <= 6 else '<n2>' if v <= 12 else '<n3>' if v <= 30 else '<n4>' if v <= 120 else '<n5>', '#' + tok]
    else:
        w = '<' + tok + '>'
        out = [w] + [w[i:i + n] for n in (2, 3, 4) for i in range(len(w) - n + 1)]
    return [1 + fnv(g) % BUCKETS for g in out[:GRAMS]]

# ---------------------------------------------------------------- data from templates
NUMW = {1: ['one', 'ek', 'aik'], 2: ['two', 'do'], 3: ['three', 'teen'], 4: ['four', 'char', 'chaar'], 5: ['five', 'panch', 'paanch'], 6: ['six', 'chay'],
        7: ['seven', 'saat'], 8: ['eight', 'aath'], 9: ['nine', 'nau'], 10: ['ten', 'das'], 12: ['twelve', 'barah'], 15: ['fifteen'], 20: ['twenty', 'bees']}
ASR = {'marla': ['barla', 'merla', 'mala', 'marlah', 'marlas', 'marley'], 'bedroom': ['bed room', 'bent room', 'bad room', 'bedrum'], 'bedrooms': ['bed rooms', 'bedroom', 'bad rooms'],
       'storey': ['story', 'stories', 'storeys', 'storie'], 'kanal': ['canal', 'kanaal', 'kennel'], 'porch': ['porsche', 'poach', 'porche'], 'feet': ['fit', 'ft', 'foot'],
       'washrooms': ['wash rooms', 'washroom'], 'bathrooms': ['bath rooms', 'bathroom'], 'upstairs': ['up stairs', 'upstair'], 'downstairs': ['down stairs'], 'terrace': ['terrance', 'teras'],
       'lounge': ['launch', 'loung'], 'drawing': ['droing', 'draw'], 'double': ['dubble', 'doubles'], 'single': ['singles'], 'setback': ['set back'], 'garage': ['garaj', 'garrage']}

def num(rng, n, words=0.35):
    """A number as it is typed or spoken: digits, or a word."""
    if n in NUMW and rng.random() < words: return rng.choice(NUMW[n])
    return str(n) if n == int(n) else str(n)

def clause(rng, pat, tag=None, n=None):
    """'{n}' in the pattern becomes the number (tagged `tag`); every other word is 'O'."""
    out = []
    for w in pat.split():
        if w == '{n}': out.append((num(rng, n), tag))
        elif w.startswith('{') and w.endswith('}'): out.append((w[1:-1], tag))        # a word that carries the value: {couple}, {double}, {no}
        else: out.append((w, 'O'))
    return out

BED = ['{n} bed', '{n} beds', '{n} bedroom', '{n} bedrooms', '{n} bed rooms', '{n} bhk', '{n} kamre', '{n} kamray', '{n} rooms', 'bedrooms {n}', 'beds {n}', '{n} sleeping rooms',
       'we need {n} bedrooms', 'bedrooms should be {n}', '{n} bedrooms in total', '{n} bedroom house', 'number of bedrooms is {n}', 'sone ke {n} kamre', '{n} bed house',
       'total {n} bedrooms', 'bedrooms we want {n}', '{n} rooms for sleeping', 'it should have {n} bedrooms', 'family needs {n} bedrooms', '{n} bed with attached bath', 'room count {n}']
BED_UP = ['{n} bedrooms upstairs', '{n} upstairs', 'upstairs {n} bedrooms', '{n} beds on the first floor', 'first floor {n} bed', 'upar {n} kamre', '{n} rooms on the top floor',
          'upper portion {n} bedrooms', '{n} bed on first floor', 'and {n} above', '{n} bedrooms on the upper floor', 'first floor should have {n} bedrooms', '{n} upar']
BED_DN = ['{n} bedrooms downstairs', '{n} downstairs', 'ground floor {n} bedrooms', 'neeche {n} kamre', '{n} bed on ground', 'lower portion {n} bed', '{n} bedrooms on the ground floor',
          'ground floor should have {n} bedrooms', '{n} neeche', '{n} beds below']
BATH = ['{n} bath', '{n} baths', '{n} bathrooms', '{n} washrooms', '{n} toilets', '{n} attached baths', 'washrooms {n}', 'bathrooms should be {n}', '{n} attached bathrooms', '{n} wash rooms', 'total {n} washrooms', '{n} ghusal khane']
CAR = ['{n} car porch', '{n} cars', 'parking for {n} cars', 'space for {n} vehicles', '{n} car parking', 'garage for {n} cars', '{n} gari ki parking', 'park {n} cars', 'porch for {n} cars',
       'room to park {n} cars', '{n} gaari', 'we have {n} cars', '{n} car garage', 'parking of {n} cars', '{n} vehicles parking']
CAR_W = [('a {couple} of cars', 2), ('{double} car porch', 2), ('{single} car garage', 1), ('{double} car garage', 2), ('{single} car porch', 1), ('{triple} car porch', 3), ('parking for a {couple} of cars', 2), ('a {pair} of cars', 2)]
SBF = ['front {n} ft', '{n} ft front setback', 'front setback of {n} feet', 'leave {n} feet in front', '{n} feet open space at the front', 'front setback {n}', '{n} feet in the front', 'aage {n} feet', 'front open space {n} ft', 'keep {n} ft at the front']
SBR = ['rear {n} ft', 'back {n} ft', '{n} ft at the back', 'rear setback of {n} feet', 'leave {n} feet at the back', 'back setback {n}', 'peechay {n} feet', '{n} feet behind', 'back open space {n} ft']
SBS = ['sides {n} ft', '{n} feet on each side', 'side setback {n}', '{n} ft on both sides', 'side space of {n} feet', 'leave {n} feet on the sides', '{n} ft side setback', '{no} side setback', '{zero} setback on the sides', '{no} space on the sides']
SIZE = ['{w} x {d}', '{w} by {d}', '{w} feet by {d} feet', '{w} ft x {d} ft', '{w} ft wide and {d} ft deep', 'width {w} depth {d}', 'frontage {w} depth {d}', '{w} wide {d} deep', 'plot of {w} by {d}', '{w} feet front and {d} feet long',
        'plot size {w} x {d}', '{w} into {d}', '{w} chora {d} lamba', 'plot is {w} feet across and {d} deep', '{w} x {d} feet plot', '{w} x {d} plot']
MARLA = ['{n} marla', '{n} marla plot', '{n} marla house', 'plot of {n} marla', '{n} marlas', 'a {n} marla plot', '{n} marla ka ghar', '{n} marla ghar']
KANAL = ['{n} kanal', '{n} kanal house', '{n} kanal plot', 'plot of {n} kanal', '{half} kanal', '{half} kanal house', '{n} kanal ka ghar']
PHR = {
    'floors_2': ['double storey', '2 storey', 'two floors', 'g + 1', 'ground plus one', 'double story', 'do manzil', 'duplex', 'two storey', 'with a first floor', '2 floors', 'two stories', 'do manzila', 'dual storey', 'ground and first floor', 'upper portion too'],
    'floors_1': ['single storey', 'one floor', 'single story', 'ek manzil', 'ground floor only', 'only ground floor', '1 storey', 'single floor', 'one storey', 'no first floor', 'ek manzila'],
    'porch_yes': ['car porch', 'with porch', 'with a garage', 'covered parking', 'porch chahiye', 'parking space', 'gari ki jagah'],
    'porch_no': ['no car porch', 'without garage', 'no parking needed', 'porch nahi chahiye', 'we do not have a car', 'no porch', 'without car porch', 'parking is not needed', 'no need for a garage', 'bina porch'],
    'lawn_no': ['no lawn', 'without lawn', 'no garden', 'use the lawn for parking', 'lawn ki zaroorat nahi', 'lawn not needed', 'skip the lawn', 'no front lawn', 'we do not want a lawn'],
    'terrace_yes': ['with terrace', 'open terrace', 'terrace upstairs', 'a terrace on the first floor', 'terrace chahiye', 'roof terrace', 'want a terrace'],
    'terrace_no': ['no terrace', 'without terrace', 'terrace not needed', 'no open terrace', 'terrace nahi chahiye', 'cover the whole first floor'],
    'omit_dining': ['no dining', 'without dining room', 'no dining room', 'dining not required', 'skip dining', 'we do not need a dining room', 'dining room nahi chahiye', 'no separate dining'],
    'omit_drawing': ['no drawing room', 'without drawing room', 'skip the drawing room', 'drawing room not required', 'we do not need a drawing room', 'drawing room nahi chahiye', 'no drawing'],
    'omit_study': ['no study', 'without study', 'no need of study', 'study not required', 'skip the study room', 'no study room'],
    'omit_store': ['no store', 'without store room', 'store nahi chahiye', 'no store room', 'skip the store', 'store not needed'],
    'focus_lounge': ['big lounge', 'large tv lounge', 'spacious living room', 'lounge should be big', 'bigger lounge', 'a wide lounge', 'bara lounge', 'large hall', 'lounge bara ho', 'big sitting area'],
    'focus_bedrooms': ['bigger bedrooms', 'large bedrooms', 'spacious bedrooms', 'bedrooms should be big', 'big bedrooms', 'baray kamre', 'rooms should be large', 'big master bedroom'],
    'focus_kitchen': ['big kitchen', 'spacious kitchen', 'kitchen bara ho', 'large kitchen', 'kitchen should be big', 'a bigger kitchen', 'wide kitchen'],
    'stairs_none': ['no stairs', 'without stairs', 'no roof stairs', 'stairs not needed', 'seerhi nahi chahiye', 'no staircase'],
    'up_drawing': ['drawing room upstairs', 'drawing room on the first floor', 'upstairs drawing room', 'a drawing room on the upper floor', 'first floor drawing room'],
    'style_modern': ['modern', 'contemporary look', 'modern style', 'minimal design', 'modern elevation', 'modern look'],
    'style_classic': ['classic', 'traditional style', 'colonial look', 'classical elevation', 'classic design'],
    'style_spanish': ['spanish', 'mediterranean style', 'spanish elevation', 'spanish look', 'mediterranean'],
}
# numbers that are not part of the request: the reader must leave them alone
NOISE = ['budget {n} lakh', 'family of {n}', 'for {n} brothers', 'in phase {n}', 'sector {n}', 'house number {n}', 'dha phase {n}', 'bahria town', 'in lahore', 'street {n}', 'block {n}', 'we are {n} people',
         'within {n} months', 'for my parents', 'corner plot', 'facing park', 'near the main road', 'with good ventilation', '{n} kids', 'age {n}', 'in islamabad', 'johar town', 'road {n} feet wide', 'for rent',
         'low cost', 'budget is tight', 'model town', 'askari {n}', 'gulberg', 'with servant quarter', 'vastu friendly', 'east facing', '{n} crore budget']
PRE = ['', '', '', 'i want', 'we need', 'please design', 'mujhe chahiye', 'make me', 'looking for', 'house plan for', 'design a house', 'i need a house', 'can you make', 'plan for', 'banao', 'hume chahiye', 'draw', 'naqsha banao', 'give me a layout for', 'show me', 'we want to build']
SEP = [',', 'and', 'with', 'plus', 'also', 'aur', '', '', 'having', 'along with', ',', 'then']
POST = ['', '', '', 'please', 'thanks', 'jaldi', 'for my family', 'chahiye', 'ok', 'it should look nice', 'thank you']

def typo(rng, w):
    if len(w) < 4 or w[0].isdigit(): return w
    i = rng.randrange(1, len(w) - 1)
    r = rng.random()
    return w[:i] + w[i + 1:] if r < 0.4 else w[:i] + w[i + 1] + w[i] + w[i + 2:] if r < 0.7 else w[:i] + w[i] + w[i:]

def sample(rng):
    """-> (tokens, tags, labels)"""
    parts, labels = [], set()
    def add(pat, tag=None, n=None): parts.append(clause(rng, pat, tag, n))
    r = rng.random
    two = None
    if r() < 0.72:                                                    # the plot
        k = r()
        if k < 0.45:
            w, d = rng.choice([20, 25, 27, 30, 32, 33, 35, 36, 40, 45, 50, 55, 60]), rng.choice([40, 45, 48, 50, 52, 55, 60, 65, 70, 75, 80, 90, 100])
            pat = rng.choice(SIZE)
            parts.append([(num(rng, w, 0.08), 'PLOT_W') if x == '{w}' else (num(rng, d, 0.05), 'PLOT_D') if x == '{d}' else (x, 'O') for x in pat.split()])
        elif k < 0.85: add(rng.choice(MARLA), 'MARLA', rng.choice([3, 4, 5, 5, 6, 7, 7, 8, 10, 10, 12, 14, 15, 20]))
        else:
            pat = rng.choice(KANAL); add(pat, 'KANAL', rng.choice([1, 1, 1, 2]))
    if r() < 0.6:                                                     # floors
        two = r() < 0.6
        add(rng.choice(PHR['floors_2' if two else 'floors_1'])); labels.add('floors_2' if two else 'floors_1')
    if r() < 0.85:                                                    # bedrooms
        if (two or (two is None and r() < 0.15)) and r() < 0.45:
            if r() < 0.8: add(rng.choice(BED_DN), 'BEDS_DOWN', rng.randint(1, 4))
            add(rng.choice(BED_UP), 'BEDS_UP', rng.randint(1, 4)); labels.add('floors_2')
        else: add(rng.choice(BED), 'BEDS', rng.randint(1, 6))
    if r() < 0.3: add(rng.choice(BATH), 'BATHS', rng.randint(1, 7))
    k = r()
    if k < 0.3:
        if r() < 0.75: add(rng.choice(CAR), 'CARS', rng.randint(1, 3))
        else: pat, _ = rng.choice(CAR_W); add(pat, 'CARS')
        labels.add('porch_yes')
    elif k < 0.42: add(rng.choice(PHR['porch_yes'])); labels.add('porch_yes')
    elif k < 0.5: add(rng.choice(PHR['porch_no'])); labels.add('porch_no')
    if r() < 0.14: add(rng.choice(SBF), 'SB_FRONT', rng.choice([5, 8, 10, 12, 15, 20]))
    if r() < 0.1: add(rng.choice(SBR), 'SB_REAR', rng.choice([3, 4, 5, 6, 7, 10]))
    if r() < 0.1: add(rng.choice(SBS), 'SB_SIDE', rng.choice([2, 3, 4, 5]))
    for lab, p in [('lawn_no', 0.07), ('omit_dining', 0.06), ('omit_drawing', 0.06), ('omit_study', 0.03), ('omit_store', 0.03), ('stairs_none', 0.04), ('up_drawing', 0.04)]:
        if r() < p: add(rng.choice(PHR[lab])); labels.add(lab)
    if r() < 0.12: lab = rng.choice(['terrace_yes', 'terrace_no']); add(rng.choice(PHR[lab])); labels.add(lab)
    if r() < 0.15: lab = rng.choice(['focus_lounge', 'focus_bedrooms', 'focus_kitchen']); add(rng.choice(PHR[lab])); labels.add(lab)
    if r() < 0.15: lab = rng.choice(['style_modern', 'style_classic', 'style_spanish']); add(rng.choice(PHR[lab])); labels.add(lab)
    for _ in range(rng.choice([0, 0, 0, 1, 1, 2])): add(rng.choice(NOISE), None, rng.choice([2, 3, 4, 5, 6, 7, 8, 10, 12, 20, 30, 50, 80]))
    rng.shuffle(parts)
    seq = [(w, 'O') for w in rng.choice(PRE).split()]
    for i, p in enumerate(parts):
        if i: seq += [(w, 'O') for w in rng.choice(SEP).replace(',', '').split()]
        seq += p
    seq += [(w, 'O') for w in rng.choice(POST).split()]
    toks, tags = [], []
    for w, t in seq:
        t = t or 'O'
        if w in ASR and r() < 0.22: w = rng.choice(ASR[w])
        elif t == 'O' and r() < 0.05: w = typo(rng, w)
        if r() < 0.02 and t == 'O': continue                          # a dropped word
        for piece in tokenize(w): toks.append(piece); tags.append(t)
    if not toks: return sample(rng)
    return toks[:MAXT], tags[:MAXT], sorted(labels)

def gen(n, seed):
    rng = random.Random(seed)
    return [sample(rng) for _ in range(n)]

# ---------------------------------------------------------------- model
def build():
    import torch, torch.nn as nn
    class Reader(nn.Module):
        def __init__(self):
            super().__init__()
            self.emb = nn.Embedding(BUCKETS + 1, DIM, padding_idx=0)
            self.pos = nn.Embedding(MAXT, DIM)
            layer = nn.TransformerEncoderLayer(DIM, 4, 160, dropout=0.1, batch_first=True, norm_first=True)
            self.enc = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
            self.norm = nn.LayerNorm(DIM)
            self.tag = nn.Linear(DIM, len(TAGS))
            self.lab = nn.Linear(DIM, len(LABELS))
        def forward(self, ids):                                        # ids: [B, T, G] hashed n-grams, 0 = padding
            g = self.emb(ids)                                          # [B, T, G, D]
            cnt = (ids > 0).sum(-1, keepdim=True).clamp(min=1).to(g.dtype)
            x = g.sum(2) / cnt
            pad = (ids.sum(-1) == 0)                                   # [B, T]
            x = x + self.pos(torch.arange(ids.shape[1], device=ids.device))[None]
            h = self.norm(self.enc(x, src_key_padding_mask=pad))
            keep = (~pad).to(h.dtype)[..., None]
            pooled = (h * keep).sum(1) / keep.sum(1).clamp(min=1)
            return self.tag(h), self.lab(pooled)
    return Reader()

def batchify(rows):
    import torch
    T = max(len(r[0]) for r in rows)
    ids = torch.zeros(len(rows), T, GRAMS, dtype=torch.long); tg = torch.full((len(rows), T), -100, dtype=torch.long); lb = torch.zeros(len(rows), len(LABELS))
    for i, (toks, tags, labels) in enumerate(rows):
        for j, (w, t) in enumerate(zip(toks, tags)):
            g = grams(w); ids[i, j, :len(g)] = torch.tensor(g); tg[i, j] = TAGS.index(t)
        for l in labels: lb[i, LABELS.index(l)] = 1
    return ids, tg, lb

def train():
    import torch, torch.nn.functional as F
    torch.manual_seed(7); torch.set_num_threads(8)
    data, test = gen(90000, 1), gen(4000, 999)
    model = build()
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.01)
    steps, bs = 0, 128
    total = 5 * (len(data) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=total, pct_start=0.1)
    for ep in range(5):
        random.Random(ep).shuffle(data); model.train(); tot = 0
        for b in range(0, len(data) - bs + 1, bs):
            ids, tg, lb = batchify(data[b:b + bs])
            lt, ll = model(ids)
            loss = F.cross_entropy(lt.reshape(-1, len(TAGS)), tg.reshape(-1), ignore_index=-100) + F.binary_cross_entropy_with_logits(ll, lb)
            opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
            tot += loss.item(); steps += 1
        print(f'epoch {ep + 1} loss {tot / (len(data) // bs):.4f}', evaluate(model, test), flush=True)
    model.eval()
    out = ROOT / 'models' / 'nlu.onnx'
    ex = torch.zeros(1, MAXT, GRAMS, dtype=torch.long); ex[0, :5, 0] = torch.tensor([3, 9, 27, 81, 243])      # a fixed length (the attention export bakes it in): the reader pads every sentence to MAXT
    torch.onnx.export(model, (ex,), str(out), input_names=['ids'], output_names=['tags', 'labels'], opset_version=17, dynamo=False)
    (ROOT / 'models' / 'nlu.json').write_text(json.dumps({'tags': TAGS, 'labels': LABELS, 'buckets': BUCKETS, 'grams': GRAMS, 'maxT': MAXT, 'heldout': evaluate(model, test)}))
    torch.save(model.state_dict(), ROOT / 'runs' / 'nlu.pt')
    print('saved', out, out.stat().st_size)

def evaluate(model, rows):
    import torch
    model.eval(); ok_tok = n_tok = ok_sent = 0; tp = fp = fn = 0
    with torch.no_grad():
        for b in range(0, len(rows), 256):
            ids, tg, lb = batchify(rows[b:b + 256])
            lt, ll = model(ids)
            pred = lt.argmax(-1); m = tg != -100
            ok_tok += ((pred == tg) & m).sum().item(); n_tok += m.sum().item()
            pl = (torch.sigmoid(ll) > 0.5).float()
            tp += (pl * lb).sum().item(); fp += (pl * (1 - lb)).sum().item(); fn += ((1 - pl) * lb).sum().item()
            ok_sent += (((pred == tg) | ~m).all(1) & (pl == lb).all(1)).sum().item()
    return {'token_acc': round(ok_tok / n_tok, 4), 'label_f1': round(2 * tp / max(1, 2 * tp + fp + fn), 4), 'whole_request': round(ok_sent / len(rows), 4)}

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'train'
    if cmd == 'gen':
        for toks, tags, labels in gen(12, int(sys.argv[2]) if len(sys.argv) > 2 else 3): print(' '.join(f'{w}/{t}' if t != 'O' else w for w, t in zip(toks, tags)), '|', ','.join(labels))
    elif cmd == 'train': train()
