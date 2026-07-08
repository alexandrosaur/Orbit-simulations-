/**
 * script.js — Kepler's Orbits Simulation
 * Uses shared controls from js/ui/controls.js
 * Displays effective potential U_eff(r) graph on the right panel
 */

import { PhysicsEngine } from '../../js/core/physics-engine.js';
import { CanvasRenderer } from '../../js/renderer/canvas-renderer.js';
import { vec, mag, sub, scale, clone } from '../../js/core/math-utils.js';
import { transport, speedSlider, trailToggle, camera, comLock, keplerMassSlider, muDisplay, referenceFrameToggle, eccentricitySlider, initialPosition, dataBarToggle } from '../../js/ui/controls.js';
import { injectShortcutLegend } from '../../js/ui/shortcut-legend.js';

class KeplerSim {
  constructor() {
    this.physics = new PhysicsEngine();
    const canvas = document.getElementById('simCanvas');
    this.renderer = new CanvasRenderer(canvas);

    this.ueffCanvas = document.getElementById('ueffCanvas');
    this.ueffCtx = this.ueffCanvas.getContext('2d');
    this._ueffResize();
    this._setupUeffResize();

    this.r1 = vec(0, 0); this.v1 = vec(0, 0);
    this.r2 = vec(12000, 0); this.v2 = vec(0, 0);
    this.t = 0; this.mu = 660000;
    this.G = 60; this.m1 = 10000; this.m2 = 1000;
    this.history1 = [clone(this.r1)];
    this.history2 = [clone(this.r2)];
    this.isRunning = false;
    this.refFrame = 'COM'; this.eccPower = 3;
    this._panState = null;
    this.speed = 1.0;
    this._comLockEnabled = false;
    this.renderer.bodyScale = 3000;

    this._buildSidebar();
    this._setupCanvas();
    this._setupSidebarToggle();
    this.reset();
    this._loop();
  }

  _ueffResize() {
    const rect = this.ueffCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.ueffCanvas.width = rect.width;
      this.ueffCanvas.height = rect.height;
    }
  }

  _setupSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.querySelector('.sim-controls');
    if (!toggleBtn || !sidebar) return;
    let collapsed = false;
    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
      toggleBtn.innerHTML = collapsed ? '☰ Controls <span>▶</span>' : '☰ Controls <span>▼</span>';
    });
  }

  _setupUeffResize() {
    const handle = document.querySelector('.ueff-resize-handle');
    const panel = document.querySelector('.sim-right-panel');
    if (!handle || !panel) return;
    let startX, startW;
    const onDown = e => {
      startX = e.clientX; startW = panel.offsetWidth;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    };
    const onMove = e => {
      const dx = e.clientX - startX;
      panel.style.width = Math.max(100, Math.min(window.innerWidth * 0.8, startW - dx)) + 'px';
      this._ueffResize();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('resize', () => this._ueffResize());
  }

  _buildSidebar() {
    const sb = document.querySelector('.sim-controls');
    sb.appendChild(transport(this));

    const params = document.createElement('div');
    params.className = 'control-group';
    params.appendChild(document.createElement('h3')).textContent = 'Orbital Parameters';

    const gLabel = document.createElement('div');
    gLabel.className = 'param-label';
    gLabel.textContent = 'Gravitational constant G';
    params.appendChild(gLabel);
    const gRow = document.createElement('div');
    gRow.className = 'param-row';
    const gSl = document.createElement('input');
    gSl.type = 'range'; gSl.id = 'gSlider'; gSl.className = 'control-slider param-slider'; gSl.min = '1'; gSl.max = '200'; gSl.step = '1'; gSl.value = '60';
    const gInp = document.createElement('input');
    gInp.type = 'number'; gInp.id = 'gInput'; gInp.className = 'param-input'; gInp.value = '60'; gInp.step = 'any';
    gSl.addEventListener('input', () => { gInp.value = gSl.value; this.G = +gSl.value; this._recalcMu(); });
    gInp.addEventListener('input', () => { gSl.value = gInp.value; this.G = +gInp.value; this._recalcMu(); });
    gRow.appendChild(gSl); gRow.appendChild(gInp);
    params.appendChild(gRow);

    params.appendChild(keplerMassSlider('Body 1 mass (kg)', 'm1', 100, 50000, 10000, v => { this.m1 = v; this._recalcMu(); }));
    params.appendChild(keplerMassSlider('Body 2 mass (kg)', 'm2', 10, 10000, 1000, v => { this.m2 = v; this._recalcMu(); }));
    params.appendChild(muDisplay(this.mu));
    params.appendChild(speedSlider(v => { this.speed = v; }));
    params.appendChild(initialPosition(() => this.reset()));
    params.appendChild(eccentricitySlider(this.eccPower, () => this.reset()));
    sb.appendChild(params);

    sb.appendChild(referenceFrameToggle(v => { this.refFrame = v; this.reset(); }));
    sb.appendChild(trailToggle(v => { this.renderer.showTrails = v; }));

    const cam = camera(this.renderer, () => this._fit());
    cam.appendChild(comLock(v => { this._comLockEnabled = v; }));
    sb.appendChild(cam);

    sb.appendChild(dataBarToggle());

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); this.isRunning = !this.isRunning; this._btn(); }
      if (e.key === 'r' || e.key === 'R') this.reset();
      if (e.key === 'f' || e.key === 'F') this._fit();
    });
  }

  _recalcMu() {
    this.mu = this.G * (this.m1 + this.m2);
    const muD = document.getElementById('muDisplay');
    if (muD) muD.textContent = this.mu.toFixed(0);
    this.reset();
  }

  _step(dt) {
    const rRel = sub(this.r2, this.r1);
    const vRel = sub(this.v2, this.v1);
    const s = this.physics.solveKepler(rRel, vRel, dt * this.speed, this.mu);
    if (this.refFrame === 'COM') {
      this.r1 = scale(-this.m2 / (this.m1 + this.m2), s.r);
      this.r2 = scale(this.m1 / (this.m1 + this.m2), s.r);
      this.v1 = scale(-this.m2 / (this.m1 + this.m2), s.v);
      this.v2 = scale(this.m1 / (this.m1 + this.m2), s.v);
    } else {
      this.r1 = vec(0, 0); this.r2 = s.r;
      this.v1 = vec(0, 0); this.v2 = s.v;
    }
    this.t += dt * this.speed;
    const pt1 = clone(this.r1); pt1.time = this.t;
    const pt2 = clone(this.r2); pt2.time = this.t;
    this.history1.push(pt1);
    this.history2.push(pt2);
    if (this.history1.length > 10000) this.history1.shift();
    if (this.history2.length > 10000) this.history2.shift();
  }

  reset() {
    this.isRunning = false;
    this.G = +document.getElementById('gInput').value || 60;
    this.m1 = +document.getElementById('m1Input').value || 10000;
    this.m2 = +document.getElementById('m2Input').value || 1000;
    this.mu = this.G * (this.m1 + this.m2);
    const muD = document.getElementById('muDisplay');
    if (muD) muD.textContent = this.mu.toFixed(0);
    this.refFrame = document.getElementById('comFrameToggle').classList.contains('active') ? 'COM' : 'Rel';
    this.renderer.showTrails = true;

    const p = document.getElementById('r0Input').value.split(',').map(s => +s.trim());
    const rRel = vec(p[0] || 12000, p[1] || 0);
    const e = +document.getElementById('eccInput').value || 0.3;
    const rm = mag(rRel);
    const vm = Math.sqrt(this.mu * (1 + e) / rm);
    const tan = vec(-rRel.y / rm, rRel.x / rm);
    const vRel = scale(vm, tan);

    if (this.refFrame === 'COM') {
      this.r1 = scale(-this.m2 / (this.m1 + this.m2), rRel);
      this.r2 = scale(this.m1 / (this.m1 + this.m2), rRel);
      this.v1 = scale(-this.m2 / (this.m1 + this.m2), vRel);
      this.v2 = scale(this.m1 / (this.m1 + this.m2), vRel);
    } else {
      this.r1 = vec(0, 0); this.r2 = rRel;
      this.v1 = vec(0, 0); this.v2 = vRel;
    }
    this.t = 0;
    this.history1 = [{ ...clone(this.r1), time: 0 }];
    this.history2 = [{ ...clone(this.r2), time: 0 }];
    this._fit();
  }

  _fit() {
    this.renderer.zoomToFit([{ pos: this.r1 }, { pos: this.r2 }], 0.85);
  }

  _setupCanvas() {
    const c = this.renderer.canvas;
    // Touch state for pinch zoom
    this._touchState = { pinchDist: 0, touch1: null, touch2: null };

    // ---- MOUSE EVENTS ----
    c.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (this._comLockEnabled) {
        this._comLockEnabled = false;
        const toggleEl = document.getElementById('comLockToggle');
        if (toggleEl) toggleEl.classList.remove('active');
      }
      const r = c.getBoundingClientRect();
      this._panState = { x: e.clientX - r.left, y: e.clientY - r.top };
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('mousemove', e => {
      if (!this._panState) return;
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      this.renderer.pan(mx - this._panState.x, my - this._panState.y);
      this._panState.x = mx; this._panState.y = my;
    });
    const end = () => { this._panState = null; c.style.cursor = 'grab'; };
    c.addEventListener('mouseup', end);
    c.addEventListener('mouseleave', end);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.renderer.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    // ---- TOUCH EVENTS ----
    if ('ontouchstart' in window) {
      const ts = this._touchState;

      c.addEventListener('touchstart', e => {
        e.preventDefault();
        const touches = e.touches;
        if (touches.length === 1) {
          if (this._comLockEnabled) {
            this._comLockEnabled = false;
            const toggleEl = document.getElementById('comLockToggle');
            if (toggleEl) toggleEl.classList.remove('active');
          }
          const r = c.getBoundingClientRect();
          const mx = touches[0].clientX - r.left;
          const my = touches[0].clientY - r.top;
          ts.touch1 = touches[0].identifier;
          this._panState = { x: mx, y: my };
        } else if (touches.length === 2) {
          this._panState = null;
          const r = c.getBoundingClientRect();
          const x1 = touches[0].clientX - r.left, y1 = touches[0].clientY - r.top;
          const x2 = touches[1].clientX - r.left, y2 = touches[1].clientY - r.top;
          ts.touch1 = touches[0].identifier;
          ts.touch2 = touches[1].identifier;
          ts.pinchDist = Math.hypot(x2 - x1, y2 - y1);
          ts.pinchCenter = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
        }
      }, { passive: false });

      c.addEventListener('touchmove', e => {
        e.preventDefault();
        const touches = e.touches;
        if (touches.length === 2) {
          const r = c.getBoundingClientRect();
          const x1 = touches[0].clientX - r.left, y1 = touches[0].clientY - r.top;
          const x2 = touches[1].clientX - r.left, y2 = touches[1].clientY - r.top;
          const dist = Math.hypot(x2 - x1, y2 - y1);
          if (ts.pinchDist > 0 && dist > 10) {
            const factor = dist / ts.pinchDist;
            this.renderer.zoomAt(factor);
            ts.pinchDist = dist;
          }
          ts.pinchCenter = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
          return;
        }
        if (touches.length === 1 && this._panState) {
          const r = c.getBoundingClientRect();
          const mx = touches[0].clientX - r.left;
          const my = touches[0].clientY - r.top;
          this.renderer.pan(mx - this._panState.x, my - this._panState.y);
          this._panState.x = mx; this._panState.y = my;
        }
      }, { passive: false });

      c.addEventListener('touchend', e => {
        if (ts.pinchDist > 0) {
          ts.pinchDist = 0;
          ts.touch1 = null;
          ts.touch2 = null;
        }
        if (e.touches.length === 0) {
          this._panState = null;
        }
      });

      c.addEventListener('touchcancel', () => {
        this._panState = null;
        ts.pinchDist = 0;
        ts.touch1 = null;
        ts.touch2 = null;
      });
    }
  }

  _btn() {
    const p = document.getElementById('playBtn'), pa = document.getElementById('pauseBtn');
    if (p) p.classList.toggle('active', this.isRunning);
    if (pa) pa.classList.toggle('active', !this.isRunning);
  }

  _fmt(v, decimals = 2) {
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1e6 || (abs < 0.01 && abs > 0)) return v.toExponential(decimals);
    return v.toFixed(decimals);
  }

  _autoZoomOut() {
    const w = this.renderer.width, h = this.renderer.height;
    if (w <= 0 || h <= 0) return;
    const margin = 0.15;
    const bodies = [{ pos: this.r1 }, { pos: this.r2 }];
    for (const body of bodies) {
      const s = this.renderer.worldToScreen(body.pos);
      const mx = w * margin, my = h * margin;
      if (s.x < -mx || s.x > w + mx || s.y < -my || s.y > h + my) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const b of bodies) {
          if (b.pos.x < minX) minX = b.pos.x;
          if (b.pos.x > maxX) maxX = b.pos.x;
          if (b.pos.y < minY) minY = b.pos.y;
          if (b.pos.y > maxY) maxY = b.pos.y;
        }
        const newZoom = Math.min((w * 0.7) / Math.max(1, maxX - minX), (h * 0.7) / Math.max(1, maxY - minY));
        if (newZoom < this.renderer.zoom) this.renderer.zoom = newZoom;
        break;
      }
    }
  }

  _drawUeff() {
    const ctx = this.ueffCtx, cw = this.ueffCanvas.width, ch = this.ueffCanvas.height;
    if (cw <= 0 || ch <= 0) return;

    const rRel = sub(this.r2, this.r1), vRel = sub(this.v2, this.v1);
    const rm = mag(rRel), vm = mag(vRel);
    const h = rRel.x * vRel.y - rRel.y * vRel.x, h2 = h * h;
    const eps = (vm ** 2) / 2 - this.mu / rm;
    const isBound = eps < 0;
    let a = isBound ? -this.mu / (2 * eps) : Infinity;
    let rPeri = 0, rApo = Infinity;
    if (isBound) {
      rPeri = a * (1 - Math.sqrt(1 + (2 * eps * h2) / (this.mu * this.mu)));
      rApo = a * (1 + Math.sqrt(1 + (2 * eps * h2) / (this.mu * this.mu)));
    } else {
      const e = Math.sqrt(1 + (2 * eps * h2) / (this.mu * this.mu));
      rPeri = h2 / (this.mu * (1 + e));
    }
    const rMin = Math.max(rPeri * 0.3, 100);
    const rMax = isBound ? rApo * 2.5 : rm * 5;
    const logRmin = Math.log10(rMin), logRmax = Math.log10(rMax);
    const ml = 45, mr = 15, mt = 20, mb = 30, pw = cw - ml - mr, ph = ch - mt - mb;
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, cw, ch);
    const samples = 200, curve = [];
    let uMin = Infinity, uMax = -Infinity;
    for (let i = 0; i < samples; i++) {
      const logR = logRmin + (i / (samples - 1)) * (logRmax - logRmin);
      const r = Math.pow(10, logR);
      const u = -this.mu / r + h2 / (2 * r * r);
      curve.push({ r, u });
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
    const uPad = (uMax - uMin) * 0.15; uMin -= uPad; uMax += uPad;
    if (uMin > 0) uMin = 0; if (uMax < 0) uMax = 0;
    const toX = r => ml + pw * (Math.log10(r) - logRmin) / (logRmax - logRmin);
    const toY = u => mt + ph * (1 - (u - uMin) / (uMax - uMin));
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (const u of [uMin, uMin * 0.5, 0, uMax * 0.5, uMax]) {
      const y = toY(u);
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(cw - mr, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(this._fmt(u), ml - 4, y);
    }
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const x = toX(curve[i].r), y = toY(curve[i].u);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4488ff'; ctx.lineWidth = 2; ctx.stroke();
    const energyLineY = toY(eps);
    ctx.strokeStyle = isBound ? 'rgba(68,255,136,0.7)' : 'rgba(255,68,68,0.7)';
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ml, energyLineY); ctx.lineTo(cw - mr, energyLineY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = isBound ? 'rgba(68,255,136,0.8)' : 'rgba(255,68,68,0.8)';
    ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('E = ' + this._fmt(eps, 4) + ' km²/s²', ml + 4, energyLineY - 2);
    const currentRX = toX(rm), currentUY = toY(-this.mu / rm + h2 / (2 * rm * rm));
    ctx.beginPath(); ctx.arc(currentRX, currentUY, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffaa00'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffaa00'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('r = ' + this._fmt(rm, 1) + ' km', currentRX, currentUY - 8);
    if (isBound) {
      const rxP = toX(rPeri), uyP = toY(-this.mu / rPeri + h2 / (2 * rPeri * rPeri));
      ctx.beginPath(); ctx.arc(rxP, uyP, 3, 0, Math.PI * 2); ctx.fillStyle = '#44ff88'; ctx.fill();
      ctx.fillStyle = 'rgba(68,255,136,0.6)'; ctx.font = '8px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('rₚ=' + this._fmt(rPeri, 1), rxP, uyP + 4);
      const rxA = toX(rApo), uyA = toY(-this.mu / rApo + h2 / (2 * rApo * rApo));
      ctx.beginPath(); ctx.arc(rxA, uyA, 3, 0, Math.PI * 2); ctx.fillStyle = '#44ff88'; ctx.fill();
      ctx.fillStyle = 'rgba(68,255,136,0.6)'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('rₐ=' + this._fmt(rApo, 1), rxA, uyA + 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('r (km)', cw / 2, ch - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '8px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let e = Math.ceil(logRmin); e <= Math.floor(logRmax); e++) {
      const tick = Math.pow(10, e), x = toX(tick);
      ctx.fillText(this._fmt(tick, 0), x, ch - mb + 2);
      ctx.beginPath(); ctx.moveTo(x, ch - mb); ctx.lineTo(x, ch - mb + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke();
    }
  }

  _render() {
    this.renderer.clear();
    const bodies = [
      { pos: this.refFrame === 'COM' ? this.r1 : vec(0, 0), mass: this.m1, color: '#1a474a', label: 'Body 1' },
      { pos: this.r2, mass: this.m2, color: '#a12719', label: 'Body 2' }
    ];
    this.renderer.drawTrails([this.history1, this.history2], ['rgba(255,252,248,0.3)', 'rgba(255,252,248,0.3)'], this.t);
    if (this.refFrame === 'COM') this.renderer.drawCOM(vec(0, 0));
    this.renderer.drawBodies(bodies);
    this.renderer.drawScaleBar();

    const rm = mag(this.r2), vm = mag(this.v2);
    const eps = (vm ** 2) / 2 - this.mu / rm;
    const h = this.r2.x * this.v2.y - this.r2.y * this.v2.x;
    const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (this.mu * this.mu)));
    const a = eps < 0 ? -this.mu / (2 * eps) : Infinity;
    document.getElementById('dTime').textContent = this._fmt(this.t, 1) + ' s';
    document.getElementById('dPos').textContent = `(${this._fmt(this.r2.x, 1)}, ${this._fmt(this.r2.y, 1)})`;
    document.getElementById('dVel').textContent = vm.toFixed(4) + ' km/s';
    document.getElementById('dEcc').textContent = e.toFixed(4);
    document.getElementById('dEnergy').textContent = this._fmt(eps, 2) + ' km²/s²';
    document.getElementById('dSma').textContent = Number.isFinite(a) ? this._fmt(a, 1) + ' km' : '∞';
  }

  _loop() {
    if (this.isRunning) this._step(60);
    this._autoZoomOut();
    this._render();
    this._drawUeff();
    requestAnimationFrame(() => this._loop());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new KeplerSim();
  injectShortcutLegend([
    'Scroll — Zoom',
    'Drag on canvas — Pan',
  ]);
});
