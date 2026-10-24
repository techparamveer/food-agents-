"use client";

import { useEffect, useState } from "react";
import { clock, countdown, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { DIETARY, type Order } from "@/lib/types";

/* Apply pane → Order builder: quantities by dietary need, then a link out to place the order.
   Comeda never orders itself. */

const lineLabel = (dietary: Order["lines"][number]["dietary"]) =>
  dietary === "standard" ? "Standard" : DIETARY.find((d) => d.id === dietary)!.label;

export function OrderBuilderPane({ order, onBack }: { order: Order; onBack: () => void }) {
  const { now, restaurantById, slotById } = useDashboard();
  const restaurant = restaurantById(order.restaurantId);
  const slot = slotById(order.slotId);
  const delivery = restaurant.delivery.find((d) => d.platform === order.platform) ?? restaurant.delivery[0];
  const [quantities, setQuantities] = useState(() => order.lines.map((l) => l.quantity));
  const meals = quantities.reduce((n, q) => n + q, 0);
  const total = meals * restaurant.costPerHead.value + (delivery?.fee.value ?? 0);
  const host = delivery ? new URL(delivery.url).hostname.replace(/^www\./, "") : "";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="apply">
      <nav className="crumbs apply__bar" aria-label="Order">
        <button type="button" className="crumbs__link" onClick={onBack}>
          Back
        </button>
        <Icon name="chevronRight" className="crumbs__sep" />
        <span className="crumbs__employer">{restaurant.name}</span>
        <Icon name="chevronRight" className="crumbs__sep" />
        <span className="crumbs__current">{slot?.label ?? "Order"}</span>
      </nav>
      <div className="apply__stage">
        <div className="apply__viewport">
          <div className="apply__sheet">
            <header className="apply__sheet-head">
              <p className="apply__dock-kicker">Order builder</p>
              <h2>
                {slot?.label} · {meals} meals
              </h2>
              <p className="apply__dock-note">
                Order by {clock(order.orderBy)} ({countdown(order.orderBy, now)}) so it arrives for{" "}
                {slot ? clock(slot.servesAt) : "serving"}. Estimated total {money(total)}, including{" "}
                {money(delivery?.fee.value ?? 0)} delivery. Place the order on the restaurant&apos;s site.
              </p>
              {delivery && (
                <div className="apply__sheet-actions">
                  <a className="btn btn--primary" href={delivery.url} target="_blank" rel="noreferrer">
                    Open {host}
                    <Icon name="external" />
                  </a>
                </div>
              )}
            </header>
            <ul className="apply__sheet-fields">
              {order.lines.map((line, i) => (
                <li key={line.dietary}>
                  <label>
                    <span className="apply__fill-label">{lineLabel(line.dietary)}</span>
                    <input
                      className="enq__input"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={quantities[i]}
                      onChange={(e) =>
                        setQuantities((all) => all.map((q, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : q)))
                      }
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
