import { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthPageSkeleton } from "./components/LoadingSkeletons";
import ProtectedRoute from "./components/ProtectedRoute";
import RouteProgress from "./components/RouteProgress";
import { DashboardLayoutProvider, DashboardShell } from "./layouts/DashboardLayout";
import MainLayout from "./layouts/MainLayout";
import { NotificationProvider } from "./notifications/NotificationCenter";
import { lazyWithRouteRecovery } from "./utils/lazyWithRouteRecovery";

const AdminDashboard = lazyWithRouteRecovery(() => import("./pages/AdminDashboard"), "admin-dashboard");
const AdminActivity = lazyWithRouteRecovery(() => import("./pages/AdminActivity"), "admin-activity");
const AdminSettings = lazyWithRouteRecovery(() => import("./pages/AdminSettings"), "admin-settings");
const AdminUsers = lazyWithRouteRecovery(() => import("./pages/AdminUsers"), "admin-users");
const Dashboard = lazyWithRouteRecovery(() => import("./pages/Dashboard"), "dashboard");
const AdminDisputes = lazyWithRouteRecovery(() => import("./pages/AdminDisputes"), "admin-disputes");
const AdminProfile = lazyWithRouteRecovery(() => import("./pages/AdminProfile"), "admin-profile");
const HeadToHead = lazyWithRouteRecovery(() => import("./pages/HeadToHead"), "head-to-head");
const Home = lazyWithRouteRecovery(() => import("./pages/Home"), "home");
const Leaderboard = lazyWithRouteRecovery(() => import("./pages/Leaderboard"), "leaderboard");
const Login = lazyWithRouteRecovery(() => import("./pages/Login"), "login");
const MyActivity = lazyWithRouteRecovery(() => import("./pages/MyActivity"), "activity");
const MyMatches = lazyWithRouteRecovery(() => import("./pages/MyMatches"), "matches");
const NotFound = lazyWithRouteRecovery(() => import("./pages/NotFound"), "not-found");
const Profile = lazyWithRouteRecovery(() => import("./pages/Profile"), "profile");
const PlayerProfile = lazyWithRouteRecovery(() => import("./pages/PlayerProfile"), "player-profile");
const Register = lazyWithRouteRecovery(() => import("./pages/Register"), "register");
const SubmitMatch = lazyWithRouteRecovery(() => import("./pages/SubmitMatch"), "submit-match");
const MatchAction = lazyWithRouteRecovery(() => import("./pages/MatchAction"), "match-action");
const PaymentOperations = lazyWithRouteRecovery(() => import("./pages/PaymentOperations"), "payment-operations");
const SubscriptionStatus = lazyWithRouteRecovery(() => import("./pages/SubscriptionStatus"), "subscription-status");
const PasswordSettings = lazyWithRouteRecovery(() => import("./pages/PasswordSettings"), "password-settings");

export default function App() {
  return (
    <>
      <RouteProgress />
      <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route
            element={
              <ProtectedRoute>
                <NotificationProvider>
                  <DashboardLayoutProvider>
                    <DashboardShell />
                  </DashboardLayoutProvider>
                </NotificationProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/leaderboard" element={<ProtectedRoute requireSubscription><Leaderboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute requireSubscription><Profile /></ProtectedRoute>} />
            <Route path="/players/:playerId" element={<ProtectedRoute requireSubscription><PlayerProfile /></ProtectedRoute>} />
            <Route path="/activity" element={<ProtectedRoute requireSubscription><MyActivity /></ProtectedRoute>} />
            <Route path="/head-to-head" element={<ProtectedRoute requireSubscription><HeadToHead /></ProtectedRoute>} />
            <Route path="/head-to-head/:playerAId/:playerBId" element={<ProtectedRoute requireSubscription><HeadToHead /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute requireSubscription><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard/submit-match" element={<ProtectedRoute requireSubscription><SubmitMatch /></ProtectedRoute>} />
            <Route path="/dashboard/matches" element={<ProtectedRoute requireSubscription><MyMatches /></ProtectedRoute>} />
            <Route path="/payments/status" element={<ProtectedRoute allowedRoles={["player"]}><SubscriptionStatus /></ProtectedRoute>} />
            <Route path="/account/password" element={<PasswordSettings />} />
            <Route path="/payments/dashboard" element={<ProtectedRoute allowedRoles={["payment_officer"]}><PaymentOperations /></ProtectedRoute>} />
            <Route path="/payments/record" element={<ProtectedRoute allowedRoles={["payment_officer"]}><PaymentOperations view="record" /></ProtectedRoute>} />
            <Route path="/admin/payments" element={<ProtectedRoute requireAdmin><PaymentOperations /></ProtectedRoute>} />
            <Route path="/admin/profile" element={<ProtectedRoute requireAdmin><AdminProfile /></ProtectedRoute>} />
            <Route path="/admin/dashboard" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/activity" element={<ProtectedRoute requireAdmin><AdminActivity /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettings /></ProtectedRoute>} />
            <Route path="/admin/disputes" element={<ProtectedRoute requireAdmin><AdminDisputes /></ProtectedRoute>} />
          </Route>
          <Route path="/matches/:matchId/sent" element={<ProtectedRoute requireSubscription><MatchAction mode="sent" /></ProtectedRoute>} />
          <Route path="/matches/:matchId/respond" element={<ProtectedRoute requireSubscription><MatchAction mode="respond" /></ProtectedRoute>} />
          <Route path="/matches/:matchId/result/submit" element={<ProtectedRoute requireSubscription><MatchAction mode="submit" /></ProtectedRoute>} />
          <Route path="/matches/:matchId/result/confirm" element={<ProtectedRoute requireSubscription><MatchAction mode="confirm" /></ProtectedRoute>} />
          <Route path="*" element={<Suspense fallback={<AuthPageSkeleton />}><NotFound /></Suspense>} />
        </Routes>
    </>
  );
}
