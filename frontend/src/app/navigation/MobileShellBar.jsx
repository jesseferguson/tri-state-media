import { Menu } from "lucide-react";

import { MessagesCenter } from "../../features/messages";
import AccountMenu from "../auth/AccountMenu.jsx";

function MobileShellBar({
  singleResourceMode,
  currentUser,
  users,
  resource,
  activePreviewRoleName,
  canManageUsers,
  roleDefinitions,
  landingPageOptions,
  canProcessFlexDieRequests,
  onOpenMenu,
  onPreviewRoleChange,
  onOpenUserAdmin,
  onQuoteCompanyChange,
  onDefaultLandingPageChange,
  onSignOut,
}) {
  return (
    <section className="mobile-shell-bar compact-card">
      {!singleResourceMode && (
        <button className="mobile-page-menu-trigger" type="button" onClick={onOpenMenu} aria-label="Open navigation menu">
          <Menu size={22} />
          <span><small>Menu</small><strong>Pages</strong></span>
        </button>
      )}
      <div className="mobile-user-block">
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
        <div>
          <p className="eyebrow">Tri-State Media</p>
          <strong>{currentUser.name}</strong>
          <span>{activePreviewRoleName ? `Viewing ${activePreviewRoleName}` : currentUser.role} / {resource.label}</span>
        </div>
      </div>
      <div className="mobile-shell-actions">
        <MessagesCenter currentUser={currentUser} users={users} compact showToast={false} canProcessFlexDieRequests={canProcessFlexDieRequests} />
      </div>
    </section>
  );
}

export default MobileShellBar;
