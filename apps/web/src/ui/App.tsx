import { useEffect } from "react";
import { useAppStore } from "../store";
import { HomeScreen } from "./HomeScreen";
import { GameCanvas } from "../game/GameCanvas";
import { GameHud } from "./GameHud";
import { network } from "../network";

/* ------------------------------------------------------------------ *
 * Top-level app                                                       *
 * ------------------------------------------------------------------ *
 * Routes between the home screen and the in-game canvas. The match   *
 * timer ticks while the game screen is active.                        *
 * ------------------------------------------------------------------ */

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const setMatchTime = useAppStore((s) => s.setMatchTime);
  const matchTime = useAppStore((s) => s.matchTimeSeconds);

  // Match timer (client-side; server is authoritative but the local
  // counter runs for HUD display).
  useEffect(() => {
    if (screen !== "game") return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = useAppStore.getState().matchTimeSeconds + dt;
      setMatchTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, setMatchTime]);

  // When the user enters the game screen, connect to the lobby and request
  // matchmaking. Disconnect on leaving.
  useEffect(() => {
    if (screen !== "game") return;
    const settings = useAppStore.getState().settings;
    const name = useAppStore.getState().displayName;
    network
      .connect(name, settings)
      .then(() => {
        network.requestQueue();
      })
      .catch(() => {
        // Network error is reflected in the store; HUD will show it.
      });
    return () => {
      network.disconnect();
    };
  }, [screen]);

  return (
    <div className="app-root">
      {screen === "home" ? <HomeScreen /> : null}
      {screen === "game" ? (
        <>
          <GameCanvas />
          <GameHud />
        </>
      ) : null}
      {/* suppress unused var */}
      <span style={{ display: "none" }}>{matchTime}</span>
    </div>
  );
}
