import { Activity, CalendarPlus, Layers3, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatFeet, getRecordTitle } from "../lib/format";

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

function widthLabel(value) {
  if (value === null || value === undefined || value === "") return "No width";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString()} in` : String(value);
}

function usageConsumes(row) {
  return ["checkout", "manual", "coater", "finished", "shipped", "scrap"].includes(row.usage_type);
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

  return Array.from(byWidth.values())
    .map((entry) => ({
      ...entry,
      locations: Array.from(entry.byLocation.values()).sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => parseFloat(a.width) - parseFloat(b.width));
}

function InventoryByWidth({ rows }) {
  const groups = inventoryByWidth(rows);
  const total = groups.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className="finished-usage-card inventory-by-width-card">
      <div className="finished-usage-head">
        <div>
          <span>Widths and Locations</span>
          <strong>{total.toLocaleString()} ft total</strong>
        </div>
        <em>{groups.length.toLocaleString()} width{groups.length === 1 ? "" : "s"} on hand</em>
      </div>

      {groups.length ? (
        <div className="inventory-width-list">
          {groups.map((group) => (
            <details key={group.width} className="inventory-width-group">
              <summary>
                <strong>{group.width}</strong>
                <span>{group.locations.length} location{group.locations.length === 1 ? "" : "s"}</span>
                <em>{group.rolls} lots / {group.total.toLocaleString()} ft</em>
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultCoaterPress(presses) {
  return (presses ?? []).find((press) => String(press.name || "").trim().toLowerCase() === "eti")
    ?? (presses ?? []).find((press) => /coater|eti/i.test(String(press.name || "")))
    ?? (presses ?? [])[0]
    ?? null;
}

function compatibilitySummary(material, summaryKey, familyKey, nameKey) {
  return material[summaryKey] || material[familyKey] || material[nameKey];
}

function compactValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value}${suffix}`;
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function materialTypeName(material) {
  return material.master_type_code || material.master_type_name || material.material_family || "--";
}

function DetailTile({ label, value, tone = "" }) {
  return (
    <div className={`material-detail-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function CompatibilityCard({ label, value }) {
  return (
    <article className="material-compat-card">
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </article>
  );
}

function NotesPanel({ material }) {
  const notes = [
    ["Cut Plan", material.coater_cut_plan],
    ["Operator Notes", material.operator_notes],
    ["Notes", material.notes],
  ].filter(([, value]) => value);

  return (
    <section className="material-detail-section material-notes-panel">
      <div className="material-section-head">
        <div>
          <span>Notes</span>
          <strong>Run guidance</strong>
        </div>
      </div>
      {notes.length ? (
        <div className="material-notes-list">
          {notes.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <p>{value}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="finished-usage-empty compact">No notes saved for this material.</p>
      )}
    </section>
  );
}

function usageAverage(rows) {
  const usageEvents = rows.filter((row) => {
    const qty = Number(row.quantity ?? 0);
    return Number.isFinite(qty) && qty > 0 && usageConsumes(row);
  });
  const points = dailyUsage(usageEvents);
  const total = points.reduce((sum, point) => sum + point.qty, 0);
  return {
    total,
    events: usageEvents.length,
    days: points.length,
    lastDate: points.at(-1)?.date || "",
    averagePerDay: points.length ? total / points.length : 0,
    averagePerEvent: usageEvents.length ? total / usageEvents.length : 0,
  };
}

function AverageUsagePanel({ rows, onViewUsage }) {
  const stats = usageAverage(rows);

  return (
    <section className="material-detail-section usage-average-panel">
      <div className="material-section-head">
        <div>
          <span>Average Usage</span>
          <strong>{stats.days ? `${Math.round(stats.averagePerDay).toLocaleString()} ft / usage day` : "--"}</strong>
        </div>
        <Activity size={18} />
      </div>
      <div className="usage-average-grid">
        <article>
          <span>Average Event</span>
          <strong>{stats.events ? `${Math.round(stats.averagePerEvent).toLocaleString()} ft` : "--"}</strong>
        </article>
        <article>
          <span>Days Used</span>
          <strong>{stats.days.toLocaleString()}</strong>
        </article>
        <article>
          <span>Last Usage</span>
          <strong>{stats.lastDate || "--"}</strong>
        </article>
      </div>
      <button className="ghost-btn material-activity-btn" type="button" onClick={onViewUsage}>
        <Activity size={15} /> View Activity
      </button>
    </section>
  );
}

export default function FinishedMaterialWindow({ material, usageRows = [], inventoryRows = [], presses = [], scheduling = false, canSchedule = true, startScheduleOpen = false, onClose, onEdit, onSchedule, onViewUsage }) {
  const [scheduleOpen, setScheduleOpen] = useState(Boolean(canSchedule && startScheduleOpen));
  const defaultPress = defaultCoaterPress(presses);
  const [scheduleForm, setScheduleForm] = useState({
    cut_description: "",
    feet: material.target_run_length_feet || "",
    press: defaultPress?.id || "",
    run_date: today(),
    operator_notes: "",
  });

  useEffect(() => {
    if (!defaultPress?.id || scheduleForm.press) return;
    setScheduleForm((prev) => ({ ...prev, press: defaultPress.id }));
  }, [defaultPress?.id, scheduleForm.press]);

  useEffect(() => {
    setScheduleOpen(Boolean(canSchedule && startScheduleOpen));
  }, [canSchedule, material.id, startScheduleOpen]);

  function updateSchedule(name, value) {
    setScheduleForm((prev) => ({ ...prev, [name]: value }));
  }

  function submitSchedule(event) {
    event.preventDefault();
    if (!canSchedule) return;
    onSchedule?.({
      cut_description: scheduleForm.cut_description,
      feet: scheduleForm.feet === "" ? null : Number(scheduleForm.feet),
      press: scheduleForm.press || null,
      run_date: scheduleForm.run_date || null,
      operator_notes: scheduleForm.operator_notes,
    });
  }

  const selectedSchedulePress = presses.find((press) => String(press.id) === String(scheduleForm.press)) || defaultPress;
  const activeInventory = activeInventoryRows(inventoryRows);
  const compatibility = [
    ["Face", compatibilitySummary(material, "allowed_face_material_summary", "face_material_family", "face_material_name")],
    ["Liner", compatibilitySummary(material, "allowed_liner_material_summary", "liner_material_family", "liner_material_name")],
    ["Adhesive", compatibilitySummary(material, "allowed_adhesive_material_summary", "adhesive_material_family", "adhesive_material_name")],
    ["Silicone", compatibilitySummary(material, "allowed_silicone_material_summary", "silicone_material_family", "silicone_material_name")],
    ["Coating", compatibilitySummary(material, "allowed_coating_material_summary", "coating_material_family", "coating_material_name")],
  ];

  return (
    <section className="finished-overlay" role="dialog" aria-modal="true" aria-label="Material">
      <div className="finished-window compact-card">
        <header className="finished-window-head material-detail-hero">
          <div className="material-title-block">
            <p className="eyebrow">{canSchedule ? "Tri-State Material" : "Outside Material"}</p>
            <h2>{getRecordTitle(material)}</h2>
            <div className="material-title-chips">
              <span>{materialTypeName(material)}</span>
              {material.company && <span>{material.company}</span>}
              <span>{material.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <div className="finished-window-actions">
            {canSchedule && (
              <button className="ghost-btn" type="button" onClick={() => setScheduleOpen((value) => !value)}><CalendarPlus size={15} /> Schedule Material</button>
            )}
            <button className="primary-btn" type="button" onClick={onEdit}><Pencil size={15} /> Edit</button>
            <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <div className="material-detail-body">
          <section className="material-detail-overview">
            <DetailTile label="Material Type" value={materialTypeName(material)} tone="primary" />
            <DetailTile label="Inventory" value={inventoryTotalFeet(material, inventoryRows)} />
            <DetailTile label="Lots" value={`${activeInventory.length.toLocaleString()} active`} />
            <DetailTile label="Glue GSM" value={compactValue(material.gsm)} />
            <DetailTile label="Target Run" value={compactValue(material.target_run_length_feet, " ft")} />
            <DetailTile label="Code" value={material.code} />
          </section>

          <section className="material-detail-section material-construction-panel">
            <div className="material-section-head">
              <div>
                <span>Construction</span>
                <strong>{material.material_family || materialTypeName(material)}</strong>
              </div>
              <Layers3 size={18} />
            </div>
            <div className="material-compat-grid">
              {compatibility.map(([label, value]) => (
                <CompatibilityCard key={label} label={label} value={value} />
              ))}
            </div>
          </section>

          {canSchedule && scheduleOpen && (
            <form className="finished-schedule-form material-detail-section" onSubmit={submitSchedule}>
              <div className="finished-schedule-title">
                <span>Schedule Material</span>
                <strong>{selectedSchedulePress ? `Press: ${selectedSchedulePress.name}` : "Coater Lineup"}</strong>
              </div>
              <label>
                <span>Press</span>
                <select value={scheduleForm.press} onChange={(event) => updateSchedule("press", event.target.value)}>
                  <option value="">Unassigned</option>
                  {presses.map((press) => (
                    <option value={press.id} key={press.id}>{press.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Run Date</span>
                <input type="date" value={scheduleForm.run_date} onChange={(event) => updateSchedule("run_date", event.target.value)} />
              </label>
              <label>
                <span>Cutting Notes</span>
                <input value={scheduleForm.cut_description} onChange={(event) => updateSchedule("cut_description", event.target.value)} placeholder="Cut 9/9" />
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
                <button className="primary-btn" type="submit" disabled={scheduling}>{scheduling ? "Scheduling..." : "Schedule Material"}</button>
              </div>
            </form>
          )}

          <InventoryByWidth rows={inventoryRows} />

          <div className="material-detail-grid">
            <AverageUsagePanel rows={usageRows} onViewUsage={onViewUsage} />
            <NotesPanel material={material} />
          </div>
        </div>
      </div>
    </section>
  );
}
