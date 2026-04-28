import { Navigate, Route, Routes } from "react-router-dom";
import GlobalLoadingBar from "./components/GlobalLoadingBar";
import ProtectedRoute from "./components/ProtectedRoute";
import MainLayout from "./layouts/MainLayout";
import AdminDashboard from "./pages/AdminDashboard";
import AdminActivity from "./pages/AdminActivity";
import AdminSettings from "./pages/AdminSettings";
import AdminUsers from "./pages/AdminUsers";
import Dashboard from "./pages/Dashboard";
import AdminDisputes from "./pages/AdminDisputes";
import AdminProfile from "./pages/AdminProfile";
import HeadToHead from "./pages/HeadToHead";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import Login from "./pages/Login";
import MyActivity from "./pages/MyActivity";
import MyMatches from "./pages/MyMatches";
import Profile from "./pages/Profile";
import PlayerProfile from "./pages/PlayerProfile";
import Register from "./pages/Register";
import SubmitMatch from "./pages/SubmitMatch";

export default function App() {
  return (
    <>
      <GlobalLoadingBar />
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="*" element={<Navigate to="/" replace />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
