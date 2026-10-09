import { create } from "zustand";
import {
  MATCH_CONFIG,
  RESPAWN_CONFIG,
  PHYSICS_CONFIG,
  SHOP_CONFIG,
  STARTER_WEAPON_ID,
  MAP_DEFAULT,
  startingCredits,
  type TeamId,
  type ServerPlayerSnapshot,
  type ServerTargetSnapshot,
  type ServerMinionSnapshot,
  type ServerJungleMonsterSnapshot,
  type ServerTurretSnapshot,
  type ServerShopItem,
  type KillFeedEntry,
} from "@rift/shared";

/* ------------------------------------------------------------------ *
 * Settings (audio, mouse sensitivity, graphics) — local-only state.  *
 * ------------------------------------------------------------------ */

export interface ClientSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  mouseSensitivity: number;
  graphicsQuality: "low" | "medium" | "high";
  fullscreen: boolean;
}

const DEFAULT_SETTINGS: ClientSettings = {
  masterVolume: 0.7,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  mouseSensitivity: 1.0,
  graphicsQuality: "medium",
  fullscreen: false,
};

/* ------------------------------------------------------------------ *
 * Local player state (PHASE 1). In PHASE 2 this is derived from the   *
 * server's authoritative snapshot for our own player, and reflects    *
 * what the local FPS controller and HUD should render.                *
 * ------------------------------------------------------------------ */

export interface LocalPlayerState {
  team: TeamId;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  velocity: { x: number; y: number; z: number };
  health: number;
  maxHealth: number;
  armor: number;
  credits: number;
  alive: boolean;
  respawnSeconds: number;
  weapon: string;
  magazine: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  kills: number;
  deaths: number;
  assists: number;
}

const BLUE_SPAWN = MAP_DEFAULT.spawnPoints.find((s) => s.team === "blue")!;

const INITIAL_PLAYER: LocalPlayerState = {
  team: "blue",
  position: { ...BLUE_SPAWN.position, y: PHYSICS_CONFIG.playerHeight },
  yaw: Math.PI, // facing toward enemy base
  pitch: 0,
  velocity: { x: 0, y: 0, z: 0 },
  health: MATCH_CONFIG.agentBaseHealth,
  maxHealth: MATCH_CONFIG.agentBaseHealth,
  armor: 0,
  credits: startingCredits(),
  alive: true,
  respawnSeconds: 0,
  weapon: STARTER_WEAPON_ID,
  magazine: 12,
  reserve: 36,
  reloading: false,
  reloadProgress: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
};

/* ------------------------------------------------------------------ *
 * App store                                                          *
 * ------------------------------------------------------------------ */

export type Screen = "home" | "game" | "matchmaking";

interface MatchStats {
  kills: number;
  assists: number;
  hits: number;
  shots: number;
}

export interface AppState {
  screen: Screen;
  displayName: string;
  settings: ClientSettings;
  /** Local-player state (sourced from server snapshot for our own id). */
  player: LocalPlayerState;
  /** All networked players keyed by sessionId. */
  players: Record<string, ServerPlayerSnapshot>;
  /** All server-authoritative targets keyed by id. */
  targets: Record<string, ServerTargetSnapshot>;
  /** All lane minions keyed by id. */
  minions: Record<string, ServerMinionSnapshot>;
  /** All jungle monsters keyed by id. */
  jungleMonsters: Record<string, ServerJungleMonsterSnapshot>;
  /** All defensive turrets keyed by id. */
  turrets: Record<string, ServerTurretSnapshot>;
  /** Catalog of shop items as broadcast by the server. */
  shopItems: ReadonlyArray<ServerShopItem>;
  /** Rolling kill feed (newest first). */
  killFeed: ReadonlyArray<KillFeedEntry>;
  match: MatchStats;
  network: { status: "offline" | "connecting" | "online" | "in-match" | "error"; endpoint: string; detail?: string };
  myPlayerId: string | null;
  queueSize: number;
  queueEtaSeconds: number | null;
  shopOpen: boolean;
  pauseOpen: boolean;
  matchTimeSeconds: number;
  hitFlashSeconds: number;
  serverTick: number;
  /** Match phase broadcast by the server. */
  matchPhase: "loading" | "playing" | "ended";
  /** Winning team id once the match has ended. */
  matchWinner: TeamId | null;
  /* actions */
  setScreen: (s: Screen) => void;
  setDisplayName: (n: string) => void;
  updateSettings: (patch: Partial<ClientSettings>) => void;
  applyPlayer: (patch: Partial<LocalPlayerState>) => void;
  setShopOpen: (b: boolean) => void;
  setPauseOpen: (b: boolean) => void;
  setMatchTime: (s: number) => void;
  setHitFlash: (s: number) => void;
  recordShot: (hit: boolean) => void;
  respawnPlayer: () => void;
  resetForNewMatch: () => void;
  setNetworkStatus: (status: AppState["network"]["status"], detail?: string) => void;
  setNetworkEndpoint: (endpoint: string) => void;
  setMyPlayerId: (id: string | null) => void;
  setQueueState: (size: number, eta: number | null) => void;
  applyServerSnapshot: (snap: {
    serverTick: number;
    matchTimeSeconds: number;
    phase: "loading" | "playing" | "ended";
    winner: TeamId | null;
    players: Record<string, ServerPlayerSnapshot>;
    targets: Record<string, ServerTargetSnapshot>;
    minions: Record<string, ServerMinionSnapshot>;
    jungleMonsters: Record<string, ServerJungleMonsterSnapshot>;
    turrets: Record<string, ServerTurretSnapshot>;
    shop: ReadonlyArray<ServerShopItem>;
    killFeed: ReadonlyArray<KillFeedEntry>;
  }) => void;
  appendKillFeed: (entry: KillFeedEntry) => void;
  clearMatchState: () => void;
}

function toLocalPlayer(s: ServerPlayerSnapshot): LocalPlayerState {
  return {
    team: s.team,
    position: { x: s.position.x, y: s.position.y, z: s.position.z },
    yaw: s.yaw,
    pitch: s.pitch,
    velocity: { x: s.velocity.x, y: s.velocity.y, z: s.velocity.z },
    health: s.health,
    maxHealth: s.maxHealth,
    armor: s.armor,
    credits: s.credits,
    alive: s.alive,
    respawnSeconds: s.respawnSeconds,
    weapon: s.weapon,
    magazine: s.ammo.magazine,
    reserve: s.ammo.reserve,
    reloading: s.ammo.reloading,
    reloadProgress: 0,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: "home",
  displayName: "Player",
  settings: DEFAULT_SETTINGS,
  player: INITIAL_PLAYER,
  players: {},
  targets: {},
  minions: {},
  jungleMonsters: {},
  turrets: {},
  shopItems: [],
  killFeed: [],
  match: { kills: 0, assists: 0, hits: 0, shots: 0 },
  network: { status: "offline", endpoint: "ws://localhost:2567" },
  myPlayerId: null,
  queueSize: 0,
  queueEtaSeconds: null,
  shopOpen: false,
  pauseOpen: false,
  matchTimeSeconds: 0,
  hitFlashSeconds: 0,
  serverTick: 0,
  matchPhase: "playing",
  matchWinner: null,

  setScreen: (s) => set({ screen: s }),
  setDisplayName: (n) => set({ displayName: n }),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  applyPlayer: (patch) =>
    set((state) => ({ player: { ...state.player, ...patch } })),
  setShopOpen: (b) => set({ shopOpen: b }),
  setPauseOpen: (b) => set({ pauseOpen: b }),
  setMatchTime: (s) => set({ matchTimeSeconds: s }),
  setHitFlash: (s) => set({ hitFlashSeconds: s }),
  recordShot: (hit) =>
    set((state) => ({
      match: {
        ...state.match,
        shots: state.match.shots + 1,
        hits: state.match.hits + (hit ? 1 : 0),
      },
    })),
  respawnPlayer: () => {
    const team = get().player.team;
    const spawn = MAP_DEFAULT.spawnPoints.find((s) => s.team === team)!;
    set({
      player: {
        ...get().player,
        position: { ...spawn.position, y: PHYSICS_CONFIG.playerHeight },
        velocity: { x: 0, y: 0, z: 0 },
        health: MATCH_CONFIG.agentBaseHealth,
        armor: 0,
        alive: true,
        respawnSeconds: 0,
      },
    });
  },
  resetForNewMatch: () => {
    set({
      match: { kills: 0, assists: 0, hits: 0, shots: 0 },
      matchTimeSeconds: 0,
      killFeed: [],
      players: {},
      targets: {},
    });
  },

  setNetworkStatus: (status, detail) =>
    set((state) => ({
      network: { ...state.network, status, detail },
    })),
  setNetworkEndpoint: (endpoint) =>
    set((state) => ({ network: { ...state.network, endpoint } })),
  setMyPlayerId: (id) => set({ myPlayerId: id }),
  setQueueState: (size, eta) => set({ queueSize: size, queueEtaSeconds: eta }),

  applyServerSnapshot: (snap) => {
    set((state) => {
      const me = state.myPlayerId;
      const mySnapshot = me ? snap.players[me] : undefined;
      const nextPlayer = mySnapshot ? toLocalPlayer(mySnapshot) : state.player;
      return {
        serverTick: snap.serverTick,
        matchTimeSeconds: snap.matchTimeSeconds,
        players: { ...snap.players },
        targets: { ...snap.targets },
        minions: { ...snap.minions },
        jungleMonsters: { ...snap.jungleMonsters },
        turrets: { ...snap.turrets },
        shopItems: [...snap.shop],
        killFeed: [...snap.killFeed].slice(-10),
        player: nextPlayer,
        matchPhase: snap.phase,
        matchWinner: snap.winner,
      };
    });
  },

  appendKillFeed: (entry) =>
    set((state) => ({
      killFeed: [entry, ...state.killFeed].slice(0, 10),
    })),

  clearMatchState: () => {
    set({
      players: {},
      targets: {},
      minions: {},
      jungleMonsters: {},
      turrets: {},
      shopItems: [],
      killFeed: [],
      matchTimeSeconds: 0,
      serverTick: 0,
      matchPhase: "playing",
      matchWinner: null,
      player: { ...INITIAL_PLAYER },
    });
  },
}));

/* ------------------------------------------------------------------ *
 * Pure helpers used in multiple components.                          *
 * ------------------------------------------------------------------ */

/** Distance from a position to a team's base shop zone. */
export function distanceToTeamShop(
  position: { x: number; z: number },
  team: TeamId
): number {
  const zone = MAP_DEFAULT.shopZones[team];
  const dx = position.x - zone.center.x;
  const dz = position.z - zone.center.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function canUseShop(position: { x: number; z: number }, team: TeamId) {
  return distanceToTeamShop(position, team) <= SHOP_CONFIG.baseShopRadius;
}

/** Format respawn seconds remaining using the schedule. */
export function respawnSecondsAtMatchTime(matchTimeSeconds: number): number {
  const matchMinute = matchTimeSeconds / 60;
  for (const tier of RESPAWN_CONFIG.tiers) {
    if (matchMinute <= tier.upToMinute) return tier.seconds;
  }
  return RESPAWN_CONFIG.tiers[RESPAWN_CONFIG.tiers.length - 1].seconds;
}

export function formatMMSS(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const STARTER_WEAPON = STARTER_WEAPON_ID;
