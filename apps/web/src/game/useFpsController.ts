import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PHYSICS_CONFIG } from "@rift/shared";
import { useAppStore } from "../store";
import { network, TICK_RATE } from "../network";
import { emitTracer } from "./Tracers";

/* ------------------------------------------------------------------ *
 * FPS controller                                                      *
 * ------------------------------------------------------------------ *
 * Phase 2: local movement is predicted on the client for instant input*
 * feel (WASD/sprint/jump/look), and the local yaw/pitch is sent to the *
 * authoritative server at 30 Hz. The server returns an authoritative   *
 * position snapshot that we snap the camera to on each game.state.    *
 * This is the "stable authoritative baseline" approach: no full       *
 * client-side prediction/reconciliation, but the local simulation     *
 * still drives the camera so controls feel instant.                   *
 * ------------------------------------------------------------------ */

export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface FpsControllerOptions {
  /** Collision boxes (axis-aligned). */
  colliders: AABB[];
  /** Initial yaw in radians. */
  initialYaw?: number;
  /** Initial pitch in radians. */
  initialPitch?: number;
}

interface MovementInputState {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  fire: boolean;
  reload: boolean;
}

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();
const tmpVel = new THREE.Vector3();

/**
 * Resolve axis-aligned wall collision. The player is treated as a capsule of
 * radius `r` and height `h`, but for the graybox prototype we approximate it
 * as a vertical cylinder of radius `r`. Returns the corrected position.
 */
function resolveCollision(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  colliders: AABB[],
  radius: number
): { hitHorizontal: boolean; grounded: boolean } {
  let hitHorizontal = false;
  let grounded = false;

  // Apply x and z separately so we can slide along walls.
  for (const c of colliders) {
    const closest = new THREE.Vector3(
      Math.max(c.min.x, Math.min(position.x, c.max.x)),
      Math.max(c.min.y, Math.min(position.y, c.max.y)),
      Math.max(c.min.z, Math.min(position.z, c.max.z))
    );
    const dx = position.x - closest.x;
    const dy = position.y - closest.y;
    const dz = position.z - closest.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < radius * radius) {
      const overlapX = radius - Math.abs(dx);
      const overlapY = radius - Math.abs(dy);
      const overlapZ = radius - Math.abs(dz);
      if (overlapY <= overlapX && overlapY <= overlapZ) {
        if (dy > 0) {
          position.y = c.max.y + radius;
          grounded = true;
          if (velocity.y < 0) velocity.y = 0;
        } else if (dy < 0) {
          position.y = c.min.y - radius;
          if (velocity.y > 0) velocity.y = 0;
        }
      } else if (overlapX <= overlapZ) {
        if (dx > 0) {
          position.x = c.max.x + radius;
        } else if (dx < 0) {
          position.x = c.min.x - radius;
        }
        velocity.x = 0;
        hitHorizontal = true;
      } else {
        if (dz > 0) {
          position.z = c.max.z + radius;
        } else if (dz < 0) {
          position.z = c.min.z - radius;
        }
        velocity.z = 0;
        hitHorizontal = true;
      }
    }
  }

  return { hitHorizontal, grounded };
}

/* ------------------------------------------------------------------ *
 * Hook                                                                *
 * ------------------------------------------------------------------ */

export function useFpsController(options: FpsControllerOptions) {
  const { camera, gl } = useThree();
  const optsRef = useRef(options);
  optsRef.current = options;

  const inputRef = useRef<MovementInputState>({
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    fire: false,
    reload: false,
  });
  const velRef = useRef(new THREE.Vector3());
  const groundedRef = useRef(true);
  const lockRef = useRef(false);
  const firePressedRef = useRef(false);

  const applyPlayer = useAppStore((s) => s.applyPlayer);
  const setPauseOpen = useAppStore((s) => s.setPauseOpen);
  const pauseOpen = useAppStore((s) => s.pauseOpen);

  /* Pointer-lock & input wiring ---------------------------------- */
  useEffect(() => {
    const dom = gl.domElement;

    const onMouseMove = (e: MouseEvent) => {
      if (!lockRef.current) return;
      const sens = useAppStore.getState().settings.mouseSensitivity;
      const state = useAppStore.getState();
      const player = state.player;
      // Pointer-lock convention used by this codebase:
      //   yaw = 0  -> forward  (-Z)
      //   yaw = π/2 -> right    (+X)
      player.yaw += e.movementX * 0.0025 * sens;
      // Pitch convention: sin(pitch) is the up component of the look
      // vector, so pitch > 0 means looking UP. Pointer-lock reports
      // movementY > 0 when the user pushes the mouse DOWN (screen-space
      // Y grows downward), so we must SUBTRACT movementY so that mouse-up
      // (movementY < 0) makes pitch grow (look up).
      player.pitch -= e.movementY * 0.0025 * sens;
      // clamp pitch
      const halfPi = Math.PI / 2 - 0.01;
      if (player.pitch > halfPi) player.pitch = halfPi;
      if (player.pitch < -halfPi) player.pitch = -halfPi;
      // unrolled yaw
      while (player.yaw > Math.PI) player.yaw -= Math.PI * 2;
      while (player.yaw < -Math.PI) player.yaw += Math.PI * 2;
      // apply directly to the camera
      const lookX = Math.cos(player.pitch) * Math.sin(player.yaw);
      const lookY = Math.sin(player.pitch);
      const lookZ = -Math.cos(player.pitch) * Math.cos(player.yaw);
      camera.lookAt(
        camera.position.x + lookX,
        camera.position.y + lookY,
        camera.position.z + lookZ
      );
      state.applyPlayer({ yaw: player.yaw, pitch: player.pitch });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          inputRef.current.forward = 1;
          break;
        case "KeyS":
        case "ArrowDown":
          inputRef.current.forward = -1;
          break;
        case "KeyA":
        case "ArrowLeft":
          inputRef.current.right = -1;
          break;
        case "KeyD":
        case "ArrowRight":
          inputRef.current.right = 1;
          break;
        case "Space":
          if (groundedRef.current) {
            velRef.current.y = PHYSICS_CONFIG.jumpVelocity;
            groundedRef.current = false;
          }
          inputRef.current.jump = true;
          e.preventDefault();
          break;
        case "ShiftLeft":
        case "ShiftRight":
          inputRef.current.sprint = true;
          break;
        case "KeyR":
          inputRef.current.reload = true;
          break;
        case "Escape":
          setPauseOpen(true);
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          if (inputRef.current.forward === 1) inputRef.current.forward = 0;
          break;
        case "KeyS":
        case "ArrowDown":
          if (inputRef.current.forward === -1) inputRef.current.forward = 0;
          break;
        case "KeyA":
        case "ArrowLeft":
          if (inputRef.current.right === -1) inputRef.current.right = 0;
          break;
        case "KeyD":
        case "ArrowRight":
          if (inputRef.current.right === 1) inputRef.current.right = 0;
          break;
        case "Space":
          inputRef.current.jump = false;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          inputRef.current.sprint = false;
          break;
        case "KeyR":
          inputRef.current.reload = false;
          break;
        default:
          break;
      }
    };

    const onPointerLockChange = () => {
      lockRef.current = document.pointerLockElement === dom;
      if (!lockRef.current) {
        inputRef.current.forward = 0;
        inputRef.current.right = 0;
        inputRef.current.sprint = false;
        inputRef.current.fire = false;
        useAppStore.getState().setPauseOpen(true);
      }
    };

    const onClick = () => {
      if (!lockRef.current && document.pointerLockElement !== dom) {
        try {
          dom.requestPointerLock();
        } catch {
          /* user gesture might not be available */
        }
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!lockRef.current) return;
      if (e.button === 0) {
        firePressedRef.current = true;
        inputRef.current.fire = true;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        firePressedRef.current = false;
        inputRef.current.fire = false;
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    dom.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      dom.removeEventListener("click", onClick);
    };
  }, [camera, gl.domElement, setPauseOpen]);

  /* Per-frame movement update ----------------------------------- */
  const syncFromStore = useCallback(() => {
    const state = useAppStore.getState();
    const p = state.player;
    camera.position.set(p.position.x, p.position.y, p.position.z);
  }, [camera]);

  // Sync initial camera transform to store values once.
  useEffect(() => {
    syncFromStore();
  }, [syncFromStore]);

  // Track last fire time to drive hit feedback
  const lastFireFrameTime = useRef(0);

  useFrame((_, delta) => {
    if (pauseOpen) {
      return;
    }
    const dt = Math.min(delta, 0.1);
    const state = useAppStore.getState();
    if (!state.player.alive) {
      // While dead, freeze the camera at the death location and don't run physics.
      // The server controls respawn.
      return;
    }

    const pos = new THREE.Vector3().copy(camera.position);
    const vel = velRef.current;

    // Decompose yaw into forward / right vectors on the XZ plane.
    const yaw = state.player.yaw;
    tmpForward.set(Math.sin(yaw), 0, -Math.cos(yaw));
    tmpRight.set(Math.cos(yaw), 0, Math.sin(yaw));

    const speed = inputRef.current.sprint
      ? PHYSICS_CONFIG.sprintSpeed
      : PHYSICS_CONFIG.walkSpeed;

    tmpDelta.set(0, 0, 0);
    tmpDelta.addScaledVector(tmpForward, inputRef.current.forward * speed);
    tmpDelta.addScaledVector(tmpRight, inputRef.current.right * speed);

    tmpVel.copy(vel);
    tmpVel.x = THREE.MathUtils.lerp(tmpVel.x, tmpDelta.x, 10 * dt);
    tmpVel.z = THREE.MathUtils.lerp(tmpVel.z, tmpDelta.z, 10 * dt);
    vel.x = tmpVel.x;
    vel.z = tmpVel.z;

    vel.y += PHYSICS_CONFIG.gravity * dt;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    const { grounded } = resolveCollision(
      pos,
      vel,
      optsRef.current.colliders,
      PHYSICS_CONFIG.playerRadius
    );
    groundedRef.current = grounded;

    if (grounded && vel.y < 0) {
      vel.y = 0;
    }
    if (pos.y < PHYSICS_CONFIG.playerHeight) {
      pos.y = PHYSICS_CONFIG.playerHeight;
      vel.y = 0;
      groundedRef.current = true;
    }

    camera.position.copy(pos);
    applyPlayer({
      position: { x: pos.x, y: pos.y, z: pos.z },
      velocity: { x: vel.x, y: vel.y, z: vel.z },
    });

    // Send input to the server (throttled internally)
    const inMatch = network.isInMatch();
    if (inMatch) {
      const yawNow = state.player.yaw;
      const pitchNow = state.player.pitch;
      const eyeVec = new THREE.Vector3(pos.x, pos.y + 0.1, pos.z);
      const eye = { x: eyeVec.x, y: eyeVec.y, z: eyeVec.z };
      // Fire: only when fire button pressed AND cooldown elapsed
      const now = performance.now();
      if (firePressedRef.current && now - lastFireFrameTime.current > 50) {
        if (network.sendFire(yawNow, pitchNow, eye, state.serverTick + 1)) {
          lastFireFrameTime.current = now;
          state.recordShot(false);
          // Client-side tracer visual: extends in the look direction.
          const lookDir = new THREE.Vector3(
            Math.cos(pitchNow) * Math.sin(yawNow),
            Math.sin(pitchNow),
            -Math.cos(pitchNow) * Math.cos(yawNow)
          );
          const end = eyeVec.clone().add(lookDir.multiplyScalar(60));
          emitTracer({
            id: `tracer-${now}`,
            origin: [eye.x, eye.y - 0.05, eye.z],
            target: [end.x, end.y, end.z],
            ttl: 0.08,
          });
        }
      }
      if (inputRef.current.reload) {
        network.sendReload(state.serverTick + 1);
        inputRef.current.reload = false;
      }
      network.sendInput(
        {
          forward: inputRef.current.forward,
          right: inputRef.current.right,
          jump: inputRef.current.jump,
          sprint: inputRef.current.sprint,
          yaw: yawNow,
          pitch: pitchNow,
          fire: false, // fire is its own message
          reload: false,
        },
        state.serverTick + 1
      );
    }
  });

  // Server reconciliation: on every store update that includes new
  // server tick, snap the camera to the authoritative position. We use
  // a small lerp to avoid hard snapping visible to the user.
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.serverTick !== prev.serverTick) {
        // Snap to server position only when we're not in a paused / death state
        if (state.player.alive) {
          camera.position.set(
            state.player.position.x,
            state.player.position.y,
            state.player.position.z
          );
        }
      }
    });
    return () => unsub();
  }, [camera]);

  return { TICK_RATE };
}

/* ------------------------------------------------------------------ *
 * Pointer lock helper                                                *
 * ------------------------------------------------------------------ */

export function usePointerLockToggle() {
  const setPauseOpen = useAppStore((s) => s.setPauseOpen);
  return useCallback(() => {
    if (!document.pointerLockElement) {
      const canvas = document.querySelector("canvas");
      if (canvas instanceof HTMLCanvasElement) {
        canvas.requestPointerLock?.();
        setPauseOpen(false);
      }
    } else {
      document.exitPointerLock?.();
    }
  }, [setPauseOpen]);
}

/* Unused exports are referenced for tree-shaking/typing. */
export { tmpForward, tmpRight, tmpDelta, tmpVel };
