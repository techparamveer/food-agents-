"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/dashboard/icon";
import { ORDER_STATUSES, type Estimate, type OrderStatus, type Restaurant } from "@/lib/types";

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

/** What a tile shows: the logo, else the photo, else nothing (the letter). */
function useTileImage(r: Restaurant): { kind: "logo" | "photo"; src: string } | undefined {
  useSyncExternalStore(subscribe, () => brokenVersion, () => 0);
  if (r.logoUrl && !broken.has(r.logoUrl)) return { kind: "logo", src: r.logoUrl };
  if (r.photoUrl && !broken.has(r.photoUrl)) return { kind: "photo", src: r.photoUrl };
  return undefined;
}

/** The restaurant's logo, else its photo, else its coloured letter, falling back as images fail. */
export function RestaurantTile({ restaurant, size = "md" }: { restaurant: Restaurant; size?: "sm" | "md" | "lg" }) {
  const image = useTileImage(restaurant);
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
export function PhotoCredit({ restaurant }: { restaurant: Restaurant }) {
  if (useTileImage(restaurant)?.kind !== "photo") return null;
  const who = restaurant.photoCredit;
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
      · Google Maps
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
