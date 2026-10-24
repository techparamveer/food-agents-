"use client";

import { useState } from "react";
import { clock, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import type { Attendee } from "@/lib/types";

/* Prep → Meal check: who has eaten in a slot. Name search works today; the meal-check thread
   adds the camera QR scanner and the hash → attendee resolver. */

type Result = { attendee: Attendee; ok: boolean; note: string };

function Avatar({ attendee }: { attendee: Attendee }) {
  return (
    <span className="emp-tile emp-tile--md emp-tile--logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={attendee.avatarUrl} alt="" />
    </span>
  );
}

export function MealCheckView() {
  const { now, slots, attendees, mealLogs, update } = useDashboard();
  const current = slots.find((s) => s.servesAt > now) ?? slots[slots.length - 1];
  const [slotId, setSlotId] = useState(current.id);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const slot = slots.find((s) => s.id === slotId)!;
  const eaten = (id: string) => mealLogs.filter((l) => l.slotId === slotId && l.attendeeId === id).length;
  const served = mealLogs.filter((l) => l.slotId === slotId).length;
  const q = query.trim().toLowerCase();
  const matches = q
    ? attendees.filter((a) => `${a.name} ${a.discordHandle}`.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const check = (attendee: Attendee) => {
    const ok = eaten(attendee.id) < slot.allowance;
    setResult({
      attendee,
      ok,
      note: ok ? `Enjoy ${slot.label}.` : `Already collected ${slot.label}.`,
    });
    if (!ok) return;
    update((data) => ({
      ...data,
      mealLogs: [
        ...data.mealLogs,
        { id: `log-${data.mealLogs.length + 1}`, attendeeId: attendee.id, slotId, at: new Date().toISOString(), method: "search" },
      ],
    }));
  };

  return (
    <>
      <header className="dash-head">
        <div className="dash-head__title">
          <span className="dash-head__icon">
            <Icon name="scan" />
          </span>
          <div>
            <h1>Meal check</h1>
            <p className="dash-head__meta">
              {slot.label} at {clock(slot.servesAt)} · {served} served · {slot.headcount - served} to go
            </p>
          </div>
        </div>
        <div className="dash-head__actions">
          <div className="seg" role="group" aria-label="Meal">
            {slots.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === slotId ? "seg__btn is-active" : "seg__btn"}
                aria-pressed={s.id === slotId}
                onClick={() => {
                  setSlotId(s.id);
                  setResult(null);
                }}
              >
                {s.label.replace(/^(Saturday|Sunday) /, "")}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="dash-body dash-body--flush">
        <div className="prep">
          <div className="guide-banner">
            <Icon name="qr" className="icon--brand" />
            <span>
              <strong>Scan a QR code</strong>
              The camera scanner is coming. Search by name below in the meantime.
            </span>
          </div>

          {result && (
            <article className={result.ok ? "card card--offer" : "card"} role="status">
              <div className="card__head">
                <Avatar attendee={result.attendee} />
                <div className="card__titles">
                  <h3 className="card__role">
                    {result.ok ? "✅" : "⛔"} {result.attendee.name}
                  </h3>
                  <p className="card__company">@{result.attendee.discordHandle}</p>
                </div>
                <span className={result.ok ? "pill pill--brand" : "pill pill--urgent"}>
                  <Icon name={result.ok ? "check" : "ban"} />
                  {result.ok ? "Fed" : "Allowance used"}
                </span>
              </div>
              <div className="card__body">
                <p className="card__detail">{result.note}</p>
              </div>
            </article>
          )}

          <section>
            <h2 className="roles__heading">Find an attendee</h2>
            <label className="search">
              <Icon name="search" />
              <input
                type="search"
                placeholder="Name or Discord handle"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ul className="upcoming">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" className="upcoming__item" onClick={() => check(a)}>
                    <Avatar attendee={a} />
                    <span className="upcoming__text">
                      <span className="upcoming__title">{a.name}</span>
                      <span className="upcoming__meta">
                        @{a.discordHandle} · {eaten(a.id)}/{slot.allowance} eaten
                      </span>
                    </span>
                    <span className="upcoming__cta">
                      Check in
                      <Icon name="arrowRight" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {q && matches.length === 0 && <p className="roles__empty">No attendee matches “{query}”.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
