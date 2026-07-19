import Card from "./ui/Card";

export function Skeleton({ className = "", width, height, rounded = false }) {
  return (
    <span
      className={`skeleton${rounded ? " skeleton--round" : ""} ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 2, className = "" }) {
  return (
    <span className={`skeleton-text ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className="skeleton-text__line" />
      ))}
    </span>
  );
}

export function SkeletonCircle({ size = 44, className = "" }) {
  return <Skeleton className={className} width={size} height={size} rounded />;
}

export function SkeletonAvatar({ size = 52 }) {
  return <SkeletonCircle size={size} className="skeleton-avatar" />;
}

export function SkeletonBadge() {
  return <Skeleton className="skeleton-badge" />;
}

export function SkeletonButton() {
  return <Skeleton className="skeleton-button" />;
}

export function SkeletonInput() {
  return <Skeleton className="skeleton-input" />;
}

export function SkeletonCard({ children, className = "" }) {
  return (
    <Card variant="loading" className={`skeleton-card ${className}`.trim()}>
      {children}
    </Card>
  );
}

export function SkeletonTableRow({ cells = 5 }) {
  return (
    <div className="skeleton-table-row" aria-hidden="true">
      {Array.from({ length: cells }, (_, index) => <Skeleton key={index} />)}
    </div>
  );
}

export function SkeletonListItem({ avatar = true }) {
  return (
    <SkeletonCard className="skeleton-list-item">
      {avatar ? <SkeletonAvatar /> : null}
      <SkeletonText lines={2} />
      <SkeletonBadge />
    </SkeletonCard>
  );
}

export function PageSkeleton({ label, children, className = "" }) {
  return (
    <section
      className={`page-skeleton ${className}`.trim()}
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only" role="status">{label}</span>
      {children}
    </section>
  );
}

export function SectionSkeleton({ children, className = "" }) {
  return <div className={`page-skeleton__section ${className}`.trim()}>{children}</div>;
}

function PageHeaderSkeleton() {
  return (
    <div className="page-skeleton__header">
      <SkeletonText lines={2} />
      <SkeletonButton />
    </div>
  );
}

function StatGridSkeleton({ count = 4 }) {
  return (
    <div className="page-skeleton__stats">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} className="page-skeleton__stat">
          <SkeletonBadge />
          <Skeleton className="skeleton-value" />
          <SkeletonText lines={1} />
        </SkeletonCard>
      ))}
    </div>
  );
}

function HeroSkeleton({ avatar = false, versus = false }) {
  return (
    <SkeletonCard className="page-skeleton__hero">
      {avatar ? <SkeletonAvatar size={84} /> : null}
      {versus ? <SkeletonAvatar size={72} /> : null}
      <SkeletonText lines={3} />
      {versus ? <><SkeletonBadge /><SkeletonAvatar size={72} /></> : <SkeletonButton />}
    </SkeletonCard>
  );
}

export function DashboardPageSkeleton() {
  return (
    <PageSkeleton label="Loading dashboard" className="dashboard-page-skeleton">
      <PageHeaderSkeleton />
      <HeroSkeleton avatar />
      <StatGridSkeleton count={4} />
      <div className="page-skeleton__columns">
        <SectionSkeleton><SkeletonText lines={1} />{Array.from({ length: 3 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
        <SectionSkeleton><SkeletonText lines={1} />{Array.from({ length: 4 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
      </div>
    </PageSkeleton>
  );
}

export function ProfilePageSkeleton({ publicProfile = false }) {
  return (
    <PageSkeleton label={publicProfile ? "Loading player profile" : "Loading profile"}>
      <HeroSkeleton avatar />
      <div className="page-skeleton__tabs">{Array.from({ length: 4 }, (_, i) => <SkeletonButton key={i} />)}</div>
      <PageHeaderSkeleton />
      <StatGridSkeleton count={6} />
      <SectionSkeleton>{Array.from({ length: 3 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
    </PageSkeleton>
  );
}

export function LeaderboardPageSkeleton() {
  return (
    <PageSkeleton label="Loading leaderboard">
      <HeroSkeleton avatar />
      <div className="page-skeleton__podium">{Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i}><SkeletonAvatar size={64} /><SkeletonText lines={2} /><SkeletonBadge /></SkeletonCard>)}</div>
      <div className="page-skeleton__controls"><SkeletonInput /><SkeletonButton /></div>
      <SectionSkeleton>{Array.from({ length: 7 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
      <div className="page-skeleton__pagination"><SkeletonButton /><SkeletonBadge /><SkeletonButton /></div>
    </PageSkeleton>
  );
}

export function MyMatchesPageSkeleton() {
  return (
    <PageSkeleton label="Loading matches">
      <HeroSkeleton />
      <StatGridSkeleton count={4} />
      <div className="page-skeleton__tabs">{Array.from({ length: 4 }, (_, i) => <SkeletonButton key={i} />)}</div>
      <SectionSkeleton>{Array.from({ length: 4 }, (_, i) => <MatchVersusSkeleton key={i} />)}</SectionSkeleton>
    </PageSkeleton>
  );
}

function MatchVersusSkeleton() {
  return (
    <SkeletonCard className="page-skeleton__versus">
      <SkeletonAvatar /><SkeletonText lines={2} /><SkeletonBadge /><SkeletonText lines={2} /><SkeletonAvatar />
    </SkeletonCard>
  );
}

export function MatchDetailsPageSkeleton() {
  return (
    <PageSkeleton label="Loading match details">
      <HeroSkeleton versus />
      <StatGridSkeleton count={3} />
      <div className="page-skeleton__columns">
        <SectionSkeleton><SkeletonText lines={1} /><SkeletonCard><Skeleton className="skeleton-evidence" /></SkeletonCard></SectionSkeleton>
        <SectionSkeleton>{Array.from({ length: 4 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
      </div>
    </PageSkeleton>
  );
}

export function SubmitMatchPageSkeleton() {
  return (
    <PageSkeleton label="Loading challenge form">
      <PageHeaderSkeleton />
      <HeroSkeleton />
      <SectionSkeleton><SkeletonInput />{Array.from({ length: 3 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
      <div className="page-skeleton__form"><SkeletonInput /><SkeletonInput /><SkeletonCard><Skeleton className="skeleton-upload" /></SkeletonCard><SkeletonButton /></div>
    </PageSkeleton>
  );
}

export function ActivityPageSkeleton({ admin = false }) {
  return (
    <PageSkeleton label={admin ? "Loading admin activity" : "Loading activity"}>
      <PageHeaderSkeleton />
      <div className="page-skeleton__controls"><SkeletonInput /><SkeletonButton /></div>
      <SectionSkeleton>{Array.from({ length: 6 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
      <div className="page-skeleton__pagination"><SkeletonButton /><SkeletonBadge /><SkeletonButton /></div>
    </PageSkeleton>
  );
}

export function NotificationsPageSkeleton() {
  return (
    <PageSkeleton label="Loading notifications">
      <PageHeaderSkeleton /><StatGridSkeleton count={2} />
      <div className="page-skeleton__controls"><SkeletonInput /><SkeletonButton /></div>
      <SectionSkeleton>{Array.from({ length: 6 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton>
    </PageSkeleton>
  );
}

export function AdminDashboardPageSkeleton() {
  return <PageSkeleton label="Loading admin dashboard"><PageHeaderSkeleton /><StatGridSkeleton count={4} /><SectionSkeleton>{Array.from({ length: 5 }, (_, i) => <SkeletonTableRow key={i} />)}</SectionSkeleton></PageSkeleton>;
}

export function AdminUsersPageSkeleton() {
  return <PageSkeleton label="Loading users"><PageHeaderSkeleton /><div className="page-skeleton__controls"><SkeletonInput /><SkeletonInput /><SkeletonButton /></div><SectionSkeleton>{Array.from({ length: 8 }, (_, i) => <SkeletonTableRow key={i} cells={6} />)}</SectionSkeleton></PageSkeleton>;
}

export function AdminDisputesPageSkeleton() {
  return <PageSkeleton label="Loading disputes"><PageHeaderSkeleton /><div className="page-skeleton__columns"><SectionSkeleton>{Array.from({ length: 6 }, (_, i) => <SkeletonListItem key={i} />)}</SectionSkeleton><SectionSkeleton><HeroSkeleton versus /><SkeletonText lines={4} /><SkeletonButton /></SectionSkeleton></div></PageSkeleton>;
}

export function AdminSettingsPageSkeleton() {
  return <PageSkeleton label="Loading admin settings"><PageHeaderSkeleton /><SectionSkeleton>{Array.from({ length: 6 }, (_, i) => <div className="page-skeleton__setting" key={i}><SkeletonText lines={2} /><SkeletonInput /></div>)}</SectionSkeleton></PageSkeleton>;
}

export function HeadToHeadPageSkeleton() {
  return <PageSkeleton label="Loading head-to-head comparison"><PageHeaderSkeleton /><div className="page-skeleton__controls"><SkeletonInput /><SkeletonInput /><SkeletonButton /></div><HeroSkeleton versus /><StatGridSkeleton count={4} /></PageSkeleton>;
}

export function AuthPageSkeleton() {
  return <PageSkeleton label="Loading sign in"><SkeletonCard className="auth-page-skeleton"><SkeletonCircle size={48} /><SkeletonText lines={3} /><SkeletonInput /><SkeletonInput /><SkeletonButton /></SkeletonCard></PageSkeleton>;
}

export function RoutePageSkeleton({ pathname = "" }) {
  if (pathname === "/dashboard") return <DashboardPageSkeleton />;
  if (pathname === "/profile") return <ProfilePageSkeleton />;
  if (pathname.startsWith("/players/")) return <ProfilePageSkeleton publicProfile />;
  if (pathname === "/leaderboard") return <LeaderboardPageSkeleton />;
  if (pathname === "/dashboard/matches") return <MyMatchesPageSkeleton />;
  if (pathname === "/dashboard/submit-match") return <SubmitMatchPageSkeleton />;
  if (pathname === "/activity") return <ActivityPageSkeleton />;
  if (pathname.startsWith("/head-to-head")) return <HeadToHeadPageSkeleton />;
  if (pathname === "/admin/dashboard") return <AdminDashboardPageSkeleton />;
  if (pathname === "/admin/users") return <AdminUsersPageSkeleton />;
  if (pathname === "/admin/disputes") return <AdminDisputesPageSkeleton />;
  if (pathname === "/admin/activity") return <ActivityPageSkeleton admin />;
  if (pathname === "/admin/settings" || pathname === "/admin/profile") return <AdminSettingsPageSkeleton />;
  return <PageSkeleton label="Loading page"><PageHeaderSkeleton /><HeroSkeleton /><StatGridSkeleton /></PageSkeleton>;
}
