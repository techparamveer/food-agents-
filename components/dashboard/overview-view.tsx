"use client";

import { Countdown, useLiveNow } from "@/components/dashboard/clock";
import { clock, longDay, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { PhotoCredit, RestaurantTile, StatusTrack } from "@/components/dashboard/parts";
import type { Ask } from "@/components/dashboard/planner-pane";
import { usePlanner } from "@/components/dashboard/planner-state";
import { budgetSummary, isPlaced } from "@/lib/plan-sync";

/* Home → Overview: the next meal, the nearest order deadlines, and budget spent vs total. */

const DEADLINES_SHOWN = 3;

export function OverviewView({ onOpenOrder, onAsk }: { onOpenOrder: (orderId: string) => void; onAsk: Ask }) {
  const data = useDashboard();
  const { now, event, slots, orders, plan, restaurantById, orderForSlot, eatenIn } = data;
  const { mealPlan, form, run } = usePlanner();
  const liveNow = useLiveNow(now);
  const next = slots.find((s) => Date.parse(s.servesAt) > liveNow);
  const nextOrder = next ? orderForSlot(next.id) : undefined;
  const nextRestaurant = next ? restaurantById(nextOrder?.restaurantId ?? plan.slots.find((p) => p.slotId === next.id)?.restaurantId ?? "") : undefined;
  const deadlines = orders.filter((o) => !isPlaced(o.status)).sort((a, b) => a.orderBy.localeCompare(b.orderBy));
  const budget = budgetSummary(data);
  const lastServed = [...slots].reverse().find((s) => Date.parse(s.servesAt) <= liveNow) ?? slots[0];

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
          <button type="button" className="guide-banner" onClick={() => run(form)}>
            <Icon name="pizza" className="icon--brand" />
            <span>
              <strong>{mealPlan ? "Plan again" : "Get it done"}</strong>
              {mealPlan
                ? `${mealPlan.slots.length} meals, ${money(Math.round(mealPlan.total))} est. of ${money(mealPlan.budget)}. Approve or swap each one in the planner.`
                : `Plan every meal for ${form.headcount} people under ${money(form.budget)}, split by dietary need.`}
            </span>
            <Icon name="arrowRight" />
          </button>

          <section>
            <h2 className="roles__heading">Next meal</h2>
            {next && nextRestaurant ? (
              <article className="card">
                <div className="card__head card__head--meal">
                  <RestaurantTile restaurant={nextRestaurant} size="hero" preferPhoto />
                  <div className="card__titles">
                    <h3 className="card__role">{next.label}</h3>
                    <p className="card__company">
                      {nextRestaurant.name}
                      <span aria-hidden="true"> · </span>
                      serves {clock(next.servesAt)} · {next.headcount} people
                    </p>
                    <PhotoCredit restaurant={nextRestaurant} preferPhoto />
                  </div>
                  <Countdown base={now} deadline={next.servesAt} prefix="Serves in " />
                </div>
                <div className="card__foot">
                  {nextOrder ? <StatusTrack status={nextOrder.status} /> : <span className="card__meta">No order yet</span>}
                  <div className="card__actions">
                    <button type="button" className="btn btn--ghost" onClick={() => onAsk(`Is ${nextRestaurant.name} still the best pick for ${next.label}?`)}>
                      <Icon name="pizza" className="icon--brand" />
                      Ask the planner
                    </button>
                    {nextOrder && (
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => onOpenOrder(nextOrder.id)}>
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
            {deadlines.length === 0 && <p className="roles__empty">Nothing left to order.</p>}
            <ul className="upcoming">
              {deadlines.slice(0, DEADLINES_SHOWN).map((order) => {
                const slot = slots.find((s) => s.id === order.slotId);
                const restaurant = restaurantById(order.restaurantId);
                if (!slot) return null;
                return (
                  <li key={order.id}>
                    <button type="button" className="upcoming__item" onClick={() => onOpenOrder(order.id)}>
                      <RestaurantTile restaurant={restaurant} />
                      <span className="upcoming__text">
                        <span className="upcoming__title">
                          {slot.label}: order by {clock(order.orderBy)}
                        </span>
                        <span className="upcoming__meta">
                          {restaurant.name} · serves {clock(slot.servesAt)} · {money(Math.round(order.total.value))} est.
                        </span>
                      </span>
                      <Countdown base={now} deadline={order.orderBy} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="roles__heading">Budget</h2>
            <div className="meter" role="img" aria-label={`${budget.spentShare}% spent, ${budget.plannedShare}% planned`}>
              <span className="meter__planned" style={{ width: `${budget.plannedShare}%` }} />
              <span className="meter__spent" style={{ width: `${budget.spentShare}%` }} />
            </div>
            <ul className="practice">
              <li className="practice__card">
                <span className="practice__icon">
                  <Icon name="wallet" />
                </span>
                <h3>
                  {money(Math.round(budget.spent))} of {money(budget.budget)}
                </h3>
                <p>Spent on orders you&apos;ve placed. {budget.spentShare}% of the budget.</p>
              </li>
              <li className="practice__card">
                <span className="practice__icon">
                  <Icon name="receipt" />
                </span>
                <h3>{money(Math.round(budget.planned))} planned</h3>
                <p>
                  All {orders.length} meal orders, estimated.{" "}
                  {budget.left >= 0 ? `${money(Math.round(budget.left))} left.` : `${money(Math.round(-budget.left))} over budget.`}
                </p>
              </li>
              {lastServed && (
                <li className="practice__card">
                  <span className="practice__icon">
                    <Icon name="users" />
                  </span>
                  <h3>{eatenIn(lastServed.id)} ate</h3>
                  <p>
                    {lastServed.label} on {longDay(lastServed.servesAt)}, out of {lastServed.headcount}.
                  </p>
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
