export const userStorageKey = "tsm_company_users_v1";
export const sessionStorageKey = "tsm_active_user_v1";

export const userRoleOptions = ["Admin", "Sales", "CSR", "Production", "Manager"];

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

export function saveUsers(users) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(userStorageKey, JSON.stringify(users.map(normalizeUser)));
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
