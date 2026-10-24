"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/dashboard/icon";
import { countdown } from "@/lib/countdown";

/* The dashboard's live clock. The event's `now` is where it starts (fixed in the demo so it always
   opens on Saturday afternoon); from there it runs in real time, one shared one-second tick. */

const listeners = new Set<() => void>();
let started = 0;
let elapsed = 0;
let timer: number | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    started ||= Date.now();
    timer = window.setInterval(() => {
      elapsed = Date.now() - started;
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

/** Milliseconds since `base` began, ticking every second. 0 on the server. */
export function useLiveNow(base: string) {
  const ms = useSyncExternalStore(subscribe, () => elapsed, () => 0);
  return Date.parse(base) + ms;
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
