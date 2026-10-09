/**
 * Rift Frontline authoritative game server.
 *
 * PHASE 2 boots the server and exposes a matchmaking lobby room that
 * groups players into MatchRoom instances for authoritative gameplay.
 */
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "node:http";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { MatchRoom } from "./rooms/MatchRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true, server: "rift-frontline", version: "0.1.0" });
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("RIFT FRONTLINE — game server\n");
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("lobby", LobbyRoom);
gameServer.define("match", MatchRoom);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[rift-server] listening on http://0.0.0.0:${PORT}`);
});

export { gameServer, httpServer };