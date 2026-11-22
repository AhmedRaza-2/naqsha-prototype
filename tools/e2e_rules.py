"""End-to-end check of the drafted plans in a real browser (headless Chrome through Playwright).

    python tools/e2e_rules.py            (serves the repo on a free port, drafts plans, prints what it found)

For each request it drafts ground floors (and a first floor over the first one, for two-storey houses) with the real model and
the real planner, then checks the things a visitor sees:
  stairs      the stair door opens onto a hall (entrance, lounge, passage, dining, drawing room, terrace), never a store, kitchen or bedroom
  kitchen     no room other than the dining room or lounge opens into the kitchen (it is not the corridor of the house)
  lounge bath no washroom in the family lounge upstairs
  roof stairs no stairs in a single-storey house of 7 marla or less
"""
import http.server, json, socket, sys, threading
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    {"w": 30, "d": 50, "beds": 2, "baths": 3, "storeys": 2, "upBeds": 2, "upBaths": 2},
    {"w": 25, "d": 45, "beds": 2, "baths": 2, "storeys": 2, "upBeds": 2, "upBaths": 2},
    {"w": 35, "d": 65, "beds": 3, "baths": 3, "storeys": 2, "upBeds": 3, "upBaths": 3},
    {"w": 30, "d": 50, "beds": 3, "baths": 3, "storeys": 1},
    {"w": 25, "d": 45, "beds": 2, "baths": 2, "storeys": 1},
    {"w": 35, "d": 65, "beds": 3, "baths": 3, "storeys": 2, "upBeds": 3, "upBaths": 3, "stairs": "separate"},
    {"w": 30, "d": 50, "beds": 2, "baths": 2, "storeys": 2, "upBeds": 2, "upBaths": 2, "stairs": "separate"},
]

JS = r"""
async (c) => {
  const M = await import('/js/modelplans.js');
  const HALL = new Set(['lobby', 'lounge', 'passage', 'dining', 'drawing', 'terrace', ...(c.stairs === 'separate' ? ['outside'] : [])]);
  const look = (L, note) => {
    const byId = Object.fromEntries(L.rooms.map((r) => [r.id, r]));
    const doors = L.openings.filter((o) => o.kind !== 'window');
    const issues = [];
    for (const s of L.rooms.filter((r) => r.type === 'stairs')) {
      const ds = doors.filter((o) => o.room === s.id || o.to === s.id);
      if (c.stairs === 'separate' && !L.upper && !note && !ds.some((o) => o.to === undefined)) issues.push('separate stairs have no door from outside (' + (L.note || 'no note') + ')');
      if (!ds.length) issues.push('stairs have no door: ' + `${s.x},${s.z} ${s.w}x${s.d} ` + L.rooms.filter((q) => !q.parent).map((q) => `${q.id}@${q.x},${q.z},${q.w}x${q.d}`).join(' '));
      for (const o of ds) { const other = o.room === s.id ? o.to : o.room; const t = other === 'terrace' ? 'terrace' : other === undefined ? 'outside' : byId[other]?.type;
        if (!HALL.has(t)) issues.push(`stairs open into ${t}`); }
    }
    for (const k of L.rooms.filter((r) => r.type === 'kitchen')) {
      const into = doors.filter((o) => o.to === k.id || o.room === k.id).map((o) => byId[o.room === k.id ? o.to : o.room]?.type).filter((t) => t && !['dining', 'lounge'].includes(t));
      if (into.length) issues.push(`kitchen opens to ${into.join(',')}`);
    }
    if (L.upper) for (const b of L.rooms.filter((r) => r.parent && byId[r.parent]?.type === 'lounge')) issues.push('washroom in the upstairs lounge');
    const names = L.rooms.filter((r) => !r.parent).map((r) => r.type).join(' ');
    return { id: L.id, rooms: names, issues };
  };
  const req = { beds: c.beds, baths: c.baths, storeys: c.storeys, focus: 'balanced', ...(c.stairs ? { stairs: c.stairs } : {}) };
  const out = { req: c, ground: [], upper: [] };
  const Ls = await M.modelLayouts({ w: c.w, d: c.d }, req, () => {});
  for (const L of Ls) out.ground.push(look(L, Ls.note));
  if (c.storeys === 2 && Ls.length) {
    const U = await M.upperLayouts(Ls[0], { beds: c.upBeds, baths: c.upBaths, terrace: 'any', upOmit: ['store', 'study'] }, () => {});
    for (const L of U) out.upper.push(look(L));
  }
  if (c.storeys === 1 && c.w * c.d / 225 <= 7.01) for (const L of Ls) if (L.rooms.some((r) => r.type === 'stairs')) out.ground.push({ id: L.id, issues: ['roof stairs in a small single-storey house'] });
  return out;
}
"""


def main():
    from playwright.sync_api import sync_playwright
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    H = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    H.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        page = b.new_page()
        page.on("pageerror", lambda e: print("PAGE ERROR", e))
        page.goto(f"http://127.0.0.1:{port}/index.html")
        cases = CASES if len(sys.argv) < 2 else CASES[: int(sys.argv[1])]
        for c in cases:
            r = page.evaluate(JS, c)
            print(f"\n== {c['w']}x{c['d']} {c['storeys']} storey, {c['beds']} bed")
            for kind in ("ground", "upper"):
                for L in r[kind]:
                    bad += bool(L["issues"])
                    print(f"  {kind:6} {L['id']}: {'OK' if not L['issues'] else '; '.join(L['issues'])}   [{L.get('rooms', '')}]")
        b.close()
    srv.shutdown()
    print(f"\n{bad} layouts with problems")


if __name__ == "__main__":
    main()
