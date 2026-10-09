/**
 * Lobby / match-making room.
 *
 * PHASE 2: keeps the original lobby semantics (welcome, queue updates) and
 * additionally creates a MatchRoom as soon as the configured minimum number
 * of players are queued. The lobby broadcasts `match.found` (with a matchId)
 * to each queued player; the client uses its existing Colyseus SDK to join
 * that room by id.
 */
import { Room, Client, matchMaker } from "@colyseus/core";
import type {
  ClientHello,
  ServerWelcome,
  ServerQueueUpdate,
  ServerMatchFound,
} from "@rift/shared";
import { isValidDisplayName } from "@rift/shared";

interface PlayerEntry {
  client: Client;
  id: string;
  name: string;
}

/** Minimum number of players required to start a development match. */
const MIN_PLAYERS_TO_START = 2;

export class LobbyRoom extends Room {
  private players = new Map<string, PlayerEntry>();
  private queue: string[] = [];
  /** SessionIds that have already been forwarded to a match. */
  private inMatch = new Set<string>();

  override onCreate(_options: unknown): void {
    this.onMessage("hello", (client, message) =>
      this.handleHello(client, message as ClientHello)
    );
    this.onMessage("queue.request", (client) => this.handleQueueRequest(client));
    this.onMessage("queue.cancel", (client) => this.handleQueueCancel(client));
  }

  override onJoin(client: Client): void {
    const sessionId: string = String(client.sessionId);
    const welcome: ServerWelcome = {
      type: "welcome",
      playerId: sessionId,
      serverTick: 0,
    };
    client.send(welcome.type, welcome);
  }

  override onLeave(client: Client): void {
    const sessionId: string = String(client.sessionId);
    this.queue = this.queue.filter((id) => id !== sessionId);
    this.players.delete(sessionId);
    this.inMatch.delete(sessionId);
    this.maybeBroadcastQueue();
  }

  private handleHello(client: Client, message: ClientHello): void {
    const rawName = message.name ?? "";
    const name: string = isValidDisplayName(rawName) ? rawName : "Player";
    const sessionId: string = String(client.sessionId);
    const existing = this.players.get(sessionId);
    if (existing) {
      existing.name = name;
    } else {
      this.players.set(sessionId, {
        client,
        id: sessionId,
        name,
      });
    }
  }

  private handleQueueRequest(client: Client): void {
    const sessionId: string = String(client.sessionId);
    if (this.inMatch.has(sessionId)) return;
    if (!this.queue.includes(sessionId)) {
      this.queue.push(sessionId);
    }
    this.maybeBroadcastQueue();
    this.tryStartMatch();
  }

  private handleQueueCancel(client: Client): void {
    const sessionId: string = String(client.sessionId);
    this.queue = this.queue.filter((id) => id !== sessionId);
    this.maybeBroadcastQueue();
  }

  private maybeBroadcastQueue(): void {
    const update: ServerQueueUpdate = {
      type: "queue.update",
      queueSize: this.queue.length,
      etaSeconds: this.queue.length >= MIN_PLAYERS_TO_START ? 3 : null,
    };
    this.broadcast(update.type, update);
  }

  private async tryStartMatch(): Promise<void> {
    while (this.queue.length >= MIN_PLAYERS_TO_START) {
      const batch = this.queue.splice(0, MIN_PLAYERS_TO_START);
      const names: Record<string, string> = {};
      for (const id of batch) {
        const entry = this.players.get(id);
        names[id] = entry?.name ?? "Player";
      }
      let room;
      try {
        room = await matchMaker.createRoom("match", { names });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[lobby] failed to create match room:", err);
        // Put players back at the front of the queue
        this.queue = batch.concat(this.queue);
        this.maybeBroadcastQueue();
        return;
      }
      // Mark players as in-match and notify them of the matchId so the
      // client can use joinById().
      for (const id of batch) {
        this.inMatch.add(id);
        const client = this.clients.find((c) => c.sessionId === id);
        if (!client) continue;
        const msg: ServerMatchFound = {
          type: "match.found",
          matchId: room.roomId,
        };
        client.send(msg.type, msg);
      }
      this.maybeBroadcastQueue();
    }
  }
}
