/**
 * Server-authoritative turret / Nexus simulation.
 *
 * Each lane has 3 turrets (outer, inner, base) plus one Nexus. Turrets
 * automatically target the closest enemy in range with simple priority:
 *   1) minions (melee > ranged > siege, closer first)
 *   2) players
 * Turrets attack at a fixed interval. They take damage only when not
 * "protected" (a higher-priority turret in the same lane is still alive).
 * Once a turret dies, it stays dead for the rest of the match and emits
 * a `turret.destroyed` event so the simulation can award gold.
 */
import {
  TURRET_CONFIG,
  MAP_DEFAULT,
  type LaneId,
  type TeamId,
  type TurretTier,
  type Vec3,
} from "@rift/shared";

export interface TurretState {
  id: string;
  team: TeamId;
  lane: LaneId;
  tier: TurretTier;
  position: Vec3;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** True while a higher-priority turret in the same lane is still alive. */
  protected: boolean;
  attackCooldown: number;
  /** Last attacker id (used for kill credit). */
  lastAttackerId: string | null;
}

export interface TurretSystemCallbacks {
  /** Find enemy players in a radius (caller decides ordering). */
  findEnemyPlayerInRange: (pos: Vec3, team: TeamId, range: number) => { id: string; position: Vec3; distance: number } | null;
  /** Find enemy minions in a radius. */
  findEnemyMinionInRange: (pos: Vec3, team: TeamId, range: number) => { id: string; position: Vec3; distance: number } | null;
  /** Apply damage to a non-turret target. */
  damageEntity: (id: string, amount: number, attackerId: string) => void;
  /** Notify the simulation of a turret death (one-shot). */
  onTurretDestroyed: (turret: TurretState, killerId: string | null) => void;
  /** Whether the match is still accepting combat. */
  isMatchActive: () => boolean;
}

const TIER_ORDER: Record<TurretTier, number> = {
  outer: 0,
  inner: 1,
  base: 2,
  nexus: 3,
};

export class TurretSystem {
  readonly turrets: TurretState[] = [];
  /** Turret ids that have already been awarded (so re-damaging them is a no-op). */
  private awarded = new Set<string>();

  constructor() {
    this.rebuild();
    this.recomputeProtection();
  }

  reset(): void {
    this.turrets.length = 0;
    this.awarded.clear();
    this.rebuild();
    this.recomputeProtection();
  }

  private rebuild(): void {
    for (const t of MAP_DEFAULT.turrets) {
      const cfg = TURRET_CONFIG[t.tier];
      this.turrets.push({
        id: `tw-${t.team}-${t.lane}-${t.tier}`,
        team: t.team,
        lane: t.lane,
        tier: t.tier,
        position: { x: t.position.x, y: 0, z: t.position.z },
        health: cfg.health,
        maxHealth: cfg.health,
        alive: true,
        protected: false,
        attackCooldown: 0,
        lastAttackerId: null,
      });
    }
  }
  /** Recompute protection flags for all turrets based on the current alive set. */
  private recomputeProtection(): void {
    // For each team and lane, only the highest-priority alive tier is
    // unprotected. Lower tiers (inner, base, nexus) remain protected
    // while a higher tier is still alive.
    const lanes = new Set<LaneId>();
    for (const t of this.turrets) lanes.add(t.lane);
    for (const team of ["blue", "red"] as TeamId[]) {
      for (const lane of lanes) {
        const inLane = this.turrets
          .filter((t) => t.team === team && t.lane === lane)
          .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
        let highestAliveFound = false;
        for (const t of inLane) {
          if (!t.alive) {
            t.protected = false;
            continue;
          }
          if (!highestAliveFound) {
            t.protected = false;
            highestAliveFound = true;
          } else {
            t.protected = true;
          }
        }
      }
    }
  }

  /** Get a turret by id. */
  get(id: string): TurretState | null {
    return this.turrets.find((t) => t.id === id) ?? null;
  }

  /** Whether a turret's destruction has already been credited. */
  alreadyAwarded(id: string): boolean {
    return this.awarded.has(id);
  }

  /** Mark a turret's destruction as credited. */
  markAwarded(id: string): void {
    this.awarded.add(id);
  }

  /**
   * Apply damage from a player (or external) to a turret. Returns whether
   * the shot actually landed (false if protected / dead / wrong team).
   */
  damageTurret(
    id: string,
    amount: number,
    attackerId: string
  ): { landed: boolean; killed: boolean } {
    const t = this.get(id);
    if (!t || !t.alive) return { landed: false, killed: false };
    if (t.protected) return { landed: false, killed: false };
    t.health -= amount;
    t.lastAttackerId = attackerId;
    if (t.health <= 0) {
      t.health = 0;
      t.alive = false;
      this.recomputeProtection();
      return { landed: true, killed: true };
    }
    return { landed: true, killed: false };
  }

  /**
   * Apply damage to a Nexus. Returns whether the Nexus was destroyed.
   * This is a thin wrapper used by the simulation; the actual
   * match-ending logic lives in `MatchSimulation.damageNexus`.
   */
  damageNexus(team: TeamId, _amount: number, _attackerId: string): { landed: boolean; destroyed: boolean } {
    // No-op stub kept for backwards compatibility; MatchSimulation owns
    // the Nexus lifecycle.
    return { landed: false, destroyed: false };
  }

  /** Snapshot: protection flags must be current. */
  refreshProtection(): void {
    this.recomputeProtection();
  }

  advanceTick(dt: number, cb: TurretSystemCallbacks): { kills: number } {
    if (!cb.isMatchActive()) return { kills: 0 };
    let kills = 0;
    for (const t of this.turrets) {
      if (!t.alive) continue;
      const cfg = TURRET_CONFIG[t.tier];
      t.attackCooldown = Math.max(0, t.attackCooldown - dt);
      if (t.attackCooldown > 0) continue;
      // Pick target.
      const target =
        cb.findEnemyMinionInRange(t.position, t.team, cfg.range) ??
        cb.findEnemyPlayerInRange(t.position, t.team, cfg.range);
      if (!target) continue;
      cb.damageEntity(target.id, cfg.damage, t.id);
      t.attackCooldown = 0.85;
    }
    return { kills };
  }

  snapshot(): Array<{
    id: string;
    team: TeamId;
    lane: LaneId;
    tier: TurretTier;
    position: Vec3;
    health: number;
    maxHealth: number;
    alive: boolean;
    protected: boolean;
  }> {
    return this.turrets.map((t) => ({
      id: t.id,
      team: t.team,
      lane: t.lane as LaneId,
      tier: t.tier,
      position: { x: t.position.x, y: t.position.y, z: t.position.z },
      health: t.health,
      maxHealth: t.maxHealth,
      alive: t.alive,
      protected: t.protected,
    }));
  }
}
