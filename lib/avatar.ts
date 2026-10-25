/* Generated avatars: initials on a colour picked from the name. Inline SVG data URIs,
   so attendee pictures never hit a third-party server. */

/** Discord's default-avatar blurple family plus a few brand-safe extras. */
const COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#1f8137", "#0e7490", "#7c3aed", "#b45309", "#475569"];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function colorFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initialsAvatar(name: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${colorFor(name)}"/>` +
    `<text x="32" y="33" dy=".35em" text-anchor="middle" fill="#fff" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="600">${initials(name)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
