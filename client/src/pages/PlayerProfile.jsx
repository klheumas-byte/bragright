import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CompetitiveSummary from "../components/CompetitiveSummary";
import CompetitiveBadge from "../components/CompetitiveBadge";
import ErrorState from "../components/ErrorState";
import ProfileIdentityHeader from "../components/ProfileIdentityHeader";
import ProfileMatchList from "../components/ProfileMatchList";
import SectionLoader from "../components/SectionLoader";
import SectionSkeleton from "../components/SectionSkeleton";
import SidebarIcon from "../components/SidebarIcon";
import { Badge, Button, Card, EmptyState, PageSection } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getPublicPlayerProfile } from "../services/api";
import {
  buildPublicCompetitiveStats,
  canChallengePlayer,
  formatProfileDate,
  normalizePublicProfile,
} from "./profileViewModel";

export default function PlayerProfile() {
  const { playerId } = useParams();
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadPlayerProfile();
  }, [playerId]);

  async function loadPlayerProfile({ forceRefresh = false } = {}) {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await trackLoading(() =>
        getPublicPlayerProfile(playerId, { forceRefresh })
      );
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      setProfile(normalizePublicProfile(response?.data));
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      setErrorMessage(error.message || "Player profile could not be loaded.");
      setProfile(null);
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }

  const isOwner = Boolean(user?.id && user.id === profile?.id);
  const showChallenge = canChallengePlayer(user, profile);
  const stats = profile ? buildPublicCompetitiveStats(profile) : [];

  return (
    <DashboardLayout
      title={profile ? `${profile.username} Profile` : "Player Profile"}
      description="Review this player's competitive record and rivalry context."
    >
      <ErrorState
        message={errorMessage}
        onRetry={() => loadPlayerProfile({ forceRefresh: true })}
        retryLabel="Retry profile"
      />

      {isLoading ? (
        <>
          <Card variant="loading" className="profile-hero-card">
            <SectionSkeleton lines={6} />
          </Card>
          <SectionLoader lines={6} message="Loading competitive profile..." />
        </>
      ) : profile ? (
        <>
          <ProfileIdentityHeader
            name={profile.username}
            image={profile.profile_image}
            subtitle="Public competitive profile"
            label="Player identity"
            badges={
              <>
                <CompetitiveBadge kind="rank" value={profile.rank} />
                <CompetitiveBadge kind="points" value={profile.points} />
                <Badge tone={profile.status === "active" ? "success" : "neutral"}>
                  {profile.status}
                </Badge>
              </>
            }
            metadata={[
              {
                id: "member-since",
                label: "Member since",
                value: formatProfileDate(profile.created_at),
              },
              {
                id: "record",
                label: "Confirmed record",
                value: `${profile.wins}-${profile.losses}-${profile.draws}`,
              },
              {
                id: "win-rate",
                label: "Win rate",
                value: `${profile.win_rate}%`,
              },
            ]}
            actions={
              <>
                {isOwner ? (
                  <Button as={Link} to="/profile" variant="primary" size="sm">
                    <SidebarIcon name="profile" decorative /> Edit profile
                  </Button>
                ) : null}
                {showChallenge ? (
                  <Button
                    as={Link}
                    to={`/dashboard/submit-match?opponentId=${encodeURIComponent(profile.id)}`}
                    variant="challenge"
                    size="sm"
                  >
                    <SidebarIcon name="matches" decorative /> Challenge player
                  </Button>
                ) : null}
                <Button as="a" href="#profile-match-history" variant="ghost" size="sm">
                  View match history
                </Button>
                <Button as={Link} to="/leaderboard" variant="ghost" size="sm">
                  Leaderboard
                </Button>
              </>
            }
          />

          <PageSection
            title="Competitive summary"
            description="Confirmed backend statistics used by the public leaderboard."
          >
            <CompetitiveSummary
              stats={stats}
              label={`${profile.username} competitive statistics`}
            />
          </PageSection>

          <PageSection
            title="Recent match history"
            description="The five most recent confirmed public match summaries."
            className="profile-public-history"
            actions={
              <Button as={Link} to="/leaderboard" variant="ghost" size="sm">
                Back to leaderboard
              </Button>
            }
          >
            <span id="profile-match-history" className="profile-anchor-target" />
            {profile.recent_confirmed_matches.length ? (
              <ProfileMatchList
                matches={profile.recent_confirmed_matches}
                profileName={profile.username}
              />
            ) : (
              <Card variant="empty" className="dashboard-panel">
                <EmptyState
                  title="No confirmed matches yet"
                  description="Confirmed public match results will appear here."
                />
              </Card>
            )}
          </PageSection>
        </>
      ) : null}
    </DashboardLayout>
  );
}
