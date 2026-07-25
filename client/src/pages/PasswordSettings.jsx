import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, FormField, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";

const initialForm = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export default function PasswordSettings() {
  const { user, changePassword, getHomePathForRole } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [showPasswords, setShowPasswords] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [saving, setSaving] = useState(false);
  const mandatory = user?.must_change_password === true;

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setFeedback({ type: "", message: "" });
    if (form.new_password !== form.confirm_password) {
      setFeedback({ type: "error", message: "New password confirmation does not match." });
      return;
    }
    if (
      form.new_password.length < PASSWORD_MIN_LENGTH
      || form.new_password.length > PASSWORD_MAX_LENGTH
    ) {
      setFeedback({
        type: "error",
        message: `Your new password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
      });
      return;
    }
    if (form.new_password === form.current_password) {
      setFeedback({
        type: "error",
        message: "Choose a new password that is different from your current password.",
      });
      return;
    }
    setSaving(true);
    try {
      const response = await changePassword(form);
      setForm(initialForm);
      setFeedback({ type: "success", message: response.message || "Password updated successfully." });
      if (mandatory) {
        navigate(getHomePathForRole(response.user?.role || user?.role), { replace: true });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout
      title={mandatory ? "Choose Your Password" : "Password Settings"}
      description="Set a private password that only you know."
      showBackButton={!mandatory}
    >
      <Card as="section" variant="profile" className="password-settings-card">
        <p className="section-label">{mandatory ? "First login" : "Account security"}</p>
        <h2 className="panel-title">
          {mandatory ? "Replace your temporary password" : "Change your password"}
        </h2>
        <p className="section-copy">
          Use 8–128 characters. Your other signed-in sessions will be closed after this change.
        </p>

        <form className="auth-form" onSubmit={submit}>
          <FormField label="Current password" htmlFor="current-password" required>
            <Input id="current-password" name="current_password" type={showPasswords ? "text" : "password"} value={form.current_password} onChange={update} autoComplete="current-password" required />
          </FormField>
          <FormField label="Preferred new password" htmlFor="new-password" required description="Use at least 8 characters.">
            <Input id="new-password" name="new_password" type={showPasswords ? "text" : "password"} value={form.new_password} onChange={update} minLength="8" maxLength="128" autoComplete="new-password" required />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirm-password" required>
            <Input id="confirm-password" name="confirm_password" type={showPasswords ? "text" : "password"} value={form.confirm_password} onChange={update} minLength="8" maxLength="128" autoComplete="new-password" required />
          </FormField>

          <label className="password-visibility-control">
            <input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />
            Show passwords
          </label>

          {feedback.message ? <Alert tone={feedback.type === "error" ? "error" : "success"} role="status">{feedback.message}</Alert> : null}

          <Button type="submit" isLoading={saving} loadingText="Saving password…">
            Save my password
          </Button>
        </form>
      </Card>
    </DashboardLayout>
  );
}
