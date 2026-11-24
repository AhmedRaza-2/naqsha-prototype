"""Build data/planreader/test.npz (the 399 official CubiCasa5k test plans) straight from the Zenodo zip with range reads (about 120 MB)."""
import io, sys, zipfile
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cubicasa_remote import Remote
import cubicasa_masks as C

out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/planreader"); out.mkdir(parents=True, exist_ok=True)
z = zipfile.ZipFile(io.BufferedReader(Remote(), 1 << 20))
names = [l.strip() for l in z.read("cubicasa5k/test.txt").decode().splitlines() if l.strip()]
xs, ys = [], []
for i, f in enumerate(names):
    base = "cubicasa5k" + f.rstrip("/") + "/"
    try:
        x, y = C.make(z.read(base + "F1_original.png"), z.read(base + "model.svg").decode("utf-8"))
        xs.append(x); ys.append(y)
    except Exception as e:
        print("skip", f, type(e).__name__)
    if i % 50 == 0: print(i, "/", len(names), flush=True)
np.savez_compressed(out / "test.npz", x=np.stack(xs), y=np.stack(ys))
print("saved", len(xs))
