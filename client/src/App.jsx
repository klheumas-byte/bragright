import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import GlobalLoadingBar from "./components/GlobalLoadingBar";
import ProtectedRoute from "./components/ProtectedRoute";
import SectionLoader from "./components/SectionLoader";
import MainLayout from "./layouts/MainLayout";

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
      <GlobalLoadingBar />
      <Suspense fallback={<SectionLoader lines={6} message="Loading page..." />}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route
            path="/leaderboard"
            element={
              <ProtectedRoute>
                <Leaderboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/players/:playerId"
            element={
              <ProtectedRoute>
                <PlayerProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute>
                <MyActivity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/head-to-head"
            element={
              <ProtectedRoute>
                <HeadToHead />
              </ProtectedRoute>
            }
          />
          <Route
            path="/head-to-head/:playerAId/:playerBId"
            element={
              <ProtectedRoute>
                <HeadToHead />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/profile"
            element={
              <ProtectedRoute requireAdmin>
                <AdminProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute requireAdmin>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/activity"
            element={
              <ProtectedRoute requireAdmin>
                <AdminActivity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute requireAdmin>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute requireAdmin>
                <AdminSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/disputes"
            element={
              <ProtectedRoute requireAdmin>
                <AdminDisputes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/submit-match"
            element={
              <ProtectedRoute>
                <SubmitMatch />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/matches"
            element={
              <ProtectedRoute>
                <MyMatches />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
