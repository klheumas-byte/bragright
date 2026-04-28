import { NavLink } from "react-router-dom";

export default function Navbar() {
  return (
    <header className="navbar">
      <div className="navbar-brand">
        <p className="brand-tag">BragRight</p>
        <h1 className="brand-title">React + Flask Dashboard Foundation</h1>
      </div>

      <nav className="navbar-links" aria-label="Main navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Home
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/login"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Login
        </NavLink>
        <NavLink
          to="/register"
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          Register
        </NavLink>
      </nav>
    </header>
  );
}
