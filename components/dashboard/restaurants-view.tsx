"use client";

import { useMemo, useState } from "react";
import { money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue, FilterMenu, RestaurantTile } from "@/components/dashboard/parts";
import type { Ask } from "@/components/dashboard/planner-pane";
import { DIETARY, type Dietary, type Restaurant } from "@/lib/types";

/* Roles → Restaurants: nearby places ranked by estimated cost per head, with ETA and rating.
   Seeded today; the restaurants thread swaps in Places results behind the same Restaurant type. */

const minutes = (n: number) => `${n} min`;
const eta = (r: Restaurant) => r.prepMinutes.value + r.travelMinutes.value;

export function RestaurantsView({ onAsk }: { onAsk: Ask }) {
  const { restaurants, event } = useDashboard();
  const [query, setQuery] = useState("");
  const [needs, setNeeds] = useState<Dietary[]>([]);
  const q = query.trim().toLowerCase();

  const ranked = useMemo(
    () =>
      restaurants
        .filter((r) => needs.every((n) => r.serves.includes(n)))
        .filter((r) => !q || `${r.name} ${r.cuisine} ${r.address}`.toLowerCase().includes(q))
        .sort((a, b) => a.costPerHead.value - b.costPerHead.value),
    [restaurants, needs, q],
  );

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__title">
          <span className="dash-head__icon">
            <Icon name="store" />
          </span>
          <div>
            <h1>Restaurants</h1>
            <p className="dash-head__meta">Near {event.venue.name}, cheapest per head first</p>
          </div>
        </div>
      </header>

      <div className="roles-bar">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search restaurants, cuisines or streets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="dash-filters">
          {(q || needs.length > 0) && (
            <button
              type="button"
              className="filter__reset"
              onClick={() => {
                setQuery("");
                setNeeds([]);
              }}
            >
              Clear
            </button>
          )}
          <FilterMenu
            label="Dietary"
            icon="leaf"
            options={DIETARY.map((d) => ({ value: d.id, label: d.label }))}
            selected={needs}
            onChange={setNeeds}
          />
        </div>
      </div>

      <div className="dash-body">
        <div className="roles">
          <section>
            <h2 className="roles__heading">
              Restaurants
              <span className="dash-tab__count">{ranked.length}</span>
            </h2>
            {ranked.length === 0 ? (
              <p className="roles__empty">No restaurants match. Try clearing a filter.</p>
            ) : (
              <ul className="role-rows">
                {ranked.map((r) => (
                  <li key={r.id} className="role-row">
                    <button
                      type="button"
                      className="role-row__main"
                      onClick={() => onAsk(`Could ${r.name} feed ${event.headcount} people? What would it cost?`)}
                    >
                      <RestaurantTile restaurant={r} />
                      <span className="role-row__text">
                        <span className="role-row__title">{r.name}</span>
                        <span className="role-row__company">
                          {r.cuisine} · {r.address} · {r.distanceKm} km
                        </span>
                        <span className="role-row__summary">
                          Serves {r.serves.map((d) => DIETARY.find((x) => x.id === d)!.label.toLowerCase()).join(", ")}
                        </span>
                      </span>
                      <span className="role-row__meta">
                        <span className="role-row__salary">
                          <EstimateValue estimate={r.costPerHead} format={money} /> a head
                        </span>
                        <span className="role-row__chips">
                          <span className="pill pill--muted">
                            ETA {minutes(eta(r))} est.
                          </span>
                          {r.rating !== undefined && (
                            <span className="pill pill--muted">
                              <Icon name="star" />
                              {r.rating}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="roles__source">
            Costs, ETAs and fees are estimates. ETA is prep time plus travel time from distance. Seeded restaurants are
            fictional until live Google Places results load.
          </p>
        </div>
      </div>
    </>
  );
}
