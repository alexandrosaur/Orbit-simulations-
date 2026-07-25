/**
 * ueff-surface-3d.js — 3D U_grav(r₁, r₂) surface + trail for Three-Body Effective Potential
 *
 * Uses composition with the shared ThreeRenderer for camera/scene/orbit/resize/context-loss.
 * Adds Ueff-specific meshes: colour-coded surface, wireframe, gold marker + ring,
 * trail polyline, and dynamic axis labels/tick marks.
 *
 * All Three.js r158, imported from jsdelivr CDN (no build step).
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { ThreeRenderer } from '../../js/renderer/three-renderer.js';

export class UeffSurface3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @param {number} [options.RMIN=0.18]
   * @param {number} [options.RMAX=12]
   * @param {number} [options.GRID=60]
   * @param {number} [options.TRAIL_LEN=220]
   * @param {number} [options.Y_MIN=-3]
   * @param {number} [options.Y_MAX=6]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.opts = {
      RMIN:      options.RMIN      ?? 0.18,
      RMAX:      options.RMAX      ?? 12,
      GRID:      options.GRID      ?? 60,
      TRAIL_LEN: options.TRAIL_LEN ?? 220,
      Y_MIN:     options.Y_MIN     ?? -3,
      Y_MAX:     options.Y_MAX     ?? 6,
    };

    // ---- Composition: shared ThreeRenderer ----
    const pivotY = (this.opts.Y_MIN + this.opts.Y_MAX) / 2;
    this._renderer = new ThreeRenderer(canvas, {
      pivotX: 3,
      pivotY,
      pivotZ: 3,
      initialDistance: 23,
      initialAzimuth: 0.88,
      initialElevation: 0.69,
    });

    this._G = 60; this._mA = 1; this._mB = 1; this._mC = 1;
    this._nA = 'A'; this._nB = 'B'; this._nC = 'C';
    this._r1 = 2; this._r2 = 2;
    this._trailHead = 0; this._frame = 0;

    // Ueff rolling window (for Y-axis ticks)
    this._uHistory = [];
    this._uMin = -1000;
    this._uMax = -1;
    this._uRange = 1000;
    // r1 / r2 rolling windows (for X/Z axis ticks)
    this._r1History = [];
    this._r2History = [];
    this._r1Min = 0;
    this._r1Max = 12;
    this._r2Min = 0;
    this._r2Max = 12;
    // Grid surface geometry range (always covers full domain)
    this._gridUMin = -1000;
    this._gridUMax = -1;
    this._gridURange = 1000;
    this._surfBuiltUMin = -1000;
    this._surfBuiltUMax = -1;

    // Axes tracking
    this._axesLines = [];
    this._axesSprites = [];

    this._buildSurface();
    this._buildTrail();
    this._buildMarker();
    this._buildAxes();
  }

  // ---- Physics ----

  _computeU(r1, r2) {
    const u = -this._G * this._mA * this._mB / Math.max(r1, 1e-6)
            - this._G * this._mA * this._mC / Math.max(r2, 1e-6);
    return Math.min(0, u);
  }

  _uToWorldY(u) {
    const range = Math.max(1e-6, this._gridURange);
    const t = Math.max(0, Math.min(1, (u - this._gridUMin) / range));
    return this.opts.Y_MIN + t * (this.opts.Y_MAX - this.opts.Y_MIN);
  }

  _uToWorldYAxis(u) {
    const range = Math.max(1e-6, this._uRange);
    const t = Math.max(0, Math.min(1, (u - this._uMin) / range));
    return this.opts.Y_MIN + t * (this.opts.Y_MAX - this.opts.Y_MIN);
  }

  _rToWorldXOrZ(r, rMax) {
    return Math.max(0, r / Math.max(rMax, 1e-6)) * 6;
  }

  _updateURange(u) {
    const now = performance.now() / 1000;
    this._uHistory.push({ time: now, u });
    while (this._uHistory.length > 0 && now - this._uHistory[0].time > 10) this._uHistory.shift();
    while (this._uHistory.length > 600) this._uHistory.shift();

    if (this._uHistory.length === 0) {
      this._uMin = u < 0 ? u * 1.1 : u * 0.9;
      this._uMax = u < 0 ? u * 0.9 : u * 1.1;
    } else {
      let rMin = Infinity, rMax = -Infinity;
      for (const e of this._uHistory) {
        if (e.u < rMin) rMin = e.u;
        if (e.u > rMax) rMax = e.u;
      }
      this._uMin = rMin < 0 ? rMin * 1.1 : rMin * 0.9;
      this._uMax = rMax < 0 ? rMax * 0.9 : rMax * 1.1;
    }
    if (Math.abs(this._uMax - this._uMin) < 1) this._uMax = this._uMin + 1;
    this._uRange = this._uMax - this._uMin;
  }

  _updateRRange(r1, r2) {
    const now = performance.now() / 1000;
    this._r1History.push({ time: now, r: r1 });
    this._r2History.push({ time: now, r: r2 });
    while (this._r1History.length > 0 && now - this._r1History[0].time > 10) {
      this._r1History.shift();
      this._r2History.shift();
    }
    while (this._r1History.length > 600) { this._r1History.shift(); this._r2History.shift(); }

    if (this._r1History.length === 0) {
      this._r1Min = 0; this._r1Max = Math.max(12, r1 * 1.1);
      this._r2Min = 0; this._r2Max = Math.max(12, r2 * 1.1);
    } else {
      let r1Min = Infinity, r1Max = -Infinity;
      let r2Min = Infinity, r2Max = -Infinity;
      for (const e of this._r1History) {
        if (e.r < r1Min) r1Min = e.r;
        if (e.r > r1Max) r1Max = e.r;
      }
      for (const e of this._r2History) {
        if (e.r < r2Min) r2Min = e.r;
        if (e.r > r2Max) r2Max = e.r;
      }
      this._r1Min = Math.max(0, r1Min * 0.9);
      this._r1Max = Math.max(r1Max * 1.1 - this._r1Min < 12 ? this._r1Min + 12 : r1Max * 1.1, this._r1Min + 12);
      this._r2Min = Math.max(0, r2Min * 0.9);
      this._r2Max = Math.max(r2Max * 1.1 - this._r2Min < 12 ? this._r2Min + 12 : r2Max * 1.1, this._r2Min + 12);
    }
  }

  _surfacePoint(r1, r2) {
    const u = this._computeU(r1, r2);
    const r1c = Math.max(0, r1);
    const r2c = Math.max(0, r2);
    return {
      x: this._rToWorldXOrZ(r1c, this._r1Max),
      y: this._uToWorldY(u),
      z: this._rToWorldXOrZ(r2c, this._r2Max),
      u,
    };
  }

  // ---- Public camera API (delegates to shared renderer) ----

  /** @param {number} rad */
  setAzimuth(rad) { this._renderer.setAzimuth(rad); }

  /** @returns {number} */
  getAzimuth() { return this._renderer.getAzimuth(); }

  /** @param {number} rad */
  setElevation(rad) { this._renderer.setElevation(rad); }

  /** @returns {number} */
  getElevation() { return this._renderer.getElevation(); }

  /** @param {number} d */
  setDistance(d) { this._renderer.setDistance(d); }

  /** @returns {number} */
  getDistance() { return this._renderer.getDistance(); }

  /** @param {number} y */
  setJib(y) { this._renderer.setJib(y); }

  /** @returns {number} */
  getJib() { return this._renderer.getJib(); }

  /** Reset camera to defaults */
  resetCamera() { this._renderer.resetCamera(); }

  /**
   * Public resize entry point — called manually after construction
   * when layout settles (canvas has zero size until CSS layout completes).
   */
  resize() { this._renderer.resize(); }

  // ---- API: called by script.js each frame ----

  update({ G, mA, mB, mC, nA, nB, nC, r1, r2, U }) {
    this._G = G; this._mA = mA; this._mB = mB; this._mC = mC;
    if (nA != null) this._nA = nA;
    if (nB != null) this._nB = nB;
    if (nC != null) this._nC = nC;
    this._r1 = Math.max(0, r1); this._r2 = Math.max(0, r2);
    // Use the true U_eff (with centrifugal term) for marker, gravitational for surface
    const uGrav = this._computeU(this._r1, this._r2);
    const uEff = U !== undefined ? U : uGrav;
    this._ueffCurrent = uEff;
    this._updateURange(uEff);
    this._updateRRange(this._r1, this._r2);

    // Rebuild surface + axes every 60 frames (~1 s at 60 fps)
    if (this._frame % 60 === 0) {
      console.log('[REBUILD] frame=', this._frame, 'uGrav=', uGrav.toExponential(1), 'uEff=', uEff.toExponential(1));
      this._buildSurface();
    }
  }

  rebuild({ G, mA, mB, mC, nA, nB, nC }) {
    this._G = G; this._mA = mA; this._mB = mB; this._mC = mC;
    if (nA != null) this._nA = nA;
    if (nB != null) this._nB = nB;
    if (nC != null) this._nC = nC;
    this._uHistory = [];
    this._r1History = [];
    this._r2History = [];
    this._buildSurface();
    this._resetTrail();
  }

  /**
   * Fully dispose all resources: meshes, materials, geometries,
   * axes sprites, and the underlying ThreeRenderer.
   */
  dispose() {
    // Surface meshes
    if (this._surfMesh) {
      this._renderer._scene.remove(this._surfMesh);
      this._surfMesh.geometry.dispose();
      this._surfMesh.material.dispose();
      this._surfMesh = null;
    }
    if (this._wireMesh) {
      this._renderer._scene.remove(this._wireMesh);
      this._wireMesh.geometry.dispose();
      this._wireMesh.material.dispose();
      this._wireMesh = null;
    }
    // Marker + ring
    if (this._marker) {
      this._renderer._scene.remove(this._marker);
      this._marker.geometry.dispose();
      this._marker.material.dispose();
      this._marker = null;
    }
    if (this._ring) {
      this._renderer._scene.remove(this._ring);
      this._ring.geometry.dispose();
      this._ring.material.dispose();
      this._ring = null;
    }
    // Trail
    if (this._trailLine) {
      this._renderer._scene.remove(this._trailLine);
      this._trailGeo.dispose();
      this._trailLine.material.dispose();
      this._trailLine = null;
      this._trailGeo = null;
    }
    // Axes
    this._clearAxes();
    // Renderer (cancels animation, removes resize/context/controls listeners)
    if (this._renderer) {
      this._renderer.destroy();
      this._renderer = null;
    }
  }

  // ---- Surface ----

  _computeGridRange() {
    const { RMIN, RMAX, GRID: N } = this.opts;
    let gMin = Infinity, gMax = -Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const u = this._computeU(
          RMIN + (i / (N - 1)) * (RMAX - RMIN),
          RMIN + (j / (N - 1)) * (RMAX - RMIN)
        );
        if (u < gMin) gMin = u; if (u > gMax) gMax = u;
      }
    }
    this._gridUMin = gMin < 0 ? gMin * 1.1 : gMin * 0.9;
    this._gridUMax = gMax < 0 ? gMax * 0.9 : gMax * 1.1;
    if (Math.abs(this._gridUMax - this._gridUMin) < 1) this._gridUMax = this._gridUMin + 1;
    this._gridURange = this._gridUMax - this._gridUMin;
    const yMinWorld = this._uToWorldY(this._gridUMin).toFixed(2);
    const yMaxWorld = this._uToWorldY(this._gridUMax).toFixed(2);
    console.log(`[GRID] Ueff: ${this._gridUMin.toExponential(1)} → ${this._gridUMax.toExponential(1)}  |  Y-world: ${yMinWorld} → ${yMaxWorld}`);
  }

  _buildSurface() {
    if (this._surfMesh) {
      this._renderer._scene.remove(this._surfMesh);
      this._renderer._scene.remove(this._wireMesh);
      this._surfMesh.geometry.dispose();
      this._wireMesh.geometry.dispose();
    }
    this._computeGridRange();
    // If no rolling window data yet, initialize from grid
    if (this._uHistory.length === 0) {
      this._uMin = this._gridUMin;
      this._uMax = this._gridUMax;
      this._uRange = this._gridURange;
    }
    this._surfBuiltUMin = this._gridUMin;
    this._surfBuiltUMax = this._gridUMax;

    // Rebuild axes with current Y ticks
    this._clearAxes();
    this._buildAxes();

    const geo = this._makeSurfaceGeo();
    const geoW = this._makeSurfaceGeo();
    this._surfMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      shininess: 38,
      specular: new THREE.Color(0.18, 0.22, 0.38),
      transparent: true,
      opacity: 0.88,
    }));
    this._wireMesh = new THREE.Mesh(geoW, new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.09,
    }));
    this._renderer._scene.add(this._surfMesh);
    this._renderer._scene.add(this._wireMesh);
  }

  _makeSurfaceGeo() {
    const { RMIN, RMAX, GRID: N, Y_MIN, Y_MAX } = this.opts;
    const uRange = Math.max(1e-6, this._gridURange);
    const pos = [], col = [], idx = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const u = this._computeU(
          RMIN + (i / (N - 1)) * (RMAX - RMIN),
          RMIN + (j / (N - 1)) * (RMAX - RMIN)
        );
        const t = Math.max(0, Math.min(1, (u - this._gridUMin) / uRange));
        pos.push((i / (N - 1)) * 6, Y_MIN + t * (Y_MAX - Y_MIN), (j / (N - 1)) * 6);
        col.push(0.12 + 0.88 * t, 0.38 + 0.62 * (1 - Math.abs(2 * t - 1)), 1.0 - 0.88 * t);
      }
    }
    for (let i = 0; i < N - 1; i++)
      for (let j = 0; j < N - 1; j++)
        idx.push(i * N + j, i * N + j + N, i * N + j + 1, i * N + j + 1, i * N + j + N, i * N + j + N + 1);
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ---- Marker + trail ----

  _buildMarker() {
    this._marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 20, 20),
      new THREE.MeshPhongMaterial({
        color: 0xffd700,
        emissive: 0xffaa00,
        emissiveIntensity: 0.7,
        shininess: 80,
      })
    );
    this._renderer._scene.add(this._marker);
    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.46, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
      })
    );
    this._renderer._scene.add(this._ring);
  }

  _updateMarker() {
    // Compute the marker position using the surface grid (pure gravitational)
    const p = this._surfacePoint(this._r1, this._r2);
    // If we have the true U_eff, override the Y position to match
    if (this._ueffCurrent !== undefined) {
      p.y = this._uToWorldY(this._ueffCurrent);
    }
    this._marker.position.set(p.x, p.y, p.z);
    this._ring.position.copy(this._marker.position);
    this._ring.lookAt(this._renderer._camera.position);
    this._ring.material.opacity = 0.3 + 0.15 * Math.sin(Date.now() * 0.004);
    return p;
  }

  // ---- Slot-based circular trail ----

  _buildTrail() {
    const y0 = (this.opts.Y_MIN + this.opts.Y_MAX) / 2;
    this._trailPts = Array.from({ length: this.opts.TRAIL_LEN }, () => new THREE.Vector3(3, y0, 3));
    this._trailGeo = new THREE.BufferGeometry().setFromPoints(this._trailPts);
    this._trailLine = new THREE.Line(
      this._trailGeo,
      new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.45 })
    );
    this._renderer._scene.add(this._trailLine);
  }

  _resetTrail() {
    const y0 = (this.opts.Y_MIN + this.opts.Y_MAX) / 2;
    for (let i = 0; i < this.opts.TRAIL_LEN; i++) this._trailPts[i].set(3, y0, 3);
    this._trailGeo.setFromPoints(this._trailPts);
    this._trailHead = 0;
  }

  _updateTrail(mp) {
    this._trailPts[this._trailHead % this.opts.TRAIL_LEN].set(mp.x, mp.y, mp.z);
    this._trailHead++;
    const ordered = [];
    for (let i = 0; i < this.opts.TRAIL_LEN; i++) {
      ordered.push(this._trailPts[(this._trailHead + i) % this.opts.TRAIL_LEN].clone());
    }
    this._trailGeo.setFromPoints(ordered);
  }

  // ---- Axes ----

  _clearAxes() {
    const scene = this._renderer._scene;
    for (const obj of this._axesLines) {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
    for (const sp of this._axesSprites) {
      scene.remove(sp);
      if (sp.material && sp.material.map) sp.material.map.dispose();
      if (sp.material) sp.material.dispose();
    }
    this._axesLines = [];
    this._axesSprites = [];
  }

  _addLabel(text, position, color) {
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 96, 24);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.position.set(...position);
    sp.scale.set(2.8, 0.85, 1);
    this._renderer._scene.add(sp);
    this._axesSprites.push(sp);
  }

  _addTickLabel(text, position, color) {
    const len = text.length;
    const cv = document.createElement('canvas');
    cv.width = Math.max(64, Math.round(len * 22 * 0.55 + 24));
    cv.height = 34;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.position.set(...position);
    sp.scale.set(cv.width / cv.height * 0.75, 0.75, 1);
    this._renderer._scene.add(sp);
    this._axesSprites.push(sp);
  }

  _addTickLine(pos, axis, color) {
    const half = 0.08;
    let from, to;
    if (axis === 'x') { from = [pos, -half, -0.12]; to = [pos, half, -0.12]; }
    else if (axis === 'z') { from = [-0.12, -half, pos]; to = [-0.12, half, pos]; }
    else { from = [-0.12, pos, -0.12]; to = [-0.04, pos, -0.12]; }
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const obj = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthTest: true }));
    this._renderer._scene.add(obj);
    this._axesLines.push(obj);
  }

  _addAxisLine(from, to, color) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const obj = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: true }));
    this._renderer._scene.add(obj);
    this._axesLines.push(obj);
  }

  _buildAxes() {
    this._addAxisLine([0, 0, 0], [7, 0, 0], 0x7788ff);
    this._addAxisLine([0, 0, 0], [0, 0, 7], 0xff7788);
    const yBot = this.opts.Y_MIN - 0.5, yTop = this.opts.Y_MAX + 0.5;
    this._addAxisLine([0, yBot, 0], [0, yTop, 0], 0x88ff99);

    this._addLabel(`r₁ (${this._nA}→${this._nB})`, [7.8, -0.5, 0], '#7788ff');
    this._addLabel(`r₂ (${this._nA}→${this._nC})`, [0, -0.5, 7.8], '#ff7788');
    this._addLabel('U_grav (J)', [0, yTop + 0.6, 0], '#88ff99');

    // Dynamic X-axis ticks (r₁)
    const r1Step = (this._r1Max - this._r1Min) / 5;
    for (let i = 0; i <= 5; i++) {
      const r = this._r1Min + i * r1Step;
      const x = this._rToWorldXOrZ(r, this._r1Max);
      this._addTickLine(x, 'x', 0x7788ff);
      this._addTickLabel(r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2), [x, -0.44, -0.22], '#7788ff');
    }
    // Dynamic Z-axis ticks (r₂)
    const r2Step = (this._r2Max - this._r2Min) / 5;
    for (let i = 0; i <= 5; i++) {
      const r = this._r2Min + i * r2Step;
      const z = this._rToWorldXOrZ(r, this._r2Max);
      this._addTickLine(z, 'z', 0xff7788);
      this._addTickLabel(r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2), [-0.22, -0.44, z], '#ff7788');
    }

    const step = this._uRange / 5;
    for (let i = 0; i <= 5; i++) {
      const val = this._uMin + i * step;
      const y = this._uToWorldYAxis(val);
      if (y >= yBot && y <= yTop) {
        this._addTickLine(y, 'y', 0x88ff99);
        const lbl = Math.abs(val) >= 1e6 ? (val / 1e6).toFixed(1) + 'M'
                  : Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'k'
                  : val.toFixed(0);
        this._addTickLabel(lbl, [-0.6, y, -0.25], '#88ff99');
      }
    }
  }

  // ---- Frame advance (called by the shared renderer's animation loop) ----

  /**
   * Called by the owning simulation each frame after update().
   * Advances the marker + trail and increments the internal frame counter.
   */
  tick() {
    const mp = this._updateMarker();
    if (this._frame % 2 === 0) this._updateTrail(mp);
    this._frame++;
    // No need to call renderer.render() — the shared renderer's animation loop handles that.
  }
}