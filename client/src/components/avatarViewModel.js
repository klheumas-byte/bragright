export function getAvatarInitials(value, fallback = "BR") {
  return String(value || fallback)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
