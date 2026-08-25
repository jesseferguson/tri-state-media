import { useEffect } from "react";
import { Menu } from "lucide-react";

import AppErrorStack from "../components/AppErrorStack.jsx";
import AppSidebar from "../navigation/AppSidebar.jsx";
import AppTopbar from "../navigation/AppTopbar.jsx";
import MobilePageMenu from "../navigation/MobilePageMenu.jsx";
import MobileShellBar from "../navigation/MobileShellBar.jsx";

export default function AppShell({
  singleResourceMode,
  liveFootageFullView,
  directScanResourceKey,
  materialWorkspaceView,
  desktopSidebarOpen,
  mobilePageMenuOpen,
  currentUser,
  users,
  resource,
  activePreviewRoleName,
  canManageUsers,
  roleDefinitions,
  landingPageOptions,
  pinnedPages = [],
  pagePinned = false,
  canPinPage = false,
  canProcessFlexDieRequests,
  mobilePageSearch,
  mobileMenuGroups,
  allowedResources,
  openGroups,
  showingStaticView,
  appErrorMessages,
  children,
  onOpenDesktopSidebar = () => {},
  onCloseDesktopSidebar = () => {},
  onOpenMobileMenu,
  onCloseMobileMenu,
  onMobilePageSearchChange,
  onSelectResource,
  onToggleGroup,
  onOpenLiveFootage,
  onRefresh,
  onOpenMaterialTypes,
  onCreate,
  onPreviewRoleChange,
  onOpenUserAdmin,
  onQuoteCompanyChange,
  onDefaultLandingPageChange,
  onTogglePinnedPage,
  onSignOut,
}) {
  const showDesktopNavigation = !singleResourceMode && !liveFootageFullView;
  const shellClassName = [
    "app-shell",
    singleResourceMode ? "single-resource-app" : "",
    liveFootageFullView ? "live-footage-tv-shell" : "",
    directScanResourceKey ? "storage-scan-shell" : "",
    materialWorkspaceView ? "material-workspace-shell" : "",
    desktopSidebarOpen ? "desktop-nav-open" : "",
    mobilePageMenuOpen ? "mobile-nav-open" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!desktopSidebarOpen || !showDesktopNavigation) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") onCloseDesktopSidebar();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [desktopSidebarOpen, onCloseDesktopSidebar, showDesktopNavigation]);

  return (
    <main className={shellClassName}>
      <MobileShellBar
        singleResourceMode={singleResourceMode}
        currentUser={currentUser}
        users={users}
        resource={resource}
        activePreviewRoleName={activePreviewRoleName}
        canManageUsers={canManageUsers}
        roleDefinitions={roleDefinitions}
        landingPageOptions={landingPageOptions}
        canProcessFlexDieRequests={canProcessFlexDieRequests}
        onOpenMenu={onOpenMobileMenu}
        onPreviewRoleChange={onPreviewRoleChange}
        onOpenUserAdmin={onOpenUserAdmin}
        onQuoteCompanyChange={onQuoteCompanyChange}
        onDefaultLandingPageChange={onDefaultLandingPageChange}
        onSignOut={onSignOut}
      />

      {mobilePageMenuOpen && (
        <MobilePageMenu
          currentUser={currentUser}
          activePreviewRoleName={activePreviewRoleName}
          resource={resource}
          search={mobilePageSearch}
          groups={mobileMenuGroups}
          onSearchChange={onMobilePageSearchChange}
          onSelectResource={onSelectResource}
          onClose={onCloseMobileMenu}
        />
      )}

      {showDesktopNavigation && (
        <>
          <button
            className="desktop-sidebar-trigger"
            type="button"
            onClick={onOpenDesktopSidebar}
            aria-label="Open navigation menu"
            aria-expanded={desktopSidebarOpen}
            aria-controls="app-sidebar"
            title="Open navigation menu"
          >
            <Menu size={20} />
            <span>
              <small>Menu</small>
              <strong>{resource.label}</strong>
            </span>
          </button>
          {desktopSidebarOpen && (
            <>
              <button className="desktop-sidebar-backdrop" type="button" onClick={onCloseDesktopSidebar} aria-label="Close navigation menu" />
              <AppSidebar
                id="app-sidebar"
                open={desktopSidebarOpen}
                allowedResources={allowedResources}
                resource={resource}
                pinnedPages={pinnedPages}
                openGroups={openGroups}
                onToggleGroup={onToggleGroup}
                onSelectResource={onSelectResource}
                onOpenLiveFootage={onOpenLiveFootage}
                onClose={onCloseDesktopSidebar}
              />
            </>
          )}
        </>
      )}

      <section className="work-area">
        {!liveFootageFullView && (
          <AppTopbar
            resource={resource}
            showingStaticView={showingStaticView}
            currentUser={currentUser}
            users={users}
            activePreviewRoleName={activePreviewRoleName}
            canManageUsers={canManageUsers}
            roleDefinitions={roleDefinitions}
            landingPageOptions={landingPageOptions}
            pagePinned={pagePinned}
            canPinPage={canPinPage}
            canProcessFlexDieRequests={canProcessFlexDieRequests}
            onRefresh={onRefresh}
            onOpenMaterialTypes={onOpenMaterialTypes}
            onCreate={onCreate}
            onPreviewRoleChange={onPreviewRoleChange}
            onOpenUserAdmin={onOpenUserAdmin}
            onQuoteCompanyChange={onQuoteCompanyChange}
            onDefaultLandingPageChange={onDefaultLandingPageChange}
            onTogglePinnedPage={onTogglePinnedPage}
            onSignOut={onSignOut}
          />
        )}

        <AppErrorStack messages={appErrorMessages} />

        {children}
      </section>
    </main>
  );
}
