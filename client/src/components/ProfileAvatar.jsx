import { useEffect, useState } from "react";
import { getApiAssetUrl } from "../services/api";
import { getAvatarColorway, getAvatarInitials } from "./avatarViewModel";
import SidebarIcon from "./SidebarIcon";

export default function ProfileAvatar({
  image,
  name = "",
  seed = "",
  className = "",
  size = "lg",
  isWinner = false,
  isCurrent = false,
  loading = "lazy",
}) {
  const imageUrl = getApiAssetUrl(image);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const accessibleName = String(name || "").trim() || "Player";
  const initials = getAvatarInitials(name, "");
  const colorway = getAvatarColorway(seed || name);

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [imageUrl]);

  const showImage = Boolean(imageUrl) && !imageFailed;

  return (
    <div
      className={[
        "profile-avatar",
        `profile-avatar--${size}`,
        `profile-avatar--colorway-${colorway}`,
        isWinner ? "profile-avatar--winner" : "",
        isCurrent ? "profile-avatar--current" : "",
        className,
      ].filter(Boolean).join(" ")}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : `${accessibleName} avatar fallback`}
    >
      {showImage && !imageLoaded ? <span className="profile-avatar-placeholder" aria-hidden="true" /> : null}
      {showImage ? (
        <img
          src={imageUrl}
          alt={`${accessibleName} profile avatar`}
          className={`profile-avatar-image${imageLoaded ? " profile-avatar-image--loaded" : ""}`}
          loading={loading}
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)}
        />
      ) : initials ? (
        <span className="profile-avatar__initials" aria-hidden="true">{initials}</span>
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
