import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SectionSkeleton from "../components/SectionSkeleton";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getPublicPlayerProfile } from "../services/api";

export default function PlayerProfile() {
  const { playerId } = useParams();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const { trackLoading } = useLoading();

  useEffect(() => {
    loadPlayerProfile();
  }, [playerId]);

  async function loadPlayerProfile() {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const response = await trackLoading(() => getPublicPlayerProfile(playerId));
      setProfile(response.data);
    } catch (error) {
      setErrorMessage(error.message);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <DashboardLayout
      title={profile ? `${profile.username} Profile` : "Player Profile"}
      description="A public summary of confirmed performance only, so bragging rights are built on verified results instead of raw claims."
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Public Player Summary</p>
          <h2 className="feature-hero-title">A competitive identity page that explains the rank.</h2>
          <p className="section-copy">
            The leaderboard shows who is ahead. The player profile shows why. That split makes the public layer feel
            like a real bragging-rights product without exposing private account data like email or password fields.
          </p>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Visibility</p>
          <p className="feature-callout-value">Confirmed stats only</p>
        </div>
      </section>

      {errorMessage ? (
        <div className="match-feedback match-feedback-error">
          <p>{errorMessage}</p>
        </div>
      ) : null}

      {isLoading ? (
        <section className="dashboard-panel">
          <SectionSkeleton lines={5} />
        </section>
      ) : profile ? (
        <>
          <section className="stat-grid stat-grid-wide">
            <CompetitiveStatCard title="Rank" value={`#${profile.rank}`} subtitle="Current public table position" />
            <CompetitiveStatCard title="Wins" value={profile.wins} subtitle={`${profile.total_matches} confirmed matches`} />
            <CompetitiveStatCard title="Points" value={profile.points} subtitle={`${profile.losses} losses | ${profile.draws} draws`} />
            <CompetitiveStatCard title="Win Rate" value={`${profile.win_rate}%`} subtitle="Confirmed-match conversion into wins" />
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Summary</p>
                <h2 className="panel-title">{profile.username}</h2>
              </div>
              <Link className="leaderboard-back-link" to="/leaderboard">
                Back to leaderboard
              </Link>
            </div>

            <div className="player-summary-grid">
              <div className="player-summary-item">
                <span className="match-score-label">Total Matches</span>
                <strong>{profile.total_matches}</strong>
              </div>
              <div className="player-summary-item">
                <span className="match-score-label">Wins</span>
                <strong>{profile.wins}</strong>
              </div>
              <div className="player-summary-item">
                <span className="match-score-label">Losses</span>
                <strong>{profile.losses}</strong>
              </div>
              <div className="player-summary-item">
                <span className="match-score-label">Draws</span>
                <strong>{profile.draws}</strong>
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Recent Form</p>
                <h2 className="panel-title">Recent confirmed matches</h2>
              </div>
              <p className="panel-subtitle">These summaries stay intentionally public-facing and lightweight.</p>
            </div>

            {profile.recent_confirmed_matches.length ? (
              <div className="match-list">
                {profile.recent_confirmed_matches.map((match) => (
                  <article key={match.match_id} className="match-card">
                    <div className="match-card-top">
                      <div>
                        <p className="match-card-player">vs {match.opponent_name}</p>
                        <p className="match-card-meta">Confirmed {formatDate(match.confirmed_at)}</p>
                      </div>
                      <span className={`match-status-badge ${getResultClassName(match.result)}`}>{match.result}</span>
                    </div>

                    <div className="player-match-score">
                      <div className="match-score-line">
                        <span className="match-score-label">{profile.username}</span>
                        <strong>{match.player_score}</strong>
                      </div>
                      <div className="match-score-line">
                        <span className="match-score-label">{match.opponent_name}</span>
                        <strong>{match.opponent_score}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No confirmed public match summaries yet for this player.</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </DashboardLayout>
  );
}

function CompetitiveStatCard({ title, value, subtitle }) {
  return (
    <article className="stat-card stat-card-emphasis">
      <div className="stat-card-header">
        <h2 className="stat-card-title">{title}</h2>
        <div className="stat-card-icon">{title.slice(0, 2).toUpperCase()}</div>
      </div>
      <p className="stat-card-value">{value}</p>
      <p className="stat-card-subtitle">{subtitle}</p>
    </article>
  );
}

function getResultClassName(result) {
  if (result === "win") {
    return "match-status-confirmed";
  }

  if (result === "loss") {
    return "match-status-disputed";
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
