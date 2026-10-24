import type { CSSProperties } from "react";
import Link from "next/link";
import { AppDemo } from "@/components/app-demo";
import { HeroCollage } from "@/components/hero-collage";

export function Hero() {
  return (
    <section className="hero">
      <HeroCollage />
      <div className="hero__veil" aria-hidden="true" />

      <div className="site hero__grid">
        <div className="hero__copy">
          <div className="hero__intro">
            <h1 className="hero__title">
              <span className="hero-line" style={{ "--d": "0.35s" } as CSSProperties}>
                Food planning for{" "}
              </span>
              <span className="hero-line" style={{ "--d": "0.45s" } as CSSProperties}>
                hackathon organisers
              </span>
            </h1>
            <p className="hero__sub hero-rise" style={{ "--d": "0.55s" } as CSSProperties}>
              Comeda plans every meal of your event: the right restaurants, quantities for every dietary need and order
              deadlines that keep the total under budget.
            </p>
          </div>
          <div className="hero__ctas hero-rise" style={{ "--d": "0.65s" } as CSSProperties}>
            <Link className="btn btn--primary btn--lg" href="/demo">
              Try the OxHack demo
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        <div
          className="hero__card"
          style={{ "--d": "0.85s" } as CSSProperties}
          role="img"
          aria-label="The Comeda dashboard: meal slots, restaurant picks, order deadlines and a food planner chat"
        >
          <AppDemo />
        </div>
      </div>
    </section>
  );
}
