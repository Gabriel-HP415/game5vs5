import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useAppStore } from "../store";
import { emitTracer } from "./Tracers";

/* ------------------------------------------------------------------ *
 * Local firing UX                                                    *
 * ------------------------------------------------------------------ *
 * Phase 2: actual hitscan and damage now run on the server. This      *
 * controller only handles CLIENT-SIDE feedback:                       *
 *   - draws a tracer line for every accepted local fire              *
 *   - updates local "shots fired" stats                                *
 *   - listens for hit events (event.damage from server) to flip      *
 *     `hits` stat and trigger a hit flash.                            *
 *                                                                      *
 * The `FiringController` in the canvas still wires the mousedown      *
 * events so the controller hook can intercept and call                *
 * `network.sendFire()`. Tracers originate from the camera with a       *
 * slight downward offset to match the weapon muzzle.                  *
 * ------------------------------------------------------------------ */

export function FiringController() {
  const { camera } = useThree();
  // No-op placeholder: actual firing input is now handled inside
  // `useFpsController`. We keep this component so the canvas can mount
  // it for parity with Phase 1; it only ensures that hits from the
  // server result in a client-side hit flash + tracer effect.

  useEffect(() => {
    // Subscribe to server damage events for instant hit feedback.
    const unsub = useAppStore.subscribe((state, prev) => {
      // We don't currently store damage events in the store; they arrive
      // as server messages and the network layer already flips hit flash.
      // This subscription is a placeholder in case we add per-event state.
      void state;
      void prev;
    });
    return () => unsub();
  }, []);

  useFrame(() => {
    // No per-frame work: this controller is now a no-op marker.
    void camera;
  });

  return null;
}

/* ------------------------------------------------------------------ *
 * Tracer helpers used by both client prediction and server events     *
 * ------------------------------------------------------------------ */

export function drawTracerFromCamera(
  camera: THREE.Camera,
  hit: { x: number; y: number; z: number } | null,
  range: number,
  idSuffix: string
): void {
  const origin: [number, number, number] = [
    camera.position.x,
    camera.position.y - 0.05,
    camera.position.z,
  ];
  let target: [number, number, number];
  if (hit) {
    target = [hit.x, hit.y, hit.z];
  } else {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const end = new THREE.Vector3()
      .copy(camera.position)
      .add(dir.multiplyScalar(range));
    target = [end.x, end.y, end.z];
  }
  emitTracer({ id: `tracer-${idSuffix}`, origin, target, ttl: 0.08 });
}
