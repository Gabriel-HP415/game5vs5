import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WEAPONS, type WeaponId, type WeaponDefinition } from "@rift/shared";
import { useAppStore } from "../store";

/* ------------------------------------------------------------------ *
 * First-person weapon model                                          *
 * ------------------------------------------------------------------ *
 * Procedural geometry only. Sway + recoil handled locally. The        *
 * weapon is selected by `player.weapon` (server-authoritative in      *
 * PHASE 2).                                                          *
 * ------------------------------------------------------------------ */

interface WeaponModelProps {
  /** Default weapon shown when no server snapshot is available yet. */
  weaponId?: WeaponId;
}

export function WeaponModel({ weaponId = "classic" }: WeaponModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pitchRef = useRef(0);
  const yawRef = useRef(0);
  const recoilRef = useRef(0);
  const fireFlashRef = useRef(0);
  const [firing, setFiring] = useState(false);

  /* Listen for fire events from the store to drive muzzle flash + recoil. */
  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (
        state.match.shots !== prev.match.shots &&
        state.match.shots > prev.match.shots
      ) {
        recoilRef.current = 1.0;
        fireFlashRef.current = 0.06;
      }
    });
  }, []);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;

    const { player } = useAppStore.getState();
    yawRef.current = THREE.MathUtils.lerp(yawRef.current, 0, 12 * dt);
    pitchRef.current = THREE.MathUtils.lerp(pitchRef.current, 0, 12 * dt);

    recoilRef.current = THREE.MathUtils.lerp(recoilRef.current, 0, 6 * dt);
    fireFlashRef.current = Math.max(0, fireFlashRef.current - dt);

    const sway = Math.sin(performance.now() * 0.0015) * 0.005;
    const recoilKick = recoilRef.current * 0.08;
    const recoilRot = recoilRef.current * 0.4;

    g.rotation.set(
      THREE.MathUtils.degToRad(player.pitch) * 0.25 - recoilRot,
      -yawRef.current + recoilRot * 0.2,
      sway
    );
    g.position.set(
      0.32 + recoilKick * 0.2,
      -0.32 - recoilKick,
      -0.55 - recoilKick * 0.5
    );

    if (fireFlashRef.current > 0 && !firing) setFiring(true);
    if (fireFlashRef.current === 0 && firing) setFiring(false);
  });

  /* Resolve the weapon definition from the server-driven player.weapon. */
  const weaponDef: WeaponDefinition = useMemo(() => {
    const { player } = useAppStore.getState();
    const id = (player.weapon as WeaponId) || weaponId;
    return WEAPONS[id] ?? WEAPONS[weaponId];
  }, [weaponId]);

  const parts = useMemo(() => {
    const tint = weaponDef.modelTint;
    const long = weaponDef.id === "operator" || weaponDef.id === "marshal";
    return { tint, long };
  }, [weaponDef]);

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0, parts.long ? -0.15 : -0.05]} castShadow>
        <boxGeometry args={[0.08, 0.1, parts.long ? 0.6 : 0.35]} />
        <meshStandardMaterial color={parts.tint} metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.08, 0.06]} rotation={[0.2, 0, 0]} castShadow>
        <boxGeometry args={[0.06, 0.13, 0.07]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.13, -0.04]} castShadow>
        <boxGeometry args={[0.05, 0.1, 0.06]} />
        <meshStandardMaterial color="#222" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, parts.long ? -0.55 : -0.25]} castShadow>
        <boxGeometry args={[0.05, 0.05, 0.1]} />
        <meshStandardMaterial color="#111" metalness={0.7} roughness={0.3} />
      </mesh>
      {firing && (
        <MuzzleFlash position={[0, 0, parts.long ? -0.62 : -0.32]} />
      )}
    </group>
  );
}

function MuzzleFlash({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <coneGeometry args={[0.08, 0.16, 12, 1, true]} />
        <meshBasicMaterial color="#fff4c2" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color="#ffd97a" intensity={3} distance={3} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * World weapon pickup (placeholder)                                   *
 * ------------------------------------------------------------------ */

interface WorldWeaponPickupProps {
  weaponId: WeaponId;
  position: [number, number, number];
}

export function WorldWeaponPickup({ weaponId, position }: WorldWeaponPickupProps) {
  const def = WEAPONS[weaponId];
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.18, 0.08, 0.55]} />
        <meshStandardMaterial color={def.modelTint} metalness={0.4} roughness={0.5} />
      </mesh>
      <pointLight color="#a6d8ff" intensity={0.4} distance={2} />
    </group>
  );
}