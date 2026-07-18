const iconPaths = {
  profile: (
    <>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  leaderboard: (
    <>
      <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 11v5M8 20h8M9 16h6" />
    </>
  ),
  compare: (
    <>
      <path d="m7 7-4 4 4 4M3 11h13" />
      <path d="m17 3 4 4-4 4M21 7H8" />
    </>
  ),
  submit: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 7v10M7 12h10" />
    </>
  ),
  matches: (
    <>
      <path d="m4 4 7.5 7.5M3 3l3 1-2 2-1-3ZM11.5 11.5l2 2M20 4l-7.5 7.5M21 3l-3 1 2 2 1-3ZM12.5 11.5l-2 2" />
      <path d="m8 12-4 7 2 2 6-5M16 12l4 7-2 2-6-5" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  adminProfile: (
    <>
      <circle cx="10" cy="8" r="3" />
      <path d="M4.5 18c.5-3.4 2.3-5 5.5-5 1.3 0 2.4.3 3.3.8" />
      <path d="m17 14 .7 1.4 1.6.2-1.1 1.1.3 1.6-1.5-.7-1.4.7.3-1.6-1.1-1.1 1.6-.2L17 14Z" />
    </>
  ),
  adminDashboard: (
    <>
      <path d="M12 3 4 6v5c0 5 3.1 8.2 8 10 4.9-1.8 8-5 8-10V6l-8-3Z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20c.5-4 2.4-6 5.5-6s5 2 5.5 6M15 14c3.1 0 5 1.7 5.5 5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m12 3 1 2.2 2.4.5 1.9-1.5 2.5 2.5-1.5 1.9.5 2.4 2.2 1-1 3-2.2 1-.5 2.4 1.5 1.9-2.5 2.5-1.9-1.5-2.4.5-1 2.2h-3l-1-2.2-2.4-.5-1.9 1.5-2.5-2.5 1.5-1.9L3 15l-2.2-1v-3L3 10l.5-2.4L2 5.7l2.5-2.5 1.9 1.5L8.8 5l1-2.2h2.2Z" />
    </>
  ),
  disputes: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
      <path d="m15 8 4 4-4 4M9 12h10" />
    </>
  ),
  crown: (
    <>
      <path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7Z" />
      <path d="M5 18h14M7 14h10" />
    </>
  ),
  bolt: <path d="m13 2-8 12h6l-1 8 9-13h-6V2Z" />,
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  balance: (
    <>
      <path d="M12 4v16M7 20h10M5 7h14" />
      <path d="m5 7-3 6h6L5 7ZM19 7l-3 6h6l-3-6Z" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v3a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 11v5M8 20h8M9 16h6" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function SidebarIcon({ name, label, className = "", decorative = false }) {
  return (
    <svg
      className={`sidebar-svg-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label || `${name} icon`}
    >
      {iconPaths[name] || iconPaths.profile}
    </svg>
  );
}

export const SIDEBAR_ICON_NAMES = Object.freeze(Object.keys(iconPaths));
