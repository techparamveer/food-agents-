"use client";

import { useEffect, useState } from "react";
import { Countdown } from "@/components/dashboard/clock";
import { clock, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue } from "@/components/dashboard/parts";
import { linesText } from "@/components/dashboard/planner-pane";
import { usePlanner } from "@/components/dashboard/planner-state";
import { deadlineLine } from "@/lib/countdown";
import { costOrder } from "@/lib/planner";
import { DIETARY, ORDER_STATUSES, type DeliveryPlatform, type Order } from "@/lib/types";

/* Apply pane → Order builder: quantities by dietary need, the delivery options, and a link out
   to place the order. Comeda never orders itself; the organiser marks the status by hand. */

const lineLabel = (dietary: Order["lines"][number]["dietary"]) =>
  dietary === "standard" ? "Standard" : DIETARY.find((d) => d.id === dietary)!.label;

const PLATFORM: Record<DeliveryPlatform, string> = {
  deliveroo: "Deliveroo",
  ubereats: "Uber Eats",
  justeat: "Just Eat",
  direct: "Direct from the restaurant",
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function OrderBuilderPane({ order, onBack }: { order: Order; onBack: () => void }) {
  const { now, event, restaurantById, slotById } = useDashboard();
  const { setLines, setPlatform, setStatus } = usePlanner();
  const [copied, setCopied] = useState(false);
  const restaurant = restaurantById(order.restaurantId);
  const slot = slotById(order.slotId);
  const meals = order.lines.reduce((n, l) => n + l.quantity, 0);
  const cost = slot ? costOrder(slot, restaurant, meals, order.platform) : undefined;
  const delivery = cost?.delivery ?? restaurant.delivery[0];
  const link = delivery?.url ?? restaurant.websiteUrl;
  const host = link ? hostOf(link) : "";
  const meal = slot ? (slot.kind === "snack" ? "snack" : slot.kind) : "meal";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const summary = [
    `${meals} meals from ${restaurant.name} for ${slot?.label ?? "the event"}`,
    `${linesText(order.lines)}`,
    `Deliver to ${event.venue.name}, ${event.venue.address}, ${event.venue.postcode} by ${slot ? clock(slot.servesAt) : "serving time"}`,
  ].join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

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
        {link && (
          <a className="apply__host" href={link} target="_blank" rel="noreferrer">
            {host}
          </a>
        )}
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
                {slot ? `${deadlineLine(order.orderBy, slot.servesAt, meal)}. ` : ""}
                Comeda never places orders: copy the quantities, order on {host || "the restaurant's site"}, then mark it ordered here.
              </p>
              <div className="apply__sheet-actions">
                {order.status === "planned" && <Countdown base={now} deadline={order.orderBy} prefix="Order in " />}
                {link && (
                  <a className="btn btn--primary" href={link} target="_blank" rel="noreferrer">
                    Order on {host}
                    <Icon name="external" />
                  </a>
                )}
                <button type="button" className="btn btn--outline" onClick={() => void copy()}>
                  <Icon name={copied ? "check" : "copy"} />
                  {copied ? "Copied" : "Copy order"}
                </button>
              </div>
            </header>

            <section className="builder__section">
              <p className="apply__fill-label">Status</p>
              <div className="seg" role="group" aria-label="Order status">
                {ORDER_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={order.status === s.id ? "seg__btn is-active" : "seg__btn"}
                    aria-pressed={order.status === s.id}
                    onClick={() => setStatus(order.id, s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="builder__section">
              <p className="apply__fill-label">Quantities by dietary need</p>
              <ul className="apply__sheet-fields builder__lines">
                {order.lines.map((line, i) => (
                  <li key={line.dietary}>
                    <label>
                      <span className="apply__fill-label">{lineLabel(line.dietary)}</span>
                      <input
                        className="enq__input"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines(
                            order.id,
                            order.lines.map((l, j) => (j === i ? { ...l, quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) } : l)),
                          )
                        }
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            {restaurant.delivery.length > 0 && (
              <section className="builder__section">
                <p className="apply__fill-label">How it gets there</p>
                <ul className="upcoming">
                  {restaurant.delivery.map((d) => (
                    <li key={d.platform}>
                      <button
                        type="button"
                        className={d.platform === order.platform ? "upcoming__item is-active" : "upcoming__item"}
                        aria-pressed={d.platform === order.platform}
                        onClick={() => setPlatform(order.id, d.platform)}
                      >
                        <span className="practice__icon">
                          <Icon name="truck" />
                        </span>
                        <span className="upcoming__text">
                          <span className="upcoming__title">{PLATFORM[d.platform]}</span>
                          <span className="upcoming__meta">
                            <EstimateValue estimate={d.fee} format={money} /> fee · <EstimateValue estimate={d.eta} format={(n) => `${n} min`} /> to the door
                          </span>
                        </span>
                        {d.platform === order.platform && (
                          <span className="pill pill--brand">
                            <Icon name="check" />
                            Using
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {cost && (
              <section className="builder__section">
                <p className="apply__fill-label">Estimated total</p>
                <p className="builder__total">
                  <EstimateValue estimate={order.total} format={money} />
                </p>
                <p className="apply__dock-note">
                  {money(cost.food)} food at about {money(restaurant.costPerHead.value)} a head
                  {slot && slot.kind !== "lunch" && slot.kind !== "dinner" ? ` (a lighter ${meal} portion)` : ""}, plus {money(cost.fee)} delivery.
                  All figures are estimates from {restaurant.costPerHead.source.label}.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
