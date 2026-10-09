/**
 * Shop overlay — appears when the local player is inside their team's
 * base shop radius. Items are defined server-side; this overlay simply
 * lists them and sends a `buy` request when clicked.
 */
import { useAppStore, canUseShop } from "../store";
import { network } from "../network";
import { useEffect, useState } from "react";

export function ShopOverlay() {
  const player = useAppStore((s) => s.player);
  const shopItems = useAppStore((s) => s.shopItems);
  const [hint, setHint] = useState<string | null>(null);

  const inShop = canUseShop(player.position, player.team);

  useEffect(() => {
    if (!inShop) setHint(null);
  }, [inShop]);

  if (!inShop) return null;

  const buy = (itemId: string) => {
    if (!network || !network.sendBuy) return;
    const before = player.credits;
    network.sendBuy(itemId);
    setHint(`Đã gửi yêu cầu mua ${itemId}`);
    setTimeout(() => setHint(null), 1500);
    void before;
  };

  return (
    <div className="hud shop-overlay">
      <div className="shop-card">
        <h3>CỬA HÀNG ĐỘI {player.team === "blue" ? "XANH" : "ĐỎ"}</h3>
        <div className="shop-balance">$ {player.credits}</div>
        <div className="shop-list">
          {shopItems.map((it) => (
            <button
              key={it.id}
              className="shop-item"
              onClick={() => buy(it.id)}
              disabled={player.credits < it.price}
            >
              <span className="shop-item-name">{it.displayName}</span>
              <span className="shop-item-price">$ {it.price}</span>
            </button>
          ))}
        </div>
        {hint ? <div className="shop-hint">{hint}</div> : null}
        <div className="shop-help muted">
          Mua vũ khí sẽ thay đổi vũ khí đang sử dụng; mua giáp sẽ cộng dồn áo giáp.
        </div>
      </div>
    </div>
  );
}
