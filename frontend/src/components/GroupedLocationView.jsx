import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { labelize } from "../lib/format";

function pathParts(row) {
  const path = row.full_path || row.name || "";
  return String(path).split(" > ").map((part) => part.trim()).filter(Boolean);
}

function rootName(row) {
  return pathParts(row)[0] || row.name || "Unassigned";
}

function secondName(row) {
  const parts = pathParts(row);
  if (parts.length >= 2) return parts[1];
  return "Root";
}

function displayName(row) {
  const parts = pathParts(row);
  if (parts.length >= 3) return row.code || parts.at(-1) || row.name;
  return row.name || row.code || "--";
}

function groupRows(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const root = rootName(row);
    const second = secondName(row);
    acc[root] ??= {};
    acc[root][second] ??= [];
    acc[root][second].push(row);
    return acc;
  }, {});
}

function LocationRow({ row, selected, onSelect, onEdit, onDelete }) {
  return (
    <article className={`location-row ${selected ? "selected" : ""}`} onClick={() => onSelect(row)}>
      <div>
        <strong>{displayName(row)}</strong>
        <span>{row.full_path || row.name}</span>
      </div>
      <span>{row.code || "--"}</span>
      <em>{labelize(row.location_type)}</em>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        <button className="ghost-btn xs" type="button" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>
        <button className="danger-btn xs" type="button" onClick={() => onDelete(row)}><Trash2 size={13} /> Delete</button>
      </div>
    </article>
  );
}

function SecondGroup({ name, rows, selectedId, onSelect, onEdit, onDelete }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="location-second-group">
      <button type="button" className="location-second-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{name}</strong>
        <span>{rows.length} records</span>
      </button>
      {open && (
        <div className="location-row-list">
          {rows.map((row) => (
            <LocationRow
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

export default function GroupedLocationView({ rows, selectedId, onSelect, onEdit, onDelete }) {
  const grouped = useMemo(() => groupRows(rows), [rows]);
  const [openRoots, setOpenRoots] = useState({});

  if (!rows?.length) return <p className="empty-row">No locations match this view.</p>;

  return (
    <div className="location-tree-view">
      {Object.entries(grouped).map(([root, seconds]) => {
        const open = openRoots[root] ?? true;
        const count = Object.values(seconds).reduce((sum, list) => sum + list.length, 0);
        return (
          <section className="location-root-group" key={root}>
            <button type="button" className="location-root-head" onClick={() => setOpenRoots((prev) => ({ ...prev, [root]: !open }))}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <strong>{root}</strong>
              <span>{Object.keys(seconds).length} groups</span>
              <em>{count} records</em>
            </button>
            {open && (
              <div className="location-second-list">
                {Object.entries(seconds).map(([second, list]) => (
                  <SecondGroup
                    key={second}
                    name={second}
                    rows={list}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
