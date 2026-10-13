import { PRESETS, MARLA, ruleFor, generateAll, estimateCost } from './layout.js';
import { planSVG, elevationSVG } from './svg.js';
import { STYLES, STYLE_IDS } from './styles.js';
import { createViewer } from './scene.js';
import { modelLayouts } from './modelplans.js';
import { supportsPreferences } from './model.js';

const $ = (id) => document.getElementById(id);
const S = { plot: null, beds: 3, layouts: [], sel: null, style: null, viewer: null };

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
  if ((m = t.match(/(\d)\s*(?:bed|kamr|room|bhk)/))) $('pb').value = Math.min(5, Math.max(2, +m[1]));
  if ((m = t.match(/(\d)\s*(?:bath|washroom|wc|toilet)/))) { syncBaths(+m[1]); $('prefs').open = true; }
  if (/big\w*\s+(?:hall|lounge|tv)/.test(t)) { $('pfocus').value = 'lounge'; $('prefs').open = true; }
  else if (/big\w*\s+(?:bed|room)/.test(t)) { $('pfocus').value = 'bedrooms'; $('prefs').open = true; }
  else if (/big\w*\s+kitchen/.test(t)) { $('pfocus').value = 'kitchen'; $('prefs').open = true; }
  readPlot();
});

// ---------- preferences: washrooms and bigger rooms ----------
const maxBedsFor = (marla) => (marla <= 6 ? 2 : marla <= 14 ? 4 : 6);
function syncBaths(want) {
  const beds = +$('pb').value;
  const sel = $('pbaths');
  const keep = want ?? +sel.value;
  sel.innerHTML = '';
  [[beds, 'One per bedroom, attached'], [beds + 1, 'Attached + a guest washroom'], [beds + 2, 'Attached + guest + a common washroom']].forEach(([n, label]) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${n}: ${label}`;
    sel.appendChild(o);
  });
  sel.value = [beds, beds + 1, beds + 2].includes(keep) ? keep : beds + 1;
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
  if (beds > maxBedsFor(marla)) return `A single floor on ${marla.toFixed(1)} marla fits up to ${maxBedsFor(marla)} bedrooms. Choose fewer bedrooms.`;
  return '';
}

$('gen').onclick = async () => {
  S.plot = readPlot();
  const problem = validateRequest();
  $('formerr').hidden = !problem;
  $('formerr').textContent = problem;
  if (problem) return;
  S.beds = +$('pb').value;
  S.prefs = { beds: S.beds, baths: +$('pbaths').value, focus: $('pfocus').value };
  const btn = $('gen'), label = btn.textContent;
  btn.disabled = true;
  let layouts = [];
  S.note = '';
  const wantsPrefs = S.prefs.baths !== S.beds + 1 || S.prefs.focus !== 'balanced';
  try {
    if (new URLSearchParams(location.search).has('rules')) throw new Error('?rules: model skipped on purpose');
    layouts = await modelLayouts(S.plot, S.prefs, (msg) => (btn.textContent = msg));
    if (wantsPrefs && layouts.length && !(await supportsPreferences())) S.note = 'The model loaded here does not know washroom or size preferences yet, so these are its standard layouts.';
    if (wantsPrefs && !layouts.length) S.note = 'No layout met every preference on this plot, so these are rule-based layouts.';
  } catch (err) {
    console.warn('Trained model unavailable, using the rule-based layouts instead.', err);
  }
  if (!layouts.length) layouts = generateAll(S.plot, S.beds);     // rule-based fallback (also used when the model finds no valid plan)
  btn.disabled = false;
  btn.textContent = label;
  S.layouts = layouts;
  S.sel = null;
  renderLayouts();
  show(2);
};

// ---------- step 2 ----------
function renderLayouts() {
  const L0 = S.layouts[0];
  $('s2sub').textContent = `${S.plot.w} x ${S.plot.d} ft plot, ${L0.beds} bedrooms${L0.beds !== S.beds ? ` (limited from ${S.beds} for this plot width)` : ''}. ${L0.source === 'model' ? 'Drafted by the Naqsha model and rule-checked.' : 'Three rule-generated options.'}${S.note ? ` ${S.note}` : ''}`;
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
