import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatInches, getRecordTitle, groupBy, labelize } from "../lib/format";

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function materialGroupName(row) {
  const family = row.material_family || row.material_name || row.name || "Unassigned Material";
  const name = row.material_name && row.material_name !== family ? row.material_name : "";
  const code = row.material_code ? `(${row.material_code})` : "";
  return [family, name, code].filter(Boolean).join(" / ");
}

function widthKey(row) {
  return row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
}

function availableQty(rows) {
  return rows.reduce((sum, row) => {
    if (row.status !== "available") return sum;
    const value = Number(row.length_feet ?? row.quantity ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function InventoryRow({ row, selected, onSelect }) {
  const qty = row.length_feet ?? row.quantity;
  return (
    <button type="button" className={`material-inventory-row ${selected ? "selected" : ""} ${row.status !== "available" ? "not-available" : ""}`} onClick={() => onSelect(row)}>
      <strong>{row.serial_number || row.lot_number || getRecordTitle(row)}</strong>
      <span>{row.location_full_path || row.location_name || "No location"}</span>
      <em>{[qty ? `${qty} ft` : "", labelize(row.status)].filter(Boolean).join(" / ") || "--"}</em>
    </button>
  );
}

function WidthGroup({ name, rows, selectedId, onSelect }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="material-width-group">
      <button className="material-width-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{name}</strong>
        <span>{rows.length} lots</span>
        <em>{availableQty(rows).toLocaleString()} ft</em>
      </button>
      {open && (
        <div className="material-inventory-rows">
          {rows.map((row) => (
            <InventoryRow key={row.id} row={row} selected={sameId(selectedId, row.id)} onSelect={onSelect} />
          ))}
        </div>
      )}
    </section>
  );
}

function MaterialGroup({ name, rows, selectedId, onSelect }) {
  const [open, setOpen] = useState(true);
  const byWidth = useMemo(() => groupBy(rows, widthKey), [rows]);

  return (
    <section className="material-family-group">
      <button className="material-family-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>{name}</strong>
        <span>{Object.keys(byWidth).length} widths</span>
        <em>{availableQty(rows).toLocaleString()} ft</em>
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
  const grouped = useMemo(() => groupBy(rows ?? [], materialGroupName), [rows]);

  if (!rows?.length) return <p className="tool-stack-empty">No material inventory matches this view.</p>;

  return (
    <div className="material-inventory-view">
      {Object.entries(grouped).map(([name, list]) => (
        <MaterialGroup key={name} name={name} rows={list} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
