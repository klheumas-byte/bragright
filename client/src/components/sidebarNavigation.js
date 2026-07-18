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
  { id: "admin-profile", label: "Admin Profile", icon: "adminProfile", to: "/admin/profile" },
  { id: "admin-dashboard", label: "Admin Dashboard", icon: "adminDashboard", to: "/admin/dashboard" },
  { id: "admin-activity", label: "Admin Activity", icon: "activity", to: "/admin/activity" },
  { id: "admin-users", label: "Admin Users", icon: "users", to: "/admin/users" },
  { id: "admin-settings", label: "Admin Settings", icon: "settings", to: "/admin/settings" },
  { id: "admin-disputes", label: "Admin Disputes", icon: "disputes", to: "/admin/disputes" },
]);
