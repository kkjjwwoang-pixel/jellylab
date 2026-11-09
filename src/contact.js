export function smoothRange(low, high, value) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

// Must match the TSL contact field: 0 = bonded, 1 = locally peeled.
export function peeledFraction(x, z, direction, progress) {
  const coordinate = (x * direction.x + z * direction.z) / 1.7;
  const front = 1.15 - progress * 2.55;
  return smoothRange(front - .22, front + .22, coordinate) * smoothRange(0, .12, progress);
}
