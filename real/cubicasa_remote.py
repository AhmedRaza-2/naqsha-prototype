"""Fetch only the model.svg files of CubiCasa5k from the Zenodo zip (HTTP range reads, no 5.5 GB download), then convert them.

    python real/cubicasa_remote.py --out data/world_cc --svgs data/cubicasa_svg --threads 8
Then run real/cubicasa_convert.py on the folder (this script does it at the end).
"""
import argparse, io, subprocess, sys, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

URL = "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1"
N = 5469495706


class Remote(io.RawIOBase):
    def __init__(s): s.p = 0; s.s = requests.Session()
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.p
    def seek(s, o, w=0):
        s.p = o if w == 0 else s.p + o if w == 1 else N + o; return s.p
    def read(s, n=-1):
        if n < 0: n = N - s.p
        n = min(n, N - s.p)
        if n <= 0: return b""
        for _ in range(4):
            try:
                r = s.s.get(URL, headers={"Range": f"bytes={s.p}-{s.p + n - 1}"}, timeout=90); r.raise_for_status(); break
            except Exception:
                continue
        else:
            raise IOError("range read failed")
        s.p += len(r.content); return r.content
    def readinto(s, b):
        d = s.read(len(b)); b[:len(d)] = d; return len(d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--svgs", default="data/cubicasa_svg")
    ap.add_argument("--out", default="data/world_cc")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    root = Path(a.svgs); root.mkdir(parents=True, exist_ok=True)
    names = [n for n in zipfile.ZipFile(io.BufferedReader(Remote(), 1 << 20)).namelist() if n.endswith("model.svg")][: a.limit]
    print(len(names), "svgs", flush=True)

    def grab(chunk):
        z = zipfile.ZipFile(io.BufferedReader(Remote(), 1 << 20))
        for n in chunk:
            dst = root / n
            if dst.exists(): continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            try: dst.write_bytes(z.read(n))
            except Exception as e: print("skip", n, type(e).__name__, flush=True)
        return len(chunk)

    chunks = [names[i::a.threads] for i in range(a.threads)]
    with ThreadPoolExecutor(a.threads) as ex:
        done = sum(ex.map(grab, chunks))
    print("fetched", done, flush=True)
    here = Path(__file__).resolve().parent
    subprocess.run([sys.executable, str(here / "cubicasa_convert.py"), str(root), "--out", a.out, "--workers", "4"], check=True)


if __name__ == "__main__":
    main()
