/**
 * MatchRoom — authoritative gameplay simulation (PHASE 2).
 *
 * Manages the authoritative simulation for a live match: player movement,
 * weapon firing, damage, death, respawn, target dummies, and state snapshots.
 *
 * The actual simulation core lives in `MatchSimulation` (no Colyseus
 * dependency) so the same code can be unit-tested in isolation. The
 * MatchRoom is a thin Colyseus adapter: it receives messages from clients
 * and forwards them to the simulation, then broadcasts the resulting
 * snapshots every tick.
 *
 * Simulation loop runs at 30 Hz. Snapshots are sent at 15 Hz (every
 * other tick) to halve network traffic.
 */
import { Room, Client } from "@colyseus/core";
import type {
  ClientBuyRequest,
  ClientHello,
  ClientInput,
  ClientFireRequest,
  ClientReloadRequest,
  ClientSwitchWeaponRequest,
  ClientRespawnRequest,
  ServerDamageEvent,
  ServerMatchEnded,
  ServerPurchaseConfirmed,
  ServerPurchaseRejected,
  ServerRespawnEvent,
  ServerError,
  Vec3,
} from "@rift/shared";
import { isValidDisplayName, TICK_DT_SEC } from "@rift/shared";
import { MatchSimulation, type PlayerState } from "../sim/MatchSimulation.js";

const SNAPSHOT_INTERVAL_TICKS = 2;

interface MatchOptions {
  names?: Record<string, string>;
}

export class MatchRoom extends Room {
  private sim: MatchSimulation = new MatchSimulation();
  private lastSnapshotTick = 0;
  private matchEndedSent = false;

  override onCreate(options: MatchOptions): void {
    this.onMessage("hello", (client, msg) => this.handleHello(client, msg as ClientHello));
    this.onMessage("input", (client, msg) => this.handleInput(client, msg as ClientInput));
    this.onMessage("fire", (client, msg) => this.handleFire(client, msg as ClientFireRequest));
    this.onMessage("reload", (client, msg) => this.handleReload(client, msg as ClientReloadRequest));
    this.onMessage("buy", (client, msg) => this.handleBuy(client, msg as ClientBuyRequest));
    this.onMessage("weapon.switch", (_client, _msg) => {
      // Phase 3: weapon switching via the shop is preferred; this is a
      // legacy no-op that simply ignores ad-hoc weapon switches.
    });
    this.onMessage("respawn", (client, _msg) => this.handleRespawnRequest(client, _msg as ClientRespawnRequest));

    this.setSimulationInterval((_dtMs) => this.tick(), TICK_DT_SEC * 1000);
  }

  override onJoin(client: Client, options: MatchOptions = {}): void {
    const sessionId: string = String(client.sessionId);
    const name = options.names?.[sessionId] ?? "Player";
    const team = this.sim.players.size % 2 === 0 ? "blue" : "red";
    this.sim.addPlayer(sessionId, name, team);

    client.send("game.state", this.sim.buildSnapshot());
    client.send("welcome", {
      type: "welcome",
      playerId: sessionId,
      serverTick: this.sim.serverTick,
      matchId: this.roomId,
    });
  }

  override onLeave(client: Client): void {
    const sessionId: string = String(client.sessionId);
    this.sim.removePlayer(sessionId);
  }

  /* ------------------------------------------------------------------ *
   * Simulation tick                                                       *
   * ------------------------------------------------------------------ */

  private tick(): void {
    this.sim.advanceTick();

    if (this.sim.lifecycle.isFinished() && !this.matchEndedSent) {
      this.matchEndedSent = true;
      const ev: ServerMatchEnded = {
        type: "match.ended",
        winner: this.sim.lifecycle.winner ?? "red",
        durationSeconds: this.sim.matchTimeSeconds,
      };
      this.broadcast(ev.type, ev);
    }

    if (this.sim.serverTick - this.lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) {
      this.lastSnapshotTick = this.sim.serverTick;
      const snap = this.sim.buildSnapshot();
      this.clients.forEach((client: Client) => {
        client.send(snap.type, snap);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Message handlers                                                     *
   * ------------------------------------------------------------------ */

  private handleHello(client: Client, msg: ClientHello): void {
    const sessionId: string = String(client.sessionId);
    const ps = this.sim.players.get(sessionId);
    if (!ps) return;
    if (isValidDisplayName(msg.name)) ps.name = msg.name;
  }

  private handleInput(client: Client, msg: ClientInput): void {
    const sessionId: string = String(client.sessionId);
    this.sim.applyInput(sessionId, {
      forward: msg.forward,
      right: msg.right,
      sprint: !!msg.buttons.sprint,
      jump: !!msg.buttons.jump,
      yaw: msg.yaw,
      pitch: msg.pitch,
    });
    // ts so the parameter is considered "used"
    void client;
  }

  private handleFire(client: Client, msg: ClientFireRequest): void {
    const sessionId: string = String(client.sessionId);
    const validation = this.sim.validateFire(sessionId);
    if (!validation.ok) {
      this.sendError(client, validation.reason ?? "rejected", "Shot rejected");
      return;
    }
    const ps = this.sim.players.get(sessionId) as PlayerState;
    const origin: Vec3 = msg.origin
      ? { x: msg.origin.x, y: msg.origin.y, z: msg.origin.z }
      : { x: ps.position.x, y: 1.75 + 0.15, z: ps.position.z };
    const result = this.sim.resolveHit(sessionId, msg.yaw, msg.pitch, origin);
    if (result.damageEvent) {
      const ev: ServerDamageEvent = {
        type: "event.damage",
        targetId: result.damageEvent.targetId,
        attackerId: result.damageEvent.attackerId,
        amount: result.damageEvent.amount,
        hitbox: result.damageEvent.hitbox,
        weapon: result.damageEvent.weapon as ServerDamageEvent["weapon"],
        targetIsPlayer: result.damageEvent.targetIsPlayer,
      };
      this.broadcast(ev.type, ev);
    }
  }

  private handleReload(client: Client, _msg: ClientReloadRequest): void {
    const sessionId: string = String(client.sessionId);
    this.sim.startReload(sessionId);
  }

  private handleWeaponSwitch(_client: Client, _msg: ClientSwitchWeaponRequest): void {
    // PHASE 2: weapon switching not yet implemented
  }

  private handleRespawnRequest(client: Client, _msg: ClientRespawnRequest): void {
    const sessionId: string = String(client.sessionId);
    const ps = this.sim.players.get(sessionId);
    if (!ps || ps.alive) return;
    this.sim.forceRespawn(sessionId);
    const ev: ServerRespawnEvent = {
      type: "event.respawn",
      playerId: sessionId,
      serverTick: this.sim.serverTick,
    };
    client.send(ev.type, ev);
  }

  private handleBuy(client: Client, msg: ClientBuyRequest): void {
    const sessionId: string = String(client.sessionId);
    const result = this.sim.applyBuy(sessionId, msg.itemId);
    if (result.ok) {
      const ev: ServerPurchaseConfirmed = {
        type: "purchase.confirmed",
        playerId: sessionId,
        itemId: result.item.id,
        newCredits: result.newCredits,
      };
      client.send(ev.type, ev);
    } else {
      const ev: ServerPurchaseRejected = {
        type: "purchase.rejected",
        playerId: sessionId,
        itemId: msg.itemId,
        reason: result.reason,
      };
      client.send(ev.type, ev);
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers                                                              *
   * ------------------------------------------------------------------ */

  private sendError(client: Client, code: string, message: string): void {
    const ev: ServerError = { type: "error", code, message };
    client.send(ev.type, ev);
  }
}
