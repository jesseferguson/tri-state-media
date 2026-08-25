import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pin, Search, X } from "lucide-react";

import { PressSpeedSidebarWidget } from "../../features/production";
import { resourceGroups } from "../../resourceConfig";
import { navigationResourcesForGroup, topLevelGroups } from "./navigationModel";

function resourceMatchesSearch(item, groupLabel, query) {
  if (!query) return true;
  return `${item.label ?? ""} ${item.singular ?? ""} ${groupLabel ?? ""}`.toLowerCase().includes(query);
}

function AppSidebar({
  id = "app-sidebar",
  open = true,
  allowedResources,
  resource,
  pinnedPages = [],
  openGroups,
  onToggleGroup,
  onSelectResource,
  onOpenLiveFootage,
  onClose,
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visiblePinnedPages = useMemo(
    () => pinnedPages.filter((item) => resourceMatchesSearch(item, "Pinned Pages", query)),
    [pinnedPages, query]
  );

  const sections = useMemo(() => topLevelGroups
    .map((group) => {
      const childGroups = resourceGroups.filter((item) => item.parent === group.key);
      const groupResources = navigationResourcesForGroup(allowedResources, group.key);
      const directItems = groupResources.filter((item) => resourceMatchesSearch(item, group.label, query));
      const childSections = childGroups
        .map((child) => {
          const allItems = navigationResourcesForGroup(allowedResources, child.key);
          const items = allItems.filter((item) => resourceMatchesSearch(item, child.label, query));
          return {
            ...child,
            allItems,
            items,
            active: allItems.some((item) => item.key === resource.key),
            open: Boolean(query) || Boolean(openGroups[child.key]),
          };
        })
        .filter((child) => child.allItems.length && (!query || child.items.length));
      const activeInGroup = groupResources.some((item) => item.key === resource.key)
        || childSections.some((child) => child.active);
      const hasVisibleContent = groupResources.length || childSections.length;
      const hasSearchMatches = directItems.length || childSections.some((child) => child.items.length);
      if (!hasVisibleContent || (query && !hasSearchMatches)) return null;
      return {
        ...group,
        directItems,
        childSections,
        active: activeInGroup,
        open: Boolean(query) || Boolean(openGroups[group.key]),
      };
    })
    .filter(Boolean), [allowedResources, openGroups, query, resource.key]);

  function renderResourceButton(item) {
    const Icon = item.icon;
    const active = item.key === resource.key;
    return (
      <button
        className={`nav-btn ${active ? "active" : ""}`}
        type="button"
        key={item.key}
        onClick={() => onSelectResource(item.key)}
        style={{ "--accent": item.accent }}
      >
        <Icon size={16} />
        <span>{item.label}</span>
      </button>
    );
  }

  return (
    <aside id={id} className={`sidebar desktop-sidebar ${open ? "open" : ""} ${pinnedPages.length ? "has-pinned-pages" : ""}`} aria-label="Primary navigation">
      <header className="desktop-sidebar-head">
        <div>
          <span>Workspace Menu</span>
          <strong>Navigation</strong>
          <em>{resource.label}</em>
        </div>
        <button className="desktop-sidebar-close" type="button" onClick={onClose} aria-label="Close navigation menu">
          <X size={18} />
        </button>
      </header>

      <label className="desktop-sidebar-search">
        <Search size={17} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pages..." />
      </label>

      <PressSpeedSidebarWidget onOpenLiveFootage={onOpenLiveFootage} />

      {pinnedPages.length > 0 && (
        <section className="desktop-sidebar-pins" aria-label="Pinned pages">
          <header>
            <span><Pin size={13} /> Pinned</span>
            <em>{pinnedPages.length}</em>
          </header>
          <div className="desktop-sidebar-pin-list">
            {visiblePinnedPages.map(renderResourceButton)}
            {!visiblePinnedPages.length && <p>No pinned pages match.</p>}
          </div>
        </section>
      )}

      <nav className="desktop-sidebar-nav">
        {sections.map((group) => (
          <section className={`nav-group ${group.active ? "has-active" : ""}`} key={group.key}>
            <button className="nav-group-toggle" type="button" onClick={() => onToggleGroup(group.key)} aria-expanded={group.open}>
              <span>{group.label}</span>
              {group.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>

            {group.open && (
              <div className="nav-submenu">
                {group.directItems.map(renderResourceButton)}

                {group.childSections.map((child) => (
                  <div className={`nav-child-group ${child.active ? "has-active" : ""}`} key={child.key}>
                    <button className="nav-child-toggle" type="button" onClick={() => onToggleGroup(child.key)} aria-expanded={child.open}>
                      <span>{child.label}</span>
                      {child.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    {child.open && (
                      <div className="nav-child-submenu">
                        {child.items.map(renderResourceButton)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
        {!sections.length && <p className="desktop-sidebar-empty">No pages match that search.</p>}
      </nav>
    </aside>
  );
}

export default AppSidebar;
