import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SectionSkeleton from "../components/SectionSkeleton";
import { useLoading } from "../context/LoadingContext";
import { usePlayerDirectory } from "../context/PlayerDirectoryContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getHeadToHead } from "../services/api";

const emptyComparison = {
  player_a: null,
  player_b: null,
  total_matches: 0,
  player_a_wins: 0,
  player_b_wins: 0,
  draws: 0,
  player_a_points: 0,
  player_b_points: 0,
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

  function handleSelectionChange(event) {
    const { name, value } = event.target;
    setSelection((currentValue) => ({
      ...currentValue,
      [name]: value,
      ...(name === "playerAId" && currentValue.playerBId === value ? { playerBId: "" } : {}),
    }));
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
    },
    {
      id: "player-a-wins",
      title: comparison.player_a?.username || "Player A Wins",
      value: comparison.player_a_wins,
      subtitle: "Confirmed wins in this rivalry only.",
    },
    {
      id: "player-b-wins",
      title: comparison.player_b?.username || "Player B Wins",
      value: comparison.player_b_wins,
      subtitle: "Confirmed wins in this rivalry only.",
    },
    {
      id: "draws",
      title: "Draws",
      value: comparison.draws,
      subtitle: "Confirmed meetings with no winner.",
    },
  ];

  return (
    <DashboardLayout
      title="Head-to-Head"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Head-to-Head</p>
          <h2 className="feature-hero-title">Compare two players.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Filter</p>
          <p className="feature-callout-value">Confirmed matches only</p>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Compare Players</p>
            <h2 className="panel-title">Build a rivalry view</h2>
          </div>
        </div>

        <form className="head-to-head-selector" onSubmit={handleComparisonSubmit}>
          <label className="form-field">
            Player A
            <select
              name="playerAId"
              value={selection.playerAId}
              onChange={handleSelectionChange}
              disabled={isLoadingPlayers}
            >
              <option value="">Select first player</option>
              {selectablePlayersForA.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.username}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            Player B
            <select
              name="playerBId"
              value={selection.playerBId}
              onChange={handleSelectionChange}
              disabled={isLoadingPlayers}
            >
              <option value="">Select second player</option>
              {selectablePlayersForB.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.username}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="auth-button head-to-head-submit-button" disabled={isLoadingPlayers}>
            View Rivalry
          </button>
        </form>

        {isLoadingPlayers ? <p className="match-helper-text">Loading available players...</p> : null}
        {playersError ? <p className="match-helper-text error-text">{playersError}</p> : null}
      </section>

      {comparisonError ? (
        <div className="match-feedback match-feedback-error">
          <p>{comparisonError}</p>
        </div>
      ) : null}

      {isLoadingComparison ? (
        <section className="dashboard-panel">
          <SectionSkeleton lines={6} />
        </section>
      ) : comparison.player_a && comparison.player_b ? (
        <>
          <section className="dashboard-panel">
            <div className="rivalry-overview">
              <article
                className={`rivalry-player-card${comparison.leader === "player_a" ? " rivalry-player-card-leading" : ""}`}
              >
                <p className="rivalry-player-label">Player A</p>
                <h2 className="rivalry-player-name">{comparison.player_a.username}</h2>
                <strong className="rivalry-player-record">{comparison.player_a_wins} wins</strong>
                <p className="rivalry-player-copy">{comparison.player_a_points} total points scored in confirmed meetings.</p>
              </article>

              <div className="rivalry-versus">
                <p className="rivalry-versus-label">Rivalry Lead</p>
                <h3 className="rivalry-versus-title">{rivalryLeaderLabel}</h3>
                <p className="rivalry-versus-copy">
                  {comparison.most_recent_result
                    ? `Most recent result: ${comparison.most_recent_result.result_label}`
                    : "No confirmed rivalry match has been recorded yet."}
                </p>
              </div>

              <article
                className={`rivalry-player-card${comparison.leader === "player_b" ? " rivalry-player-card-leading" : ""}`}
              >
                <p className="rivalry-player-label">Player B</p>
                <h2 className="rivalry-player-name">{comparison.player_b.username}</h2>
                <strong className="rivalry-player-record">{comparison.player_b_wins} wins</strong>
                <p className="rivalry-player-copy">{comparison.player_b_points} total points scored in confirmed meetings.</p>
              </article>
            </div>
          </section>

          <section className="stat-grid">
            {rivalryStats.map((stat) => (
              <article key={stat.id} className="stat-card stat-card-emphasis">
                <div className="stat-card-header">
                  <h2 className="stat-card-title">{stat.title}</h2>
                  <div className="stat-card-icon">{String(stat.title).slice(0, 2).toUpperCase()}</div>
                </div>
                <p className="stat-card-value">{stat.value}</p>
                <p className="stat-card-subtitle">{stat.subtitle}</p>
              </article>
            ))}
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Recent Rivalry Matches</p>
                <h2 className="panel-title">Confirmed meetings between these two players</h2>
              </div>
            </div>

            {comparison.recent_matches.length ? (
              <div className="match-list">
                {comparison.recent_matches.map((match) => (
                  <article key={match.match_id} className="match-card">
                    <div className="match-card-top">
                      <div>
                        <p className="match-card-player">
                          {comparison.player_a.username} vs {comparison.player_b.username}
                        </p>
                        <p className="match-card-meta">Confirmed {formatDate(match.confirmed_at)}</p>
                      </div>
                      <span className={`match-status-badge ${getResultTone(match.result_label)}`}>{match.result_label}</span>
                    </div>

                    <div className="player-match-score">
                      <div className="match-score-line">
                        <span className="match-score-label">{comparison.player_a.username}</span>
                        <strong>{match.player_a_score}</strong>
                      </div>
                      <div className="match-score-line">
                        <span className="match-score-label">{comparison.player_b.username}</span>
                        <strong>{match.player_b_score}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">These two players do not have any confirmed head-to-head matches yet.</p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="dashboard-panel">
          <div className="match-empty-state">
            <p className="empty-state-copy">Choose two players above to load a rivalry comparison.</p>
          </div>
        </section>
      )}
    </DashboardLayout>
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

function getResultTone(resultLabel) {
  if (resultLabel.includes("won")) {
    return "match-status-confirmed";
  }

  return "match-status-pending";
}

function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
