/**
 * MatchSimulation — pure simulation core (no Colyseus dependency).
 *
 * This module is the authoritative gameplay loop used by the MatchRoom.
 * It is split out into a pure class so that automated tests can drive
 * the same code paths without needing a live Colyseus transport.
 *
 * Coordinate convention (matches client useFpsController):
 *   forward = (-Z) at yaw=0
 *   lookX =  cos(pitch) * sin(yaw)
 *   lookY =  sin(pitch)
 *   lookZ = -cos(pitch) * cos(yaw)
 *   movement forward = (sin(yaw), 0, -cos(yaw))
 *   movement right   = (cos(yaw), 0,  sin(yaw))
 */
import type {
  KillFeedEntry,
  ServerGameState,
  ServerPlayerAmmo,
  ServerPlayerSnapshot,
  ServerTargetSnapshot,
  Vec3,
} from "@rift/shared";
import {
  TICK_RATE_HZ,
  TICK_DT_SEC,
  MATCH_CONFIG,
  RESPAWN_CONFIG,
  PHYSICS_CONFIG,
  WEAPONS,
  STARTER_WEAPON_ID,
  clampNumber,
  isValidAim,
  MAP_DEFAULT,
  SHOP_ITEMS,
  ECONOMY_CONFIG,
  type ShopItem,
} from "@rift/shared";
import { MinionSystem, type MinionState, type TargetHandle } from "./MinionSystem.js";
import { JungleSystem } from "./JungleSystem.js";
import { TurretSystem } from "./TurretSystem.js";
import { EconomySystem } from "./EconomySystem.js";
import { MatchLifecycle } from "./MatchLifecycle.js";

/* ------------------------------------------------------------------ *
 * AABB collision (mirrors client-side collision in useFpsController)    *
 * ------------------------------------------------------------------ */

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function resolveCollision(
  pos: Vec3,
  vel: Vec3,
  colliders: AABB[],
  radius: number
): boolean {
  let grounded = false;
  for (const c of colliders) {
    const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const cy = Math.max(c.min.y, Math.min(pos.y, c.max.y));
    const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const dz = pos.z - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < radius * radius) {
      const olY = radius - Math.abs(dy);
      const olX = radius - Math.abs(dx);
      const olZ = radius - Math.abs(dz);
      if (olY <= olX && olY <= olZ) {
        if (dy > 0) {
          pos.y = c.max.y + radius;
          grounded = true;
          if (vel.y < 0) vel.y = 0;
        } else if (dy < 0) {
          pos.y = c.min.y - radius;
          if (vel.y > 0) vel.y = 0;
        }
      } else if (olX <= olZ) {
        pos.x = dx > 0 ? c.max.x + radius : c.min.x - radius;
        vel.x = 0;
      } else {
        pos.z = dz > 0 ? c.max.z + radius : c.min.z - radius;
        vel.z = 0;
      }
    }
  }
  return grounded;
}

/* ------------------------------------------------------------------ *
 * Hitscan / ray vs AABB                                                 *
 * ------------------------------------------------------------------ */

export function rayHitsAABB(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  aabb: AABB
): number | null {
  const inv = { x: 1 / dir.x, y: 1 / dir.y, z: 1 / dir.z };
  const t1 = (aabb.min.x - origin.x) * inv.x;
  const t2 = (aabb.max.x - origin.x) * inv.x;
  const t3 = (aabb.min.y - origin.y) * inv.y;
  const t4 = (aabb.max.y - origin.y) * inv.y;
  const t5 = (aabb.min.z - origin.z) * inv.z;
  const t6 = (aabb.max.z - origin.z) * inv.z;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
  if (tmax < 0 || tmin > tmax) return null;
  const t = tmin >= 0 ? tmin : tmax;
  if (t > maxDist) return null;
  return t;
}

/* ------------------------------------------------------------------ *
 * Map colliders (built once, reused)                                  *
 * ------------------------------------------------------------------ */

export function buildMapColliders(): AABB[] {
  const { boundsMin, boundsMax } = MAP_DEFAULT;
  const wallH = 4;
  const wallT = 1;
  const aabbs: AABB[] = [];
  aabbs.push(
    { min: { x: boundsMin.x - wallT, y: 0, z: boundsMin.z }, max: { x: boundsMax.x + wallT, y: wallH, z: boundsMin.z + wallT } },
    { min: { x: boundsMin.x - wallT, y: 0, z: boundsMax.z - wallT }, max: { x: boundsMax.x + wallT, y: wallH, z: boundsMax.z + wallT } },
    { min: { x: boundsMax.x - wallT, y: 0, z: boundsMin.z }, max: { x: boundsMax.x + wallT, y: wallH, z: boundsMax.z + wallT } },
    { min: { x: boundsMin.x - wallT, y: 0, z: boundsMin.z }, max: { x: boundsMin.x + wallT, y: wallH, z: boundsMax.z + wallT } }
  );
  const covers = [
    { x: 18, z: 18 }, { x: 36, z: 16 }, { x: 38, z: 30 },
    { x: 6, z: 4 }, { x: -6, z: -4 }, { x: 8, z: -6 }, { x: -8, z: 6 },
    { x: 18, z: -18 }, { x: 36, z: -16 }, { x: 38, z: -30 },
  ];
  for (const c of covers) {
    aabbs.push({ min: { x: c.x - 2.5, y: 0, z: c.z - 1 }, max: { x: c.x + 2.5, y: 1.6, z: c.z + 1 } });
  }
  return aabbs;
}

export const MAP_COLLIDERS = buildMapColliders();

/* ------------------------------------------------------------------ *
 * Target / dummy state                                                *
 * ------------------------------------------------------------------ */

export interface TargetState {
  id: string;
  position: Vec3;
  halfExtents: Vec3;
  maxHealth: number;
  health: number;
  alive: boolean;
  respawnTimer: number;
  respawnSeconds: number;
}

export function makeDefaultTargets(): TargetState[] {
  return [
    { id: "mid-1",  position: { x: -11, y: 0, z: 0 },   halfExtents: { x: 1, y: 1, z: 1 }, maxHealth: 200, health: 200, alive: true, respawnTimer: 0, respawnSeconds: 3 },
    { id: "mid-2",  position: { x: 11,  y: 0, z: 0 },   halfExtents: { x: 1, y: 1, z: 1 }, maxHealth: 200, health: 200, alive: true, respawnTimer: 0, respawnSeconds: 3 },
    { id: "lane-top", position: { x: 23.5, y: 0, z: 23.5 }, halfExtents: { x: 1, y: 1, z: 1 }, maxHealth: 200, health: 200, alive: true, respawnTimer: 0, respawnSeconds: 3 },
    { id: "lane-bot", position: { x: -23.5, y: 0, z: -23.5 }, halfExtents: { x: 1, y: 1, z: 1 }, maxHealth: 200, health: 200, alive: true, respawnTimer: 0, respawnSeconds: 3 },
  ];
}

export function targetAABB(t: TargetState): AABB {
  return {
    min: { x: t.position.x - t.halfExtents.x, y: t.position.y, z: t.position.z - t.halfExtents.z },
    max: { x: t.position.x + t.halfExtents.x, y: t.position.y + t.halfExtents.y * 2, z: t.position.z + t.halfExtents.z },
  };
}

/* ------------------------------------------------------------------ *
 * Player state                                                        *
 * ------------------------------------------------------------------ */

export interface PlayerState {
  id: string;
  name: string;
  team: "blue" | "red";
  weapon: string;
  position: Vec3;
  yaw: number;
  pitch: number;
  velocity: Vec3;
  health: number;
  maxHealth: number;
  armor: number;
  credits: number;
  kills: number;
  deaths: number;
  assists: number;
  alive: boolean;
  respawnTimer: number;
  magazine: number;
  reserve: number;
  reloading: boolean;
  reloadEndsAtTick: number;
  nextShotAtTick: number;
  // Movement input
  inputForward: number;
  inputRight: number;
  inputSprint: boolean;
  inputJump: boolean;
  // Internal physics
  velY: number;
  grounded: boolean;
}

export function spawnPlayerAt(ps: PlayerState, position: Vec3, yaw: number): void {
  ps.position = { x: position.x, y: PHYSICS_CONFIG.playerHeight, z: position.z };
  ps.yaw = yaw;
  ps.pitch = 0;
  ps.velocity = { x: 0, y: 0, z: 0 };
  ps.velY = 0;
  ps.grounded = true;
  ps.alive = true;
  ps.health = ps.maxHealth;
  ps.respawnTimer = 0;
  const w = WEAPONS[ps.weapon as keyof typeof WEAPONS];
  ps.magazine = w.magazineSize;
  ps.reserve = w.reserveAmmo;
  ps.reloading = false;
  ps.reloadEndsAtTick = 0;
  ps.nextShotAtTick = 0;
}

export function respawnSecondsFor(matchSeconds: number): number {
  const matchMinute = matchSeconds / 60;
  for (const tier of RESPAWN_CONFIG.tiers) {
    if (matchMinute <= tier.upToMinute) return tier.seconds;
  }
  return RESPAWN_CONFIG.tiers[RESPAWN_CONFIG.tiers.length - 1].seconds;
}

/* ------------------------------------------------------------------ *
 * MatchSimulation                                                     *
 * ------------------------------------------------------------------ */

export interface MatchSimulationOptions {
  /** Optional override for tick rate (for tests that want to advance ticks). */
  tickRateHz?: number;
  /** Optional map colliders; defaults to the built-in graybox layout. */
  colliders?: AABB[];
  /** Optional target definitions; defaults to makeDefaultTargets(). */
  targets?: TargetState[];
}

export interface DamageEvent {
  targetId: string;
  attackerId: string;
  amount: number;
  hitbox: "head" | "body" | "legs";
  weapon: string;
  targetIsPlayer: boolean;
}

export interface FireValidationResult {
  accepted: boolean;
  reason?: "no_ammo" | "reloading" | "fire_rate" | "dead" | "invalid_aim";
  hit?: { targetId: string; distance: number; point: Vec3 };
  damageEvent?: DamageEvent;
}

export class MatchSimulation {
  readonly players = new Map<string, PlayerState>();
  readonly targets: TargetState[];
  readonly killFeed: KillFeedEntry[] = [];
  readonly minions = new MinionSystem();
  readonly jungle = new JungleSystem();
  readonly turrets = new TurretSystem();
  readonly economy = new EconomySystem();
  readonly lifecycle = new MatchLifecycle();
  /** Single-shot guard for Nexus destruction. */
  nexusDestroyedOnce = new Set<"blue" | "red">();
  /** Has the initial wave been spawned yet? (Lifecycle auto-start.) */
  private autoStarted = false;
  serverTick = 0;
  matchTimeSeconds = 0;
  readonly colliders: AABB[];
  readonly tickRateHz: number;
  readonly tickDt: number;

  constructor(options: MatchSimulationOptions = {}) {
    this.tickRateHz = options.tickRateHz ?? TICK_RATE_HZ;
    this.tickDt = 1 / this.tickRateHz;
    this.colliders = options.colliders ?? MAP_COLLIDERS;
    this.targets = options.targets ?? makeDefaultTargets();
    this.economy.bindPlayerSource(
      (id) => {
        const p = this.players.get(id);
        if (!p) return null;
        return { credits: p.credits, alive: p.alive };
      },
      () =>
        Array.from(this.players.entries()).map(([id, p]) => [
          id,
          { credits: p.credits, alive: p.alive, team: p.team },
        ]),
      (id, credits) => {
        const p = this.players.get(id);
        if (p) p.credits = credits;
      }
    );
  }

  /* ----- Player management --------------------------------------- */

  addPlayer(id: string, name: string, team: "blue" | "red", weapon = STARTER_WEAPON_ID): PlayerState {
    const spawn = MAP_DEFAULT.spawnPoints.find((s) => s.team === team)!;
    const ps: PlayerState = {
      id,
      name,
      team,
      weapon,
      position: { x: 0, y: 0, z: 0 },
      yaw: Math.PI,
      pitch: 0,
      velocity: { x: 0, y: 0, z: 0 },
      health: MATCH_CONFIG.agentBaseHealth,
      maxHealth: MATCH_CONFIG.agentBaseHealth,
      armor: 0,
      credits: MATCH_CONFIG.startingCredits,
      kills: 0,
      deaths: 0,
      assists: 0,
      alive: true,
      respawnTimer: 0,
      magazine: 0,
      reserve: 0,
      reloading: false,
      reloadEndsAtTick: 0,
      nextShotAtTick: 0,
      inputForward: 0,
      inputRight: 0,
      inputSprint: false,
      inputJump: false,
      velY: 0,
      grounded: true,
    };
    spawnPlayerAt(ps, spawn.position, Math.PI);
    this.players.set(id, ps);
    // Auto-start the match the moment the first player joins.
    if (!this.autoStarted) {
      this.lifecycle.start();
      this.autoStarted = true;
    }
    return ps;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  /* ----- Input handling ----------------------------------------- */

  applyInput(id: string, input: {
    forward: number;
    right: number;
    sprint: boolean;
    jump: boolean;
    yaw: number;
    pitch: number;
  }): void {
    const ps = this.players.get(id);
    if (!ps || !ps.alive) return;
    ps.inputForward = clampNumber(input.forward, -1, 1);
    ps.inputRight = clampNumber(input.right, -1, 1);
    ps.inputSprint = !!input.sprint;
    ps.inputJump = !!input.jump;
    if (isValidAim(input.yaw, input.pitch)) {
      ps.yaw = input.yaw;
      ps.pitch = input.pitch;
    }
  }

  /**
   * Validate a fire request. Does NOT actually run the hitscan; the
   * caller calls `resolveHit()` for that. Returns the validation result
   * and, if accepted, deducts ammo and records the next-shot cooldown.
   */
  validateFire(id: string): { ok: true } | { ok: false; reason: FireValidationResult["reason"] } {
    const ps = this.players.get(id);
    if (!ps) return { ok: false, reason: "dead" };
    if (!ps.alive) return { ok: false, reason: "dead" };
    if (ps.magazine <= 0) return { ok: false, reason: "no_ammo" };
    if (ps.reloading) return { ok: false, reason: "reloading" };
    if (this.serverTick < ps.nextShotAtTick) return { ok: false, reason: "fire_rate" };
    return { ok: true };
  }

  /**
   * Run the authoritative hitscan for a shot, apply damage, and return
   * the outcome. Damage is routed against any hittable entity in front
   * of the shooter (target dummies, lane minions, jungle monsters,
   * turrets, Nexus, enemy players). The closest valid hit wins.
   */
  resolveHit(
    attackerId: string,
    yaw: number,
    pitch: number,
    origin: Vec3
  ): FireValidationResult {
    if (!this.lifecycle.isActive()) {
      return { accepted: false, reason: "dead" };
    }
    const ps = this.players.get(attackerId);
    if (!ps || !ps.alive) {
      return { accepted: false, reason: "dead" };
    }
    const weapon = WEAPONS[ps.weapon as keyof typeof WEAPONS];
    if (!weapon) return { accepted: false, reason: "invalid_aim" };

    // Validate aim direction
    let useYaw = yaw;
    let usePitch = pitch;
    if (!isValidAim(useYaw, usePitch)) {
      useYaw = ps.yaw;
      usePitch = ps.pitch;
    }

    // Validate cooldown
    if (this.serverTick < ps.nextShotAtTick) {
      return { accepted: false, reason: "fire_rate" };
    }
    if (ps.magazine <= 0) {
      return { accepted: false, reason: "no_ammo" };
    }
    if (ps.reloading) {
      return { accepted: false, reason: "reloading" };
    }

    // Deduct ammo and set cooldown
    ps.magazine--;
    const fireIntervalTicks = Math.ceil((60 / weapon.fireRateRpm) * this.tickRateHz);
    ps.nextShotAtTick = this.serverTick + fireIntervalTicks;

    // Direction
    const cp = Math.cos(usePitch);
    const sp = Math.sin(usePitch);
    const sy = Math.sin(useYaw);
    const cy = Math.cos(useYaw);
    const dir = { x: cp * sy, y: sp, z: -cp * cy };
    const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (dirLen < 0.001) return { accepted: true };
    dir.x /= dirLen; dir.y /= dirLen; dir.z /= dirLen;

    const maxRange = weapon.maxRangeM;

    // Test against targets (Phase 1 dummies), minions, jungle monsters,
    // turrets, Nexus, enemy players. Pick the closest valid hit.
    type HitKind = "target" | "minion" | "jungle" | "turret" | "player";
    let bestKind: HitKind | null = null;
    let bestId: string | null = null;
    let bestDist = Infinity;
    const consider = (kind: HitKind, id: string, dist: number | null) => {
      if (dist === null) return;
      if (dist > maxRange) return;
      if (dist < bestDist) {
        bestKind = kind;
        bestId = id;
        bestDist = dist;
      }
    };

    // Targets
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = rayHitsAABB(origin, dir, maxRange, targetAABB(t));
      consider("target", t.id, d ?? Infinity);
    }
    // Minions
    for (const m of this.minions.minions) {
      if (m.dead) continue;
      if (m.team === ps.team) continue;
      const aabb: AABB = {
        min: { x: m.position.x - 0.5, y: 0, z: m.position.z - 0.5 },
        max: { x: m.position.x + 0.5, y: 1.2, z: m.position.z + 0.5 },
      };
      const d = rayHitsAABB(origin, dir, maxRange, aabb);
      consider("minion", m.id, d ?? Infinity);
    }
    // Jungle monsters
    for (const jm of this.jungle.monsters) {
      if (!jm.alive) continue;
      const aabb: AABB = {
        min: { x: jm.position.x - 0.7, y: 0, z: jm.position.z - 0.7 },
        max: { x: jm.position.x + 0.7, y: 1.4, z: jm.position.z + 0.7 },
      };
      const d = rayHitsAABB(origin, dir, maxRange, aabb);
      consider("jungle", jm.id, d ?? Infinity);
    }
    // Turrets
    for (const tw of this.turrets.turrets) {
      if (!tw.alive) continue;
      if (tw.team === ps.team) continue;
      if (tw.protected) continue;
      const aabb: AABB = {
        min: { x: tw.position.x - 1.2, y: 0, z: tw.position.z - 1.2 },
        max: { x: tw.position.x + 1.2, y: 3, z: tw.position.z + 1.2 },
      };
      const d = rayHitsAABB(origin, dir, maxRange, aabb);
      consider("turret", tw.id, d ?? Infinity);
    }
    // Enemy players
    for (const other of this.players.values()) {
      if (other.id === ps.id) continue;
      if (other.team === ps.team) continue;
      if (!other.alive) continue;
      const aabb: AABB = {
        min: { x: other.position.x - 0.4, y: 0, z: other.position.z - 0.4 },
        max: { x: other.position.x + 0.4, y: 1.8, z: other.position.z + 0.4 },
      };
      const d = rayHitsAABB(origin, dir, maxRange, aabb);
      consider("player", other.id, d ?? Infinity);
    }

    if (bestKind === null || bestId === null) {
      return { accepted: true };
    }

    const damage = weapon.damageBody;
    if (bestKind === "target") {
      const t = this.targets.find((x) => x.id === bestId);
      if (t) {
        t.health -= damage;
        if (t.health <= 0) {
          t.health = 0;
          t.alive = false;
          t.respawnTimer = 0;
        }
        return {
          accepted: true,
          hit: { targetId: t.id, distance: bestDist, point: { x: 0, y: 0, z: 0 } },
          damageEvent: {
            targetId: t.id,
            attackerId,
            amount: damage,
            hitbox: "body",
            weapon: ps.weapon,
            targetIsPlayer: false,
          },
        };
      }
      return { accepted: true };
    }
    if (bestKind === "minion") {
      const m = this.minions.minions.find((x) => x.id === bestId);
      if (m) {
        const r = this.minions.damageFromPlayer(m.id, damage, ps.id);
        if (r.killed) {
          // Last-hit credit goes to the killing player only.
          this.economy.grantLastHit(ps.id, r.credit);
        }
        return {
          accepted: true,
          hit: { targetId: m.id, distance: bestDist, point: { x: 0, y: 0, z: 0 } },
          damageEvent: {
            targetId: m.id,
            attackerId,
            amount: damage,
            hitbox: "body",
            weapon: ps.weapon,
            targetIsPlayer: false,
          },
        };
      }
      return { accepted: true };
    }
    if (bestKind === "jungle") {
      const r = this.jungle.damageMonster(bestId, damage, ps.id);
      if (r.killed) {
        this.economy.grantLastHit(ps.id, r.reward);
        this.recordKillFeed("jungle", ps.id, bestId, r.reward);
      }
      return {
        accepted: true,
        hit: { targetId: bestId, distance: bestDist, point: { x: 0, y: 0, z: 0 } },
        damageEvent: {
          targetId: bestId,
          attackerId,
          amount: damage,
          hitbox: "body",
          weapon: ps.weapon,
          targetIsPlayer: false,
        },
      };
    }
    if (bestKind === "turret") {
      const r = this.turrets.damageTurret(bestId, damage, ps.id);
      if (r.killed) {
        this.awardTurretDestruction(bestId, ps.id);
      }
      return {
        accepted: true,
        hit: { targetId: bestId, distance: bestDist, point: { x: 0, y: 0, z: 0 } },
        damageEvent: {
          targetId: bestId,
          attackerId,
          amount: damage,
          hitbox: "body",
          weapon: ps.weapon,
          targetIsPlayer: false,
        },
      };
    }
    if (bestKind === "player") {
      const target = this.players.get(bestId);
      if (target) {
        const died = this.applyDamageToPlayer(target, damage, ps.id);
        if (died) {
          this.recordPlayerKill(ps.id, target.id);
        }
      }
      return {
        accepted: true,
        hit: { targetId: bestId, distance: bestDist, point: { x: 0, y: 0, z: 0 } },
        damageEvent: {
          targetId: bestId,
          attackerId,
          amount: damage,
          hitbox: "body",
          weapon: ps.weapon,
          targetIsPlayer: true,
        },
      };
    }
    return { accepted: true };
  }

  /** Apply damage to a player; returns true if the player died. */
  private applyDamageToPlayer(target: PlayerState, amount: number, attackerId: string): boolean {
    if (!target.alive) return false;
    target.health -= amount;
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.deaths += 1;
      target.respawnTimer = 0;
      const attacker = this.players.get(attackerId);
      if (attacker && attacker.id !== target.id) {
        attacker.kills += 1;
        // Kill credit goes to the killer.
        this.economy.grantLastHit(attacker.id, ECONOMY_CONFIG.killCredit);
      }
      return true;
    }
    return false;
  }

  /** Award a turret destruction: split credit per teammate of the killer. */
  private awardTurretDestruction(turretId: string, killerId: string): void {
    const turret = this.turrets.get(turretId);
    if (!turret) return;
    if (this.turrets.alreadyAwarded(turretId)) return;
    this.turrets.markAwarded(turretId);
    const killer = this.players.get(killerId);
    if (!killer) return;
    // Credit per teammate of the killer's team (per ECONOMY_CONFIG).
    const teammates = Array.from(this.players.values()).filter(
      (p) => p.team === killer.team
    );
    const total = ECONOMY_CONFIG.structureCreditPerTeammate * teammates.length;
    this.economy.distributeTeamReward(killer.team, total, Array.from(this.players.values()));
    this.recordKillFeed("turret", killer.id, turret.id, total);
  }
  private recordKillFeed(kind: string, killerId: string, victimId: string, _credit: number): void {
    const killer = this.players.get(killerId);
    const entry: KillFeedEntry = {
      id: `kf-${this.serverTick}-${this.killFeed.length}`,
      serverTick: this.serverTick,
      killerId,
      killerName: killer?.name ?? "?",
      victimId,
      victimName: kind === "turret" ? "Turret" : kind === "jungle" ? "Jungle" : "?",
      weapon: killer ? (killer.weapon as KillFeedEntry["weapon"]) : null,
      headshot: false,
      label: `${killer?.name ?? "?"} → ${kind === "turret" ? "Turret" : kind}`,
    };
    this.killFeed.unshift(entry);
    if (this.killFeed.length > 32) this.killFeed.length = 32;
  }

  private recordPlayerKill(killerId: string, victimId: string): void {
    const killer = this.players.get(killerId);
    const victim = this.players.get(victimId);
    if (!killer || !victim) return;
    const entry: KillFeedEntry = {
      id: `kf-${this.serverTick}-${this.killFeed.length}`,
      serverTick: this.serverTick,
      killerId,
      killerName: killer.name,
      victimId,
      victimName: victim.name,
      weapon: killer.weapon as KillFeedEntry["weapon"],
      headshot: false,
      label: `${killer.name} → ${victim.name}`,
    };
    this.killFeed.unshift(entry);
    if (this.killFeed.length > 32) this.killFeed.length = 32;
  }

  startReload(id: string): boolean {
    const ps = this.players.get(id);
    if (!ps || !ps.alive || ps.reloading) return false;
    if (ps.magazine >= WEAPONS[ps.weapon as keyof typeof WEAPONS].magazineSize) return false;
    if (ps.reserve <= 0) return false;
    const weapon = WEAPONS[ps.weapon as keyof typeof WEAPONS];
    ps.reloading = true;
    ps.reloadEndsAtTick = this.serverTick + Math.ceil(weapon.reloadSeconds * this.tickRateHz);
    return true;
  }

  forceRespawn(id: string): void {
    const ps = this.players.get(id);
    if (!ps || ps.alive) return;
    const spawn = MAP_DEFAULT.spawnPoints.find((s) => s.team === ps.team)!;
    spawnPlayerAt(ps, spawn.position, Math.PI);
  }

  /* ----- Buy / shop -------------------------------------------- */

  /**
   * Validate and apply a buy request. Returns the result and (on
   * success) the new credit total. Caller is responsible for
   * broadcasting the appropriate event to clients.
   */
  applyBuy(
    playerId: string,
    itemId: string
  ): { ok: true; item: ShopItem; newCredits: number } | { ok: false; reason: string } {
    if (!this.lifecycle.isActive()) return { ok: false, reason: "match_finished" };
    const ps = this.players.get(playerId);
    if (!ps) return { ok: false, reason: "unknown_player" };
    if (!ps.alive) return { ok: false, reason: "dead" };
    const shop = MAP_DEFAULT.shopZones[ps.team];
    const decision = this.economy.validate(playerId, itemId, ps.position, shop.center, ps.team);
    if (!decision.ok) return { ok: false, reason: decision.reason };
    const newCredits = this.economy.confirmPurchase(playerId, itemId);
    if (newCredits === null) return { ok: false, reason: "internal" };
    if (decision.item.kind === "weapon" && decision.item.weaponId) {
      ps.weapon = decision.item.weaponId as PlayerState["weapon"];
      const w = WEAPONS[ps.weapon as keyof typeof WEAPONS];
      ps.magazine = w.magazineSize;
      ps.reserve = w.reserveAmmo;
      ps.reloading = false;
      ps.nextShotAtTick = 0;
    } else if (decision.item.kind === "armor" && decision.item.armorGrant) {
      ps.armor = Math.min(100, ps.armor + decision.item.armorGrant);
    }
    return { ok: true, item: decision.item, newCredits };
  }

  /* ----- Nexus / match end ------------------------------------- */

  /**
   * Direct damage to a team's Nexus. The Nexus is a dedicated state,
   * shielded while any of the team's lane turrets is alive in a
   * different lane. The Nexus takes damage only after the team's
   * turrets across all lanes have been destroyed.
   *
   * The first call that reduces nexus health to zero ends the match
   * and the function returns `{ ended: true, winner }`. Subsequent
   * calls no-op (single-shot guard).
   */
  damageNexus(team: "blue" | "red", amount: number, attackerId: string): { ended: boolean; winner: "blue" | "red" | null } {
    if (!this.lifecycle.isActive()) return { ended: false, winner: null };
    if (this.nexusDestroyedOnce.has(team)) return { ended: false, winner: null };
    // The Nexus is exposed only after at least one lane is fully
    // exposed (i.e. all non-Nexus turrets of the team in that lane
    // are dead). The Nexus turrets themselves are the target; we just
    // need to confirm a path was opened.
    const anyLaneOpen = (["top", "mid", "bot"] as const).some((lane) =>
      this.turrets.turrets.every(
        (t) => !(t.team === team && t.lane === lane && t.alive && t.tier !== "nexus")
      )
    );
    if (!anyLaneOpen) return { ended: false, winner: null };
    this.nexusDestroyedOnce.add(team);
    // Winning team is the OPPOSING team of the destroyed Nexus.
    const winner: "blue" | "red" = team === "blue" ? "red" : "blue";
    this.lifecycle.end(winner, this.serverTick);
    return { ended: true, winner };
  }

  /* ----- Tick --------------------------------------------------- */

  advanceTick(dt?: number): void {
    this.serverTick++;
    const stepDt = dt ?? this.tickDt;
    this.matchTimeSeconds += stepDt;
    for (const ps of this.players.values()) {
      this.simulatePlayer(ps, stepDt);
    }
    for (const t of this.targets) {
      if (!t.alive) {
        t.respawnTimer += stepDt;
        if (t.respawnTimer >= t.respawnSeconds) {
          t.alive = true;
          t.health = t.maxHealth;
          t.respawnTimer = 0;
        }
      }
    }

    if (!this.lifecycle.isActive()) {
      // Match over — freeze MOBA systems, skip further updates.
      return;
    }

    // Refresh turret protection flags at the start of every tick.
    this.turrets.refreshProtection();

    // Passive gold income
    this.economy.tickPassive(stepDt);

    // Minions
    this.minions.advanceTick(stepDt, {
      findTarget: (m, maxRange) => this.minionFindTarget(m, maxRange),
      resolveTarget: (id, team, maxRange) => this.minionResolveTarget(id, team, maxRange),
      damageNonMinion: (t, amount, attackerId) => this.minionDealNonMinion(t, amount, attackerId),
      isMatchActive: () => this.lifecycle.isActive(),
    });

    // Jungle
    this.jungle.advanceTick(stepDt, {
      getEntityPosition: (id) => this.minionOrPlayerPosition(id),
      isEntityAlive: (id) => this.isTargetAlive(id),
      damageEntity: (id, amount, attackerId) => this.damageExternalEntity(id, amount, attackerId),
      awardGold: (killerId, amount) => this.economy.grantLastHit(killerId, amount),
      isMatchActive: () => this.lifecycle.isActive(),
    });

    // Turrets
    this.turrets.advanceTick(stepDt, {
      findEnemyPlayerInRange: (pos, team, range) => this.findEnemyPlayerInRange(pos, team, range),
      findEnemyMinionInRange: (pos, team, range) => this.findEnemyMinionInRange(pos, team, range),
      damageEntity: (id, amount, attackerId) => this.damageExternalEntity(id, amount, attackerId),
      onTurretDestroyed: (turret, killerId) => this.awardTurretDestruction(turret.id, killerId ?? "environment"),
      isMatchActive: () => this.lifecycle.isActive(),
    });
  }

  /* ----- MOBA target-lookup helpers ---------------------------- */

  private minionOrPlayerPosition(id: string): Vec3 | null {
    if (id.startsWith("mn-")) {
      const m = this.minions.minions.find((x) => x.id === id);
      if (m) return { x: m.position.x, y: m.position.y, z: m.position.z };
    }
    const p = this.players.get(id);
    if (p) return { x: p.position.x, y: p.position.y, z: p.position.z };
    return null;
  }

  private isTargetAlive(id: string): boolean {
    if (id.startsWith("mn-")) {
      const m = this.minions.minions.find((x) => x.id === id);
      return !!m && !m.dead;
    }
    const p = this.players.get(id);
    return !!p && p.alive;
  }

  private damageExternalEntity(id: string, amount: number, attackerId: string): void {
    if (id.startsWith("mn-")) {
      const r = this.minions.damageFromPlayer(id, amount, attackerId);
      if (r.killed) {
        // Minion dying to a turret/monster/player — credit if it was a
        // player who last hit.
        if (this.players.has(attackerId)) {
          this.economy.grantLastHit(attackerId, r.credit);
        }
      }
      return;
    }
    if (id.startsWith("tw-")) {
      const r = this.turrets.damageTurret(id, amount, attackerId);
      if (r.killed) this.awardTurretDestruction(id, attackerId);
      return;
    }
    const p = this.players.get(id);
    if (p) {
      const died = this.applyDamageToPlayer(p, amount, attackerId);
      if (died) this.recordPlayerKill(attackerId, p.id);
      return;
    }
    // Jungle monsters
    if (this.jungle.get(id)) {
      const r = this.jungle.damageMonster(id, amount, attackerId);
      if (r.killed) {
        if (this.players.has(attackerId)) {
          this.economy.grantLastHit(attackerId, r.reward);
        }
        this.recordKillFeed("jungle", attackerId, id, r.reward);
      }
    }
  }

  private minionFindTarget(m: MinionState, maxRange: number): TargetHandle | null {
    // Priority: closest enemy minion, then closest enemy turret/nexus, then closest enemy player.
    const mpos = m.position;
    let best: TargetHandle | null = null;
    let bestDist = maxRange;
    for (const other of this.minions.minions) {
      if (other.dead || other.team === m.team) continue;
      const d = Math.hypot(other.position.x - mpos.x, other.position.z - mpos.z);
      if (d <= bestDist) {
        best = { kind: "minion", id: other.id, team: other.team, position: other.position };
        bestDist = d;
      }
    }
    for (const tw of this.turrets.turrets) {
      if (!tw.alive || tw.team === m.team) continue;
      if (tw.protected) continue;
      const d = Math.hypot(tw.position.x - mpos.x, tw.position.z - mpos.z);
      if (d <= bestDist) {
        best = { kind: "turret", id: tw.id, team: tw.team, position: tw.position };
        bestDist = d;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.team === m.team) continue;
      const d = Math.hypot(p.position.x - mpos.x, p.position.z - mpos.z);
      if (d <= bestDist) {
        best = { kind: "player", id: p.id, team: p.team, position: p.position };
        bestDist = d;
      }
    }
    return best;
  }

  private minionResolveTarget(id: string, minionTeam: "blue" | "red", maxRange: number): TargetHandle | null {
    if (id.startsWith("mn-")) {
      const m = this.minions.minions.find((x) => x.id === id);
      if (!m || m.dead || m.team === minionTeam) return null;
      const d = Math.hypot(m.position.x - 0, m.position.z - 0); // distance to self doesn't matter here
      // (m.position is from the minion state; we just need validity.)
      void d;
      return { kind: "minion", id: m.id, team: m.team, position: m.position };
    }
    if (id.startsWith("tw-")) {
      const t = this.turrets.get(id);
      if (!t || !t.alive || t.team === minionTeam) return null;
      return { kind: "turret", id: t.id, team: t.team, position: t.position };
    }
    const p = this.players.get(id);
    if (!p || !p.alive || p.team === minionTeam) return null;
    // Soft leash: if the player runs too far, lose the target.
    const d = Math.hypot(p.position.x - 0, p.position.z - 0);
    if (d > maxRange * 4) return null;
    return { kind: "player", id: p.id, team: p.team, position: p.position };
  }

  private minionDealNonMinion(t: TargetHandle, amount: number, attackerId: string): void {
    if (t.kind === "turret") {
      const r = this.turrets.damageTurret(t.id, amount, attackerId);
      if (r.killed) this.awardTurretDestruction(t.id, attackerId);
      return;
    }
    if (t.kind === "nexus") {
      // Not a separate kind in TargetHandle — handled by turret id prefix.
      return;
    }
    if (t.kind === "player") {
      const p = this.players.get(t.id);
      if (!p) return;
      const died = this.applyDamageToPlayer(p, amount, attackerId);
      if (died) this.recordPlayerKill(attackerId, p.id);
    }
  }

  private findEnemyPlayerInRange(pos: Vec3, team: "blue" | "red", range: number): { id: string; position: Vec3; distance: number } | null {
    let best: { id: string; position: Vec3; distance: number } | null = null;
    for (const p of this.players.values()) {
      if (p.team === team || !p.alive) continue;
      const d = Math.hypot(p.position.x - pos.x, p.position.z - pos.z);
      if (d <= range && (!best || d < best.distance)) {
        best = { id: p.id, position: { x: p.position.x, y: p.position.y, z: p.position.z }, distance: d };
      }
    }
    return best;
  }

  private findEnemyMinionInRange(pos: Vec3, team: "blue" | "red", range: number): { id: string; position: Vec3; distance: number } | null {
    let best: { id: string; position: Vec3; distance: number } | null = null;
    for (const m of this.minions.minions) {
      if (m.dead || m.team === team) continue;
      const d = Math.hypot(m.position.x - pos.x, m.position.z - pos.z);
      if (d <= range && (!best || d < best.distance)) {
        best = { id: m.id, position: { x: m.position.x, y: m.position.y, z: m.position.z }, distance: d };
      }
    }
    return best;
  }

  private simulatePlayer(ps: PlayerState, dt: number): void {
    if (!ps.alive) return;

    if (ps.reloading && this.serverTick >= ps.reloadEndsAtTick) {
      const w = WEAPONS[ps.weapon as keyof typeof WEAPONS];
      ps.magazine = w.magazineSize;
      ps.reserve = Math.max(0, ps.reserve - w.reserveAmmo);
      ps.reloading = false;
      ps.reloadEndsAtTick = 0;
    }

    const sy = Math.sin(ps.yaw);
    const cy = Math.cos(ps.yaw);
    const fwdX = sy, fwdZ = -cy;
    const rgtX = cy, rgtZ = sy;
    const speed = ps.inputSprint ? PHYSICS_CONFIG.sprintSpeed : PHYSICS_CONFIG.walkSpeed;
    const dvx = fwdX * ps.inputForward * speed + rgtX * ps.inputRight * speed;
    const dvz = fwdZ * ps.inputForward * speed + rgtZ * ps.inputRight * speed;
    ps.velocity.x = ps.velocity.x + (dvx - ps.velocity.x) * Math.min(1, 10 * dt);
    ps.velocity.z = ps.velocity.z + (dvz - ps.velocity.z) * Math.min(1, 10 * dt);

    ps.velY += PHYSICS_CONFIG.gravity * dt;
    if (ps.inputJump && ps.grounded) {
      ps.velY = PHYSICS_CONFIG.jumpVelocity;
      ps.grounded = false;
    }

    ps.position.x += ps.velocity.x * dt;
    ps.position.y += ps.velY * dt;
    ps.position.z += ps.velocity.z * dt;

    const pos3 = { x: ps.position.x, y: ps.position.y, z: ps.position.z };
    const vel3 = { x: ps.velocity.x, y: ps.velY, z: ps.velocity.z };
    ps.grounded = resolveCollision(pos3, vel3, this.colliders, PHYSICS_CONFIG.playerRadius);
    ps.position.x = pos3.x;
    ps.position.y = pos3.y;
    ps.position.z = pos3.z;
    ps.velocity.x = vel3.x;
    ps.velY = vel3.y;
    ps.velocity.z = vel3.z;

    if (ps.position.y < PHYSICS_CONFIG.playerHeight) {
      ps.position.y = PHYSICS_CONFIG.playerHeight;
      ps.velY = 0;
      ps.grounded = true;
    }
  }

  /* ----- Snapshots ---------------------------------------------- */

  buildSnapshot(): ServerGameState {
    this.turrets.refreshProtection();
    return {
      type: "game.state",
      serverTick: this.serverTick,
      matchTimeSeconds: this.matchTimeSeconds,
      phase: this.lifecycle.isFinished() ? "ended" : "playing",
      winner: this.lifecycle.winner,
      players: Array.from(this.players.values()).map(playerSnapshot),
      targets: this.targets.map(targetSnapshot),
      minions: this.minions.snapshot(),
      jungleMonsters: this.jungle.snapshot(),
      turrets: this.turrets.snapshot(),
      shop: SHOP_ITEMS.map((it) => ({ id: it.id, displayName: it.displayName, price: it.price, category: it.category })),
      killFeed: this.killFeed,
    };
  }
}

function playerAmmoSnapshot(ps: PlayerState): ServerPlayerAmmo {
  return {
    magazine: ps.magazine,
    reserve: ps.reserve,
    reloading: ps.reloading,
    reloadEndsAtServerTick: ps.reloadEndsAtTick,
    nextShotAllowedAtServerTick: ps.nextShotAtTick,
  };
}

function playerSnapshot(ps: PlayerState): ServerPlayerSnapshot {
  return {
    id: ps.id,
    name: ps.name,
    team: ps.team,
    agent: null,
    weapon: ps.weapon as ServerPlayerSnapshot["weapon"],
    position: { x: ps.position.x, y: ps.position.y, z: ps.position.z },
    yaw: ps.yaw,
    pitch: ps.pitch,
    velocity: { x: ps.velocity.x, y: ps.velocity.y, z: ps.velocity.z },
    health: ps.health,
    maxHealth: ps.maxHealth,
    armor: ps.armor,
    credits: ps.credits,
    kills: ps.kills,
    deaths: ps.deaths,
    assists: ps.assists,
    alive: ps.alive,
    respawnSeconds: ps.alive ? 0 : Math.max(0, respawnSecondsFor(0) - ps.respawnTimer),
    ammo: playerAmmoSnapshot(ps),
  };
}

function targetSnapshot(t: TargetState): ServerTargetSnapshot {
  return {
    id: t.id,
    position: { x: t.position.x, y: t.position.y, z: t.position.z },
    health: t.health,
    maxHealth: t.maxHealth,
    alive: t.alive,
    respawnSeconds: t.alive ? 0 : Math.max(0, t.respawnSeconds - t.respawnTimer),
  };
}
