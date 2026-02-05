export type WindData = {
  wind_speed_mps: number;
  wind_dir_from_deg: number; // meteorological "from"
  time_utc?: string;
  time_local?: string;
  timezone?: string;
  utc_offset_seconds?: number;
};

export function mpsToMph(mps: number) {
  return mps * 2.236936;
}

export function mphToMps(mph: number) {
  return mph / 2.236936;
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// Convert meteorological "from" degrees -> downwind "to" degrees
export function downwindDeg(fromDeg: number) {
  return (fromDeg + 180) % 360;
}

export function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

export function rotatePoint(origin: { x: number; y: number }, p: { x: number; y: number }, deg: number) {
  const r = degToRad(deg);
  const s = Math.sin(r);
  const c = Math.cos(r);

  const x = p.x - origin.x;
  const y = p.y - origin.y;

  return {
    x: origin.x + x * c - y * s,
    y: origin.y + x * s + y * c,
  };
}

export function defaultHalfAngleDegFromMph(mph: number) {
  // narrower with higher wind, wider with low wind
  if (mph <= 3) return 28;
  if (mph <= 8) return 22;
  if (mph <= 14) return 18;
  return 14;
}

export function computeCone(
  src: { x: number; y: number },
  lengthPx: number,
  halfAngleDeg: number,
  windFromDeg: number
) {
  const down = downwindDeg(windFromDeg);

  // "tip" initially to the right, then rotate around src
  const tip0 = { x: src.x + lengthPx, y: src.y };
  const left0 = rotatePoint(src, tip0, -halfAngleDeg);
  const right0 = rotatePoint(src, tip0, +halfAngleDeg);

  const left = rotatePoint(src, left0, -down);
  const right = rotatePoint(src, right0, -down);
  const tip = rotatePoint(src, tip0, -down);

  return { left, right, tip, downwindDeg: down };
}
