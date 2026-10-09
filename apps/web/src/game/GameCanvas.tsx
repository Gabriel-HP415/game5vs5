import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../store";
import { Map } from "./Map";
import { WeaponModel } from "./WeaponModel";
import { TargetDummy } from "./TargetDummy";
import { Tracers } from "./Tracers";
import { FiringController } from "./FiringController";
import { useFpsController, type AABB } from "./useFpsController";
import { network } from "../network";
import { Minions } from "./Minions";
import { JungleMonsters } from "./JungleMonsters";
import { Turrets } from "./Turrets";

/* ------------------------------------------------------------------ *
 * Scene root                                                          *
 * ------------------------------------------------------------------ *
 * Hosts the R3F canvas, graybox map, dummies, FPS camera controller,  *
 * and the first-person weapon model attached to the camera.            *
 * ------------------------------------------------------------------ */

export function GameCanvas() {
  const player = useAppStore((s) => s.player);
  const [colliders, setColliders] = useState<AABB[]>([]);

  // Build dummy AABBs (visual position; health comes from the server).
  const dummyPositions: Array<{ id: string; pos: [number, number, number] }> = useMemo(
    () => [
      { id: "mid-1",    pos: [-11, 0, 0] },
      { id: "mid-2",    pos: [11, 0, 0] },
      { id: "lane-top", pos: [23.5, 0, 23.5] },
      { id: "lane-bot", pos: [-23.5, 0, -23.5] },
    ],
    []
  );

  return (
    <Canvas
      shadows
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{
        fov: 90,
        near: 0.05,
        far: 500,
        position: [player.position.x, player.position.y, player.position.z],
      }}
      onCreated={({ gl }) => {
        gl.setClearColor("#0a1020");
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
    >
      <ambientLight intensity={0.45} />
      <hemisphereLight args={["#a6d8ff", "#1a1f30", 0.4]} />
      <directionalLight
        position={[40, 60, 20]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />

      <Map onColliders={setColliders} />

      {/* Target dummies — health driven by the server */}
      {dummyPositions.map((d) => (
        <TargetDummy
          key={d.id}
          id={d.id}
          position={d.pos}
          maxHealth={200}
          respawnSeconds={3}
        />
      ))}

      <Tracers />
      <FiringController />

      {/* Server-authoritative MOBA entities (Phase 3) */}
      <Minions />
      <JungleMonsters />
      <Turrets />

      <FpsControllerHost colliders={colliders} />
      <CameraAttachedWeapon />
      <RemotePlayers />
    </Canvas>
  );
}

function FpsControllerHost({ colliders }: { colliders: AABB[] }) {
  useFpsController({ colliders });
  return null;
}

/**
 * Attaches the first-person weapon model to the camera so it follows the
 * player's view. This component must be a child of <Canvas>.
 */
function CameraAttachedWeapon() {
  const { camera } = useThree();
  const groupRef = React.useRef<THREE.Group | null>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const offset = new THREE.Vector3(0.32, -0.32, -0.55);
    offset.applyQuaternion(camera.quaternion);
    g.position.copy(camera.position).add(offset);
    g.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={groupRef}>
      <WeaponModel weaponId="classic" />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * RemotePlayers                                                       *
 * ------------------------------------------------------------------ *
 * Renders a simple visual marker for every other player in the match.  *
 * Future phases will use the full agent model.                         *
 * ------------------------------------------------------------------ */

function RemotePlayers() {
  const players = useAppStore((s) => s.players);
  const myId = useAppStore((s) => s.myPlayerId);
  return (
    <>
      {Object.values(players)
        .filter((p) => p.id !== myId)
        .map((p) => (
          <RemotePlayerMarker key={p.id} player={p} />
        ))}
    </>
  );
}

function RemotePlayerMarker({ player }: { player: { id: string; name: string; team: "blue" | "red"; position: { x: number; y: number; z: number }; yaw: number; pitch: number; alive: boolean; weapon: string } }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!player.alive) {
      g.visible = false;
      return;
    }
    g.visible = true;
    // Smooth interpolation toward server position
    g.position.x = THREE.MathUtils.lerp(g.position.x, player.position.x, Math.min(1, 12 * dt));
    g.position.y = player.position.y;
    g.position.z = THREE.MathUtils.lerp(g.position.z, player.position.z, Math.min(1, 12 * dt));
    g.rotation.y = -player.yaw;
  });
  const color = player.team === "blue" ? "#3aa3ff" : "#ff5263";
  return (
    <group ref={ref} position={[player.position.x, player.position.y, player.position.z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.9, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} />
      </mesh>
    </group>
  );
}
