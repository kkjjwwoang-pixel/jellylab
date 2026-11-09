import { Vector3, Quaternion } from 'three';
import { clamp } from './physics.js';

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

/** A moving center of mass, off-center grip, and frictional ground contact.
 * Local spring deformation takes the first part of a pull; the remaining tension
 * acts on this body. Orientation is never sprung back to the original pose.
 */
export class JellyBody {
  constructor() {
    this.position = new Vector3(0, 1.09, 0);
    this.velocity = new Vector3();
    this.orientation = new Quaternion();
    this.angularVelocity = new Vector3();
    this.grip = new Vector3();
    this.target = new Vector3();
    this.held = false;
    this.scale = 1;
    this.grounded = true;
    this.clearance = 0;
    this.impact = 0;
    this.accumulator = 0;
    this.attached = true;
    this.adhesionLoad = 0;
    this.peel = 0;
    this.peelDirection = new Vector3(0, 0, 1);
    this._restTime = 0;
    this._releasedTime = 0;
    this._settling = false;
    this._gripForce = new Vector3();
    this._r = new Vector3(); this._error = new Vector3(); this._force = new Vector3();
    this._contact = new Vector3(); this._velocity = new Vector3(); this._cross = new Vector3();
    this._direction = new Vector3(); this._inverse = new Quaternion(); this._rotation = new Quaternion();
    this.supportPositions = null;
    this.contactInset = .10;
    this.surfaceGap = 0;
  }

  setShape(positions = null, height = 2.1) {
    this.supportPositions = positions;
    this.contactInset = positions ? Math.min(.10, height * .045) : .10;
    this.reset();
  }

  beginGrip(localPoint, worldPoint) {
    this.grip.copy(localPoint); this.target.copy(worldPoint); this.held = true;
    // Re-gripping an already landed body creates a fresh contact patch even if
    // residual rolling prevented the passive settling test from firing yet.
    if (this.grounded && this.clearance < .06 * this.scale && this.surfaceGap < .04 * this.scale && this.velocity.y < .6) {
      this.attached = true; this.peel = 0; this.adhesionLoad = 0;
      this.velocity.set(0, 0, 0); this.angularVelocity.set(0, 0, 0);
      this._restTime = 0; this._releasedTime = 0;
      this._settling = false;
    }
    this._r.copy(localPoint).applyQuaternion(this.orientation);
    this.peelDirection.set(this._r.x, 0, this._r.z);
    if (this.peelDirection.lengthSq() < .01) this.peelDirection.set(0, 0, 1);
    this.peelDirection.normalize();
  }

  release() { this.held = false; }

  detach() {
    this.attached = false;
    this._restTime = 0; this._releasedTime = 0; this._settling = false;
  }

  observeSurfaceContact(minimumHeight) {
    if (!Number.isFinite(minimumHeight)) return;
    this.surfaceGap = Math.max(0, minimumHeight - .004);
    // The rendered peel can exhaust a footprint well before progress reaches 1.
    // Once its final contact is gone, a resting-shape collider must not keep the
    // body pinned while the local stretch field runs into its safety limit.
    if (this.attached && this.held && this.peel > .12 && this.surfaceGap > .035 * this.scale) {
      this.detach();
      this.grounded = false;
      this.clearance = this.surfaceGap;
    }
  }

  reset() {
    this.position.set(0, 1.09 * this.scale, 0); this.velocity.set(0, 0, 0);
    this.orientation.identity(); this.angularVelocity.set(0, 0, 0);
    this.held = false; this.grounded = true; this.clearance = 0;
    this.impact = 0; this.accumulator = 0;
    this.surfaceGap = 0;
    this.attached = true; this.adhesionLoad = 0; this._restTime = 0; this._releasedTime = 0;
    this._settling = false;
    this.peel = 0; this.peelDirection.set(0, 0, 1);
    if (this.supportPositions) {
      this.position.y = -this.support().y - this.contactInset * this.scale;
      this.position.z = 0.5;
    }
  }

  // Exact support point for the superellipsoid, in the current world-down direction.
  support(morph = 0, squash = 0) {
    if (this.supportPositions) {
      // The lowest uploaded vertices determine contact after every rotation.
      // Average tied vertices so a flat face rests on its center, not one corner.
      const p = this.supportPositions;
      const sy = 1 + clamp(squash, -.48, .55);
      const sx = (1 + morph * .08) / Math.sqrt(sy), sz = (1 + morph * .04) / Math.sqrt(sy);
      const yScale = sy * (1 - morph * .12);
      const down = this._direction.copy(DOWN).applyQuaternion(this._inverse.copy(this.orientation).invert());
      const dx = down.x * sx, dy = down.y * yScale, dz = down.z * sz;
      let best = -Infinity, count = 0;
      this._contact.set(0, 0, 0);
      for (let i = 0; i < p.length; i += 3) {
        const projection = p[i] * dx + p[i + 1] * dy + p[i + 2] * dz;
        if (projection > best + .00001) { best = projection; count = 0; this._contact.set(0, 0, 0); }
        if (projection >= best - .00001) {
          this._contact.x += p[i]; this._contact.y += p[i + 1]; this._contact.z += p[i + 2]; count++;
        }
      }
      this._contact.multiplyScalar(1 / Math.max(1, count));
      this._contact.x *= sx; this._contact.y *= yScale; this._contact.z *= sz;
      return this._contact.multiplyScalar(this.scale).applyQuaternion(this.orientation);
    }
    const power = 4.4 - clamp(morph, 0, 1) * 2.15;
    const dual = power / (power - 1);
    const sy = 1 + clamp(squash, -.48, .55);
    const axes = [1.48 / Math.sqrt(sy), 1.05 * sy, 1.16 / Math.sqrt(sy)];
    const direction = this._direction.copy(DOWN).applyQuaternion(this._inverse.copy(this.orientation).invert());
    const d = [direction.x, direction.y, direction.z];
    const denominator = Math.pow(axes.reduce((sum, a, i) => sum + Math.abs(a * d[i]) ** dual, 0), 1 / dual);
    this._contact.set(...axes.map((a, i) => a * Math.sign(d[i]) * (Math.abs(a * d[i]) / denominator) ** (dual - 1)));
    return this._contact.multiplyScalar(this.scale).applyQuaternion(this.orientation);
  }

  advance(dt, { softness = .68, morph = 0, squash = 0, scale = 1 } = {}) {
    this.scale = scale; this.impact = 0;
    this.accumulator += clamp(dt, 0, .05);
    const h = 1 / 120;
    const mass = 1.65;
    const inverseMass = 1 / mass;
    const inverseInertia = 1.05 / (mass * scale * scale);
    while (this.accumulator >= h) {
      this._force.set(0, -9.8 * mass, 0);
      this.adhesionLoad = 0;
      if (!this.attached) this._releasedTime += h;
      if (this.held) {
        const r = this._r.copy(this.grip).multiplyScalar(scale).applyQuaternion(this.orientation);
        const error = this._error.copy(this.target).sub(this.position).sub(r);
        const distance = error.length();
        // Measure actual stretch, not torque: grabbing an edge must not bypass
        // the bonded phase. Thresholds scale with the specimen on small screens.
        this.adhesionLoad = Math.hypot(Math.hypot(error.x, error.z) / (2.35 * scale),
          Math.max(0, error.y) / (2.15 * scale));
        if (this.attached && Math.hypot(error.x, error.z) > Math.max(.3 * scale, Math.abs(error.y) * .9)) {
          this._direction.set(error.x, 0, error.z).normalize();
          this.peelDirection.lerp(this._direction, 1 - Math.exp(-h * 6)).normalize();
        }
        const slack = (.40 + softness * .22) * scale;
        if (distance > slack) {
          const force = this._gripForce.copy(error).multiplyScalar((distance - slack) / distance * 38);
          const gripVelocity = this._velocity.copy(this.angularVelocity).cross(r).add(this.velocity);
          force.addScaledVector(gripVelocity, -5).clampLength(0, 48);
          this._force.add(force);
          const torque = this._cross.copy(r).cross(force);
          // A bonded contact patch resists lifting AND rolling until it peels.
          // The local gel still stretches while the center of mass stays put.
          if (!this.attached) this.angularVelocity.addScaledVector(torque, h * inverseInertia);
        }
      }
      const peelTarget = this.attached ? clamp((this.adhesionLoad - .12) / .9, 0, 1) : 1;
      this.peel += (peelTarget - this.peel) * (1 - Math.exp(-h * 9));
      if (this.attached) {
        // The visible bond front travels across the footprint first. Transfer
        // to free-body motion only after the last edge has peeled, not on a timer.
        if (this.peel < .975) {
          this.velocity.set(0, 0, 0); this.angularVelocity.set(0, 0, 0);
          // Compress a broad contact patch into the shader's world-floor clamp.
          this.position.y = -this.support(morph, squash).y - this.contactInset * scale;
          this.clearance = 0; this.grounded = true;
          this.accumulator -= h;
          continue;
        }
        this.detach();
      }
      if (this._settling) {
        if (this.grounded && this.surfaceGap < .04 * scale && (!this.held || this.adhesionLoad < .6)) {
          // A forming contact patch supports weight while the remaining motion
          // coasts to rest. Keep integrating position and rotation; do not keep
          // injecting single-point collision jitter into a nearly flat GLB face.
          const decay = Math.exp(-h * 5);
          this.velocity.multiplyScalar(decay);
          this.angularVelocity.multiplyScalar(decay);
          this.position.addScaledVector(this.velocity, h);
          this.integrateOrientation(h);
          this.position.y = -this.support(morph, squash).y - this.contactInset * scale;
          this.clearance = 0;
          if (this.velocity.length() < .006 * scale && this.angularVelocity.length() < .006) {
            this.attached = true; this.peel = 0; this._settling = false;
          }
          this.accumulator -= h;
          continue;
        }
        // Renewed tension interrupts settling immediately.
        this._settling = false; this._restTime = 0;
      }
      // A soft edge keeps the specimen in reach without pinning it to the center.
      const radius = Math.hypot(this.position.x / scale, this.position.z / scale);
      if (radius > 1.65) {
        const edge = (radius - 1.65) * 24 / radius;
        this._force.x -= this.position.x * edge;
        this._force.z -= this.position.z * edge;
      }
      this.velocity.addScaledVector(this._force, h * inverseMass).multiplyScalar(Math.exp(-.4 * h)).clampLength(0, 5);
      this.angularVelocity.multiplyScalar(Math.exp(-.42 * h)).clampLength(0, 6);
      this.position.addScaledVector(this.velocity, h);
      this.integrateOrientation(h);
      const contact = this.support(morph, squash);
      // Small allowance for shader ripples. The final surface contact is world-space.
      const gap = this.position.y + contact.y + this.contactInset * scale;
      this.clearance = Math.max(0, gap);
      this.grounded = gap < .025 * scale;
      if (this.grounded) {
        if (gap < 0) this.position.y -= gap;
        const contactVelocity = this._velocity.copy(this.angularVelocity).cross(contact).add(this.velocity);
        const normalSpeed = contactVelocity.y;
        const normalLever = this._cross.copy(contact).cross(UP);
        const effectiveMass = inverseMass + inverseInertia * normalLever.lengthSq();
        const restitution = normalSpeed < -.9 ? .06 : 0;
        const impulse = Math.max(0, -(1 + restitution) * normalSpeed / effectiveMass);
        this.velocity.y += impulse * inverseMass;
        this.angularVelocity.addScaledVector(normalLever, impulse * inverseInertia);
        if (normalSpeed < -.9) this.impact = Math.max(this.impact, Math.min(2, -normalSpeed * .3));

        // Contact friction converts sideways movement into rolling, then dissipates it.
        contactVelocity.copy(this.angularVelocity).cross(contact).add(this.velocity); contactVelocity.y = 0;
        const tangentSpeed = contactVelocity.length();
        if (tangentSpeed > 1e-6) {
          const tangent = contactVelocity.multiplyScalar(-1 / tangentSpeed);
          const lever = this._cross.copy(contact).cross(tangent);
          const friction = Math.min(tangentSpeed / (inverseMass + inverseInertia * lever.lengthSq()), .92 * (impulse + mass * 9.8 * h));
          this.velocity.addScaledVector(tangent, friction * inverseMass);
          this.angularVelocity.addScaledVector(lever, friction * inverseInertia);
        }
        this.angularVelocity.multiplyScalar(Math.exp(-1.95 * h));
        this.velocity.x *= Math.exp(-1.0 * h); this.velocity.z *= Math.exp(-1.0 * h);
      }
      // Let the last fraction of a roll dissipate continuously. Previously the
      // attachment gate accepted visible motion and zeroed it on the next step.
      const canSettle = this.grounded && this.surfaceGap < .04 * scale && this._releasedTime > .5 && (!this.held || this.adhesionLoad < .6);
      if (canSettle && this.velocity.length() < .4 * scale && this.angularVelocity.length() < .5) {
        this._restTime += h;
        if (this._restTime > .18) this._settling = true;
      } else this._restTime = 0;
      this.accumulator -= h;
    }
  }

  integrateOrientation(dt) {
    const spin = this.angularVelocity.length();
    if (spin > 1e-6) {
      this._rotation.setFromAxisAngle(this._direction.copy(this.angularVelocity).multiplyScalar(1 / spin), spin * dt);
      this.orientation.premultiply(this._rotation).normalize();
    }
  }
}
