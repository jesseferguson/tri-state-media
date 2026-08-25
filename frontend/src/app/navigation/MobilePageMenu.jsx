import { ChevronRight, Search, X } from "lucide-react";

function MobilePageMenu({
  currentUser,
  activePreviewRoleName,
  resource,
  search,
  groups,
  onSearchChange,
  onSelectResource,
  onClose,
}) {
  return (
    <section className="mobile-page-menu-overlay" role="dialog" aria-modal="true" aria-label="Choose a page">
      <button className="mobile-page-menu-backdrop" type="button" onClick={onClose} aria-label="Close navigation menu" />
      <div className="mobile-page-menu-window">
        <header>
          <div>
            <span>{currentUser.name}</span>
            <strong>Navigation</strong>
            <em>{activePreviewRoleName ? `Viewing ${activePreviewRoleName}` : currentUser.role}</em>
          </div>
          <button type="button" onClick={onClose} aria-label="Close navigation menu">
            <X size={18} />
          </button>
        </header>
        <label className="mobile-page-search">
          <Search size={17} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search pages..." />
        </label>
        <div className="mobile-page-groups">
          {groups.map((group) => (
            <details className="mobile-page-group" key={group.key} open={search.trim() ? true : undefined}>
              <summary><strong>{group.label}</strong><span>{group.items.length}</span></summary>
              <div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button className={item.key === resource.key ? "active" : ""} type="button" key={item.key} onClick={() => onSelectResource(item.key)} style={{ "--accent": item.accent }}>
                      <span><Icon size={18} /></span>
                      <strong>{item.label}</strong>
                      {item.key === resource.key ? <b>Current</b> : <ChevronRight size={16} />}
                    </button>
                  );
                })}
              </div>
            </details>
          ))}
          {!groups.length && <p className="mobile-page-empty">No pages match that search.</p>}
        </div>
      </div>
    </section>
  );
}

export default MobilePageMenu;
