import { useMemo } from "react";
import * as THREE from "three";
import { MAP_DEFAULT, type Vec3 } from "@rift/shared";
import type { AABB } from "./useFpsController";

/* ------------------------------------------------------------------ *
 * Graybox map                                                         *
 * ------------------------------------------------------------------ *
 * Procedurally constructs an original three-lane MOBA-inspired layout *
 * using primitive geometry. Exposes the collision AABBs so the FPS    *
 * controller can collide against walls.                               *
 * ------------------------------------------------------------------ */

interface MapProps {
  onColliders?: (aabbs: AABB[]) => void;
}

const FLOOR_COLOR = "#1d2a3a";
const BLUE_BASE_COLOR = "#1d3a6b";
const RED_BASE_COLOR = "#6b1d2a";
const RIVER_COLOR = "#0e5a7a";
const JUNGLE_COLOR = "#1f3a2a";
const LANE_COLOR = "#3a3a3a";
const WALL_COLOR = "#0a1020";
const SPAWN_BLUE = "#3aa3ff";
const SPAWN_RED = "#ff5263";

function vec(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** Compute an AABB for a box centered at `center` with size (w,h,d). */
function boxAABB(center: THREE.Vector3, w: number, h: number, d: number): AABB {
  return {
    min: new THREE.Vector3(center.x - w / 2, center.y - h / 2, center.z - d / 2),
    max: new THREE.Vector3(center.x + w / 2, center.y + h / 2, center.z + d / 2),
  };
}

export function Map({ onColliders }: MapProps) {
  const def = MAP_DEFAULT;
  const { colliders } = useMemo(() => {
    const aabbs: AABB[] = [];

    /* Outer boundary walls to keep the player on the map. The boundary is
       hollow: walls form a ring around the playable area. */
    const wallHeight = 4;
    const wallThickness = 1;
    const min = vec(def.boundsMin);
    const max = vec(def.boundsMax);
    const spanX = max.x - min.x;
    const spanZ = max.z - min.z;

    aabbs.push(
      // north wall (+Z)
      boxAABB(
        new THREE.Vector3((min.x + max.x) / 2, wallHeight / 2, max.z + wallThickness / 2),
        spanX + wallThickness * 2,
        wallHeight,
        wallThickness
      ),
      // south wall (-Z)
      boxAABB(
        new THREE.Vector3((min.x + max.x) / 2, wallHeight / 2, min.z - wallThickness / 2),
        spanX + wallThickness * 2,
        wallHeight,
        wallThickness
      ),
      // east wall (+X)
      boxAABB(
        new THREE.Vector3(max.x + wallThickness / 2, wallHeight / 2, (min.z + max.z) / 2),
        wallThickness,
        wallHeight,
        spanZ
      ),
      // west wall (-X)
      boxAABB(
        new THREE.Vector3(min.x - wallThickness / 2, wallHeight / 2, (min.z + max.z) / 2),
        wallThickness,
        wallHeight,
        spanZ
      )
    );

    /* Jungle cover blocks scattered between lanes. Each block is a low wall
       that provides cover for firefights but doesn't block whole lanes. */
    const coverPositions: Vec3[] = [
      // Top jungle
      { x: 18, y: 0, z: 18 },
      { x: 36, y: 0, z: 16 },
      { x: 38, y: 0, z: 30 },
      // Mid river rocks
      { x: 6, y: 0, z: 4 },
      { x: -6, y: 0, z: -4 },
      { x: 8, y: 0, z: -6 },
      { x: -8, y: 0, z: 6 },
      // Bot jungle
      { x: 18, y: 0, z: -18 },
      { x: 36, y: 0, z: -16 },
      { x: 38, y: 0, z: -30 },
    ];
    for (const p of coverPositions) {
      const w = 4 + Math.random() * 1.5;
      const d = 1.6;
      const h = 1.6;
      const center = new THREE.Vector3(p.x, h / 2, p.z);
      aabbs.push(boxAABB(center, w, h, d));
    }

    /* Lane divider walls: thin walls separating the three lanes from the
       jungle, so vision control matters. Holes are left at the standard
       choke points. */
    const dividerX = 14; // distance from center where dividers start
    const dividerHeight = 2.4;
    const dividerThickness = 0.6;
    // Top-side divider (separates top lane from jungle)
    for (let z = 0; z <= 30; z += 6) {
      // skip the gap near lane entrance
      if (z === 18) continue;
      const center = new THREE.Vector3(dividerX, dividerHeight / 2, z);
      aabbs.push(boxAABB(center, dividerThickness, dividerHeight, 5.4));
    }
    for (let z = 0; z >= -30; z -= 6) {
      if (z === -18) continue;
      const center = new THREE.Vector3(dividerX, dividerHeight / 2, z);
      aabbs.push(boxAABB(center, dividerThickness, dividerHeight, 5.4));
    }

    /* Base gates: each base is enclosed by an inner wall with one opening
       (the lane exit). */
    const baseWallHeight = 3.2;
    const baseWallThickness = 0.8;
    // Blue base enclosure (around +X)
    const bx = 65;
    aabbs.push(
      boxAABB(new THREE.Vector3(bx, baseWallHeight / 2, -8), 1, baseWallHeight, 8),
      boxAABB(new THREE.Vector3(bx, baseWallHeight / 2, 8), 1, baseWallHeight, 8),
      boxAABB(new THREE.Vector3(bx + 3.5, baseWallHeight / 2, -3.5), 4, baseWallHeight, baseWallThickness),
      boxAABB(new THREE.Vector3(bx + 3.5, baseWallHeight / 2, 3.5), 4, baseWallHeight, baseWallThickness)
    );
    // Red base enclosure
    const rx = -65;
    aabbs.push(
      boxAABB(new THREE.Vector3(rx, baseWallHeight / 2, -8), 1, baseWallHeight, 8),
      boxAABB(new THREE.Vector3(rx, baseWallHeight / 2, 8), 1, baseWallHeight, 8),
      boxAABB(new THREE.Vector3(rx - 3.5, baseWallHeight / 2, -3.5), 4, baseWallHeight, baseWallThickness),
      boxAABB(new THREE.Vector3(rx - 3.5, baseWallHeight / 2, 3.5), 4, baseWallHeight, baseWallThickness)
    );

    return { colliders: aabbs };
  }, [def]);

  // Push colliders out via callback whenever they change.
  useMemo(() => {
    if (onColliders) onColliders(colliders);
  }, [colliders, onColliders]);

  return (
    <group>
      {/* Floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(def.boundsMin.x + def.boundsMax.x) / 2, -0.01, (def.boundsMin.z + def.boundsMax.z) / 2]}
        receiveShadow
      >
        <planeGeometry args={[def.boundsMax.x - def.boundsMin.x, def.boundsMax.z - def.boundsMin.z]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.95} />
      </mesh>

      {/* Lane strips (visual only) */}
      <LaneStrip z={0} width={8} color={LANE_COLOR} />
      <LaneStrip z={28} width={6} color={LANE_COLOR} />
      <LaneStrip z={-28} width={6} color={LANE_COLOR} />

      {/* River */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[20, 32]} />
        <meshStandardMaterial color={RIVER_COLOR} transparent opacity={0.6} />
      </mesh>

      {/* Jungle patches */}
      <JunglePatch center={new THREE.Vector3(20, 0, 0)} size={[36, 60]} />
      <JunglePatch center={new THREE.Vector3(-20, 0, 0)} size={[36, 60]} />

      {/* Blue base floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[65, 0.002, 0]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color={BLUE_BASE_COLOR} roughness={0.7} />
      </mesh>

      {/* Red base floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-65, 0.002, 0]}>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color={RED_BASE_COLOR} roughness={0.7} />
      </mesh>

      {/* Nexus placeholder: large glowing crystal at each base */}
      <NexusPlaceholder position={[78, 1.2, 0]} color={SPAWN_BLUE} />
      <NexusPlaceholder position={[-78, 1.2, 0]} color={SPAWN_RED} />

      {/* Cover blocks (rendering mirrors collider list) */}
      {colliders.slice(4, 14).map((c, i) => (
        <mesh
          key={`cover-${i}`}
          position={[
            (c.min.x + c.max.x) / 2,
            (c.min.y + c.max.y) / 2,
            (c.min.z + c.max.z) / 2,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z]} />
          <meshStandardMaterial color={JUNGLE_COLOR} roughness={0.9} />
        </mesh>
      ))}

      {/* Outer walls (visualization only; the AABBs already provide collision) */}
      <BoundaryWalls min={vec(def.boundsMin)} max={vec(def.boundsMax)} color={WALL_COLOR} />

      {/* Lane dividers (visualization) */}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={`divider-top-${i}`} position={[14, 1.2, i * 6]} castShadow>
          <boxGeometry args={[0.6, 2.4, 5.4]} />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh key={`divider-bot-${i}`} position={[14, 1.2, -i * 6]} castShadow>
          <boxGeometry args={[0.6, 2.4, 5.4]} />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      ))}

      {/* Base walls */}
      <BaseEnclosure center={65} color={BLUE_BASE_COLOR} />
      <BaseEnclosure center={-65} color={RED_BASE_COLOR} />

      {/* Spawn beacons */}
      <SpawnBeacon position={[70, 0.05, 0]} color={SPAWN_BLUE} />
      <SpawnBeacon position={[-70, 0.05, 0]} color={SPAWN_RED} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Visual subcomponents                                              *
 * ------------------------------------------------------------------ */

function LaneStrip({ z, width, color }: { z: number; width: number; color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, z]}>
      <planeGeometry args={[180, width]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function JunglePatch({
  center,
  size,
}: {
  center: THREE.Vector3;
  size: [number, number];
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, 0.001, center.z]}>
      <planeGeometry args={size} />
      <meshStandardMaterial color={JUNGLE_COLOR} roughness={0.95} />
    </mesh>
  );
}

function NexusPlaceholder({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <octahedronGeometry args={[1.6, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.2}
          metalness={0.4}
        />
      </mesh>
      <pointLight color={color} intensity={1.5} distance={6} />
    </group>
  );
}

function BoundaryWalls({ min, max, color }: { min: THREE.Vector3; max: THREE.Vector3; color: string }) {
  const spanX = max.x - min.x;
  const spanZ = max.z - min.z;
  const wallHeight = 4;
  const wallThickness = 1;
  return (
    <group>
      <mesh position={[(min.x + max.x) / 2, wallHeight / 2, max.z + wallThickness / 2]} castShadow>
        <boxGeometry args={[spanX + wallThickness * 2, wallHeight, wallThickness]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[(min.x + max.x) / 2, wallHeight / 2, min.z - wallThickness / 2]} castShadow>
        <boxGeometry args={[spanX + wallThickness * 2, wallHeight, wallThickness]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[max.x + wallThickness / 2, wallHeight / 2, (min.z + max.z) / 2]} castShadow>
        <boxGeometry args={[wallThickness, wallHeight, spanZ]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      <mesh position={[min.x - wallThickness / 2, wallHeight / 2, (min.z + max.z) / 2]} castShadow>
        <boxGeometry args={[wallThickness, wallHeight, spanZ]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
    </group>
  );
}

function BaseEnclosure({ center, color }: { center: number; color: string }) {
  const wallHeight = 3.2;
  const wallThickness = 0.8;
  const x = center;
  return (
    <group>
      <mesh position={[x, wallHeight / 2, -4]} castShadow>
        <boxGeometry args={[1, wallHeight, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[x, wallHeight / 2, 4]} castShadow>
        <boxGeometry args={[1, wallHeight, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[x + (center > 0 ? 3.5 : -3.5), wallHeight / 2, -3.5]} castShadow>
        <boxGeometry args={[4, wallHeight, wallThickness]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[x + (center > 0 ? 3.5 : -3.5), wallHeight / 2, 3.5]} castShadow>
        <boxGeometry args={[4, wallHeight, wallThickness]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}

function SpawnBeacon({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.8, 0.8, 0.1, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.2}
          transparent
          opacity={0.85}
        />
      </mesh>
      <pointLight color={color} intensity={0.6} distance={6} />
    </group>
  );
}