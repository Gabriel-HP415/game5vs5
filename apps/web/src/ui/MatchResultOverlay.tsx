/**
 * Victory / defeat overlay.
 *
 * Renders a centered card once the server has broadcast `match.ended`
 * (or the latest snapshot says `phase: "ended"`). Lets the user
 * return to the home screen.
 */
import { useAppStore } from "../store";

export function MatchResultOverlay() {
  const phase = useAppStore((s) => s.matchPhase);
  const winner = useAppStore((s) => s.matchWinner);
  const me = useAppStore((s) => s.player);

  if (phase !== "ended") return null;
  const won = winner === me.team;

  return (
    <div className="hud match-result">
      <div className={"result-card " + (won ? "win" : "lose")}>
        <h2>{won ? "CHIẾN THẮNG" : "THẤT BẠI"}</h2>
        <p className="muted">Đội {winner === "blue" ? "Xanh" : "Đỏ"} đã phá hủy Nexus đối phương.</p>
        <button
          className="primary"
          onClick={() => {
            useAppStore.getState().setScreen("home");
            useAppStore.getState().clearMatchState();
          }}
        >
          Trở về sảnh
        </button>
      </div>
    </div>
  );
}
