# Development Log

A chronological summary of milestones achieved, files added, tests run, and
known limitations. Each phase must be stable before the next phase starts.

## PHASE 1 — Foundation (DONE)

**Status:** working browser-rendered first-person prototype with graybox map,
FPS controls, weapon model, and target dummies. Both the web client and the
authoritative server boot cleanly.

### Files added

Top-level:
- `package.json` (workspace root)
- `tsconfig.base.json`
- `.gitignore`
- `README.md`

`packages/shared` (TypeScript source — no compile required at runtime):
- `package.json`, `tsconfig.json`
- `src/index.ts`
- `src/types/index.ts` — `TeamId`, `AgentId`, `WeaponId`, `AbilityId`, `HitboxPart`,
  `FireMode`, `DamageCategory`, `MatchPhase`, `TICK_RATE_HZ`
- `src/config/index.ts` — `MATCH_CONFIG`, `RESPAWN_CONFIG`, `MINION_CONFIG`,
  `JUNGLE_CONFIG`, `TURRET_CONFIG`, `ECONOMY_CONFIG`, `PHYSICS_CONFIG`,
  `SHOP_CONFIG`
- `src/agents/index.ts` — five-agent roster (Jett, Sage, Sova, Brimstone, Killjoy)
- `src/weapons/index.ts` — 12-weapon roster with full balance data
- `src/abilities/index.ts` — initial ability kit (basic / signature / ultimate
  per agent)
- `src/map/index.ts` — `MAP_DEFAULT` with spawns, lane waypoints, turrets,
  jungle camps, objectives, shop zones
- `src/economy/index.ts` — reward helpers
- `src/net/index.ts` — client/server message schemas + validation helpers

`apps/web` (Vite + React + TS + Three.js + R3F + Zustand):
- `package.json`, `tsconfig.json`, `vite.config.ts`
- `index.html`, `public/favicon.svg`
- `src/main.tsx`, `src/styles/global.css`
- `src/store.ts` — Zustand store with client settings, local player state,
  match stats, helpers
- `src/ui/App.tsx`, `src/ui/HomeScreen.tsx`, `src/ui/GameHud.tsx`
- `src/game/GameCanvas.tsx`, `src/game/Map.tsx`, `src/game/WeaponModel.tsx`,
  `src/game/TargetDummy.tsx`, `src/game/Tracers.tsx`,
  `src/game/FiringController.tsx`, `src/game/useFpsController.ts`

`apps/game-server` (Node.js + Colyseus):
- `package.json`, `tsconfig.json`
- `src/index.ts`
- `src/rooms/LobbyRoom.ts`

Docs & assets:
- `assets/MANIFEST.md`
- `docs/PHASES.md`, `docs/LOG.md`

### What works

- Home screen with Vietnamese UI, brand logo, settings, display-name input,
  network status pill, and primary "Bắt đầu chơi" action.
- 3D scene boots with Three.js / React Three Fiber.
- First-person camera with pointer-lock mouse look and adjustable sensitivity.
- WASD movement, sprint (Shift), jump (Space), ground detection, axis-aligned
  wall collision.
- Procedural weapon model attached to the camera with sway and recoil.
- Crosshair, HP overlay, ammo display, credits, match timer, kill/shots/accuracy
  stats panel, minimap (DOM canvas overlay), pause overlay, in-base shop prompt.
- Graybox three-lane map: lanes, river, jungle patches, base enclosures,
  nexus placeholders (blue / red), outer boundary walls.
- 4 target dummies (mid-left, mid-right, top-lane, bot-lane) with HP, respawn,
  hit-flash and shot/hit counters.
- Local hitscan firing system with spread, falloff, magazine, reload, tracers,
  muzzle flash.
- Build pipeline: `npm install` at the root installs every workspace,
  `npm run dev` runs web + server concurrently, `npm run typecheck` validates
  TypeScript across all workspaces, `npm run build` produces production
  bundles.

### Test results

- `npm run typecheck` — PASS (all three workspaces).
- `npm run build` — PASS (75 modules transformed, ~1 MB JS bundle).
- `npm run dev:server` — boots on port 2567; `/health` returns
  `{"ok":true,"server":"rift-frontline","version":"0.1.0"}`.
- `npm run dev:web` — Vite serves on port 5173.
- Headless Chromium load of the built bundle — home screen renders, "Bắt
  đầu chơi" button transitions to in-game canvas, 3D scene mounts, no
  console errors, HUD overlay visible (crosshair, HP, ammo, credits, minimap,
  timer, hint banner).

### Known limitations

- PHASE 1 is single-player and offline. Multiplayer simulation will arrive in
  PHASE 2 / 7.
- Audio system is not yet implemented; volumes are stored but no audio plays.
- No minimap live-update for allied/enemy positions beyond the local player.
- Tracers, dummies, and weapon model are procedural placeholders. Production
  art is scheduled for PHASE 8.
- Server only exposes the lobby room stub. The MatchRoom (5v5 simulation) is
  scheduled for PHASE 7.

## PHASE 2 — Core FPS and Authoritative Multiplayer (DONE)

**Status:** Authoritative Colyseus server is online. The web client
joins a `LobbyRoom`, transitions to a `MatchRoom` on `match.found`,
streams input at ~30 Hz, and renders authoritative snapshots at ~15 Hz.
Shooting, damage, death, respawn, kill feed, scoreboard, and HUD
indicators are all driven by server state.

### Files added / changed

`packages/shared/src/net/index.ts`
- New `ServerPlayerAmmo`, `ServerTargetSnapshot`, `KillFeedEntry`,
  `ServerGameState` types
- `ClientFireRequest`, `ClientReloadRequest`, `ClientRespawnRequest`
  message types
- Validation helpers `isValidAim`, `isValidMovementAxis`,
  `isValidDisplayName`, `clampNumber`

`apps/game-server/src/sim/MatchSimulation.ts` (new)
- Authoritative simulation core decoupled from Colyseus transport.
- AABB raycast (`rayHitsAABB`), player physics integration with
  collision, fire validation (`validateFire`), hit resolution
  (`resolveHit`), reload timers (`startReload`), respawn logic
  (`forceRespawn`), tick progression (`advanceTick`), and snapshot
  generation (`buildSnapshot`).

`apps/game-server/src/rooms/MatchRoom.ts` (new)
- Colyseus `Room` adapter managing clients, message routing
  (`input`, `fire`, `reload`, `respawn`), 30 Hz simulation timer,
  15 Hz snapshot broadcasts (`SNAPSHOT_INTERVAL_TICKS = 2`).

`apps/game-server/src/rooms/LobbyRoom.ts`
- Sends `match.found` to two queued clients and creates a fresh
  `MatchRoom` per match.

`apps/game-server/tsconfig.test.json` (new)
- Test-only tsconfig with `rootDir: ../..` so the tests can import
  the emitted `MatchSimulation.js`.

`apps/web/src/network.ts`
- Client networking singleton managing Colyseus `lobby` and `match`
  rooms, input streaming (`sendInput`), firing (`sendFire`), reload
  events, snapshot ingestion into the Zustand store, and kill-feed
  / damage events.

`apps/web/src/colyseus.d.ts`
- TypeScript shim for `colyseus.js` 0.15.x to resolve the missing
  export typings under `moduleResolution: Bundler`.

`apps/web/src/store.ts`
- Zustand store extended with remote player state, target snapshot,
  kill feed, match statistics, network connection status, and HUD
  presentation flags.

`apps/web/src/game/useFpsController.ts`
- 30 Hz `sendInput` to server, server-position reconciliation,
  retained Phase 1 mouse-look fix (yaw += movementX, pitch -= movementY).

`apps/web/src/game/GameCanvas.tsx`
- `RemotePlayers` marker rendering using authoritative snapshots.
- `TargetDummy` syncs to `targets[id]` server state.
- `Tracers` play from client-side raycasts (predicted visuals).
- `CameraAttachedWeapon` reacts to `player.weapon` from server state.

`apps/web/src/ui/GameHud.tsx` & `apps/web/src/styles/global.css`
- HP / armor bar
- Weapon name, magazine and reserve ammo with reload progress bar
- Ten-player scoreboard panel
- Kill feed rows (last 6 entries)
- Death / respawn countdown overlay
- Connection status indicator
- Neutral MOBA objective placeholder

`packages/shared/tests/phase2.test.mjs`
- Pure unit tests for validation helpers, weapon stats, respawn tier
  lookup, and match config invariants.

`apps/game-server/tests/match.test.mjs`
- 15 integration tests against the simulation: valid fire, fire-rate
  cooldown, empty magazine, reload-in-progress, dead-player reject,
  target damage once-per-shot, target death + respawn, forced
  respawn, reload completion, team spawn assignment, two-player
  convergence, invalid aim ignore, move clamp, server-side damage
  computation, and snapshot field coverage.

### What works

- Two or more clients can join the same development match (lobby
  pairs them and creates a `MatchRoom`).
- A shot from one client produces the same authoritative damage on
  the snapshot for all observers.
- Target health is owned by the server; client cannot manipulate it.
- Death, kill feed, kill/death/assist stats, and respawn countdown
  are synchronized.
- HUD health / armor / ammo / reload indicator reflect the latest
  server snapshot.
- The existing first-person controls, weapon sway, crosshair, and
  graybox map from Phase 1 still work.

### Test results

- `npm test` — 22 tests, 22 pass, 0 fail (7 shared + 15 server).
- `npm run typecheck` — PASS (all three workspaces).
- `npm run build` — PASS (78 modules transformed, ~1.08 MB JS bundle).

### Known limitations

- Respawn tier is currently derived from match time 0 (fast respawn)
  until the match-time clock is integrated with the actual server
  timer. The configurable tier table is in place and verified.
- Damage is applied as a flat body shot; headshot/legshot multipliers
  are reserved for Phase 9 (combat polish).
- Tracer visuals are client-predicted; the server only confirms hits.
  Visual reconciliation can be tightened in Phase 9.
- No reconnect / session resume yet; a dropped client loses its slot.
  This is scheduled for Phase 7 (match-flow hardening).
- Phase 3 (minions, jungle, turrets) and Phase 4 (economy) are
  intentionally NOT started.

## PHASE 3 — MOBA Core Gameplay (DONE)

**Status:** Server-authoritative MOBA loop is live. Three lanes
spawn server-controlled minions on a configurable cadence; jungle
camps have aggro / leash / respawn; turrets and Nexus-tier
structures follow a lane progression rule; the economy tracks
credits per player and a base shop validates purchases; the
match ends once a team's lane defenses are fully destroyed.

### Files added / changed

`packages/shared/src/types/index.ts`
- New `LaneId`, `MinionType`, `TurretTier`, `ShopItemKind` types.

`packages/shared/src/net/index.ts`
- New `ServerMinionSnapshot`, `ServerJungleMonsterSnapshot`,
  `ServerTurretSnapshot`, `ServerShopItem` snapshot types.
- New `ServerMatchEnded`, `ServerPurchaseConfirmed`,
  `ServerPurchaseRejected` events.
- `ServerGameState` now carries `minions`, `jungleMonsters`,
  `turrets`, `shop`, `winner`, and `phase`.

`packages/shared/src/shop/index.ts` (new)
- `SHOP_ITEMS` data (weapons + light/heavy armor), `getShopItem`
  lookup, `validateBuy` server-side purchase validator.

`packages/shared/src/map/index.ts` (no change)
- Already provided `laneWaypoints`, `turrets`, `jungleCamps`,
  `shopZones`, `spawnPoints` for both teams.

`apps/game-server/src/sim/MinionSystem.ts` (new)
- Lane-minion state machine: spawn waves, walk waypoints, acquire
  enemy minion > turret > player, melee/ranged attack, despawn on
  death, single-shot kill credit through the parent simulation.

`apps/game-server/src/sim/JungleSystem.ts` (new)
- Neutral camp state machine: aggro, melee range chase, leash
  disengage, timed respawn, configurable gold reward.

`apps/game-server/src/sim/TurretSystem.ts` (new)
- Defensive-structure state machine: per-lane tier ordering, target
  priority (minion > player), protection flag recomputed each tick,
  destruction marked exactly once for credit purposes.

`apps/game-server/src/sim/EconomySystem.ts` (new)
- Per-player credit ledger, passive income (1 cr/s floor), team
  reward distribution, shop purchase validation and credit
  deduction. Hooked into the parent simulation via bound getters
  and mutators so the authoritative player state remains the
  source of truth.

`apps/game-server/src/sim/MatchLifecycle.ts` (new)
- `waiting | playing | finished` state machine. `end()` is
  single-shot so duplicate Nexus-destruction events cannot
  re-transition the match.

`apps/game-server/src/sim/MatchSimulation.ts`
- New systems composed into the existing tick: `minions`,
  `jungle`, `turrets`, `economy`, `lifecycle`. `resolveHit` now
  also targets lane minions, jungle monsters, turrets, and
  enemy players (closest valid hit wins). Nexus destruction
  ends the match exactly once. `applyBuy` validates and
  applies shop purchases. `addPlayer` auto-starts the match.

`apps/game-server/src/rooms/MatchRoom.ts`
- New `buy` message handler. Broadcasts `match.ended` once when
  the lifecycle flips to `finished`.

`apps/web/src/store.ts`
- New `minions`, `jungleMonsters`, `turrets`, `shopItems`,
  `matchPhase`, `matchWinner` slices on the Zustand store.
- `applyServerSnapshot` now ingests all MOBA state.

`apps/web/src/network.ts`
- `applySnapshot` maps server MOBA fields. New `sendBuy`
  method. Listens for `match.ended` and toggles the result
  overlay immediately.

`apps/web/src/game/Minions.tsx`, `JungleMonsters.tsx`, `Turrets.tsx`
(new) — graybox rendering for the new entity classes.

`apps/web/src/game/GameCanvas.tsx` mounts the new renderers.

`apps/web/src/ui/ShopOverlay.tsx`, `MatchResultOverlay.tsx` (new)
- Shop overlay that opens automatically when the local player is
  inside their team's base shop radius. Match result overlay
  shows victory / defeat when the match ends.

`apps/web/src/ui/GameHud.tsx` and `styles/global.css`
- Updated `ObjectiveStatus` to count live allied / enemy
  non-Nexus turrets. Added CSS for the shop card and the
  result card.

`apps/game-server/tests/moba.test.mjs` (new)
- 15 deterministic tests covering: minion wave spawning,
  waypoint traversal, last-hit credit uniqueness, jungle
  respawn, jungle leash disengage, turret protection,
  turret destruction credit + idempotency, Nexus protected
  vs. exposed, Nexus destruction ending the match exactly
  once, finished match freezing combat / shop / minion
  movement, valid and invalid purchases, insufficient-gold
  rejection, outside-shop rejection, duplicate weapon
  rejection, shop catalog sanity, and snapshot consistency.

`packages/shared/package.json`
- Added `dist/...` `import` conditions so the test runner can
  resolve `@rift/shared` to the compiled `dist/` output without
  a TypeScript loader.

### What works

- Both teams spawn melee + ranged minion waves on all three
  lanes; a siege wave spawns every 3rd wave. Minions move along
  their team's direction, acquire targets, and fight.
- Jungle camps remain neutral until first damage, then leash
  players and respawn on a timer.
- Lane turrets protect inner/outer/base/nexus from damage
  unless a higher-priority tier is destroyed. The Nexus-tier
  structures become damageable only after a full lane is
  cleared. Destroyed turrets stay destroyed for the rest of
  the match and award gold exactly once.
- Players earn passive gold (≈1 cr/s) plus one-shot rewards
  for last-hits, structure kills, and player kills.
- The base shop exposes 7 weapons + 2 armor items. Purchases
  are server-validated against alive state, in-shop radius,
  owned count, and credits. Successful purchases swap
  weapons or grant armor immediately.
- A single Nexus destruction ends the match; the server
  broadcasts `match.ended` exactly once. Further combat,
  purchases, and minion movement are rejected.
- Snapshots now include minions, jungle, turrets, the shop
  catalog, the match phase, and the winning team. The web
  client renders all of these; the shop overlay and
  victory/defeat card react to the new fields.

### Test results

- `npm test` — 37 tests, 37 pass, 0 fail
  (7 shared + 15 server match + 15 server MOBA).
- `npm run typecheck` — PASS (all three workspaces).
- `npm run build` — PASS.

### Manual multiplayer verification steps

1. From the repo root, run `npm run dev:server` (port 2567) and
   `npm run dev:web` (port 5173), or use `npm run docker:up` for
   the containerised stack.
2. Open two browser tabs on the home screen, type a name in
   each, click "Bắt đầu chơi" on both. The lobby will pair them
   into a MatchRoom.
3. Walk into the lane (WASD); the first minion wave spawns at
   1:30 by default. Verify that blue and red minions meet in
   the middle of the lane and fight each other.
4. Engage a jungle camp: damage the monster once to aggro, run
   far away to verify it returns to its spawn, and check the
   respawn indicator in the HUD.
5. Attack an enemy outer turret; verify the inner turrets are
   invulnerable until the outer dies. After the outer is
   destroyed, gold is credited to the killer's team exactly
   once (visible in the scoreboard).
6. Walk into the blue base (or red base for the other tab) to
   trigger the shop overlay. Buy a weapon and an armor item;
   the player's weapon model and armor value should update
   immediately. Move out of the shop radius to dismiss.
7. To trigger the win condition in development, both teams must
   destroy a full lane's turrets to expose the opposing Nexus.
   After the Nexus is destroyed the server broadcasts
   `match.ended` and the result overlay appears with
   "CHIẾN THẮNG" / "THẤT BẠI".

### Known limitations

- Lane-progression rule is simplified: the Nexus becomes
  damageable after ANY single lane is fully cleared, not all
  three. This matches the chosen graybox layout and keeps the
  win condition achievable in development.
- Last-hit gold for lane minions vs. lane minions is not
  granted in this slice; only player kills, jungle kills,
  turret destruction, and player-vs-player kills grant
  credit. Lane minions are a background objective.
- The shop catalog is fixed (no item combination / inventory
  stacking beyond a `maxOwned` cap).
- Match result is a one-shot broadcast; the existing Phase 2
  lobby flow is preserved but a dedicated "return to lobby"
  UX beyond the "Trở về sảnh" button is reserved for Phase 7.
- Multi-client snapshot consistency is verified in unit tests
  (back-to-back snapshots from the same simulation agree), but
  a full two-browser end-to-end match has not been played in
  this development environment.

See `docs/PHASES.md` for the full roadmap.