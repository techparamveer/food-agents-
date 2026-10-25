import type { CSSProperties } from "react";
import Link from "next/link";

/* Pizza 01 from Hugeicons (https://hugeicons.com/icon/pizza-01), MIT License, © 2025 Hugeicons.
   Its five strokes grow in turn with Sprout's staggered logo animation: the slice rises from
   its centre, the crust draws out from its left end, then each topping pops in. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link className="logo" href={href} aria-label="Comeda home">
      <svg
        className="logo__mark"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          className="logo__seg logo__seg--base"
          style={{ "--i": 0 } as CSSProperties}
          d="M10.2201 18.821L18.6793 13.1312C20.1246 12.159 20.8472 11.673 20.9785 10.7879C21.1098 9.90283 20.6352 9.30806 19.686 8.11852C17.5076 5.3886 14.548 3.35345 11.1624 2.38141C9.87428 2.01158 9.23023 1.82667 8.53978 2.2186C7.84933 2.61053 7.62404 3.37564 7.17348 4.90586L4.40648 14.3032C3.11201 18.6995 2.46477 20.8977 3.54764 21.7392C4.63051 22.5807 6.49371 21.3275 10.2201 18.821Z"
        />
        <path
          className="logo__seg logo__seg--right"
          style={{ "--i": 1 } as CSSProperties}
          d="M7.5 5C7.5 5 8.03795 5.1182 8.90014 5.38146C11.6322 6.21565 14.0691 7.83278 16 10.0001"
        />
        <path
          className="logo__seg logo__seg--base"
          style={{ "--i": 2 } as CSSProperties}
          d="M6.4203 7.95312C7.49617 8.24808 8.18093 9.23142 8.18093 10.4264C8.18093 12.0936 6.56098 13.3678 4.96094 12.9134"
        />
        <path
          className="logo__seg logo__seg--base"
          style={{ "--i": 3 } as CSSProperties}
          d="M12.8361 16.7619C12.5399 15.6169 11.6875 15.0625 10.5384 15.0625C9.15372 15.0625 8.03125 16.2813 8.03125 17.7848C8.03125 18.5814 8.21305 19.1322 8.71526 19.63"
        />
        <path
          className="logo__seg logo__seg--base"
          style={{ "--i": 4 } as CSSProperties}
          d="M13.125 11H13M13.25 11C13.25 11.1381 13.1381 11.25 13 11.25C12.8619 11.25 12.75 11.1381 12.75 11C12.75 10.8619 12.8619 10.75 13 10.75C13.1381 10.75 13.25 10.8619 13.25 11Z"
        />
      </svg>
      <span className="logo__word">comeda</span>
    </Link>
  );
}
