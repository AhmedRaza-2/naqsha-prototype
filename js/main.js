import { PRESETS, MARLA, ruleFor, generateAll, estimateCost } from './layout.js';
import { planSVG, elevationSVG } from './svg.js';
import { STYLES, STYLE_IDS } from './styles.js';
import { createViewer } from './scene.js';
import { modelLayouts, planToLayout } from './modelplans.js';
import { compactPlans, isCompact } from './compact.js';
import { onModelState, preloadModel, supportsPreferences } from './model.js';

const $ = (id) => document.getElementById(id);
const S = { seen: new Set(), plot: null, beds: 3, layouts: [], sel: null, style: null, viewer: null };

function show(n) {
  for (let i = 1; i <= 3; i++) $('s' + i).hidden = i !== n;
  document.querySelectorAll('#steps li').forEach((li) => {
    const k = +li.dataset.s;
    li.classList.toggle('on', k === n);
    li.classList.toggle('done', k < n);
  });
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => show(+b.dataset.go)));

// ---------- step 1 ----------
function readPlot() {
  const w = +$('pw').value, d = +$('pd').value;
  const marla = (w * d) / MARLA;
  const r = ruleFor(w, d);
  $('plotinfo').textContent = `${w} x ${d} ft = ${(w * d).toLocaleString()} sq ft = ${marla.toFixed(1)} marla. Buildable area about ${(w - 2 * r.side)} x ${(d - r.front - r.rear)} ft after setbacks.`;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', +c.dataset.w === w && +c.dataset.d === d));
  const cap = maxBedsFor(w, d), lo = minBedsFor(w, d);
  [...$('pb').options].forEach((o) => { o.disabled = +o.value > cap || +o.value < lo; });
  const want = Math.min(Math.max(+$('pb').value, lo), Math.max(cap, lo));
  if (cap > 0 && want !== +$('pb').value) $('pb').value = String(want);
  if (typeof syncBaths === 'function') syncBaths();
  return { w, d };
}
PRESETS.forEach((p) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = `${p.label} (${p.w}x${p.d})`; b.dataset.w = p.w; b.dataset.d = p.d;
  b.onclick = () => { $('pw').value = p.w; $('pd').value = p.d; readPlot(); };
  $('presets').appendChild(b);
});
['pw', 'pd'].forEach((id) => $(id).addEventListener('input', readPlot));

// tiny natural-language parser: "10 marla 3 bed", "30x60 4 bedroom", "1 kanal"
$('nl').addEventListener('input', () => {
  const t = $('nl').value.toLowerCase();
  let m;
  if ((m = t.match(/(\d+)\s*[x*]\s*(\d+)/))) { $('pw').value = m[1]; $('pd').value = m[2]; }
  else if ((m = t.match(/(\d+(?:\.\d+)?)\s*kanal/))) { const a = +m[1] * 20 * MARLA; const w = Math.round(Math.sqrt(a * 0.55)); $('pw').value = w; $('pd').value = Math.round(a / w); }
  else if ((m = t.match(/(\d+(?:\.\d+)?)\s*marla/))) {
    const hit = PRESETS.find((p) => Math.abs((p.w * p.d) / MARLA - +m[1]) < 0.6);
    if (hit) { $('pw').value = hit.w; $('pd').value = hit.d; }
    else { const a = +m[1] * MARLA; const w = Math.round(Math.sqrt(a * 0.55)); $('pw').value = w; $('pd').value = Math.round(a / w); }
  }
  if ((m = t.match(/(\d)\s*(?:bed|kamr|room|bhk)/))) $('pb').value = Math.min(6, Math.max(1, +m[1]));
  if ((m = t.match(/(\d)\s*(?:bath|washroom|wc|toilet)/))) { syncBaths(+m[1]); $('prefs').open = true; }
  if (/big\w*\s+(?:hall|lounge|tv)/.test(t)) { $('pfocus').value = 'lounge'; $('prefs').open = true; }
  else if (/big\w*\s+(?:bed|room)/.test(t)) { $('pfocus').value = 'bedrooms'; $('prefs').open = true; }
  else if (/big\w*\s+kitchen/.test(t)) { $('pfocus').value = 'kitchen'; $('prefs').open = true; }
  readPlot();
});

// ---------- preferences: washrooms and bigger rooms ----------
// most bedrooms that fit on one floor, found by probing the layout generator (same rule as max_beds in tools/bands.py).
// 0 = too small or narrow for a single-floor house after setbacks. Up to 6 marla the compact layout also offers 1 bedroom.
const maxBedsFor = (w, d) => {
  const marla = (w * d) / MARLA, r = ruleFor(w, d);
  if (marla <= 6) {
    if (d - r.front - r.rear < 21.5) return 0;
    return (w >= 24 && d >= 42) || (w >= 22 && d >= 48) ? 2 : 1;
  }
  const usable = w - 2 * r.side;
  if (usable < 19) return 0;
  return usable < 26 ? 2 : usable < 32 ? 3 : usable < 44 ? 4 : 6;
};
const minBedsFor = (w, d) => ((w * d) / MARLA <= 6 ? 1 : 2);
// washrooms: one per bedroom + a guest washroom, + a common one off the lounge above 6 marla (same as max_baths)
const extraBathsFor = (w, d) => ((w * d) / MARLA <= 6 ? 1 : 2);
function syncBaths(want) {
  const beds = +$('pb').value;
  const sel = $('pbaths');
  const keep = want ?? +sel.value;
  const plot = { w: +$('pw').value, d: +$('pd').value };
  const opts = [[beds, beds === 1 ? 'Attached to the bedroom' : 'One per bedroom, attached'], [beds + 1, 'Attached + a guest washroom'], [beds + 2, 'Attached + guest + a common washroom']]
    .slice(0, 1 + extraBathsFor(plot.w, plot.d));
  sel.innerHTML = '';
  opts.forEach(([n, label]) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${n}: ${label}`;
    sel.appendChild(o);
  });
  sel.value = opts.some(([n]) => n === keep) ? keep : beds + 1;
}
$('pb').addEventListener('change', () => syncBaths());
syncBaths();

/** Returns an error message, or '' when the request is fine. Also nudges the bedroom count to what the plot can hold. */
function validateRequest() {
  const w = +$('pw').value, d = +$('pd').value, beds = +$('pb').value;
  if (!Number.isFinite(w) || !Number.isFinite(d)) return 'Enter the plot width and depth in feet.';
  if (w < 18 || w > 120) return 'Plot width should be between 18 and 120 ft.';
  if (d < 30 || d > 200) return 'Plot depth should be between 30 and 200 ft.';
  const marla = (w * d) / MARLA;
  if (marla < 3 || marla > 60) return 'Naqsha plans plots from 3 marla to 3 kanal.';
  const cap = maxBedsFor(w, d);
  if (cap === 0) return marla <= 6
    ? `${w} x ${d} ft leaves too little depth for a house after the front and back open spaces. A single floor needs a plot at least 31 ft deep.`
    : `${w} x ${d} ft is too narrow for a single floor with side setbacks. Plots above 6 marla need about 25 ft of width.`;
  if (beds > cap) return `A single floor on ${w} x ${d} ft fits up to ${cap} bedroom${cap > 1 ? 's' : ''}. Choose fewer bedrooms${cap < 4 && marla > 8 ? ' or a wider plot (about 38 ft)' : cap === 1 ? ' or a deeper plot (about 25 x 45 ft fits 2)' : ''}.`;
  if (beds < minBedsFor(w, d)) return 'Plots above 6 marla are planned with at least 2 bedrooms.';
  return '';
}

// ---------- the trained model: start downloading at once, show progress, never block the page ----------
const LOAD_TIMEOUT_MS = (Number(new URLSearchParams(location.search).get('loadtimeout')) || 45) * 1000;   // after this, show rule-based layouts and keep downloading
const rulesOnly = new URLSearchParams(location.search).has('rules');
let modelState = { phase: 'idle', pct: 0 };
let waitingBtn = null;                                           // the button that is waiting for the model, if any
onModelState((st) => {
  modelState = st;
  const msg = st.phase === 'loading' ? `Naqsha model: downloading ${st.pct}% (first visit only)`
    : st.phase === 'ready' ? 'Naqsha model ready' : st.phase === 'error' ? 'Naqsha model could not load, so rule-based layouts will be used' : '';
  $('modelstat').textContent = rulesOnly ? '' : msg;
  if (waitingBtn && st.phase === 'loading') waitingBtn.textContent = `Downloading the Naqsha model ${st.pct}%`;
});
if (!rulesOnly) preloadModel().catch((err) => console.warn('Trained model unavailable.', err));

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Draft layouts for S.plot / S.prefs. regen = show different layouts than the ones already shown. */
async function generate(regen) {
  const btn = $(regen ? 'regen' : 'gen'), label = btn.textContent;
  btn.disabled = true;
  waitingBtn = btn;
  S.note = '';
  let layouts = [];
  const wantsPrefs = S.prefs.baths !== S.beds + 1 || S.prefs.focus !== 'balanced';
  let usedModel = false;
  try {
    if (rulesOnly) throw new Error('?rules: model skipped on purpose');
    await withTimeout(preloadModel(), LOAD_TIMEOUT_MS);
    waitingBtn = null;
    const draft = (prefs) => modelLayouts(S.plot, prefs, (msg) => (btn.textContent = msg),
      { exclude: regen ? S.seen : new Set(), temperature: regen ? 0.95 : 0.8, n: regen ? 18 : 12 });
    layouts = await draft(S.prefs);
    usedModel = true;
    if (wantsPrefs && layouts.length && !(await supportsPreferences())) S.note = 'The model loaded here does not know washroom or size preferences yet, so these are its standard layouts.';
    // nothing valid for the exact request: ask again with fewer preferences, and say which one was dropped
    const { beds, baths, focus } = S.prefs;
    const bigger = { bedrooms: 'bedrooms', lounge: 'hall', kitchen: 'kitchen' }[focus];
    const relax = [
      focus !== 'balanced' && [{ ...S.prefs, focus: 'balanced' }, `Bigger ${bigger} does not fit on this plot with your other choices, so these layouts use the usual proportions.`],
      baths > beds && [{ ...S.prefs, baths: beds }, `${baths} washrooms do not fit on this plot, so these layouts have ${beds}, one attached to each bedroom.`],
      baths > beds && focus !== 'balanced' && [{ ...S.prefs, baths: beds, focus: 'balanced' }, `${baths} washrooms and a bigger ${bigger} do not fit on this plot together, so these layouts have ${beds} washroom${beds > 1 ? 's' : ''} and the usual proportions.`],
    ].filter(Boolean);
    for (const [prefs, note] of relax) {
      if (layouts.length || isCompact(S.plot.w, S.plot.d)) break;   // small plots: the compact generator relaxes instantly below
      layouts = await draft(prefs);
      if (layouts.length) S.note = note;
    }
  } catch (err) {
    if (err && err.message === 'timeout') S.note = `The model is still downloading (${modelState.pct}%) on this connection, so these are rule-based layouts. Press Regenerate once it says ready.`;
    else console.warn('Trained model unavailable, using the rule-based layouts instead.', err);
  }
  waitingBtn = null;
  btn.disabled = false;
  btn.textContent = label;
  const compact = isCompact(S.plot.w, S.plot.d);
  if (regen && usedModel && !layouts.length && !compact) {       // nothing new and valid this time: keep what the visitor has
    S.note = 'No new valid layout this time. Press Regenerate again.';
    renderLayouts();
    return;
  }
  if (!layouts.length && compact) {                              // small plots: the compact generator the model learned from
    const { items, relaxed } = compactPlans({ w: S.plot.w, d: S.plot.d, ...S.prefs });
    layouts = items.filter((it) => !regen || !S.seen.has(it.text)).map((it, i) => Object.assign(planToLayout(it, i), { tag: 'Rule-based', source: 'rules' }));
    if (relaxed && layouts.length) S.note = `${S.note ? `${S.note} ` : ''}Not every preference fits on this plot, so the closest layouts are shown.`;
  }
  if (!layouts.length) {
    layouts = generateAll(S.plot, S.beds);                       // rule-based fallback
    if (regen && !S.note) S.note = 'Rule-based layouts do not change. The Naqsha model gives new ones each time once it has loaded.';
  }
  layouts.forEach((L) => L.text && S.seen.add(L.text));
  S.layouts = layouts;
  S.sel = null;
  renderLayouts();
  show(2);
}

$('gen').onclick = async () => {
  S.plot = readPlot();
  const problem = validateRequest();
  $('formerr').hidden = !problem;
  $('formerr').textContent = problem;
  if (problem) return;
  S.beds = +$('pb').value;
  S.prefs = { beds: S.beds, baths: +$('pbaths').value, focus: $('pfocus').value };
  S.seen = new Set();
  await generate(false);
};
$('regen').onclick = () => generate(true);

// ---------- step 2 ----------
function renderLayouts() {
  const L0 = S.layouts[0];
  $('s2sub').textContent = `${S.plot.w} x ${S.plot.d} ft plot, ${L0.beds} bedroom${L0.beds === 1 ? '' : 's'}${L0.beds !== S.beds ? ` (limited from ${S.beds} for this plot width)` : ''}. ${L0.source === 'model' ? 'Drafted by the Naqsha model and rule-checked.' : 'Three rule-generated options.'}${S.note ? ` ${S.note}` : ''}`;
  const host = $('layouts');
  host.innerHTML = '';
  S.layouts.forEach((L) => {
    const warn = L.checks.length - L.score;
    const el = document.createElement('button');
    el.className = 'opt';
    el.innerHTML = `${planSVG(L)}<h4>${L.label}: ${L.tag}</h4><p>${L.covered.toLocaleString()} sq ft covered</p><span class="badge ${warn ? 'w' : ''}">${L.score}/${L.checks.length} checks passed</span>`;
    el.onclick = () => select(L.id);
    host.appendChild(el);
  });
  $('to3').disabled = true;
  $('checks').innerHTML = '<li><span></span><span>Select a layout to see its rule check and cost estimate.</span></li>';
  $('cost').innerHTML = ''; $('chkscore').textContent = '';
}
function select(id) {
  S.sel = S.layouts.find((l) => l.id === id);
  [...$('layouts').children].forEach((c, i) => c.classList.toggle('sel', S.layouts[i].id === id));
  $('chkscore').textContent = `(${S.sel.score}/${S.sel.checks.length})`;
  $('checks').innerHTML = S.sel.checks.map((c) =>
    `<li><span class="ico ${c.level}">${c.level === 'ok' ? '&#10003;' : '&#9888;'}</span><div><b>${c.title}</b><span>${c.detail}</span></div></li>`).join('');
  $('cost').innerHTML = '<table>' + estimateCost(S.sel).map((t) =>
    `<tr><td>${t.tier} <small>(Rs ${t.rate.toLocaleString()}/sq ft)</small></td><td>Rs ${(t.total / 1e6).toFixed(1)} M</td></tr>`).join('') + '</table>';
  $('to3').disabled = false;
}
$('to3').onclick = () => { renderStyles(); show(3); };

// ---------- step 3 ----------
function renderStyles() {
  const host = $('styles');
  host.innerHTML = '';
  S.style = null; $('to4').disabled = true;
  STYLE_IDS.forEach((id) => {
    const st = STYLES[id];
    const el = document.createElement('button');
    el.className = 'opt';
    el.innerHTML = `${elevationSVG(S.sel, st)}<h4>${st.name}</h4><p>${st.blurb}</p>`;
    el.onclick = () => {
      S.style = id;
      [...host.children].forEach((c) => c.classList.toggle('sel', c === el));
      $('to4').disabled = false;
    };
    host.appendChild(el);
  });
}

// ---------- step 4 ----------
$('to4').onclick = () => {
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  S.viewer = createViewer($('vhost'), S.sel, S.style, {
    onRoom: (n) => ($('hudroom').textContent = n),
    onMode: (mode, roof) => {
      $('vmode').textContent = mode === 'walk' ? 'Overview' : 'Walk inside';
      $('vroof').textContent = roof ? 'Hide roof' : 'Show roof';
      $('vreset').hidden = mode !== 'walk';
      $('hudhint').textContent = mode === 'walk'
        ? 'Drag to look. W/A/S/D or arrows to move, Q/E to turn, Shift to run.'
        : 'Drag to orbit, scroll to zoom, right-drag to pan.';
    },
  });
};
$('vmode').onclick = () => S.viewer.setMode(S.viewer.mode === 'orbit' ? 'walk' : 'orbit');
$('vroof').onclick = () => { const v = S.viewer; v.setRoof(!v.roofVisible); $('vroof').textContent = v.roofVisible ? 'Hide roof' : 'Show roof'; };
$('vreset').onclick = () => S.viewer.resetWalk();
$('vback').onclick = () => {
  S.viewer.dispose(); S.viewer = null;
  $('viewer').hidden = true; document.body.style.overflow = '';
};

readPlot();
show(1);

// hand-over from the landing page: ?q=10+marla+3+bed&w=35&d=65&baths=4&focus=lounge fills the form and generates straight away
const qs = new URLSearchParams(location.search);
if (qs.get('q')) {
  $('nl').value = qs.get('q');
  $('nl').dispatchEvent(new Event('input'));
  if (qs.get('w') && qs.get('d')) { $('pw').value = qs.get('w'); $('pd').value = qs.get('d'); readPlot(); }
  syncBaths(qs.get('baths') ? +qs.get('baths') : undefined);
  if (['balanced', 'bedrooms', 'lounge', 'kitchen'].includes(qs.get('focus'))) $('pfocus').value = qs.get('focus');
  if (qs.get('baths') || (qs.get('focus') && qs.get('focus') !== 'balanced')) $('prefs').open = true;
  $('gen').click();
}
