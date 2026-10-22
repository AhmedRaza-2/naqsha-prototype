// The "what rooms do you want" form, one panel per floor. It is a view over the form's fields (the hidden ones in #legacy):
// ticking a room writes the field, and a change anywhere (the sentence box, the voice, another copy of this form) redraws every copy.
// Rooms that would not fit are greyed out with the reason; clicking one shows it.
import { assess, whyNot } from './fit.js';

const $ = (id) => document.getElementById(id);
const instances = [];
const fire = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));
const setVal = (id, v) => { const el = $(id); if (el && el.value !== String(v)) { el.value = String(v); fire(el); } };
const omitBox = (kind) => document.querySelector(`input[name=omit][value=${kind}]`);
const floorsNow = () => +$('pfloors').value;

/** The ground-floor and first-floor choices as the fit check reads them. */
export function readFloor(which) {
  const w = +$('pw').value, d = +$('pd').value, twoFloors = floorsNow() === 2;
  if (which === 'ground') {
    return { w, d, twoFloors, ground: true, beds: +$('pb').value, baths: +$('pbaths').value || +$('pb').value + 1,
      drawing: !omitBox('drawing').checked, lounge: !omitBox('lounge').checked, dining: !omitBox('dining').checked, porch: $('pporch').value !== 'no', openk: $('popenk').value === 'yes' };
  }
  return { w, d, twoFloors: true, ground: false, beds: +$('pup').value, baths: +$('pupbaths').value || +$('pup').value + 1,
    drawing: $('pupdraw').value === 'yes', lounge: true, terrace: $('pterr').value !== 'without' };
}

const pill = (key, label, on, off = false, why = '') => `<label class="pill${on ? ' on' : ''}${off ? ' off' : ''}" data-k="${key}"${off ? ` aria-disabled="true" title="${why.replace(/"/g, '')}"` : ''}><input type="checkbox" data-k="${key}"${on ? ' checked' : ''}${off ? ' disabled' : ''}><span>${label}</span></label>`;
const step = (key, label, v) => `<div class="step2" data-k="${key}"><span class="lab">${label}</span><button type="button" class="sb" data-d="-1" aria-label="One fewer ${label.toLowerCase()}">&minus;</button><output>${v}</output><button type="button" class="sb" data-d="1" aria-label="One more ${label.toLowerCase()}">+</button></div>`;

/** scope: 'tabs' (both floors, tabs when there are two), 'ground' or 'first' (just that floor). */
export function mountFloorForm(host, scope = 'tabs') {
  const inst = { host, scope, tab: scope === 'first' ? 'first' : 'ground', note: '' };
  host.classList.add('ff');
  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { inst.tab = t.dataset.tab; inst.note = ''; render(inst); return; }
    const sb = e.target.closest('.sb');
    if (sb) { stepper(inst, sb.closest('.step2').dataset.k, +sb.dataset.d); return; }
    const lab = e.target.closest('.pill.off');
    if (lab) { e.preventDefault(); inst.note = whyNot(readFloor(floorOf(inst)), lab.dataset.k); render(inst); }
  });
  host.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    inst.note = '';
    tick(floorOf(inst), cb.dataset.k, cb.checked);
  });
  instances.push(inst);
  render(inst);
  return inst;
}
const floorOf = (inst) => (inst.scope === 'tabs' ? (floorsNow() === 2 ? inst.tab : 'ground') : inst.scope);

function tick(floor, k, on, quiet = false) {
  if (floor === 'ground') {
    if (k === 'porch') setVal('pporch', on ? 'yes' : 'no');
    else if (k === 'openk') setVal('popenk', on ? 'yes' : 'no');
    else { const b = omitBox(k); if (b) { b.checked = !on; fire(b); } }
  } else if (k === 'drawing') setVal('pupdraw', on ? 'yes' : 'no');
  else if (k === 'terrace') setVal('pterr', on ? 'with' : 'without');
  if (!quiet) refreshForms();
}
function stepper(inst, key, dir) {
  const floor = floorOf(inst);
  if (floor === 'ground') {
    if (key === 'beds') setVal('pb', Math.min(6, Math.max(1, +$('pb').value + dir)));
    else setVal('pbaths', Math.min(+$('pb').value + 2, Math.max(+$('pb').value, +$('pbaths').value + dir)));
  } else if (key === 'beds') setVal('pup', Math.min(4, Math.max(1, +$('pup').value + dir)));
  else setVal('pupbaths', Math.min(+$('pup').value + 1, Math.max(+$('pup').value, +$('pupbaths').value + dir)));
  inst.note = '';
  if (key === 'beds' && dir > 0) makeRoom(inst, floor);
  refreshForms();
}
/** More bedrooms than the floor takes with every room ticked: untick the least needed room (dining, then lounge, then drawing room) and say so. */
function makeRoom(inst, floor) {
  const drop = [];
  for (const k of floor === 'ground' ? ['dining', 'lounge', 'drawing'] : ['drawing']) {
    if (assess(readFloor(floor)).fits || !readFloor(floor)[k]) continue;
    tick(floor, k, false, true); drop.push(assess(readFloor(floor)).name[k]);
  }
  if (drop.length) inst.note = `With ${floor === 'ground' ? +$('pb').value : +$('pup').value} bedrooms there is no space for the ${drop.join(' and the ')}, so ${drop.length > 1 ? 'they are' : 'it is'} left out. Tick ${drop.length > 1 ? 'one' : 'it'} again if you would rather have smaller rooms.`;
}

function render(inst) {
  const two = floorsNow() === 2, floor = floorOf(inst), cfg = readFloor(floor), a = assess(cfg);
  const tabs = inst.scope === 'tabs' && two
    ? `<div class="fftabs" role="tablist">${[['ground', 'Ground floor'], ['first', 'First floor']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${floor === k}" class="${floor === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
    : inst.scope === 'tabs' ? '<div class="ffhead">Rooms you want</div>' : '';
  const room = (k, label) => pill(k, label, !!cfg[k], !cfg[k] && !a.can[k], !cfg[k] && !a.can[k] ? whyNot(cfg, k) : '');
  let rooms;
  if (floor === 'ground') {
    rooms = `${room('drawing', 'Drawing room')}${room('lounge', 'TV lounge')}${room('dining', 'Dining room')}${pill('porch', 'Car porch', cfg.porch)}<span class="pill fixed"><span>Kitchen</span></span>${pill('openk', 'Open kitchen (counter, no wall)', cfg.openk)}`;
  } else {
    rooms = `<span class="pill fixed"><span>Family lounge</span></span>${room('drawing', 'Drawing room')}${room('terrace', 'Open terrace')}`;
  }
  const warn = [inst.note, ...a.msgs].filter(Boolean);
  inst.host.innerHTML = `${tabs}<div class="ffbody"><div class="ffsteps">${step('beds', 'Bedrooms', cfg.beds)}${step('baths', 'Washrooms', cfg.baths)}</div>`
    + `<div class="ffrooms">${rooms}</div>`
    + `<p class="ffspace">About ${a.space} sq ft of floor on this level. The rooms you chose take about ${a.want}.</p>`
    + `${warn.length ? `<p class="ffwarn" role="status">${warn.join(' ')}</p>` : ''}</div>`;
  inst.host.querySelectorAll('.sb').forEach((b) => {
    const k = b.closest('.step2').dataset.k, v = +b.dataset.d;
    const lo = k === 'beds' ? 1 : cfg.beds, hi = k === 'beds' ? (floor === 'ground' ? 6 : 4) : cfg.beds + (floor === 'ground' ? 2 : 1), cur = k === 'beds' ? cfg.beds : cfg.baths;
    b.disabled = v < 0 ? cur <= lo : cur >= hi;
  });
}

/** Redraw every copy of the form from the fields. Call after anything else sets the fields. */
export function refreshForms() { instances.forEach(render); }
