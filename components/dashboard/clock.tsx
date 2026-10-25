"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/dashboard/icon";
import { countdown } from "@/lib/countdown";

/* The dashboard's live clock. It follows the current instant from the browser, with one shared
   one-second tick. `base` is only the stable server-rendered snapshot used during hydration. */

const listeners = new Set<() => void>();
let current = typeof window === "undefined" ? 0 : Date.now();
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = window.setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The current instant in milliseconds, ticking every second. */
export function useLiveNow(base: string) {
  return useSyncExternalStore(subscribe, () => current, () => Date.parse(base));
}

/** A live "3h 05m" pill until `deadline`. Turns urgent inside the hour and says so once it passes. */
export function Countdown({ base, deadline, prefix = "" }: { base: string; deadline: string; prefix?: string }) {
  const now = useLiveNow(base);
  const left = countdown(now, deadline);
  return (
    <span className={left.tone === "overdue" || left.tone === "urgent" ? "pill pill--urgent" : "pill"} role="timer" aria-live="off">
      <Icon name="clock" />
      {prefix}
      {left.label}
    </span>
  );
}
