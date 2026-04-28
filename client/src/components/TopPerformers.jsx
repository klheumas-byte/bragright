// TopPerformers renders the competitive leaderboard.
// It accepts player data as a prop so the same component can later use real backend data.
export default function TopPerformers({ players = [] }) {
  return (
    <section className="dashboard-panel performers-panel" aria-labelledby="top-performers-title">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Leaderboard</p>
          <h2 className="panel-title" id="top-performers-title">
            Top Performers
          </h2>
        </div>
      </div>

      <div className="performer-list">
        {players.map((player, index) => {
          const rank = index + 1;
          const medalClass = rank <= 3 ? ` top-${rank}` : "";
          const performerClass =
            rank <= 3 ? `performer-row performer-row-top${medalClass}` : "performer-row";

          return (
            <article
              className={performerClass}
              key={player.id}
              aria-label={`${player.name}, rank ${rank}, ${player.points} points`}
            >
              <div className="performer-identity">
                <span className="performer-rank" aria-hidden="true">
                  {rank}
                </span>
                <div>
                  <h3 className="performer-name">{player.name}</h3>
                  <p className="performer-meta">Competitive rating</p>
                </div>
              </div>
              <strong className="performer-points">{player.points} pts</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
