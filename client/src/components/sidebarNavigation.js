export const PLAYER_NAVIGATION_ITEMS = Object.freeze([
  { id: "profile", label: "Profile", icon: "profile", to: "/profile" },
  { id: "dashboard", label: "Dashboard", icon: "dashboard", to: "/dashboard", end: true },
  { id: "leaderboard", label: "Leaderboard", icon: "leaderboard", to: "/leaderboard" },
  { id: "head-to-head", label: "Head-to-Head", icon: "compare", to: "/head-to-head" },
  { id: "submit-match", label: "Submit Match", icon: "submit", to: "/dashboard/submit-match" },
  { id: "matches", label: "My Matches", icon: "matches", to: "/dashboard/matches" },
  { id: "my-activity", label: "My Activity", icon: "activity", to: "/activity" },
]);

export const ADMIN_NAVIGATION_ITEMS = Object.freeze([
  { id: "admin-dashboard", label: "Overview", icon: "adminDashboard", to: "/admin/dashboard" },
  { id: "admin-users", label: "Users", icon: "users", to: "/admin/users" },
  { id: "admin-disputes", label: "Disputes", icon: "disputes", to: "/admin/disputes" },
  { id: "admin-activity", label: "Activity", icon: "activity", to: "/admin/activity" },
  { id: "admin-settings", label: "Settings", icon: "settings", to: "/admin/settings" },
  { id: "admin-profile", label: "My Admin Profile", icon: "adminProfile", to: "/admin/profile" },
  { id: "player-area", label: "Player Area", icon: "dashboard", to: "/dashboard" },
]);
