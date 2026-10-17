import { PRESETS, MARLA, ruleFor, estimateCost } from './layout.js';
import { planSVG, elevationSVG } from './svg.js';
import { STYLES, STYLE_IDS } from './styles.js';
import { createViewer } from './scene.js';
import { modelLayouts, upperLayouts, planToLayout, knowsStoreys, FAMILY } from './modelplans.js';
import { check, score, serialize } from './bands.js';
import { check as treeCheck, serialize as treeSerialize } from './tree.js';
import { mountEditor } from './editor.js';
import { onModelState, preloadModel } from './model.js';

const $ = (id) => document.getElementById(id);
const S = { seen: new Set(), seenUp: new Set(), plot: null, beds: 3, layouts: [], sel: null, upperLayouts: [], up: null, style: null, viewer: null };

const SECTIONS = { 1: 's1', 2: 's2', 2.5: 'su', 3: 's3' };                  // 2.5: the first floor of a two-storey house
function show(n) {
  for (const [k, id] of Object.entries(SECTIONS)) $(id).hidden = +k !== n;
  document.querySelectorAll('#steps li').forEach((li) => {
    const k = +li.dataset.s, at = Math.floor(n);
    li.classList.toggle('on', k === at);
    li.classList.toggle('done', k < at);
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
  // every choice stays open; each is labelled by how well it suits this plot
  const cap = maxBedsFor(w, d), lo = minBedsFor(w, d), rec = recBedsFor(w, d);
  if (!userBeds && cap > 0) $('pb').value = String(floors() === 2 ? Math.min(rec, 2) : rec);
  [...$('pb').options].forEach((o) => {
    const n = +o.value;
    o.textContent = `${n}${n === rec ? ' (recommended)' : n > cap || n < lo ? ' (may not fit)' : ''}`;
  });
  const beds = +$('pb').value;
  $('plotinfo').textContent += cap === 0 ? '' : floors() === 2 ? ` Two floors: up to ${cap} bedroom${cap > 1 ? 's' : ''} fit downstairs; more go upstairs.` : beds > cap
    ? ` One floor here fits ${cap} bedroom${cap > 1 ? 's' : ''} comfortably; with ${beds} the model shows the closest layouts that fit.`
    : ` Recommended for this plot: ${rec} bedroom${rec > 1 ? 's' : ''}.`;
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
  if ((m = t.match(/(\d)\s*(?:bed|kamr|room|bhk)/))) { $('pb').value = Math.min(6, Math.max(1, +m[1])); userBeds = true; }
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
// what usually suits a plot this size (typical Pakistani homes), never more than one floor fits comfortably
const recBedsFor = (w, d) => {
  const marla = (w * d) / MARLA;
  const typical = marla <= 7 ? 2 : marla <= 12 ? 3 : marla <= 22 ? 4 : 5;
  return Math.max(minBedsFor(w, d), Math.min(maxBedsFor(w, d), typical));
};
let userBeds = false;                                              // once the visitor picks a bedroom count, keep it
const floors = () => +$('pfloors').value;
const setShown = (el, on) => { el.style.display = on ? '' : 'none'; };
setShown($('floorsrow'), false);                                   // shown once the loaded model knows two-storey houses
function syncFloors() {
  const two = floors() === 2;
  setShown($('pupl'), two); setShown($('pupbl'), two);
  $('pbl').childNodes[0].nodeValue = two ? 'Bedrooms downstairs\n            ' : 'Bedrooms\n            ';
  const ub = +$('pup').value, sel = $('pupbaths'), keep = +sel.value;
  sel.innerHTML = '';
  [[ub, 'attached only'], [ub + 1, 'attached + a common one']].forEach(([n, label]) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${n}: ${label}${n === ub + 1 ? ' (recommended)' : ''}`;
    sel.appendChild(o);
  });
  sel.value = [ub, ub + 1].includes(keep) ? keep : ub + 1;
  readPlot();
}
$('pfloors').addEventListener('change', syncFloors);
$('pup').addEventListener('change', syncFloors);
// washrooms: one per bedroom + a guest washroom, + a common one off the lounge above 6 marla (same as max_baths)
const extraBathsFor = (w, d) => ((w * d) / MARLA <= 6 ? 1 : 2);
function syncBaths(want) {
  const beds = +$('pb').value;
  const sel = $('pbaths');
  const keep = want ?? +sel.value;
  const plot = { w: +$('pw').value, d: +$('pd').value };
  const opts = [[beds, 'attached only'], [beds + 1, 'attached + guest'], [beds + 2, 'attached + guest + common']];
  const fits = beds + extraBathsFor(plot.w, plot.d);
  sel.innerHTML = '';
  opts.forEach(([n, label]) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = `${n}: ${label}${n === beds + 1 ? ' (recommended)' : n > fits ? ' (may not fit)' : ''}`;
    sel.appendChild(o);
  });
  sel.value = opts.some(([n]) => n === keep) ? keep : beds + 1;
}
$('pb').addEventListener('change', () => { userBeds = true; readPlot(); });
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
  return '';
}

// ---------- the trained model: every layout is drafted by it. Download starts at once, with progress ----------
let waitingBtn = null;                                           // the button that is waiting for the model, if any
onModelState((st) => {
  $('modelstat').textContent = st.phase === 'loading' ? `Naqsha model: downloading ${st.pct}% (first visit only)`
    : st.phase === 'ready' ? 'Naqsha model ready'
    : st.phase === 'error' ? 'The Naqsha model could not load. Check the connection; Generate tries again.' : '';
  if (waitingBtn && st.phase === 'loading') waitingBtn.textContent = `Downloading the Naqsha model ${st.pct}%`;
});
preloadModel().then(() => knowsStoreys()).then((ok) => { setShown($('floorsrow'), ok); if (!ok) $('pfloors').value = '1'; syncFloors(); })
  .catch((err) => console.warn('Naqsha model could not load.', err));

/** Draft layouts with the model for S.plot / S.prefs. regen = different layouts from the ones already shown. */
async function generate(regen) {
  const btn = $(regen ? 'regen' : 'gen'), label = btn.textContent;
  btn.disabled = true;
  waitingBtn = btn;
  S.note = '';
  let layouts = [], failure = '';
  try {
    await preloadModel();                                        // after a failed download this starts it again
    waitingBtn = null;
    const draft = (prefs) => modelLayouts(S.plot, prefs, (msg) => (btn.textContent = msg),
      { exclude: regen ? S.seen : new Set(), temperature: regen ? 0.95 : 0.8, n: regen ? 18 : 12 });
    layouts = await draft(S.prefs);
    // nothing valid for the exact request: ask the model again with fewer preferences, and say which one was dropped
    const { beds, baths, focus, porch, family = 'any' } = S.prefs;
    const bigger = { bedrooms: 'bedrooms', lounge: 'hall', kitchen: 'kitchen' }[focus];
    const relax = [
      focus !== 'balanced' && [{ ...S.prefs, focus: 'balanced' }, `Bigger ${bigger} does not fit on this plot with your other choices, so these layouts use the usual proportions.`],
      baths > beds && [{ ...S.prefs, baths: beds }, `${baths} washrooms do not fit on this plot, so these layouts have ${beds}, one attached to each bedroom.`],
      baths > beds && focus !== 'balanced' && [{ ...S.prefs, baths: beds, focus: 'balanced' }, `${baths} washrooms and a bigger ${bigger} do not fit on this plot together, so these layouts have ${beds} washroom${beds > 1 ? 's' : ''} and the usual proportions.`],
    ].filter(Boolean);
    if (family !== 'any') relax.unshift([{ ...S.prefs, family: 'any' }, 'That layout style does not fit this plot, so these are the closest layouts.']);
    if (porch !== 'any') relax.push([{ ...S.prefs, porch: 'any' }, porch === 'yes'
      ? 'No layout with a car porch fits this plot with your other choices, so these may not have one.'
      : 'Every layout the model drafted for this plot has a car porch, so these keep it.']);
    // a bedroom count this plot cannot hold on one floor: the closest count that fits, with the usual washrooms
    const fitBeds = Math.min(Math.max(beds, minBedsFor(S.plot.w, S.plot.d)), maxBedsFor(S.plot.w, S.plot.d));
    if (fitBeds !== beds) {
      const fit = [{ ...S.prefs, beds: fitBeds, baths: fitBeds + 1, focus: 'balanced', porch: 'any' },
        beds > fitBeds ? `${beds} bedrooms do not fit on ${S.prefs.storeys === 2 ? 'the ground floor' : 'one floor'} of ${S.plot.w} x ${S.plot.d} ft, so these are the closest layouts, with ${fitBeds}.${S.prefs.storeys === 2 ? '' : ' Choose 2 floors to fit more bedrooms.'}`
          : `Plots this size are planned with at least ${fitBeds} bedrooms, so these layouts have ${fitBeds}.`];
      relax.splice(0, relax.length, fit);                           // other relaxations cannot help here; go straight to it
    }
    if (S.prefs.storeys === 2) {                                  // a ground floor with stairs holds fewer bedrooms: step down until one fits
      for (let b = Math.min(beds, fitBeds) - 1; b >= 2; b--) relax.push([{ ...S.prefs, beds: b, baths: b + 1, focus: 'balanced', porch: 'any' },
        `${beds} bedrooms do not fit on the ground floor of ${S.plot.w} x ${S.plot.d} ft together with the stairs, so these are the closest layouts, with ${b}.`]);
    }
    for (const [prefs, note] of relax) {
      if (layouts.length) break;
      layouts = await draft(prefs);
      if (layouts.length) S.note = note;
    }
  } catch (err) {
    console.warn('Naqsha model could not load.', err);
    failure = 'The Naqsha model could not load on this connection. Check the connection and try again.';
  }
  waitingBtn = null;
  btn.disabled = false;
  btn.textContent = label;
  if (!layouts.length) {
    const msg = failure || (regen ? 'No new layout passed the checks this time. Press Regenerate again.'
      : `The model could not draft a layout that passes the checks for ${S.plot.w} x ${S.plot.d} ft with ${S.beds} bedroom${S.beds > 1 ? 's' : ''}. Try fewer bedrooms or washrooms, or another plot size.`);
    if (regen) { S.note = msg; renderLayouts(); } else { $('formerr').textContent = msg; $('formerr').hidden = false; }
    return;
  }
  layouts.forEach((L) => S.seen.add(L.text));
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
  S.prefs = { beds: S.beds, baths: +$('pbaths').value, focus: $('pfocus').value, porch: $('pporch').value, family: $('pfamily').value,
    storeys: floors(), upBeds: +$('pup').value, upBaths: +$('pupbaths').value };
  S.seen = new Set(); S.upperLayouts = []; S.up = null;
  $('uerr').hidden = true;
  await generate(false);
};
$('regen').onclick = () => generate(true);

// ---------- step 2 ----------
function renderLayouts() {
  const L0 = S.layouts[0], two = S.prefs.storeys === 2;
  $('s2').querySelector('h2').textContent = two ? 'Choose the ground floor' : 'Choose a layout';
  $('to3').textContent = two ? 'Use this ground floor' : 'Use this layout';
  $('s2sub').textContent = `${S.plot.w} x ${S.plot.d} ft plot, ${L0.beds} bedroom${L0.beds === 1 ? '' : 's'}${two ? ' downstairs. The stairs are placed for the first floor, which comes next' : ''}. Drafted by the Naqsha model and rule-checked. Pick one to adjust its walls.${S.note ? ` ${S.note}` : ''}`;
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
  editor?.destroy(); editor = null; editIdx = -1; editState.clear(); $('editor').hidden = true;
  $('checks').innerHTML = '<li><span></span><span>Select a layout to see its rule check and cost estimate.</span></li>';
  $('cost').innerHTML = ''; $('chkscore').textContent = '';
}
let editor = null, editIdx = -1;
const editState = new Map();                                    // per layout: { original, history }, kept while switching layouts
function showChecks() {
  $('chkscore').textContent = `(${S.sel.score}/${S.sel.checks.length})`;
  $('checks').innerHTML = S.sel.checks.map((c) =>
    `<li><span class="ico ${c.level}">${c.level === 'ok' ? '&#10003;' : '&#9888;'}</span><div><b>${c.title}</b><span>${c.detail}</span></div></li>`).join('');
  $('cost').innerHTML = '<table>' + estimateCost(S.sel).map((t) =>
    `<tr><td>${t.tier} <small>(Rs ${t.rate.toLocaleString()}/sq ft)</small></td><td>Rs ${(t.total / 1e6).toFixed(1)} M</td></tr>`).join('') + '</table>';
}
function select(id) {
  const idx = S.layouts.findIndex((l) => l.id === id);
  S.sel = S.layouts[idx];
  [...$('layouts').children].forEach((c, i) => c.classList.toggle('sel', i === idx));
  showChecks();
  $('to3').disabled = false;
  if (editor && editIdx === idx) return;                         // clicking the layout being edited: keep the editor as it is
  // editor: dragging a wall edits the plan; the rule check, cost, card and 3D all use the edited layout
  const fresh = $('editor').hidden;
  editor?.destroy();
  $('editor').hidden = false;
  editIdx = idx;
  const card = $('layouts').children[idx];
  if (!editState.has(S.sel.id)) editState.set(S.sel.id, {});
  editor = mountEditor($('edhost'), S.sel, {
    undoBtn: $('edundo'), resetBtn: $('edreset'), state: editState.get(S.sel.id),
    rebuild: (plan) => {
      const checks = plan.tree ? treeCheck(plan, plan.beds) : check(plan, plan.beds);
      const L = planToLayout({ text: plan.tree ? treeSerialize(plan) : serialize(plan), plan, checks, score: score(checks) }, idx);
      const fam = S.layouts[idx].family;
      L.family = fam;
      L.tag = (FAMILY[fam] || 'Naqsha model') + (JSON.stringify(plan) !== JSON.stringify(editState.get(L.id).original) ? ', edited' : '');
      return L;
    },
    onChange: (L, live) => {
      S.layouts[idx] = S.sel = L;
      showChecks();
      if (live) return;                                          // the card thumbnail is redrawn when the drag ends
      const warn = L.checks.length - L.score;
      card.innerHTML = `${planSVG(L)}<h4>${L.label}: ${L.tag}</h4><p>${L.covered.toLocaleString()} sq ft covered</p><span class="badge ${warn ? 'w' : ''}">${L.score}/${L.checks.length} checks passed</span>`;
    },
  });
  if (fresh) $('editor').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
$('to3').onclick = async () => {
  if (S.prefs.storeys !== 2) { renderStyles(); show(3); return; }
  S.upperLayouts = []; S.seenUp = new Set();
  await draftUpper(false);
};

// ---------- the first floor of a two-storey house: drafted by the model over the chosen ground floor ----------
const upCost = () => ({ covered: S.sel.covered + (S.up ? S.up.covered : 0) });
async function draftUpper(regen) {
  const btn = $(regen ? 'uregen' : 'to3'), label = btn.textContent;
  btn.disabled = true;
  $('uerr').hidden = true;
  let layouts = [], note = '';
  try {
    const { upBeds, upBaths } = S.prefs;
    const tries = [[upBeds, upBaths, '']];
    if (upBaths > upBeds) tries.push([upBeds, upBeds, `${upBaths} washrooms upstairs do not fit with this ground floor, so these have ${upBeds}, one attached to each bedroom.`]);
    for (let b = upBeds - 1; b >= 1; b--) tries.push([b, b + 1, `${upBeds} bedrooms do not fit upstairs over this ground floor, so these have ${b}.`], [b, b, `${upBeds} bedrooms do not fit upstairs over this ground floor, so these have ${b}.`]);
    for (const [beds, baths, msg] of tries) {
      layouts = await upperLayouts(S.sel, { beds, baths }, (m) => (btn.textContent = m),
        { exclude: regen ? S.seenUp : new Set(), temperature: regen ? 0.95 : 0.8, n: regen ? 18 : 12 });
      if (layouts.length) { note = msg; break; }
      if (regen) break;                                          // Regenerate keeps the request; only the first try relaxes it
    }
  } catch (err) {
    console.warn('Naqsha model could not draft the first floor.', err);
  }
  btn.disabled = false;
  btn.textContent = label;
  if (!layouts.length) {
    $('uerr').textContent = regen ? 'No new first floor passed the checks this time. Press Regenerate again.'
      : 'The model could not draft a first floor over this ground floor. Pick another ground floor or press Regenerate layouts.';
    $('uerr').hidden = false;
    return;
  }
  layouts.forEach((L) => S.seenUp.add(L.text));
  S.upperLayouts = layouts; S.up = null; S.upNote = note;
  upEditor?.destroy(); upEditor = null; upIdx = -1; upEditState.clear(); $('ueditor').hidden = true;
  renderUpper();
  show(2.5);
}
const upEditState = new Map();
let upEditor = null, upIdx = -1;
const upCard = (L) => `${planSVG(L)}<h4>${L.label}${L.tag === 'First floor, edited' ? ', edited' : ''}</h4><p>${L.beds} bedroom${L.beds === 1 ? '' : 's'}, ${L.covered.toLocaleString()} sq ft covered</p><span class="badge ${L.checks.length - L.score ? 'w' : ''}">${L.score}/${L.checks.length} checks passed</span>`;
function showUpperChecks() {
  const L = S.up;
  $('uchkscore').textContent = `(${L.score}/${L.checks.length})`;
  $('uchecks').innerHTML = L.checks.map((c) => `<li><span class="ico ${c.level}">${c.level === 'ok' ? '&#10003;' : '&#9888;'}</span><div><b>${c.title}</b><span>${c.detail}</span></div></li>`).join('');
  $('ucost').innerHTML = '<table>' + estimateCost(upCost()).map((t) => `<tr><td>${t.tier} <small>(Rs ${t.rate.toLocaleString()}/sq ft)</small></td><td>Rs ${(t.total / 1e6).toFixed(1)} M</td></tr>`).join('') + '</table>';
  drawPair();
}
/** Pick a first floor and open it in the editor (drag walls; the stairs stay where the stairs below are). */
function selectUpper(idx) {
  S.up = S.upperLayouts[idx];
  const host = $('ulayouts');
  [...host.children].forEach((c, i) => c.classList.toggle('sel', i === idx));
  showUpperChecks();
  $('uto3').disabled = false;
  if (upEditor && upIdx === idx) return;
  upEditor?.destroy();
  upIdx = idx;
  $('ueditor').hidden = false;
  if (!upEditState.has(S.up.id)) upEditState.set(S.up.id, {});
  upEditor = mountEditor($('uedhost'), S.up, {
    undoBtn: $('uedundo'), resetBtn: $('uedreset'), state: upEditState.get(S.up.id),
    accept: (plan) => !treeCheck(plan, plan.beds).some((c) => c.level === 'err'),
    rebuild: (plan) => {
      const checks = treeCheck(plan, plan.beds);
      const L = planToLayout({ text: treeSerialize(plan), plan, checks, score: score(checks) }, idx);
      if (JSON.stringify(plan) !== JSON.stringify(upEditState.get(L.id).original)) L.tag = 'First floor, edited';
      return L;
    },
    onChange: (L, live) => {
      S.upperLayouts[idx] = S.up = L;
      showUpperChecks();
      if (!live) host.children[idx].innerHTML = upCard(L);
    },
  });
}
/** Both floors side by side: the chosen ground floor and the first floor being picked. */
function drawPair(host = $('pair')) {
  const half = (title, L) => `<figure><figcaption>${title}</figcaption>${L ? planSVG(L, { maxW: 420, maxH: 520 }) : '<p class="fine">Pick a first floor below.</p>'}</figure>`;
  host.innerHTML = half('Ground floor', S.sel) + half('First floor', S.up);
}
function renderUpper() {
  $('usub').textContent = `Over the ${S.sel.beds}-bedroom ground floor, the stairs come up in the same place. Drafted by the Naqsha model and rule-checked. Open roof of the floor below is shown as terrace.${S.upNote ? ` ${S.upNote}` : ''}`;
  const host = $('ulayouts');
  host.innerHTML = '';
  S.upperLayouts.forEach((L, i) => {
    const warn = L.checks.length - L.score;
    const el = document.createElement('button');
    el.className = 'opt';
    el.innerHTML = upCard(L);
    el.onclick = () => selectUpper(i);
    host.appendChild(el);
  });
  $('uto3').disabled = true;
  drawPair();
  $('uchecks').innerHTML = '<li><span></span><span>Select a first floor to see its rule check and the cost of both floors.</span></li>';
  $('ucost').innerHTML = ''; $('uchkscore').textContent = '';
}
$('uregen').onclick = () => draftUpper(true);
$('uto3').onclick = () => { renderStyles(); show(3); };

// ---------- step 3 ----------
function renderStyles() {
  $('s3back').dataset.go = S.prefs.storeys === 2 ? '2.5' : '2';
  $('pair3').hidden = !S.up;
  if (S.up) drawPair($('pair3'));
  const host = $('styles');
  host.innerHTML = '';
  S.style = null; $('to4').disabled = true;
  STYLE_IDS.forEach((id) => {
    const st = STYLES[id];
    const el = document.createElement('button');
    el.className = 'opt';
    el.innerHTML = `${elevationSVG(S.sel, st, S.up)}<h4>${st.name}</h4><p>${st.blurb}</p>`;
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
  $('vfloor').hidden = !S.up;
  $('vfloor').textContent = 'Go upstairs';
  S.viewer = createViewer($('vhost'), S.sel, S.style, {
    onRoom: (n) => ($('hudroom').textContent = n),
    onFloor: (f) => ($('vfloor').textContent = f ? 'Go downstairs' : 'Go upstairs'),
    onMode: (mode, roof) => {
      $('vmode').textContent = mode === 'walk' ? 'Overview' : 'Walk inside';
      $('vroof').textContent = roof ? 'Hide roof' : 'Show roof';
      $('vreset').hidden = mode !== 'walk';
      $('hudhint').textContent = mode === 'walk'
        ? 'Drag to look. W/A/S/D or arrows to move, Q/E to turn, Shift to run.'
        : 'Drag to orbit, scroll to zoom, right-drag to pan.';
    },
  }, S.up);
};
$('vmode').onclick = () => S.viewer.setMode(S.viewer.mode === 'orbit' ? 'walk' : 'orbit');
$('vroof').onclick = () => { const v = S.viewer; v.setRoof(!v.roofVisible); $('vroof').textContent = v.roofVisible ? 'Hide roof' : 'Show roof'; };
$('vreset').onclick = () => S.viewer.resetWalk();
$('vfloor').onclick = () => S.viewer.setFloor(S.viewer.floor ? 0 : 1);
$('vback').onclick = () => {
  S.viewer.dispose(); S.viewer = null;
  $('viewer').hidden = true; document.body.style.overflow = '';
};

syncFloors();
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
