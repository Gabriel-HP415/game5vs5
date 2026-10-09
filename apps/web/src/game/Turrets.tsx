/**
 * Turret and Nexus visuals. Towers are larger upright boxes colored
 * by team. A dimmer tone indicates a protected structure.
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../store";
import type { ServerTurretSnapshot, TeamId, TurretTier } from "@rift/shared";

function baseColor(team: TeamId, tier: TurretTier): string {
  const tint = team === "blue" ? "70,130,200" : "200,80,90";
  const intensity =
    tier === "outer" ? 0.5 : tier === "inner" ? 0.6 : tier === "base" ? 0.7 : 0.85;
  return `rgba(${tint}, ${intensity})`;
}

function TurretMarker({ t }: { t: ServerTurretSnapshot }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.set(t.position.x, 0, t.position.z);
  });
  const visible = t.alive;
  const height = t.tier === "nexus" ? 4.5 : t.tier === "base" ? 3.8 : t.tier === "inner" ? 3.2 : 2.6;
  const color = baseColor(t.team, t.tier);
  const opacity = t.protected ? 0.55 : 0.9;
  return (
    <group ref={ref} position={[t.position.x, 0, t.position.z]}>
      {visible && (
        <>
          <mesh position={[0, height / 2, 0]} castShadow>
            <cylinderGeometry args={[0.6, 0.9, height, 8]} />
            <meshStandardMaterial color={color} transparent opacity={opacity} />
          </mesh>
          <mesh position={[0, height + 0.3, 0]} castShadow>
            <sphereGeometry args={[0.5, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
          </mesh>
          {/* Health bar above the turret. */}
          <mesh position={[0, height + 1.0, 0]}>
            <planeGeometry args={[1.6, 0.12]} />
            <meshBasicMaterial color="#111" transparent opacity={0.75} />
          </mesh>
          <mesh
            position={[
              -0.8 + 1.6 * (t.health / Math.max(1, t.maxHealth)) * 0.5,
              height + 1.0,
              0.01,
            ]}
          >
            <planeGeometry args={[1.6 * (t.health / Math.max(1, t.maxHealth)), 0.1]} />
            <meshBasicMaterial color={t.team === "blue" ? "#5aa6ff" : "#ff6470"} />
          </mesh>
        </>
      )}
    </group>
  );
}

export function Turrets() {
  const turrets = useAppStore((s) => s.turrets);
  return (
    <>
      {Object.values(turrets).map((t) => (
        <TurretMarker key={t.id} t={t} />
      ))}
    </>
  );
}
