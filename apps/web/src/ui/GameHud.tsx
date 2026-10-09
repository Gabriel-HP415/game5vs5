import { useEffect, useRef } from "react";
import { useAppStore, formatMMSS } from "../store";
import { MAP_DEFAULT, MATCH_CONFIG, PHYSICS_CONFIG, WEAPONS } from "@rift/shared";
import { distanceToTeamShop } from "../store";
import { useNetworkStatus, useKillFeed } from "../network";
import { useState } from "react";
import { ShopOverlay } from "./ShopOverlay";
import { MatchResultOverlay } from "./MatchResultOverlay";

/* ------------------------------------------------------------------ *
 * HUD overlay                                                         *
 * ------------------------------------------------------------------ *
 * DOM-based HUD: crosshair, health, armor, ammo, reload, kill feed,    *
 * scoreboard, network status, respawn countdown, match timer.         *
 *                                                                      *
 * The HUD reads from the Zustand store which is now updated by the     *
 * authoritative server (PHASE 2).                                    *
 * ------------------------------------------------------------------ */

export function GameHud() {
  return (
    <div className="hud">
      <Crosshair />
      <HealthOverlay />
      <AmmoOverlay />
      <CreditsOverlay />
      <Minimap />
      <TimerOverlay />
      <HintOverlay />
      <ConnectionPill />
      <NetworkStatus />
      <KillFeed />
      <Scoreboard />
      <DeathOverlay />
      <ObjectiveStatus />
      <ShopOverlay />
      <MatchResultOverlay />
      {useAppStore.getState().hitFlashSeconds > 0 ? <HitFlashOverlay /> : null}
      <StatsOverlay />
    </div>
  );
}

function Crosshair() {
  return (
    <div className="crosshair">
      <div className="h-l" />
      <div className="h-r" />
    </div>
  );
}

function HealthOverlay() {
  const player = useAppStore((s) => s.player);
  const hp = Math.max(0, Math.round(player.health));
  const maxHp = player.maxHealth;
  const armor = Math.max(0, Math.round(player.armor));
  return (
    <div className="health">
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 26, fontWeight: 600 }}>{hp}</span>
        <span className="muted">+ {armor}</span>
      </div>
      <div className="health-bar" style={{ position: "relative" }}>
        <div
          className="fill"
          style={{
            width: `${(hp / maxHp) * 100}%`,
            background: "linear-gradient(90deg, #ff5263 0%, #ff7b3a 100%)",
          }}
        />
        {armor > 0 && (
          <div
            className="fill"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${(armor / MATCH_CONFIG.heavyArmorPoints) * 100}%`,
              background: "rgba(58, 163, 255, 0.55)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

function AmmoOverlay() {
  const player = useAppStore((s) => s.player);
  const def = WEAPONS[player.weapon as keyof typeof WEAPONS];
  const displayName = def?.displayName ?? "—";
  const magazine = player.magazine;
  const reserve = player.reserve;
  const reloading = player.reloading;
  return (
    <div className="weapon">
      <div className="name">{displayName}</div>
      <div className="ammo">
        <span style={{ fontWeight: 600 }}>{magazine}</span>
        <span className="muted"> / {reserve}</span>
      </div>
      {reloading ? (
        <div className="reload-indicator">
          <ReloadBar />
        </div>
      ) : null}
    </div>
  );
}

function ReloadBar() {
  // A small CSS animated bar that completes over the weapon's reload time.
  const player = useAppStore((s) => s.player);
  const def = WEAPONS[player.weapon as keyof typeof WEAPONS];
  const seconds = def?.reloadSeconds ?? 1.75;
  return (
    <div className="reload-bar" key={`${player.weapon}-reload`}>
      <div
        className="reload-fill"
        style={{ animation: `rift-reload ${seconds}s linear forwards` }}
      />
      <span className="reload-label">ĐANG NẠP ĐẠN</span>
    </div>
  );
}

function CreditsOverlay() {
  const player = useAppStore((s) => s.player);
  return (
    <div className="credits">
      <span style={{ fontSize: 16, marginRight: 6 }}>$</span>
      {player.credits}
    </div>
  );
}

function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useAppStore((s) => s.player);
  const players = useAppStore((s) => s.players);
  const myId = useAppStore((s) => s.myPlayerId);
  const map = MAP_DEFAULT;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, w, h);

    const world = { minX: map.boundsMin.x, maxX: map.boundsMax.x, minZ: map.boundsMin.z, maxZ: map.boundsMax.z };
    const sx = (w - 8) / (world.maxX - world.minX);
    const sz = (h - 8) / (world.maxZ - world.minZ);
    const tx = (x: number) => 4 + (x - world.minX) * sx;
    const tz = (z: number) => 4 + (z - world.minZ) * sz;

    // Lane strip
    ctx.fillStyle = "#2a3145";
    ctx.fillRect(tx(0) - 4, tz(-40), 8, 80);
    ctx.fillRect(tx(-30) - 4, tz(0), 60, 8);
    ctx.fillRect(tx(-90), tz(0) - 4, 180, 8);

    // Bases
    ctx.fillStyle = player.team === "blue" ? "#1d3a6b" : "#6b1d2a";
    ctx.fillRect(tx(60), tz(-7), 16, 14);
    ctx.fillStyle = player.team === "blue" ? "#6b1d2a" : "#1d3a6b";
    ctx.fillRect(tx(-76), tz(-7), 16, 14);

    // River
    ctx.fillStyle = "rgba(58, 163, 255, 0.18)";
    ctx.fillRect(tx(-7), tz(-15), 14, 30);

    // Player marker
    ctx.fillStyle = player.team === "blue" ? "#3aa3ff" : "#ff5263";
    ctx.beginPath();
    ctx.arc(tx(player.position.x), tz(player.position.z), 3, 0, Math.PI * 2);
    ctx.fill();

    // Player facing arrow
    const fx = Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx(player.position.x), tz(player.position.z));
    ctx.lineTo(
      tx(player.position.x) + fx * 8,
      tz(player.position.z) + fz * 8
    );
    ctx.stroke();

    // Other players
    for (const p of Object.values(players)) {
      if (p.id === myId) continue;
      if (!p.alive) continue;
      ctx.fillStyle = p.team === "blue" ? "#3aa3ff" : "#ff5263";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(tx(p.position.x), tz(p.position.z), 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, [player, players, myId, map]);

  return (
    <div className="minimap">
      <canvas ref={ref} className="map-canvas" width={180} height={180} />
      <div className="legend">BẢN ĐỒ NHỎ</div>
    </div>
  );
}

function TimerOverlay() {
  const matchTime = useAppStore((s) => s.matchTimeSeconds);
  return <div className="timer">{formatMMSS(matchTime)}</div>;
}

function HintOverlay() {
  const network = useNetworkStatus();
  const player = useAppStore((s) => s.player);
  if (document.pointerLockElement !== null) return null;
  if (network.status !== "in-match") return null;
  return (
    <div className="hint">
      Nhấp chuột để bắt đầu — WASD di chuyển · Shift chạy nhanh · Space nhảy · R nạp đạn · Esc tạm dừng
      <br />
      <span className="muted">
        Bạn đang ở spawn của đội {player.team === "blue" ? "Xanh" : "Đỏ"}. Hãy di chuyển ra lane để giao tranh.
      </span>
    </div>
  );
}

function ConnectionPill() {
  const network = useNetworkStatus();
  if (network.status === "offline") return null;
  const label =
    network.status === "in-match"
      ? "Đang trong trận"
      : network.status === "online"
      ? "Đã kết nối"
      : network.status === "connecting"
      ? "Đang kết nối"
      : "Lỗi";
  const klass =
    "status-pill " +
    (network.status === "in-match" || network.status === "online"
      ? ""
      : network.status === "connecting"
      ? "warn"
      : "error");
  return (
    <div className="hud connection-pill" style={{ top: 64 }}>
      <span className={klass}>
        <span className="dot" />
        {label}
      </span>
    </div>
  );
}

function NetworkStatus() {
  const network = useNetworkStatus();
  if (network.status !== "error") return null;
  return (
    <div className="hud error-overlay">
      <strong>Lỗi kết nối máy chủ</strong>
      <div className="muted">{network.detail ?? "Không thể kết nối tới authoritative server."}</div>
    </div>
  );
}

function KillFeed() {
  const entries = useKillFeed();
  return (
    <div className="killfeed">
      {entries.slice(0, 5).map((e) => (
        <div key={e.id} className="killfeed-row">
          <span className="killer">{e.killerName}</span>
          <span className="weapon">{e.headshot ? "⊕" : "→"}</span>
          <span className="victim">{e.victimName}</span>
        </div>
      ))}
    </div>
  );
}

function Scoreboard() {
  const players = useAppStore((s) => s.players);
  const myId = useAppStore((s) => s.myPlayerId);
  const [open, setOpen] = useState(false);
  const blues = Object.values(players).filter((p) => p.team === "blue");
  const reds = Object.values(players).filter((p) => p.team === "red");
  const blueScore = blues.reduce((sum, p) => sum + p.kills, 0);
  const redScore = reds.reduce((sum, p) => sum + p.kills, 0);
  return (
    <div className="scoreboard">
      <button
        className="ghost scoreboard-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{ pointerEvents: "auto" }}
      >
        BẢNG ĐIỂM {open ? "▾" : "▴"}  {blueScore} : {redScore}
      </button>
      {open ? (
        <div className="scoreboard-panel">
          <div className="team">
            <div className="team-title blue">XANH</div>
            {renderSlots(blues, myId)}
          </div>
          <div className="team">
            <div className="team-title red">ĐỎ</div>
            {renderSlots(reds, myId)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderSlots(
  team: Array<{ id: string; name: string; alive: boolean; kills: number; deaths: number; assists: number; health: number; maxHealth: number; agent: string | null }>,
  myId: string | null
) {
  const rows = [...team];
  while (rows.length < 5) {
    rows.push({
      id: `empty-${rows.length}`,
      name: "—",
      alive: false,
      kills: 0,
      deaths: 0,
      assists: 0,
      health: 0,
      maxHealth: 100,
      agent: null,
    });
  }
  return (
    <div>
      {rows.map((p) => (
        <div
          key={p.id}
          className={"score-row" + (p.id === myId ? " self" : "")}
        >
          <span className="name">{p.name}</span>
          <span className="kd">
            {p.kills}/{p.deaths}/{p.assists}
          </span>
          <span className="hp" style={{ color: p.alive ? "#a6d8ff" : "#555" }}>
            {p.alive ? `${p.health}/${p.maxHealth}` : "Đã chết"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DeathOverlay() {
  const player = useAppStore((s) => s.player);
  if (player.alive) return null;
  const respawnIn = Math.max(0, player.respawnSeconds);
  return (
    <div className="hud death-overlay">
      <div className="death-card">
        <h2>ĐÃ BỊ HẠ</h2>
        <p className="muted">Đang hồi sinh…</p>
        <div className="respawn-timer">{respawnIn.toFixed(1)}s</div>
      </div>
    </div>
  );
}

function ObjectiveStatus() {
  const turrets = useAppStore((s) => s.turrets);
  const me = useAppStore((s) => s.player);
  const enemyTurrets = Object.values(turrets).filter(
    (t) => t.team !== me.team && t.tier !== "nexus" && t.alive
  );
  const myTurrets = Object.values(turrets).filter(
    (t) => t.team === me.team && t.tier !== "nexus" && t.alive
  );
  return (
    <div className="hud objective-status">
      <div className="muted" style={{ fontSize: 11 }}>MỤC TIÊU LỚN</div>
      <div style={{ fontSize: 12 }}>
        Trụ đồng minh: <strong>{myTurrets.length}</strong> · Trụ địch:{" "}
        <strong>{enemyTurrets.length}</strong>
      </div>
      <div style={{ fontSize: 11 }} className="muted">
        Phá hủy toàn bộ trụ của một lane để mở Nexus đối phương.
      </div>
    </div>
  );
}

function HitFlashOverlay() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        boxShadow: "inset 0 0 80px rgba(255, 60, 60, 0.35)",
        pointerEvents: "none",
      }}
    />
  );
}

function StatsOverlay() {
  const match = useAppStore((s) => s.match);
  const accuracy = match.shots > 0 ? Math.round((match.hits / match.shots) * 100) : 0;
  return (
    <div
      className="reticle-info"
      style={{
        top: 80,
        right: 24,
        left: "auto",
        transform: "none",
        background: "rgba(7, 12, 24, 0.6)",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid var(--line)",
      }}
    >
      <div>
        <span className="muted">ĐẠN</span>
        <div style={{ fontSize: 14, color: "var(--text-0)" }}>{match.shots}</div>
      </div>
      <div>
        <span className="muted">TRÚNG</span>
        <div style={{ fontSize: 14, color: "var(--text-0)" }}>{match.hits}</div>
      </div>
      <div>
        <span className="muted">CHÍNH XÁC</span>
        <div style={{ fontSize: 14, color: "var(--text-0)" }}>{accuracy}%</div>
      </div>
    </div>
  );
}

/* unused vars suppression */
void PHYSICS_CONFIG;
