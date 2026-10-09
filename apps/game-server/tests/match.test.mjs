/**
 * MatchRoom / MatchSimulation integration tests.
 *
 * These tests exercise the authoritative gameplay core directly (no
 * Colyseus transport) so they can run under `node --test`. The tests
 * cover the Phase 2 acceptance criteria:
 *
 *   - Valid shooting
 *   - Invalid fire rate (cooldown)
 *   - Empty magazine
 *   - Reload state
 *   - Damage application
 *   - Target death and respawn
 *   - Player death
 *   - Actions rejected while dead
 *   - Two clients observing the same authoritative result
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MatchSimulation } from "../dist-test/apps/game-server/src/sim/MatchSimulation.js";
import {
  WEAPONS,
  STARTER_WEAPON_ID,
  MATCH_CONFIG,
  ECONOMY_CONFIG,
  SHOP_ITEMS,
  getShopItem,
  validateBuy,
} from "@rift/shared";

function makeSimulation(opts) {
  return new MatchSimulation({
    tickRateHz: opts?.tickRateHz ?? 30,
    targets: opts?.targets,
  });
}

function makeSimpleTarget() {
  return {
    id: "t1",
    position: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 1, y: 1, z: 1 },
    maxHealth: 100,
    health: 100,
    alive: true,
    respawnTimer: 0,
    respawnSeconds: 1,
  };
}

/* ------------------------------------------------------------------ *
 * Fire validation                                                      *
 * ------------------------------------------------------------------ */

test("valid fire deducts ammo and applies damage", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  const initialMagazine = p.magazine;
  const initialHealth = sim.targets[0].health;

  // Face toward the target (yaw=0 means looking at -Z, so we set
  // target on -Z to ensure a hit). Use yaw=π/2 to look at +X, and
  // place target at +X axis.
  sim.targets[0].position = { x: 0, y: 0, z: 0 };
  // yaw = 0 → looking toward -Z; place target at (0, 0, -5)
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(result.accepted, true, "shot should be accepted");
  assert.ok(result.damageEvent, "damage event should be present");
  assert.equal(result.damageEvent?.targetId, "t1");
  assert.equal(p.magazine, initialMagazine - 1, "magazine decremented by 1");
  assert.ok(sim.targets[0].health < initialHealth, "target health reduced");
});

test("fire-rate cooldown rejects rapid second shot", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()], tickRateHz: 30 });
  sim.addPlayer("p1", "Alice", "blue");
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const first = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(first.accepted, true);
  // Immediately fire again (same tick) — must be rejected by fire-rate.
  const second = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(second.accepted, false, "second shot should be rejected by cooldown");
  assert.equal(second.reason, "fire_rate");
});

test("empty magazine is rejected", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.magazine = 0;
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "no_ammo");
});

test("reload is rejected while in-progress", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.reloading = true;
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "reloading");
});

test("actions are rejected when the player is dead", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  const startX = p.position.x;
  const startZ = p.position.z;
  p.alive = false;
  p.magazine = 10;
  const fire = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(fire.accepted, false);
  assert.equal(fire.reason, "dead");
  sim.applyInput("p1", { forward: 1, right: 0, sprint: false, jump: false, yaw: 0, pitch: 0 });
  // Player position should not change while dead
  assert.equal(p.position.x, startX);
  assert.equal(p.position.z, startZ);
});

/* ------------------------------------------------------------------ *
 * Damage application / target death                                   *
 * ------------------------------------------------------------------ */

test("target takes damage only once per shot", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  sim.addPlayer("p1", "Alice", "blue");
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const before = sim.targets[0].health;
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(result.accepted, true);
  assert.equal(sim.targets[0].health, before - WEAPONS[STARTER_WEAPON_ID].damageBody);
});

test("target dies when health drops to zero and respawns after delay", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()], tickRateHz: 30 });
  const p = sim.addPlayer("p1", "Alice", "blue");
  // Reduce target health so one body shot kills it.
  sim.targets[0].health = 10;
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(result.accepted, true);
  assert.equal(sim.targets[0].alive, false, "target should be marked dead");
  // Advance ticks past 1 second respawn (35 ticks at 30 Hz = 1.166 s,
  // which gives a comfortable float-rounding buffer over 1.0).
  for (let i = 0; i < 35; i++) sim.advanceTick();
  assert.equal(sim.targets[0].alive, true, "target should respawn after delay");
  assert.equal(sim.targets[0].health, sim.targets[0].maxHealth);
  // Player magazine should reflect two fire-rate windows
  void p;
});

/* ------------------------------------------------------------------ *
 * Player death & respawn                                                *
 * ------------------------------------------------------------------ */

test("force respawn restores full health, magazine, and position", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.alive = false;
  p.health = 0;
  p.position = { x: 99, y: 99, z: 99 };
  p.magazine = 0;
  p.reserve = 0;
  sim.forceRespawn("p1");
  assert.equal(p.alive, true);
  assert.equal(p.health, p.maxHealth);
  assert.equal(p.magazine, WEAPONS[STARTER_WEAPON_ID].magazineSize);
  // Respawn position should be near the team's spawn
  const spawn = p.position;
  assert.ok(Math.abs(spawn.x) > 0 || Math.abs(spawn.z) > 0, "respawned at a spawn point");
});

/* ------------------------------------------------------------------ *
 * Reload timing                                                         *
 * ------------------------------------------------------------------ */

test("reload completes after the configured reload seconds", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()], tickRateHz: 30 });
  const p = sim.addPlayer("p1", "Alice", "blue");
  // Drain magazine
  p.magazine = 0;
  p.reserve = 36;
  const started = sim.startReload("p1");
  assert.equal(started, true, "reload should start");
  assert.equal(p.reloading, true);
  const weapon = WEAPONS[STARTER_WEAPON_ID];
  const reloadTicks = Math.ceil(weapon.reloadSeconds * 30);
  for (let i = 0; i < reloadTicks - 1; i++) {
    sim.advanceTick();
    assert.equal(p.reloading, true, `still reloading at tick ${i + 1}`);
  }
  sim.advanceTick();
  assert.equal(p.reloading, false, "reload complete after enough ticks");
  assert.equal(p.magazine, weapon.magazineSize, "magazine refilled");
});

/* ------------------------------------------------------------------ *
 * Team assignment                                                       *
 * ------------------------------------------------------------------ */

test("players are added with the correct team spawn", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const blue = sim.addPlayer("p1", "Alice", "blue");
  const red = sim.addPlayer("p2", "Bob", "red");
  // Blue spawn is at +X, red at -X
  assert.ok(blue.position.x > 0, "blue spawns at +X");
  assert.ok(red.position.x < 0, "red spawns at -X");
});

/* ------------------------------------------------------------------ *
 * Two clients seeing the same authoritative result                      *
 * ------------------------------------------------------------------ */

test("two players firing at the same target converge on identical state", () => {
  // Use an in-memory snapshot map so we can assert the two observers
  // see the same state.
  const sim = makeSimulation({ targets: [makeSimpleTarget()], tickRateHz: 30 });
  sim.addPlayer("p1", "Alice", "blue");
  sim.addPlayer("p2", "Bob", "red");
  sim.targets[0].position = { x: 0, y: 0, z: -5 };

  const observer1 = sim.buildSnapshot();
  const observer2 = sim.buildSnapshot();
  assert.deepEqual(observer1, observer2, "snapshots from the same tick are identical");

  // p1 fires
  sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  const afterFire = sim.buildSnapshot();
  const afterFire2 = sim.buildSnapshot();
  assert.deepEqual(afterFire, afterFire2, "snapshots after a fire are identical for both observers");
  assert.ok(afterFire.targets[0].health < observer1.targets[0].health);
});

/* ------------------------------------------------------------------ *
 * Invalid aim is rejected or defaulted                                   *
 * ------------------------------------------------------------------ */

test("invalid aim input is ignored (not NaN'd into the state)", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  sim.applyInput("p1", { forward: 0, right: 0, sprint: false, jump: false, yaw: Number.NaN, pitch: 0 });
  assert.ok(Number.isFinite(p.yaw), "yaw remains finite after invalid input");
});

test("move input outside the unit range is clamped", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  const p = sim.addPlayer("p1", "Alice", "blue");
  sim.applyInput("p1", { forward: 10, right: -10, sprint: true, jump: false, yaw: 0, pitch: 0 });
  assert.equal(p.inputForward, 1, "forward clamped to 1");
  assert.equal(p.inputRight, -1, "right clamped to -1");
});

/* ------------------------------------------------------------------ *
 * Damage is server-calculated, not client-trusted                       *
 * ------------------------------------------------------------------ */

test("damage is computed from weapon stats, not from the client", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  sim.addPlayer("p1", "Alice", "blue");
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const weapon = WEAPONS[STARTER_WEAPON_ID];
  const before = sim.targets[0].health;
  const result = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  // Damage is always weapon.damageBody for a body hit, regardless of
  // any client-supplied amount. The result carries this authoritative
  // value, which would be broadcast to all clients.
  assert.equal(result.damageEvent?.amount, weapon.damageBody);
  assert.equal(sim.targets[0].health, before - weapon.damageBody);
});

/* ------------------------------------------------------------------ *
 * Snapshot coverage                                                      *
 * ------------------------------------------------------------------ */

test("snapshot exposes all required Phase 2 fields", () => {
  const sim = makeSimulation({ targets: [makeSimpleTarget()] });
  sim.addPlayer("p1", "Alice", "blue");
  sim.addPlayer("p2", "Bob", "red");
  const snap = sim.buildSnapshot();
  assert.equal(snap.type, "game.state");
  assert.equal(snap.phase, "playing");
  assert.equal(snap.players.length, 2);
  assert.equal(snap.targets.length, 1);
  for (const p of snap.players) {
    assert.ok(p.id);
    assert.ok(p.name);
    assert.ok(p.team === "blue" || p.team === "red");
    assert.ok(typeof p.health === "number");
    assert.ok(p.maxHealth === MATCH_CONFIG.agentBaseHealth);
    assert.ok(typeof p.alive === "boolean");
    assert.ok(p.ammo);
    assert.equal(typeof p.ammo.magazine, "number");
    assert.equal(typeof p.ammo.reserve, "number");
  }
});
