import { Client, Room } from "colyseus.js";
import type {
  ServerMessage,
  ServerGameState,
  ServerWelcome,
  ServerQueueUpdate,
  ServerMatchFound,
  ServerError,
  ServerDamageEvent,
  ServerKillEvent,
  ServerRespawnEvent,
  ServerPlayerSnapshot,
  ServerTargetSnapshot,
  KillFeedEntry,
} from "@rift/shared";
import { useAppStore, type ClientSettings } from "./store";

/* ------------------------------------------------------------------ *
 * Authoritative network layer                                         *
 * ------------------------------------------------------------------ *
 * Single instance shared across the app. Handles:                       *
 *   - Connecting to the Colyseus lobby                                *
 *   - Hello + queue.request / queue.cancel                            *
 *   - Listening for match.found and joining the match room           *
 *   - Forwarding authoritative game.state snapshots to the store     *
 *   - Sending local input / fire / reload messages at 30 Hz          *
 * ------------------------------------------------------------------ */

const SERVER_ENDPOINT =
  (typeof window !== "undefined" && (window as unknown as { __RIFT_ENDPOINT?: string }).__RIFT_ENDPOINT) ||
  (typeof window !== "undefined" && `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:2567`) ||
  "ws://localhost:2567";

const TICK_RATE = 30;
const TICK_DT_MS = 1000 / TICK_RATE;
const INPUT_SEND_RATE_MS = 33; // 30 Hz

export interface NetworkStatus {
  status: "offline" | "connecting" | "online" | "in-match" | "error";
  detail?: string;
}

class Network {
  private client: Client | null = null;
  private lobby: Room | null = null;
  private match: Room | null = null;
  private myPlayerId: string | null = null;
  private lastInputSentAt = 0;
  private inputSendScheduled = false;
  private lastFireSentTick = 0;

  /* ----- Public API ------------------------------------------------ */

  getStatus(): NetworkStatus {
    if (this.match) return { status: "in-match" };
    if (this.lobby) return { status: "online" };
    if (this.client) return { status: "connecting" };
    return { status: "offline" };
  }

  isInMatch(): boolean {
    return this.match !== null;
  }

  getMyPlayerId(): string | null {
    return this.myPlayerId;
  }

  setEndpoint(endpoint: string): void {
    useAppStore.getState().setNetworkEndpoint(endpoint);
  }

  async connect(name: string, settings: ClientSettings): Promise<void> {
    if (this.client) return;
    this.setStatus("connecting");
    try {
      this.client = new Client(SERVER_ENDPOINT);
      this.setEndpoint(SERVER_ENDPOINT);
      this.lobby = await this.client.joinOrCreate("lobby", { name });
      this.setStatus("online");
      this.lobby.onMessage("*", (type: string | number, msg: unknown) => {
        this.handleLobbyMessage(type, msg as ServerMessage);
      });
      this.lobby.onLeave(() => {
        this.lobby = null;
        if (!this.match) this.setStatus("offline");
      });
      this.lobby.onError((code: number, message?: string) => {
        // eslint-disable-next-line no-console
        console.error("[net] lobby error", code, message);
        this.setStatus("error", `${code}: ${message}`);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[net] failed to connect to lobby:", err);
      this.setStatus("error", String(err));
      throw err;
    }
  }

  requestQueue(): void {
    if (!this.lobby) return;
    const name = useAppStore.getState().displayName;
    this.lobby.send("hello", { type: "hello", name });
    this.lobby.send("queue.request", { type: "queue.request" });
  }

  cancelQueue(): void {
    if (!this.lobby) return;
    this.lobby.send("queue.cancel", { type: "queue.cancel" });
  }

  sendInput(input: {
    forward: number;
    right: number;
    jump: boolean;
    sprint: boolean;
    yaw: number;
    pitch: number;
    fire: boolean;
    reload: boolean;
  }, clientTick: number): void {
    if (!this.match) return;
    const now = performance.now();
    if (now - this.lastInputSentAt < INPUT_SEND_RATE_MS) return;
    this.lastInputSentAt = now;
    this.match.send("input", {
      type: "input",
      clientTick,
      forward: input.forward,
      right: input.right,
      buttons: {
        jump: input.jump,
        sprint: input.sprint,
        fire: input.fire,
        aim: false,
        reload: input.reload,
        ability1: false,
        ability2: false,
        ability3: false,
      },
      yaw: input.yaw,
      pitch: input.pitch,
    } satisfies {
      type: "input";
      clientTick: number;
      forward: number;
      right: number;
      buttons: {
        jump: boolean;
        sprint: boolean;
        fire: boolean;
        aim: boolean;
        reload: boolean;
        ability1: boolean;
        ability2: boolean;
        ability3: boolean;
      };
      yaw: number;
      pitch: number;
    });
  }

  sendFire(yaw: number, pitch: number, origin: { x: number; y: number; z: number }, clientTick: number): boolean {
    if (!this.match) return false;
    const now = performance.now();
    // Local cooldown mirror: prevents the client from spamming the server.
    // The server is still the final authority.
    if (now - this.lastFireSentTick < 50) return false;
    this.lastFireSentTick = now;
    this.match.send("fire", {
      type: "fire",
      clientTick,
      yaw,
      pitch,
      origin,
    });
    return true;
  }

  sendReload(clientTick: number): void {
    if (!this.match) return;
    this.match.send("reload", { type: "reload", clientTick });
  }

  sendBuy(itemId: string): void {
    if (!this.match) return;
    this.match.send("buy", { type: "buy", itemId });
  }

  sendRespawn(clientTick: number): void {
    if (!this.match) return;
    this.match.send("respawn", { type: "respawn", clientTick });
  }

  disconnect(): void {
    if (this.match) {
      this.match.leave();
      this.match = null;
    }
    if (this.lobby) {
      this.lobby.leave();
      this.lobby = null;
    }
    this.client = null;
    this.myPlayerId = null;
    this.setStatus("offline");
  }

  /* ----- Internal handlers ---------------------------------------- */

  private setStatus(status: NetworkStatus["status"], detail?: string): void {
    useAppStore.getState().setNetworkStatus(status, detail);
  }

  private async joinMatchById(matchId: string): Promise<void> {
    if (!this.client) return;
    const room = await this.client.joinById(matchId, {});
    this.match = room;
    this.setStatus("in-match");
    this.match.onMessage("*", (type: string | number, msg: unknown) => {
      this.handleMatchMessage(type, msg as ServerMessage);
    });
    this.match.onStateChange((state: unknown) => {
      // We use onMessage for snapshots; ignore schema state changes
    });
    this.match.onLeave(() => {
      this.match = null;
      this.myPlayerId = null;
      useAppStore.getState().clearMatchState();
      this.setStatus(this.lobby ? "online" : "offline");
    });
    this.match.onError((code: number, message?: string) => {
      // eslint-disable-next-line no-console
      console.error("[net] match error", code, message);
    });
  }

  private handleLobbyMessage(type: string | number, msg: ServerMessage): void {
    switch (type) {
      case "welcome": {
        const w = msg as ServerWelcome;
        this.myPlayerId = w.playerId;
        useAppStore.getState().setMyPlayerId(w.playerId);
        break;
      }
      case "queue.update": {
        const u = msg as ServerQueueUpdate;
        useAppStore.getState().setQueueState(u.queueSize, u.etaSeconds);
        break;
      }
      case "match.found": {
        const m = msg as ServerMatchFound;
        // eslint-disable-next-line no-console
        console.log("[net] match found, joining", m.matchId);
        this.joinMatchById(m.matchId);
        break;
      }
      case "error": {
        const e = msg as ServerError;
        // eslint-disable-next-line no-console
        console.warn("[net] server error:", e.code, e.message);
        useAppStore.getState().setNetworkStatus("error", `${e.code}: ${e.message}`);
        break;
      }
      default:
        break;
    }
  }

  private handleMatchMessage(type: string | number, msg: ServerMessage): void {
    switch (type) {
      case "game.state": {
        const s = msg as ServerGameState;
        this.applySnapshot(s);
        break;
      }
      case "event.damage": {
        const d = msg as ServerDamageEvent;
        if (d.targetIsPlayer) {
          // Player damage is reflected in the snapshot, but we also fire a
          // hit flash on the local UI for instant feedback.
          if (d.targetId === this.myPlayerId) {
            useAppStore.getState().setHitFlash(0.18);
          }
        }
        break;
      }
      case "event.kill": {
        const k = msg as ServerKillEvent;
        const killerName = k.killerId ? this.findNameById(k.killerId) ?? "?" : "?";
        const victimName = this.findNameById(k.victimId) ?? "?";
        this.appendKillFeedEntry({
          id: `kill-${k.victimId}-${Date.now()}`,
          serverTick: 0,
          killerId: k.killerId,
          killerName,
          victimId: k.victimId,
          victimName,
          weapon: k.weapon,
          headshot: k.headshot,
          label: `${killerName} → ${victimName}`,
        });
        break;
      }
      case "event.respawn": {
        const r = msg as ServerRespawnEvent;
        if (r.playerId === this.myPlayerId) {
          useAppStore.getState().setPauseOpen(false);
        }
        break;
      }
      case "match.ended": {
        // Trigger a one-time UI state update so the result overlay shows
        // immediately rather than waiting for the next snapshot tick.
        useAppStore.setState({ matchPhase: "ended" });
        break;
      }
      case "purchase.confirmed":
      case "purchase.rejected":
        // The store is updated by the next snapshot; this is just a log.
        break;
      case "error": {
        const e = msg as ServerError;
        // eslint-disable-next-line no-console
        console.warn("[net] match error:", e.code, e.message);
        break;
      }
      default:
        break;
    }
  }

  private findNameById(id: string): string | null {
    const ps = useAppStore.getState().players[id];
    return ps?.name ?? null;
  }

  private applySnapshot(s: ServerGameState): void {
    const players: Record<string, ServerPlayerSnapshot> = {};
    for (const p of s.players) players[p.id] = p;
    const targets: Record<string, ServerTargetSnapshot> = {};
    for (const t of s.targets) targets[t.id] = t;
    const minions: Record<string, import("@rift/shared").ServerMinionSnapshot> = {};
    for (const m of s.minions ?? []) minions[m.id] = m;
    const jungleMonsters: Record<string, import("@rift/shared").ServerJungleMonsterSnapshot> = {};
    for (const j of s.jungleMonsters ?? []) jungleMonsters[j.id] = j;
    const turrets: Record<string, import("@rift/shared").ServerTurretSnapshot> = {};
    for (const t of s.turrets ?? []) turrets[t.id] = t;
    const shop = s.shop ?? [];
    useAppStore.getState().applyServerSnapshot({
      serverTick: s.serverTick,
      matchTimeSeconds: s.matchTimeSeconds,
      phase: s.phase,
      winner: s.winner ?? null,
      players,
      targets,
      minions,
      jungleMonsters,
      turrets,
      shop,
      killFeed: [...s.killFeed],
    });

    // If our local player just respawned, clear the pause overlay
    const local = s.players.find((p) => p.id === this.myPlayerId);
    if (local && local.alive) {
      useAppStore.getState().setPauseOpen(false);
    }
  }

  private appendKillFeedEntry(entry: KillFeedEntry): void {
    useAppStore.getState().appendKillFeed(entry);
  }
}

export const network = new Network();

/* ------------------------------------------------------------------ *
 * Hook for components                                                 *
 * ------------------------------------------------------------------ */

import { useEffect, useState } from "react";

export function useNetworkStatus(): NetworkStatus {
  const status = useAppStore((s) => s.network.status);
  const detail = useAppStore((s) => s.network.detail);
  return { status, detail };
}

export function useKillFeed(): ReadonlyArray<KillFeedEntry> {
  return useAppStore((s) => s.killFeed);
}

export function usePlayer(id: string | null): ServerPlayerSnapshot | null {
  return useAppStore((s) => (id ? s.players[id] ?? null : null));
}

export function useTargets(): ReadonlyArray<ServerTargetSnapshot> {
  return useAppStore((s) => Object.values(s.targets));
}

export function useTickRate(): number {
  return TICK_RATE;
}

export { TICK_RATE, TICK_DT_MS };
