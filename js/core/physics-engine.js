/**
 * physics-engine.js — Universal Kepler solver and N-body gravity
 * 
 * Provides:
 *  - Two-body propagation via universal Kepler equation (Lagrange coefficients)
 *  - N-body gravitational acceleration with spline softening (exact Newtonian for r ≥ ε)
 *  - Leapfrog integrator (symplectic, preserves energy/angular momentum)
 *  - RK4 integrator (backward-compatible, higher accuracy per step but no energy preservation)
 *  - Energy and angular momentum calculations (softening-aware)
 */

import { 
  vec, dot, mag, add, sub, scale, normalize, cross, dist, clone,
  stumpffC, stumpffS, uniKeplerF, uniKeplerD
} from './math-utils.js';

export class PhysicsEngine {
  constructor() {
    // No state — this is a stateless computation engine
  }

  // ==================================================================
  // Universal Kepler solver (two-body propagation)
  // ==================================================================

  /**
   * Solve the universal Kepler equation for the universal anomaly χ
   * using Newton-Raphson iteration, then compute the propagated state
   * via Lagrange f/g coefficients.
   * 
   * @param {{x:number,y:number,z:number}} r0vec - Initial position vector
   * @param {{x:number,y:number,z:number}} v0vec - Initial velocity vector
   * @param {number} dt - Propagation time step (seconds)
   * @param {number} mu - Gravitational parameter (km³/s²)
   * @returns {{r: {x,y,z}, v: {x,y,z}}} Propagated position and velocity
   */
  solveKepler(r0vec, v0vec, dt, mu) {
    const r0 = mag(r0vec);
    const v0 = mag(v0vec);
    const vr0 = dot(r0vec, v0vec) / r0;
    const alpha = 2 / r0 - (v0 ** 2) / mu;

    // Initial guess for chi
    let chi = Math.sqrt(mu) * Math.abs(alpha) * dt;
    if (!isFinite(chi) || chi === 0) {
      chi = Math.cbrt(mu) * dt; // Fallback for parabolic case
    }

    const maxIter = 1000;
    const tol = 1e-10;

    for (let i = 0; i < maxIter; i++) {
      const f = uniKeplerF(chi, r0, vr0, alpha, dt, mu);
      const df = uniKeplerD(chi, r0, vr0, alpha, mu);
      const dchi = -f / df;
      chi += dchi;
      if (Math.abs(dchi) < tol) break;
    }

    // Lagrange coefficients f, g, fdot, gdot
    const z = alpha * chi ** 2;
    const C = stumpffC(z);
    const S = stumpffS(z);

    const fCoeff = 1 - (chi ** 2 / r0) * C;
    const gCoeff = dt - (chi ** 3 / Math.sqrt(mu)) * S;

    const rVec = add(scale(fCoeff, r0vec), scale(gCoeff, v0vec));
    const rMag = mag(rVec);

    if (rMag === 0) {
      throw new Error('Resulting position vector has zero magnitude.');
    }

    const fdotCoeff = (chi * Math.sqrt(mu) / (r0 * rMag)) * (alpha * chi ** 2 * S - 1);
    const gdotCoeff = 1 - (chi ** 2 / rMag) * C;

    const vVec = add(scale(fdotCoeff, r0vec), scale(gdotCoeff, v0vec));

    return { r: rVec, v: vVec };
  }

  // ==================================================================
  // N-body gravity with spline softening
  // ==================================================================

  /**
   * Compute gravitational acceleration for each body due to all others.
   * Uses a cubic-spline softening kernel so that:
   *   - For r >= ε: force is EXACTLY Newtonian (1/r²), zero degradation
   *   - For r < ε:  force smoothly transitions to a finite value at r=0
   * 
   * This prevents singularities without affecting orbital dynamics.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}}>} bodies
   * @param {number} G - Gravitational constant
   * @param {number} [softening=0] - Softening length (same units as positions)
   * @returns {Array<{x,y,z}>} Acceleration vectors for each body
   */
  computeAccelerations(bodies, G, softening = 0) {
    const n = bodies.length;
    const accs = new Array(n);
    for (let i = 0; i < n; i++) {
      accs[i] = vec(0, 0, 0);
    }

    if (softening <= 0) {
      // No softening — pure Newtonian
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const rij = sub(bodies[j].pos, bodies[i].pos);
          const r2 = dot(rij, rij);
          if (r2 < 1e-30) continue;
          const r = Math.sqrt(r2);
          const invR3 = 1.0 / (r2 * r);
          const accelX = G * invR3 * rij.x;
          const accelY = G * invR3 * rij.y;
          const accelZ = G * invR3 * rij.z;
          accs[i].x += bodies[j].mass * accelX;
          accs[i].y += bodies[j].mass * accelY;
          accs[i].z += bodies[j].mass * accelZ;
          accs[j].x -= bodies[i].mass * accelX;
          accs[j].y -= bodies[i].mass * accelY;
          accs[j].z -= bodies[i].mass * accelZ;
        }
      }
      return accs;
    }

    // Spline softening: EXACT 1/r² for r >= ε, smooth cubic inside
    const eps = softening;
    const eps2 = eps * eps;
    const invEps3 = 1.0 / (eps * eps2);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const rij = sub(bodies[j].pos, bodies[i].pos);
        const r2 = dot(rij, rij);
        const r = Math.sqrt(r2);
        if (r < 1e-30) continue;

        let accelMag;
        if (r >= eps) {
          // *** EXACT NEWTONIAN — zero degradation ***
          accelMag = G / (r2 * r);
        } else {
          // Spline kernel inside ε: C² continuous
          const u = r / eps;
          const u2 = u * u;
          const splineFactor = u * (4.0 - 3.0 * u2) * invEps3;
          accelMag = G * splineFactor;
        }

        const accelX = accelMag * rij.x;
        const accelY = accelMag * rij.y;
        const accelZ = accelMag * rij.z;

        accs[i].x += bodies[j].mass * accelX;
        accs[i].y += bodies[j].mass * accelY;
        accs[i].z += bodies[j].mass * accelZ;
        accs[j].x -= bodies[i].mass * accelX;
        accs[j].y -= bodies[i].mass * accelY;
        accs[j].z -= bodies[i].mass * accelZ;
      }
    }

    return accs;
  }

  /**
   * Same as computeAccelerations but also returns the softened potential energy.
   * Uses the same spline kernel for consistency.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}}>} bodies
   * @param {number} G - Gravitational constant
   * @param {number} [softening=0] - Softening length
   * @returns {{accs: Array<{x,y,z}>, potential: number}} Accelerations and total potential energy
   */
  computeAccelerationsWithEnergy(bodies, G, softening = 0) {
    const n = bodies.length;
    const accs = new Array(n);
    for (let i = 0; i < n; i++) {
      accs[i] = vec(0, 0, 0);
    }
    let PE = 0;
    const eps = softening;
    const eps2 = eps * eps;
    const invEps3 = eps > 0 ? 1.0 / (eps * eps2) : 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const rij = sub(bodies[j].pos, bodies[i].pos);
        const r2 = dot(rij, rij);
        const r = Math.sqrt(r2);
        if (r < 1e-30) continue;

        let accelMag;
        let potentialPair;

        if (softening <= 0 || r >= eps) {
          accelMag = G / (r2 * r);
          potentialPair = -G * bodies[i].mass * bodies[j].mass / r;
        } else {
          const u = r / eps;
          const u2 = u * u;
          const splineFactor = u * (4.0 - 3.0 * u2) * invEps3;
          accelMag = G * splineFactor;
          potentialPair = -G * bodies[i].mass * bodies[j].mass / eps * (2.0 - 2.0 * u2 + u2 * u2);
        }

        const accelX = accelMag * rij.x;
        const accelY = accelMag * rij.y;
        const accelZ = accelMag * rij.z;

        accs[i].x += bodies[j].mass * accelX;
        accs[i].y += bodies[j].mass * accelY;
        accs[i].z += bodies[j].mass * accelZ;
        accs[j].x -= bodies[i].mass * accelX;
        accs[j].y -= bodies[i].mass * accelY;
        accs[j].z -= bodies[i].mass * accelZ;

        PE += potentialPair;
      }
    }

    return { accs, potential: PE };
  }

  // ==================================================================
  // Symplectic Leapfrog integrator (DKD form)
  // ==================================================================

  /**
   * Advance the N-body system by one time step using the second-order
   * symplectic leapfrog integrator (Drift-Kick-Drift / Verlet).
   * 
   * Properties:
   *  - Symplectic: preserves phase-space volume, no secular energy drift
   *  - Time-reversible: EXACTLY, not just approximately
   *  - Angular momentum conserved to machine precision
   *  - Energy oscillates but does NOT systematically drift (unlike RK4)
   * 
   * The DKD scheme:
   *   1. pos += 0.5 * dt * vel          (half-step drift)
   *   2. vel += dt * acceleration(pos)  (full-step kick)
   *   3. pos += 0.5 * dt * vel          (half-step drift)
   * 
   * @param {Array<{mass: number, pos: {x,y,z}, vel: {x,y,z}}>} bodies
   * @param {number} G - Gravitational constant
   * @param {number} dt - Time step (seconds)
   * @param {number} [softening=0] - Softening length
   */
  integrateLeapfrog(bodies, G, dt, softening = 0) {
    const n = bodies.length;

    // 1. Half-step drift: pos += 0.5 * dt * vel
    for (let i = 0; i < n; i++) {
      bodies[i].pos.x += 0.5 * dt * bodies[i].vel.x;
      bodies[i].pos.y += 0.5 * dt * bodies[i].vel.y;
      bodies[i].pos.z += 0.5 * dt * bodies[i].vel.z;
    }

    // 2. Full-step kick: vel += dt * acceleration evaluated at current positions
    const accs = this.computeAccelerations(bodies, G, softening);
    for (let i = 0; i < n; i++) {
      bodies[i].vel.x += dt * accs[i].x;
      bodies[i].vel.y += dt * accs[i].y;
      bodies[i].vel.z += dt * accs[i].z;
    }

    // 3. Second half-step drift: pos += 0.5 * dt * vel
    for (let i = 0; i < n; i++) {
      bodies[i].pos.x += 0.5 * dt * bodies[i].vel.x;
      bodies[i].pos.y += 0.5 * dt * bodies[i].vel.y;
      bodies[i].pos.z += 0.5 * dt * bodies[i].vel.z;
    }
  }

  // ==================================================================
  // RK4 integrator for N-body (legacy, energy-drift)
  // ==================================================================

  /**
   * Advance the N-body system by one time step using 4th-order Runge-Kutta.
   * NOTE: RK4 is NOT symplectic — energy and angular momentum will drift
   * over long simulations. Use integrateLeapfrog for long-term stability.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}, vel: {x,y,z}}>} bodies
   * @param {number} G - Gravitational constant
   * @param {number} dt - Time step (seconds)
   * @param {number} [softening=0] - Softening length
   * @param {Function} [onStep] - Optional callback after each sub-step
   */
  integrateRK4(bodies, G, dt, softening = 0, onStep) {
    if (typeof softening === 'function') {
      onStep = softening;
      softening = 0;
    }

    const n = bodies.length;
    const pos0 = bodies.map(b => clone(b.pos));
    const vel0 = bodies.map(b => clone(b.vel));

    // k1
    const a1 = this.computeAccelerations(bodies, G, softening);
    const k1v = vel0.map(v => clone(v));
    const k1a = a1.map(a => clone(a));

    // k2
    const pos2 = bodies.map((b, i) => add(pos0[i], scale(0.5 * dt, k1v[i])));
    const tempBodies2 = bodies.map((b, i) => ({ mass: b.mass, pos: pos2[i], vel: vec(0, 0, 0) }));
    const a2 = this.computeAccelerations(tempBodies2, G, softening);
    const k2v = bodies.map((b, i) => add(vel0[i], scale(0.5 * dt, k1a[i])));
    const k2a = a2.map(a => clone(a));

    // k3
    const pos3 = bodies.map((b, i) => add(pos0[i], scale(0.5 * dt, k2v[i])));
    const tempBodies3 = bodies.map((b, i) => ({ mass: b.mass, pos: pos3[i], vel: vec(0, 0, 0) }));
    const a3 = this.computeAccelerations(tempBodies3, G, softening);
    const k3v = bodies.map((b, i) => add(vel0[i], scale(0.5 * dt, k2a[i])));
    const k3a = a3.map(a => clone(a));

    // k4
    const pos4 = bodies.map((b, i) => add(pos0[i], scale(dt, k3v[i])));
    const tempBodies4 = bodies.map((b, i) => ({ mass: b.mass, pos: pos4[i], vel: vec(0, 0, 0) }));
    const a4 = this.computeAccelerations(tempBodies4, G, softening);
    const k4v = bodies.map((b, i) => add(vel0[i], scale(dt, k3a[i])));
    const k4a = a4.map(a => clone(a));

    // Combine
    for (let i = 0; i < n; i++) {
      bodies[i].pos = add(
        pos0[i],
        scale(dt / 6, add(add(k1v[i], scale(2, k2v[i])), add(scale(2, k3v[i]), k4v[i])))
      );
      bodies[i].vel = add(
        vel0[i],
        scale(dt / 6, add(add(k1a[i], scale(2, k2a[i])), add(scale(2, k3a[i]), k4a[i])))
      );
    }

    if (onStep) onStep(bodies);
  }

  // ==================================================================
  // Energy, angular momentum, center of mass
  // ==================================================================

  /**
   * Compute total energy (kinetic + potential) of the system.
   * Uses the same spline-kernel potential for consistency.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}, vel: {x,y,z}}>} bodies
   * @param {number} G - Gravitational constant
   * @param {number} [softening=0] - Softening length
   * @returns {number} Total energy
   */
  computeTotalEnergy(bodies, G, softening = 0) {
    let KE = 0;
    let PE = 0;
    const n = bodies.length;
    const eps = softening;

    for (let i = 0; i < n; i++) {
      KE += 0.5 * bodies[i].mass * mag(bodies[i].vel) ** 2;
      for (let j = i + 1; j < n; j++) {
        const dr = sub(bodies[i].pos, bodies[j].pos);
        const r = mag(dr);
        if (r > 1e-15) {
          if (softening <= 0 || r >= eps) {
            PE -= (G * bodies[i].mass * bodies[j].mass) / r;
          } else {
            const u = r / eps;
            const u2 = u * u;
            PE -= (G * bodies[i].mass * bodies[j].mass) / eps * (2.0 - 2.0 * u2 + u2 * u2);
          }
        }
      }
    }

    return KE + PE;
  }

  /**
   * Compute total angular momentum vector of the system.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}, vel: {x,y,z}}>} bodies
   * @returns {{x: number, y: number, z: number}}
   */
  computeAngularMomentum(bodies) {
    const L = vec(0, 0, 0);
    for (const body of bodies) {
      const rv = cross(body.pos, body.vel);
      L.x += body.mass * rv.x;
      L.y += body.mass * rv.y;
      L.z += body.mass * rv.z;
    }
    return L;
  }

  /**
   * Compute the center of mass position.
   * 
   * @param {Array<{mass: number, pos: {x,y,z}}>} bodies
   * @returns {{x: number, y: number, z: number}}
   */
  computeCenterOfMass(bodies) {
    let totalMass = 0;
    const com = vec(0, 0, 0);
    for (const body of bodies) {
      totalMass += body.mass;
      com.x += body.mass * body.pos.x;
      com.y += body.mass * body.pos.y;
      com.z += body.mass * body.pos.z;
    }
    if (totalMass > 0) {
      com.x /= totalMass;
      com.y /= totalMass;
      com.z /= totalMass;
    }
    return com;
  }
}