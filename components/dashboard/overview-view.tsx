"use client";

import { clock, countdown, longDay, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { RestaurantTile, StatusTrack } from "@/components/dashboard/parts";
import type { Ask } from "@/components/dashboard/planner-pane";

/* Home → Overview: the next meal, what has to be ordered and when, and budget spent. */

export function OverviewView({ onOpenOrder, onAsk }: { onOpenOrder: (orderId: string) => void; onAsk: Ask }) {
  const { now, event, slots, orders, plan, restaurantById, orderForSlot, eatenIn } = useDashboard();
  const upcoming = slots.filter((s) => s.servesAt > now);
  const next = upcoming[0];
  const committed = orders.filter((o) => o.status !== "draft").reduce((sum, o) => sum + o.total.value, 0);
  const share = Math.min(100, Math.round((committed / event.budget) * 100));
  const deadlines = orders.filter((o) => o.status === "draft" || o.status === "approved").sort((a, b) => a.orderBy.localeCompare(b.orderBy));
  const nextPick = next ? plan.slots.find((p) => p.slotId === next.id) : undefined;
  const nextRestaurant = nextPick ? restaurantById(nextPick.restaurantId) : undefined;

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__title">
          <span className="dash-head__icon">
            <Icon name="home" />
          </span>
          <div>
            <h1>Overview</h1>
            <p className="dash-head__meta">
              {event.name} · {event.venue.name} · {event.headcount} people
            </p>
          </div>
        </div>
      </header>

      <div className="dash-body dash-body--flush">
        <div className="prep">
          <section>
            <h2 className="roles__heading">Next meal</h2>
            {next && nextRestaurant ? (
              <article className="card">
                <div className="card__head">
                  <RestaurantTile restaurant={nextRestaurant} />
                  <div className="card__titles">
                    <h3 className="card__role">{next.label}</h3>
                    <p className="card__company">
                      {nextRestaurant.name}
                      <span aria-hidden="true"> · </span>
                      {clock(next.servesAt)}, {countdown(next.servesAt, now)}
                    </p>
                  </div>
                  <span className="pill">
                    <Icon name="users" />
                    {next.headcount}
                  </span>
                </div>
                <div className="card__foot">
                  {orderForSlot(next.id) ? <StatusTrack status={orderForSlot(next.id)!.status} /> : <span className="card__meta">No order yet</span>}
                  <div className="card__actions">
                    <button type="button" className="btn btn--ghost" onClick={() => onAsk(`Is ${nextRestaurant.name} still the best pick for ${next.label.toLowerCase()}?`)}>
                      <Icon name="pizza" className="icon--brand" />
                      Ask the planner
                    </button>
                    {orderForSlot(next.id) && (
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpenOrder(orderForSlot(next.id)!.id)}>
                        Open order
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ) : (
              <p className="roles__empty">Every meal has been served. Nice work.</p>
            )}
          </section>

          <section>
            <h2 className="roles__heading">Order deadlines</h2>
            <ul className="upcoming">
              {deadlines.map((order) => {
                const slot = slots.find((s) => s.id === order.slotId)!;
                const restaurant = restaurantById(order.restaurantId);
                return (
                  <li key={order.id}>
                    <button type="button" className="upcoming__item" onClick={() => onOpenOrder(order.id)}>
                      <RestaurantTile restaurant={restaurant} />
                      <span className="upcoming__text">
                        <span className="upcoming__title">
                          Order by {clock(order.orderBy)} for {clock(slot.servesAt)} {slot.label.toLowerCase()}
                        </span>
                        <span className="upcoming__meta">
                          {restaurant.name} · {countdown(order.orderBy, now)}
                        </span>
                      </span>
                      <span className="upcoming__cta">
                        Build order
                        <Icon name="arrowRight" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="roles__heading">Budget</h2>
            <ul className="practice">
              <li className="practice__card">
                <span className="practice__icon">
                  <Icon name="wallet" />
                </span>
                <h3>
                  {money(committed)} of {money(event.budget)}
                </h3>
                <p>Committed across approved, ordered and delivered meals. {share}% of the budget.</p>
              </li>
              <li className="practice__card">
                <span className="practice__icon">
                  <Icon name="receipt" />
                </span>
                <h3>{money(plan.total.value)} planned</h3>
                <p>The full plan for all {slots.length} meals, estimated.</p>
              </li>
              <li className="practice__card">
                <span className="practice__icon">
                  <Icon name="users" />
                </span>
                <h3>{eatenIn(slots[0].id)} ate</h3>
                <p>
                  {slots[0].label} on {longDay(slots[0].servesAt)}, out of {slots[0].headcount}.
                </p>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
