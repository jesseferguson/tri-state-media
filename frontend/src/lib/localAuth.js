import { createRecord, deleteRecord, fetchCollection, requestApi, updateRecord } from "../api";
import { clearApiToken, getApiToken, setApiToken } from "./authToken";
import { quoteCompanyKey } from "./quoteCompanies";

export const userStorageKey = "tsm_company_users_v1";
export const sessionStorageKey = "tsm_active_user_v1";
export const roleStorageKey = "tsm_company_roles_v1";

export const defaultRoleDefinitions = [
  {
    id: "role-admin",
    name: "Admin",
    description: "Full system access",
    allowedResourceKeys: ["*"],
    locked: true,
  },
  {
    id: "role-sales",
    name: "Sales",
    description: "Quote calculator only",
    allowedResourceKeys: ["quote-calculator"],
  },
  {
    id: "role-sales-manager",
    name: "Sales Manager",
    description: "Quote calculator access with saved quote approval",
    allowedResourceKeys: ["quote-calculator", "quote-approval"],
  },
  {
    id: "role-csr",
    name: "CSR",
    description: "Customer service quoting, tickets, and scheduling",
    allowedResourceKeys: ["quote-calculator", "customers", "job-tickets", "production-schedule", "customer-orders", "footage-reports"],
  },
  {
    id: "role-production",
    name: "Production",
    description: "Production queue, job details, and press workflow",
    allowedResourceKeys: ["production-schedule", "job-tickets", "customer-orders", "presses", "material-handling", "skids", "racks", "footage-reports"],
  },
  {
    id: "role-coater",
    name: "Coater",
    description: "Coater operator lineup and roll tag workflow",
    allowedResourceKeys: ["coater-operator", "material-handling", "skids", "racks"],
  },
  {
    id: "role-manager",
    name: "Manager",
    description: "Management access",
    allowedResourceKeys: ["*"],
  },
];

function canUseStorage() {
  return typeof window !== "undefined" && window.localStorage;
}

export function makeUserId() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRoleId() {
  return `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeUser(user = {}) {
  return {
    id: user.id || makeUserId(),
    username: String(user.username || "").trim(),
    password: String(user.password || ""),
    name: String(user.name || user.username || "").trim(),
    role: user.role || "CSR",
    quoteCompany: quoteCompanyKey(user.quoteCompany || user.quote_company),
    active: user.active !== false,
    createdAt: user.createdAt || new Date().toISOString(),
  };
}

export function canDeleteMaterialRoll(user = {}) {
  const roleName = String(user?.role || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return roleName.includes("admin")
    || roleName.includes("manager")
    || (roleName.includes("material") && roleName.includes("hand"));
}

export function normalizeRole(role = {}) {
  const name = String(role.name || "").trim();
  const defaultRole = defaultRoleDefinitions.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const roleAllowedKeys = Array.isArray(role.allowedResourceKeys) ? role.allowedResourceKeys : role.allowed_resource_keys;
  const allowedResourceKeys = Array.isArray(roleAllowedKeys)
    ? roleAllowedKeys.map(String).filter(Boolean)
    : defaultRole?.allowedResourceKeys ?? [];

  return {
    id: role.id || defaultRole?.id || makeRoleId(),
    name: name || "New Role",
    description: String(role.description || defaultRole?.description || "").trim(),
    allowedResourceKeys,
    locked: Boolean(role.locked || defaultRole?.locked),
    createdAt: role.createdAt || new Date().toISOString(),
  };
}

export function userIsAdmin(user) {
  return String(user?.role || "").toLowerCase() === "admin";
}

export function publicUser(user) {
  if (!user) return null;
  const { password, apiToken, token, ...safeUser } = user;
  return safeUser;
}

export function loadUsers() {
  if (!canUseStorage()) return [];

  let users = [];
  try {
    const payload = JSON.parse(window.localStorage.getItem(userStorageKey) || "[]");
    users = Array.isArray(payload) ? payload.map(normalizeUser) : [];
  } catch {
    users = [];
  }

  saveUsers(users);
  return users;
}

export function loadRoles() {
  if (!canUseStorage()) return defaultRoleDefinitions.map(normalizeRole);

  let roles = [];
  try {
    const payload = JSON.parse(window.localStorage.getItem(roleStorageKey) || "[]");
    roles = Array.isArray(payload) ? payload.map(normalizeRole) : [];
  } catch {
    roles = [];
  }

  defaultRoleDefinitions.forEach((defaultRole) => {
    const index = roles.findIndex((role) => role.name.toLowerCase() === defaultRole.name.toLowerCase());
    if (index === -1) {
      roles.push(normalizeRole(defaultRole));
    } else {
      roles[index] = {
        ...normalizeRole({ ...defaultRole, ...roles[index] }),
        id: defaultRole.locked ? defaultRole.id : roles[index].id,
        name: defaultRole.locked ? defaultRole.name : roles[index].name,
        locked: Boolean(defaultRole.locked || roles[index].locked),
      };
    }
  });

  saveRoles(roles);
  return roles;
}

export function saveUsers(users) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(userStorageKey, JSON.stringify(users.map((user) => ({ ...normalizeUser(user), password: "" }))));
}

export function saveRoles(roles) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(roleStorageKey, JSON.stringify(roles.map(normalizeRole)));
}

export function roleHasResourceAccess(roleDefinitions, roleName, resourceKey) {
  if (String(roleName || "").toLowerCase() === "admin") return true;
  const role = (roleDefinitions ?? []).find((item) => item.name.toLowerCase() === String(roleName || "").toLowerCase());
  if (!role) return false;
  return role.allowedResourceKeys.includes("*") || role.allowedResourceKeys.includes(resourceKey);
}

export async function loadUsersFromApi() {
  const payload = await fetchCollection("company-users", { ordering: "name,username", pageSize: 500 });
  return payload.results.map(normalizeUser);
}

export async function loadRolesFromApi() {
  const payload = await fetchCollection("company-roles", { ordering: "name", pageSize: 100 });
  return payload.results.map(normalizeRole);
}

export async function saveUserToApi(user) {
  const payload = {
    username: user.username,
    password: user.password || "",
    name: user.name,
    role: user.role,
    quoteCompany: quoteCompanyKey(user.quoteCompany),
    active: user.active !== false,
  };
  if (String(user.id || "").startsWith("user-")) {
    return normalizeUser(await createRecord("company-users", payload));
  }
  return normalizeUser(await updateRecord("company-users", user.id, payload));
}

export async function saveRoleToApi(role) {
  const payload = {
    name: role.name,
    description: role.description || "",
    allowedResourceKeys: role.allowedResourceKeys || [],
    locked: role.locked || false,
  };
  if (String(role.id || "").startsWith("role-")) {
    return normalizeRole(await createRecord("company-roles", payload));
  }
  return normalizeRole(await updateRecord("company-roles", role.id, payload));
}

export async function deleteRoleFromApi(role) {
  if (!String(role.id || "").startsWith("role-")) {
    await deleteRecord("company-roles", role.id);
  }
}

export function loadSessionUser(users = loadUsers()) {
  if (!canUseStorage() || !getApiToken()) return null;
  try {
    const session = JSON.parse(window.localStorage.getItem(sessionStorageKey) || "null");
    if (!session?.id) return null;
    const user = users.find((item) => item.id === session.id && item.active !== false);
    return publicUser(user || session);
  } catch {
    return null;
  }
}

export function saveSession(user) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(publicUser(user)));
}

export function clearSession() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(sessionStorageKey);
  clearApiToken();
}

export async function signIn(username, password) {
  try {
    const payload = await requestApi("auth/sign-in", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ username, password }),
    });
    setApiToken(payload.token || "");
    saveSession(payload.user);
    saveUsers(payload.users ?? []);
    saveRoles(payload.roles ?? []);
    return {
      user: publicUser(normalizeUser(payload.user)),
      users: (payload.users ?? []).map(normalizeUser),
      roles: (payload.roles ?? []).map(normalizeRole),
    };
  } catch (apiError) {
    clearApiToken();
    try {
      const payload = JSON.parse(apiError.message);
      return { error: payload.error || payload.detail || "Username or password is not correct." };
    } catch {
      return { error: apiError.message || "Could not reach secure sign-in. Make sure the backend is running, then try again." };
    }
  }
}
