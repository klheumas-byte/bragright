import Button from "./Button";
import SidebarIcon from "../SidebarIcon";

const BADGE_TONE_ICONS = Object.freeze({
  success: "check",
  warning: "clock",
  danger: "disputes",
  info: "bolt",
});

export function Alert({
  children,
  title,
  tone = "info",
  action,
  className = "",
  role,
}) {
  const resolvedRole = role || (tone === "error" ? "alert" : "status");
  return (
    <div
      className={`ui-alert ui-alert--${tone} ${className}`.trim()}
      role={resolvedRole}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <div className="ui-alert__content">
        {title ? <strong>{title}</strong> : null}
        {typeof children === "string" ? <p>{children}</p> : children}
      </div>
      {action}
    </div>
  );
}

export function Banner(props) {
  return <Alert {...props} className={`ui-banner ${props.className || ""}`} />;
}

export function Badge({ children, tone = "neutral", icon, className = "", ...props }) {
  const resolvedIcon = icon || (BADGE_TONE_ICONS[tone] ? <SidebarIcon name={BADGE_TONE_ICONS[tone]} decorative /> : null);
  return (
    <span
      className={`ui-badge ui-badge--${tone} ${className}`.trim()}
      {...props}
    >
      {resolvedIcon ? <span className="ui-badge__icon" aria-hidden="true">{resolvedIcon}</span> : null}
      {children}
    </span>
  );
}

export function Chip({ children, className = "", ...props }) {
  return (
    <span className={`ui-chip ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}

export function Progress({ value = 0, max = 100, label = "Progress" }) {
  const safeMax = Number(max) > 0 ? Number(max) : 100;
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), safeMax);
  const percentage = (safeValue / safeMax) * 100;
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin="0"
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
    >
      <div className="ui-progress__bar" style={{ width: `${percentage}%` }} />
    </div>
  );
}

export function Spinner({ label = "Loading", className = "" }) {
  return (
    <span
      className={`ui-spinner ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  actionLabel,
  onAction,
  icon = <SidebarIcon name="activity" decorative />,
  className = "",
}) {
  return (
    <div className={`ui-empty-state${icon ? " ui-empty-state--with-icon" : ""} ${className}`.trim()}>
      {icon ? <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span> : null}
      <strong>{title}</strong>
      {description ? (
        <p className="ui-empty-state__description">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="secondary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ToastRegion({ children, label = "Notifications" }) {
  return (
    <div className="ui-toast-region" aria-label={label} aria-live="polite">
      {children}
    </div>
  );
}

export function Toast(props) {
  return <Alert {...props} className={`ui-toast ${props.className || ""}`} />;
}
