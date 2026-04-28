import { useEffect, useMemo, useState } from "react";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SuccessAlert from "../components/SuccessAlert";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  createAdminUser,
  getAdminUsers,
  resetAdminUserPassword,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "../services/api";

const initialConfirmationState = {
  isOpen: false,
  title: "",
  description: "",
  confirmLabel: "Confirm",
  action: null,
};

const initialCreateUserState = {
  username: "",
  email: "",
  role: "player",
};

export default function AdminUsers() {
  const { trackLoading } = useLoading();
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    search: "",
    role: "all",
    status: "all",
  });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [confirmationState, setConfirmationState] = useState(initialConfirmationState);
  const [generatedPassword, setGeneratedPassword] = useState(null);
  const [createUserValues, setCreateUserValues] = useState(initialCreateUserState);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [activeActionKey, setActiveActionKey] = useState("");

  useEffect(() => {
    loadUsers(filters);
  }, [filters.role, filters.search, filters.status]);

  const hasActiveFilters = useMemo(
    () => Boolean(filters.search.trim() || filters.role !== "all" || filters.status !== "all"),
    [filters]
  );

  async function loadUsers(nextFilters = filters) {
    try {
      setIsLoading(true);
      const response = await trackLoading(() => getAdminUsers(nextFilters));
      setUsers(Array.isArray(response?.data?.users) ? response.data.users.map(normalizeAdminUser) : []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  function handleCreateUserChange(event) {
    const { name, value } = event.target;
    setCreateUserValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  function syncUpdatedUser(updatedUser) {
    const normalizedUser = normalizeAdminUser(updatedUser);
    setUsers((currentUsers) =>
      currentUsers.map((user) => (user.id === normalizedUser.id ? normalizedUser : user))
    );
  }

  async function executeRoleChange(user, nextRole) {
    try {
      setFeedback({ type: "", message: "" });
      setGeneratedPassword(null);
      setActiveActionKey(`${user.id}:role`);
      const response = await trackLoading(() => updateAdminUserRole(user.id, nextRole));
      syncUpdatedUser(response.data);
      setFeedback({ type: "success", message: nextRole === "admin" ? "Role updated. User promoted to admin." : "Role updated." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      await loadUsers();
    } finally {
      setActiveActionKey("");
    }
  }

  function handleRoleSelection(user, nextRole) {
    if (!nextRole || nextRole === user.role) {
      return;
    }

    if (nextRole === "admin" && user.role !== "admin") {
      setConfirmationState({
        isOpen: true,
        title: `Promote ${user.username} to admin?`,
        description: "Admins gain access to dispute moderation, user management, and admin dashboard controls.",
        confirmLabel: "Promote to admin",
        action: () => executeRoleChange(user, nextRole),
      });
      return;
    }

    executeRoleChange(user, nextRole);
  }

  async function executeStatusChange(user, nextStatus) {
    try {
      setFeedback({ type: "", message: "" });
      setGeneratedPassword(null);
      setActiveActionKey(`${user.id}:status`);
      const response = await trackLoading(() => updateAdminUserStatus(user.id, nextStatus));
      syncUpdatedUser(response.data);
      setFeedback({
        type: "success",
        message: nextStatus === "disabled" ? "User disabled." : "User enabled.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      await loadUsers();
    } finally {
      setActiveActionKey("");
    }
  }

  function handleStatusToggle(user) {
    const nextStatus = user.status === "active" ? "disabled" : "active";

    if (nextStatus === "disabled") {
      setConfirmationState({
        isOpen: true,
        title: `Disable ${user.username}?`,
        description: "Disabled users can no longer sign in or access their BragRight account until an admin re-enables them.",
        confirmLabel: "Disable user",
        action: () => executeStatusChange(user, nextStatus),
      });
      return;
    }

    executeStatusChange(user, nextStatus);
  }

  async function handlePasswordReset(user) {
    try {
      setFeedback({ type: "", message: "" });
      setGeneratedPassword(null);
      setActiveActionKey(`${user.id}:password`);
      const response = await trackLoading(() => resetAdminUserPassword(user.id));
      const temporaryPassword =
        response?.data?.temporary_password ||
        response?.temporary_password ||
        response?.data?.password ||
        "";

      if (!temporaryPassword) {
        throw new Error(
          response?.message || "The reset password response did not include a temporary password."
        );
      }

      setGeneratedPassword({
        userId: user.id,
        username: user.username,
        temporaryPassword,
      });
      setFeedback({
        type: "success",
        message: response?.message || "Temporary password generated.",
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setActiveActionKey("");
    }
  }

  async function handleCreateUserSubmit(event) {
    event.preventDefault();

    try {
      setFeedback({ type: "", message: "" });
      setGeneratedPassword(null);
      setIsCreatingUser(true);
      const response = await trackLoading(() => createAdminUser(createUserValues));
      const createdUser = response?.data?.user;
      if (createdUser) {
        setUsers((currentUsers) => [normalizeAdminUser(createdUser), ...currentUsers]);
      } else {
        await loadUsers();
      }

      setGeneratedPassword({
        userId: response?.data?.user?.id || "",
        username: response?.data?.user?.username || createUserValues.username,
        temporaryPassword: response?.data?.temporary_password || "",
      });
      setCreateUserValues(initialCreateUserState);
      setFeedback({ type: "success", message: response.message || "User created successfully." });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmationState.action) {
      return;
    }

    const action = confirmationState.action;
    setConfirmationState(initialConfirmationState);
    await action();
  }

  return (
    <DashboardLayout
      title="Admin Users"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Users</p>
          <h2 className="feature-hero-title">Manage player and admin accounts.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Visible users</p>
          <p className="feature-callout-value">{users.length}</p>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Create User</p>
            <h2 className="panel-title">Add a player or admin</h2>
          </div>
        </div>

        <form className="admin-activity-filters" onSubmit={handleCreateUserSubmit}>
          <label className="form-field">
            Username
            <input
              name="username"
              value={createUserValues.username}
              onChange={handleCreateUserChange}
              placeholder="New username"
              disabled={isCreatingUser}
              required
            />
          </label>

          <label className="form-field">
            Email
            <input
              type="email"
              name="email"
              value={createUserValues.email}
              onChange={handleCreateUserChange}
              placeholder="player@example.com"
              disabled={isCreatingUser}
              required
            />
          </label>

          <label className="form-field">
            Role
            <select name="role" value={createUserValues.role} onChange={handleCreateUserChange} disabled={isCreatingUser}>
              <option value="player">Player</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button className="auth-button" type="submit" disabled={isCreatingUser}>
            <ButtonLoadingText isLoading={isCreatingUser} loadingText="Saving...">
              Create User
            </ButtonLoadingText>
          </button>
        </form>
      </section>

      <section className="dashboard-panel">
        <div className="admin-toolbar admin-user-filters">
          <label className="form-field">
            Search users
            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilterChange}
              placeholder="Search by username or email"
            />
          </label>

          <label className="form-field">
            Role
            <select name="role" value={filters.role} onChange={handleFilterChange}>
              <option value="all">All roles</option>
              <option value="player">Players</option>
              <option value="admin">Admins</option>
            </select>
          </label>

          <label className="form-field">
            Status
            <select name="status" value={filters.status} onChange={handleFilterChange}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

        <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
        <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={() => loadUsers(filters)} />

        {generatedPassword ? (
          <div className="admin-generated-password-card">
            <p className="panel-kicker">Temporary Password</p>
            <h3 className="panel-title">Reset created for {generatedPassword.username}</h3>
            <p className="section-copy">
              Share this temporary password securely. The user can sign in with it immediately.
            </p>
            <code className="admin-generated-password-value">{generatedPassword.temporaryPassword}</code>
          </div>
        ) : null}

        {isLoading ? (
          <SectionLoader as="div" lines={8} message="Loading users..." className="" />
        ) : users.length ? (
          <div className="admin-users-table">
            <div className="admin-users-table-header">
              <span>Username</span>
              <span>Email</span>
              <span>Role</span>
              <span>Status</span>
              <span>Last login</span>
              <span>Actions</span>
            </div>

            <div className="admin-users-table-body">
              {users.map((user) => (
                <article key={user.id} className="admin-users-row">
                  <div className="admin-users-cell">
                    <p className="admin-users-primary">{user.username}</p>
                    <p className="admin-users-secondary">Created {formatDate(user.created_at)}</p>
                  </div>

                  <div className="admin-users-cell">
                    <p className="admin-users-primary">{user.email}</p>
                  </div>

                  <div className="admin-users-cell">
                    <span className={`match-status-badge ${user.role === "admin" ? "match-status-pending" : "match-status-confirmed"}`}>
                      {user.role}
                    </span>
                  </div>

                  <div className="admin-users-cell">
                    <span className={`match-status-badge ${user.status === "active" ? "match-status-confirmed" : "match-status-rejected"}`}>
                      {user.status}
                    </span>
                  </div>

                  <div className="admin-users-cell">
                    <p className="admin-users-primary">{formatDate(user.last_login_at)}</p>
                  </div>

                  <div className="admin-users-cell admin-users-actions">
                    <label className="form-field admin-users-action-field">
                      <span className="sr-only">Change role for {user.username}</span>
                      <select
                        value={user.role}
                        disabled={activeActionKey === `${user.id}:role`}
                        onChange={(event) => handleRoleSelection(user, event.target.value)}
                      >
                        <option value="player">Player</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>

                    <button
                      type="button"
                      className="inline-action-button"
                      disabled={activeActionKey === `${user.id}:status`}
                      onClick={() => handleStatusToggle(user)}
                    >
                      <ButtonLoadingText
                        isLoading={activeActionKey === `${user.id}:status`}
                        loadingText="Saving..."
                      >
                        {user.status === "active" ? "Disable" : "Enable"}
                      </ButtonLoadingText>
                    </button>

                    <button
                      type="button"
                      className="auth-button admin-reset-password-button"
                      disabled={activeActionKey === `${user.id}:password`}
                      onClick={() => handlePasswordReset(user)}
                    >
                      <ButtonLoadingText
                        isLoading={activeActionKey === `${user.id}:password`}
                        loadingText="Resetting..."
                      >
                        Reset password
                      </ButtonLoadingText>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="match-empty-state">
            <p className="empty-state-copy">{hasActiveFilters ? "No matching filters." : "No users found."}</p>
          </div>
        )}
      </section>

      {confirmationState.isOpen ? (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-confirmation-title">
            <p className="panel-kicker">Confirm admin action</p>
            <h2 id="admin-confirmation-title" className="panel-title">
              {confirmationState.title}
            </h2>
            <p className="section-copy">{confirmationState.description}</p>

            <div className="admin-modal-actions">
              <button type="button" className="inline-action-button" onClick={() => setConfirmationState(initialConfirmationState)}>
                Cancel
              </button>
              <button type="button" className="auth-button" onClick={handleConfirmAction}>
                {confirmationState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

function normalizeAdminUser(user) {
  const status = user?.status || (user?.is_active ? "active" : "disabled");

  return {
    id: user?.id || "",
    username: user?.username || "Unknown user",
    email: user?.email || "",
    role: user?.role || "player",
    status,
    is_active: status === "active",
    created_at: user?.created_at || null,
    updated_at: user?.updated_at || null,
    last_login_at: user?.last_login_at || null,
  };
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
