import type { Metadata } from "next";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { QrCode } from "@/components/qr-code";
import { payloadFor } from "@/lib/qr";
import { OXHACK_ATTENDEES, OXHACK_EVENT } from "@/lib/seed/oxhack";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/meal-check.css";

/* Printable demo QR codes, one per seeded attendee, so the meal check can scan real codes
   from paper or a second screen. The encoded text comes from lib/qr.ts. */

export const metadata: Metadata = {
  title: "Demo QR codes · Comeda",
  robots: { index: false },
};

export default function QrSheetPage() {
  return (
    <main className="qr-sheet">
      <header className="qr-sheet__head">
        <div>
          <h1>{OXHACK_EVENT.name} demo QR codes</h1>
          <p>
            {OXHACK_ATTENDEES.length} attendees with placeholder hashes. Scan them in{" "}
            <Link href="/demo?section=mealcheck">Meal check</Link>.
          </p>
        </div>
        <PrintButton />
      </header>
      <ul className="qr-sheet__grid">
        {OXHACK_ATTENDEES.map((a) => (
          <li key={a.id} className="qr-sheet__card">
            <QrCode value={payloadFor(a)} label={`QR code for ${a.name}`} />
            <span className="qr-sheet__name">{a.name}</span>
            <span className="qr-sheet__meta">@{a.discordHandle}</span>
            <code className="qr-sheet__hash">{a.qrHash}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
