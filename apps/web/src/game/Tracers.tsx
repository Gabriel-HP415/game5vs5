import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------ *
 * Tracers                                                            *
 * ------------------------------------------------------------------ *
 * Very small in-engine tracer lines fired by the local player. PHASE 2 *
 * will move shooting/tracers to authoritative server snapshots.       *
 * ------------------------------------------------------------------ */

export interface TracerSpec {
  id: string;
  origin: [number, number, number];
  target: [number, number, number];
  color?: string;
  ttl?: number;
}

const tracers: TracerSpec[] = [];
const tracerListeners = new Set<() => void>();

export function emitTracer(spec: TracerSpec) {
  tracers.push({ ...spec, color: spec.color ?? "#fff4c2", ttl: spec.ttl ?? 0.1 });
  tracerListeners.forEach((l) => l());
}

export function Tracers() {
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    // Cull expired tracers.
    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].ttl = (tracers[i].ttl ?? 0) - dt;
      if ((tracers[i].ttl ?? 0) <= 0) tracers.splice(i, 1);
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={linesRef}>
        {tracers.map((t) => (
          <TracerLine key={t.id} origin={t.origin} target={t.target} color={t.color} />
        ))}
      </group>
    </group>
  );
}

function TracerLine({
  origin,
  target,
  color,
}: {
  origin: [number, number, number];
  target: [number, number, number];
  color?: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const from = new THREE.Vector3(...origin);
  const to = new THREE.Vector3(...target);
  const dir = to.clone().sub(from);
  const length = dir.length();
  const mid = from.clone().add(dir.clone().multiplyScalar(0.5));
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  return (
    <mesh position={mid} quaternion={quat} ref={ref}>
      <cylinderGeometry args={[0.015, 0.015, length, 6]} />
      <meshBasicMaterial color={color ?? "#fff4c2"} transparent opacity={0.7} />
    </mesh>
  );
}

/* Listen for new tracers — useful for forcing re-render via store-driven
   effect; kept here for symmetry but currently unused. */
export function _useTracerSubscription() {
  return tracers.length;
}