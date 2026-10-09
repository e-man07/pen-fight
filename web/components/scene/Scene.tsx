/* eslint-disable react-hooks/immutability, react-hooks/refs */
"use client";

import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Pens } from "@/lib/sim";
import { COS, SIN } from "@/lib/trig";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { SEAT_COLORS } from "@/lib/seats";
import { Game, SEATS, unlockAudio, type FlickEvent } from "./game";
import { DustMotes, FX, FXLayer } from "./fx";
import { PenMesh } from "./Pen";
import { Character, type CharacterLook, type CharInfo } from "./Character";
import { MainDesk, Room, ROOM_X, ROOM_Z, WALLS } from "./Classroom";
import type { BoardData } from "./textures";

export type { FlickEvent } from "./game";

export interface SceneProps {
  /** Number of players, 2..4 (default: pens.length or 2). Seats: 0 bottom, 1 top, 2 left, 3 right. */
  playerCount?: number;
  /** Seat of the viewer: camera sits behind this seat's character, so the viewer's own pen is near the camera. (spectators use 0). */
  seat: number;
  names: string[];
  score: number[];
  targetWins: number;
  round: number;
  /** Resting/target pen state. */
  pens: Pens;
  resetKey: string;
  flick: FlickEvent | null;
  onFlickAnimationEnd?: (id: string) => void;
  turn: number | null;
  canAim: boolean;
  /** Called on release of a valid aim drag: angle in half-degrees 0..719, power 1..100. */
  onFlick: (angle: number, power: number) => void;
  roundWinner?: number | "draw" | null;
  /** "game" (default): intro shot + action-follow camera. "lobby": slow looping cinematic backdrop (subject biased away from the lobby card). */
  mode?: "game" | "lobby";
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const TARGET_Z = -1.0;
const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dampN = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (u: number) => u * u * (3 - 2 * u);

interface LobbyShot {
  yaw: number;
  pitch: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}
// slow looping cinematic: wide establishing, push-in on the far student, orbit, low push on the pens
const LOBBY: LobbyShot[] = [
  { yaw: 0.18, pitch: 0.95, dist: 31, tx: 0, ty: -1, tz: 0 },
  { yaw: -0.35, pitch: 0.55, dist: 21, tx: 0.5, ty: 1.5, tz: -3.5 },
  { yaw: 0.7, pitch: 0.7, dist: 25, tx: 0, ty: 0, tz: 0 },
  { yaw: 1.05, pitch: 0.42, dist: 16, tx: 0, ty: 1, tz: 2 },
  { yaw: 0.2, pitch: 0.62, dist: 17, tx: 1, ty: 1.2, tz: 3.5 },
];
const SHOT_T = 11;

interface RigState {
  ang: number;
  zoom: number;
  fx: number;
  fy: number;
  fz: number;
  pitchO: number;
  yawO: number;
  kick: number;
  shake: number;
  sway: number;
  introT: number;
  winT: number;
  lastWin: string;
  lastHit: number;
  lastOut: number;
  reduce: boolean;
  t: number;
  tFx: number;
  tFz: number;
  vo: string;
  scrub: boolean;
  lob: LobbyShot;
}

function CameraRig({ game, propsRef }: { game: Game; propsRef: React.RefObject<SceneProps> }) {
  const { camera, size } = useThree();
  const st = useMemo<RigState>(
    () => ({
      ang: SEATS[propsRef.current.seat]?.rot ?? 0,
      zoom: 1,
      fx: 0,
      fy: 0,
      fz: 0,
      pitchO: 0,
      yawO: 0,
      kick: 0,
      shake: 0,
      sway: 1,
      introT: 0,
      winT: 99,
      lastWin: "",
      lastHit: 0,
      lastOut: 0,
      reduce: false,
      t: 0,
      tFx: 0,
      tFz: 0,
      vo: "",
      scrub: false,
      lob: { ...LOBBY[0] },
    }),
    [propsRef],
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    st.reduce = mq.matches;
    const fn = () => (st.reduce = mq.matches);
    mq.addEventListener?.("change", fn);
    return () => mq.removeEventListener?.("change", fn);
  }, [st]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const p = propsRef.current;
    const lobby = p.mode === "lobby";
    const aspect = size.width / Math.max(1, size.height);
    st.t += dt;
    if (process.env.NODE_ENV !== "production") {
      const sv = document.documentElement.getAttribute("data-pen-scrub");
      if (sv) {
        st.t = parseFloat(sv);
        st.introT = st.t;
        st.scrub = true;
      }
    }
    const reduce = st.reduce;

    // ---- view bias for lobby (card at left on desktop / bottom on portrait) ----
    const vo = lobby ? (aspect > 1.1 ? "r" : "u") : "";
    const key = `${vo}${size.width}x${size.height}`;
    if (key !== st.vo) {
      st.vo = key;
      if (!lobby) cam.clearViewOffset();
      else if (vo === "r") cam.setViewOffset(size.width, size.height, -size.width * 0.17, 0, size.width, size.height);
      else cam.setViewOffset(size.width, size.height, 0, size.height * 0.2, size.width, size.height);
    }

    let fov: number;
    let px: number, py: number, pz: number, lx: number, ly: number, lz: number;

    if (lobby) {
      const n = LOBBY.length;
      const tt = reduce ? 0 : st.t;
      const i = Math.floor(tt / SHOT_T) % n;
      const u = (tt % SHOT_T) / SHOT_T;
      const a = LOBBY[i];
      const b = LOBBY[(i + 1) % n];
      const e = smooth(clampN((u - 0.55) / 0.45, 0, 1));
      const drift = reduce ? 0 : u;
      const L = st.lob;
      const tgt = {
        yaw: a.yaw + (b.yaw - a.yaw) * e + drift * 0.12,
        pitch: a.pitch + (b.pitch - a.pitch) * e,
        dist: a.dist + (b.dist - a.dist) * e - drift * 1.6,
        tx: a.tx + (b.tx - a.tx) * e,
        ty: a.ty + (b.ty - a.ty) * e,
        tz: a.tz + (b.tz - a.tz) * e,
      };
      const k = st.scrub ? 1e3 : 3.2;
      L.yaw = dampN(L.yaw, tgt.yaw, k, dt);
      L.pitch = dampN(L.pitch, tgt.pitch, k, dt);
      L.dist = dampN(L.dist, tgt.dist, k, dt);
      L.tx = dampN(L.tx, tgt.tx, k, dt);
      L.ty = dampN(L.ty, tgt.ty, k, dt);
      L.tz = dampN(L.tz, tgt.tz, k, dt);
      const portrait = clampN((1.1 - aspect) / 0.6, 0, 1);
      const dm = 1 + portrait * 0.95;
      fov = 38;
      const cp = Math.cos(L.pitch);
      lx = L.tx;
      ly = L.ty;
      lz = L.tz;
      px = lx + L.dist * dm * Math.sin(L.yaw) * cp;
      py = ly + L.dist * dm * Math.sin(L.pitch);
      pz = lz + L.dist * dm * Math.cos(L.yaw) * cp;
      st.ang = 0;
    } else {
      // ---- base play framing (full 6x12 desk visible on any aspect) ----
      const portrait = clampN((1.1 - aspect) / 0.6, 0, 1);
      const fov0 = 40 + portrait * 4;
      const tanH = Math.tan(THREE.MathUtils.degToRad(fov0 / 2));
      const seatIdx = Math.max(0, Math.min(3, Math.round(p.seat) || 0));
      const np = Math.max(2, Math.min(4, p.playerCount ?? p.pens.length ?? 2));
      const side = seatIdx >= 2;
      const pitch0 = THREE.MathUtils.degToRad(61 + portrait * 10 + (side ? 7 : 0));
      // world-unit spans that must fit: V across the screen height, W across its width
      const spanV = side ? 20 : 24.7;
      const spanW = side ? 22.5 : np >= 3 ? 20 : 17;
      const dist0 = Math.max(spanV / (2 * tanH), spanW / (2 * tanH * Math.min(aspect, 2.4)));

      const targetAng = SEATS[seatIdx].rot;
      let dAng = targetAng - st.ang;
      dAng -= Math.round(dAng / (2 * Math.PI)) * 2 * Math.PI;
      st.ang += dAng * (1 - Math.exp(-3 * dt));
      const ca = Math.cos(st.ang);
      const sa = Math.sin(st.ang);

      const aiming = p.canAim && game.aim.active;
      let zoomT = 1,
        fxT = 0,
        fyT = 0,
        fzT = 0,
        pitchT = 0,
        yawT = 0,
        rate = 2.4;

      if (!reduce) {
        // pen follow cam
        const phase = game.phase;
        if (phase === "run" || phase === "settle") {
          let sx = 0,
            sz = 0,
            n = 0;
          for (let k = 0; k < game.n; k++) {
            const q = game.pens[k];
            if (q.speed > 0.8 || q.state === "air") {
              sx += q.x * ca - q.z * sa;
              sz += q.x * sa + q.z * ca;
              n++;
            }
          }
          if (n > 0) {
            st.tFx = clampN((sx / n) * 0.6, -2.2, 2.2);
            st.tFz = clampN((sz / n) * 0.6, -5, 5);
          }
          fxT = st.tFx;
          fzT = st.tFz;
          zoomT = phase === "run" ? 0.8 : 0.9;
          if (game.slowmo > 0.2) {
            const vx = game.slowX * ca - game.slowZ * sa;
            const vz = game.slowX * sa + game.slowZ * ca;
            fxT = clampN(vx * 0.8, -3, 3);
            fzT = clampN(vz * 0.8, -7, 7);
            zoomT = 0.6;
            fyT = 0.6;
            yawT = (vx > 0 ? -1 : 1) * 0.1;
            pitchT = -0.12;
            rate = 4.5;
          }
        } else {
          st.tFx = 0;
          st.tFz = 0;
        }
        // reactions
        const rw = p.roundWinner;
        const rk = rw == null ? "" : String(rw);
        if (rk !== st.lastWin) {
          st.lastWin = rk;
          st.winT = rk ? 0 : 99;
        }
        if (rw != null) {
          st.winT += dt;
          if (st.winT < 2.6) {
            if (rw === "draw") {
              zoomT = 1.2;
              rate = 1.6;
            } else {
              const ws = SEATS[Math.max(0, Math.min(3, Number(rw)))];
              // world seat position -> viewer frame
              fxT = ws.x * ca - ws.z * sa;
              fzT = ws.x * sa + ws.z * ca;
              fyT = 3.5;
              zoomT = 0.55;
              pitchT = -0.15;
              rate = 5.5;
            }
          }
        }
        if (aiming) {
          zoomT = 1;
          fxT = fyT = fzT = pitchT = yawT = 0;
          rate = 3;
        }
      }
      st.zoom = dampN(st.zoom, zoomT, rate, dt);
      st.fx = dampN(st.fx, fxT, rate, dt);
      st.fy = dampN(st.fy, fyT, rate, dt);
      st.fz = dampN(st.fz, fzT, rate, dt);
      st.pitchO = dampN(st.pitchO, pitchT, rate, dt);
      st.yawO = dampN(st.yawO, yawT, rate, dt);

      // intro dolly-in
      let iz = 0,
        ip = 0,
        iy = 0;
      if (!reduce) {
        st.introT += dt;
        const e = smooth(clampN(st.introT / 3.0, 0, 1));
        iz = (1 - e) * 0.4;
        ip = (1 - e) * 0.22;
        iy = (1 - e) * 0.4 * (seatIdx % 2 === 0 ? 1 : -1);
      }

      // hit / out events -> shake + fov punch
      if (game.hitSeq !== st.lastHit) {
        st.lastHit = game.hitSeq;
        if (!reduce) {
          st.shake = Math.min(1.3, st.shake + 0.45 + game.hitStrength * 0.7);
          st.kick = -3.2 * (0.5 + game.hitStrength);
        }
      }
      if (game.outSeq !== st.lastOut) {
        st.lastOut = game.outSeq;
        if (!reduce) st.shake = Math.min(1.3, st.shake + 0.5);
      }
      st.shake *= Math.exp(-6 * dt);
      st.kick = dampN(st.kick, 0, 7, dt);
      st.sway = dampN(st.sway, reduce || aiming ? 0 : p.canAim ? 0.3 : 1, 3, dt);

      fov = fov0 + st.kick;
      const pitch = pitch0 + st.pitchO + ip;
      const yaw = st.ang + st.yawO + iy;
      const dist = dist0 * (st.zoom + iz);
      const tx = st.fx;
      const tz = (side ? -0.2 : TARGET_Z) + st.fz;
      const wx = tx * ca + tz * sa;
      const wz = -tx * sa + tz * ca;
      lx = wx;
      ly = -0.5 + st.fy;
      lz = wz;
      const cp = Math.cos(pitch);
      px = lx + dist * Math.sin(yaw) * cp;
      py = ly + dist * Math.sin(pitch);
      pz = lz + dist * Math.cos(yaw) * cp;
      const t = state.clock.elapsedTime;
      const sw = st.sway;
      px += (Math.sin(t * 0.31) * 0.35 * ca) * sw;
      pz += (-Math.sin(t * 0.31) * 0.35 * sa) * sw;
      py += Math.sin(t * 0.23) * 0.2 * sw;
      if (st.shake > 0.002) {
        const a = st.shake * 0.28;
        px += Math.sin(t * 61) * a;
        py += Math.sin(t * 73 + 1) * a;
        pz += Math.sin(t * 53 + 2) * a;
      }
    }

    // keep the lobby camera clear of walls/furniture, never under desk height
    if (lobby) {
      px = clampN(px, -ROOM_X + 3, ROOM_X - 3);
      pz = clampN(pz, -ROOM_Z + 2.5, ROOM_Z - 2.5);
    }
    py = Math.max(py, 4);
    // cut-away: hide any wall the camera is outside of
    WALLS.near = pz < ROOM_Z - 0.6;
    WALLS.far = pz > -ROOM_Z + 0.6;
    WALLS.left = px > -ROOM_X + 0.6;
    WALLS.right = px < ROOM_X - 0.6;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.set(px, py, pz);
    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();
  });
  return null;
}

// ---------------------------------------------------------------------------
// Aiming interaction
// ---------------------------------------------------------------------------
const MIN_DRAG = 0.3;
const MAX_DRAG = 4.5;
const DOTS = 16;

function Aiming({ game, propsRef }: { game: Game; propsRef: React.RefObject<SceneProps> }) {
  const { gl, camera } = useThree();
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  const head = useRef<THREE.Mesh>(null);
  const band = useRef<THREE.Mesh>(null);
  const knob = useRef<THREE.Mesh>(null);
  const grp = useRef<THREE.Group>(null);
  const col = useMemo(() => new THREE.Color(), []);
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#7CFF6B", toneMapped: false, depthWrite: false }), []);

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "none";
    const ndc = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
    const hit = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    let dragging = false;
    let pid = -1;

    const toDesk = (e: PointerEvent, out: THREE.Vector3) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      const h = ray.ray.intersectPlane(plane, hit);
      if (!h) return false;
      out.copy(h);
      return true;
    };

    const compute = (e: PointerEvent) => {
      const cur = new THREE.Vector3();
      if (!toDesk(e, cur)) return false;
      const dx = cur.x - p0.x;
      const dz = cur.z - p0.z;
      const len = Math.hypot(dx, dz);
      const a = game.aim;
      const lenC = Math.min(len, MAX_DRAG);
      a.valid = len >= MIN_DRAG;
      let deg = (Math.atan2(-dz, -dx) * 180) / Math.PI;
      if (len < 1e-6) deg = 0;
      const half = (((Math.round(deg * 2) % 720) + 720) % 720) as number;
      a.angle = half;
      a.power = Math.max(1, Math.min(100, Math.round(8 + ((lenC - MIN_DRAG) / (MAX_DRAG - MIN_DRAG)) * 92)));
      a.ax = COS[half] / 1024;
      a.az = SIN[half] / 1024;
      const k = len > 1e-6 ? lenC / len : 0;
      a.bandX = dx * k;
      a.bandZ = dz * k;
      return true;
    };

    const down = (e: PointerEvent) => {
      unlockAudio();
      const p = propsRef.current;
      if (!p.canAim || dragging || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (!toDesk(e, p0)) return;
      dragging = true;
      pid = e.pointerId;
      try {
        el.setPointerCapture(pid);
      } catch {
        /* ignore */
      }
      game.aimSeat = p.seat;
      game.aim.active = true;
      game.aim.valid = false;
      game.aim.power = 1;
      game.aim.bandX = game.aim.bandZ = 0;
      const c = game.chars[p.seat];
      if (c.mode === "idle" || c.mode === "recover" || c.mode === "hold") {
        c.mode = "aim";
        c.t = 0;
      }
    };
    const move = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pid) return;
      compute(e);
    };
    const end = (e: PointerEvent, cancel: boolean) => {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
      const p = propsRef.current;
      if (!cancel && game.aim.active) compute(e);
      const a = game.aim;
      if (!cancel && a.active && a.valid && p.canAim) {
        game.release(p.seat, a.angle, a.power);
        p.onFlick(a.angle, a.power);
      } else game.cancelAim();
      a.active = false;
    };
    const up = (e: PointerEvent) => end(e, false);
    const cancel = (e: PointerEvent) => end(e, true);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [gl, camera, game, propsRef]);

  useFrame(() => {
    const g = grp.current;
    if (!g) return;
    const a = game.aim;
    const show = a.active;
    g.visible = show;
    if (!show) return;
    const pen = game.pens[game.aimSeat];
    const p = a.power / 100;
    col.setHSL(0.33 * (1 - p), 0.9, 0.52);
    dotMat.color.copy(col);
    const strongLen = 1.4 + p * 7.5;
    for (let i = 0; i < DOTS; i++) {
      const d = dots.current[i];
      if (!d) continue;
      const dist = 0.9 + i * 0.5;
      d.visible = a.valid && dist < strongLen;
      d.position.set(pen.x + a.ax * dist, 0.07, pen.z + a.az * dist);
      d.scale.setScalar(0.7 + (dist / strongLen) * 0.7);
    }
    const h = head.current;
    if (h) {
      h.visible = a.valid;
      h.position.set(pen.x + a.ax * (strongLen + 0.35), 0.07, pen.z + a.az * (strongLen + 0.35));
      h.rotation.set(0, -Math.atan2(a.az, a.ax), -Math.PI / 2, "YZX");
    }
    const len = Math.hypot(a.bandX, a.bandZ);
    const b = band.current;
    if (b) {
      b.visible = len > 0.05;
      b.position.set(pen.x + a.bandX / 2, 0.05, pen.z + a.bandZ / 2);
      b.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
      b.rotation.y = -Math.atan2(a.bandZ, a.bandX);
      b.scale.set(len, 1, 1);
    }
    const k = knob.current;
    if (k) {
      k.visible = len > 0.05;
      k.position.set(pen.x + a.bandX, 0.06, pen.z + a.bandZ);
    }
  });

  return (
    <group ref={grp} visible={false}>
      {Array.from({ length: DOTS }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            dots.current[i] = m;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          material={dotMat}
          renderOrder={6}
        >
          <circleGeometry args={[0.13, 10]} />
        </mesh>
      ))}
      <mesh ref={head} material={dotMat} renderOrder={6}>
        <coneGeometry args={[0.42, 0.8, 3]} />
      </mesh>
      <mesh ref={band} renderOrder={5}>
        <planeGeometry args={[1, 0.08]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.45} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={knob} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <ringGeometry args={[0.18, 0.3, 20]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Driver: pushes React props into the imperative game and runs it each frame
// ---------------------------------------------------------------------------
const LOOKS: CharacterLook[] = [
  { skin: "#e2a46f", hair: "#241a2e", body: SEAT_COLORS[0], sleeve: "#2f5fd6", accent: "#ffd23f", pants: "#4b5675", shoe: SEAT_COLORS[0], style: 0 },
  { skin: "#a9693f", hair: "#7a3fd6", body: SEAT_COLORS[1], sleeve: "#ffffff", accent: "#2ec4b6", pants: "#2b2f5c", shoe: SEAT_COLORS[1], style: 1 },
  { skin: "#c98a5c", hair: "#2a1c14", body: SEAT_COLORS[2], sleeve: "#0f8a5b", accent: "#ffd23f", pants: "#3a4a68", shoe: SEAT_COLORS[2], style: 2 },
  { skin: "#f0c09a", hair: "#3b2418", body: SEAT_COLORS[3], sleeve: "#ffffff", accent: "#ffd23f", pants: "#2b2f5c", shoe: SEAT_COLORS[3], style: 3 },
];

function World({ props }: { props: SceneProps }) {
  const propsRef = useRef(props);
  const game = useMemo(() => {
    const g = new Game();
    g.fx = new FX();
    return g;
  }, []);
  const info = useRef<CharInfo>({ turn: props.turn, roundWinner: props.roundWinner });

  useEffect(() => {
    propsRef.current = props;
    info.current = { turn: props.turn, roundWinner: props.roundWinner };
  });

  useEffect(() => {
    game.onEnd = (id) => propsRef.current.onFlickAnimationEnd?.(id);
    return () => {
      game.onEnd = null;
    };
  }, [game]);

  // new round -> drop pens in; otherwise snap to resting state
  const lastReset = useRef<string | null>(null);
  useEffect(() => {
    game.setCount(props.playerCount ?? props.pens.length);
    if (lastReset.current !== props.resetKey) {
      lastReset.current = props.resetKey;
      game.reset(props.pens);
    } else {
      game.setRest(props.pens);
    }
  }, [props.pens, props.resetKey, props.playerCount, game]);

  const lastFlick = useRef<string | null>(null);
  useEffect(() => {
    const f = props.flick;
    if (f && f.id !== lastFlick.current) {
      lastFlick.current = f.id;
      game.enqueue(f);
    }
  }, [props.flick, game]);

  const lastWinner = useRef<string>("");
  useEffect(() => {
    const k = props.roundWinner == null ? "" : String(props.roundWinner);
    if (k === lastWinner.current) return;
    lastWinner.current = k;
    if (typeof props.roundWinner === "number" && SEATS[props.roundWinner]) {
      const ws = SEATS[props.roundWinner];
      game.fx?.confettiBurst(ws.x * 0.6, 4, ws.z * 0.6, 90);
      game.fx?.confettiBurst(0, 6, 0, 60);
      game.fx?.sparkBurst(ws.x * 0.7, 5, ws.z * 0.7, 40, 7, 1, 0.9, 0.4);
    }
  }, [props.roundWinner, game]);

  useFrame((_, dt) => {
    const p = propsRef.current;
    game.update(dt, { turn: p.turn, canAim: p.canAim, seat: p.seat });
  });

  const n = Math.max(2, Math.min(4, props.playerCount ?? props.pens.length ?? 2));
  const nameKey = props.names.join("|");
  const scoreKey = props.score.join(",");
  const board: BoardData = useMemo(
    () => ({ names: props.names, score: props.score, targetWins: props.targetWins, round: props.round }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nameKey, scoreKey, props.targetWins, props.round],
  );

  return (
    <>
      <color attach="background" args={["#cfeaff"]} />
      <hemisphereLight args={["#e4f3ff", "#ffcfb0", 1.7]} />
      <directionalLight
        position={[-14, 30, 10]}
        intensity={3.4}
        color="#fff0d2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={5}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={4}
      />
      <directionalLight position={[16, 18, -10]} intensity={0.9} color="#b9c8ff" />
      <CameraRig game={game} propsRef={propsRef} />
      <Room data={board} playerCount={n} />
      <MainDesk playerCount={n} />
      {Array.from({ length: n }).map((_, i) => (
        <PenMesh key={`pen${i}`} game={game} idx={i} color={SEAT_COLORS[i]} />
      ))}
      {Array.from({ length: n }).map((_, i) => (
        <Character key={`ch${i}`} seat={i} game={game} infoRef={info} look={LOOKS[i]} />
      ))}
      <FXLayer fx={game.fx!} />
      <DustMotes />
      {/* Postprocessing is opt-in (?fx=1): on some Retina/Chrome GPUs the extra render
          targets made the canvas flash black rectangles. */}
      {fxEnabled() && (
        <EffectComposer multisampling={isManual() ? 0 : 2}>
          <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.95} luminanceSmoothing={0.25} />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <Vignette offset={0.35} darkness={0.4} />
        </EffectComposer>
      )}
      <Aiming game={game} propsRef={propsRef} />
      {isManual() && <ManualDriver game={game} />}
    </>
  );
}

const fxEnabled = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fx") === "1";

const isManual = () =>
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("manual");

/** Dev only (?manual=1): frames are advanced by hand via the data-pen-advance attribute so a hidden tab can be inspected. */
function ManualDriver({ game }: { game: Game }) {
  const advance = useThree((st) => st.advance);
  useEffect(() => {
    let t = 0;
    const run = (sec: number) => {
      const n = Math.max(1, Math.round(sec * 20));
      for (let i = 0; i < n; i++) {
        t += 1 / 20;
        advance(t);
      }
    };
    const el = document.documentElement;
    const mo = new MutationObserver(() => {
      const v = parseFloat(el.getAttribute("data-pen-advance") || "");
      if (!Number.isNaN(v)) {
        el.removeAttribute("data-pen-advance");
        run(v);
        el.setAttribute(
          "data-pen-debug",
          JSON.stringify({ pens: game.pens.map((q) => [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), q.state, +q.heading.toFixed(2)]), aim: game.aim, chars: game.chars.map((c) => [c.mode, +c.wind.toFixed(2), +c.lunge.toFixed(2)]), active: !!game.active }),
        );
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-pen-advance"] });
    run(0.05);
    return () => mo.disconnect();
  }, [advance, game]);
  return null;
}

// ---------------------------------------------------------------------------
// Error boundary + canvas
// ---------------------------------------------------------------------------
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[Scene] 3D scene failed to start", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#2e3a26",
            color: "#f3ecd2",
            font: "16px system-ui, sans-serif",
            textAlign: "center",
            padding: 24,
          }}
        >
          3D view unavailable (WebGL could not start). The game still works.
        </div>
      );
    }
    return this.props.children;
  }
}

export function Scene(props: SceneProps) {
  const manual = useMemo(() => isManual(), []);
  return (
    <SceneBoundary>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", touchAction: "none" }}>
        {/* cheap CSS vignette instead of a GPU pass */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background: "radial-gradient(ellipse at center, transparent 58%, rgba(30,16,60,0.28) 100%)",
          }}
        />
        <Canvas
          frameloop={manual ? "never" : "always"}
          shadows="percentage"
          dpr={manual ? 0.6 : [1, 1.5]}
          camera={{ fov: 40, near: 0.5, far: 200, position: [0, 24, 14] }}
          // Without the postprocessing pass, use hardware MSAA and the same neutral tone
          // mapping the scene was tuned for (R3F's default filmic mapping washes it out).
          flat
          gl={{ antialias: !fxEnabled(), powerPreference: "high-performance", preserveDrawingBuffer: manual }}
          onCreated={({ gl }) => {
            if (!fxEnabled()) {
              gl.toneMapping = THREE.NeutralToneMapping;
              gl.toneMappingExposure = 1;
            }
          }}
          style={{ touchAction: "none", display: "block" }}
        >
          <World props={props} />
        </Canvas>
      </div>
    </SceneBoundary>
  );
}

export default Scene;
