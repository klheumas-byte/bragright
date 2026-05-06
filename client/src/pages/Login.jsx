import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import SectionSkeleton from "../components/SectionSkeleton";
import { useAuth } from "../context/AuthContext";

const initialFormState = {
  email: "",
  password: "",
};

export default function Login() {
  const [formData, setFormData] = useState(initialFormState);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated, isInitializing, login, user, getHomePathForRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const redirectTo = location.state?.from?.pathname || getHomePathForRole(user?.role);

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((currentFormData) => ({
      ...currentFormData,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      const loggedInUser = await login(formData);
      navigate(location.state?.from?.pathname || getHomePathForRole(loggedInUser?.role), { replace: true });
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isInitializing) {
    return (
      <section className="auth-page">
        <div className="auth-card">
          <p className="auth-kicker">Loading</p>
          <h1 className="auth-title">Checking your session</h1>
          <SectionSkeleton lines={3} />
        </div>
      </section>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={getHomePathForRole(user?.role)} replace />;
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="auth-kicker">Welcome back</p>
        <h1 className="auth-title">Log in to BragRight</h1>
        <p className="auth-copy">
          Access your player dashboard, rankings, and competitive momentum.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            Email
            <input
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="form-field">
            Password
            <input
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              required
            />
          </label>

          {statusMessage ? <p className="auth-message error-text">{statusMessage}</p> : null}

          <button className="auth-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="auth-switch">
          Need an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </section>
  );
}
