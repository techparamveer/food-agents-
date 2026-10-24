"use client";

import { useEffect, useRef } from "react";
import { longDay, clock, money, useDashboard } from "@/components/dashboard/data";
import { Icon, type IconName } from "@/components/dashboard/icon";
import type { SettingsTab } from "@/lib/sections";
import { DIETARY } from "@/lib/types";

const TABS: { id: SettingsTab; group: string; label: string; icon: IconName; hint: string }[] = [
  { id: "event", group: "Event", label: "Event", icon: "calendar", hint: "Dates, venue, headcount and budget. Comeda plans meals from these." },
  { id: "dietary", group: "Event", label: "Dietary mix", icon: "leaf", hint: "Rough shares Comeda uses to split every order." },
  { id: "notifications", group: "Team", label: "Notifications", icon: "bell", hint: "How attendees hear that food has arrived." },
];
const GROUPS = [...new Set(TABS.map((t) => t.group))];

export function SettingsDialog({
  tab,
  onTab,
  onClose,
}: {
  tab: SettingsTab | null;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = tab !== null;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const { event } = useDashboard();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="setd"
      aria-labelledby="setd-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="setd__frame">
        <nav className="setd__nav" aria-label="Settings">
          {GROUPS.map((group) => (
            <div key={group} className="setd__group">
              <p className="setd__heading">{group}</p>
              {TABS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === active.id ? "setd__tab is-active" : "setd__tab"}
                  aria-current={item.id === active.id ? "page" : undefined}
                  onClick={() => onTab(item.id)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="setd__body">
          <header className="setd__head">
            <div>
              <h2 id="setd-title">{active.label}</h2>
              <p>{active.hint}</p>
            </div>
            <button type="button" className="btn btn--icon" aria-label="Close settings" onClick={onClose}>
              <Icon name="x" />
            </button>
          </header>

          <div className="setd__scroll">
            <div hidden={active.id !== "event"}>
              <form className="set__form" onSubmit={(e) => e.preventDefault()}>
                <fieldset className="ob-group">
                  <legend className="ob-field__label">{event.name}</legend>
                  <p className="ob-field__hint">
                    {longDay(event.startsAt)}, {clock(event.startsAt)} to {longDay(event.endsAt)}, {clock(event.endsAt)}
                  </p>
                  <label className="ob-field">
                    <span className="ob-field__label">Venue</span>
                    <input className="ob-input" readOnly value={`${event.venue.name}, ${event.venue.address} ${event.venue.postcode}`} />
                  </label>
                  <label className="ob-field">
                    <span className="ob-field__label">Headcount</span>
                    <input className="ob-input ob-input--short" readOnly value={event.headcount} />
                  </label>
                  <label className="ob-field">
                    <span className="ob-field__label">Food budget</span>
                    <input className="ob-input ob-input--short" readOnly value={money(event.budget)} />
                  </label>
                </fieldset>
              </form>
            </div>
            <div hidden={active.id !== "dietary"}>
              <form className="set__form" onSubmit={(e) => e.preventDefault()}>
                <fieldset className="ob-group">
                  <legend className="ob-field__label">Share of attendees</legend>
                  <p className="ob-field__hint">Everyone else gets the standard menu.</p>
                  {DIETARY.map((d) => (
                    <label key={d.id} className="ob-field">
                      <span className="ob-field__label">{d.label}</span>
                      <input
                        className="ob-input ob-input--short"
                        readOnly
                        value={`${Math.round(event.dietaryMix[d.id] * 100)}% · ${Math.round(event.dietaryMix[d.id] * event.headcount)} people`}
                      />
                    </label>
                  ))}
                </fieldset>
              </form>
            </div>
            <div hidden={active.id !== "notifications"}>
              <form className="set__form" onSubmit={(e) => e.preventDefault()}>
                <fieldset className="ob-group">
                  <legend className="ob-field__label">Discord</legend>
                  <p className="ob-field__hint">Post in your server when each meal arrives.</p>
                  <label className="ob-switch" aria-disabled="true">
                    <input type="checkbox" role="switch" disabled checked={false} readOnly />
                    <span className="ob-switch__track" aria-hidden="true" />
                    <span className="ob-switch__text">Coming soon: notify on Discord</span>
                  </label>
                </fieldset>
              </form>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
