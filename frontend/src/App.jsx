import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, ChevronRight, KeyRound, LogIn, LogOut, Plus, RefreshCcw, Search, Shield, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react";
import { createRecord, deleteRecord, deleteRecordAction, fetchCollection, postRecordAction, updateRecord, uploadRecordAction } from "./api";
import { resourceGroups, resourceMap, resources } from "./resourceConfig";
import RecordForm from "./components/RecordForm";
import ResourceTable from "./components/ResourceTable";
import FlexDieSearch from "./components/FlexDieSearch";
import FlexDieDetailPanel from "./components/FlexDieDetailPanel";
import FinishedMaterialWindow from "./components/FinishedMaterialWindow";
import DataImportTool from "./components/DataImportTool";
import GroupedLocationView from "./components/GroupedLocationView";
import GroupedUsageView from "./components/GroupedUsageView";
import JobTicketGallery from "./components/JobTicketGallery";
import JobTicketPanel from "./components/JobTicketPanel";
import LabelLayoutsView from "./components/LabelLayoutsView";
import MaterialInventoryView from "./components/MaterialInventoryView";
import MaterialTypeWindow from "./components/MaterialTypeWindow";
import MaterialUsageWindow from "./components/MaterialUsageWindow";
import PackagingInventoryView from "./components/PackagingInventoryView";
import QuotePricingTool from "./components/QuotePricingTool";
import RecipeOptionsView from "./components/RecipeOptionsView";
import RecipeToolStackView from "./components/RecipeToolStackView";
import RollWorkflowWindow from "./components/RollWorkflowWindow";
import ProductionScheduleView from "./components/ProductionScheduleView";
import {
  clearSession,
  deleteRoleFromApi,
  loadRoles,
  loadRolesFromApi,
  loadSessionUser,
  loadUsers,
  loadUsersFromApi,
  makeRoleId,
  makeUserId,
  roleHasResourceAccess,
  saveRoleToApi,
  saveRoles,
  saveUserToApi,
  saveUsers,
  signIn,
  userIsAdmin,
} from "./lib/localAuth";
import { emptyFlexDieFilters, filterFlexDies, filterRows } from "./lib/filtering";
import { formatCell, getRecordTitle } from "./lib/format";

function labelForField(resource, key) {
  const friendlyLabels = {
    recipe: "Label Layout",
    recipe_name: "Label Layout",
    recipe_option: "Press Setup Option",
    recipe_option_name: "Press Setup Option",
  };
  if (friendlyLabels[key]) return friendlyLabels[key];
  const field = (resource.fields ?? []).find((item) => item.name === key);
  return field?.label ?? key.replace(/_/g, " ");
}

function getDetailKeys(resource, record) {
  const fieldNames = (resource.fields ?? []).map((field) => field.name);
  const seen = new Set();

  return [...(resource.columns ?? []), ...fieldNames, ...Object.keys(record ?? {})].filter((key) => {
    if (seen.has(key) || key === "id" || key.endsWith("_details")) return false;
    const value = record?.[key];
    if (value === undefined) return false;
    if (Array.isArray(value) && !value.length) return false;
    if (value && typeof value === "object" && !Array.isArray(value)) return false;
    if ((key.endsWith("_name") || key.endsWith("_label")) && fieldNames.includes(key.replace(/_(name|label)$/, ""))) return false;
    seen.add(key);
    return true;
  });
}

function detailValue(record, key) {
  const relationText = record?.[`${key}_name`] ?? record?.[`${key}_label`] ?? record?.[`${key}_number`] ?? record?.[`${key}_serial`];
  if (relationText && (record?.[key] === null || record?.[key] === undefined || typeof record?.[key] === "number")) return String(relationText);

  const value = record?.[key];
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => typeof item === "object" ? getRecordTitle(item) : item).join(", ") : "--";
  }
  return formatCell(record, key);
}

function mergeRows(existing = [], next = []) {
  const byId = new Map(existing.map((row) => [String(row.id), row]));
  next.forEach((row) => byId.set(String(row.id), { ...(byId.get(String(row.id)) ?? {}), ...row }));
  return Array.from(byId.values());
}

function relationLookupSpec(relation, filters = {}, pageSize = 250, fetchAll = false) {
  const relationResource = resourceMap[relation];
  if (!relationResource) return null;
  return {
    key: relation,
    endpoint: relationResource.endpoint,
    ordering: relationResource.defaultOrdering,
    filters: { ...(relationResource.filters ?? {}), ...(filters ?? {}) },
    pageSize,
    fetchAll,
  };
}

function addLookupSpec(specs, spec) {
  if (!spec) return;
  specs.push(spec);
}

function addFieldLookups(specs, fields = []) {
  fields.forEach((field) => {
    if (field.lookupRelation) {
      addLookupSpec(specs, relationLookupSpec(field.lookupRelation, field.lookupFilters, field.maxResults ?? 250));
    }
    if (!field.relation || !["relation", "searchRelation", "multiRelation"].includes(field.type)) return;
    addLookupSpec(specs, relationLookupSpec(field.relation, field.lookupFilters, field.maxResults ?? 250));
  });
}

async function loadScopedLookups({ resource, selected, isMaterialTypePage }) {
  const specs = [];
  addFieldLookups(specs, resource.fields ?? []);

  if (resource.key === "raw-materials" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { inventory: selected.id }, 100));
  }

  if (resource.key === "material-coated-stock") {
    addLookupSpec(specs, relationLookupSpec("raw-materials", selected?.id ? { material: selected.id } : { material_type: "coated_stock" }, 250));
    if (selected?.id) addLookupSpec(specs, relationLookupSpec("material-usages", { material: selected.id }, 150));
    addLookupSpec(specs, relationLookupSpec("presses", {}, 100));
  }

  if (isMaterialTypePage && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-supplier-options", { material: selected.id }, 150));
  }

  if (resource.endpoint === "materials" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { material: selected.id }, 150));
  }

  if (resource.key === "finished-inventory" && selected?.material_inventory) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { inventory: selected.material_inventory }, 150));
  }

  if (resource.key === "job-tickets") {
    addLookupSpec(specs, relationLookupSpec("finished-inventory", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("job-ticket-usages", {}, 1000, true));
  }

  if (resource.key === "job-tickets" && selected) {
    if (selected.material_spec) addLookupSpec(specs, relationLookupSpec("raw-materials", { material: selected.material_spec }, 250));
    if (selected.material_master_type || selected.material_spec_master_type) {
      addLookupSpec(specs, relationLookupSpec("raw-materials", { master_type: selected.material_master_type || selected.material_spec_master_type }, 250));
    }
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 150));
    addLookupSpec(specs, relationLookupSpec("box-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("production-schedule", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-orders", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-order-events", {}, 250));
    addLookupSpec(specs, relationLookupSpec("job-ticket-events", { job_ticket: selected.id }, 250));
    addLookupSpec(specs, relationLookupSpec("presses", {}, 150));
  }

  if (resource.key === "production-schedule") {
    addLookupSpec(specs, relationLookupSpec("job-tickets", {}, 1000));
    addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock" }, 1000));
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 1000));
    addLookupSpec(specs, relationLookupSpec("box-inventory", {}, 250));
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 250));
  }

  if (resource.key === "packaging-inventory") {
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 500));
  }

  if (resource.key === "flex-dies" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("history", { flex_die: selected.id }, 250));
  }

  const entries = await Promise.all(
    specs.map((spec) =>
      fetchCollection(spec.endpoint, {
        ordering: spec.ordering,
        pageSize: spec.pageSize,
        filters: spec.filters,
        fetchAll: spec.fetchAll,
      })
        .then((payload) => [spec.key, payload.results])
        .catch(() => [spec.key, []])
    )
  );

  return entries.reduce((acc, [key, results]) => {
    acc[key] = mergeRows(acc[key], results);
    return acc;
  }, {});
}

function currentInventoryQuantity(roll) {
  return Number(roll?.length_feet ?? roll?.quantity ?? 0) || 0;
}

function rollUsagePayload(roll, overrides = {}) {
  return {
    inventory: roll.id,
    material: roll.material,
    unit: roll.unit || "lf",
    used_date: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

function activeInventoryFeet(rows) {
  return (rows ?? []).reduce((sum, row) => {
    if (row.is_active === false || ["depleted", "scrapped", "in_use"].includes(row.status)) return sum;
    const qty = Number(row.length_feet ?? row.quantity ?? 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function inventoryTotalFeetForMaterial(row, inventoryRows) {
  if (row.inventory_total_feet !== null && row.inventory_total_feet !== undefined && row.inventory_total_feet !== "") {
    return row.inventory_total_feet;
  }
  return activeInventoryFeet(inventoryRows.filter((inventory) => String(inventory.material) === String(row.id)));
}

function generatedJobTicketNumber(payload = {}) {
  const tsmId = String(payload.product_code || "").trim();
  if (tsmId) return tsmId;
  const existing = String(payload.ticket_number || "").trim();
  if (existing) return existing;
  return `JT-${Date.now().toString(36).toUpperCase()}`;
}

function autoImageName(slot, ticket = {}) {
  const label = {
    general: "General",
    spec: "Spec",
    finishing: "Finishing",
  }[slot] || "Image";
  const job = String(ticket.job_name || ticket.product_code || ticket.ticket_number || "Job").trim().replace(/\s+/g, "-");
  return `${label}-${job}`;
}

function scheduleDefaultsForTicket(ticket, currentUser) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    job_ticket: ticket?.id || "",
    customer: ticket?.customer || "",
    customer_po: "",
    priority: "normal",
    order_date: today,
    due_date: "",
    quantity_to_ship: 0,
    quantity_to_stock: 0,
    notes: ticket?.job_notes || ticket?.finishing_notes || "",
    scheduled_by: currentUser?.name || "",
    last_updated_by: currentUser?.name || "",
    status: "unscheduled",
  };
}

const jobTicketChangeFields = [
  ["customer", "Customer"],
  ["job_name", "Job Number"],
  ["product_code", "TSM ID"],
  ["description", "Description"],
  ["material_master_type", "Material Type"],
  ["material_spec", "Finished Material"],
  ["label_width_inches", "Label Width"],
  ["label_length_inches", "Label Length"],
  ["repeat_inches", "Repeat"],
  ["cutting_type", "Cutting"],
  ["finishing_type", "Finishing"],
  ["unit_type", "Unit Type"],
  ["labels_per_unit", "Labels per Unit"],
  ["units_per_carton", "Units per Carton"],
  ["core_size_inches", "Core Size"],
  ["wind_direction", "Wind"],
  ["fanfold_gear", "Fanfold Gear"],
  ["labels_per_fold", "Labels per Fold"],
  ["ribbon", "Ribbon"],
  ["laminate", "Laminate"],
  ["bagged", "Bagged"],
  ["box_item_number", "Legacy Box Item #"],
  ["box", "Box Link"],
  ["core", "Core Link"],
  ["recipe", "Recipe"],
  ["carton_label_part_number", "Carton Label Part Number"],
  ["carton_label_description_a", "Carton Label Description A"],
  ["carton_label_description_b", "Carton Label Description B"],
  ["carton_label_description_c", "Carton Label Description C"],
  ["carton_label_finishing_1", "Carton Label Finishing 1"],
  ["carton_label_finishing_2", "Carton Label Finishing 2"],
];

function summarizeJobTicketChanges(previous, next) {
  if (!previous || !next) return [];
  return jobTicketChangeFields
    .filter(([key]) => String(previous[key] ?? "") !== String(next[key] ?? ""))
    .map(([key, label]) => `${label}: ${previous[key] || "--"} to ${next[key] || "--"}`);
}

const initialOpenGroups = Object.fromEntries(
  resourceGroups.map((group) => [group.key, false])
);

const topLevelGroups = resourceGroups.filter((group) => !group.parent);
const groupLabelsByKey = Object.fromEntries(resourceGroups.map((group) => [group.key, group.label]));
const materialTypePageKeys = new Set([
  "material-faces",
  "material-liners",
  "material-adhesives",
  "material-silicone",
  "material-coatings",
]);

const materialFormPageKeys = new Set([
  "materials",
  "material-coated-stock",
  "material-faces",
  "material-liners",
  "material-adhesives",
  "material-silicone",
  "material-coatings",
  "material-supplier-options",
  "raw-materials",
]);

const toolingConfigFormPageKeys = new Set([
  "recipes",
  "recipe-options",
  "recipe-tools",
]);

const AUTO_REFRESH_INTERVALS = {
  "production-schedule": 15_000,
  "job-tickets": 30_000,
  "flex-dies": 45_000,
  "recipe-options": 45_000,
  "recipe-tools": 45_000,
};

function refreshIntervalForResource(key) {
  return AUTO_REFRESH_INTERVALS[key] ?? 60_000;
}

function visibleResourcesForRole(roleDefinitions, roleName) {
  return resources.filter((item) => !item.permissionOnly && roleHasResourceAccess(roleDefinitions, roleName, item.key));
}

function defaultResourceKeyForRole(roleDefinitions, roleName) {
  const visible = visibleResourcesForRole(roleDefinitions, roleName);
  const normalizedRole = String(roleName || "").toLowerCase();
  if (normalizedRole === "sales" && visible.some((item) => item.key === "quote-calculator")) return "quote-calculator";
  if (visible.some((item) => item.key === "job-tickets")) return "job-tickets";
  return visible[0]?.key ?? "quote-calculator";
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
  active: true,
};

const emptyRoleForm = {
  name: "",
  description: "",
  allowedResourceKeys: ["quote-calculator"],
};

function SignInScreen({ onSignIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    const result = await onSignIn(username, password);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  return (
    <main className="auth-screen">
      <section className="auth-card compact-card">
        <div>
          <p className="eyebrow">Tri-State Media</p>
          <h1>Sign In</h1>
          <p>Use your company login to open the tooling and quoting system.</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-btn" type="submit" disabled={submitting}><LogIn size={16} /> {submitting ? "Signing In..." : "Sign In"}</button>
        </form>
      </section>
    </main>
  );
}

function UserAdminPanel({ currentUser, users, roleDefinitions, onSaveUsers, onSaveRoles, onClose }) {
  const [form, setForm] = useState(emptyUserForm);
  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [adminTab, setAdminTab] = useState("users");
  const [editingId, setEditingId] = useState(null);
  const [editingRoleId, setEditingRoleId] = useState(null);
  const [error, setError] = useState("");
  const [roleError, setRoleError] = useState("");
  const activeUserCount = users.filter((user) => user.active !== false).length;
  const roleCount = roleDefinitions.length;
  const currentRole = roleDefinitions.find((role) => role.name === currentUser?.role);
  const roleScreenGroups = useMemo(() => {
    const groups = new Map();
    resources.forEach((item) => {
      const key = item.group || "other";
      const label = groupLabelsByKey[key] || "Other";
      if (!groups.has(key)) groups.set(key, { key, label, screens: [] });
      groups.get(key).screens.push(item);
    });
    return Array.from(groups.values());
  }, []);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function startEdit(user) {
    setAdminTab("users");
    setEditingId(user.id);
    setForm({
      name: user.name,
      username: user.username,
      password: "",
      role: user.role || "CSR",
      active: user.active !== false,
    });
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyUserForm);
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
            <strong>{currentRole?.allowedResourceKeys.includes("*") ? "All Screens" : `${currentRole?.allowedResourceKeys.length ?? 0} Screens`}</strong>
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
            <label className="field">
              <span>{editingId ? "New Password" : "Password"}</span>
              <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={editingId ? "Leave blank to keep current" : "Starting password"} />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={form.role} onChange={(event) => update("role", event.target.value)} disabled={editingId && form.username === "admin"}>
                {roleDefinitions.map((role) => <option value={role.name} key={role.id}>{role.name}</option>)}
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
                      <span>{user.username} / {user.role}</span>
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
                <h2>Roles + Screens</h2>
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
              <div className="role-screen-picker">
                {roleScreenGroups.map((group) => (
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
              {roleError && <div className="auth-error">{roleError}</div>}
              <div className="form-actions">
                {editingRoleId && <button className="ghost-btn" type="button" onClick={cancelRoleEdit}>Cancel</button>}
                <button className="primary-btn" type="submit"><ShieldCheck size={16} /> {editingRoleId ? "Save Role" : "Add Role"}</button>
              </div>
            </form>
            <div className="role-list-rows">
              {roleDefinitions.map((role) => {
                const accessCount = role.allowedResourceKeys.includes("*") ? "All screens" : `${role.allowedResourceKeys.length} screens`;
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

function AccountMenu({ currentUser, canManageUsers, onOpenUserAdmin, onSignOut }) {
  const [open, setOpen] = useState(false);

  function openUsers() {
    setOpen(false);
    onOpenUserAdmin();
  }

  return (
    <div className="account-menu" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button className="account-menu-trigger" type="button" onClick={() => setOpen((prev) => !prev)}>
        <ShieldCheck size={16} />
        <span>{currentUser.name}</span>
        <em>{currentUser.role}</em>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="account-menu-panel">
          <div>
            <strong>{currentUser.name}</strong>
            <span>{currentUser.username} / {currentUser.role}</span>
          </div>
          {canManageUsers && <button type="button" onClick={openUsers}><Users size={15} /> Manage Users</button>}
          <button type="button" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={15} /> Sign Out</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useState(() => loadUsers());
  const [roleDefinitions, setRoleDefinitions] = useState(() => loadRoles());
  const [currentUser, setCurrentUser] = useState(() => loadSessionUser());
  const [userPanelOpen, setUserPanelOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadUsersFromApi(), loadRolesFromApi()])
      .then(([apiUsers, apiRoles]) => {
        if (!alive) return;
        const localRoles = loadRoles();
        const localUsers = loadUsers();
        const apiRoleNames = new Set(apiRoles.map((role) => role.name.toLowerCase()));
        const apiUsernames = new Set(apiUsers.map((user) => user.username.toLowerCase()));
        const missingLocalRoles = localRoles.filter((role) => !apiRoleNames.has(role.name.toLowerCase()) && !role.locked);
        const missingLocalUsers = localUsers.filter((user) => !apiUsernames.has(user.username.toLowerCase()) && user.username.toLowerCase() !== "admin");

        if (missingLocalRoles.length || missingLocalUsers.length) {
          return Promise.all(missingLocalRoles.map(saveRoleToApi))
            .then(() => Promise.all(missingLocalUsers.map(saveUserToApi)))
            .then(refreshCompanyAccess)
            .then(({ apiUsers: refreshedUsers, apiRoles: refreshedRoles }) => {
              if (!alive) return;
              const refreshedUser = refreshedUsers.find((user) =>
                (String(user.id) === String(currentUser?.id) || user.username === currentUser?.username) &&
                user.active !== false
              );
              if (refreshedUser) setCurrentUser(refreshedUser);
              setUsers(refreshedUsers);
              setRoleDefinitions(refreshedRoles);
            });
        }

        setUsers(apiUsers);
        setRoleDefinitions(apiRoles);
        saveUsers(apiUsers);
        saveRoles(apiRoles);
        const refreshedUser = apiUsers.find((user) =>
          (String(user.id) === String(currentUser?.id) || user.username === currentUser?.username) &&
          user.active !== false
        );
        if (refreshedUser) setCurrentUser(refreshedUser);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function handleSignIn(username, password) {
    const result = await signIn(username, password);
    if (result.error) return result;
    setUsers(result.users);
    if (result.roles) setRoleDefinitions(result.roles);
    setCurrentUser(result.user);
    return result;
  }

  function handleSignOut() {
    clearSession();
    setCurrentUser(null);
    setUserPanelOpen(false);
  }

  async function refreshCompanyAccess() {
    const [apiUsers, apiRoles] = await Promise.all([loadUsersFromApi(), loadRolesFromApi()]);
    saveUsers(apiUsers);
    saveRoles(apiRoles);
    setUsers(apiUsers);
    setRoleDefinitions(apiRoles);
    return { apiUsers, apiRoles };
  }

  async function handleSaveUsers(nextUsers) {
    const currentById = new Map(users.map((user) => [String(user.id), user]));
    const changedUsers = nextUsers.filter((user) => {
      const previous = currentById.get(String(user.id));
      return !previous || JSON.stringify({ ...previous, password: "" }) !== JSON.stringify({ ...user, password: "" }) || user.password;
    });
    for (const user of changedUsers) {
      await saveUserToApi(user);
    }
    const { apiUsers: loaded } = await refreshCompanyAccess();
    setUsers(loaded);
    const refreshedUser = loaded.find((user) =>
      (String(user.id) === String(currentUser?.id) || user.username === currentUser?.username) &&
      user.active !== false
    );
    if (refreshedUser) {
      const { password, ...publicCurrentUser } = refreshedUser;
      setCurrentUser(publicCurrentUser);
    } else {
      handleSignOut();
    }
  }

  async function handleSaveRoles(nextRoles) {
    const nextIds = new Set(nextRoles.map((role) => String(role.id)));
    const removedRoles = roleDefinitions.filter((role) => !nextIds.has(String(role.id)));
    for (const role of removedRoles) {
      await deleteRoleFromApi(role);
    }

    const currentById = new Map(roleDefinitions.map((role) => [String(role.id), role]));
    const changedRoles = nextRoles.filter((role) => {
      const previous = currentById.get(String(role.id));
      return !previous || JSON.stringify(previous) !== JSON.stringify(role);
    });
    for (const role of changedRoles) {
      await saveRoleToApi(role);
    }
    await refreshCompanyAccess();
  }

  if (!currentUser) return <SignInScreen onSignIn={handleSignIn} />;

  return (
    <>
      <SignedInApp
        currentUser={currentUser}
        roleDefinitions={roleDefinitions}
        canManageUsers={userIsAdmin(currentUser)}
        onOpenUserAdmin={() => setUserPanelOpen(true)}
        onSignOut={handleSignOut}
      />
      {userPanelOpen && userIsAdmin(currentUser) && (
        <UserAdminPanel
          currentUser={currentUser}
          users={users}
          roleDefinitions={roleDefinitions}
          onSaveUsers={handleSaveUsers}
          onSaveRoles={handleSaveRoles}
          onClose={() => setUserPanelOpen(false)}
        />
      )}
    </>
  );
}

function SignedInApp({ currentUser, roleDefinitions, canManageUsers, onOpenUserAdmin, onSignOut }) {
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState(() => defaultResourceKeyForRole(roleDefinitions, currentUser?.role));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [formMode, setFormMode] = useState(null); // null | create | edit
  const [createDefaults, setCreateDefaults] = useState({});
  const [flexFilters, setFlexFilters] = useState(emptyFlexDieFilters);
  const [openGroups, setOpenGroups] = useState(initialOpenGroups);
  const [usageOpen, setUsageOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [finishedMaterialOpen, setFinishedMaterialOpen] = useState(false);
  const [materialTypeOpen, setMaterialTypeOpen] = useState(false);
  const [localInventoryRows, setLocalInventoryRows] = useState([]);
  const [localUsageEvents, setLocalUsageEvents] = useState([]);
  const [quoteJobTicketId, setQuoteJobTicketId] = useState("");

  const allowedResources = useMemo(
    () => visibleResourcesForRole(roleDefinitions, currentUser?.role),
    [roleDefinitions, currentUser?.role]
  );
  const activeKeyAllowed = allowedResources.some((item) => item.key === activeKey);
  const resource = activeKeyAllowed
    ? resourceMap[activeKey]
    : allowedResources[0] ?? resourceMap["quote-calculator"] ?? resources[0];
  const singleResourceMode = allowedResources.length === 1 && !canManageUsers;
  const showingStaticView = Boolean(resource.staticView);
  const showingJobTicketOverlay = resource.key === "job-tickets" && selected;
  const isMaterialTypePage = materialTypePageKeys.has(resource.key);
  const isMaterialFormPage = materialFormPageKeys.has(resource.key);
  const isToolingConfigPage = toolingConfigFormPageKeys.has(resource.key);
  const showingMaterialFormOverlay = Boolean(formMode && isMaterialFormPage);
  const showingScheduleFormOverlay = Boolean(formMode && resource.key === "production-schedule");
  const showingToolingConfigFormOverlay = Boolean(formMode && isToolingConfigPage);
  const showingToolingConfigDetailOverlay = Boolean(selected && !formMode && isToolingConfigPage);
  const collectionQueryKey = ["collection", resource.key, resource.filters ?? {}, resource.searchMode === "flexDie" ? "" : search];

  useEffect(() => {
    if (activeKeyAllowed) return;
    setActiveKey(defaultResourceKeyForRole(roleDefinitions, currentUser?.role));
  }, [activeKeyAllowed, currentUser?.role, roleDefinitions]);

  const listQuery = useQuery({
    queryKey: collectionQueryKey,
    queryFn: async () => {
      try {
        return await fetchCollection(resource.endpoint, {
          ordering: resource.defaultOrdering,
          pageSize: resource.key === "job-tickets" ? 1000 : resource.searchMode === "flexDie" ? 500 : 250,
          filters: resource.filters ?? {},
          search: resource.searchMode === "flexDie" ? "" : search,
          fetchAll: resource.key === "job-tickets",
        });
      } catch (error) {
        if (resource.key === "material-usages" && String(error.message).includes("404")) {
          return { count: 0, results: [], raw: { missingEndpoint: true } };
        }
        throw error;
      }
    },
    enabled: !showingStaticView,
    keepPreviousData: true,
    refetchInterval: showingStaticView ? false : refreshIntervalForResource(resource.key),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const lookupQuery = useQuery({
    queryKey: ["lookups", resource.key, selected?.id ?? null, formMode ?? "view"],
    queryFn: () => loadScopedLookups({ resource, selected, isMaterialTypePage }),
    enabled: !showingStaticView,
    staleTime: 30_000,
    refetchInterval: showingStaticView ? false : 120_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const rows = useMemo(() => {
    const base = listQuery.data?.results ?? [];
    if (resource.key !== "raw-materials") return base;
    return mergeRows(base, localInventoryRows);
  }, [listQuery.data, localInventoryRows, resource.key]);

  useEffect(() => {
    if (!selected?.id || formMode) return;
    const fresh = rows.find((row) => String(row.id) === String(selected.id));
    if (!fresh) return;
    if (JSON.stringify(fresh) !== JSON.stringify(selected)) setSelected(fresh);
  }, [rows, selected?.id, formMode]);

  const detailKeys = selected ? getDetailKeys(resource, selected) : [];
  const usageRows = useMemo(() => {
    const usages = [...(lookupQuery.data?.["material-usages"] ?? []), ...localUsageEvents];
    if (!selected) return [];

    if (resource.key === "raw-materials") {
      return usages.filter((row) => String(row.inventory) === String(selected.id));
    }

    if (resource.key === "finished-inventory") {
      return usages.filter((row) =>
        String(row.finished_inventory) === String(selected.id) ||
        (selected.material_inventory && String(row.inventory) === String(selected.material_inventory))
      );
    }

    if (resource.endpoint === "materials") {
      return usages.filter((row) => String(row.material) === String(selected.id));
    }

    return [];
  }, [localUsageEvents, lookupQuery.data, resource.endpoint, resource.key, selected]);
  const selectedMaterialInventoryRows = useMemo(() => {
    if (!selected || resource.key !== "material-coated-stock") return [];
    return (lookupQuery.data?.["raw-materials"] ?? []).filter((row) => String(row.material) === String(selected.id));
  }, [lookupQuery.data, resource.key, selected]);
  const selectedMaterialSupplierOptions = useMemo(() => {
    if (!selected || !isMaterialTypePage) return [];
    return (lookupQuery.data?.["material-supplier-options"] ?? []).filter((row) => String(row.material) === String(selected.id));
  }, [isMaterialTypePage, lookupQuery.data, selected]);
  const selectedFlexDieHistory = useMemo(() => {
    if (!selected || resource.key !== "flex-dies") return [];
    return (lookupQuery.data?.history ?? []).filter((row) => String(row.flex_die) === String(selected.id));
  }, [lookupQuery.data, resource.key, selected]);

  const canShowUsage = Boolean(selected) && (
    resource.key === "raw-materials" ||
    resource.key === "finished-inventory" ||
    resource.endpoint === "materials"
  );
  const canConsumeMaterial = Boolean(selected) && resource.key === "raw-materials";
  const visibleRows = useMemo(() => {
    if (resource.searchMode === "flexDie") return filterFlexDies(rows, flexFilters);
    const filtered = filterRows(rows, search);
    if (resource.key === "raw-materials") {
      return filtered.filter((row) => !["in_use", "depleted", "scrapped"].includes(row.status));
    }
    return filtered;
  }, [rows, search, flexFilters, resource.key, resource.searchMode]);
  const tableRows = useMemo(() => {
    if (resource.key !== "material-coated-stock") return visibleRows;
    const inventoryRows = lookupQuery.data?.["raw-materials"] ?? [];
    return visibleRows.map((row) => {
      return {
        ...row,
        inventory_total_feet: inventoryTotalFeetForMaterial(row, inventoryRows),
      };
    });
  }, [lookupQuery.data, resource.key, visibleRows]);
  const recordFormLookups = useMemo(() => {
    if (resource.key !== "job-tickets") return lookupQuery.data ?? {};
    return { ...(lookupQuery.data ?? {}), "job-tickets": rows };
  }, [lookupQuery.data, resource.key, rows]);

  function prepareSavePayload(payload) {
    const { __imageUploads, ...dataPayload } = payload ?? {};
    if (resource.key === "job-tickets") {
      return {
        ...dataPayload,
        ticket_number: generatedJobTicketNumber(dataPayload),
      };
    }
    if (resource.key !== "raw-materials") return payload;
    const quantity = dataPayload.length_feet === "" || dataPayload.length_feet === null || dataPayload.length_feet === undefined
      ? dataPayload.quantity ?? 0
      : dataPayload.length_feet;
    return {
      ...dataPayload,
      quantity,
      unit: dataPayload.unit || "lf",
    };
  }

  function canUseRecordField(field) {
    if (!field.requiresResourceAccess) return true;
    return roleHasResourceAccess(roleDefinitions, currentUser?.role, field.requiresResourceAccess);
  }

  const canEditJobTicket = roleHasResourceAccess(roleDefinitions, currentUser?.role, "job-ticket-editor");
  const canScheduleFromJobTicket = roleHasResourceAccess(roleDefinitions, currentUser?.role, "job-ticket-schedule");
  const canQuoteJobTicket = roleHasResourceAccess(roleDefinitions, currentUser?.role, "quote-calculator");
  const canManageQuoteMaterials = roleHasResourceAccess(roleDefinitions, currentUser?.role, "quote-material-admin");
  const jobTicketScheduleResource = useMemo(() => {
    const schedule = resourceMap["production-schedule"];
    const hiddenOnTicket = new Set([
      "job_ticket",
      "customer",
      "scheduled_by",
      "last_updated_by",
      "status",
      "scheduled_date",
      "press",
      "press_sequence",
      "operator",
      "actual_footage",
      "footage_report",
    ]);
    return {
      ...schedule,
      key: "job-ticket-schedule-form",
      fields: (schedule.fields ?? []).filter((field) => !hiddenOnTicket.has(field.name)),
    };
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const imageUploads = Array.isArray(payload?.__imageUploads) ? payload.__imageUploads : [];
      const cleanPayload = prepareSavePayload(payload);
      delete cleanPayload.__imageUploads;
      let saved;
      if (formMode === "edit" && selected?.id) {
        saved = await updateRecord(resource.endpoint, selected.id, cleanPayload);
      } else {
        saved = await createRecord(resource.endpoint, cleanPayload);
      }
      if (resource.key === "raw-materials") {
        try {
          await createRecord("material-usages", {
            inventory: saved.id,
            material: saved.material,
            usage_type: "adjustment",
            quantity: Number(saved.length_feet ?? saved.quantity ?? cleanPayload.length_feet ?? 0),
            unit: saved.unit || "lf",
            used_date: new Date().toISOString().slice(0, 10),
            reference: "Inventory added",
            notes: "Roll added to inventory.",
          });
        } catch (error) {
          if (!String(error.message).includes("404")) throw error;
        }
      }
      if (resource.key === "job-tickets" && imageUploads.length && saved?.id) {
        for (const upload of imageUploads) {
          if (!upload.file || !upload.slot) continue;
          const formData = new FormData();
          formData.append("image", upload.file);
          formData.append("name", autoImageName(upload.slot, saved || cleanPayload));
          saved = await uploadRecordAction(resource.endpoint, saved.id, `images/${upload.slot}`, formData);
        }
      }
      if (resource.key === "flex-dies" && imageUploads.length && saved?.id) {
        const upload = imageUploads.find((item) => item.slot === "dieline" && item.file);
        if (upload) {
          const formData = new FormData();
          formData.append("image", upload.file);
          formData.append("name", upload.file.name);
          saved = await uploadRecordAction(resource.endpoint, saved.id, "dieline-image", formData);
        }
      }
      return saved;
    },
    onSuccess: async (saved) => {
      if (saved && resource.key === "job-tickets") {
        const changes = formMode === "edit" ? summarizeJobTicketChanges(selected, saved) : [];
        try {
          await createRecord("job-ticket-events", {
            job_ticket: saved.id,
            event_type: formMode === "edit" ? "updated" : "created",
            summary: formMode === "edit"
              ? (changes.length
                ? `${currentUser.name} updated ${changes.slice(0, 4).join(", ")}${changes.length > 4 ? "..." : ""}.`
                : `${currentUser.name} updated the job ticket.`)
              : `${currentUser.name} created the job ticket.`,
            performed_by: currentUser.name,
            details: { changes },
          });
        } catch {
          // The ticket save should still succeed if history logging is unavailable.
        }
      }
      if (saved && resource.key === "raw-materials") {
        setLocalInventoryRows((prev) => mergeRows([saved], prev));
        queryClient.setQueryData(collectionQueryKey, (current) => {
          if (!current?.results) return current;
          const exists = current.results.some((row) => String(row.id) === String(saved.id));
          const results = exists
            ? current.results.map((row) => String(row.id) === String(saved.id) ? saved : row)
            : [saved, ...current.results];
          return {
            ...current,
            count: Math.max(current.count ?? 0, results.length),
            results,
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? null);
      setFormMode(null);
      setCreateDefaults({});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRecord(resource.endpoint, selected.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(null);
      setFormMode(null);
      setCreateDefaults({});
    },
  });

  async function fallbackRollAction(action, payload) {
    const roll = selected;
    async function tryCreateUsage(usagePayload) {
      try {
        return await createRecord("material-usages", usagePayload);
      } catch (error) {
        if (String(error.message).includes("404")) return null;
        throw error;
      }
    }

    if (action === "check-out") {
      const checkoutQuantity = currentInventoryQuantity(roll);
      const nextNotes = payload.qc_issue && payload.qc_notes
        ? [roll.notes, `QC: ${payload.qc_notes}`].filter(Boolean).join("\n")
        : roll.notes;
      const usage = await tryCreateUsage(rollUsagePayload(roll, {
        usage_type: "checkout",
        quantity: checkoutQuantity,
        used_by: payload.used_by,
        reference: payload.used_for || "Coordinator checkout",
        notes: payload.notes || `Full roll taken out: ${checkoutQuantity} ${roll.unit || "lf"}.`,
      }));
      const saved = usage
        ? await updateRecord("raw-materials", roll.id, {
            status: payload.qc_issue ? "on_hold" : "in_use",
            notes: nextNotes,
          })
        : await updateRecord("raw-materials", roll.id, {
            status: payload.qc_issue ? "on_hold" : "in_use",
            quantity: 0,
            length_feet: roll.length_feet === null || roll.length_feet === undefined ? undefined : 0,
            notes: nextNotes,
          });
      if (payload.qc_issue) {
        await tryCreateUsage(rollUsagePayload(roll, {
          usage_type: "qc_issue",
          quantity: 0,
          used_by: payload.used_by,
          reference: payload.used_for || "QC Review",
          notes: payload.qc_notes || payload.notes,
        }));
      }
      return saved;
    }

    if (action === "status") {
      const nextNotes = payload.qc_issue && payload.qc_notes
        ? [roll.notes, `QC: ${payload.qc_notes}`].filter(Boolean).join("\n")
        : [roll.notes, payload.notes].filter(Boolean).join("\n");
      const saved = await updateRecord("raw-materials", roll.id, {
        status: payload.status,
        notes: nextNotes,
      });
      await tryCreateUsage(rollUsagePayload(roll, {
        usage_type: payload.qc_issue || payload.status === "on_hold" ? "qc_issue" : "adjustment",
        quantity: 0,
        used_by: payload.used_by,
        reference: payload.reference || (payload.status === "scheduled" ? "Held for job" : "Inventory status update"),
        notes: payload.qc_notes || payload.notes,
      }));
      return saved;
    }

    const remaining = Number(payload.remaining_quantity ?? 0);
    const checkoutRows = [...(lookupQuery.data?.["material-usages"] ?? []), ...localUsageEvents]
      .filter((row) => String(row.inventory) === String(roll.id) && row.usage_type === "checkout");
    const checkedOutQuantity = checkoutRows.length
      ? Number(checkoutRows[0].quantity ?? 0)
      : currentInventoryQuantity(roll);
    const consumed = Math.max(0, checkedOutQuantity - remaining);
    const nextNotes = payload.qc_issue && payload.qc_notes
      ? [roll.notes, `QC: ${payload.qc_notes}`].filter(Boolean).join("\n")
      : roll.notes;
    const saved = await updateRecord("raw-materials", roll.id, {
      quantity: remaining,
      length_feet: roll.length_feet === null || roll.length_feet === undefined ? undefined : remaining,
      location: payload.location || null,
      status: payload.qc_issue ? "on_hold" : (remaining <= 0 ? "depleted" : "available"),
      notes: nextNotes,
    });

    if (consumed > 0) {
      await tryCreateUsage(rollUsagePayload(roll, {
        usage_type: "manual",
        quantity: consumed,
        used_by: payload.used_by,
        reference: "Coordinator return",
        notes: payload.notes || `Returned with ${remaining} ${roll.unit || "lf"} remaining.`,
      }));
    }
    await tryCreateUsage(rollUsagePayload(roll, {
      usage_type: "returned",
      quantity: 0,
      used_by: payload.used_by,
      reference: "Coordinator return",
      notes: payload.notes || `Returned with ${remaining} ${roll.unit || "lf"} remaining.`,
    }));
    if (payload.qc_issue) {
      await tryCreateUsage(rollUsagePayload(roll, {
        usage_type: "qc_issue",
        quantity: 0,
        used_by: payload.used_by,
        reference: "Coordinator return",
        notes: payload.qc_notes || payload.notes,
      }));
    }

    return saved;
  }

  const rollActionMutation = useMutation({
    mutationFn: ({ action, payload }) => fallbackRollAction(action, payload),
    onSuccess: (saved, variables) => {
      const roll = selected;
      if (roll) {
        if (variables.action === "check-out") {
          const checkoutQuantity = currentInventoryQuantity(roll);
          setLocalUsageEvents((prev) => [
            {
              id: `local-checkout-${Date.now()}`,
              inventory: roll.id,
              material: roll.material,
              usage_type: variables.payload.qc_issue ? "qc_issue" : "checkout",
              quantity: checkoutQuantity,
              unit: roll.unit || "lf",
              inventory_width_inches: roll.width_inches,
              used_date: new Date().toISOString().slice(0, 10),
              used_by: variables.payload.used_by,
              reference: variables.payload.used_for || "Coordinator checkout",
              notes: variables.payload.qc_notes || variables.payload.notes,
            },
            ...prev,
          ]);
        }

        if (variables.action === "return-roll") {
          const remaining = Number(variables.payload.remaining_quantity ?? 0);
          const consumed = Math.max(0, currentInventoryQuantity(roll) - remaining);
          setLocalUsageEvents((prev) => [
            {
              id: `local-return-${Date.now()}`,
              inventory: roll.id,
              material: roll.material,
              usage_type: consumed > 0 ? "manual" : "returned",
              quantity: consumed,
              unit: roll.unit || "lf",
              inventory_width_inches: roll.width_inches,
              used_date: new Date().toISOString().slice(0, 10),
              used_by: variables.payload.used_by,
              reference: "Coordinator return",
              notes: variables.payload.notes,
            },
            ...prev,
          ]);
        }

        if (variables.action === "status") {
          setLocalUsageEvents((prev) => [
            {
              id: `local-status-${Date.now()}`,
              inventory: roll.id,
              material: roll.material,
              usage_type: variables.payload.qc_issue || variables.payload.status === "on_hold" ? "qc_issue" : "adjustment",
              quantity: 0,
              unit: roll.unit || "lf",
              inventory_width_inches: roll.width_inches,
              used_date: new Date().toISOString().slice(0, 10),
              used_by: variables.payload.used_by,
              reference: variables.payload.reference || "Inventory status update",
              notes: variables.payload.qc_notes || variables.payload.notes,
            },
            ...prev,
          ]);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? selected);
    },
  });

  const finishedScheduleMutation = useMutation({
    mutationFn: async ({ material, schedule }) => {
      const required = [
        ["face_material", "Face Type"],
        ["liner_material", "Liner Type"],
        ["adhesive_material", "Adhesive Type"],
        ["silicone_material", "Silicone Type"],
      ];
      const missing = required.filter(([key]) => !material[key]).map(([, label]) => label);
      if (missing.length) {
        throw new Error(`Add these component types before scheduling: ${missing.join(", ")}`);
      }

      let etiPress = (lookupQuery.data?.presses ?? []).find((press) => String(press.name ?? "").trim().toLowerCase() === "eti");
      if (!etiPress) {
        etiPress = await createRecord("presses", {
          name: "ETI",
          is_active: true,
        });
      }
      return createRecord("coater-roll-tags", {
        name: material.name || material.material_family || material.code,
        status: "scheduled",
        print_status: "not_printed",
        scheduled_material: material.id,
        produced_material: material.id,
        liner: material.liner_material,
        face: material.face_material,
        adhesive: material.adhesive_material,
        silicone: material.silicone_material,
        coating: material.coating_material || null,
        result_code: material.code,
        length_feet: schedule.feet,
        cut_description: schedule.cut_description,
        operator_notes: schedule.operator_notes,
        notes: [
          schedule.cut_description ? `Cut: ${schedule.cut_description}` : "",
          schedule.operator_notes ? `Operator note: ${schedule.operator_notes}` : "",
        ].filter(Boolean).join("\n"),
        press: etiPress?.id ?? null,
        log_inventory: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const scheduleUpdateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateRecord("production-schedule", id, payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected((current) => (current?.id && saved?.id && String(current.id) === String(saved.id) ? saved : current));
    },
  });

  const scheduleRemoveMutation = useMutation({
    mutationFn: ({ id, payload }) => postRecordAction("production-schedule", id, "remove-from-schedule", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-order-events"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(null);
      setFormMode(null);
    },
  });

  const jobTicketEditMutation = useMutation({
    mutationFn: async (payload) => {
      if (!selected?.id) throw new Error("No job ticket selected.");
      const imageUploads = Array.isArray(payload?.__imageUploads) ? payload.__imageUploads : [];
      const cleanPayload = {
        ...payload,
        ticket_number: generatedJobTicketNumber(payload),
      };
      delete cleanPayload.__imageUploads;
      let saved = await updateRecord("job-tickets", selected.id, cleanPayload);
      for (const upload of imageUploads) {
        if (!upload.file || !upload.slot) continue;
        const formData = new FormData();
        formData.append("image", upload.file);
        formData.append("name", autoImageName(upload.slot, saved || cleanPayload));
        saved = await uploadRecordAction("job-tickets", saved.id, `images/${upload.slot}`, formData);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      const changes = summarizeJobTicketChanges(selected, saved);
      if (saved?.id) {
        try {
          await createRecord("job-ticket-events", {
            job_ticket: saved.id,
            event_type: "updated",
            summary: changes.length
              ? `${currentUser.name} updated ${changes.slice(0, 4).join(", ")}${changes.length > 4 ? "..." : ""}.`
              : `${currentUser.name} updated the job ticket.`,
            performed_by: currentUser.name,
            details: { changes },
          });
        } catch {
          // History is helpful, but the ticket save should not be blocked by it.
        }
      }
      queryClient.invalidateQueries({ queryKey: ["collection", "job-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? selected);
    },
  });

  const jobTicketScheduleCreateMutation = useMutation({
    mutationFn: (payload) => createRecord("production-schedule", {
      ...payload,
      job_ticket: selected.id,
      customer: selected.customer || null,
      status: "unscheduled",
      scheduled_by: currentUser.name,
      last_updated_by: currentUser.name,
      scheduled_date: payload.order_date || new Date().toISOString().slice(0, 10),
      press: null,
      press_sequence: null,
      operator: "",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  async function refreshFlexDie(saved = null) {
    if (saved && resource.key === "flex-dies") setSelected(saved);
    await queryClient.invalidateQueries({ queryKey: ["collection", "flex-dies"] });
    await queryClient.invalidateQueries({ queryKey: ["lookups"] });
  }

  async function requestFlexDieReorder(dieOrId, note = "") {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "request-reorder", {
      requested_by: currentUser.name,
      notes: note,
    });
    await refreshFlexDie(saved);
  }

  async function markFlexDieOrdered(dieOrId, note = "") {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "mark-ordered", {
      performed_by: currentUser.name,
      notes: note,
    });
    await refreshFlexDie(saved);
  }

  async function receiveFlexDie(dieOrId, { serialNumber = "", quantity = 1, notes = "" } = {}) {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "receive-die", {
      received_by: currentUser.name,
      serial_number: serialNumber,
      quantity,
      notes,
    });
    await refreshFlexDie(saved);
  }

  async function adjustFlexDieCount(dieOrId, { activeCount = 0, notes = "" } = {}) {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "adjust-count", {
      performed_by: currentUser.name,
      active_die_count: activeCount,
      notes,
    });
    await refreshFlexDie(saved);
  }

  async function deleteFlexDieDieline(dieOrId) {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await deleteRecordAction("flex-dies", id, "dieline-image");
    await refreshFlexDie(saved);
  }

  function switchResource(key) {
    if (!allowedResources.some((item) => item.key === key)) return;
    setActiveKey(key);
    setSelected(null);
    setFormMode(null);
    setCreateDefaults({});
    setUsageOpen(false);
    setRollOpen(false);
    setFinishedMaterialOpen(false);
    setSearch("");
  }

  function toggleGroup(key) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function editRecord(row) {
    setSelected(row);
    setFormMode("edit");
  }

  function confirmDeleteRecord(row) {
    const title = getRecordTitle(row);
    if (!window.confirm(`Delete ${title}? This cannot be undone.`)) return;
    setSelected(row);
    deleteRecord(resource.endpoint, row.id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
        queryClient.invalidateQueries({ queryKey: ["lookups"] });
        setSelected(null);
        setFormMode(null);
      })
      .catch((error) => {
        window.alert(`Could not delete ${title}: ${error.message}`);
      });
  }

  return (
    <main className={`app-shell ${singleResourceMode ? "single-resource-app" : ""}`}>
      <section className="mobile-shell-bar compact-card">
        <div>
          <p className="eyebrow">Tri-State Media</p>
          <strong>{resource.label}</strong>
          <span>{currentUser.name} / {currentUser.role}</span>
        </div>
        <AccountMenu
          currentUser={currentUser}
          canManageUsers={canManageUsers}
          onOpenUserAdmin={onOpenUserAdmin}
          onSignOut={onSignOut}
        />
        {!singleResourceMode && (
          <label>
            <span>Page</span>
            <select value={resource.key} onChange={(event) => switchResource(event.target.value)}>
              {allowedResources.map((item) => (
                <option value={item.key} key={item.key}>
                  {groupLabelsByKey[item.group] ? `${groupLabelsByKey[item.group]} - ` : ""}{item.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">Tooling Control</p>
          <h1>Recipes + Tools</h1>
          <p>Compact setup library built for future recipe recommendations.</p>
        </div>

        {topLevelGroups.map((group) => {
          const childGroups = resourceGroups.filter((item) => item.parent === group.key);
          const groupResources = allowedResources.filter((item) => item.group === group.key);
          const visibleChildGroups = childGroups.filter((child) => allowedResources.some((item) => item.group === child.key));
          const activeInGroup = groupResources.some((item) => item.key === resource.key) || visibleChildGroups.some((child) => allowedResources.some((item) => item.group === child.key && item.key === resource.key));
          const open = Boolean(openGroups[group.key]);
          if (!groupResources.length && !visibleChildGroups.length) return null;

          return (
            <section className={`nav-group ${activeInGroup ? "has-active" : ""}`} key={group.key}>
              <button className="nav-group-toggle" type="button" onClick={() => toggleGroup(group.key)}>
                <span>{group.label}</span>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>

              {open && (
                <div className="nav-submenu">
                  {groupResources.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === resource.key;
                    return (
                      <button className={`nav-btn ${active ? "active" : ""}`} type="button" key={item.key} onClick={() => switchResource(item.key)} style={{ "--accent": item.accent }}>
                        <Icon size={16} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}

                  {visibleChildGroups.map((child) => {
                    const childResources = allowedResources.filter((item) => item.group === child.key);
                    const activeInChild = childResources.some((item) => item.key === resource.key);
                    const childOpen = Boolean(openGroups[child.key]);
                    if (!childResources.length) return null;

                    return (
                      <div className={`nav-child-group ${activeInChild ? "has-active" : ""}`} key={child.key}>
                        <button className="nav-child-toggle" type="button" onClick={() => toggleGroup(child.key)}>
                          <span>{child.label}</span>
                          {childOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {childOpen && (
                          <div className="nav-child-submenu">
                            {childResources.map((item) => {
                              const Icon = item.icon;
                              const active = item.key === resource.key;
                              return (
                                <button className={`nav-btn ${active ? "active" : ""}`} type="button" key={item.key} onClick={() => switchResource(item.key)} style={{ "--accent": item.accent }}>
                                  <Icon size={16} />
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </aside>

      <section className="work-area">
        <header className="topbar compact-card">
          <div>
            <p className="eyebrow">{resource.singular}</p>
            <h2>{resource.label}</h2>
            <p>{resource.tagline}</p>
          </div>
          <div className="top-actions">
            {!showingStaticView && <button className="ghost-btn" type="button" onClick={() => listQuery.refetch()}><RefreshCcw size={15} /> Refresh</button>}
            {!resource.disableCreate && !showingStaticView && (
              <button className="primary-btn" type="button" onClick={() => { setSelected(null); setCreateDefaults({}); setFormMode("create"); }}><Plus size={16} /> {resource.key === "raw-materials" ? "Add Inventory Roll" : "Add"}</button>
            )}
            <AccountMenu
              currentUser={currentUser}
              canManageUsers={canManageUsers}
              onOpenUserAdmin={onOpenUserAdmin}
              onSignOut={onSignOut}
            />
          </div>
        </header>

        {saveMutation.error && <div className="error-box">{saveMutation.error.message}</div>}
        {finishedScheduleMutation.error && <div className="error-box">{finishedScheduleMutation.error.message}</div>}
        {scheduleUpdateMutation.error && <div className="error-box">{scheduleUpdateMutation.error.message}</div>}
        {scheduleRemoveMutation.error && <div className="error-box">{scheduleRemoveMutation.error.message}</div>}
        {jobTicketEditMutation.error && <div className="error-box">{jobTicketEditMutation.error.message}</div>}
        {jobTicketScheduleCreateMutation.error && <div className="error-box">{jobTicketScheduleCreateMutation.error.message}</div>}
        {deleteMutation.error && <div className="error-box">{deleteMutation.error.message}</div>}
        {rollActionMutation.error && <div className="error-box">{rollActionMutation.error.message}</div>}
        {listQuery.error && <div className="error-box">Could not load {resource.label}: {listQuery.error.message}</div>}
        {resource.key === "material-usages" && listQuery.data?.raw?.missingEndpoint && (
          <div className="error-box">Material Usage needs the latest backend migration/restart before it can load saved usage records.</div>
        )}
        {lookupQuery.error && <div className="error-box">Could not load lookup data: {lookupQuery.error.message}</div>}

        {resource.viewMode === "quoteCalculator" ? (
          <QuotePricingTool
            currentUser={currentUser}
            initialJobTicketId={quoteJobTicketId}
            canManageQuoteMaterials={canManageQuoteMaterials}
          />
        ) : resource.viewMode === "dataImport" ? (
          <DataImportTool currentUser={currentUser} />
        ) : (
          <>
            {resource.searchMode === "flexDie" ? (
              <FlexDieSearch filters={flexFilters} setFilters={setFlexFilters} liners={lookupQuery.data?.materials ?? []} />
            ) : (
              <section className="search-line compact-card">
                <Search size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${resource.label.toLowerCase()}...`} />
                <span>{visibleRows.length} / {rows.length}</span>
              </section>
            )}

            {formMode && !showingMaterialFormOverlay && !showingScheduleFormOverlay && !showingToolingConfigFormOverlay && !(showingJobTicketOverlay && formMode === "edit") && (
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={recordFormLookups}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
                canUseField={canUseRecordField}
              />
            )}

            <section className={`content-grid ${["job-tickets", "production-schedule"].includes(resource.key) || isToolingConfigPage ? "wide-list" : ""}`}>
              <div className="list-panel compact-card">
                <div className="panel-head thin">
                  <div>
                    <p className="eyebrow">Records</p>
                    <h2>{listQuery.isLoading ? "Loading..." : `${visibleRows.length} shown`}</h2>
                  </div>
                </div>

                {resource.viewMode === "productionSchedule" ? (
                  <ProductionScheduleView
                    rows={tableRows}
                    selected={selected}
                    presses={lookupQuery.data?.presses ?? []}
                    currentUser={currentUser}
                    lookups={lookupQuery.data ?? {}}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onClose={() => setSelected(null)}
                    onEdit={(row) => {
                      if (row) setSelected(row);
                      setFormMode("edit");
                    }}
                    onUpdate={(id, payload) => scheduleUpdateMutation.mutate({ id, payload })}
                    onRemove={(row, reason) => scheduleRemoveMutation.mutateAsync({
                      id: row.id,
                      payload: { reason, performed_by: currentUser.name },
                    })}
                    onFlexDieReorder={(die, note) => requestFlexDieReorder(die, note)}
                    onFlexDieCountUpdate={(die, payload) => adjustFlexDieCount(die, payload)}
                  />
                ) : resource.viewMode === "jobTicketGallery" ? (
                  <JobTicketGallery
                    rows={visibleRows}
                    selectedId={selected?.id}
                    usageRows={lookupQuery.data?.["job-ticket-usages"] ?? []}
                    finishedRows={lookupQuery.data?.["finished-inventory"] ?? []}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                  />
                ) : resource.viewMode === "packagingInventory" ? (
                  <PackagingInventoryView
                    boxRows={visibleRows}
                    coreRows={lookupQuery.data?.["core-inventory"] ?? []}
                    search={search}
                  />
                ) : resource.viewMode === "materialInventory" ? (
                  <MaterialInventoryView
                    rows={visibleRows}
                    selectedId={selected?.id}
                    onSelect={(row) => { setSelected(row); setFormMode(null); setUsageOpen(false); setRollOpen(true); }}
                  />
                ) : resource.viewMode === "locations" ? (
                  <GroupedLocationView
                    rows={visibleRows}
                    selectedId={selected?.id}
                    onSelect={(row) => setSelected(row)}
                    onEdit={editRecord}
                    onDelete={confirmDeleteRecord}
                  />
                ) : resource.key === "material-usages" ? (
                  <GroupedUsageView
                    rows={visibleRows}
                    selectedId={selected?.id}
                    onSelect={(row) => setSelected(row)}
                    onEdit={editRecord}
                    onDelete={confirmDeleteRecord}
                  />
                ) : resource.key === "recipes" ? (
                  <LabelLayoutsView
                    rows={visibleRows}
                    selectedId={selected?.id}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                  />
                ) : resource.key === "recipe-options" ? (
                  <RecipeOptionsView
                    rows={visibleRows}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                  />
                ) : resource.key === "recipe-tools" ? (
                  <RecipeToolStackView
                    rows={tableRows}
                    selectedId={selected?.id}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                  />
                ) : (
                  <ResourceTable
                    resource={resource}
                    rows={tableRows}
                    selectedId={selected?.id}
                    onSelect={(row) => {
                      setSelected(row);
                      setFormMode(null);
                      if (resource.key === "material-coated-stock") setFinishedMaterialOpen(true);
                      if (isMaterialTypePage) setMaterialTypeOpen(true);
                    }}
                  />
                )}
              </div>

              {resource.key !== "job-tickets" && resource.key !== "production-schedule" && resource.key !== "raw-materials" && resource.key !== "material-coated-stock" && !isMaterialTypePage && !isToolingConfigPage && (
                <aside className={resource.key === "flex-dies" && selected ? "flex-die-detail-shell" : "detail-panel compact-card"}>
                  {selected ? (
                  resource.key === "flex-dies" ? (
                    <FlexDieDetailPanel
                      die={selected}
                      historyRows={selectedFlexDieHistory}
                      onEdit={() => setFormMode("edit")}
                      onDelete={() => deleteMutation.mutate()}
                      onRequestReorder={(note) => requestFlexDieReorder(selected, note)}
                      onMarkOrdered={(note) => markFlexDieOrdered(selected, note)}
                      onReceiveDie={(payload) => receiveFlexDie(selected, payload)}
                      onAdjustCount={(payload) => adjustFlexDieCount(selected, payload)}
                      onDeleteDieline={() => deleteFlexDieDieline(selected)}
                    />
                  ) : (
                  <>
                    <div className="panel-head thin">
                      <div>
                        <p className="eyebrow">Selected</p>
                        <h2>{getRecordTitle(selected)}</h2>
                      </div>
                    </div>
                    <div className="detail-list">
                      {detailKeys.map((key) => (
                        <div key={key}><span>{labelForField(resource, key)}</span><strong>{detailValue(selected, key)}</strong></div>
                      ))}
                    </div>
                    {!resource.disableMutate && (
                      <div className="detail-actions">
                        <button className="primary-btn" type="button" onClick={() => setFormMode("edit")}>Edit</button>
                        {canShowUsage && <button className="ghost-btn" type="button" onClick={() => setUsageOpen(true)}>Usage</button>}
                        {canConsumeMaterial && (
                          <button className="ghost-btn" type="button" onClick={() => setRollOpen(true)}>Roll Control</button>
                        )}
                        <button className="danger-btn" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>Delete</button>
                      </div>
                    )}
                    {resource.disableMutate && canShowUsage && (
                      <div className="detail-actions">
                        <button className="ghost-btn" type="button" onClick={() => setUsageOpen(true)}>Usage</button>
                      </div>
                    )}
                  </>
                  )
                  ) : (
                  <>
                    <div className="panel-head thin">
                      <div>
                        <p className="eyebrow">Selected</p>
                        <h2>Nothing selected</h2>
                      </div>
                    </div>
                    <p className="muted">Click a row to inspect it. The form stays closed until you add or edit.</p>
                  </>
                  )}
                </aside>
              )}
            </section>
          </>
        )}

        {showingJobTicketOverlay && (
          <section className="job-overlay" role="dialog" aria-modal="true" aria-label="Job ticket packet">
            <div className="job-overlay-shell compact-card">
              <header className="job-overlay-head">
                <div>
                  <p className="eyebrow">{formMode === "edit" ? "Edit Job Ticket" : "Job Ticket"}</p>
                  <h2>{selected.job_name || getRecordTitle(selected)}</h2>
                </div>
                <button className="ghost-btn" type="button" onClick={() => { setSelected(null); setFormMode(null); }}>
                  <X size={16} /> Close
                </button>
              </header>

              <JobTicketPanel
                ticket={selected}
                lookups={lookupQuery.data ?? {}}
                chartsLoading={lookupQuery.isLoading || (lookupQuery.isFetching && !lookupQuery.data)}
                canEdit={canEditJobTicket}
                canSchedule={canScheduleFromJobTicket}
                canQuote={canQuoteJobTicket}
                onQuoteJob={() => {
                  setQuoteJobTicketId(String(selected.id));
                  setActiveKey("quote-calculator");
                  setSelected(null);
                  setFormMode(null);
                  setSearch("");
                }}
                renderEditorForm={({ onCancel }) => (
                  <RecordForm
                    resource={resource}
                    record={selected}
                    lookups={recordFormLookups}
                    submitting={jobTicketEditMutation.isPending}
                    onSubmit={(payload) => jobTicketEditMutation.mutate(payload)}
                    onCancel={onCancel}
                    canUseField={canUseRecordField}
                  />
                )}
                renderScheduleForm={({ onCancel }) => (
                  <RecordForm
                    resource={jobTicketScheduleResource}
                    defaults={scheduleDefaultsForTicket(selected, currentUser)}
                    lookups={{ ...(lookupQuery.data ?? {}), "job-tickets": selected ? [selected] : [] }}
                    submitting={jobTicketScheduleCreateMutation.isPending}
                    onSubmit={(payload) => jobTicketScheduleCreateMutation.mutate(payload)}
                    onCancel={onCancel}
                    canUseField={canUseRecordField}
                  />
                )}
              />
            </div>
          </section>
        )}

        {showingMaterialFormOverlay && (
          <section className="material-form-overlay" role="dialog" aria-modal="true" aria-label={`${formMode === "edit" ? "Edit" : "Add"} ${resource.singular}`}>
            <div className="material-form-window">
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={lookupQuery.data ?? {}}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {showingToolingConfigFormOverlay && (
          <section className="tooling-form-overlay" role="dialog" aria-modal="true" aria-label={`${formMode === "edit" ? "Edit" : "Add"} ${resource.singular}`}>
            <div className="tooling-form-window">
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={lookupQuery.data ?? {}}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {showingToolingConfigDetailOverlay && (
          <section className="tooling-detail-overlay" role="dialog" aria-modal="true" aria-label={`${resource.singular} details`}>
            <div className="tooling-detail-window">
              <header className="tooling-detail-head">
                <div>
                  <p className="eyebrow">{resource.singular} Details</p>
                  <h2>{getRecordTitle(selected)}</h2>
                  <span>{resource.label}</span>
                </div>
                <button className="ghost-btn" type="button" onClick={() => setSelected(null)}>
                  <X size={16} /> Close
                </button>
              </header>

              <div className="tooling-detail-grid">
                {detailKeys.map((key) => (
                  <div key={key}>
                    <span>{labelForField(resource, key)}</span>
                    <strong>{detailValue(selected, key)}</strong>
                  </div>
                ))}
              </div>

              {!resource.disableMutate && (
                <div className="tooling-detail-actions">
                  <button className="primary-btn" type="button" onClick={() => setFormMode("edit")}>Edit</button>
                  <button className="danger-btn" type="button" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>Delete</button>
                </div>
              )}
            </div>
          </section>
        )}

        {showingScheduleFormOverlay && (
          <section className="schedule-form-overlay" role="dialog" aria-modal="true" aria-label={`${formMode === "edit" ? "Edit" : "Schedule"} ${resource.singular}`}>
            <div className="schedule-form-window">
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={lookupQuery.data ?? {}}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate({ ...payload, last_updated_by: currentUser.name })}
                onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {usageOpen && canShowUsage && (
          <MaterialUsageWindow
            title={getRecordTitle(selected)}
            rows={usageRows}
            onClose={() => setUsageOpen(false)}
          />
        )}

        {rollOpen && canConsumeMaterial && (
          <RollWorkflowWindow
            roll={selected}
            locations={lookupQuery.data?.locations ?? []}
            usageRows={usageRows}
            submitting={rollActionMutation.isPending}
            onClose={() => setRollOpen(false)}
            onEdit={() => {
              setRollOpen(false);
              setFormMode("edit");
            }}
            onCheckOut={(payload) => rollActionMutation.mutate({ action: "check-out", payload })}
            onReturn={(payload) => rollActionMutation.mutate({ action: "return-roll", payload })}
            onUpdateStatus={(payload) => rollActionMutation.mutate({ action: "status", payload })}
          />
        )}

        {finishedMaterialOpen && selected && resource.key === "material-coated-stock" && (
          <FinishedMaterialWindow
            material={selected}
            usageRows={usageRows}
            inventoryRows={selectedMaterialInventoryRows}
            scheduling={finishedScheduleMutation.isPending}
            onClose={() => setFinishedMaterialOpen(false)}
            onEdit={() => {
              setFinishedMaterialOpen(false);
              setFormMode("edit");
            }}
            onSchedule={(schedule) => finishedScheduleMutation.mutate({ material: selected, schedule })}
          />
        )}

        {materialTypeOpen && selected && isMaterialTypePage && (
          <MaterialTypeWindow
            material={selected}
            options={selectedMaterialSupplierOptions}
            onClose={() => setMaterialTypeOpen(false)}
            onEdit={() => {
              setMaterialTypeOpen(false);
              setFormMode("edit");
            }}
            onDelete={canManageUsers ? () => {
              setMaterialTypeOpen(false);
              confirmDeleteRecord(selected);
            } : undefined}
            onAddSupplierOption={() => {
              const material = selected;
              setMaterialTypeOpen(false);
              setActiveKey("material-supplier-options");
              setSelected(null);
              setSearch("");
              setCreateDefaults({
                material: material.id,
                supplier_name: "",
                option_name: material.name || "",
                is_active: true,
              });
              setFormMode("create");
            }}
            onEditSupplierOption={(option) => {
              setMaterialTypeOpen(false);
              setActiveKey("material-supplier-options");
              setSelected(option);
              setSearch("");
              setCreateDefaults({});
              setFormMode("edit");
            }}
          />
        )}
      </section>
    </main>
  );
}
