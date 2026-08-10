export const PLAYER_NAVIGATION_ITEMS = Object.freeze([
  { id: "dashboard", label: "Dashboard", icon: "dashboard", to: "/dashboard", end: true },
  { id: "matches", label: "Match Actions", icon: "matches", to: "/dashboard/matches" },
  { id: "submit-match", label: "Challenge Player", icon: "submit", to: "/dashboard/submit-match" },
  { id: "profile", label: "Profile", icon: "profile", to: "/profile" },
  { id: "leaderboard", label: "Leaderboard", icon: "leaderboard", to: "/leaderboard" },
  { id: "head-to-head", label: "Head-to-Head", icon: "compare", to: "/head-to-head" },
  { id: "my-activity", label: "My Activity", icon: "activity", to: "/activity" },
  { id: "subscription", label: "Subscription", icon: "activity", to: "/payments/status" },
  { id: "password", label: "Password", icon: "settings", to: "/account/password" },
]);

export const ADMIN_NAVIGATION_ITEMS = Object.freeze([
  { id: "admin-dashboard", label: "Overview", icon: "adminDashboard", to: "/admin/dashboard" },
  { id: "admin-payments", label: "Payments", icon: "activity", to: "/admin/payments" },
  { id: "admin-users", label: "Users", icon: "users", to: "/admin/users" },
  { id: "admin-disputes", label: "Disputes", icon: "disputes", to: "/admin/disputes" },
  { id: "admin-activity", label: "Activity", icon: "activity", to: "/admin/activity" },
  { id: "admin-settings", label: "Settings", icon: "settings", to: "/admin/settings" },
  { id: "admin-profile", label: "My Admin Profile", icon: "adminProfile", to: "/admin/profile" },
  { id: "player-area", label: "Player Area", icon: "dashboard", to: "/dashboard" },
  { id: "password", label: "Password", icon: "settings", to: "/account/password" },
]);

export const PAYMENT_NAVIGATION_ITEMS = Object.freeze([
  { id: "payment-dashboard", label: "Collections", icon: "adminDashboard", to: "/payments/dashboard", end: true },
  { id: "record-payment", label: "Record Payment", icon: "submit", to: "/payments/record" },
  { id: "password", label: "Password", icon: "settings", to: "/account/password" },
]);

export const RESTRICTED_PLAYER_NAVIGATION_ITEMS = Object.freeze([
  { id: "payment-status", label: "Subscription", icon: "activity", to: "/payments/status", end: true },
  { id: "password", label: "Password", icon: "settings", to: "/account/password" },
]);
