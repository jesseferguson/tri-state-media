import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, RefreshCcw, Search, X } from "lucide-react";
import { createRecord, deleteRecord, fetchCollection, updateRecord } from "./api";
import { resourceGroups, resourceMap, resources } from "./resourceConfig";
import RecordForm from "./components/RecordForm";
import ResourceTable from "./components/ResourceTable";
import FlexDieSearch from "./components/FlexDieSearch";
import FinishedMaterialWindow from "./components/FinishedMaterialWindow";
import JobTicketPanel from "./components/JobTicketPanel";
import MaterialInventoryView from "./components/MaterialInventoryView";
import MaterialUsageWindow from "./components/MaterialUsageWindow";
import QuickRollEntry from "./components/QuickRollEntry";
import RecipeOptionsView from "./components/RecipeOptionsView";
import RecipeToolStackView from "./components/RecipeToolStackView";
import RollWorkflowWindow from "./components/RollWorkflowWindow";
import { emptyFlexDieFilters, filterFlexDies, filterRows } from "./lib/filtering";
import { formatCell, getRecordTitle } from "./lib/format";

function labelForField(resource, key) {
  const field = (resource.fields ?? []).find((item) => item.name === key);
  return field?.label ?? key.replace(/_/g, " ");
}

function getDetailKeys(resource, record) {
  const fieldNames = (resource.fields ?? []).map((field) => field.name);
  const seen = new Set();

  return [...(resource.columns ?? []), ...fieldNames, ...Object.keys(record ?? {})].filter((key) => {
    if (seen.has(key) || key === "id" || key.endsWith("_details")) return false;
    const value = record?.[key];
    if (value === undefined) return false;
    if (Array.isArray(value) && !value.length) return false;
    if (value && typeof value === "object" && !Array.isArray(value)) return false;
    if ((key.endsWith("_name") || key.endsWith("_label")) && fieldNames.includes(key.replace(/_(name|label)$/, ""))) return false;
    seen.add(key);
    return true;
  });
}

function detailValue(record, key) {
  const relationText = record?.[`${key}_name`] ?? record?.[`${key}_label`] ?? record?.[`${key}_number`] ?? record?.[`${key}_serial`];
  if (relationText && (record?.[key] === null || record?.[key] === undefined || typeof record?.[key] === "number")) return String(relationText);

  const value = record?.[key];
  if (Array.isArray(value)) return value.length ? value.join(", ") : "--";
  return formatCell(record, key);
}

async function loadAllLookups() {
  return Promise.all(
    resources.map((resource) =>
      fetchCollection(resource.endpoint, { ordering: resource.defaultOrdering, pageSize: 1000, filters: resource.filters ?? {} })
        .then((payload) => [resource.key, payload.results])
        .catch(() => [resource.key, []])
    )
  ).then(Object.fromEntries);
}

function currentInventoryQuantity(roll) {
  return Number(roll?.length_feet ?? roll?.quantity ?? 0) || 0;
}

function rollUsagePayload(roll, overrides = {}) {
  return {
    inventory: roll.id,
    material: roll.material,
    unit: roll.unit || "lf",
    used_date: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

const initialOpenGroups = Object.fromEntries(
  resourceGroups.map((group) => [group.key, Boolean(group.defaultOpen)])
);

const topLevelGroups = resourceGroups.filter((group) => !group.parent);

export default function App() {
  const queryClient = useQueryClient();
  const [activeKey, setActiveKey] = useState("job-tickets");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [formMode, setFormMode] = useState(null); // null | create | edit
  const [createDefaults, setCreateDefaults] = useState({});
  const [flexFilters, setFlexFilters] = useState(emptyFlexDieFilters);
  const [openGroups, setOpenGroups] = useState(initialOpenGroups);
  const [usageOpen, setUsageOpen] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [finishedMaterialOpen, setFinishedMaterialOpen] = useState(false);
  const [localUsageEvents, setLocalUsageEvents] = useState([]);

  const resource = resourceMap[activeKey] ?? resources[0];
  const showingJobTicketOverlay = resource.key === "job-tickets" && selected;

  const listQuery = useQuery({
    queryKey: ["collection", resource.key, resource.filters ?? {}],
    queryFn: async () => {
      try {
        return await fetchCollection(resource.endpoint, { ordering: resource.defaultOrdering, pageSize: 1000, filters: resource.filters ?? {} });
      } catch (error) {
        if (resource.key === "material-usages" && String(error.message).includes("404")) {
          return { count: 0, results: [], raw: { missingEndpoint: true } };
        }
        throw error;
      }
    },
    keepPreviousData: true,
  });

  const lookupQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: loadAllLookups,
    staleTime: 60_000,
  });

  const rows = listQuery.data?.results ?? [];
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
      return usages.filter((row) => String(row.material) === String(selected.id));
    }

    return [];
  }, [localUsageEvents, lookupQuery.data, resource.endpoint, resource.key, selected]);
  const selectedMaterialInventoryRows = useMemo(() => {
    if (!selected || resource.key !== "material-coated-stock") return [];
    return (lookupQuery.data?.["raw-materials"] ?? []).filter((row) => String(row.material) === String(selected.id));
  }, [lookupQuery.data, resource.key, selected]);

  const canShowUsage = Boolean(selected) && (
    resource.key === "raw-materials" ||
    resource.key === "finished-inventory" ||
    resource.endpoint === "materials"
  );
  const canConsumeMaterial = Boolean(selected) && resource.key === "raw-materials";
  const visibleRows = useMemo(() => {
    if (resource.searchMode === "flexDie") return filterFlexDies(rows, flexFilters);
    const filtered = filterRows(rows, search);
    if (resource.key === "raw-materials") {
      return filtered.filter((row) => !["in_use", "depleted", "scrapped"].includes(row.status));
    }
    return filtered;
  }, [rows, search, flexFilters, resource.searchMode]);

  const saveMutation = useMutation({
    mutationFn: (payload) => formMode === "edit" && selected?.id
      ? updateRecord(resource.endpoint, selected.id, payload)
      : createRecord(resource.endpoint, payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? null);
      setFormMode(null);
      setCreateDefaults({});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRecord(resource.endpoint, selected.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", resource.key] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(null);
      setFormMode(null);
      setCreateDefaults({});
    },
  });

  async function fallbackRollAction(action, payload) {
    const roll = selected;
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
      }
      queryClient.invalidateQueries({ queryKey: ["collection"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setSelected(saved ?? selected);
    },
  });

  const quickRollMutation = useMutation({
    mutationFn: (payload) => createRecord("raw-materials", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });
  const finishedScheduleMutation = useMutation({
    mutationFn: async ({ material, schedule }) => {
      const required = [
        ["face_material", "Face Type"],
        ["liner_material", "Liner Type"],
        ["adhesive_material", "Adhesive Type"],
        ["silicone_material", "Silicone Type"],
      ];
      const missing = required.filter(([key]) => !material[key]).map(([, label]) => label);
      if (missing.length) {
        throw new Error(`Add these component types before scheduling: ${missing.join(", ")}`);
      }

      let etiPress = (lookupQuery.data?.presses ?? []).find((press) => String(press.name ?? "").trim().toLowerCase() === "eti");
      if (!etiPress) {
        etiPress = await createRecord("presses", {
          name: "ETI",
          is_active: true,
        });
      }
      return createRecord("coater-roll-tags", {
        name: material.name || material.material_family || material.code,
        status: "scheduled",
        print_status: "not_printed",
        scheduled_material: material.id,
        produced_material: material.id,
        liner: material.liner_material,
        face: material.face_material,
        adhesive: material.adhesive_material,
        silicone: material.silicone_material,
        coating: material.coating_material || null,
        result_code: material.code,
        length_feet: schedule.feet,
        cut_description: schedule.cut_description,
        operator_notes: schedule.operator_notes,
        notes: [
          schedule.cut_description ? `Cut: ${schedule.cut_description}` : "",
          schedule.operator_notes ? `Operator note: ${schedule.operator_notes}` : "",
        ].filter(Boolean).join("\n"),
        press: etiPress?.id ?? null,
        log_inventory: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  function switchResource(key) {
    setActiveKey(key);
    setSelected(null);
    setFormMode(null);
    setCreateDefaults({});
    setUsageOpen(false);
    setRollOpen(false);
    setFinishedMaterialOpen(false);
    setSearch("");
    const nextGroup = resourceMap[key]?.group;
    if (nextGroup) setOpenGroups((prev) => ({ ...prev, [nextGroup]: true }));
  }

  function toggleGroup(key) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">Tooling Control</p>
          <h1>Recipes + Tools</h1>
          <p>Compact setup library built for future recipe recommendations.</p>
        </div>

        {topLevelGroups.map((group) => {
          const childGroups = resourceGroups.filter((item) => item.parent === group.key);
          const groupResources = resources.filter((item) => item.group === group.key);
          const activeInGroup = groupResources.some((item) => item.key === resource.key) || childGroups.some((child) => resources.some((item) => item.group === child.key && item.key === resource.key));
          const open = openGroups[group.key] || activeInGroup;
          if (!groupResources.length && !childGroups.length) return null;

          return (
            <section className={`nav-group ${activeInGroup ? "has-active" : ""}`} key={group.key}>
              <button className="nav-group-toggle" type="button" onClick={() => toggleGroup(group.key)}>
                <span>{group.label}</span>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>

              {open && (
                <div className="nav-submenu">
                  {groupResources.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === resource.key;
                    return (
                      <button className={`nav-btn ${active ? "active" : ""}`} type="button" key={item.key} onClick={() => switchResource(item.key)} style={{ "--accent": item.accent }}>
                        <Icon size={16} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}

                  {childGroups.map((child) => {
                    const childResources = resources.filter((item) => item.group === child.key);
                    const activeInChild = childResources.some((item) => item.key === resource.key);
                    const childOpen = openGroups[child.key] || activeInChild;
                    if (!childResources.length) return null;

                    return (
                      <div className={`nav-child-group ${activeInChild ? "has-active" : ""}`} key={child.key}>
                        <button className="nav-child-toggle" type="button" onClick={() => toggleGroup(child.key)}>
                          <span>{child.label}</span>
                          {childOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {childOpen && (
                          <div className="nav-child-submenu">
                            {childResources.map((item) => {
                              const Icon = item.icon;
                              const active = item.key === resource.key;
                              return (
                                <button className={`nav-btn ${active ? "active" : ""}`} type="button" key={item.key} onClick={() => switchResource(item.key)} style={{ "--accent": item.accent }}>
                                  <Icon size={16} />
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </aside>

      <section className="work-area">
        <header className="topbar compact-card">
          <div>
            <p className="eyebrow">{resource.singular}</p>
            <h2>{resource.label}</h2>
            <p>{resource.tagline}</p>
          </div>
          <div className="top-actions">
            <button className="ghost-btn" type="button" onClick={() => listQuery.refetch()}><RefreshCcw size={15} /> Refresh</button>
            {!resource.disableCreate && (
              <button className="primary-btn" type="button" onClick={() => { setSelected(null); setCreateDefaults({}); setFormMode("create"); }}><Plus size={16} /> Add</button>
            )}
          </div>
        </header>

        {saveMutation.error && <div className="error-box">{saveMutation.error.message}</div>}
        {quickRollMutation.error && <div className="error-box">{quickRollMutation.error.message}</div>}
        {finishedScheduleMutation.error && <div className="error-box">{finishedScheduleMutation.error.message}</div>}
        {deleteMutation.error && <div className="error-box">{deleteMutation.error.message}</div>}
        {rollActionMutation.error && <div className="error-box">{rollActionMutation.error.message}</div>}
        {listQuery.error && <div className="error-box">Could not load {resource.label}: {listQuery.error.message}</div>}
        {resource.key === "material-usages" && listQuery.data?.raw?.missingEndpoint && (
          <div className="error-box">Material Usage needs the latest backend migration/restart before it can load saved usage records.</div>
        )}
        {lookupQuery.error && <div className="error-box">Could not load lookup data: {lookupQuery.error.message}</div>}

        {resource.searchMode === "flexDie" ? (
          <FlexDieSearch filters={flexFilters} setFilters={setFlexFilters} />
        ) : (
          <section className="search-line compact-card">
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${resource.label.toLowerCase()}...`} />
            <span>{visibleRows.length} / {rows.length}</span>
          </section>
        )}

        {formMode && !(showingJobTicketOverlay && formMode === "edit") && (
          <RecordForm
            resource={resource}
            record={formMode === "edit" ? selected : null}
            defaults={formMode === "create" ? createDefaults : {}}
            lookups={lookupQuery.data ?? {}}
            submitting={saveMutation.isPending}
            onSubmit={(payload) => saveMutation.mutate(payload)}
            onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
          />
        )}

        <section className={`content-grid ${resource.key === "job-tickets" ? "wide-list" : ""}`}>
          <div className="list-panel compact-card">
            <div className="panel-head thin">
              <div>
                <p className="eyebrow">Records</p>
                <h2>{listQuery.isLoading ? "Loading..." : `${visibleRows.length} shown`}</h2>
              </div>
            </div>

            {resource.viewMode === "materialInventory" ? (
              <>
                <QuickRollEntry
                  materials={lookupQuery.data?.materials ?? []}
                  locations={lookupQuery.data?.locations ?? []}
                  submitting={quickRollMutation.isPending}
                  onSubmit={(payload) => quickRollMutation.mutate(payload)}
                />
                <MaterialInventoryView
                  rows={visibleRows}
                  selectedId={selected?.id}
                  onSelect={(row) => { setSelected(row); setFormMode(null); setUsageOpen(false); setRollOpen(true); }}
                />
              </>
            ) : resource.key === "recipe-options" ? (
              <RecipeOptionsView rows={visibleRows} onEdit={(row) => { setSelected(row); setFormMode("edit"); }} />
            ) : resource.key === "recipe-tools" ? (
              <RecipeToolStackView
                rows={visibleRows}
                selectedId={selected?.id}
                onSelect={(row) => { setSelected(row); setFormMode(null); }}
                onEdit={(row) => { setSelected(row); setFormMode("edit"); }}
              />
            ) : (
              <ResourceTable
                resource={resource}
                rows={visibleRows}
                selectedId={selected?.id}
                onSelect={(row) => {
                  setSelected(row);
                  setFormMode(null);
                  if (resource.key === "material-coated-stock") setFinishedMaterialOpen(true);
                }}
              />
            )}
          </div>

          {resource.key !== "job-tickets" && resource.key !== "raw-materials" && resource.key !== "material-coated-stock" && (
            <aside className="detail-panel compact-card">
              {selected ? (
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

        {showingJobTicketOverlay && (
          <section className="job-overlay" role="dialog" aria-modal="true" aria-label="Job ticket packet">
            <div className="job-overlay-shell compact-card">
              <header className="job-overlay-head">
                <div>
                  <p className="eyebrow">{formMode === "edit" ? "Edit Job Ticket" : "Job Ticket"}</p>
                  <h2>{getRecordTitle(selected)}</h2>
                </div>
                <button className="ghost-btn" type="button" onClick={() => { setSelected(null); setFormMode(null); }}>
                  <X size={16} /> Close
                </button>
              </header>

              {formMode === "edit" ? (
                <RecordForm
                  resource={resource}
                  record={selected}
                  lookups={lookupQuery.data ?? {}}
                  submitting={saveMutation.isPending}
                  onSubmit={(payload) => saveMutation.mutate(payload)}
                  onCancel={() => { setFormMode(null); setCreateDefaults({}); }}
                />
              ) : (
                <JobTicketPanel
                  ticket={selected}
                  lookups={lookupQuery.data ?? {}}
                  editing={formMode === "edit"}
                  deleting={deleteMutation.isPending}
                  onEdit={() => setFormMode("edit")}
                  onDelete={() => deleteMutation.mutate()}
                  onSchedule={() => {
                    const ticket = selected;
                    setActiveKey("production-schedule");
                    setSelected(null);
                    setFormMode("create");
                    setSearch("");
                    setCreateDefaults({
                      job_ticket: ticket.id,
                      customer: "",
                      customer_po: "",
                      status: "scheduled",
                      priority: "normal",
                      quantity_to_ship: 0,
                      quantity_to_stock: 0,
                      notes: ticket.job_notes || ticket.finishing_notes || "",
                    });
                    setOpenGroups((prev) => ({ ...prev, production: true }));
                  }}
                />
              )}
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

        {rollOpen && canConsumeMaterial && (
          <RollWorkflowWindow
            roll={selected}
            locations={lookupQuery.data?.locations ?? []}
            usageRows={usageRows}
            submitting={rollActionMutation.isPending}
            onClose={() => setRollOpen(false)}
            onCheckOut={(payload) => rollActionMutation.mutate({ action: "check-out", payload })}
            onReturn={(payload) => rollActionMutation.mutate({ action: "return-roll", payload })}
          />
        )}

        {finishedMaterialOpen && selected && resource.key === "material-coated-stock" && (
          <FinishedMaterialWindow
            material={selected}
            usageRows={usageRows}
            inventoryRows={selectedMaterialInventoryRows}
            scheduling={finishedScheduleMutation.isPending}
            onClose={() => setFinishedMaterialOpen(false)}
            onEdit={() => {
              setFinishedMaterialOpen(false);
              setFormMode("edit");
            }}
            onSchedule={(schedule) => finishedScheduleMutation.mutate({ material: selected, schedule })}
          />
        )}
      </section>
    </main>
  );
}
