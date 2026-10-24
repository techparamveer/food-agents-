"use client";

import { Icon } from "@/components/dashboard/icon";

export function PrintButton() {
  return (
    <button type="button" className="btn btn--primary" onClick={() => window.print()}>
      <Icon name="printer" />
      Print
    </button>
  );
}
