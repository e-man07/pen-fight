/* eslint-disable react-hooks/immutability */
"use client";

import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SEAT_Y, SEATS, dirToLocal, toLocal, type Game } from "./game";
import { makeToonGradient } from "./textures";

export interface CharInfo {
  turn: number | null;
  roundWinner: number | "draw" | null | undefined;
}

export interface CharacterLook {
  skin: string;
  hair: string;
  body: string;
  sleeve: string;
  accent: string;
  pants: string;
  shoe: string;
  style: 0 | 1 | 2 | 3;
}

/** neutral rest pose: hands on the lap / just over the character's own edge, off the playing area */
const REST_X = 1.5;
const REST_Y = 2.3;
const REST_Z = -1.4;
const L1 = 3.2;
const L2 = 3.0;
const DESK_LY = -SEAT_Y; // desk top height in character-local space

// ---- shared geometry (unit-ish, sized through scale) -----------------------
const capsuleZ = (r: number, len: number) => {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  return g;
};
const G = {
  sphere: new THREE.SphereGeometry(1, 24, 18),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  upper: capsuleZ(0.46, L1 - 0.2),
  fore: capsuleZ(0.31, L2 - 0.2),
  finger1: capsuleZ(0.15, 0.32),
  finger2: capsuleZ(0.13, 0.22),
  thumb: capsuleZ(0.14, 0.26),
  thigh: capsuleZ(0.62, 2.1),
  torso: new THREE.CapsuleGeometry(1, 2.0, 8, 22),
  calf: new THREE.CapsuleGeometry(0.5, 3.1, 6, 14),
  neck: new THREE.CapsuleGeometry(0.42, 0.3, 4, 10),
  ring: new THREE.TorusGeometry(1, 0.1, 8, 28),
  mouth: new THREE.TorusGeometry(0.36, 0.065, 6, 16, Math.PI),
  cap: new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, 1.6),
  octa: new THREE.OctahedronGeometry(1),
};

const GRAD = makeToonGradient(4);
const OUT = new THREE.MeshBasicMaterial({ color: "#2b1850", side: THREE.BackSide });
const WHITE = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const EYE = new THREE.MeshBasicMaterial({ color: "#1c1230" });
const MOUTH = new THREE.MeshBasicMaterial({ color: "#5a1d2b" });
const TONGUE = new THREE.MeshBasicMaterial({ color: "#ff7a8a" });
const BLUSH = new THREE.MeshBasicMaterial({ color: "#ff8fa3", transparent: true, opacity: 0.55, depthWrite: false });
const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD });

function Part({
  geo,
  mat,
  position,
  rotation,
  scale = [1, 1, 1],
  outline = 1.07,
}: {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  outline?: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geo} material={mat} scale={scale} castShadow />
      {outline > 0 && <mesh geometry={geo} material={OUT} scale={[scale[0] * outline, scale[1] * outline, scale[2] * outline]} />}
    </group>
  );
}

interface ArmRig {
  upper: THREE.Group | null;
  fore: THREE.Group | null;
  hand: THREE.Group | null;
  f1: THREE.Group | null;
  f2: THREE.Group | null;
}
function attach(rig: ArmRig, key: keyof ArmRig, g: THREE.Group | null) {
  rig[key] = g;
}
const makeRig = (): ArmRig => ({ upper: null, fore: null, hand: null, f1: null, f2: null });

function Arm({
  rig,
  skin,
  sleeve,
  accent,
  sx,
}: {
  rig: ArmRig;
  skin: THREE.Material;
  sleeve: THREE.Material;
  accent: THREE.Material;
  sx: number;
}) {
  return (
    <>
      <group ref={(g) => attach(rig, "upper", g)}>
        <Part geo={G.upper} mat={sleeve} scale={[1, 1, 1]} outline={1.16} />
        <Part geo={G.ring} mat={accent} position={[0, 0, L1 - 0.1]} scale={[0.5, 0.5, 0.9]} outline={0} />
      </group>
      <group ref={(g) => attach(rig, "fore", g)}>
        <Part geo={G.sphereLo} mat={skin} scale={[0.34, 0.34, 0.34]} outline={1.2} />
        <Part geo={G.fore} mat={skin} outline={1.2} />
      </group>
      <group ref={(g) => attach(rig, "hand", g)}>
        <Part geo={G.sphere} mat={skin} position={[0, 0, 0.42]} scale={[0.5, 0.4, 0.58]} outline={1.1} />
        <Part geo={G.sphereLo} mat={skin} position={[-sx * 0.08, -0.24, 0.82]} scale={[0.4, 0.28, 0.3]} outline={1.12} />
        <Part geo={G.thumb} mat={skin} position={[sx * 0.46, -0.02, 0.2]} rotation={[0, sx * 0.55, 0]} outline={1.2} />
        <group ref={(g) => attach(rig, "f1", g)} position={[sx * 0.2, 0.04, 0.78]}>
          <Part geo={G.finger1} mat={skin} outline={1.22} />
          <group ref={(g) => attach(rig, "f2", g)} position={[0, 0, 0.48]}>
            <Part geo={G.finger2} mat={skin} outline={1.22} />
          </group>
        </group>
      </group>
    </>
  );
}

// scratch
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _W = new THREE.Vector3();
const _E = new THREE.Vector3();
const _pole = new THREE.Vector3();

function solveArm(rig: ArmRig, S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, fingerAngle: number) {
  const d = _d.subVectors(T, S);
  const full = d.length() || 1;
  d.multiplyScalar(1 / full);
  _W.copy(T).addScaledVector(d, -1.75);
  const dir = _p.subVectors(_W, S);
  let dist = dir.length() || 1e-3;
  dir.multiplyScalar(1 / dist);
  dist = Math.min(Math.max(dist, Math.abs(L1 - L2) + 0.05), L1 + L2 - 0.02);
  _W.copy(S).addScaledVector(dir, dist);
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _pole.copy(pole);
  _pole.addScaledVector(dir, -_pole.dot(dir));
  if (_pole.lengthSq() < 1e-5) _pole.set(0, -1, 0);
  _pole.normalize();
  _E.copy(S).addScaledVector(dir, a).addScaledVector(_pole, h);

  const up = rig.upper;
  const fo = rig.fore;
  const ha = rig.hand;
  if (!up || !fo || !ha) return;
  up.position.copy(S);
  up.quaternion.setFromUnitVectors(Z, _d.subVectors(_E, S).normalize());
  fo.position.copy(_E);
  fo.quaternion.setFromUnitVectors(Z, _d.subVectors(_W, _E).normalize());
  ha.position.copy(_W);
  _d.subVectors(T, _W);
  if (_d.lengthSq() < 1e-4) _d.subVectors(_W, _E);
  ha.quaternion.setFromUnitVectors(Z, _d.normalize());
  if (rig.f1) rig.f1.rotation.x = fingerAngle;
  if (rig.f2) rig.f2.rotation.x = fingerAngle * 0.8 + 0.08;
}

interface Mood {
  mSY: number;
  mSX: number;
  mRot: number;
  mY: number;
  open: number;
  brow: number;
  browY: number;
  eye: number;
  eyeS: number;
}
const MOODS: Record<string, Mood> = {
  focus: { mSY: 0.12, mSX: 1.0, mRot: Math.PI, mY: 0.95, open: 0, brow: 0.22, browY: 2.62, eye: 1, eyeS: 1 },
  smug: { mSY: 0.8, mSX: 1.3, mRot: Math.PI + 0.2, mY: 1.0, open: 0, brow: -0.15, browY: 2.78, eye: 0.62, eyeS: 1 },
  happy: { mSY: 0.5, mSX: 1.5, mRot: Math.PI, mY: 1.0, open: 0.85, brow: -0.15, browY: 2.88, eye: 1, eyeS: 1.05 },
  sad: { mSY: 0.9, mSX: 1.0, mRot: 0, mY: 0.68, open: 0, brow: -0.45, browY: 2.65, eye: 0.7, eyeS: 1 },
  meh: { mSY: 0.07, mSX: 0.9, mRot: Math.PI, mY: 0.9, open: 0, brow: -0.05, browY: 2.7, eye: 0.78, eyeS: 1 },
  shock: { mSY: 0.1, mSX: 1, mRot: Math.PI, mY: 0.9, open: 1.0, brow: -0.3, browY: 3.0, eye: 1, eyeS: 1.3 },
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export function Character({
  seat,
  game,
  infoRef,
  look,
}: {
  seat: number;
  game: Game;
  infoRef: RefObject<CharInfo>;
  look: CharacterLook;
}) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Group>(null);
  const browR = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const openM = useRef<THREE.Group>(null);
  const rigR = useMemo(() => makeRig(), []);
  const rigL = useMemo(() => makeRig(), []);
  const m = useMemo(
    () => ({
      skin: toon(look.skin),
      hair: toon(look.hair),
      body: toon(look.body),
      bodyDark: toon(new THREE.Color(look.body).multiplyScalar(0.82).getStyle()),
      sleeve: toon(look.sleeve),
      accent: toon(look.accent),
      pants: toon(look.pants),
      shoe: toon("#ffffff"),
      sole: toon(look.shoe),
      glass: new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.3, metalness: 0.3 }),
    }),
    [look],
  );
  const st = useMemo(
    () => ({
      lean: 0,
      yaw: 0,
      pitch: 0,
      dirx: 0,
      dirz: -1,
      tipR: new THREE.Vector3(REST_X, REST_Y, REST_Z),
      tipL: new THREE.Vector3(-REST_X, REST_Y, REST_Z),
      nextBlink: 1.5,
      blink: 0,
      mood: { ...MOODS.focus },
      init: false,
      shock: 0,
      roll: 0,
      reach: 0,
    }),
    [],
  );

  const loc = useMemo(() => ({ x: 0, z: 0 }), []);
  const loc2 = useMemo(() => ({ x: 0, z: 0 }), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime + seat * 1.3;
    const c = game.chars[seat];
    const pv = game.pens[seat];
    const eliminated = pv.floorY < -1;
    const info = infoRef.current;
    const rw = info.roundWinner;
    const cel = rw == null ? 0 : rw === "draw" ? 3 : rw === seat ? 1 : 2;
    const down = eliminated && cel === 0;

    // is any pen about to go over the edge? -> shocked face
    let danger = 0;
    for (let k = 0; k < game.n; k++) {
      const q = game.pens[k];
      if (q.state === "desk" && q.speed > 2.5) {
        const edge = Math.min(3 - Math.abs(q.x), 6 - Math.abs(q.z));
        if (edge < 1.6) danger = 1;
      }
    }
    st.shock = damp(st.shock, danger, danger ? 14 : 5, dt);

    toLocal(seat, pv.x, pv.z, loc);
    const penLx = loc.x;
    const penLz = loc.z;
    const penOk = pv.state === "desk" && pv.speed < 1.5;

    const wantDir = c.mode === "idle" || c.mode === "recover" ? 1 : 0;
    dirToLocal(seat, c.aimX, c.aimZ, loc2);
    const tdx = wantDir ? 0 : loc2.x;
    const tdz = wantDir ? -1 : loc2.z;
    st.dirx = damp(st.dirx, tdx, 12, dt);
    st.dirz = damp(st.dirz, tdz, 12, dt);
    const dl = Math.hypot(st.dirx, st.dirz) || 1;
    const dx = st.dirx / dl;
    const dz = st.dirz / dl;

    // ---- right hand target (local space) ---------------------------------
    let tx: number, ty: number, tz: number;
    let useReach = false;
    let rate = 8;
    let finger = 0.5;
    if (cel === 1) {
      tx = 2.2;
      ty = DESK_LY + 6.2 + Math.sin(t * 10) * 0.9;
      tz = -1.2;
      finger = 0.2;
    } else if (cel === 2) {
      const hy = 0.5 + 6.6 * Math.cos(0.6);
      tx = 0.55;
      ty = hy + 0.1;
      tz = -6.6 * Math.sin(0.6) - 1.9;
      finger = 0.3;
    } else if (cel === 3) {
      tx = 2.6;
      ty = DESK_LY + 2.6;
      tz = -2.6;
    } else if (penOk) {
      useReach = true;
      const back0 = 0.85 + c.wind * 2.1;
      const back = back0 + (-0.2 - back0) * c.lunge;
      const hy0 = 0.28 + c.wind * 1.2;
      const hy = hy0 + (0.2 - hy0) * c.lunge;
      tx = penLx - dx * back;
      ty = DESK_LY + hy;
      tz = penLz - dz * back;
      rate = c.mode === "strike" ? 60 : 24;
      finger = 0.12 - 1.1 * c.wind + 0.63 * c.lunge;
      if (st.shock > 0.5) {
        ty += 1.8;
        finger = -0.5;
      }
    } else {
      tx = REST_X;
      ty = REST_Y + st.shock * 1.8;
      tz = REST_Z;
    }
    // the hand only reaches onto the desk on this player's turn / while aiming or striking;
    // otherwise (and right after the hit) it withdraws to the rest pose
    const flicking = c.mode === "aim" || c.mode === "auto" || c.mode === "strike" || c.mode === "hold" || (c.mode === "recover" && c.t < 0);
    const myTurn = info.turn === seat && cel === 0 && !eliminated && game.phase === "none" && c.mode === "idle";
    const reachT = cel === 0 && penOk && (flicking || myTurn) ? 1 : 0;
    st.reach = damp(st.reach, reachT, reachT > st.reach ? (c.mode === "strike" ? 40 : 9) : 9, dt);
    if (useReach) {
      const r = st.reach;
      tx = REST_X + (tx - REST_X) * r;
      ty = REST_Y + (ty - REST_Y) * r + 4 * r * (1 - r) * 1.1;
      tz = REST_Z + (tz - REST_Z) * r;
      finger = 0.5 + (finger - 0.5) * r;
      rate = 40;
    }
    if (!st.init) {
      st.tipR.set(tx, ty, tz);
      st.init = true;
    }
    st.tipR.x = damp(st.tipR.x, tx, rate, dt);
    st.tipR.y = damp(st.tipR.y, ty, rate, dt);
    st.tipR.z = damp(st.tipR.z, tz, rate, dt);

    // ---- left hand target ------------------------------------------------
    const rl = st.reach;
    let lx = -REST_X + (-1.6 + REST_X) * rl,
      ly = REST_Y + (DESK_LY + 0.25 - REST_Y) * rl + st.shock * 3.2,
      lz = REST_Z + (-3.4 - c.wind * 0.6 - REST_Z) * rl;
    if (st.shock > 0.4) {
      lx = -0.9;
      lz = -2.6;
    }
    if (cel === 1) {
      lx = -2.2;
      ly = DESK_LY + 5.8 + Math.sin(t * 10 + 1.8) * 0.9;
      lz = -1.2;
    } else if (cel === 2) {
      lx = -1.5;
      ly = DESK_LY + 0.3;
      lz = -3.2;
    } else if (cel === 3) {
      lx = -2.6;
      ly = DESK_LY + 2.6;
      lz = -2.6;
    }
    st.tipL.x = damp(st.tipL.x, lx, 9, dt);
    st.tipL.y = damp(st.tipL.y, ly, 9, dt);
    st.tipL.z = damp(st.tipL.z, lz, 9, dt);

    // ---- torso lean ------------------------------------------------------
    let leanT = clamp((-st.tipR.z - 4.3) / 5, 0, 1) * 0.45 + c.wind * 0.08;
    if (cel === 1) leanT = -0.12;
    if (cel === 2) leanT = 0.62 + Math.sin(t * 1.4) * 0.03;
    if (st.shock > 0.4 && cel === 0) leanT = -0.18;
    if (down) leanT = 0.4;
    st.lean = damp(st.lean, leanT, cel === 1 ? 12 : 6, dt);
    const cl = Math.cos(st.lean);
    const sl = Math.sin(st.lean);
    const bounce = cel === 1 ? Math.abs(Math.sin(t * 8)) * 0.8 : 0;
    const breath = Math.sin(t * 1.7) * 0.035;
    st.roll = damp(st.roll, cel === 1 ? Math.sin(t * 8) * 0.09 : cel === 2 ? Math.sin(t * 1.1) * 0.04 : 0, 10, dt);
    if (root.current) root.current.position.y = SEAT_Y + bounce;
    if (torso.current) {
      torso.current.rotation.set(-st.lean, 0, st.roll);
      torso.current.position.y = 0.5 + breath;
      const squash = cel === 1 ? 1 + Math.sin(t * 16) * 0.025 : 1;
      torso.current.scale.set(1 + breath * 0.25, (1 + breath * 0.2) * squash, 1);
    }

    _S.set(1.35, 0.5 + 4.3 * cl + breath, -4.3 * sl);
    _T.copy(st.tipR);
    _pole.set(0.9, -0.7, 0.5);
    if (cel === 1) _pole.set(1, -0.3, 0.6);
    solveArm(rigR, _S, _T, _pole, finger);
    _S.set(-1.35, 0.5 + 4.3 * cl + breath, -4.3 * sl);
    _T.copy(st.tipL);
    _pole.set(-0.9, -0.7, 0.5);
    solveArm(rigL, _S, _T, _pole, cel === 1 ? 0.2 : 0.45);

    // ---- head look --------------------------------------------------------
    const mw = game.movingWho;
    let tgt = pv;
    if (mw != null) tgt = game.pens[mw];
    else if (info.turn != null && info.turn !== seat && info.turn < game.n) tgt = game.pens[info.turn];
    else if (info.turn !== seat) {
      let best = 1e9;
      for (let k = 0; k < game.n; k++) {
        if (k === seat) continue;
        const q = game.pens[k];
        const dd = Math.hypot(q.x - pv.x, q.z - pv.z);
        if (q.floorY > -1 && dd < best) {
          best = dd;
          tgt = q;
        }
      }
    }
    toLocal(seat, tgt.x, tgt.z, loc2);
    const gx = loc2.x;
    const gz = loc2.z;
    const gy = tgt.y - SEAT_Y;
    const hy = 0.5 + 6.6 * cl;
    const hz = -6.6 * sl;
    let yawT = clamp(-Math.atan2(gx, -(gz - hz)), -0.8, 0.8);
    let pitchDown = clamp(Math.atan2(hy - gy, Math.hypot(gx, gz - hz)), 0, 0.95);
    if (cel === 1) {
      yawT = Math.sin(t * 2.4) * 0.35;
      pitchDown = -0.2;
    } else if (cel === 2) {
      yawT = 0.25;
      pitchDown = 0.9;
    } else if (down) {
      yawT = 0.15;
      pitchDown = 0.75;
    }
    st.yaw = damp(st.yaw, yawT, 8, dt);
    st.pitch = damp(st.pitch, pitchDown, 8, dt);
    if (head.current) {
      head.current.rotation.set(st.lean - st.pitch + Math.sin(t * 0.9) * 0.02, st.yaw, Math.sin(t * 0.7) * 0.03 + (cel === 1 ? Math.sin(t * 8) * 0.07 : 0));
    }

    // ---- face -------------------------------------------------------------
    let mood = "focus";
    if (cel === 1) mood = "happy";
    else if (cel === 2) mood = "sad";
    else if (cel === 3) mood = "meh";
    else if (down) mood = "sad";
    else if (st.shock > 0.45) mood = "shock";
    else if (info.turn != null && info.turn !== seat && game.n === 2) mood = "smug";
    const M = MOODS[mood];
    const q = st.mood;
    const r = 11;
    q.mSY = damp(q.mSY, M.mSY, r, dt);
    q.mSX = damp(q.mSX, M.mSX, r, dt);
    q.mRot = damp(q.mRot, M.mRot, r, dt);
    q.mY = damp(q.mY, M.mY, r, dt);
    q.open = damp(q.open, M.open, r, dt);
    q.brow = damp(q.brow, M.brow, r, dt);
    q.browY = damp(q.browY, M.browY, r, dt);
    q.eye = damp(q.eye, M.eye, r, dt);
    q.eyeS = damp(q.eyeS, M.eyeS, r, dt);
    if (mouth.current) {
      mouth.current.visible = q.open < 0.3;
      mouth.current.rotation.z = q.mRot;
      mouth.current.scale.set(q.mSX, Math.max(0.06, q.mSY), 1);
      mouth.current.position.y = q.mY;
    }
    if (openM.current) {
      openM.current.visible = q.open >= 0.3;
      openM.current.position.y = q.mY - 0.05;
      openM.current.scale.set(1 + q.open * 0.2, q.open, 1);
    }
    if (browR.current) {
      browR.current.rotation.z = q.brow;
      browR.current.position.y = q.browY;
    }
    if (browL.current) {
      browL.current.rotation.z = -q.brow;
      browL.current.position.y = q.browY;
    }
    st.nextBlink -= dt;
    if (st.nextBlink < 0) {
      st.blink = 0.14;
      st.nextBlink = 2 + Math.random() * 3.5;
    }
    st.blink = Math.max(0, st.blink - dt);
    const blinkF = st.blink > 0 ? 0.08 : 1;
    if (eyes.current) eyes.current.scale.set(q.eyeS, Math.max(0.08, q.eye * blinkF) * q.eyeS, 1);
  });

  const sty = look.style;

  return (
    <group ref={root} position={[SEATS[seat].x, SEAT_Y, SEATS[seat].z]} rotation={[0, SEATS[seat].rot, 0]}>
      {/* pelvis + legs */}
      <Part geo={G.sphere} mat={m.pants} position={[0, 0.35, 0]} scale={[1.55, 0.9, 1.15]} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part geo={G.thigh} mat={m.pants} position={[s * 0.78, 0.5, -0.2]} rotation={[0, Math.PI, 0]} />
          <Part geo={G.calf} mat={m.pants} position={[s * 0.78, -1.9, -2.9]} />
          <Part geo={G.sphere} mat={m.shoe} position={[s * 0.78, -4.1, -3.15]} scale={[0.85, 0.5, 1.35]} />
          <Part geo={G.sphere} mat={m.sole} position={[s * 0.78, -4.35, -3.15]} scale={[0.88, 0.2, 1.4]} outline={1.04} />
          {sty === 2 && <Part geo={G.sphere} mat={m.shoe} position={[s * 0.78, -3.75, -2.95]} scale={[0.7, 0.65, 0.7]} outline={1.06} />}
        </group>
      ))}

      {/* torso (pivot at hips) */}
      <group ref={torso} position={[0, 0.5, 0]}>
        <Part geo={G.torso} mat={m.body} position={[0, 2.15, 0]} scale={[1.38, 1.0, 0.85]} outline={1.05} />
        <Part geo={G.sphere} mat={m.bodyDark} position={[0, 4.35, 0.75]} scale={[1.05, 0.65, 0.65]} />
        <Part geo={G.sphere} mat={m.bodyDark} position={[0, 1.3, -1.12]} scale={[1.0, 0.5, 0.18]} outline={0} />
        <Part geo={G.sphere} mat={m.accent} position={[0, 3.0, -1.18]} scale={[0.42, 0.42, 0.08]} outline={0} />
        {[-1, 1].map((s) => (
          <Part key={s} geo={G.sphereLo} mat={m.accent} position={[s * 0.42, 3.55, -1.1]} scale={[0.1, 0.5, 0.1]} outline={0} />
        ))}
        <Part geo={G.neck} mat={m.skin} position={[0, 4.65, 0]} />
        {(sty === 1 || sty === 3) && (
          // varsity / jacket collar
          <Part geo={G.ring} mat={m.accent} position={[0, 4.35, -0.05]} rotation={[Math.PI / 2, 0, 0]} scale={[0.82, 0.82, 1.4]} outline={0} />
        )}
        {sty === 2 && (
          // hoodie drawstring collar
          <Part geo={G.ring} mat={m.bodyDark} position={[0, 4.35, 0.1]} rotation={[Math.PI / 2, 0, 0]} scale={[0.95, 0.95, 1.6]} outline={0} />
        )}
        {sty === 0 && (
          // headphones around the neck
          <>
            <Part geo={G.ring} mat={m.accent} position={[0, 4.5, 0.05]} rotation={[Math.PI / 2, 0, 0]} scale={[0.98, 0.9, 1.9]} outline={0} />
            {[-1, 1].map((s) => (
              <Part key={s} geo={G.sphere} mat={m.accent} position={[s * 1.05, 4.2, -0.55]} scale={[0.34, 0.42, 0.42]} outline={1.08} />
            ))}
          </>
        )}
        {[-1, 1].map((s) => (
          <Part key={s} geo={G.sphere} mat={m.sleeve} position={[s * 1.35, 4.3, 0]} scale={[0.62, 0.62, 0.62]} outline={1.1} />
        ))}

        {/* head */}
        <group ref={head} position={[0, 4.95, 0]} scale={0.86}>
          <Part geo={G.sphere} mat={m.skin} position={[0, 1.65, 0]} scale={[1.78, 1.66, 1.68]} outline={1.04} />
          {[-1, 1].map((s) => (
            <Part key={s} geo={G.sphere} mat={m.skin} position={[s * 1.74, 1.55, 0.05]} scale={[0.26, 0.36, 0.3]} outline={1.1} />
          ))}
          {/* cheeks */}
          {[-1, 1].map((s) => (
            <mesh key={s} geometry={G.sphereLo} material={BLUSH} position={[s * 1.0, 1.15, -1.55]} scale={[0.34, 0.2, 0.08]} />
          ))}
          <mesh geometry={G.sphereLo} material={m.skin} position={[0, 1.35, -1.72]} scale={[0.2, 0.17, 0.17]} />
          {/* eyes */}
          <group ref={eyes} position={[0, 1.78, 0]}>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.68, 0, -1.5]}>
                <mesh geometry={G.sphere} material={EYE} scale={[0.36, 0.46, 0.2]} />
                <mesh geometry={G.sphereLo} material={WHITE} position={[0.1 * s, 0.17, -0.17]} scale={[0.12, 0.12, 0.06]} />
                <mesh geometry={G.sphereLo} material={WHITE} position={[-0.09 * s, -0.12, -0.18]} scale={[0.06, 0.06, 0.04]} />
              </group>
            ))}
          </group>
          {/* brows */}
          <group ref={browR} position={[0.68, 2.62, -1.5]}>
            <Part geo={G.sphereLo} mat={m.hair} scale={[0.4, 0.075, 0.08]} outline={0} />
          </group>
          <group ref={browL} position={[-0.68, 2.62, -1.5]}>
            <Part geo={G.sphereLo} mat={m.hair} scale={[0.4, 0.075, 0.08]} outline={0} />
          </group>
          <mesh ref={mouth} geometry={G.mouth} material={MOUTH} position={[0, 0.95, -1.6]} rotation={[0, 0, Math.PI]} />
          <group ref={openM} position={[0, 0.9, -1.6]} visible={false}>
            <mesh geometry={G.sphere} material={MOUTH} scale={[0.34, 0.3, 0.12]} />
            <mesh geometry={G.sphereLo} material={TONGUE} position={[0, -0.12, -0.03]} scale={[0.2, 0.1, 0.07]} />
          </group>

          {/* hair */}
          {sty === 0 && (
            <>
              <Part geo={G.cap} mat={m.hair} position={[0, 1.7, 0.1]} rotation={[0.45, 0, 0]} scale={[1.86, 1.76, 1.78]} outline={1.03} />
              {[
                [0, 3.45, 0.2, 0.95],
                [-0.9, 3.25, 0.3, 0.8],
                [0.9, 3.25, 0.3, 0.8],
                [-1.5, 2.6, 0.6, 0.7],
                [1.5, 2.6, 0.6, 0.7],
                [0, 3.0, 1.1, 0.85],
                [-1.0, 2.5, 1.3, 0.75],
                [1.0, 2.5, 1.3, 0.75],
                [0, 2.1, 1.6, 0.8],
              ].map(([x, y, z, r], i) => (
                <Part key={i} geo={G.sphereLo} mat={m.hair} position={[x, y, z]} scale={[r, r, r]} outline={1.07} />
              ))}
              <Part geo={G.ring} mat={m.accent} position={[0, 2.5, 0.0]} rotation={[1.95, 0, 0]} scale={[1.6, 1.6, 1.2]} outline={0} />
            </>
          )}
          {sty === 1 && (
            <>
              <Part geo={G.cap} mat={m.hair} position={[0, 1.7, 0.1]} rotation={[0.35, 0, 0]} scale={[1.9, 1.8, 1.82]} outline={1.03} />
              <Part geo={G.sphere} mat={m.hair} position={[0, 0.9, 0.75]} scale={[1.95, 1.65, 1.35]} outline={1.04} />
              {[-1, 1].map((s) => (
                <Part key={s} geo={G.sphere} mat={m.hair} position={[s * 1.62, 1.1, -0.3]} scale={[0.42, 1.05, 0.7]} outline={1.07} />
              ))}
              <Part geo={G.sphere} mat={m.hair} position={[0, 2.78, -1.15]} rotation={[0.45, 0, 0.1]} scale={[1.45, 0.38, 0.55]} outline={1.06} />
              <Part geo={G.octa} mat={m.accent} position={[1.1, 2.7, -1.2]} scale={[0.26, 0.26, 0.1]} outline={0} />
              {[-1, 1].map((s) => (
                <mesh key={s} geometry={G.ring} material={m.glass} position={[s * 0.68, 1.78, -1.62]} scale={[0.52, 0.52, 0.6]} />
              ))}
              <mesh geometry={G.sphereLo} material={m.glass} position={[0, 1.82, -1.66]} scale={[0.2, 0.05, 0.05]} />
            </>
          )}
          {sty === 2 && (
            <>
              <Part geo={G.cap} mat={m.hair} position={[0, 1.7, 0.1]} rotation={[0.45, 0, 0]} scale={[1.84, 1.74, 1.76]} outline={1.03} />
              {/* backwards cap */}
              <Part geo={G.cap} mat={m.accent} position={[0, 1.9, 0.1]} rotation={[0.15, 0, 0]} scale={[1.9, 1.75, 1.85]} outline={1.03} />
              <Part geo={G.sphere} mat={m.accent} position={[0, 2.35, 1.9]} rotation={[-0.15, 0, 0]} scale={[1.1, 0.14, 0.8]} outline={1.1} />
            </>
          )}
          {sty === 3 && (
            <>
              <Part geo={G.cap} mat={m.hair} position={[0, 1.7, 0.1]} rotation={[0.35, 0, 0]} scale={[1.9, 1.8, 1.82]} outline={1.03} />
              {[-1, 1].map((s) => (
                <Part key={s} geo={G.sphere} mat={m.hair} position={[s * 1.25, 3.45, 0.2]} scale={[0.8, 0.8, 0.8]} outline={1.07} />
              ))}
              {[-1, 1].map((s) => (
                <Part key={s} geo={G.ring} mat={m.accent} position={[s * 1.15, 3.0, 0.2]} rotation={[0.4, 0.3 * s, 0]} scale={[0.5, 0.5, 1.2]} outline={0} />
              ))}
              <Part geo={G.sphere} mat={m.hair} position={[0, 1.3, 2.0]} scale={[0.6, 1.5, 0.6]} outline={1.07} />
              <Part geo={G.sphere} mat={m.hair} position={[0, 2.78, -1.15]} rotation={[0.45, 0, -0.1]} scale={[1.45, 0.38, 0.55]} outline={1.06} />
              {[-1, 1].map((s) => (
                <Part key={s} geo={G.sphere} mat={m.accent} position={[s * 1.88, 1.55, 0.05]} scale={[0.34, 0.66, 0.66]} outline={1.08} />
              ))}
            </>
          )}
        </group>
      </group>

      <Arm rig={rigR} skin={m.skin} sleeve={m.sleeve} accent={m.accent} sx={1} />
      <Arm rig={rigL} skin={m.skin} sleeve={m.sleeve} accent={m.accent} sx={-1} />
    </group>
  );
}
