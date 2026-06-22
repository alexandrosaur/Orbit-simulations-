/**
 * math-utils.js — Vector math and Stumpff functions for orbital mechanics
 * 
 * Provides 2D/3D vector operations and the universal variable formulation
 * helper functions (Stumpff C(z) and S(z)).
 */

// ======================================================================
// Vector types & operations (2D and 3D compatible)
// ======================================================================

/**
 * Create a vector
 * @param {number} x
 * @param {number} y
 * @param {number} [z=0]
 * @returns {{x: number, y: number, z: number}}
 */
export function vec(x, y, z = 0) {
  return { x, y, z };
}

/** Dot product */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Vector magnitude */
export function mag(v) {
  return Math.sqrt(dot(v, v));
}

/** Vector addition */
export function add(a, b) {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

/** Vector subtraction */
export function sub(a, b) {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Scalar multiplication */
export function scale(s, v) {
  return vec(s * v.x, s * v.y, s * v.z);
}

/** Component-wise multiplication */
export function mul(a, b) {
  return vec(a.x * b.x, a.y * b.y, a.z * b.z);
}

/** Normalize a vector to unit length */
export function normalize(v) {
  const m = mag(v);
  if (m === 0) return vec(0, 0, 0);
  return scale(1 / m, v);
}

/** Cross product (3D) */
export function cross(a, b) {
  return vec(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}

/** Distance between two points */
export function dist(a, b) {
  return mag(sub(a, b));
}

/** Clone a vector */
export function clone(v) {
  return vec(v.x, v.y, v.z);
}

/** Array of vector values for serialization */
export function toArray(v) {
  return [v.x, v.y, v.z];
}

/** Create vector from array */
export function fromArray(arr) {
  return vec(arr[0] || 0, arr[1] || 0, arr[2] || 0);
}

// ======================================================================
// Stumpff functions — universal variable formulation
// ======================================================================

/**
 * Stumpff C(z) function
 * C(z) = (1 - cos(√z)) / z   for z > 0
 * C(z) = (cosh(√-z) - 1) / -z for z < 0
 * C(0) = 1/2
 * 
 * @param {number} z
 * @returns {number}
 */
export function stumpffC(z) {
  if (z > 0) {
    return (1 - Math.cos(Math.sqrt(z))) / z;
  } else if (z < 0) {
    return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  } else {
    return 1 / 2;
  }
}

/**
 * Stumpff S(z) function
 * S(z) = (√z - sin(√z)) / √(z³)   for z > 0
 * S(z) = (sinh(√-z) - √-z) / √((-z)³)  for z < 0
 * S(0) = 1/6
 * 
 * @param {number} z
 * @returns {number}
 */
export function stumpffS(z) {
  if (z > 0) {
    return (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / Math.sqrt(z ** 3);
  } else if (z < 0) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / Math.sqrt((-z) ** 3);
  } else {
    return 1 / 6;
  }
}

// ======================================================================
// Universal Kepler equation
// ======================================================================

/**
 * Universal Kepler equation F(χ) = 0
 * 
 * @param {number} chi - Universal anomaly
 * @param {number} r0 - Initial radial distance
 * @param {number} vr0 - Initial radial velocity
 * @param {number} alpha - 2/r0 - v0²/μ
 * @param {number} dt - Time step
 * @param {number} mu - Gravitational parameter
 * @returns {number}
 */
export function uniKeplerF(chi, r0, vr0, alpha, dt, mu) {
  const z = alpha * chi ** 2;
  return (
    (r0 * vr0 / Math.sqrt(mu)) * chi ** 2 * stumpffC(z) +
    (1 - alpha * r0) * chi ** 3 * stumpffS(z) +
    r0 * chi -
    Math.sqrt(mu) * dt
  );
}

/**
 * Derivative of the universal Kepler equation F'(χ)
 * 
 * @param {number} chi - Universal anomaly
 * @param {number} r0 - Initial radial distance
 * @param {number} vr0 - Initial radial velocity
 * @param {number} alpha - 2/r0 - v0²/μ
 * @param {number} mu - Gravitational parameter
 * @returns {number}
 */
export function uniKeplerD(chi, r0, vr0, alpha, mu) {
  const z = alpha * chi ** 2;
  return (
    (r0 * vr0 / Math.sqrt(mu)) * chi * (1 - alpha * chi ** 2 * stumpffS(z)) +
    (1 - alpha * r0) * chi ** 2 * stumpffC(z) +
    r0
  );
}

// ======================================================================
// Formatting helpers
// ======================================================================

/**
 * Format a large number with SI prefixes
 * @param {number} v
 * @param {number} [digits=2]
 * @returns {string}
 */
export function formatNum(v, digits = 2) {
  if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(digits) + 'T';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(digits) + 'G';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(digits) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(digits) + 'k';
  return v.toFixed(digits);
}