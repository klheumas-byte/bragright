import { useId } from "react";
import { Card } from "./ui";
import PlayerIdentity from "./PlayerIdentity";
import SidebarIcon from "./SidebarIcon";

export default function ProfileIdentityHeader({
  name,
  subtitle,
  image,
  badges,
  metadata = [],
  actions,
  label = "Player profile",
  isLoading = false,
  loader,
  player,
}) {
  const generatedId = useId();
  const titleId = `${generatedId}-profile-title`;

  return (
    <Card
      as="section"
      variant="profile"
      className="profile-hero-card"
      aria-labelledby={isLoading ? undefined : titleId}
      aria-busy={isLoading || undefined}
    >
      <SidebarIcon name="trophy" className="profile-hero-motif" decorative />
      {isLoading ? (
        loader
      ) : (
        <div className="profile-hero-layout">
          <div className="profile-identity-block">
            <div className="profile-identity-copy">
              <p className="profile-identity-label">{label}</p>
              <h2 className="sr-only" id={titleId}>{name || "BragRight Player"}</h2>
              <PlayerIdentity
                player={player || { name, profile_image: image }}
                variant="full"
                className="profile-hero-identity"
                showUsername
              />
              {subtitle ? <p className="profile-hero-email">{subtitle}</p> : null}
              {badges ? <div className="profile-badge-row">{badges}</div> : null}
              {actions ? <div className="profile-header-actions">{actions}</div> : null}
            </div>
          </div>

          {metadata.length ? (
            <dl className="profile-meta-grid">
              {metadata.map((item) => (
                <div className="profile-meta-card" key={item.id}>
                  <dt className="match-score-label">{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      )}
    </Card>
  );
}
