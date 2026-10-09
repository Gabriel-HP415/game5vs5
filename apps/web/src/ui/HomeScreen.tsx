import { useState } from "react";
import { useAppStore, type ClientSettings } from "../store";

/* ------------------------------------------------------------------ *
 * Home screen                                                         *
 * ------------------------------------------------------------------ *
 * Logo, project description, settings, and a primary "Play" action.   *
 * Vietnamese-language UI as required by the spec.                     *
 * ------------------------------------------------------------------ */

export function HomeScreen() {
  const setScreen = useAppStore((s) => s.setScreen);
  const displayName = useAppStore((s) => s.displayName);
  const setDisplayName = useAppStore((s) => s.setDisplayName);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const network = useAppStore((s) => s.network);
  const [nameDraft, setNameDraft] = useState(displayName);

  const onPlay = () => {
    if (nameDraft.trim()) setDisplayName(nameDraft.trim().slice(0, 20));
    setScreen("game");
  };

  return (
    <div className="home-screen">
      <div className="home-card">
        <div className="brand-block">
          <div className="brand-logo">
            <Logo />
          </div>
          <h2>RIFT FRONTLINE · PROTOTYPE v0.1</h2>
          <h1>RIFT FRONTLINE</h1>
          <p>
            Một game FPS-MOBA 5 đấu 5 chạy hoàn toàn trong trình duyệt. Ba đường,
            rừng, sông, mục tiêu lớn và căn cứ hai bên — tất cả được xây dựng theo
            phong cách chiến thuật, tốc độ và đọc trận đấu nhanh. Đây là phiên bản
            prototype <b>PHASE 1</b>: bản đồ graybox, di chuyển first-person, một
            khẩu súng cơ bản, và các mục tiêu thử nghiệm.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span
              className={
                "status-pill " +
                (network.status === "online" || network.status === "in-match"
                  ? ""
                  : network.status === "connecting"
                  ? "warn"
                  : "error")
              }
            >
              <span className="dot" />
              {statusLabel(network.status)} · {network.endpoint}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SettingsPanel settings={settings} update={updateSettings} />
          <div className="settings-card">
            <h3>Tên hiển thị</h3>
            <input
              type="text"
              value={nameDraft}
              maxLength={20}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Nhập tên của bạn"
            />
          </div>
          <button className="primary play-btn" onClick={onPlay}>
            ▶ Bắt đầu chơi
          </button>
          <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
            PHASE 1 — chỉ chế độ đơn cục bộ. Khi PHASE 7 hoàn tất, bạn có thể
            vào hàng chờ 5 đấu 5 trực tuyến.
          </div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: "offline" | "connecting" | "online" | "in-match" | "error") {
  switch (s) {
    case "online":
      return "Đã kết nối";
    case "in-match":
      return "Đang trong trận";
    case "connecting":
      return "Đang kết nối";
    case "offline":
      return "Chưa kết nối";
    case "error":
      return "Lỗi";
  }
}

function SettingsPanel({
  settings,
  update,
}: {
  settings: ClientSettings;
  update: (patch: Partial<ClientSettings>) => void;
}) {
  return (
    <div className="settings-card">
      <h3>Cài đặt</h3>
      <div className="setting-row">
        <label htmlFor="sens">Độ nhạy chuột</label>
        <input
          id="sens"
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={settings.mouseSensitivity}
          onChange={(e) => update({ mouseSensitivity: parseFloat(e.target.value) })}
        />
        <span className="mono">{settings.mouseSensitivity.toFixed(2)}</span>
      </div>
      <div className="setting-row">
        <label htmlFor="quality">Chất lượng đồ họa</label>
        <select
          id="quality"
          value={settings.graphicsQuality}
          onChange={(e) =>
            update({ graphicsQuality: e.target.value as ClientSettings["graphicsQuality"] })
          }
        >
          <option value="low">Thấp</option>
          <option value="medium">Trung bình</option>
          <option value="high">Cao</option>
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor="master">Âm lượng chính</label>
        <input
          id="master"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.masterVolume}
          onChange={(e) => update({ masterVolume: parseFloat(e.target.value) })}
        />
        <span className="mono">{Math.round(settings.masterVolume * 100)}%</span>
      </div>
      <div className="setting-row">
        <label htmlFor="music">Âm lượng nhạc nền</label>
        <input
          id="music"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.musicVolume}
          onChange={(e) => update({ musicVolume: parseFloat(e.target.value) })}
        />
        <span className="mono">{Math.round(settings.musicVolume * 100)}%</span>
      </div>
      <div className="setting-row">
        <label htmlFor="sfx">Âm lượng hiệu ứng</label>
        <input
          id="sfx"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.sfxVolume}
          onChange={(e) => update({ sfxVolume: parseFloat(e.target.value) })}
        />
        <span className="mono">{Math.round(settings.sfxVolume * 100)}%</span>
      </div>
      <div className="setting-row">
        <label htmlFor="fullscreen">Toàn màn hình</label>
        <input
          id="fullscreen"
          type="checkbox"
          checked={settings.fullscreen}
          onChange={(e) => {
            update({ fullscreen: e.target.checked });
            if (e.target.checked) {
              document.documentElement.requestFullscreen?.().catch(() => {
                /* ignore */
              });
            } else {
              document.exitFullscreen?.().catch(() => {
                /* ignore */
              });
            }
          }}
        />
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" fill="none">
      <path d="M6 24 L16 6 L26 24 Z" fill="#ffffff" />
      <circle cx="16" cy="18" r="3" fill="#0b1020" />
    </svg>
  );
}