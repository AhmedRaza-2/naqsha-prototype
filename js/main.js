import { PRESETS, MARLA, ruleFor } from './layout.js';
import { planSVG } from './svg.js';
import { STYLES, STYLE_IDS } from './styles.js';
import { renderFront, SITE_DEFAULT } from './scene.js';
import { createViewer } from './viewer.js';
import { parseRequest } from './nlp.js';
import { setPorch, setBalcony, hasPorch, balconyRoom } from './plantweak.js';
import { readInspiration } from './inspire.js';
import { modelLayouts, upperLayouts, planToLayout, knowsStoreys, boxAndStairs, terraceArea, FAMILY } from './modelplans.js';
import { check, score, serialize } from './bands.js';
import { check as treeCheck, serialize as treeSerialize } from './tree.js';
import { mountEditor } from './editor.js';
import { onModelState, preloadModel } from './model.js';
import { canListen, loadSpeechModel, startListening, transcribe, readAnswer } from './voice.js';

const $ = (id) => document.getElementById(id);
const S = { seen: new Set(), seenUp: new Set(), plot: null, beds: 3, layouts: [], sel: null, upperLayouts: [], up: null, style: null, viewer: null };
if (/[?&]debug3d/.test(location.search)) window.__S = S;                  // for tests

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
  $('psbf').placeholder = `standard ${r.front}`; $('psbb').placeholder = `standard ${r.rear}`; $('psbs').placeholder = `standard ${r.side}`;
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

// the sentence reader (nlp.js): "10 marla double storey 4 bed car porch, front 12 ft" fills the form; what it understood is shown below
const NL_CHIPS = $('nlsaid');
function applyParsed(r) {
  if (r.plot) { $('pw').value = r.plot.w; $('pd').value = r.plot.d; }
  if (r.floors && $('floorsrow').style.display !== 'none') { $('pfloors').value = String(r.floors); syncFloors(); }
  if (r.upBeds && $('floorsrow').style.display !== 'none') { $('pup').value = String(Math.min(4, r.upBeds)); syncFloors(); }
  if (r.beds) { $('pb').value = String(Math.min(6, Math.max(1, r.beds))); userBeds = true; }
  if (r.baths) { syncBaths(r.baths); $('prefs').open = true; }
  if (r.bathsAttachedOnly) { syncBaths(+$('pb').value); $('prefs').open = true; }
  if (r.focus) { $('pfocus').value = r.focus; $('prefs').open = true; }
  if (r.porch) { $('pporch').value = r.porch; $('prefs').open = true; }
  if (r.family) { $('pfamily').value = r.family; $('prefs').open = true; }
  if (r.setbacks) {
    for (const [k, id] of [['front', 'psbf'], ['rear', 'psbb'], ['side', 'psbs']]) if (r.setbacks[k] != null) $(id).value = String(r.setbacks[k]);
    $('prefs').open = true;
  }
  if (r.stairs) { $('pstairs').value = r.stairs; $('prefs').open = true; }
  if (r.terrace && $('floorsrow').style.display !== 'none' && floors() === 2) $('pterr').value = r.terrace;
  S.wantStyle = r.style || null;
  if (r.colors && r.colors.wall) S.colors.wall = r.colors.wall;
}
$('nl').addEventListener('input', () => {
  const r = parseRequest($('nl').value);
  applyParsed(r);
  readPlot();
  const chips = r.understood.map((u) => `<span class="chip-said"><b>${u.label}</b> ${u.value}</span>`).join('');
  const notes = r.notes.length ? `<span class="chip-note">Noted, but the planner cannot place these yet: ${r.notes.join(', ')}.</span>` : '';
  NL_CHIPS.innerHTML = chips + notes;
});

// ---------- voice: speak the request; the words are read like typed text and the visitor confirms before anything is drafted ----------
const mic = $('mic'), micstat = $('micstat'), meter = $('meter').firstElementChild;
const MIC_IDLE = 'English only for now. A speech model runs on your device; the first time it downloads about 40 MB.';
let rec = null, voiceBusy = false, voiceMode = 'request';          // 'request': the first sentence; 'answer': a yes or no
const say = (t) => { micstat.textContent = t; };
function micState(on) {
  mic.setAttribute('aria-pressed', String(on));
  mic.classList.toggle('on', on);
  $('miclabel').textContent = on ? 'Stop' : 'Speak instead';
  if (!on) meter.style.width = '0%';
}
/** Listen until the visitor stops (or presses the button), then turn the audio into text. -> text or '' */
async function listenOnce() {
  voiceBusy = true;
  let stopped = null;
  const finish = () => { if (rec) { const r = rec.stop(); rec = null; micState(false); stopped = r; } };
  try {
    say('Allow the microphone, then speak. I stop after a long pause, or press Stop when you are done.');
    let dl = 0;
    const model = loadSpeechModel((p) => { dl = p; });          // the model downloads while the visitor speaks
    model.catch(() => {});
    const done = new Promise((resolve) => {
      startListening({ onLevel: (v) => { meter.style.width = `${Math.round(v * 100)}%`; }, onSilence: () => { finish(); resolve(); } })
        .then((r) => { rec = r; micState(true); say('Listening. Say, for example, "ten marla double storey four bedroom with a car porch".'); mic.onclick = () => { finish(); resolve(); }; })
        .catch((e) => { micState(false); say(e && e.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it in the browser, or type the request instead.' : 'No microphone was found. You can type the request instead.'); resolve(); });
    });
    await done;
    if (!stopped) return '';
    if (stopped.speechMs < 300) { say('I did not hear anything. Press the button and try again.'); return ''; }
    const t0 = Date.now();
    const tick = setInterval(() => say(dl < 0.995 ? `Downloading the speech model: ${Math.round(dl * 100)}%` : 'Turning your speech into text...'), 300);
    try {
      const text = await transcribe(stopped.audio, (p) => { dl = p; });
      console.info('speech to text', Date.now() - t0, 'ms');
      return text;
    } finally { clearInterval(tick); }
  } catch (err) {
    console.warn('voice failed', err);
    say('The speech model could not load on this connection. You can type the request instead.');
    return '';
  } finally { voiceBusy = false; micState(false); mic.onclick = onMic; }
}
async function onMic() {
  if (voiceBusy) return;
  voiceMode = 'request';
  $('voiceok').hidden = true;
  const text = await listenOnce();
  if (!text) return;
  $('nl').value = text;
  $('nl').dispatchEvent(new Event('input'));                    // read like typed text: the fields fill in and the chips show what was understood
  $('heard').textContent = text;
  $('voiceok').hidden = false;
  say(MIC_IDLE);
  $('voiceyes').focus();
}
if (canListen()) mic.onclick = onMic; else { mic.disabled = true; say('Voice input needs a browser with microphone access (use https). You can type the request instead.'); }
$('voiceyes').onclick = () => { $('voiceok').hidden = true; $('gen').click(); };
$('voiceedit').onclick = () => { $('voiceok').hidden = true; $('nl').focus(); };
$('voiceagain').onclick = () => { $('voiceok').hidden = true; mic.click(); };
$('voicesay').onclick = async () => {                          // answer by voice: "yes" goes ahead, "no" starts again
  if (voiceBusy) return;
  const text = await listenOnce();
  const a = readAnswer(text);
  if (a === 'yes') { $('voiceok').hidden = true; $('gen').click(); }
  else if (a === 'no') { $('voiceok').hidden = true; say('Okay. Say it again, or type the changes.'); mic.click(); }
  else if (text) say(`I heard "${text}". Say "yes" to go ahead or "no" to change it, or use the buttons.`);
};

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
  setShown($('pupl'), two); setShown($('pupbl'), two); setShown($('pterrl'), two);
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
let knowsStoreysNow = false;
preloadModel().then(() => knowsStoreys()).then((ok) => { knowsStoreysNow = ok; setShown($('floorsrow'), ok); if (!ok) $('pfloors').value = '1'; syncFloors(); })
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
    // the visitor's own open space leaves no room for what they asked: keep the bedrooms, use the standard open space, and say so
    if (S.prefs.setbacks && Object.keys(S.prefs.setbacks).length) relax.unshift([{ ...S.prefs, setbacks: null },
      `The open space you asked for leaves no room for ${beds} bedroom${beds > 1 ? 's' : ''} on this plot, so these layouts use the standard open space instead.`]);
    const perfect = (ls) => ls.some((L) => L.score === L.checks.length);
    for (const [prefs, note] of relax) {
      // a two-storey ground floor must pass every rule (the first floor is drafted over it): a near miss is not kept
      // while a step down (a bedroom fewer here, which can go upstairs) still might pass
      if (layouts.length && (S.prefs.storeys !== 2 || perfect(layouts))) break;
      const next = await draft(prefs);
      if (next.length && (!layouts.length || perfect(next))) { layouts = next; S.note = note; }
    }
    // a two-storey house: a first floor is drafted over each ground floor now, so the options are whole houses, side by side
    // (kept as it was before: the ground floors first, and the first floor is drafted over the one you choose)
    // if (layouts.length && S.prefs.storeys === 2) layouts = await withUppers(layouts, btn);
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
  // none passes every rule: say so plainly, and point to the fix (two floors hold more bedrooms on the same plot)
  if (layouts.every((L) => L.score < L.checks.length)) {
    const two = S.prefs.storeys !== 2 && knowsStoreysNow;
    S.note = `${S.note ? `${S.note} ` : ''}None of these passes every rule (see the rule check of each layout).${two ? ` ${S.beds} bedrooms are tight on one floor of ${S.plot.w} x ${S.plot.d} ft: choose 2 floors to fit them.` : ' Try fewer bedrooms or washrooms.'}`;
  }
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
  const sbv = (id) => { const v = $(id).value.trim(); return v === '' ? undefined : Math.max(0, +v); };
  const setbacks = Object.fromEntries(Object.entries({ front: sbv('psbf'), rear: sbv('psbb'), side: sbv('psbs') }).filter(([, v]) => Number.isFinite(v)));
  S.prefs = { beds: S.beds, baths: +$('pbaths').value, focus: $('pfocus').value, porch: $('pporch').value, family: $('pfamily').value,
    setbacks: Object.keys(setbacks).length ? setbacks : null, entrance: $('pentr').value, stairs: $('pstairs').value,
    storeys: floors(), upBeds: +$('pup').value, upBaths: +$('pupbaths').value, terrace: $('pterr').value };
  S.seen = new Set(); S.upperLayouts = []; S.up = null;
  $('uerr').hidden = true;
  await generate(false);
};
$('regen').onclick = () => generate(true);

// ---------- step 2 ----------
const upKeyOf = (L) => JSON.stringify(boxAndStairs(L.rects));
const terraceTag = (L) => { const t = terraceArea(L.rects); return t >= 40 ? `terrace ${Math.round(t)} sq ft` : 'no terrace'; };
/** The card of a ground-floor layout: with its first floor beside it once that is drafted. */
function layoutCard(L, i) {
  const warn = L.checks.length - L.score;
  const U = S.prefs.storeys === 2 && L.uppers ? L.uppers[L.upPick ?? 0] : null;
  if (!U) return `${planSVG(L)}<h4>${L.label}: ${L.tag}</h4><p>${L.covered.toLocaleString()} sq ft covered</p>${S.prefs.storeys === 2 ? '<p class="fine">The first floor is drafted when you choose this one.</p>' : ''}<span class="badge ${warn ? 'w' : ''}">${L.score}/${L.checks.length} checks passed</span>`;
  const uw = U.checks.length - U.score;
  return `<div class="duo"><figure><figcaption>Ground floor</figcaption>${planSVG(L, { maxW: 200, maxH: 330, labels: false })}</figure><figure><figcaption>First floor</figcaption>${planSVG(U, { maxW: 200, maxH: 330, labels: false })}</figure></div>`
    + `<h4>House ${'ABCDEF'[i]}: ${L.tag}</h4><p>${L.covered.toLocaleString()} + ${U.covered.toLocaleString()} sq ft covered, ${terraceTag(U)}</p>${L.upNote ? `<p class="fine">${L.upNote}</p>` : ''}`
    + `<span class="badge ${warn || uw ? 'w' : ''}">${L.score}/${L.checks.length} and ${U.score}/${U.checks.length} checks passed</span>`;
}
function renderLayouts() {
  const L0 = S.layouts[0], two = S.prefs.storeys === 2, houses = two && S.layouts.some((L) => L.uppers);
  $('s2').querySelector('h2').textContent = houses ? 'Choose your house' : two ? 'Choose the ground floor' : 'Choose a layout';
  $('to3').textContent = houses ? 'Use this house' : two ? 'Use this ground floor' : 'Use this layout';
  $('s2sub').textContent = `${S.plot.w} x ${S.plot.d} ft plot, ${L0.beds} bedroom${L0.beds === 1 ? '' : 's'}${two ? ' downstairs' : ''}${houses ? ` and ${S.layouts.find((L) => L.uppers).uppers[0].beds} upstairs. Each option shows the ground floor and the first floor drafted over it, side by side` : two ? '. The stairs are placed for the first floor, which comes next' : ''}. Drafted by the Naqsha model and rule-checked. Pick one to adjust its walls.${S.note ? ` ${S.note}` : ''}`;
  const host = $('layouts');
  host.innerHTML = '';
  S.layouts.forEach((L, i) => {
    const el = document.createElement('button');
    el.className = 'opt';
    el.innerHTML = layoutCard(L, i);
    el.onclick = () => select(L.id);
    host.appendChild(el);
  });
  $('to3').disabled = true;
  editor?.destroy(); editor = null; editIdx = -1; editState.clear(); $('editor').hidden = true;
  $('checks').innerHTML = '<li><span></span><span>Select a layout to see its rule check and areas.</span></li>';
  $('areas').innerHTML = ''; $('chkscore').textContent = '';
}
let editor = null, editIdx = -1;
const editState = new Map();                                    // per layout: { original, history }, kept while switching layouts
function showChecks() {
  $('chkscore').textContent = `(${S.sel.score}/${S.sel.checks.length})`;
  $('checks').innerHTML = S.sel.checks.map((c) =>
    `<li><span class="ico ${c.level}">${c.level === 'ok' ? '&#10003;' : '&#9888;'}</span><div><b>${c.title}</b><span>${c.detail}</span></div></li>`).join('');
  $('areas').innerHTML = areaTable([['Ground floor', S.sel]]);
}
function select(id) {
  const idx = S.layouts.findIndex((l) => l.id === id);
  S.sel = S.layouts[idx];
  [...$('layouts').children].forEach((c, i) => c.classList.toggle('sel', i === idx));
  showChecks();
  $('to3').disabled = false;
  if (S.prefs.storeys === 2) $('to3').textContent = S.sel.uppers ? 'Use this house' : 'Use this ground floor';
  if (editor && editIdx === idx) return;                         // clicking the layout being edited: keep the editor as it is
  // editor: dragging a wall edits the plan; the rule check, cost, card and 3D all use the edited layout
  const fresh = $('editor').hidden;
  editor?.destroy();
  $('editor').hidden = false;
  editIdx = idx;
  const card = $('layouts').children[idx];
  if (!editState.has(S.sel.id)) editState.set(S.sel.id, {});
  editor = mountEditor($('edhost'), S.sel, {
    undoBtn: $('edundo'), resetBtn: $('edreset'), furnBtn: $('edfurn'), state: editState.get(S.sel.id),
    rebuild: (plan) => {
      const checks = plan.tree ? treeCheck(plan, plan.beds) : check(plan, plan.beds);
      const L = planToLayout({ text: plan.tree ? treeSerialize(plan) : serialize(plan), plan, checks, score: score(checks) }, idx);
      const fam = S.layouts[idx].family;
      L.family = fam;
      const was = S.layouts[idx];
      Object.assign(L, { uppers: was.uppers, upNote: was.upNote, upKey: was.upKey, upPick: was.upPick, upTerrace: was.upTerrace });
      L.tag = (FAMILY[fam] || 'Naqsha model') + (JSON.stringify(plan) !== JSON.stringify(editState.get(L.id).original) ? ', edited' : '');
      return L;
    },
    onChange: (L, live) => {
      S.layouts[idx] = S.sel = L;
      showChecks();
      if (live) return;                                          // the card thumbnail is redrawn when the drag ends
      card.innerHTML = layoutCard(L, idx);
    },
  });
  if (fresh) $('editor').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
$('to3').onclick = async () => {
  if (S.prefs.storeys !== 2) { renderStyles(); show(3); return; }
  S.seenUp = new Set();
  const L = S.sel;
  if (L.uppers && L.upKey === upKeyOf(L) && L.upTerrace === S.prefs.terrace) {      // the first floors drafted with the houses still fit
    S.upperLayouts = L.uppers.slice(); S.up = null; S.upNote = L.upNote || '';
    S.upperLayouts.forEach((u) => S.seenUp.add(u.text));
    upEditor?.destroy(); upEditor = null; upIdx = -1; upEditState.clear(); $('ueditor').hidden = true;
    renderUpper();
    show(2.5);
    selectUpper(Math.min(L.upPick ?? 0, S.upperLayouts.length - 1));
    return;
  }
  S.upperLayouts = [];
  await draftUpper(false);
};

// ---------- the first floor of a two-storey house: drafted by the model over the chosen ground floor ----------
/** Plot, covered area and coverage (against the indicative limit for the plot size), for one or two floors. */
function areaTable(floors) {
  const L0 = floors[0][1], plot = L0.plot.w * L0.plot.d, rule = L0.rule;
  const f = (v) => Math.round(v).toLocaleString();
  const rows = [['Plot', `${f(plot)} sq ft (${(plot / MARLA).toFixed(1)} marla)`]];
  let total = 0;
  for (const [name, L] of floors) { if (!L) continue; rows.push([`${name} covered`, `${f(L.covered)} sq ft`]); total += L.covered; }
  const cov = (L0.covered / plot) * 100;
  rows.push(['Ground coverage', `${cov.toFixed(0)}% <small>(limit about ${rule.cover}%)</small>`]);
  if (floors.length > 1 && floors[1][1]) rows.push(['Built area, both floors', `${f(total)} sq ft`]);
  const beds = floors.reduce((a, [, L]) => a + (L ? L.beds : 0), 0), baths = floors.reduce((a, [, L]) => a + (L ? L.rooms.filter((r) => r.parent).length : 0), 0);
  rows.push(['Bedrooms, washrooms', `${beds}, ${baths}`]);
  return '<table>' + rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table><p class="fine">Setbacks and coverage limits are indicative; confirm with your development authority.</p>';
}
/** First floors over a ground floor, stepping down to fewer upstairs bedrooms or washrooms when the plan does not fit. */
async function upperFor(ground, { regen, quick = false }, onStatus) {
  const { upBeds, upBaths, terrace } = S.prefs;
  const tries = [[upBeds, upBaths, '']];
  if (upBaths > upBeds) tries.push([upBeds, upBeds, `${upBaths} washrooms upstairs do not fit with this ground floor, so these have ${upBeds}, one attached to each bedroom.`]);
  for (let b = upBeds - 1; b >= 1; b--) tries.push([b, b + 1, `${upBeds} bedrooms do not fit upstairs over this ground floor, so these have ${b}.`], [b, b, `${upBeds} bedrooms do not fit upstairs over this ground floor, so these have ${b}.`]);
  for (const [beds, baths, msg] of quick ? tries.slice(0, 1) : tries) {                // quick: the houses are drafted without the step-downs
    const layouts = await upperLayouts(ground, { beds, baths, terrace }, onStatus,
      { exclude: regen ? S.seenUp : new Set(), temperature: regen ? 0.95 : 0.8, n: regen ? 18 : 12, quick });
    if (layouts.length) return { layouts, note: [msg, layouts.note].filter(Boolean).join(' ') };
    if (regen) break;                                            // Regenerate keeps the request; only the first try relaxes it
  }
  return { layouts: [], note: '' };
}
/** A first floor over each ground floor, so the options are whole houses. Pre-drafting has a time budget; a ground floor it did
 *  not get to (or that no first floor fitted quickly) stays an ordinary option, and its first floor is drafted when it is picked. */
async function withUppers(layouts, btn) {
  const deadline = Date.now() + 30000;
  let got = 0;
  for (let i = 0; i < layouts.length; i++) {
    const L = layouts[i];
    if (Date.now() > deadline) break;
    btn.textContent = `First floor ${i + 1} of ${layouts.length}...`;
    let r = { layouts: [], note: '' };
    try { r = await upperFor(L, { regen: false, quick: true }, (m) => (btn.textContent = `First floor ${i + 1} of ${layouts.length}: ${m}`)); } catch (err) { console.warn('first floor failed', err); }
    if (!r.layouts.length) continue;
    Object.assign(L, { uppers: r.layouts, upNote: r.note, upKey: upKeyOf(L), upTerrace: S.prefs.terrace });
    got++;
  }
  if (!got) return layouts;                                      // none: the first floor is drafted when a ground floor is picked
  layouts.filter((L) => L.uppers).forEach((L, i) => { L.upPick = i % L.uppers.length; });    // houses show different first floors (with and without a terrace)
  return layouts;
}
async function draftUpper(regen) {
  const btn = $(regen ? 'uregen' : 'to3'), label = btn.textContent;
  btn.disabled = true;
  $('uerr').hidden = true;
  let layouts = [], note = '';
  try {
    ({ layouts, note } = await upperFor(S.sel, { regen }, (m) => (btn.textContent = m)));
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
  Object.assign(S.sel, { uppers: layouts.slice(), upNote: note, upKey: upKeyOf(S.sel), upTerrace: S.prefs.terrace, upPick: 0 });
  upEditor?.destroy(); upEditor = null; upIdx = -1; upEditState.clear(); $('ueditor').hidden = true;
  renderUpper();
  show(2.5);
}
const upEditState = new Map();
let upEditor = null, upIdx = -1;
const upCard = (L) => `${planSVG(L)}<h4>${L.label}${L.tag === 'First floor, edited' ? ', edited' : ''}</h4><p>${L.beds} bedroom${L.beds === 1 ? '' : 's'}, ${L.covered.toLocaleString()} sq ft covered, ${terraceTag(L)}</p><span class="badge ${L.checks.length - L.score ? 'w' : ''}">${L.score}/${L.checks.length} checks passed</span>`;
function showUpperChecks() {
  const L = S.up;
  $('uchkscore').textContent = `(${L.score}/${L.checks.length})`;
  $('uchecks').innerHTML = L.checks.map((c) => `<li><span class="ico ${c.level}">${c.level === 'ok' ? '&#10003;' : '&#9888;'}</span><div><b>${c.title}</b><span>${c.detail}</span></div></li>`).join('');
  $('uareas').innerHTML = areaTable([['Ground floor', S.sel], ['First floor', L]]);
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
    undoBtn: $('uedundo'), resetBtn: $('uedreset'), furnBtn: $('uedfurn'), state: upEditState.get(S.up.id),
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
  const half = (title, L) => `<figure><figcaption>${title}</figcaption>${L ? planSVG(L, { maxW: 420, maxH: 520, furniture: true }) : '<p class="fine">Pick a first floor below.</p>'}</figure>`;
  host.innerHTML = half('Ground floor', S.sel) + half('First floor', S.up);
}
function renderUpper() {
  $('usub').textContent = `Over the ${S.sel.beds}-bedroom ground floor, the stairs come up in the same place. Drafted by the Naqsha model and rule-checked. The open roof of the floor below, where the first floor does not cover it, is the terrace.${S.upNote ? ` ${S.upNote}` : ''}`;
  $('uterr').value = S.prefs.terrace || 'both';
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
  $('uchecks').innerHTML = '<li><span></span><span>Select a first floor to see its rule check and the areas of both floors.</span></li>';
  $('uareas').innerHTML = ''; $('uchkscore').textContent = '';
}
$('uregen').onclick = () => draftUpper(true);
$('uterr').onchange = () => {                                      // the terrace choice changes the first floors drafted
  S.prefs.terrace = $('uterr').value; $('pterr').value = $('uterr').value;
  S.seenUp = new Set();
  draftUpper(true);
};
$('uto3').onclick = () => { renderStyles(); show(3); };

// ---------- step 3 ----------
// colours a Pakistani house is commonly finished in; null keeps the style's own colour
const WALLS = [[null, 'Style colour'], ['#f3f1ec', 'White'], ['#eadfca', 'Cream'], ['#e2cfa9', 'Sand'], ['#cfcfca', 'Light grey'], ['#c9d1bf', 'Sage'], ['#d9a98a', 'Terracotta']];
const TRIMS = [[null, 'Style colour'], ['#2b2f33', 'Charcoal'], ['#fbf8f0', 'White'], ['#6b4a32', 'Walnut'], ['#8a8f93', 'Steel']];
const INTERIORS = [[null, 'Style colour'], ['#f8f6f1', 'Off-white'], ['#efe6d6', 'Warm beige'], ['#e3e8e4', 'Mint grey'], ['#ece2dc', 'Blush']];
const WALLC = [[null, 'Same as the house'], ['#f3f1ec', 'White'], ['#eadfca', 'Cream'], ['#d9a98a', 'Terracotta'], ['#9aa59a', 'Sage grey'], ['#6b6f73', 'Slate'], ['#b8956a', 'Sand stone']];
const FLOORS_L = [[null, 'Style floor'], ['marble', 'White marble'], ['marble-warm', 'Warm marble'], ['terracotta', 'Terracotta'], ['wood', 'Light wood'], ['wood-dark', 'Dark wood']];
const FLOORS_B = [[null, 'Style floor'], ['wood', 'Light wood'], ['wood-dark', 'Dark wood'], ['marble', 'White marble'], ['marble-warm', 'Warm marble'], ['terracotta', 'Terracotta']];
const ACCENTS = [[null, 'Style colour'], ['#a8744c', 'Teak'], ['#6b4a32', 'Walnut'], ['#2f5d50', 'Deep green'], ['#8c2f2f', 'Brick red'], ['#c49a4a', 'Brass'], ['#2b2f33', 'Charcoal']];
S.colors = { wall: null, trim: null, accent: null };
S.site = { ...SITE_DEFAULT };
// what a floor material looks like in its swatch (the swatch colour is a CSS colour; a floor is named by its material)
const FLOOR_LOOK = { marble: '#ece9e2', 'marble-warm': '#e8dcc4', terracotta: '#c9774c', wood: '#c99b62', 'wood-dark': '#6b4529' };
function swatches(host, list, cur, onPick, look = null) {
  host.innerHTML = list.map(([c, name]) => `<button type="button" role="radio" aria-checked="${c === cur}" title="${name}" aria-label="${name}" data-c="${c || ''}" class="swatch${c ? '' : ' auto'}"${c ? ` style="--c:${(look && look[c]) || c}"` : ''}></button>`).join('');
  host.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    host.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    onPick(b.dataset.c || null);
  }));
}
let renderTicket = 0;
/** The three style cards: a 3D render of the house from the street (drawn one after another so the page stays responsive). */
function drawStyleCards() {
  const ticket = ++renderTicket;
  const cards = [...$('styles').children];
  STYLE_IDS.forEach((id, i) => {
    const img = cards[i].querySelector('.shot');
    img.parentElement.classList.add('loading');
    setTimeout(() => {
      if (ticket !== renderTicket) return;
      try { img.src = renderFront(S.sel, id, S.up, { colors: S.colors, width: 900, height: 600, site: S.site }); }
      catch (err) { console.warn('Could not render the front of the house.', err); }
      img.parentElement.classList.remove('loading');
    }, 30 + i * 60);
  });
}
// the colour rows of step 3; a colour taken from the visitor's photo is added to the row it belongs to
function drawSwatches() {
  const withPhoto = (list, key) => (S.inspo && S.inspo[key] ? [...list, [S.inspo[key], 'From your photo']] : list);
  swatches($('swwall'), withPhoto(WALLS, 'wall'), S.colors.wall, (c) => { S.colors.wall = c; drawStyleCards(); });
  swatches($('swtrim'), withPhoto(TRIMS, 'trim'), S.colors.trim, (c) => { S.colors.trim = c; drawStyleCards(); });
  swatches($('swacc'), withPhoto(ACCENTS, 'accent'), S.colors.accent, (c) => { S.colors.accent = c; drawStyleCards(); });
}

/** A changed copy of the chosen layout: the plan is checked again and the layout drawn from it. */
function relayout(plan, idx) {
  const checks = plan.tree ? treeCheck(plan, plan.beds) : check(plan, plan.beds);
  return planToLayout({ text: plan.tree ? treeSerialize(plan) : serialize(plan), plan, checks, score: score(checks) }, idx);
}

function bindFacade() {
  const set = (key, v) => { S.site[key] = v; drawStyleCards(); };
  $('froof').value = S.site.roof; $('froof').onchange = () => set('roof', $('froof').value);
  $('fwin').value = S.site.windows; $('fwin').onchange = () => set('windows', $('fwin').value);
  $('fshut').value = S.site.shutters ? '1' : '0'; $('fshut').onchange = () => set('shutters', $('fshut').value === '1');
  $('fclad').value = S.site.cladding; $('fclad').onchange = () => set('cladding', $('fclad').value);
  const note = (t) => { $('fnote').textContent = t; };
  note('');
  // the car porch: the ground floor changes in that one part, the rest of the plan stays as it is
  const idx = S.layouts.findIndex((l) => l.id === S.sel.id);
  S.porchBase ||= {};
  const base = (S.porchBase[S.sel.id] ||= JSON.parse(JSON.stringify(S.sel.plan)));
  $('fporch').value = 'keep';
  $('fporch').onchange = () => {
    const mode = $('fporch').value;
    const next = mode === 'keep' ? JSON.parse(JSON.stringify(base)) : setPorch(base, mode);
    if (!next) { note(mode === 'yes' ? 'There is no lawn strip wide enough in front for a car porch on this layout.' : 'This layout has no car porch to remove.'); $('fporch').value = 'keep'; return; }
    S.layouts[idx] = S.sel = relayout(next, idx);
    note(mode === 'keep' ? '' : 'Only the car porch changed; the rooms are as they were.');
    drawStyleCards();
    if ($('pair3') && !$('pair3').hidden) drawPair($('pair3'));
  };
  // a balcony in front of the first floor (two floors only)
  const canBalcony = !!S.up && !!balconyRoom(S.up.rects);
  $('fbalcl').hidden = !canBalcony;
  $('fbalc').value = S.up && S.up.plan.balcony ? '1' : '0';
  $('fbalc').onchange = () => {
    const next = setBalcony(S.up.plan, $('fbalc').value === '1');
    const i2 = S.upperLayouts.findIndex((l) => l.id === S.up.id);
    const L2 = relayout(next, i2 < 0 ? 0 : i2);
    L2.tag = S.up.tag;
    S.upperLayouts[i2 < 0 ? 0 : i2] = S.up = L2;
    note($('fbalc').value === '1' ? 'A balcony and its door were added in front of the first floor; the rooms are as they were.' : '');
    drawStyleCards();
    drawPair($('pair3'));
  };
  // a photo of a house the visitor likes: its colours and the closest style
  $('finsp').onchange = async () => {
    const f = $('finsp').files[0];
    $('finspout').textContent = 'Reading the picture...';
    const pal = await readInspiration(f);
    if (!pal) { $('finspout').textContent = 'That file is not a picture I can read. Try a JPG or PNG.'; return; }
    S.inspo = pal;
    S.colors.wall = pal.wall; S.colors.trim = pal.trim; if (pal.accent) S.colors.accent = pal.accent;
    drawSwatches();
    $('finspout').innerHTML = `<img class="inspo" src="${pal.url}" alt="Your picture" width="56" height="42"> Colours taken: walls <i class="dot" style="background:${pal.wall}"></i> trim <i class="dot" style="background:${pal.trim}"></i>${pal.accent ? ` accent <i class="dot" style="background:${pal.accent}"></i>` : ''}. Closest style: ${STYLES[pal.style].name}.`;
    drawStyleCards();
    const i = STYLE_IDS.indexOf(pal.style);
    if (i >= 0) $('styles').children[i].click();
  };
}
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
    el.className = 'opt style';
    el.innerHTML = `<span class="shotbox"><img class="shot" alt="Front of the house in the ${st.name} style" width="900" height="600"></span><h4>${st.name}</h4><p>${st.blurb}</p>`;
    el.onclick = () => {
      S.style = id;
      [...host.children].forEach((c) => c.classList.toggle('sel', c === el));
      $('to4').disabled = false;
    };
    host.appendChild(el);
  });
  drawSwatches();
  bindFacade();
  swatches($('swwallc'), WALLC, S.site.wallColor, (c) => { S.site.wallColor = c; drawStyleCards(); });
  const siteSel = [['swallstyle', 'wall'], ['swallh', 'wallH', Number], ['sgate', 'gate'], ['scar', 'car'], ['scarc', 'carColor']];
  for (const [id, key, cast] of siteSel) { $(id).value = String(S.site[key]); $(id).onchange = () => { S.site[key] = cast ? cast($(id).value) : $(id).value; drawStyleCards(); }; }
  drawStyleCards();
  if (S.wantStyle && STYLES[S.wantStyle]) { const i = STYLE_IDS.indexOf(S.wantStyle); if (i >= 0) host.children[i].click(); }   // the style the visitor asked for in words
}

/** One sheet with the plan of every floor and the front of the house, saved as a PNG (nothing leaves the browser). */
function planSheet(styleId) {
  const parts = [{ svg: planSVG(S.sel, { furniture: true }), cap: S.up ? 'Ground floor' : 'Floor plan' }];
  if (S.up) parts.push({ svg: planSVG(S.up, { furniture: true }), cap: 'First floor' });
  const front = renderFront(S.sel, styleId, S.up, { colors: S.colors, width: 1200, height: 800, site: S.site });
  const size = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  const H = 520, gap = 30, top = 70;
  let x = gap, body = '';
  for (const p of parts) {
    const [vw, vh] = size(p.svg), w = (vw / vh) * H;
    body += p.svg.replace('<svg ', `<svg x="${x}" y="${top}" width="${w}" height="${H}" `)
      + `<text x="${x + w / 2}" y="${top + H + 24}" text-anchor="middle" font-size="15" fill="#3a2f2c">${p.cap}</text>`;
    x += w + gap;
  }
  const fw = H * 1.5;
  body += `<image x="${x}" y="${top}" width="${fw}" height="${H}" href="${front}" preserveAspectRatio="xMidYMid slice"/>`
    + `<text x="${x + fw / 2}" y="${top + H + 24}" text-anchor="middle" font-size="15" fill="#3a2f2c">Front of the house, ${STYLES[styleId].name}</text>`;
  x += fw + gap;
  const W = x;
  const t = `${S.plot.w} x ${S.plot.d} ft plot, ${S.up ? 'two storeys' : 'single storey'}, ${S.sel.beds}${S.up ? ' + ' + S.up.beds : ''} bedrooms`;
  return { W, Ht: top + H + 50, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top + H + 50}" font-family="Geist, Arial, sans-serif">`
    + `<rect width="100%" height="100%" fill="#fbf8f1"/><text x="${gap}" y="34" font-size="22" font-weight="600" fill="#3a2f2c">Naqsha AI house plan</text>`
    + `<text x="${gap}" y="56" font-size="14" fill="#6b5f5a">${t}. Concept only, not a stamped drawing.</text>${body}</svg>` };
}
function downloadSheet() {
  const { W, Ht, svg } = planSheet(S.style || STYLE_IDS[0]);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'), k = 2;
    c.width = W * k; c.height = Ht * k;
    const g = c.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0);
    c.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `naqsha-${S.plot.w}x${S.plot.d}-plan.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
$('dl').onclick = downloadSheet;

// ---------- step 4 ----------
const VIEW_HINT = {
  walk: 'Drag to look. W/A/S/D or arrows to move, Shift to run, scroll to zoom. Click a door or press F to open and close it.',
  follow: 'You are the visitor: W/A/S/D to walk, drag to turn the camera. Click a door or press F to open and close it.',
  tour: 'A guided tour: the visitor walks through every room. Pick another view to take over.',
  orbit: 'Drag to orbit, scroll to zoom, right-drag to pan.',
  top: 'Looking straight down. Scroll to zoom, right-drag to pan.',
  street: 'The street view. Drag to look around the house.',
  showcase: 'The house turns slowly. Drag to take over.',
};
function openViewer() {
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  $('vfloor').hidden = !S.up;
  $('vfloor').textContent = 'Go upstairs';
  $('vview').value = 'walk';
  $('vdoors').textContent = 'Close doors';
  let doorsOpen = true;
  S.viewer = createViewer($('vhost'), S.sel, S.style, {
    onRoom: (n) => ($('hudroom').textContent = n),
    onFloor: (f) => ($('vfloor').textContent = f ? 'Go downstairs' : 'Go upstairs'),
    onTour: (on) => { if (!on && S.viewer && S.viewer.mode === 'tour') { $('vview').value = 'follow'; S.viewer.setMode('follow'); } },
    onRoomStop: (n) => ($('hudroom').textContent = n),
    onNearDoor: (d) => {
      const base = VIEW_HINT[S.viewer ? S.viewer.mode : 'walk'];
      $('hudhint').textContent = d && S.viewer && ['walk', 'follow'].includes(S.viewer.mode) ? `${d.open ? 'Press F to close' : 'Press F to open'} the door. ${base}` : base;
    },
    onMode: (mode, roof) => {
      $('vview').value = mode;
      $('vroof').textContent = roof ? 'Hide roof' : 'Show roof';
      $('vreset').hidden = !['walk', 'follow', 'tour'].includes(mode);
      $('vcutl').hidden = !(S.up && ['orbit', 'top', 'street', 'showcase'].includes(mode));
      $('vdoors').hidden = !['walk', 'follow', 'tour'].includes(mode);
      $('hudhint').textContent = VIEW_HINT[mode] || '';
    },
  }, S.up, S.colors, S.site);
  $('vpalette').hidden = true;
  $('vcolors').setAttribute('aria-expanded', 'false');
  const v = S.viewer;
  swatches($('vswwall'), WALLS.slice(1), S.colors.wall, (c) => v.setColors({ wall: c }));
  swatches($('vswint'), INTERIORS.slice(1), null, (c) => v.setColors({ interior: c }));
  swatches($('vswtrim'), TRIMS.slice(1), S.colors.trim, (c) => v.setColors({ trim: c }));
  swatches($('vswfl'), FLOORS_L.slice(1), S.site.floorLiving, (c) => c && v.setFloors({ living: c }), FLOOR_LOOK);
  swatches($('vswfb'), FLOORS_B.slice(1), S.site.floorBed, (c) => c && v.setFloors({ bed: c }), FLOOR_LOOK);
  swatches($('vswwc'), WALLC, S.site.wallColor, (c) => v.setSite({ wallColor: c }));
  for (const [id, key, cast] of [['vwall', 'wall'], ['vwallh', 'wallH', Number], ['vgate', 'gate'], ['vcar', 'car'], ['vcarc', 'carColor']]) {
    $(id).value = String(S.site[key]);
    $(id).onchange = () => { const val = cast ? cast($(id).value) : $(id).value; S.site[key] = val; v.setSite({ [key]: val }); };
  }
  $('vfov').value = 70;
  $('vfov').oninput = () => v.setFov(+$('vfov').value);
  $('vview').onchange = () => { const m = $('vview').value; if (m === 'tour') v.startTour(); else v.setMode(m); };
  $('vcut').value = 'all';
  $('vcut').onchange = () => v.setCutaway($('vcut').value);
  $('vdoors').onclick = () => { doorsOpen = !doorsOpen; v.setAllDoors(doorsOpen); $('vdoors').textContent = doorsOpen ? 'Close doors' : 'Open doors'; };
}
$('to4').onclick = openViewer;
$('vcolors').onclick = () => { const p = $('vpalette'); p.hidden = !p.hidden; $('vcolors').setAttribute('aria-expanded', String(!p.hidden)); };
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
