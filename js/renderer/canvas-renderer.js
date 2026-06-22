/**
 * canvas-renderer.js — Draws bodies, trails, grid, scale bar
 * 
 * HiDPI-aware 2D canvas renderer with center-zoom, pan,
 * bodies scaled in world units (using scale bar), trail max-time.
 */

import { mag, dist } from '../core/math-utils.js';

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.showTrails = true;
    this.showCom = true;
    this.trailMaxTime = 10; // max trail age in real seconds (wall-clock time)
    this.bodyScale = 1; // multiplier for world-unit body size
    this.trailOpacity = 0.4;
    this.trailSmoothSamples = 20;

    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._handleResize();
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = rect.height * this.dpr;
      this.width = rect.width;
      this.height = rect.height;
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }

  worldToScreen(worldPos) {
    return {
      x: this.width / 2 + (worldPos.x - this.offsetX) * this.zoom,
      y: this.height / 2 - (worldPos.y - this.offsetY) * this.zoom
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.width / 2) / this.zoom + this.offsetX,
      y: (this.height / 2 - sy) / this.zoom + this.offsetY
    };
  }

  zoomAt(factor) {
    this.zoom *= factor;
    this.zoom = Math.min(100000, this.zoom);
  }

  pan(dx, dy) {
    this.offsetX -= dx / this.zoom;
    this.offsetY += dy / this.zoom;
  }

  resetCamera() {
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  zoomToFit(bodies, margin = 0.8) {
    if (bodies.length === 0) return;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const b of bodies) {
      if (b.pos.x < minX) minX = b.pos.x;
      if (b.pos.x > maxX) maxX = b.pos.x;
      if (b.pos.y < minY) minY = b.pos.y;
      if (b.pos.y > maxY) maxY = b.pos.y;
    }
    const ww = Math.max(1, maxX - minX);
    const wh = Math.max(1, maxY - minY);
    this.zoom = Math.min((this.width * margin) / ww, (this.height * margin) / wh);
    this.offsetX = (minX + maxX) / 2;
    this.offsetY = (minY + maxY) / 2;
  }

  // ==================================================================
  // Catmull-Rom spline interpolation for smooth trails
  // ==================================================================

  /**
   * Compute the cubic Catmull-Rom basis coefficients for a segment.
   * Returns { a, b, c, d } where f(t) = a·t³ + b·t² + c·t + d
   */
  _catmullRomCoeffs(p0, p1, p2, p3) {
    return {
      x: { a: -p0.x + 3*p1.x - 3*p2.x + p3.x, b: 2*p0.x - 5*p1.x + 4*p2.x - p3.x, c: -p0.x + p2.x, d: 2*p1.x },
      y: { a: -p0.y + 3*p1.y - 3*p2.y + p3.y, b: 2*p0.y - 5*p1.y + 4*p2.y - p3.y, c: -p0.y + p2.y, d: 2*p1.y },
    };
  }

  /**
   * Evaluate a cubic polynomial at t using forward differencing.
   * Returns an array of 'count' evenly spaced points from t=0 to t=1.
   */
  _evalFwdDiff(coeffs, count) {
    if (count <= 1) {
      return [{ x: coeffs.x.d * 0.5, y: coeffs.y.d * 0.5 }];
    }
    const δ = 1 / count;
    const δ2 = δ * δ;
    const δ3 = δ2 * δ;

    // f(t) = (a·t³ + b·t² + c·t + d) / 2   (×0.5 from Catmull-Rom definition)
    // D1 = f'(0) · δ
    // D2 = f''(0) · δ² / 2
    // D3 = f'''(0) · δ³ / 6  (constant)
    const points = [];
    let px = coeffs.x.d * 0.5;
    let py = coeffs.y.d * 0.5;
    const d1x = (coeffs.x.c * δ) * 0.5;
    const d1y = (coeffs.y.c * δ) * 0.5;
    const d2x = (coeffs.x.b * 2 * δ2) * 0.5;
    const d2y = (coeffs.y.b * 2 * δ2) * 0.5;
    const d3x = (coeffs.x.a * 6 * δ3) * 0.5;
    const d3y = (coeffs.y.a * 6 * δ3) * 0.5;

    let dd1x = d1x, dd1y = d1y;
    let dd2x = d2x, dd2y = d2y;

    for (let i = 0; i < count; i++) {
      points.push({ x: px, y: py });
      px += dd1x; py += dd1y;
      dd1x += dd2x; dd1y += dd2y;
      dd2x += d3x; dd2y += d3y;
    }
    return points;
  }

  /**
   * Trim trail points to only those within `maxAge` simulation seconds,
   * then interpolate for smooth rendering.
   * @param {Array<{x:number,y:number,z:number, time?:number}>} rawPoints - History points with optional time
   * @param {number} currentTime - Current simulation time
   * @param {number} maxAge - Maximum age in seconds to display
   * @param {boolean} useSmooth - Whether to apply Catmull-Rom smoothing
   * @returns {Array<{x:number,y:number,z:number}>|null}
   */
  _smoothTrailTimed(rawPoints, currentTime, maxAge, useSmooth = true) {
    if (!this.showTrails || maxAge <= 0 || rawPoints.length < 2) {
      return rawPoints && rawPoints.length === 1 ? rawPoints : null;
    }

    // Filter by real-time age: only show points within maxAge (in seconds)
    const nowReal = Date.now();
    let startIdx = 0;
    for (let i = 0; i < rawPoints.length; i++) {
      const age = (nowReal - (rawPoints[i].realTime || nowReal)) / 1000;
      if (age <= maxAge) {
        startIdx = i;
        break;
      }
    }
    const trimmed = rawPoints.slice(startIdx);
    if (trimmed.length < 2) return trimmed.length === 1 ? trimmed : null;

    // When smoothing is off, return raw trimmed points
    if (!useSmooth) return trimmed;

    // Forward-difference Catmull-Rom interpolation
    const n = trimmed.length;
    const totalSmooth = (n - 1) * this.trailSmoothSamples + 1;
    const smooth = new Array(totalSmooth);
    let idx = 0;

    for (let i = 0; i < n - 1; i++) {
      const p0 = i > 0 ? trimmed[i - 1] : trimmed[i];
      const p1 = trimmed[i];
      const p2 = trimmed[i + 1];
      const p3 = i < n - 2 ? trimmed[i + 2] : trimmed[i + 1];
      const coeffs = this._catmullRomCoeffs(p0, p1, p2, p3);
      const segPoints = this._evalFwdDiff(coeffs, this.trailSmoothSamples);
      for (let k = 0; k < segPoints.length; k++) {
        smooth[idx++] = segPoints[k];
      }
    }
    // Append last original point
    smooth[totalSmooth - 1] = { x: trimmed[n - 1].x, y: trimmed[n - 1].y };

    return smooth;
  }

  // ==================================================================
  // Drawing
  // ==================================================================
  clear() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
  }

  _niceScaleLabel(niceW) {
    if (niceW >= 1e12) return (niceW / 1e12).toFixed(0) + ' Tm';
    if (niceW >= 1e9) return (niceW / 1e9).toFixed(0) + ' Gm';
    if (niceW >= 1e6) return (niceW / 1e6).toFixed(0) + ' Mm';
    if (niceW >= 1e3) return (niceW / 1e3).toFixed(0) + ' km';
    if (niceW >= 1) return niceW.toFixed(0) + ' km';
    return (niceW * 1000).toFixed(0) + ' m';
  }

  /** Returns the current world-units-per-pixel ratio */
  get worldPerPx() {
    return 1 / this.zoom;
  }

  drawScaleBar() {
    // Ensure canvas dimensions are up to date (handles async layout)
    if (this.width <= 0 || this.height <= 0) {
      this._handleResize();
      if (this.width <= 0 || this.height <= 0) return;
    }
    const ctx = this.ctx;
    const barPx = Math.min(150, this.width * 0.25);
    const raw = barPx * this.worldPerPx;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let niceW;
    if (norm < 1.5) niceW = mag;
    else if (norm < 3.5) niceW = 2 * mag;
    else if (norm < 7.5) niceW = 5 * mag;
    else niceW = 10 * mag;

    const nicePx = niceW * this.zoom;
    const label = this._niceScaleLabel(niceW);
    const bx = this.width - nicePx - 20;
    const by = this.height - 80;

    ctx.save();
    // Semi-transparent background behind the scale bar for readability
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - 6, by - 22, nicePx + 12, 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';

    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + nicePx, by); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + nicePx, by - 4); ctx.lineTo(bx + nicePx, by + 4);
    ctx.stroke();
    ctx.fillText(label, bx + nicePx / 2, by - 8);
    ctx.restore();

    // Store for body scaling
    this._scaleBarWorld = niceW;
    this._scaleBarPx = nicePx;
  }

  drawTrails(trails, colors, currentTime, globalAlpha) {
    if (!this.showTrails) return;
    const ctx = this.ctx;
    const alpha = globalAlpha !== undefined ? globalAlpha : this.trailOpacity;
    // Skip Catmull-Rom smoothing when > 20 bodies for performance
    const useSmooth = trails.length <= 20;
    for (let b = 0; b < trails.length; b++) {
      const trail = trails[b];
      if (!trail || trail.length < 2) continue;
      const smooth = this._smoothTrailTimed(trail, currentTime, this.trailMaxTime, useSmooth);
      if (!smooth || smooth.length < 2) continue;

      ctx.beginPath();
      const start = this.worldToScreen(smooth[0]);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < smooth.length; i++) {
        const p = this.worldToScreen(smooth[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = colors[b] || '#ffffff';
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Preloaded arrow image for velocity vector display
   */
  _arrowImg = null;

  /**
   * Stored arrow hit region from the last drawVelocityArrow call.
   * { cx, cy, angle, length, width } in screen pixels, or null if arrow was not drawn.
   */
  _arrowHitRegion = null;

  _loadArrow() {
    if (this._arrowImg) return;
    this._arrowImg = new Image();
    this._arrowImg.src = '../../assets/icons/Yellow-Arrow-Transparent.png';
  }

  /**
   * Test whether a screen-space point (sx, sy) falls within the last-drawn
   * velocity arrow.  Rotates the point into the arrow's local frame and
   * checks the axis-aligned bounding box.
   * @param {number} sx - Screen X
   * @param {number} sy - Screen Y
   * @returns {boolean}
   */
  hitTestArrow(sx, sy) {
    const r = this._arrowHitRegion;
    if (!r) return false;
    // Translate point to arrow origin
    const dx = sx - r.cx;
    const dy = sy - r.cy;
    // Rotate into arrow's local frame (inverse rotation)
    const cos = Math.cos(-r.angle);
    const sin = Math.sin(-r.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    // Arrow extends from -length to 0 in local X, centered on Y
    return lx >= r.xMin && lx <= r.xMax && ly >= r.yMin && ly <= r.yMax;
  }

  /**
   * Draw a velocity vector arrow for the selected body using the PNG sprite.
   * Arrow is fixed-size in screen pixels (80×36) so it's always visible
   * regardless of zoom level or body size.
   * @param {{pos: {x,y,z}, vel: {x,y,z}}} body
   */
  drawVelocityArrow(body) {
    const ctx = this.ctx;
    const screen = this.worldToScreen(body.pos);
    const vx = body.vel.x, vy = body.vel.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 1e-12) {
      this._arrowHitRegion = null;
      return;
    }
    this._loadArrow();
    if (!this._arrowImg || !this._arrowImg.complete || this._arrowImg.naturalWidth === 0) {
      this._arrowHitRegion = null;
      return;
    }

    // Fixed arrow size in screen pixels
    const arrowLength = 80;
    const arrowWidth = 36;

    // Normalise velocity direction (flip y because screen y is inverted)
    const dx = vx / speed;
    const dy = -vy / speed;
    const angle = Math.atan2(dy, dx);

    // Arrow center offset 30px from body center in velocity direction
    const offset = 30;
    const arrowCx = screen.x + Math.cos(angle) * offset;
    const arrowCy = screen.y + Math.sin(angle) * offset;

    // Store hit region for click targeting (local coords: x from 0 to arrowLength)
    this._arrowHitRegion = {
      cx: arrowCx,
      cy: arrowCy,
      angle,
      length: arrowLength,
      width: arrowWidth,
      xMin: 0,
      xMax: arrowLength,
      yMin: -arrowWidth / 2,
      yMax: arrowWidth / 2,
    };

    ctx.save();
    ctx.translate(arrowCx, arrowCy);
    ctx.rotate(angle);
    ctx.drawImage(this._arrowImg, 0, -arrowWidth / 2, arrowLength, arrowWidth);
    ctx.restore();
  }

  /**
   * Draw bodies with world-unit sizing relative to the scale bar.
   * A body's radius in world units is proportional to its mass^(1/3).
   * The scale bar tells us how many world units per pixel, so we compute pixel size from that.
   * @param {Array} bodies
   * @param {number} [bodyIndexDragging=-1] - Index of body being dragged (white ring)
   * @param {number} [bodyIndexSelected=-1] - Index of selected body (golden ring)
   */
  drawBodies(bodies, bodyIndexDragging = -1, bodyIndexSelected = -1) {
    const ctx = this.ctx;
    const wpp = this.worldPerPx;

    // Base world-unit radius for mass=1000 is ~0.2 world units (tunable)
    // Multiply by sqrt(mass) for cross-sectional area scaling
    const baseWorldRadius = 0.1 * this.bodyScale;

    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const screen = this.worldToScreen(body.pos);

      // World-unit radius based on mass, converted to pixels
      const worldRadius = baseWorldRadius * Math.sqrt(body.mass / 1000);
      const pixelRadius = Math.max(2, Math.min(60, worldRadius / wpp));

      // Glow
      const gradient = ctx.createRadialGradient(screen.x - 2, screen.y - 2, 1, screen.x, screen.y, pixelRadius + 6);
      gradient.addColorStop(0, body.color);
      gradient.addColorStop(0, body.color);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, pixelRadius + 6, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Body
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, pixelRadius, 0, Math.PI * 2);
      ctx.fillStyle = body.color;
      ctx.fill();

      // Selection highlight (golden ring) and velocity arrow
      if (i === bodyIndexSelected) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw velocity arrow for selected body (fixed screen-pixel size)
        this.drawVelocityArrow(body);
      }

      if (i === bodyIndexDragging) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (body.label) {
        ctx.fillStyle = '#e0e8f0';
        ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(body.label, screen.x, screen.y - pixelRadius - 6);
      }
    }
  }

  drawCOM(comPos) {
    if (!this.showCom) return;
    const ctx = this.ctx;
    const screen = this.worldToScreen(comPos);
    const arm = 8, gap = 5;
    ctx.strokeStyle = 'rgba(160, 160, 160, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screen.x - gap - arm, screen.y); ctx.lineTo(screen.x - gap, screen.y);
    ctx.moveTo(screen.x + gap, screen.y); ctx.lineTo(screen.x + gap + arm, screen.y);
    ctx.moveTo(screen.x, screen.y - gap - arm); ctx.lineTo(screen.x, screen.y - gap);
    ctx.moveTo(screen.x, screen.y + gap); ctx.lineTo(screen.x, screen.y + gap + arm);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160, 160, 160, 0.7)';
    ctx.fill();
  }

  render(bodies, trails, com, bodyIndexSelected = -1, currentTime = 0) {
    // Ensure dimensions are up to date (canvases don't have layout at construction)
    this._handleResize();
    this.clear();
    this.drawTrails(trails, bodies.map(b => b.color), currentTime);
    if (com) this.drawCOM(com);
    this.drawBodies(bodies, -1, bodyIndexSelected);
    this.drawScaleBar();
  }
}