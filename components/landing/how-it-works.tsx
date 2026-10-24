import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/dashboard/icon";

type Step = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  art: ReactNode;
};

const STEPS: Step[] = [
  {
    id: "tell",
    kicker: "Tell Comeda about your event",
    title: "Headcount, budget, dates. Done.",
    body: "Start from sensible defaults: 150 people, £5,000 and a rough dietary mix. Comeda proposes meal slots from your event dates and plans every one.",
    points: ["Dietary mix prefilled, change it any time", "Meal slots from your dates"],
    art: <TellArt />,
  },
  {
    id: "match",
    kicker: "Restaurants near your venue",
    title: "Ranked by cost per head",
    body: "Comeda finds restaurants near the venue, estimates cost per head, delivery fees and ETAs, and picks one per meal that keeps the total under budget.",
    points: ["Every number labelled as an estimate, with its source", "Approve or swap per meal"],
    art: <MatchArt />,
  },
  {
    id: "track",
    kicker: "Every order, by deadline",
    title: "Always know what to order next",
    body: "Each meal becomes one bulk order with quantities by dietary need and an order-by time: serving time, minus prep, minus delivery.",
    points: ["From draft to delivered", "Links straight to the restaurant to order"],
    art: <TrackArt />,
  },
  {
    id: "prep",
    kicker: "Check meals at the table",
    title: "One meal each, no queues",
    body: "Scan an attendee's QR code or search their name. Comeda shows a big tick or a stop, with their Discord name and avatar, and counts meals left.",
    points: ["Works in a phone browser", "Per-meal allowance"],
    art: <PrepArt />,
  },
];

export function HowItWorks() {
  return (
    <section className="lp-section" id="how-it-works" aria-labelledby="how-title">
      <div className="site">
        <div className="lp-head">
          <p className="lp-kicker">How Comeda works</p>
          <h2 id="how-title" className="lp-title">
            From headcount to hot food
          </h2>
          <p className="lp-lead">
            One planner that turns your budget into a menu, keeps every order on time and checks meals at the table.
          </p>
        </div>

        <ol className="how">
          {STEPS.map((step, i) => (
            <li key={step.id} className="how__row lp-reveal">
              <div className="how__copy">
                <p className="how__kicker">
                  <span className="how__num">{i + 1}</span>
                  {step.kicker}
                </p>
                <h3 className="how__title">{step.title}</h3>
                <p className="how__body">{step.body}</p>
                <ul className="how__points">
                  {step.points.map((point) => (
                    <li key={point}>
                      <Icon name="check" className="icon--brand" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="how__art" aria-hidden="true">
                {step.art}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Illustrations: static, simplified copies of the app's own screens ---------- */

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `mock ${className}` : "mock"}>{children}</div>;
}

function ComedaSays({ children }: { children: ReactNode }) {
  return (
    <div className="mock-say">
      <span className="mock-say__avatar">
        <Icon name="pizza" className="icon--brand" />
      </span>
      <p>{children}</p>
    </div>
  );
}

function TellArt() {
  const steps: { label: string; icon: IconName; state: "done" | "active" | "todo" }[] = [
    { label: "Event & venue", icon: "pin", state: "done" },
    { label: "Headcount & budget", icon: "wallet", state: "done" },
    { label: "Dietary mix", icon: "leaf", state: "active" },
    { label: "Meal slots", icon: "calendar", state: "todo" },
  ];
  const chips = [
    { label: "15% vegetarian", on: true },
    { label: "8% vegan", on: true },
    { label: "4% halal", on: true },
    { label: "3% gluten-free", on: true },
    { label: "Nut-free", on: false },
  ];

  return (
    <div className="art art--tell">
      <Card className="mock-steps">
        {steps.map((s) => (
          <div key={s.label} className="mock-steps__item" data-state={s.state}>
            <span className="mock-steps__icon">
              <Icon name={s.state === "done" ? "check" : s.icon} />
            </span>
            {s.label}
          </div>
        ))}
      </Card>
      <Card className="mock-ask">
        <ComedaSays>Roughly how do your attendees eat?</ComedaSays>
        <div className="mock-chips">
          {chips.map((c) => (
            <span key={c.label} className="mock-chip" data-on={c.on || undefined}>
              {c.on && <Icon name="check" />}
              {c.label}
            </span>
          ))}
        </div>
        <div className="mock-ask__foot">
          <span className="mock-btn mock-btn--primary">Continue</span>
        </div>
      </Card>
    </div>
  );
}

function MatchArt() {
  return (
    <div className="art art--match">
      <Card className="mock-role">
        <div className="mock-role__top">
          <span className="mock-logo mock-logo--mono">N</span>
          <div>
            <p className="mock-role__title">High Street Noodle Bar</p>
            <p className="mock-muted">Pan-Asian · 0.6 km · 4.3 ★</p>
          </div>
        </div>
        <div className="mock-role__facts">
          <div>
            <p className="mock-role__salary">£8 a head</p>
            <p className="mock-muted">Estimate</p>
          </div>
          <div className="mock-role__right">
            <p>ETA 32 min</p>
            <p className="mock-muted">Prep + travel</p>
          </div>
        </div>
        <div className="mock-why">
          <p className="mock-why__head">
            <Icon name="pizza" className="icon--brand" />
            Why Comeda picked this
          </p>
          <p>Covers every dietary need on your list and keeps Saturday dinner under £1,300.</p>
        </div>
        <div className="mock-role__actions">
          <span className="mock-btn">
            <Icon name="x" />
            Swap
          </span>
          <span className="mock-btn mock-btn--primary">
            <Icon name="check" />
            Approve
          </span>
        </div>
      </Card>
      <Card className="mock-count">
        <span className="mock-count__dot" />
        5 restaurants nearby · 5 meals planned
      </Card>
    </div>
  );
}

function TrackArt() {
  return (
    <div className="art art--track">
      <Card className="mock-task">
        <div className="mock-task__when">
          <strong>17:40</strong>
          <span>Order by</span>
        </div>
        <div className="mock-task__body">
          <div className="mock-task__head">
            <span className="mock-logo mock-logo--sm mock-logo--mono">N</span>
            <div>
              <p className="mock-task__role">Saturday dinner</p>
              <p className="mock-muted">High Street Noodle Bar · 150 meals</p>
            </div>
            <span className="mock-pill mock-pill--urgent">
              <Icon name="clock" />
              Order soon
            </span>
          </div>
          <p className="mock-task__title">Order by 17:40 for 18:30 dinner</p>
          <p className="mock-muted">104 standard, 23 veg, 12 vegan, 6 halal, 5 gluten-free.</p>
          <div className="mock-progress">
            <span className="mock-progress__bar">
              {Array.from({ length: 4 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            Approved 2/4
          </div>
        </div>
      </Card>
      <Card className="mock-task mock-task--quiet">
        <div className="mock-task__when">
          <strong>Sun</strong>
          <span>07:45</span>
        </div>
        <div className="mock-task__body">
          <div className="mock-task__head">
            <span className="mock-logo mock-logo--sm mock-logo--mono">B</span>
            <div>
              <p className="mock-task__role">Sunday breakfast</p>
              <p className="mock-muted">Jericho Bagel Bakery</p>
            </div>
          </div>
          <p className="mock-task__title">Planned, not yet ordered</p>
        </div>
      </Card>
    </div>
  );
}

const MEALS: { label: string; icon: IconName; count: string }[] = [
  { label: "Saturday lunch", icon: "utensils", count: "138/150" },
  { label: "Saturday dinner", icon: "utensils", count: "0/150" },
  { label: "Midnight snack", icon: "pizza", count: "0/150" },
  { label: "Sunday breakfast", icon: "utensils", count: "0/150" },
];

function PrepArt() {
  return (
    <div className="art art--prep">
      <Card className="mock-chat">
        <ComedaSays>Scanned: Amara Ahmed (@amaraahmed).</ComedaSays>
        <div className="mock-me">
          <p>✅ Enjoy Saturday dinner. 1 of 1 meals collected.</p>
        </div>
        <div className="mock-feedback">
          <p className="mock-feedback__row">
            <span className="mock-feedback__tag mock-feedback__tag--good">Fed</span>
            <span>First meal this slot.</span>
          </p>
          <p className="mock-feedback__row">
            <span className="mock-feedback__tag">Next</span>
            <span>Scan the next code, or search by name.</span>
          </p>
        </div>
      </Card>
      <Card className="mock-stages">
        {MEALS.map((s) => (
          <div key={s.label} className="mock-stages__item">
            <Icon name={s.icon} />
            <span>{s.label}</span>
            <span className="mock-muted">{s.count}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
