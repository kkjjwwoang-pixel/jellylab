export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A damped spring integrated at fixed 120 Hz steps by the simulation. */
export class Spring {
  constructor(value = 0) { this.value = value; this.velocity = 0; this.target = value; }
  step(dt, stiffness, damping) {
    this.velocity += ((this.target - this.value) * stiffness - this.velocity * damping) * dt;
    this.value += this.velocity * dt;
  }
  reset(value = 0) { this.value = this.target = value; this.velocity = 0; }
}

export class JellyPhysics {
  constructor() {
    this.softness = .68;
    this.squash = new Spring(); this.shearX = new Spring(); this.shearZ = new Spring();
    this.twist = new Spring(); this.hoverX = new Spring(); this.hoverZ = new Spring();
    this.grab = [new Spring(), new Spring(), new Spring()];
    this.morph = new Spring(); this.accumulator = 0; this.time = 0;
  }
  impact(strength = 1) {
    this.squash.velocity -= 2.6 * strength;
    this.shearX.velocity += .9 * strength;
    this.shearZ.velocity += .5 * strength;
    this.twist.velocity += .8 * strength;
  }
  advance(dt) {
    this.accumulator += clamp(dt, 0, .05);
    const h = 1 / 120;
    const stiffness = 145 - this.softness * 112;
    const damping = 9.2 - this.softness * 5.4;
    while (this.accumulator >= h) {
      this.squash.step(h, stiffness, damping);
      this.shearX.step(h, stiffness * .72, damping);
      this.shearZ.step(h, stiffness * .82, damping);
      this.twist.step(h, stiffness * .6, damping * .9);
      this.hoverX.step(h, 16, 6); this.hoverZ.step(h, 16, 6);
      this.grab.forEach(s => s.step(h, stiffness * 1.9, damping * 1.5));
      this.morph.step(h, 16, 7);
      this.time += h; this.accumulator -= h;
    }
    // Bound extreme repeated impulses without disrupting a normal spring cycle.
    this.squash.value = clamp(this.squash.value, -.48, .55);
    for (const spring of [this.shearX, this.shearZ, this.twist]) {
      spring.value = clamp(spring.value, -.65, .65);
      spring.velocity = clamp(spring.velocity, -5, 5);
    }
  }
  reset() {
    for (const item of Object.values(this)) if (item instanceof Spring) item.reset();
    this.grab.forEach(s => s.reset());
    this.time = 0; this.accumulator = 0; this.softness = .68;
  }
}
