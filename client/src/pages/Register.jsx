import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import SectionSkeleton from "../components/SectionSkeleton";
import { Alert, Button, Card, FormField, Input } from "../components/ui";
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
  const { isAuthenticated, isInitializing, register, user, getHomePathForRole } = useAuth();
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

  if (isInitializing) {
    return (
      <section className="auth-page">
        <Card as="div" variant="profile" className="auth-card">
          <p className="auth-kicker">Loading</p>
          <h1 className="auth-title">Checking your session</h1>
          <SectionSkeleton lines={3} />
        </Card>
      </section>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={getHomePathForRole(user?.role)} replace />;
  }

  return (
    <section className="auth-page">
      <Card as="div" variant="profile" className="auth-card">
        <p className="auth-kicker">Create your account</p>
        <h1 className="auth-title">Start tracking your edge</h1>
        <p className="auth-copy">
          Create a BragRight account to prepare for match history, rankings, and
          player insights.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <FormField label="Username" htmlFor="register-username" required className="form-field">
            <Input
              id="register-username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              placeholder="Competitive name"
              required
            />
          </FormField>

          <FormField label="Email" htmlFor="register-email" required className="form-field">
            <Input
              id="register-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
            />
          </FormField>

          <FormField
            label="Password"
            htmlFor="register-password"
            required
            description="Use at least 8 characters."
            className="form-field"
          >
            <Input
              id="register-password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="At least 8 characters"
              minLength="8"
              description="Use at least 8 characters."
              required
            />
          </FormField>

          {statusMessage ? (
            <Alert tone="error" className="auth-message error-text">
              {statusMessage}
            </Alert>
          ) : null}

          <Button
            className="auth-button"
            type="submit"
            isLoading={isSubmitting}
            loadingText="Creating account..."
          >
            Create account
          </Button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </Card>
    </section>
  );
}
