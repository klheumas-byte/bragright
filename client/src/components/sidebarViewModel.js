import { getAvatarInitials } from "./avatarViewModel.js";

export function getSidebarIdentity(user) {
  const displayName = String(user?.display_name || user?.username || user?.email || "Signed-in user");
  const username = String(user?.username || "").replace(/^@/, "");
  const initialsSource = user?.display_name || user?.username || user?.email || "";
  return {
    displayName,
    username,
    initials: initialsSource ? getAvatarInitials(initialsSource) : "",
    image: user?.profile_image || "",
  };
}

export function getSidebarAvatarMode(identity, imageFailed = false) {
  if (identity?.image && !imageFailed) {
    return "image";
  }
  if (identity?.initials) {
    return "initials";
  }
  return "default";
}
