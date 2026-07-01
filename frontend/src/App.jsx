import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Building2, ChevronDown, ChevronRight, KeyRound, LogIn, LogOut, Menu, Plus, RefreshCcw, Search, Shield, ShieldCheck, UserCog, UserPlus, Users, X } from "lucide-react";
import { createRecord, deleteRecord, deleteRecordAction, fetchCollection, postRecordAction, updateRecord, uploadRecordAction } from "./api";
import { resourceGroups, resourceMap, resources } from "./resourceConfig";
import RecordForm from "./components/RecordForm";
import ResourceTable from "./components/ResourceTable";
import FlexDieSearch from "./components/FlexDieSearch";
import FlexDieDetailPanel from "./components/FlexDieDetailPanel";
import FlexDieTable from "./components/FlexDieTable";
import FinishedInventoryView, { FinishedInventoryWindow } from "./components/FinishedInventoryView";
import FinishedMaterialWindow from "./components/FinishedMaterialWindow";
import FootageReportsView from "./components/FootageReportsView";
import CustomerWorkspace from "./components/CustomerWorkspace";
import CoaterOperatorView from "./components/CoaterOperatorView";
import DataImportTool from "./components/DataImportTool";
import GroupedLocationView from "./components/GroupedLocationView";
import GroupedUsageView from "./components/GroupedUsageView";
import JobTicketGallery from "./components/JobTicketGallery";
import JobTicketPanel from "./components/JobTicketPanel";
import LabelLayoutsView from "./components/LabelLayoutsView";
import LiveFootageView from "./components/LiveFootageView";
import MaterialInventoryView from "./components/MaterialInventoryView";
import MaterialHandlingView, { activeJobKey } from "./components/MaterialHandlingView";
import MaterialTypeTable from "./components/MaterialTypeTable";
import MaterialTypeWindow from "./components/MaterialTypeWindow";
import MaterialTypeManager from "./components/MaterialTypeManager";
import MaterialUsageWindow from "./components/MaterialUsageWindow";
import MessagesCenter from "./components/MessagesCenter";
import PackagingInventoryView from "./components/PackagingInventoryView";
import PressSpeedSidebarWidget from "./components/PressSpeedSidebarWidget";
import QuotePricingTool from "./components/QuotePricingTool";
import RecipeOptionsView from "./components/RecipeOptionsView";
import RecipeToolStackView from "./components/RecipeToolStackView";
import RollScanStation from "./components/RollScanStation";
import RollWorkflowWindow from "./components/RollWorkflowWindow";
import ProductionScheduleView from "./components/ProductionScheduleView";
import PressTable from "./components/PressTable";
import SupplierTable from "./components/SupplierTable";
import ToolingItemDetailPanel from "./components/ToolingItemDetailPanel";
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
  saveSession,
  saveUserToApi,
  saveUsers,
  signIn,
  userIsAdmin,
} from "./lib/localAuth";
import { quoteCompanyKey, quoteCompanyLabel, quoteCompanyOptions } from "./lib/quoteCompanies";
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

function normalizeToolKey(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function assignmentToolDetails(tool) {
  return tool?.tool_details ?? tool?.flex_die_details ?? tool?.mag_details ?? tool?.perf_cylinder_details ?? tool?.perf_blade_setup_details ?? {};
}

function assignmentToolTarget(tool) {
  const details = assignmentToolDetails(tool);
  const type = normalizeToolKey(tool?.tool_type ?? details.type);
  if (type.includes("flex_die")) return { resourceKey: "flex-dies", id: tool.flex_die ?? details.id };
  if (type.includes("mag") && !type.includes("perf")) return { resourceKey: "mags", id: tool.mag ?? details.id };
  if (type.includes("perf_blade_setup")) return { resourceKey: "perf-blade-setups", id: tool.perf_blade_setup ?? details.id };
  if (type.includes("perf_cylinder") || type.includes("perf")) return { resourceKey: "perf-cylinders", id: tool.perf_cylinder ?? details.id };
  return { resourceKey: "", id: null };
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
    const lookupPageSize = field.lookupPageSize ?? field.maxResults ?? 250;
    const lookupFetchAll = Boolean(field.lookupFetchAll ?? field.fetchAll ?? false);
    if (field.lookupRelation) {
      addLookupSpec(specs, relationLookupSpec(field.lookupRelation, field.lookupFilters, lookupPageSize, lookupFetchAll));
    }
    if (!field.relation || !["relation", "searchRelation", "multiRelation"].includes(field.type)) return;
    addLookupSpec(specs, relationLookupSpec(field.relation, field.lookupFilters, lookupPageSize, lookupFetchAll));
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
    if (selected?.id) addLookupSpec(specs, {
      key: "coater-roll-tags",
      endpoint: "coater-roll-tags",
      ordering: "-run_date,-created_at",
      filters: { material: selected.id },
      pageSize: 1000,
      fetchAll: true,
    });
    addLookupSpec(specs, relationLookupSpec("presses", {}, 100));
  }

  if (isMaterialTypePage) {
    addLookupSpec(specs, relationLookupSpec("material-supplier-options", { material_type: resource.filters?.material_type }, 1000, true));
  }

  if (resource.endpoint === "materials" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { material: selected.id }, 150));
  }

  if (resource.key === "customers" && selected?.id) {
    addLookupSpec(specs, { key: "quote-records", endpoint: "quote-records", ordering: "-created_at", filters: { customer: selected.id }, pageSize: 1000, fetchAll: true });
    addLookupSpec(specs, relationLookupSpec("customer-orders", { customer: selected.id }, 1000, true));
    addLookupSpec(specs, relationLookupSpec("job-tickets", { customer: selected.id }, 1000, true));
  }

  if (resource.key === "suppliers") {
    addLookupSpec(specs, relationLookupSpec("suppliers", {}, 1000, true));
  }

  if (resource.key === "finished-inventory" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory: selected.id }, 150));
  }

  if (resource.key === "finished-inventory" && selected?.material_inventory) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { inventory: selected.material_inventory }, 150));
  }

  if (resource.key === "job-tickets" && selected) {
    if (selected.material_spec) addLookupSpec(specs, relationLookupSpec("raw-materials", { material: selected.material_spec }, 250));
    if (selected.material_master_type || selected.material_spec_master_type) {
      addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock", master_type: selected.material_master_type || selected.material_spec_master_type }, 250));
    }
    addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock" }, 1000, true));
    addLookupSpec(specs, relationLookupSpec("finished-inventory", { job_ticket: selected.id }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("finished-inventory", { tsm_id: selected.product_code }, 250, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("finished-inventory", { tsm_id: selected.ticket_number }, 250, true));
    addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_job_ticket: selected.id }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_tsm_id: selected.product_code }, 250, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_tsm_id: selected.ticket_number }, 250, true));
    addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { job_ticket: selected.id }, 1000, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { legacy_job_ticket_id: selected.ticket_number }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { legacy_job_ticket_id: selected.product_code }, 250, true));
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 150));
    addLookupSpec(specs, relationLookupSpec("box-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("production-schedule", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-orders", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-orders", { job_ticket: selected.id }, 250, true));
    addLookupSpec(specs, relationLookupSpec("customer-order-events", {}, 250));
    addLookupSpec(specs, relationLookupSpec("customer-order-events", { job_ticket: selected.id }, 250, true));
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
    addLookupSpec(specs, relationLookupSpec("recipe-tools", { flex_die: selected.id }, 500, true));
  }

  if (resource.key === "recipes") {
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("recipe-tools", {}, 2000, true));
    addLookupSpec(specs, relationLookupSpec("print-plates", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("print-stations", {}, 2000, true));
    addFieldLookups(specs, resourceMap["recipe-options"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["recipe-tools"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["print-plates"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["print-stations"]?.fields ?? []);
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

function compactScanValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findScannedLocation(locations, value) {
  const scan = compactScanValue(value);
  if (!scan) return null;
  return (locations ?? []).find((row) => [
    row.id,
    row.code,
    row.name,
    row.full_path,
    row.location_full_path,
  ].some((field) => compactScanValue(field) === scan));
}

function locationCodeFromScan(value) {
  const clean = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46);
  return clean || `LOC-${Date.now()}`;
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

function firstMaterialComponentId(material, preferredKey, allowedKey) {
  if (material?.[preferredKey]) return material[preferredKey];
  const allowed = Array.isArray(material?.[allowedKey]) ? material[allowedKey] : [];
  return allowed[0] || null;
}

function generatedJobTicketNumber(payload = {}, currentTicket = null) {
  const existing = String(payload.ticket_number || "").trim();
  if (existing) return existing;
  const current = String(currentTicket?.ticket_number || "").trim();
  if (current) return current;
  const tsmId = String(payload.product_code || "").trim();
  if (tsmId) return tsmId;
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

const initialOpenGroups = Object.fromEntries(
  resourceGroups.map((group) => [group.key, false])
);

const topLevelGroups = resourceGroups.filter((group) => !group.parent);
const groupLabelsByKey = Object.fromEntries(resourceGroups.map((group) => [group.key, group.label]));

function navigationResourcesForGroup(items, groupKey) {
  const grouped = items.filter((item) => item.group === groupKey);
  if (groupKey !== "production") return grouped;
  const suppliers = grouped.find((item) => item.key === "suppliers");
  if (!suppliers) return grouped;
  const withoutSuppliers = grouped.filter((item) => item.key !== "suppliers");
  const customerIndex = withoutSuppliers.findIndex((item) => item.key === "customers");
  withoutSuppliers.splice(customerIndex >= 0 ? customerIndex + 1 : withoutSuppliers.length, 0, suppliers);
  return withoutSuppliers;
}
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

const toolingItemPageKeys = new Set([
  "flex-dies",
  "mags",
  "perf-cylinders",
  "perf-blade-setups",
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
  return resources.filter((item) => !item.permissionOnly && !item.hideFromNav && roleHasResourceAccess(roleDefinitions, roleName, item.key));
}

function resourceAvailableForRole(roleDefinitions, roleName, key) {
  const item = resourceMap[key];
  return Boolean(item && !item.permissionOnly && roleHasResourceAccess(roleDefinitions, roleName, item.key));
}

function defaultResourceKeyForRole(roleDefinitions, roleName) {
  const visible = visibleResourcesForRole(roleDefinitions, roleName);
  const normalizedRole = String(roleName || "").toLowerCase();
  if (normalizedRole === "sales" && visible.some((item) => item.key === "quote-calculator")) return "quote-calculator";
  if (normalizedRole === "coater" && visible.some((item) => item.key === "coater-operator")) return "coater-operator";
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
  quoteCompany: "tri_state_media",
  active: true,
};

const emptyRoleForm = {
  name: "",
  description: "",
  allowedResourceKeys: ["quote-calculator"],
};

const materialOwnerTabs = [
  { key: "tri_state", label: "Tri-State Media Materials" },
  { key: "other", label: "Other Materials" },
];

function isTriStateMaterial(row) {
  return /tri\s*-?\s*state\s+media/i.test(String(row?.company || ""));
}

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
  const selectedUserRole = roleDefinitions.find((role) => role.name === form.role);
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

  function startEdit(user) {
    setAdminTab("users");
    setEditingId(user.id);
    setForm({
      name: user.name,
      username: user.username,
      password: "",
      role: user.role || "CSR",
      quoteCompany: quoteCompanyKey(user.quoteCompany),
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
            {selectedUserRole && <p className="role-summary-note">Access: {roleAccessSummary(selectedUserRole)}</p>}
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
                      <span>{user.username} / {user.role} / {quoteCompanyLabel(user.quoteCompany)}</span>
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

function AccountMenu({
  currentUser,
  canManageUsers,
  roleDefinitions = [],
  previewRoleName = "",
  onPreviewRoleChange,
  onOpenUserAdmin,
  onQuoteCompanyChange,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const activeQuoteCompany = quoteCompanyKey(currentUser?.quoteCompany);
  const activeRoleLabel = previewRoleName || currentUser?.role || "";

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
        <em>{previewRoleName ? `View: ${previewRoleName}` : currentUser.role}</em>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="account-menu-panel">
          <div>
            <strong>{currentUser.name}</strong>
            <span>{currentUser.username} / {currentUser.role}</span>
            {previewRoleName && <em>Development view: {previewRoleName}</em>}
          </div>
          {canManageUsers && (
            <div className="account-role-preview-card">
              <span>View As Role</span>
              <select value={previewRoleName} onChange={(event) => onPreviewRoleChange?.(event.target.value)}>
                <option value="">Actual role ({currentUser.role})</option>
                {roleDefinitions.map((role) => (
                  <option value={role.name} key={role.id}>{role.name}</option>
                ))}
              </select>
              {previewRoleName && (
                <button type="button" onClick={() => onPreviewRoleChange?.("")}>
                  <Shield size={14} />
                  Back to {currentUser.role}
                </button>
              )}
              <small>Current screen access: {activeRoleLabel}</small>
            </div>
          )}
          <div className="account-company-card">
            <span>Quote Company</span>
            <div className="account-company-options">
              {quoteCompanyOptions.map((company) => (
                <button
                  className={`account-company-option ${company.value === activeQuoteCompany ? "active" : ""}`}
                  type="button"
                  onClick={() => onQuoteCompanyChange(company.value)}
                  key={company.value}
                >
                  <Building2 size={14} />
                  <span>{company.label}</span>
                </button>
              ))}
            </div>
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

  async function handleQuoteCompanyChange(value) {
    if (!currentUser) return;
    const nextQuoteCompany = quoteCompanyKey(value);
    if (nextQuoteCompany === quoteCompanyKey(currentUser.quoteCompany)) return;

    const matchesCurrentUser = (user) =>
      String(user.id) === String(currentUser.id) || String(user.username || "").toLowerCase() === String(currentUser.username || "").toLowerCase();
    const nextUser = { ...currentUser, quoteCompany: nextQuoteCompany };
    const nextUsers = users.map((user) => matchesCurrentUser(user) ? { ...user, quoteCompany: nextQuoteCompany } : user);
    setCurrentUser(nextUser);
    setUsers(nextUsers);
    saveUsers(nextUsers);
    saveSession(nextUser);

    if (String(currentUser.id || "").startsWith("user-")) return;

    try {
      const saved = await updateRecord("company-users", currentUser.id, { quoteCompany: nextQuoteCompany });
      const syncedUser = { ...nextUser, ...saved, quoteCompany: quoteCompanyKey(saved.quoteCompany) };
      const syncedUsers = nextUsers.map((user) => matchesCurrentUser(user) ? { ...user, ...syncedUser } : user);
      setCurrentUser(syncedUser);
      setUsers(syncedUsers);
      saveUsers(syncedUsers);
      saveSession(syncedUser);
    } catch (error) {
      console.warn("Could not sync quote company preference.", error);
    }
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
        users={users}
        roleDefinitions={roleDefinitions}
        canManageUsers={userIsAdmin(currentUser)}
        onOpenUserAdmin={() => setUserPanelOpen(true)}
        onQuoteCompanyChange={handleQuoteCompanyChange}
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

function SignedInApp({ currentUser, users = [], roleDefinitions, canManageUsers, onOpenUserAdmin, onQuoteCompanyChange, onSignOut }) {
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState(() => defaultResourceKeyForRole(roleDefinitions, currentUser?.role));
  const [linkedRollTagId, setLinkedRollTagId] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("rollTagId") || "" : ""
  ));
  const [previewRoleName, setPreviewRoleName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [formMode, setFormMode] = useState(null); // null | create | edit
  const [createDefaults, setCreateDefaults] = useState({});
  const [flexFilters, setFlexFilters] = useState(emptyFlexDieFilters);
  const [flexDieDetailOpen, setFlexDieDetailOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(initialOpenGroups);
  const [mobilePageMenuOpen, setMobilePageMenuOpen] = useState(false);
  const [mobilePageSearch, setMobilePageSearch] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [finishedInventoryOpen, setFinishedInventoryOpen] = useState(false);
  const [finishedMaterialOpen, setFinishedMaterialOpen] = useState(false);
  const [finishedMaterialStartSchedule, setFinishedMaterialStartSchedule] = useState(false);
  const [materialTypeOpen, setMaterialTypeOpen] = useState(false);
  const [materialTypeManagerOpen, setMaterialTypeManagerOpen] = useState(false);
  const [materialOwnerTab, setMaterialOwnerTab] = useState("tri_state");
  const [materialSupplierReturnKey, setMaterialSupplierReturnKey] = useState("");
  const [localInventoryRows, setLocalInventoryRows] = useState([]);
  const [localUsageEvents, setLocalUsageEvents] = useState([]);
  const [quoteJobTicketId, setQuoteJobTicketId] = useState("");
  const [quoteCustomerId, setQuoteCustomerId] = useState("");
  const [liveFootageTvMode, setLiveFootageTvMode] = useState(false);
  const [toolingWorkspaceForm, setToolingWorkspaceForm] = useState(null);
  const [toolingItemForm, setToolingItemForm] = useState(null);
  const [toolingItemOverrides, setToolingItemOverrides] = useState({});
  const canPreviewRoles = canManageUsers;
  const activePreviewRoleName = canPreviewRoles ? previewRoleName : "";
  const currentUserForView = useMemo(
    () => activePreviewRoleName ? { ...currentUser, role: activePreviewRoleName, previewRole: activePreviewRoleName } : currentUser,
    [activePreviewRoleName, currentUser]
  );
  const viewCanManageUsers = userIsAdmin(currentUserForView);
  const viewRoleName = currentUserForView?.role || currentUser?.role || "";

  useEffect(() => {
    if (!canPreviewRoles) {
      setPreviewRoleName("");
      return;
    }
    if (!previewRoleName) return;
    const roleExists = roleDefinitions.some((role) => role.name === previewRoleName);
    if (!roleExists) setPreviewRoleName("");
  }, [canPreviewRoles, previewRoleName, roleDefinitions]);

  const allowedResources = useMemo(
    () => visibleResourcesForRole(roleDefinitions, viewRoleName),
    [roleDefinitions, viewRoleName]
  );
  const activeKeyAllowed = resourceAvailableForRole(roleDefinitions, viewRoleName, activeKey);
  const resource = activeKeyAllowed
    ? resourceMap[activeKey]
    : allowedResources[0] ?? resourceMap["quote-calculator"] ?? resources[0];
  const singleResourceMode = allowedResources.length === 1 && !viewCanManageUsers;
  const showingStaticView = Boolean(resource.staticView);
  const showingJobTicketOverlay = resource.key === "job-tickets" && selected;
  const isMaterialTypePage = materialTypePageKeys.has(resource.key);
  const isMaterialFormPage = materialFormPageKeys.has(resource.key);
  const isToolingConfigPage = toolingConfigFormPageKeys.has(resource.key);
  const showingMaterialFormOverlay = Boolean(formMode && isMaterialFormPage);
  const showingScheduleFormOverlay = Boolean(formMode && resource.key === "production-schedule");
  const showingFlexDieFormOverlay = Boolean(formMode && resource.key === "flex-dies");
  const showingToolingConfigFormOverlay = Boolean(formMode && isToolingConfigPage);
  const showingPressFormOverlay = Boolean(formMode && resource.key === "presses");
  const showingToolingConfigDetailOverlay = Boolean(selected && !formMode && isToolingConfigPage && resource.key !== "recipes");
  const collectionQueryKey = ["collection", resource.key, resource.filters ?? {}, resource.searchMode === "flexDie" ? "" : search];
  const mobileMenuGroups = useMemo(() => {
    const query = mobilePageSearch.trim().toLowerCase();
    return resourceGroups
      .map((group) => ({
        ...group,
        items: navigationResourcesForGroup(allowedResources, group.key)
          .filter((item) => !query || `${item.label} ${item.singular} ${group.label}`.toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length);
  }, [allowedResources, mobilePageSearch]);

  useEffect(() => {
    if (activeKeyAllowed) return;
    setActiveKey(defaultResourceKeyForRole(roleDefinitions, viewRoleName));
  }, [activeKeyAllowed, viewRoleName, roleDefinitions]);

  useEffect(() => {
    if (!linkedRollTagId) return;
    if (resourceAvailableForRole(roleDefinitions, viewRoleName, "material-handling")) {
      setActiveKey("material-handling");
      setSelected(null);
      setFormMode(null);
    }
  }, [linkedRollTagId, roleDefinitions, viewRoleName]);

  const listQuery = useQuery({
    queryKey: collectionQueryKey,
    queryFn: async () => {
      try {
        return await fetchCollection(resource.endpoint, {
          ordering: resource.defaultOrdering,
          pageSize: resource.pageSize ?? (resource.searchMode === "flexDie" ? 500 : 250),
          filters: resource.filters ?? {},
          search: resource.searchMode === "flexDie" ? "" : search,
          fetchAll: resource.fetchAll ?? false,
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
      const materialUsages = usages.filter((row) => String(row.material) === String(selected.id));
      const productionRuns = (lookupQuery.data?.["coater-roll-tags"] ?? [])
        .filter((row) => row.source_schedule && row.status === "complete")
        .map((row) => ({
          id: `coater-run-${row.id}`,
          material: row.produced_material || row.scheduled_material,
          usage_type: "coater",
          quantity: row.length_feet || 0,
          unit: "lf",
          used_date: row.run_date || String(row.created_at || "").slice(0, 10),
          used_by: row.operator,
          reference: row.schedule_tag_number,
          coater_roll_tag_number: row.tag_number,
          production_schedule: row.schedule_id,
          inventory_serial: row.result_serial_number,
          notes: row.notes,
        }));
      return [...productionRuns, ...materialUsages];
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
  const materialMasterTypes = useMemo(
    () => [...(lookupQuery.data?.["material-master-types"] ?? [])].sort((a, b) => String(a.code || a.name || "").localeCompare(String(b.code || b.name || ""), undefined, { numeric: true })),
    [lookupQuery.data]
  );
  const selectedFlexDieHistory = useMemo(() => {
    if (!selected || resource.key !== "flex-dies") return [];
    return (lookupQuery.data?.history ?? []).filter((row) => String(row.flex_die) === String(selected.id));
  }, [lookupQuery.data, resource.key, selected]);
  const selectedFlexDieUsageRows = useMemo(() => {
    if (!selected || resource.key !== "flex-dies") return [];
    return (lookupQuery.data?.["recipe-tools"] ?? []).filter((row) => String(row.flex_die) === String(selected.id));
  }, [lookupQuery.data, resource.key, selected]);

  const canShowUsage = Boolean(selected) && (
    resource.key === "raw-materials" ||
    resource.key === "finished-inventory" ||
    resource.endpoint === "materials"
  );
  const canConsumeMaterial = Boolean(selected) && resource.key === "raw-materials";
  const materialSearchRows = useMemo(() => {
    if (resource.key !== "material-coated-stock") return [];
    return filterRows(rows, search);
  }, [rows, resource.key, search]);
  const materialTabCounts = useMemo(() => ({
    tri_state: materialSearchRows.filter(isTriStateMaterial).length,
    other: materialSearchRows.filter((row) => !isTriStateMaterial(row)).length,
  }), [materialSearchRows]);
  const visibleRows = useMemo(() => {
    if (resource.searchMode === "flexDie") return filterFlexDies(rows, flexFilters);
    const filtered = filterRows(rows, search);
    if (resource.key === "material-coated-stock") {
      return filtered.filter((row) => materialOwnerTab === "tri_state" ? isTriStateMaterial(row) : !isTriStateMaterial(row));
    }
    if (resource.key === "raw-materials") {
      return filtered.filter((row) => !["in_use", "depleted", "scrapped"].includes(row.status));
    }
    return filtered;
  }, [rows, search, flexFilters, resource.key, resource.searchMode, materialOwnerTab]);
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

  const toolingWorkspaceResource = useMemo(() => {
    if (!toolingWorkspaceForm) return null;
    const base = resourceMap[toolingWorkspaceForm.resourceKey];
    if (!base) return null;
    const hiddenWhenDefaulted = new Set();
    if (toolingWorkspaceForm.mode === "create" && toolingWorkspaceForm.resourceKey === "recipe-options" && toolingWorkspaceForm.defaults?.recipe) {
      hiddenWhenDefaulted.add("recipe");
    }
    if (toolingWorkspaceForm.mode === "create" && toolingWorkspaceForm.resourceKey === "recipe-tools" && toolingWorkspaceForm.defaults?.recipe_option) {
      hiddenWhenDefaulted.add("recipe_option");
    }
    if (toolingWorkspaceForm.mode === "create" && toolingWorkspaceForm.resourceKey === "print-plates" && toolingWorkspaceForm.defaults?.recipe) {
      hiddenWhenDefaulted.add("recipe");
    }
    if (toolingWorkspaceForm.mode === "create" && toolingWorkspaceForm.resourceKey === "print-stations" && toolingWorkspaceForm.defaults?.print_plate) {
      hiddenWhenDefaulted.add("print_plate");
    }
    return {
      ...base,
      fields: (base.fields ?? []).map((field) => hiddenWhenDefaulted.has(field.name) ? { ...field, hidden: true } : field),
    };
  }, [toolingWorkspaceForm]);

  const toolingWorkspaceLookups = useMemo(() => {
    const lookupData = lookupQuery.data ?? {};
    return {
      ...lookupData,
      recipes: mergeRows(lookupData.recipes ?? [], resource.key === "recipes" ? rows : []),
      "recipe-options": lookupData["recipe-options"] ?? [],
      "recipe-tools": lookupData["recipe-tools"] ?? [],
      "print-plates": lookupData["print-plates"] ?? [],
      "print-stations": lookupData["print-stations"] ?? [],
    };
  }, [lookupQuery.data, resource.key, rows]);

  const toolingItemFormResource = useMemo(() => {
    if (!toolingItemForm?.resourceKey) return null;
    return resourceMap[toolingItemForm.resourceKey] ?? null;
  }, [toolingItemForm]);

  const toolingItemLookups = useMemo(() => ({
    ...(lookupQuery.data ?? {}),
    ...toolingWorkspaceLookups,
  }), [lookupQuery.data, toolingWorkspaceLookups]);

  function lookupRow(relation, id) {
    if (id === null || id === undefined || id === "") return null;
    return (toolingWorkspaceLookups[relation] ?? []).find((row) => String(row.id) === String(id)) ?? null;
  }

  function cacheToolingItem(resourceKey, saved) {
    if (!resourceKey || !saved?.id) return;
    setToolingItemOverrides((current) => ({
      ...current,
      [`${resourceKey}:${saved.id}`]: saved,
    }));
    if (resource.key === resourceKey && String(selected?.id) === String(saved.id)) {
      setSelected(saved);
    }
  }

  function resolveToolingItemFromAssignment(tool) {
    const target = assignmentToolTarget(tool);
    if (!target.resourceKey) return null;
    const override = target.id ? toolingItemOverrides[`${target.resourceKey}:${target.id}`] : null;
    const lookupRecord = target.id
      ? (toolingItemLookups[target.resourceKey] ?? []).find((row) => String(row.id) === String(target.id))
      : null;
    const details = assignmentToolDetails(tool);
    const fallback = target.id ? { ...details, id: target.id } : details;
    return {
      resourceKey: target.resourceKey,
      record: override ?? lookupRecord ?? fallback,
      assignment: tool,
    };
  }

  function prepareSavePayload(payload) {
    const { __imageUploads, ...dataPayload } = payload ?? {};
    if (resource.key === "job-tickets") {
      return {
        ...dataPayload,
        ticket_number: generatedJobTicketNumber(dataPayload, formMode === "edit" ? selected : null),
        performed_by: currentUserForView?.name || "",
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
    return roleHasResourceAccess(roleDefinitions, viewRoleName, field.requiresResourceAccess);
  }

  const canEditJobTicket = roleHasResourceAccess(roleDefinitions, viewRoleName, "job-ticket-editor");
  const canScheduleFromJobTicket = roleHasResourceAccess(roleDefinitions, viewRoleName, "job-ticket-schedule");
  const canQuoteJobTicket = roleHasResourceAccess(roleDefinitions, viewRoleName, "quote-calculator");
  const canApproveJobTicketChanges = viewCanManageUsers
    || /manager|admin/i.test(viewRoleName)
    || roleHasResourceAccess(roleDefinitions, viewRoleName, "job-ticket-change-approval");
  const canManageQuoteMaterials = roleHasResourceAccess(roleDefinitions, viewRoleName, "quote-material-admin");
  const canApproveQuotes = roleHasResourceAccess(roleDefinitions, viewRoleName, "quote-approval");
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
          formData.append("performed_by", currentUserForView?.name || "");
          formData.append("change_description", upload.changeDescription || "");
          if (cleanPayload?.[`${upload.slot}_image_description`]) {
            formData.append("description", cleanPayload[`${upload.slot}_image_description`]);
          }
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
      if (saved && resource.key === "job-tickets") {
        queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      }
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      if (resource.key === "material-supplier-options" && materialSupplierReturnKey) {
        queryClient.invalidateQueries({ queryKey: ["collection", materialSupplierReturnKey] });
        setActiveKey(materialSupplierReturnKey);
        setSelected(null);
        setFormMode(null);
        setCreateDefaults({});
        setMaterialSupplierReturnKey("");
        return;
      }
      setSelected(saved ?? null);
      setFormMode(null);
      setCreateDefaults({});
    },
  });

  function prepareToolingWorkspacePayload(payload) {
    const next = { ...(payload ?? {}) };
    if (toolingWorkspaceForm?.resourceKey === "recipe-options") {
      const name = String(next.name || "").trim();
      if (!name) {
        const recipe = lookupRow("recipes", next.recipe);
        const press = lookupRow("presses", next.press);
        if (recipe && press) next.name = `${recipe.name || getRecordTitle(recipe)} - ${press.name || getRecordTitle(press)}`.slice(0, 150);
      }
    }
    return next;
  }

  const toolingWorkspaceMutation = useMutation({
    mutationFn: async (payload) => {
      const formState = toolingWorkspaceForm;
      const formResource = formState ? resourceMap[formState.resourceKey] : null;
      if (!formState || !formResource) throw new Error("No tooling form is open.");
      const cleanPayload = prepareToolingWorkspacePayload(payload);
      if (formState.mode === "edit" && formState.record?.id) {
        return updateRecord(formResource.endpoint, formState.record.id, cleanPayload);
      }
      return createRecord(formResource.endpoint, cleanPayload);
    },
    onSuccess: (saved) => {
      const formResourceKey = toolingWorkspaceForm?.resourceKey;
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      if (formResourceKey) queryClient.invalidateQueries({ queryKey: ["collection", formResourceKey] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      if (formResourceKey === resource.key) setSelected(saved ?? null);
      setToolingWorkspaceForm(null);
    },
  });

  const toolingItemStatusMutation = useMutation({
    mutationFn: async ({ resourceKey, record, payload }) => {
      const targetResource = resourceMap[resourceKey];
      if (!targetResource || !record?.id) throw new Error("Could not find this tooling record.");
      return updateRecord(targetResource.endpoint, record.id, payload);
    },
    onSuccess: (saved, variables) => {
      cacheToolingItem(variables.resourceKey, saved);
      queryClient.invalidateQueries({ queryKey: ["collection", variables.resourceKey] });
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const toolingItemFormMutation = useMutation({
    mutationFn: async (payload) => {
      const formState = toolingItemForm;
      const targetResource = formState ? resourceMap[formState.resourceKey] : null;
      if (!formState || !targetResource || !formState.record?.id) throw new Error("No tooling item is open.");
      const { __imageUploads, ...cleanPayload } = payload ?? {};
      return updateRecord(targetResource.endpoint, formState.record.id, cleanPayload);
    },
    onSuccess: (saved) => {
      const formResourceKey = toolingItemForm?.resourceKey;
      cacheToolingItem(formResourceKey, saved);
      if (formResourceKey) queryClient.invalidateQueries({ queryKey: ["collection", formResourceKey] });
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setToolingItemForm(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRecord(resource.endpoint, selected.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(null);
      setFormMode(null);
      setFlexDieDetailOpen(false);
      setCreateDefaults({});
    },
  });

  async function fallbackRollAction(action, payload, rollOverride = selected) {
    const roll = rollOverride;
    if (!roll?.id) throw new Error("No roll selected.");
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

  async function resolveScannedLocationId(value, existingId = "") {
    if (existingId) return existingId;
    const text = String(value ?? "").trim();
    if (!text) return null;
    const matched = findScannedLocation(lookupQuery.data?.locations ?? [], text);
    if (matched?.id) return matched.id;
    const created = await createRecord("locations", {
      name: text.slice(0, 100),
      code: locationCodeFromScan(text),
      location_type: "position",
      is_active: true,
      notes: "Created from mobile roll scanner.",
    });
    return created.id;
  }

  const scanRollMutation = useMutation({
    mutationFn: async ({ action, roll, payload }) => {
      if (!roll?.id) throw new Error("Scan a valid roll before saving.");
      const locationId = action === "check-out"
        ? null
        : await resolveScannedLocationId(payload.location_text, payload.location);
      if (action === "check-in") {
        return fallbackRollAction("return-roll", {
          ...payload,
          location: locationId,
          remaining_quantity: payload.remaining_quantity ?? currentInventoryQuantity(roll),
          notes: payload.notes || `Scanner check-in at ${payload.location_text || "inventory"}.`,
        }, roll);
      }
      if (action === "check-out") {
        return fallbackRollAction("check-out", {
          ...payload,
          used_for: "Scanner checkout",
          notes: payload.notes || "Scanner checkout.",
        }, roll);
      }
      const held = await fallbackRollAction("status", {
        ...payload,
        status: "on_hold",
        reference: "Scanner hold / QC",
        qc_issue: true,
        qc_notes: payload.notes,
        notes: payload.notes || "Scanner hold / QC.",
      }, roll);
      if (locationId) {
        return updateRecord("raw-materials", held.id, { location: locationId });
      }
      return held;
    },
    onSuccess: (saved) => {
      if (saved) {
        setLocalInventoryRows((prev) => mergeRows([saved], prev));
        queryClient.setQueryData(collectionQueryKey, (current) => {
          if (!current?.results) return current;
          const exists = current.results.some((row) => String(row.id) === String(saved.id));
          const results = exists
            ? current.results.map((row) => String(row.id) === String(saved.id) ? saved : row)
            : [saved, ...current.results];
          return { ...current, results, count: Math.max(current.count ?? 0, results.length) };
        });
        setSelected(saved);
      }
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const finishedInventorySendMutation = useMutation({
    mutationFn: ({ id, payload }) => postRecordAction("finished-inventory", id, "send-out", payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["collection", "finished-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? selected);
    },
  });

  const finishedInventoryReceiveMutation = useMutation({
    mutationFn: (payload) => createRecord("finished-inventory/receive-order", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "finished-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-order-events"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const finishedScheduleMutation = useMutation({
    mutationFn: async ({ material, schedule }) => {
      const required = [
        ["face_material", "allowed_face_materials", "Face Type"],
        ["liner_material", "allowed_liner_materials", "Liner Type"],
        ["adhesive_material", "allowed_adhesive_materials", "Adhesive Type"],
        ["silicone_material", "allowed_silicone_materials", "Silicone Type"],
      ];
      const missing = required
        .filter(([preferredKey, allowedKey]) => !firstMaterialComponentId(material, preferredKey, allowedKey))
        .map(([, , label]) => label);
      if (missing.length) {
        throw new Error(`Add these component types before scheduling: ${missing.join(", ")}`);
      }
      const liner = firstMaterialComponentId(material, "liner_material", "allowed_liner_materials");
      const face = firstMaterialComponentId(material, "face_material", "allowed_face_materials");
      const adhesive = firstMaterialComponentId(material, "adhesive_material", "allowed_adhesive_materials");
      const silicone = firstMaterialComponentId(material, "silicone_material", "allowed_silicone_materials");
      const coating = firstMaterialComponentId(material, "coating_material", "allowed_coating_materials");

      return createRecord("coater-roll-tags", {
        name: material.name || material.material_family || material.code,
        status: "scheduled",
        print_status: "not_printed",
        scheduled_by: currentUserForView?.name || "",
        scheduled_material: material.id,
        produced_material: material.id,
        liner,
        face,
        adhesive,
        silicone,
        coating,
        result_code: material.code,
        length_feet: schedule.feet,
        run_date: schedule.run_date || null,
        cut_description: schedule.cut_description,
        operator_notes: schedule.operator_notes,
        notes: [
          schedule.cut_description ? `Cut: ${schedule.cut_description}` : "",
          schedule.operator_notes ? `Operator note: ${schedule.operator_notes}` : "",
        ].filter(Boolean).join("\n"),
        press: schedule.press ? Number(schedule.press) : null,
        log_inventory: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const materialTypeSaveMutation = useMutation({
    mutationFn: ({ mode, record, payload }) => {
      const cleanPayload = {
        ...payload,
        code: String(payload.code || "").trim().toUpperCase(),
        name: String(payload.name || "").trim(),
      };
      if (mode === "edit" && record?.id) return updateRecord("material-master-types", record.id, cleanPayload);
      return createRecord("material-master-types", cleanPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "material-master-types"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const materialTypeDeleteMutation = useMutation({
    mutationFn: (row) => deleteRecord("material-master-types", row.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "material-master-types"] });
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
        ticket_number: generatedJobTicketNumber(payload, selected),
        performed_by: currentUserForView?.name || "",
      };
      delete cleanPayload.__imageUploads;
      let saved = await updateRecord("job-tickets", selected.id, cleanPayload);
      for (const upload of imageUploads) {
        if (!upload.file || !upload.slot) continue;
        const formData = new FormData();
        formData.append("image", upload.file);
        formData.append("name", autoImageName(upload.slot, saved || cleanPayload));
        formData.append("performed_by", currentUserForView?.name || "");
        formData.append("change_description", upload.changeDescription || "");
        if (cleanPayload?.[`${upload.slot}_image_description`]) {
          formData.append("description", cleanPayload[`${upload.slot}_image_description`]);
        }
        saved = await uploadRecordAction("job-tickets", saved.id, `images/${upload.slot}`, formData);
      }
      return saved;
    },
    onSuccess: async (saved) => {
      queryClient.invalidateQueries({ queryKey: ["collection", "job-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? selected);
    },
  });

  const jobTicketChangeApprovalMutation = useMutation({
    mutationFn: ({ event, status, pendingPayload = null }) => {
      const action = status === "approved" ? "approve" : status === "retracted" ? "retract" : "reject";
      return postRecordAction(
        "job-ticket-events",
        event.id,
        action,
        {
          performed_by: currentUserForView?.name || "",
          role: currentUserForView?.role || "",
          ...(pendingPayload && Object.keys(pendingPayload).length ? { pending_payload: pendingPayload } : {}),
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const jobTicketPrintMutation = useMutation({
    mutationFn: async (payload) => {
      if (!selected?.id) throw new Error("No job ticket selected.");
      return postRecordAction("job-tickets", selected.id, "queue-print-label", {
        ...payload,
        performed_by: currentUserForView?.name || "",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const jobTicketScheduleCreateMutation = useMutation({
    mutationFn: (payload) => createRecord("production-schedule", {
      ...payload,
      job_ticket: selected.id,
      customer: selected.customer || null,
      status: "unscheduled",
      scheduled_by: currentUserForView.name,
      last_updated_by: currentUserForView.name,
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
      requested_by: currentUserForView.name,
      notes: note,
    });
    await refreshFlexDie(saved);
  }

  async function markFlexDieOrdered(dieOrId, note = "") {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "mark-ordered", {
      performed_by: currentUserForView.name,
      notes: note,
    });
    await refreshFlexDie(saved);
  }

  async function receiveFlexDie(dieOrId, { serialNumber = "", quantity = 1, notes = "" } = {}) {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "receive-die", {
      received_by: currentUserForView.name,
      serial_number: serialNumber,
      quantity,
      notes,
    });
    await refreshFlexDie(saved);
  }

  async function adjustFlexDieCount(dieOrId, { activeCount = 0, notes = "" } = {}) {
    const id = typeof dieOrId === "object" ? dieOrId.id : dieOrId;
    const saved = await postRecordAction("flex-dies", id, "adjust-count", {
      performed_by: currentUserForView.name,
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
    setFlexDieDetailOpen(false);
    setCreateDefaults({});
    setMaterialSupplierReturnKey("");
    setUsageOpen(false);
    setRollOpen(false);
    setFinishedMaterialOpen(false);
    setFinishedMaterialStartSchedule(false);
    setMaterialTypeManagerOpen(false);
    setToolingWorkspaceForm(null);
    setSearch("");
    setMobilePageMenuOpen(false);
    setMobilePageSearch("");
  }

  function closeRecordForm() {
    if (resource.key === "material-supplier-options" && materialSupplierReturnKey) {
      setActiveKey(materialSupplierReturnKey);
      setMaterialSupplierReturnKey("");
      setSelected(null);
    }
    setFormMode(null);
    setCreateDefaults({});
  }

  function openLiveFootageFromSidebar() {
    setLiveFootageTvMode(false);
    switchResource("live-footage");
  }

  function toggleGroup(key) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function editRecord(row) {
    setSelected(row);
    setFormMode("edit");
  }

  function openMaterialDetail(row, startSchedule = false) {
    setSelected(row);
    setFormMode(null);
    setFinishedMaterialStartSchedule(Boolean(startSchedule && isTriStateMaterial(row)));
    setFinishedMaterialOpen(true);
  }

  function openFlexDieFolder(row) {
    setSelected(row);
    setFormMode(null);
    setFlexDieDetailOpen(true);
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
        setFlexDieDetailOpen(false);
      })
      .catch((error) => {
        window.alert(`Could not delete ${title}: ${error.message}`);
      });
  }

  function openPressOptionForm(recipe) {
    setSelected(recipe);
    setFormMode(null);
    setToolingWorkspaceForm({
      resourceKey: "recipe-options",
      mode: "create",
      record: null,
      defaults: {
        recipe: recipe.id,
        name: "",
        setup_type: "standard",
        is_preferred: false,
        is_approved: true,
        is_active: true,
        requires_undercut: false,
        requires_manual_review: false,
      },
    });
  }

  function editPressOption(option) {
    setFormMode(null);
    setToolingWorkspaceForm({
      resourceKey: "recipe-options",
      mode: "edit",
      record: option,
      defaults: {},
    });
  }

  function toolingDefaultsFor(option, requestedGroup = "") {
    const group = String(requestedGroup || "").toUpperCase();
    if (["MAG", "MAG1", "MAIN_MAG"].includes(group)) return { tool_type: "mag", tool_role: "top" };
    if (["DIE", "DIE1", "MAIN_DIE"].includes(group)) return { tool_type: "flex_die", tool_role: "top" };
    if (["MAG2", "UNDERCUT_MAG"].includes(group)) return { tool_type: "mag", tool_role: "undercut" };
    if (["DIE2", "UNDERCUT_DIE"].includes(group)) return { tool_type: "flex_die", tool_role: "undercut" };
    if (group === "PERF") return { tool_type: "perf_cylinder", tool_role: "perf" };
    return { tool_type: "flex_die", tool_role: "top" };
  }

  function openToolAssignmentForm(option, requestedGroup = "") {
    const defaults = toolingDefaultsFor(option, requestedGroup);
    setFormMode(null);
    setToolingWorkspaceForm({
      resourceKey: "recipe-tools",
      mode: "create",
      record: null,
      defaults: {
        recipe_option: option.id,
        station_number: "",
        is_required: true,
        notes: "",
        ...defaults,
      },
    });
  }

  function editToolAssignment(tool) {
    setFormMode(null);
    setToolingWorkspaceForm({
      resourceKey: "recipe-tools",
      mode: "edit",
      record: tool,
      defaults: {},
    });
  }

  async function deleteToolingWorkspaceRecord(resourceKey, row) {
    const targetResource = resourceMap[resourceKey];
    if (!targetResource || !row?.id) return;
    const title = getRecordTitle(row);
    if (!window.confirm(`Delete ${title}? This cannot be undone.`)) return;
    try {
      await deleteRecord(targetResource.endpoint, row.id);
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["collection", resourceKey] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    } catch (error) {
      window.alert(`Could not delete ${title}: ${error.message}`);
    }
  }

  function openToolingItemEditor(resourceKey, record) {
    if (!resourceKey || !record?.id) return;
    setToolingItemForm({ resourceKey, record });
  }

  function renderToolingItemDetail(tool, onClose) {
    const target = resolveToolingItemFromAssignment(tool);
    if (!target?.record) return null;
    return (
      <ToolingItemDetailPanel
        item={target.record}
        resourceKey={target.resourceKey}
        assignment={target.assignment}
        onClose={onClose}
        onEdit={(record) => openToolingItemEditor(target.resourceKey, record)}
        onEditAssignment={editToolAssignment}
        onUpdateStatus={(payload) => toolingItemStatusMutation.mutateAsync({
          resourceKey: target.resourceKey,
          record: target.record,
          payload,
        })}
        updating={toolingItemStatusMutation.isPending}
      />
    );
  }

  const selectedToolingItem = selected && toolingItemPageKeys.has(resource.key)
    ? (toolingItemOverrides[`${resource.key}:${selected.id}`] ?? selected)
    : selected;

  const liveFootageFullView = resource.viewMode === "liveFootage" && liveFootageTvMode;

  return (
    <main className={`app-shell ${singleResourceMode ? "single-resource-app" : ""} ${liveFootageFullView ? "live-footage-tv-shell" : ""}`}>
      <section className="mobile-shell-bar compact-card">
        <div>
          <p className="eyebrow">Tri-State Media</p>
          <strong>{resource.label}</strong>
          <span>{currentUser.name} / {activePreviewRoleName ? `Viewing ${activePreviewRoleName}` : currentUser.role}</span>
        </div>
        <AccountMenu
          currentUser={currentUser}
          canManageUsers={canManageUsers}
          roleDefinitions={roleDefinitions}
          previewRoleName={activePreviewRoleName}
          onPreviewRoleChange={setPreviewRoleName}
          onOpenUserAdmin={onOpenUserAdmin}
          onQuoteCompanyChange={onQuoteCompanyChange}
          onSignOut={onSignOut}
        />
        <MessagesCenter currentUser={currentUser} users={users} compact showToast={false} />
        {!singleResourceMode && (
          <button className="mobile-page-menu-trigger" type="button" onClick={() => setMobilePageMenuOpen(true)}>
            <Menu size={18} />
            <span><small>Pages</small><strong>Browse all screens</strong></span>
            <ChevronRight size={17} />
          </button>
        )}
      </section>

      {mobilePageMenuOpen && (
        <section className="mobile-page-menu-overlay" role="dialog" aria-modal="true" aria-label="Choose a page">
          <div className="mobile-page-menu-window">
            <header>
              <div>
                <span>Navigation</span>
                <strong>Choose a page</strong>
              </div>
              <button className="ghost-btn" type="button" onClick={() => { setMobilePageMenuOpen(false); setMobilePageSearch(""); }}>
                <X size={17} /> Close
              </button>
            </header>
            <label className="mobile-page-search">
              <Search size={17} />
              <input autoFocus value={mobilePageSearch} onChange={(event) => setMobilePageSearch(event.target.value)} placeholder="Search pages..." />
            </label>
            <div className="mobile-page-groups">
              {mobileMenuGroups.map((group) => (
                <section className="mobile-page-group" key={group.key}>
                  <header><strong>{group.label}</strong><span>{group.items.length}</span></header>
                  <div>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button className={item.key === resource.key ? "active" : ""} type="button" key={item.key} onClick={() => switchResource(item.key)} style={{ "--accent": item.accent }}>
                          <span><Icon size={18} /></span>
                          <strong>{item.label}</strong>
                          {item.key === resource.key ? <b>Current</b> : <ChevronRight size={16} />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!mobileMenuGroups.length && <p className="mobile-page-empty">No pages match that search.</p>}
            </div>
          </div>
        </section>
      )}

      {!liveFootageFullView && <aside className="sidebar">
        <PressSpeedSidebarWidget onOpenLiveFootage={openLiveFootageFromSidebar} />

        {topLevelGroups.map((group) => {
          const childGroups = resourceGroups.filter((item) => item.parent === group.key);
          const groupResources = navigationResourcesForGroup(allowedResources, group.key);
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
                    const childResources = navigationResourcesForGroup(allowedResources, child.key);
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
      </aside>}

      <section className="work-area">
        {!liveFootageFullView && <header className="topbar compact-card">
          <div>
            <p className="eyebrow">{resource.singular}</p>
            <h2>{resource.label}</h2>
            <p>{resource.tagline}</p>
          </div>
          <div className="top-actions">
            {!showingStaticView && <button className="ghost-btn" type="button" onClick={() => listQuery.refetch()}><RefreshCcw size={15} /> Refresh</button>}
            {resource.key === "material-coated-stock" && !showingStaticView && (
              <button className="ghost-btn" type="button" onClick={() => setMaterialTypeManagerOpen(true)}>Material Types</button>
            )}
            {!resource.disableCreate && !showingStaticView && (
              <button className="primary-btn" type="button" onClick={() => { setSelected(null); setFlexDieDetailOpen(false); setCreateDefaults(resource.key === "material-coated-stock" && materialOwnerTab === "tri_state" ? { company: "Tri-State Media" } : {}); setFormMode("create"); }}><Plus size={16} /> {resource.key === "raw-materials" ? "Add Inventory Roll" : resource.key === "material-coated-stock" ? "Add Material" : "Add"}</button>
            )}
            <MessagesCenter currentUser={currentUser} users={users} />
            <AccountMenu
              currentUser={currentUser}
              canManageUsers={canManageUsers}
              roleDefinitions={roleDefinitions}
              previewRoleName={activePreviewRoleName}
              onPreviewRoleChange={setPreviewRoleName}
              onOpenUserAdmin={onOpenUserAdmin}
              onQuoteCompanyChange={onQuoteCompanyChange}
              onSignOut={onSignOut}
            />
          </div>
        </header>}

        {saveMutation.error && <div className="error-box">{saveMutation.error.message}</div>}
        {finishedScheduleMutation.error && <div className="error-box">{finishedScheduleMutation.error.message}</div>}
        {scheduleUpdateMutation.error && <div className="error-box">{scheduleUpdateMutation.error.message}</div>}
        {scheduleRemoveMutation.error && <div className="error-box">{scheduleRemoveMutation.error.message}</div>}
        {jobTicketEditMutation.error && <div className="error-box">{jobTicketEditMutation.error.message}</div>}
        {jobTicketChangeApprovalMutation.error && <div className="error-box">{jobTicketChangeApprovalMutation.error.message}</div>}
        {jobTicketPrintMutation.error && <div className="error-box">{jobTicketPrintMutation.error.message}</div>}
        {jobTicketScheduleCreateMutation.error && <div className="error-box">{jobTicketScheduleCreateMutation.error.message}</div>}
        {materialTypeSaveMutation.error && <div className="error-box">{materialTypeSaveMutation.error.message}</div>}
        {materialTypeDeleteMutation.error && <div className="error-box">{materialTypeDeleteMutation.error.message}</div>}
        {toolingWorkspaceMutation.error && <div className="error-box">{toolingWorkspaceMutation.error.message}</div>}
        {toolingItemStatusMutation.error && <div className="error-box">{toolingItemStatusMutation.error.message}</div>}
        {toolingItemFormMutation.error && <div className="error-box">{toolingItemFormMutation.error.message}</div>}
        {deleteMutation.error && <div className="error-box">{deleteMutation.error.message}</div>}
        {rollActionMutation.error && <div className="error-box">{rollActionMutation.error.message}</div>}
        {finishedInventorySendMutation.error && <div className="error-box">{finishedInventorySendMutation.error.message}</div>}
        {listQuery.error && <div className="error-box">Could not load {resource.label}: {listQuery.error.message}</div>}
        {resource.key === "material-usages" && listQuery.data?.raw?.missingEndpoint && (
          <div className="error-box">Material Usage needs the latest backend migration/restart before it can load saved usage records.</div>
        )}
        {lookupQuery.error && <div className="error-box">Could not load lookup data: {lookupQuery.error.message}</div>}

        {resource.viewMode === "quoteCalculator" ? (
          <QuotePricingTool
            currentUser={currentUserForView}
            initialJobTicketId={quoteJobTicketId}
            initialCustomerId={quoteCustomerId}
            canManageQuoteMaterials={canManageQuoteMaterials}
            canApproveQuotes={canApproveQuotes}
          />
        ) : resource.viewMode === "liveFootage" ? (
          <LiveFootageView tvMode={liveFootageTvMode} onTvModeChange={setLiveFootageTvMode} />
        ) : resource.viewMode === "footageReports" ? (
          <FootageReportsView currentUser={currentUserForView} />
        ) : resource.viewMode === "coaterOperator" ? (
          <CoaterOperatorView
            currentUser={currentUserForView}
            linkedRollTagId={linkedRollTagId}
            onLinkedRollTagChange={(rollTagId) => {
              setLinkedRollTagId(String(rollTagId));
              const url = new URL(window.location.href);
              url.searchParams.set("rollTagId", String(rollTagId));
              window.history.replaceState({}, "", url);
            }}
            onLinkedRollTagClose={() => {
              setLinkedRollTagId("");
              const url = new URL(window.location.href);
              url.searchParams.delete("rollTagId");
              window.history.replaceState({}, "", url);
            }}
          />
        ) : resource.viewMode === "materialHandling" ? (
          <MaterialHandlingView
            currentUser={currentUserForView}
            linkedRollTagId={linkedRollTagId}
            onLinkedRollTagChange={(rollTagId) => {
              setLinkedRollTagId(String(rollTagId));
              const url = new URL(window.location.href);
              url.searchParams.set("rollTagId", String(rollTagId));
              window.history.replaceState({}, "", url);
            }}
          />
        ) : resource.viewMode === "dataImport" ? (
          <DataImportTool currentUser={currentUserForView} />
        ) : (
          <>
            {resource.searchMode === "flexDie" ? (
              <FlexDieSearch
                filters={flexFilters}
                setFilters={setFlexFilters}
                liners={lookupQuery.data?.materials ?? []}
                resultCount={visibleRows.length}
                totalCount={rows.length}
              />
            ) : (
              <section className="search-line compact-card">
                <Search size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${resource.label.toLowerCase()}...`} />
                <span>{visibleRows.length} / {rows.length}</span>
              </section>
            )}

            {resource.key === "material-coated-stock" && (
              <section className="material-setup-panel compact-card">
                <article>
                  <strong>Material Types</strong>
                  <span>Broad families used for quoting and job matching.</span>
                  <em>{materialMasterTypes.slice(0, 4).map((row) => row.code || row.name).filter(Boolean).join(" / ") || "PM / PM-PET / PET"}</em>
                </article>
                <article>
                  <strong>Materials</strong>
                  <span>Specific coated constructions with face, liner, adhesive, and silicone choices.</span>
                  <em>{visibleRows.length} active record{visibleRows.length === 1 ? "" : "s"}</em>
                </article>
                <div>
                  <button className="ghost-btn" type="button" onClick={() => setMaterialTypeManagerOpen(true)}>Manage Material Types</button>
                  <button className="primary-btn" type="button" onClick={() => { setSelected(null); setCreateDefaults(materialOwnerTab === "tri_state" ? { company: "Tri-State Media" } : {}); setFormMode("create"); }}>
                    <Plus size={15} /> Add Material
                  </button>
                </div>
                <nav className="material-owner-tabs" aria-label="Material ownership filter">
                  {materialOwnerTabs.map((tab) => (
                    <button
                      className={materialOwnerTab === tab.key ? "active" : ""}
                      type="button"
                      key={tab.key}
                      onClick={() => {
                        setMaterialOwnerTab(tab.key);
                        setSelected(null);
                        setFinishedMaterialOpen(false);
                        setFinishedMaterialStartSchedule(false);
                      }}
                    >
                      <span>{tab.label}</span>
                      <strong>{materialTabCounts[tab.key] ?? 0}</strong>
                    </button>
                  ))}
                </nav>
              </section>
            )}

            {formMode && !showingMaterialFormOverlay && !showingScheduleFormOverlay && !showingFlexDieFormOverlay && !showingToolingConfigFormOverlay && !showingPressFormOverlay && !(showingJobTicketOverlay && formMode === "edit") && (
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={recordFormLookups}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            )}

            <section className={`content-grid ${["customers", "job-tickets", "production-schedule", "material-coated-stock", "suppliers", "presses", "flex-dies"].includes(resource.key) || isMaterialTypePage || isToolingConfigPage ? "wide-list" : ""}`}>
              <div className="list-panel compact-card">
                <div className="panel-head thin">
                  <div>
                    <p className="eyebrow">Records</p>
                    <h2>{listQuery.isLoading ? "Loading..." : `${visibleRows.length} shown`}</h2>
                  </div>
                </div>

                {resource.viewMode === "customers" ? (
                  <CustomerWorkspace
                    rows={visibleRows}
                    selected={selected}
                    quotes={lookupQuery.data?.["quote-records"] ?? []}
                    orders={lookupQuery.data?.["customer-orders"] ?? []}
                    jobTickets={lookupQuery.data?.["job-tickets"] ?? []}
                    loading={lookupQuery.isLoading && Boolean(selected)}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={confirmDeleteRecord}
                    onQuote={(customer) => {
                      setQuoteCustomerId(String(customer.id));
                      setQuoteJobTicketId("");
                      setActiveKey("quote-calculator");
                      setSelected(null);
                      setFormMode(null);
                      setSearch("");
                    }}
                  />
                ) : resource.viewMode === "productionSchedule" ? (
                  <ProductionScheduleView
                    rows={tableRows}
                    selected={selected}
                    presses={lookupQuery.data?.presses ?? []}
                    currentUser={currentUserForView}
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
                      payload: { reason, performed_by: currentUserForView.name },
                    })}
                    onUseMaterial={(row) => {
                      const context = {
                        scheduleId: row.id,
                        jobTicketId: row.job_ticket,
                        label: [row.job_ticket_number || row.job_name || `Schedule ${row.id}`, row.press_name].filter(Boolean).join(" / "),
                      };
                      window.localStorage.setItem(activeJobKey, JSON.stringify(context));
                      setLinkedRollTagId("");
                      const url = new URL(window.location.href);
                      url.searchParams.delete("rollTagId");
                      window.history.replaceState({}, "", url);
                      switchResource("material-handling");
                    }}
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
                  <>
                    <RollScanStation
                      rows={rows}
                      locations={lookupQuery.data?.locations ?? []}
                      submitting={scanRollMutation.isPending}
                      error={scanRollMutation.error?.message}
                      currentUser={currentUserForView}
                      onSubmit={(payload) => scanRollMutation.mutate(payload)}
                      onSelect={(row) => { setSelected(row); setFormMode(null); setUsageOpen(false); setRollOpen(true); }}
                    />
                    <MaterialInventoryView
                      rows={visibleRows}
                      selectedId={selected?.id}
                      onSelect={(row) => { setSelected(row); setFormMode(null); setUsageOpen(false); setRollOpen(true); }}
                    />
                  </>
                ) : resource.viewMode === "finishedInventory" ? (
                  <FinishedInventoryView
                    rows={visibleRows}
                    selectedId={selected?.id}
                    onSelect={(row) => {
                      setSelected(row);
                      setFormMode(null);
                      setUsageOpen(false);
                      setFinishedInventoryOpen(true);
                    }}
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
                    recipeOptions={lookupQuery.data?.["recipe-options"] ?? []}
                    recipeTools={lookupQuery.data?.["recipe-tools"] ?? []}
                    selectedId={selected?.id}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={confirmDeleteRecord}
                    onAddPressOption={openPressOptionForm}
                    onEditPressOption={editPressOption}
                    onDeletePressOption={(option) => deleteToolingWorkspaceRecord("recipe-options", option)}
                    onAddTooling={openToolAssignmentForm}
                    onEditTooling={editToolAssignment}
                    onDeleteTooling={(tool) => deleteToolingWorkspaceRecord("recipe-tools", tool)}
                    renderToolDetail={renderToolingItemDetail}
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
                ) : resource.key === "suppliers" ? (
                  <SupplierTable
                    rows={visibleRows}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={viewCanManageUsers ? confirmDeleteRecord : undefined}
                  />
                ) : resource.key === "presses" ? (
                  <PressTable
                    rows={visibleRows}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={viewCanManageUsers ? confirmDeleteRecord : undefined}
                  />
                ) : resource.key === "flex-dies" ? (
                  <FlexDieTable
                    rows={tableRows}
                    selectedId={selected?.id}
                    onOpen={openFlexDieFolder}
                    onEdit={(row) => { setSelected(row); setFlexDieDetailOpen(false); setFormMode("edit"); }}
                    onDelete={confirmDeleteRecord}
                  />
                ) : isMaterialTypePage ? (
                  <MaterialTypeTable
                    rows={visibleRows}
                    options={lookupQuery.data?.["material-supplier-options"] ?? []}
                    selectedId={selected?.id}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={viewCanManageUsers ? confirmDeleteRecord : undefined}
                    onAddSupplierOption={(material) => {
                      setMaterialTypeOpen(false);
                      setMaterialSupplierReturnKey(resource.key);
                      setActiveKey("material-supplier-options");
                      setSelected(null);
                      setSearch("");
                      setCreateDefaults({
                        material: material.id,
                        option_name: material.name || "",
                        is_active: true,
                      });
                      setFormMode("create");
                    }}
                    onEditSupplierOption={(option) => {
                      setMaterialTypeOpen(false);
                      setMaterialSupplierReturnKey(resource.key);
                      setActiveKey("material-supplier-options");
                      setSelected(option);
                      setSearch("");
                      setCreateDefaults({});
                      setFormMode("edit");
                    }}
                  />
                ) : (
                  <ResourceTable
                    resource={resource}
                    rows={tableRows}
                    selectedId={selected?.id}
                    onSelect={(row) => {
                      if (resource.key === "material-coated-stock") {
                        openMaterialDetail(row, false);
                        return;
                      }
                      setSelected(row);
                      setFormMode(null);
                      if (isMaterialTypePage) setMaterialTypeOpen(true);
                    }}
                    rowActions={resource.key === "material-coated-stock" && materialOwnerTab === "tri_state"
                      ? [{ label: "Schedule Material", className: "primary-btn xs", onClick: (row) => openMaterialDetail(row, true) }]
                      : []}
                  />
                )}
              </div>

              {resource.key !== "customers" && resource.key !== "job-tickets" && resource.key !== "production-schedule" && resource.key !== "raw-materials" && resource.key !== "finished-inventory" && resource.key !== "material-coated-stock" && resource.key !== "suppliers" && resource.key !== "presses" && resource.key !== "flex-dies" && !isMaterialTypePage && !isToolingConfigPage && (
                <aside className={resource.key === "flex-dies" && selected ? "flex-die-detail-shell" : toolingItemPageKeys.has(resource.key) && selected ? "tooling-item-detail-shell" : "detail-panel compact-card"}>
                  {selected ? (
                  resource.key === "flex-dies" ? (
                    <FlexDieDetailPanel
                      die={selectedToolingItem}
                      historyRows={selectedFlexDieHistory}
                      usageRows={selectedFlexDieUsageRows}
                      onEdit={() => setFormMode("edit")}
                      onDelete={() => deleteMutation.mutate()}
                      onRequestReorder={(note) => requestFlexDieReorder(selected, note)}
                      onMarkOrdered={(note) => markFlexDieOrdered(selected, note)}
                      onReceiveDie={(payload) => receiveFlexDie(selected, payload)}
                      onAdjustCount={(payload) => adjustFlexDieCount(selected, payload)}
                      onDeleteDieline={() => deleteFlexDieDieline(selected)}
                      onUpdateStatus={(payload) => toolingItemStatusMutation.mutateAsync({
                        resourceKey: "flex-dies",
                        record: selectedToolingItem,
                        payload,
                      })}
                    />
                  ) : toolingItemPageKeys.has(resource.key) ? (
                    <ToolingItemDetailPanel
                      item={selectedToolingItem}
                      resourceKey={resource.key}
                      onEdit={(record) => openToolingItemEditor(resource.key, record)}
                      onUpdateStatus={(payload) => toolingItemStatusMutation.mutateAsync({
                        resourceKey: resource.key,
                        record: selectedToolingItem,
                        payload,
                      })}
                      updating={toolingItemStatusMutation.isPending}
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
                chartsLoading={lookupQuery.isLoading && !lookupQuery.data}
                inventoryReceiving={finishedInventoryReceiveMutation.isPending}
                inventoryReceiveError={finishedInventoryReceiveMutation.error?.message}
                canEdit={canEditJobTicket}
                canSchedule={canScheduleFromJobTicket}
                canQuote={canQuoteJobTicket}
                canApproveChanges={canApproveJobTicketChanges}
                currentUserName={currentUserForView?.name || currentUser?.name || ""}
                approvingChangeId={jobTicketChangeApprovalMutation.isPending ? jobTicketChangeApprovalMutation.variables?.event?.id || "" : ""}
                onApproveChange={(event, status, pendingPayload) => jobTicketChangeApprovalMutation.mutate({ event, status, pendingPayload })}
                printingLabel={jobTicketPrintMutation.isPending}
                printLabelError={jobTicketPrintMutation.error?.message || ""}
                onQueuePrintLabel={(payload) => jobTicketPrintMutation.mutateAsync(payload)}
                onQuoteJob={() => {
                  setQuoteJobTicketId(String(selected.id));
                  setQuoteCustomerId("");
                  setActiveKey("quote-calculator");
                  setSelected(null);
                  setFormMode(null);
                  setSearch("");
                }}
                onReceiveFinishedInventory={(payload) => finishedInventoryReceiveMutation.mutateAsync(payload)}
                editorFields={resource.fields ?? []}
                renderEditorForm={({ onCancel, onFormChange }) => (
                  <RecordForm
                    resource={resource}
                    record={selected}
                    lookups={recordFormLookups}
                    submitting={jobTicketEditMutation.isPending}
                    onSubmit={(payload) => jobTicketEditMutation.mutate(payload)}
                    onCancel={onCancel}
                    canUseField={canUseRecordField}
                    onFormChange={onFormChange}
                  />
                )}
                renderScheduleForm={({ onCancel }) => (
                  <RecordForm
                    resource={jobTicketScheduleResource}
                    defaults={scheduleDefaultsForTicket(selected, currentUserForView)}
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
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {showingPressFormOverlay && (
          <section className="press-form-overlay" role="dialog" aria-modal="true" aria-label={`${formMode === "edit" ? "Edit" : "Add"} press`}>
            <div className="press-form-window">
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={recordFormLookups}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={closeRecordForm}
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
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {showingFlexDieFormOverlay && (
          <section className="flex-die-form-overlay" role="dialog" aria-modal="true" aria-label={`${formMode === "edit" ? "Edit" : "Add"} ${resource.singular}`}>
            <div className="flex-die-form-window">
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={recordFormLookups}
                submitting={saveMutation.isPending}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {flexDieDetailOpen && resource.key === "flex-dies" && selectedToolingItem && !showingFlexDieFormOverlay && (
          <section className="flex-die-folder-overlay" role="dialog" aria-modal="true" aria-label={`${getRecordTitle(selectedToolingItem)} flex die folder`}>
            <div className="flex-die-folder-window">
              <header className="flex-die-folder-window-head">
                <button className="ghost-btn" type="button" onClick={() => setFlexDieDetailOpen(false)}>
                  <X size={16} /> Close
                </button>
              </header>

              <FlexDieDetailPanel
                die={selectedToolingItem}
                historyRows={selectedFlexDieHistory}
                usageRows={selectedFlexDieUsageRows}
                onEdit={() => setFormMode("edit")}
                onDelete={() => deleteMutation.mutate()}
                onRequestReorder={(note) => requestFlexDieReorder(selectedToolingItem, note)}
                onMarkOrdered={(note) => markFlexDieOrdered(selectedToolingItem, note)}
                onReceiveDie={(payload) => receiveFlexDie(selectedToolingItem, payload)}
                onAdjustCount={(payload) => adjustFlexDieCount(selectedToolingItem, payload)}
                onDeleteDieline={() => deleteFlexDieDieline(selectedToolingItem)}
                onUpdateStatus={(payload) => toolingItemStatusMutation.mutateAsync({
                  resourceKey: "flex-dies",
                  record: selectedToolingItem,
                  payload,
                })}
              />
            </div>
          </section>
        )}

        {toolingWorkspaceForm && toolingWorkspaceResource && (
          <section className="tooling-form-overlay" role="dialog" aria-modal="true" aria-label={`${toolingWorkspaceForm.mode === "edit" ? "Edit" : "Add"} ${toolingWorkspaceResource.singular}`}>
            <div className="tooling-form-window">
              <RecordForm
                resource={toolingWorkspaceResource}
                record={toolingWorkspaceForm.mode === "edit" ? toolingWorkspaceForm.record : null}
                defaults={toolingWorkspaceForm.mode === "create" ? toolingWorkspaceForm.defaults : {}}
                lookups={toolingWorkspaceLookups}
                submitting={toolingWorkspaceMutation.isPending}
                onSubmit={(payload) => toolingWorkspaceMutation.mutate(payload)}
                onCancel={() => setToolingWorkspaceForm(null)}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {toolingItemForm && toolingItemFormResource && (
          <section className="tooling-form-overlay" role="dialog" aria-modal="true" aria-label={`Edit ${toolingItemFormResource.singular}`}>
            <div className="tooling-form-window">
              <RecordForm
                resource={toolingItemFormResource}
                record={toolingItemForm.record}
                defaults={{}}
                lookups={toolingItemLookups}
                submitting={toolingItemFormMutation.isPending}
                onSubmit={(payload) => toolingItemFormMutation.mutate(payload)}
                onCancel={() => setToolingItemForm(null)}
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
                onSubmit={(payload) => saveMutation.mutate({ ...payload, last_updated_by: currentUserForView.name })}
                onCancel={closeRecordForm}
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

        {finishedInventoryOpen && selected && resource.key === "finished-inventory" && (
          <FinishedInventoryWindow
            item={selected}
            usageRows={usageRows}
            sending={finishedInventorySendMutation.isPending}
            onClose={() => setFinishedInventoryOpen(false)}
            onEdit={() => {
              setFinishedInventoryOpen(false);
              setFormMode("edit");
            }}
            onSendOut={(payload) => finishedInventorySendMutation.mutateAsync({ id: selected.id, payload })}
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

        {materialTypeManagerOpen && resource.key === "material-coated-stock" && (
          <MaterialTypeManager
            rows={materialMasterTypes}
            saving={materialTypeSaveMutation.isPending}
            deleting={materialTypeDeleteMutation.isPending}
            onClose={() => setMaterialTypeManagerOpen(false)}
            onSave={(payload) => materialTypeSaveMutation.mutateAsync(payload)}
            onDelete={(row) => materialTypeDeleteMutation.mutateAsync(row)}
          />
        )}

        {finishedMaterialOpen && selected && resource.key === "material-coated-stock" && (
          <FinishedMaterialWindow
            material={selected}
            usageRows={usageRows}
            inventoryRows={selectedMaterialInventoryRows}
            presses={lookupQuery.data?.presses ?? []}
            scheduling={finishedScheduleMutation.isPending}
            scheduleError={finishedScheduleMutation.error?.message || ""}
            canSchedule={isTriStateMaterial(selected)}
            startScheduleOpen={finishedMaterialStartSchedule}
            onClose={() => {
              setFinishedMaterialOpen(false);
              setFinishedMaterialStartSchedule(false);
            }}
            onEdit={() => {
              setFinishedMaterialOpen(false);
              setFinishedMaterialStartSchedule(false);
              setFormMode("edit");
            }}
            onSchedule={(schedule) => finishedScheduleMutation.mutateAsync({ material: selected, schedule })}
            onClearScheduleError={() => finishedScheduleMutation.reset()}
            onViewUsage={() => {
              setFinishedMaterialOpen(false);
              setFinishedMaterialStartSchedule(false);
              setUsageOpen(true);
            }}
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
            onDelete={viewCanManageUsers ? () => {
              setMaterialTypeOpen(false);
              confirmDeleteRecord(selected);
            } : undefined}
            onAddSupplierOption={() => {
              const material = selected;
              setMaterialTypeOpen(false);
              setMaterialSupplierReturnKey(resource.key);
              setActiveKey("material-supplier-options");
              setSelected(null);
              setSearch("");
              setCreateDefaults({
                material: material.id,
                option_name: material.name || "",
                is_active: true,
              });
              setFormMode("create");
            }}
            onEditSupplierOption={(option) => {
              setMaterialTypeOpen(false);
              setMaterialSupplierReturnKey(resource.key);
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
