export function getAvatarInitials(value, fallback = "BR") {
  return String(value || fallback)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

const AVATAR_COLORWAYS = ["violet", "blue", "orange"];

// Deterministic per-player colorway so opponent lists stay colorful and each
// player is easy to tell apart, while the same player always gets the same color.
export function getAvatarColorway(seed) {
  const value = String(seed || "").trim();
  if (!value) return AVATAR_COLORWAYS[0];
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLORWAYS[hash % AVATAR_COLORWAYS.length];
}
