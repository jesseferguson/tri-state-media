import { useState } from "react";
import { Building2, ChevronDown, Home, LogOut, Shield, ShieldCheck, Users } from "lucide-react";

import { quoteCompanyKey, quoteCompanyOptions } from "../../lib/quoteCompanies";

function AccountMenu({
  currentUser,
  canManageUsers,
  roleDefinitions = [],
  landingPageOptions = [],
  previewRoleName = "",
  onPreviewRoleChange,
  onOpenUserAdmin,
  onQuoteCompanyChange,
  onDefaultLandingPageChange,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const activeQuoteCompany = quoteCompanyKey(currentUser?.quoteCompany);
  const activeRoleLabel = previewRoleName || currentUser?.role || "";
  const activeLandingPage = landingPageOptions.some((item) => item.key === currentUser?.defaultLandingPage)
    ? currentUser.defaultLandingPage
    : "";

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
          <div className="account-landing-card">
            <span>Default Landing Page</span>
            <label>
              <Home size={14} />
              <select value={activeLandingPage} onChange={(event) => onDefaultLandingPageChange?.(event.target.value)}>
                <option value="">System default</option>
                {landingPageOptions.map((item) => (
                  <option value={item.key} key={item.key}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
          {canManageUsers && <button type="button" onClick={openUsers}><Users size={15} /> Manage Users</button>}
          <button type="button" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={15} /> Sign Out</button>
        </div>
      )}
    </div>
  );
}

export default AccountMenu;
