import { Pin, Plus, RefreshCcw } from "lucide-react";

import { MessagesCenter } from "../../features/messages";
import AccountMenu from "../auth/AccountMenu.jsx";

function AppTopbar({
  resource,
  showingStaticView,
  currentUser,
  users,
  activePreviewRoleName,
  canManageUsers,
  roleDefinitions,
  landingPageOptions,
  pagePinned = false,
  canPinPage = false,
  canProcessFlexDieRequests,
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
  const createLabel = resource.key === "raw-materials"
    ? "Add Inventory Roll"
    : resource.key === "material-coated-stock"
      ? "Add Material"
      : "Add";

  return (
    <header className="topbar compact-card">
      <div>
        <p className="eyebrow">{resource.singular}</p>
        <h2>{resource.label}</h2>
        <p>{resource.tagline}</p>
      </div>
      <div className="top-actions">
        {canPinPage && (
          <button
            className={`ghost-btn page-pin-btn ${pagePinned ? "active" : ""}`}
            type="button"
            onClick={onTogglePinnedPage}
            title={pagePinned ? "Unpin this page" : "Pin this page"}
            aria-pressed={pagePinned}
          >
            <Pin size={15} />
            {pagePinned ? "Pinned" : "Pin"}
          </button>
        )}
        {!showingStaticView && <button className="ghost-btn" type="button" onClick={onRefresh}><RefreshCcw size={15} /> Refresh</button>}
        {resource.key === "material-coated-stock" && !showingStaticView && (
          <button className="ghost-btn" type="button" onClick={onOpenMaterialTypes}>Material Types</button>
        )}
        {!resource.disableCreate && !showingStaticView && (
          <button className="primary-btn" type="button" onClick={onCreate}><Plus size={16} /> {createLabel}</button>
        )}
        <MessagesCenter currentUser={currentUser} users={users} canProcessFlexDieRequests={canProcessFlexDieRequests} />
        <AccountMenu
          currentUser={currentUser}
          canManageUsers={canManageUsers}
          roleDefinitions={roleDefinitions}
          landingPageOptions={landingPageOptions}
          previewRoleName={activePreviewRoleName}
          onPreviewRoleChange={onPreviewRoleChange}
          onOpenUserAdmin={onOpenUserAdmin}
          onQuoteCompanyChange={onQuoteCompanyChange}
          onDefaultLandingPageChange={onDefaultLandingPageChange}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}

export default AppTopbar;
