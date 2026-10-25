import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/dashboard/icon";

const NEEDS = ["Standard", "Vegetarian", "Vegan", "Halal", "Gluten-free"];
const MEALS = ["Breakfast", "Lunch", "Dinner", "Midnight snack"];

export function FeatureGrid() {
  return (
    <section className="lp-section" id="features" aria-labelledby="grid-title">
      <div className="site">
        <div className="lp-head">
          <p className="lp-kicker">Alongside you all weekend</p>
          <h2 id="grid-title" className="lp-title">
            The food lead that never clocks off
          </h2>
        </div>

        <ul className="grid">
          <li className="grid__card grid__card--wide lp-reveal">
            <CardHead icon="chat" title="Plan in plain English">
              “Feed 150, 20 vegan, by 7pm, under £600.” The planner answers with a restaurant, quantities and an
              order deadline.
            </CardHead>
            <div className="grid__ask" aria-hidden="true">
              <div className="grid__q">Feed 150, 20 vegan, by 7pm, under £600</div>
              <div className="grid__input">
                <Icon name="plus" />
                <span>Ask Comeda anything…</span>
                <span className="grid__call">
                  <Icon name="arrowUp" />
                </span>
              </div>
            </div>
          </li>

          <li className="grid__card lp-reveal">
            <CardHead icon="bell" title="Never miss an order deadline">
              Every meal shows when to order by: serving time, minus prep, minus delivery.
            </CardHead>
            <div className="grid__note" aria-hidden="true">
              <span className="grid__note-icon">
                <Icon name="pizza" className="icon--brand" />
              </span>
              <div>
                <p className="grid__note-title">Order dinner by 17:58</p>
                <p className="grid__note-body">Noodle bar · 150 meals · £1,212 est.</p>
              </div>
            </div>
          </li>

          <li className="grid__card lp-reveal">
            <CardHead icon="leaf" title="Every dietary need, counted">
              Quantities split by your dietary mix, for every meal of the event.
            </CardHead>
            <div className="grid__tags" aria-hidden="true">
              {NEEDS.map((r) => (
                <span key={r} className="tag">
                  {r}
                </span>
              ))}
              {MEALS.map((l) => (
                <span key={l} className="tag tag--brand">
                  {l}
                </span>
              ))}
            </div>
          </li>

          <li className="grid__card grid__card--wide lp-reveal">
            <CardHead icon="scan" title="A meal check at the food table">
              Scan each attendee&apos;s QR code, or search by name, and see straight away whether they have a meal left.
            </CardHead>
            <Link className="link-brand grid__link" href="/demo?section=mealcheck">
              Open the meal check
              <Icon name="arrowRight" />
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

function CardHead({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="grid__head">
      <span className="grid__icon">
        <Icon name={icon} />
      </span>
      <h3 className="grid__title">{title}</h3>
      <p className="grid__body">{children}</p>
    </div>
  );
}
