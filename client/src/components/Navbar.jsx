import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { isAuthenticated, getHomePathForRole, user } = useAuth();
  const dashboardPath = getHomePathForRole(user?.role);

  return (
    <header className="navbar">
      <NavLink to="/" className="navbar-brand" aria-label="BragRight home">
        <span className="brand-mark">BR</span>
        <div>
          <p className="brand-tag">BragRight</p>
          <h1 className="brand-title">Play. Prove. Rank.</h1>
        </div>
      </NavLink>

      <nav className="navbar-links" aria-label="Main navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Home
        </NavLink>
        {isAuthenticated ? (
          <NavLink
            to={dashboardPath}
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Dashboard
          </NavLink>
        ) : (
          <>
            <NavLink
              to="/login"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              Sign in
            </NavLink>
            <NavLink
              to="/register"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              Join
            </NavLink>
          </>
        )}
      </nav>
    </header>
  );
}
