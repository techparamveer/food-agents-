import type { ReactNode } from "react";
import Link from "next/link";

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "Who is Comeda for?",
    a: "Hackathon and event organisers feeding a crowd over a weekend. Organisers sign in; attendees never need an account.",
  },
  {
    q: "Does Comeda place orders?",
    a: "No. Comeda plans each meal and builds the order, then links you to the restaurant or delivery platform to place it yourself.",
  },
  {
    q: "Where do prices and delivery times come from?",
    a: "Nearby restaurants come from Google Places, and per-head costs and delivery fees are estimated with Gemini and Google Search. Every number is labelled as an estimate, with its source.",
  },
  {
    q: "How does the meal check work?",
    a: "Each attendee carries a QR code. Scan it at the food table, or search by name, and Comeda shows whether they still have a meal left in that slot.",
  },
  {
    q: "Can I try it?",
    a: (
      <>
        Yes. The{" "}
        <Link className="link-brand" href="/demo">
          OxHack demo
        </Link>{" "}
        plans 150 people across a weekend in Oxford with a £5,000 budget.
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="lp-section" id="faq" aria-labelledby="faq-title">
      <div className="site">
        <div className="faq">
          <div className="lp-head lp-head--left">
            <p className="lp-kicker">Questions</p>
            <h2 id="faq-title" className="lp-title">
              Good to know
            </h2>
          </div>
          <div className="faq__list">
            {QUESTIONS.map(({ q, a }) => (
              <details key={q} className="faq__item" name="faq">
                <summary>
                  {q}
                  <svg className="icon faq__chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
