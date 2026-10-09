/**
 * Server-authoritative jungle monster simulation.
 *
 * Each camp has a leash center, a leash radius, configurable HP, damage,
 * attack range, attack interval, and respawn timer. Monsters are neutral
 * until first aggro, then attack whoever hit them until that target dies
 * or moves outside the leash radius. Death awards configurable gold to
 * the killer's team (distributed per teammate by the parent simulation).
 */
import {
  JUNGLE_CONFIG,
  MAP_DEFAULT,
  type Vec3,
} from "@rift/shared";

export interface JungleMonster {
  id: string;
  displayName: string;
  position: Vec3;
  /** Leash home (where the monster returns when combat disengages). */
  home: Vec3;
  leashRadius: number;
  health: number;
  maxHealth: number;
  damage: number;
  attackRange: number;
  attackInterval: number;
  respawnSeconds: number;
  alive: boolean;
  respawnTimer: number;
  /** The id of the entity the monster is currently aggro'd on. */
  aggroId: string | null;
  attackCooldown: number;
  /** Reward granted on kill (per killing team). */
  rewardGold: number;
}

export interface JungleSystemCallbacks {
  /** Find an entity position by id (player / minion). */
  getEntityPosition: (id: string) => Vec3 | null;
  /** Whether an entity is still alive. */
  isEntityAlive: (id: string) => boolean;
  /** Apply damage to a non-monster target. */
  damageEntity: (id: string, amount: number, attackerId: string) => void;
  /** Award gold to the killer's team (per teammate distribution). */
  awardGold: (killerId: string, amount: number) => void;
  /** Whether the match is still accepting combat. */
  isMatchActive: () => boolean;
}

export class JungleSystem {
  readonly monsters: JungleMonster[] = [];

  constructor() {
    for (const camp of MAP_DEFAULT.jungleCamps) {
      this.monsters.push(this.buildMonster(camp.id, camp.position, camp.leashRadius));
    }
  }

  private buildMonster(id: string, position: Vec3, leashRadius: number): JungleMonster {
    // Cycle the small-camp reward in the configured range.
    const reward =
      JUNGLE_CONFIG.smallCampTotalRewardMin +
      Math.floor(
        ((JUNGLE_CONFIG.smallCampTotalRewardMax - JUNGLE_CONFIG.smallCampTotalRewardMin) *
          (id.charCodeAt(id.length - 1) % 7)) /
          7
      );
    return {
      id,
      displayName: id
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" "),
      position: { x: position.x, y: 0, z: position.z },
      home: { x: position.x, y: 0, z: position.z },
      leashRadius,
      health: 600,
      maxHealth: 600,
      damage: 14,
      attackRange: 2.5,
      attackInterval: 1.0,
      respawnSeconds: 90,
      alive: true,
      respawnTimer: 0,
      aggroId: null,
      attackCooldown: 0,
      rewardGold: reward,
    };
  }

  reset(): void {
    this.monsters.length = 0;
    for (const camp of MAP_DEFAULT.jungleCamps) {
      this.monsters.push(this.buildMonster(camp.id, camp.position, camp.leashRadius));
    }
  }

  /** Find a monster by id (or null). */
  get(id: string): JungleMonster | null {
    return this.monsters.find((m) => m.id === id) ?? null;
  }

  /** Apply damage to a monster (called by player weapons). */
  damageMonster(
    id: string,
    amount: number,
    killerId: string | null
  ): { killed: boolean; reward: number } {
    const m = this.get(id);
    if (!m || !m.alive) return { killed: false, reward: 0 };
    m.health -= amount;
    if (killerId && !m.aggroId) m.aggroId = killerId;
    if (m.health <= 0) {
      m.health = 0;
      m.alive = false;
      m.respawnTimer = 0;
      m.aggroId = null;
      return { killed: true, reward: m.rewardGold };
    }
    return { killed: false, reward: 0 };
  }

  advanceTick(dt: number, cb: JungleSystemCallbacks): { kills: number } {
    if (!cb.isMatchActive()) return { kills: 0 };
    let kills = 0;
    for (const m of this.monsters) {
      if (!m.alive) {
        m.respawnTimer += dt;
        if (m.respawnTimer >= m.respawnSeconds) {
          m.alive = true;
          m.health = m.maxHealth;
          m.respawnTimer = 0;
          m.aggroId = null;
        }
        continue;
      }
      this.tickMonster(m, dt, cb);
    }
    return { kills };
  }

  private tickMonster(m: JungleMonster, dt: number, cb: JungleSystemCallbacks): void {
    m.attackCooldown = Math.max(0, m.attackCooldown - dt);

    // Validate current aggro.
    if (m.aggroId) {
      const stillAlive = cb.isEntityAlive(m.aggroId);
      const pos = cb.getEntityPosition(m.aggroId);
      if (!stillAlive || !pos) {
        m.aggroId = null;
      } else {
        const dist = Math.hypot(pos.x - m.position.x, pos.z - m.position.z);
        if (dist > m.leashRadius) {
          // Leash rule: disengage and head home.
          m.aggroId = null;
        }
      }
    }

    if (m.aggroId) {
      const targetPos = cb.getEntityPosition(m.aggroId);
      if (targetPos) {
        const dx = targetPos.x - m.position.x;
        const dz = targetPos.z - m.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > m.attackRange) {
          const step = Math.min(2.5 * dt, dist);
          if (dist > 0.0001) {
            m.position.x += (dx / dist) * step;
            m.position.z += (dz / dist) * step;
          }
        } else if (m.attackCooldown <= 0) {
          cb.damageEntity(m.aggroId, m.damage, m.id);
          m.attackCooldown = m.attackInterval;
        }
      }
    } else {
      // Return home.
      const dx = m.home.x - m.position.x;
      const dz = m.home.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        const step = Math.min(2.5 * dt, dist);
        if (dist > 0.0001) {
          m.position.x += (dx / dist) * step;
          m.position.z += (dz / dist) * step;
        }
      }
    }
  }

  snapshot(): Array<{
    id: string;
    position: Vec3;
    health: number;
    maxHealth: number;
    alive: boolean;
    respawnSeconds: number;
    displayName: string;
  }> {
    return this.monsters.map((m) => ({
      id: m.id,
      position: { x: m.position.x, y: m.position.y, z: m.position.z },
      health: m.health,
      maxHealth: m.maxHealth,
      alive: m.alive,
      respawnSeconds: m.alive ? 0 : Math.max(0, m.respawnSeconds - m.respawnTimer),
      displayName: m.displayName,
    }));
  }
}
