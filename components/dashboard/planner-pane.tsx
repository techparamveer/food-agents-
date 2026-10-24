"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { clock, money, useDashboard } from "@/components/dashboard/data";
import { Icon } from "@/components/dashboard/icon";
import { RestaurantTile } from "@/components/dashboard/parts";

/* Chat pane → Gemini food planner. A stub: it replies from a script until the planner
   thread wires Gemini in behind `send`. */

/** Sends a message to the planner. */
export type Ask = (text: string) => void;

/** What other panels can ask the planner to do. */
export type PlannerApi = { send: Ask };

export type PlannerContext = {
  /** What the planner says about whatever is open in the panel. */
  prompt: string;
  suggestions: string[];
};

type Turn = { key: string; role: "user" | "assistant"; text: string; pending?: boolean };

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

const STUB_REPLY =
  "I'm not connected to Gemini yet, so I can't plan live. The seeded OxHack plan is in Orders, and every slot can be swapped there.";

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
  const logRef = useRef<HTMLDivElement>(null);

  const question = "Feed 150 by 7pm tonight, under £1,300";
  const update = (key: string, patch: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.key === key ? patch(t) : t)));

  const scripted = useRef<() => void>(undefined);
  const beat = useBeats(BEATS, autoplay, (next) => {
    scripted.current?.();
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

  const send = (text: string) => {
    const typed = text.trim();
    if (!typed) return;
    const key = `t${Date.now()}`;
    setDraft("");
    setTurns((all) => [...all, { key: `${key}u`, role: "user", text: typed }, { key, role: "assistant", text: "", pending: true }]);
    window.setTimeout(() => update(key, (t) => ({ ...t, text: STUB_REPLY, pending: false })), 600);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  // Hand other panels a way to talk to the planner.
  const api = useRef<PlannerApi>({ send: () => {} });
  useEffect(() => {
    api.current.send = send;
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
              <Typed text="Hi. I've planned every OxHack meal against your budget and dietary mix." play={autoplay} onGrow={follow} />
            </p>
          </div>
        )}

        {beat >= PLAN && <PlanCard progress={beat < FOUND ? beat - PLAN : undefined} />}

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
              {turn.pending && !turn.text ? (
                <span className="ag__typing" aria-label="The planner is typing">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <RichText text={turn.text} />
              )}
            </div>
          ),
        )}
      </div>

      <div className="ag__foot">
        <div className="ag__chips">
          {context.suggestions.map((s) => (
            <button key={s} type="button" className="ag__chip" disabled={playing} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        <form className="ag__composer" onSubmit={onSubmit}>
          <input
            placeholder="Feed 150, 20 vegan, by 7pm, under £600…"
            aria-label="Message the planner"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="ag__call" aria-label="Send" disabled={playing || !draft.trim()}>
            <Icon name="arrowUp" />
          </button>
        </form>
      </div>
    </section>
  );
}

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

/** Tool-result card: the meal plan, one restaurant per slot. */
function PlanCard({ progress }: { progress?: number }) {
  const { event, slots, plan, restaurantById } = useDashboard();
  const [open, setOpen] = useState(true);
  const working = progress !== undefined;
  const steps = [
    `Splitting ${event.headcount} people by dietary need`,
    `Proposing ${slots.length} meal slots from the event dates`,
    "Comparing nearby restaurants by cost per head and ETA",
    `Keeping the total under ${money(event.budget)}`,
  ];

  return (
    <div className="tool">
      <button type="button" className="tool__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tool__title">Meal plan</span>
        {working ? (
          <span className="tool__status tool__status--busy">
            <span className="tool__spinner" aria-hidden="true" />
            Planning
          </span>
        ) : (
          <span className="tool__status">
            <Icon name="check" />
            Done
          </span>
        )}
        <Icon name="chevronDown" className="tool__chevron" />
      </button>
      {open && working && (
        <ol className="tool__steps">
          {steps.slice(0, progress + 1).map((step, i) => (
            <li key={step} className={i < progress ? "is-done" : undefined}>
              {i < progress ? <Icon name="check" /> : <span className="tool__spinner" aria-hidden="true" />}
              {step}
            </li>
          ))}
        </ol>
      )}
      {open && !working && (
        <>
          <p className="tool__summary">
            {slots.length} meals → {money(plan.total.value)} est. of {money(event.budget)}
          </p>
          <ul className="ag__cards">
            {plan.slots.map((p) => {
              const slot = slots.find((s) => s.id === p.slotId)!;
              const restaurant = restaurantById(p.restaurantId);
              return (
                <li key={p.slotId}>
                  <span className="ag__card">
                    <RestaurantTile restaurant={restaurant} size="sm" />
                    <span className="ag__card-text">
                      <span className="ag__card-title">{slot.label}</span>
                      <span className="ag__card-meta">
                        {restaurant.name} · {clock(slot.servesAt)}
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
