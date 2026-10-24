"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/* Below this card width the dashboard is shown at phone size rather than shrunk. */
const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const PHONE_BREAKPOINT = 560;

export function AppDemo() {
  const appRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const design = width < PHONE_BREAKPOINT ? PHONE_WIDTH : DESKTOP_WIDTH;
      const scale = Math.min(1, width / design);
      setFrame({ width: width / scale, height: height / scale, scale });
    });
    observer.observe(app);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app" data-halftone-occluder="" ref={appRef}>
      {frame && (
        <iframe
          className={loaded ? "app__frame is-loaded" : "app__frame"}
          src="/demo?play=1"
          title="Comeda dashboard preview"
          tabIndex={-1}
          aria-hidden="true"
          onLoad={() => setLoaded(true)}
          style={
            {
              "--frame-w": `${frame.width}px`,
              "--frame-h": `${frame.height}px`,
              "--frame-scale": frame.scale,
            } as CSSProperties
          }
        />
      )}
    </div>
  );
}
