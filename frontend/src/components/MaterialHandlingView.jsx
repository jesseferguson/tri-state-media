import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, ChevronRight, Factory, History, Layers3, LoaderCircle, MapPin, PackageCheck, PackageOpen, PackagePlus, Plus, Save, Search, Trash2, Warehouse, X } from "lucide-react";
import { fetchCollection, postRecordAction, requestApi, updateRecord } from "../api";
import { formatInches, labelize } from "../lib/format";
import { canDeleteMaterialRoll } from "../lib/localAuth";
import DeleteMaterialRollDialog from "./DeleteMaterialRollDialog";
import ScanLinkScreen from "./ScanLinkScreen";

const activeJobKey = "tsm_active_material_job_v1";

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
}

function userHeaders(user) {
  return {
    "X-Company-User-Id": String(user?.id || ""),
    "X-Company-Username": String(user?.username || ""),
  };
}

function apiErrorMessage(error) {
  const message = String(error?.message || "");
  try {
    const payload = JSON.parse(message);
    const collect = (value) => {
      if (Array.isArray(value)) return value.flatMap(collect);
      if (value && typeof value === "object") return Object.values(value).flatMap(collect);
      return value ? [String(value)] : [];
    };
    return payload.detail || collect(payload).join(" ") || message;
  } catch {
    return message;
  }
}

function footage(row) {
  return Number(row?.length_feet ?? row?.quantity ?? 0) || 0;
}

function inventoryUnit(row) {
  return row?.unit || "lf";
}

function formatInventoryAmount(row, value = footage(row)) {
  const unit = inventoryUnit(row);
  const maximumFractionDigits = unit === "lf" ? 0 : 2;
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits })} ${unit}`;
}

function locationName(row) {
  return row?.current_location_display || row?.location_full_path || row?.location_name || "Plant Floor";
}

function locationLabel(row) {
  return row?.full_path || row?.location_full_path || row?.name || row?.code || "";
}

function rackLabel(row) {
  return [row?.rack_code, row?.storage_location_display || row?.location_detail].filter(Boolean).join(" / ");
}

function locationSearchText(row) {
  return [locationLabel(row), row?.code, row?.location_type, row?.inventory_scope].filter(Boolean).join(" ");
}

function findFloorLocation(locations, pattern) {
  return (locations ?? []).find((row) => (
    row.is_active !== false
    && row.inventory_scope !== "finished_product"
    && pattern.test(`${row.full_path || ""} ${row.name || ""} ${row.code || ""}`)
  ));
}

function rollRoute(row) {
  return {
    skid: row?.current_skid_number || (row?.current_rack_code ? "No skid" : "Plant Floor"),
    rack: row?.current_rack_code || "No rack",
    location: row?.current_rack_location_full_path || row?.location_full_path || row?.location_name || "Wilmington Ohio > Plant Floor",
  };
}

function groupAmount(rows) {
  const units = new Set(rows.map(inventoryUnit));
  if (units.size !== 1) return `${rows.length} items`;
  return formatInventoryAmount(rows[0], rows.reduce((sum, row) => sum + footage(row), 0));
}

function widthName(row) {
  return row?.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
}

function materialName(row) {
  const base = row?.material_master_type_code || row?.master_type_code || row?.material_family || row?.material_name || row?.name || "Material";
  const materialType = row?.material_type;
  if (materialType !== "coated_stock") return base;
  const liner = row?.material_liner_family || row?.material_liner_name || row?.liner_material_family || row?.liner_material_name;
  const adhesive = row?.material_adhesive_family || row?.material_adhesive_name || row?.adhesive_material_family || row?.adhesive_material_name;
  return [base, liner, adhesive].filter((value, index, values) => value && values.indexOf(value) === index).join("-");
}

function readActiveJob() {
  try {
    return JSON.parse(window.localStorage.getItem(activeJobKey) || "null");
  } catch {
    return null;
  }
}

function runDateForRolls(rolls) {
  const counts = new Map();
  rolls.forEach((roll) => {
    const date = String(roll.run_date || roll.created_at || "").slice(0, 10);
    if (date) counts.set(date, (counts.get(date) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || "";
}

function extractRollTagId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.searchParams.get("rollTagId") || "";
  } catch {
    const match = /(?:rollTagId=)?(\d+)/i.exec(text);
    return match?.[1] || "";
  }
}

const rawComponentChoices = [
  ["face", "Face"],
  ["liner", "Liner"],
  ["adhesive", "Adhesive"],
  ["silicone", "Silicone"],
  ["coating", "Coating"],
];

const rawComponentOrder = rawComponentChoices.map(([value]) => value);
const rawComponentLabels = Object.fromEntries(rawComponentChoices);

function rawComponentLabel(value) {
  return rawComponentLabels[value] || labelize(value || "Raw Material");
}

function materialTreeGroups(rows, section) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = section === "finished" ? materialName(row) : (row.material_type || "other");
    const label = section === "finished" ? key : rawComponentLabel(key);
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    groups.get(key).rows.push(row);
  });
  return Array.from(groups.values()).sort((left, right) => {
    if (section === "raw") {
      const leftOrder = rawComponentOrder.indexOf(left.key);
      const rightOrder = rawComponentOrder.indexOf(right.key);
      if (leftOrder !== rightOrder) return (leftOrder === -1 ? 999 : leftOrder) - (rightOrder === -1 ? 999 : rightOrder);
    }
    return left.label.localeCompare(right.label, undefined, { numeric: true });
  });
}

function materialSizeGroups(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = widthName(row);
    if (!groups.has(key)) groups.set(key, { key, label: key, rows: [] });
    groups.get(key).rows.push(row);
  });
  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
}

function MaterialLoadingScreen({ title = "Loading Material", detail = "Pulling inventory, locations, skids, and racks." }) {
  return (
    <section className="material-loading-screen" aria-live="polite">
      <div className="scan-link-loader">
        <span className="scan-link-loader-icon"><Layers3 size={30} /></span>
        <LoaderCircle className="scan-link-spinner" size={58} />
      </div>
      <div>
        <span>Secure plant inventory</span>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      <div className="scan-link-loading-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

function materialMaker(row, tag) {
  if (row?.inventory_origin === "tri_state" || row?.source_roll_tag || tag) return "Tri-State Media";
  return row?.supplier_name || row?.material_company || row?.company || "Unknown maker";
}

function MaterialInventoryTree({ rows, tags = [], selectedId, relatedRollIds, onSelect }) {
  const [section, setSection] = useState("finished");
  const [expanded, setExpanded] = useState({});
  const finishedRows = rows.filter((row) => row.material_type === "coated_stock");
  const rawRows = rows.filter((row) => row.material_type !== "coated_stock");
  const visibleRows = section === "finished" ? finishedRows : rawRows;
  const groups = useMemo(() => materialTreeGroups(visibleRows, section), [visibleRows, section]);
  const tagById = useMemo(() => {
    const map = new Map();
    tags.forEach((tag) => map.set(String(tag.id), tag));
    return map;
  }, [tags]);
  const summary = {
    finished: {
      count: finishedRows.length,
      amount: groupAmount(finishedRows),
    },
    raw: {
      count: rawRows.length,
      amount: groupAmount(rawRows),
    },
  };

  function toggle(key) {
    setExpanded((current) => ({ ...current, [key]: !(current[key] ?? false) }));
  }

  return (
    <div className="material-tree">
      <nav className="material-tree-tabs" aria-label="Inventory material class">
        <button className={section === "finished" ? "active" : ""} type="button" onClick={() => setSection("finished")}>
          <PackageCheck size={17} />
          <span><strong>Finished Material</strong><small>{summary.finished.count} items / {summary.finished.amount}</small></span>
        </button>
        <button className={section === "raw" ? "active" : ""} type="button" onClick={() => setSection("raw")}>
          <Factory size={17} />
          <span><strong>Raw Material</strong><small>{summary.raw.count} items / {summary.raw.amount}</small></span>
        </button>
      </nav>
      <div className="material-handling-groups material-tree-groups">
        {groups.map((group) => {
          const open = expanded[group.key] ?? false;
          const sizeGroups = materialSizeGroups(group.rows);
          return (
            <section className={open ? "open" : ""} key={group.key}>
              <button className="material-tree-group-head" type="button" onClick={() => toggle(group.key)} aria-expanded={open}>
                <div>{section === "finished" ? <Layers3 size={15} /> : <Factory size={15} />}<strong>{group.label}</strong></div>
                <span>{group.rows.length} item{group.rows.length === 1 ? "" : "s"}</span>
                <b>{groupAmount(group.rows)}</b>
                {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
              </button>
              {open && (
                <div className="material-size-groups">
                  {sizeGroups.map((sizeGroup) => {
                    const sizeKey = `${group.key}:${sizeGroup.key}`;
                    const sizeOpen = expanded[sizeKey] ?? false;
                    return (
                      <section className={sizeOpen ? "open" : ""} key={sizeKey}>
                        <button className="material-size-group-head" type="button" onClick={() => toggle(sizeKey)} aria-expanded={sizeOpen}>
                          <div><Layers3 size={14} /><strong>{sizeGroup.label}</strong></div>
                          <span>{sizeGroup.rows.length} item{sizeGroup.rows.length === 1 ? "" : "s"}</span>
                          <b>{groupAmount(sizeGroup.rows)}</b>
                          {sizeOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        {sizeOpen && (
                          <div>
                            {sizeGroup.rows.map((row) => {
                              const tag = tagById.get(String(row.source_roll_tag || ""));
                              const route = rollRoute(row);
                              return (
                                <article className={`material-compact-roll ${sameId(row.id, selectedId) ? "active" : ""}`} key={row.id}>
                                  <button className="material-roll-summary" type="button" onClick={() => onSelect(row)}>
                                    <span className={`material-roll-status ${row.status}`} />
                                    <div className="material-roll-main">
                                      <div className="material-roll-line">
                                        <strong>{materialName(row)}</strong>
                                        <b>{formatInventoryAmount(row)}</b>
                                      </div>
                                      <div className="material-roll-essentials">
                                        <span><Factory size={12} /> {materialMaker(row, tag)}</span>
                                        <span><Layers3 size={12} /> {widthName(row)}</span>
                                        <span><PackageOpen size={12} /> {route.skid}</span>
                                        <span><MapPin size={12} /> {route.location}</span>
                                      </div>
                                    </div>
                                    <em>{relatedRollIds.has(String(row.source_roll_tag || "")) ? "Same run" : labelize(row.status)}</em>
                                  </button>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {!groups.length && (
          <p className="material-handling-empty">
            No {section === "finished" ? "finished material" : "raw material"} matches these filters.
          </p>
        )}
      </div>
    </div>
  );
}

function UsageHistory({ rows, rolls, search }) {
  const events = [
    ...rolls.map((roll) => ({
      ...roll,
      id: `roll-${roll.id}`,
      used_date: roll.run_date || roll.created_at,
      reference: roll.schedule_tag_number,
      inventory_serial: roll.tag_number,
      quantity: roll.length_feet,
      unit: "ft",
      used_by: roll.operator,
      job_name: "Master roll documented",
    })),
    ...rows,
  ];
  const filtered = events.filter((row) => {
    const text = `${row.used_date} ${row.reference} ${row.production_schedule} ${row.job_ticket_number} ${row.job_name} ${row.inventory_serial} ${row.used_by} ${row.notes}`.toLowerCase();
    return !search || text.includes(search.toLowerCase());
  });
  const byDate = new Map();
  filtered.forEach((row) => {
    const date = String(row.used_date || row.created_at || "").slice(0, 10) || "No date";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  });
  return (
    <div className="material-handling-history">
      {Array.from(byDate.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, dateRows]) => (
        <section key={date}>
          <header><strong>{date}</strong><span>{dateRows.length} event{dateRows.length === 1 ? "" : "s"}</span></header>
          <div>
            {dateRows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.inventory_serial || row.coater_roll_tag_number || row.reference || "Material usage"}</strong>
                  <span>{[row.job_ticket_number || row.reference, row.used_by, row.notes].filter(Boolean).join(" / ")}</span>
                </div>
                <b>{Number(row.quantity || 0).toLocaleString()} {row.unit || "lf"}</b>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!filtered.length && <p className="material-handling-empty">No historical usage matches this search.</p>}
    </div>
  );
}

function IntakeSearchPicker({ label, options, value, onChange, getLabel, getSearchText = getLabel, placeholder, required = false }) {
  const selected = options.find((option) => sameId(option.id, value));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = options
    .filter((option) => !normalizedQuery || getSearchText(option).toLowerCase().includes(normalizedQuery))
    .slice(0, 40);

  return (
    <label className="material-intake-search-picker">
      <span>{label}</span>
      <div className={open ? "open" : ""}>
        <Search size={16} />
        <input
          value={open ? query : selected ? getLabel(selected) : query}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          placeholder={placeholder}
          required={required && !value}
          autoComplete="off"
        />
        {value && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(true); }} aria-label={`Clear ${label}`}><X size={14} /></button>}
        {open && (
          <div className="material-intake-search-results">
            {visible.map((option) => (
              <button
                className={sameId(option.id, value) ? "active" : ""}
                type="button"
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(String(option.id));
                  setQuery("");
                  setOpen(false);
                }}
              >
                <strong>{getLabel(option)}</strong>
              </button>
            ))}
            {!visible.length && <p>No matches found.</p>}
          </div>
        )}
      </div>
    </label>
  );
}

function MaterialIntakeDialog({
  materials,
  masterTypes,
  suppliers,
  racks,
  locations,
  saving,
  error,
  onClose,
  onSave,
}) {
  const materialLocations = locations.filter((row) => row.is_active !== false && row.inventory_scope !== "finished_product");
  const activeRacks = racks.filter((row) => row.status === "active" && row.location_inventory_scope !== "finished_product");
  const plantFloor = findFloorLocation(materialLocations, /wilmington.*plant\s*floor|plant\s*floor/i);
  const offsiteFloor = findFloorLocation(materialLocations, /off[\s-]*site.*floor/i);
  const defaultFloor = plantFloor?.id || materialLocations[0]?.id || "";
  const floorShortcuts = [
    plantFloor && { key: "plant", label: "Wilmington", detail: "Plant Floor", location: plantFloor },
    offsiteFloor && { key: "offsite", label: "Wilmington", detail: "Off-Site Floor", location: offsiteFloor },
  ].filter(Boolean);
  const [category, setCategory] = useState("finished");
  const [definitionMode, setDefinitionMode] = useState("existing");
  const [storageMode, setStorageMode] = useState("floor");
  const [form, setForm] = useState({
    material: "",
    master_type: "",
    master_type_code: "",
    material_type: "coated_stock",
    name: "",
    company: "",
    supplier: "",
    liner_material: "",
    adhesive_material: "",
    inventory_origin: "legacy",
    lot_number: "",
    width_inches: "",
    amount: "",
    roll_count: "1",
    unit: "lf",
    received_date: new Date().toISOString().slice(0, 10),
    direct_rack: "",
    location: defaultFloor,
    notes: "",
  });
  const availableMaterials = materials.filter((row) => (
    row.is_active !== false
    && (category === "finished" ? row.material_type === "coated_stock" : row.material_type !== "coated_stock")
  ));
  const selectedMaterial = materials.find((row) => sameId(row.id, form.material));
  const activeMaterialType = definitionMode === "existing"
    ? selectedMaterial?.material_type || (category === "finished" ? "coated_stock" : "face")
    : form.material_type;
  const liquidMaterial = ["adhesive", "silicone", "coating"].includes(activeMaterialType);
  const linearTotal = Number(form.amount || 0) * Number(form.roll_count || 0);
  const finishedLiners = materials.filter((row) => row.is_active !== false && row.material_type === "liner");
  const finishedAdhesives = materials.filter((row) => row.is_active !== false && row.material_type === "adhesive");
  const selectedLiner = finishedLiners.find((row) => sameId(row.id, form.liner_material));
  const selectedAdhesive = finishedAdhesives.find((row) => sameId(row.id, form.adhesive_material));
  const finishedIdentity = [
    form.name || masterTypes.find((row) => sameId(row.id, form.master_type))?.code || form.master_type_code,
    selectedLiner?.material_family || selectedLiner?.name,
    selectedAdhesive?.material_family || selectedAdhesive?.name,
  ].filter(Boolean).join("-");

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function chooseFloor(locationId) {
    setStorageMode("floor");
    setForm((current) => ({ ...current, location: String(locationId || ""), direct_rack: "" }));
  }

  function chooseRack(rackId) {
    setStorageMode("rack");
    setForm((current) => ({ ...current, direct_rack: String(rackId || ""), location: "" }));
  }

  function chooseCategory(nextCategory) {
    const finished = nextCategory === "finished";
    setCategory(nextCategory);
    setForm((current) => ({
      ...current,
      material: "",
      material_type: finished ? "coated_stock" : "face",
      unit: finished ? "lf" : "lf",
      width_inches: "",
      amount: "",
    }));
  }

  function chooseMaterial(value) {
    const material = materials.find((row) => sameId(row.id, value));
    const liquid = ["adhesive", "silicone", "coating"].includes(material?.material_type);
    setForm((current) => ({
      ...current,
      material: value,
      supplier: material?.supplier || current.supplier,
      unit: liquid ? "gal" : "lf",
      width_inches: liquid ? "" : current.width_inches,
    }));
  }

  function chooseNewMaterialType(value) {
    const liquid = ["adhesive", "silicone", "coating"].includes(value);
    setForm((current) => ({
      ...current,
      material_type: value,
      unit: liquid ? "gal" : "lf",
      width_inches: liquid ? "" : current.width_inches,
    }));
  }

  function submit(event) {
    event.preventDefault();
    const payload = {
      material: definitionMode === "existing" ? form.material : null,
      create_material: definitionMode === "new" ? {
        material_type: category === "finished" ? "coated_stock" : form.material_type,
        master_type: category === "finished" && form.master_type !== "__new__" ? form.master_type : null,
        master_type_code: category === "finished" && form.master_type === "__new__" ? form.master_type_code : "",
        name: form.name,
        company: form.company,
        material_family: form.name,
        supplier: form.supplier || null,
        liner_material: category === "finished" ? (form.liner_material || null) : null,
        adhesive_material: category === "finished" ? (form.adhesive_material || null) : null,
      } : null,
      supplier: form.supplier || null,
      inventory_origin: form.inventory_origin,
      lot_number: form.lot_number,
      width_inches: liquidMaterial ? null : (form.width_inches || null),
      length_feet: form.unit === "lf" ? Number(form.amount) : null,
      quantity: Number(form.amount),
      roll_count: Number(form.roll_count),
      unit: form.unit,
      received_date: form.received_date,
      direct_rack: storageMode === "rack" ? form.direct_rack : null,
      location: storageMode === "floor" ? (form.location || null) : null,
      notes: form.notes,
    };
    onSave(payload);
  }

  const canSubmit = Number(form.amount) > 0
    && Number(form.roll_count) >= 1
    && (definitionMode === "existing" ? Boolean(form.material) : Boolean(form.name || (category === "finished" && form.master_type)))
    && (definitionMode !== "new" || category !== "finished" || (Boolean(form.master_type) && (form.master_type !== "__new__" || Boolean(form.master_type_code.trim()))))
    && (storageMode !== "rack" || Boolean(form.direct_rack));

  return (
    <section className="material-intake-overlay" role="dialog" aria-modal="true" aria-label="Add material without QR">
      <form className="material-intake-window" onSubmit={submit}>
        <header>
          <div><span>Inventory Intake</span><h2>Add Material</h2></div>
          <button type="button" onClick={onClose} aria-label="Close material intake"><X size={19} /></button>
        </header>
        <main>
          <section className="material-intake-section">
            <header><strong>Material Category</strong><span>1</span></header>
            <div className="material-intake-choice-grid">
              <button className={category === "finished" ? "active" : ""} type="button" onClick={() => chooseCategory("finished")}>
                <PackageCheck size={21} /><span><strong>Finished Material</strong><small>PM, PMDT, PET, and coated stock</small></span>
              </button>
              <button className={category === "raw" ? "active" : ""} type="button" onClick={() => chooseCategory("raw")}>
                <Factory size={21} /><span><strong>Raw Component</strong><small>Face, liner, adhesive, silicone, or coating</small></span>
              </button>
            </div>
          </section>

          <section className="material-intake-section">
            <header><strong>Material Identity</strong><span>2</span></header>
            <div className="material-intake-mode">
              <button className={definitionMode === "existing" ? "active" : ""} type="button" onClick={() => setDefinitionMode("existing")}>Existing Type</button>
              <button className={definitionMode === "new" ? "active" : ""} type="button" onClick={() => setDefinitionMode("new")}><Plus size={14} /> New Type</button>
            </div>
            <div className="material-intake-fields">
              {definitionMode === "existing" ? (
                <div className="wide">
                  <IntakeSearchPicker
                    label="Material"
                    options={availableMaterials}
                    value={form.material}
                    onChange={chooseMaterial}
                    getLabel={(row) => [materialName(row), row.company, row.code].filter(Boolean).join(" / ")}
                    placeholder="Search material type, name, company, or code"
                    required
                  />
                </div>
              ) : category === "finished" ? (
                <>
                  <IntakeSearchPicker
                    label="Material Type"
                    options={masterTypes.filter((row) => row.is_active !== false)}
                    value={form.master_type === "__new__" ? "" : form.master_type}
                    onChange={(value) => {
                      const master = masterTypes.find((row) => sameId(row.id, value));
                      setForm((current) => ({ ...current, master_type: value, master_type_code: "", name: current.name || master?.code || "" }));
                    }}
                    getLabel={(row) => row.code + (row.name && row.name !== row.code ? ` / ${row.name}` : "")}
                    placeholder="Search PM, PMDT, PET..."
                  />
                  <label><span>Company</span><input value={form.company} onChange={(event) => update("company", event.target.value)} placeholder="RICOH" required /></label>
                  <button className={`material-intake-new-type ${form.master_type === "__new__" ? "active" : ""}`} type="button" onClick={() => setForm((current) => ({ ...current, master_type: current.master_type === "__new__" ? "" : "__new__", master_type_code: "" }))}><Plus size={14} /> {form.master_type === "__new__" ? "Use Existing Type" : "Type Not Listed"}</button>
                  {form.master_type === "__new__" && <label><span>New Type Code</span><input value={form.master_type_code} onChange={(event) => {
                    const value = event.target.value.toUpperCase();
                    setForm((current) => ({ ...current, master_type_code: value, name: current.name || value }));
                  }} placeholder="PMDT" required /></label>}
                  <label className="wide"><span>Material Name</span><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="PMDT" required /></label>
                  <div className="wide material-intake-component-pickers">
                    <IntakeSearchPicker label="Liner" options={finishedLiners} value={form.liner_material} onChange={(value) => update("liner_material", value)} getLabel={(row) => [row.material_family || row.name, row.company].filter(Boolean).join(" / ")} placeholder="Search liner type" />
                    <IntakeSearchPicker label="Adhesive" options={finishedAdhesives} value={form.adhesive_material} onChange={(value) => update("adhesive_material", value)} getLabel={(row) => [row.material_family || row.name, row.company].filter(Boolean).join(" / ")} placeholder="Search adhesive type" />
                  </div>
                  {finishedIdentity && <div className="wide material-intake-name-preview"><span>Inventory Material Name</span><strong>{finishedIdentity}</strong></div>}
                </>
              ) : (
                <>
                  <label>
                    <span>Component</span>
                    <select value={form.material_type} onChange={(event) => chooseNewMaterialType(event.target.value)}>
                      {rawComponentChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </label>
                  <label><span>Company</span><input value={form.company} onChange={(event) => update("company", event.target.value)} placeholder="Supplier company" /></label>
                  <label className="wide"><span>Material Name / Type</span><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Example: 40 SCK liner" required /></label>
                </>
              )}
              <IntakeSearchPicker label="Supplier" options={suppliers.filter((row) => row.is_active !== false)} value={form.supplier} onChange={(value) => update("supplier", value)} getLabel={(row) => [row.name, row.city, row.state].filter(Boolean).join(" / ")} placeholder="Search supplier" />
              <label>
                <span>Inventory Origin</span>
                <select value={form.inventory_origin} onChange={(event) => update("inventory_origin", event.target.value)}>
                  <option value="legacy">Existing Stock / No QR</option>
                  <option value="purchased">Purchased / Outsourced</option>
                  <option value="tri_state">Tri-State Produced / Manual</option>
                </select>
              </label>
            </div>
          </section>

          <section className="material-intake-section">
            <header><strong>Physical Inventory</strong><span>3</span></header>
            <div className="material-intake-fields">
              <label><span>Lot Number</span><input value={form.lot_number} onChange={(event) => update("lot_number", event.target.value)} placeholder="Supplier or internal lot" /></label>
              {!liquidMaterial && <label><span>Width</span><input type="number" min="0" step="0.001" inputMode="decimal" value={form.width_inches} onChange={(event) => update("width_inches", event.target.value)} placeholder="inches" /></label>}
              <label>
                <span>Unit</span>
                <select value={form.unit} onChange={(event) => update("unit", event.target.value)}>
                  <option value="lf">Linear Feet</option>
                  <option value="gal">Gallons</option>
                  <option value="lbs">Pounds</option>
                  <option value="roll">Rolls</option>
                  <option value="each">Each</option>
                </select>
              </label>
              <label><span>{form.unit === "lf" ? "Length Per Roll" : "Amount Per Container"}</span><input type="number" min="0.001" step="0.001" inputMode="decimal" value={form.amount} onChange={(event) => update("amount", event.target.value)} required /></label>
              <label><span>{form.unit === "lf" ? "Number of Rolls" : "Number of Containers"}</span><input type="number" min="1" max="500" step="1" inputMode="numeric" value={form.roll_count} onChange={(event) => update("roll_count", event.target.value)} required /></label>
              <label><span>Received</span><input type="date" value={form.received_date} onChange={(event) => update("received_date", event.target.value)} /></label>
              <div className="wide material-intake-lot-total">
                <span>Total Received</span>
                <strong>{linearTotal.toLocaleString(undefined, { maximumFractionDigits: form.unit === "lf" ? 0 : 2 })} {form.unit}</strong>
                <small>{Number(form.roll_count || 0).toLocaleString()} x {Number(form.amount || 0).toLocaleString()} {form.unit}</small>
              </div>
              <p className="wide material-intake-note">Supplier lot is optional here. For outside material, enter the shipment once with roll count and add the exact lot details later when that process happens.</p>
            </div>
          </section>

          <section className="material-intake-section">
            <header><strong>Storage</strong><span>4</span></header>
            <div className="material-intake-mode">
              <button className={storageMode === "floor" ? "active" : ""} type="button" onClick={() => setStorageMode("floor")}><MapPin size={14} /> Plant Floor</button>
              <button className={storageMode === "rack" ? "active" : ""} type="button" onClick={() => setStorageMode("rack")}><Warehouse size={14} /> Rack Space</button>
            </div>
            <div className="material-intake-fields">
              {storageMode === "rack" ? (
                <div className="wide">
                  <IntakeSearchPicker
                    label="Rack"
                    options={activeRacks}
                    value={form.direct_rack}
                    onChange={chooseRack}
                    getLabel={rackLabel}
                    placeholder="Search rack code or location"
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="wide material-floor-shortcuts">
                    {floorShortcuts.map((shortcut) => (
                      <button
                        className={sameId(form.location, shortcut.location.id) ? "active" : ""}
                        type="button"
                        key={shortcut.key}
                        onClick={() => chooseFloor(shortcut.location.id)}
                      >
                        <MapPin size={16} />
                        <span><strong>{shortcut.label}</strong><small>{shortcut.detail}</small></span>
                      </button>
                    ))}
                  </div>
                  <div className="wide">
                    <IntakeSearchPicker
                      label="Other Floor Location"
                      options={materialLocations}
                      value={form.location}
                      onChange={chooseFloor}
                      getLabel={locationLabel}
                      getSearchText={locationSearchText}
                      placeholder="Search floor, warehouse, shelf, or code"
                    />
                  </div>
                </>
              )}
              <label className="wide"><span>Notes</span><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Condition, supplier details, or handling notes" /></label>
            </div>
          </section>

          {error && <div className="material-intake-error"><AlertTriangle size={17} /><span>{apiErrorMessage(error)}</span></div>}
        </main>
        <footer>
          <button className="ghost-btn" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={!canSubmit || saving}><PackagePlus size={17} /> {saving ? "Adding Material..." : "Add to Inventory"}</button>
        </footer>
      </form>
    </section>
  );
}

function RollDetail({ roll, locations, racks, schedules, activeJob, currentUser, saving, error, notice, canDelete, onClose, onSave, onConsume, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => ({
    lot_number: roll.lot_number || "",
    width_inches: roll.width_inches || "",
    location: roll.location || "",
    direct_rack: roll.direct_rack || "",
    storage_mode: roll.direct_rack ? "rack" : "floor",
    notes: roll.notes || "",
  }));
  const [useForm, setUseForm] = useState(() => ({
    production_schedule: activeJob?.scheduleId || "",
    mode: "partial",
    used_feet: "",
    used_by: currentUser?.name || "",
    poor_run: false,
    notes: "",
  }));
  const available = footage(roll);
  const unit = inventoryUnit(roll);
  const isLinearFeet = unit === "lf";
  const entered = Number(useForm.used_feet || 0);
  const buffered = useForm.mode === "partial" ? Math.min(available, entered * (isLinearFeet ? 1.03 : 1)) : available;
  const amountTooHigh = useForm.mode === "partial" && useForm.used_feet !== "" && entered > available;
  const remainingAfterUse = Math.max(0, available - buffered);

  useEffect(() => {
    setEditForm({
      lot_number: roll.lot_number || "",
      width_inches: roll.width_inches || "",
      location: roll.location || "",
      direct_rack: roll.direct_rack || "",
      storage_mode: roll.direct_rack ? "rack" : "floor",
      notes: roll.notes || "",
    });
    setEditing(false);
  }, [roll.id]);

  return (
    <aside className="material-handling-detail" role="dialog" aria-modal="true" aria-label={`${materialName(roll)} inventory detail`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="material-roll-identity">
        <div>
          <strong title={materialName(roll)}>{materialName(roll)}</strong>
          <span>{roll.serial_number || roll.source_roll_tag_number || roll.lot_number}</span>
        </div>
        <div className="material-detail-head-actions">
          <button type="button" onClick={onClose} aria-label="Close roll details"><X size={18} /></button>
        </div>
      </header>
      <section className="material-live-roll-balance">
        <div><span>Amount on hand</span><strong>{formatInventoryAmount(roll, available)}</strong></div>
        <ChevronRight size={18} />
        <div className={remainingAfterUse <= 0 ? "empty" : ""}><span>After this use</span><strong>{formatInventoryAmount(roll, remainingAfterUse)}</strong></div>
        <small>{remainingAfterUse <= 0 ? "The roll will leave active inventory and be removed from its skid." : "Updates live as footage is entered below."}</small>
      </section>
      <div className="material-detail-route">
        <span><PackageOpen size={14} /><small>Skid</small><strong>{rollRoute(roll).skid}</strong></span>
        <ChevronRight size={14} />
        <span><Warehouse size={14} /><small>Rack</small><strong>{rollRoute(roll).rack}</strong></span>
        <ChevronRight size={14} />
        <span><MapPin size={14} /><small>Location</small><strong>{rollRoute(roll).location}</strong></span>
      </div>
      <div className="material-handling-roll-facts">
        <div><span>Material</span><strong>{materialName(roll)}</strong></div>
        <div><span>Width</span><strong>{widthName(roll)}</strong></div>
        <div><span>Location</span><strong>{locationName(roll)}</strong></div>
        <div><span>Status</span><strong>{labelize(roll.status)}</strong></div>
      </div>

      <div className="material-roll-management-actions">
        <button className="ghost-btn" type="button" onClick={() => setEditing((value) => !value)}>
          <Save size={15} /> {editing ? "Close Roll Editor" : "Edit Roll"}
        </button>
        {canDelete && (
          <button className="material-remove-inventory-btn" type="button" onClick={onDelete}>
            <Trash2 size={15} /> Remove from Inventory
          </button>
        )}
      </div>
      {editing && (
        <form className="material-handling-edit" onSubmit={(event) => { event.preventDefault(); onSave(editForm); }}>
          <label><span>Lot Number</span><input value={editForm.lot_number} onChange={(event) => setEditForm((form) => ({ ...form, lot_number: event.target.value }))} /></label>
          <label><span>Width</span><input type="number" step="0.001" value={editForm.width_inches} onChange={(event) => setEditForm((form) => ({ ...form, width_inches: event.target.value }))} /></label>
          {roll.current_skid ? (
            <div className="material-location-locked wide"><Warehouse size={15} /><span>This roll's location follows its skid and rack.</span></div>
          ) : (
            <>
              <div className="material-edit-location-mode wide">
                <button className={editForm.storage_mode === "floor" ? "active" : ""} type="button" onClick={() => setEditForm((form) => ({ ...form, storage_mode: "floor", direct_rack: "" }))}><MapPin size={14} /> Plant Floor</button>
                <button className={editForm.storage_mode === "rack" ? "active" : ""} type="button" onClick={() => setEditForm((form) => ({ ...form, storage_mode: "rack", location: "" }))}><Warehouse size={14} /> Rack</button>
              </div>
              {editForm.storage_mode === "rack" ? (
                <label className="wide"><span>Rack</span><select value={editForm.direct_rack || ""} onChange={(event) => setEditForm((form) => ({ ...form, direct_rack: event.target.value }))}><option value="">Select rack</option>{racks.filter((rack) => rack.status === "active" && rack.location_inventory_scope !== "finished_product").map((rack) => <option value={rack.id} key={rack.id}>{rack.rack_code} / {rack.storage_location_display}</option>)}</select></label>
              ) : (
                <label className="wide"><span>Plant Floor Location</span><select value={editForm.location || ""} onChange={(event) => setEditForm((form) => ({ ...form, location: event.target.value }))}><option value="">Wilmington Ohio &gt; Plant Floor</option>{locations.filter((location) => location.inventory_scope !== "finished_product").map((location) => <option value={location.id} key={location.id}>{location.full_path || location.name}</option>)}</select></label>
              )}
            </>
          )}
          <label className="wide"><span>Roll Notes</span><textarea value={editForm.notes} onChange={(event) => setEditForm((form) => ({ ...form, notes: event.target.value }))} /></label>
          <button className="primary-btn wide" type="submit" disabled={saving}>Save Roll</button>
        </form>
      )}

      <form className="material-consume-form" onSubmit={(event) => { event.preventDefault(); onConsume(useForm); }}>
        <header><PackageCheck size={17} /><div><span>Use On A Job</span><strong>{activeJob?.label || "Choose scheduled job"}</strong></div></header>
        <label className="wide">
          <span>Scheduled Job</span>
          <select value={useForm.production_schedule} onChange={(event) => setUseForm((form) => ({ ...form, production_schedule: event.target.value }))}>
            <option value="">No job selected</option>
            {schedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.job_ticket_number || schedule.job_name || `Schedule ${schedule.id}`} / {schedule.press_name || "No press"}</option>)}
          </select>
        </label>
        <div className="material-consume-modes">
          <button className={useForm.mode === "full" ? "active" : ""} type="button" onClick={() => setUseForm((form) => ({ ...form, mode: "full" }))}>{isLinearFeet ? "Run Roll Out" : "Use Entire Item"}</button>
          <button className={useForm.mode === "partial" ? "active" : ""} type="button" onClick={() => setUseForm((form) => ({ ...form, mode: "partial" }))}>Partial Use</button>
        </div>
        {useForm.mode === "partial" && (
          <label className={`wide material-footage-entry ${amountTooHigh ? "invalid" : ""}`}>
            <span>Amount Used ({unit})</span>
            <input
              type="number"
              min="0.01"
              max={available}
              step="0.01"
              inputMode="decimal"
              value={useForm.used_feet}
              onChange={(event) => setUseForm((form) => ({ ...form, used_feet: event.target.value }))}
              aria-invalid={amountTooHigh}
              required
            />
            {amountTooHigh && <small>That is too much material. Only {formatInventoryAmount(roll, available)} is available.</small>}
          </label>
        )}
        <div className={`material-consume-preview ${remainingAfterUse <= 0 ? "empty" : ""} ${amountTooHigh ? "invalid" : ""}`}>
          <span>Remaining after use</span>
          <strong>{formatInventoryAmount(roll, remainingAfterUse)}</strong>
          <small>{useForm.mode === "partial"
            ? `${formatInventoryAmount(roll, buffered)} deducted${isLinearFeet ? " including the 3% safety buffer" : ""}`
            : "The entire inventory amount will be recorded as used"}</small>
        </div>
        <label><span>Operator</span><input value={useForm.used_by} onChange={(event) => setUseForm((form) => ({ ...form, used_by: event.target.value }))} /></label>
        <label className="check"><input type="checkbox" checked={useForm.poor_run} onChange={(event) => setUseForm((form) => ({ ...form, poor_run: event.target.checked }))} /><span>Poor run / needs note</span></label>
        <label className="wide"><span>Run Note</span><textarea value={useForm.notes} onChange={(event) => setUseForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Why the roll came off or any quality issue" /></label>
        {(error || notice) && <p className={error ? "error" : "success"}>{error || notice}</p>}
        <button className="primary-btn wide" type="submit" disabled={saving || amountTooHigh || (useForm.mode === "partial" && entered <= 0)}>
          {saving ? "Saving Usage..." : useForm.mode === "full" ? (isLinearFeet ? "Use Entire Roll" : "Use Entire Item") : "Save Partial Usage"}
        </button>
      </form>
    </aside>
  );
}

export default function MaterialHandlingView({
  currentUser,
  linkedRollTagId = "",
  linkedInventoryId = "",
  onLinkedRollTagChange,
  onCloseLinkedRoll,
  onOpenStorage,
}) {
  const queryClient = useQueryClient();
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [view, setView] = useState("active");
  const [search, setSearch] = useState("");
  const [activeJob, setActiveJob] = useState(() => readActiveJob());
  const [notice, setNotice] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  const dataQuery = useQuery({
    queryKey: ["material-handling-data"],
    queryFn: async () => {
      const [tags, inventory, usage, locations, schedules, materials, masterTypes, suppliers, racks] = await Promise.all([
        fetchCollection("coater-roll-tags", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
        fetchCollection("raw-materials", { ordering: "-received_date,-id", pageSize: 1000, fetchAll: true }),
        fetchCollection("material-usages", { ordering: "-used_date,-created_at", pageSize: 1000, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 1000, fetchAll: true }),
        fetchCollection("production-schedule", { ordering: "scheduled_date,press_sequence", pageSize: 500, fetchAll: true }),
        fetchCollection("materials", { ordering: "material_type,company,name", pageSize: 1000, fetchAll: true }),
        fetchCollection("material-master-types", { ordering: "code,name", pageSize: 500, fetchAll: true }),
        fetchCollection("suppliers", { ordering: "name", pageSize: 1000, fetchAll: true }),
        fetchCollection("racks", { ordering: "rack_code", pageSize: 1000, fetchAll: true }),
      ]);
      return {
        tags: tags.results ?? [],
        inventory: inventory.results ?? [],
        usage: usage.results ?? [],
        locations: locations.results ?? [],
        schedules: (schedules.results ?? []).filter((row) => ["scheduled", "ready", "running", "on_hold"].includes(row.status)),
        materials: materials.results ?? [],
        masterTypes: masterTypes.results ?? [],
        suppliers: suppliers.results ?? [],
        racks: racks.results ?? [],
      };
    },
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const data = dataQuery.data ?? { tags: [], inventory: [], usage: [], locations: [], schedules: [], materials: [], masterTypes: [], suppliers: [], racks: [] };
  const linkedTag = data.tags.find((tag) => sameId(tag.id, linkedRollTagId)) ?? null;
  const linkedInventory = linkedTag
    ? data.inventory.find((row) => sameId(row.source_roll_tag, linkedTag.id) || sameId(row.id, linkedTag.logged_inventory))
    : null;
  const linkedInventoryRecord = data.inventory.find((row) => sameId(row.id, linkedInventoryId)) || null;
  const selectedRoll = data.inventory.find((row) => sameId(row.id, selectedInventoryId)) || linkedInventory || linkedInventoryRecord || null;
  const focusMaterialId = linkedTag?.produced_material || linkedTag?.scheduled_material || "";
  const relatedTags = linkedTag
    ? data.tags.filter((tag) => sameId(tag.source_schedule, linkedTag.source_schedule || linkedTag.id))
    : [];
  const relatedRollIds = new Set(relatedTags.map((tag) => String(tag.id)));
  const majorityRunDate = runDateForRolls(relatedTags);
  const activeRows = data.inventory
    .filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && footage(row) > 0)
    .filter((row) => !focusMaterialId || sameId(row.material, focusMaterialId))
    .filter((row) => !search || `${row.serial_number} ${row.lot_number} ${materialName(row)} ${row.material_type} ${row.material_company || ""} ${row.supplier_name || ""} ${row.inventory_origin || ""} ${widthName(row)} ${locationName(row)} ${row.current_skid_number || ""} ${row.current_rack_code || ""} ${row.current_rack_location_full_path || ""}`.toLowerCase().includes(search.toLowerCase()));
  const usageRows = data.usage.filter((row) => !focusMaterialId || sameId(row.material, focusMaterialId));
  const rollHistory = data.tags.filter((tag) => (
    tag.source_schedule
    && tag.status === "complete"
    && (!focusMaterialId || sameId(tag.produced_material || tag.scheduled_material, focusMaterialId))
  ));
  const inventorySummary = useMemo(() => ({
    rolls: activeRows.length,
    footage: activeRows.filter((row) => inventoryUnit(row) === "lf").reduce((sum, row) => sum + footage(row), 0),
    skids: new Set(activeRows.map((row) => row.current_skid).filter(Boolean)).size,
    racks: new Set(activeRows.map((row) => row.current_rack).filter(Boolean)).size,
    floor: activeRows.filter((row) => !row.current_skid && !row.current_rack).length,
  }), [activeRows]);

  useEffect(() => {
    const directInventory = linkedInventory || linkedInventoryRecord;
    if (directInventory) setSelectedInventoryId(String(directInventory.id));
  }, [linkedInventory?.id, linkedInventoryRecord?.id]);

  useEffect(() => () => scannerRef.current?.stop?.(), []);

  async function startScanner() {
    setCameraError("");
    setCameraOpen(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current,
        (result, _scanError, activeControls) => {
          const rollId = extractRollTagId(result?.getText?.());
          if (!rollId) return;
          activeControls?.stop?.();
          scannerRef.current = null;
          setCameraOpen(false);
          onLinkedRollTagChange?.(rollId);
        }
      );
      scannerRef.current = controls;
    } catch (error) {
      setCameraError(error?.message || "Camera scanning is not available. Use the phone camera on the printed QR code.");
      setCameraOpen(false);
    }
  }

  const editMutation = useMutation({
    mutationFn: async ({ roll, form }) => {
      const payload = {
        lot_number: form.lot_number,
        width_inches: form.width_inches ? Number(form.width_inches) : null,
        location: form.storage_mode === "floor" && form.location ? Number(form.location) : null,
        direct_rack: form.storage_mode === "rack" && form.direct_rack ? Number(form.direct_rack) : null,
        notes: form.notes,
      };
      const saved = await updateRecord("raw-materials", roll.id, payload);
      if (roll.source_roll_tag) {
        await updateRecord("coater-roll-tags", roll.source_roll_tag, {
          result_lot_number: payload.lot_number,
          width_inches: payload.width_inches,
          location: payload.location,
          notes: payload.notes,
        });
      }
      return saved;
    },
    onSuccess: (saved) => {
      setSelectedInventoryId(String(saved.id));
      setNotice(`${saved.serial_number || saved.lot_number} was updated.`);
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
    },
  });

  const consumeMutation = useMutation({
    mutationFn: ({ roll, form }) => postRecordAction("raw-materials", roll.id, "consume-roll", {
      production_schedule: form.production_schedule ? Number(form.production_schedule) : null,
      mode: form.mode,
      used_feet: form.mode === "partial" ? Number(form.used_feet) : null,
      used_by: form.used_by || currentUser?.name || "",
      poor_run: form.poor_run,
      notes: form.notes,
    }),
    onSuccess: (result) => {
      const remaining = Number(result.remainingFootage || 0);
      setNotice(`${Number(result.deductedFootage || 0).toLocaleString()} ft recorded. ${remaining.toLocaleString()} ft remains active.`);
      setSelectedInventoryId(String(result.inventory.id));
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (roll) => postRecordAction("raw-materials", roll.id, "remove-from-inventory", {
      confirm_delete: true,
    }, {
      headers: userHeaders(currentUser),
    }),
    onSuccess: (result) => {
      setDeleteCandidate(null);
      setSelectedInventoryId("");
      setNotice(`${result.rollReference || "Roll"} was removed from inventory.`);
      if (linkedRollTagId || linkedInventoryId) onCloseLinkedRoll?.();
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["material-storage"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const intakeMutation = useMutation({
    mutationFn: (payload) => requestApi("raw-materials/intake", {
      method: "POST",
      headers: userHeaders(currentUser),
      body: JSON.stringify(payload),
    }),
    onSuccess: (saved) => {
      setIntakeOpen(false);
      setSelectedInventoryId(String(saved.id));
      setNotice(`${saved.created_count || 1} inventory item${saved.created_count === 1 ? "" : "s"} added${saved.lot_number ? ` for lot ${saved.lot_number}` : ""}.`);
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["material-storage"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  function selectRoll(row) {
    setSelectedInventoryId(String(row.id));
    setNotice("");
  }

  if ((linkedRollTagId || linkedInventoryId) && dataQuery.isLoading) {
    return <ScanLinkScreen kind="roll" />;
  }

  return (
    <section className="material-handling-view">
      <nav className="material-storage-links" aria-label="Material storage views">
        <button className="active" type="button"><Layers3 size={16} /> Material</button>
        <button type="button" onClick={() => onOpenStorage?.("skids")}><PackageOpen size={16} /> Skids</button>
        <button type="button" onClick={() => onOpenStorage?.("racks")}><Warehouse size={16} /> Racks</button>
      </nav>

      {dataQuery.isLoading ? (
        <div className="material-handling-loading-slot">
          <MaterialLoadingScreen title="Loading Material Inventory" detail="Pulling active rolls, supplier names, skids, racks, and plant locations." />
        </div>
      ) : (
        <>
          <section className="material-workspace-actions">
            {activeJob && <span className="material-active-job"><CheckCircle2 size={14} /> {activeJob.label}</span>}
            <button className="ghost-btn" type="button" onClick={() => { intakeMutation.reset(); setIntakeOpen(true); }}><PackagePlus size={16} /> Add Material</button>
            <button className="primary-btn" type="button" onClick={startScanner}><Camera size={16} /> Scan Roll</button>
          </section>

          {linkedTag && !linkedInventory && (
            <div className="material-pending-tag">
              <AlertTriangle size={18} />
              <div><strong>{linkedTag.tag_number} is printed but not documented.</strong><span>The coater operator must enter the actual master-roll footage before this appears in active inventory.</span></div>
            </div>
          )}
          {cameraOpen && (
            <section className="material-camera-overlay">
              <div><video ref={videoRef} playsInline muted /><button className="ghost-btn" type="button" onClick={() => { scannerRef.current?.stop?.(); setCameraOpen(false); }}><X size={16} /> Close Camera</button></div>
            </section>
          )}
          {cameraError && <p className="coater-error">{cameraError}</p>}

          <nav className="material-handling-tabs">
            <button className={view === "active" ? "active" : ""} type="button" onClick={() => setView("active")}><PackageCheck size={15} /> Active Inventory</button>
            <button className={view === "history" ? "active" : ""} type="button" onClick={() => setView("history")}><History size={15} /> Usage History</button>
          </nav>

          <section className="material-handling-toolbar single">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "active" ? "Search material, lot, supplier, or location" : "Search date, job, schedule, or operator"} /></label>
          </section>

          <div className={`material-handling-layout ${view === "history" ? "history" : ""}`}>
            <main>
              {view === "active"
                ? <MaterialInventoryTree rows={activeRows} tags={data.tags} selectedId={selectedRoll?.id} relatedRollIds={relatedRollIds} onSelect={selectRoll} />
                : <UsageHistory rows={usageRows} rolls={rollHistory} search={search} />}
            </main>
          </div>
        </>
      )}
      {view === "active" && selectedRoll && (
        <div className="material-roll-overlay" role="presentation" onMouseDown={() => {
          setSelectedInventoryId("");
          if (linkedRollTagId || linkedInventoryId) onCloseLinkedRoll?.();
        }}>
          <RollDetail
            key={selectedRoll.id}
            roll={selectedRoll}
            locations={data.locations}
            racks={data.racks}
            schedules={data.schedules}
            activeJob={activeJob}
            currentUser={currentUser}
            saving={editMutation.isPending || consumeMutation.isPending}
            error={editMutation.error?.message || consumeMutation.error?.message || ""}
            notice={notice}
            canDelete={canDeleteMaterialRoll(currentUser)}
            onClose={() => {
              setSelectedInventoryId("");
              if (linkedRollTagId || linkedInventoryId) onCloseLinkedRoll?.();
            }}
            onSave={(form) => editMutation.mutate({ roll: selectedRoll, form })}
            onConsume={(form) => consumeMutation.mutate({ roll: selectedRoll, form })}
            onDelete={() => setDeleteCandidate(selectedRoll)}
          />
        </div>
      )}
      <DeleteMaterialRollDialog
        roll={deleteCandidate}
        deleting={deleteMutation.isPending}
        error={apiErrorMessage(deleteMutation.error)}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setDeleteCandidate(null);
            deleteMutation.reset();
          }
        }}
        onConfirm={() => deleteMutation.mutate(deleteCandidate)}
      />
      {intakeOpen && (
        <MaterialIntakeDialog
          materials={data.materials}
          masterTypes={data.masterTypes}
          suppliers={data.suppliers}
          racks={data.racks}
          locations={data.locations}
          saving={intakeMutation.isPending}
          error={intakeMutation.error}
          onClose={() => {
            if (!intakeMutation.isPending) {
              setIntakeOpen(false);
              intakeMutation.reset();
            }
          }}
          onSave={(payload) => intakeMutation.mutate(payload)}
        />
      )}
    </section>
  );
}

export { activeJobKey };
