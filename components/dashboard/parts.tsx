"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import type { Estimate, OrderStatus, Restaurant } from "@/lib/types";

export function RestaurantTile({ restaurant, size = "md" }: { restaurant: Restaurant; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`emp-tile emp-tile--${size}`} style={{ background: restaurant.color }} aria-hidden="true">
      {restaurant.monogram}
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

const ORDER_STEPS: { id: OrderStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "approved", label: "Approved" },
  { id: "ordered", label: "Ordered" },
  { id: "delivered", label: "Delivered" },
];

/** Four-step track from draft to delivered; the current status is highlighted. */
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
