"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/dashboard/icon";

/** Organiser sign-in. Accounts aren't live yet, so every route leads to the OxHack demo. */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    router.push("/demo");
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <Logo href="/" />
        <form onSubmit={onSubmit} className="auth__form">
          <div>
            <h1>Sign in to Comeda</h1>
            <p className="auth__sub">Organiser accounts are coming soon. Until then, explore the OxHack demo.</p>
          </div>
          <label className="auth__field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@hackathon.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary auth__submit">
            Continue to the demo
            <Icon name="arrowRight" />
          </button>
          <Link className="btn btn--ghost" href="/demo">
            Skip and open the demo
          </Link>
        </form>
      </div>
    </div>
  );
}
