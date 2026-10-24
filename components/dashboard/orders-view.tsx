"use client";

import { useState } from "react";
import { clock, countdown, dayKey, longDay, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue, RestaurantTile, StatusTrack } from "@/components/dashboard/parts";
import type { Ask } from "@/components/dashboard/planner-pane";
import type { MealSlot } from "@/lib/types";

/* Applications → Orders: one bulk order per meal slot, grouped by day, with its deadline. */

type Tab = "open" | "done";

export function OrdersView({ onOpenOrder, onAsk }: { onOpenOrder: (orderId: string) => void; onAsk: Ask }) {
  const { now, slots, orders, plan, restaurantById, orderForSlot } = useDashboard();
  const [tab, setTab] = useState<Tab>("open");
  const isDone = (slot: MealSlot) => {
    const order = orderForSlot(slot.id);
    return order?.status === "ordered" || order?.status === "delivered";
  };
  const shown = slots.filter((s) => (tab === "done" ? isDone(s) : !isDone(s)));
  const counts: Record<Tab, number> = {
    open: slots.filter((s) => !isDone(s)).length,
    done: slots.filter(isDone).length,
  };
  const byDay = new Map<string, MealSlot[]>();
  for (const slot of shown) byDay.set(dayKey(slot.servesAt), [...(byDay.get(dayKey(slot.servesAt)) ?? []), slot]);

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__title">
          <span className="dash-head__icon">
            <Icon name="receipt" />
          </span>
          <div>
            <h1>Orders</h1>
            <p className="dash-head__meta">
              {orders.length} of {slots.length} meals have an order · Comeda never places orders for you
            </p>
          </div>
        </div>
      </header>

      <div className="dash-toolbar">
        <div className="dash-tabs" role="tablist" aria-label="Orders">
          {(["open", "done"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "dash-tab is-active" : "dash-tab"}
              onClick={() => setTab(id)}
            >
              {id === "open" ? "To order" : "Ordered"}
              <span className="dash-tab__count">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="dash-body">
        <div className="dash-column">
          {[...byDay.entries()].map(([day, items]) => (
            <section key={day} className="day">
              <h2 className="day__heading">
                <span className="day__date">{longDay(items[0].servesAt)}</span>
              </h2>
              <ol className="day__list">
                {items.map((slot) => {
                  const order = orderForSlot(slot.id);
                  const pick = plan.slots.find((p) => p.slotId === slot.id);
                  const restaurant = restaurantById(order?.restaurantId ?? pick?.restaurantId ?? "");
                  const urgent = order && order.status !== "ordered" && order.status !== "delivered" && Date.parse(order.orderBy) - Date.parse(now) < 2 * 3_600_000;
                  return (
                    <li key={slot.id}>
                      <article className="q-item">
                        <div className="q-item__time">
                          <span className="q-item__clock">{clock(slot.servesAt)}</span>
                          <span className="q-item__kind">Serve</span>
                        </div>
                        <div className="card">
                          <div className="card__head">
                            <RestaurantTile restaurant={restaurant} />
                            <div className="card__titles">
                              <h3 className="card__role">{slot.label}</h3>
                              <p className="card__company">
                                {restaurant.name}
                                <span aria-hidden="true"> · </span>
                                {slot.headcount} people
                              </p>
                            </div>
                            {order ? (
                              <span className={urgent ? "pill pill--urgent" : "pill"}>
                                <Icon name="clock" />
                                Order by {clock(order.orderBy)}
                              </span>
                            ) : (
                              <span className="pill pill--muted">Planned</span>
                            )}
                          </div>
                          <div className="card__body">
                            <p className="card__task">
                              {order ? <EstimateValue estimate={order.total} format={money} /> : "No order yet"}
                            </p>
                            <p className="card__detail">
                              {order
                                ? `Order ${countdown(order.orderBy, now)} for ${clock(slot.servesAt)} ${slot.label.toLowerCase()}.`
                                : "The planner has a restaurant in mind. Build the order when you're ready."}
                            </p>
                          </div>
                          <div className="card__foot">
                            {order ? <StatusTrack status={order.status} /> : <span className="card__meta">Not started</span>}
                            <div className="card__actions">
                              <button type="button" className="btn btn--ghost" onClick={() => onAsk(`Swap the restaurant for ${slot.label.toLowerCase()}?`)}>
                                <Icon name="pizza" className="icon--brand" />
                                Swap
                              </button>
                              {order && (
                                <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpenOrder(order.id)}>
                                  Build order
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {shown.length === 0 && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="pizza" className="icon--brand" />
              </span>
              <p>{tab === "done" ? "Orders you place will show up here." : "Every meal is ordered."}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
