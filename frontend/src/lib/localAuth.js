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
    id: "role-csr",
    name: "CSR",
    description: "Customer service quoting, tickets, and scheduling",
    allowedResourceKeys: ["quote-calculator", "customers", "job-tickets", "production-schedule", "customer-orders"],
  },
  {
    id: "role-production",
    name: "Production",
    description: "Production queue, job details, and press workflow",
    allowedResourceKeys: ["production-schedule", "job-tickets", "customer-orders", "presses"],
  },
  {
    id: "role-manager",
    name: "Manager",
    description: "Management access",
    allowedResourceKeys: ["*"],
  },
];

const defaultAdminUser = {
  id: "user-admin",
  username: "admin",
  password: "Bluelabels7&",
  name: "Admin",
  role: "Admin",
  active: true,
  createdAt: "2026-05-15T00:00:00.000Z",
};

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
    active: user.active !== false,
    createdAt: user.createdAt || new Date().toISOString(),
  };
}

export function normalizeRole(role = {}) {
  const name = String(role.name || "").trim();
  const defaultRole = defaultRoleDefinitions.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const allowedResourceKeys = Array.isArray(role.allowedResourceKeys)
    ? role.allowedResourceKeys.map(String).filter(Boolean)
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
  const { password, ...safeUser } = user;
  return safeUser;
}

export function loadUsers() {
  if (!canUseStorage()) return [defaultAdminUser];

  let users = [];
  try {
    const payload = JSON.parse(window.localStorage.getItem(userStorageKey) || "[]");
    users = Array.isArray(payload) ? payload.map(normalizeUser) : [];
  } catch {
    users = [];
  }

  const adminIndex = users.findIndex((user) => user.username.toLowerCase() === "admin");
  if (adminIndex === -1) {
    users = [defaultAdminUser, ...users];
  } else {
    users[adminIndex] = {
      ...users[adminIndex],
      username: "admin",
      name: users[adminIndex].name || "Admin",
      role: "Admin",
      active: true,
      password: users[adminIndex].password || defaultAdminUser.password,
    };
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
  window.localStorage.setItem(userStorageKey, JSON.stringify(users.map(normalizeUser)));
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

export function loadSessionUser(users = loadUsers()) {
  if (!canUseStorage()) return null;
  try {
    const session = JSON.parse(window.localStorage.getItem(sessionStorageKey) || "null");
    if (!session?.id) return null;
    const user = users.find((item) => item.id === session.id && item.active !== false);
    return publicUser(user);
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
}

export function signIn(username, password) {
  const users = loadUsers();
  const cleanUsername = String(username || "").trim().toLowerCase();
  const user = users.find((item) => item.username.toLowerCase() === cleanUsername);

  if (!user || user.password !== password) {
    return { error: "Username or password is not correct." };
  }

  if (user.active === false) {
    return { error: "This user is inactive. Ask an admin to reactivate the account." };
  }

  saveSession(user);
  return { user: publicUser(user), users };
}
