"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { clock, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { QrScanner } from "@/components/dashboard/qr-scanner";
import { checkAllowance, countEaten, defaultRules, logServing, parseRuleOverrides, slotAt, slotWindow, type SlotRules } from "@/lib/allowance";
import { createResolver } from "@/lib/qr";
import { OXHACK_MEAL_LOGS } from "@/lib/seed/oxhack";
import { DIETARY, type Attendee, type MealLog, type MealSlot } from "@/lib/types";

/* Prep → Meal check: the organiser at the food table scans a QR code (or searches by name),
   sees a big ✅ or ⛔, and taps Serve. Logs stay in this browser (no meal-log table yet), and
   allowance rules live in lib/allowance.ts. */

type Result =
  | { kind: "attendee"; attendeeId: string; method: MealLog["method"]; servedLogId?: string }
  | { kind: "unknown"; text: string; malformed: boolean };

type Filter = "all" | "todo" | "eaten";

const MINUTE = 60_000;
/** Undo sits where Serve was, so a quick second tap on Serve mustn't undo it. */
const UNDO_GUARD_MS = 600;
const logsKey = (eventId: string) => `comeda:meal-logs:${eventId}`;
const rulesKey = (eventId: string) => `comeda:meal-rules:${eventId}`;
const newLogId = () => `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
/** The real time, for event handlers. (The compiler's purity check can't tell `serve` isn't run during render.) */
const wallClock = () => Date.now();

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the in-memory state still works.
  }
}

function Avatar({ attendee, size = "md" }: { attendee: Attendee; size?: "md" | "lg" }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`mc-avatar mc-avatar--${size}`} src={attendee.avatarUrl} alt="" />;
}

const dietaryLabel = (a: Attendee) => DIETARY.find((d) => d.id === a.dietary)?.label;

export function MealCheckView() {
  const { demo, now: dataNow, event, slots, attendees, mealLogs, update } = useDashboard();

  /* Rules per slot: defaults from lib/allowance.ts, overridden in the panel below. */
  const [overrides, setOverrides] = useState<Record<string, SlotRules>>({});

  /* The clock. The demo's data is frozen on Saturday afternoon, so the table runs a demo clock
     a few minutes into the chosen slot that the organiser can nudge forward to show seconds. */
  const [offset, setOffset] = useState(5);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    if (demo) return;
    const id = window.setInterval(() => setLiveNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [demo]);

  /* The slot follows the clock (and the rules' table windows) until the organiser picks one by hand. */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const autoId = slotAt(slots, demo ? Date.parse(dataNow) : liveNow, overrides).id;
  const slotId = pickedId ?? autoId;
  const slot = slots.find((s) => s.id === slotId)!;
  const rules = overrides[slotId] ?? defaultRules(slot);
  const now = demo ? Date.parse(slot.servesAt) + offset * MINUTE : liveNow;
  const setRules = (patch: Partial<SlotRules>) => {
    const next = { ...overrides, [slotId]: { ...rules, ...patch } };
    setOverrides(next);
    writeJson(rulesKey(event.id), next);
  };

  /* Logs and rules saved in this browser survive a refresh at the food table. */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const logs = readJson<MealLog[]>(logsKey(event.id));
    if (Array.isArray(logs)) update((data) => ({ ...data, mealLogs: logs }));
    setOverrides(parseRuleOverrides(readJson<unknown>(rulesKey(event.id)), slots));
  }, [event.id, update, slots]);

  const commitLogs = (patch: (logs: MealLog[]) => MealLog[]) =>
    update((data) => {
      const next = patch(data.mealLogs);
      writeJson(logsKey(event.id), next);
      return { ...data, mealLogs: next };
    });

  const resolve = useMemo(() => createResolver(attendees), [attendees]);
  const byId = useMemo(() => new Map(attendees.map((a) => [a.id, a])), [attendees]);

  const [result, setResult] = useState<Result | null>(null);
  // When the clock moves the slot on, the card re-checks against the new slot; its serving was in the old one.
  const [resultSlotId, setResultSlotId] = useState(slotId);
  if (resultSlotId !== slotId) {
    setResultSlotId(slotId);
    setResult((r) => (r?.kind === "attendee" ? { ...r, servedLogId: undefined } : r));
  }
  const resultRef = useRef<HTMLDivElement>(null);
  const show = (next: Result) => {
    setResult(next);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const onScan = (text: string) => {
    const r = resolve(text);
    if (r.ok) show({ kind: "attendee", attendeeId: r.attendee.id, method: "qr" });
    else show({ kind: "unknown", text: r.text, malformed: r.reason === "malformed" });
  };

  const servedAt = useRef(0);
  const serve = (attendeeId: string, method: MealLog["method"]) => {
    // The card on screen may be stale (the live clock ticks every 15 s), so check again now.
    const at = demo ? now : wallClock();
    if (!demo) setLiveNow(at);
    const r = logServing({ slot, rules, logs: mealLogs, attendeeId, now: at, method, id: newLogId() });
    if (!r.ok) {
      // The card re-renders with the fresh clock and logs, so it shows the ⛔ reason.
      setResult({ kind: "attendee", attendeeId, method });
      return;
    }
    commitLogs((logs) => [...logs, r.log]);
    servedAt.current = wallClock();
    setResult({ kind: "attendee", attendeeId, method, servedLogId: r.log.id });
  };

  const undo = (logId: string) => {
    if (wallClock() - servedAt.current < UNDO_GUARD_MS) return;
    commitLogs((logs) => logs.filter((l) => l.id !== logId));
    setResult((r) => (r?.kind === "attendee" ? { ...r, servedLogId: undefined } : r));
  };

  const pickSlot = (id: string) => {
    setPickedId(id);
    setOffset(5);
    setResult(null);
  };

  /* Attendee list: search doubles as the fallback when a QR code won't scan. */
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const eatenById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of mealLogs) if (l.slotId === slotId) m.set(l.attendeeId, (m.get(l.attendeeId) ?? 0) + 1);
    return m;
  }, [mealLogs, slotId]);
  const servedPeople = eatenById.size;
  const servings = [...eatenById.values()].reduce((a, b) => a + b, 0);
  const q = query.trim().toLowerCase().replace(/^@/, "");
  const listed = attendees.filter((a) => {
    const n = eatenById.get(a.id) ?? 0;
    if (filter === "todo" && n > 0) return false;
    if (filter === "eaten" && n === 0) return false;
    return !q || a.name.toLowerCase().includes(q) || a.discordHandle.includes(q);
  });

  const win = slotWindow(slot, rules);
  const secondsLine =
    win.secondsAt === null ? "No seconds" : now >= win.secondsAt ? "Seconds open" : `Seconds from ${clock(new Date(win.secondsAt).toISOString())}`;

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
              {slot.label} at {clock(slot.servesAt)} · {servedPeople} of {attendees.length} served
            </p>
          </div>
        </div>
        <div className="dash-head__actions mc-slots">
          <div className="seg" role="group" aria-label="Meal">
            {slots.map((s) => (
              <button
                key={s.id}
                type="button"
                className={s.id === slotId ? "seg__btn is-active" : "seg__btn"}
                aria-pressed={s.id === slotId}
                onClick={() => pickSlot(s.id)}
              >
                {s.label.replace(/^(Saturday|Sunday) /, (m) => m.slice(0, 3) + " ")}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="dash-body dash-body--flush">
        <div className="prep mc">
          <div className="mc-clock">
            <span className="card__meta">
              <Icon name="clock" />
              {demo ? "Demo clock" : "Now"} <strong>{clock(new Date(now).toISOString())}</strong>
              <span aria-hidden="true">·</span>
              {secondsLine}
            </span>
            {demo && (
              <span className="mc-clock__nudge">
                <button type="button" className="btn btn--ghost" onClick={() => setOffset((o) => o - 15)} aria-label="Back 15 minutes">
                  −15m
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setOffset((o) => o + 15)} aria-label="Forward 15 minutes">
                  +15m
                </button>
              </span>
            )}
          </div>

          <QrScanner onScan={onScan} />

          <div ref={resultRef} aria-live="polite">
            {result && (
              <ResultCard
                result={result}
                attendee={result.kind === "attendee" ? byId.get(result.attendeeId) : undefined}
                slot={slot}
                rules={rules}
                logs={mealLogs}
                now={now}
                onServe={serve}
                onUndo={undo}
                onDismiss={() => setResult(null)}
              />
            )}
          </div>

          <section>
            <h2 className="roles__heading">
              Attendees
              <span className="pill pill--muted">
                {servedPeople}/{attendees.length} eaten{servings > servedPeople ? ` · ${servings - servedPeople} seconds` : ""}
              </span>
            </h2>
            <div className="mc-find">
              <label className="search">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="Search name or Discord handle"
                  aria-label="Search attendees"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="seg" role="group" aria-label="Show">
                {(
                  [
                    ["all", "All"],
                    ["todo", "Not eaten"],
                    ["eaten", "Eaten"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={filter === id ? "seg__btn is-active" : "seg__btn"}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="mc-list">
              {listed.map((a) => {
                const n = eatenById.get(a.id) ?? 0;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="mc-row"
                      onClick={() => show({ kind: "attendee", attendeeId: a.id, method: "search" })}
                    >
                      <Avatar attendee={a} />
                      <span className="upcoming__text">
                        <span className="upcoming__title">{a.name}</span>
                        <span className="upcoming__meta">@{a.discordHandle}</span>
                      </span>
                      <span className={n > 0 ? "pill pill--brand" : "pill pill--muted"}>
                        {n}/{win.secondsAt !== null && now >= win.secondsAt ? rules.servings + rules.seconds : rules.servings}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {listed.length === 0 && <p className="roles__empty">{q ? `No attendee matches “${query}”.` : "Nobody here yet."}</p>}
          </section>

          <section>
            <h2 className="roles__heading">Allowance for {slot.label}</h2>
            <form className="mc-rules" onSubmit={(e) => e.preventDefault()}>
              <label className="ob-field">
                <span className="ob-field__label">Servings each</span>
                <input
                  className="ob-input ob-input--short"
                  type="number"
                  min={0}
                  max={5}
                  value={rules.servings}
                  onChange={(e) => setRules({ servings: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
                />
              </label>
              <label className="ob-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={rules.secondsAfterMinutes !== null}
                  onChange={(e) => setRules({ secondsAfterMinutes: e.target.checked ? defaultRules(slot).secondsAfterMinutes ?? 30 : null })}
                />
                <span className="ob-switch__track" aria-hidden="true" />
                <span className="ob-switch__text">Allow seconds</span>
              </label>
              {rules.secondsAfterMinutes !== null && (
                <label className="ob-field">
                  <span className="ob-field__label">Seconds open after (minutes)</span>
                  <input
                    className="ob-input ob-input--short"
                    type="number"
                    min={0}
                    max={240}
                    step={5}
                    value={rules.secondsAfterMinutes}
                    onChange={(e) => setRules({ secondsAfterMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                  />
                </label>
              )}
              <p className="ob-field__hint">
                Table open {clock(new Date(win.opensAt).toISOString())}–{clock(new Date(win.closesAt).toISOString())}.
                {overrides[slotId] && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="mc-link"
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[slotId];
                        setOverrides(next);
                        writeJson(rulesKey(event.id), next);
                      }}
                    >
                      Reset to default
                    </button>
                  </>
                )}
              </p>
            </form>
          </section>

          <div className="mc-foot">
            <Link href="/demo/qr-sheet" className="guide-banner" target="_blank">
              <Icon name="printer" className="icon--brand" />
              <span>
                <strong>Print demo QR codes</strong>
                One code per attendee. Scan them from paper or another screen.
              </span>
              <Icon name="arrowRight" />
            </Link>
            {demo && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  commitLogs(() => OXHACK_MEAL_LOGS);
                  setResult(null);
                }}
              >
                <Icon name="undo" />
                Reset demo meal logs
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ResultCard({
  result,
  attendee,
  slot,
  rules,
  logs,
  now,
  onServe,
  onUndo,
  onDismiss,
}: {
  result: Result;
  attendee: Attendee | undefined;
  slot: MealSlot;
  rules: SlotRules;
  logs: MealLog[];
  now: number;
  onServe: (attendeeId: string, method: MealLog["method"]) => void;
  onUndo: (logId: string) => void;
  onDismiss: () => void;
}) {
  if (result.kind === "unknown" || !attendee) {
    const text = result.kind === "unknown" ? result.text : "";
    return (
      <article className="mc-result is-blocked">
        <div className="mc-result__verdict">
          <span className="mc-result__mark" aria-hidden="true">⛔</span>
          <div>
            <strong>Unknown code</strong>
            <span>
              {result.kind === "unknown" && result.malformed ? "This isn't a Comeda attendee QR code." : "No attendee has this code."} Search by name below.
            </span>
          </div>
        </div>
        {text && <code className="mc-result__raw">{text.slice(0, 80)}</code>}
        <div className="mc-result__actions">
          <button type="button" className="btn btn--outline" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </article>
    );
  }

  const served = result.servedLogId ? logs.find((l) => l.id === result.servedLogId) : undefined;
  // The verdict is for the next serving; once served, show the serving that just happened.
  const a = checkAllowance({ slot, rules, logs: served ? logs.filter((l) => l.id !== served.id) : logs, attendeeId: attendee.id, now });
  const eaten = countEaten(logs, slot.id, attendee.id);
  const remaining = served ? Math.max(0, a.limit - eaten) : a.remaining;
  const ok = a.ok || Boolean(served);
  const diet = dietaryLabel(attendee);

  return (
    <article className={served ? "mc-result is-served" : ok ? "mc-result is-ok" : "mc-result is-blocked"}>
      <div className="mc-result__verdict">
        <span className="mc-result__mark" aria-hidden="true">{ok ? "✅" : "⛔"}</span>
        <div>
          <strong>{served ? "Served" : ok ? (a.eaten > 0 ? "Seconds OK" : "OK to serve") : "Don't serve"}</strong>
          <span>
            {served
              ? `Logged at ${clock(served.at)}${served.method === "qr" ? " from QR" : " by search"}.`
              : ok
                ? `${slot.label}${a.eaten > 0 ? ", seconds" : ""}.`
                : a.reason?.text}
          </span>
        </div>
      </div>

      <div className="mc-result__who">
        <Avatar attendee={attendee} size="lg" />
        <div className="mc-result__names">
          <span className="mc-result__name">{attendee.name}</span>
          <span className="mc-result__handle">
            <span className="mc-discord" aria-hidden="true" />@{attendee.discordHandle}
          </span>
          {diet && (
            <span className="pill">
              <Icon name="leaf" />
              {diet}
            </span>
          )}
        </div>
      </div>

      <dl className="mc-result__stats">
        <div>
          <dt>Eaten this slot</dt>
          <dd>{eaten}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{remaining}</dd>
        </div>
        <div>
          <dt>Seconds</dt>
          <dd>{a.secondsAt === null ? "None" : a.secondsOpen ? "Open" : clock(a.secondsAt)}</dd>
        </div>
      </dl>

      <div className="mc-result__actions">
        {served ? (
          <>
            <button type="button" className="btn btn--outline" onClick={() => onUndo(served.id)}>
              <Icon name="undo" />
              Undo
            </button>
            <button type="button" className="btn btn--ghost" onClick={onDismiss}>
              Next
            </button>
          </>
        ) : ok ? (
          <>
            <button type="button" className="btn btn--primary btn--lg mc-result__serve" onClick={() => onServe(attendee.id, result.method)}>
              <Icon name="utensils" />
              Serve {slot.kind === "snack" ? "snack" : "meal"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onDismiss}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--outline" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}
