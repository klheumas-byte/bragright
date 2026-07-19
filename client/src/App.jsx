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
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/players/:playerId" element={<PlayerProfile />} />
            <Route path="/activity" element={<MyActivity />} />
            <Route path="/head-to-head" element={<HeadToHead />} />
            <Route path="/head-to-head/:playerAId/:playerBId" element={<HeadToHead />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/submit-match" element={<SubmitMatch />} />
            <Route path="/dashboard/matches" element={<MyMatches />} />
            <Route path="/admin/profile" element={<ProtectedRoute requireAdmin><AdminProfile /></ProtectedRoute>} />
            <Route path="/admin/dashboard" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/activity" element={<ProtectedRoute requireAdmin><AdminActivity /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettings /></ProtectedRoute>} />
            <Route path="/admin/disputes" element={<ProtectedRoute requireAdmin><AdminDisputes /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Suspense fallback={<AuthPageSkeleton />}><NotFound /></Suspense>} />
        </Routes>
    </>
  );
}
