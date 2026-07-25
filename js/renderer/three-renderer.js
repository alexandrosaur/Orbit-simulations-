/**
 * three-renderer.js — Shared Three.js 3D renderer for orbit simulations
 *
 * Provides:
 *  - Three.js scene + camera + lighting setup
 *  - Mouse-drag orbit (left button), right-drag pan, scroll zoom
 *  - Configurable orbit pivot (defaults to origin)
 *  - Public camera API (setAzimuth, setElevation, setDistance, setJib, resetCamera)
 *  - WebGL context-loss recovery
 *  - Clean dispose with resize listener removal
 *
 * Used via composition by simulation-specific 3D views (e.g. UeffSurface3D).
 *
 * Precision headroom note:
 *  Raw physical units in Three.js world space will cause z-fighting/clipping
 *  at extreme zoom scales (> 10⁵×). For future work: use log-scaled world
 *  coordinates or recursive world-space offset (camera-relative positioning).
 *
 * Interface mirrors js/renderer/canvas-renderer.js where applicable.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';

export class ThreeRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @param {number} [options.pivotX=0]
   * @param {number} [options.pivotY=0]
   * @param {number} [options.pivotZ=0]
   * @param {number} [options.initialDistance=23]
   * @param {number} [options.initialAzimuth=0.88]
   * @param {number} [options.initialElevation=0.69]
   * @param {number} [options.initialJibY=0]
   * @param {number} [options.fov=55]
   * @param {number} [options.near=0.1]
   * @param {number} [options.far=1000]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;

    // ---- Configurable orbit pivot ----
    this._pivotX = options.pivotX ?? 0;
    this._pivotY = options.pivotY ?? 0;
    this._pivotZ = options.pivotZ ?? 0;
    this._panOffset = { x: 0, y: 0, z: 0 };

    // ---- Camera state ----
    this._azimuth = options.initialAzimuth ?? 0.88;
    this._elevation = options.initialElevation ?? 0.69;
    this._distance = options.initialDistance ?? 23;
    this._jibY = options.initialJibY ?? 0;

    // ---- Three.js setup ----
    this._renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x05091a, 1);

    this._camera = new THREE.PerspectiveCamera(
      options.fov ?? 55,
      1, // aspect updated in _handleResize
      options.near ?? 0.1,
      options.far ?? 1000
    );
    this._scene = new THREE.Scene();

    // ---- Lighting ----
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xc8d8ff, 0.9);
    dir.position.set(8, 16, 8);
    this._scene.add(dir);
    const fill = new THREE.DirectionalLight(0xff9955, 0.25);
    fill.position.set(-6, -4, -6);
    this._scene.add(fill);

    // ---- Resize handling ----
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._handleResize();

    // ---- WebGL context loss ----
    this._contextLost = false;
    this._onContextLost = this._handleContextLost.bind(this);
    this._onContextRestored = this._handleContextRestored.bind(this);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    // ---- Orbit controls ----
    this._initOrbitControls();

    // ---- Animation loop ----
    this._animHandle = null;
    this._animate();
  }

  // ==================================================================
  // Public camera API (callers use these instead of poking _ fields)
  // ==================================================================

  /** @returns {number} Azimuth in radians */
  getAzimuth() { return this._azimuth; }

  /** @param {number} rad */
  setAzimuth(rad) { this._azimuth = rad; }

  /** @returns {number} Elevation in radians */
  getElevation() { return this._elevation; }

  /** @param {number} rad */
  setElevation(rad) { this._elevation = rad; }

  /** @returns {number} Camera distance from pivot */
  getDistance() { return this._distance; }

  /** @param {number} d */
  setDistance(d) { this._distance = d; }

  /** @param {number} y — Jib Y offset added to pivotY */
  setJib(y) { this._jibY = y; }

  /** @returns {number} */
  getJib() { return this._jibY; }

  /**
   * Reset camera to default azimuth/elevation/distance/pivot/panOffset.
   * Does NOT reset jibY — that's application-specific.
   */
  resetCamera() {
    this._azimuth = 0.88;
    this._elevation = 0.69;
    this._distance = 23;
    this._panOffset = { x: 0, y: 0, z: 0 };
    // Pivot is intentionally NOT reset — it's set by the application at construction time.
  }

  /**
   * @deprecated Prefer setAzimuth/setElevation/setDistance/setJib.
   * Kept for backward compatibility.
   */
  zoomAt(factor) {
    this._distance = Math.max(3, Math.min(1000, this._distance * factor));
  }

  /**
   * Pan in screen-space (camera-local right/up).
   * @param {number} dx — screen pixels right
   * @param {number} dy — screen pixels up
   */
  pan(dx, dy) {
    const dir = new THREE.Vector3();
    this._camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, this._camera.up).normalize();
    const screenUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const scale = this._distance * 0.002;
    this._panOffset.x += (-dx * right.x + dy * screenUp.x) * scale;
    this._panOffset.y += (-dx * right.y + dy * screenUp.y) * scale;
    this._panOffset.z += (-dx * right.z + dy * screenUp.z) * scale;
  }

  /**
   * Frame all bodies in view (camera framing only — does NOT rebuild geometry/axes).
   * Geometry/axis rebuilding is the caller's responsibility.
   * @param {Array<{pos: {x: number, y: number, z: number}}>} bodies
   * @param {number} [margin=1.2]
   */
  zoomToFit(bodies, margin = 1.2) {
    if (!bodies || bodies.length === 0) return;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const b of bodies) {
      const p = b.pos || b;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(
      maxX - minX,
      maxY - minY,
      maxZ - minZ,
      1
    );
    this._distance = span * margin;
    this._pivotX = (minX + maxX) / 2;
    this._pivotY = (minY + maxY) / 2;
    this._pivotZ = (minZ + maxZ) / 2;
    this._panOffset = { x: 0, y: 0, z: 0 };
  }

  /**
   * Project a 3D world position to 2D screen coordinates (CSS pixels).
   * @param {{x: number, y: number, z: number}} worldPos
   * @returns {{x: number, y: number}}
   */
  worldToScreen(worldPos) {
    const vec = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    vec.project(this._camera);
    return {
      x: (vec.x * 0.5 + 0.5) * this._canvasWidth,
      y: (-vec.y * 0.5 + 0.5) * this._canvasHeight,
    };
  }

  /**
   * Convert screen coordinates to world position (raycast to z=0 plane).
   * @param {number} sx
   * @param {number} sy
   * @returns {{x: number, y: number, z: number}}
   */
  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2(
      (sx / this._canvasWidth) * 2 - 1,
      -(sy / this._canvasHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this._camera);
    // Intersect z=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pt);
    return { x: pt?.x ?? 0, y: pt?.y ?? 0, z: 0 };
  }

  // ==================================================================
  // Resize
  // ==================================================================

  /** Public entry point — call when layout settles or canvas changes size */
  resize() {
    this._handleResize();
  }

  _handleResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this._canvasWidth = w;
    this._canvasHeight = h;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  // ==================================================================
  // WebGL context loss
  // ==================================================================

  _handleContextLost(e) {
    e.preventDefault();
    this._contextLost = true;
  }

  _handleContextRestored() {
    this._contextLost = false;
    // Renderer will resume on next animation frame
  }

  // ==================================================================
  // Orbit controls (mouse drag + scroll)
  // ==================================================================

  _initOrbitControls() {
    this._orbDragging = false;
    this._panDragging = false;
    this._lastMouseX = 0;
    this._lastMouseY = 0;

    const onMouseDown = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this._lastMouseX = e.clientX - rect.left;
      this._lastMouseY = e.clientY - rect.top;
      if (e.button === 2) {
        this._panDragging = true;
      } else {
        this._orbDragging = true;
      }
      this.canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dx = mx - this._lastMouseX;
      const dy = my - this._lastMouseY;
      this._lastMouseX = mx;
      this._lastMouseY = my;

      if (this._orbDragging) {
        this._azimuth -= dx * 0.008;
        this._elevation = Math.max(0.08, Math.min(1.5, this._elevation + dy * 0.008));
      } else if (this._panDragging) {
        const dir = new THREE.Vector3();
        this._camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, this._camera.up).normalize();
        const screenUp = new THREE.Vector3().crossVectors(right, dir).normalize();
        const scale = this._distance * 0.002;
        this._panOffset.x += (-dx * right.x + dy * screenUp.x) * scale;
        this._panOffset.y += (-dx * right.y + dy * screenUp.y) * scale;
        this._panOffset.z += (-dx * right.z + dy * screenUp.z) * scale;
      }
    };

    const onMouseUp = () => {
      this._orbDragging = false;
      this._panDragging = false;
      this.canvas.style.cursor = '';
    };

    const onWheel = (e) => {
      e.preventDefault();
      this._distance *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this._distance = Math.max(3, Math.min(1000, this._distance));
    };

    const onContextMenu = (e) => e.preventDefault();

    this.canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContextMenu);

    // Store for cleanup
    this._orbitCleanup = () => {
      this.canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      this.canvas.removeEventListener('wheel', onWheel);
      this.canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }

  // ==================================================================
  // Camera update (called each frame before render)
  // ==================================================================

  _updateCamera() {
    const pivotY = this._pivotY + this._jibY;
    const pX = this._pivotX + this._panOffset.x;
    const pY = pivotY + this._panOffset.y;
    const pZ = this._pivotZ + this._panOffset.z;

    this._camera.position.set(
      pX + this._distance * Math.cos(this._elevation) * Math.sin(this._azimuth),
      pY + this._distance * Math.sin(this._elevation),
      pZ + this._distance * Math.cos(this._elevation) * Math.cos(this._azimuth)
    );
    this._camera.lookAt(pX, pivotY, pZ);
  }

  // ==================================================================
  // Animation loop
  // ==================================================================

  _animate() {
    this._animHandle = requestAnimationFrame(() => this._animate());
    this._handleResize();
    this._updateCamera();
    if (!this._contextLost) {
      this._renderer.render(this._scene, this._camera);
    }
  }

  // ==================================================================
  // Destruction
  // ==================================================================

  /**
   * Remove all listeners, cancel animation, dispose Three.js resources.
   * Subclasses should call super.destroy() after cleaning up their own meshes.
   */
  destroy() {
    if (this._animHandle) {
      cancelAnimationFrame(this._animHandle);
      this._animHandle = null;
    }
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    if (this._orbitCleanup) {
      this._orbitCleanup();
      this._orbitCleanup = null;
    }
    if (this._renderer) {
      this._renderer.dispose();
      this._renderer = null;
    }
    // Scene disposal is the caller's responsibility — they own the meshes.
  }
}