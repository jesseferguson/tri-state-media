import { CalendarPlus, Pencil, X } from "lucide-react";
import { useState } from "react";
import { formatCell, formatFeet, getRecordTitle, labelize } from "../lib/format";

function usageTitle(row) {
  return [row.reference, row.inventory_serial, row.inventory_lot].filter(Boolean).join(" / ") || labelize(row.usage_type);
}

function dailyUsage(rows) {
  const byDate = new Map();
  rows.forEach((row) => {
    const qty = Number(row.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (!usageConsumes(row)) return;
    const date = row.used_date || "No date";
    byDate.set(date, (byDate.get(date) ?? 0) + qty);
  });
  return Array.from(byDate.entries())
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function MaterialUsageChart({ rows }) {
  const points = dailyUsage(rows);
  const max = Math.max(...points.map((point) => point.qty), 1);
  const total = points.reduce((sum, point) => sum + point.qty, 0);

  return (
    <section className="finished-usage-card">
      <div className="finished-usage-head">
        <div>
          <span>Usage Chart</span>
          <strong>{total.toLocaleString()} ft total</strong>
        </div>
        <em>X: date / Y: footage</em>
      </div>

      {points.length ? (
        <div className="finished-chart" role="img" aria-label="Material usage by date">
          <div className="finished-y-axis">
            <span>{max.toLocaleString()}</span>
            <span>{Math.round(max / 2).toLocaleString()}</span>
            <span>0</span>
          </div>
          <div className="finished-bars">
            {points.map((point) => (
              <div className="finished-bar-cell" key={point.date}>
                <div className="finished-bar-track">
                  <span style={{ height: `${Math.max(5, Math.round((point.qty / max) * 100))}%` }} />
                </div>
                <strong>{point.qty.toLocaleString()}</strong>
                <em>{String(point.date).slice(5)}</em>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="finished-usage-empty">No usage has been recorded for this material yet.</p>
      )}
    </section>
  );
}

function widthLabel(value) {
  if (value === null || value === undefined || value === "") return "No width";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString()} in` : String(value);
}

function usageConsumes(row) {
  return ["checkout", "manual", "coater", "finished", "scrap"].includes(row.usage_type);
}

function inventoryStatusTone(status) {
  if (status === "on_hold") return "qc";
  if (["scheduled", "allocated"].includes(status)) return "hold";
  if (status === "in_use") return "out";
  if (["depleted", "scrapped"].includes(status)) return "bad";
  return "ready";
}

function activeInventoryRows(rows) {
  return (rows ?? []).filter((row) => row.is_active !== false && !["depleted", "scrapped", "in_use"].includes(row.status));
}

function inventoryTotalFeet(material, inventoryRows) {
  if (material.inventory_total_feet !== null && material.inventory_total_feet !== undefined && material.inventory_total_feet !== "") {
    return formatFeet(material.inventory_total_feet);
  }
  const total = activeInventoryRows(inventoryRows).reduce((sum, row) => sum + (Number(row.length_feet ?? row.quantity ?? 0) || 0), 0);
  return formatFeet(total);
}

function inventoryByWidth(rows) {
  const byWidth = new Map();
  activeInventoryRows(rows).forEach((row) => {
    const width = widthLabel(row.width_inches);
    if (!byWidth.has(width)) byWidth.set(width, { width, total: 0, rolls: 0, byLocation: new Map() });
    const entry = byWidth.get(width);
    const qty = Number(row.length_feet ?? row.quantity ?? 0);
    const feet = Number.isFinite(qty) ? qty : 0;
    const location = row.location_full_path || row.location_name || "No location";
    entry.total += feet;
    entry.rolls += 1;
    if (!entry.byLocation.has(location)) entry.byLocation.set(location, { location, total: 0, rolls: 0, statuses: new Set() });
    const loc = entry.byLocation.get(location);
    loc.total += feet;
    loc.rolls += 1;
    loc.statuses.add(row.status || "available");
  });

  return Array.from(byWidth.values()).map((entry) => ({
    ...entry,
    locations: Array.from(entry.byLocation.values()),
  }));
}

function InventoryByWidth({ rows }) {
  const groups = inventoryByWidth(rows);
  const total = groups.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className="finished-usage-card inventory-by-width-card">
      <div className="finished-usage-head">
        <div>
          <span>Inventory On Hand</span>
          <strong>{total.toLocaleString()} ft total</strong>
        </div>
        <em>Grouped by width and location</em>
      </div>

      {groups.length ? (
        <div className="inventory-width-list">
          {groups.map((group) => (
            <details key={group.width} className="inventory-width-group" open>
              <summary>
                <strong>{group.width}</strong>
                <span>{group.rolls} lots</span>
                <em>{group.total.toLocaleString()} ft</em>
              </summary>
              <div className="inventory-location-list">
                {group.locations.map((location) => {
                  const tone = location.statuses.has("on_hold") ? "qc" : location.statuses.has("scheduled") || location.statuses.has("allocated") ? "hold" : "ready";
                  return (
                    <article key={location.location} className="inventory-location-row">
                      <i className={`status-pulse ${tone}`} aria-hidden="true" />
                      <strong>{location.location}</strong>
                      <span>{location.rolls} lots</span>
                      <em>{location.total.toLocaleString()} ft</em>
                    </article>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className="finished-usage-empty">No active inventory is linked to this material yet.</p>
      )}
    </section>
  );
}

function widthUsageData(inventoryRows, usageRows) {
  const byWidth = new Map();

  function ensure(width) {
    const key = widthLabel(width);
    if (!byWidth.has(key)) byWidth.set(key, { width: key, added: 0, used: 0, rolls: 0 });
    return byWidth.get(key);
  }

  inventoryRows.forEach((row) => {
    const entry = ensure(row.width_inches);
    const current = Number(row.length_feet ?? row.quantity ?? 0);
    entry.added += Number.isFinite(current) ? current : 0;
    entry.rolls += 1;
  });

  usageRows.forEach((row) => {
    const qty = Number(row.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const entry = ensure(row.inventory_width_inches);
    if (usageConsumes(row)) {
      entry.used += qty;
      entry.added += qty;
    }
  });

  return Array.from(byWidth.values())
    .filter((row) => row.added > 0 || row.used > 0)
    .sort((a, b) => parseFloat(a.width) - parseFloat(b.width));
}

function WidthUsageChart({ inventoryRows, usageRows }) {
  const rows = widthUsageData(inventoryRows, usageRows);
  const max = Math.max(...rows.flatMap((row) => [row.added, row.used]), 1);

  return (
    <section className="finished-usage-card">
      <div className="finished-usage-head">
        <div>
          <span>Width Usage</span>
          <strong>Added vs used footage</strong>
        </div>
        <em>Grouped by width</em>
      </div>

      {rows.length ? (
        <div className="width-usage-chart">
          {rows.map((row) => (
            <article className="width-usage-row" key={row.width}>
              <strong>{row.width}</strong>
              <div className="width-bars">
                <span className="added" style={{ width: `${Math.max(4, Math.round((row.added / max) * 100))}%` }} />
                <span className="used" style={{ width: `${Math.max(4, Math.round((row.used / max) * 100))}%` }} />
              </div>
              <em>{row.added.toLocaleString()} added / {row.used.toLocaleString()} used</em>
            </article>
          ))}
        </div>
      ) : (
        <p className="finished-usage-empty">No width inventory or usage has been recorded for this material yet.</p>
      )}
    </section>
  );
}

export default function FinishedMaterialWindow({ material, usageRows = [], inventoryRows = [], scheduling = false, onClose, onEdit, onSchedule }) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    cut_description: "",
    feet: material.target_run_length_feet || "",
    operator_notes: "",
  });

  const fields = [
    ["Code", material.code],
    ["Family", material.material_family],
    ["Inventory", inventoryTotalFeet(material, inventoryRows)],
    ["Glue GSM", material.gsm],
    ["Face Type", material.face_material_family || material.face_material_name],
    ["Liner Type", material.liner_material_family || material.liner_material_name],
    ["Adhesive Type", material.adhesive_material_family || material.adhesive_material_name],
    ["Silicone Type", material.silicone_material_family || material.silicone_material_name],
    ["Coating Type", material.coating_material_family || material.coating_material_name],
    ["Active", material.is_active ? "Yes" : "No"],
  ];

  function updateSchedule(name, value) {
    setScheduleForm((prev) => ({ ...prev, [name]: value }));
  }

  function submitSchedule(event) {
    event.preventDefault();
    onSchedule?.({
      cut_description: scheduleForm.cut_description,
      feet: scheduleForm.feet === "" ? null : Number(scheduleForm.feet),
      operator_notes: scheduleForm.operator_notes,
    });
  }

  return (
    <section className="finished-overlay" role="dialog" aria-modal="true" aria-label="Finished raw material">
      <div className="finished-window compact-card">
        <header className="finished-window-head">
          <div>
            <p className="eyebrow">Finished Raw Material</p>
            <h2>{getRecordTitle(material)}</h2>
          </div>
          <div className="finished-window-actions">
            <button className="ghost-btn" type="button" onClick={() => setScheduleOpen((value) => !value)}><CalendarPlus size={15} /> Schedule</button>
            <button className="primary-btn" type="button" onClick={onEdit}><Pencil size={15} /> Edit</button>
            <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <div className="finished-material-grid">
          {fields.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value || "--"}</strong>
            </div>
          ))}
        </div>

        <MaterialUsageChart rows={usageRows} />

        <InventoryByWidth rows={inventoryRows} />

        <WidthUsageChart inventoryRows={inventoryRows} usageRows={usageRows} />

        {scheduleOpen && (
          <form className="finished-schedule-form" onSubmit={submitSchedule}>
            <div className="finished-schedule-title">
              <span>Schedule</span>
              <strong>Press: ETI</strong>
            </div>
            <label>
              <span>Cut Description</span>
              <input value={scheduleForm.cut_description} onChange={(event) => updateSchedule("cut_description", event.target.value)} placeholder="Example: 3 x 13 in" />
            </label>
            <label>
              <span>Feet</span>
              <input type="number" step="0.01" value={scheduleForm.feet} onChange={(event) => updateSchedule("feet", event.target.value)} placeholder="Run feet" />
            </label>
            <label className="field-wide">
              <span>Note To Operator</span>
              <textarea value={scheduleForm.operator_notes} onChange={(event) => updateSchedule("operator_notes", event.target.value)} placeholder="Operator note for this scheduled run" />
            </label>
            <div className="finished-schedule-actions">
              <button className="primary-btn" type="submit" disabled={scheduling}>{scheduling ? "Scheduling..." : "Put On Schedule"}</button>
            </div>
          </form>
        )}

        <div className="finished-usage-list">
          {usageRows.slice(0, 6).map((row) => (
            <article key={row.id}>
              <strong>{usageTitle(row)}</strong>
              <span>{[formatCell(row, "used_date"), labelize(row.usage_type), row.quantity ? `${row.quantity} ${row.unit}` : ""].filter(Boolean).join(" / ")}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
