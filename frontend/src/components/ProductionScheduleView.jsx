import { useMemo, useState } from "react";
import { Image as ImageIcon, PackageCheck, Trash2 } from "lucide-react";
import { formatInches, getRecordTitle, labelize } from "../lib/format";
import RecipeOptionsView from "./RecipeOptionsView";

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date - todayStart()) / 86_400_000);
}

function shipTone(row) {
  const days = daysUntil(row.due_date);
  if (days === null) return "neutral";
  if (days < 0) return "late";
  if (days <= 2) return "urgent";
  if (days <= 5) return "soon";
  return "ok";
}

function shipLabel(row) {
  const days = daysUntil(row.due_date);
  if (days === null) return "No ship date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} late`;
  if (days === 0) return "Ships today";
  return `${days} day${days === 1 ? "" : "s"} to ship`;
}

function scheduleTitle(row) {
  return [row.job_ticket_number, row.job_name].filter(Boolean).join(" / ") || getRecordTitle(row);
}

function schedulePartNumber(row) {
  return row.job_name || row.job_product_code || row.job_ticket_number || getRecordTitle(row);
}

function orderQuantity(row) {
  return numeric(row.quantity_to_ship) + numeric(row.quantity_to_stock);
}

function formatQty(value) {
  const number = numeric(value);
  return number.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 3,
  });
}

function formatNumber(value, suffix = "") {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "--";
  const rounded = Math.round(number * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

function scheduleImage(row) {
  return row.job_general_image_url || row.general_image_url || "";
}

function formatShortDate(value) {
  if (!value) return "--";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function daysOnSchedule(row) {
  const value = row.order_date || row.scheduled_date || row.created_at;
  if (!value) return "--";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "--";
  return Math.max(0, Math.floor((todayStart() - date) / 86_400_000));
}

function inventoryFootage(row) {
  return numeric(row?.length_feet ?? row?.quantity);
}

function ticketForSchedule(row, lookups) {
  return (lookups?.["job-tickets"] ?? []).find((ticket) => sameId(ticket.id, row.job_ticket)) ?? null;
}

function scheduleTicketFallback(row) {
  if (!row) return null;
  return {
    id: row.job_ticket,
    ticket_number: row.job_ticket_number,
    job_name: row.job_name,
    product_code: row.job_product_code,
    material_spec: row.job_material_spec,
    material_spec_code: row.job_material_spec_code,
    material_spec_name: row.job_material_spec_name,
    material_master_type: row.job_material_master_type,
    material_master_type_code: row.job_material_master_type_code,
    material_spec_master_type: row.job_material_spec_master_type,
    material_spec_master_type_code: row.job_material_spec_master_type_code,
    recipe: row.job_recipe,
    recipe_name: row.recipe_name,
    label_width_inches: row.job_label_width_inches,
    label_length_inches: row.job_label_length_inches,
    repeat_inches: row.job_repeat_inches,
    cutting_type: row.job_cutting_type,
    finishing_type: row.job_finishing_type,
    labels_per_unit: row.job_labels_per_unit,
    units_per_carton: row.job_units_per_carton,
    labels_per_carton: row.job_labels_per_carton,
    core_size_inches: row.job_core_size_inches,
    wind_direction: row.job_wind_direction,
    box_item_number: row.box_item_number,
    box_name: row.box_name,
  };
}

function matchingMaterialInventory(ticket, rows) {
  if (!ticket) return [];
  return (rows ?? []).filter((row) => {
    if (sameId(row.material, ticket.material_spec)) return true;
    if (ticket.material_master_type && sameId(row.material_master_type, ticket.material_master_type)) return true;
    if (ticket.material_spec_master_type && sameId(row.material_master_type, ticket.material_spec_master_type)) return true;
    if (ticket.material_spec_code && row.material_code === ticket.material_spec_code) return true;
    if (ticket.material_spec_code && row.code === ticket.material_spec_code) return true;
    return false;
  });
}

function matchingRecipeOptions(ticket, rows) {
  if (!ticket) return [];
  return (rows ?? []).filter((row) => {
    if (ticket.recipe && sameId(row.recipe, ticket.recipe)) return true;
    if (ticket.recipe_name && row.recipe_name === ticket.recipe_name) return true;
    return false;
  });
}

function groupInventoryByWidth(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const qty = inventoryFootage(row);
    if (qty <= 0 || ["depleted", "scrapped"].includes(row.status)) return acc;
    const key = row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
    if (!acc[key]) acc[key] = { rows: [], total: 0 };
    acc[key].rows.push(row);
    acc[key].total += qty;
    return acc;
  }, {});
}

function sortScheduleRows(rows) {
  return [...rows].sort((a, b) => {
    const aSequence = a.press_sequence ? numeric(a.press_sequence) : Number.MAX_SAFE_INTEGER;
    const bSequence = b.press_sequence ? numeric(b.press_sequence) : Number.MAX_SAFE_INTEGER;
    const sequence = aSequence - bSequence;
    if (sequence) return sequence;
    return String(a.due_date || a.order_date || "").localeCompare(String(b.due_date || b.order_date || ""));
  });
}

function moveToLineup(row, pressId, onUpdate, currentUser) {
  const nextPress = pressId ? Number(pressId) : null;
  onUpdate(row.id, {
    press: nextPress,
    status: nextPress ? "scheduled" : "unscheduled",
    last_updated_by: currentUser?.name || "",
  });
}

function buildLineupGroups(rows, presses) {
  const knownPressIds = new Set(presses.map((press) => String(press.id)));
  const groups = [
    {
      key: "unassigned",
      label: "Unassigned",
      rows: sortScheduleRows(rows.filter((row) => !row.press)),
    },
    ...presses.map((press) => ({
      key: `press-${press.id}`,
      label: press.name,
      rows: sortScheduleRows(rows.filter((row) => String(row.press ?? "") === String(press.id))),
    })),
  ];

  const extraPressRows = rows.filter((row) => row.press && !knownPressIds.has(String(row.press)));
  const extraGroups = new Map();
  extraPressRows.forEach((row) => {
    const key = `press-extra-${row.press}`;
    if (!extraGroups.has(key)) {
      extraGroups.set(key, { key, label: row.press_name || "Other Press", rows: [] });
    }
    extraGroups.get(key).rows.push(row);
  });

  return [
    ...groups,
    ...Array.from(extraGroups.values()).map((group) => ({ ...group, rows: sortScheduleRows(group.rows) })),
  ];
}

function updateOnBlur(event, value, onSave) {
  if (String(event.target.value ?? "") !== String(value ?? "")) onSave(event.target.value);
}

function ScheduleThumb({ row }) {
  const src = scheduleImage(row);
  return (
    <div className="schedule-thumb">
      {src ? (
        <img src={src} alt={row.job_general_image_name || row.job_name || "Scheduled job"} />
      ) : (
        <ImageIcon size={17} />
      )}
    </div>
  );
}

function ScheduleMaterialChart({ rows }) {
  const groups = Object.entries(groupInventoryByWidth(rows ?? []))
    .map(([label, group]) => ({ label, value: group.total }))
    .filter((group) => group.value > 0);
  if (!groups.length) return <p className="muted">No active material widths yet.</p>;
  const max = Math.max(...groups.map((group) => group.value), 1);
  return (
    <div className="schedule-material-chart">
      {groups.map((group) => (
        <div key={group.label}>
          <span>{group.label}</span>
          <strong>{formatNumber(group.value, " ft")}</strong>
          <em style={{ "--bar-width": `${Math.max(5, (group.value / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function ScheduleFact({ label, value }) {
  return (
    <span className="schedule-qty-line">
      <em>{label}</em>
      <i aria-hidden="true" />
      <strong>{value || "--"}</strong>
    </span>
  );
}

function RemoveScheduleDialog({ row, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!row) return null;

  async function submit(event) {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setError("Enter a reason before removing this job from the schedule.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(row, cleanReason);
      onClose();
    } catch (err) {
      setError(err.message || "Could not remove this job from the schedule.");
      setSubmitting(false);
    }
  }

  return (
    <section className="schedule-remove-overlay" role="dialog" aria-modal="true" aria-label="Remove scheduled job">
      <form className="schedule-remove-window" onSubmit={submit}>
        <div>
          <p className="eyebrow">Remove From Schedule</p>
          <h2>{scheduleTitle(row)}</h2>
          <span>{row.customer_name || "No customer"} / {shipLabel(row)}</span>
        </div>
        <label>
          <span>Reason Required</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Example: customer changed quantity, duplicate schedule entry, job cancelled..."
          />
        </label>
        {error && <p className="schedule-remove-error">{error}</p>}
        <div className="schedule-remove-actions">
          <button className="ghost-btn" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="danger-btn" type="submit" disabled={submitting}>
            {submitting ? "Removing..." : "Remove Job"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ScheduleDetailOverlay({ row, lookups, onClose, onFlexDieReorder, onFlexDieCountUpdate }) {
  if (!row) return null;
  const tone = shipTone(row);
  const ticket = ticketForSchedule(row, lookups) ?? scheduleTicketFallback(row);
  const materialInventory = matchingMaterialInventory(ticket, lookups?.["raw-materials"])
    .filter((item) => item.is_active !== false && !["depleted", "scrapped"].includes(item.status) && inventoryFootage(item) > 0);
  const materialFeet = materialInventory.reduce((sum, item) => sum + inventoryFootage(item), 0);
  const recipeOptions = matchingRecipeOptions(ticket, lookups?.["recipe-options"]);

  return (
    <section className="schedule-overlay" role="dialog" aria-modal="true" aria-label="Schedule order details">
      <div className="schedule-window">
        <header className="schedule-window-head">
          <div>
            <p className="eyebrow">Scheduled Order</p>
            <h2>{scheduleTitle(row)}</h2>
            <span className={`schedule-ship-pill ${tone}`}>{shipLabel(row)}</span>
          </div>
          <div className="schedule-window-actions">
            <button className="ghost-btn" type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        <section className="schedule-packet-hero">
          <ScheduleThumb row={row} />
          <div className="schedule-detail-grid">
            <DetailItem label="Customer" value={row.customer_name} />
            <DetailItem label="TSM ID" value={row.product_code || row.job_product_code} />
            <DetailItem label="Customer PO" value={row.customer_po} />
            <DetailItem label="Ship Date" value={row.due_date} />
            <DetailItem label="Ship / Stock" value={`${formatQty(row.quantity_to_ship)} / ${formatQty(row.quantity_to_stock)}`} />
            <DetailItem label="Scheduled By" value={row.scheduled_by} />
          </div>
        </section>

        <section className="schedule-operator-sections">
          <div className="schedule-operator-card">
            <h3><PackageCheck size={15} /> Label Specs</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Size" value={`${formatInches(ticket?.label_width_inches || row.job_label_width_inches)} x ${formatInches(ticket?.label_length_inches || row.job_label_length_inches)}`} />
              <DetailItem label="Repeat" value={formatInches(ticket?.repeat_inches || row.job_repeat_inches)} />
              <DetailItem label="Recipe" value={ticket?.recipe_name || row.recipe_name} />
              <DetailItem label="Cutting" value={labelize(ticket?.cutting_type)} />
            </div>
          </div>

          <div className="schedule-operator-card">
            <h3><PackageCheck size={15} /> Material</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Material Type" value={ticket?.material_master_type_code || ticket?.material_spec_master_type_code} />
              <DetailItem label="Material" value={[row.job_material_spec_code, row.job_material_spec_name].filter(Boolean).join(" / ")} />
              <DetailItem label="On Hand" value={`${materialInventory.length} rolls / ${formatNumber(materialFeet, " ft")}`} />
            </div>
            <ScheduleMaterialChart rows={materialInventory} />
          </div>

          <div className="schedule-operator-card">
            <h3><PackageCheck size={15} /> Finishing & Box</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Finishing" value={labelize(ticket?.finishing_type)} />
              <DetailItem label="Core / Wind" value={[formatInches(ticket?.core_size_inches), ticket?.wind_direction ? `Wind ${ticket.wind_direction}` : ""].filter(Boolean).join(" / ")} />
              <DetailItem label="Labels / Unit" value={ticket?.labels_per_unit} />
              <DetailItem label="Units / Carton" value={ticket?.units_per_carton} />
              <DetailItem label="Box" value={[row.box_item_number || ticket?.box_item_number, row.box_name || ticket?.box_name].filter(Boolean).join(" / ")} />
            </div>
          </div>

          <div className="schedule-operator-card wide">
            <h3><PackageCheck size={15} /> Tooling</h3>
            {recipeOptions.length ? (
              <RecipeOptionsView
                rows={recipeOptions}
                operatorName={row.operator || row.last_updated_by || row.scheduled_by}
                onFlexDieReorder={onFlexDieReorder}
                onFlexDieCountUpdate={onFlexDieCountUpdate}
              />
            ) : (
              <p className="muted">No tooling options are linked to this job yet.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ProductionScheduleView({ rows, selected, presses = [], currentUser, lookups = {}, onSelect, onClose, onEdit, onUpdate, onRemove, onFlexDieReorder, onFlexDieCountUpdate }) {
  const [removeRow, setRemoveRow] = useState(null);
  const grouped = useMemo(() => buildLineupGroups(rows, presses), [rows, presses]);

  return (
    <section className="schedule-board">
      {grouped.map((group) => (
        <section className="schedule-status-group" key={group.key}>
          <header>
            <div>
              <strong>{group.label}</strong>
              <span>{group.rows.length} job{group.rows.length === 1 ? "" : "s"}</span>
            </div>
          </header>
          <div className="schedule-card-list">
            {group.rows.map((row, index) => (
              <article className={`schedule-card ${selected?.id === row.id ? "active" : ""}`} key={row.id}>
                <button className="schedule-receipt-main" type="button" onClick={() => onSelect(row)}>
                  <ScheduleThumb row={row} />
                  <div className="schedule-receipt-body">
                    <span className="schedule-sequence">{row.press_sequence || index + 1}</span>
                    <strong className="schedule-part-number" title={schedulePartNumber(row)}>{schedulePartNumber(row)}</strong>
                    <span className="schedule-date">{formatShortDate(row.order_date || row.scheduled_date)}</span>
                    <span className="schedule-customer" title={row.customer_name || ""}>{row.customer_name || "--"}</span>
                    <span className="schedule-scheduled-by">{row.scheduled_by || row.last_updated_by || "--"}</span>
                    <div className="schedule-qty-lines">
                      <ScheduleFact label="Stock" value={formatQty(row.quantity_to_stock)} />
                      <ScheduleFact label="Ship" value={formatQty(row.quantity_to_ship)} />
                    </div>
                    <span className="schedule-days-on">{daysOnSchedule(row)} Day(s) On Schedule</span>
                  </div>
                </button>
                <div className="schedule-card-controls">
                  <select aria-label="Move to lineup" value={row.press || ""} onChange={(event) => moveToLineup(row, event.target.value, onUpdate, currentUser)}>
                    <option value="">Unassigned</option>
                    {presses.map((press) => <option value={press.id} key={press.id}>{press.name}</option>)}
                  </select>
                  <input type="number" min="1" placeholder="#" defaultValue={row.press_sequence ?? ""} onBlur={(event) => updateOnBlur(event, row.press_sequence, (value) => onUpdate(row.id, { press_sequence: value ? Number(value) : null, last_updated_by: currentUser?.name || "" }))} />
                  <button className="ghost-btn xs" type="button" onClick={() => onEdit?.(row)}>
                    Edit
                  </button>
                  {onRemove && (
                    <button className="danger-btn xs" type="button" onClick={() => setRemoveRow(row)}>
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!group.rows.length && <p className="schedule-empty">No jobs here.</p>}
          </div>
        </section>
      ))}

      <ScheduleDetailOverlay
        row={selected}
        lookups={lookups}
        onClose={onClose}
        onFlexDieReorder={onFlexDieReorder}
        onFlexDieCountUpdate={onFlexDieCountUpdate}
      />
      <RemoveScheduleDialog
        row={removeRow}
        onClose={() => setRemoveRow(null)}
        onConfirm={onRemove}
      />
    </section>
  );
}
