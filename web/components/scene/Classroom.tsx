/* eslint-disable react-hooks/immutability */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { FLOOR_Y, SEAT_Y, SEATS } from "./game";
import { SEAT_COLORS } from "@/lib/seats";
import {
  BOARD_H,
  BOARD_W,
  canvasTex,
  drawBoard,
  getAOTexture,
  makeBeamTexture,
  makeDeskTexture,
  makeFloorTexture,
  makeGlobeTexture,
  makePosterTexture,
  makeScreenTexture,
  makeShelfTexture,
  makeSkyTexture,
  makeWallTexture,
  type BoardData,
} from "./textures";

/** Walls the camera is currently outside of are hidden (dollhouse cut-away) so their back faces / thick trim never cover the view. */
export const WALLS = { near: true, far: true, left: true, right: true };
export const ROOM_Z = 14;
export const ROOM_X = 19;
const WALL_H = 26;
const WALL_CY = FLOOR_Y + WALL_H / 2;

const std = (color: string, roughness = 0.55, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// one shared material set (module level, created lazily in the browser)
let _M: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  return {
    white: std("#ffffff", 0.4),
    cream: std("#fff4e0", 0.7),
    navy: std("#2b2f5c", 0.5),
    metal: std("#d8def2", 0.35, { metalness: 0.5 }),
    teal: std("#2ec4b6", 0.45),
    coral: std("#ff6f61", 0.45),
    yellow: std("#ffc93c", 0.45),
    lilac: std("#a98bff", 0.45),
    blue: std("#4d8dff", 0.45),
    pink: std("#ff8fb8", 0.5),
    mint: std("#7be0b4", 0.5),
    wood: std("#e9b66e", 0.55),
    woodDark: std("#c98a4b", 0.6),
    leaf: std("#3fbf6a", 0.6),
    leafDark: std("#2a9a55", 0.6),
    pot: std("#ff9f6b", 0.6),
    strap: std("#2b2f5c", 0.8),
    paper: std("#fffaf0", 0.9),
    chalk: std("#fffdf6", 0.9),
    glassFrame: std("#ffffff", 0.35),
    door: std("#ff8a5b", 0.5),
    black: std("#252840", 0.5),
  };
}
const M = () => (_M ??= makeMats());

const DESK_COLORS = ["#ff7a6b", "#2ec4b6", "#ffc93c", "#a98bff"];

function AOBlob({ x, z, w, d, rot = 0, y = FLOOR_Y + 0.03, op = 1 }: { x: number; z: number; w: number; d: number; rot?: number; y?: number; op?: number }) {
  const tex = useMemo(() => getAOTexture(), []);
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, rot]} renderOrder={1}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} opacity={op} toneMapped={false} />
    </mesh>
  );
}

function Laptop({ pos, rot = 0, hue }: { pos: [number, number, number]; rot?: number; hue: number }) {
  const m = M();
  const tex = useMemo(() => makeScreenTexture(hue), [hue]);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RoundedBox args={[2.2, 0.12, 1.5]} radius={0.05} position={[0, 0.06, 0]} material={m.metal} castShadow />
      <group position={[0, 0.12, -0.7]} rotation={[-0.25, 0, 0]}>
        <RoundedBox args={[2.2, 1.45, 0.08]} radius={0.04} position={[0, 0.72, 0]} material={m.metal} castShadow />
        <mesh position={[0, 0.72, 0.05]}>
          <planeGeometry args={[2.0, 1.25]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function Plush({ pos, color, ear = "#ffd6e0" }: { pos: [number, number, number]; color: string; ear?: string }) {
  const mat = useMemo(() => std(color, 0.9), [color]);
  const earMat = useMemo(() => std(ear, 0.9), [ear]);
  return (
    <group position={pos}>
      <mesh castShadow material={mat} position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.55, 14, 12]} />
      </mesh>
      <mesh castShadow material={mat} position={[0, 1.2, 0]}>
        <sphereGeometry args={[0.42, 14, 12]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow material={mat} position={[s * 0.22, 1.7, 0]} scale={[0.5, 1.2, 0.5]}>
          <sphereGeometry args={[0.26, 10, 8]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} material={earMat} position={[s * 0.22, 1.7, -0.08]} scale={[0.28, 0.9, 0.2]}>
          <sphereGeometry args={[0.26, 10, 8]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.16, 1.25, -0.38]}>
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshBasicMaterial color="#2b2f5c" />
        </mesh>
      ))}
    </group>
  );
}

function Bottle({ pos, color }: { pos: [number, number, number]; color: string }) {
  const mat = useMemo(() => std(color, 0.35), [color]);
  const m = M();
  return (
    <group position={pos}>
      <mesh castShadow material={mat} position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.32, 1.1, 6, 14]} />
      </mesh>
      <mesh castShadow material={m.white} position={[0, 1.78, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.28, 12]} />
      </mesh>
    </group>
  );
}

function PencilCup({ pos, color }: { pos: [number, number, number]; color: string }) {
  const mat = useMemo(() => std(color, 0.5), [color]);
  const m = M();
  const cols = [m.coral, m.yellow, m.teal, m.lilac, m.blue];
  return (
    <group position={pos}>
      <mesh castShadow material={mat} position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.45, 0.4, 0.9, 14]} />
      </mesh>
      {cols.map((c, i) => (
        <mesh key={i} castShadow material={c} position={[Math.cos(i * 1.3) * 0.2, 1.15, Math.sin(i * 1.3) * 0.2]} rotation={[Math.sin(i) * 0.25, 0, Math.cos(i * 2) * 0.25]}>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 6]} />
        </mesh>
      ))}
    </group>
  );
}

function Headphones({ pos, color, rot = 0 }: { pos: [number, number, number]; color: string; rot?: number }) {
  const mat = useMemo(() => std(color, 0.4), [color]);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <mesh castShadow material={mat} position={[0, 0.75, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.7, 0.07, 8, 20, Math.PI]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow material={mat} position={[s * 0.7, 0.72, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.33, 0.33, 0.28, 14]} />
        </mesh>
      ))}
    </group>
  );
}

function Notebooks({ pos, rot = 0 }: { pos: [number, number, number]; rot?: number }) {
  const m = M();
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RoundedBox args={[1.9, 0.32, 2.5]} radius={0.06} position={[0, 0.16, 0]} material={m.blue} castShadow />
      <RoundedBox args={[1.8, 0.28, 2.4]} radius={0.06} position={[0.05, 0.46, 0.05]} rotation={[0, 0.2, 0]} material={m.yellow} castShadow />
      <RoundedBox args={[1.7, 0.26, 2.2]} radius={0.06} position={[-0.05, 0.73, 0]} rotation={[0, -0.15, 0]} material={m.coral} castShadow />
    </group>
  );
}

function Backpack({ pos, rot = 0, color, dark }: { pos: [number, number, number]; rot?: number; color: string; dark: string }) {
  const m = M();
  const body = useMemo(() => std(color, 0.5), [color]);
  const pocket = useMemo(() => std(dark, 0.5), [dark]);
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <RoundedBox args={[2.6, 3.5, 1.5]} radius={0.62} smoothness={4} material={body} castShadow />
      <RoundedBox args={[2.0, 1.5, 0.55]} radius={0.25} position={[0, -0.7, -0.85]} material={pocket} castShadow />
      <RoundedBox args={[2.2, 0.8, 0.35]} radius={0.17} position={[0, 0.9, -0.82]} material={pocket} castShadow />
      <mesh material={m.strap} position={[0, 2.0, 0.2]}>
        <torusGeometry args={[0.5, 0.11, 6, 12]} />
      </mesh>
      {/* keychain */}
      <mesh position={[0.9, -1.6, -0.95]} material={m.yellow}>
        <sphereGeometry args={[0.16, 8, 8]} />
      </mesh>
      <mesh position={[0.9, -2.0, -0.95]} material={m.pink}>
        <capsuleGeometry args={[0.1, 0.3, 4, 8]} />
      </mesh>
    </group>
  );
}

function Desk({
  pos,
  color,
  len = 9,
  wid = 3.4,
  children,
}: {
  pos: [number, number, number];
  color: string;
  len?: number;
  wid?: number;
  children?: React.ReactNode;
}) {
  const m = M();
  const top = useMemo(() => std(color, 0.4), [color]);
  const edge = useMemo(() => std(new THREE.Color(color).multiplyScalar(0.8).getStyle(), 0.5), [color]);
  const h = -FLOOR_Y;
  return (
    <group position={pos}>
      <RoundedBox args={[len, 0.4, wid]} radius={0.17} smoothness={4} position={[0, -0.2, 0]} material={edge} castShadow receiveShadow />
      <RoundedBox args={[len - 0.14, 0.1, wid - 0.14]} radius={0.05} position={[0, -0.02, 0]} material={top} receiveShadow />
      {[-1, 1].map((sx) => (
        <group key={sx}>
          {[-1, 1].map((sz) => (
            <mesh key={sz} castShadow position={[sx * (len / 2 - 0.55), -h / 2 - 0.2, sz * (wid / 2 - 0.45)]} material={m.white}>
              <capsuleGeometry args={[0.17, h - 0.9, 4, 10]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh castShadow position={[0, -3.2, 0]} material={m.metal}>
        <boxGeometry args={[len - 1.1, 0.16, 0.16]} />
      </mesh>
      {children}
    </group>
  );
}

function Plant({ pos, scale = 1 }: { pos: [number, number, number]; scale?: number }) {
  const m = M();
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    const t = st.clock.elapsedTime;
    g.children.forEach((c, i) => {
      c.rotation.z = Math.sin(t * 1.1 + i * 1.7) * 0.07 + (i % 2 ? 0.45 : -0.45) * 0.6;
    });
  });
  return (
    <group position={pos} scale={scale}>
      <mesh castShadow material={m.pot} position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.85, 0.6, 1.4, 14]} />
      </mesh>
      <group ref={ref} position={[0, 1.4, 0]}>
        {Array.from({ length: 7 }).map((_, i) => (
          <group key={i} rotation={[0, i * 0.9, 0]}>
            <mesh castShadow material={i % 2 ? m.leaf : m.leafDark} position={[0, 0.9, 0]} scale={[0.32, 1.1, 0.12]}>
              <sphereGeometry args={[1, 10, 8]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Clock({ pos }: { pos: [number, number, number] }) {
  const m = M();
  const sec = useRef<THREE.Mesh>(null);
  const tex = useMemo(
    () =>
      canvasTex(128, 128, (g) => {
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc(64, 64, 62, 0, 6.28);
        g.fill();
        g.fillStyle = "#2b2f5c";
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 6.28;
          g.beginPath();
          g.arc(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50, i % 3 ? 2.5 : 4.5, 0, 6.28);
          g.fill();
        }
        g.strokeStyle = "#2b2f5c";
        g.lineCap = "round";
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(64, 64);
        g.lineTo(64 - 20, 64 - 18);
        g.stroke();
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(64, 64);
        g.lineTo(64 + 5, 64 - 40);
        g.stroke();
      }),
    [],
  );
  useFrame((st) => {
    if (sec.current) sec.current.rotation.z = -Math.floor(st.clock.elapsedTime) * (Math.PI / 30);
  });
  return (
    <group position={pos}>
      <mesh material={m.coral}>
        <cylinderGeometry args={[1.05, 1.05, 0.2, 28]} />
      </mesh>
      <mesh position={[0, 0, 0.11]} rotation={[0, 0, 0]}>
        <circleGeometry args={[0.92, 28]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh ref={sec} position={[0, 0, 0.14]}>
        <boxGeometry args={[0.04, 1.6, 0.02]} />
        <meshBasicMaterial color="#ff4d6d" />
      </mesh>
    </group>
  );
}

function Pennants({ y = 6, w = 28, n = 16 }: { y?: number; w?: number; n?: number }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const palette = ["#ff6f91", "#6c8cff", "#2ec4b6", "#ffc93c", "#a98bff", "#ff9f6b"].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x0 = -w / 2 + u * w;
      const x1 = x0 + (w / n) * 0.8;
      const sag = (a: number) => -Math.sin(((a + w / 2) / w) * Math.PI) * 1.2;
      const y0 = y + sag(x0);
      const y1 = y + sag(x1);
      pos.push(x0, y0, 0, x1, y1, 0, (x0 + x1) / 2, Math.min(y0, y1) - 1.4, 0);
      const c = palette[i % palette.length];
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [y, w, n]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (ref.current) ref.current.rotation.z = Math.sin(st.clock.elapsedTime * 0.8) * 0.004;
  });
  return (
    <mesh ref={ref} geometry={geo}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function Globe({ pos }: { pos: [number, number, number] }) {
  const m = M();
  const tex = useMemo(() => makeGlobeTexture(), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.25;
  });
  return (
    <group position={pos}>
      <mesh material={m.coral} position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.6, 0.75, 0.3, 14]} />
      </mesh>
      <mesh material={m.metal} position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 1.3, 6]} />
      </mesh>
      <mesh ref={ref} castShadow position={[0, 1.75, 0]} rotation={[0, 0, 0.4]}>
        <sphereGeometry args={[0.95, 22, 16]} />
        <meshStandardMaterial map={tex} roughness={0.4} />
      </mesh>
    </group>
  );
}

function StringLights({ from, to, n = 22, sag = 1.6 }: { from: [number, number, number]; to: [number, number, number]; n?: number; sag?: number }) {
  const matA = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd27a"), toneMapped: false }), []);
  const matB = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff9ec7"), toneMapped: false }), []);
  const matC = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#8fe9ff"), toneMapped: false }), []);
  const mats = [matA, matB, matC];
  const bulbs = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      out.push([
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u - Math.sin(u * Math.PI) * sag,
        from[2] + (to[2] - from[2]) * u,
      ]);
    }
    return out;
  }, [from, to, n, sag]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    matA.color.setRGB(1.5, 1.05, 0.5).multiplyScalar(0.75 + 0.35 * Math.sin(t * 2.2));
    matB.color.setRGB(1.5, 0.7, 1.0).multiplyScalar(0.75 + 0.35 * Math.sin(t * 2.2 + 2.1));
    matC.color.setRGB(0.6, 1.3, 1.6).multiplyScalar(0.75 + 0.35 * Math.sin(t * 2.2 + 4.2));
  });
  return (
    <group>
      {bulbs.map((p, i) => (
        <mesh key={i} position={p} material={mats[i % 3]}>
          <sphereGeometry args={[0.2, 8, 6]} />
        </mesh>
      ))}
    </group>
  );
}

function Window({ pos, sky }: { pos: [number, number, number]; sky: THREE.Texture }) {
  const m = M();
  return (
    <group position={pos}>
      <mesh>
        <planeGeometry args={[4.4, 5]} />
        <meshBasicMaterial map={sky} toneMapped={false} />
      </mesh>
      <RoundedBox args={[0.3, 5.3, 0.3]} radius={0.1} position={[0, 0, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[4.7, 0.3, 0.3]} radius={0.1} position={[0, 0, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[4.7, 0.3, 0.3]} radius={0.1} position={[0, 2.6, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[4.7, 0.3, 0.3]} radius={0.1} position={[0, -2.6, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[0.3, 5.3, 0.3]} radius={0.1} position={[-2.3, 0, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[0.3, 5.3, 0.3]} radius={0.1} position={[2.3, 0, 0.1]} material={m.glassFrame} />
      <RoundedBox args={[5.2, 0.3, 0.9]} radius={0.12} position={[0, -2.85, 0.35]} material={m.glassFrame} />
    </group>
  );
}

function LightBeam({ pos, rotY = 0, w = 4.5, len = 20, op = 0.55 }: { pos: [number, number, number]; rotY?: number; w?: number; len?: number; op?: number }) {
  const tex = useMemo(() => makeBeamTexture(), []);
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => {
    if (ref.current) ref.current.opacity = op * (0.85 + 0.15 * Math.sin(st.clock.elapsedTime * 0.5 + pos[2]));
  });
  return (
    <mesh position={pos} rotation={[0, rotY, 0.913]} renderOrder={4}>
      <planeGeometry args={[w, len]} />
      <meshBasicMaterial ref={ref} map={tex} transparent opacity={op} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

/** One end wall (board, shelf, posters, plants...). Rotated by PI for the near end. */
function EndWall({ boardTex, wallTex, poster }: { boardTex: THREE.CanvasTexture; wallTex: THREE.Texture; poster: THREE.Texture[] }) {
  const m = M();
  const shelfTex = useMemo(() => makeShelfTexture(), []);
  const faceMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, emissive: new THREE.Color("#ffffff"), emissiveMap: boardTex, emissiveIntensity: 0.7 }),
    [boardTex],
  );
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 }), [wallTex]);
  const W = 9;
  const H = W * (BOARD_H / BOARD_W);
  return (
    <group position={[0, 0, -ROOM_Z]}>
      <mesh receiveShadow material={wallMat} position={[0, WALL_CY, 0]}>
        <planeGeometry args={[ROOM_X * 2, WALL_H]} />
      </mesh>
      {/* teal wainscot with yellow rail */}
      <mesh receiveShadow material={m.teal} position={[0, FLOOR_Y + 1.8, 0.04]}>
        <boxGeometry args={[ROOM_X * 2, 3.6, 0.08]} />
      </mesh>
      <mesh material={m.yellow} position={[0, FLOOR_Y + 3.65, 0.09]}>
        <boxGeometry args={[ROOM_X * 2, 0.22, 0.14]} />
      </mesh>
      <mesh material={m.white} position={[0, FLOOR_Y + 0.2, 0.1]}>
        <boxGeometry args={[ROOM_X * 2, 0.4, 0.14]} />
      </mesh>

      {/* board */}
      <group position={[0, 1.2, 0.06]}>
        <RoundedBox args={[W + 0.7, H + 0.7, 0.3]} radius={0.2} smoothness={4} position={[0, 0, -0.1]} material={m.white} castShadow />
        <mesh material={faceMat} position={[0, 0, 0.07]}>
          <planeGeometry args={[W, H]} />
        </mesh>
        <RoundedBox args={[W + 0.5, 0.2, 0.55]} radius={0.08} position={[0, -H / 2 - 0.55, 0.3]} material={m.coral} castShadow />
        {[
          [-2.4, m.yellow],
          [-1.7, m.pink],
          [-1.1, m.chalk],
          [2.2, m.mint],
        ].map(([x, mat], i) => (
          <mesh key={i} material={mat as THREE.Material} position={[x as number, -H / 2 - 0.36, 0.38]} rotation={[0, 0.4 * (i - 1), Math.PI / 2]}>
            <capsuleGeometry args={[0.07, 0.4, 4, 8]} />
          </mesh>
        ))}
      </group>
      <Clock pos={[8.3, 3.3, 0.2]} />
      <Pennants y={7.2} w={30} n={20} />
      <mesh position={[-8.3, -0.4, 0.1]}>
        <planeGeometry args={[2.4, 3.2]} />
        <meshBasicMaterial map={poster[0]} />
      </mesh>
      <mesh position={[-11.2, -1, 0.1]} rotation={[0, 0, 0.05]}>
        <planeGeometry args={[2.2, 2.9]} />
        <meshBasicMaterial map={poster[1]} />
      </mesh>
      <mesh position={[11.5, -0.6, 0.1]} rotation={[0, 0, -0.04]}>
        <planeGeometry args={[2.4, 3.2]} />
        <meshBasicMaterial map={poster[2]} />
      </mesh>
      <mesh position={[14.4, -0.5, 0.1]}>
        <planeGeometry args={[2.2, 2.9]} />
        <meshBasicMaterial map={poster[3]} />
      </mesh>

      {/* bookshelf */}
      <group position={[-14.5, FLOOR_Y + 4, 0.95]}>
        <RoundedBox args={[6.2, 8, 1.8]} radius={0.15} material={m.white} castShadow />
        <mesh position={[0, 0, 0.92]}>
          <planeGeometry args={[5.6, 7.4]} />
          <meshStandardMaterial map={shelfTex} roughness={0.8} />
        </mesh>
        <Globe pos={[-1.4, 4.0, 0]} />
        <Plant pos={[1.6, 4.0, 0]} scale={0.9} />
      </group>
      <Plant pos={[16.3, FLOOR_Y, 1.2]} scale={1.6} />
      <Plant pos={[-17.2, FLOOR_Y, 1.0]} scale={1.2} />
      <mesh material={m.pink} position={[6.0, FLOOR_Y + 1.1, 1.3]} castShadow>
        <cylinderGeometry args={[1.0, 0.8, 2.2, 16]} />
      </mesh>
      <AOBlob x={-14.5} z={-ROOM_Z + 1.2} w={9} d={4.5} />
    </group>
  );
}

export function Room({ data, playerCount = 2 }: { data: BoardData; playerCount?: number }) {
  // with side seats (3-4 players) the neighbouring desks move out to make room for the stools
  const bx = playerCount >= 3 ? 14 : 10.6;
  const deskLen = playerCount >= 3 ? 8 : 9;
  const m = M();
  const floorTex = useMemo(() => makeFloorTexture(), []);
  const wallPeach = useMemo(() => makeWallTexture("#ffd9c6", "rgba(255,255,255,0.28)"), []);
  const wallMint = useMemo(() => makeWallTexture("#c3f3e2", "rgba(255,255,255,0.3)"), []);
  const wallMintMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wallMint, roughness: 1 }), [wallMint]);
  const sky = useMemo(() => makeSkyTexture(), []);
  const posters = useMemo(() => [makePosterTexture("chart"), makePosterTexture("space"), makePosterTexture("map"), makePosterTexture("abc")], []);
  const posters2 = useMemo(() => [makePosterTexture("map"), makePosterTexture("abc"), makePosterTexture("space"), makePosterTexture("art")], []);
  const boardTex = useMemo(() => canvasTex(BOARD_W, BOARD_H, () => {}), []);
  useEffect(() => {
    const c = boardTex.image as HTMLCanvasElement | undefined;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    drawBoard(g, data);
    boardTex.needsUpdate = true;
  }, [data, boardTex]);

  const farRef = useRef<THREE.Group>(null);
  const nearRef = useRef<THREE.Group>(null);
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (farRef.current) farRef.current.visible = WALLS.far;
    if (nearRef.current) nearRef.current.visible = WALLS.near;
    if (leftRef.current) leftRef.current.visible = WALLS.left;
    if (rightRef.current) rightRef.current.visible = WALLS.right;
  });
  const rows = [-9.2, -3.9, 1.4, 6.7];
  // desk colours per (side,row)
  const colorFor = (sx: number, i: number) => DESK_COLORS[(i + (sx > 0 ? 2 : 0)) % 4];
  const bpColors: [string, string][] = [
    ["#ff7a6b", "#d9574a"],
    ["#2ec4b6", "#1f9a8e"],
    ["#ffc93c", "#d9a21f"],
    ["#a98bff", "#7f5fe0"],
  ];

  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
        <planeGeometry args={[ROOM_X * 2, ROOM_Z * 2]} />
        <meshStandardMaterial map={floorTex} roughness={0.45} />
      </mesh>

      <group ref={farRef}>
        <EndWall boardTex={boardTex} wallTex={wallPeach} poster={posters} />
      </group>
      <group ref={nearRef} rotation={[0, Math.PI, 0]}>
        <EndWall boardTex={boardTex} wallTex={wallPeach} poster={posters2} />
      </group>

      {/* left wall: windows + beams */}
      <group ref={leftRef}>
      <group position={[-ROOM_X, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <mesh receiveShadow material={wallMintMat} position={[0, WALL_CY, 0]}>
          <planeGeometry args={[ROOM_Z * 2, WALL_H]} />
        </mesh>
        <mesh material={m.yellow} position={[0, FLOOR_Y + 1.8, 0.04]}>
          <boxGeometry args={[ROOM_Z * 2, 3.6, 0.08]} />
        </mesh>
        <mesh material={m.white} position={[0, FLOOR_Y + 0.2, 0.1]}>
          <boxGeometry args={[ROOM_Z * 2, 0.4, 0.14]} />
        </mesh>
        {[-8, 0, 8].map((x) => (
          <Window key={x} pos={[x, 2.0, 0.08]} sky={sky} />
        ))}
      </group>
      {[-8, 0, 8].map((z) => (
        <LightBeam key={z} pos={[-11.5, -1.8, z]} rotY={0} w={5.2} len={20} op={0.32} />
      ))}
      {[-8, 0, 8].map((z) => (
        <LightBeam key={`b${z}`} pos={[-11.5, -1.8, z + 0.2]} rotY={Math.PI / 2} w={4} len={20} op={0.2} />
      ))}
      <StringLights from={[-ROOM_X + 0.6, 7.2, -ROOM_Z + 0.6]} to={[-ROOM_X + 0.6, 7.2, ROOM_Z - 0.6]} n={26} />
      </group>

      {/* right wall: windows + door */}
      <group ref={rightRef}>
      <group position={[ROOM_X, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh receiveShadow material={wallMintMat} position={[0, WALL_CY, 0]}>
          <planeGeometry args={[ROOM_Z * 2, WALL_H]} />
        </mesh>
        <mesh material={m.pink} position={[0, FLOOR_Y + 1.8, 0.04]}>
          <boxGeometry args={[ROOM_Z * 2, 3.6, 0.08]} />
        </mesh>
        <mesh material={m.white} position={[0, FLOOR_Y + 0.2, 0.1]}>
          <boxGeometry args={[ROOM_Z * 2, 0.4, 0.14]} />
        </mesh>
        {[-8, 8].map((x) => (
          <Window key={x} pos={[x, 2.0, 0.08]} sky={sky} />
        ))}
        <RoundedBox args={[4.4, 9.4, 0.3]} radius={0.15} position={[0, FLOOR_Y + 4.7, 0.15]} material={m.door} castShadow />
        <mesh material={m.yellow} position={[1.5, FLOOR_Y + 4.3, 0.4]}>
          <sphereGeometry args={[0.22, 10, 8]} />
        </mesh>
      </group>

      <StringLights from={[ROOM_X - 0.6, 7.2, -ROOM_Z + 0.6]} to={[ROOM_X - 0.6, 7.2, ROOM_Z - 0.6]} n={26} />
      </group>

      {/* neighbouring desks */}
      {[-1, 1].map((sx) =>
        rows.map((z, i) => (
          <Desk key={`${sx}-${i}`} pos={[sx * bx, 0, z]} len={deskLen} color={colorFor(sx, i)}>
            {i === 0 && sx < 0 && (
              <>
                <Laptop pos={[-1.3, 0.01, 0.2]} rot={0.5} hue={200} />
                <Plush pos={[2.4, 0.01, 0.3]} color="#ffb6c8" />
              </>
            )}
            {i === 1 && sx > 0 && (
              <>
                <Notebooks pos={[-2, 0.01, 0.2]} rot={0.3} />
                <PencilCup pos={[1.2, 0.01, -0.6]} color="#a98bff" />
                <Bottle pos={[2.9, 0.01, 0.5]} color="#4dd0c4" />
              </>
            )}
            {i === 2 && sx < 0 && (
              <>
                <Headphones pos={[-1.5, 0.01, 0.2]} color="#ff6f91" rot={0.4} />
                <Bottle pos={[2.2, 0.01, -0.6]} color="#ffd23f" />
                <Notebooks pos={[0.4, 0.01, 0.9]} rot={-0.2} />
              </>
            )}
            {i === 3 && sx > 0 && (
              <>
                <Laptop pos={[1.4, 0.01, 0.1]} rot={-0.4} hue={330} />
                <Plush pos={[-2.2, 0.01, 0.4]} color="#9fe3ff" ear="#ffffff" />
              </>
            )}
            {i === 0 && sx > 0 && (
              <>
                <mesh receiveShadow material={m.paper} position={[-1.2, 0.015, 0.3]} rotation={[-Math.PI / 2, 0, 0.12]}>
                  <planeGeometry args={[3, 2]} />
                </mesh>
                <PencilCup pos={[2, 0.01, -0.5]} color="#ff7a6b" />
              </>
            )}
            {i === 1 && sx < 0 && <Notebooks pos={[1.5, 0.01, 0.2]} rot={0.5} />}
            {i === 2 && sx > 0 && <Bottle pos={[-1.6, 0.01, 0.3]} color="#ff7a6b" />}
            {i === 3 && sx < 0 && (
              <>
                <Headphones pos={[1.2, 0.01, 0.1]} color="#2ec4b6" />
                <PencilCup pos={[-2.2, 0.01, 0.4]} color="#ffc93c" />
              </>
            )}
          </Desk>
        )),
      )}
      {[-1, 1].map((sx) =>
        rows.map((z, i) => <AOBlob key={`ao${sx}${i}`} x={sx * bx} z={z} w={deskLen + 3} d={6.8} />),
      )}
      <Backpack pos={[bx - deskLen / 2, -1.9, -9.2]} rot={Math.PI / 2} color={bpColors[0][0]} dark={bpColors[0][1]} />
      <Backpack pos={[bx - deskLen / 2, -2.0, 1.4]} rot={Math.PI / 2} color={bpColors[1][0]} dark={bpColors[1][1]} />
      <Backpack pos={[-(bx - deskLen / 2), -2.0, -3.9]} rot={-Math.PI / 2} color={bpColors[2][0]} dark={bpColors[2][1]} />
      <Backpack pos={[-(bx - deskLen / 2), -1.9, 6.7]} rot={-Math.PI / 2} color={bpColors[3][0]} dark={bpColors[3][1]} />
    </group>
  );
}

export function MainDesk({ playerCount = 2 }: { playerCount?: number }) {
  const m = M();
  const tex = useMemo(() => makeDeskTexture(), []);
  const topMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }), [tex]);
  const edgeMat = useMemo(() => std("#2ec4b6", 0.4), []);
  const seatMats = useMemo(() => SEAT_COLORS.map((c) => std(c, 0.4)), []);
  const h = -FLOOR_Y;
  return (
    <group>
      <RoundedBox args={[6.0, 0.42, 12.0]} radius={0.2} smoothness={5} position={[0, -0.2, 0]} material={edgeMat} castShadow receiveShadow />
      <mesh receiveShadow position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} material={topMat}>
        <planeGeometry args={[5.9, 11.9]} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <mesh castShadow position={[sx * 2.55, -h / 2 - 0.2, sz * 5.4]} material={m.white}>
              <capsuleGeometry args={[0.2, h - 1, 4, 10]} />
            </mesh>
            <mesh position={[sx * 2.55, FLOOR_Y + 0.15, sz * 5.4]} material={m.coral}>
              <cylinderGeometry args={[0.32, 0.36, 0.3, 12]} />
            </mesh>
          </group>
        )),
      )}
      {[-1, 1].map((sx) => (
        <mesh key={sx} castShadow position={[sx * 2.55, -2.6, 0]} material={m.metal}>
          <boxGeometry args={[0.18, 0.18, 10.8]} />
        </mesh>
      ))}
      <AOBlob x={0} z={0} w={9} d={16} op={1} />
      {SEATS.slice(0, playerCount).map((seat, i) => (
        <group key={i}>
          <group position={[seat.x * 1.0 + Math.sign(seat.x) * 0.1, SEAT_Y - 0.25, seat.z + Math.sign(seat.z) * 0.1]}>
            <mesh castShadow receiveShadow material={seatMats[i]}>
              <cylinderGeometry args={[2.3, 2.3, 0.5, 28]} />
            </mesh>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} castShadow position={[Math.cos(k * 1.571 + 0.78) * 1.6, -2.2, Math.sin(k * 1.571 + 0.78) * 1.6]} rotation={[Math.sin(k * 1.571 + 0.78) * 0.15, 0, -Math.cos(k * 1.571 + 0.78) * 0.15]} material={m.metal}>
                <capsuleGeometry args={[0.14, 3.9, 4, 8]} />
              </mesh>
            ))}
          </group>
          <AOBlob x={seat.x + Math.sign(seat.x) * 0.1} z={seat.z + Math.sign(seat.z) * 0.1} w={6} d={6} />
        </group>
      ))}
    </group>
  );
}
