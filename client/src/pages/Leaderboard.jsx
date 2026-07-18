import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import CompetitiveBadge from "../components/CompetitiveBadge";
import {
  CurrentPlayerSkeleton,
  LeaderboardControlsSkeleton,
  LeaderboardHeaderSkeleton,
  LeaderboardListSkeleton,
  LeaderboardPaginationSkeleton,
  TopPlayersSkeleton,
} from "../components/LeaderboardSkeletons";
import ProfileAvatar from "../components/ProfileAvatar";
import SidebarIcon from "../components/SidebarIcon";
import TrophyWatermark from "../components/TrophyWatermark";
import { Badge, Button, Card, EmptyState, Field, PageSection } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getLeaderboard } from "../services/api";
import {
  canChallengeLeaderboardPlayer,
  EMPTY_LEADERBOARD_PAGINATION,
  isCurrentLeaderboardPlayer,
  normalizeLeaderboardResponse,
  normalizeLeaderboardSearch,
} from "./leaderboardViewModel";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function Leaderboard() {
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const [entries, setEntries] = useState([]);
  const [topPlayers, setTopPlayers] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [rankedTotal, setRankedTotal] = useState(0);
  const [pagination, setPagination] = useState(EMPTY_LEADERBOARD_PAGINATION);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextSearch = normalizeLeaderboardSearch(searchInput);
      setPagination((current) => ({ ...current, page: 1 }));
      setSearch(nextSearch);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    loadLeaderboard();
  }, [pagination.page, search, user?.id]);

  async function loadLeaderboard({ forceRefresh = false } = {}) {
    const requestId = ++requestIdRef.current;
    if (hasLoaded) {
      setIsTransitioning(true);
    } else {
      setIsInitialLoading(true);
    }
    setErrorMessage("");

    try {
      const response = await trackLoading(() =>
        getLeaderboard({
          page: pagination.page,
          limit: PAGE_SIZE,
          search,
          playerId: user?.id,
          forceRefresh,
        })
      );
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      const result = normalizeLeaderboardResponse(response?.data);
      setEntries(result.entries);
      setTopPlayers(result.topPlayers);
      setCurrentPlayer(result.currentPlayer);
      setRankedTotal(result.rankedTotal);
      setPagination(result.pagination);
      setHasLoaded(true);
    } catch (error) {
      if (!mountedRef.current || requestIdRef.current !== requestId) {
        return;
      }
      setErrorMessage(error.message || "Leaderboard could not be loaded.");
      if (!hasLoaded) {
        setEntries([]);
        setTopPlayers([]);
        setCurrentPlayer(null);
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setIsInitialLoading(false);
        setIsTransitioning(false);
      }
    }
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setPagination((current) => ({ ...current, page: 1 }));
  }

  return (
    <DashboardLayout
      title="Leaderboard"
      description="See who owns the top spot."
      sidebarRank={currentPlayer?.rank}
    >
      {isInitialLoading ? (
        <LeaderboardHeaderSkeleton />
      ) : (
        <Card
          as="section"
          variant="dashboard"
          className="feature-hero-card leaderboard-hero"
          aria-labelledby="leaderboard-hero-title"
        >
          <TrophyWatermark className="arena-hero-watermark" />
          <div>
            <p className="section-label">Official standings</p>
            <h2 className="feature-hero-title" id="leaderboard-hero-title">
              Confirmed competitive rankings.
            </h2>
            <p className="leaderboard-hero-copy">
              Ordered by backend-confirmed points, wins, and deterministic player-name tie breaking.
            </p>
            <div className="leaderboard-hero-actions">
              <Button as={Link} to="/profile" variant="secondary" size="sm">
                View my profile
              </Button>
              <Button as={Link} to="/dashboard/matches" variant="ghost" size="sm">
                My matches
              </Button>
            </div>
          </div>

          <div className="status-summary-grid" aria-label="Leaderboard summary">
            <CompetitivePill
              label="Your position"
              value={currentPlayer ? `#${currentPlayer.rank}` : "Not listed"}
              tone={currentPlayer ? "confirmed" : "neutral"}
            />
            <CompetitivePill
              label="Your points"
              value={currentPlayer?.points ?? 0}
              tone="pending"
            />
            <CompetitivePill
              label="Ranked players"
              value={rankedTotal}
              tone="neutral"
            />
          </div>
        </Card>
      )}

      <ErrorState
        message={errorMessage}
        onRetry={() => loadLeaderboard({ forceRefresh: true })}
        retryLabel="Retry leaderboard"
      />

      {isInitialLoading ? (
        <CurrentPlayerSkeleton />
      ) : currentPlayer ? (
        <Card
          as="section"
          variant="dashboard"
          className="leaderboard-current-card"
          aria-labelledby="your-position-title"
        >
          <ProfileAvatar
            image={currentPlayer.profile_image}
            name={currentPlayer.username}
            className="leaderboard-avatar"
          />
          <div className="leaderboard-current-copy">
            <Badge tone="info">Your rank</Badge>
            <h2 id="your-position-title">#{currentPlayer.rank} · {currentPlayer.username}</h2>
            <p>
              {currentPlayer.points} points · {currentPlayer.wins} wins ·{" "}
              {currentPlayer.total_matches} confirmed matches
            </p>
          </div>
          <Button as={Link} to={`/players/${currentPlayer.id}`} variant="secondary" size="sm">
            View public profile
          </Button>
        </Card>
      ) : (
        <Card
          as="section"
          variant="information"
          className="leaderboard-current-card"
          aria-labelledby="your-position-title"
        >
          <ProfileAvatar name={user?.username || "Current player"} className="leaderboard-avatar" />
          <div className="leaderboard-current-copy">
            <Badge tone="neutral">Not listed</Badge>
            <h2 id="your-position-title">Your position is not available</h2>
            <p>This account does not currently appear in the official standings.</p>
          </div>
          <Button as={Link} to="/dashboard/matches" variant="secondary" size="sm">
            View my matches
          </Button>
        </Card>
      )}

      <PageSection
        title="Top ranked players"
        description="The leading competitors in the official backend order."
      >
        {isInitialLoading ? (
          <TopPlayersSkeleton />
        ) : topPlayers.length ? (
          <div className="competitive-podium-grid">
            {topPlayers.map((player) => (
              <Card
                as="article"
                variant="dashboard"
                key={player.id}
                className={`podium-card podium-card-rank-${player.rank}`}
              >
                <div className="podium-card-header">
                  <ProfileAvatar
                    image={player.profile_image}
                    name={player.username}
                    className="leaderboard-avatar leaderboard-avatar-top"
                  />
                  <CompetitiveBadge kind="rank" value={player.rank} />
                </div>
                <h3 className="podium-name">{player.username}</h3>
                <p className="podium-meta">
                  {player.wins}-{player.losses}-{player.draws} confirmed record
                </p>
                <strong className="podium-points">{player.points} pts</strong>
                <Button
                  as={Link}
                  to={`/players/${player.id}`}
                  variant="secondary"
                  size="sm"
                  aria-label={`View ${player.username}'s profile`}
                >
                  View profile
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <Card variant="empty" className="dashboard-panel">
            <EmptyState
              title="The ranking awaits"
              description="Players will appear when eligible accounts are available in the official standings."
            />
          </Card>
        )}
      </PageSection>

      <PageSection
        title="Competitive standings"
        description="Search player names without changing the official ranking order."
      >
        {isInitialLoading ? (
          <LeaderboardControlsSkeleton />
        ) : (
          <Card variant="information" className="leaderboard-controls">
            <Field
              label="Search players"
              id="leaderboard-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              maxLength={64}
              placeholder="Search by player name"
              description="Results retain their absolute official rank."
            />
            <div className="leaderboard-order-control" aria-label="Leaderboard filters">
              <span className="match-score-label">Ranking view</span>
              <Badge tone="info">Official order</Badge>
              <p>No additional filters are supported by current competition data.</p>
            </div>
            {searchInput ? (
              <Button variant="ghost" size="sm" onClick={clearSearch}>
                Clear search
              </Button>
            ) : null}
          </Card>
        )}

        <div className="leaderboard-results-status" role="status" aria-live="polite">
          {isTransitioning
            ? search
              ? `Searching for ${search}`
              : `Loading leaderboard page ${pagination.page}`
            : search
              ? `${pagination.total} ${pagination.total === 1 ? "player" : "players"} found for ${search}`
              : `${pagination.total} ranked ${pagination.total === 1 ? "player" : "players"}`}
        </div>

        {isInitialLoading || isTransitioning ? (
          <LeaderboardListSkeleton
            rows={PAGE_SIZE}
            label={search ? "Loading leaderboard search results" : "Loading leaderboard list"}
          />
        ) : errorMessage && !hasLoaded ? null : entries.length ? (
          <div className="leaderboard-list">
            {entries.map((player) => (
              <LeaderboardEntry
                key={player.id}
                player={player}
                viewer={user}
                isCurrent={isCurrentLeaderboardPlayer(player, user?.id)}
              />
            ))}
          </div>
        ) : (
          <Card variant="empty" className="dashboard-panel">
            <EmptyState
              title={search ? "No rivals found" : "The ranking awaits"}
              description={
                search
                  ? "Try another player name or clear the search."
                  : "The official standings are currently empty."
              }
              actionLabel={search ? "Clear search" : undefined}
              onAction={search ? clearSearch : undefined}
            />
          </Card>
        )}

        {isInitialLoading || isTransitioning ? (
          <LeaderboardPaginationSkeleton />
        ) : pagination.pages > 1 ? (
          <nav className="leaderboard-pagination" aria-label="Leaderboard pages">
            <Button
              variant="secondary"
              size="sm"
              disabled={!pagination.has_previous}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: current.page - 1,
                }))
              }
            >
              Previous
            </Button>
            <span aria-live="polite">
              Page {pagination.page} of {pagination.pages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!pagination.has_next}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: current.page + 1,
                }))
              }
            >
              Next
            </Button>
          </nav>
        ) : null}
      </PageSection>
    </DashboardLayout>
  );
}

function LeaderboardEntry({ player, viewer, isCurrent }) {
  const canChallenge = canChallengeLeaderboardPlayer(viewer, player);
  return (
    <Card
      as="article"
      variant="dashboard"
      className={`leaderboard-entry-card${isCurrent ? " leaderboard-entry-current" : ""}`}
      aria-label={`${player.username}, official rank ${player.rank}${isCurrent ? ", your rank" : ""}`}
    >
      <div className="leaderboard-entry-rank">
        <span>Rank</span>
        <strong>#{player.rank}</strong>
      </div>
      <div className="leaderboard-entry-identity">
        <ProfileAvatar
          image={player.profile_image}
          name={player.username}
          className="leaderboard-avatar"
        />
        <div>
          <div className="leaderboard-entry-name-row">
            <h3>{player.username}</h3>
            {isCurrent ? <Badge tone="info">Your rank</Badge> : null}
          </div>
          <p>
            {player.total_matches} matches · {player.wins}-{player.losses}-{player.draws} record
          </p>
        </div>
      </div>
      <div className="leaderboard-entry-metrics">
        <span><strong>{player.points}</strong> points</span>
        <span><strong>{player.win_rate}%</strong> win rate</span>
      </div>
      <div className="leaderboard-entry-actions">
        <Button
          as={Link}
          to={`/players/${player.id}`}
          variant="secondary"
          size="sm"
          aria-label={`View ${player.username}'s profile`}
        >
          Profile
        </Button>
        {canChallenge ? (
          <Button
            as={Link}
            to={`/dashboard/submit-match?opponentId=${encodeURIComponent(player.id)}`}
            variant="challenge"
            size="sm"
            aria-label={`Challenge ${player.username}`}
          >
            <SidebarIcon name="matches" decorative /> Challenge
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function CompetitivePill({ label, value, tone }) {
  return (
    <div className={`status-pill status-pill-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
