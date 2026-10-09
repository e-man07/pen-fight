/**
 * Deterministic integer physics for a pen flick on a desk.
 *
 * 1:1 mirror of anchor/programs/pen-fight/src/sim.rs. The Solana program runs the
 * same simulation on the Ephemeral Rollup, so what you animate here is exactly what
 * the chain decided. All values are integers kept well below 2^53, so plain JS
 * numbers are exact; `div` truncates toward zero like Rust's integer division.
 *
 * World units: 1024 = 1.0 unit (~10 cm). x runs across the desk, z along it.
 * Angle is in half-degrees (0..720), 0 = +x, 360 = +z.
 */
import { ANGLE_STEPS, COS, SIN } from "./trig";

export const UNIT = 1024;
export const HALF_X = 3072;
export const HALF_Z = 6144;
export const PEN_RADIUS = 717;
export const FRICTION = 983;
export const RESTITUTION = 870;
export const STOP_SPEED = 6;
export const MAX_TICKS = 480;
export const MAX_POWER = 100;
export const SPEED_PER_100_POWER = 328;

export interface Pen {
  x: number;
  z: number;
  vx: number;
  vz: number;
  out: boolean;
}

/** One pen per player (length = number of players, 2..4). Index = seat. */
export type Pens = Pen[];

export const MAX_PLAYERS = 4;

const div = (a: number, b: number) => Math.trunc(a / b);

export const makePen = (x: number, z: number): Pen => ({ x, z, vx: 0, vz: 0, out: false });
export const clonePen = (p: Pen): Pen => ({ ...p });
export const clonePens = (p: Pens): Pens => p.map(clonePen);

export function edgeMargin(p: Pen): number {
  return Math.min(HALF_X - Math.abs(p.x), HALF_Z - Math.abs(p.z));
}

function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = div(x + 1, 2);
  while (y < x) {
    x = y;
    y = div(x + div(n, x), 2);
  }
  return x;
}

export function applyFlick(pen: Pen, angle: number, power: number): void {
  const a = ((angle % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
  const v0 = div(power * SPEED_PER_100_POWER, 100);
  pen.vx = div(v0 * COS[a], UNIT);
  pen.vz = div(v0 * SIN[a], UNIT);
}

function collide(a: Pen, b: Pen): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist2 = dx * dx + dz * dz;
  const min = 2 * PEN_RADIUS;
  if (dist2 >= min * min) return;
  const d = isqrt(dist2);
  const nx = d === 0 ? UNIT : div(dx * UNIT, d);
  const nz = d === 0 ? 0 : div(dz * UNIT, d);

  const overlap = min - d;
  const pushA = div(overlap, 2);
  const pushB = overlap - pushA;
  a.x -= div(pushA * nx, UNIT);
  a.z -= div(pushA * nz, UNIT);
  b.x += div(pushB * nx, UNIT);
  b.z += div(pushB * nz, UNIT);

  const rvn = div((a.vx - b.vx) * nx + (a.vz - b.vz) * nz, UNIT);
  if (rvn > 0) {
    const j = div(rvn * (UNIT + RESTITUTION), 2 * UNIT);
    a.vx -= div(j * nx, UNIT);
    a.vz -= div(j * nz, UNIT);
    b.vx += div(j * nx, UNIT);
    b.vz += div(j * nz, UNIT);
  }
}

/** Number of pens still on the desk. */
export const aliveCount = (pens: Pens): number => pens.filter((p) => !p.out).length;

/** Advance one tick. Returns true when the simulation should stop. */
export function step(pens: Pens): boolean {
  for (const p of pens) {
    if (p.out) continue;
    p.x += p.vx;
    p.z += p.vz;
    p.vx = div(p.vx * FRICTION, UNIT);
    p.vz = div(p.vz * FRICTION, UNIT);
    if (Math.abs(p.vx) + Math.abs(p.vz) < STOP_SPEED) {
      p.vx = 0;
      p.vz = 0;
    }
  }

  // Pairwise collisions in a fixed (i < j) order, same as the program.
  for (let i = 0; i < pens.length; i++) {
    for (let j = i + 1; j < pens.length; j++) {
      if (pens[i].out || pens[j].out) continue;
      collide(pens[i], pens[j]);
    }
  }

  for (const p of pens) {
    if (!p.out && (Math.abs(p.x) > HALF_X || Math.abs(p.z) > HALF_Z)) {
      p.out = true;
      p.vx = 0;
      p.vz = 0;
    }
  }

  return aliveCount(pens) <= 1 || pens.every((p) => p.out || (p.vx === 0 && p.vz === 0));
}

/** Run to rest, mutating `pens`. Returns the number of ticks simulated. */
export function runToRest(pens: Pens): number {
  for (let t = 0; t < MAX_TICKS; t++) {
    if (step(pens)) return t + 1;
  }
  for (const p of pens) {
    p.vx = 0;
    p.vz = 0;
  }
  return MAX_TICKS;
}

/**
 * Simulate a flick and record every tick (for animation). frames[0] is the state
 * right after the flick impulse, before any movement.
 */
export function simulateFlick(
  start: Pens,
  who: number,
  angle: number,
  power: number,
): { frames: Pens[]; final: Pens } {
  const pens = clonePens(start);
  applyFlick(pens[who], angle, power);
  const frames: Pens[] = [clonePens(pens)];
  let ticks = 0;
  for (; ticks < MAX_TICKS; ticks++) {
    const done = step(pens);
    frames.push(clonePens(pens));
    if (done) break;
  }
  if (ticks === MAX_TICKS) {
    for (const p of pens) {
      p.vx = 0;
      p.vz = 0;
    }
    frames[frames.length - 1] = clonePens(pens);
  }
  return { frames, final: pens };
}

/**
 * Starting pen positions for a round. `seed` is the VRF u64, `n` the player count.
 * Seats: 0 bottom, 1 top, 2 left, 3 right.
 */
export function spawn(seed: bigint, n = 2): Pens {
  const b = (i: number) => Number((seed >> BigInt(8 * i)) & 0xffn);
  const jx = (v: number) => (v - 128) * 12;
  const jz = (v: number) => (v - 128) * 8;
  return [
    makePen(jx(b(0)), 3584),
    makePen(jx(b(1)), -3584),
    makePen(-1700, jz(b(2))),
    makePen(1700, jz(b(3))),
  ].slice(0, n);
}

/** Aim angle (half-degrees) from `from` toward `to`. Used by hints/bots. */
export function angleToward(from: Pen, to: Pen): number {
  const rad = Math.atan2(to.z - from.z, to.x - from.x);
  const steps = Math.round((rad * 180) / Math.PI * 2);
  return ((steps % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
}
