"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { clock, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { EstimateValue, RestaurantTile } from "@/components/dashboard/parts";
import { usePlanner } from "@/components/dashboard/planner-state";
import { iso, londonClock, londonDay, londonInstant } from "@/lib/london-time";
import { budgetSummary, mergeRestaurants, type PlannerForm } from "@/lib/plan-sync";
import type { MealPlan, SlotPlan } from "@/lib/planner";
import type { SearchInfo } from "@/lib/restaurant-search";
import { DIETARY, type Dietary, type OrderLine, type Restaurant } from "@/lib/types";

/* Chat pane → the Comeda food planner. "Get it done" runs the deterministic planner on the
   organiser's numbers; the chat below sends free text to Gemini (or rules, without a key),
   which calls the same planner and restaurant search as tools. */

/** Sends a message to the planner. */
export type Ask = (text: string) => void;

/** What other panels can ask the planner to do. */
export type PlannerApi = { send: Ask };

export type PlannerContext = {
  /** What the planner says about whatever is open in the panel. */
  prompt: string;
  suggestions: string[];
};

/** One rendered turn. Assistant turns fill in as the stream arrives. */
type Turn = {
  key: string;
  role: "user" | "assistant";
  text: string;
  tool?: string;
  plan?: MealPlan;
  restaurants?: Restaurant[];
  model?: string;
  /** The server's signature over `text`; history turns without one are ignored by the server. */
  sig?: string;
  pending?: boolean;
  error?: string;
};

/* Autoplay script for the landing page demo. Each entry is the wait (ms) before the next beat:
   1 greet · 2 planning starts · 3-5 steps tick off · 6 plan in · 7 nudge ·
   8 the organiser types · 9 sends · 10 the planner replies. */
const BEATS = [600, 1300, 900, 900, 900, 900, 1500, 2200, 1700, 1300];
const GREET = 1;
const PLAN = 2;
const FOUND = 6;
const NUDGE = 7;
const TYPE = 8;
const SEND = 9;
const REPLY = 10;

const DEMO_REPLY = `Here's how I'd feed 150 by 7pm under £1,300:

- **Restaurant:** High Street Noodle Bar, 0.6 km away
- **Quantities:** 104 standard, 23 veg, 12 vegan, 6 halal, 5 gluten-free
- **Estimated total:** £1,212 including delivery
- **Order by 17:58** so it lands at 18:30

Want me to open the order builder?`;

const MAX_MESSAGE = 2000;

export function PlannerPane({
  context,
  onHide,
  onReady,
  autoplay = false,
}: {
  context: PlannerContext;
  onHide: () => void;
  /** Receives the planner's API on mount, and null on unmount. */
  onReady?: (api: PlannerApi | null) => void;
  /** Play a scripted session instead of waiting for input (landing page hero). */
  autoplay?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const data = useDashboard();
  const logRef = useRef<HTMLDivElement>(null);

  const question = "Feed 150 by 7pm tonight, under £1,300";
  const update = (key: string, patch: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.key === key ? patch(t) : t)));

  const scripted = useRef<() => void>(undefined);
  const planner = usePlanner();
  const beat = useBeats(BEATS, autoplay, (next) => {
    scripted.current?.();
    // The tour plans the seeded event offline: landing-page visitors never trigger live searches.
    if (next === FOUND && !planner.mealPlan) void planner.run(planner.form, { live: false });
    if (next === TYPE) scripted.current = stream(question, (text) => setDraft(text));
    if (next === SEND) {
      setDraft("");
      setTurns([
        { key: "demo-q", role: "user", text: question },
        { key: "demo-a", role: "assistant", text: "", pending: true },
      ]);
    }
    if (next === REPLY)
      scripted.current = stream(DEMO_REPLY, (text, done) => update("demo-a", (t) => ({ ...t, text, pending: !done })));
  });
  useEffect(() => () => scripted.current?.(), []);
  const playing = autoplay && beat < BEATS.length;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, context.prompt, beat]);
  const follow = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  };

  /** Sends one message and streams the reply (see lib/server/food-chat.ts for the events). */
  const send = async (text: string) => {
    const typed = text.trim().slice(0, MAX_MESSAGE);
    if (!typed || busy) return;
    const key = `t${Date.now()}`;
    const history = turns.filter((t) => t.text && !t.pending && !t.error).map((t) => ({ role: t.role, text: t.text, sig: t.sig }));
    setDraft("");
    setBusy(true);
    setTurns((all) => [...all, { key: `${key}u`, role: "user", text: typed }, { key, role: "assistant", text: "", pending: true }]);
    // The server's own words when it refuses (rate limit); anything else gets the generic line.
    let refusal = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: typed, history, state: budgetSummary(data) }),
      });
      if (!res.ok || !res.body) {
        const reason = await res.json().then((b: { error?: unknown }) => b.error, () => undefined);
        if (res.status === 429 && typeof reason === "string") refusal = reason;
        throw new Error(`Chat failed: ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "tool") update(key, (t) => ({ ...t, tool: event.label }));
          else if (event.type === "plan") {
            // Live restaurants aren't in the seeded event yet: add them so the cards can name them.
            data.update((d) => mergeRestaurants(d, event.restaurants ?? []));
            update(key, (t) => ({ ...t, plan: event.plan }));
          } else if (event.type === "restaurants") {
            data.update((d) => mergeRestaurants(d, event.restaurants));
            update(key, (t) => ({ ...t, restaurants: event.restaurants }));
          } else if (event.type === "delta") update(key, (t) => ({ ...t, text: t.text + event.text }));
          else if (event.type === "done") update(key, (t) => ({ ...t, pending: false, model: event.model, sig: event.sig }));
          else if (event.type === "error") update(key, (t) => ({ ...t, pending: false, error: event.message }));
        }
      }
      update(key, (t) => ({ ...t, pending: false }));
    } catch {
      update(key, (t) => ({ ...t, pending: false, error: refusal || "Comeda couldn't answer just now. Try again in a moment." }));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  // Hand other panels a way to talk to the planner.
  const api = useRef<PlannerApi>({ send: () => {} });
  useEffect(() => {
    api.current.send = (text) => void send(text);
  });
  useEffect(() => {
    const current = api.current;
    onReady?.(current);
    return () => onReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register once; the API object stays the same.
  }, []);

  return (
    <section className="ag" aria-label="Comeda food planner">
      <button type="button" className="ag__hide" onClick={onHide}>
        <Icon name="panel" />
        Hide
      </button>

      <div className="ag__log" ref={logRef} aria-live="polite">
        <p className="ag__divider">
          <span>Today</span>
        </p>

        {beat >= GREET && (
          <div className="ag__msg">
            <p>
              <Typed
                text="Hi. Tell me your headcount, budget and dates, and I'll plan every meal, split by dietary need and under budget."
                play={autoplay}
                onGrow={follow}
              />
            </p>
          </div>
        )}

        {beat >= PLAN && <GetItDone progress={autoplay && beat < FOUND ? beat - PLAN : undefined} tour={autoplay} />}

        {beat >= NUDGE && (
          <div className="ag__msg" key={context.prompt}>
            <p>
              <Typed text={context.prompt} play={autoplay} onGrow={follow} />
            </p>
          </div>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <p key={turn.key} className="ag__mine">
              {turn.text}
            </p>
          ) : (
            <div key={turn.key} className="ag__msg">
              {turn.tool && <ToolDone label={turn.tool} busy={Boolean(turn.pending && !turn.plan && !turn.restaurants)} />}
              {turn.plan && <ChatPlan plan={turn.plan} />}
              {turn.restaurants && <RestaurantRows restaurants={turn.restaurants.slice(0, 4)} />}
              {turn.pending && !turn.text ? (
                <span className="ag__typing" aria-label="The planner is typing">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <RichText text={turn.text} />
              )}
              {turn.error && <p className="ag__error">{turn.error}</p>}
            </div>
          ),
        )}
      </div>

      <div className="ag__foot">
        <div className="ag__chips">
          {context.suggestions.map((s) => (
            <button key={s} type="button" className="ag__chip" disabled={busy || playing} onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
        <form className="ag__composer" onSubmit={onSubmit}>
          <input
            placeholder="Feed 150, 20 vegan, by 7pm, under £600…"
            aria-label="Message the planner"
            value={draft}
            maxLength={MAX_MESSAGE}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="ag__call" aria-label="Send" disabled={busy || playing || !draft.trim()}>
            <Icon name="arrowUp" />
          </button>
        </form>
      </div>
    </section>
  );
}

/* ---------- "Get it done" ---------- */

const PLAN_STEPS = (form: PlannerForm, slots: number) => [
  `Splitting ${form.headcount} people by dietary need`,
  `Proposing ${slots} meal slots from the event dates`,
  "Comparing nearby restaurants by cost per head and ETA",
  `Keeping the total under ${money(form.budget)}`,
];

const STEP_MS = 380;

/** Tool card: the organiser's numbers in, a restaurant per meal out, each one approved or swapped. */
function GetItDone({ progress: scripted, tour = false }: { progress?: number; tour?: boolean }) {
  const { slots } = useDashboard();
  const { mealPlan, form, run } = usePlanner();
  const [open, setOpen] = useState(true);
  // The landing demo never shows the form: its script plans the defaults (see PlannerPane).
  const [editing, setEditing] = useState(!mealPlan && !tour);
  const [step, setStep] = useState<number | undefined>(undefined);
  const [runError, setRunError] = useState("");
  const progress = scripted ?? step;
  const working = progress !== undefined;

  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  const submit = async (next: PlannerForm) => {
    setEditing(false);
    setRunError("");
    setStep(0);
    timers.current.forEach(window.clearTimeout);
    timers.current = [1, 2, 3].map((n) => window.setTimeout(() => setStep(n), n * STEP_MS));
    // The steps tick at their own pace; the card stays on the last one until the live search is back.
    const minimum = new Promise((done) => (timers.current[3] = window.setTimeout(done, 4 * STEP_MS)));
    try {
      await Promise.all([run(next), minimum]);
    } catch (error) {
      setEditing(true);
      setRunError(error instanceof Error ? error.message : "Live Google Places data is unavailable right now.");
    } finally {
      timers.current.forEach(window.clearTimeout);
      setStep(undefined);
    }
  };

  const steps = PLAN_STEPS(form, mealPlan?.slots.length ?? slots.length);
  return (
    <div className="tool">
      <button type="button" className="tool__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tool__title">Get it done</span>
        {working ? (
          <span className="tool__status tool__status--busy">
            <span className="tool__spinner" aria-hidden="true" />
            Planning
          </span>
        ) : mealPlan && !editing ? (
          <span className="tool__status">
            <Icon name="check" />
            Done
          </span>
        ) : null}
        <Icon name="chevronDown" className="tool__chevron" />
      </button>
      {open && working && (
        <ol className="tool__steps">
          {steps.slice(0, progress + 1).map((s, i) => (
            <li key={s} className={i < progress ? "is-done" : undefined}>
              {i < progress ? <Icon name="check" /> : <span className="tool__spinner" aria-hidden="true" />}
              {s}
            </li>
          ))}
        </ol>
      )}
      {open && !working && !tour && (editing || !mealPlan) && (
        <PlanForm initial={form} onSubmit={(next) => void submit(next)} onCancel={mealPlan ? () => setEditing(false) : undefined} />
      )}
      {open && !working && runError && <p className="enq__error">{runError}</p>}
      {open && !working && !editing && mealPlan && <PlanResult plan={mealPlan} onEdit={() => setEditing(true)} />}
    </div>
  );
}

const toLocal = (at: string) => `${londonDay(at)}T${londonClock(at)}`;
const fromLocal = (value: string) => {
  const [day, time] = value.split("T");
  const [h, m] = (time ?? "").split(":").map(Number);
  return day && Number.isFinite(h) && Number.isFinite(m) ? iso(londonInstant(day, h, m)) : "";
};
const pct = (share: number) => String(Math.round(share * 1000) / 10);

function PlanForm({ initial, onSubmit, onCancel }: { initial: PlannerForm; onSubmit: (form: PlannerForm) => void; onCancel?: () => void }) {
  const [headcount, setHeadcount] = useState(String(initial.headcount));
  const [budget, setBudget] = useState(String(initial.budget));
  const [starts, setStarts] = useState(toLocal(initial.startsAt));
  const [ends, setEnds] = useState(toLocal(initial.endsAt));
  const [mix, setMix] = useState<Record<Dietary, string>>(
    () => Object.fromEntries(DIETARY.map((d) => [d.id, pct(initial.dietaryMix[d.id])])) as Record<Dietary, string>,
  );
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const people = Math.round(Number(headcount));
    const pounds = Number(budget.replace(/[£,\s]/g, ""));
    const startsAt = fromLocal(starts);
    const endsAt = fromLocal(ends);
    const shares = Object.fromEntries(DIETARY.map((d) => [d.id, Math.max(0, Number(mix[d.id]) || 0) / 100])) as Record<Dietary, number>;
    if (!(people > 0)) return setError("How many people are you feeding?");
    if (!(pounds > 0)) return setError("Add a budget in pounds.");
    if (!startsAt || !endsAt || endsAt <= startsAt) return setError("The event needs to end after it starts.");
    if (Object.values(shares).reduce((n, s) => n + s, 0) > 1) return setError("The dietary mix adds up to more than 100%.");
    setError("");
    onSubmit({ headcount: people, budget: pounds, startsAt, endsAt, dietaryMix: shares });
  };

  return (
    <form className="tool__body plan-form" onSubmit={submit}>
      <div className="plan-form__grid">
        <label className="enq__field">
          People
          <input className="enq__input" type="number" min={1} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
        </label>
        <label className="enq__field">
          Budget (£)
          <input className="enq__input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
        <label className="enq__field">
          Starts
          <input className="enq__input" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </label>
        <label className="enq__field">
          Ends
          <input className="enq__input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
      </div>
      <fieldset className="plan-form__mix">
        <legend className="tool__label">
          <span>Dietary mix (%)</span>
        </legend>
        {DIETARY.map((d) => (
          <label key={d.id} className="enq__field">
            {d.label}
            <input
              className="enq__input"
              inputMode="decimal"
              value={mix[d.id]}
              onChange={(e) => setMix((m) => ({ ...m, [d.id]: e.target.value }))}
            />
          </label>
        ))}
      </fieldset>
      {error && <p className="enq__error">{error}</p>}
      <div className="mini-role__actions">
        {onCancel && (
          <button type="button" className="mini-role__btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="mini-role__btn mini-role__btn--dark">
          <Icon name="pizza" />
          Get it done
        </button>
      </div>
    </form>
  );
}

const lineLabel = (l: OrderLine) => (l.dietary === "standard" ? "standard" : DIETARY.find((d) => d.id === l.dietary)!.label.toLowerCase());
export const linesText = (lines: OrderLine[]) =>
  [...lines.filter((l) => l.dietary === "standard"), ...lines.filter((l) => l.dietary !== "standard")]
    .filter((l) => l.quantity > 0)
    .map((l) => `${l.quantity} ${lineLabel(l)}`)
    .join(", ");

function PlanResult({ plan, onEdit }: { plan: MealPlan; onEdit: () => void }) {
  const { restaurantById } = useDashboard();
  const { approve, swap } = usePlanner();
  // Open on the first meal the organiser can still change.
  const [index, setIndex] = useState(() => Math.max(0, plan.slots.findIndex((x) => !x.locked)));
  const [swapping, setSwapping] = useState(false);
  const current = Math.min(index, Math.max(plan.slots.length - 1, 0));
  const s: SlotPlan | undefined = plan.slots[current];
  const approved = plan.slots.filter((x) => x.status === "approved").length;
  const go = (i: number) => {
    setIndex(i);
    setSwapping(false);
  };

  return (
    <>
      <p className="tool__summary">
        {plan.slots.length} meals → {money(Math.round(plan.total))} est. of {money(plan.budget)}
        {plan.fits ? ` · ${money(Math.round(plan.remaining))} left` : " · over budget"}
      </p>
      {s ? (
        <div className="tool__body">
          <p className="tool__label">
            <span>{s.locked ? "Already ordered" : s.status === "approved" ? "Approved" : s.status === "swapped" ? "Your pick" : "Picked for you"}</span>
            <span>
              {current + 1} of {plan.slots.length}
            </span>
          </p>
          <div className="tool__stage">
            <article className="mini-role">
              <div className="mini-role__head">
                <RestaurantTile restaurant={restaurantById(s.restaurantId)} />
                <span>
                  <span className="mini-role__title">
                    {s.slot.label} · {restaurantById(s.restaurantId).name}
                  </span>
                  <span className="mini-role__meta">
                    Serves {clock(s.slot.servesAt)} · order by {clock(s.orderBy)} · {money(Math.round(s.cost))} est.
                  </span>
                </span>
              </div>
              <p className="mini-role__why">{linesText(s.lines)}</p>
              <p className="mini-role__why">{s.reason}</p>
              {swapping && (
                <ul className="ag__cards">
                  {s.alternatives.map((a) => (
                    <li key={a.restaurantId}>
                      <button
                        type="button"
                        className="ag__card"
                        onClick={() => {
                          swap(s.slot.id, a.restaurantId);
                          setSwapping(false);
                        }}
                      >
                        <RestaurantTile restaurant={restaurantById(a.restaurantId)} size="sm" />
                        <span className="ag__card-text">
                          <span className="ag__card-title">{a.name}</span>
                          <span className="ag__card-meta">
                            {a.delta >= 0 ? "+" : "−"}
                            {money(Math.abs(Math.round(a.delta)))}
                            {a.note ? ` · ${a.note}` : ""}
                          </span>
                        </span>
                        <Icon name="chevronRight" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!s.locked && (
                <div className="mini-role__actions">
                  <button type="button" className="mini-role__btn" aria-expanded={swapping} onClick={() => setSwapping((o) => !o)}>
                    <Icon name={swapping ? "x" : "swap"} />
                    {swapping ? "Keep" : "Swap"}
                  </button>
                  <button
                    type="button"
                    className={s.status === "approved" ? "mini-role__btn is-saved" : "mini-role__btn mini-role__btn--dark"}
                    aria-pressed={s.status === "approved"}
                    onClick={() => {
                      approve(s.slot.id);
                      if (current < plan.slots.length - 1) go(current + 1);
                    }}
                  >
                    <Icon name="check" />
                    {s.status === "approved" ? "Approved" : "Approve"}
                  </button>
                </div>
              )}
            </article>
            <div className="tool__pager">
              <button type="button" aria-label="Previous meal" disabled={current === 0} onClick={() => go(current - 1)}>
                <Icon name="chevronLeft" />
              </button>
              <button type="button" aria-label="Next meal" disabled={current >= plan.slots.length - 1} onClick={() => go(current + 1)}>
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
          {plan.narrative && <p className="tool__empty">{plan.narrative}</p>}
          {plan.search && <SearchNote search={plan.search} />}
        </div>
      ) : (
        <>
          <p className="tool__empty">{plan.notes[0]}</p>
          {plan.search && <SearchNote search={plan.search} />}
        </>
      )}
      <div className="plan-form__foot">
        <button type="button" className="tool__all" onClick={onEdit}>
          Change the numbers
        </button>
        {approved < plan.slots.length && (
          <button type="button" className="tool__all" onClick={() => approve()}>
            Approve all {plan.slots.length}
          </button>
        )}
      </div>
    </>
  );
}

/** Where the plan's restaurants came from. */
function SearchNote({ search }: { search: SearchInfo }) {
  return (
    <p className="tool__empty">
      {search.source === "fallback"
        ? "Planned with sample restaurant data."
        : `Planned from ${search.count} live Google Places restaurants${search.source === "cache" ? " (cached)" : ""}; ${search.grounded} of their costs are grounded in Google Search, the rest are labelled estimates.`}
      {search.source !== "fallback" && search.warnings.map((w) => ` ${w}`).join("")}
    </p>
  );
}

/* ---------- Chat tool results ---------- */

function ToolDone({ label, busy }: { label: string; busy: boolean }) {
  return (
    <div className="tool">
      <div className="tool__head">
        <span className="tool__title">{label}</span>
        {busy ? (
          <span className="tool__status tool__status--busy">
            <span className="tool__spinner" aria-hidden="true" />
            Working
          </span>
        ) : (
          <span className="tool__status">
            <Icon name="check" />
            Done
          </span>
        )}
      </div>
    </div>
  );
}

/** A plan the chat made. Whole-event plans can replace the current one. */
function ChatPlan({ plan }: { plan: MealPlan }) {
  const { restaurantById } = useDashboard();
  const { run } = usePlanner();
  const [used, setUsed] = useState(false);
  const wholeEvent = !plan.input.slots;
  return (
    <>
      <ul className="ag__cards">
        {plan.slots.map((s) => {
          const r = restaurantById(s.restaurantId);
          return (
            <li key={s.slot.id}>
              <span className="ag__card">
                <RestaurantTile restaurant={r} size="sm" />
                <span className="ag__card-text">
                  <span className="ag__card-title">
                    {s.slot.label} · {money(Math.round(s.cost))}
                  </span>
                  <span className="ag__card-meta">
                    {r.name} · order by {clock(s.orderBy)}
                  </span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {wholeEvent && (
        <button
          type="button"
          className="tool__all"
          disabled={used}
          onClick={() => {
            const { headcount, budget, startsAt, endsAt, dietaryMix } = plan.input;
            void run({ headcount, budget, startsAt, endsAt, dietaryMix });
            setUsed(true);
          }}
        >
          {used ? "Plan updated" : "Use this plan"}
        </button>
      )}
      {plan.search && <SearchNote search={plan.search} />}
    </>
  );
}

function RestaurantRows({ restaurants }: { restaurants: Restaurant[] }) {
  return (
    <ul className="ag__cards">
      {restaurants.map((r) => (
        <li key={r.id}>
          <span className="ag__card">
            <RestaurantTile restaurant={r} size="sm" />
            <span className="ag__card-text">
              <span className="ag__card-title">{r.name}</span>
              <span className="ag__card-meta">
                {r.cuisine} · <EstimateValue estimate={r.costPerHead} format={(n) => `${money(n)}/head`} /> · {r.prepMinutes.value + r.travelMinutes.value} min
              </span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Shared bits ---------- */

/** Steps through `delays`, returning how many beats have fired and calling `onBeat` as each one does.
    Without autoplay every beat has fired; with reduced motion they all fire at once. */
function useBeats(delays: number[], enabled: boolean, onBeat: (beat: number) => void) {
  const [beat, setBeat] = useState(enabled ? 0 : delays.length);
  const onBeatRef = useRef(onBeat);
  useEffect(() => {
    onBeatRef.current = onBeat;
  });
  useEffect(() => {
    if (!enabled) return;
    const pace = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1;
    let at = 0;
    const timers = delays.map((delay, i) => {
      at += delay * pace;
      return window.setTimeout(() => {
        setBeat(i + 1);
        onBeatRef.current(i + 1);
      }, at);
    });
    return () => timers.forEach(window.clearTimeout);
  }, [delays, enabled]);
  return beat;
}

/** Feeds `text` to `onText` a few characters at a time, like a model streaming. Returns a cancel function. */
function stream(text: string, onText: (text: string, done: boolean) => void, step = 3, every = 22) {
  let n = 0;
  const id = window.setInterval(() => {
    n = Math.min(text.length, n + step);
    onText(text.slice(0, n), n === text.length);
    if (n === text.length) window.clearInterval(id);
  }, every);
  return () => window.clearInterval(id);
}

/** Text that streams in when `play` is set, otherwise renders straight away. */
function Typed({ text, play, onGrow }: { text: string; play: boolean; onGrow?: () => void }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (play) return stream(text, (t) => setShown(t));
  }, [play, text]);
  useEffect(() => onGrow?.(), [shown, onGrow]);
  return <>{play ? shown : text}</>;
}

/** Minimal formatting for model replies: paragraphs, "- " bullet lists and **bold**. */
function RichText({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    );
  return (
    <>
      {text
        .trim()
        .split(/\n{2,}/)
        .map((block, i) => {
          const lines = block.split("\n");
          if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
            return (
              <ul key={i} className="ag__list">
                {lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ""))}</li>
                ))}
              </ul>
            );
          }
          return <p key={i}>{inline(block)}</p>;
        })}
    </>
  );
}
