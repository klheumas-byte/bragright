import { Link } from "react-router-dom";
import { Badge } from "./ui";
import { formatProfileDate, getProfileMatchTone } from "../pages/profileViewModel";

export default function ProfileMatchList({ matches = [], profileName = "You" }) {
  return (
    <div className="profile-match-list">
      {matches.map((match) => {
        const content = (
          <>
            <div className="profile-match-top">
              <div className="profile-match-copy">
                <p className="profile-match-opponent">
                  vs {match.opponentName}
                </p>
                <p className="match-card-meta">
                  {formatProfileDate(match.playedAt)}
                </p>
              </div>
              <div className="profile-match-badges">
                {match.resultLabel ? (
                  <Badge tone={getProfileMatchTone(match)}>
                    {match.resultLabel}
                  </Badge>
                ) : null}
                <Badge tone={getProfileMatchTone(match, { statusOnly: true })}>
                  {match.statusLabel}
                </Badge>
              </div>
            </div>

            <div className="profile-match-score-grid">
              <div className="match-score-line">
                <span className="match-score-label">{profileName}</span>
                <strong>{match.playerScore}</strong>
              </div>
              <div className="match-score-line">
                <span className="match-score-label">{match.opponentName}</span>
                <strong>{match.opponentScore}</strong>
              </div>
            </div>
          </>
        );

        return match.detailPath ? (
          <Link
            key={match.id}
            to={match.detailPath}
            className="profile-match-card profile-match-card-link"
            aria-label={`Open match against ${match.opponentName}, ${match.statusLabel}`}
          >
            {content}
          </Link>
        ) : (
          <article key={match.id} className="profile-match-card">
            {content}
          </article>
        );
      })}
    </div>
  );
}
