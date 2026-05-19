import { useState } from "react";
import { CalendarClock, ClipboardList, Gauge, Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import { formatInches, getRecordTitle } from "../lib/format";

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

function orderQuantity(row) {
  return numeric(row.quantity_to_ship) + numeric(row.quantity_to_stock);
}

function formatQty(value) {
  const number = numeric(value);
  return number.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(number) ? 0 : 3,
  });
}

function scheduleImage(row) {
  return row.job_general_image_url || row.general_image_url || "";
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

function ScheduleFact({ label, value }) {
  return (
    <div className="schedule-fact">
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
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

function ScheduleDetailOverlay({ row, presses, currentUser, onClose, onEdit, onUpdate }) {
  if (!row) return null;
  const tone = shipTone(row);

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
            <button className="ghost-btn" type="button" onClick={onEdit}>Edit Full Form</button>
            <button className="ghost-btn" type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        <section className="schedule-detail-grid">
          <div>
            <span>Customer</span>
            <strong>{row.customer_name || "--"}</strong>
          </div>
          <div>
            <span>TSM ID</span>
            <strong>{row.product_code || row.job_product_code || "--"}</strong>
          </div>
          <div>
            <span>Customer PO</span>
            <strong>{row.customer_po || "--"}</strong>
          </div>
          <div>
            <span>Ship Date</span>
            <strong>{row.due_date || "--"}</strong>
          </div>
          <div>
            <span>Ship / Stock</span>
            <strong>{numeric(row.quantity_to_ship).toLocaleString()} / {numeric(row.quantity_to_stock).toLocaleString()}</strong>
          </div>
          <div>
            <span>Total Quantity</span>
            <strong>{orderQuantity(row).toLocaleString()}</strong>
          </div>
        </section>

        <section className="schedule-workflow-panel">
          <div className="schedule-control">
            <span>Current Lineup</span>
            <select value={row.press || ""} onChange={(event) => moveToLineup(row, event.target.value, onUpdate, currentUser)}>
              <option value="">Unassigned</option>
              {presses.map((press) => <option value={press.id} key={press.id}>{press.name}</option>)}
            </select>
          </div>
          <label className="schedule-control">
            <span>Press Order #</span>
            <input type="number" defaultValue={row.press_sequence ?? ""} onBlur={(event) => updateOnBlur(event, row.press_sequence, (value) => onUpdate(row.id, { press_sequence: value ? Number(value) : null, last_updated_by: currentUser?.name || "" }))} />
          </label>
          <label className="schedule-control">
            <span>Operator</span>
            <input defaultValue={row.operator || ""} onBlur={(event) => updateOnBlur(event, row.operator, (value) => onUpdate(row.id, { operator: value, last_updated_by: currentUser?.name || "" }))} />
          </label>
          <label className="schedule-control">
            <span>Actual Footage</span>
            <input type="number" step="0.01" defaultValue={row.actual_footage ?? ""} onBlur={(event) => updateOnBlur(event, row.actual_footage, (value) => onUpdate(row.id, { actual_footage: value ? Number(value) : null, last_updated_by: currentUser?.name || "" }))} />
          </label>
          <label className="schedule-control wide">
            <span>Footage Report</span>
            <textarea defaultValue={row.footage_report || ""} onBlur={(event) => updateOnBlur(event, row.footage_report, (value) => onUpdate(row.id, { footage_report: value, last_updated_by: currentUser?.name || "" }))} placeholder="Operator footage, waste, roll changes, issues, or completion notes." />
          </label>
        </section>

        <section className="schedule-detail-grid">
          <div>
            <span>Label Size</span>
            <strong>{formatInches(row.label_width_inches || row.job_label_width_inches)} x {formatInches(row.label_length_inches || row.job_label_length_inches)}</strong>
          </div>
          <div>
            <span>Material</span>
            <strong>{[row.job_material_spec_code, row.job_material_spec_name].filter(Boolean).join(" / ") || "--"}</strong>
          </div>
          <div>
            <span>Recipe</span>
            <strong>{row.recipe_name || "--"}</strong>
          </div>
          <div>
            <span>Box</span>
            <strong>{[row.box_item_number, row.box_name].filter(Boolean).join(" / ") || "--"}</strong>
          </div>
          <div>
            <span>Scheduled By</span>
            <strong>{row.scheduled_by || "--"}</strong>
          </div>
          <div>
            <span>Last Updated By</span>
            <strong>{row.last_updated_by || "--"}</strong>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ProductionScheduleView({ rows, selected, presses = [], currentUser, onSelect, onClose, onEdit, onUpdate, onRemove }) {
  const [removeRow, setRemoveRow] = useState(null);
  const grouped = buildLineupGroups(rows, presses);

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
            {group.rows.map((row) => (
              <article className={`schedule-card ${selected?.id === row.id ? "active" : ""}`} key={row.id}>
                <button className="schedule-receipt-main" type="button" onClick={() => onSelect(row)}>
                  <ScheduleThumb row={row} />
                  <div className="schedule-receipt-body">
                    <div className="schedule-card-title">
                      <strong>{scheduleTitle(row)}</strong>
                      <span className={`schedule-ship-pill ${shipTone(row)}`}>{shipLabel(row)}</span>
                    </div>
                    <div className="schedule-receipt-grid">
                      <ScheduleFact label="Customer" value={row.customer_name} />
                      <ScheduleFact label="Ship" value={formatQty(row.quantity_to_ship)} />
                      <ScheduleFact label="Stock" value={formatQty(row.quantity_to_stock)} />
                      <ScheduleFact label="Scheduled By" value={row.scheduled_by || row.last_updated_by} />
                    </div>
                    <div className="schedule-receipt-foot">
                      <span><ClipboardList size={12} /> {row.customer_po || "No PO"}</span>
                      <span><Gauge size={12} /> {row.press_sequence ? `Lineup #${row.press_sequence}` : group.label}</span>
                      <span><CalendarClock size={12} /> {row.due_date || "No ship date"}</span>
                    </div>
                  </div>
                </button>
                <div className="schedule-card-controls">
                  <select aria-label="Move to lineup" value={row.press || ""} onChange={(event) => moveToLineup(row, event.target.value, onUpdate, currentUser)}>
                    <option value="">Unassigned</option>
                    {presses.map((press) => <option value={press.id} key={press.id}>{press.name}</option>)}
                  </select>
                  <input type="number" min="1" placeholder="#" defaultValue={row.press_sequence ?? ""} onBlur={(event) => updateOnBlur(event, row.press_sequence, (value) => onUpdate(row.id, { press_sequence: value ? Number(value) : null, last_updated_by: currentUser?.name || "" }))} />
                  {row.press && (
                    <button className="ghost-btn xs" type="button" onClick={() => moveToLineup(row, "", onUpdate, currentUser)}>
                      <RotateCcw size={12} /> Unassign
                    </button>
                  )}
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
        presses={presses}
        currentUser={currentUser}
        onClose={onClose}
        onEdit={onEdit}
        onUpdate={onUpdate}
      />
      <RemoveScheduleDialog
        row={removeRow}
        onClose={() => setRemoveRow(null)}
        onConfirm={onRemove}
      />
    </section>
  );
}
