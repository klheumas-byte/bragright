import { Link } from "react-router-dom";
import SectionSkeleton from "../components/SectionSkeleton";
import SidebarIcon from "../components/SidebarIcon";
import { useAuth } from "../context/AuthContext";

const essentials = [
  {
    icon: "matches",
    title: "Challenge clearly",
    description: "Schedule opponents and keep every match in one place.",
  },
  {
    icon: "check",
    title: "Confirm confidently",
    description: "Record outcomes through a transparent confirmation flow.",
  },
  {
    icon: "leaderboard",
    title: "Rank credibly",
    description: "Build a competitive record grounded in confirmed results.",
  },
];

const matchFlow = [
  { icon: "matches", label: "Challenge", detail: "Match requested" },
  { icon: "submit", label: "Result", detail: "Score submitted" },
  { icon: "check", label: "Record", detail: "Outcome confirmed" },
];

export default function Home() {
  const { isAuthenticated, isInitializing, getHomePathForRole, user } = useAuth();
  const dashboardPath = getHomePathForRole(user?.role);

  if (isInitializing) {
    return (
      <section className="landing-page">
        <section className="landing-hero" aria-label="Preparing BragRight">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">BragRight</p>
            <h1 className="landing-title">Preparing the arena.</h1>
            <SectionSkeleton lines={3} />
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">Competition, on record</p>
          <h1 className="landing-title" id="landing-title">
            Play it. <span>Prove it.</span> Own it.
          </h1>
          <p className="landing-subtitle">
            Matches, results, and rankings—clear and credible.
          </p>

          <div className="landing-hero-actions">
            <Link
              className="landing-button landing-button-primary"
              to={isAuthenticated ? dashboardPath : "/register"}
            >
              {isAuthenticated ? "Enter Dashboard" : "Start Competing"}
            </Link>
            {!isAuthenticated ? (
              <Link className="landing-button landing-button-secondary" to="/login">
                Sign In
              </Link>
            ) : null}
          </div>

          <div className="landing-proof-row" aria-label="Platform essentials">
            <span><SidebarIcon name="matches" decorative /> Challenge</span>
            <span><SidebarIcon name="check" decorative /> Confirm</span>
            <span><SidebarIcon name="trophy" decorative /> Rank</span>
          </div>
        </div>

        <div className="landing-product-card" aria-label="BragRight match workflow">
          <header className="landing-product-card__header">
            <div>
              <p className="landing-panel-label">Match workflow</p>
              <h2>Every result earns its place.</h2>
            </div>
            <span className="landing-product-status">
              <SidebarIcon name="bolt" decorative /> Ready
            </span>
          </header>

          <div className="landing-product-flow">
            {matchFlow.map((item, index) => (
              <div className="landing-product-step" key={item.label}>
                <span className="landing-product-step__icon" aria-hidden="true">
                  <SidebarIcon name={item.icon} decorative />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                {index < matchFlow.length - 1 ? <span className="landing-product-step__line" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>

          <div className="landing-product-card__footer">
            <SidebarIcon name="trophy" decorative />
            <strong>One match. One trusted record.</strong>
          </div>
        </div>
      </section>

      <section className="landing-section landing-essentials" aria-labelledby="landing-essentials-title">
        <div className="landing-section-heading">
          <p className="landing-section-label">The essentials</p>
          <h2 className="landing-section-title" id="landing-essentials-title">Built for the result.</h2>
        </div>

        <div className="landing-feature-grid">
          {essentials.map((feature) => (
            <article className="landing-feature-card" key={feature.title}>
              <span className="landing-feature-icon" aria-hidden="true">
                <SidebarIcon name={feature.icon} decorative />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-section-dark" aria-labelledby="landing-flow-title">
        <div className="landing-section-heading">
          <p className="landing-section-label">Three clear steps</p>
          <h2 className="landing-section-title" id="landing-flow-title">Challenge. Confirm. Climb.</h2>
        </div>

        <div className="landing-workflow-grid">
          {matchFlow.map((step, index) => (
            <article className="landing-workflow-card" key={step.label}>
              <span className="landing-step-number">0{index + 1}</span>
              <SidebarIcon name={step.icon} decorative />
              <strong>{step.label}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <div>
          <p className="landing-section-label">Your next match matters</p>
          <h2 className="landing-section-title" id="landing-cta-title">Make it count.</h2>
        </div>
        <Link
          className="landing-button landing-button-primary"
          to={isAuthenticated ? dashboardPath : "/register"}
        >
          {isAuthenticated ? "Open BragRight" : "Create Your Record"}
        </Link>
      </section>
    </section>
  );
}
