import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PlayerIdentity from "../components/PlayerIdentity";
import RichMatchCard from "../components/RichMatchCard";
import SectionSkeleton from "../components/SectionSkeleton";
import SidebarIcon from "../components/SidebarIcon";
import StatCard from "../components/StatCard";
import TrophyWatermark from "../components/TrophyWatermark";
import { Alert, Button, Card, EmptyState, Field, PageSection } from "../components/ui";
import { useLoading } from "../context/LoadingContext";
import { usePlayerDirectory } from "../context/PlayerDirectoryContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getHeadToHead } from "../services/api";

const MAX_PICKER_RESULTS = 12;

const emptyComparison = {
  player_a: null,
  player_b: null,
  total_matches: 0,
  player_a_wins: 0,
  player_b_wins: 0,
  draws: 0,
  player_a_points: 0,
  player_b_points: 0,
  player_a_goals: 0,
  player_b_goals: 0,
  player_a_goal_difference: 0,
  player_b_goal_difference: 0,
  biggest_win: null,
  leader: "draw",
  most_recent_result: null,
  recent_matches: [],
};

export default function HeadToHead() {
  const { playerAId, playerBId } = useParams();
  const navigate = useNavigate();
  const { trackLoading } = useLoading();
  const { players, isLoadingPlayers, playersError } = usePlayerDirectory();
  const [comparison, setComparison] = useState(emptyComparison);
  const [isLoadingComparison, setIsLoadingComparison] = useState(Boolean(playerAId && playerBId));
  const [comparisonError, setComparisonError] = useState("");
  const [selection, setSelection] = useState({
    playerAId: playerAId || "",
    playerBId: playerBId || "",
  });
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");

  useEffect(() => {
    setSelection({
      playerAId: playerAId || "",
      playerBId: playerBId || "",
    });

    if (playerAId && playerBId) {
      loadComparison(playerAId, playerBId);
      return;
    }

    setComparison(emptyComparison);
    setIsLoadingComparison(false);
    setComparisonError("");
  }, [playerAId, playerBId]);

  const selectablePlayersForA = players;
  const selectablePlayersForB = useMemo(
    () => players.filter((player) => player.id !== selection.playerAId),
    [players, selection.playerAId]
  );

  async function loadComparison(nextPlayerAId, nextPlayerBId) {
    try {
      setIsLoadingComparison(true);
      setComparisonError("");
      const response = await trackLoading(() => getHeadToHead(nextPlayerAId, nextPlayerBId));
      setComparison(response.data || emptyComparison);
    } catch (error) {
      setComparisonError(error.message);
      setComparison(emptyComparison);
    } finally {
      setIsLoadingComparison(false);
    }
  }

  function selectPlayerA(playerId) {
    setSelection((currentValue) => ({
      ...currentValue,
      playerAId: playerId,
      ...(currentValue.playerBId === playerId ? { playerBId: "" } : {}),
    }));
  }

  function selectPlayerB(playerId) {
    setSelection((currentValue) => ({ ...currentValue, playerBId: playerId }));
  }

  function handleComparisonSubmit(event) {
    event.preventDefault();

    if (!selection.playerAId || !selection.playerBId) {
      setComparisonError("Choose two players to compare.");
      return;
    }

    navigate(`/head-to-head/${selection.playerAId}/${selection.playerBId}`);
  }

  const rivalryLeaderLabel = resolveLeaderLabel(comparison);
  const rivalryStats = [
    {
      id: "total-matches",
      title: "Confirmed Meetings",
      value: comparison.total_matches,
      subtitle: "Only confirmed rivalry matches count toward this comparison.",
      icon: "matches",
      tone: "primary",
    },
    {
      id: "player-a-wins",
      title: comparison.player_a?.username || "Player A Wins",
      value: comparison.player_a_wins,
      subtitle: "Confirmed wins in this rivalry only.",
      icon: "trophy",
      tone: "success",
    },
    {
      id: "player-b-wins",
      title: comparison.player_b?.username || "Player B Wins",
      value: comparison.player_b_wins,
      subtitle: "Confirmed wins in this rivalry only.",
      icon: "trophy",
      tone: "secondary",
    },
    {
      id: "goal-difference",
      title: "Goal Difference",
      value: comparison.player_a_goal_difference > 0
        ? `${comparison.player_a.username} +${comparison.player_a_goal_difference}`
        : comparison.player_b_goal_difference > 0
          ? `${comparison.player_b.username} +${comparison.player_b_goal_difference}`
          : "Level",
      subtitle: `${comparison.draws} confirmed draw${comparison.draws === 1 ? "" : "s"}.`,
      icon: "balance",
      tone: "warning",
    },
  ];

  return (
    <DashboardLayout
      title="Head-to-Head"
      description="Compare rivals and settle the matchup with real records."
    >
      <Card as="section" variant="dashboard" className="feature-hero-card">
        <TrophyWatermark />
        <div>
          <p className="section-label">Head-to-Head</p>
          <h2 className="feature-hero-title">Compare two players.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Filter</p>
          <p className="feature-callout-value">Confirmed matches only</p>
        </div>
      </Card>

      <PageSection title="Compare Players" description="Search and tap two players to build a rivalry view.">
        <Card as="section" variant="dashboard" className="dashboard-panel">
          <form onSubmit={handleComparisonSubmit}>
            <div className="match-score-grid head-to-head-picker-grid">
              <PlayerPickerColumn
                label="Player A"
                players={selectablePlayersForA}
                selectedId={selection.playerAId}
                search={searchA}
                onSearchChange={setSearchA}
                onSelect={selectPlayerA}
                disabled={isLoadingPlayers}
              />
              <PlayerPickerColumn
                label="Player B"
                players={selectablePlayersForB}
                selectedId={selection.playerBId}
                search={searchB}
                onSearchChange={setSearchB}
                onSelect={selectPlayerB}
                disabled={isLoadingPlayers}
              />
            </div>

            <Button
              type="submit"
              className="head-to-head-submit-button"
              disabled={isLoadingPlayers || !selection.playerAId || !selection.playerBId}
            >
              View Rivalry
            </Button>
          </form>

          {isLoadingPlayers ? <p className="match-helper-text">Loading available players...</p> : null}
          {playersError ? <Alert tone="error">{playersError}</Alert> : null}
        </Card>
      </PageSection>

      {comparisonError ? <Alert tone="error">{comparisonError}</Alert> : null}

      {isLoadingComparison ? (
        <Card as="section" variant="dashboard" className="dashboard-panel">
          <SectionSkeleton lines={6} />
        </Card>
      ) : comparison.player_a && comparison.player_b ? (
        <>
          <Card as="section" variant="dashboard" className="dashboard-panel">
            <div className="rivalry-overview">
              <article
                className={`rivalry-player-card${comparison.leader === "player_a" ? " rivalry-player-card-leading" : ""}`}
              >
                <p className="rivalry-player-label">Player A</p>
                <h2 className="rivalry-player-name">{comparison.player_a.username}</h2>
                <strong className="rivalry-player-record">{comparison.player_a_wins} wins</strong>
                <p className="rivalry-player-copy">{comparison.player_a_goals ?? comparison.player_a_points} goals in confirmed meetings.</p>
              </article>

              <div className="rivalry-versus">
                <p className="rivalry-versus-label">Rivalry Lead</p>
                <h3 className="rivalry-versus-title">{rivalryLeaderLabel}</h3>
                <p className="rivalry-versus-copy">
                  {comparison.most_recent_result
                    ? `Most recent result: ${comparison.most_recent_result.result_label}`
                    : "No confirmed rivalry match has been recorded yet."}
                </p>
                {comparison.biggest_win ? <p className="rivalry-versus-copy">Largest win: {comparison.biggest_win.score}</p> : null}
              </div>

              <article
                className={`rivalry-player-card${comparison.leader === "player_b" ? " rivalry-player-card-leading" : ""}`}
              >
                <p className="rivalry-player-label">Player B</p>
                <h2 className="rivalry-player-name">{comparison.player_b.username}</h2>
                <strong className="rivalry-player-record">{comparison.player_b_wins} wins</strong>
                <p className="rivalry-player-copy">{comparison.player_b_goals ?? comparison.player_b_points} goals in confirmed meetings.</p>
              </article>
            </div>
          </Card>

          <section className="stat-grid" aria-label="Rivalry statistics">
            {rivalryStats.map((stat) => (
              <StatCard
                key={stat.id}
                title={stat.title}
                value={stat.value}
                subtitle={stat.subtitle}
                icon={stat.icon}
                tone={stat.tone}
                emphasis
              />
            ))}
          </section>

          <PageSection title="Recent Rivalry Matches" description="Confirmed meetings between these two players.">
            {comparison.recent_matches.length ? (
              <div className="match-list">
                {comparison.recent_matches.map((match) => (
                  <RichMatchCard
                    key={match.match_id}
                    variant="compact"
                    match={{
                      id: match.match_id,
                      status: "confirmed",
                      player_one: comparison.player_a,
                      player_two: comparison.player_b,
                      player_one_score: match.player_a_score,
                      player_two_score: match.player_b_score,
                      confirmed_at: match.confirmed_at,
                    }}
                  />
                ))}
              </div>
            ) : (
              <Card variant="empty">
                <EmptyState
                  title="No confirmed meetings yet"
                  description="These two players do not have any confirmed head-to-head matches yet."
                />
              </Card>
            )}
          </PageSection>
        </>
      ) : (
        <Card as="section" variant="empty">
          <EmptyState
            title="Choose two players"
            description="Choose two players above to load a rivalry comparison."
          />
        </Card>
      )}
    </DashboardLayout>
  );
}

function PlayerPickerColumn({ label, players, selectedId, search, onSearchChange, onSelect, disabled }) {
  const selected = players.find((player) => player.id === selectedId) || null;
  const query = search.trim().toLowerCase();
  const results = players
    .filter((player) => !query || player.username.toLowerCase().includes(query))
    .slice(0, MAX_PICKER_RESULTS);

  return (
    <div className="head-to-head-picker-column">
      <Field
        type="search"
        label={label}
        placeholder="Search players"
        value={search}
        disabled={disabled}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      {selected ? (
        <Card variant="dashboard" className="selected-opponent-card" aria-live="polite">
          <PlayerIdentity player={selected} variant="compact" label={`Selected ${label}`} className="selected-opponent-copy" />
          <span className="selected-opponent-confirmation" aria-label={`${label} selected`}>
            <SidebarIcon name="check" decorative />
          </span>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onSelect("")}>
            Change
          </Button>
        </Card>
      ) : results.length ? (
        <div className="opponent-results" role="group" aria-label={`${label} candidates`}>
          {results.map((player) => (
            <button
              key={player.id}
              type="button"
              className="opponent-option-card"
              disabled={disabled}
              onClick={() => onSelect(player.id)}
            >
              <PlayerIdentity player={player} variant="compact" className="opponent-option-copy" />
            </button>
          ))}
        </div>
      ) : (
        <Card variant="empty">
          <EmptyState title="No players found" description="Try another username." />
        </Card>
      )}
    </div>
  );
}

function resolveLeaderLabel(comparison) {
  if (comparison.leader === "player_a") {
    return `${comparison.player_a.username} leads`;
  }

  if (comparison.leader === "player_b") {
    return `${comparison.player_b.username} leads`;
  }

  return "Rivalry is tied";
}
