import { simulateFlick, type Pens } from "@/lib/sim";
import { COS, SIN } from "@/lib/trig";
import type { FX } from "./fx";
import { SEAT_COLORS } from "@/lib/seats";

/** Seat layout around the desk: 0 bottom (z+), 1 top (z-), 2 left (x-), 3 right (x+). rot = character yaw = camera yaw for that viewer. */
export const SEATS = [
  { x: 0, z: 8.5, rot: 0 },
  { x: 0, z: -8.5, rot: Math.PI },
  { x: -5.5, z: 0, rot: -Math.PI / 2 },
  { x: 5.5, z: 0, rot: Math.PI / 2 },
] as const;
export const MAX_SEATS = 4;

/** world (x,z) -> seat-local (x right, z backwards; character faces -z) */
export function toLocal(seat: number, wx: number, wz: number, out: { x: number; z: number }) {
  const S0 = SEATS[seat];
  const dx = wx - S0.x;
  const dz = wz - S0.z;
  const c = Math.cos(S0.rot);
  const s = Math.sin(S0.rot);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
}
/** world direction -> seat-local direction */
export function dirToLocal(seat: number, ax: number, az: number, out: { x: number; z: number }) {
  const r = SEATS[seat].rot;
  const c = Math.cos(r);
  const s = Math.sin(r);
  out.x = ax * c - az * s;
  out.z = ax * s + az * c;
}

const SEAT_RGB = SEAT_COLORS.map((h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
});

/** Where an eliminated pen comes to rest on the floor, just outside the edge it left by. */
function floorSpot(x: number, z: number): [number, number] {
  const ox = Math.abs(x) - 3;
  const oz = Math.abs(z) - 6;
  if (ox * 1.0 >= oz * 0.5) {
    return [Math.sign(x || 1) * Math.max(Math.abs(x), 3.8), Math.max(-6.9, Math.min(6.9, z))];
  }
  return [Math.max(-3.6, Math.min(3.6, x)), Math.sign(z || 1) * Math.max(Math.abs(z), 6.8)];
}

export const S = 1 / 1024;
export const PEN_Y = 0.13;
export const FLOOR_Y = -7.5;
export const SEAT_Y = -3.0;
export const SEAT_Z = 8.5;
const GRAVITY = -70;
const CONTACT_T = 0.09;

export interface FlickEvent {
  id: string;
  pre: Pens;
  who: number;
  angle: number;
  power: number;
}

export type PenState = "desk" | "air" | "floor";

export interface PenVis {
  x: number;
  y: number;
  z: number;
  heading: number;
  spinVel: number;
  roll: number;
  rollVel: number;
  pitch: number;
  pitchVel: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number; // units/s while animating
  state: PenState;
  floorY: number;
  bounces: number;
  highlight: boolean;
  turn: boolean;
}

export type CharMode = "idle" | "aim" | "auto" | "strike" | "hold" | "recover";

export interface CharCtl {
  mode: CharMode;
  t: number;
  wind: number;
  lunge: number;
  aimX: number;
  aimZ: number;
  power: number;
  holdT: number;
}

interface Active {
  ev: FlickEvent;
  frames: Pens[];
  final: Pens;
  phase: "prep" | "run" | "settle";
  prepT: number;
  t: number; // ticks
  processed: number;
  outHandled: boolean[];
  settleT: number;
}

export interface AimState {
  active: boolean;
  valid: boolean;
  angle: number;
  power: number;
  ax: number;
  az: number;
  bandX: number;
  bandZ: number;
}

export interface GameInputs {
  turn: number | null;
  canAim: boolean;
  seat: number;
}

const sig = (p: Pens) => p.map((q) => `${q.x},${q.z},${q.out ? 1 : 0}`).join("|");

const newPen = (x: number, z: number): PenVis => ({
  x,
  y: PEN_Y,
  z,
  heading: 0,
  spinVel: 0,
  roll: 0,
  rollVel: 0,
  pitch: 0,
  pitchVel: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  speed: 0,
  state: "desk",
  floorY: PEN_Y,
  bounces: 0,
  highlight: false,
  turn: false,
});

const newChar = (): CharCtl => ({
  mode: "idle",
  t: 0,
  wind: 0,
  lunge: 0,
  aimX: 0,
  aimZ: -1,
  power: 0,
  holdT: 0,
});

const wrapAng = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

// ---- tiny WebAudio helper (muted until a user gesture) -------------------
let actx: AudioContext | null = null;
export function unlockAudio() {
  try {
    if (!actx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") void actx.resume();
  } catch {
    /* ignore */
  }
}
export function playClick(strength: number, freq = 900) {
  try {
    if (!actx || actx.state !== "running") return;
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + 0.07);
    g.gain.setValueAtTime(Math.min(0.25, 0.05 + strength * 0.2), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.1);
  } catch {
    /* ignore */
  }
}

export class Game {
  /** number of players (2..4); arrays always hold 4 slots */
  n = 2;
  pens: PenVis[] = [newPen(0, 3.5), newPen(0, -3.5), newPen(-1.66, 0), newPen(1.66, 0)];
  chars: CharCtl[] = [newChar(), newChar(), newChar(), newChar()];
  aim: AimState = { active: false, valid: false, angle: 0, power: 0, ax: 0, az: -1, bandX: 0, bandZ: 0 };
  /** seat currently being aimed by the viewer */
  aimSeat = 0;
  active: Active | null = null;
  queue: FlickEvent[] = [];
  seenFlickId: string | null = null;
  seenReset: string | null = null;
  restDirty: Pens | null = null;
  restSig = "";
  onEnd: ((id: string) => void) | null = null;
  fx: FX | null = null;
  /** camera/fx event counters */
  hitSeq = 0;
  hitStrength = 0;
  hitX = 0;
  hitZ = 0;
  outSeq = 0;
  /** smoothed time scale (slow-mo before/while a pen goes over the edge) */
  timeScale = 1;
  slowmo = 0;
  slowX = 0;
  slowZ = 0;
  private fallT = 9;
  private slowTarget = 0;
  private trailT = 0;
  private trailGo = false;

  get phase(): "none" | "prep" | "run" | "settle" {
    return this.active ? this.active.phase : "none";
  }

  /** Which pen is currently being animated (for characters to watch). */
  get movingWho(): number | null {
    return this.active && this.active.phase !== "prep" ? this.active.ev.who : null;
  }

  setCount(n: number) {
    this.n = Math.max(2, Math.min(MAX_SEATS, Math.round(n) || 2));
  }

  // ---- rest state ------------------------------------------------------
  setRest(pens: Pens) {
    const s = sig(pens);
    if (s === this.restSig) return;
    this.restSig = s;
    if (this.active || this.queue.length) {
      this.restDirty = pens;
      return;
    }
    this.applyRest(pens);
  }

  applyRest(pens: Pens) {
    for (let i = 0; i < pens.length && i < MAX_SEATS; i++) {
      const t = pens[i];
      const v = this.pens[i];
      const tx = t.x * S;
      const tz = t.z * S;
      if (t.out) {
        if (v.state !== "floor") {
          [v.x, v.z] = floorSpot(tx, tz);
          v.y = FLOOR_Y + 0.13;
          v.floorY = v.y;
          v.state = "floor";
          v.pitch = 0;
          v.roll = 0;
        }
      } else {
        const d = Math.hypot(v.x - tx, v.z - tz);
        if (v.state !== "desk" || d > 0.02) {
          v.x = tx;
          v.z = tz;
          v.y = PEN_Y;
          v.floorY = PEN_Y;
          v.state = "desk";
          v.vy = 0;
        }
      }
      v.speed = 0;
    }
  }

  /** New round: pens drop in onto the desk. */
  reset(pens: Pens) {
    this.finishActive(false);
    this.queue.length = 0;
    this.restDirty = null;
    this.restSig = sig(pens);
    this.setCount(pens.length);
    for (let i = 0; i < pens.length && i < MAX_SEATS; i++) {
      const t = pens[i];
      const v = this.pens[i];
      v.x = t.x * S;
      v.z = t.z * S;
      v.y = 6 + i * 1.6;
      v.floorY = PEN_Y;
      v.vy = 0;
      v.vx = v.vz = 0;
      v.state = "air";
      v.bounces = 0;
      v.heading = [0.1, Math.PI - 0.12, Math.PI / 2 + 0.1, -Math.PI / 2 - 0.1][i] + (Math.random() - 0.5) * 0.3;
      v.roll = (Math.random() - 0.5) * 5;
      v.pitch = (Math.random() - 0.5) * 2;
      v.rollVel = (Math.random() - 0.5) * 6;
      v.pitchVel = (Math.random() - 0.5) * 4;
      v.spinVel = 0;
      v.speed = 0;
    }
    for (const c of this.chars) {
      c.mode = "idle";
      c.wind = 0;
      c.lunge = 0;
    }
  }

  // ---- flicks ----------------------------------------------------------
  enqueue(ev: FlickEvent) {
    if (this.active) this.finishActive(true);
    this.queue.push(ev);
  }

  private begin(ev: FlickEvent) {
    const sim = simulateFlick(ev.pre, ev.who, ev.angle, ev.power);
    this.applyRest(ev.pre);
    this.active = {
      ev,
      frames: sim.frames,
      final: sim.final,
      phase: "prep",
      prepT: 0,
      t: 0,
      processed: 0,
      outHandled: ev.pre.map((p) => p.out),
      settleT: 0,
    };
    const a = ((ev.angle % 720) + 720) % 720;
    const c = this.chars[ev.who];
    c.aimX = COS[a] / 1024;
    c.aimZ = SIN[a] / 1024;
    c.power = ev.power / 100;
    if (this.aim.active && this.aimSeat === ev.who) this.cancelAim();
  }

  private startRun(a: Active) {
    a.phase = "run";
    a.t = 0;
    a.processed = 0;
    const who = a.ev.who;
    const ang = (((a.ev.angle % 720) + 720) % 720) / 2;
    this.pens[who].heading = (ang * Math.PI) / 180;
    this.pens[who].spinVel = 0;
    const c = this.chars[who];
    c.mode = "recover";
    c.t = -0.3;
    c.lunge = 1;
    playClick(a.ev.power / 100, 700);
  }

  /** Jump the running animation straight to its end. */
  finishActive(notify: boolean) {
    const a = this.active;
    if (!a) return;
    for (let k = 0; k < a.final.length; k++) {
      const f = a.final[k];
      const v = this.pens[k];
      if (f.out) {
        if (v.state !== "floor") {
          [v.x, v.z] = floorSpot(f.x * S, f.z * S);
          v.y = FLOOR_Y + 0.13;
          v.floorY = v.y;
          v.state = "floor";
          v.pitch = v.roll = 0;
        }
      } else {
        v.x = f.x * S;
        v.z = f.z * S;
        v.y = PEN_Y;
        v.state = "desk";
      }
      v.speed = 0;
    }
    this.endActive(notify);
  }

  private endActive(notify: boolean) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    for (const c of this.chars) {
      if (c.mode === "hold") {
        c.mode = "recover";
        c.t = 0;
      }
    }
    if (this.restDirty && sig(this.restDirty) !== sig(a.ev.pre)) this.applyRest(this.restDirty);
    this.restDirty = null;
    if (notify && this.onEnd) this.onEnd(a.ev.id);
  }

  private triggerFall(k: number, a: Active, j: number) {
    const v = this.pens[k];
    const cur = a.frames[j][k];
    const prev = a.frames[Math.max(0, j - 1)][k];
    v.x = cur.x * S;
    v.z = cur.z * S;
    v.vx = (cur.x - prev.x) * S * 60;
    v.vz = (cur.z - prev.z) * S * 60;
    // nudge outward so the pen clears the desk edge
    if (Math.abs(cur.x) > 3072) v.vx += Math.sign(cur.x) * 1.5;
    if (Math.abs(cur.z) > 6144) v.vz += Math.sign(cur.z) * 1.5;
    v.vy = 1.5;
    v.state = "air";
    v.floorY = FLOOR_Y + 0.13;
    v.bounces = 0;
    v.rollVel = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 5);
    v.pitchVel = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 5);
    v.spinVel = (Math.random() - 0.5) * 4;
    v.speed = 0;
    this.fallT = 0;
    this.outSeq++;
    this.slowX = v.x;
    this.slowZ = v.z;
    this.fx?.sparkBurst(v.x, 0.3, v.z, 14, 5, 1, 0.5, 0.4);
    playClick(0.4, 500);
  }

  private stepActive(dt: number) {
    const a = this.active!;
    const who = a.ev.who;
    if (a.phase === "prep") {
      a.prepT += dt;
      const c = this.chars[who];
      if (c.mode === "hold" || (c.mode === "strike" && c.t >= CONTACT_T)) this.startRun(a);
      else if (c.mode !== "auto" && c.mode !== "strike") {
        c.mode = "auto";
        c.t = 0;
      }
      if (a.phase === "prep" && a.prepT > 2.5) this.startRun(a);
      return;
    }
    const last = a.frames.length - 1;
    if (a.phase === "run") {
      a.t += dt * 60 * this.timeScale;
      const ti = Math.min(a.t, last);
      const i = Math.floor(ti);
      const f = ti - i;
      // process discrete events up to frame i
      for (let j = a.processed + 1; j <= i; j++) {
        const fr = a.frames[j];
        const pr = a.frames[j - 1];
        for (let k = 0; k < fr.length; k++) {
          if (fr[k].out && !a.outHandled[k]) {
            a.outHandled[k] = true;
            this.triggerFall(k, a, j);
          }
        }
        // collision: any live pen whose velocity changed far more than friction explains
        let hitN = 0;
        let hx = 0;
        let hz = 0;
        let maxSp = 0;
        for (let k = 0; k < fr.length; k++) {
          if (fr[k].out || pr[k].out) continue;
          const sp = Math.hypot(pr[k].vx, pr[k].vz);
          const dv = Math.hypot(fr[k].vx - pr[k].vx, fr[k].vz - pr[k].vz);
          if (dv > 0.12 * sp + 25) {
            hitN++;
            hx += this.pens[k].x;
            hz += this.pens[k].z;
            maxSp = Math.max(maxSp, sp);
            this.pens[k].spinVel = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 6);
          }
        }
        if (hitN > 0) {
          for (let k = 0; k < fr.length; k++) maxSp = Math.max(maxSp, fr[k].out ? 0 : Math.hypot(pr[k].vx, pr[k].vz));
          const st = Math.min(1, maxSp / 250);
          playClick(st, 1100);
          this.hitSeq++;
          this.hitStrength = st;
          this.hitX = hx / hitN;
          this.hitZ = hz / hitN;
          this.fx?.sparkBurst(this.hitX, 0.5, this.hitZ, 8 + Math.round(st * 14), 3 + st * 6);
        }
      }
      a.processed = Math.max(a.processed, i);
      // look ahead for a pen about to go over the edge -> slow motion
      let pending = 99;
      for (let j = i + 1; j <= Math.min(last, i + 48); j++) {
        const fr = a.frames[j];
        let found = -1;
        for (let k = 0; k < fr.length; k++) if (fr[k].out && !a.outHandled[k]) found = k;
        if (found >= 0) {
          pending = j - i;
          this.slowX = fr[found].x * S;
          this.slowZ = fr[found].z * S;
          break;
        }
      }
      this.slowTarget = pending <= 44 ? 1 : 0;
      const A = a.frames[i];
      const B = a.frames[Math.min(i + 1, last)];
      for (let k = 0; k < A.length; k++) {
        const v = this.pens[k];
        if (a.outHandled[k] || A[k].out) continue;
        v.x = (A[k].x + (B[k].x - A[k].x) * f) * S;
        v.z = (A[k].z + (B[k].z - A[k].z) * f) * S;
        v.y = PEN_Y;
        const sp = Math.hypot(A[k].vx, A[k].vz);
        v.speed = sp * S * 60;
        if (this.fx && v.speed > 3 && this.trailGo) {
          const c = SEAT_RGB[k] ?? SEAT_RGB[0];
          this.fx.trail(v.x, PEN_Y, v.z, c[0], c[1], c[2]);
        }
        if (sp > 18 && Math.abs(v.spinVel) < 0.6) {
          const target = Math.atan2(A[k].vz, A[k].vx);
          v.heading += wrapAng(target - v.heading) * Math.min(1, dt * 10);
        }
      }
      if (a.t >= last) {
        for (let k = 0; k < a.final.length; k++) {
          const fk = a.final[k];
          const v = this.pens[k];
          v.speed = 0;
          if (!fk.out) {
            v.x = fk.x * S;
            v.z = fk.z * S;
          }
        }
        a.phase = "settle";
        a.settleT = 0;
      }
      return;
    }
    // settle
    a.settleT += dt;
    const airborne = this.pens.some((p, i) => i < this.n && p.state === "air");
    if ((a.settleT > 0.35 && !airborne) || a.settleT > 2) {
      this.endActive(true);
    }
  }

  // ---- aiming ---------------------------------------------------------
  cancelAim() {
    this.aim.active = false;
    const c = this.chars[this.aimSeat];
    if (c.mode === "aim") c.mode = "idle";
  }

  release(seat: number, angle: number, power: number) {
    this.aim.active = false;
    const a = ((angle % 720) + 720) % 720;
    const c = this.chars[seat];
    c.aimX = COS[a] / 1024;
    c.aimZ = SIN[a] / 1024;
    c.power = power / 100;
    c.mode = "strike";
    c.t = 0;
  }

  // ---- per frame -------------------------------------------------------
  update(dt: number, inp: GameInputs) {
    dt = Math.min(dt, 0.05);
    this.fallT += dt;
    this.trailT -= dt;
    this.trailGo = false;
    if (this.trailT <= 0) {
      this.trailT = 0.025;
      this.trailGo = true;
    }
    const fallSlow = this.fallT < 0.65 && this.pens.some((p, i) => i < this.n && p.state === "air");
    const tgt = !this.active ? 0 : fallSlow ? 1 : this.slowTarget;
    this.slowmo += (tgt - this.slowmo) * (1 - Math.exp(-9 * dt));
    this.timeScale = 1 - 0.62 * this.slowmo;
    if (!this.active && this.queue.length) this.begin(this.queue.shift()!);
    if (this.active) this.stepActive(dt);
    else if (this.restDirty) {
      this.applyRest(this.restDirty);
      this.restDirty = null;
    }
    if (this.aim.active && !inp.canAim) this.cancelAim();

    for (let i = 0; i < this.n; i++) {
      this.stepPen(this.pens[i], dt * (this.pens[i].state === "air" ? this.timeScale : 1));
      this.pens[i].highlight = inp.canAim && inp.seat === i;
      this.pens[i].turn = inp.turn === i;
    }

    for (let s = 0; s < this.n; s++) this.stepChar(s, this.chars[s], dt);
  }

  private stepPen(v: PenVis, dt: number) {
    if (v.state === "air") {
      v.vy += GRAVITY * dt;
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      v.z += v.vz * dt;
      v.roll += v.rollVel * dt;
      v.pitch += v.pitchVel * dt;
      v.heading += v.spinVel * dt;
      if (v.y <= v.floorY && v.vy < 0) {
        v.y = v.floorY;
        v.bounces++;
        v.vy = -v.vy * 0.38;
        v.vx *= 0.6;
        v.vz *= 0.6;
        v.rollVel *= 0.5;
        v.pitchVel *= 0.5;
        v.spinVel *= 0.5;
        if (v.bounces > 1) playClick(Math.min(1, Math.abs(v.vy) / 8), 400);
        if (Math.abs(v.vy) < 2.4 || v.bounces >= 3) {
          v.vy = 0;
          v.state = v.floorY > -1 ? "desk" : "floor";
        }
      }
      return;
    }
    // resting: damp any residual motion and ease tilt back to flat
    if (v.state === "floor" && (Math.abs(v.vx) > 0.01 || Math.abs(v.vz) > 0.01)) {
      v.x += v.vx * dt;
      v.z += v.vz * dt;
      const k = Math.exp(-5 * dt);
      v.vx *= k;
      v.vz *= k;
    }
    v.roll += v.rollVel * dt;
    v.pitch += v.pitchVel * dt;
    v.rollVel = damp(v.rollVel, 0, 6, dt);
    v.pitchVel = damp(v.pitchVel, 0, 6, dt);
    v.roll -= Math.round(v.roll / (2 * Math.PI)) * 2 * Math.PI;
    v.pitch -= Math.round(v.pitch / (2 * Math.PI)) * 2 * Math.PI;
    v.roll = damp(v.roll, 0, 10, dt);
    v.pitch = damp(v.pitch, 0, 10, dt);
    if (v.spinVel !== 0) {
      v.heading += v.spinVel * dt;
      v.spinVel *= Math.exp(-3.5 * dt);
      if (Math.abs(v.spinVel) < 0.02) v.spinVel = 0;
    }
  }

  private stepChar(s: number, c: CharCtl, dt: number) {
    c.t += dt;
    switch (c.mode) {
      case "idle":
        c.wind = damp(c.wind, 0, 8, dt);
        c.lunge = damp(c.lunge, 0, 6, dt);
        break;
      case "aim":
        c.wind = damp(c.wind, this.aim.power / 100, 14, dt);
        c.lunge = damp(c.lunge, 0, 14, dt);
        c.power = this.aim.power / 100;
        c.aimX = this.aim.ax;
        c.aimZ = this.aim.az;
        break;
      case "auto": {
        const u = Math.min(1, c.t / 0.42);
        c.wind = (u * u * (3 - 2 * u)) * Math.max(0.25, c.power);
        c.lunge = 0;
        if (u >= 1) {
          c.mode = "strike";
          c.t = 0;
        }
        break;
      }
      case "strike": {
        const u = Math.min(1, c.t / 0.1);
        c.lunge = 1 - (1 - u) * (1 - u);
        c.wind = damp(c.wind, 0, 30, dt);
        if (c.t >= 0.1) {
          c.mode = "hold";
          c.holdT = 0;
        }
        break;
      }
      case "hold":
        c.lunge = 1;
        c.wind = 0;
        c.holdT += dt;
        if (!(this.active && this.active.ev.who === s) && c.holdT > 3) {
          c.mode = "recover";
          c.t = 0;
        }
        break;
      case "recover":
        if (c.t > 0) {
          c.lunge = damp(c.lunge, 0, 5, dt);
          c.wind = damp(c.wind, 0, 8, dt);
          if (c.t > 0.7) c.mode = "idle";
        }
        break;
    }
  }
}
