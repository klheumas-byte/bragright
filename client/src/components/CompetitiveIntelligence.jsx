import { Link } from "react-router-dom";
import { formatActivityTimestamp } from "./activityPresentation";
import PlayerIdentity from "./PlayerIdentity";
import SidebarIcon from "./SidebarIcon";
import { Badge, Button, Card, EmptyState } from "./ui";
import { createHeadToHeadSummary } from "./competitiveIntelligenceViewModel";

export function NextBestAction({ action, onAction }) {
  if (!action) return null;
  return <Card as="article" variant="dashboard" className={`competitive-next-action competitive-next-action--${action.tone}`}>
    <span className="competitive-next-action__icon" aria-hidden="true"><SidebarIcon name={action.tone === "danger" ? "disputes" : "bolt"} decorative /></span>
    <div><p className="panel-kicker">Your next move</p><h3>{action.title}</h3><p>{action.description}</p></div>
    <Button variant="primary" onClick={() => onAction?.(action)}>{action.actionLabel}</Button>
  </Card>;
}

export function RecentForm({ items = [], emptyAction }) {
  if (!items.length) return <Card variant="empty"><EmptyState title="No completed matches" description="Complete your first match to begin tracking form." actionLabel={emptyAction ? "Start a match" : undefined} onAction={emptyAction} /></Card>;
  return <div className="recent-form" aria-label={`Recent form: ${items.map((item) => item.resultLabel).join(", ")}`}>
    <div className="recent-form__sequence" role="list">
      {items.map((item) => <span key={item.id || `${item.opponentName}-${item.playedAt}`} role="listitem" className={`recent-form__result recent-form__result--${item.result}`} aria-label={item.resultLabel}>{item.resultLabel.charAt(0)}</span>)}
    </div>
    <div className="recent-form__matches">
      {items.map((item) => { const timestamp = formatActivityTimestamp(item.playedAt); const content = <><Badge tone={item.result === "win" ? "success" : item.result === "loss" ? "danger" : "neutral"}>{item.resultLabel}</Badge><strong>{item.opponentName}</strong>{item.score ? <span>{item.score}</span> : null}<time dateTime={timestamp.dateTime} title={timestamp.absolute}>{timestamp.relative}</time></>; return item.detailPath ? <Link to={item.detailPath} className="recent-form__match" key={item.id || item.playedAt} aria-label={`${item.resultLabel} against ${item.opponentName}. View match`}>{content}</Link> : <div className="recent-form__match" key={item.id || item.playedAt}>{content}</div>; })}
    </div>
  </div>;
}

export function PerformanceInsights({ insights = [] }) {
  if (!insights.length) return null;
  return <div className="competitive-insights" aria-label="Performance insights">{insights.map((insight) => <Card as={insight.path ? Link : "article"} to={insight.path} variant="information" className="competitive-insight" key={insight.id}><SidebarIcon name="activity" decorative /><span>{insight.text}</span></Card>)}</div>;
}

export function PlayerGoalCard({ goal, onAction }) {
  if (!goal) return null;
  const percent = goal.target ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
  return <Card as="article" variant="information" className="competitive-goal">
    <div><p className="panel-kicker">{goal.description}</p><h3>{goal.title}</h3><p>{goal.progressLabel || `${goal.current} of ${goal.target} completed`}</p></div>
    {goal.target ? <div className="competitive-goal__track" role="progressbar" aria-label={goal.title} aria-valuemin="0" aria-valuemax={goal.target} aria-valuenow={goal.current}><span style={{ width: `${percent}%` }} /></div> : null}
    <Button variant="secondary" size="sm" onClick={() => onAction?.(goal)}>{goal.actionLabel}</Button>
  </Card>;
}

export function RivalryCard({ rivalry, currentPlayerId = "" }) {
  if (!rivalry) return null;
  const destination = rivalry.opponentId && currentPlayerId ? `/head-to-head/${encodeURIComponent(currentPlayerId)}/${encodeURIComponent(rivalry.opponentId)}` : "";
  return <Card as="article" variant="information" className="rivalry-card">
    <div className="rivalry-card__heading"><PlayerIdentity player={{ id: rivalry.opponentId, username: rivalry.opponentName }} variant="compact" label="Top rival" /><Badge tone="prestige">{rivalry.matches} meetings</Badge></div>
    <dl>
      <div><dt>Wins</dt><dd>{rivalry.wins}</dd></div>
      <div><dt>Losses</dt><dd>{rivalry.losses}</dd></div>
      <div><dt>Draws</dt><dd>{rivalry.draws}</dd></div>
      <div><dt>Total goals</dt><dd>{rivalry.totalGoals ?? "—"}</dd></div>
      <div><dt>Goal difference</dt><dd>{rivalry.goalDifference > 0 ? `+${rivalry.goalDifference}` : rivalry.goalDifference ?? "—"}</dd></div>
      <div><dt>Latest result</dt><dd>{rivalry.latestResult || "—"}</dd></div>
      <div><dt>Biggest win</dt><dd>{rivalry.biggestWin?.score || "—"}</dd></div>
    </dl>
    <p>{rivalry.definition}</p>{destination ? <Button as={Link} to={destination} variant="ghost" size="sm">View head-to-head</Button> : null}
  </Card>;
}

export function HeadToHeadSummary({ comparison }) {
  const summary = createHeadToHeadSummary(comparison);
  if (!summary) return <EmptyState title="No head-to-head data" description="Confirmed meetings will appear here when available." />;
  return <div className="head-to-head-summary" aria-label={`${summary.playerA.username} and ${summary.playerB.username} head-to-head summary`}>
    <PlayerIdentity player={summary.playerA} variant="compact" label={`${summary.playerAWins} wins`} />
    <dl><div><dt>Meetings</dt><dd>{summary.totalMatches}</dd></div><div><dt>Draws</dt><dd>{summary.draws}</dd></div><div><dt>Goals</dt><dd>{comparison.player_a_goals ?? comparison.player_a_points}–{comparison.player_b_goals ?? comparison.player_b_points}</dd></div>{summary.latestResult ? <div><dt>Latest</dt><dd>{summary.latestResult}</dd></div> : null}</dl>
    <PlayerIdentity player={summary.playerB} variant="compact" label={`${summary.playerBWins} wins`} />
  </div>;
}
