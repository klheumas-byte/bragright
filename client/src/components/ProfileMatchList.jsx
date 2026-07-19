import RichMatchCard from "./RichMatchCard";

export default function ProfileMatchList({ matches = [], profileName = "You" }) {
  return (
    <div className="profile-match-list">
      {matches.map((match) => (
        <RichMatchCard
          key={match.id}
          match={match}
          currentUserName={profileName}
          variant="compact"
          detailPath={match.detailPath}
        />
      ))}
    </div>
  );
}
