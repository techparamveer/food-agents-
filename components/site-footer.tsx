import Link from "next/link";
import { Logo } from "@/components/logo";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
  { href: "/demo", label: "Demo" },
  { href: "/login", label: "Login" },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <Logo />
            <p>Food planning for hackathon organisers.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="site-footer__links">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link className="link-muted" href={l.href}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="site-footer__legal">© {new Date().getFullYear()} Comeda</p>
        </div>
      </div>
    </footer>
  );
}
