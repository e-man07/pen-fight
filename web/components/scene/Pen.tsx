/* eslint-disable react-hooks/immutability */
"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Game } from "./game";
import { FLOOR_Y } from "./game";
import { getBlobTexture } from "./textures";

const BODY = Math.PI / 2;

export function PenMesh({ game, idx, color }: { game: Game; idx: number; color: string }) {
  const grp = useRef<THREE.Group>(null);
  const blob = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const blobTex = useMemo(() => getBlobTexture(), []);
  const capMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1, emissive: color, emissiveIntensity: 0.22 }),
    [color],
  );
  const bodyMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.15, clearcoat: 1, emissive: "#ffffff", emissiveIntensity: 0.12 }),
    [],
  );
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    [color],
  );
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b9bcc2", roughness: 0.3, metalness: 0.8 }), []);

  useFrame((state) => {
    const p = game.pens[idx];
    const g = grp.current;
    if (g) {
      g.position.set(p.x, p.y, p.z);
      g.rotation.set(p.roll, -p.heading, p.pitch, "YZX");
    }
    const b = blob.current;
    if (b) {
      const onDesk = Math.abs(p.x) < 3.1 && Math.abs(p.z) < 6.1;
      const gy = onDesk ? 0.012 : FLOOR_Y + 0.02;
      const h = Math.max(0, p.y - gy);
      b.position.set(p.x + h * 0.15, gy, p.z + h * 0.15);
      b.rotation.set(-Math.PI / 2, -p.heading, 0, "YXZ");
      const sc = 1 + h * 0.1;
      b.scale.set(sc, sc, 1);
      (b.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.9 - h * 0.12);
    }
    const r = ring.current;
    if (r) {
      r.visible = (p.highlight || p.turn) && p.state === "desk";
      if (r.visible) {
        r.position.set(p.x, 0.03, p.z);
        const s = 1 + Math.sin(state.clock.elapsedTime * (p.highlight ? 4 : 3)) * 0.08;
        r.scale.set(s, s, 1);
        ringMat.opacity = p.highlight ? 0.9 : 0.55 + Math.sin(state.clock.elapsedTime * 3) * 0.15;
      }
    }
  });

  return (
    <>
      <group ref={grp} scale={1.15}>
        <mesh material={capMat} castShadow position={[-0.6, 0, 0]} rotation={[0, 0, BODY]}>
          <cylinderGeometry args={[0.2, 0.2, 0.62, 14]} />
        </mesh>
        <mesh material={capMat} castShadow position={[-0.91, 0, 0]}>
          <sphereGeometry args={[0.2, 14, 10]} />
        </mesh>
        <mesh material={metal} castShadow position={[-0.55, 0.19, 0]}>
          <boxGeometry args={[0.5, 0.05, 0.08]} />
        </mesh>
        <mesh material={metal} castShadow position={[-0.29, 0, 0]} rotation={[0, 0, BODY]}>
          <cylinderGeometry args={[0.21, 0.21, 0.05, 14]} />
        </mesh>
        <mesh material={bodyMat} castShadow position={[0.1, 0, 0]} rotation={[0, 0, BODY]}>
          <cylinderGeometry args={[0.17, 0.17, 0.75, 14]} />
        </mesh>
        <mesh material={capMat} castShadow position={[0.5, 0, 0]} rotation={[0, 0, BODY]}>
          <cylinderGeometry args={[0.18, 0.18, 0.1, 14]} />
        </mesh>
        <mesh material={capMat} castShadow position={[0.7, 0, 0]} rotation={[0, 0, -BODY]}>
          <coneGeometry args={[0.17, 0.32, 14]} />
        </mesh>
        <mesh material={metal} castShadow position={[0.9, 0, 0]} rotation={[0, 0, -BODY]}>
          <coneGeometry args={[0.05, 0.14, 8]} />
        </mesh>
      </group>
      <mesh ref={blob} renderOrder={2}>
        <planeGeometry args={[2.6, 0.9]} />
        <meshBasicMaterial map={blobTex} transparent depthWrite={false} opacity={0.8} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} visible={false} material={ringMat}>
        <ringGeometry args={[0.95, 1.1, 40]} />
      </mesh>
    </>
  );
}
