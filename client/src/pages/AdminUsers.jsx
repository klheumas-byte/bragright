import { useEffect, useMemo, useState } from "react";
import ErrorState from "../components/ErrorState";
import PlayerIdentity from "../components/PlayerIdentity";
import SuccessAlert from "../components/SuccessAlert";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Modal,
  PageSection,
  Select,
} from "../components/ui";
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

const USER_ROLE_OPTIONS = [
  { value: "player", label: "Player" },
  { value: "payment_officer", label: "Payment Officer" },
  { value: "super_admin", label: "Super Admin" },
];

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
      setFeedback({ type: "success", message: ["admin", "super_admin"].includes(nextRole) ? "Role updated. User promoted to Super Admin." : "Role updated." });
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

    if (["admin", "super_admin"].includes(nextRole) && !["admin", "super_admin"].includes(user.role)) {
      setConfirmationState({
        isOpen: true,
        title: `Promote ${user.username} to Super Admin?`,
        description: "Super Admins gain complete payment, dispute, user, and system oversight.",
        confirmLabel: "Promote to Super Admin",
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
        message: nextStatus === "active" ? "User restored." : `User marked ${nextStatus}.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
      await loadUsers();
    } finally {
      setActiveActionKey("");
    }
  }

  function handleStatusSelection(user, nextStatus) {
    if (!nextStatus || nextStatus === user.status) return;
    if (nextStatus !== "active") {
      setConfirmationState({
        isOpen: true,
        title: `Mark ${user.username} as ${nextStatus}?`,
        description: "This security restriction blocks sign-in but preserves payment, match, and audit history.",
        confirmLabel: `Confirm ${nextStatus}`,
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

  const columns = [
    {
      id: "username",
      header: "Username",
      cell: (user) => (
        <div className="admin-users-cell">
          <PlayerIdentity
            player={user}
            variant="admin"
            showUsername={false}
            showBadges={false}
            showPrivateMeta={false}
          />
          <p className="admin-users-secondary">Created {formatDate(user.created_at)}</p>
        </div>
      ),
    },
    { id: "email", header: "Email", accessor: "email" },
    {
      id: "role",
      header: "Role",
      cell: (user) => <Badge tone={user.role === "admin" ? "warning" : "success"}>{user.role}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      cell: (user) => <Badge tone={user.status === "active" ? "success" : "danger"}>{user.status}</Badge>,
    },
    {
      id: "last_login",
      header: "Last login",
      cell: (user) => formatDate(user.last_login_at),
    },
  ];

  return (
    <DashboardLayout
      title="Admin Users"
      description="Manage player access without losing sight of the competition."
    >
      <Card as="section" variant="dashboard" className="feature-hero-card">
        <div>
          <p className="section-label">Users</p>
          <h2 className="feature-hero-title">Manage player and admin accounts.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Visible users</p>
          <p className="feature-callout-value">{users.length}</p>
        </div>
      </Card>

      <PageSection title="Create User" description="Add an account.">
        <Card as="form" variant="dashboard" onSubmit={handleCreateUserSubmit} className="admin-activity-filters">
          <Field
            label="Username"
            name="username"
            value={createUserValues.username}
            onChange={handleCreateUserChange}
            placeholder="New username"
            disabled={isCreatingUser}
            required
          />

          <Field
            label="Email"
            type="email"
            name="email"
            value={createUserValues.email}
            onChange={handleCreateUserChange}
            placeholder="player@example.com"
            disabled={isCreatingUser}
            required
          />

          <Field control={Select} id="create-user-role" label="Role" name="role" value={createUserValues.role} onChange={handleCreateUserChange} disabled={isCreatingUser}>
            {USER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Field>

          <Button type="submit" isLoading={isCreatingUser} loadingText="Saving...">
            Create User
          </Button>
        </Card>
      </PageSection>

      <PageSection title="All users" description="Search, filter, and manage every account.">
        <Card variant="dashboard" className="admin-toolbar admin-user-filters">
          <Field
            label="Search users"
            type="text"
            name="search"
            value={filters.search}
            onChange={handleFilterChange}
            placeholder="Search by username or email"
          />

          <Field control={Select} id="filter-role" label="Role" name="role" value={filters.role} onChange={handleFilterChange}>
            <option value="all">All roles</option>
            <option value="player">Players</option>
            <option value="payment_officer">Payment Officers</option>
            <option value="super_admin">Super Admins</option>
            <option value="admin">Legacy Admins</option>
          </Field>

          <Field control={Select} label="Status" name="status" value={filters.status} onChange={handleFilterChange}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
            <option value="disabled">Disabled</option>
            <option value="deleted">Deleted</option>
          </Field>
        </Card>

        <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
        <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={() => loadUsers(filters)} />

        {generatedPassword ? (
          <Card variant="dashboard" className="admin-generated-password-card">
            <p className="panel-kicker">Temporary Password</p>
            <h3 className="panel-title">Reset created for {generatedPassword.username}</h3>
            <p className="section-copy">
              Share this temporary password securely. The user can sign in with it immediately.
            </p>
            <code className="admin-generated-password-value">{generatedPassword.temporaryPassword}</code>
          </Card>
        ) : null}

        <DataTable
          columns={columns}
          rows={users}
          isLoading={isLoading}
          caption="Admin-managed player and admin accounts"
          emptyTitle={hasActiveFilters ? "No matching users" : "No users found"}
          emptyDescription={hasActiveFilters ? "No matching filters." : "No users found."}
          actionsLabel="Actions"
          renderActions={(user) => (
            <div className="admin-users-actions">
              <Select
                aria-label={`Change role for ${user.username}`}
                value={user.role}
                disabled={activeActionKey === `${user.id}:role`}
                onChange={(event) => handleRoleSelection(user, event.target.value)}
              >
                {USER_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                {user.role === "admin" ? <option value="admin">Legacy Admin</option> : null}
              </Select>

              <Select
                aria-label={`Change status for ${user.username}`}
                value={user.status}
                disabled={activeActionKey === `${user.id}:status`}
                onChange={(event) => handleStatusSelection(user, event.target.value)}
              >
                <option value="active">Active / Restore</option>
                <option value="suspended">Suspended</option>
                <option value="banned">Banned</option>
                <option value="disabled">Disabled</option>
                <option value="deleted">Soft deleted</option>
              </Select>

              <Button
                size="sm"
                isLoading={activeActionKey === `${user.id}:password`}
                loadingText="Resetting..."
                onClick={() => handlePasswordReset(user)}
              >
                Reset password
              </Button>
            </div>
          )}
        />
      </PageSection>

      <Modal
        isOpen={confirmationState.isOpen}
        onClose={() => setConfirmationState(initialConfirmationState)}
        eyebrow="Confirm admin action"
        title={confirmationState.title}
        description={confirmationState.description}
        titleClassName="panel-title"
        descriptionClassName="section-copy"
        className="admin-modal"
        actions={
          <>
            <Button
              variant="secondary"
              className="inline-action-button"
              onClick={() => setConfirmationState(initialConfirmationState)}
            >
              Cancel
            </Button>
            <Button className="auth-button" onClick={handleConfirmAction}>
              {confirmationState.confirmLabel}
            </Button>
          </>
        }
      />
    </DashboardLayout>
  );
}

function normalizeAdminUser(user) {
  const status = user?.status || (user?.is_active ? "active" : "disabled");

  return {
    id: user?.id || "",
    username: user?.username || "Unknown user",
    email: user?.email || "",
    profile_image: user?.profile_image || "",
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
