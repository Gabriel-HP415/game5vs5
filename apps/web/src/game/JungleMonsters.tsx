/**
 * Jungle monster visuals. A larger capsule tinted per camp id.
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../store";
import type { ServerJungleMonsterSnapshot } from "@rift/shared";

function JungleMarker({ m }: { m: ServerJungleMonsterSnapshot }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.x = THREE.MathUtils.lerp(g.position.x, m.position.x, Math.min(1, 8 * dt));
    g.position.y = m.position.y;
    g.position.z = THREE.MathUtils.lerp(g.position.z, m.position.z, Math.min(1, 8 * dt));
  });
  const hue = (Math.abs(hashCode(m.id)) % 360) / 360;
  const color = `hsl(${hue * 360}, 55%, 45%)`;
  return (
    <group ref={ref} position={[m.position.x, m.position.y, m.position.z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.4, 1.4, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 1.85, 0]} castShadow>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function JungleMonsters() {
  const monsters = useAppStore((s) => s.jungleMonsters);
  return (
    <>
      {Object.values(monsters)
        .filter((m) => m.alive)
        .map((m) => (
          <JungleMarker key={m.id} m={m} />
        ))}
    </>
  );
}
