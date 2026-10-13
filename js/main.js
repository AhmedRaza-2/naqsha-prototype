import { PRESETS, MARLA, ruleFor, generateAll, estimateCost } from './layout.js';
import { planSVG, elevationSVG } from './svg.js';
import { STYLES, STYLE_IDS } from './styles.js';
import { createViewer } from './scene.js';
import { modelLayouts } from './modelplans.js';

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
  readPlot();
});

$('gen').onclick = async () => {
  S.plot = readPlot();
  if (S.plot.w < 18 || S.plot.d < 30) return alert('Plot is too small for this prototype (min 18 x 30 ft).');
  S.beds = +$('pb').value;
  const btn = $('gen'), label = btn.textContent;
  btn.disabled = true;
  let layouts = [];
  try {
    if (new URLSearchParams(location.search).has('rules')) throw new Error('?rules: model skipped on purpose');
    layouts = await modelLayouts(S.plot, S.beds, (msg) => (btn.textContent = msg));
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
  $('s2sub').textContent = `${S.plot.w} x ${S.plot.d} ft plot, ${L0.beds} bedrooms${L0.beds !== S.beds ? ` (limited from ${S.beds} for this plot width)` : ''}. ${L0.source === 'model' ? 'Drafted by the Naqsha model and rule-checked.' : 'Three rule-generated options.'}`;
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

// hand-over from the landing page: ?q=10+marla+3+bed fills the box and generates straight away
const handedOver = new URLSearchParams(location.search).get('q');
if (handedOver) {
  $('nl').value = handedOver;
  $('nl').dispatchEvent(new Event('input'));
  $('gen').click();
}
