import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, CheckCircle2, ClipboardList, Factory, History, Image as ImageIcon, Layers3, PackageCheck, PauseCircle, Play, RotateCcw, ScanLine, Search, Trash2, X } from "lucide-react";
import { formatInches, getRecordTitle, labelize } from "../../../lib/format";
import { AuthenticatedImage, PdfPreview, isPdfUrl } from "../../../shared/components/FilePreview";
import RecipeOptionsView from "../../tooling/components/RecipeOptionsView";
import ScheduleMaterialWorkflow from "./ScheduleMaterialWorkflow";

const productLineupStatuses = new Set(["unscheduled", "scheduled", "ready", "running", "on_hold"]);
const materialLineupStatuses = new Set(["scheduled", "running", "on_hold"]);
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

function daysOnSchedule(row) {
  const value = row.order_date || row.scheduled_date || row.created_at;
  const date = parseLocalDate(value);
  if (!date) return "--";
  return Math.max(0, Math.floor((todayStart() - date) / 86_400_000));
}

function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function businessDaysBetween(start, end = todayStart()) {
  if (!start || start >= end) return 0;
  let days = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor < end) {
    if (isBusinessDay(cursor)) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function itemScheduleAgeStart(item) {
  const row = item.row;
  const value = item.kind === "material"
    ? row.run_date || row.created_at
    : row.scheduled_date || row.created_at || row.order_date;
  return parseLocalDate(value);
}

function itemBusinessDaysOnSchedule(item) {
  return businessDaysBetween(itemScheduleAgeStart(item));
}

function heldAtDate(item) {
  return parseLocalDate(item?.row?.held_at || item?.row?.updated_at || item?.row?.created_at);
}

function itemBusinessDaysHeld(item) {
  return businessDaysBetween(heldAtDate(item));
}

function normalizeSchedulePriority(value) {
  const key = String(value || "low").toLowerCase();
  if (schedulePriorityAliases[key]) return schedulePriorityAliases[key];
  return schedulePriorityLabels[key] ? key : "low";
}

function schedulePriorityLabel(value) {
  return schedulePriorityLabels[normalizeSchedulePriority(value)] || "Low";
}

function scheduleAgeGlow(days, priorityValue = "low") {
  const priority = normalizeSchedulePriority(priorityValue);
  const classNames = [`schedule-priority-${priority}`];
  if (days < 7 && priority !== "high") {
    return {
      className: classNames.join(" "),
      style: undefined,
      title: `${schedulePriorityLabel(priority)} priority`,
    };
  }
  const intensity = Math.max(0, Math.min(1, (days - 7) / 13));
  const hueRange = {
    low: [48, 34],
    medium: [36, 8],
    high: [0, 0],
  }[priority];
  const visualIntensity = priority === "high" ? Math.max(0.7, intensity) : intensity;
  const boost = priority === "high" ? 0.04 : priority === "medium" ? 0.02 : 0;
  classNames.push("schedule-age-glow", priority === "high" || (priority !== "low" && days >= 20) ? "critical" : "warning");
  return {
    className: classNames.join(" "),
    style: {
      "--schedule-age-hue": Math.round(hueRange[0] - visualIntensity * (hueRange[0] - hueRange[1])),
      "--schedule-age-lightness": `${Math.round(57 - visualIntensity * 5)}%`,
      "--schedule-age-bg-alpha": (0.05 + visualIntensity * 0.07 + boost).toFixed(2),
      "--schedule-age-ring-alpha": (0.14 + visualIntensity * 0.1 + boost).toFixed(2),
      "--schedule-age-glow-alpha": (0.16 + visualIntensity * 0.14 + boost).toFixed(2),
      "--schedule-age-pulse-alpha": (0.2 + visualIntensity * 0.16 + boost).toFixed(2),
    },
    title: `${schedulePriorityLabel(priority)} priority / ${days} business days on schedule`,
  };
}

function scheduleStatusAgeCue(days) {
  if (days < 7) return { className: "", style: undefined, title: "" };
  const intensity = Math.max(0, Math.min(1, (days - 7) / 13));
  return {
    className: `schedule-status-age-cue ${days >= 20 ? "critical" : "warning"}`,
    style: {
      "--schedule-status-age-hue": Math.round(34 - intensity * 34),
      "--schedule-status-age-lightness": `${Math.round(55 - intensity * 7)}%`,
      "--schedule-status-age-bg-alpha": (0.15 + intensity * 0.14).toFixed(2),
      "--schedule-status-age-ring-alpha": (0.2 + intensity * 0.2).toFixed(2),
    },
    title: `${days} business days on schedule`,
  };
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
  };
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

function schedulePressPreferenceKey(user) {
  return `tsm-main-schedule-press:${user?.id || user?.username || user?.name || "guest"}`;
}

function readSchedulePressPreference(user) {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(schedulePressPreferenceKey(user)) || "all";
    return stored === "held" ? "all" : stored;
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
  return [...(active.length ? active : presses)].sort(comparePressNames);
}

function isActiveProductSchedule(row) {
  return productLineupStatuses.has(String(row?.status || "scheduled"));
}

function isCoaterSchedule(row) {
  return Boolean(row?.is_schedule) || (!row?.source_schedule && row?.log_inventory === false);
}

function isActiveMaterialSchedule(row) {
  return isCoaterSchedule(row) && materialLineupStatuses.has(String(row?.status || "scheduled"));
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

function itemPressId(item) {
  const value = item?.row?.press;
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function itemDate(item) {
  const row = item.row;
  return item.kind === "material"
    ? row.run_date || String(row.created_at || "").slice(0, 10)
    : row.scheduled_date || row.order_date || row.due_date || String(row.created_at || "").slice(0, 10);
}

function itemSequence(item) {
  const sequence = numeric(item?.row?.press_sequence);
  return sequence > 0 ? sequence : Number.MAX_SAFE_INTEGER;
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

function normalizeProductItem(row) {
  return {
    key: `product-${row.id}`,
    kind: "product",
    row,
    pressId: itemPressId({ row }),
    title: schedulePartNumber(row),
  };
}

function normalizeMaterialItem(row) {
  return {
    key: `material-${row.id}`,
    kind: "material",
    row,
    pressId: itemPressId({ row }),
    title: coaterScheduleTitle(row),
  };
}

function compareLineupItems(a, b) {
  const press = String(a.row.press_name || "").localeCompare(String(b.row.press_name || ""), undefined, { numeric: true });
  if (press) return press;
  const sequence = itemSequence(a) - itemSequence(b);
  if (sequence) return sequence;
  const date = String(itemDate(a) || "").localeCompare(String(itemDate(b) || ""));
  if (date) return date;
  if (a.kind !== b.kind) return a.kind === "material" ? -1 : 1;
  return itemTitle(a).localeCompare(itemTitle(b), undefined, { numeric: true });
}

function tabMatchesItem(tab, item) {
  const held = isHeldScheduleItem(item);
  if (tab.key === "held") return held;
  if (held) return false;
  if (tab.key === "all") return true;
  if (tab.key === "unassigned") return !itemPressId(item);
  return sameId(itemPressId(item), tab.pressId);
}

function itemMatchesSearch(item, query) {
  if (!query) return true;
  const row = item.row;
  return [
    item.kind,
    itemTitle(item),
    itemSpecLine(item),
    item.kind === "product" ? schedulePriorityLabel(row.priority) : "",
    row.hold_notes,
    row.held_by,
    row.tag_number,
    row.cut_description,
    row.job_ticket_number,
    row.customer_name,
    row.customer_po,
    row.job_name,
    row.job_product_code,
    row.status,
    row.priority,
    row.operator,
    row.scheduled_by,
    row.last_updated_by,
    row.notes,
    row.operator_notes,
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function buildPressTabs(productItems, materialItems, presses) {
  const items = [...productItems, ...materialItems];
  const heldItems = items.filter(isHeldScheduleItem);
  const pressRows = activePressList(presses);
  const knownPressIds = new Set(pressRows.map((press) => String(press.id)));
  const tabs = [
    { key: "all", label: "All Work" },
    { key: "held", label: "Held" },
    { key: "unassigned", label: "Unassigned" },
    ...pressRows.map((press) => ({ key: `press-${press.id}`, label: press.name, pressId: String(press.id) })),
  ];
  items.forEach((item) => {
    if (isHeldScheduleItem(item)) return;
    const pressId = itemPressId(item);
    if (!pressId || knownPressIds.has(pressId) || tabs.some((tab) => sameId(tab.pressId, pressId))) return;
    tabs.push({ key: `press-extra-${pressId}`, label: item.row.press_name || "Other Press", pressId });
  });
  return tabs.map((tab) => {
    const tabItems = items.filter((item) => tabMatchesItem(tab, item));
    return {
      ...tab,
      count: tabItems.length,
      alertCount: tab.key === "held" ? heldItems.filter((item) => itemBusinessDaysHeld(item) >= 20).length : 0,
      productCount: tabItems.filter((item) => item.kind === "product").length,
      materialCount: tabItems.filter((item) => item.kind === "material").length,
    };
  });
}

function ScheduleMetric({ label, value, detail, tone = "" }) {
  return (
    <article className={`schedule-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <em>{detail}</em>}
    </article>
  );
}

function updateOnBlur(event, value, onSave) {
  if (String(event.target.value ?? "") !== String(value ?? "")) onSave(event.target.value);
}

function ScheduleThumb({ row }) {
  const src = scheduleImage(row);
  const source = row.job_general_image_source || "";
  return (
    <div className="schedule-thumb">
      {src && !scheduleImageIsDocument(row) ? (
        <AuthenticatedImage src={src} alt={row.job_general_image_name || row.job_name || "Scheduled job"} />
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

        <section className="schedule-note-grid">
          <ScheduleNoteBlock label="Operator Run Note" value={ticket?.job_notes} emptyText="No operator run note on this ticket." />
          <ScheduleNoteBlock label="CSR Schedule Note" value={row.notes} emptyText="No CSR schedule note entered." />
          {ticket?.finishing_notes && <ScheduleNoteBlock label="Finishing Note" value={ticket.finishing_notes} />}
        </section>

        <section className="schedule-operator-sections">
          <div className="schedule-operator-card">
            <h3><PackageCheck size={15} /> Label Specs</h3>
            <div className="schedule-detail-grid compact">
              <DetailItem label="Size" value={`${formatInches(ticket?.label_width_inches || row.job_label_width_inches)} x ${formatInches(ticket?.label_length_inches || row.job_label_length_inches)}`} />
              <DetailItem label="Repeat" value={formatInches(ticket?.repeat_inches || row.job_repeat_inches)} />
              <DetailItem label="Recipe" value={ticket?.recipe_name || row.recipe_name} />
              <DetailItem label="Cutting" value={labelize(ticket?.cutting_type)} />
              <DetailItem label="Description" value={ticket?.description} />
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
  item,
  index,
  selectedProduct,
  selectedMaterial,
  presses,
  canMoveUp,
  canMoveDown,
  moving,
  currentUser,
  onSelect,
  onEdit,
  onUpdate,
  onMaterialUpdate,
  onRemove,
  onHold,
  onUseMaterial,
  onOpenMaterialRun,
  onMove,
}) {
  const [cardView, setCardView] = useState("overview");
  const row = item.row;
  const isMaterial = item.kind === "material";
  const isHeld = isHeldScheduleItem(item);
  const active = isMaterial ? sameId(selectedMaterial?.id, row.id) : sameId(selectedProduct?.id, row.id);
  const canUpdate = isMaterial ? Boolean(onMaterialUpdate) : Boolean(onUpdate);
  const pressChoices = activePressList(presses);
  const hasCurrentPress = !row.press || pressChoices.some((press) => sameId(press.id, row.press));
  const selectChoices = hasCurrentPress
    ? pressChoices
    : [{ id: row.press, name: row.press_name || `Press ${row.press}` }, ...pressChoices];
  const orderValue = row.press_sequence || index + 1;
  const priority = normalizeSchedulePriority(row.priority);
  const businessDaysOnSchedule = itemBusinessDaysOnSchedule(item);
  const ageGlow = scheduleAgeGlow(businessDaysOnSchedule, priority);
  const statusAgeCue = scheduleStatusAgeCue(businessDaysOnSchedule);

  function saveItem(payload) {
    if (isMaterial) return onMaterialUpdate?.(row.id, payload);
    return onUpdate?.(row.id, {
      ...payload,
      last_updated_by: currentUser?.name || currentUser?.username || "",
    });
  }

  function handlePressChange(value) {
    const nextPress = value ? Number(value) : null;
    if (isMaterial) {
      return saveItem({
        press: nextPress,
        press_sequence: nextPress ? row.press_sequence ?? null : null,
      });
    }
    return saveItem({
      press: nextPress,
      press_sequence: nextPress ? row.press_sequence ?? null : null,
      status: nextPress ? (row.status === "unscheduled" || !row.status ? "scheduled" : row.status) : "unscheduled",
    });
  }

  return (
    <article
      className={`schedule-lineup-row ${isMaterial ? "material" : "product"} ${active ? "active" : ""} ${ageGlow.className}`}
      style={ageGlow.style}
      title={ageGlow.title || undefined}
    >
      <div className="schedule-card-view-tabs" role="tablist" aria-label={`${itemTitle(item)} card view`}>
        <button className={cardView === "overview" ? "active" : ""} type="button" role="tab" aria-selected={cardView === "overview"} onClick={() => setCardView("overview")}>
          <ClipboardList size={12} />
          Overview
        </button>
        <button className={cardView === "notes" ? "active" : ""} type="button" role="tab" aria-selected={cardView === "notes"} onClick={() => setCardView("notes")}>
          <History size={12} />
          Notes
        </button>
      </div>

      {cardView === "overview" && (
        <>
      <div className="schedule-lineup-position">
        <strong>{orderValue}</strong>
        <div className="schedule-move-buttons">
          <button type="button" title="Move up" aria-label={`Move ${itemTitle(item)} up`} disabled={!canMoveUp || moving} onClick={() => onMove(item, "up")}>
            <ArrowUp size={14} />
          </button>
          <button type="button" title="Move down" aria-label={`Move ${itemTitle(item)} down`} disabled={!canMoveDown || moving} onClick={() => onMove(item, "down")}>
            <ArrowDown size={14} />
          </button>
        </div>
      </div>

      <button className="schedule-lineup-main" type="button" onClick={() => onSelect(item)}>
        {isMaterial ? <MaterialRunThumb row={row} /> : <ScheduleThumb row={row} />}
        <div className="schedule-lineup-title">
          <span className={`schedule-kind-pill ${isMaterial ? "material" : "product"}`}>
            {isMaterial ? <Layers3 size={14} /> : <ClipboardList size={14} />}
            {isMaterial ? "Material Run" : "Job Ticket"}
          </span>
          <strong className={isMaterial ? undefined : "schedule-part-number"} title={itemTitle(item)}>{itemTitle(item)}</strong>
        </div>
      </button>

      <div className="schedule-lineup-spec" title={itemSpecLine(item)}>
        <span>{itemSpecLabel(item)}</span>
        <strong>{itemSpecLine(item)}</strong>
      </div>

      <div className="schedule-lineup-meta">
        <span
          className={`schedule-status-pill ${row.status || "scheduled"} ${statusAgeCue.className}`}
          style={statusAgeCue.style}
          title={statusAgeCue.title || undefined}
        >
          {labelize(row.status || "scheduled")}
        </span>
        <strong>{formatShortDate(itemDate(item))}</strong>
        <em>{row.press_name || "Unassigned"}</em>
      </div>

      <div className={`schedule-lineup-editors ${isMaterial ? "material-editors" : "product-editors"}`}>
        {!isMaterial && (
          <select
            className={`schedule-priority-select ${priority}`}
            aria-label="Priority"
            value={priority}
            disabled={!canUpdate}
            onChange={(event) => saveItem({ priority: event.target.value })}
          >
            {schedulePriorityOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        )}
        <select aria-label="Press lineup" value={row.press || ""} disabled={!canUpdate} onChange={(event) => handlePressChange(event.target.value)}>
          <option value="">Unassigned</option>
          {selectChoices.map((press) => <option value={press.id} key={press.id}>{press.name}</option>)}
        </select>
        <input
          type="number"
          min="1"
          placeholder="#"
          defaultValue={row.press_sequence ?? ""}
          disabled={!canUpdate}
          onBlur={(event) => updateOnBlur(event, row.press_sequence, (value) => saveItem({ press_sequence: value ? Number(value) : null }))}
        />
      </div>
        </>
      )}

      {cardView === "notes" && <ScheduleLineupBack item={item} />}

      <div className="schedule-lineup-actions">
        {!isMaterial && (
          <>
            <button className="ghost-btn xs" type="button" onClick={() => onSelect(item)}>Details</button>
            <button className="ghost-btn xs" type="button" onClick={() => onEdit?.(row)}>Edit</button>
            {isHeld ? (
              <button className="primary-btn xs" type="button" onClick={() => saveItem({ status: row.press ? "scheduled" : "unscheduled" })}>
                <RotateCcw size={13} /> Resume
              </button>
            ) : (
              <button className="ghost-btn xs" type="button" onClick={() => onHold?.(row)}>
                <PauseCircle size={13} /> Hold
              </button>
            )}
            {onUseMaterial && (
              <button className="ghost-btn xs" type="button" onClick={() => onUseMaterial(row)}>
                <ScanLine size={13} /> Scan Roll
              </button>
            )}
            {onRemove && (
              <button className="danger-btn xs" type="button" onClick={() => onRemove(row)}>
                <Trash2 size={12} /> Remove
              </button>
            )}
          </>
        )}
        {isMaterial && onOpenMaterialRun && (
          <button className="primary-btn xs" type="button" onClick={() => onOpenMaterialRun(row)}>
            <Play size={13} /> Run
          </button>
        )}
        {isMaterial && (
          <button className="ghost-btn xs" type="button" onClick={() => onSelect(item)}>
            Details
          </button>
        )}
        {isMaterial && canUpdate && (
          <button className="danger-btn xs" type="button" onClick={() => saveItem({ status: "void" })}>
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>
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

export default function ProductionScheduleView({ rows, selected, presses = [], currentUser, lookups = {}, focusScheduleId = "", onFocusHandled, onSelect, onClose, onEdit, onUpdate, onMaterialUpdate, onOpenMaterialRun, onRemove, onUseMaterial, onFlexDieReorder, onFlexDieCountUpdate }) {
  const [removeRow, setRemoveRow] = useState(null);
  const [holdRow, setHoldRow] = useState(null);
  const [selectedMaterialRun, setSelectedMaterialRun] = useState(null);
  const [activeTabKey, setActiveTabKey] = useState(() => readSchedulePressPreference(currentUser));
  const [lineupType, setLineupType] = useState("all");
  const [lineupSearch, setLineupSearch] = useState("");
  const [movingItemKey, setMovingItemKey] = useState("");
  const productItems = useMemo(
    () => (rows ?? []).filter(isActiveProductSchedule).map(normalizeProductItem),
    [rows]
  );
  const materialRows = useMemo(
    () => (lookups?.["coater-roll-tags"] ?? []).filter(isActiveMaterialSchedule),
    [lookups]
  );
  const materialItems = useMemo(
    () => materialRows.map(normalizeMaterialItem),
    [materialRows]
  );
  const lineupItems = useMemo(
    () => [...productItems, ...materialItems].sort(compareLineupItems),
    [materialItems, productItems]
  );
  const tabs = useMemo(() => buildPressTabs(productItems, materialItems, presses), [materialItems, presses, productItems]);
  const selectedTab = tabs.find((tab) => tab.key === activeTabKey) ?? tabs[0] ?? { key: "all", label: "All Work" };
  const searchQuery = lineupSearch.trim().toLowerCase();
  const visibleItems = useMemo(() => lineupItems
    .filter((item) => tabMatchesItem(selectedTab, item))
    .filter((item) => selectedTab.key === "held" || lineupType === "all" || item.kind === lineupType)
    .filter((item) => itemMatchesSearch(item, searchQuery))
    .sort(compareLineupItems),
  [lineupItems, lineupType, searchQuery, selectedTab]);
  const reorderableItems = useMemo(() => {
    if (!selectedTab.pressId || lineupType !== "all" || searchQuery) return [];
    return lineupItems
      .filter((item) => sameId(itemPressId(item), selectedTab.pressId))
      .sort(compareLineupItems);
  }, [lineupItems, lineupType, searchQuery, selectedTab]);
  const reorderIndexByKey = useMemo(
    () => new Map(reorderableItems.map((item, index) => [item.key, index])),
    [reorderableItems]
  );
  const selectedTabItems = useMemo(() => lineupItems.filter((item) => tabMatchesItem(selectedTab, item)), [lineupItems, selectedTab]);
  const scheduleSummary = useMemo(() => {
    const productCount = selectedTabItems.filter((item) => item.kind === "product").length;
    const materialCount = selectedTabItems.filter((item) => item.kind === "material").length;
    const runningCount = selectedTabItems.filter((item) => item.row.status === "running").length;
    const priorityCount = selectedTabItems.filter((item) => item.kind === "product" && ["medium", "high"].includes(normalizeSchedulePriority(item.row.priority))).length;
    const lateCount = selectedTabItems.filter((item) => item.kind === "product" && daysUntil(item.row.due_date) < 0).length;
    const materialFeet = selectedTabItems
      .filter((item) => item.kind === "material")
      .reduce((sum, item) => sum + coaterProgress(item.row).target, 0);
    return { productCount, materialCount, runningCount, priorityCount, lateCount, materialFeet };
  }, [selectedTabItems]);
  const selectedMaterialRolls = useMemo(() => {
    if (!selectedMaterialRun) return [];
    return (lookups?.["coater-roll-tags"] ?? [])
      .filter((tag) => sameId(tag.source_schedule, selectedMaterialRun.id) && tag.status !== "void")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [lookups, selectedMaterialRun]);

  useEffect(() => {
    setActiveTabKey(readSchedulePressPreference(currentUser));
  }, [currentUser?.id, currentUser?.username, currentUser?.name]);

  useEffect(() => {
    if (tabs.some((tab) => tab.key === activeTabKey)) return;
    setActiveTabKey("all");
    saveSchedulePressPreference(currentUser, "all");
  }, [activeTabKey, currentUser, tabs]);

  useEffect(() => {
    if (!focusScheduleId) return;
    const item = productItems.find((candidate) => sameId(candidate.row.id, focusScheduleId));
    if (!item) return;
    const tabKey = isHeldScheduleItem(item) ? "held" : item.pressId ? `press-${item.pressId}` : "unassigned";
    const nextTabKey = tabs.some((tab) => tab.key === tabKey) ? tabKey : "all";
    setActiveTabKey(nextTabKey);
    if (nextTabKey !== "held") saveSchedulePressPreference(currentUser, nextTabKey);
    setLineupType(tabKey === "held" ? "product" : "all");
    setLineupSearch("");
    setSelectedMaterialRun(null);
    onSelect?.(item.row);
    onFocusHandled?.();
  }, [currentUser, focusScheduleId, onFocusHandled, onSelect, productItems, tabs]);

  function selectTab(key) {
    setActiveTabKey(key);
    if (key !== "held") saveSchedulePressPreference(currentUser, key);
    setLineupType(key === "held" ? "product" : "all");
    setSelectedMaterialRun(null);
    onClose?.();
  }

  function selectLineupItem(item) {
    if (item.kind === "material") {
      setSelectedMaterialRun(item.row);
      onClose?.();
      return;
    }
    setSelectedMaterialRun(null);
    onSelect?.(item.row);
  }

  async function saveSequence(item, sequence) {
    if (item.kind === "material") return onMaterialUpdate?.(item.row.id, { press_sequence: sequence });
    return onUpdate?.(item.row.id, {
      press_sequence: sequence,
      last_updated_by: currentUser?.name || currentUser?.username || "",
    });
  }

  async function moveProductToHeld(row, payload) {
    await onUpdate?.(row.id, {
      ...payload,
      last_updated_by: currentUser?.name || currentUser?.username || "",
    });
    setSelectedMaterialRun(null);
    if (selected?.id && sameId(selected.id, row.id)) onClose?.();
  }

  async function moveLineupItem(item, direction) {
    const index = reorderableItems.findIndex((candidate) => candidate.key === item.key);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= reorderableItems.length) return;
    const reordered = [...reorderableItems];
    const [picked] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, picked);
    setMovingItemKey(item.key);
    try {
      const saves = reordered
        .map((entry, entryIndex) => ({ entry, nextSequence: entryIndex + 1 }))
        .filter(({ entry, nextSequence }) => numeric(entry.row.press_sequence) !== nextSequence)
        .map(({ entry, nextSequence }) => saveSequence(entry, nextSequence))
        .filter(Boolean);
      await Promise.all(saves);
    } finally {
      setMovingItemKey("");
    }
  }

  return (
    <section className="schedule-board schedule-workspace">
      <section className="schedule-command-bar">
        <div>
          <p className="eyebrow">Main Scheduling</p>
          <h2>{selectedTab.label}</h2>
          <span>
            {selectedTab.count} {selectedTab.key === "held" ? "held job" : "active scheduled item"}{selectedTab.count === 1 ? "" : "s"} in this lineup
          </span>
        </div>
        <div className="schedule-command-actions">
          <label className="schedule-lineup-search">
            <Search size={15} />
            <input value={lineupSearch} onChange={(event) => setLineupSearch(event.target.value)} placeholder="Search ticket, customer, material, PO, press..." />
            {lineupSearch && (
              <button type="button" onClick={() => setLineupSearch("")} title="Clear search" aria-label="Clear schedule search">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="schedule-type-tabs" role="tablist" aria-label="Scheduled work type">
            <button className={lineupType === "all" ? "active" : ""} type="button" role="tab" aria-selected={lineupType === "all"} onClick={() => setLineupType("all")}>All</button>
            <button className={lineupType === "product" ? "active product" : "product"} type="button" role="tab" aria-selected={lineupType === "product"} onClick={() => setLineupType("product")}>Tickets</button>
            <button className={lineupType === "material" ? "active material" : "material"} type="button" role="tab" aria-selected={lineupType === "material"} onClick={() => setLineupType("material")}>Material</button>
          </div>
        </div>
      </section>

      <nav className="schedule-press-tabs" aria-label="Press schedule tabs">
        {tabs.map((tab) => (
          <button className={tab.key === selectedTab.key ? "active" : ""} type="button" key={tab.key} onClick={() => selectTab(tab.key)}>
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
            {tab.alertCount > 0 && <em className="schedule-tab-alert">{tab.alertCount}</em>}
          </button>
        ))}
      </nav>

      <section className="schedule-metric-row">
        <ScheduleMetric label="Job Tickets" value={scheduleSummary.productCount} detail={`${scheduleSummary.priorityCount} medium / high`} tone="product" />
        <ScheduleMetric label="Material Runs" value={scheduleSummary.materialCount} detail={`${formatNumber(scheduleSummary.materialFeet, " ft")} target`} tone="material" />
        <ScheduleMetric label="Running Now" value={scheduleSummary.runningCount} detail="Active press work" tone="running" />
        <ScheduleMetric label="Late Ship Dates" value={scheduleSummary.lateCount} detail="Needs attention" tone={scheduleSummary.lateCount ? "late" : "ok"} />
      </section>

      <section className="schedule-lineup-panel">
        <header className="schedule-lineup-head">
          <div>
            <span><CalendarDays size={14} /> Lineup</span>
            <strong>{visibleItems.length} shown</strong>
          </div>
          <em>{reorderableItems.length ? "Order saves to the selected press lineup." : "Choose a press tab with all work visible to reorder."}</em>
        </header>

        <div className="schedule-lineup-table" role="list">
          {visibleItems.map((item, index) => {
            const reorderIndex = reorderIndexByKey.get(item.key);
            return (
              <ScheduleLineupRow
                item={item}
                index={index}
                selectedProduct={selected}
                selectedMaterial={selectedMaterialRun}
                presses={presses}
                canMoveUp={reorderIndex !== undefined && reorderIndex > 0}
                canMoveDown={reorderIndex !== undefined && reorderIndex < reorderableItems.length - 1}
                moving={movingItemKey === item.key}
                currentUser={currentUser}
                key={item.key}
                onSelect={selectLineupItem}
                onEdit={onEdit}
                onUpdate={onUpdate}
                onMaterialUpdate={onMaterialUpdate}
                onRemove={setRemoveRow}
                onHold={setHoldRow}
                onUseMaterial={onUseMaterial}
                onOpenMaterialRun={onOpenMaterialRun}
                onMove={moveLineupItem}
              />
            );
          })}
          {!visibleItems.length && (
            <div className="schedule-lineup-empty">
              <Factory size={28} />
              <strong>{selectedTab.key === "held" ? "No held jobs here." : "No scheduled work here."}</strong>
              <span>{selectedTab.key === "held" ? "Clear the search to see held jobs." : "Switch presses or clear the search to see the rest of the lineup."}</span>
            </div>
          )}
        </div>
      </section>

      <ScheduleDetailOverlay
        row={selected}
        lookups={lookups}
        currentUser={currentUser}
        onClose={onClose}
        onFlexDieReorder={onFlexDieReorder}
        onFlexDieCountUpdate={onFlexDieCountUpdate}
      />
      <MaterialRunDetailOverlay
        row={selectedMaterialRun}
        relatedRolls={selectedMaterialRolls}
        onClose={() => setSelectedMaterialRun(null)}
        onOpenMaterialRun={onOpenMaterialRun}
      />
      <RemoveScheduleDialog
        row={removeRow}
        onClose={() => setRemoveRow(null)}
        onConfirm={onRemove}
      />
      <HoldScheduleDialog
        row={holdRow}
        currentUser={currentUser}
        onClose={() => setHoldRow(null)}
        onConfirm={moveProductToHeld}
      />
    </section>
  );
}
