/**
 * Authoritative match state machine for Phase 3.
 *
 * Transitions:
 *   waiting  -> playing  (first player joins, or explicit start)
 *   playing  -> finished (one team's Nexus is destroyed)
 *   finished (terminal)
 *
 * In `finished`, all combat / economic mutations are rejected by the
 * helpers below so the result cannot be mutated by a stale client.
 */
import type { TeamId } from "@rift/shared";

export type Phase = "waiting" | "playing" | "finished";

export class MatchLifecycle {
  private _phase: Phase = "waiting";
  private _winner: TeamId | null = null;
  private _endedAt: number | null = null;

  get phase(): Phase {
    return this._phase;
  }

  get winner(): TeamId | null {
    return this._winner;
  }

  get endedAt(): number | null {
    return this._endedAt;
  }

  /** Start the match if it is still waiting. Idempotent. */
  start(): boolean {
    if (this._phase !== "waiting") return false;
    this._phase = "playing";
    return true;
  }

  /**
   * End the match. Returns true on the first call, false on any
   * subsequent call (so duplicate Nexus-destruction events are safe).
   */
  end(winner: TeamId, atTick: number): boolean {
    if (this._phase === "finished") return false;
    this._phase = "finished";
    this._winner = winner;
    this._endedAt = atTick;
    return true;
  }

  reset(): void {
    this._phase = "waiting";
    this._winner = null;
    this._endedAt = null;
  }

  isActive(): boolean {
    return this._phase === "playing";
  }

  isFinished(): boolean {
    return this._phase === "finished";
  }
}
