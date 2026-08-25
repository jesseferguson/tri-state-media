import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SignInScreen from "./auth/SignInScreen.jsx";
import UserAdminPanel from "./auth/UserAdminPanel.jsx";
import FlexDieLoadingScreen from "./components/FlexDieLoadingScreen.jsx";
import AppShell from "./layout/AppShell.jsx";
import {
  buildMobileMenuGroups,
  defaultResourceKeyForRole,
  fallbackResource,
  initialOpenGroups,
  refreshIntervalForResource,
  resourceAvailableForRole,
  resourceCanOpenFromReturnKey,
  visibleResourcesForRole,
} from "./navigation/navigationModel";
import { BadgeCheck, CalendarSearch, Plus, RotateCcw, Search, X } from "lucide-react";
import { AUTH_SESSION_ENDED_EVENT, AUTH_SESSION_ENDED_MESSAGE, createRecord, deleteRecord, deleteRecordAction, fetchCollection, postRecordAction, requestApi, updateRecord, uploadRecordAction } from "../api";
import { resourceMap } from "../resourceConfig";
import { CustomerForm, CustomerWorkspace } from "../features/customers";
import { DataImportTool } from "../features/imports";
import { FinishedInventoryView, FinishedInventoryWindow, PackagingInventoryView } from "../features/inventory";
import {
  DeleteMaterialRollDialog,
  FinishedMaterialWindow,
  GroupedLocationView,
  GroupedUsageView,
  MaterialHandlingView,
  MaterialInventoryView,
  MaterialStorageView,
  MaterialTypeManager,
  MaterialTypeTable,
  MaterialTypeWindow,
  MaterialUsageWindow,
  RollScanStation,
  RollWorkflowWindow,
  activeJobKey,
} from "../features/materials";
import {
  CoaterOperatorView,
  FootageReportsView,
  JobTicketGallery,
  JobTicketPanel,
  LiveFootageView,
  PressOperatorDashboard,
  PressTable,
  ProductionScheduleView,
} from "../features/production";
import { QuotePricingTool } from "../features/quotes";
import { SupplierTable } from "../features/suppliers";
import {
  FlexDieDetailPanel,
  FlexDieTable,
  FlexDieWorkspacePanel,
  LabelLayoutsView,
  RecipeOptionsView,
  RecipeToolStackView,
  ToolingItemDetailPanel,
} from "../features/tooling";
import { RecordForm, ResourceTable } from "../shared/components";
import {
  clearSession,
  canDeleteMaterialRoll,
  deleteRoleFromApi,
  loadRoles,
  loadRolesFromApi,
  loadSessionUser,
  loadUsers,
  loadUsersFromApi,
  normalizePinnedMenuPages,
  roleHasResourceAccess,
  saveRoleToApi,
  saveRoles,
  saveSession,
  saveUserToApi,
  saveUsers,
  signIn,
  userIsAdmin,
} from "../lib/localAuth";
import { quoteCompanyKey } from "../lib/quoteCompanies";
import { emptyFlexDieFilters, filterFlexDies, filterRows } from "../lib/filtering";
import { getRecordTitle } from "../lib/format";
import { apiErrorMessage, companyUserHeaders, messageUserId, messageUserLabel } from "./shared/appUtils.js";
import { detailValue, getDetailKeys, labelForField } from "./resources/recordDetails.js";
import { loadScopedLookups, mergeRows } from "./resources/recordLookups.js";
import {
  isTriStateMaterial,
  materialFormPageKeys,
  materialOwnerTabs,
  materialTypePageKeys,
  toolingConfigFormPageKeys,
  toolingItemPageKeys,
} from "./resources/resourceGroups.js";
import { assignmentToolDetails, assignmentToolTarget } from "./resources/toolingAssignments.js";
import { autoImageName, generatedJobTicketNumber, scheduleDefaultsForTicket } from "./resources/jobTicketForms.js";
import { currentInventoryQuantity, findScannedLocation, firstMaterialComponentId, inventoryTotalFeetForMaterial, locationCodeFromScan, rollUsagePayload } from "./resources/materialHelpers.js";







export default function App() {
  const queryClient = useQueryClient();
  const [users, setUsers] = useState(() => loadUsers());
  const [roleDefinitions, setRoleDefinitions] = useState(() => loadRoles());
  const [currentUser, setCurrentUser] = useState(() => loadSessionUser());
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [signInMessage, setSignInMessage] = useState("");

  useEffect(() => {
    function handleSessionEnded(event) {
      const message = event.detail?.message || AUTH_SESSION_ENDED_MESSAGE;
      clearSession();
      queryClient.clear();
      setCurrentUser(null);
      setUserPanelOpen(false);
      setSignInMessage(message);
    }

    window.addEventListener(AUTH_SESSION_ENDED_EVENT, handleSessionEnded);
    return () => window.removeEventListener(AUTH_SESSION_ENDED_EVENT, handleSessionEnded);
  }, [queryClient]);

  useEffect(() => {
    if (!currentUser || !userIsAdmin(currentUser)) return undefined;
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
  }, [currentUser?.id, currentUser?.role]);

  async function handleSignIn(username, password) {
    const result = await signIn(username, password);
    if (result.error) return result;
    setUsers(result.users);
    if (result.roles) setRoleDefinitions(result.roles);
    setCurrentUser(result.user);
    setSignInMessage("");
    return result;
  }

  function handleSignOut() {
    clearSession();
    queryClient.clear();
    setCurrentUser(null);
    setUserPanelOpen(false);
    setSignInMessage("");
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

  async function handleDefaultLandingPageChange(value) {
    if (!currentUser) return;
    const nextDefaultLandingPage = String(value || "").trim();
    if (nextDefaultLandingPage === String(currentUser.defaultLandingPage || "").trim()) return;

    const matchesCurrentUser = (user) =>
      String(user.id) === String(currentUser.id) || String(user.username || "").toLowerCase() === String(currentUser.username || "").toLowerCase();
    const nextUser = { ...currentUser, defaultLandingPage: nextDefaultLandingPage };
    const nextUsers = users.map((user) => matchesCurrentUser(user) ? { ...user, defaultLandingPage: nextDefaultLandingPage } : user);
    setCurrentUser(nextUser);
    setUsers(nextUsers);
    saveUsers(nextUsers);
    saveSession(nextUser);

    if (String(currentUser.id || "").startsWith("user-")) return;

    try {
      const saved = await updateRecord("company-users", currentUser.id, { defaultLandingPage: nextDefaultLandingPage });
      const syncedUser = {
        ...nextUser,
        ...saved,
        quoteCompany: quoteCompanyKey(saved.quoteCompany),
        defaultLandingPage: String(saved.defaultLandingPage || saved.default_landing_page || "").trim(),
      };
      const syncedUsers = nextUsers.map((user) => matchesCurrentUser(user) ? { ...user, ...syncedUser } : user);
      setCurrentUser(syncedUser);
      setUsers(syncedUsers);
      saveUsers(syncedUsers);
      saveSession(syncedUser);
    } catch (error) {
      console.warn("Could not sync default landing page preference.", error);
    }
  }

  async function handlePinnedMenuPagesChange(value) {
    if (!currentUser) return;
    const nextPinnedMenuPages = normalizePinnedMenuPages(value);
    const currentPinnedMenuPages = normalizePinnedMenuPages(currentUser.pinnedMenuPages);
    if (JSON.stringify(nextPinnedMenuPages) === JSON.stringify(currentPinnedMenuPages)) return;

    const matchesCurrentUser = (user) =>
      String(user.id) === String(currentUser.id) || String(user.username || "").toLowerCase() === String(currentUser.username || "").toLowerCase();
    const nextUser = { ...currentUser, pinnedMenuPages: nextPinnedMenuPages };
    const nextUsers = users.map((user) => matchesCurrentUser(user) ? { ...user, pinnedMenuPages: nextPinnedMenuPages } : user);
    setCurrentUser(nextUser);
    setUsers(nextUsers);
    saveUsers(nextUsers);
    saveSession(nextUser);

    if (String(currentUser.id || "").startsWith("user-")) return;

    try {
      const saved = await updateRecord("company-users", currentUser.id, { pinnedMenuPages: nextPinnedMenuPages });
      const syncedUser = {
        ...nextUser,
        ...saved,
        quoteCompany: quoteCompanyKey(saved.quoteCompany),
        defaultLandingPage: String(saved.defaultLandingPage || saved.default_landing_page || "").trim(),
        pinnedMenuPages: normalizePinnedMenuPages(saved.pinnedMenuPages || saved.pinned_menu_pages),
      };
      const syncedUsers = nextUsers.map((user) => matchesCurrentUser(user) ? { ...user, ...syncedUser } : user);
      setCurrentUser(syncedUser);
      setUsers(syncedUsers);
      saveUsers(syncedUsers);
      saveSession(syncedUser);
    } catch (error) {
      console.warn("Could not sync pinned menu pages.", error);
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
      saveSession(publicCurrentUser);
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

  if (!currentUser) return <SignInScreen onSignIn={handleSignIn} message={signInMessage} />;

  return (
    <>
      <SignedInApp
        currentUser={currentUser}
        users={users}
        roleDefinitions={roleDefinitions}
        canManageUsers={userIsAdmin(currentUser)}
        onOpenUserAdmin={() => setUserPanelOpen(true)}
        onQuoteCompanyChange={handleQuoteCompanyChange}
        onDefaultLandingPageChange={handleDefaultLandingPageChange}
        onPinnedMenuPagesChange={handlePinnedMenuPagesChange}
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



function SignedInApp({ currentUser, users = [], roleDefinitions, canManageUsers, onOpenUserAdmin, onQuoteCompanyChange, onDefaultLandingPageChange, onPinnedMenuPagesChange, onSignOut }) {
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("skidToken")) return "skids";
      if (params.get("rackToken")) return "racks";
      if (params.get("rollTagId") || params.get("inventoryId")) return "material-handling";
      if (params.get("flexDieId")) return "flex-dies";
      if (params.get("pressDashboard")) return "live-footage";
    }
    return defaultResourceKeyForRole(roleDefinitions, currentUser?.role, currentUser?.defaultLandingPage);
  });
  const [linkedRollTagId, setLinkedRollTagId] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("rollTagId") || "" : ""
  ));
  const [linkedInventoryId, setLinkedInventoryId] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("inventoryId") || "" : ""
  ));
  const [coaterScheduleStartId, setCoaterScheduleStartId] = useState("");
  const [scheduleFocusId, setScheduleFocusId] = useState("");
  const [scannedSkidToken, setScannedSkidToken] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("skidToken") || "" : ""
  ));
  const [scannedRackToken, setScannedRackToken] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("rackToken") || "" : ""
  ));
  const [linkedFlexDieId, setLinkedFlexDieId] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("flexDieId") || "" : ""
  ));
  const [pressDashboardKey, setPressDashboardKey] = useState(() => (
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("pressDashboard") || "" : ""
  ));
  const [previewRoleName, setPreviewRoleName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [formMode, setFormMode] = useState(null); // null | create | edit
  const [createDefaults, setCreateDefaults] = useState({});
  const [flexFilters, setFlexFilters] = useState(emptyFlexDieFilters);
  const [flexDieDetailOpen, setFlexDieDetailOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(initialOpenGroups);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(false);
  const [mobilePageMenuOpen, setMobilePageMenuOpen] = useState(false);
  const [mobilePageSearch, setMobilePageSearch] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [inventoryDeleteCandidate, setInventoryDeleteCandidate] = useState(null);
  const [finishedInventoryOpen, setFinishedInventoryOpen] = useState(false);
  const [finishedInventoryNotice, setFinishedInventoryNotice] = useState(null);
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
  const [customerFollowUpRequest, setCustomerFollowUpRequest] = useState(null);
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

  const directScanResourceKey = scannedSkidToken
    ? "skids"
    : scannedRackToken
      ? "racks"
      : linkedRollTagId || linkedInventoryId
        ? "material-handling"
        : linkedFlexDieId
          ? "flex-dies"
          : "";
  const allowedResources = useMemo(() => {
    const visible = visibleResourcesForRole(roleDefinitions, viewRoleName);
    const directResource = directScanResourceKey ? resourceMap[directScanResourceKey] : null;
    if (directResource && !visible.some((item) => item.key === directResource.key)) {
      return [...visible, directResource];
    }
    return visible;
  }, [directScanResourceKey, roleDefinitions, viewRoleName]);
  const activeResource = resourceMap[activeKey];
  const activeKeyAllowed = allowedResources.some((item) => item.key === activeKey)
    || resourceAvailableForRole(roleDefinitions, viewRoleName, activeKey)
    || resourceCanOpenFromReturnKey(roleDefinitions, viewRoleName, activeKey, materialSupplierReturnKey);
  const resource = activeKeyAllowed && activeResource
    ? activeResource
    : allowedResources[0] ?? resourceMap["quote-calculator"] ?? fallbackResource;
  const singleResourceMode = allowedResources.length === 1 && !viewCanManageUsers;
  const showingStaticView = Boolean(resource.staticView);
  const showingJobTicketOverlay = resource.key === "job-tickets" && selected;
  const isMaterialTypePage = materialTypePageKeys.has(resource.key);
  const isMaterialFormPage = materialFormPageKeys.has(resource.key);
  const isToolingConfigPage = toolingConfigFormPageKeys.has(resource.key);
  const showingMaterialFormOverlay = Boolean(formMode && isMaterialFormPage);
  const showingScheduleFormOverlay = Boolean(formMode && resource.key === "production-schedule");
  const showingCustomerForm = Boolean(formMode && resource.key === "customers");
  const showingFlexDieFormOverlay = Boolean(formMode && resource.key === "flex-dies");
  const showingToolingConfigFormOverlay = Boolean(formMode && isToolingConfigPage);
  const showingPressFormOverlay = Boolean(formMode && resource.key === "presses");
  const showingToolingConfigDetailOverlay = Boolean(selected && !formMode && isToolingConfigPage && resource.key !== "recipes");
  const collectionQueryKey = ["collection", resource.key, resource.filters ?? {}, resource.searchMode === "flexDie" ? "" : search];
  const mobileMenuGroups = useMemo(
    () => buildMobileMenuGroups(allowedResources, mobilePageSearch),
    [allowedResources, mobilePageSearch]
  );
  const landingPageOptions = useMemo(
    () => visibleResourcesForRole(roleDefinitions, currentUser?.role),
    [currentUser?.role, roleDefinitions]
  );
  const pinnedPageKeys = useMemo(() => {
    const allowedKeys = new Set(allowedResources.map((item) => item.key));
    return normalizePinnedMenuPages(currentUser?.pinnedMenuPages).filter((key) => allowedKeys.has(key));
  }, [allowedResources, currentUser?.pinnedMenuPages]);
  const pinnedPages = useMemo(
    () => pinnedPageKeys.map((key) => resourceMap[key]).filter(Boolean),
    [pinnedPageKeys]
  );
  const canPinPage = allowedResources.some((item) => item.key === resource.key);
  const pagePinned = pinnedPageKeys.includes(resource.key);

  function togglePinnedPage() {
    if (!canPinPage) return;
    const allowedKeys = new Set(allowedResources.map((item) => item.key));
    const current = normalizePinnedMenuPages(currentUser?.pinnedMenuPages).filter((key) => allowedKeys.has(key));
    const next = current.includes(resource.key)
      ? current.filter((key) => key !== resource.key)
      : [resource.key, ...current];
    onPinnedMenuPagesChange?.(next);
  }

  useEffect(() => {
    if (!mobilePageMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMobilePageMenuOpen(false);
        setMobilePageSearch("");
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobilePageMenuOpen]);

  useEffect(() => {
    if (!finishedInventoryNotice) return undefined;
    const timer = window.setTimeout(() => setFinishedInventoryNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [finishedInventoryNotice]);

  function showFinishedInventoryNotice(message) {
    setFinishedInventoryNotice({ id: Date.now(), message });
  }

  function startCustomerFollowUpFromQuote({ quote, customer }) {
    if (!quote || !customer?.id) return;
    const quoteId = String(quote.id ?? quote.external_id ?? quote.pk ?? "").trim();
    const jobTicketId = String(quote.jobTicketId ?? quote.job_ticket ?? "").trim();
    const quoteLabel = quote.quoteNumber || quote.quote_number || "Quote";
    setCustomerFollowUpRequest({
      id: `quote-${quoteId || quoteLabel}-${Date.now()}`,
      customerId: String(customer.id),
      quoteIds: quoteId ? [quoteId] : [],
      jobTicketIds: jobTicketId ? [jobTicketId] : [],
      subject: `${quoteLabel} follow-up`,
      body: "",
    });
    setActiveKey("customers");
    setSelected(customer);
    setFormMode(null);
    setSearch("");
  }

  useEffect(() => {
    if (activeKeyAllowed) return;
    setActiveKey(defaultResourceKeyForRole(roleDefinitions, viewRoleName, currentUserForView?.defaultLandingPage));
  }, [activeKeyAllowed, currentUserForView?.defaultLandingPage, viewRoleName, roleDefinitions]);

  useEffect(() => {
    if (!linkedRollTagId && !linkedInventoryId) return;
    if (allowedResources.some((item) => item.key === "material-handling")) {
      setActiveKey("material-handling");
      setSelected(null);
      setFormMode(null);
    }
  }, [allowedResources, linkedInventoryId, linkedRollTagId]);

  useEffect(() => {
    const targetKey = scannedSkidToken ? "skids" : scannedRackToken ? "racks" : "";
    if (!targetKey || !allowedResources.some((item) => item.key === targetKey)) return;
    setActiveKey(targetKey);
    setSelected(null);
    setFormMode(null);
  }, [allowedResources, scannedRackToken, scannedSkidToken]);

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

  const flexDieScanQuery = useQuery({
    queryKey: ["flex-die-scan", linkedFlexDieId],
    queryFn: () => requestApi(`flex-dies/${linkedFlexDieId}`),
    enabled: Boolean(linkedFlexDieId && resource.key === "flex-dies"),
    retry: 1,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const base = listQuery.data?.results ?? [];
    if (resource.key !== "raw-materials") return base;
    return mergeRows(base, localInventoryRows);
  }, [listQuery.data, localInventoryRows, resource.key]);

  useEffect(() => {
    if (!linkedFlexDieId) return;
    if (resource.key !== "flex-dies") setActiveKey("flex-dies");
    setFormMode(null);
    setFlexDieDetailOpen(true);
  }, [linkedFlexDieId, resource.key]);

  useEffect(() => {
    if (!linkedFlexDieId || resource.key !== "flex-dies") return;
    const scannedDie = flexDieScanQuery.data || rows.find((row) => String(row.id) === String(linkedFlexDieId));
    if (!scannedDie) return;
    setSelected(scannedDie);
    setFormMode(null);
    setFlexDieDetailOpen(true);
  }, [flexDieScanQuery.data, linkedFlexDieId, resource.key, rows]);

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
  const canProcessFlexDieRequests = roleHasResourceAccess(roleDefinitions, viewRoleName, "flex-die-requests");
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
      if ((resource.key === "flex-dies" || resource.key === "rotary-dies") && imageUploads.length && saved?.id) {
        const upload = imageUploads.find((item) => item.slot === "dieline" && item.file);
        if (upload) {
          const formData = new FormData();
          formData.append("image", upload.file);
          formData.append("name", upload.file.name);
          saved = await uploadRecordAction(resource.endpoint, saved.id, "dieline-image", formData);
        }
      }
      if (resource.key === "recipes" && imageUploads.length && saved?.id) {
        const upload = imageUploads.find((item) => item.slot === "layout" && item.file);
        if (upload) {
          const formData = new FormData();
          formData.append("image", upload.file);
          formData.append("name", upload.file.name);
          saved = await uploadRecordAction(resource.endpoint, saved.id, upload.action || "layout-file", formData);
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

  const inventoryDeleteMutation = useMutation({
    mutationFn: (roll) => postRecordAction("raw-materials", roll.id, "remove-from-inventory", {
      confirm_delete: true,
    }, {
      headers: companyUserHeaders(currentUser),
    }),
    onSuccess: () => {
      setInventoryDeleteCandidate(null);
      setRollOpen(false);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["material-storage"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
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
      showFinishedInventoryNotice(`${getRecordTitle(saved ?? selected)} was sent out successfully.`);
    },
  });

  const finishedInventoryMoveMutation = useMutation({
    mutationFn: ({ id, payload }) => postRecordAction("finished-inventory", id, "move-item", payload),
    onSuccess: (result) => {
      const destination = result?.destination ?? null;
      queryClient.invalidateQueries({ queryKey: ["collection", "finished-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      if (destination) setSelected(destination);
      showFinishedInventoryNotice(result?.completed || `${getRecordTitle(destination ?? selected)} moved successfully.`);
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

  const customerInteractionMutation = useMutation({
    mutationFn: (payload) => createRecord("customer-interactions", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-interactions"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const customerOpenLogUpdateMutation = useMutation({
    mutationFn: ({ interaction, payload, actionSummary }) => {
      if (!interaction?.id) throw new Error("Choose an open log before updating.");
      const actor = messageUserLabel(currentUserForView);
      return updateRecord("customer-interactions", interaction.id, {
        ...payload,
        action_summary: actionSummary || "updated follow-up",
        updated_by: actor,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-interactions"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const customerNotifyTeamMutation = useMutation({
    mutationFn: async ({ customer, recipientIds = [], subject = "", body = "", relatedRecord = null }) => {
      if (!customer?.id) throw new Error("Choose a customer before notifying the team.");
      if (!recipientIds.length) throw new Error("Choose at least one team member.");
      if (!String(body || "").trim()) throw new Error("Add a team note before sending.");
      const viewerId = messageUserId(currentUserForView);
      const participantIds = [...new Set([viewerId, ...recipientIds.map(String)].filter(Boolean))];
      const participantRows = participantIds.map((id) => (
        String(id) === String(viewerId)
          ? currentUserForView
          : users.find((user) => String(messageUserId(user)) === String(id))
      )).filter(Boolean);
      const cleanSubject = String(subject || "").trim() || `${customer.name || "Customer"} follow-up`;
      const relatedLabel = relatedRecord?.value ? relatedRecord.label : "";
      const thread = await createRecord("message-threads", {
        title: cleanSubject,
        participant_user_ids: participantIds,
        participant_names: participantRows.map(messageUserLabel),
        context_type: "customer",
        context_id: String(customer.id),
        context_label: customer.name || `Customer ${customer.id}`,
        created_by_user_id: viewerId,
        created_by_name: messageUserLabel(currentUserForView),
      });
      await createRecord("messages", {
        thread: thread.id,
        sender_user_id: viewerId,
        sender_name: messageUserLabel(currentUserForView),
        body: [String(body || "").trim(), relatedLabel ? `Related item: ${relatedLabel}` : ""].filter(Boolean).join("\n\n"),
        read_by_user_ids: [viewerId],
      });
      const [relationType, relationId] = String(relatedRecord?.value || "").split(":");
      await createRecord("customer-interactions", {
        customer: customer.id,
        customer_order: relationType === "order" && relationId ? Number(relationId) : null,
        job_ticket: relationType === "job" && relationId ? Number(relationId) : null,
        related_job_tickets: relationType === "job" && relationId ? [Number(relationId)] : [],
        quote: relationType === "quote" && relationId ? relationId : null,
        related_quotes: relationType === "quote" && relationId ? [relationId] : [],
        interaction_type: "task",
        status: "open",
        subject: cleanSubject,
        body: `Team notified: ${participantRows.filter((user) => String(messageUserId(user)) !== String(viewerId)).map(messageUserLabel).join(", ")}\n\n${String(body || "").trim()}`,
        occurred_at: new Date().toISOString(),
        follow_up_date: null,
        created_by: messageUserLabel(currentUserForView),
        updated_by: messageUserLabel(currentUserForView),
      });
      return thread;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-threads"] });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-interactions"] });
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

  const coaterScheduleUpdateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateRecord("coater-roll-tags", id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
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

  const orderRestoreScheduleMutation = useMutation({
    mutationFn: ({ order, payload }) => postRecordAction("customer-orders", order.id, "restore-to-schedule", payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-order-events"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "job-ticket-events"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      if (saved?.schedule_entry) setScheduleFocusId(String(saved.schedule_entry));
      switchResource("production-schedule");
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

  const flexDieFolderLabelMutation = useMutation({
    mutationFn: async ({ die, form }) => {
      if (!die?.id) throw new Error("No flex die selected.");
      return postRecordAction("flex-dies", die.id, "print-folder-label", {
        ...form,
        performed_by: currentUserForView?.name || "",
        frontend_url: window.location.origin,
      }, {
        headers: companyUserHeaders(currentUserForView),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const jobTicketScheduleCreateMutation = useMutation({
    mutationFn: (payload) => createRecord("production-schedule", {
      ...payload,
      job_ticket: selected.id,
      customer: selected.customer || null,
      status: "unscheduled",
      priority: payload.priority || "low",
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
    await queryClient.invalidateQueries({ queryKey: ["flex-die-requests"] });
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

  function clearFlexDieScanLink() {
    setLinkedFlexDieId("");
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("flexDieId")) return;
    url.searchParams.delete("flexDieId");
    window.history.replaceState({}, "", url);
  }

  function closeFlexDieFolder() {
    setFlexDieDetailOpen(false);
    if (linkedFlexDieId) clearFlexDieScanLink();
  }

  function switchResource(key) {
    if (!allowedResources.some((item) => item.key === key)) return;
    setActiveKey(key);
    setSelected(null);
    setFormMode(null);
    setFlexDieDetailOpen(false);
    clearFlexDieScanLink();
    setCreateDefaults({});
    setMaterialSupplierReturnKey("");
    setUsageOpen(false);
    setRollOpen(false);
    setFinishedMaterialOpen(false);
    setFinishedMaterialStartSchedule(false);
    setCoaterScheduleStartId("");
    setMaterialTypeManagerOpen(false);
    setToolingWorkspaceForm(null);
    setSearch("");
    setDesktopSidebarOpen(false);
    setMobilePageMenuOpen(false);
    setMobilePageSearch("");
  }

  function orderIsOnSchedule(order) {
    return Boolean(order?.schedule_entry) && ["unscheduled", "scheduled", "ready", "running", "on_hold"].includes(String(order?.status || "").toLowerCase());
  }

  function orderCanRestoreToSchedule(order) {
    return !order?.schedule_entry && String(order?.status || "").toLowerCase() === "schedule_removed";
  }

  function viewOrderOnSchedule(order) {
    if (!order?.schedule_entry) return;
    setScheduleFocusId(String(order.schedule_entry));
    switchResource("production-schedule");
  }

  function restoreOrderToSchedule(order) {
    if (!order?.id || orderRestoreScheduleMutation.isPending) return;
    orderRestoreScheduleMutation.mutate({
      order,
      payload: {
        performed_by: currentUserForView?.name || currentUser?.name || "",
        reason: `Restored from Customer Orders by ${currentUserForView?.name || currentUser?.name || "user"}.`,
      },
    });
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

  useEffect(() => {
    if (!showingCustomerForm) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event) {
      if (event.key === "Escape") closeRecordForm();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showingCustomerForm, resource.key, materialSupplierReturnKey]);

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
    clearFlexDieScanLink();
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
  const flexDieScanActive = Boolean(linkedFlexDieId && resource.key === "flex-dies");
  const flexDieFolderLoading = resource.key === "flex-dies" && (
    Boolean(flexDieScanActive && (flexDieScanQuery.isLoading || !selectedToolingItem)) ||
    Boolean(flexDieDetailOpen && selectedToolingItem && lookupQuery.isLoading)
  );
  const flexDieFolderError = flexDieScanActive && flexDieScanQuery.error
    ? `Could not open that flex die: ${flexDieScanQuery.error.message}`
    : "";

  const liveFootageFullView = resource.viewMode === "liveFootage" && liveFootageTvMode;
  const materialWorkspaceView = ["material-handling", "skids", "racks"].includes(resource.key);

  function closeMobilePageMenu() {
    setMobilePageMenuOpen(false);
    setMobilePageSearch("");
  }

  function openCreateRecordForm() {
    setSelected(null);
    setFlexDieDetailOpen(false);
    setCreateDefaults(resource.key === "material-coated-stock" && materialOwnerTab === "tri_state" ? { company: "Tri-State Media" } : {});
    setFormMode("create");
  }

  const appErrorMessages = [
    saveMutation.error?.message,
    finishedScheduleMutation.error?.message,
    scheduleUpdateMutation.error?.message,
    coaterScheduleUpdateMutation.error?.message,
    scheduleRemoveMutation.error?.message,
    jobTicketEditMutation.error?.message,
    jobTicketChangeApprovalMutation.error?.message,
    jobTicketPrintMutation.error?.message,
    flexDieFolderLabelMutation.error ? apiErrorMessage(flexDieFolderLabelMutation.error) : "",
    jobTicketScheduleCreateMutation.error?.message,
    customerInteractionMutation.error ? apiErrorMessage(customerInteractionMutation.error) : "",
    customerOpenLogUpdateMutation.error ? apiErrorMessage(customerOpenLogUpdateMutation.error) : "",
    customerNotifyTeamMutation.error ? apiErrorMessage(customerNotifyTeamMutation.error) : "",
    materialTypeSaveMutation.error?.message,
    materialTypeDeleteMutation.error?.message,
    toolingWorkspaceMutation.error?.message,
    toolingItemStatusMutation.error?.message,
    toolingItemFormMutation.error?.message,
    deleteMutation.error?.message,
    rollActionMutation.error?.message,
    finishedInventorySendMutation.error?.message,
    listQuery.error ? `Could not load ${resource.label}: ${listQuery.error.message}` : "",
    resource.key === "material-usages" && listQuery.data?.raw?.missingEndpoint
      ? "Material Usage needs the latest backend migration/restart before it can load saved usage records."
      : "",
    lookupQuery.error ? `Could not load lookup data: ${lookupQuery.error.message}` : "",
  ];

  if (pressDashboardKey) {
    return (
      <PressOperatorDashboard
        pressKey={pressDashboardKey}
        onClose={() => {
          setPressDashboardKey("");
          setActiveKey("live-footage");
          const url = new URL(window.location.href);
          url.searchParams.delete("pressDashboard");
          window.history.replaceState({}, "", url);
        }}
      />
    );
  }

  return (
    <AppShell
      singleResourceMode={singleResourceMode}
      liveFootageFullView={liveFootageFullView}
      directScanResourceKey={directScanResourceKey}
      materialWorkspaceView={materialWorkspaceView}
      desktopSidebarOpen={desktopSidebarOpen}
      mobilePageMenuOpen={mobilePageMenuOpen}
      currentUser={currentUser}
      users={users}
      resource={resource}
      activePreviewRoleName={activePreviewRoleName}
      canManageUsers={canManageUsers}
      roleDefinitions={roleDefinitions}
      landingPageOptions={landingPageOptions}
      pinnedPages={pinnedPages}
      pagePinned={pagePinned}
      canPinPage={canPinPage}
      canProcessFlexDieRequests={canProcessFlexDieRequests}
      mobilePageSearch={mobilePageSearch}
      mobileMenuGroups={mobileMenuGroups}
      allowedResources={allowedResources}
      openGroups={openGroups}
      showingStaticView={showingStaticView}
      appErrorMessages={appErrorMessages}
      onOpenDesktopSidebar={() => setDesktopSidebarOpen(true)}
      onCloseDesktopSidebar={() => setDesktopSidebarOpen(false)}
      onOpenMobileMenu={() => setMobilePageMenuOpen(true)}
      onCloseMobileMenu={closeMobilePageMenu}
      onMobilePageSearchChange={setMobilePageSearch}
      onSelectResource={switchResource}
      onToggleGroup={toggleGroup}
      onOpenLiveFootage={openLiveFootageFromSidebar}
      onRefresh={() => listQuery.refetch()}
      onOpenMaterialTypes={() => setMaterialTypeManagerOpen(true)}
      onCreate={openCreateRecordForm}
      onPreviewRoleChange={setPreviewRoleName}
      onOpenUserAdmin={onOpenUserAdmin}
      onQuoteCompanyChange={onQuoteCompanyChange}
      onDefaultLandingPageChange={onDefaultLandingPageChange}
      onTogglePinnedPage={togglePinnedPage}
      onSignOut={onSignOut}
    >

        {resource.key === "flex-dies" && listQuery.isLoading ? (
          <FlexDieLoadingScreen scanned={Boolean(linkedFlexDieId)} />
        ) : resource.viewMode === "quoteCalculator" ? (
          <QuotePricingTool
            currentUser={currentUserForView}
            initialJobTicketId={quoteJobTicketId}
            initialCustomerId={quoteCustomerId}
            canManageQuoteMaterials={canManageQuoteMaterials}
            canApproveQuotes={canApproveQuotes}
            onStartCustomerFollowUp={startCustomerFollowUpFromQuote}
          />
        ) : resource.viewMode === "liveFootage" ? (
          <LiveFootageView
            tvMode={liveFootageTvMode}
            onTvModeChange={setLiveFootageTvMode}
            currentUser={currentUserForView}
            canManageSettings={viewCanManageUsers}
          />
        ) : resource.viewMode === "footageReports" ? (
          <FootageReportsView currentUser={currentUserForView} />
        ) : resource.viewMode === "coaterOperator" ? (
          <CoaterOperatorView
            currentUser={currentUserForView}
            initialMaterialScheduleId={coaterScheduleStartId}
            onInitialMaterialScheduleHandled={() => setCoaterScheduleStartId("")}
            linkedRollTagId={linkedRollTagId}
            onLinkedRollTagChange={(rollTagId) => {
              setLinkedRollTagId(String(rollTagId));
              const url = new URL(window.location.href);
              if (rollTagId) url.searchParams.set("rollTagId", String(rollTagId));
              else url.searchParams.delete("rollTagId");
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
            linkedInventoryId={linkedInventoryId}
            onOpenStorage={(key) => {
              setLinkedRollTagId("");
              setLinkedInventoryId("");
              const url = new URL(window.location.href);
              url.searchParams.delete("rollTagId");
              url.searchParams.delete("inventoryId");
              window.history.replaceState({}, "", url);
              setActiveKey(key);
            }}
            onCloseLinkedRoll={() => {
              setLinkedRollTagId("");
              setLinkedInventoryId("");
              const url = new URL(window.location.href);
              url.searchParams.delete("rollTagId");
              url.searchParams.delete("inventoryId");
              window.history.replaceState({}, "", url);
            }}
            onLinkedRollTagChange={(rollTagId) => {
              setLinkedRollTagId(String(rollTagId));
              setLinkedInventoryId("");
              const url = new URL(window.location.href);
              url.searchParams.delete("inventoryId");
              if (rollTagId) {
                url.searchParams.set("rollTagId", String(rollTagId));
              } else {
                url.searchParams.delete("rollTagId");
              }
              window.history.replaceState({}, "", url);
            }}
          />
        ) : resource.viewMode === "materialStorageSkids" || resource.viewMode === "materialStorageRacks" ? (
          <MaterialStorageView
            mode={resource.viewMode === "materialStorageSkids" ? "skids" : "racks"}
            currentUser={currentUserForView}
            onNavigate={(key) => setActiveKey(key)}
            onOpenRoll={(roll) => {
              setLinkedRollTagId("");
              setLinkedInventoryId(String(roll.id));
              setScannedSkidToken("");
              const url = new URL(window.location.href);
              url.searchParams.delete("rollTagId");
              url.searchParams.delete("skidToken");
              url.searchParams.set("inventoryId", String(roll.id));
              window.history.replaceState({}, "", url);
              setActiveKey("material-handling");
            }}
            initialToken={resource.viewMode === "materialStorageSkids" ? scannedSkidToken : scannedRackToken}
            onClearToken={() => {
              const isSkid = resource.viewMode === "materialStorageSkids";
              if (isSkid) setScannedSkidToken("");
              else setScannedRackToken("");
              const url = new URL(window.location.href);
              url.searchParams.delete(isSkid ? "skidToken" : "rackToken");
              window.history.replaceState({}, "", url);
            }}
          />
        ) : resource.viewMode === "dataImport" ? (
          <DataImportTool currentUser={currentUserForView} />
        ) : (
          <>
            {resource.searchMode === "flexDie" ? (
              <FlexDieWorkspacePanel
                filters={flexFilters}
                setFilters={setFlexFilters}
                liners={lookupQuery.data?.materials ?? []}
                rows={rows}
                resultCount={visibleRows.length}
                totalCount={rows.length}
                resourceLabel={resource.singular}
                currentUser={currentUserForView}
                canProcessFlexDieRequests={canProcessFlexDieRequests}
                loading={listQuery.isFetching && !rows.length}
                onRequestsChanged={() => refreshFlexDie()}
              />
            ) : resource.viewMode === "customers" || resource.viewMode === "productionSchedule" ? null : (
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

            {showingCustomerForm && (
              <section className="customer-form-overlay" role="dialog" aria-modal="true" aria-label={formMode === "edit" ? "Edit customer" : "Add customer"}>
                <button className="customer-form-backdrop" type="button" onClick={closeRecordForm} aria-label="Close customer form" />
                <div className="customer-form-modal">
                  <CustomerForm
                    record={formMode === "edit" ? selected : null}
                    defaults={formMode === "create" ? createDefaults : {}}
                    submitting={saveMutation.isPending}
                    error={saveMutation.error}
                    onSubmit={(payload) => saveMutation.mutate(payload)}
                    onCancel={closeRecordForm}
                  />
                </div>
              </section>
            )}

            {formMode && !showingCustomerForm && !showingMaterialFormOverlay && !showingScheduleFormOverlay && !showingFlexDieFormOverlay && !showingToolingConfigFormOverlay && !showingPressFormOverlay && !(showingJobTicketOverlay && formMode === "edit") && (
              <RecordForm
                resource={resource}
                record={formMode === "edit" ? selected : null}
                defaults={formMode === "create" ? createDefaults : {}}
                lookups={recordFormLookups}
                submitting={saveMutation.isPending}
                error={saveMutation.error}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            )}

            <section className={`content-grid ${["customers", "job-tickets", "production-schedule", "material-coated-stock", "suppliers", "presses", "flex-dies"].includes(resource.key) || isMaterialTypePage || isToolingConfigPage ? "wide-list" : ""}`}>
              <div className={`list-panel compact-card ${resource.viewMode === "customers" ? "customer-shell-panel" : ""}`}>
                {resource.viewMode !== "customers" && <div className="panel-head thin">
                  <div>
                    <p className="eyebrow">Records</p>
                    <h2>{listQuery.isLoading ? "Loading..." : `${visibleRows.length} shown`}</h2>
                  </div>
                </div>}

                {resource.viewMode === "customers" ? (
                  <CustomerWorkspace
                    rows={visibleRows}
                    allRows={rows}
                    totalCount={listQuery.data?.count ?? rows.length}
                    search={search}
                    selected={selected}
                    quotes={lookupQuery.data?.["quote-records"] ?? []}
                    orders={lookupQuery.data?.["customer-orders"] ?? []}
                    jobTickets={lookupQuery.data?.["job-tickets"] ?? []}
                    allJobTickets={lookupQuery.data?.["all-job-tickets"] ?? lookupQuery.data?.["job-tickets"] ?? []}
                    interactions={lookupQuery.data?.["customer-interactions"] ?? []}
                    openInteractions={lookupQuery.data?.["customer-open-interactions"] ?? []}
                    users={users}
                    currentUser={currentUserForView}
                    externalFollowUpSeed={customerFollowUpRequest}
                    interactionSaving={customerInteractionMutation.isPending}
                    openLogSaving={customerOpenLogUpdateMutation.isPending}
                    notifyTeamSaving={customerNotifyTeamMutation.isPending}
                    loading={lookupQuery.isLoading && Boolean(selected)}
                    onSearchChange={setSearch}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
                    onDelete={confirmDeleteRecord}
                    onAddInteraction={(payload) => customerInteractionMutation.mutateAsync(payload)}
                    onUpdateOpenLog={(payload) => customerOpenLogUpdateMutation.mutateAsync(payload)}
                    onNotifyTeam={(payload) => customerNotifyTeamMutation.mutateAsync(payload)}
                    onViewOrderSchedule={viewOrderOnSchedule}
                    onRestoreOrderSchedule={restoreOrderToSchedule}
                    orderScheduleRestoringId={orderRestoreScheduleMutation.isPending ? orderRestoreScheduleMutation.variables?.order?.id || "" : ""}
                    onFollowUpSeedHandled={() => setCustomerFollowUpRequest(null)}
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
                    focusScheduleId={scheduleFocusId}
                    onFocusHandled={() => setScheduleFocusId("")}
                    onSelect={(row) => { setSelected(row); setFormMode(null); }}
                    onClose={() => setSelected(null)}
                    onEdit={(row) => {
                      if (row) setSelected(row);
                      setFormMode("edit");
                    }}
                    onUpdate={(id, payload) => scheduleUpdateMutation.mutateAsync({ id, payload })}
                    onMaterialUpdate={(id, payload) => coaterScheduleUpdateMutation.mutateAsync({ id, payload })}
                    onOpenMaterialRun={resourceAvailableForRole(roleDefinitions, viewRoleName, "coater-operator") ? (row) => {
                      setCoaterScheduleStartId(String(row.id));
                      setLinkedRollTagId("");
                      setLinkedInventoryId("");
                      const url = new URL(window.location.href);
                      url.searchParams.delete("rollTagId");
                      url.searchParams.delete("inventoryId");
                      window.history.replaceState({}, "", url);
                      setSelected(null);
                      setFormMode(null);
                      setActiveKey("coater-operator");
                    } : undefined}
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
                    scheduleRows={lookupQuery.data?.["production-schedule"] ?? []}
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
                    loading={listQuery.isLoading || (listQuery.isFetching && !visibleRows.length)}
                    onSelect={(row) => {
                      setSelected(row);
                      setFormMode(null);
                      setUsageOpen(false);
                      finishedInventorySendMutation.reset();
                      finishedInventoryMoveMutation.reset();
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
                    loading={listQuery.isLoading || (lookupQuery.isLoading && !lookupQuery.data && !selected)}
                    setupLoading={lookupQuery.isLoading && !lookupQuery.data}
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
                      ? [
                        { label: "Schedule Material", className: "primary-btn xs", onClick: (row) => openMaterialDetail(row, true) },
                        ...(viewCanManageUsers ? [{ label: "Remove", className: "danger-btn xs", onClick: (row) => confirmDeleteRecord(row) }] : []),
                      ]
                      : resource.key === "material-coated-stock" && viewCanManageUsers
                        ? [{ label: "Remove", className: "danger-btn xs", onClick: (row) => confirmDeleteRecord(row) }]
                      : resource.key === "customer-orders"
                        ? [
                          {
                            key: "view-on-schedule",
                            label: "View on Schedule",
                            icon: CalendarSearch,
                            show: orderIsOnSchedule,
                            onClick: viewOrderOnSchedule,
                          },
                          {
                            key: "restore-to-schedule",
                            label: "Put Back on Schedule",
                            icon: RotateCcw,
                            className: "primary-btn xs",
                            show: orderCanRestoreToSchedule,
                            disabled: (row) => orderRestoreScheduleMutation.isPending && String(orderRestoreScheduleMutation.variables?.order?.id || "") === String(row.id),
                            onClick: restoreOrderToSchedule,
                          },
                        ]
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
                      currentUser={currentUserForView}
                      canProcessFlexDieRequests={canProcessFlexDieRequests}
                      onRequestsChanged={() => refreshFlexDie(selectedToolingItem)}
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
                allJobTickets={lookupQuery.data?.["all-job-tickets"] ?? rows}
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
                onOpenScheduleSuggestion={(ticket) => {
                  setSelected(ticket);
                  setFormMode(null);
                }}
                editorFields={resource.fields ?? []}
                renderEditorForm={({ onCancel, onFormChange }) => (
                  <RecordForm
                    resource={resource}
                    record={selected}
                    lookups={recordFormLookups}
                    submitting={jobTicketEditMutation.isPending}
                    error={jobTicketEditMutation.error}
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
                    error={jobTicketScheduleCreateMutation.error}
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
                error={saveMutation.error}
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
                error={saveMutation.error}
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
                error={saveMutation.error}
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
                error={saveMutation.error}
                onSubmit={(payload) => saveMutation.mutate(payload)}
                onCancel={closeRecordForm}
                canUseField={canUseRecordField}
              />
            </div>
          </section>
        )}

        {flexDieDetailOpen && resource.key === "flex-dies" && !showingFlexDieFormOverlay && (
          <section className="flex-die-folder-overlay" role="dialog" aria-modal="true" aria-label={`${selectedToolingItem ? getRecordTitle(selectedToolingItem) : "Loading"} flex die folder`}>
            <div className="flex-die-folder-window">
              <header className="flex-die-folder-window-head">
                <button className="ghost-btn" type="button" onClick={closeFlexDieFolder}>
                  <X size={16} /> Close
                </button>
              </header>

              {flexDieFolderLoading || flexDieFolderError ? (
                <FlexDieLoadingScreen compact scanned={Boolean(linkedFlexDieId)} error={flexDieFolderError} />
              ) : selectedToolingItem ? (
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
                  currentUser={currentUserForView}
                  canProcessFlexDieRequests={canProcessFlexDieRequests}
                  onRequestsChanged={() => refreshFlexDie(selectedToolingItem)}
                  presses={lookupQuery.data?.presses ?? []}
                  printingLabel={flexDieFolderLabelMutation.isPending}
                  printLabelError={apiErrorMessage(flexDieFolderLabelMutation.error)}
                  onPrintFolderLabel={(form) => flexDieFolderLabelMutation.mutateAsync({ die: selectedToolingItem, form })}
                />
              ) : (
                <FlexDieLoadingScreen compact error="No flex die record is selected." />
              )}
            </div>
          </section>
        )}

        {toolingWorkspaceForm && toolingWorkspaceResource && (
          <section className="tooling-form-overlay" role="dialog" aria-modal="true" aria-label={`${toolingWorkspaceForm.mode === "edit" ? "Edit" : "Add"} ${toolingWorkspaceResource.singular}`}>
            <div className={`tooling-form-window ${toolingWorkspaceResource.key === "recipe-tools" ? "recipe-tools-window" : ""}`}>
              <RecordForm
                resource={toolingWorkspaceResource}
                record={toolingWorkspaceForm.mode === "edit" ? toolingWorkspaceForm.record : null}
                defaults={toolingWorkspaceForm.mode === "create" ? toolingWorkspaceForm.defaults : {}}
                lookups={toolingWorkspaceLookups}
                submitting={toolingWorkspaceMutation.isPending}
                error={toolingWorkspaceMutation.error}
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
                error={toolingItemFormMutation.error}
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
                error={saveMutation.error}
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
            locations={lookupQuery.data?.locations ?? []}
            inventoryRows={rows}
            sending={finishedInventorySendMutation.isPending}
            moving={finishedInventoryMoveMutation.isPending}
            sendError={apiErrorMessage(finishedInventorySendMutation.error)}
            moveError={apiErrorMessage(finishedInventoryMoveMutation.error)}
            onClose={() => {
              setFinishedInventoryOpen(false);
              finishedInventorySendMutation.reset();
              finishedInventoryMoveMutation.reset();
            }}
            onEdit={() => {
              setFinishedInventoryOpen(false);
              setFormMode("edit");
            }}
            onSendOut={(payload) => finishedInventorySendMutation.mutateAsync({ id: selected.id, payload })}
            onMoveItem={(payload) => finishedInventoryMoveMutation.mutateAsync({ id: selected.id, payload })}
          />
        )}

        {rollOpen && canConsumeMaterial && (
          <RollWorkflowWindow
            roll={selected}
            locations={lookupQuery.data?.locations ?? []}
            usageRows={usageRows}
            submitting={rollActionMutation.isPending}
            canDelete={canDeleteMaterialRoll(currentUserForView)}
            onClose={() => setRollOpen(false)}
            onEdit={() => {
              setRollOpen(false);
              setFormMode("edit");
            }}
            onCheckOut={(payload) => rollActionMutation.mutate({ action: "check-out", payload })}
            onReturn={(payload) => rollActionMutation.mutate({ action: "return-roll", payload })}
            onUpdateStatus={(payload) => rollActionMutation.mutate({ action: "status", payload })}
            onDelete={() => setInventoryDeleteCandidate(selected)}
          />
        )}

        <DeleteMaterialRollDialog
          roll={inventoryDeleteCandidate}
          deleting={inventoryDeleteMutation.isPending}
          error={apiErrorMessage(inventoryDeleteMutation.error)}
          onCancel={() => {
            if (!inventoryDeleteMutation.isPending) {
              setInventoryDeleteCandidate(null);
              inventoryDeleteMutation.reset();
            }
          }}
          onConfirm={() => inventoryDeleteMutation.mutate(inventoryDeleteCandidate)}
        />

        {materialTypeManagerOpen && resource.key === "material-coated-stock" && (
          <MaterialTypeManager
            rows={materialMasterTypes}
            saving={materialTypeSaveMutation.isPending}
            deleting={materialTypeDeleteMutation.isPending}
            canDelete={viewCanManageUsers}
            onClose={() => setMaterialTypeManagerOpen(false)}
            onSave={(payload) => materialTypeSaveMutation.mutateAsync(payload)}
            onDelete={viewCanManageUsers ? (row) => materialTypeDeleteMutation.mutateAsync(row) : undefined}
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

        {finishedInventoryNotice && (
          <div className="finished-inventory-toast" role="status" aria-live="polite">
            <BadgeCheck size={18} />
            <span>{finishedInventoryNotice.message}</span>
          </div>
        )}
    </AppShell>
  );
}
