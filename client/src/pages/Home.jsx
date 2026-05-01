import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const featureCards = [
  {
    title: "Schedule Matches",
    description: "Create match requests, line up opponents, and keep every challenge organized in one place.",
  },
  {
    title: "Confirm Results",
    description: "Submit outcomes quickly and let both players lock in the final result with confidence.",
  },
  {
    title: "Resolve Disputes",
    description: "Escalate contested results into a clear review flow instead of relying on hearsay or screenshots alone.",
  },
  {
    title: "Track Performance",
    description: "Watch your history grow across wins, losses, activity, and momentum over time.",
  },
  {
    title: "Build Trusted Rankings",
    description: "Turn verified match history into leaderboards players can respect and reference.",
  },
];

const workflowSteps = [
  "Create account",
  "Schedule match",
  "Play and submit result",
  "Opponent confirms or disputes",
  "Build history",
];

const trustPoints = [
  "Admin moderation supports fair resolution when a result is challenged.",
  "Dispute review creates an accountable process for contested match outcomes.",
  "Activity logs help maintain a visible record of important competitive actions.",
  "Structured result tracking keeps rankings grounded in confirmed history.",
];

export default function Home() {
  const { isAuthenticated, getHomePathForRole, user } = useAuth();
  const dashboardPath = getHomePathForRole(user?.role);

  return (
    <section className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Competitive record, verified</p>
          <h1 className="landing-title">Track Matches. Prove Results. Earn Bragging Rights.</h1>
          <p className="landing-subtitle">
            BragRight helps players schedule matches, submit results, confirm outcomes,
            and build trusted competitive history.
          </p>

          <div className="landing-hero-actions">
            <Link className="landing-button landing-button-primary" to="/register">
              Get Started
            </Link>
            <Link className="landing-button landing-button-secondary" to="/login">
              Log In
            </Link>
          </div>

          <div className="landing-proof-row">
            <span>Match scheduling</span>
            <span>Verified outcomes</span>
            <span>Trusted rankings</span>
          </div>
        </div>

        <div className="landing-hero-panel">
          <div className="landing-hero-stat-card">
            <p className="landing-panel-label">Competitive workflow</p>
            <h2>Built for organized rivalry, not guesswork.</h2>
            <p>
              From match request to confirmed result, BragRight gives players and admins
              a cleaner system for competitive accountability.
            </p>
          </div>

          <div className="landing-hero-metrics">
            <article className="landing-metric">
              <strong>Schedule</strong>
              <span>Send and manage match requests with clarity.</span>
            </article>
            <article className="landing-metric">
              <strong>Confirm</strong>
              <span>Lock in results with both players on record.</span>
            </article>
            <article className="landing-metric">
              <strong>Compete</strong>
              <span>Turn every verified match into long-term credibility.</span>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <p className="landing-section-label">Platform features</p>
          <h2 className="landing-section-title">A professional layer for every competitive match.</h2>
        </div>

        <div className="landing-feature-grid">
          {featureCards.map((feature) => (
            <article className="landing-feature-card" key={feature.title}>
              <div className="landing-feature-icon" aria-hidden="true">
                {feature.title.split(" ")[0].slice(0, 2).toUpperCase()}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-dark">
        <div className="landing-section-heading">
          <p className="landing-section-label">How it works</p>
          <h2 className="landing-section-title">Simple enough for players, structured enough for trust.</h2>
        </div>

        <div className="landing-workflow-grid">
          {workflowSteps.map((step, index) => (
            <article className="landing-workflow-card" key={step}>
              <span className="landing-step-number">0{index + 1}</span>
              <h3>{step}</h3>
              <p>
                {index === 0 && "Join the platform and set up a competitive identity players can recognize."}
                {index === 1 && "Challenge an opponent and keep the match request visible from the start."}
                {index === 2 && "Record the score once the match is complete so the result enters review."}
                {index === 3 && "Give the other player the chance to confirm the outcome or raise a dispute."}
                {index === 4 && "Build a long-term record that can support rankings, profiles, and reputation."}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-trust-panel">
          <div className="landing-trust-copy">
            <p className="landing-section-label">Trust and oversight</p>
            <h2 className="landing-section-title">Competition stays credible when the process is visible.</h2>
            <p className="landing-trust-description">
              BragRight supports a more professional competitive environment with admin moderation,
              dispute review, activity visibility, and fair result tracking built into the experience.
            </p>
          </div>

          <div className="landing-trust-list">
            {trustPoints.map((point) => (
              <article className="landing-trust-item" key={point}>
                <span className="landing-trust-badge" aria-hidden="true">
                  +
                </span>
                <p>{point}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <p className="landing-section-label">Start competing</p>
          <h2 className="landing-section-title">Start tracking your competitive record today</h2>
        </div>

        <div className="landing-hero-actions">
          <Link className="landing-button landing-button-primary" to="/register">
            Create Account
          </Link>
          <Link className="landing-button landing-button-secondary" to="/login">
            Log In
          </Link>
          {isAuthenticated ? (
            <Link className="landing-button landing-button-tertiary" to={dashboardPath}>
              Go to Dashboard
            </Link>
          ) : null}
        </div>
      </section>
    </section>
  );
}
