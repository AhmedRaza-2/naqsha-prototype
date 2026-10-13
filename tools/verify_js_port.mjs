// Scores the plan texts in a vectors file with js/bands.js and compares with the Python results.
// Run through tools/verify_js_port.py:  node tools/verify_js_port.mjs <vectors.json>
import fs from 'fs';
import { parse, check, score } from '../js/bands.js';

const { texts, expected } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0, unparseable = 0;
texts.forEach((t, i) => {
  let got;
  try {
    const p = parse(t);
    const cs = check(p, p.beds);
    got = { ok: true, score: Math.round(score(cs) * 1e6) / 1e6, failed: cs.filter((c) => c.level !== 'ok').map((c) => c.name).sort() };
  } catch (e) {
    got = { ok: false };
  }
  const exp = expected[i];
  const same = got.ok === exp.ok && (!exp.ok || (Math.abs(got.score - exp.score) < 1e-6 && JSON.stringify(got.failed) === JSON.stringify(exp.failed)));
  if (!same) {
    bad++;
    if (bad <= 4) console.log('MISMATCH', i, JSON.stringify(exp), JSON.stringify(got), '\n' + texts[i].slice(0, 220));
  }
  if (!exp.ok) unparseable++;
});
console.log(`${texts.length} plans compared, ${unparseable} unparseable in both, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
