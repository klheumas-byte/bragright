import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import SectionSkeleton from "../components/SectionSkeleton";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getLeaderboard } from "../services/api";

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const { trackLoading } = useLoading();

  useEffect(() => {
    loadLeaderboard();
  }, []);

  async function loadLeaderboard() {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const response = await trackLoading(() => getLeaderboard());
      setLeaderboard(response.data.leaderboard || []);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  const podium = leaderboard.slice(0, 3);

  return (
    <DashboardLayout
      title="Leaderboard"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Standings</p>
          <h2 className="feature-hero-title">Confirmed rankings.</h2>
        </div>

        <div className="status-summary-grid">
          <CompetitivePill label="Tracked Players" value={leaderboard.length} tone="neutral" />
          <CompetitivePill label="Top Score" value={leaderboard[0]?.points ?? 0} tone="confirmed" />
          <CompetitivePill label="Status" value="Live" tone="pending" />
        </div>
      </section>

      <ErrorState message={errorMessage} onRetry={loadLeaderboard} />

      {isLoading ? (
        <section className="dashboard-panel">
          <SectionSkeleton lines={5} />
        </section>
      ) : (
        <>
          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Podium</p>
                <h2 className="panel-title">Top competitors</h2>
              </div>
            </div>

            <div className="competitive-podium-grid">
              {podium.length ? (
                podium.map((player) => (
                  <Link key={player.id} to={`/players/${player.id}`} className="podium-card">
                    <span className={`podium-rank podium-rank-${player.rank}`}>#{player.rank}</span>
                    <h3 className="podium-name">{player.username}</h3>
                    <p className="podium-meta">
                      {player.wins} wins | {player.total_matches} matches
                    </p>
                    <strong className="podium-points">{player.points} pts</strong>
                  </Link>
                ))
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">No players available for the leaderboard yet.</p>
                </div>
              )}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Full Table</p>
                <h2 className="panel-title">Competitive standings</h2>
              </div>
            </div>

            {leaderboard.length ? (
              <div className="leaderboard-table">
                <div className="leaderboard-row leaderboard-row-header">
                  <span>Rank</span>
                  <span>Player</span>
                  <span>Wins</span>
                  <span>Points</span>
                </div>

                {leaderboard.map((player) => (
                  <Link key={player.id} to={`/players/${player.id}`} className="leaderboard-row leaderboard-row-link">
                    <span className="leaderboard-rank">#{player.rank}</span>
                    <span className="leaderboard-player">
                      <strong>{player.username}</strong>
                      <small>
                        {player.total_matches} matches | {player.losses} losses | {player.draws} draws
                      </small>
                    </span>
                    <span>{player.wins}</span>
                    <span className="leaderboard-points">{player.points}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No players are available to rank yet.</p>
              </div>
            )}
          </section>
        </>
      )}
    </DashboardLayout>
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
