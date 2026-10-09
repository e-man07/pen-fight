/* eslint-disable react-hooks/immutability, react-hooks/purity */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getSoftDot } from "./textures";

/** Fixed-size particle pool; all buffers allocated once. */
export class Pool {
  readonly n: number;
  readonly pos: Float32Array;
  readonly col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private next = 0;
  constructor(n: number, readonly additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.grav = new Float32Array(n);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, grav: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.base[k] = r;
    this.base[k + 1] = g;
    this.base[k + 2] = b;
    this.life[i] = life;
    this.max[i] = life;
    this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      const L = this.life[i];
      const k = i * 3;
      if (L <= 0) continue;
      this.life[i] = L - dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999;
        continue;
      }
      this.vel[k + 1] += this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.additive ? this.life[i] / this.max[i] : 1;
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
  }
}

const PAL = [
  [1, 0.42, 0.57],
  [0.42, 0.55, 1],
  [0.2, 0.78, 0.65],
  [1, 0.72, 0.1],
  [0.65, 0.48, 1],
];

export class FX {
  spark = new Pool(320, true);
  confetti = new Pool(220, false);
  sparkBurst(x: number, y: number, z: number, n: number, speed: number, r = 1, g = 0.85, b = 0.35) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spark.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * speed * 0.6, Math.sin(a) * s, 0.45 + Math.random() * 0.4, r, g, b, -9);
    }
  }
  trail(x: number, y: number, z: number, r: number, g: number, b: number) {
    this.spark.emit(x + (Math.random() - 0.5) * 0.15, y + 0.1, z + (Math.random() - 0.5) * 0.15, 0, 0.3, 0, 0.35, r * 0.7, g * 0.7, b * 0.7, 0);
  }
  confettiBurst(x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = 3 + Math.random() * 7;
      const c = PAL[i % PAL.length];
      this.confetti.emit(x, y, z, Math.cos(a) * s, 8 + Math.random() * 9, Math.sin(a) * s, 2.2 + Math.random() * 1.2, c[0], c[1], c[2], -16);
    }
  }
}

function PointsLayer({ pool, size }: { pool: Pool; size: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pool.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(pool.col, 3));
    return g;
  }, [pool]);
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size,
        map: pool.additive ? getSoftDot() : null,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: pool.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    [pool, size],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.Points>(null);
  useFrame((_, dt) => {
    pool.update(Math.min(dt, 0.05));
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={8} />;
}

export function FXLayer({ fx }: { fx: FX }) {
  return (
    <>
      <PointsLayer pool={fx.spark} size={0.55} />
      <PointsLayer pool={fx.confetti} size={0.28} />
    </>
  );
}

/** Slow drifting dust motes lit by the window light. */
export function DustMotes({ count = 70 }: { count?: number }) {
  const data = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seed[i * 3] = Math.random() * 6.28;
      seed[i * 3 + 1] = Math.random() * 6.28;
      seed[i * 3 + 2] = Math.random();
    }
    return { pos, seed };
  }, [count]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
    return g;
  }, [data]);
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.22,
        map: getSoftDot(),
        color: "#fff4c9",
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const { pos, seed } = data;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const a = seed[k];
      const b = seed[k + 1];
      pos[k] = -14 + seed[k + 2] * 20 + Math.sin(t * 0.13 + a) * 2.2;
      pos[k + 1] = 0.5 + ((seed[k + 2] * 13 + t * 0.35 + b) % 11);
      pos[k + 2] = -10 + ((seed[k + 2] * 37) % 1) * 20 + Math.cos(t * 0.11 + b) * 2;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={7} />;
}
