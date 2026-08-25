import { resourceGroups, resourceMap, resources } from "../../resourceConfig";
import { roleHasResourceAccess } from "../../lib/localAuth";

export const fallbackResource = resources[0];

export const initialOpenGroups = Object.fromEntries(
  resourceGroups.map((group) => [group.key, false])
);

export const topLevelGroups = resourceGroups.filter((group) => !group.parent);

const groupsByKey = new Map(resourceGroups.map((group) => [group.key, group]));

export function navigationGroupLabel(group) {
  const parent = groupsByKey.get(group.parent);
  return parent ? `${parent.label} / ${group.label}` : group.label;
}

export function navigationResourcesForGroup(items, groupKey) {
  const grouped = items.filter((item) => item.group === groupKey);
  if (groupKey !== "production") return grouped;
  const suppliers = grouped.find((item) => item.key === "suppliers");
  if (!suppliers) return grouped;
  const withoutSuppliers = grouped.filter((item) => item.key !== "suppliers");
  const customerIndex = withoutSuppliers.findIndex((item) => item.key === "customers");
  withoutSuppliers.splice(customerIndex >= 0 ? customerIndex + 1 : withoutSuppliers.length, 0, suppliers);
  return withoutSuppliers;
}

const AUTO_REFRESH_INTERVALS = {
  "production-schedule": 15_000,
  "job-tickets": 30_000,
  "flex-dies": 45_000,
  "rotary-dies": 45_000,
  "recipe-options": 45_000,
  "recipe-tools": 45_000,
};

export function refreshIntervalForResource(key) {
  return AUTO_REFRESH_INTERVALS[key] ?? 60_000;
}

export function visibleResourcesForRole(roleDefinitions, roleName) {
  return resources.filter((item) => !item.permissionOnly && !item.hideFromNav && roleHasResourceAccess(roleDefinitions, roleName, item.key));
}

export function resourceAvailableForRole(roleDefinitions, roleName, key) {
  const item = resourceMap[key];
  return Boolean(item && !item.permissionOnly && roleHasResourceAccess(roleDefinitions, roleName, item.key));
}

export function resourceCanOpenFromReturnKey(roleDefinitions, roleName, key, returnKey) {
  if (key !== "material-supplier-options" || !returnKey) return false;
  return resourceAvailableForRole(roleDefinitions, roleName, returnKey);
}

export function defaultResourceKeyForRole(roleDefinitions, roleName, preferredKey = "") {
  const visible = visibleResourcesForRole(roleDefinitions, roleName);
  const preferredResourceKey = String(preferredKey || "").trim();
  if (preferredResourceKey && visible.some((item) => item.key === preferredResourceKey)) return preferredResourceKey;
  const normalizedRole = String(roleName || "").toLowerCase();
  if (normalizedRole === "sales" && visible.some((item) => item.key === "quote-calculator")) return "quote-calculator";
  const operatorRole = normalizedRole.includes("operator") || normalizedRole.includes("coater") || normalizedRole.includes("press");
  if (operatorRole && visible.some((item) => item.key === "coater-operator")) return "coater-operator";
  if (visible.some((item) => item.key === "production-schedule")) return "production-schedule";
  if (visible.some((item) => item.key === "coater-operator")) return "coater-operator";
  if (visible.some((item) => item.key === "job-tickets")) return "job-tickets";
  return visible[0]?.key ?? "quote-calculator";
}

export function buildMobileMenuGroups(allowedResources, search = "") {
  const query = search.trim().toLowerCase();
  return resourceGroups
    .map((group) => {
      const label = navigationGroupLabel(group);
      return {
        ...group,
        label,
        items: navigationResourcesForGroup(allowedResources, group.key)
          .filter((item) => !query || `${item.label ?? ""} ${item.singular ?? ""} ${label}`.toLowerCase().includes(query)),
      };
    })
    .filter((group) => group.items.length);
}
