"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/dashboard/icon";
import {
  ORDER_STATUSES,
  type DeliveryPlatform,
  type Estimate,
  type OrderStatus,
  type Restaurant,
} from "@/lib/types";

/* Images that failed to load (no logo, expired photo), shared by every tile so a failure in the
   list isn't retried in the detail view, and the photo credit knows what the tile is showing. */
const broken = new Set<string>();
const listeners = new Set<() => void>();
let brokenVersion = 0;
const markBroken = (url: string) => {
  if (broken.has(url)) return;
  broken.add(url);
  brokenVersion++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

type TileImage = { kind: "logo" | "photo" | "asset"; src: string };

/** What a tile shows. Meal heroes can lead with the place photo; compact tiles lead with the logo. */
function useTileImage(r: Restaurant, preferPhoto = false): TileImage | undefined {
  useSyncExternalStore(subscribe, () => brokenVersion, () => 0);
  if (preferPhoto && r.photoUrl && !broken.has(r.photoUrl)) return { kind: "photo", src: r.photoUrl };
  if (preferPhoto && r.imageUrl && !broken.has(r.imageUrl)) return { kind: "asset", src: r.imageUrl };
  if (r.logoUrl && !broken.has(r.logoUrl)) return { kind: "logo", src: r.logoUrl };
  if (r.photoUrl && !broken.has(r.photoUrl)) return { kind: "photo", src: r.photoUrl };
  if (r.imageUrl && !broken.has(r.imageUrl)) return { kind: "asset", src: r.imageUrl };
  return undefined;
}

/** The restaurant's logo, else its photo, else its coloured letter, falling back as images fail. */
export function RestaurantTile({
  restaurant,
  size = "md",
  preferPhoto = false,
}: {
  restaurant: Restaurant;
  size?: "sm" | "md" | "lg" | "hero";
  preferPhoto?: boolean;
}) {
  const image = useTileImage(restaurant, preferPhoto);
  const credit = restaurant.photoCredit ? `Photo: ${restaurant.photoCredit.name} · Google Maps` : "Photo: Google Maps";
  return (
    <span
      className={image ? `emp-tile emp-tile--${size} emp-tile--${image.kind}` : `emp-tile emp-tile--${size}`}
      style={image?.kind === "logo" ? undefined : { background: restaurant.color }}
      title={image?.kind === "photo" ? credit : undefined}
      aria-hidden="true"
    >
      {image ? (
        // A plain img: the routes redirect to the restaurant's site or Google's CDN; nothing for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={image.src} src={image.src} alt="" loading="lazy" decoding="async" onError={() => markBroken(image.src)} />
      ) : (
        restaurant.monogram
      )}
    </span>
  );
}

/** Google requires the photographer's credit wherever a Places photo is shown, so this appears only when the tile shows the photo. */
export function PhotoCredit({ restaurant, preferPhoto = false }: { restaurant: Restaurant; preferPhoto?: boolean }) {
  if (useTileImage(restaurant, preferPhoto)?.kind !== "photo") return null;
  const who = restaurant.photoCredit;
  const mapsUrl = restaurant.photoMapsUrl ?? restaurant.mapsUrl;
  return (
    <span className="photo-credit">
      Photo:{" "}
      {who?.url ? (
        <a href={who.url} target="_blank" rel="noreferrer">
          {who.name}
        </a>
      ) : (
        (who?.name ?? "Google Maps contributor")
      )}{" "}
      ·{" "}
      {mapsUrl ? (
        <a href={mapsUrl} target="_blank" rel="noreferrer">
          Google Maps
        </a>
      ) : (
        "Google Maps"
      )}
    </span>
  );
}

/** A number with its provenance: "£6.50 est." linking to the source when there is one. */
export function EstimateValue({ estimate, format }: { estimate: Estimate; format: (n: number) => string }) {
  const label = `${estimate.isEstimate ? "Estimate" : "Confirmed"} · ${estimate.source.label}`;
  return (
    <span title={label}>
      {format(estimate.value)}
      {estimate.isEstimate &&
        (estimate.source.url ? (
          <a className="estimate" href={estimate.source.url} target="_blank" rel="noreferrer">
            {" "}
            est.
          </a>
        ) : (
          <span className="estimate"> est.</span>
        ))}
    </span>
  );
}

/** Split the selected order-to-door estimate into kitchen prep and courier delivery. */
export function EtaBreakdown({ restaurant, platform }: { restaurant: Restaurant; platform?: DeliveryPlatform }) {
  const option = restaurant.delivery.find((delivery) => delivery.platform === platform) ?? restaurant.delivery[0];
  const prep = Math.max(0, restaurant.prepMinutes.value);
  const total = Math.max(prep, option?.eta.value ?? prep + restaurant.travelMinutes.value);
  const delivery: Estimate = {
    value: Math.max(0, total - prep),
    source: option?.eta.source ?? restaurant.travelMinutes.source,
    isEstimate: option?.eta.isEstimate ?? restaurant.travelMinutes.isEstimate,
  };
  const totalEstimate: Estimate = option
    ? { ...option.eta, value: total }
    : {
        value: total,
        source: restaurant.travelMinutes.source,
        isEstimate: restaurant.prepMinutes.isEstimate || restaurant.travelMinutes.isEstimate,
      };
  const minutes = (value: number) => `${Math.round(value)} min`;

  return (
    <dl className="eta-breakdown" aria-label="Preparation and delivery estimates">
      <div>
        <dt>
          <Icon name="chef" />
          Preparation
        </dt>
        <dd><EstimateValue estimate={restaurant.prepMinutes} format={minutes} /></dd>
      </div>
      <div>
        <dt>
          <Icon name="truck" />
          Delivery
        </dt>
        <dd><EstimateValue estimate={delivery} format={minutes} /></dd>
      </div>
      <div>
        <dt>
          <Icon name="clock" />
          Total ETA
        </dt>
        <dd><EstimateValue estimate={totalEstimate} format={minutes} /></dd>
      </div>
    </dl>
  );
}

const ORDER_STEPS = ORDER_STATUSES;

/** Four-step track from planned to arrived; the current status is highlighted. */
export function StatusTrack({ status, muted = false }: { status: OrderStatus; muted?: boolean }) {
  const current = ORDER_STEPS.findIndex((s) => s.id === status);
  return (
    <div className={muted ? "track track--muted" : "track"}>
      <ol className="track__steps" aria-label={`Step ${current + 1} of ${ORDER_STEPS.length}: ${ORDER_STEPS[current].label}`}>
        {ORDER_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={i < current ? "track__step is-done" : i === current ? "track__step is-current" : "track__step"}
            title={s.label}
          />
        ))}
      </ol>
      <span className="track__label">
        {ORDER_STEPS[current].label}
        <span className="track__count">
          {current + 1}/{ORDER_STEPS.length}
        </span>
      </span>
    </div>
  );
}

export function FilterMenu<T extends string>({
  label,
  icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
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

  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="filter" ref={rootRef}>
      <button
        type="button"
        className={selected.length ? "filter__trigger is-active" : "filter__trigger"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} />
        {label}
        {selected.length > 0 && <span className="filter__count">{selected.length}</span>}
        <Icon name="chevronDown" className="filter__chevron" />
      </button>
      {open && (
        <div className="filter__menu" role="group" aria-label={label}>
          {options.map((option) => (
            <label key={option.value} className="filter__option">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span className="filter__box" aria-hidden="true">
                <Icon name="check" />
              </span>
              {option.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="filter__clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
