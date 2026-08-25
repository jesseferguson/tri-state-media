import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, PackagePlus, Search } from "lucide-react";
import FlexDieRequestQueue from "./FlexDieRequestQueue";
import FlexDieSearch from "./FlexDieSearch";

function numberValue(value) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function activeFilterCount(filters) {
  return Object.values(filters ?? {}).filter((value) => String(value ?? "").trim() !== "").length;
}

export default function FlexDieWorkspacePanel({
  filters,
  setFilters,
  liners = [],
  rows = [],
  resultCount = 0,
  totalCount = 0,
  resourceLabel = "Flex Die",
  currentUser,
  canProcessFlexDieRequests = false,
  loading = false,
  onRequestsChanged,
}) {
  const [activeTab, setActiveTab] = useState("search");

  useEffect(() => {
    if (!canProcessFlexDieRequests && activeTab === "processing") setActiveTab("search");
  }, [activeTab, canProcessFlexDieRequests]);

  const stats = useMemo(() => {
    const needDie = rows.filter((die) => numberValue(die.active_die_count) < 1).length;
    const belowTarget = rows.filter((die) => {
      const active = numberValue(die.active_die_count);
      const target = numberValue(die.target_die_count);
      return target > 0 && active < target;
    }).length;
    return {
      activeFilters: activeFilterCount(filters),
      belowTarget,
      needDie,
    };
  }, [filters, rows]);

  const tabs = [
    { key: "search", label: "Search", icon: Search, badge: resultCount },
    ...(canProcessFlexDieRequests ? [{ key: "processing", label: "Processing", icon: PackagePlus }] : []),
  ];

  return (
    <section className="flex-die-workbench compact-card">
      <header className="flex-die-workbench-head">
        <div className="flex-die-workbench-title">
          <p className="eyebrow">Flex Die</p>
          <h3>Folder Control</h3>
        </div>
        <div className="flex-die-workbench-stats" aria-label="Flex die folder counts">
          <div>
            <span>Shown</span>
            <strong>{loading ? "--" : resultCount}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{loading ? "--" : totalCount}</strong>
          </div>
          <div className={stats.belowTarget ? "warn" : ""}>
            <span>Below Target</span>
            <strong>{loading ? "--" : stats.belowTarget}</strong>
          </div>
          <div className={stats.needDie ? "bad" : ""}>
            <span>Need Die</span>
            <strong>{loading ? "--" : stats.needDie}</strong>
          </div>
        </div>
      </header>

      <nav className="flex-die-workbench-tabs" aria-label="Flex die tools">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button className={activeTab === tab.key ? "active" : ""} type="button" key={tab.key} onClick={() => setActiveTab(tab.key)}>
              <Icon size={16} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && <strong>{tab.badge}</strong>}
            </button>
          );
        })}
        {stats.activeFilters > 0 && (
          <span className="flex-die-filter-badge">
            <ClipboardList size={14} />
            {stats.activeFilters} active
          </span>
        )}
        {(stats.belowTarget > 0 || stats.needDie > 0) && (
          <span className="flex-die-alert-badge">
            <AlertTriangle size={14} />
            {stats.belowTarget || stats.needDie}
          </span>
        )}
      </nav>

      <div className="flex-die-workbench-body">
        {activeTab === "processing" && canProcessFlexDieRequests ? (
          <FlexDieRequestQueue
            currentUser={currentUser}
            canProcess={canProcessFlexDieRequests}
            compact
            embedded
            title="Processing"
            emptyText="No open flex die requests."
            onChanged={onRequestsChanged}
          />
        ) : (
          <FlexDieSearch
            filters={filters}
            setFilters={setFilters}
            liners={liners}
            resultCount={resultCount}
            totalCount={totalCount}
            resourceLabel={resourceLabel}
            embedded
          />
        )}
      </div>
    </section>
  );
}
