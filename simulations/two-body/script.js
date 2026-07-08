/**
 * script.js — N-Body Problem Simulation
 * Uses shared controls from js/ui/controls.js
 */

import { PhysicsEngine } from '../../js/core/physics-engine.js';
import { StateManager } from '../../js/core/state-manager.js';
import { CanvasRenderer } from '../../js/renderer/canvas-renderer.js';
import { vec, mag, sub, dot, cross, formatNum } from '../../js/core/math-utils.js';
import { transport, GSlider, speedSlider, softeningSlider, trailToggle, camera, comLock, bodyMassSliders, bodyDataDisplay, infoText, dataBarToggle } from '../../js/ui/controls.js';
import { injectShortcutLegend } from '../../js/ui/shortcut-legend.js';

/**
 * Create the default three bodies in an equilateral triangle.
 * @param {StateManager} state
 * @returns {Object} Saved initial state snapshot
 */
function initDefaultPreset(state) {
  state.bodies = [];
  state.history = [];
  state.time = 0;

  const mass = 100;
  const positions = [
    vec(0, 1, 0),
    vec(2, 1, 0)
  ];
  const velocities = [
    vec(0, 0, 0),
    vec(0, 0, 0)
  
  ];

  const names = ['Alpha', 'Beta'];
  const colors = ['#ff4444', '#44ff88',];

  for (let i = 0; i < 2; i++) {
    state.addBody(names[i], mass, positions[i], velocities[i], colors[i]);
  }

  return state.saveState();
}

class NBodySim {
  constructor() {
    this.physics = new PhysicsEngine();
    this.state = new StateManager();
    const canvas = document.getElementById('simCanvas');
    this.renderer = new CanvasRenderer(canvas);

    this.isRunning = false;
    this.speed = 1.0;
    this.G = 60;
    this.dt = 0.005;
    this.softening = 0.01;
    this._initialState = null;
    this._panState = null;
    this._dragBody = null;
    this._comLockEnabled = false;
    this._selectedBody = -1;
    this._selectLock = false;
    this._cameraAnim = null;
    this._isMobile = false;

    window._sim = this; // expose for panel button onclick handlers
    this._detectMobile();
    this._buildSidebar();
    this._initDefaultState();
    this._setupCanvas();
    this._setupSidebarToggle();
    this._loop();
  }

  _detectMobile() {
    this._isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    // Show the mobile Add Body button
    const addBtn = document.getElementById('mobileAddBtn');
    if (addBtn && this._isMobile) {
      addBtn.style.display = 'flex';
      addBtn.addEventListener('click', () => {
        // Add body at center of current viewport
        const cx = this.renderer.width / 2;
        const cy = this.renderer.height / 2;
        const world = this.renderer.screenToWorld(cx, cy);
        this.addBody(vec(world.x, world.y, 0));
      });
    }
  }

  _setupSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.querySelector('.sim-controls');
    const arrow = document.getElementById('sidebarToggleArrow');
    if (!toggleBtn || !sidebar) return;
    let collapsed = false;
    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
      if (arrow) {
        arrow.textContent = collapsed ? '▶' : '▼';
      }
      toggleBtn.innerHTML = collapsed ? '☰ Controls <span id="sidebarToggleArrow">▶</span>' : '☰ Controls <span id="sidebarToggleArrow">▼</span>';
      // Re-acquire arrow reference since innerHTML changed it
      const newArrow = document.getElementById('sidebarToggleArrow');
      if (newArrow && collapsed) newArrow.textContent = '▶';
      else if (newArrow) newArrow.textContent = '▼';
    });
  }

  _initDefaultState() {
    this._initialState = initDefaultPreset(this.state);
    this._refreshMassSliders();
    bodyDataDisplay(this.state.bodies);
    this.renderer.zoomToFit(this.state.bodies, 0.85);
    this._selectedBody = -1;
    this._selectLock = false;
  }

  _buildSidebar() {
    const sb = document.querySelector('.sim-controls');
    sb.appendChild(transport(this));
    sb.appendChild(GSlider(v => { this.G = v; }));
    sb.appendChild(speedSlider(v => { this.speed = v; }));
    sb.appendChild(softeningSlider(v => { this.softening = v; }));
    sb.appendChild(infoText(this._isMobile ? 'Tap + button to add body · × on slider to remove' : 'Right-click canvas to add body · × on slider to remove'));
    sb.appendChild(trailToggle(v => { this.renderer.showTrails = v; }));

    // Masses
    const m = document.createElement('div');
    m.className = 'control-group';
    m.appendChild(document.createElement('h3')).textContent = 'Masses';
    this._massControls = document.createElement('div');
    this._massControls.id = 'massControls';
    m.appendChild(this._massControls);
    sb.appendChild(m);

    // Camera + COM lock
    const cam = camera(this.renderer, () => {
      this.renderer.zoomToFit(this.state.bodies, 0.85);
    });
    cam.appendChild(comLock(v => { this._comLockEnabled = v; }));
    sb.appendChild(cam);

    // Display: data bar toggle
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
    this._selectedBody = -1;
    this._selectLock = false;
    const panel = document.getElementById('bodyInfoPanel');
    if (panel) panel.style.display = 'none';
  }

  step() { this._step(); }

  /** Select a body by index: start smooth camera animation to centre on it. Does NOT pause simulation. */
  _selectBody(index) {
    if (index < 0 || index >= this.state.bodies.length) return;
    this._selectedBody = index;
    this._selectLock = true;
    const body = this.state.bodies[index];
    // Start smooth camera animation
    const dx = body.pos.x - this.renderer.offsetX;
    const dy = body.pos.y - this.renderer.offsetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.max(0.1, Math.min(0.2, dist * 0.15));
    this._cameraAnim = {
      fromX: this.renderer.offsetX,
      fromY: this.renderer.offsetY,
      toX: body.pos.x,
      toY: body.pos.y,
      t: 0,
      duration: duration
    };
    // Build panel structure once (buttons are stable, values updated by ID each frame)
    const panel = document.getElementById('bodyInfoPanel');
    if (panel) {
      panel.innerHTML = `<div style="color:${body.color};font-weight:600;font-size:0.9rem;margin-bottom:4px;" id="panelLabel">${body.label}</div>
<div style="font-variant-numeric:tabular-nums;">Pos: (<span id="panelPx" style="display:inline-block;min-width:7ch;text-align:right;">${this._fmt(body.pos.x)}</span>, <span id="panelPy" style="display:inline-block;min-width:7ch;text-align:right;">${this._fmt(body.pos.y)}</span>)</div>
<div style="font-variant-numeric:tabular-nums;">Vel: (<span id="panelVx" contenteditable="true" data-axis="x" style="display:inline-block;min-width:7ch;text-align:right;cursor:text;border-bottom:1px dashed rgba(255,255,255,0.2);" title="Click to edit">${this._fmt(body.vel.x)}</span>, <span id="panelVy" contenteditable="true" data-axis="y" style="display:inline-block;min-width:7ch;text-align:right;cursor:text;border-bottom:1px dashed rgba(255,255,255,0.2);" title="Click to edit">${this._fmt(body.vel.y)}</span>)</div>
<div>Speed: <span id="panelSpeed" style="font-variant-numeric:tabular-nums;">${this._fmt(mag(body.vel))}</span> km/s</div>
<div style="margin-top:8px;display:flex;gap:8px;">
  <button onclick="window._sim._makeStationary()" style="background:var(--accent);color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem;min-height:32px;">⏸ Stationary</button>
  <button onclick="window._sim.removeBody(window._sim._selectedBody);window._sim._deselectBody()" style="background:#ff4444;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem;min-height:32px;">✕ Delete</button>
</div>`;
      // Set up blur handler to commit velocity edits
      const vxEl = document.getElementById('panelVx');
      const vyEl = document.getElementById('panelVy');
      const commitVel = (el) => {
        const val = parseFloat(el.textContent);
        const axis = el.getAttribute('data-axis');
        if (!isNaN(val) && this._selectedBody >= 0 && this._selectedBody < this.state.bodies.length) {
          this.state.bodies[this._selectedBody].vel[axis] = val;
        }
      };
      const onBlur = (e) => commitVel(e.target);
      const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
      if (vxEl) { vxEl.addEventListener('blur', onBlur); vxEl.addEventListener('keydown', onKey); }
      if (vyEl) { vyEl.addEventListener('blur', onBlur); vyEl.addEventListener('keydown', onKey); }
      panel.style.display = 'block';
    }
  }

  /** Deselect the currently selected body, return camera to free mode */
  _deselectBody() {
    this._selectedBody = -1;
    this._selectLock = false;
    const panel = document.getElementById('bodyInfoPanel');
    if (panel) panel.style.display = 'none';
  }

  /** Toggle stationary lock on selected body (velocity forced to 0 each frame) */
  _makeStationary() {
    if (this._selectedBody < 0 || this._selectedBody >= this.state.bodies.length) return;
    const body = this.state.bodies[this._selectedBody];
    body.stationary = !body.stationary;
    if (body.stationary) body.vel = vec(0, 0, 0);
  }

  setMass(i, m) {
    const bodies = this.state.bodies;
    const oldMass = bodies[i].mass;
    m = Math.max(0.001, m);
    if (Math.abs(oldMass - m) < 1e-12) { this.state.setMass(i, m); return; }
    this.state.setMass(i, m);
    const k = Math.sqrt(oldMass / m);
    bodies[i].vel.x *= k; bodies[i].vel.y *= k; bodies[i].vel.z *= k;
  }

  addBody(worldPos, mass = 1000) {
    const count = this.state.bodies.length;
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
    const name = names[count] || `Body ${count + 1}`;
    const colors = ['#ff4444', '#4488ff', '#44ff88', '#ffaa00', '#ff44ff', '#44ffff', '#ff8844', '#88ff44', '#ff4488', '#44aaff'];
    const color = colors[count % colors.length];
    const idx = this.state.addBody(name, mass, worldPos, vec(0, 0, 0), color);
    if (this._initialState) {
      const s = this.state.saveState();
      s.bodies[idx].vel = vec(0, 0, 0);
      this._initialState = s;
    }
    this._refreshMassSliders();
    bodyDataDisplay(this.state.bodies);
    return idx;
  }

  removeBody(index) {
    if (this.state.bodies.length <= 1) return;
    this.state.removeBody(index);
    this._initialState = this.state.saveState();
    this._refreshMassSliders();
    bodyDataDisplay(this.state.bodies);
  }

  /** Ease-in-out cubic: t from 0→1, returns eased value (slow→fast→slow) */
  _easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  _step() {
    const dt = this.dt * this.speed;
    // Save positions of stationary bodies before physics
    const pinnedPositions = new Map();
    for (const body of this.state.bodies) {
      if (body.stationary) {
        pinnedPositions.set(body, { x: body.pos.x, y: body.pos.y, z: body.pos.z });
      }
    }
    this.physics.integrateLeapfrog(this.state.bodies, this.G, dt, this.softening);
    // Restore stationary bodies to their pinned positions and zero velocity
    for (const body of this.state.bodies) {
      if (body.stationary) {
        const pos = pinnedPositions.get(body);
        body.pos.x = pos.x;
        body.pos.y = pos.y;
        body.pos.z = pos.z;
        body.vel.x = 0;
        body.vel.y = 0;
        body.vel.z = 0;
      }
    }
    this.state.time += dt;
    this.state.recordState(this.state.time);
  }

  /** Update camera to follow selected body (called every frame, even when paused) */
  _updateCamera(dt) {
    if (this._selectLock && this._selectedBody >= 0 && this._selectedBody < this.state.bodies.length) {
      const body = this.state.bodies[this._selectedBody];
      if (this._cameraAnim) {
        this._cameraAnim.toX = body.pos.x;
        this._cameraAnim.toY = body.pos.y;
        this._cameraAnim.t += dt;
        const frac = Math.min(1, this._cameraAnim.t / this._cameraAnim.duration);
        this.renderer.offsetX = this._cameraAnim.fromX + (this._cameraAnim.toX - this._cameraAnim.fromX) * frac;
        this.renderer.offsetY = this._cameraAnim.fromY + (this._cameraAnim.toY - this._cameraAnim.fromY) * frac;
        if (frac >= 1) {
          this._cameraAnim = null;
        }
      } else {
        this.renderer.offsetX = body.pos.x;
        this.renderer.offsetY = body.pos.y;
      }
    }
  }

  _refreshMassSliders() {
    const c = document.getElementById('massControls');
    if (!c) return;
    c.innerHTML = '';
    c.appendChild(bodyMassSliders(this.state.bodies, (i, v) => this.setMass(i, v), i => this.removeBody(i)));
  }

  /** Hit-test a body at screen coordinates, returning its index or null */
  _hitTestBody(sx, sy) {
    for (let i = this.state.bodies.length - 1; i >= 0; i--) {
      const s = this.renderer.worldToScreen(this.state.bodies[i].pos);
      const dx = sx - s.x, dy = sy - s.y;
      const rad = Math.max(5, Math.min(30, 4 * Math.pow(this.state.bodies[i].mass, 1 / 3)));
      if (dx * dx + dy * dy < (Math.max(20, rad + 10)) ** 2) {
        return i;
      }
    }
    return null;
  }

  _setupCanvas() {
    const c = this.renderer.canvas;
    let clickStartX = 0, clickStartY = 0, clickDown = false;
    let mousedownBody = null;
    this._velDrag = false;
    // Track touch IDs for multi-touch pinch zoom
    this._touchState = { pinchDist: 0, touch1: null, touch2: null, longPressTimer: null, longPressFired: false };

    // ---- MOUSE EVENTS ----
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      clickDown = true;
      const r = c.getBoundingClientRect();
      clickStartX = e.clientX - r.left;
      clickStartY = e.clientY - r.top;
      const mx = e.clientX - r.left, my = e.clientY - r.top;

      mousedownBody = this._hitTestBody(mx, my);
      this._panState = { x: mx, y: my };
      this._velDrag = false;
      c.style.cursor = 'grab';
    };

    const onMouseMove = (e) => {
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      // Detect if mouse moved enough to be a drag, not a click
      if (clickDown && (Math.abs(mx - clickStartX) > 4 || Math.abs(my - clickStartY) > 4)) {
        clickDown = false;
        // Start velocity vector drag only if user clicked directly on the arrow
        if (mousedownBody === null && this.renderer.hitTestArrow(clickStartX, clickStartY)) {
          this._velDrag = true;
          c.style.cursor = 'crosshair';
          this.pause();
          return;
        }
        // Start position drag if we hit a body
        if (mousedownBody !== null) {
          this._dragBody = mousedownBody;
          this.pause();
          this._dragStart = { mx: clickStartX, my: clickStartY, pos: { ...this.state.bodies[mousedownBody].pos } };
          c.style.cursor = 'grabbing';
          return;
        }
        // Reaching here = plain pan on empty canvas → unlock camera
        this._selectLock = false;
      }
      // Handle velocity vector drag
      if (this._velDrag) {
        const body = this.state.bodies[this._selectedBody];
        const bodyScreen = this.renderer.worldToScreen(body.pos);
        const dwx = mx - bodyScreen.x;
        const dwy = -(my - bodyScreen.y);
        const dist = Math.sqrt(dwx * dwx + dwy * dwy);
        if (dist > 1) {
          const currentSpeed = mag(body.vel);
          const nx = dwx / dist;
          const ny = dwy / dist;
          body.vel.x = nx * currentSpeed;
          body.vel.y = ny * currentSpeed;
        }
        return;
      }
      if (this._dragBody !== null) {
        const dWx = (mx - this._dragStart.mx) / this.renderer.zoom;
        const dWy = -(my - this._dragStart.my) / this.renderer.zoom;
        this.state.bodies[this._dragBody].pos.x = this._dragStart.pos.x + dWx;
        this.state.bodies[this._dragBody].pos.y = this._dragStart.pos.y + dWy;
        this.state.history[this._dragBody] = [{ ...this.state.bodies[this._dragBody].pos }];
        return;
      }
      if (this._panState) {
        this.renderer.pan(mx - this._panState.x, my - this._panState.y);
        this._panState.x = mx; this._panState.y = my;
      }
    };

    const end = (e) => {
      if (this._velDrag) {
        this._velDrag = false;
        clickDown = false;
        clickStartX = 0; clickStartY = 0;
      }
      // Check if this was a click (not a drag)
      if (clickDown && e.button === 0) {
        clickDown = false;
        const panel = document.getElementById('bodyInfoPanel');
        if (panel && panel.contains(e.target)) return;
        if (mousedownBody !== null) {
          this._selectBody(mousedownBody);
        } else {
          this._deselectBody();
        }
      }
      clickDown = false;
      if (this._dragBody !== null) {
        this._dragBody = null;
        this.state.clearHistory();
      }
      this._panState = null;
      c.style.cursor = 'grab';
      mousedownBody = null;
    };

    c.addEventListener('mousedown', onMouseDown);
    c.addEventListener('mousemove', onMouseMove);
    c.addEventListener('mouseup', end);
    c.addEventListener('mouseleave', end);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.renderer.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const world = this.renderer.screenToWorld(mx, my);
      this.addBody(vec(world.x, world.y, 0));
    });

    // ---- TOUCH EVENTS ----
    if (this._isMobile) {
      const ts = this._touchState;

      c.addEventListener('touchstart', e => {
        e.preventDefault();
        const touches = e.touches;

        // Clear any pending long-press
        if (ts.longPressTimer) { clearTimeout(ts.longPressTimer); ts.longPressTimer = null; }
        ts.longPressFired = false;

        if (touches.length === 1) {
          // Single finger: start drag/click detection
          const r = c.getBoundingClientRect();
          const mx = touches[0].clientX - r.left;
          const my = touches[0].clientY - r.top;
          ts.touch1 = touches[0].identifier;
          clickStartX = mx;
          clickStartY = my;
          clickDown = true;
          mousedownBody = this._hitTestBody(mx, my);
          this._panState = { x: mx, y: my };
          this._velDrag = false;

          // Long-press timer (800ms) to add body (replacement for right-click)
          const ctx = { mx, my };
          ts.longPressTimer = setTimeout(() => {
            ts.longPressFired = true;
            clickDown = false;
            this._panState = null;
            const world = this.renderer.screenToWorld(ctx.mx, ctx.my);
            this.addBody(vec(world.x, world.y, 0));
            // Brief haptic feedback if available
            if (navigator.vibrate) navigator.vibrate(10);
          }, 800);

        } else if (touches.length === 2) {
          // Two fingers: pinch zoom
          clickDown = false;
          if (ts.longPressTimer) { clearTimeout(ts.longPressTimer); ts.longPressTimer = null; }
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
          // Pinch zoom
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

        if (touches.length === 1) {
          const r = c.getBoundingClientRect();
          const mx = touches[0].clientX - r.left;
          const my = touches[0].clientY - r.top;

          // Check for long-press cancellation (moved too much)
          if (ts.longPressTimer && (Math.abs(mx - clickStartX) > 10 || Math.abs(my - clickStartY) > 10)) {
            clearTimeout(ts.longPressTimer);
            ts.longPressTimer = null;
          }

          // Detect if moved enough to be a drag, not a tap
          if (clickDown && (Math.abs(mx - clickStartX) > 8 || Math.abs(my - clickStartY) > 8)) {
            clickDown = false;
            if (ts.longPressTimer) { clearTimeout(ts.longPressTimer); ts.longPressTimer = null; }
            // Start position drag if we hit a body
            if (mousedownBody !== null) {
              this._dragBody = mousedownBody;
              this.pause();
              this._dragStart = { mx: clickStartX, my: clickStartY, pos: { ...this.state.bodies[mousedownBody].pos } };
              return;
            }
            // Plain pan → unlock camera
            this._selectLock = false;
          }

          // Handle body position drag
          if (this._dragBody !== null) {
            const dWx = (mx - this._dragStart.mx) / this.renderer.zoom;
            const dWy = -(my - this._dragStart.my) / this.renderer.zoom;
            this.state.bodies[this._dragBody].pos.x = this._dragStart.pos.x + dWx;
            this.state.bodies[this._dragBody].pos.y = this._dragStart.pos.y + dWy;
            this.state.history[this._dragBody] = [{ ...this.state.bodies[this._dragBody].pos }];
            return;
          }

          // Pan
          if (this._panState) {
            this.renderer.pan(mx - this._panState.x, my - this._panState.y);
            this._panState.x = mx; this._panState.y = my;
          }
        }
      }, { passive: false });

      c.addEventListener('touchend', e => {
        e.preventDefault();
        // Clear long-press timer
        if (ts.longPressTimer) { clearTimeout(ts.longPressTimer); ts.longPressTimer = null; }
        if (ts.longPressFired) {
          ts.longPressFired = false;
          clickDown = false;
          return;
        }

        if (ts.pinchDist > 0) {
          // Pinch ended
          ts.pinchDist = 0;
          ts.touch1 = null;
          ts.touch2 = null;
          return;
        }

        // Check if this was a single tap (not a drag)
        if (clickDown) {
          clickDown = false;
          const panel = document.getElementById('bodyInfoPanel');
          const target = e.target || document.elementFromPoint(
            (e.changedTouches[0] || {}).clientX,
            (e.changedTouches[0] || {}).clientY
          );
          if (panel && panel.contains(target)) return;
          if (mousedownBody !== null) {
            this._selectBody(mousedownBody);
          } else {
            this._deselectBody();
          }
        }

        if (this._dragBody !== null) {
          this._dragBody = null;
          this.state.clearHistory();
        }
        this._panState = null;
        mousedownBody = null;
      }, { passive: false });

      c.addEventListener('touchcancel', e => {
        if (ts.longPressTimer) { clearTimeout(ts.longPressTimer); ts.longPressTimer = null; }
        ts.longPressFired = false;
        clickDown = false;
        if (this._dragBody !== null) {
          this._dragBody = null;
          this.state.clearHistory();
        }
        this._panState = null;
        ts.pinchDist = 0;
        mousedownBody = null;
      });
    }
  }

  _fmt(v, d = 2) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e6 || (a < 0.01 && a > 0)) return v.toExponential(d);
    return v.toFixed(d);
  }

  _loop() {
    if (this.isRunning) { this._step(); this._step(); }
    const com = this.physics.computeCenterOfMass(this.state.bodies);
    // Only apply COM lock if selection is NOT locked
    if (this._comLockEnabled && !this._selectLock) { this.renderer.offsetX = com.x; this.renderer.offsetY = com.y; }
    // Update camera follow every frame (even when paused)
    this._updateCamera(this.isRunning ? this.dt * this.speed : 0.016);
    this.renderer.render(this.state.bodies, this.state.history, com, this._selectLock ? this._selectedBody : -1, this.state.time);
    document.getElementById('dTime').textContent = this.state.time.toExponential(2) + ' s';
    const b = this.state.bodies;
    for (let i = 0; i < b.length; i++) {
      const el = document.getElementById(`dBody${i}`);
      if (el) el.textContent = `(${this._fmt(b[i].pos.x)}, ${this._fmt(b[i].pos.y)}) v ${mag(b[i].vel).toFixed(3)}`;
    }

    // Update floating info panel values (structure built once in _selectBody)
    if (this._selectedBody >= 0 && this._selectedBody < b.length) {
      const body = b[this._selectedBody];
      const px = document.getElementById('panelPx');
      if (px) { px.textContent = this._fmt(body.pos.x); }
      const py = document.getElementById('panelPy');
      if (py) { py.textContent = this._fmt(body.pos.y); }
      const vx = document.getElementById('panelVx');
      if (vx && document.activeElement !== vx) { vx.textContent = this._fmt(body.vel.x); }
      const vy = document.getElementById('panelVy');
      if (vy && document.activeElement !== vy) { vy.textContent = this._fmt(body.vel.y); }
      const spd = document.getElementById('panelSpeed');
      if (spd) { spd.textContent = this._fmt(mag(body.vel)); }
    }

    const E = this.physics.computeTotalEnergy(b, this.G, this.softening);
    document.getElementById('dEnergy').textContent = formatNum(E, 2) + ' J';
    document.getElementById('dAngMom').textContent = formatNum(mag(this.physics.computeAngularMomentum(b)), 2);
    requestAnimationFrame(() => this._loop());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new NBodySim();
  injectShortcutLegend([
    'Right-click canvas — Add body',
    'Drag a body — Reposition',
    'Scroll — Zoom',
  ]);
});
