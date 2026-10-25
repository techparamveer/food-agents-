import assert from "node:assert/strict";
import { heuristicEstimates } from "@/lib/restaurants/estimate-parse";
import { faviconServiceUrl, pickIcon, pngSize, publicUrl } from "@/lib/restaurants/logo";
import { scoreRestaurants } from "@/lib/restaurants/rank";
import { DEFAULT_VENUE, seedPlaces } from "@/lib/restaurants/seed";

/* Logos come from the restaurant's own site: its biggest declared icon, never a mask outline or a
   16 px favicon, and the server only ever fetches public web hosts. */

const page = "https://www.example-diner.co.uk/locations/oxford";

/* ---------- picking an icon ---------- */

assert.equal(
  pickIcon(
    `<link rel="icon" href="/favicon-16.png" sizes="16x16">
     <link rel="icon" type="image/png" href="/icon-192.png" sizes="192x192">
     <link rel='apple-touch-icon' href='/touch.png'>
     <link rel="mask-icon" href="/mask.svg" sizes="any">`,
    page,
  ),
  "https://www.example-diner.co.uk/icon-192.png",
  "a 192 px icon beats an unsized apple-touch-icon (180 by convention)",
);
assert.equal(
  pickIcon(`<LINK REL="apple-touch-icon" SIZES="180x180" HREF="https://cdn.example.com/a.png?v=1&amp;w=180"><link rel="icon" href="/f.ico">`, page),
  "https://cdn.example.com/a.png?v=1&w=180",
  "case-insensitive, absolute hrefs kept, &amp; decoded",
);
assert.equal(pickIcon(`<link rel="apple-touch-icon" sizes="180x180" href="/t.png"><link rel="icon" sizes="180x180" href="/i.png">`, page), "https://www.example-diner.co.uk/t.png", "ties go to the apple-touch-icon");
assert.equal(pickIcon(`<link rel="shortcut icon" href="/favicon.ico"><link rel="icon" sizes="32x32" href="/32.png">`, page), null, "only small favicons → no logo");
assert.equal(pickIcon(`<link rel="mask-icon" href="/m.svg" sizes="any">`, page), null, "mask icons are one-colour outlines");
assert.equal(
  pickIcon(`<link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`, page),
  "https://www.example-diner.co.uk/apple-touch-icon.png",
  "sizes=any on a .ico is a small favicon bundle, not a big logo",
);
assert.equal(pickIcon(`<link rel="icon" href="/favicon.ico" sizes="any">`, page), null);
assert.equal(pickIcon(`<link rel="icon" type="image/svg+xml" href="/logo" sizes="any">`, page), "https://www.example-diner.co.uk/logo", "sizes=any on an SVG scales");
assert.equal(pickIcon(`<link rel="apple-touch-icon" href="http://insecure.example.com/t.png">`, page), null, "http icons would be blocked as mixed content");
assert.equal(pickIcon(`<link rel="apple-touch-icon" href="https://127.0.0.1/t.png">`, page), null);
assert.equal(pickIcon(`<link rel="stylesheet" href="/x.css"><link rel="preload" href="/icon.png">`, page), null);
assert.equal(pickIcon("", page), null);

/* ---------- only public hosts ---------- */

for (const bad of ["http://localhost:3000/", "https://10.0.0.5/", "http://169.254.169.254/latest", "https://[::1]/", "https://intranet/", "ftp://example.com/x", "file:///etc/passwd", "https://user:pw@example.com/", "https://printer.local/", "nonsense"]) {
  assert.equal(publicUrl(bad), null, bad);
}
assert.equal(publicUrl("/logo.png", "https://shakeshack.co.uk/locations/")?.href, "https://shakeshack.co.uk/logo.png");
assert.equal(publicUrl("http://www.handlebaroxford.com/")?.hostname, "www.handlebaroxford.com");

/* ---------- favicon service ---------- */

assert.equal(faviconServiceUrl("gails.com"), "https://www.google.com/s2/favicons?domain=gails.com&sz=128");
const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
new DataView(png.buffer).setUint32(16, 128);
new DataView(png.buffer).setUint32(20, 96);
assert.deepEqual(pngSize(png), { width: 128, height: 96 });
assert.equal(pngSize(new Uint8Array([0xff, 0xd8, 0xff])), null);

/* ---------- restaurants carry a logo route only when they have a website ---------- */

const [place] = seedPlaces(DEFAULT_VENUE);
const live = { ...place, placeId: "ChIJ-logo-test", websiteUrl: "https://gails.com/pages/jericho" };
const scored = scoreRestaurants(
  [live, { ...live, id: "x2", placeId: "ChIJ-no-site", websiteUrl: undefined }, { ...place, id: "seed-only" }],
  new Map([live.id, "x2", "seed-only"].map((id) => [id, heuristicEstimates(live, 150)])),
  { headcount: 150, slot: new Date("2026-11-14T18:30:00Z"), source: "live", venue: DEFAULT_VENUE },
);
const byId = (id: string) => scored.find((r) => r.id === id)!;
const [withSite, withoutSite, seeded] = [byId(live.id), byId("x2"), byId("seed-only")];
assert.equal(withSite.logoUrl, "/api/restaurants/logo?place=ChIJ-logo-test", "the browser asks our route, never the site directly");
assert.equal(withoutSite.logoUrl, undefined);
assert.equal(seeded.logoUrl, undefined, "seeded restaurants have no place id: letters");

console.log("test-logos: ok");
