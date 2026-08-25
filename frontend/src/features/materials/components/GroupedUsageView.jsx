import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { formatCell, labelize } from "../../../lib/format";

function usageType(row) {
  return labelize(row.usage_type) || "Unknown";
}

function yearOf(row) {
  const date = String(row.used_date || row.created_at || "");
  return date.slice(0, 4) || "No year";
}

function monthOf(row) {
  const date = String(row.used_date || row.created_at || "");
  if (date.length < 7) return "No month";
  const parsed = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date.slice(0, 7);
  return parsed.toLocaleString(undefined, { month: "long" });
}

function groupRows(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const type = usageType(row);
    const year = yearOf(row);
    const month = monthOf(row);
    acc[type] ??= {};
    acc[type][year] ??= {};
    acc[type][year][month] ??= [];
    acc[type][year][month].push(row);
    return acc;
  }, {});
}

function totalQty(rows) {
  return rows.reduce((sum, row) => {
    const qty = Number(row.quantity ?? 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function UsageRow({ row, selected, onSelect, onEdit, onDelete }) {
  return (
    <article className={`usage-ledger-row ${selected ? "selected" : ""}`} onClick={() => onSelect(row)}>
      <div>
        <strong>{row.reference || row.inventory_serial || row.material_name || "Usage record"}</strong>
        <span>{[formatCell(row, "used_date"), row.material_name, row.inventory_lot].filter(Boolean).join(" / ")}</span>
      </div>
      <span>{row.quantity ? `${Number(row.quantity).toLocaleString()} ${row.unit || ""}` : "--"}</span>
      <em>{row.used_by || "--"}</em>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        <button className="ghost-btn xs" type="button" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>
        <button className="danger-btn xs" type="button" onClick={() => onDelete(row)}><Trash2 size={13} /> Delete</button>
      </div>
    </article>
  );
}

function MonthGroup({ name, rows, selectedId, onSelect, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="usage-month-group">
      <button className="usage-month-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <strong>{name}</strong>
        <span>{rows.length} records</span>
        <em>{totalQty(rows).toLocaleString()} qty</em>
      </button>
      {open && (
        <div className="usage-row-list">
          {rows.map((row) => (
            <UsageRow
              key={row.id}
              row={row}
              selected={String(selectedId) === String(row.id)}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function YearGroup({ year, months, selectedId, onSelect, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  const rows = Object.values(months).flat();
  return (
    <section className="usage-year-group">
      <button className="usage-year-head" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{year}</strong>
        <span>{rows.length} records</span>
        <em>{totalQty(rows).toLocaleString()} qty</em>
      </button>
      {open && (
        <div className="usage-month-list">
          {Object.entries(months).map(([month, list]) => (
            <MonthGroup key={month} name={month} rows={list} selectedId={selectedId} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function GroupedUsageView({ rows, selectedId, onSelect, onEdit, onDelete }) {
  const grouped = useMemo(() => groupRows(rows), [rows]);
  const [openTypes, setOpenTypes] = useState({});

  if (!rows?.length) return <p className="empty-row">No usage records match this view.</p>;

  return (
    <div className="usage-ledger-view">
      {Object.entries(grouped).map(([type, years]) => {
        const open = openTypes[type] ?? true;
        const rowsForType = Object.values(years).flatMap((months) => Object.values(months).flat());
        return (
          <section className="usage-type-group" key={type}>
            <button className="usage-type-head" type="button" onClick={() => setOpenTypes((prev) => ({ ...prev, [type]: !open }))}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <strong>{type}</strong>
              <span>{rowsForType.length} records</span>
              <em>{totalQty(rowsForType).toLocaleString()} qty</em>
            </button>
            {open && (
              <div className="usage-year-list">
                {Object.entries(years).map(([year, months]) => (
                  <YearGroup key={year} year={year} months={months} selectedId={selectedId} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
