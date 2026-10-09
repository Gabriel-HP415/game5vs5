# PHASE Roadmap

| Phase | Theme                         | Notes                                                                                 |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------- |
| 1     | Foundation                    | Working browser FPS prototype, graybox map, first-person camera, weapon model.        |
| 2     | Core FPS                      | Authoritative server, weapons, damage, health, armor, death, respawn, HUD.            |
| 3     | MOBA map                      | Full graybox three-lane map, jungle camps, turrets, nexus, minion paths.              |
| 4     | Economy                       | Credits, last-hit, kill rewards, shop, armor, weapon drops.                            |
| 5     | Agents                        | Five-agent roster, abilities, cooldowns, ultimate charge.                              |
| 6     | Objectives                    | Dragon, Baron, Inhibitors, Nexus progression, match victory.                           |
| 7     | Online systems                | Matchmaking, agent selection lobby, reconnection, results.                             |
| 8     | Polish                        | Original models, weapons, animations, environment art, audio, performance.             |
| 9     | Deployment                    | Production build, server deployment config, database migrations, logging, healthcheck.|

## Repository layout

apps/
  web/         — Vite + React + TS + Three.js + R3F client
  game-server/ — Node.js + Colyseus authoritative game server
packages/
  shared/      — Shared types, agent/weapon/ability data, network schemas

## Key files

- packages/shared/src/config — central balance config
- packages/shared/src/agents — five-agent roster
- packages/shared/src/weapons — initial 12-weapon roster
- packages/shared/src/abilities — initial ability kit
- packages/shared/src/map — graybox map layout
- packages/shared/src/net — client/server message schemas
- apps/web/src/game — client gameplay (R3F scene, FPS controller)
- apps/game-server/src — authoritative server simulation