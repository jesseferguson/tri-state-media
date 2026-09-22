import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, CheckCircle2, ClipboardList, Factory, FileText, History, Image as ImageIcon, Layers3, PackageCheck, PauseCircle, Play, RotateCcw, ScanLine, Search, Trash2, X } from "lucide-react";
import { formatInches, getRecordTitle, labelize } from "../../../lib/format";
import { AuthenticatedImage, PdfPreview, isPdfUrl } from "../../../shared/components/FilePreview";
import RecipeOptionsView from "../../tooling/components/RecipeOptionsView";
import ScheduleMaterialWorkflow from "./ScheduleMaterialWorkflow";
import { buildLineupPositions, buildPressScopes, createLineupItems, filterLineupItems, groupLineupItems } from "../utils/scheduleLineup";
import "./ProductionScheduleView.css";

const schedulePriorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const schedulePriorityLabels = Object.fromEntries(schedulePriorityOptions.map((option) => [option.value, option.label]));
const schedulePriorityAliases = {
  normal: "low",
  rush: "medium",
  hot: "high",
};
const scheduleHoldReasonOptions = [
  { value: "tooling", label: "Tooling" },
  { value: "material", label: "Material" },
  { value: "boxes", label: "Boxes" },
  { value: "cores", label: "Cores" },
  { value: "adhesive", label: "Adhesive" },
  { value: "liner", label: "Liner" },
  { value: "face", label: "Face" },
  { value: "art_files", label: "Art / Files" },
];
const scheduleHoldReasonLabels = Object.fromEntries(scheduleHoldReasonOptions.map((option) => [option.value, option.label]));

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

function parseLocalDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function daysUntil(value) {
  const date = parseLocalDate(value);
  if (!date) return null;
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

function unitNoun(ticket) {
  return ticket?.unit_type === "tag" ? "Tags" : "Labels";
}

function unitPerPackageLabel(ticket) {
  return ticket?.finishing_type === "rolls" ? `${unitNoun(ticket)} / Roll` : `${unitNoun(ticket)} / Unit`;
}

function unitsPerCartonLabel(ticket) {
  return `${unitNoun(ticket)} / Carton`;
}

function labelsPerFoldLabel(ticket) {
  return `${unitNoun(ticket)} / Fold`;
}

function scheduleImage(row) {
  return row.job_general_image_url || row.general_image_url || "";
}

function scheduleImageIsDocument(row) {
  if (row.job_general_image_is_document) return true;
  return isPdfUrl(scheduleImage(row));
}

function formatShortDate(value) {
  if (!value) return "--";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatShortDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatShortDate(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function normalizeSchedulePriority(value) {
  const key = String(value || "low").toLowerCase();
  if (schedulePriorityAliases[key]) return schedulePriorityAliases[key];
  return schedulePriorityLabels[key] ? key : "low";
}

function schedulePriorityLabel(value) {
  return schedulePriorityLabels[normalizeSchedulePriority(value)] || "Low";
}

function normalizeHoldReasons(value) {
  if (Array.isArray(value)) return value.filter((item) => scheduleHoldReasonLabels[item]);
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeHoldReasons(parsed);
    } catch {
      return value.split(",").map((item) => item.trim()).filter((item) => scheduleHoldReasonLabels[item]);
    }
  }
  return [];
}

function holdReasonLabel(value) {
  return scheduleHoldReasonLabels[value] || labelize(value);
}

function holdReasonSummary(row) {
  const reasons = normalizeHoldReasons(row.hold_reasons).map(holdReasonLabel);
  return reasons.join(", ") || row.hold_notes || "No hold reason recorded";
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
    description: row.job_description,
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
    unit_type: row.job_unit_type,
    labels_per_unit: row.job_labels_per_unit,
    units_per_carton: row.job_units_per_carton,
    labels_per_carton: row.job_labels_per_carton,
    core_size_inches: row.job_core_size_inches,
    wind_direction: row.job_wind_direction,
    fanfold_gear: row.job_fanfold_gear,
    labels_per_fold: row.job_labels_per_fold,
    ribbon: row.job_ribbon,
    laminate: row.job_laminate,
    bagged: row.job_bagged,
    core: row.job_core,
    core_name: row.job_core_name,
    core_item_number: row.job_core_item_number,
    box_item_number: row.box_item_number,
    linked_box_item_number: row.linked_box_item_number,
    box_name: row.box_name,
    job_notes: row.job_notes,
    finishing_notes: row.job_finishing_notes,
    has_print: row.job_has_print,
    print_method: row.job_print_method,
    print_method_display: row.job_print_method_display,
    art_file_created: row.job_art_file_created,
    print_notes: row.job_print_notes,
    print_plate_summary: row.job_print_plate_summary,
  };
}

function isDynamicSchedule(row, ticket = null) {
  return String(row?.job_print_method || ticket?.print_method || "") === "dynamic";
}

function dynamicRangeLabel(row) {
  return [row?.dynamic_start_number, row?.dynamic_end_number].filter(Boolean).join(" - ");
}

function dynamicFileLabel(row) {
  if (!isDynamicSchedule(row)) return "";
  if (!row.dynamic_file_created) return "Files not created";
  return dynamicRangeLabel(row) || "File created";
}

function scheduleHasPrint(row, ticket = null) {
  return Boolean(
    row?.job_has_print ||
    ticket?.has_print ||
    (row?.job_print_method && row.job_print_method !== "none") ||
    (ticket?.print_method && ticket.print_method !== "none")
  );
}

function schedulePrintMethodLabel(row, ticket = null) {
  if (!scheduleHasPrint(row, ticket)) return "No Print";
  return row?.job_print_method_display || ticket?.print_method_display || labelize(row?.job_print_method || ticket?.print_method || "static");
}

function schedulePrintPlates(row, ticket = null) {
  const scheduleSummary = Array.isArray(row?.job_print_plate_summary) ? row.job_print_plate_summary : [];
  if (scheduleSummary.length) return scheduleSummary;
  const ticketSummary = Array.isArray(ticket?.print_plate_summary) ? ticket.print_plate_summary : [];
  if (ticketSummary.length) return ticketSummary;
  return (ticket?.print_plate_details ?? []).map((plate) => ({
    ...plate,
    stations: plate.stations ?? [],
  }));
}

function matchingMaterialInventory(ticket, rows) {
  if (!ticket) return [];
  const masterType = ticket.material_master_type || ticket.material_spec_master_type;
  return (rows ?? []).filter((row) => {
    if (row.material_type && row.material_type !== "coated_stock") return false;
    if (masterType) return sameId(row.material_master_type, masterType);
    if (sameId(row.material, ticket.material_spec)) return true;
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

function matchingCoreInventory(ticket, rows) {
  if (!ticket?.core) return [];
  return (rows ?? []).filter((row) => sameId(row.core, ticket.core));
}

function inventoryLocationSummary(rows) {
  return (rows ?? [])
    .filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && numeric(row.quantity) > 0)
    .slice(0, 4)
    .map((row) => `${row.location_full_path || row.location_name || "No location"}: ${formatNumber(row.quantity)}`)
    .join(" / ");
}

function schedulePressPreferenceKey(user) {
  return `tsm-main-schedule-press:${user?.id || user?.username || user?.name || "guest"}`;
}

function readSchedulePressPreference(user) {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(schedulePressPreferenceKey(user)) || "all";
    return stored === "held" ? "all" : stored.replace(/^press-extra-/, "press-");
  } catch {
    return "all";
  }
}

function saveSchedulePressPreference(user, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(schedulePressPreferenceKey(user), value || "all");
  } catch {
    // Local storage can be unavailable in private or locked-down browser contexts.
  }
}

function comparePressNames(a, b) {
  return String(a?.name || a?.label || "").localeCompare(String(b?.name || b?.label || ""), undefined, { numeric: true });
}

function activePressList(presses = []) {
  const active = presses.filter((press) => press?.is_active !== false);
  return [...active].sort(comparePressNames);
}

function coaterScheduleTitle(row) {
  return row.scheduled_material_name || row.produced_material_name || row.name || row.tag_number || "Material Run";
}

function productMaterialCode(row) {
  return row.job_material_spec_name || row.job_material_spec_master_type || row.job_material_spec_code || row.job_material_spec_master_type_code || "";
}

function coaterProgress(row, rolls = []) {
  const target = numeric(row.schedule_target_footage ?? row.length_feet);
  const documentedFromRows = rolls
    .filter((roll) => roll.status === "complete")
    .reduce((sum, roll) => sum + numeric(roll.length_feet), 0);
  const documented = numeric(row.schedule_documented_footage) || documentedFromRows;
  const remaining = Math.max(0, target - documented);
  const percent = target > 0 ? Math.min(100, (documented / target) * 100) : 0;
  return {
    target,
    documented,
    remaining,
    percent,
    rollCount: numeric(row.schedule_roll_count) || rolls.filter((roll) => roll.status !== "void").length,
    pendingCount: numeric(row.schedule_pending_roll_count) || rolls.filter((roll) => roll.status === "tag_printed").length,
  };
}

function itemTitle(item) {
  return item.kind === "material" ? coaterScheduleTitle(item.row) : schedulePartNumber(item.row);
}

function isHeldScheduleItem(item) {
  return item.kind === "product" && String(item?.row?.status || "") === "on_hold";
}

function itemSpecLabel(item) {
  if (isHeldScheduleItem(item)) return "Held For";
  return item.kind === "material" ? "Footage" : "Material";
}

function itemSpecLine(item) {
  const row = item.row;
  if (item.kind === "material") {
    const progress = coaterProgress(row);
    return progress.target ? formatNumber(progress.target) : "--";
  }
  if (isHeldScheduleItem(item)) return holdReasonSummary(row);
  return productMaterialCode(row) || "Material not assigned";
}

function ScheduleThumb({ row }) {
  const src = scheduleImage(row);
  const source = row.job_general_image_source || "";
  return (
    <div className="schedule-thumb">
      {src && !scheduleImageIsDocument(row) ? (
        <AuthenticatedImage className="schedule-thumb-image" src={src} alt={row.job_general_image_name || row.job_name || "Scheduled job"} />
      ) : src ? (
        <PdfPreview url={src} title={row.job_general_image_name || row.job_name || "Scheduled PDF"} compact />
      ) : (
        <ImageIcon size={17} />
      )}
      {source && <em>{source}</em>}
    </div>
  );
}

function MaterialRunThumb({ row }) {
  return (
    <div className="schedule-thumb material-roll-thumb" aria-label="Material roll">
      <div className="material-roll-art" aria-hidden="true">
        <span className="material-roll-sheet" />
        <span className="material-roll-face">
          <i />
          <span className="material-roll-core" />
        </span>
        <span className="material-roll-shadow" />
      </div>
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
      <strong>{value === 0 ? 0 : value || "--"}</strong>
    </div>
  );
}

function ScheduleNoteBlock({ label, value, emptyText }) {
  return (
    <article className={`schedule-note-block ${value ? "has-note" : ""}`}>
      <span>{label}</span>
      <p>{value || emptyText}</p>
    </article>
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

function HoldScheduleDialog({ row, currentUser, onClose, onConfirm }) {
  const [selectedReasons, setSelectedReasons] = useState(() => normalizeHoldReasons(row?.hold_reasons));
  const [notes, setNotes] = useState(row?.hold_notes || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!row) return null;

  function toggleReason(value) {
    setSelectedReasons((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  }

  async function submit(event) {
    event.preventDefault();
    if (!selectedReasons.length) {
      setError("Select at least one reason before moving this job to Held.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(row, {
        status: "on_hold",
        hold_reasons: selectedReasons,
        hold_notes: notes.trim(),
        held_by: currentUser?.name || currentUser?.username || "",
      });
      onClose();
    } catch (err) {
      setError(err.message || "Could not move this job to Held.");
      setSubmitting(false);
    }
  }

  return (
    <section className="schedule-hold-overlay" role="dialog" aria-modal="true" aria-label="Move scheduled job to Held">
      <form className="schedule-hold-window" onSubmit={submit}>
        <div>
          <p className="eyebrow">Move To Held</p>
          <h2>{scheduleTitle(row)}</h2>
          <span>{row.customer_name || "No customer"} / {shipLabel(row)}</span>
        </div>
        <fieldset className="schedule-hold-reason-grid">
          <legend>Hold Reasons</legend>
          {scheduleHoldReasonOptions.map((option) => (
            <label className={selectedReasons.includes(option.value) ? "selected" : ""} key={option.value}>
              <input
                type="checkbox"
                checked={selectedReasons.includes(option.value)}
                onChange={() => toggleReason(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="schedule-hold-note-field">
          <span>Hold Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add details the scheduler or operator should know..."
          />
        </label>
        {error && <p className="schedule-remove-error">{error}</p>}
        <div className="schedule-remove-actions">
          <button className="ghost-btn" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={submitting}>
            {submitting ? "Moving..." : "Move To Held"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ScheduleDetailOverlay({ row, lookups, currentUser, onClose, onFlexDieReorder, onFlexDieCountUpdate }) {
  if (!row) return null;
  const tone = shipTone(row);
  const ticket = ticketForSchedule(row, lookups) ?? scheduleTicketFallback(row);
  const dynamicSchedule = isDynamicSchedule(row, ticket);
  const hasPrint = scheduleHasPrint(row, ticket);
  const printPlates = schedulePrintPlates(row, ticket);
  const materialInventory = matchingMaterialInventory(ticket, lookups?.["raw-materials"])
    .filter((item) => item.is_active !== false && !["depleted", "scrapped"].includes(item.status) && inventoryFootage(item) > 0);
  const materialFeet = materialInventory.reduce((sum, item) => sum + inventoryFootage(item), 0);
  const recipeOptions = matchingRecipeOptions(ticket, lookups?.["recipe-options"]);
  const coreInventory = matchingCoreInventory(ticket, lookups?.["core-inventory"]);

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

        <section className="schedule-packet-hero schedule-product-packet-hero">
          <ScheduleThumb row={row} />
          <div className="schedule-info-cluster">
            <article className="schedule-info-group order">
              <h3><ClipboardList size={15} /> Order</h3>
              <div className="schedule-detail-grid compact">
                <DetailItem label="Customer" value={row.customer_name} />
                <DetailItem label="TSM ID" value={row.product_code || row.job_product_code} />
                <DetailItem label="Customer PO" value={row.customer_po} />
                <DetailItem label="Ship Date" value={row.due_date} />
                <DetailItem label="Ship / Stock" value={`${formatQty(row.quantity_to_ship)} / ${formatQty(row.quantity_to_stock)}`} />
                <DetailItem label="Scheduled By" value={row.scheduled_by} />
                {dynamicSchedule && <DetailItem label="Dynamic File" value={dynamicFileLabel(row)} />}
                {dynamicSchedule && <DetailItem label="Number Range" value={dynamicRangeLabel(row)} />}
              </div>
              {dynamicSchedule && (
                <div className={`schedule-dynamic-file-panel ${row.dynamic_file_created ? "ready" : "hold"}`}>
                  <FileText size={15} />
                  <div>
                    <strong>{dynamicFileLabel(row)}</strong>
                    <span>{row.dynamic_file_notes || (row.dynamic_file_created ? "Dynamic file is ready for this order." : holdReasonSummary(row))}</span>
                  </div>
                </div>
              )}
              <ScheduleNoteBlock label="CSR Schedule Note" value={row.notes} emptyText="No CSR schedule note entered." />
            </article>

            <article className="schedule-info-group specs">
              <h3><PackageCheck size={15} /> Label Specs</h3>
              <div className="schedule-detail-grid compact">
                <DetailItem label="Size" value={`${formatInches(ticket?.label_width_inches || row.job_label_width_inches)} x ${formatInches(ticket?.label_length_inches || row.job_label_length_inches)}`} />
                <DetailItem label="Repeat" value={formatInches(ticket?.repeat_inches || row.job_repeat_inches)} />
                <DetailItem label="Recipe" value={ticket?.recipe_name || row.recipe_name} />
                <DetailItem label="Cutting" value={labelize(ticket?.cutting_type)} />
                <DetailItem label="Description" value={ticket?.description} />
              </div>
            </article>

            <article className="schedule-info-group material">
              <h3><Layers3 size={15} /> Material</h3>
              <div className="schedule-detail-grid compact">
                <DetailItem label="Material Type" value={ticket?.material_master_type_code || ticket?.material_spec_master_type_code} />
                <DetailItem label="Material" value={[row.job_material_spec_code, row.job_material_spec_name].filter(Boolean).join(" / ")} />
                <DetailItem label="On Hand" value={`${materialInventory.length} rolls / ${formatNumber(materialFeet, " ft")}`} />
              </div>
              <ScheduleMaterialChart rows={materialInventory} />
            </article>
          </div>
        </section>

        <section className="schedule-note-grid">
          <ScheduleNoteBlock label="Operator Run Note" value={ticket?.job_notes} emptyText="No operator run note on this ticket." />
          {ticket?.finishing_notes && <ScheduleNoteBlock label="Finishing Note" value={ticket.finishing_notes} />}
        </section>

        <section className="schedule-operator-sections">
          <div className="schedule-operator-card wide schedule-material-action-card">
            <ScheduleMaterialWorkflow
              schedule={row}
              ticket={ticket}
              inventoryRows={lookups?.["raw-materials"] ?? []}
              currentUser={currentUser}
            />
          </div>

          <div className="schedule-operator-card">
            <h3><PackageCheck size={15} /> Finishing & Box</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Finishing" value={labelize(ticket?.finishing_type)} />
              <DetailItem label="Core / Wind" value={[formatInches(ticket?.core_size_inches), ticket?.wind_direction ? `Wind ${ticket.wind_direction}` : ""].filter(Boolean).join(" / ")} />
              {ticket?.finishing_type === "fanfold" && <DetailItem label="Fanfold Gear" value={ticket?.fanfold_gear} />}
              {ticket?.finishing_type === "fanfold" && <DetailItem label={labelsPerFoldLabel(ticket)} value={ticket?.labels_per_fold} />}
              <DetailItem label={unitPerPackageLabel(ticket)} value={ticket?.labels_per_unit} />
              <DetailItem label={unitsPerCartonLabel(ticket)} value={ticket?.units_per_carton} />
              <DetailItem label="Ribbon" value={labelize(ticket?.ribbon || "no_ribbon")} />
              <DetailItem label="Laminate" value={labelize(ticket?.laminate || "no_laminate")} />
              <DetailItem label="Bagged" value={labelize(ticket?.bagged || "not_bagged")} />
              <DetailItem label="Box Item #" value={row.box_item_number || ticket?.box_item_number || ticket?.linked_box_item_number} />
              <DetailItem label="Box Link" value={[row.linked_box_item_number || ticket?.linked_box_item_number, row.box_name || ticket?.box_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Core Link" value={[ticket?.core_item_number, ticket?.core_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Core On Hand" value={inventoryLocationSummary(coreInventory)} />
            </div>
          </div>

          {hasPrint && (
            <div className="schedule-operator-card wide schedule-print-setup-card">
              <h3><FileText size={15} /> Print Setup</h3>
              <div className="schedule-detail-grid compact">
                <DetailItem label="Method" value={schedulePrintMethodLabel(row, ticket)} />
                <DetailItem label="Art File" value={ticket?.art_file_created || row.job_art_file_created ? "Created" : dynamicSchedule ? "Order Specific" : "Needed"} />
                {dynamicSchedule && <DetailItem label="Dynamic File" value={dynamicFileLabel(row)} />}
                {dynamicSchedule && <DetailItem label="Number Range" value={dynamicRangeLabel(row)} />}
                <DetailItem label="Plates" value={printPlates.length} />
                <DetailItem label="Print Notes" value={ticket?.print_notes || row.job_print_notes} />
              </div>
              {printPlates.length ? (
                <div className="schedule-print-plate-list">
                  {printPlates.map((plate) => (
                    <article key={plate.id || plate.plate_number}>
                      <header>
                        <strong>{plate.plate_number || "Plate"}</strong>
                        <span>{plate.description || plate.customer_plate_number || "Print plate"}</span>
                      </header>
                      {(plate.stations ?? []).length ? (
                        <div>
                          {(plate.stations ?? []).map((station) => (
                            <em key={station.id || `${plate.id}-${station.station_number}`}>
                              {[`Station ${station.station_number || "--"}`, station.station_plate_number || plate.plate_number, station.pms_color, station.anilox_gear_number ? `Anilox ${station.anilox_gear_number}` : ""].filter(Boolean).join(" / ")}
                            </em>
                          ))}
                        </div>
                      ) : (
                        <p>No station rows linked.</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No linked print plates are available for this scheduled job.</p>
              )}
            </div>
          )}

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

function scheduleHistoryRows(item) {
  const row = item.row;
  if (item.kind === "product" && Array.isArray(row.customer_order_events) && row.customer_order_events.length) {
    return row.customer_order_events.map((event) => ({
      id: event.id || `${event.event_type}-${event.created_at}`,
      title: labelize(event.event_type || "order event"),
      detail: event.summary,
      by: event.performed_by,
      date: event.created_at,
    }));
  }
  return [
    row.updated_at ? {
      id: "updated",
      title: "Updated",
      detail: [row.last_updated_by ? `By ${row.last_updated_by}` : "", row.status ? `Status ${labelize(row.status)}` : ""].filter(Boolean).join(" / ") || "Schedule item updated.",
      by: row.last_updated_by,
      date: row.updated_at,
    } : null,
    row.created_at ? {
      id: "created",
      title: "Created",
      detail: [row.scheduled_by ? `By ${row.scheduled_by}` : "", row.press_name || "Unassigned"].filter(Boolean).join(" / ") || "Schedule item created.",
      by: row.scheduled_by,
      date: row.created_at,
    } : null,
  ].filter(Boolean);
}

function ScheduleLineupBack({ item }) {
  const row = item.row;
  const isMaterial = item.kind === "material";
  const isHeld = isHeldScheduleItem(item);
  const dynamicSchedule = !isMaterial && isDynamicSchedule(row);
  const noteRows = isMaterial
    ? [
      { label: "Cut Description", value: row.cut_description },
      { label: "Operator Note", value: row.operator_notes || row.notes },
    ]
    : [
      ...(isHeld ? [
        { label: "Hold Reasons", value: holdReasonSummary(row) },
        { label: "Hold Notes", value: row.hold_notes },
      ] : []),
      ...(dynamicSchedule ? [
        { label: "Dynamic File", value: dynamicFileLabel(row) },
        { label: "Number Range", value: dynamicRangeLabel(row) },
        { label: "Dynamic File Note", value: row.dynamic_file_notes },
      ] : []),
      { label: "CSR Schedule Note", value: row.notes },
      { label: "Operator Run Note", value: row.job_notes },
      { label: "Footage Report", value: row.footage_report },
    ];
  const events = scheduleHistoryRows(item);
  return (
    <div className="schedule-lineup-back">
      <div className="schedule-lineup-note-stack">
        {noteRows.map((note) => (
          <article className={note.value ? "has-note" : ""} key={note.label}>
            <span>{note.label}</span>
            <p>{note.value || "No note entered."}</p>
          </article>
        ))}
      </div>
      <div className="schedule-lineup-history">
        <span><History size={13} /> History</span>
        {events.slice(0, 4).map((event) => (
          <article key={event.id}>
            <strong>{event.title}</strong>
            <p>{event.detail || "Schedule activity recorded."}</p>
            <em>{[event.by, formatShortDateTime(event.date)].filter(Boolean).join(" / ")}</em>
          </article>
        ))}
        {!events.length && <p>No history has been recorded yet.</p>}
      </div>
    </div>
  );
}

function ScheduleLineupRow({
  item, position, selectedProduct, selectedMaterial, presses, canMoveUp, canMoveDown,
  moving, reorderCount, currentUser, onSelect, onEdit, onUpdate, onMaterialUpdate,
  onRemove, onHold, onUseMaterial, onOpenMaterialRun, onMove, onPositionChange,
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nextPosition, setNextPosition] = useState(String(position || ""));
  const row = item.row;
  const isMaterial = item.kind === "material";
  const isHeld = row.status === "on_hold";
  const active = isMaterial ? sameId(selectedMaterial?.id, row.id) : sameId(selectedProduct?.id, row.id);
  const canUpdate = isMaterial ? Boolean(onMaterialUpdate) : Boolean(onUpdate);
  const disabled = saving || moving;
  const pressChoices = activePressList(presses);
  const selectChoices = !row.press || pressChoices.some((press) => sameId(press.id, row.press))
    ? pressChoices : [{ id: row.press, name: row.press_name || `Press ${row.press}` }, ...pressChoices];
  const priority = normalizeSchedulePriority(row.priority);
  const dynamicSchedule = !isMaterial && isDynamicSchedule(row);

  useEffect(() => { setNextPosition(String(position || "")); }, [position]);

  async function saveItem(payload) {
    if (!canUpdate || disabled) return;
    setSaving(true);
    setError("");
    try {
      if (isMaterial) await onMaterialUpdate(row.id, payload);
      else await onUpdate(row.id, { ...payload, last_updated_by: currentUser?.name || currentUser?.username || "" });
    } catch (err) {
      setError(err.message || "This change could not be saved. Try again.");
    } finally { setSaving(false); }
  }

  function handlePressChange(value) {
    const nextPress = value ? Number(value) : null;
    // Unnumbered assignments follow numbered work on the destination press.
    const payload = { press: nextPress, press_sequence: null };
    if (!isMaterial && !isHeld && row.status !== "running") {
      payload.status = nextPress ? (row.status === "unscheduled" || !row.status ? "scheduled" : row.status) : "unscheduled";
    }
    return saveItem(payload);
  }

  const date = isMaterial ? row.run_date : row.due_date;
  return (
    <article className={`schedule-lineup-row schedule-job-card ${isMaterial ? "material" : "product"} ${active ? "active" : ""}`} role="listitem" aria-label={itemTitle(item)} aria-busy={disabled}>
      <div className="schedule-lineup-position">
        <strong title={row.press ? "Position in this press's full lineup" : "No press assigned"}>{row.press ? position : "-"}</strong>
        {reorderCount > 1 && <div className="schedule-move-buttons">
          <button type="button" title="Move up" aria-label={`Move ${itemTitle(item)} up`} disabled={!canMoveUp || disabled} onClick={() => onMove(item, "up")}><ArrowUp size={16} /></button>
          <button type="button" title="Move down" aria-label={`Move ${itemTitle(item)} down`} disabled={!canMoveDown || disabled} onClick={() => onMove(item, "down")}><ArrowDown size={16} /></button>
        </div>}
      </div>
      <button className="schedule-lineup-main" type="button" onClick={() => onSelect(item)} aria-label={`View details for ${itemTitle(item)}`}>
        {isMaterial ? <MaterialRunThumb row={row} /> : <ScheduleThumb row={row} />}
        <div className="schedule-lineup-title">
          <span className={`schedule-kind-pill ${isMaterial ? "material" : "product"}`}>{isMaterial ? <Layers3 size={14} /> : <ClipboardList size={14} />}{isMaterial ? "Material run" : "Job ticket"}</span>
          <strong className={isMaterial ? undefined : "schedule-part-number"}>{itemTitle(item)}</strong>
          <small>{isMaterial ? row.tag_number : [row.customer_name, row.job_ticket_number].filter(Boolean).join(" / ")}</small>
          {dynamicSchedule && <span className={`schedule-dynamic-pill ${row.dynamic_file_created ? "ready" : "hold"}`} title={dynamicRangeLabel(row) || dynamicFileLabel(row)}><FileText size={13} />{dynamicFileLabel(row)}</span>}
        </div>
      </button>
      <div className="schedule-lineup-spec">
        <span>{itemSpecLabel(item)}</span><strong>{itemSpecLine(item)}{isMaterial && coaterProgress(row).target ? " ft" : ""}</strong>
        {!isMaterial && priority !== "low" && <small>{schedulePriorityLabel(row.priority)} priority</small>}
      </div>
      <div className="schedule-lineup-meta">
        <span className={`schedule-status-pill ${row.status || "scheduled"}`}>{labelize(row.status || "scheduled")}</span>
        <strong>{isMaterial ? "Run" : "Due"}: {date ? formatShortDate(date) : "Not set"}</strong>
        <em>Press: {row.press_name || (row.press ? `Press ${row.press}` : "Unassigned")}</em>
      </div>
      <div className="schedule-job-footer">
        <button className="ghost-btn xs" type="button" onClick={() => onSelect(item)}>Details</button>
        <button className="ghost-btn xs" type="button" aria-expanded={showNotes} aria-controls={`schedule-notes-${item.key}`} onClick={() => setShowNotes((value) => !value)}><History size={14} />{showNotes ? "Hide notes" : "Notes"}</button>
        {saving && <span role="status">Saving...</span>}
      </div>
      {showNotes && <div className="schedule-job-note-content" id={`schedule-notes-${item.key}`}><ScheduleLineupBack item={item} /></div>}
      {(canUpdate || onEdit || onOpenMaterialRun || onUseMaterial) && <details className="schedule-job-manage">
        <summary>{isMaterial ? "Manage run" : "Manage job"}</summary>
        <div className="schedule-lineup-editors">
          {!isMaterial && <label><span>Priority</span><select aria-label={`Priority for ${itemTitle(item)}`} value={priority} disabled={!canUpdate || disabled} onChange={(event) => saveItem({ priority: event.target.value })}>{schedulePriorityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>}
          <label><span>Assign to press</span><select aria-label={`Assign ${itemTitle(item)} to press`} value={row.press || ""} disabled={!canUpdate || disabled} onChange={(event) => handlePressChange(event.target.value)}>
            <option value="">Unassigned</option>{selectChoices.map((press) => <option value={press.id} key={press.id}>{press.name}</option>)}
          </select></label>
          {reorderCount > 1 && <form className="schedule-position-form" onSubmit={(event) => { event.preventDefault(); onPositionChange(item, Number(nextPosition) - 1); }}>
            <label><span>Lineup position</span><input aria-label={`Lineup position for ${itemTitle(item)}`} type="number" min="1" max={reorderCount} step="1" required value={nextPosition} disabled={disabled} onChange={(event) => setNextPosition(event.target.value)} /></label>
            <button className="ghost-btn xs" disabled={disabled || Number(nextPosition) === position} type="submit">Move</button>
          </form>}
        </div>
        <div className="schedule-lineup-actions">
          {!isMaterial && <>
            {onEdit && <button className="ghost-btn xs" type="button" disabled={disabled} onClick={() => onEdit(row)}>Edit job</button>}
            {canUpdate && (isHeld
              ? <button className="primary-btn xs" type="button" disabled={disabled || (dynamicSchedule && !row.dynamic_file_created)} onClick={() => saveItem({ status: row.press ? "scheduled" : "unscheduled" })}><RotateCcw size={13} />Resume</button>
              : <button className="ghost-btn xs" type="button" disabled={disabled} onClick={() => onHold?.(row)}><PauseCircle size={13} />Hold</button>)}
            {onUseMaterial && <button className="ghost-btn xs" type="button" disabled={disabled} onClick={() => onUseMaterial(row)}><ScanLine size={13} />Scan roll</button>}
            {onRemove && <button className="danger-btn xs" type="button" disabled={disabled} onClick={() => onRemove(row)}><Trash2 size={13} />Remove</button>}
          </>}
          {isMaterial && onOpenMaterialRun && <button className="primary-btn xs" type="button" disabled={disabled} onClick={() => onOpenMaterialRun(row)}><Play size={13} />Open run</button>}
          {isMaterial && canUpdate && <button className="danger-btn xs" type="button" disabled={disabled} onClick={() => saveItem({ status: "void" })}><Trash2 size={13} />Remove</button>}
        </div>
        {isHeld && dynamicSchedule && !row.dynamic_file_created && <p className="muted">Create the dynamic print files in Edit job before resuming.</p>}
      </details>}
      {error && <p className="schedule-job-error" role="alert">{error}</p>}
    </article>
  );
}

function MaterialRunDetailOverlay({ row, relatedRolls = [], onClose, onOpenMaterialRun }) {
  if (!row) return null;
  const progress = coaterProgress(row, relatedRolls);

  return (
    <section className="schedule-overlay" role="dialog" aria-modal="true" aria-label="Material run details">
      <div className="schedule-window schedule-material-window">
        <header className="schedule-window-head">
          <div>
            <p className="eyebrow">Coater Material Run</p>
            <h2>{coaterScheduleTitle(row)}</h2>
            <span className={`schedule-kind-pill material`}><Layers3 size={14} /> {row.tag_number || "Material Schedule"}</span>
          </div>
          <div className="schedule-window-actions">
            {onOpenMaterialRun && (
              <button className="primary-btn" type="button" onClick={() => onOpenMaterialRun(row)}>
                <Play size={15} /> Run Material
              </button>
            )}
            <button className="ghost-btn" type="button" onClick={onClose}><X size={15} /> Close</button>
          </div>
        </header>

        <section className="schedule-material-run-progress">
          <header>
            <div>
              <span>Run Progress</span>
              <strong>{formatNumber(progress.documented, " ft")} / {formatNumber(progress.target, " ft")}</strong>
            </div>
            <b>{progress.percent.toFixed(progress.percent >= 10 ? 0 : 1)}%</b>
          </header>
          <em style={{ "--schedule-progress": `${progress.percent}%` }} />
          <div>
            <DetailItem label="Remaining" value={formatNumber(progress.remaining, " ft")} />
            <DetailItem label="Finished Rolls" value={progress.rollCount} />
            <DetailItem label="Pending Tags" value={progress.pendingCount} />
          </div>
        </section>

        <section className="schedule-detail-grid">
          <DetailItem label="Press" value={row.press_name || "Unassigned"} />
          <DetailItem label="Order" value={row.press_sequence} />
          <DetailItem label="Run Date" value={formatShortDate(row.run_date)} />
          <DetailItem label="Status" value={labelize(row.status)} />
          <DetailItem label="Scheduled By" value={row.scheduled_by} />
          <DetailItem label="Width" value={formatInches(row.width_inches)} />
        </section>

        <section className="schedule-note-grid">
          <ScheduleNoteBlock label="Cut Description" value={row.cut_description} emptyText="No cut description entered." />
          <ScheduleNoteBlock label="Operator Note" value={row.operator_notes || row.notes} emptyText="No operator note entered." />
        </section>

        <section className="schedule-operator-sections">
          <div className="schedule-operator-card">
            <h3><Layers3 size={15} /> Coater Components</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Face" value={[row.face_code, row.face_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Liner" value={[row.liner_code, row.liner_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Adhesive" value={[row.adhesive_code, row.adhesive_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Silicone" value={[row.silicone_code, row.silicone_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Coating" value={[row.coating_name].filter(Boolean).join(" / ")} />
              <DetailItem label="Produced Material" value={row.produced_material_name || row.scheduled_material_name} />
            </div>
          </div>

          <div className="schedule-operator-card">
            <h3><CheckCircle2 size={15} /> Rolls From This Run</h3>
            {relatedRolls.length ? (
              <div className="schedule-material-roll-list">
                {relatedRolls.map((roll) => (
                  <article key={roll.id}>
                    <strong>{roll.tag_number}</strong>
                    <span>{labelize(roll.status)}</span>
                    <em>{[formatInches(roll.width_inches), roll.length_feet ? formatNumber(roll.length_feet, " ft") : "", formatShortDate(roll.run_date)].filter(Boolean).join(" / ")}</em>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No rolls have been printed for this run yet.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ProductionScheduleView({ rows, selected, presses = [], currentUser, lookups = {}, loading = false, loadError, refreshing = false, onReload, onReorder, focusScheduleId = "", onFocusHandled, onSelect, onClose, onEdit, onUpdate, onMaterialUpdate, onOpenMaterialRun, onRemove, onUseMaterial, onFlexDieReorder, onFlexDieCountUpdate }) {
  const [removeRow, setRemoveRow] = useState(null);
  const [holdRow, setHoldRow] = useState(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState(null);
  const [activeScopeKey, setActiveScopeKey] = useState(() => readSchedulePressPreference(currentUser));
  const [lineupType, setLineupType] = useState("all");
  const [lineupStatus, setLineupStatus] = useState("all");
  const [lineupSearch, setLineupSearch] = useState("");
  const [movingItemKey, setMovingItemKey] = useState("");
  const [saveError, setSaveError] = useState("");
  const lineupItems = useMemo(() => createLineupItems(rows ?? [], lookups["coater-roll-tags"] ?? []), [rows, lookups]);
  const scopes = useMemo(() => buildPressScopes(lineupItems, presses), [lineupItems, presses]);
  const scope = scopes.find((candidate) => candidate.key === activeScopeKey) || scopes[0];
  const scopedItems = useMemo(() => filterLineupItems(lineupItems, { scope }), [lineupItems, scope]);
  const visibleItems = useMemo(() => filterLineupItems(lineupItems, { scope, status: lineupStatus, workType: lineupType, query: lineupSearch }), [lineupItems, scope, lineupStatus, lineupType, lineupSearch]);
  const hasFilters = lineupType !== "all" || lineupStatus !== "all" || Boolean(lineupSearch.trim());
  const reorderableItems = scope.pressId && !hasFilters && onReorder && !loading && !loadError ? scopedItems : [];
  const positions = useMemo(() => buildLineupPositions(lineupItems), [lineupItems]);
  const groups = useMemo(() => scope.key === "all" ? groupLineupItems(visibleItems, scopes) : [{ ...scope, items: visibleItems }], [scope, scopes, visibleItems]);
  const lateCount = scopedItems.filter((item) => item.kind === "product" && item.row.due_date && daysUntil(item.row.due_date) < 0).length;
  const selectedMaterialRun = (lookups["coater-roll-tags"] ?? []).find((row) => sameId(row.id, selectedMaterialId)) || null;
  const selectedMaterialRolls = useMemo(() => (lookups["coater-roll-tags"] ?? []).filter((tag) => selectedMaterialId && sameId(tag.source_schedule, selectedMaterialId) && tag.status !== "void"), [lookups, selectedMaterialId]);
  const selectedProduct = (rows ?? []).find((row) => sameId(row.id, selected?.id)) || selected;

  useEffect(() => { setActiveScopeKey(readSchedulePressPreference(currentUser)); }, [currentUser?.id, currentUser?.username, currentUser?.name]);
  useEffect(() => {
    if (loading || loadError || scopes.some((candidate) => candidate.key === activeScopeKey)) return;
    setActiveScopeKey("all");
    saveSchedulePressPreference(currentUser, "all");
  }, [activeScopeKey, currentUser, scopes, loading, loadError]);
  useEffect(() => {
    if (!focusScheduleId || loading) return;
    const item = lineupItems.find((candidate) => candidate.kind === "product" && sameId(candidate.row.id, focusScheduleId));
    if (!item) return;
    const key = item.pressId ? `press-${item.pressId}` : "unassigned";
    setActiveScopeKey(key);
    saveSchedulePressPreference(currentUser, key);
    setLineupType("all"); setLineupStatus("all"); setLineupSearch("");
    setSelectedMaterialId(null);
    onSelect?.(item.row);
    onFocusHandled?.();
  }, [currentUser, focusScheduleId, lineupItems, loading, onFocusHandled, onSelect]);

  function clearFilters() { setLineupType("all"); setLineupStatus("all"); setLineupSearch(""); }
  function selectScope(key) {
    setActiveScopeKey(key); saveSchedulePressPreference(currentUser, key);
    clearFilters(); setSaveError(""); setSelectedMaterialId(null); onClose?.();
  }
  function selectLineupItem(item) {
    if (item.kind === "material") { setSelectedMaterialId(item.row.id); onClose?.(); }
    else { setSelectedMaterialId(null); onSelect?.(item.row); }
  }
  async function moveProductToHeld(row, payload) {
    await onUpdate?.(row.id, { ...payload, last_updated_by: currentUser?.name || currentUser?.username || "" });
  }
  async function moveLineupItemToPosition(item, targetIndex) {
    if (movingItemKey || !onReorder) return;
    const index = reorderableItems.findIndex((candidate) => candidate.key === item.key);
    if (index < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= reorderableItems.length || targetIndex === index) return;
    const reordered = [...reorderableItems];
    reordered.splice(targetIndex, 0, ...reordered.splice(index, 1));
    const reference = (entry) => ({ kind: entry.kind, id: entry.row.id });
    setMovingItemKey(item.key); setSaveError("");
    try {
      await onReorder({ press: Number(scope.pressId), items: reordered.map(reference), expected_items: reorderableItems.map((entry) => ({ ...reference(entry), press_sequence: entry.row.press_sequence ?? null })) });
    } catch (err) {
      setSaveError(err.message || "The lineup could not be saved. Refresh and try again.");
    } finally { setMovingItemKey(""); }
  }
  function moveLineupItem(item, direction) {
    const index = reorderableItems.findIndex((candidate) => candidate.key === item.key);
    return moveLineupItemToPosition(item, index + (direction === "up" ? -1 : 1));
  }
  function scopeStatus(candidate) {
    if (candidate.key === "all") return "Every active job and material run";
    if (candidate.key === "unassigned") return "Work waiting for a press";
    if (candidate.runningCount) return `${candidate.runningCount} running${candidate.heldCount ? ` / ${candidate.heldCount} on hold` : ""}`;
    if (candidate.heldCount) return `${candidate.heldCount} on hold / none running`;
    return candidate.count ? "Queued / none marked running" : "No active work";
  }

  return (
    <section className="schedule-board schedule-workspace schedule-press-workspace">
      <header className="schedule-workspace-heading">
        <div><p className="eyebrow">Production schedule</p><h2>Press lineups</h2><p>Choose a press to see its jobs in order.</p></div>
        <div className="schedule-workspace-key"><span><ClipboardList size={15} />Job tickets</span><span><Layers3 size={15} />Material runs</span></div>
      </header>
      <div className="schedule-workspace-layout">
        <nav className="schedule-press-navigation" aria-label="Press lineups">
          <div className="schedule-nav-heading"><h3>View a press</h3><p>Counts include work on hold.</p></div>
          <label className="schedule-mobile-press-picker"><span>View a press</span><select value={scope.key} disabled={loading || Boolean(movingItemKey)} onChange={(event) => selectScope(event.target.value)}>
            {scopes.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label} ({candidate.count}){candidate.isInactive ? " / Inactive" : ""}</option>)}
          </select></label>
          <div className="schedule-press-menu">
            {scopes.map((candidate) => <button className={`schedule-press-option ${candidate.key === scope.key ? "is-selected" : ""}`} type="button" key={candidate.key} aria-pressed={candidate.key === scope.key} disabled={loading || Boolean(movingItemKey)} onClick={() => selectScope(candidate.key)}>
              <span className="schedule-press-option-heading"><span>{candidate.label}</span><strong>{candidate.count}</strong></span>
              <span className="schedule-press-option-status"><i className={candidate.runningCount ? "is-running" : candidate.heldCount ? "is-held" : ""} aria-hidden="true" />{scopeStatus(candidate)}</span>
              {candidate.pressId && <small className="schedule-press-option-detail">{candidate.isInactive ? "Inactive press / assigned work" : candidate.isOrphan ? "Assigned press / details unavailable" : `${candidate.productCount} tickets / ${candidate.materialCount} material runs`}</small>}
            </button>)}
          </div>
        </nav>
        <div className="schedule-lineup-content" aria-busy={loading || Boolean(movingItemKey)}>
          <header className="schedule-scope-heading"><div><span>{scope.key === "all" ? "Shop overview" : scope.key === "unassigned" ? "Needs a press" : "Selected press"}</span><h3>{scope.label}</h3><p>{scope.key === "all" ? "Active work grouped by press. Select a press to manage its order." : scope.key === "unassigned" ? "Open Manage job or Manage run to assign this work to a press." : "Only work assigned to this press appears here, including jobs on hold."}</p></div><span className="schedule-scope-count">{loading ? "..." : scope.count} active</span></header>
          <div className="schedule-activity-summary"><span><Play size={14} /><strong>{scope.runningCount}</strong> running</span><span><PauseCircle size={14} /><strong>{scope.heldCount}</strong> on hold</span><span><CalendarDays size={14} /><strong>{lateCount}</strong> past due</span></div>
          <div className="schedule-lineup-controls">
            <label className="schedule-lineup-search"><Search size={17} /><input aria-label="Search this lineup" value={lineupSearch} disabled={Boolean(movingItemKey)} onChange={(event) => setLineupSearch(event.target.value)} placeholder="Search ticket, customer, material..." />{lineupSearch && <button type="button" disabled={Boolean(movingItemKey)} onClick={() => setLineupSearch("")} aria-label="Clear schedule search"><X size={16} /></button>}</label>
            <label className="schedule-work-type"><span>Work type</span><select value={lineupType} disabled={Boolean(movingItemKey)} onChange={(event) => setLineupType(event.target.value)}><option value="all">All work</option><option value="product">Job tickets</option><option value="material">Material runs</option></select></label>
          </div>
          <div className="schedule-status-filters" role="group" aria-label="Filter by status">
            {[{ value: "all", label: "All active", count: scope.count }, { value: "running", label: "Running", count: scope.runningCount }, { value: "on_hold", label: "On hold", count: scope.heldCount }].map((status) => <button type="button" key={status.value} className={lineupStatus === status.value ? "is-selected" : ""} aria-pressed={lineupStatus === status.value} disabled={Boolean(movingItemKey)} onClick={() => setLineupStatus(status.value)}>{status.label}<span>{status.count}</span></button>)}
          </div>
          <div className="schedule-filter-summary"><p role="status">{loading ? "Loading press lineups..." : movingItemKey ? "Saving lineup order..." : `Showing ${visibleItems.length} of ${scope.count} active items${refreshing ? " / Updating..." : ""}`}</p>{hasFilters && <button className="ghost-btn xs" type="button" disabled={Boolean(movingItemKey)} onClick={clearFilters}>Clear filters</button>}</div>
          {scope.pressId && <p className="schedule-reorder-hint">{hasFilters ? "Clear filters to change lineup order. Numbers show positions in the full lineup." : "Use the arrows to change lineup order. Open Manage for assignment and job actions."}</p>}
          {(loadError || saveError) && <div className="schedule-save-error" role="alert"><p>{loadError ? "The complete schedule could not be loaded. Refresh before changing the lineup." : saveError}</p>{onReload && <button className="ghost-btn xs" type="button" disabled={refreshing} onClick={() => onReload()}>Refresh lineup</button>}</div>}
          {!loading && groups.map((group) => group.items.length > 0 && <section className="schedule-press-group" key={group.key} aria-label={`${group.label} jobs`}>
            {scope.key === "all" && <header className="schedule-press-group-heading"><h4>{group.label}</h4><span>{group.items.length} {group.items.length === 1 ? "item" : "items"}</span><button className="ghost-btn xs" type="button" onClick={() => selectScope(group.key)}>{group.pressId ? "View press" : "View unassigned"}</button></header>}
            <div className="schedule-lineup-table" role="list" aria-label={`${group.label} lineup`}>
              {group.items.map((item) => {
                const index = reorderableItems.findIndex((candidate) => candidate.key === item.key);
                return <ScheduleLineupRow key={item.key} item={item} position={positions.get(item.key)} selectedProduct={selectedProduct} selectedMaterial={selectedMaterialRun} presses={presses} canMoveUp={index > 0} canMoveDown={index >= 0 && index < reorderableItems.length - 1} reorderCount={reorderableItems.length} moving={Boolean(movingItemKey) || Boolean(loadError)} currentUser={currentUser} onSelect={selectLineupItem} onEdit={onEdit} onUpdate={onUpdate} onMaterialUpdate={onMaterialUpdate} onRemove={onRemove ? setRemoveRow : undefined} onHold={setHoldRow} onUseMaterial={onUseMaterial} onOpenMaterialRun={onOpenMaterialRun} onMove={moveLineupItem} onPositionChange={moveLineupItemToPosition} />;
              })}
            </div>
          </section>)}
          {!loading && !loadError && !visibleItems.length && <div className="schedule-lineup-empty"><Factory size={28} /><strong>{hasFilters ? "No work matches these filters." : scope.key === "unassigned" ? "No work waiting for a press." : scope.key === "all" ? "No active work scheduled." : `No active work assigned to ${scope.label}.`}</strong><span>{hasFilters ? "Clear the filters to see the full lineup." : "Completed and removed work is not shown in active lineups."}</span></div>}
        </div>
      </div>
      <ScheduleDetailOverlay row={selectedProduct} lookups={lookups} currentUser={currentUser} onClose={onClose} onFlexDieReorder={onFlexDieReorder} onFlexDieCountUpdate={onFlexDieCountUpdate} />
      <MaterialRunDetailOverlay row={selectedMaterialRun} relatedRolls={selectedMaterialRolls} onClose={() => setSelectedMaterialId(null)} onOpenMaterialRun={onOpenMaterialRun} />
      {removeRow && <RemoveScheduleDialog key={removeRow.id} row={removeRow} onClose={() => setRemoveRow(null)} onConfirm={onRemove} />}
      {holdRow && <HoldScheduleDialog key={holdRow.id} row={holdRow} currentUser={currentUser} onClose={() => setHoldRow(null)} onConfirm={moveProductToHeld} />}
    </section>
  );
}
