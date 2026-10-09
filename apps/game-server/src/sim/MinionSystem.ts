/**
 * Server-authoritative lane-minion simulation.
 *
 * Minions spawn in waves per team per lane, walk the lane waypoints, and
 * acquire nearby enemies (minion > turret > player) in priority order.
 * Damage is dealt at fixed intervals while in range. Last-hits by players
 * award gold exactly once.
 */
import {
  MINION_CONFIG,
  MAP_DEFAULT,
  type LaneId,
  type MinionType,
  type TeamId,
  type Vec3,
} from "@rift/shared";

export interface MinionState {
  id: string;
  team: TeamId;
  lane: LaneId;
  type: MinionType;
  position: Vec3;
  health: number;
  maxHealth: number;
  /** Index into the ordered waypoint list the minion is currently heading toward. */
  waypointIndex: number;
  /** True for blue team, whose path runs in forward order from +X to -X. */
  waypointsForward: boolean;
  /** Live attack cooldown counter (seconds). */
  attackCooldown: number;
  /** Live id of the entity the minion is engaging. */
  targetId: string | null;
  /** Whether this minion has already triggered a kill reward. */
  dead: boolean;
}

export interface MinionStats {
  health: number;
  damage: number;
  range: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Credits awarded to the killer's team on last-hit. */
  lastHitCredit: number;
  /** Detection radius for acquiring a target. */
  detectionRange: number;
}

export function minionStatsFor(type: MinionType): MinionStats {
  switch (type) {
    case "melee":
      return {
        health: MINION_CONFIG.baseHealthMelee,
        damage: MINION_CONFIG.baseDamageMelee,
        range: MINION_CONFIG.attackRangeMelee,
        attackInterval: 1.0,
        lastHitCredit: MINION_CONFIG.lastHitCreditMelee,
        detectionRange: MINION_CONFIG.detectionRange,
      };
    case "ranged":
      return {
        health: MINION_CONFIG.baseHealthRanged,
        damage: MINION_CONFIG.baseDamageRanged,
        range: MINION_CONFIG.attackRangeRanged,
        attackInterval: 1.0,
        lastHitCredit: MINION_CONFIG.lastHitCreditRanged,
        detectionRange: MINION_CONFIG.detectionRange,
      };
    case "siege":
      return {
        health: MINION_CONFIG.baseHealthSiege,
        damage: MINION_CONFIG.baseDamageSiege,
        range: 9.0,
        attackInterval: 0.85,
        lastHitCredit: MINION_CONFIG.lastHitCreditSiege,
        detectionRange: 9.0,
      };
  }
}

const MOVE_SPEED = MINION_CONFIG.moveSpeed;

/** Build the per-lane ordered waypoint list (3 lanes × 7 points). */
export function buildLaneWaypoints(): Record<LaneId, Vec3[]> {
  const lanes: Record<LaneId, Vec3[]> = { top: [], mid: [], bot: [] };
  for (const w of MAP_DEFAULT.laneWaypoints) {
    lanes[w.lane].push(w.position);
  }
  return lanes;
}

export class MinionSystem {
  readonly minions: MinionState[] = [];
  /** Seconds remaining until the next wave spawns. */
  waveTimer = MINION_CONFIG.firstWaveAtSeconds;
  /** Total waves spawned (used to seed siege spawn cadence). */
  waveCount = 0;
  private readonly waypoints: Record<LaneId, Vec3[]>;
  private nextIdCounter = 0;

  constructor() {
    this.waypoints = buildLaneWaypoints();
  }

  reset(): void {
    this.minions.length = 0;
    this.waveTimer = MINION_CONFIG.firstWaveAtSeconds;
    this.waveCount = 0;
    this.nextIdCounter = 0;
  }

  private spawnMinion(team: TeamId, lane: LaneId, type: MinionType): MinionState {
    this.nextIdCounter += 1;
    const id = `mn-${this.nextIdCounter}`;
    const stats = minionStatsFor(type);
    const wps = this.waypoints[lane];
    // Blue starts at index 0 (the +X end) and walks toward N-1.
    // Red starts at index N-1 (the -X end) and walks toward 0.
    const startIndex = team === "blue" ? 0 : wps.length - 1;
    const startPos = wps[startIndex];
    const m: MinionState = {
      id,
      team,
      lane,
      type,
      position: { x: startPos.x, y: 0.6, z: startPos.z },
      health: stats.health,
      maxHealth: stats.health,
      waypointIndex: startIndex,
      waypointsForward: team === "blue",
      attackCooldown: 0,
      targetId: null,
      dead: false,
    };
    this.minions.push(m);
    return m;
  }

  /** Spawn a single wave for both teams across all three lanes. */
  spawnWave(): void {
    this.waveCount += 1;
    const isSiegeWave = this.waveCount % MINION_CONFIG.siegeEveryNWaves === 0;
    for (const team of ["blue", "red"] as TeamId[]) {
      for (const lane of ["top", "mid", "bot"] as LaneId[]) {
        for (let i = 0; i < MINION_CONFIG.perWaveMelee; i++) this.spawnMinion(team, lane, "melee");
        for (let i = 0; i < MINION_CONFIG.perWaveRanged; i++) this.spawnMinion(team, lane, "ranged");
        if (isSiegeWave) this.spawnMinion(team, lane, "siege");
      }
    }
  }

  /** Force-spawn a wave immediately (for tests). */
  forceSpawnWave(): void {
    this.spawnWave();
  }

  /** Count the current minions for a team. */
  countForTeam(team: TeamId): number {
    let n = 0;
    for (const m of this.minions) if (m.team === team) n += 1;
    return n;
  }

  /** Count minions on a specific lane for a specific team. */
  countOnLane(team: TeamId, lane: LaneId): number {
    let n = 0;
    for (const m of this.minions) if (m.team === team && m.lane === lane) n += 1;
    return n;
  }

  advanceTick(
    dt: number,
    cb: MinionSystemCallbacks
  ): { kills: number } {
    let kills = 0;
    if (!cb.isMatchActive()) {
      // Minions freeze when the match is over.
      return { kills };
    }
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.spawnWave();
      this.waveTimer += MINION_CONFIG.waveIntervalSeconds;
    }

    for (const m of this.minions) {
      if (m.dead) continue;
      this.updateMinion(m, dt, cb);
    }
    for (let i = this.minions.length - 1; i >= 0; i--) {
      if (this.minions[i].dead) {
        this.minions.splice(i, 1);
        kills += 1;
      }
    }
    return { kills };
  }

  private updateMinion(m: MinionState, dt: number, cb: MinionSystemCallbacks): void {
    const stats = minionStatsFor(m.type);
    m.attackCooldown = Math.max(0, m.attackCooldown - dt);

    // Acquire / re-acquire a target.
    let target: TargetHandle | null = null;
    if (m.targetId) {
      target = cb.resolveTarget(m.targetId, m.team, stats.range);
    }
    if (!target) {
      const acquired = cb.findTarget(m, stats.detectionRange);
      if (acquired) {
        m.targetId = acquired.id;
        target = acquired;
      }
    }

    if (target) {
      const dx = target.position.x - m.position.x;
      const dz = target.position.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > stats.range) {
        const step = Math.min(MOVE_SPEED * dt, dist);
        if (dist > 0.0001) {
          m.position.x += (dx / dist) * step;
          m.position.z += (dz / dist) * step;
        }
      } else if (m.attackCooldown <= 0) {
        this.applyMinionAttack(m, target, stats.damage, stats.lastHitCredit, cb);
        m.attackCooldown = stats.attackInterval;
      }
      return;
    }

    // No target — keep walking waypoints.
    m.targetId = null;
    this.advanceWaypoint(m, dt);
  }

  private applyMinionAttack(
    m: MinionState,
    target: TargetHandle,
    damage: number,
    lastHitCredit: number,
    cb: MinionSystemCallbacks
  ): void {
    if (target.kind === "minion") {
      // Internal: damage and detect kill
      const enemy = this.minions.find((x) => x.id === target.id);
      if (!enemy || enemy.dead || enemy.team === m.team) return;
      enemy.health -= damage;
      if (enemy.health <= 0) {
        enemy.dead = true;
        enemy.health = 0;
        // Lane-vs-lane minion kills in this slice do not grant last-hit
        // gold to a player; minions simply despawn.
      }
      return;
    }
    // Player / turret / nexus — defer to callback.
    cb.damageNonMinion(target, damage, m.id);
  }

  private advanceWaypoint(m: MinionState, dt: number): void {
    const wps = this.waypoints[m.lane];
    if (m.waypointsForward) {
      const target = wps[m.waypointIndex];
      const dx = target.x - m.position.x;
      const dz = target.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      const step = MOVE_SPEED * dt;
      if (dist <= step) {
        m.position.x = target.x;
        m.position.z = target.z;
        m.waypointIndex = Math.min(wps.length - 1, m.waypointIndex + 1);
      } else if (dist > 0.0001) {
        m.position.x += (dx / dist) * step;
        m.position.z += (dz / dist) * step;
      }
    } else {
      const target = wps[m.waypointIndex];
      const dx = target.x - m.position.x;
      const dz = target.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      const step = MOVE_SPEED * dt;
      if (dist <= step) {
        m.position.x = target.x;
        m.position.z = target.z;
        m.waypointIndex = Math.max(0, m.waypointIndex - 1);
      } else if (dist > 0.0001) {
        m.position.x += (dx / dist) * step;
        m.position.z += (dz / dist) * step;
      }
    }
  }

  /**
   * Apply damage from a player (or external) to a minion. Returns whether
   * this hit killed the minion and the credit that should be awarded.
   */
  damageFromPlayer(
    minionId: string,
    amount: number,
    _killerPlayerId: string
  ): { killed: boolean; credit: number } {
    const m = this.minions.find((x) => x.id === minionId);
    if (!m || m.dead) return { killed: false, credit: 0 };
    m.health -= amount;
    if (m.health <= 0) {
      m.dead = true;
      m.health = 0;
      return { killed: true, credit: minionStatsFor(m.type).lastHitCredit };
    }
    return { killed: false, credit: 0 };
  }
  /** Snapshots for the client. */
  snapshot(): Array<{
    id: string;
    team: TeamId;
    lane: LaneId;
    type: MinionType;
    position: Vec3;
    health: number;
    maxHealth: number;
    targetId: string | null;
  }> {
    return this.minions.map((m) => ({
      id: m.id,
      team: m.team,
      lane: m.lane,
      type: m.type,
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      health: m.health,
      maxHealth: m.maxHealth,
      targetId: m.targetId,
    }));
  }
}

/**
 * Handle the parent simulation passes back to the minion system when an
 * attack or seek query needs authoritative data.
 */
export interface TargetHandle {
  kind: "minion" | "player" | "turret" | "nexus";
  id: string;
  team: TeamId;
  position: Vec3;
}

export interface MinionSystemCallbacks {
  /**
   * Return the best enemy target (minion > turret > player) within
   * `maxRange` of the minion, or null if none.
   */
  findTarget: (m: MinionState, maxRange: number) => TargetHandle | null;
  /**
   * Resolve a tracked target id to its live position. Returns null if
   * the target is no longer valid (dead, swapped team, etc.).
   */
  resolveTarget: (targetId: string, minionTeam: TeamId, maxRange: number) => TargetHandle | null;
  /**
   * Apply damage to a non-minion target (player / turret / nexus).
   */
  damageNonMinion: (target: TargetHandle, amount: number, attackerId: string) => void;
  /** Whether the match is still accepting combat. */
  isMatchActive: () => boolean;
}
