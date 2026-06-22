/**
 * state-manager.js — Manages the state of all celestial bodies
 * 
 * Handles body creation, state history (for trails), serialization,
 * and preset configurations.
 */

import { vec, clone, add, sub, scale, mag } from './math-utils.js';

export class StateManager {
  constructor() {
    /** @type {Array<{id: string, mass: number, pos: {x,y,z}, vel: {x,y,z}, color: string, label: string}>} */
    this.bodies = [];
    /** @type {number} Current simulation time */
    this.time = 0;
    /** @type {Array<Array<{x:number,y:number,z:number}>>} History per body (for trail rendering) */
    this.history = [];
    /** @type {number} Max history length per body */
    this.maxHistory = 2000;
    /** @type {number} History recording interval (steps) */
    this.recordInterval = 1;
    this._stepCounter = 0;
  }

  /**
   * Add a body to the system
   * @param {string} name - Label for the body
   * @param {number} mass - Mass (kg)
   * @param {{x:number,y:number,z:number}} position - Initial position
   * @param {{x:number,y:number,z:number}} velocity - Initial velocity
   * @param {string} [color] - CSS color for rendering
   * @returns {number} Index of the added body
   */
  addBody(name, mass, position, velocity, color) {
    const id = `body-${this.bodies.length}-${Date.now()}`;
    const idx = this.bodies.length;
    const colors = ['#ff4444', '#4488ff', '#44ff88', '#ffaa00', '#ff44ff', '#44ffff'];
    this.bodies.push({
      id,
      mass,
      pos: clone(position),
      vel: clone(velocity),
      color: color || colors[idx % colors.length],
      label: name
    });
    this.history.push([clone(position)]);
    return idx;
  }

  /**
   * Remove a body by index
   * @param {number} index
   */
  removeBody(index) {
    if (index >= 0 && index < this.bodies.length) {
      this.bodies.splice(index, 1);
      this.history.splice(index, 1);
    }
  }

  /**
   * Set the position of a body
   * @param {number} index
   * @param {{x:number,y:number,z:number}} position
   */
  setPosition(index, position) {
    if (index >= 0 && index < this.bodies.length) {
      this.bodies[index].pos = clone(position);
    }
  }

  /**
   * Set the velocity of a body
   * @param {number} index
   * @param {{x:number,y:number,z:number}} velocity
   */
  setVelocity(index, velocity) {
    if (index >= 0 && index < this.bodies.length) {
      this.bodies[index].vel = clone(velocity);
    }
  }

  /**
   * Set the mass of a body
   * @param {number} index
   * @param {number} mass
   */
  setMass(index, mass) {
    if (index >= 0 && index < this.bodies.length) {
      this.bodies[index].mass = Math.max(0.001, mass);
    }
  }

  /**
   * Record the current state into history (for trail rendering)
   * Call this after each physics step
   * @param {number} [simTime] - Current simulation time (attached to point for time-based trails)
   */
  recordState(simTime) {
    this._stepCounter++;
    if (this._stepCounter % this.recordInterval !== 0) return;

    const realTime = Date.now();
    for (let i = 0; i < this.bodies.length; i++) {
      const pt = clone(this.bodies[i].pos);
      pt.time = simTime || 0;
      pt.realTime = realTime;
      this.history[i].push(pt);
      if (this.history[i].length > this.maxHistory) {
        this.history[i].shift();
      }
    }
  }

  /**
   * Get trail positions for a body
   * @param {number} bodyIndex
   * @param {number} [length] - Max number of points to return
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  getTrail(bodyIndex, length) {
    if (bodyIndex < 0 || bodyIndex >= this.history.length) return [];
    const trail = this.history[bodyIndex];
    if (length && length < trail.length) {
      return trail.slice(trail.length - length);
    }
    return trail;
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.history = this.bodies.map(b => [clone(b.pos)]);
  }

  /**
   * Save the current state as a serializable object
   * @returns {Object}
   */
  saveState() {
    return {
      time: this.time,
      bodies: this.bodies.map(b => ({
        mass: b.mass,
        pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
        color: b.color,
        label: b.label
      }))
    };
  }

  /**
   * Load state from a saved object
   * @param {Object} state
   */
  loadState(state) {
    this.time = state.time || 0;
    this.bodies = state.bodies.map((b, i) => ({
      id: `body-${i}-restored`,
      mass: b.mass,
      pos: vec(b.pos.x, b.pos.y, b.pos.z),
      vel: vec(b.vel.x, b.vel.y, b.vel.z),
      color: b.color || '#ffffff',
      label: b.label || `Body ${i + 1}`
    }));
    this.clearHistory();
  }

  /**
   * Reset to initial state (restore from a saved snapshot)
   * @param {Object} [initialState] - If omitted, keeps current bodies but resets time and history
   */
  reset(initialState) {
    if (initialState) {
      this.loadState(initialState);
    } else {
      this.time = 0;
      this.clearHistory();
    }
  }
}