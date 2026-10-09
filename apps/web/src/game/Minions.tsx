/**
 * Renders server-authoritative lane minions in first-person.
 *
 * Each minion is a small upright capsule tinted by team. The store
 * provides the latest snapshot; this component just animates toward
 * the authoritative position with light smoothing.
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../store";
import type { MinionType, ServerMinionSnapshot, TeamId } from "@rift/shared";

function tintFor(team: TeamId, type: MinionType): string {
  if (team === "blue") {
    return type === "melee" ? "#2c5fa3" : type === "ranged" ? "#4a7fc4" : "#6a4dc4";
  }
  return type === "melee" ? "#a33243" : type === "ranged" ? "#c4555a" : "#c4558a";
}

function MinionMarker({ m }: { m: ServerMinionSnapshot }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = THREE.MathUtils.lerp(g.position.x, m.position.x, Math.min(1, 14 * dt));
    g.position.y = m.position.y;
    g.position.z = THREE.MathUtils.lerp(g.position.z, m.position.z, Math.min(1, 14 * dt));
  });
  const color = tintFor(m.team, m.type);
  const scale = m.type === "siege" ? 1.3 : m.type === "ranged" ? 0.9 : 1;
  const height = m.type === "siege" ? 1.0 : 0.7;
  return (
    <group ref={ref} position={[m.position.x, m.position.y, m.position.z]} scale={[scale, scale, scale]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <capsuleGeometry args={[0.25, height * 0.7, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0, height + 0.18, 0]} castShadow>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

export function Minions() {
  const minions = useAppStore((s) => s.minions);
  return (
    <>
      {Object.values(minions).map((m) => (
        <MinionMarker key={m.id} m={m} />
      ))}
    </>
  );
}
