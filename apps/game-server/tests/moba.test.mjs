/**
 * PHASE 3 MOBA integration tests.
 *
 * These tests exercise the lane minion, jungle, turret, economy, shop,
 * Nexus and match-lifecycle systems through the `MatchSimulation` API.
 * They are deterministic: they advance ticks explicitly and avoid
 * fragile floating-point timing assertions by using integer math
 * where possible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MatchSimulation } from "../dist-test/apps/game-server/src/sim/MatchSimulation.js";
import { SHOP_ITEMS, MAP_DEFAULT } from "@rift/shared";

function newSim() {
  return new MatchSimulation({ tickRateHz: 30 });
}

/* ------------------------------------------------------------------ *
 * Lane minions                                                          *
 * ------------------------------------------------------------------ */

test("minion waves spawn for both teams on all three lanes", () => {
  const sim = newSim();
  sim.addPlayer("p1", "Alice", "blue");
  sim.addPlayer("p2", "Bob", "red");
  sim.minions.forceSpawnWave();
  assert.equal(sim.minions.countForTeam("blue"), 3 * 3 * 2, "blue spawns 18 minions (3 lanes x 6)");
  assert.equal(sim.minions.countForTeam("red"), 18, "red spawns 18 minions (3 lanes x 6)");
  assert.ok(sim.minions.countOnLane("blue", "top") > 0, "blue has top-lane minions");
  assert.ok(sim.minions.countOnLane("blue", "mid") > 0, "blue has mid-lane minions");
  assert.ok(sim.minions.countOnLane("blue", "bot") > 0, "blue has bot-lane minions");
});

test("minions walk along their lane waypoints over time", () => {
  const sim = newSim();
  sim.addPlayer("p1", "Alice", "blue");
  sim.minions.forceSpawnWave();
  const startPositions = sim.minions.minions
    .filter((m) => m.team === "blue")
    .map((m) => ({ x: m.position.x, z: m.position.z }));
  // Advance a few ticks; the blue team should move toward the red base (-X).
  for (let i = 0; i < 20; i++) sim.advanceTick();
  const blueMinions = sim.minions.minions.filter((m) => m.team === "blue");
  assert.ok(blueMinions.length > 0, "blue minions still alive");
  // At least one blue minion should have moved toward -X.
  const moved = blueMinions.some(
    (m, i) => m.position.x < startPositions[i].x - 0.5
  );
  assert.ok(moved, "blue minions advance toward the red base");
});

test("minion last-hit by a player grants gold exactly once", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  sim.minions.forceSpawnWave();
  // Pick a red melee minion, park a blue player right on top of it.
  const redMinion = sim.minions.minions.find((m) => m.team === "red" && m.type === "melee");
  assert.ok(redMinion, "red minion present");
  p.position = { x: redMinion.position.x, y: redMinion.position.y, z: redMinion.position.z };
  p.yaw = 0; // looking down -Z
  // One body shot from a Classic deals 26 damage; melee minion has 250 HP,
  // so we need to damage it via the internal minion system to test the
  // last-hit credit path precisely.
  const startCredits = p.credits;
  const r = sim.minions.damageFromPlayer(redMinion.id, redMinion.health, p.id);
  assert.equal(r.killed, true, "killing blow registered");
  if (r.killed) sim.economy.grantLastHit(p.id, r.credit);
  assert.equal(p.credits, startCredits + r.credit, "last-hit credit applied once");
  // Second hit on already-dead minion must NOT award extra credit.
  const r2 = sim.minions.damageFromPlayer(redMinion.id, 50, p.id);
  assert.equal(r2.killed, false, "second hit on dead minion returns killed=false");
  assert.equal(p.credits, startCredits + r.credit, "no duplicate credit");
});

/* ------------------------------------------------------------------ *
 * Jungle monsters                                                       *
 * ------------------------------------------------------------------ */

test("jungle monster dies on damage and respawns after the timer", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  const m = sim.jungle.monsters[0];
  const reward = m.rewardGold;
  const startCredits = p.credits;
  // Drive monster health to 0 with one large hit.
  const r = sim.jungle.damageMonster(m.id, m.maxHealth + 5, p.id);
  assert.equal(r.killed, true);
  if (r.killed) sim.economy.grantLastHit(p.id, r.reward);
  assert.equal(p.credits, startCredits + reward, "reward applied once");
  // Advance ticks equal to the respawn timer; monster must come back.
  const ticksToWait = Math.ceil(m.respawnSeconds * 30) + 1;
  for (let i = 0; i < ticksToWait; i++) sim.advanceTick();
  const after = sim.jungle.get(m.id);
  assert.ok(after && after.alive, "monster respawns after timer");
  assert.equal(after.health, after.maxHealth, "respawned at full health");
});

test("jungle monster aggro disengages when target leaves the leash", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  const m = sim.jungle.monsters[0];
  // Park the player at the camp, damage the monster so it aggros.
  p.position = { x: m.position.x, y: 0, z: m.position.z };
  sim.jungle.damageMonster(m.id, 5, p.id);
  assert.equal(m.aggroId, p.id, "monster aggros the player");
  // Teleport the player far away; the leash should disengage next tick.
  p.position = { x: 500, y: 0, z: 500 };
  sim.advanceTick(0.05);
  assert.notEqual(m.aggroId, p.id, "leash disengages when target leaves radius");
});

/* ------------------------------------------------------------------ *
 * Turrets                                                               *
 * ------------------------------------------------------------------ */

test("turret protection prevents damage to inner turrets while outer is alive", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "red");
  // Pick a blue mid inner turret.
  const inner = sim.turrets.turrets.find(
    (t) => t.team === "blue" && t.lane === "mid" && t.tier === "inner"
  );
  assert.ok(inner, "blue mid inner turret present");
  const r = sim.turrets.damageTurret(inner.id, 99999, p.id);
  assert.equal(r.landed, false, "inner turret is protected by outer");
  // Now destroy the outer turret of the same lane.
  const outer = sim.turrets.turrets.find(
    (t) => t.team === "blue" && t.lane === "mid" && t.tier === "outer"
  );
  const r2 = sim.turrets.damageTurret(outer.id, 99999, p.id);
  assert.equal(r2.killed, true);
  // Refresh protection so the inner becomes targetable.
  sim.turrets.refreshProtection();
  const r3 = sim.turrets.damageTurret(inner.id, 50, p.id);
  assert.equal(r3.landed, true, "inner turret is now hittable");
});

test("turret destruction awards team gold once", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "red");
  const teammate = sim.addPlayer("p2", "Cara", "red");
  const startCredits = p.credits;
  const startCreditsT = teammate.credits;
  // Pick a blue outer turret (lowest priority, unprotected by default).
  const outer = sim.turrets.turrets.find(
    (t) => t.team === "blue" && t.lane === "top" && t.tier === "outer"
  );
  const r = sim.turrets.damageTurret(outer.id, 99999, p.id);
  assert.equal(r.killed, true);
  if (r.killed) sim.awardTurretDestruction(outer.id, p.id);
  // Both red players should have received the credit; blue team members should not.
  assert.ok(p.credits > startCredits, "killer gets credit");
  assert.ok(teammate.credits > startCreditsT, "teammate gets credit");
  // Awarding the same destruction again must not double-credit.
  const k1 = p.credits;
  const t1 = teammate.credits;
  sim.awardTurretDestruction(outer.id, p.id);
  assert.equal(p.credits, k1, "no double credit on second award");
  assert.equal(teammate.credits, t1, "no double credit on second award");
});

/* ------------------------------------------------------------------ *
 * Nexus / match lifecycle                                               *
 * ------------------------------------------------------------------ */

test("Nexus is protected while base turret is alive; destroying it ends the match exactly once", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "red");
  // Damage to a blue Nexus should be rejected while the base turrets
  // exist; after the lane turrets die and the nexus is exposed, the
  // destruction ends the match.
  const nexus = sim.turrets.turrets.find(
    (t) => t.team === "blue" && t.tier === "nexus"
  );
  const r0 = sim.damageNexus("blue", 99999, p.id);
  assert.equal(r0.ended, false, "nexus is protected by lane turrets");
  // Now nuke the lane turrets in sequence to expose the nexus.
  for (const lane of ["top", "bot"]) {
    for (const tier of ["outer", "inner", "base"]) {
      const t = sim.turrets.turrets.find(
        (x) => x.team === "blue" && x.lane === lane && x.tier === tier
      );
      if (t) sim.turrets.damageTurret(t.id, 99999, p.id);
    }
  }
  sim.turrets.refreshProtection();
  const r1 = sim.damageNexus("blue", 99999, p.id);
  assert.equal(r1.ended, true, "nexus destroyed ends the match");
  assert.equal(r1.winner, "red", "winner is the opposing team");
  // Second destruction attempt must not transition again.
  const r2 = sim.damageNexus("blue", 99999, p.id);
  assert.equal(r2.ended, false, "second destruction does not re-trigger");
  assert.equal(sim.lifecycle.winner, "red", "winner remains red");
});

test("finished match rejects combat and purchases", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  // End the match.
  sim.lifecycle.end("red", sim.serverTick);
  // Shooting should be rejected.
  sim.targets[0].position = { x: 0, y: 0, z: -5 };
  const r = sim.resolveHit("p1", 0, 0, { x: 0, y: 1, z: 0 });
  assert.equal(r.accepted, false, "shots are rejected after match end");
  // Buying should be rejected.
  const b = sim.applyBuy("p1", "armor.light");
  assert.equal(b.ok, false, "buys are rejected after match end");
  // Minions should not advance when match is finished.
  sim.minions.forceSpawnWave();
  const start = sim.minions.minions.map((m) => ({ x: m.position.x, z: m.position.z }));
  for (let i = 0; i < 30; i++) sim.advanceTick();
  for (let i = 0; i < sim.minions.minions.length; i++) {
    assert.equal(sim.minions.minions[i].position.x, start[i].x, "minions frozen");
    assert.equal(sim.minions.minions[i].position.z, start[i].z, "minions frozen");
  }
  void p;
});

/* ------------------------------------------------------------------ *
 * Shop / economy                                                        *
 * ------------------------------------------------------------------ */

test("valid purchase deducts gold and applies the item effect", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  // Give the player enough gold to buy a light armor and park them at the
  // team's base shop center.
  p.credits = 10_000;
  const shop = MAP_DEFAULT.shopZones.blue.center;
  p.position = { x: shop.x, y: 0, z: shop.z };
  const before = p.armor;
  const r = sim.applyBuy("p1", "armor.light");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(p.armor, before + r.item.armorGrant, "armor granted");
    assert.equal(p.credits, 10_000 - r.item.price, "credits deducted");
  }
});

test("insufficient gold rejects the purchase", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.credits = 50;
  const shop = MAP_DEFAULT.shopZones.blue.center;
  p.position = { x: shop.x, y: 0, z: shop.z };
  const r = sim.applyBuy("p1", "armor.light");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "no_gold");
});

test("buying outside the shop radius is rejected", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.credits = 10_000;
  p.position = { x: 0, y: 0, z: 0 };
  const r = sim.applyBuy("p1", "armor.light");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not_in_shop");
});

test("duplicate weapon purchase is rejected", () => {
  const sim = newSim();
  const p = sim.addPlayer("p1", "Alice", "blue");
  p.credits = 10_000;
  const shop = MAP_DEFAULT.shopZones.blue.center;
  p.position = { x: shop.x, y: 0, z: shop.z };
  const r1 = sim.applyBuy("p1", "weapon.vandal");
  assert.equal(r1.ok, true);
  const r2 = sim.applyBuy("p1", "weapon.vandal");
  assert.equal(r2.ok, false, "second purchase of single-copy weapon is rejected");
});

test("shop exposes a non-empty catalog of items", () => {
  const cat = SHOP_ITEMS;
  assert.ok(cat.length >= 3, "at least three items available");
  for (const it of cat) {
    assert.ok(it.id && it.displayName && it.price > 0, "every item has id/name/price");
  }
});

/* ------------------------------------------------------------------ *
 * Multi-observer consistency                                            *
 * ------------------------------------------------------------------ */

test("two snapshots from the same simulation agree on all entity state", () => {
  const sim = newSim();
  sim.addPlayer("p1", "Alice", "blue");
  sim.addPlayer("p2", "Bob", "red");
  sim.minions.forceSpawnWave();
  sim.advanceTick(0.1);
  const snap1 = sim.buildSnapshot();
  const snap2 = sim.buildSnapshot();
  // Snapshots taken back-to-back without advancing should be byte-for-byte
  // identical (deterministic state).
  assert.equal(snap1.serverTick, snap2.serverTick, "same tick");
  assert.equal(snap1.minions.length, snap2.minions.length, "same minion count");
  assert.equal(snap1.turrets.length, snap2.turrets.length, "same turret count");
  for (let i = 0; i < snap1.turrets.length; i++) {
    assert.equal(snap1.turrets[i].id, snap2.turrets[i].id);
    assert.equal(snap1.turrets[i].health, snap2.turrets[i].health);
    assert.equal(snap1.turrets[i].alive, snap2.turrets[i].alive);
  }
});
