import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This page is a static landing screen with a WebGL canvas. Cache Components'
  // instant-navigation checks in `next dev` were stalling the request, and
  // Strict Mode double-mounts the canvas (two full landscape paints).
  reactStrictMode: false,
  // The floating "N" badge overlaps the dashboard's account row in demos.
  devIndicators: false,
};

export default nextConfig;
