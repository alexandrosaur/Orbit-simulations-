/**
 * script.js — Three-Body Effective Potential Simulation
 * Computes instantaneous per-body gravitational potential energy
 * from the other two bodies and draws a live U_eff bar graph.
 * Features an inline split layout with 3D U_eff surface.
 */

import { PhysicsEngine } from '../../js/core/physics-engine.js';
import { StateManager } from '../../js/core/state-manager.js';
import { CanvasRenderer } from '../../js/renderer/canvas-renderer.js';
import { vec, mag, sub, cross, formatNum } from '../../js/core/math-utils.js';
import { transport, GSlider, speedSlider, softeningSlider, trailToggle, camera, comLock, bodyMassSliders, bodyDataDisplay, infoText, dataBarToggle } from '../../js/ui/controls.js';
import { UeffSurface3D } from './ueff-surface-3d.js';

function initThreeBodyPreset(state) {
  state.bodies = [];
  state.history = [];
  state.time = 0;

  const mass = 100;
  const s = 1000 / 1000;
  const h = s * Math.sqrt(3) / 2;
  const positions = [
    vec(0, (2/3) * h, 0),
    vec(-s / 2, -(1/3) * h, 0),
    vec(s / 2, -(1/3) * h, 0)
  ];
  const velocities = [
    vec(0, 0, 0),
    vec(0, 0, 0),
    vec(0, 0, 0)
  ];

  const names = ['Alpha', 'Beta', 'Gamma'];
  const colors = ['#ff4444', '#44ff88', '#4488ff'];

  for (let i = 0; i < 3; i++) {
    state.addBody(names[i], mass, positions[i], velocities[i], colors[i]);
  }

  return state.saveState();
}

class ThreeBodyUeffSim {
  constructor() {
    this.physics = new PhysicsEngine();
    this.state = new StateManager();
    const canvas = document.getElementById('simCanvas');
    this.renderer = new CanvasRenderer(canvas);

    this.isRunning = false;
    this.speed = 1.0;
    this.G = 60;
    this.dt = 0.005;
    this.softening = 5;
    this._initialState = null;
    this._panState = null;
    this._dragBody = null;
    this._comLockEnabled = false;
    this._selectedBody = 0;
    this._selectLock = false;
    this._cameraAnim = null;

    this._ueffHistory = [];
    this._lastResetTime = 0;
    this._overcrowdedPositions = new Set();
    this._surface3D = null;
    this._swapped = false;

    window._sim = this;
    this._buildSidebar();
    this._initSurface3D();
    this._setup3DControls();
    this._initDefaultState();
    this._setupCanvas();
    this._setupBarCanvas();
    this._resizeBodyCanvases();
    window.addEventListener('resize', () => this._resizeBodyCanvases());
    this._loop();
  }

  _initDefaultState() {
    this._initialState = initThreeBodyPreset(this.state);
    this._refreshMassSliders();
    bodyDataDisplay(this.state.bodies);
    this.renderer.zoomToFit(this.state.bodies, 0.85);
    this._ueffHistory = [];
    this._rebuildSurface();
    // No auto-select — nothing is selected on load
    this._selectedBody = -1;
    this._selectLock = false;
  }

  _initSurface3D() {
    const canvas3D = document.getElementById('ueffCanvas3D');
    if (!canvas3D) return;
    this._surface3D = new UeffSurface3D(canvas3D, { Y_MIN: -3, Y_MAX: 6 });
    const rect = canvas3D.parentElement.getBoundingClientRect();
    canvas3D.width = rect.width * window.devicePixelRatio;
    canvas3D.height = rect.height * window.devicePixelRatio;
    this._surface3D.resize();
  }

  _setup3DControls() {
    const pitchSlider = document.getElementById('ueffPitchSlider');
    if (pitchSlider) pitchSlider.addEventListener('input', () => {
      if (this._surface3D) this._surface3D._elevation = pitchSlider.value / 100 * Math.PI / 2;
    });
    const spinSlider = document.getElementById('ueffSpinSlider');
    if (spinSlider) spinSlider.addEventListener('input', () => {
      if (this._surface3D) this._surface3D._azimuth = spinSlider.value / 180 * Math.PI;
    });
    const yawSlider = document.getElementById('ueffYawSlider');
    if (yawSlider) yawSlider.addEventListener('input', () => {
      if (this._surface3D) {
        const rad = (yawSlider.value - 180) / 180 * Math.PI;
        this._surface3D._jibY = Math.sin(rad) * 12;
        this._surface3D._panOffset.z = Math.cos(rad) * 4;
      }
    });
    document.getElementById('ueffZoomOutBtn')?.addEventListener('click', () => {
      if (this._surface3D) this._surface3D._distance = Math.min(50, this._surface3D._distance * 1.2);
    });
    document.getElementById('ueffZoomInBtn')?.addEventListener('click', () => {
      if (this._surface3D) this._surface3D._distance = Math.max(3, this._surface3D._distance / 1.2);
    });
    // Swap button: toggles simulation and 3D canvases between center and right panel
    document.getElementById('ueffSwapBtn')?.addEventListener('click', () => {
      const wrap3D = document.querySelector('.ueff-3d-wrap');
      const simWrap = document.getElementById('simCanvasWrap');
      if (!wrap3D || !simWrap) return;
      // Get the canvases
      const simCanvas = document.getElementById('simCanvas');
      const canvas3D = document.getElementById('ueffCanvas3D');
      if (!simCanvas || !canvas3D) return;
      // Toggle swapped state
      this._swapped = !this._swapped;
      if (this._swapped) {
        // Move 3D canvas to center, sim canvas to right
        simWrap.insertBefore(canvas3D, simWrap.firstChild);
        wrap3D.appendChild(simCanvas);
      } else {
        // Move sim canvas back to center, 3D back to right
        simWrap.insertBefore(simCanvas, simWrap.firstChild);
        wrap3D.appendChild(canvas3D);
      }
      // Resize both
      this.renderer._handleResize();
      this._resize3DCanvas();
    });
  }

  _resize3DCanvas() {
    if (!this._surface3D) return;
    const canvas3D = document.getElementById('ueffCanvas3D');
    if (!canvas3D) return;
    const rect = canvas3D.parentElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas3D.width = rect.width * window.devicePixelRatio;
      canvas3D.height = rect.height * window.devicePixelRatio;
      this._surface3D.resize();
    }
  }

  _rebuildSurface() {
    if (!this._surface3D) return;
    const bodies = this.state.bodies;
    if (bodies.length < 3 || this._selectedBody < 0) return;
    const target = bodies[this._selectedBody < bodies.length ? this._selectedBody : 0];
    const otherA = bodies[(this._selectedBody + 1) % bodies.length];
    const otherB = bodies[(this._selectedBody + 2) % bodies.length];
    this._surface3D.rebuild({ G: this.G, mA: target.mass, mB: otherA.mass, mC: otherB.mass, nA: target.label, nB: otherA.label, nC: otherB.label });
  }

  _updateSurface(r1, r2, u) {
    if (!this._surface3D) return;
    const bodies = this.state.bodies;
    if (bodies.length < 3 || this._selectedBody < 0) return;
    const target = bodies[this._selectedBody < bodies.length ? this._selectedBody : 0];
    const otherA = bodies[(this._selectedBody + 1) % bodies.length];
    const otherB = bodies[(this._selectedBody + 2) % bodies.length];
    this._surface3D.update({ G: this.G, mA: target.mass, mB: otherA.mass, mC: otherB.mass, nA: target.label, nB: otherA.label, nC: otherB.label, r1, r2, U: u });
    document.getElementById('infoBody') && (document.getElementById('infoBody').textContent = target.label ?? '—');
    document.getElementById('infoR1') && (document.getElementById('infoR1').textContent = r1?.toFixed(2) ?? '—');
    document.getElementById('infoR2') && (document.getElementById('infoR2').textContent = r2?.toFixed(2) ?? '—');
    document.getElementById('infoUgrav') && (document.getElementById('infoUgrav').textContent = u?.toFixed(2) ?? '—');
    const ue = this._calcBodyUEff(this._selectedBody);
    document.getElementById('infoUeff') && (document.getElementById('infoUeff').textContent = ue?.U_eff?.toFixed(2) ?? '—');
  }

  _setupBarCanvas() {
    this.barCanvas = document.getElementById('ueffBarCanvas');
    this.barCtx = this.barCanvas.getContext('2d');
    this.barCanvas.addEventListener('click', (e) => {
      const rect = this.barCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const bodies = this.state.bodies;
      if (bodies.length === 0) return;
      const FIXED_BAR_W = 48;
      const ROW_HEIGHT = 172;
      const margin = { left: 34, right: 8 };
      const plotW = rect.width - margin.left - margin.right;
      const maxPerRow = Math.max(1, Math.floor(plotW / FIXED_BAR_W));
      const rows = Math.max(1, Math.ceil(bodies.length / maxPerRow));
      for (let row = 0; row < rows; row++) {
        const rowY0 = row * ROW_HEIGHT;
        const rowY1 = rowY0 + ROW_HEIGHT;
        if (my < rowY0 || my > rowY1) continue;
        for (let b = 0; b < maxPerRow; b++) {
          const idx = row * maxPerRow + b;
          if (idx >= bodies.length) break;
          const x0 = margin.left + b * FIXED_BAR_W;
          const x1 = x0 + FIXED_BAR_W;
          if (mx >= x0 && mx <= x1) { this._selectBody(idx); return; }
        }
      }
    });
  }

  _resizeBodyCanvases() {
    if (this.barCanvas) {
      const rect = this.barCanvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.barCanvas.width = rect.width * window.devicePixelRatio;
        this.barCanvas.height = rect.height * window.devicePixelRatio;
        const ctx = this.barCanvas.getContext('2d');
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      }
    }
  }

  _buildSidebar() {
    const sb = document.querySelector('.sim-controls');
    sb.appendChild(transport(this));
    sb.appendChild(GSlider(v => { this.G = v; this._rebuildSurface(); }));
    sb.appendChild(speedSlider(v => { this.speed = v; }));
    sb.appendChild(softeningSlider(v => { this.softening = v; }));
    sb.appendChild(infoText('Right-click canvas to add body · × on slider to remove'));
    sb.appendChild(trailToggle(v => { this.renderer.showTrails = v; }));
    const m = document.createElement('div');
    m.className = 'control-group';
    m.appendChild(document.createElement('h3')).textContent = 'Masses';
    this._massControls = document.createElement('div');
    this._massControls.id = 'massControls';
    m.appendChild(this._massControls);
    sb.appendChild(m);
    const cam = camera(this.renderer, () => { this.renderer.zoomToFit(this.state.bodies, 0.85); });
    cam.appendChild(comLock(v => { this._comLockEnabled = v; }));
    sb.appendChild(cam);
    sb.appendChild(dataBarToggle());
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.target.isContentEditable) return;
      if (e.key === ' ') { e.preventDefault(); this.isRunning ? this.pause() : this.start(); }
      if (e.key === 'r' || e.key === 'R') this.reset();
      if (e.key === 's' || e.key === 'S') this.step();
      if (e.key === 'f' || e.key === 'F') { this.renderer.zoomToFit(this.state.bodies, 0.85); this._deselectBody(); }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this._selectedBody >= 0 && this._selectedBody < this.state.bodies.length) {
          this.removeBody(this._selectedBody);
          this._deselectBody();
        }
      }
    });
  }

  start() { this.isRunning = true; this._btn(); }
  pause() { this.isRunning = false; this._btn(); }
  reset() {
    this.isRunning = false; this._btn();
    if (this._initialState) { this.state.loadState(this._initialState); this.state.clearHistory(); }
    this._refreshMassSliders();
    bodyDataDisplay(this.state.bodies);
    this.renderer.zoomToFit(this.state.bodies, 0.85);
    this._ueffHistory = []; this._rebuildSurface();
    this._selectBody(0);
  }
  step() { this._step(); }

  setMass(i, m) {
    const bodies = this.state.bodies;
    const oldMass = bodies[i].mass;
    m = Math.max(0.001, m);
    if (Math.abs(oldMass - m) < 1e-12) { this.state.setMass(i, m); return; }
    this.state.setMass(i, m);
    const k = Math.sqrt(oldMass / m);
    bodies[i].vel.x *= k; bodies[i].vel.y *= k; bodies[i].vel.z *= k;
    this._ueffHistory = []; this._rebuildSurface();
  }

  addBody(worldPos, mass = 1000) {
    const count = this.state.bodies.length;
    const names = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa'];
    const name = names[count] || `Body ${count+1}`;
    const colors = ['#ff4444','#4488ff','#44ff88','#ffaa00','#ff44ff','#44ffff','#ff8844','#88ff44','#ff4488','#44aaff'];
    const color = colors[count % colors.length];
    const idx = this.state.addBody(name, mass, worldPos, vec(0,0,0), color);
    if (this._initialState) {
      const s = this.state.saveState(); s.bodies[idx].vel = vec(0,0,0); this._initialState = s;
    }
    const bodies = this.state.bodies;
    const TOL = 1e-8;
    for (let i = 0; i < idx; i++) {
      if (Math.abs(bodies[i].pos.x - bodies[idx].pos.x) < TOL && Math.abs(bodies[i].pos.y - bodies[idx].pos.y) < TOL && Math.abs(bodies[i].pos.z - bodies[idx].pos.z) < TOL) {
        this._overcrowdedPositions.add(`${Math.round(bodies[idx].pos.x/TOL)*TOL},${Math.round(bodies[idx].pos.y/TOL)*TOL}`);
        break;
      }
    }
    this._refreshMassSliders(); bodyDataDisplay(this.state.bodies);
    this._ueffHistory = []; this._rebuildSurface(); return idx;
  }

  removeBody(index) {
    if (this.state.bodies.length <= 1) return;
    this.state.removeBody(index);
    this._initialState = this.state.saveState();
    this._refreshMassSliders(); bodyDataDisplay(this.state.bodies);
    if (this._selectedBody >= this.state.bodies.length) this._selectedBody = Math.max(0, this.state.bodies.length - 1);
    this._ueffHistory = []; this._rebuildSurface();
  }

  _selectBody(index) {
    if (index < 0 || index >= this.state.bodies.length) return;
    this._selectedBody = index; this._selectLock = true;
    const body = this.state.bodies[index];
    const dx = body.pos.x - this.renderer.offsetX;
    const dy = body.pos.y - this.renderer.offsetY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const duration = Math.max(0.1, Math.min(0.2, dist * 0.15));
    this._cameraAnim = { fromX: this.renderer.offsetX, fromY: this.renderer.offsetY, toX: body.pos.x, toY: body.pos.y, t: 0, duration };
    const ue = this._calcBodyUEff(index);
    const panel = document.getElementById('bodyInfoPanel');
    if (panel) {
      panel.innerHTML = `<div style="color:${body.color};font-weight:600;font-size:0.9rem;margin-bottom:4px;" id="panelLabel">${body.label}</div>
<div style="font-variant-numeric:tabular-nums;">Pos: (<span id="panelPx">${this._fmt(body.pos.x)}</span>, <span id="panelPy">${this._fmt(body.pos.y)}</span>)</div>
<div style="font-variant-numeric:tabular-nums;">Vel: (<span id="panelVx" contenteditable="true" data-axis="x" style="cursor:text;border-bottom:1px dashed rgba(255,255,255,0.2);">${this._fmt(body.vel.x)}</span>, <span id="panelVy" contenteditable="true" data-axis="y" style="cursor:text;border-bottom:1px dashed rgba(255,255,255,0.2);">${this._fmt(body.vel.y)}</span>)</div>
<div>Speed: <span id="panelSpeed">${this._fmt(mag(body.vel))}</span> km/s</div>
<div style="margin-top:6px;font-size:0.82rem;">U<sub>eff</sub> = <span id="panelUeff">${this._fmt(ue.U_eff)}</span> J &nbsp; (<span style="color:#88aaff;" id="panelUgrav">${this._fmt(ue.U_grav)}</span> + <span style="color:#ffaa44;" id="panelUcent">${this._fmt(ue.U_cent)}</span>)</div>
<div style="font-size:0.75rem;color:var(--text-muted);">L = <span id="panelL">${this._fmt(ue.L)}</span> kg·km²/s &nbsp; R = <span id="panelR">${this._fmt(ue.R)}</span> km</div>
<div style="margin-top:8px;display:flex;gap:8px;">
<button onclick="window._sim._makeStationary()" style="background:var(--accent);color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem;">⏸ Stationary</button>
<button onclick="window._sim.removeBody(window._sim._selectedBody);window._sim._deselectBody()" style="background:#ff4444;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem;">✕ Delete</button></div>`;
      const vxEl = document.getElementById('panelVx');
      const vyEl = document.getElementById('panelVy');
      const commitVel = (el) => {
        const val = parseFloat(el.textContent);
        const axis = el.getAttribute('data-axis');
        if (!isNaN(val) && this._selectedBody >= 0 && this._selectedBody < this.state.bodies.length) {
          this.state.bodies[this._selectedBody].vel[axis] = val;
        }
      };
      if (vxEl) { vxEl.addEventListener('blur', e => commitVel(e.target)); vxEl.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); e.target.blur(); }}); }
      if (vyEl) { vyEl.addEventListener('blur', e => commitVel(e.target)); vyEl.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); e.target.blur(); }}); }
      panel.style.display = 'block';
    }
  }

  _deselectBody() {
    this._selectedBody = -1; this._selectLock = false; this._lockShiftX = 0;
    const panel = document.getElementById('bodyInfoPanel');
    if (panel) panel.style.display = 'none';
  }

  _makeStationary() {
    if (this._selectedBody < 0 || this._selectedBody >= this.state.bodies.length) return;
    const body = this.state.bodies[this._selectedBody];
    body.stationary = !body.stationary;
    if (body.stationary) body.vel = vec(0,0,0);
  }

  _step() {
    const TOL = 1e-8;
    if (this._overcrowdedPositions.size > 0) {
      const bodies = this.state.bodies;
      for (const posKey of this._overcrowdedPositions) {
        const [px, py] = posKey.split(',').map(Number);
        const cluster = [];
        for (let i = 0; i < bodies.length; i++) {
          if (Math.abs(bodies[i].pos.x - px) < TOL && Math.abs(bodies[i].pos.y - py) < TOL && Math.abs(bodies[i].pos.z) < TOL) cluster.push(i);
        }
        const n = cluster.length;
        if (n > 1) {
          for (let k = 0; k < n; k++) {
            const angle = (2*Math.PI*k)/n;
            bodies[cluster[k]].pos.x += Math.cos(angle)*0.01;
            bodies[cluster[k]].pos.z += Math.sin(angle)*0.01;
            if (n>2) bodies[cluster[k]].pos.y += ((k/(n-1))-0.5)*0.01;
          }
        }
      }
      this._overcrowdedPositions.clear();
    }
    const dt = this.dt * this.speed;
    const pinnedPositions = new Map();
    for (const body of this.state.bodies) {
      if (body.stationary) pinnedPositions.set(body, { x: body.pos.x, y: body.pos.y, z: body.pos.z });
    }
    this.physics.integrateLeapfrog(this.state.bodies, this.G, dt, this.softening);
    for (const body of this.state.bodies) {
      if (body.stationary) {
        const pos = pinnedPositions.get(body);
        body.pos.x = pos.x; body.pos.y = pos.y; body.pos.z = pos.z;
        body.vel.x = 0; body.vel.y = 0; body.vel.z = 0;
      }
    }
    this.state.time += dt;
    this.state.recordState(this.state.time);
  }

  _updateCamera(dt) {
    if (this._selectLock && this._selectedBody >= 0 && this._selectedBody < this.state.bodies.length) {
      const body = this.state.bodies[this._selectedBody];
      if (this._cameraAnim) {
        this._cameraAnim.toX = body.pos.x; this._cameraAnim.toY = body.pos.y;
        this._cameraAnim.t += dt;
        const frac = Math.min(1, this._cameraAnim.t / this._cameraAnim.duration);
        this.renderer.offsetX = this._cameraAnim.fromX + (this._cameraAnim.toX - this._cameraAnim.fromX) * frac + (this._lockShiftX||0);
        this.renderer.offsetY = this._cameraAnim.fromY + (this._cameraAnim.toY - this._cameraAnim.fromY) * frac;
        if (frac >= 1) this._cameraAnim = null;
      } else {
        this.renderer.offsetX = body.pos.x + (this._lockShiftX||0);
        this.renderer.offsetY = body.pos.y;
      }
    }
  }

  _refreshMassSliders() {
    const c = document.getElementById('massControls');
    if (!c) return; c.innerHTML = '';
    c.appendChild(bodyMassSliders(this.state.bodies, (i,v)=>this.setMass(i,v), i=>this.removeBody(i)));
  }

  _setupCanvas() {
    const c = this.renderer.canvas;
    let clickStartX=0, clickStartY=0, clickDown=false, mousedownBody=null;
    this._velDrag = false;
    c.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      clickDown = true; const r = c.getBoundingClientRect();
      clickStartX = e.clientX - r.left; clickStartY = e.clientY - r.top;
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      mousedownBody = null;
      for (let i = this.state.bodies.length-1; i>=0; i--) {
        const s = this.renderer.worldToScreen(this.state.bodies[i].pos);
        const dx = mx - s.x, dy = my - s.y;
        const rad = Math.max(5, Math.min(30, 4*Math.pow(this.state.bodies[i].mass,1/3)));
        if (dx*dx + dy*dy < Math.pow(Math.max(20,rad+10),2)) { mousedownBody=i; break; }
      }
      this._panState = { x: mx, y: my }; this._velDrag = false; c.style.cursor='grab';
    });
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (clickDown && (Math.abs(mx-clickStartX)>4||Math.abs(my-clickStartY)>4)) {
        clickDown = false;
        if (mousedownBody===null && this.renderer.hitTestArrow(clickStartX, clickStartY)) { this._velDrag=true; c.style.cursor='crosshair'; this.pause(); return; }
        if (mousedownBody!==null) { this._dragBody=mousedownBody; this.pause(); this._dragStart={mx:clickStartX,my:clickStartY,pos:{...this.state.bodies[mousedownBody].pos}}; c.style.cursor='grabbing'; return; }
        // Reaching here = plain pan on empty canvas → unlock camera
        this._selectLock = false;
      }
      if (this._velDrag) {
        const body = this.state.bodies[this._selectedBody];
        const s = this.renderer.worldToScreen(body.pos);
        const dwx=mx-s.x, dwy=-(my-s.y), dist=Math.sqrt(dwx*dwx+dwy*dwy);
        if (dist>1) { const sp=mag(body.vel); body.vel.x=dwx/dist*sp; body.vel.y=dwy/dist*sp; }
        return;
      }
      if (this._dragBody!==null) {
        const dWx=(mx-this._dragStart.mx)/this.renderer.zoom, dWy=-(my-this._dragStart.my)/this.renderer.zoom;
        this.state.bodies[this._dragBody].pos.x=this._dragStart.pos.x+dWx;
        this.state.bodies[this._dragBody].pos.y=this._dragStart.pos.y+dWy;
        this.state.history[this._dragBody]=[{...this.state.bodies[this._dragBody].pos}]; return;
      }
      if (this._panState) { this.renderer.pan(mx-this._panState.x, my-this._panState.y); this._panState.x=mx; this._panState.y=my; }
    });
    const end = e => {
      if (this._velDrag) { this._velDrag=false; clickDown=false; clickStartX=0; clickStartY=0; }
      if (clickDown && e.button===0) {
        clickDown=false;
        const panel = document.getElementById('bodyInfoPanel');
        if (panel && panel.contains(e.target)) return;
        // Always deselect on canvas click (no extra click needed)
        this._deselectBody();
        if (mousedownBody!==null) this._selectBody(mousedownBody);
      }
      clickDown=false; if (this._dragBody!==null) { this._dragBody=null; this.state.clearHistory(); }
      this._panState=null; c.style.cursor='grab'; mousedownBody=null;
    };
    c.addEventListener('mouseup', end); c.addEventListener('mouseleave', end);
    c.addEventListener('wheel', e => { e.preventDefault(); this.renderer.zoomAt(e.deltaY<0?1.1:1/1.1); }, {passive:false});
    c.addEventListener('contextmenu', e => {
      e.preventDefault(); const r=c.getBoundingClientRect();
      this.addBody(this.renderer.screenToWorld(e.clientX-r.left, e.clientY-r.top));
    });
  }

  _calcBodyUEff(index) {
    const bodies=this.state.bodies, body=bodies[index], eps=1e-10;
    let comX=0, comY=0, totalMass=0;
    for (const b of bodies) totalMass+=b.mass;
    if (totalMass<=0) return {U_eff:0,U_grav:0,U_cent:0,L:0,R:0};
    for (const b of bodies) { comX+=b.mass*b.pos.x/totalMass; comY+=b.mass*b.pos.y/totalMass; }
    const Rx=body.pos.x-comX, Ry=body.pos.y-comY, R=Math.sqrt(Rx*Rx+Ry*Ry);
    const L_scalar=body.mass*(Rx*body.vel.y-Ry*body.vel.x);
    let U_grav=0;
    for (let j=0;j<bodies.length;j++) {
      if (j===index) continue;
      const dx=body.pos.x-bodies[j].pos.x, dy=body.pos.y-bodies[j].pos.y;
      U_grav-=this.G*body.mass*bodies[j].mass/Math.max(Math.sqrt(dx*dx+dy*dy),eps);
    }
    let U_cent=0;
    if (R>eps) U_cent=(L_scalar*L_scalar)/(2*body.mass*R*R);
    return {U_eff:U_grav+U_cent,U_grav,U_cent,L:L_scalar,R};
  }

  _calcBodyPotential(index) { return this._calcBodyUEff(index).U_grav; }

  _calcSystemUEff() {
    const bodies=this.state.bodies, eps=1e-10;
    if (bodies.length===0) return 0;
    let U_total=0;
    for (let i=0;i<bodies.length;i++) for (let j=i+1;j<bodies.length;j++) {
      const dx=bodies[i].pos.x-bodies[j].pos.x, dy=bodies[i].pos.y-bodies[j].pos.y;
      U_total-=this.G*bodies[i].mass*bodies[j].mass/Math.max(Math.sqrt(dx*dx+dy*dy),eps);
    }
    let L_total=0; for (const b of bodies) L_total+=b.mass*(b.pos.x*b.vel.y-b.pos.y*b.vel.x);
    let comX=0,comY=0,totalMass=0; for (const b of bodies) totalMass+=b.mass;
    if (totalMass<=0) return 0;
    for (const b of bodies) { comX+=b.mass*b.pos.x/totalMass; comY+=b.mass*b.pos.y/totalMass; }
    let I=0; for (const b of bodies) { const Rx=b.pos.x-comX,Ry=b.pos.y-comY; I+=b.mass*(Rx*Rx+Ry*Ry); }
    let U_cent_sys=0; if (I>eps) U_cent_sys=(L_total*L_total)/(2*I);
    return U_total+U_cent_sys;
  }

  _getRollingRange(values) {
    const now=this.state.time;
    if (now-this._lastResetTime>=5) { this._ueffHistory=[]; this._lastResetTime=now; }
    this._ueffHistory.push({time:now,values:[...values]});
    while (this._ueffHistory.length>600) this._ueffHistory.shift();
    if (this._ueffHistory.length===0) { const m=Math.min(...values); const mr=Math.min(0,m); return {bottom:mr<0?mr*1.1:-1,top:0}; }
    let rollingMin=Infinity;
    for (const e of this._ueffHistory) for (const v of e.values) if (v<rollingMin) rollingMin=v;
    const minR=Math.min(0,rollingMin);
    return {bottom:minR<0?minR*1.1:-1,top:0};
  }

  _drawBarGraph() {
    const ctx=this.barCtx, canvas=this.barCanvas;
    if (!ctx||!canvas) return;
    const bodies=this.state.bodies;
    if (bodies.length===0) return;
    const FIXED_BAR_W=48, ROW_HEIGHT=172, margin={top:34,bottom:10,left:34,right:8};
    const rect=canvas.parentElement.getBoundingClientRect();
    const wCSS=rect.width;
    if (wCSS<=0||rect.height<=0) return;
    const plotW=wCSS-margin.left-margin.right;
    const maxPerRow=Math.max(1,Math.floor(plotW/FIXED_BAR_W));
    const rows=Math.max(1,Math.ceil(bodies.length/maxPerRow));
    const totalHeight=ROW_HEIGHT*rows;
    canvas.width=wCSS*window.devicePixelRatio;
    canvas.height=totalHeight*window.devicePixelRatio;
    canvas.style.height=totalHeight+'px';
    ctx.setTransform(window.devicePixelRatio,0,0,window.devicePixelRatio,0,0);
    const w=wCSS, h=totalHeight;
    if (w<=0||h<=0) return;
    const values=bodies.map((_,i)=>this._calcBodyPotential(i));
    const {bottom,top}=this._getRollingRange(values);
    const range=Math.max(1e-6,top-bottom);
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='rgba(10,10,20,1)'; ctx.fillRect(0,0,w,h);
    const rowPlotH=ROW_HEIGHT-44;
    for (let row=0;row<rows;row++) {
      const rowOffset=row*ROW_HEIGHT;
      const rowBodies=bodies.slice(row*maxPerRow,(row+1)*maxPerRow);
      const rowValues=values.slice(row*maxPerRow,(row+1)*maxPerRow);
      if (rowBodies.length===0) continue;
      const yForU=u=>rowOffset+20+(1-u/bottom)*rowPlotH;
      const yZero=yForU(0);
      ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
      for (let t=0;t<=4;t++) { const y=rowOffset+20+(rowPlotH*t)/4; ctx.beginPath(); ctx.moveTo(margin.left,y); ctx.lineTo(margin.left+maxPerRow*FIXED_BAR_W,y); ctx.stroke(); }
      ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.setLineDash([4,6]);
      ctx.beginPath(); ctx.moveTo(margin.left,yZero); ctx.lineTo(margin.left+maxPerRow*FIXED_BAR_W,yZero); ctx.stroke(); ctx.setLineDash([]);
      for (let b=0;b<rowBodies.length;b++) {
        const idx=row*maxPerRow+b, U=rowValues[b];
        const x=margin.left+b*FIXED_BAR_W, y=yForU(U), barH=yZero-y, barInnerW=FIXED_BAR_W-6;
        ctx.fillStyle=rowBodies[b].color;
        if (barH>0) ctx.fillRect(x+3,y,barInnerW,barH);
        if (idx===this._selectedBody) { ctx.strokeStyle='#ffd700'; ctx.lineWidth=2; ctx.strokeRect(x+1,y-2,barInnerW+4,barH+4); ctx.lineWidth=1; }
        ctx.fillStyle='#ffffff'; ctx.font='8px Inter,sans-serif'; ctx.textAlign='center';
        ctx.fillText(formatNum(U,1),x+FIXED_BAR_W/2,y-4);
        ctx.fillStyle=rowBodies[b].color; ctx.font='bold 9px Inter,sans-serif';
        ctx.fillText(rowBodies[b].label||`Body ${idx+1}`,x+FIXED_BAR_W/2,rowOffset+ROW_HEIGHT-5);
      }
      if (row===0) {
        ctx.fillStyle='#cacaca'; ctx.font='9px Inter,sans-serif'; ctx.textAlign='left';
        ctx.fillText('U_grav per body (J)',margin.left,12); ctx.textAlign='right';
        ctx.fillText(`selected: ${bodies[this._selectedBody]?.label||`Body ${this._selectedBody+1}`}`,w-margin.right,12);
      }
      ctx.fillStyle='#888'; ctx.textAlign='right'; ctx.font='8px Inter,sans-serif';
      for (let t=0;t<=4;t++) { const val=bottom+(range*t)/4; const y=rowOffset+20+(t/4)*rowPlotH; ctx.fillText(formatNum(val,1),margin.left-4,y+3); }
    }
  }

  _fmt(v,d=2) { const a=Math.abs(v); if (a===0) return '0'; if (a>=1e6||(a<0.01&&a>0)) return v.toExponential(d); return v.toFixed(d); }

  _loop() {
    if (this.isRunning) { this._step(); this._step(); }
    const com = this.physics.computeCenterOfMass(this.state.bodies);
    if (this._comLockEnabled && !this._selectLock) { this.renderer.offsetX = com.x + (this._lockShiftX||0); this.renderer.offsetY = com.y; }
    this._updateCamera(this.isRunning ? this.dt*this.speed : 0.016);
    this.renderer.render(this.state.bodies, this.state.history, com, this._selectLock ? this._selectedBody : -1, this.state.time);
    document.getElementById('dTime').textContent = this.state.time.toExponential(2)+' s';
    const bodies = this.state.bodies;
    for (let i=0; i<bodies.length; i++) { const el=document.getElementById(`dBody${i}`); if (el) el.textContent=`U_grav=${formatNum(this._calcBodyPotential(i),2)} J`; }
    document.getElementById('dEnergy').textContent = formatNum(this.physics.computeTotalEnergy(bodies,this.G,this.softening),2)+' J';
    document.getElementById('dAngMom').textContent = formatNum(mag(this.physics.computeAngularMomentum(bodies)),2);
    document.getElementById('dSysUEff').textContent = formatNum(this._calcSystemUEff(),2)+' J';
    if (this._selectedBody>=0 && this._selectedBody<bodies.length) {
      const body=bodies[this._selectedBody];
      document.getElementById('panelPx') && (document.getElementById('panelPx').textContent=this._fmt(body.pos.x));
      document.getElementById('panelPy') && (document.getElementById('panelPy').textContent=this._fmt(body.pos.y));
      const vx=document.getElementById('panelVx'); if (vx && document.activeElement!==vx) vx.textContent=this._fmt(body.vel.x);
      const vy=document.getElementById('panelVy'); if (vy && document.activeElement!==vy) vy.textContent=this._fmt(body.vel.y);
      document.getElementById('panelSpeed') && (document.getElementById('panelSpeed').textContent=this._fmt(mag(body.vel)));
      const ue=this._calcBodyUEff(this._selectedBody);
      document.getElementById('panelUeff') && (document.getElementById('panelUeff').textContent=this._fmt(ue.U_eff));
      document.getElementById('panelUgrav') && (document.getElementById('panelUgrav').textContent=this._fmt(ue.U_grav));
      document.getElementById('panelUcent') && (document.getElementById('panelUcent').textContent=this._fmt(ue.U_cent));
      document.getElementById('panelL') && (document.getElementById('panelL').textContent=this._fmt(ue.L));
      document.getElementById('panelR') && (document.getElementById('panelR').textContent=this._fmt(ue.R));
    }
    if (this._surface3D && bodies.length>=3 && this._selectedBody>=0 && this._selectedBody<bodies.length) {
      const target=bodies[this._selectedBody];
      const otherA=bodies[(this._selectedBody+1)%bodies.length], otherB=bodies[(this._selectedBody+2)%bodies.length];
      this._updateSurface(mag(sub(target.pos,otherA.pos)), mag(sub(target.pos,otherB.pos)), this._calcBodyPotential(this._selectedBody));
    }
    this._drawBarGraph();
    requestAnimationFrame(() => this._loop());
  }
}

document.addEventListener('DOMContentLoaded', () => { new ThreeBodyUeffSim(); });