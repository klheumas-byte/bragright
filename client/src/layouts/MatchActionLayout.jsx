import { Link, useNavigate } from "react-router-dom";
import { Button, Card } from "../components/ui";

export default function MatchActionLayout({
  title,
  instruction,
  match,
  children,
  actions,
  fullMatch = true,
}) {
  const navigate = useNavigate();
  return (
    <main className="match-action-page">
      <header className="match-action-header">
        <Link to="/dashboard" className="match-action-brand" aria-label="BragRight dashboard">
          BRAGR<span>IGHT</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>Back</Button>
      </header>
      <section className="match-action-content" aria-labelledby="match-action-title">
        <div className="match-action-heading">
          <p className="section-label">Match action</p>
          <h1 id="match-action-title">{title}</h1>
          <p>{instruction}</p>
        </div>
        {match ? <MatchSummary match={match} /> : null}
        {children}
        {fullMatch && match?.id ? (
          <Link className="match-action-full-link" to={`/dashboard/matches?matchId=${encodeURIComponent(match.id)}`}>
            View full match
          </Link>
        ) : null}
      </section>
      {actions ? <div className="match-action-sticky" aria-label="Match actions"><div>{actions}</div></div> : null}
    </main>
  );
}

function MatchSummary({ match }) {
  return (
    <Card as="section" variant="information" className="match-action-summary" aria-label="Match summary">
      <div className="match-action-players">
        <strong>{match.player_one_name}</strong>
        <span aria-hidden="true">vs</span>
        <strong>{match.player_two_name}</strong>
      </div>
      <dl>
        <div><dt>Game</dt><dd>{match.game || "Not specified"}</dd></div>
        <div><dt>Type</dt><dd>{match.match_type || "Competitive Match"}</dd></div>
        <div><dt>Scheduled</dt><dd><ActionTime value={match.scheduled_at} fallback="Not scheduled" /></dd></div>
        <div><dt>Status</dt><dd>{match.status_message || match.display_status}</dd></div>
      </dl>
      {match.request_message ? <p className="match-action-message">“{match.request_message}”</p> : null}
    </Card>
  );
}

export function ActionTime({ value, fallback = "Not available" }) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}</time>;
}
