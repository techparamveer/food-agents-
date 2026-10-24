"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { createQrDetector, type QrDetector, type QrEngine } from "@/lib/qr-detector";

/* Camera QR scanner. Needs a secure context (HTTPS or localhost) for getUserMedia; anywhere
   else it explains why and offers "Scan a photo", which decodes a picture from the camera roll. */

type Status = "idle" | "starting" | "scanning" | "error";

/** The same code held in front of the camera fires once, not every frame. */
const REPEAT_MS = 2500;
const FRAME_MS = 180;

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied. Allow it in the browser's site settings.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is busy in another app.";
  return "Couldn't start the camera.";
}

export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [engine, setEngine] = useState<QrEngine | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  });

  const emit = (text: string) => {
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.text === text && now - last.at < REPEAT_MS) {
      lastRef.current = { text, at: now };
      return;
    }
    lastRef.current = { text, at: now };
    navigator.vibrate?.(40);
    onScanRef.current(text);
  };

  const stop = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => stop, []);

  const loop = (detector: QrDetector) => {
    const tick = async () => {
      const video = videoRef.current;
      if (!streamRef.current || !video) return;
      if (video.readyState >= 2) {
        try {
          const [code] = await detector.detect(video);
          if (code?.rawValue) emit(code.rawValue);
        } catch {
          // A dropped frame; try the next one.
        }
      }
      if (streamRef.current) timerRef.current = window.setTimeout(tick, FRAME_MS);
    };
    tick();
  };

  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setMessage("The camera needs HTTPS or localhost. Search by name, or scan a photo instead.");
      return;
    }
    setStatus("starting");
    setMessage("");
    try {
      const [{ detector, engine }, stream] = await Promise.all([
        createQrDetector(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
      ]);
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setEngine(engine);
      setStatus("scanning");
      loop(detector);
    } catch (error) {
      stop();
      setStatus("error");
      setMessage(cameraError(error));
    }
  };

  const scanPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { detector, engine } = await createQrDetector();
      setEngine(engine);
      const bitmap = await createImageBitmap(file);
      const [code] = await detector.detect(bitmap);
      bitmap.close();
      if (code?.rawValue) {
        lastRef.current = null;
        emit(code.rawValue);
        if (status === "error") setStatus("idle");
      } else {
        setStatus("error");
        setMessage("No QR code found in that photo.");
      }
    } catch {
      setStatus("error");
      setMessage("Couldn't read that photo.");
    }
  };

  const live = status === "scanning" || status === "starting";

  return (
    <div className="mc-scanner">
      <div className={live ? "mc-scanner__view is-live" : "mc-scanner__view"}>
        <video ref={videoRef} playsInline muted aria-label="Camera preview" />
        {live ? (
          <span className="mc-scanner__frame" aria-hidden="true" />
        ) : (
          <div className="mc-scanner__idle">
            <Icon name="qr" />
            <p>{status === "error" ? message : "Point the camera at an attendee's QR code."}</p>
            <button type="button" className="btn btn--primary" onClick={start}>
              <Icon name="scan" />
              {status === "error" ? "Try the camera again" : "Start camera"}
            </button>
          </div>
        )}
      </div>
      <div className="mc-scanner__bar">
        <span className="card__meta" role="status">
          {status === "starting" ? "Starting camera…" : status === "scanning" ? "Scanning" : "Camera off"}
          {engine && live && <span className="mc-scanner__engine">{engine === "native" ? "Built-in decoder" : "WASM decoder"}</span>}
        </span>
        <span className="card__actions">
          <label className="btn btn--ghost mc-scanner__photo">
            <input type="file" accept="image/*" onChange={(e) => {
              scanPhoto(e.target.files?.[0]);
              e.target.value = "";
            }} />
            Scan a photo
          </label>
          {live && (
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                stop();
                setStatus("idle");
              }}
            >
              Stop
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
