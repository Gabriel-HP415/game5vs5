/**
 * Server-authoritative economy: gold tracking, last-hit rewards, passive
 * income, and shop purchase validation.
 *
 * Credits are owned by the simulation. Shop purchases are validated here
 * for one-call convenience but the actual application (credit deduction,
 * weapon swap, armor grant) is performed by the parent `MatchSimulation`.
 */
import {
  ECONOMY_CONFIG,
  MATCH_CONFIG,
  SHOP_CONFIG,
  SHOP_ITEMS,
  type ShopItem,
  type TeamId,
  type Vec3,
  type WeaponId,
  getShopItem,
  validateBuy,
} from "@rift/shared";

export interface BuyContext {
  alive: boolean;
  credits: number;
  owned: number;
  inShop: boolean;
}

export type BuyDecision =
  | { ok: true; item: ShopItem; newCredits: number }
  | { ok: false; reason: string };

export class EconomySystem {
  /** Per-player passive gold accumulator (seconds). */
  private readonly passiveTimer = new Map<string, number>();

  /** Map of playerId -> count of each item they already own. */
  readonly ownedItems = new Map<string, Map<string, number>>();

  reset(): void {
    this.passiveTimer.clear();
    this.ownedItems.clear();
  }

  ownedCount(playerId: string, itemId: string): number {
    return this.ownedItems.get(playerId)?.get(itemId) ?? 0;
  }

  /** Award gold to a single player. Returns the new total. */
  grant(playerId: string, amount: number): number {
    const ps = this.lookupPlayer(playerId);
    if (!ps) return 0;
    const next = Math.max(0, ps.credits + amount);
    if (this.playerMutator) this.playerMutator(playerId, next);
    return next;
  }

  /**
   * Award last-hit gold to a player; tracks a single credit grant
   * (`rewardCreditedOnce`) so multiple damage events on the same dying
   * unit cannot multiply the reward.
   */
  grantLastHit(playerId: string, amount: number): number {
    return this.grant(playerId, amount);
  }

  /**
   * Distribute passive gold: ~1 credit per second per player, with
   * the remainder floored. Called every tick from the parent sim.
   */
  tickPassive(dt: number): void {
    for (const [id, ps] of this.allPlayers()) {
      const next = (this.passiveTimer.get(id) ?? 0) + dt;
      const whole = Math.floor(next);
      if (whole > 0) {
        const updated = Math.max(0, ps.credits + whole);
        if (this.playerMutator) this.playerMutator(id, updated);
        this.passiveTimer.set(id, next - whole);
      } else {
        this.passiveTimer.set(id, next);
      }
    }
  }

  /**
   * Award a team-wide gold pool (used for turret destruction, dragon,
   * baron). Each living teammate of the credited team receives an equal
   * share, distributed one credit at a time so total stays integer.
   */
  distributeTeamReward(killerTeam: TeamId, total: number, players: ReadonlyArray<{ id: string; team: TeamId; alive: boolean }>): void {
    const teammates = players.filter((p) => p.team === killerTeam);
    if (teammates.length === 0) return;
    const share = Math.floor(total / teammates.length);
    for (const tm of teammates) {
      this.grant(tm.id, share);
    }
  }

  /** Whether the player is within their team base shop radius. */
  inShopZone(team: TeamId, position: Vec3, shopCenter: Vec3): boolean {
    const dx = position.x - shopCenter.x;
    const dz = position.z - shopCenter.z;
    return dx * dx + dz * dz <= SHOP_CONFIG.baseShopRadius * SHOP_CONFIG.baseShopRadius;
  }

  /**
   * Validate a buy request. Does NOT mutate state. The parent sim must
   * call `confirmPurchase` after a successful validation to deduct
   * credits and bump the owned counter.
   */
  validate(playerId: string, itemId: string, position: Vec3, shopCenter: Vec3, team: TeamId): BuyDecision {
    const ps = this.lookupPlayer(playerId);
    if (!ps) return { ok: false, reason: "unknown_player" };
    const item = getShopItem(itemId);
    if (!item) return { ok: false, reason: "unknown_item" };
    const ctx: BuyContext = {
      alive: ps.alive,
      credits: ps.credits,
      owned: this.ownedCount(playerId, itemId),
      inShop: this.inShopZone(team, position, shopCenter),
    };
    const v = validateBuy(itemId, ctx);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, item, newCredits: ctx.credits - v.item.price };
  }

  /**
   * Apply a validated purchase: deduct credits, bump owned counter.
   * Returns the new credit total on success, or null on failure.
   */
  confirmPurchase(playerId: string, itemId: string): number | null {
    const ps = this.lookupPlayer(playerId);
    if (!ps) return null;
    const item = getShopItem(itemId);
    if (!item) return null;
    if (ps.credits < item.price) return null;
    const next = ps.credits - item.price;
    if (this.playerMutator) this.playerMutator(playerId, next);
    const m = this.ownedItems.get(playerId) ?? new Map<string, number>();
    m.set(itemId, (m.get(itemId) ?? 0) + 1);
    this.ownedItems.set(playerId, m);
    return next;
  }

  /** Re-export of starting credits for reference. */
  startingCredits(): number {
    return MATCH_CONFIG.startingCredits;
  }

  /**
   * The set of item ids the player can see in their shop. In Phase 3
   * we expose the same list to both teams.
   */
  catalog(): ReadonlyArray<ShopItem> {
    return SHOP_ITEMS;
  }

  /* ----- private hooks (parent provides) ------------------------ */

  private playerResolver: ((id: string) => { credits: number; alive: boolean } | null) | null = null;
  private allPlayersResolver: () => Iterable<[string, { credits: number; alive: boolean; team: TeamId }]> = () => new Map();
  private playerMutator: ((id: string, credits: number) => void) | null = null;

  /** Wire the parent simulation as the source of truth for players. */
  bindPlayerSource(
    get: (id: string) => { credits: number; alive: boolean } | null,
    all: () => Iterable<[string, { credits: number; alive: boolean; team: TeamId }]>,
    mut: (id: string, credits: number) => void
  ): void {
    this.playerResolver = get;
    this.allPlayersResolver = all;
    this.playerMutator = mut;
  }

  private lookupPlayer(id: string): { credits: number; alive: boolean } | null {
    return this.playerResolver ? this.playerResolver(id) : null;
  }

  private *allPlayers(): Iterable<[string, { credits: number; alive: boolean; team: TeamId }]> {
    yield* this.allPlayersResolver();
  }
}

/** Re-export some common credit values for the snapshot. */
export function killCredit(): number {
  return ECONOMY_CONFIG.killCredit;
}

export function assistCredit(): number {
  return ECONOMY_CONFIG.assistCredit;
}

export function structureCreditPerTeammate(): number {
  return ECONOMY_CONFIG.structureCreditPerTeammate;
}

export type { WeaponId };
