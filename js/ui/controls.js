/**
 * controls.js — Comprehensive reusable UI control factories for orbital simulations
 * 
 * Every simulation imports only what it needs.
 * Factories return DocumentFragment or HTMLElement ready to append to sidebar.
 */

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else if (c instanceof Node) e.appendChild(c);
  }
  return e;
}

function group(title, ...items) {
  const g = el('div', { class: 'control-group' });
  if (title) g.appendChild(el('h3', {}, title));
  for (const item of items) {
    if (typeof item === 'string') g.appendChild(document.createTextNode(item));
    else if (item instanceof Node) g.appendChild(item);
  }
  return g;
}

function paramLabel(text) {
  return el('div', { class: 'param-label' }, text);
}

function paramRow(...children) {
  return el('div', { class: 'param-row' }, ...children);
}

// ======================================================================
// 1. TRANSPORT
// ======================================================================
export function transport(sim) {
  const playBtn = el('button', { id: 'playBtn', class: 'sim-btn active' }, '▶ Play');
  const pauseBtn = el('button', { id: 'pauseBtn', class: 'sim-btn' }, '⏸ Pause');
  const stepBtn = el('button', { id: 'stepBtn', class: 'sim-btn' }, '⏭ Step');
  const resetBtn = el('button', { id: 'resetBtn', class: 'sim-btn danger' }, '⏹ Reset');
  playBtn.onclick = () => sim.start();
  pauseBtn.onclick = () => sim.pause();
  stepBtn.onclick = () => sim.step();
  resetBtn.onclick = () => sim.reset();
  sim._btn = () => {
    playBtn.classList.toggle('active', sim.isRunning);
    pauseBtn.classList.toggle('active', !sim.isRunning);
  };
  return group('Transport', el('div', { class: 'btn-group' }, playBtn, pauseBtn, stepBtn, resetBtn));
}

// ======================================================================
// 2. G SLIDER
// ======================================================================
export function GSlider(onChange) {
  const label = paramLabel('Gravitational constant G');
  const sl = el('input', { type: 'range', class: 'control-slider param-slider', min: '1', max: '200', step: '1', value: '60' });
  const inp = el('input', { type: 'number', class: 'param-input', value: '60', step: 'any' });
  sl.addEventListener('input', () => { inp.value = sl.value; onChange(+sl.value); });
  inp.addEventListener('input', () => { sl.value = inp.value; onChange(+inp.value); });
  return group('Orbital Parameters', label, paramRow(sl, inp));
}

// ======================================================================
// 3. SPEED SLIDER (log scale)
// ======================================================================
export function speedSlider(onChange) {
  const label = paramLabel('Speed multiplier (log scale)');
  const sl = el('input', { type: 'range', id: 'speedSlider', class: 'control-slider param-slider', min: '0', max: '100', step: '1', value: '0' });
  const display = el('span', { id: 'speedValue', class: 'param-input', style: 'text-align:center;color:var(--accent);font-weight:500;' }, '0.1x');
  function toSpd(v) { return 0.1 * Math.pow(100000, v / 100); }
  sl.addEventListener('input', () => {
    const speed = toSpd(+sl.value);
    display.textContent = (speed >= 1 ? Math.round(speed) : speed.toFixed(1).replace(/\.0$/, '')) + 'x';
    onChange(speed);
  });
  onChange(toSpd(+sl.value));
  return el('div', {}, label, paramRow(sl, display));
}

// ======================================================================
// 4. SOFTENING SLIDER
// ======================================================================
export function softeningSlider(onChange) {
  const label = paramLabel('Softening ε');
  const sl = el('input', { type: 'range', id: 'softeningSlider', class: 'control-slider param-slider', min: '0', max: '10', step: '0.1', value: '5' });
  const display = el('span', { id: 'softeningValue', class: 'param-input', style: 'text-align:center;color:var(--accent);font-weight:500;' }, '5');
  sl.addEventListener('input', () => { const v = +sl.value; display.textContent = v.toFixed(2); onChange(v); });
  return el('div', {}, label, paramRow(sl, display));
}

// ======================================================================
// 5. TRAIL TOGGLE (no trails / show trails — max 10s)
// ======================================================================
export function trailToggle(onChange) {
  const toggleEl = el('div', { class: 'toggle-switch active' });
  const labelEl = el('label', {}, 'Show trails (max 10s)');
  const row = el('div', { class: 'toggle-row' }, toggleEl, labelEl);
  toggleEl.addEventListener('click', () => {
    const now = toggleEl.classList.toggle('active');
    if (onChange) onChange(now);
  });
  return group('Trail', row);
}

// ======================================================================
// 6. CAMERA (zoom buttons, no COM lock)
// ======================================================================
export function camera(renderer, fitCallback) {
  const zoomIn = el('button', { class: 'sim-btn' }, '🔍+');
  const zoomOut = el('button', { class: 'sim-btn' }, '🔍−');
  const fit = el('button', { class: 'sim-btn' }, '⊞ Fit');
  zoomIn.onclick = () => renderer.zoomAt(1.3);
  zoomOut.onclick = () => renderer.zoomAt(1 / 1.3);
  fit.onclick = () => { if (fitCallback) fitCallback(); };
  return group('Camera', el('div', { class: 'btn-group' }, zoomIn, zoomOut, fit));
}

// ======================================================================
// 7. TOGGLE
// ======================================================================
export function toggle(id, labelText, defaultValue, onChange) {
  const toggleEl = el('div', { id, class: 'toggle-switch' + (defaultValue ? ' active' : '') });
  const labelEl = el('label', {}, labelText);
  const row = el('div', { class: 'toggle-row' }, toggleEl, labelEl);
  toggleEl.addEventListener('click', () => {
    const now = toggleEl.classList.toggle('active');
    if (onChange) onChange(now);
  });
  return row;
}

export function comLock(onChange) {
  return toggle('comLockToggle', 'Track centre of mass', false, onChange);
}

// ======================================================================
// 8. N-BODY MASS SLIDERS (with × delete)
// ======================================================================
export function bodyMassSliders(bodies, onMassChange, onRemove) {
  const frag = document.createDocumentFragment();
  bodies.forEach((b, i) => {
    const d = el('div', { style: 'margin-bottom:6px;display:flex;align-items:center;gap:4px;' });
    const del = el('span', { style: 'cursor:pointer;color:#ff4444;font-weight:700;font-size:1rem;padding:0 4px;flex-shrink:0;user-select:none;', title: 'Remove body' }, '×');
    del.addEventListener('click', () => { if (onRemove) onRemove(i); });
    d.appendChild(del);
    const col = el('div', { style: 'flex:1;' });
    const l = el('span', { class: 'control-label', style: `color:${b.color};` }, `${b.label} mass`);
    col.appendChild(l);
    const row = el('div', { style: 'display:flex;align-items:center;gap:6px;' });
    const sl = el('input', { type: 'range', class: 'control-slider', min: '1', max: '100000', value: String(b.mass), style: 'flex:1;' });
    const inp = el('input', { type: 'number', value: String(b.mass), style: 'width:72px;padding:2px 4px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:0.82rem;' });
    sl.addEventListener('input', () => { inp.value = sl.value; onMassChange(i, +sl.value); });
    inp.addEventListener('input', () => { const v = +inp.value; if (v > 0) { sl.value = String(v); onMassChange(i, v); } });
    row.appendChild(sl); row.appendChild(inp); col.appendChild(row); d.appendChild(col); frag.appendChild(d);
  });
  return frag;
}

// ======================================================================
// 9. KEPLER MASS SLIDERS
// ======================================================================
export function keplerMassSlider(label, id, min, max, value, onChange) {
  const labelEl = paramLabel(label);
  const sl = el('input', { type: 'range', id: id + 'Slider', class: 'control-slider param-slider', min: String(min), max: String(max), step: String((max - min) / 100), value: String(value) });
  const inp = el('input', { type: 'number', id: id + 'Input', class: 'param-input', value: String(value), step: 'any' });
  sl.addEventListener('input', () => { inp.value = sl.value; onChange(+sl.value); });
  inp.addEventListener('input', () => { const v = +inp.value; if (v > 0) { sl.value = String(v); onChange(v); } });
  return el('div', {}, labelEl, paramRow(sl, inp));
}

// ======================================================================
// 10. μ DISPLAY
// ======================================================================
export function muDisplay(value) {
  return el('div', { class: 'param-label' }, `μ = G·(m₁+m₂): <span id="muDisplay" style="color:var(--accent);font-weight:600;">${value.toFixed(0)}</span>`);
}

// ======================================================================
// 11. REFERENCE FRAME toggle style (like N-body toggles)
// ======================================================================
export function referenceFrameToggle(onChange) {
  const toggleEl = el('div', { id: 'comFrameToggle', class: 'toggle-switch active' });
  const labelEl = el('label', {}, 'COM frame (vs. perifocal)');
  const row = el('div', { class: 'toggle-row' }, toggleEl, labelEl);
  toggleEl.addEventListener('click', () => {
    const isCom = toggleEl.classList.toggle('active');
    if (onChange) onChange(isCom ? 'COM' : 'Rel');
  });
  return group('Reference Frame', row);
}

// ======================================================================
// 12. TEXT INPUT
// ======================================================================
export function textInput(id, labelText, defaultValue) {
  const labelEl = paramLabel(labelText);
  const inp = el('input', { type: 'text', id, class: 'param-input', value: defaultValue, style: 'width:100%;' });
  inp.addEventListener('change', () => {});
  return el('div', {}, labelEl, inp);
}

// ======================================================================
// 13. ECCENTRICITY SLIDER
// ======================================================================
export function eccentricitySlider(eccPower, onReset) {
  const labelEl = paramLabel('Eccentricity e');
  const sl = el('input', { type: 'range', id: 'eccSlider', class: 'control-slider param-slider', min: '0', max: '2.5', step: '0.01', value: '0.2' });
  const inp = el('input', { id: 'eccInput', class: 'param-input', type: 'number', step: '0.0001', min: '0', max: '10', value: '0.3000' });
  const toEcc = v => (+inp.min || 0) + ((+inp.max || 10) - (+inp.min || 0)) * Math.pow(v / +sl.max, eccPower);
  const toSl = e => +sl.max * Math.pow((e - (+inp.min || 0)) / ((+inp.max || 10) - (+inp.min || 0)), 1 / eccPower);
  sl.addEventListener('input', () => { inp.value = toEcc(+sl.value).toFixed(4); onReset(); });
  inp.addEventListener('input', () => {
    let v = +inp.value; if (!Number.isFinite(v)) return;
    const mn = +inp.min || 0, mx = +inp.max || 10;
    if (v < mn) v = mn; if (v > mx) v = mx;
    const st = +inp.step || 0.0001; v = Math.round(v / st) * st;
    inp.value = v.toFixed(4); sl.value = String(toSl(v)); onReset();
  });
  inp.value = toEcc(+sl.value).toFixed(4);
  return el('div', {}, labelEl, paramRow(sl, inp));
}

// ======================================================================
// 14. INITIAL POSITION INPUT
// ======================================================================
export function initialPosition(onChange) {
  const labelEl = paramLabel('Initial position r₀ (km) from central body');
  const inp = el('input', { type: 'text', id: 'r0Input', class: 'param-input', value: '12000, 0', style: 'width:100%;' });
  inp.addEventListener('change', onChange);
  return el('div', {}, labelEl, inp);
}

// ======================================================================
// 15. INFO TEXT
// ======================================================================
export function infoText(text) {
  return el('div', { class: 'param-label', style: 'margin-top:4px;font-size:0.72rem;color:var(--text-muted);font-style:italic;' }, text);
}

// ======================================================================
// 16. BODY DATA DISPLAY (colored labels, dynamic N bodies)
// ======================================================================
export function bodyDataDisplay(bodies) {
  const container = document.getElementById('bodyDataContainer');
  if (!container) return;
  container.innerHTML = '';
  bodies.forEach((b, i) => {
    const group = el('div', { style: 'display:flex;flex-direction:column;gap:2px;white-space:nowrap;flex:1 0 0;min-width:0;' });
    const label = el('span', { style: `color:${b.color};font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;` }, b.label);
    const value = el('span', { id: `dBody${i}`, style: 'color:var(--text-primary);font-size:0.85rem;font-variant-numeric:tabular-nums;' }, '(0,0) v 0');
    group.appendChild(label);
    group.appendChild(value);
    container.appendChild(group);
  });
}

// ======================================================================
// 17. COLLAPSIBLE DATA BAR toggle
// ======================================================================
export function dataBarToggle() {
  const toggleEl = el('div', { id: 'dataBarToggle', class: 'toggle-switch active' });
  const labelEl = el('label', {}, 'Show data bar');
  const row = el('div', { class: 'toggle-row', style: 'margin-top:4px;' }, toggleEl, labelEl);
  toggleEl.addEventListener('click', () => {
    const show = toggleEl.classList.toggle('active');
    const bar = document.querySelector('.sim-data-bar');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  });
  return group('Display', row);
}