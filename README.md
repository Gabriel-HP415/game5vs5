# RIFT FRONTLINE

A browser-based, 3D, 5v5 FPS-MOBA prototype inspired by VALORANT-style tactical gunplay and League of Legends-style map strategy. This repository contains a real, modular foundation: a Vite + React + React Three Fiber client, an authoritative Colyseus multiplayer server, and a shared TypeScript package for game data and schemas.

## Repository layout

apps/
  web/         — Vite + React + TS + Three.js + React Three Fiber client
  game-server/ — Node.js + Colyseus authoritative game server
packages/
  shared/      — Shared types, agent/weapon/ability data, schemas, validation
assets/        — Placeholder 3D models, textures, audio (procedural for now)
docs/          — Design notes and development log
tests/         — End-to-end and manual test scripts

## Quick start (local development)

Prerequisites:
- Node.js 20+ (Node.js 24 LTS recommended)
- npm 10+

Install all workspaces from the repository root:

```bash
npm install
```

Run the web client and game server together (two processes via `concurrently`):

```bash
npm run dev
```

Or run them individually:

```bash
npm run dev:web      # http://localhost:5173
npm run dev:server   # ws://localhost:2567
```

Type-check the entire monorepo:

```bash
npm run typecheck
```

Build for production:

```bash
npm run build
```

## Controls (in-game)

- WASD: move
- Mouse: look
- Space: jump
- Shift: sprint
- Left click: fire
- R: reload
- 1/2: weapon switch (placeholder)
- Esc: release pointer lock

Click anywhere on the 3D view to capture the mouse. Press Esc to release.

## Current phase

PHASE 1 — Foundation: graybox three-lane map, FPS movement, FPS camera, weapon model, crosshair, two team spawns, target dummies, single-player playable prototype.

Subsequent phases will add:
- PHASE 2: authoritative server simulation, weapons, health, armor, death, respawn
- PHASE 3: full graybox MOBA map, turrets, minion paths, jungle
- PHASE 4: economy, last-hit rewards, shop
- PHASE 5: five-agent roster with abilities and cooldowns
- PHASE 6: objectives (Dragon, Baron, Inhibitor, Nexus)
- PHASE 7: matchmaking, character selection, results
- PHASE 8: art, animations, audio polish
- PHASE 9: deployment

See `docs/PHASES.md` for the full roadmap.