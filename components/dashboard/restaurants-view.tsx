"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clock, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue, FilterMenu, PhotoCredit, RestaurantTile } from "@/components/dashboard/parts";
import type { Ask } from "@/components/dashboard/planner-pane";
import { GEMINI_UNGROUNDED_LABEL, platformLabel } from "@/lib/restaurants/estimate-parse";
import type { FindRestaurantsResult } from "@/lib/restaurants/find-core";
import { filterRestaurants, sortRestaurants, type SortKey } from "@/lib/restaurants/rank";
import type { EtaRange, RankedRestaurant } from "@/lib/restaurants/types";
import { DIETARY, type Dietary, type Estimate, type MealSlot, type Restaurant } from "@/lib/types";

/* Roles → Restaurants: Places results near the venue, ranked by estimated cost per head, ETA
   and rating. Every number that isn't a Places fact carries an "est." link to its source. */

const SORTS: { id: SortKey; label: string }[] = [
  { id: "best", label: "Best overall" },
  { id: "cost", label: "Cheapest" },
  { id: "eta", label: "Fastest" },
  { id: "rating", label: "Top rated" },
];

const MAX_PER_HEAD = ["any", "6", "8", "10", "12", "15"] as const;
type MaxPerHead = (typeof MAX_PER_HEAD)[number];

const minutes = (n: number) => `${Math.round(n)} min`;
const km = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} km`;
const servesLabel = (serves: Dietary[]) =>
  serves.length ? `Serves ${serves.map((d) => DIETARY.find((x) => x.id === d)!.label.toLowerCase()).join(", ")}` : "Dietary options unknown";
const priceLabel = (level?: number) => (level ? "£".repeat(level) : "—");

function EtaWindow({ range, offset = 0 }: { range: EtaRange; offset?: number }) {
  return (
    <span className="eta-window">
      Shortest {minutes(range.shortestMinutes + offset)} · Longest {minutes(range.longestMinutes + offset)} to Andrew Wiles Building
    </span>
  );
}

/** For inside buttons, where a link can't go: the source link sits beside the row instead. */
function EstText({ estimate, format }: { estimate: Estimate; format: (n: number) => string }) {
  return (
    <span title={`Estimate · ${estimate.source.label}`}>
      {format(estimate.value)}
      <span className="estimate"> est.</span>
    </span>
  );
}

/** Single-choice twin of Sprout's FilterMenu (same markup and classes, radio instead of checkbox). */
function ChoiceMenu<T extends string>({
  label,
  icon,
  options,
  value,
  active,
  onChange,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  options: { value: T; label: string }[];
  value: T;
  active: boolean;
  onChange: (next: T) => void;
}) {
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

  return (
    <div className="filter" ref={rootRef}>
      <button
        type="button"
        className={active ? "filter__trigger is-active" : "filter__trigger"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} />
        {label}
        <Icon name="chevronDown" className="filter__chevron" />
      </button>
      {open && (
        <div className="filter__menu" role="radiogroup" aria-label={label}>
          {options.map((option) => (
            <label key={option.value} className="filter__option">
              <input
                type="radio"
                checked={value === option.value}
                onChange={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              />
              <span className="filter__box" aria-hidden="true">
                <Icon name="check" />
              </span>
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function nextSlot(slots: MealSlot[], now: string) {
  return slots.find((s) => Date.parse(s.servesAt) > Date.parse(now)) ?? slots[0];
}

export function RestaurantsView({ onAsk }: { onAsk: Ask }) {
  const { slots, now, event, update } = useDashboard();
  const [slotId, setSlotId] = useState(() => nextSlot(slots, now)?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; result: FindRestaurantsResult } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);

  const slot = slots.find((s) => s.id === slotId) ?? slots[0]!;
  const key = `${slot.servesAt}|${slot.headcount}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams({ slot: slot.servesAt, headcount: String(slot.headcount), open: "0" });
    fetch(`/api/restaurants?${params}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((result: FindRestaurantsResult) => {
        setLoadError(null);
        setLoaded({ key, result });
        // Make live restaurants resolvable by id for the planner and order builder.
        update((d) => {
          const fresh = new Map(result.restaurants.map((r) => [r.id, r as Restaurant]));
          return { ...d, restaurants: [...d.restaurants.filter((r) => !fresh.has(r.id)), ...fresh.values()] };
        });
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoadError({ key, message: error instanceof Error ? error.message : "Live Google Places data is unavailable right now." });
      });
    return () => ctrl.abort();
  }, [key, slot.servesAt, slot.headcount, event.venue, update]);

  const result = loaded?.key === key ? loaded.result : null;
  const error = loadError?.key === key ? loadError.message : "";
  const selected = selectedId ? result?.restaurants.find((r) => r.id === selectedId) : undefined;

  if (selected && result) {
    return (
      <RestaurantDetail
        restaurant={selected}
        restaurants={result.restaurants}
        slot={slot}
        onBack={() => setSelectedId(null)}
        onSelect={setSelectedId}
        onAsk={onAsk}
      />
    );
  }
  return <RestaurantList slot={slot} slots={slots} onSlot={setSlotId} result={result} error={error} onSelect={setSelectedId} />;
}

function RestaurantList({
  slot,
  slots,
  onSlot,
  result,
  error,
  onSelect,
}: {
  slot: MealSlot;
  slots: MealSlot[];
  onSlot: (id: string) => void;
  result: FindRestaurantsResult | null;
  error: string;
  onSelect: (id: string) => void;
}) {
  const { event } = useDashboard();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("best");
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [needs, setNeeds] = useState<Dietary[]>([]);
  const [maxPerHead, setMaxPerHead] = useState<MaxPerHead>("any");
  const [openOnly, setOpenOnly] = useState(true);
  const q = query.trim().toLowerCase();
  const narrowed = q !== "" || cuisines.length > 0 || needs.length > 0 || maxPerHead !== "any";

  const ranked = useMemo(() => {
    if (!result) return [];
    const kept = filterRestaurants(result.restaurants, {
      cuisines,
      dietary: needs,
      openAtSlot: openOnly,
      maxPerHead: maxPerHead === "any" ? undefined : Number(maxPerHead),
    }).filter((r) => !q || `${r.name} ${r.cuisine} ${r.address}`.toLowerCase().includes(q));
    return sortRestaurants(kept, sort);
  }, [result, cuisines, needs, openOnly, maxPerHead, q, sort]);

  const picks = useMemo(() => {
    if (narrowed || sort !== "best" || ranked.length < 4) return [];
    const by = (key: SortKey) => sortRestaurants(ranked, key)[0]!;
    const out: { r: RankedRestaurant; label: string }[] = [];
    for (const [r, label] of [
      [by("best"), "Best overall"],
      [by("cost"), "Cheapest"],
      [by("eta"), "Fastest"],
      [by("rating"), "Top rated"],
    ] as const) {
      if (!out.some((p) => p.r.id === r.id)) out.push({ r, label });
    }
    return out.slice(0, 3);
  }, [ranked, narrowed, sort]);
  const pickIds = new Set(picks.map((p) => p.r.id));
  const rest = ranked.filter((r) => !pickIds.has(r.id));

  const serves = clock(slot.servesAt);

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__title">
          <span className="dash-head__icon">
            <Icon name="store" />
          </span>
          <div>
            <h1>Restaurants</h1>
            <p className="dash-head__meta">
              Near {event.venue.name}, ranked by estimated cost per head, ETA and rating for {slot.label} ({serves}, {slot.headcount} people)
            </p>
          </div>
        </div>
      </header>

      <div className="dash-toolbar">
        <div className="dash-tabs" role="tablist" aria-label="Meal slot">
          {slots.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={slot.id === s.id}
              className={slot.id === s.id ? "dash-tab is-active" : "dash-tab"}
              onClick={() => onSlot(s.id)}
            >
              {s.label}
              <span className="dash-tab__count">{clock(s.servesAt)}</span>
            </button>
          ))}
        </div>
      </div>

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
          {narrowed && (
            <button
              type="button"
              className="filter__reset"
              onClick={() => {
                setQuery("");
                setCuisines([]);
                setNeeds([]);
                setMaxPerHead("any");
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className={openOnly ? "dash-tab is-active" : "dash-tab"}
            aria-pressed={openOnly}
            onClick={() => setOpenOnly((v) => !v)}
          >
            Open at {serves}
          </button>
          <FilterMenu
            label="Cuisine"
            icon="utensils"
            options={(result?.cuisines ?? []).map((c) => ({ value: c, label: c }))}
            selected={cuisines}
            onChange={setCuisines}
          />
          <FilterMenu
            label="Dietary"
            icon="leaf"
            options={DIETARY.map((d) => ({ value: d.id, label: d.label }))}
            selected={needs}
            onChange={setNeeds}
          />
          <ChoiceMenu
            label={maxPerHead === "any" ? "Max per head" : `Up to £${maxPerHead}`}
            icon="wallet"
            options={MAX_PER_HEAD.map((v) => ({ value: v, label: v === "any" ? "Any price" : `Up to £${v} a head` }))}
            value={maxPerHead}
            active={maxPerHead !== "any"}
            onChange={setMaxPerHead}
          />
          <ChoiceMenu
            label={SORTS.find((s) => s.id === sort)!.label}
            icon="list"
            options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
            value={sort}
            active={sort !== "best"}
            onChange={setSort}
          />
        </div>
      </div>

      <div className="dash-body">
        <div className="roles">
          {picks.length > 0 && (
            <section>
              <h2 className="roles__heading">
                <Icon name="pizza" className="icon--brand" />
                Picked for {slot.label}
                <span className="dash-tab__count">{picks.length}</span>
              </h2>
              <ul className="picks">
                {picks.map(({ r, label }) => (
                  <li key={r.id}>
                    <button type="button" className="pick" onClick={() => onSelect(r.id)}>
                      <span className="pick__head">
                        <RestaurantTile restaurant={r} />
                        <span className={label === "Best overall" ? "pill pill--brand" : "pill"}>{label}</span>
                      </span>
                      <span className="pick__role">{r.name}</span>
                      <span className="pick__company">
                        {r.cuisine} · {km(r.distanceKm)}
                        {r.rating !== undefined ? ` · ${r.rating}★` : ""}
                      </span>
                      <span className="pick__why">
                        <EstText estimate={r.costPerHead} format={money} /> a head, food at the door in about {minutes(r.etaMinutes)}.{" "}
                        Order by {clock(r.orderBy)}.
                      </span>
                      <span className="pick__foot">
                        <span>{money(r.totalCost)} for {slot.headcount}</span>
                        <span className="pick__eta">
                          <span>Prep {minutes(r.prepMinutes.value)} · Delivery {minutes(r.travelMinutes.value)}</span>
                          <span>Total ETA {minutes(r.etaMinutes)}</span>
                          <EtaWindow range={r.etaRange} />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="roles__heading">
              {narrowed ? "Results" : picks.length > 0 ? "More restaurants" : "Restaurants"}
              <span className="dash-tab__count">{rest.length}</span>
            </h2>
            {error ? (
              <p className="roles__empty">{error}</p>
            ) : !result ? (
              <p className="roles__empty">Finding restaurants near {event.venue.name}…</p>
            ) : rest.length === 0 ? (
              <p className="roles__empty">No restaurants match. Try clearing a filter.</p>
            ) : (
              <ul className="role-rows">
                {rest.map((r) => (
                  <li key={r.id} className="role-row">
                    <button type="button" className="role-row__main" onClick={() => onSelect(r.id)}>
                      <RestaurantTile restaurant={r} />
                      <span className="role-row__text">
                        <span className="role-row__title">
                          {r.name}
                          {r.catering.value && <span className="new">Catering</span>}
                        </span>
                        <span className="role-row__company">
                          {r.cuisine} · {r.address} · {km(r.distanceKm)}
                        </span>
                        <span className="role-row__summary">
                          {r.openAtSlot === false ? `Closed at ${serves} · ` : ""}
                          {servesLabel(r.serves)}
                        </span>
                      </span>
                      <span className="role-row__meta">
                        <span className="role-row__salary">
                          <EstText estimate={r.costPerHead} format={money} /> a head
                        </span>
                        <span className="role-row__chips">
                          <span className="pill pill--muted">Prep {minutes(r.prepMinutes.value)} est.</span>
                          <span className="pill pill--muted">Delivery {minutes(r.travelMinutes.value)} est.</span>
                          {r.rating !== undefined && (
                            <span className="pill pill--muted">
                              <Icon name="star" />
                              {r.rating}
                            </span>
                          )}
                        </span>
                        <EtaWindow range={r.etaRange} />
                      </span>
                    </button>
                    <a
                      className="save-btn"
                      href={r.costPerHead.source.url ?? r.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Estimate source: ${r.costPerHead.source.label}`}
                      aria-label={`Source for the ${r.name} cost estimate`}
                    >
                      <Icon name="external" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {result && <SourceNote result={result} />}
        </div>
      </div>
    </>
  );
}

function SourceNote({ result }: { result: FindRestaurantsResult }) {
  const unverified = result.restaurants.filter((r) => r.costPerHead.source.label === GEMINI_UNGROUNDED_LABEL).length;
  return (
    <p className="roles__source">
      {result.source === "fallback" ? (
        <> </>
      ) : (
        <>
          Restaurants, ratings and hours from{" "}
          <a href="https://developers.google.com/maps/documentation/places/web-service/op-overview" target="_blank" rel="noreferrer">
            Google Places
          </a>
          {result.source === "cache" ? " (cached)" : ""}. {result.grounded} of {result.restaurants.length} priced by Gemini with Google Search
          {unverified ? `, ${unverified} by Gemini without a search source` : ""}; follow any “est.” link for its source.{" "}
        </>
      )}
      Costs, ETAs and delivery fees are estimates. ETA is prep time plus courier travel time from distance.
      {result.source !== "fallback" && result.warnings.map((w) => <span key={w}> {w}</span>)}
    </p>
  );
}

function RestaurantDetail({
  restaurant: r,
  restaurants,
  slot,
  onBack,
  onSelect,
  onAsk,
}: {
  restaurant: RankedRestaurant;
  restaurants: RankedRestaurant[];
  slot: MealSlot;
  onBack: () => void;
  onSelect: (id: string) => void;
  onAsk: Ask;
}) {
  const index = Math.max(0, restaurants.findIndex((x) => x.id === r.id));
  const next = restaurants[(index + 1) % restaurants.length] ?? r;
  const prev = restaurants[(index - 1 + restaurants.length) % restaurants.length] ?? r;
  const listed = r.platforms.filter((p) => p.available.value).sort((a, b) => a.fee.value - b.fee.value);
  const cheapest = listed[0];
  const serves = clock(slot.servesAt);

  return (
    <div className="detail">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="crumbs__link" onClick={onBack}>
          Restaurants
        </button>
        <Icon name="chevronRight" className="crumbs__sep" />
        <span className="crumbs__current">{r.name}</span>
        <span className="crumbs__pager">
          <span className="crumbs__count">
            {index + 1} of {restaurants.length}
          </span>
          <button type="button" className="btn btn--icon" aria-label="Previous restaurant" onClick={() => onSelect(prev.id)}>
            <Icon name="chevronLeft" />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Next restaurant" onClick={() => onSelect(next.id)}>
            <Icon name="chevronRight" />
          </button>
        </span>
      </nav>

      <div className="detail__scroll">
        <article className="detail__inner">
          <div className="rcard">
            <div className="rcard__top">
              <div className="rcard__head">
                <RestaurantTile restaurant={r} size="lg" />
                <div>
                  <h1 className="rcard__title">{r.name}</h1>
                  <p className="rcard__company">
                    {r.cuisine} · {r.address}
                    <a href={r.mapsUrl} target="_blank" rel="noreferrer" aria-label="Open in Google Maps">
                      <Icon name="external" />
                    </a>
                  </p>
                  <PhotoCredit restaurant={r} />
                </div>
              </div>
              <div className="rcard__facts">
                <p className="rcard__salary">
                  {money(r.costPerHead.value)} a head
                  <span>
                    {money(r.totalCost)} for {slot.headcount} people ·{" "}
                    <a className="estimate" href={r.costPerHead.source.url ?? r.mapsUrl} target="_blank" rel="noreferrer">
                      estimate
                    </a>
                  </span>
                </p>
                <p className="rcard__place">
                  Total ETA {minutes(r.etaMinutes)}
                  <span>
                    {minutes(r.prepMinutes.value)} prep + {minutes(r.travelMinutes.value)} delivery · order by {clock(r.orderBy)} for {serves}
                  </span>
                  <EtaWindow range={r.etaRange} />
                </p>
              </div>
              <dl className="glance">
                <div>
                  <dt>Distance</dt>
                  <dd>{km(r.distanceKm)}</dd>
                </div>
                <div>
                  <dt>Rating</dt>
                  <dd>{r.rating !== undefined ? `${r.rating}★ (${(r.ratingCount ?? 0).toLocaleString("en-GB")})` : "—"}</dd>
                </div>
                <div>
                  <dt>Price level</dt>
                  <dd>{priceLabel(r.priceLevel)}</dd>
                </div>
                <div>
                  <dt>Prep for {slot.headcount}</dt>
                  <dd>
                    <EstimateValue estimate={r.prepMinutes} format={minutes} />
                  </dd>
                </div>
                <div>
                  <dt>Delivery ETA</dt>
                  <dd>
                    <EstimateValue estimate={r.travelMinutes} format={minutes} />
                  </dd>
                </div>
                <div>
                  <dt>At {serves}</dt>
                  <dd>{r.openAtSlot === null ? "Hours unknown" : r.openAtSlot ? "Open" : "Closed"}</dd>
                </div>
              </dl>
            </div>
            <div className="rcard__why">
              <p className="rcard__why-title">
                <Icon name="pizza" className="icon--brand" />
                Why Comeda ranked this #{index + 1}
              </p>
              <p>
                About {money(r.costPerHead.value)} a head and {minutes(r.etaMinutes)} from order to door ({minutes(r.prepMinutes.value)} prep +{" "}
                {minutes(r.travelMinutes.value)} travel)
                {r.rating !== undefined ? `, rated ${r.rating}★` : ""}.{" "}
                {r.catering.value
                  ? "Looks set up for large orders."
                  : "No sign of catering, so call ahead before ordering for this many."}
              </p>
              <ul className="rcard__tags">
                {r.serves.map((d) => (
                  <li key={d}>{DIETARY.find((x) => x.id === d)!.label}</li>
                ))}
                <li>
                  {r.catering.source.url ? (
                    <a href={r.catering.source.url} target="_blank" rel="noreferrer">
                      {r.catering.value ? "Catering" : "No catering"} · estimate
                    </a>
                  ) : (
                    `${r.catering.value ? "Catering" : "No catering"} · estimate`
                  )}
                </li>
              </ul>
            </div>
          </div>

          <section className="detail__section">
            <h2>Delivery platforms</h2>
            <div className="role-rows">
              {r.platforms.map((p) => (
                <div key={p.platform} className="role-row">
                  <div className="role-row__main">
                    <span className="role-row__text">
                      <span className="role-row__title">
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {platformLabel(p.platform)}
                        </a>
                      </span>
                      <span className="role-row__company">
                        {p.available.value ? "Listed" : "Probably not listed"} ·{" "}
                        <a className="estimate" href={p.available.source.url} target="_blank" rel="noreferrer">
                          {p.available.source.label}
                        </a>
                      </span>
                    </span>
                    <span className="role-row__meta">
                      <span className="role-row__salary">
                        <EstimateValue estimate={p.fee} format={money} /> delivery
                      </span>
                      <span className="role-row__chips">
                        <span className="pill pill--muted">Prep {minutes(r.prepMinutes.value)} est.</span>
                        <span className="pill pill--muted">Delivery {minutes(Math.max(0, p.etaMinutes - r.prepMinutes.value))} est.</span>
                      </span>
                      <EtaWindow range={r.etaRange} offset={p.etaMinutes - r.etaMinutes} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {r.hours && (
            <section className="detail__section">
              <h2>Opening hours</h2>
              <ul>
                {r.hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}

          <p className="roles__source">
            Cost per head: {r.costPerHead.source.label}. ETA range: {r.etaRange.source.label}. Delivery fees and ETAs are estimates; check the platform before ordering.
            Comeda never places orders.
          </p>
        </article>
      </div>

      <div className="detail__actions">
        {cheapest ? (
          <a className="btn btn--primary" href={cheapest.url} target="_blank" rel="noreferrer">
            <Icon name="truck" />
            Order on {platformLabel(cheapest.platform)}
          </a>
        ) : (
          <a className="btn btn--primary" href={r.websiteUrl ?? r.mapsUrl} target="_blank" rel="noreferrer">
            <Icon name="external" />
            Contact the restaurant
          </a>
        )}
        <button
          type="button"
          className="btn btn--outline"
          onClick={() =>
            onAsk(`Could ${r.name} feed ${slot.headcount} people for ${slot.label.toLowerCase()}? What would it cost and when must we order?`)
          }
        >
          <Icon name="pizza" className="icon--brand" />
          Ask the planner
        </button>
        <a className="btn btn--outline" href={r.mapsUrl} target="_blank" rel="noreferrer">
          <Icon name="pin" />
          Google Maps
        </a>
        <button type="button" className="btn btn--ghost-lg" onClick={() => onSelect(next.id)}>
          Next
        </button>
      </div>
    </div>
  );
}
