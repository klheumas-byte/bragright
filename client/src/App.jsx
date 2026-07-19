import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthPageSkeleton } from "./components/LoadingSkeletons";
import ProtectedRoute from "./components/ProtectedRoute";
import RouteProgress from "./components/RouteProgress";
import { DashboardLayoutProvider, DashboardShell } from "./layouts/DashboardLayout";
import MainLayout from "./layouts/MainLayout";
import { NotificationProvider } from "./notifications/NotificationCenter";

const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminActivity = lazy(() => import("./pages/AdminActivity"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AdminDisputes = lazy(() => import("./pages/AdminDisputes"));
const AdminProfile = lazy(() => import("./pages/AdminProfile"));
const HeadToHead = lazy(() => import("./pages/HeadToHead"));
const Home = lazy(() => import("./pages/Home"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Login = lazy(() => import("./pages/Login"));
const MyActivity = lazy(() => import("./pages/MyActivity"));
const MyMatches = lazy(() => import("./pages/MyMatches"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Profile = lazy(() => import("./pages/Profile"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const Register = lazy(() => import("./pages/Register"));
const SubmitMatch = lazy(() => import("./pages/SubmitMatch"));

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
