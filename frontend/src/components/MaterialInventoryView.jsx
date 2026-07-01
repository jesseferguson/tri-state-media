import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, PackageCheck } from "lucide-react";
import { formatInches, getRecordTitle, groupBy, labelize } from "../lib/format";

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function materialGroupName(row) {
  const family = row.material_family || row.material_name || row.name || "Unassigned Material";
  const company = row.material_company || "";
  const name = row.material_name && row.material_name !== family ? row.material_name : "";
  const fallback = !company && !name && row.material_code ? row.material_code : "";
  return [family, company || name, fallback].filter(Boolean).join(" / ");
}

function widthKey(row) {
  return row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
}

function locationKey(row) {
  return row.location_full_path || row.location_name || "No location";
}

function inventoryQty(rows) {
  return rows.reduce((sum, row) => {
    if (["depleted", "scrapped", "in_use"].includes(row.status)) return sum;
    const value = Number(row.length_feet ?? row.quantity ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function statusTone(status) {
  if (status === "on_hold") return "qc";
  if (["scheduled", "allocated"].includes(status)) return "hold";
  if (status === "in_use") return "out";
  if (["depleted", "scrapped"].includes(status)) return "bad";
  return "ready";
}

function InventoryRow({ row, selected, onSelect }) {
  const qty = row.length_feet ?? row.quantity;
  return (
    <button type="button" className={`material-inventory-row ${selected ? "selected" : ""} ${row.status !== "available" ? "not-available" : ""}`} onClick={() => onSelect(row)}>
      <i className={`status-pulse ${statusTone(row.status)}`} aria-hidden="true" />
      <strong>{Number(qty || 0).toLocaleString()} ft</strong>
      <span>{row.serial_number || row.lot_number || getRecordTitle(row)}</span>
      <em>{labelize(row.status)}</em>
    </button>
  );
}

function LocationGroup({ name, rows, selectedId, onSelect }) {
  return (
    <section className="material-location-group">
      <div className="material-location-head">
        <strong>{name}</strong>
        <span>{rows.length} lots</span>
        <em>{inventoryQty(rows).toLocaleString()} ft</em>
      </div>
      <div className="material-inventory-rows compact">
        {rows.map((row) => (
          <InventoryRow key={row.id} row={row} selected={sameId(selectedId, row.id)} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

function WidthGroup({ name, rows, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const byLocation = useMemo(() => groupBy(rows, locationKey), [rows]);
  return (
    <section className="material-width-group">
      <button className="material-width-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{name}</strong>
        <span>{rows.length} lots</span>
        <em>{inventoryQty(rows).toLocaleString()} ft</em>
      </button>
      {open && (
        <div className="material-location-list">
          {Object.entries(byLocation).map(([location, list]) => (
            <LocationGroup key={location} name={location} rows={list} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

function MaterialGroup({ name, rows, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const byWidth = useMemo(() => groupBy(rows, widthKey), [rows]);

  return (
    <section className="material-family-group">
      <button className="material-family-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>{name}</strong>
        <span>{Object.keys(byWidth).length} widths</span>
        <em>{inventoryQty(rows).toLocaleString()} ft</em>
      </button>
      {open && (
        <div className="material-width-list">
          {Object.entries(byWidth).map(([width, list]) => (
            <WidthGroup key={width} name={width} rows={list} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function MaterialInventoryView({ rows, selectedId, onSelect }) {
  const [showInactive, setShowInactive] = useState(false);
  const activeRows = useMemo(
    () => (rows ?? []).filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && Number(row.length_feet ?? row.quantity ?? 0) > 0),
    [rows]
  );
  const displayedRows = showInactive ? (rows ?? []) : activeRows;
  const grouped = useMemo(() => groupBy(displayedRows, materialGroupName), [displayedRows]);

  if (!rows?.length) return <p className="tool-stack-empty">No material inventory matches this view.</p>;

  return (
    <div className="material-inventory-view">
      <header className="material-inventory-mode">
        <div>
          <PackageCheck size={16} />
          <span><strong>{activeRows.length} active rolls</strong><small>Active inventory</small></span>
        </div>
        <button className="ghost-btn xs" type="button" onClick={() => setShowInactive((value) => !value)}>
          <History size={14} /> {showInactive ? "Active Rolls Only" : "Show Used History"}
        </button>
      </header>
      {Object.entries(grouped).map(([name, list]) => (
        <MaterialGroup key={name} name={name} rows={list} selectedId={selectedId} onSelect={onSelect} />
      ))}
      {!displayedRows.length && <p className="tool-stack-empty">No active material rolls match this view.</p>}
    </div>
  );
}
