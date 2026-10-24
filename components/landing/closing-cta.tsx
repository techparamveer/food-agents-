import Link from "next/link";

export function ClosingCta() {
  return (
    <section className="lp-cta" aria-labelledby="cta-title">
      <div className="site">
        <div className="lp-cta__card lp-reveal">
          <h2 id="cta-title" className="lp-cta__title">
            Feed everyone, on time, under budget
          </h2>
          <p className="lp-cta__sub">Tell Comeda your headcount, budget and dates, and it plans every meal for you to approve.</p>
          <div className="lp-cta__actions">
            <Link className="btn btn--primary btn--lg" href="/demo">
              Try the OxHack demo
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
            <Link className="btn btn--outline btn--lg" href="/login">
              Organiser sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
