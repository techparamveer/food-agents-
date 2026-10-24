import type { CSSProperties } from "react";
import Link from "next/link";

/* A pizza slice drawn in four strokes: crust, slice, then the toppings. Each segment
   grows in turn with the same staggered animation the logo has always had. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link className="logo" href={href} aria-label="Comeda home">
      <svg
        className="logo__mark"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path className="logo__seg logo__seg--base" style={{ "--i": 0 } as CSSProperties} d="M3.5 6.5c5.4-3.3 11.6-3.3 17 0" />
        <path className="logo__seg logo__seg--stem" style={{ "--i": 1 } as CSSProperties} d="M5 9.2 12 21l7-11.8" />
        <path
          className="logo__seg logo__seg--left"
          style={{ "--i": 2 } as CSSProperties}
          d="M10.6 10.6a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0z"
        />
        <path
          className="logo__seg logo__seg--right"
          style={{ "--i": 3 } as CSSProperties}
          d="M15.6 10.2a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM13.2 15a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"
        />
      </svg>
      <span className="logo__word">comeda</span>
    </Link>
  );
}
