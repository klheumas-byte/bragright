import { useEffect, useState } from "react";
import { getApiAssetUrl } from "../services/api";
import { getAvatarInitials } from "./avatarViewModel";
import SidebarIcon from "./SidebarIcon";

export default function ProfileAvatar({
  image,
  name = "",
  className = "",
}) {
  const imageUrl = getApiAssetUrl(image);
  const [imageFailed, setImageFailed] = useState(false);
  const accessibleName = String(name || "").trim() || "Player";
  const initials = getAvatarInitials(name, "");

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div
      className={`profile-avatar profile-avatar-large ${className}`.trim()}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : `${accessibleName} avatar fallback`}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={`${accessibleName} profile avatar`}
          className="profile-avatar-image"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <SidebarIcon
          name="profile"
          className="profile-avatar-default-icon"
          decorative
        />
      )}
    </div>
  );
}

export { getAvatarInitials } from "./avatarViewModel";
