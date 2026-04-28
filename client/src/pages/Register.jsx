import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const initialFormState = {
  username: "",
  email: "",
  password: "",
};

export default function Register() {
  const [formData, setFormData] = useState(initialFormState);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated, register, user, getHomePathForRole } = useAuth();
  const navigate = useNavigate();

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
      const registeredUser = await register(formData);
      navigate(getHomePathForRole(registeredUser?.role), { replace: true });
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAuthenticated) {
    return <Navigate to={getHomePathForRole(user?.role)} replace />;
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="auth-kicker">Create your account</p>
        <h1 className="auth-title">Start tracking your edge</h1>
        <p className="auth-copy">
          Create a BragRight account to prepare for match history, rankings, and
          player insights.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            Username
            <input
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              placeholder="Competitive name"
              required
            />
          </label>

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
              placeholder="At least 8 characters"
              minLength="8"
              required
            />
          </label>

          {statusMessage ? <p className="auth-message error-text">{statusMessage}</p> : null}

          <button className="auth-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </section>
  );
}
