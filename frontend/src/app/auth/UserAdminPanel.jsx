import { useMemo, useState } from "react";
import { BadgeCheck, KeyRound, Shield, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react";

import { resourceGroups, resources } from "../../resourceConfig";
import { makeRoleId, makeUserId, roleHasResourceAccess } from "../../lib/localAuth";
import { quoteCompanyKey, quoteCompanyLabel, quoteCompanyOptions } from "../../lib/quoteCompanies";

const groupLabelsByKey = Object.fromEntries(resourceGroups.map((group) => [group.key, group.label]));

function landingPageOptionsForRole(roleDefinitions, roleName) {
  return resources.filter((item) => (
    !item.permissionOnly
    && !item.hideFromNav
    && roleHasResourceAccess(roleDefinitions, roleName, item.key)
  ));
}

function validDefaultLandingPage(roleDefinitions, roleName, value) {
  const key = String(value || "").trim();
  if (!key) return "";
  return landingPageOptionsForRole(roleDefinitions, roleName).some((item) => item.key === key) ? key : "";
}

function landingPageLabel(key) {
  return resources.find((item) => item.key === key)?.label || "System default";
}

function userInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

const emptyUserForm = {
  name: "",
  username: "",
  password: "",
  role: "CSR",
  quoteCompany: "tri_state_media",
  defaultLandingPage: "",
  pinnedMenuPages: [],
  active: true,
};

const emptyRoleForm = {
  name: "",
  description: "",
  allowedResourceKeys: ["quote-calculator"],
};

function UserAdminPanel({ currentUser, users, roleDefinitions, onSaveUsers, onSaveRoles, onClose }) {
  const [form, setForm] = useState(emptyUserForm);
  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [adminTab, setAdminTab] = useState("users");
  const [editingId, setEditingId] = useState(null);
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [showPasswordEntry, setShowPasswordEntry] = useState(false);
  const [error, setError] = useState("");
  const [roleError, setRoleError] = useState("");
  const activeUserCount = users.filter((user) => user.active !== false).length;
  const roleCount = roleDefinitions.length;
  const currentRole = roleDefinitions.find((role) => role.name === currentUser?.role);
  const selectedUserRole = roleDefinitions.find((role) => role.name === form.role);
  const selectedUserLandingPageOptions = useMemo(
    () => landingPageOptionsForRole(roleDefinitions, form.role),
    [form.role, roleDefinitions]
  );
  const selectedDefaultLandingPage = validDefaultLandingPage(roleDefinitions, form.role, form.defaultLandingPage);
  const roleAccessGroups = useMemo(() => {
    function groupResources(items, fallbackLabel = "Other") {
      const groups = new Map();
      items.forEach((item) => {
        const key = item.group || "other";
        const label = groupLabelsByKey[key] || fallbackLabel;
        if (!groups.has(key)) groups.set(key, { key, label, screens: [] });
        groups.get(key).screens.push(item);
      });
      return Array.from(groups.values());
    }
    return {
      screens: groupResources(resources.filter((item) => !item.permissionOnly && !item.hideFromNav)),
      abilities: groupResources(resources.filter((item) => item.permissionOnly), "Abilities"),
    };
  }, []);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function generateTemporaryPassword() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const numbers = "23456789";
    const symbols = "!@$%&?";
    const alphabet = `${letters}${numbers}${symbols}`;
    const bytes = new Uint32Array(24);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else bytes.forEach((_value, index) => { bytes[index] = Math.floor(Math.random() * 1_000_000); });
    const passwordParts = [
      letters[bytes[0] % letters.length],
      numbers[bytes[1] % numbers.length],
      symbols[bytes[2] % symbols.length],
      ...Array.from(bytes.slice(3, 12)).map((value) => alphabet[value % alphabet.length]),
    ];
    for (let index = passwordParts.length - 1; index > 0; index -= 1) {
      const swapIndex = bytes[12 + index] % (index + 1);
      [passwordParts[index], passwordParts[swapIndex]] = [passwordParts[swapIndex], passwordParts[index]];
    }
    const password = passwordParts.join("");
    setForm((prev) => ({ ...prev, password }));
    setShowPasswordEntry(true);
  }

  function startEdit(user) {
    setAdminTab("users");
    setEditingId(user.id);
    setShowPasswordEntry(false);
    setForm({
      name: user.name,
      username: user.username,
      password: "",
      role: user.role || "CSR",
      quoteCompany: quoteCompanyKey(user.quoteCompany),
      defaultLandingPage: String(user.defaultLandingPage || "").trim(),
      pinnedMenuPages: Array.isArray(user.pinnedMenuPages) ? user.pinnedMenuPages : [],
      active: user.active !== false,
    });
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyUserForm);
    setShowPasswordEntry(false);
    setError("");
  }

  function updateRoleForm(name, value) {
    setRoleForm((prev) => ({ ...prev, [name]: value }));
  }

  function startEditRole(role) {
    if (role.locked) return;
    setAdminTab("roles");
    setEditingRoleId(role.id);
    setRoleForm({
      name: role.name,
      description: role.description || "",
      allowedResourceKeys: role.allowedResourceKeys.includes("*") ? resources.map((item) => item.key) : [...role.allowedResourceKeys],
    });
    setRoleError("");
  }

  function cancelRoleEdit() {
    setEditingRoleId(null);
    setRoleForm(emptyRoleForm);
    setRoleError("");
  }

  function toggleRoleScreen(key) {
    setRoleForm((prev) => {
      const current = new Set(prev.allowedResourceKeys ?? []);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, allowedResourceKeys: Array.from(current) };
    });
  }

  function roleAccessSummary(role) {
    if (role.allowedResourceKeys.includes("*")) return "All screens + abilities";
    const visibleCount = resources.filter((item) => !item.permissionOnly && !item.hideFromNav && role.allowedResourceKeys.includes(item.key)).length;
    const abilityCount = resources.filter((item) => item.permissionOnly && role.allowedResourceKeys.includes(item.key)).length;
    return `${visibleCount} tab${visibleCount === 1 ? "" : "s"}${abilityCount ? ` / ${abilityCount} permission${abilityCount === 1 ? "" : "s"}` : ""}`;
  }

  async function submitRole(event) {
    event.preventDefault();
    const name = roleForm.name.trim();
    const nameTaken = roleDefinitions.some((role) => role.id !== editingRoleId && role.name.toLowerCase() === name.toLowerCase());
    const allowedResourceKeys = (roleForm.allowedResourceKeys ?? []).filter((key) => resources.some((item) => item.key === key));

    if (!name) {
      setRoleError("Role name is required.");
      return;
    }
    if (name.toLowerCase() === "admin") {
      setRoleError("The Admin role is protected.");
      return;
    }
    if (nameTaken) {
      setRoleError("That role name already exists.");
      return;
    }
    if (!allowedResourceKeys.length) {
      setRoleError("Select at least one screen for this role.");
      return;
    }

    const existing = roleDefinitions.find((role) => role.id === editingRoleId);
    const nextRole = {
      id: editingRoleId || makeRoleId(),
      name,
      description: roleForm.description.trim(),
      allowedResourceKeys,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    const nextRoles = editingRoleId
      ? roleDefinitions.map((role) => role.id === editingRoleId ? nextRole : role)
      : [nextRole, ...roleDefinitions];
    await onSaveRoles(nextRoles);
    if (editingRoleId && existing?.name && existing.name !== name) {
      await onSaveUsers(users.map((user) => user.role === existing.name ? { ...user, role: name } : user));
    }
    cancelRoleEdit();
  }

  async function deleteRole(role) {
    if (role.locked) return;
    if (users.some((user) => user.role === role.name)) {
      setRoleError(`Move users out of ${role.name} before deleting it.`);
      return;
    }
    await onSaveRoles(roleDefinitions.filter((item) => item.id !== role.id));
    if (editingRoleId === role.id) cancelRoleEdit();
  }

  async function submit(event) {
    event.preventDefault();
    const name = form.name.trim();
    const username = form.username.trim();
    const usernameTaken = users.some((user) => user.id !== editingId && user.username.toLowerCase() === username.toLowerCase());

    if (!name || !username) {
      setError("Name and username are required.");
      return;
    }
    if (usernameTaken) {
      setError("That username is already in use.");
      return;
    }
    if (!editingId && !form.password) {
      setError("Add a starting password for the new user.");
      return;
    }

    const nextUser = {
      id: editingId || makeUserId(),
      name,
      username,
      password: form.password || users.find((user) => user.id === editingId)?.password || "",
      role: form.role,
      quoteCompany: quoteCompanyKey(form.quoteCompany),
      defaultLandingPage: selectedDefaultLandingPage,
      pinnedMenuPages: Array.isArray(form.pinnedMenuPages) ? form.pinnedMenuPages : [],
      active: form.active,
      createdAt: users.find((user) => user.id === editingId)?.createdAt || new Date().toISOString(),
    };

    const nextUsers = editingId
      ? users.map((user) => user.id === editingId ? nextUser : user)
      : [nextUser, ...users];
    await onSaveUsers(nextUsers);
    cancelEdit();
  }

  async function toggleActive(user) {
    if (user.username === "admin") return;
    await onSaveUsers(users.map((item) => item.id === user.id ? { ...item, active: item.active === false } : item));
  }

  return (
    <section className="admin-overlay" role="dialog" aria-modal="true" aria-label="User administration">
      <div className="admin-window compact-card">
        <header className="admin-window-head">
          <div className="admin-title-block">
            <div className="admin-title-icon">
              <UserCog size={22} />
            </div>
            <div>
              <p className="eyebrow">Administration</p>
              <h2>People + Access</h2>
              <p>Manage company logins, active employees, and the screens each role can open.</p>
            </div>
          </div>
          <div className="admin-head-actions">
            <span className="admin-current-user">
              <BadgeCheck size={15} />
              {currentUser.name} / {currentUser.role}
            </span>
            <button className="ghost-btn admin-close-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <section className="admin-stat-row">
          <div className="admin-stat-card">
            <Users size={18} />
            <span>Active Users</span>
            <strong>{activeUserCount}</strong>
          </div>
          <div className="admin-stat-card">
            <Shield size={18} />
            <span>Roles</span>
            <strong>{roleCount}</strong>
          </div>
          <div className="admin-stat-card">
            <KeyRound size={18} />
            <span>Your Access</span>
            <strong>{currentRole ? roleAccessSummary(currentRole) : "No Access"}</strong>
          </div>
        </section>

        <nav className="admin-tabs" aria-label="User administration sections">
          <button className={adminTab === "users" ? "active" : ""} type="button" onClick={() => setAdminTab("users")}>
            <Users size={16} />
            Users
          </button>
          <button className={adminTab === "roles" ? "active" : ""} type="button" onClick={() => setAdminTab("roles")}>
            <ShieldCheck size={16} />
            Roles + Screens
          </button>
        </nav>

        {adminTab === "users" && (
        <div className="user-admin-grid">
          <form className="user-admin-form" onSubmit={submit}>
            <div className="panel-head thin">
              <div>
                <p className="eyebrow">{editingId ? "Edit User" : "New User"}</p>
                <h2>{editingId ? "Update Login" : "Add Employee"}</h2>
              </div>
            </div>
            <label className="field">
              <span>Name</span>
              <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Employee name" />
            </label>
            <label className="field">
              <span>Username</span>
              <input value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="login id" disabled={editingId && form.username === "admin"} />
            </label>
            <div className="password-reset-note">
              <KeyRound size={17} />
              <div>
                <strong>{editingId ? "Reset Password" : "Starting Password"}</strong>
                <span>Saved passwords cannot be viewed. Set a new temporary password when someone needs help signing in.</span>
              </div>
            </div>
            <label className="field">
              <span>{editingId ? "New / Temporary Password" : "Password"}</span>
              <input
                type={showPasswordEntry ? "text" : "password"}
                value={form.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder={editingId ? "Leave blank to keep current" : "Starting password"}
                autoComplete="new-password"
              />
            </label>
            <div className="password-admin-tools">
              <button className="ghost-btn xs" type="button" onClick={generateTemporaryPassword}>Generate Temporary</button>
              <button className="ghost-btn xs" type="button" onClick={() => setShowPasswordEntry((show) => !show)} disabled={!form.password}>
                {showPasswordEntry ? "Hide Typed Password" : "Show Typed Password"}
              </button>
            </div>
            <label className="field">
              <span>Role</span>
              <select value={form.role} onChange={(event) => update("role", event.target.value)} disabled={editingId && form.username === "admin"}>
                {roleDefinitions.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}
              </select>
            </label>
            {selectedUserRole && <p className="role-summary-note">Access: {roleAccessSummary(selectedUserRole)}</p>}
            <label className="field">
              <span>Default Landing Page</span>
              <select value={selectedDefaultLandingPage} onChange={(event) => update("defaultLandingPage", event.target.value)}>
                <option value="">System default</option>
                {selectedUserLandingPageOptions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Quote Company</span>
              <select value={quoteCompanyKey(form.quoteCompany)} onChange={(event) => update("quoteCompany", event.target.value)}>
                {quoteCompanyOptions.map((company) => <option value={company.value} key={company.value}>{company.label}</option>)}
              </select>
            </label>
            <label className="check-field">
              <input type="checkbox" checked={form.active} onChange={(event) => update("active", event.target.checked)} disabled={editingId && form.username === "admin"} />
              <span>Active user</span>
            </label>
            {error && <div className="auth-error">{error}</div>}
            <div className="form-actions">
              {editingId && <button className="ghost-btn" type="button" onClick={cancelEdit}>Cancel</button>}
              <button className="primary-btn" type="submit"><UserPlus size={16} /> {editingId ? "Save User" : "Add User"}</button>
            </div>
          </form>

          <section className="user-admin-list">
            <div className="panel-head thin">
              <div>
                <p className="eyebrow">Directory</p>
                <h2>{users.filter((user) => user.active !== false).length} Active Users</h2>
              </div>
            </div>
            <div className="user-list-rows">
              {users.map((user) => (
                <article className={`user-list-row ${user.active === false ? "inactive" : ""}`} key={user.id}>
                  <div className="user-list-person">
                    <span className="user-avatar">{userInitials(user.name)}</span>
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.username} / {user.role} / {quoteCompanyLabel(user.quoteCompany)} / {landingPageLabel(user.defaultLandingPage)}</span>
                    </div>
                  </div>
                  <span className={`user-status-pill ${user.active === false ? "inactive" : "active"}`}>{user.active === false ? "Inactive" : "Active"}</span>
                  <div className="admin-row-actions">
                    <button className="ghost-btn xs" type="button" onClick={() => startEdit(user)}>Edit</button>
                    <button className="ghost-btn xs" type="button" onClick={() => toggleActive(user)} disabled={user.username === "admin" || user.id === currentUser?.id}>
                      {user.active === false ? "Activate" : "Deactivate"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        )}

        {adminTab === "roles" && (
          <section className="role-admin-panel">
            <div className="panel-head thin">
              <div>
                <p className="eyebrow">Access</p>
                <h2>Roles + Permissions</h2>
              </div>
            </div>
            <form className="role-admin-form" onSubmit={submitRole}>
              <label className="field">
                <span>Role Name</span>
                <input value={roleForm.name} onChange={(event) => updateRoleForm("name", event.target.value)} placeholder="Example: Shipping" />
              </label>
              <label className="field">
                <span>Description</span>
                <input value={roleForm.description} onChange={(event) => updateRoleForm("description", event.target.value)} placeholder="What this role is allowed to do" />
              </label>
              <div className="role-access-layout">
                <section>
                  <div className="role-access-title">
                    <strong>Tabs People Can Open</strong>
                    <span>Choose the actual menu tabs this role can see.</span>
                  </div>
                  <div className="role-screen-picker">
                    {roleAccessGroups.screens.map((group) => (
                      <section className="role-screen-group" key={group.key}>
                        <header>
                          <strong>{group.label}</strong>
                          <span>{group.screens.filter((item) => roleForm.allowedResourceKeys.includes(item.key)).length} / {group.screens.length}</span>
                        </header>
                        <div>
                          {group.screens.map((item) => (
                            <label className="role-screen-check" key={item.key}>
                              <input type="checkbox" checked={roleForm.allowedResourceKeys.includes(item.key)} onChange={() => toggleRoleScreen(item.key)} />
                              <span>{item.label}</span>
                            </label>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
                <section>
                  <div className="role-access-title">
                    <strong>Extra Abilities</strong>
                    <span>These do not add menu tabs; they unlock actions inside existing screens.</span>
                  </div>
                  <div className="role-screen-picker role-ability-picker">
                    {roleAccessGroups.abilities.map((group) => (
                      <section className="role-screen-group" key={group.key}>
                        <header>
                          <strong>{group.label}</strong>
                          <span>{group.screens.filter((item) => roleForm.allowedResourceKeys.includes(item.key)).length} / {group.screens.length}</span>
                        </header>
                        <div>
                          {group.screens.map((item) => (
                            <label className="role-screen-check" key={item.key}>
                              <input type="checkbox" checked={roleForm.allowedResourceKeys.includes(item.key)} onChange={() => toggleRoleScreen(item.key)} />
                              <span>{item.label}</span>
                            </label>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </section>
              </div>
              {roleError && <div className="auth-error">{roleError}</div>}
              <div className="form-actions">
                {editingRoleId && <button className="ghost-btn" type="button" onClick={cancelRoleEdit}>Cancel</button>}
                <button className="primary-btn" type="submit"><ShieldCheck size={16} /> {editingRoleId ? "Save Role" : "Add Role"}</button>
              </div>
            </form>
            <div className="role-list-rows">
              {roleDefinitions.map((role) => {
                const accessCount = roleAccessSummary(role);
                return (
                  <article className="role-list-row" key={role.id}>
                    <div className="role-list-main">
                      <span className="role-avatar"><ShieldCheck size={15} /></span>
                      <div>
                      <strong>{role.name}</strong>
                      <span>{role.description || accessCount}</span>
                      </div>
                    </div>
                    <span className="role-access-pill">{accessCount}</span>
                    <div className="admin-row-actions">
                      <button className="ghost-btn xs" type="button" onClick={() => startEditRole(role)} disabled={role.locked}>Edit</button>
                      <button className="ghost-btn xs" type="button" onClick={() => deleteRole(role)} disabled={role.locked}>Delete</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

export default UserAdminPanel;
