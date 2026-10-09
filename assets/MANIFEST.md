# Asset Manifest

This file tracks what assets exist, what is procedurally generated, and what is
still missing. PHASE 1 ships without any external assets; everything is built
from primitive geometry and color tints.

## Models

| Asset                      | Source                  | Status        |
| -------------------------- | ----------------------- | ------------- |
| Map graybox                | Procedural (Box, Plane) | DONE (PHASE 1) |
| Spawn beacon (blue/red)    | Procedural              | DONE (PHASE 1) |
| Target dummy               | Procedural              | DONE (PHASE 1) |
| First-person weapon model  | Procedural              | DONE (PHASE 1) |
| Turret placeholder         | Procedural              | Planned (PHASE 3) |
| Minion placeholder         | Procedural              | Planned (PHASE 3) |
| Jungle monster placeholder | Procedural              | Planned (PHASE 3) |
| Nexus placeholder          | Procedural              | Planned (PHASE 3) |
| Agent character models     | TBD                     | Planned (PHASE 5/8) |
| Weapon world pickups       | TBD                     | Planned (PHASE 8) |

## Audio

| Asset                      | Source                  | Status        |
| -------------------------- | ----------------------- | ------------- |
| Master / music / sfx bus   | WebAudio graph          | Planned (PHASE 5) |
| Weapon firing              | TBD (open-source)       | Planned (PHASE 8) |
| Footsteps                  | TBD (open-source)       | Planned (PHASE 8) |
| Ability cues               | TBD (open-source)       | Planned (PHASE 8) |

## Textures

PHASE 1 uses solid color materials. PHASE 3+ will introduce a tiling palette
of simple, original or permissively-licensed textures (concrete, grass, river,
metal).

## Animations

Animation states for character rigs are not yet implemented. PHASE 1 uses a
static placeholder body. Full rigs (idle, walk, run, jump, fire, reload, hit,
death) are scheduled for PHASE 5/8.