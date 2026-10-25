"use client";

import { useEffect, useRef, useState } from "react";
import { Countdown, useLiveNow } from "@/components/dashboard/clock";
import { clock, dayKey, longDay, money, useDashboard } from "@/components/dashboard/data";
import { FoodFeedback } from "@/components/dashboard/food-feedback";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue, EtaBreakdown, RestaurantTile, StatusTrack } from "@/components/dashboard/parts";
import { linesText, type Ask } from "@/components/dashboard/planner-pane";
import { usePlanner } from "@/components/dashboard/planner-state";
import { deadlineLine } from "@/lib/countdown";
import { budgetSummary, isPlaced } from "@/lib/plan-sync";
import { costSlot } from "@/lib/planner";
import { ORDER_STATUSES, type MealSlot, type Order, type OrderStatus } from "@/lib/types";

/* Applications → Orders: one bulk order per meal slot, grouped by day, with a live deadline.
   Status is set by hand: Comeda never places or tracks orders itself. */

type Tab = "open" | "placed" | "arrived";

const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "To order" },
  { id: "placed", label: "On the way" },
  { id: "arrived", label: "Arrived" },
];

const tabFor = (order?: Order): Tab =>
  !order || order.status === "planned" ? "open" : order.status === "arrived" ? "arrived" : "placed";

const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  planned: { status: "ordered", label: "Mark ordered" },
  ordered: { status: "out_for_delivery", label: "Out for delivery" },
  out_for_delivery: { status: "arrived", label: "Mark arrived" },
};

export function OrdersView({ onOpenOrder, onAsk }: { onOpenOrder: (orderId: string) => void; onAsk: Ask }) {
  const data = useDashboard();
  const { slots, orders, event, orderForSlot } = data;
  const [tab, setTab] = useState<Tab>("open");
  const shown = slots.filter((s) => tabFor(orderForSlot(s.id)) === tab);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, slots.filter((s) => tabFor(orderForSlot(s.id)) === t.id).length])) as Record<Tab, number>;
  const byDay = new Map<string, MealSlot[]>();
  for (const slot of shown) byDay.set(dayKey(slot.servesAt), [...(byDay.get(dayKey(slot.servesAt)) ?? []), slot]);
  const budget = budgetSummary(data);

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
              {orders.filter((o) => isPlaced(o.status)).length} of {slots.length} placed · {money(Math.round(budget.planned))} planned of{" "}
              {money(event.budget)} · Comeda never places orders for you
            </p>
          </div>
        </div>
      </header>

      <div className="dash-toolbar">
        <div className="dash-tabs" role="tablist" aria-label="Orders">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="dash-tabpanel"
              className={tab === t.id ? "dash-tab is-active" : "dash-tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="dash-tab__count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <p className="dash-toolbar__note">Order by = serving time − prep − delivery</p>
      </div>

      <div className="dash-body" id="dash-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div className="dash-column">
          {[...byDay.entries()].map(([day, items]) => (
            <section key={day} className="day">
              <h2 className="day__heading">
                <span className="day__date">{longDay(items[0].servesAt)}</span>
              </h2>
              <ol className="day__list">
                {items.map((slot) => (
                  <li key={slot.id}>
                    <OrderItem slot={slot} onOpenOrder={onOpenOrder} onAsk={onAsk} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {shown.length === 0 && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="pizza" className="icon--brand" />
              </span>
              <p>
                {tab === "open"
                  ? "Every meal is ordered."
                  : tab === "placed"
                    ? "Orders you mark as placed show up here until they arrive."
                    : "Nothing has arrived yet."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function OrderItem({ slot, onOpenOrder, onAsk }: { slot: MealSlot; onOpenOrder: (orderId: string) => void; onAsk: Ask }) {
  const { now, plan, restaurantById, orderForSlot } = useDashboard();
  const { setStatus } = usePlanner();
  const liveNow = useLiveNow(now);
  const order = orderForSlot(slot.id);
  const pick = plan.slots.find((p) => p.slotId === slot.id);
  const restaurant = restaurantById(order?.restaurantId ?? pick?.restaurantId ?? "");
  const next = order ? NEXT[order.status] : undefined;
  const late = order?.status === "planned" && Date.parse(order.orderBy) < liveNow;
  const label = ORDER_STATUSES.find((s) => s.id === order?.status)?.label;

  return (
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
          {!order ? (
            <span className="pill pill--muted">No order yet</span>
          ) : order.status === "planned" ? (
            <Countdown base={now} deadline={order.orderBy} prefix={late ? "" : "Order in "} />
          ) : order.status === "arrived" ? (
            <span className="pill pill--brand">
              <Icon name="check" />
              Arrived
            </span>
          ) : (
            <span className="pill">
              <Icon name="truck" />
              {label}
            </span>
          )}
        </div>
        <div className="card__body">
          <p className="card__task">
            {order ? (
              <>
                <EstimateValue estimate={order.total} format={money} /> · {linesText(order.lines)}
              </>
            ) : (
              "No order yet"
            )}
          </p>
          <p className="card__detail">
            {order ? `${deadlineLine(order.orderBy, slot.servesAt, slot.kind === "snack" ? "snack" : slot.kind)}.` : "Run Get it done in the planner to cost this meal."}
            {pick?.reason ? ` ${pick.reason}` : ""}
          </p>
          {order && <EtaBreakdown restaurant={restaurant} platform={order.platform} />}
          {order?.status === "arrived" && <FoodFeedback slotId={slot.id} />}
        </div>
        <div className="card__foot">
          {order ? <StatusTrack status={order.status} /> : <span className="card__meta">Not planned</span>}
          <div className="card__actions">
            {order?.status === "planned" ? (
              <SwapMenu slot={slot} current={restaurant.id} />
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => onAsk(`Is ${restaurant.name} still right for ${slot.label}?`)}>
                <Icon name="pizza" className="icon--brand" />
                Ask
              </button>
            )}
            {order && (
              <button type="button" className="btn btn--icon" aria-label="Build order" title="Build order" onClick={() => onOpenOrder(order.id)}>
                <Icon name="pen" />
              </button>
            )}
            {order && next && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => (order.status === "planned" ? onOpenOrder(order.id) : setStatus(order.id, next.status))}
              >
                {order.status === "planned" ? "Build order" : next.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Pick another restaurant for a planned slot, cheapest first. */
function SwapMenu({ slot, current }: { slot: MealSlot; current: string }) {
  const { restaurants } = useDashboard();
  const { swap } = usePlanner();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = restaurants
    .filter((r) => r.id !== current)
    .map((r) => ({ r, cost: costSlot(slot, r).cost }))
    .sort((a, b) => a.cost - b.cost || a.r.id.localeCompare(b.r.id));

  return (
    <div className="filter" ref={rootRef}>
      <button type="button" className="btn btn--ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="swap" />
        Swap
      </button>
      {open && (
        <div className="filter__menu swap-menu" role="menu" aria-label={`Swap ${slot.label}`}>
          {options.map(({ r, cost }) => (
            <button
              key={r.id}
              type="button"
              role="menuitem"
              className="filter__option"
              onClick={() => {
                swap(slot.id, r.id);
                setOpen(false);
              }}
            >
              <RestaurantTile restaurant={r} size="sm" />
              <span>
                {r.name}
                <span className="side__muted"> · {money(Math.round(cost))}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
