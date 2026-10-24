"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/logo";

const NAV_ITEMS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
  { href: "/demo", label: "Demo" },
] as const;

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="site">
        <div className="site-header__bar">
          <div className="site-header__left">
            <Logo />
          </div>

          <nav className="primary-nav" aria-label="Primary">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link className="link-muted" href={item.href}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-header__right">
            <div className="site-header__actions">
              <Link className="btn btn--outline" href="/login">
                Login
              </Link>
              <Link className="btn btn--primary" href="/demo">
                Try the demo
              </Link>
              <button
                className="btn btn--icon site-header__menu"
                type="button"
                aria-controls="mobile-menu"
                aria-expanded={menuOpen}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 5h16" />
                  <path d="M4 12h16" />
                  <path d="M4 19h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mobile-menu" id="mobile-menu" hidden={!menuOpen}>
        <div className="site">
          <nav aria-label="Mobile">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
}
