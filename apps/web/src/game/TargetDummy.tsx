import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../store";

/* ------------------------------------------------------------------ *
 * Target dummy (PHASE 2 — server-authoritative)                       *
 * ------------------------------------------------------------------ *
 * Renders one of the 4 graybox target dummies. Health and alive state *
 * are read directly from the server snapshot via the Zustand store.  *
 * When a hit lands, the server applies damage and the local dummy     *
 * flashes for instant client-side feedback (in addition to the        *
 * authoritative state update).                                        *
 * ------------------------------------------------------------------ */

export interface TargetDummyProps {
  id: string;
  position: [number, number, number];
  /** Total hit points (display only; server is authoritative). */
  maxHealth: number;
  /** Respawn delay after death in seconds (display only). */
  respawnSeconds: number;
}

export function TargetDummy({ id, position, maxHealth, respawnSeconds }: TargetDummyProps) {
  const ref = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const flashRef = useRef(0);
  const prevHealthRef = useRef<number | null>(null);
  const state = useAppStore((s) => s.targets[id]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!state || !state.alive) {
      // Sink the dummy below the floor when dead (server will respawn it).
      g.position.set(position[0], -10, position[2]);
    } else {
      // Lerp the position toward the server position (should be near-instant
      // for static dummies, but keeps the code robust if we ever move them).
      g.position.set(
        THREE.MathUtils.lerp(g.position.x, state.position.x, 15 * dt),
        position[1],
        THREE.MathUtils.lerp(g.position.z, state.position.z, 15 * dt)
      );
    }

    if (flashRef.current > 0 && matRef.current) {
      flashRef.current = Math.max(0, flashRef.current - dt * 4);
      const k = flashRef.current;
      matRef.current.emissive.setRGB(1 * k, 0.4 * k, 0.4 * k);
    }
  });

  // Trigger hit flash when health drops.
  useEffect(() => {
    if (!state) return;
    const prev = prevHealthRef.current;
    if (prev !== null && state.health < prev) {
      flashRef.current = 0.3;
    }
    prevHealthRef.current = state.health;
  }, [state?.health, state]);

  return (
    <group ref={ref} position={position}>
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          ref={matRef}
          color="#d44a3a"
          emissive="#000"
          emissiveIntensity={0}
          roughness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <boxGeometry args={[0.5, 0.8, 0.3]} />
        <meshStandardMaterial color="#d44a3a" roughness={0.6} />
      </mesh>
      <mesh position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.18, 0.8, 0.22]} />
        <meshStandardMaterial color="#3a3a44" roughness={0.7} />
      </mesh>
      <mesh position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.18, 0.8, 0.22]} />
        <meshStandardMaterial color="#3a3a44" roughness={0.7} />
      </mesh>
      <pointLight color="#ff5263" intensity={0.8} distance={3} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Helpers exported for tests                                          *
 * ------------------------------------------------------------------ */

export function _resetDummyStateForTests() {
  // No-op in PHASE 2; server is authoritative.
}
