import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock3, FileText, History, Image as ImageIcon, PackageCheck, Printer, RotateCcw, Send, ShieldCheck, XCircle } from "lucide-react";
import { PdfPreview, isPdfUrl } from "./FilePreview";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const tabs = [
  { key: "general", label: "General" },
  { key: "labels", label: "Labels" },
  { key: "history", label: "History" },
  { key: "editor", label: "Editor" },
];

const historyTabs = [
  { key: "orders", label: "Jobs Ran" },
  { key: "ticket", label: "Job Ticket Changes" },
  { key: "inventory", label: "Inventory" },
];

const chartRangeOptions = [
  { key: "all", label: "All" },
  { key: "9mo", label: "9 Months" },
  { key: "3mo", label: "3 Months", featured: true },
];

const printTemplates = [
  { value: "Standard", label: "Standard Carton" },
  { value: "BARCODE", label: "Variable Barcode" },
  { value: "CS", label: "Clopay" },
  { value: "CL", label: "Customer Label" },
  { value: "BCL", label: "BCL" },
  { value: "ABE", label: "ABE" },
  { value: "DOWCARTONLABEL", label: "Dow Carton" },
  { value: "DOWCLOSURELABEL", label: "Dow Closure" },
  { value: "COATER", label: "Material Tag" },
];

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function getBoxCount(row, ticket) {
  const unit = String(row.unit ?? "").toLowerCase();
  const qty = Number(row.quantity ?? 0);
  if (["carton", "case"].includes(unit)) return Number.isFinite(qty) ? qty : 0;
  return 0;
}

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function inventoryFootage(row) {
  return numeric(row?.length_feet ?? row?.quantity);
}

function formatNumber(value, suffix = "") {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "--";
  const rounded = Math.round(n * 10) / 10;
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

function isClopayTicket(ticket) {
  const text = [ticket?.customer_display, ticket?.customer_name, ticket?.job_name, ticket?.description].filter(Boolean).join(" ").toLowerCase();
  return text.includes("clopay");
}

function defaultCartonLineA(ticket) {
  const count = ticket?.labels_per_unit;
  if (!count) return "";
  return `${formatNumber(count)} ${String(ticket?.unit_type || "label").toLowerCase()}${Number(count) === 1 ? "" : "s"} / ${ticket?.finishing_type === "rolls" ? "roll" : "unit"}`;
}

function defaultCartonLineB(ticket) {
  const count = ticket?.units_per_carton || ticket?.labels_per_carton;
  if (!count) return "";
  return `${formatNumber(count)} ${String(ticket?.unit_type || "label").toLowerCase()}${Number(count) === 1 ? "" : "s"} / carton`;
}

function printPressLabel(press) {
  if (!press) return "";
  const queue = press.printer_queue_key ? ` / ${press.printer_queue_key}` : "";
  const ip = press.printer_ip ? ` / ${press.printer_ip}` : " / no printer IP";
  return `${press.name || "Press"}${queue}${ip}`;
}

function buildDefaultPrintForm(ticket, presses = [], currentUserName = "") {
  const suggestedPress = presses.find((press) => press?.is_active !== false && press?.printer_ip) || presses.find((press) => press?.is_active !== false) || presses[0] || null;
  const clopay = isClopayTicket(ticket);
  const partNumber = ticket?.carton_label_part_number || ticket?.product_code || ticket?.job_name || ticket?.ticket_number || "";
  return {
    press: suggestedPress?.id ? String(suggestedPress.id) : "",
    template: clopay ? "CS" : "Standard",
    total: "1",
    part_number: partNumber,
    text1: ticket?.carton_label_description_a || ticket?.description || "",
    text2: ticket?.carton_label_description_b || "",
    text3: ticket?.carton_label_description_c || "",
    labela: ticket?.carton_label_finishing_1 || defaultCartonLineA(ticket),
    labelb: ticket?.carton_label_finishing_2 || defaultCartonLineB(ticket),
    lot_number: "",
    label_type: "",
    blackout: "",
    po: "",
    starting_number: "",
    ending_number: "",
    ref_number: "",
    rework_message: "",
    clopay_shipping_header: clopay ? "CLOPAY" : "",
    clopay_ship_date: "",
    clopay_part_number: partNumber,
    clopay_po: "",
    clopay_po_line: "",
    clopay_quantity: "",
    clopay_uom: "EA",
    operator: currentUserName,
    material_part_number: partNumber,
    face: ticket?.face_type || "",
    liner: ticket?.liner_type || "",
    adhesive: "",
    adhesive_width: "",
    length: "",
    note: "",
    roll_id: "",
  };
}

function inventoryRollName(row) {
  return row?.name || row?.source_roll_tag_number || row?.serial_number || row?.lot_number || row?.code || "Roll";
}

function inventoryLocation(row) {
  return row?.location_full_path || row?.location_name || "No location";
}

function ChartLoadingState({ label = "Loading chart data" }) {
  return (
    <div className="job-chart-loading" role="status" aria-live="polite">
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}

function Stat({ label, value, valueNode, bars, rangeLabel, loading = false }) {
  return (
    <div className="job-stat">
      <div>
        <span>{label}</span>
        {valueNode ?? <strong>{value ?? "--"}</strong>}
      </div>
      {loading ? <ChartLoadingState /> : bars && <MiniBarChart bars={bars} rangeLabel={rangeLabel} />}
    </div>
  );
}

function MiniBarChart({ bars, rangeLabel }) {
  const [selected, setSelected] = useState(null);
  if (!bars?.length) {
    return <div className="job-mini-chart empty"><span>No data</span></div>;
  }
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const active = selected || bars[bars.length - 1];
  return (
    <div className="job-mini-bars">
      <div className="job-mini-bar-track" style={{ "--bar-count": bars.length }}>
        {bars.map((bar) => (
          <button
            type="button"
            key={bar.key}
            title={`${bar.label}: ${formatNumber(bar.value)}`}
            className={active.key === bar.key ? "active" : ""}
            style={{ "--bar-height": `${Math.max(4, (bar.value / max) * 100)}%` }}
            onMouseEnter={() => setSelected(bar)}
            onFocus={() => setSelected(bar)}
            onClick={() => setSelected(bar)}
          >
            <span />
          </button>
        ))}
      </div>
      <em>{active.label}: {formatNumber(active.value)} <small>{rangeLabel}</small></em>
    </div>
  );
}

function sameText(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

function compactText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function sameNumber(a, b) {
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.0001;
}

function InfoRow({ label, value, wide = false }) {
  const displayValue = value === null || value === undefined || value === "" ? "--" : value;
  return (
    <div className={`job-info-row ${wide ? "wide" : ""}`} title={`${label}: ${displayValue}`}>
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}

function primaryImage(ticket) {
  const images = Array.isArray(ticket.job_images) ? ticket.job_images : [];
  return (
    images.find((image) => image.slot === "general" && image.url) ||
    images.find((image) => image.url) ||
    null
  );
}

function imageSourceLabel(image) {
  return image?.source || "";
}

function matchingMaterialInventory(ticket, rows) {
  const masterTypeIds = [ticket.material_master_type, ticket.material_spec_master_type].filter(Boolean);
  const masterTypeCodes = [
    ticket.material_master_type_code,
    ticket.material_spec_master_type_code,
  ].map(compactText).filter(Boolean);
  const masterTypeNames = [
    ticket.material_master_type_name,
    ticket.material_spec_master_type_name,
  ].map(compactText).filter(Boolean);
  const materialCodes = [ticket.material_spec_code, ticket.material_code].map(compactText).filter(Boolean);
  return (rows ?? []).filter((row) => {
    if (row.material_type && row.material_type !== "coated_stock") return false;
    if (masterTypeIds.some((id) => sameId(row.material_master_type, id))) return true;
    if (masterTypeCodes.includes(compactText(row.material_master_type_code))) return true;
    if (masterTypeNames.includes(compactText(row.material_master_type_name))) return true;
    if (sameId(row.material, ticket.material_spec)) return true;
    if (materialCodes.includes(compactText(row.material_code))) return true;
    if (materialCodes.includes(compactText(row.code))) return true;
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

function matchingFinishedRows(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.job_ticket, ticket.id)) return true;
    if (sameText(row.job_ticket_number, ticket.ticket_number)) return true;
    if (sameText(row.job_ticket_product_code, ticket.product_code)) return true;
    if (sameText(row.imported_tsm_id, ticket.product_code)) return true;
    if (sameText(row.imported_tsm_id, ticket.ticket_number)) return true;
    if (sameText(row.sku, ticket.product_code)) return true;
    return false;
  });
}

function matchingFinishedUsageRows(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.finished_inventory_job_ticket, ticket.id)) return true;
    if (sameText(row.finished_inventory_job_ticket_number, ticket.ticket_number)) return true;
    if (sameText(row.finished_inventory_job_product_code, ticket.product_code)) return true;
    if (sameText(row.finished_inventory_imported_tsm_id, ticket.product_code)) return true;
    if (sameText(row.finished_inventory_imported_tsm_id, ticket.ticket_number)) return true;
    return false;
  });
}

function matchingUsageRows(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.job_ticket, ticket.id)) return true;
    if (sameText(row.job_ticket_number, ticket.ticket_number)) return true;
    if (sameText(row.product_code, ticket.product_code)) return true;
    if (sameText(row.legacy_job_ticket_id, ticket.ticket_number)) return true;
    if (sameText(row.legacy_job_ticket_id, ticket.product_code)) return true;
    return false;
  });
}

function matchingRecipeOptions(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (ticket.recipe && sameId(row.recipe, ticket.recipe)) return true;
    if (ticket.recipe_name && row.recipe_name === ticket.recipe_name) return true;
    return false;
  });
}

function matchingBoxInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.box, ticket.box)) return true;
    if (sameText(row.box_item_number, ticket.box_item_number || ticket.linked_box_item_number)) return true;
    if (sameText(row.box_name, ticket.box_name)) return true;
    return false;
  });
}

function matchingCoreInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.core, ticket.core)) return true;
    if (sameText(row.core_item_number, ticket.core_item_number)) return true;
    if (sameText(row.core_name, ticket.core_name)) return true;
    if (sameNumber(row.core_size_inches, ticket.core_size_inches)) return true;
    return false;
  });
}

function matchingCustomerOrders(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.job_ticket, ticket.id)) return true;
    if (sameText(row.job_ticket_number, ticket.ticket_number)) return true;
    if (sameText(row.product_code, ticket.product_code)) return true;
    return false;
  });
}

function matchingCustomerOrderEvents(orders, rows) {
  const orderIds = new Set((orders ?? []).map((order) => String(order.id)));
  const orderNumbers = new Set((orders ?? []).map((order) => String(order.order_number || "").toLowerCase()).filter(Boolean));
  return (rows ?? []).filter((row) => {
    if (orderIds.has(String(row.order))) return true;
    if (orderNumbers.has(String(row.order_number || "").toLowerCase())) return true;
    return false;
  });
}

function matchingJobTicketEvents(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.job_ticket, ticket.id)) return true;
    if (sameText(row.job_ticket_number, ticket.ticket_number)) return true;
    if (sameText(row.product_code, ticket.product_code)) return true;
    return false;
  });
}

function activePackagingRows(rows) {
  return (rows ?? [])
    .filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && numeric(row.quantity) > 0)
    .sort((a, b) => String(a.location_full_path || a.location_name || "").localeCompare(String(b.location_full_path || b.location_name || "")));
}

function shortDate(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function RecipePressOverview({ rows }) {
  const groups = (rows ?? []).reduce((acc, row) => {
    const pressName = row.press_name || row.press_details?.name || "No press";
    if (!acc[pressName]) acc[pressName] = { total: 0, approved: 0, preferred: 0 };
    acc[pressName].total += 1;
    if (row.is_approved !== false && row.is_active !== false) acc[pressName].approved += 1;
    if (row.is_preferred) acc[pressName].preferred += 1;
    return acc;
  }, {});
  const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  return (
    <div className="job-recipe-press-strip" aria-label="Recipe press options">
      {entries.map(([pressName, stat]) => (
        <div key={pressName} className={stat.approved ? "ready" : "review"}>
          <span>Press</span>
          <strong>{pressName}</strong>
          <em>{stat.approved}/{stat.total} active{stat.preferred ? ` / ${stat.preferred} preferred` : ""}</em>
        </div>
      ))}
    </div>
  );
}

function PackagingInventoryTable({ title, type, rows }) {
  const visibleRows = activePackagingRows(rows);
  const isCore = type === "core";
  return (
    <div className="job-packaging-inventory-card">
      <div className="job-packaging-inventory-head">
        <strong>{title}</strong>
        <span>{visibleRows.length ? `${visibleRows.length} active location${visibleRows.length === 1 ? "" : "s"}` : "No active inventory"}</span>
      </div>
      {visibleRows.length ? (
        <div className="job-packaging-table-wrap">
          <table className="job-packaging-table">
            <thead>
              <tr>
                <th>Item #</th>
                <th>{isCore ? "Core" : "Box"}</th>
                <th>Supplier</th>
                {isCore && <th>Size</th>}
                <th>Lot</th>
                <th className="qty-cell">Qty</th>
                <th>Status</th>
                <th>Location</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id || `${row.lot_number}-${row.location_full_path || row.location_name}`}>
                  <td title={isCore ? row.core_item_number : row.box_item_number}>{isCore ? row.core_item_number || "--" : row.box_item_number || "--"}</td>
                  <td title={isCore ? row.core_name : row.box_name}>{isCore ? row.core_name || "--" : row.box_name || "--"}</td>
                  <td title={isCore ? row.core_supplier : row.box_supplier}>{isCore ? row.core_supplier || "--" : row.box_supplier || "--"}</td>
                  {isCore && <td>{formatInches(row.core_size_inches)}</td>}
                  <td title={row.lot_number}>{row.lot_number || "--"}</td>
                  <td className="qty-cell">{formatNumber(row.quantity)}</td>
                  <td>{labelize(row.status || "available")}</td>
                  <td title={row.location_full_path || row.location_name}>{row.location_full_path || row.location_name || "--"}</td>
                  <td>{shortDate(row.received_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No linked {isCore ? "core" : "box"} inventory is available yet.</p>
      )}
    </div>
  );
}

function matchingSchedule(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function scheduleQuantity(row) {
  return numeric(row.quantity_to_ship) + numeric(row.quantity_to_stock);
}

function dateValue(row) {
  return row.scheduled_date || row.order_date || row.due_date || row.run_date || "";
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subtractBusinessDays(days) {
  const now = new Date();
  const date = new Date(now);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

function rangeStart(rangeKey) {
  const now = new Date();
  if (rangeKey === "all") return null;
  if (rangeKey === "9mo" || rangeKey === "3mo") {
    const months = rangeKey === "9mo" ? 9 : 3;
    return new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  }
  if (rangeKey === "ytd") return new Date(now.getFullYear(), 0, 1);
  if (rangeKey === "last-year") return new Date(now.getFullYear() - 1, 0, 1);
  if (rangeKey === "last-quarter") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const startMonth = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
    const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return new Date(year, startMonth, 1);
  }
  if (rangeKey === "30bd") return subtractBusinessDays(30);
  if (rangeKey === "60bd") return subtractBusinessDays(60);
  if (rangeKey === "90bd") return subtractBusinessDays(90);
  return null;
}

function rangeEnd(rangeKey) {
  const now = new Date();
  if (rangeKey === "last-year") return new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
  if (rangeKey === "last-quarter") {
    const start = rangeStart(rangeKey);
    return new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59);
  }
  return now;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function fixedMonthRangeCount(rangeKey) {
  if (rangeKey === "3mo") return 3;
  if (rangeKey === "9mo") return 9;
  return 0;
}

function monthlyBars(rows, dateGetter, quantityGetter, rangeKey) {
  const start = rangeStart(rangeKey);
  const end = rangeEnd(rangeKey);
  const grouped = new Map();
  const monthCount = fixedMonthRangeCount(rangeKey);
  if (start && monthCount) {
    for (let index = 0; index < monthCount; index += 1) {
      const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
      const key = monthKey(date);
      grouped.set(key, {
        key,
        label: monthLabel(date),
        value: 0,
        sort: date.getTime(),
      });
    }
  }
  rows
    .map((row) => {
      const rawDate = dateGetter(row);
      const date = parseDateValue(rawDate);
      const quantity = quantityGetter(row);
      return date && !Number.isNaN(date.getTime()) && (!start || date >= start) && date <= end && quantity > 0
        ? { date, quantity }
        : null;
    })
    .filter(Boolean)
    .forEach((point) => {
      const key = monthKey(point.date);
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: monthLabel(point.date),
          value: 0,
          sort: new Date(point.date.getFullYear(), point.date.getMonth(), 1).getTime(),
        });
      }
      grouped.get(key).value += point.quantity;
    });

  return Array.from(grouped.values()).sort((a, b) => a.sort - b.sort);
}

function shipmentPoints(finishedRows, usageRows, finishedUsageRows, ticket) {
  const finishedPoints = (finishedRows ?? [])
    .filter((row) => row.status === "shipped")
    .map((row) => ({
      date: parseDateValue(row.run_date || row.shipped_date || row.updated_at),
      quantity: getBoxCount(row, ticket) || numeric(row.quantity),
      source: "New System",
    }));

  const usagePoints = (usageRows ?? []).map((row) => ({
    date: usageDate(row),
    quantity: numeric(row.quantity),
      source: row.source || "Glide",
    }));

  const finishedUsagePoints = (finishedUsageRows ?? [])
    .filter((row) => ["shipped", "manual", "checkout"].includes(String(row.usage_type || "").toLowerCase()))
    .map((row) => ({
      date: usageDate(row),
      quantity: numeric(row.quantity),
      source: "Finished Inventory",
    }));

  return [...finishedPoints, ...usagePoints, ...finishedUsagePoints].filter((point) => point.date && point.quantity > 0);
}

function finishedLocationGroups(rows) {
  const groups = new Map();
  (rows ?? []).forEach((row) => {
    const location = row.location_full_path || row.location_name || "No location";
    if (!groups.has(location)) groups.set(location, { location, rows: [], total: 0 });
    const group = groups.get(location);
    group.rows.push(row);
    group.total += numeric(row.quantity);
  });
  return Array.from(groups.values()).sort((a, b) => a.location.localeCompare(b.location));
}

function inventoryLocationGroups(rows) {
  const groups = new Map();
  (rows ?? []).forEach((row) => {
    const quantity = inventoryFootage(row);
    if (quantity <= 0) return;
    const location = inventoryLocation(row);
    if (!groups.has(location)) groups.set(location, { location, rows: [], total: 0 });
    const group = groups.get(location);
    group.rows.push(row);
    group.total += quantity;
  });
  return Array.from(groups.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location));
}

function finishedCartonLocationGroups(rows) {
  const groups = new Map();
  (rows ?? []).forEach((row) => {
    const cartons = getBoxCount(row);
    if (cartons <= 0) return;
    const location = row.location_full_path || row.location_name || "No location";
    if (!groups.has(location)) groups.set(location, { location, rows: [], total: 0 });
    const group = groups.get(location);
    group.rows.push(row);
    group.total += cartons;
  });
  return Array.from(groups.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location));
}

function monthsInRange(rangeKey, bars) {
  const now = new Date();
  if (rangeKey === "3mo") return 3;
  if (rangeKey === "9mo") return 9;
  if (rangeKey === "30bd") return 1;
  if (rangeKey === "60bd") return 2;
  if (rangeKey === "90bd") return 3;
  if (rangeKey === "last-quarter") return 3;
  if (rangeKey === "last-year") return 12;
  if (rangeKey === "ytd") return now.getMonth() + 1;
  return Math.max(1, bars?.length || 0);
}

function monthlyAverageFromBars(bars, rangeKey) {
  if (!bars?.length) return null;
  const total = bars.reduce((sum, bar) => sum + numeric(bar.value), 0);
  return total > 0 ? Math.round((total / monthsInRange(rangeKey, bars)) * 10) / 10 : null;
}

function WidthFootageChart({ rows, loading = false }) {
  const [selectedLabel, setSelectedLabel] = useState("");
  if (loading) return <ChartLoadingState label="Loading inventory chart" />;
  const groups = Object.entries(groupInventoryByWidth(rows ?? []))
    .map(([label, group]) => ({
      label,
      value: group.total,
      rows: [...group.rows].sort((a, b) => inventoryLocation(a).localeCompare(inventoryLocation(b))),
    }))
    .filter((group) => group.value > 0);
  if (!groups.length) return <p className="muted">No active material widths yet.</p>;
  const max = Math.max(...groups.map((group) => group.value), 1);
  const selectedGroup = groups.find((group) => group.label === selectedLabel);
  return (
    <div className="job-width-chart">
      {groups.map((group) => (
        <button
          key={group.label}
          type="button"
          className={selectedGroup?.label === group.label ? "active" : ""}
          onClick={() => setSelectedLabel((current) => (current === group.label ? "" : group.label))}
        >
          <span>{group.label}</span>
          <strong>{formatNumber(group.value, " ft")}</strong>
          <em style={{ "--bar-width": `${Math.max(5, (group.value / max) * 100)}%` }} />
        </button>
      ))}
      {selectedGroup && (
        <div className="job-width-detail">
          <strong>{selectedGroup.label} Locations</strong>
          <table>
            <thead>
              <tr>
                <th>Roll</th>
                <th>Location</th>
                <th>Feet</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroup.rows.map((row) => (
                <tr key={row.id || `${inventoryRollName(row)}-${inventoryLocation(row)}`}>
                  <td>{inventoryRollName(row)}</td>
                  <td>{inventoryLocation(row)}</td>
                  <td>{formatNumber(inventoryFootage(row), " ft")}</td>
                  <td>{labelize(row.status || "available")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatBreakdown({ total, groups, suffix = "", emptyLabel = "No locations" }) {
  const max = Math.max(...(groups ?? []).map((group) => group.total), 1);
  return (
    <div className="job-stat-breakdown">
      <strong>{total}</strong>
      {(groups ?? []).length ? (
        groups.map((group) => (
          <div key={group.location} className="job-stat-breakdown-row">
            <span>{group.location}:</span>
            <b>{formatNumber(group.total, suffix)}</b>
            <em style={{ "--bar-width": `${Math.max(6, (group.total / max) * 100)}%` }} />
          </div>
        ))
      ) : (
        <small>{emptyLabel}</small>
      )}
    </div>
  );
}

function FinishedStockSnapshotTable({ groups }) {
  if (!groups?.length) return <p className="muted">No finished stock is linked to this job yet.</p>;
  return (
    <div className="job-ticket-table-wrap">
      <table className="job-ticket-data-table">
        <thead>
          <tr>
            <th>Location</th>
            <th className="qty-cell">Quantity</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const notes = group.rows.map((row) => row.notes).filter(Boolean).slice(0, 2).join(" / ");
            return (
              <tr key={group.location}>
                <td>{group.location}</td>
                <td className="qty-cell">{formatNumber(group.total)}</td>
                <td>{notes || `${group.rows.length} lot${group.rows.length === 1 ? "" : "s"}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RawMaterialInventoryTable({ rows }) {
  const visibleRows = [...(rows ?? [])].sort((a, b) => {
    const locationCompare = inventoryLocation(a).localeCompare(inventoryLocation(b));
    if (locationCompare) return locationCompare;
    return String(a.lot_number || a.serial_number || "").localeCompare(String(b.lot_number || b.serial_number || ""));
  });
  if (!visibleRows.length) return <p className="muted">No active raw material inventory is linked to this material type yet.</p>;
  return (
    <div className="job-ticket-table-wrap">
      <table className="job-ticket-data-table raw-material-table">
        <thead>
          <tr>
            <th>Location</th>
            <th className="qty-cell">Quantity</th>
            <th>Width</th>
            <th>Lot Number</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id || `${inventoryLocation(row)}-${row.lot_number || row.serial_number}`}>
              <td>{inventoryLocation(row)}</td>
              <td className="qty-cell">{formatNumber(inventoryFootage(row), " ft")}</td>
              <td>{formatInches(row.width_inches)}</td>
              <td>{row.lot_number || row.serial_number || "--"}</td>
              <td>{row.notes || labelize(row.status || "available")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function eventDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function eventChanges(event) {
  const rawChanges = event?.details?.changes;
  if (!Array.isArray(rawChanges)) return [];
  return rawChanges.map((change, index) => {
    if (typeof change === "string") return { key: `${event.id || "event"}-${index}`, text: change };
    const label = change.label || change.field || "Field";
    return {
      key: `${event.id || "event"}-${change.field || index}`,
      label,
      from: change.from || "--",
      to: change.to || "--",
      text: `${label}: ${change.from || "--"} to ${change.to || "--"}`,
    };
  });
}

function changeApproval(event) {
  return event?.details?.approval || {};
}

function changeApprovalStatus(event) {
  const status = String(changeApproval(event).status || "").toLowerCase();
  if (["pending", "approved", "rejected", "retracted"].includes(status)) return status;
  return eventChanges(event).length && event.event_type === "updated" ? "unreviewed" : "none";
}

function changeApprovalLabel(status) {
  return {
    pending: "Needs Approval",
    approved: "Approved",
    rejected: "Rejected",
    retracted: "Taken Back",
    unreviewed: "Recorded",
  }[status] || "";
}

function changeApprovalIcon(status) {
  if (status === "approved") return CheckCircle2;
  if (status === "rejected") return XCircle;
  if (status === "pending") return Clock3;
  if (status === "retracted") return XCircle;
  return ShieldCheck;
}

function fieldLabelForReview(field, form) {
  if (typeof field.dynamicLabel === "function") return field.dynamicLabel(form || {});
  return field.label || labelize(field.name);
}

function comparableFieldValue(field, value) {
  if (field.type === "imageUpload") return value instanceof File ? value.name : "";
  if (field.type === "checkbox") return Boolean(value) ? "true" : "false";
  if (["number", "relation", "searchRelation"].includes(field.type)) {
    if (value === "" || value === null || value === undefined) return "";
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? String(numberValue) : String(value);
  }
  if (Array.isArray(value)) return value.map(String).sort().join("|");
  return String(value ?? "").trim();
}

function lookupRowLabel(field, value, lookups) {
  if (value === "" || value === null || value === undefined) return "";
  const rows = lookups?.[field.relation] ?? [];
  const row = rows.find((item) => String(item.id) === String(value));
  if (!row) return String(value);
  return getRecordTitle(row);
}

function displayFieldValue(field, value, lookups) {
  if (field.type === "imageUpload") return value instanceof File ? `New file: ${value.name}` : "";
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "select") {
    const choice = (field.choices ?? []).find(([choiceValue]) => String(choiceValue) === String(value ?? ""));
    return choice?.[1] || value || "";
  }
  if (field.type === "relation" || field.type === "searchRelation") return lookupRowLabel(field, value, lookups);
  if (field.type === "multiRelation") {
    return (Array.isArray(value) ? value : [])
      .map((item) => lookupRowLabel(field, item, lookups))
      .filter(Boolean)
      .join(", ");
  }
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function buildEditorPreviewChanges(ticket, draft, fields, lookups) {
  if (!draft) return [];
  return (fields ?? [])
    .filter((field) => !field.readOnly && !field.hidden && field.name !== "performed_by")
    .map((field) => {
      const beforeRaw = field.type === "imageUpload" ? "" : ticket?.[field.name];
      const afterRaw = draft[field.name];
      const beforeCompare = comparableFieldValue(field, beforeRaw);
      const afterCompare = comparableFieldValue(field, afterRaw);
      if (beforeCompare === afterCompare) return null;
      if (field.type === "imageUpload" && !afterCompare) return null;
      return {
        key: field.name,
        label: fieldLabelForReview(field, draft),
        from: displayFieldValue(field, beforeRaw, lookups) || "--",
        to: displayFieldValue(field, afterRaw, lookups) || "--",
      };
    })
    .filter(Boolean);
}

function PendingChangeControls({ event, canApproveChanges = false, canRetractChanges = false, approvingChangeId = "", onApproveChange }) {
  const changes = eventChanges(event);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});

  useEffect(() => {
    setDraft(Object.fromEntries(changes.map((change) => [change.label, change.to === "--" ? "" : change.to])));
  }, [event?.id]);

  function updateDraft(change, value) {
    setDraft((current) => ({ ...current, [change.label]: value }));
  }

  function adjustedPayload() {
    const out = {};
    changes.forEach((change) => {
      const raw = event?.details?.changes?.find?.((item) => item?.label === change.label || item?.field === change.label);
      const fieldName = raw?.field;
      if (!fieldName) return;
      const next = draft[change.label];
      if (next !== undefined && next !== change.to) out[fieldName] = next;
    });
    return out;
  }

  const busy = approvingChangeId === event.id;
  return (
    <div className="job-change-actions">
      {canApproveChanges && <button className="approve" type="button" onClick={() => onApproveChange?.(event, "approved")} disabled={busy}>Approve</button>}
      {canApproveChanges && <button className="adjust" type="button" onClick={() => setEditing((current) => !current)} disabled={busy}>Adjust</button>}
      {canApproveChanges && <button className="reject" type="button" onClick={() => onApproveChange?.(event, "rejected")} disabled={busy}>Reject</button>}
      {canRetractChanges && <button className="retract" type="button" onClick={() => onApproveChange?.(event, "retracted")} disabled={busy}>Take Back</button>}
      {canApproveChanges && editing && (
        <div className="job-change-adjust-panel">
          {changes.map((change) => (
            <label key={change.key}>
              <span>{change.label}</span>
              <input value={draft[change.label] ?? ""} onChange={(event) => updateDraft(change, event.target.value)} />
            </label>
          ))}
          <button type="button" onClick={() => onApproveChange?.(event, "approved", adjustedPayload())} disabled={busy}>
            Approve Edited Values
          </button>
        </div>
      )}
    </div>
  );
}

function JobTicketEventList({ events, emptyText, canApproveChanges = false, currentUserName = "", approvingChangeId = "", onApproveChange }) {
  if (!events.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="job-history-event-list">
      {events.map((event) => {
        const changes = eventChanges(event);
        const approvalStatus = changeApprovalStatus(event);
        const ApprovalIcon = changeApprovalIcon(approvalStatus);
        const approval = changeApproval(event);
        const artwork = event?.details?.pending_artwork;
        const requestedByUser = String(event.performed_by || "").trim().toLowerCase() === String(currentUserName || "").trim().toLowerCase();
        const canRetractChanges = canApproveChanges || requestedByUser;
        return (
          <article className={`job-change-event approval-${approvalStatus}`} key={event.id}>
            <div>
              <strong>{event.summary || labelize(event.event_type)}</strong>
              <span>{[eventDate(event.created_at), event.performed_by, labelize(event.event_type)].filter(Boolean).join(" / ")}</span>
            </div>
            {approvalStatus !== "none" && (
              <div className="job-change-approval-line">
                <span className={`job-change-status ${approvalStatus}`}>
                  <ApprovalIcon size={13} />
                  {changeApprovalLabel(approvalStatus)}
                </span>
                {approval.reviewed_by && <em>Reviewed by {approval.reviewed_by} / {eventDate(approval.reviewed_at)}</em>}
                {(canApproveChanges || canRetractChanges) && approvalStatus === "pending" && (
                  <PendingChangeControls
                    event={event}
                    canApproveChanges={canApproveChanges}
                    canRetractChanges={canRetractChanges}
                    approvingChangeId={approvingChangeId}
                    onApproveChange={onApproveChange}
                  />
                )}
              </div>
            )}
            {artwork && (
              <div className="job-artwork-history-strip">
                <span>Artwork history saved</span>
                {artwork.previous?.url && <a href={artwork.previous.url} target="_blank" rel="noreferrer">Previous artwork</a>}
                {artwork.next?.url && <a href={artwork.next.url} target="_blank" rel="noreferrer">Pending artwork</a>}
                {artwork.change_description && <em>{artwork.change_description}</em>}
              </div>
            )}
            {changes.length ? (
              <ul>
                {changes.map((change) => <li key={change.key}>{change.text}</li>)}
              </ul>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function OrderEventList({ events, emptyText }) {
  if (!events.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="job-order-event-list">
      {events.map((event) => (
        <article key={`${event.source || "order"}-${event.id}`}>
          <strong>{event.summary}</strong>
          <span>{[eventDate(event.created_at), labelize(event.event_type), event.performed_by].filter(Boolean).join(" / ")}</span>
        </article>
      ))}
    </div>
  );
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function scheduleEventScheduleId(event) {
  return event?.details?.schedule_id ?? event?.details?.schedule ?? event?.schedule_id ?? "";
}

function orderPlannedQuantity(row) {
  return numeric(row?.quantity_to_ship) + numeric(row?.quantity_to_stock);
}

function orderGroupKey(order) {
  const po = compactText(order?.customer_po);
  if (po) return `po:${po}`;
  return `order:${compactText(order?.order_number || order?.id)}`;
}

function groupDateValue(group) {
  const dates = [
    ...group.orders.map((order) => order.updated_at || order.scheduled_date || order.due_date || order.order_date),
    ...group.schedules.map((schedule) => schedule.updated_at || dateValue(schedule)),
    ...group.events.map((event) => event.created_at),
  ].map((value) => parseDateValue(value)).filter(Boolean);
  if (!dates.length) return 0;
  return Math.max(...dates.map((date) => date.getTime()));
}

function buildOrderHistoryGroups({ orders, schedules, orderEvents, scheduleEvents, search }) {
  const groups = new Map();
  const claimedScheduleIds = new Set();

  (orders ?? []).forEach((order) => {
    const key = orderGroupKey(order);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        orders: [],
        schedules: [],
        orderEvents: [],
        scheduleEvents: [],
        orderNumbers: [],
        customerPo: order.customer_po || "",
      });
    }
    const group = groups.get(key);
    group.orders.push(order);
    group.orderNumbers = uniqueValues([...group.orderNumbers, order.order_number || `Order ${order.id}`]);
    if (!group.customerPo && order.customer_po) group.customerPo = order.customer_po;
  });

  groups.forEach((group) => {
    const scheduleEntryIds = new Set(group.orders.map((order) => String(order.schedule_entry || "")).filter(Boolean));
    const orderIds = new Set(group.orders.map((order) => String(order.id)));
    const orderNumbers = new Set(group.orders.map((order) => compactText(order.order_number)).filter(Boolean));
    group.schedules = (schedules ?? []).filter((schedule) => {
      if (scheduleEntryIds.has(String(schedule.id))) return true;
      if (group.customerPo && sameText(schedule.customer_po, group.customerPo)) return true;
      return false;
    });
    group.schedules.forEach((schedule) => claimedScheduleIds.add(String(schedule.id)));
    const scheduleIds = new Set(group.schedules.map((schedule) => String(schedule.id)));
    group.orderEvents = (orderEvents ?? []).filter((event) => (
      orderIds.has(String(event.order)) || orderNumbers.has(compactText(event.order_number))
    ));
    group.scheduleEvents = (scheduleEvents ?? []).filter((event) => scheduleIds.has(String(scheduleEventScheduleId(event))));
  });

  (schedules ?? []).forEach((schedule) => {
    if (claimedScheduleIds.has(String(schedule.id))) return;
    const key = schedule.customer_po ? `schedule-po:${compactText(schedule.customer_po)}` : `schedule:${schedule.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        orders: [],
        schedules: [],
        orderEvents: [],
        scheduleEvents: [],
        orderNumbers: [`Schedule ${schedule.id}`],
        customerPo: schedule.customer_po || "",
      });
    }
    const group = groups.get(key);
    group.schedules.push(schedule);
    const scheduleIds = new Set(group.schedules.map((row) => String(row.id)));
    group.scheduleEvents = (scheduleEvents ?? []).filter((event) => scheduleIds.has(String(scheduleEventScheduleId(event))));
  });

  const needle = compactText(search);
  return Array.from(groups.values())
    .map((group) => {
      const events = [...group.orderEvents, ...group.scheduleEvents]
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const searchText = compactText([
        ...group.orderNumbers,
        group.customerPo,
        ...group.orders.map((order) => order.customer_po),
        ...group.schedules.map((schedule) => schedule.customer_po),
      ].join(" "));
      return { ...group, events, searchText };
    })
    .filter((group) => !needle || group.searchText.includes(needle))
    .sort((a, b) => groupDateValue(b) - groupDateValue(a));
}

function OrderMetricBars({ items }) {
  const max = Math.max(...items.map((item) => numeric(item.value)), 1);
  return (
    <div className="job-order-metric-bars">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.display ?? formatNumber(item.value, item.suffix || "")}</strong>
          <em aria-hidden="true"><i style={{ "--bar-width": `${Math.max(5, (numeric(item.value) / max) * 100)}%` }} /></em>
        </div>
      ))}
    </div>
  );
}

function orderFootageReports(group) {
  return [
    ...group.orders.map((order) => ({
      key: `order-${order.id}`,
      date: order.scheduled_date || order.due_date || order.order_date,
      footage: numeric(order.actual_footage),
      report: order.footage_report || order.operator_note,
      source: order.order_number || `Order ${order.id}`,
    })),
    ...group.schedules.map((schedule) => ({
      key: `schedule-${schedule.id}`,
      date: dateValue(schedule),
      footage: numeric(schedule.actual_footage),
      report: schedule.footage_report || schedule.notes,
      source: `Schedule ${schedule.id}`,
    })),
  ].filter((row) => row.footage > 0 || row.report);
}

function groupScheduledBy(group) {
  return uniqueValues([
    ...group.schedules.map((schedule) => schedule.scheduled_by || schedule.last_updated_by),
    ...group.orders.map((order) => order.scheduled_by || order.last_updated_by),
  ].filter(Boolean)).join(" / ");
}

function groupRunDateLabel(group) {
  const dates = [
    ...group.schedules.map(dateValue),
    ...group.orders.map((order) => order.scheduled_date || order.due_date || order.order_date),
  ].filter(Boolean);
  return dates[0] || "";
}

function OrderHistoryGroupCard({ group }) {
  const orderCount = group.orders.length;
  const scheduleCount = group.schedules.length;
  const plannedShip = group.orders.length
    ? group.orders.reduce((sum, order) => sum + numeric(order.quantity_to_ship), 0)
    : group.schedules.reduce((sum, schedule) => sum + numeric(schedule.quantity_to_ship), 0);
  const plannedStock = group.orders.length
    ? group.orders.reduce((sum, order) => sum + numeric(order.quantity_to_stock), 0)
    : group.schedules.reduce((sum, schedule) => sum + numeric(schedule.quantity_to_stock), 0);
  const footage = group.schedules.some((schedule) => numeric(schedule.actual_footage) > 0)
    ? group.schedules.reduce((sum, schedule) => sum + numeric(schedule.actual_footage), 0)
    : group.orders.reduce((sum, order) => sum + numeric(order.actual_footage), 0);
  const reports = orderFootageReports(group);
  const latestStatus = group.orders[0]?.status || group.schedules[0]?.status || "";
  const scheduledBy = groupScheduledBy(group);
  const runDate = groupRunDateLabel(group);
  return (
    <details className="job-order-history-card">
      <summary className="job-order-history-summary">
        <div className="job-order-history-main">
          <span>Job Ran</span>
          <strong>{group.orderNumbers.join(" / ") || "Schedule"}</strong>
          <em>{group.customerPo ? `PO ${group.customerPo}` : "No PO"}</em>
        </div>
        <div className="job-order-history-quick">
          <div>
            <span>Scheduled By</span>
            <strong>{scheduledBy || "--"}</strong>
          </div>
          <div>
            <span>Run Date</span>
            <strong>{runDate || "--"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{labelize(latestStatus || "open")}</strong>
          </div>
          <div>
            <span>Footage</span>
            <strong>{footage ? formatNumber(footage, " ft") : "--"}</strong>
          </div>
        </div>
        <span className="job-order-history-expand">Details</span>
      </summary>

      <div className="job-order-history-detail">
        <div className="job-order-detail-summary">
          <span>{orderCount} order{orderCount === 1 ? "" : "s"} / {scheduleCount} schedule{scheduleCount === 1 ? "" : "s"}</span>
          <span>{group.customerPo ? `PO ${group.customerPo}` : "No PO on file"}</span>
        </div>

        <OrderMetricBars
          items={[
            { label: "Ship", value: plannedShip },
            { label: "Stock", value: plannedStock },
            { label: "Footage", value: footage, suffix: " ft" },
          ]}
        />

        <div className="job-order-history-grid">
          <section>
            <div className="job-order-section-title">
              <CalendarPlus size={14} />
              <strong>Schedule History</strong>
            </div>
            {group.schedules.length ? (
              <div className="job-order-schedule-stack">
                {group.schedules.map((schedule) => (
                  <div key={schedule.id} className="job-order-schedule-row">
                    <div>
                      <strong>{dateValue(schedule) || "No date"}</strong>
                      <span>{[labelize(schedule.status), labelize(schedule.priority), schedule.press_name].filter(Boolean).join(" / ")}</span>
                    </div>
                    <OrderMetricBars
                      items={[
                        { label: "Ship", value: numeric(schedule.quantity_to_ship) },
                        { label: "Stock", value: numeric(schedule.quantity_to_stock) },
                        { label: "Footage", value: numeric(schedule.actual_footage), suffix: " ft" },
                      ]}
                    />
                    <em>{[schedule.scheduled_by ? `Scheduled by ${schedule.scheduled_by}` : "", schedule.operator ? `Operator ${schedule.operator}` : "", schedule.footage_report || schedule.notes].filter(Boolean).join(" / ") || "No footage report"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No schedule records are linked to this order yet.</p>
            )}
          </section>

          <section>
            <div className="job-order-section-title">
              <History size={14} />
              <strong>Footage Reports</strong>
            </div>
            {reports.length ? (
              <div className="job-footage-report-list">
                {reports.map((report) => (
                  <div key={report.key}>
                    <strong>{report.footage ? formatNumber(report.footage, " ft") : "--"}</strong>
                    <span>{[report.date, report.source].filter(Boolean).join(" / ")}</span>
                    <p>{report.report || "No report text"}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No footage reports have been entered yet.</p>
            )}
          </section>
        </div>

        {group.events.length ? (
          <div className="job-order-event-timeline">
            {group.events.slice(0, 8).map((event) => (
              <div key={`${event.source || "event"}-${event.id}`}>
                <span>{eventDate(event.created_at)}</span>
                <strong>{event.summary || labelize(event.event_type)}</strong>
                <em>{[labelize(event.event_type), event.performed_by].filter(Boolean).join(" / ")}</em>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function usageDate(row) {
  const raw = row?.used_at || row?.date || row?.used_date;
  return parseDateValue(raw);
}

export default function JobTicketPanel({
  ticket,
  lookups,
  chartsLoading = false,
  inventoryReceiving = false,
  inventoryReceiveError = "",
  canEdit = false,
  canSchedule = false,
  canQuote = false,
  canApproveChanges = false,
  currentUserName = "",
  printingLabel = false,
  printLabelError = "",
  approvingChangeId = "",
  onQuoteJob,
  onQueuePrintLabel,
  onApproveChange,
  onReceiveFinishedInventory,
  renderEditorForm,
  renderScheduleForm,
  editorFields = [],
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [historyTab, setHistoryTab] = useState("orders");
  const [chartRange, setChartRange] = useState("3mo");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [orderHistorySearch, setOrderHistorySearch] = useState("");
  const [editorDraft, setEditorDraft] = useState(null);
  const [printNotice, setPrintNotice] = useState("");
  const [printForm, setPrintForm] = useState(() => buildDefaultPrintForm(ticket, lookups?.presses ?? [], currentUserName));
  const [receiveForm, setReceiveForm] = useState({
    order_number: "",
    quantity: "",
    location: "",
    received_by: "",
    unit: "carton",
  });

  const materialInventory = useMemo(
    () => matchingMaterialInventory(ticket, lookups["raw-materials"]),
    [ticket, lookups]
  );

  const finishedRows = useMemo(
    () => matchingFinishedRows(ticket, lookups["finished-inventory"]),
    [ticket, lookups]
  );
  const customerOrders = useMemo(
    () => matchingCustomerOrders(ticket, lookups["customer-orders"]),
    [ticket, lookups]
  );
  const customerOrderEvents = useMemo(
    () => matchingCustomerOrderEvents(customerOrders, lookups["customer-order-events"]),
    [customerOrders, lookups]
  );
  const jobTicketEvents = useMemo(
    () => matchingJobTicketEvents(ticket, lookups["job-ticket-events"]),
    [ticket, lookups]
  );

  const scheduleRows = useMemo(
    () => matchingSchedule(ticket, lookups["production-schedule"]),
    [ticket, lookups]
  );
  const usageRows = useMemo(
    () => matchingUsageRows(ticket, lookups["job-ticket-usages"]),
    [ticket, lookups]
  );
  const finishedUsageRows = useMemo(
    () => matchingFinishedUsageRows(ticket, lookups["material-usages"]),
    [ticket, lookups]
  );
  const shippedPoints = useMemo(
    () => shipmentPoints(finishedRows, usageRows, finishedUsageRows, ticket),
    [finishedRows, usageRows, finishedUsageRows, ticket]
  );

  const availableInventory = materialInventory.filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status));
  const availableInventoryWithFeet = availableInventory.filter((row) => inventoryFootage(row) > 0);
  const availableFinished = finishedRows.filter((row) => row.is_active !== false && !["depleted", "scrapped", "shipped"].includes(row.status));
  const finishedByLocation = useMemo(() => finishedLocationGroups(availableFinished), [availableFinished]);
  const finishedCartonByLocation = useMemo(() => finishedCartonLocationGroups(availableFinished), [availableFinished]);
  const materialFeet = availableInventoryWithFeet.reduce((sum, row) => sum + inventoryFootage(row), 0);
  const finishedQuantity = availableFinished.reduce((sum, row) => sum + numeric(row.quantity), 0);
  const finishedCartons = availableFinished.reduce((sum, row) => sum + getBoxCount(row), 0);
  const scheduleTotal = scheduleRows.reduce((sum, row) => sum + scheduleQuantity(row), 0);
  const selectedRangeLabel = chartRangeOptions.find((option) => option.key === chartRange)?.label || "3 Months";
  const shippedBars = useMemo(
    () => monthlyBars(shippedPoints, (row) => row.date, (row) => row.quantity, chartRange),
    [chartRange, shippedPoints]
  );
  const shippedMonthlyAverage = useMemo(
    () => monthlyAverageFromBars(shippedBars, chartRange),
    [shippedBars, chartRange]
  );
  const sortedJobTicketEvents = [...jobTicketEvents].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const ticketChangeEvents = sortedJobTicketEvents.filter((event) => !["scheduled", "schedule_updated", "schedule_removed"].includes(event.event_type));
  const scheduleJobTicketEvents = sortedJobTicketEvents.filter((event) => ["scheduled", "schedule_updated", "schedule_removed"].includes(event.event_type));
  const pendingChangeEvents = ticketChangeEvents.filter((event) => changeApprovalStatus(event) === "pending");
  const pressOptions = useMemo(
    () => [...(lookups?.presses ?? [])].filter((press) => press?.is_active !== false).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true })),
    [lookups]
  );
  const selectedPrintPress = pressOptions.find((press) => sameId(press.id, printForm.press)) || null;
  const selectedPrintTemplate = printForm.template || "Standard";
  const showVariablePrintFields = selectedPrintTemplate === "BARCODE";
  const showClopayPrintFields = selectedPrintTemplate === "CS" || isClopayTicket(ticket);
  const showCoaterPrintFields = selectedPrintTemplate === "COATER";
  const editorPreviewChanges = useMemo(
    () => buildEditorPreviewChanges(ticket, editorDraft, editorFields, lookups),
    [editorDraft, editorFields, lookups, ticket]
  );
  const orderHistoryGroups = useMemo(
    () => buildOrderHistoryGroups({
      orders: customerOrders,
      schedules: scheduleRows,
      orderEvents: customerOrderEvents.map((event) => ({ ...event, source: "order" })),
      scheduleEvents: scheduleJobTicketEvents.map((event) => ({ ...event, source: "ticket" })),
      search: orderHistorySearch,
    }),
    [customerOrders, customerOrderEvents, orderHistorySearch, scheduleJobTicketEvents, scheduleRows]
  );
  const image = primaryImage(ticket);
  const imageIsDocument = image?.isDocument || isPdfUrl(image?.url);
  const partNumber = ticket.job_name || ticket.ticket_number || "--";
  const descriptionText = ticket.description || ticket.job_name || ticket.job_notes || "No description entered.";
  const materialTypeDisplay = ticket.material_master_type_code || ticket.material_spec_master_type_code || ticket.material_master_type_name || ticket.material_spec_master_type_name || "--";
  const activeHistoryTab = historyTabs.some((tab) => tab.key === historyTab) ? historyTab : "orders";
  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === "editor") return canEdit;
    return true;
  });

  useEffect(() => {
    setEditorDraft(null);
    setPrintNotice("");
    setPrintForm(buildDefaultPrintForm(ticket, lookups?.presses ?? [], currentUserName));
  }, [ticket?.id]);

  useEffect(() => {
    if (printForm.press || !pressOptions.length) return;
    const suggestedPress = pressOptions.find((press) => press.printer_ip) || pressOptions[0];
    if (suggestedPress?.id) setPrintForm((current) => ({ ...current, press: String(suggestedPress.id) }));
  }, [pressOptions, printForm.press]);

  function selectTab(key) {
    setActiveTab(key);
  }

  function updateReceive(name, value) {
    setReceiveForm((current) => ({ ...current, [name]: value }));
  }

  async function submitReceive(event) {
    event.preventDefault();
    await onReceiveFinishedInventory?.({
      ...receiveForm,
      ticket_lookup: receiveForm.order_number ? "" : ticket.product_code || ticket.ticket_number,
      job_ticket: receiveForm.order_number ? "" : ticket.id,
    });
    setReceiveForm((current) => ({ ...current, quantity: "", order_number: "", location: "" }));
  }

  function updatePrintField(name, value) {
    setPrintNotice("");
    setPrintForm((current) => ({ ...current, [name]: value }));
  }

  function resetPrintForm() {
    setPrintNotice("");
    setPrintForm(buildDefaultPrintForm(ticket, pressOptions, currentUserName));
  }

  async function submitPrintJob(event) {
    event.preventDefault();
    setPrintNotice("");
    const result = await onQueuePrintLabel?.({
      ...printForm,
      press: printForm.press || null,
    });
    if (result?.queueKey) {
      setPrintNotice(`Queued ${printForm.template || "label"} label to ${result.queueKey}.`);
    } else {
      setPrintNotice("Print job queued.");
    }
  }

  function openPendingChanges() {
    setHistoryTab("ticket");
    setActiveTab("history");
  }

  return (
    <div className="job-ticket-panel">
      <div className="job-packet-toolbar">
        <div>
          <p className="eyebrow">Job Packet</p>
          <strong>{ticket.product_code ? `TSM ${ticket.product_code}` : ticket.customer_display || ticket.customer_name || "Job details"}</strong>
        </div>
        <div>
          {canQuote && (
            <button className="primary-btn" type="button" onClick={onQuoteJob}>
              <FileText size={15} /> Quote Job
            </button>
          )}
        </div>
      </div>

      <div className="job-tab-action-row">
        {visibleTabs.length > 1 && (
          <div className="job-tabs" role="tablist" aria-label="Job ticket sections">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeTab === tab.key ? "active" : ""}
                onClick={() => selectTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {canSchedule && (
          <button
            className="job-schedule-action"
            type="button"
            onClick={() => setScheduleOpen(true)}
            disabled={pendingChangeEvents.length > 0}
            title={pendingChangeEvents.length ? "Approve, reject, or take back pending changes before scheduling." : "Schedule job"}
          >
            <CalendarPlus size={15} /> Schedule Job
          </button>
        )}
      </div>

      {activeTab === "general" && (
        <div className="job-panel-section">
          {pendingChangeEvents.length > 0 && (
            <section className="job-pending-change-alert" role="alert">
              <div>
                <Clock3 size={18} />
                <div>
                  <strong>Approval Needed Before This Job Can Be Scheduled</strong>
                  <span>{pendingChangeEvents.length} job ticket change request{pendingChangeEvents.length === 1 ? "" : "s"} waiting for manager/admin review. The live ticket has not changed yet.</span>
                </div>
              </div>
              <button type="button" onClick={openPendingChanges}>Review Changes</button>
            </section>
          )}
          <section className="job-ticket-sheet-head">
            <div className="job-ticket-sheet-image">
              {image?.url && !imageIsDocument ? (
                <img src={image.url} alt={image.name || ticket.job_name || "Job image"} />
              ) : image?.url ? (
                <PdfPreview url={image.url} title={image.name || ticket.job_name || "Job PDF"} />
              ) : (
                <div>
                  <ImageIcon size={30} />
                  <span>No job image</span>
                </div>
              )}
              {imageSourceLabel(image) && <span className="job-image-source-badge">{imageSourceLabel(image)}</span>}
            </div>
            <div className="job-ticket-title-panel">
              <span className="job-ticket-title-label">Part Number</span>
              <strong className="job-ticket-part-number" title={partNumber}>{partNumber}</strong>
              <p className="job-ticket-description">{descriptionText}</p>
              <div className="job-ticket-meta-grid">
                <div>
                  <span>Customer</span>
                  <strong>{ticket.customer_display || ticket.customer_name || "--"}</strong>
                </div>
                <div>
                  <span>TSM ID</span>
                  <strong>{ticket.product_code || "--"}</strong>
                </div>
                <div>
                  <span>Job Number</span>
                  <strong>{ticket.job_name || ticket.ticket_number || "--"}</strong>
                </div>
                <div>
                  <span>Material Type</span>
                  <strong>{materialTypeDisplay}</strong>
                </div>
                <div>
                  <span>Size</span>
                  <strong>{`${formatInches(ticket.label_width_inches)} x ${formatInches(ticket.label_length_inches)}`}</strong>
                </div>
              </div>
            </div>
          </section>

          <div className="job-ticket-main-grid">
            <section className="job-ticket-sheet-card job-ticket-average-card">
              <div className="job-ticket-card-head">
                <strong>Average Shipping</strong>
                <div className="job-chart-range compact">
                  {chartRangeOptions.map((option) => (
                    <button
                      className={`${chartRange === option.key ? "active" : ""} ${option.featured ? "featured" : ""}`}
                      type="button"
                      key={option.key}
                      onClick={() => setChartRange(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="job-ticket-average-summary">
                <span>{selectedRangeLabel}</span>
                <strong>{chartsLoading ? "Loading..." : shippedMonthlyAverage ? `${formatNumber(shippedMonthlyAverage)} / month` : "--"}</strong>
              </div>
              {chartsLoading ? <ChartLoadingState /> : <MiniBarChart bars={shippedBars} rangeLabel={selectedRangeLabel} />}
            </section>

            <section className="job-ticket-sheet-card">
              <div className="job-ticket-card-head">
                <strong>Finished Stock</strong>
                <span>Inventory: {formatNumber(finishedCartons)}</span>
              </div>
              <FinishedStockSnapshotTable groups={finishedCartonByLocation} />
            </section>
          </div>

          <section className="job-ticket-sheet-card job-ticket-raw-material-card">
            <div className="job-ticket-card-head">
              <strong>Raw Material Inventory</strong>
              <span>{formatNumber(materialFeet, " ft")} available</span>
            </div>
            <RawMaterialInventoryTable rows={availableInventoryWithFeet} />
          </section>
        </div>
      )}

      {activeTab === "labels" && (
        <div className="job-panel-section">
          <section className="job-print-workspace">
            <div className="job-print-hero">
              <div>
                <p className="eyebrow">Print Labels</p>
                <h3>{showCoaterPrintFields ? "Material Tag" : "Carton Label"}</h3>
                <span>{showCoaterPrintFields ? "Queue a roll tag for the coater/material flow." : "Queue carton labels from the ticket specs and shipment details."}</span>
              </div>
              <div className={`job-printer-status ${selectedPrintPress?.printer_ip ? "ready" : "needs-setup"}`}>
                <Printer size={18} />
                <div>
                  <strong>{selectedPrintPress?.name || "No press selected"}</strong>
                  <span>{selectedPrintPress?.printer_ip ? `${selectedPrintPress.printer_ip}:${selectedPrintPress.printer_port || 9100}` : "Add printer IP on the Presses page"}</span>
                </div>
              </div>
            </div>

            <form className="job-print-form" onSubmit={submitPrintJob}>
              <div className="job-print-grid">
                <label>
                  <span>Press Printer</span>
                  <select value={printForm.press} onChange={(event) => updatePrintField("press", event.target.value)} required>
                    <option value="">Select press printer</option>
                    {pressOptions.map((press) => (
                      <option value={press.id} key={press.id}>{printPressLabel(press)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Label Type</span>
                  <select value={printForm.template} onChange={(event) => updatePrintField("template", event.target.value)}>
                    {printTemplates.map((template) => (
                      <option value={template.value} key={template.value}>{template.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Labels to Print</span>
                  <input type="number" min="1" step="1" value={printForm.total} onChange={(event) => updatePrintField("total", event.target.value)} />
                </label>
                <label>
                  <span>Lot Number</span>
                  <input value={printForm.lot_number} onChange={(event) => updatePrintField("lot_number", event.target.value)} placeholder="Lot / batch" />
                </label>
                <label>
                  <span>Part Number</span>
                  <input value={printForm.part_number} onChange={(event) => updatePrintField("part_number", event.target.value)} />
                </label>
                <label>
                  <span>PO</span>
                  <input value={printForm.po} onChange={(event) => updatePrintField("po", event.target.value)} placeholder="Customer PO" />
                </label>
                <label>
                  <span>Description 1</span>
                  <input value={printForm.text1} onChange={(event) => updatePrintField("text1", event.target.value)} />
                </label>
                <label>
                  <span>Description 2</span>
                  <input value={printForm.text2} onChange={(event) => updatePrintField("text2", event.target.value)} />
                </label>
                <label>
                  <span>Description 3</span>
                  <input value={printForm.text3} onChange={(event) => updatePrintField("text3", event.target.value)} />
                </label>
                <label>
                  <span>Finish Line A</span>
                  <input value={printForm.labela} onChange={(event) => updatePrintField("labela", event.target.value)} />
                </label>
                <label>
                  <span>Finish Line B</span>
                  <input value={printForm.labelb} onChange={(event) => updatePrintField("labelb", event.target.value)} />
                </label>
                <label>
                  <span>Label Style</span>
                  <input value={printForm.label_type} onChange={(event) => updatePrintField("label_type", event.target.value)} placeholder="Optional" />
                </label>
              </div>

              {(showVariablePrintFields || showClopayPrintFields || showCoaterPrintFields) && (
                <div className="job-print-options">
                  {showVariablePrintFields && (
                    <section>
                      <div className="job-print-section-head">
                        <strong>Variable Numbers</strong>
                        <span>Use one print request per PO/range.</span>
                      </div>
                      <div className="job-print-grid compact">
                        <label>
                          <span>Starting Number</span>
                          <input value={printForm.starting_number} onChange={(event) => updatePrintField("starting_number", event.target.value)} />
                        </label>
                        <label>
                          <span>Ending Number</span>
                          <input value={printForm.ending_number} onChange={(event) => updatePrintField("ending_number", event.target.value)} />
                        </label>
                        <label>
                          <span>Reference</span>
                          <input value={printForm.ref_number} onChange={(event) => updatePrintField("ref_number", event.target.value)} />
                        </label>
                      </div>
                    </section>
                  )}

                  {showClopayPrintFields && (
                    <section>
                      <div className="job-print-section-head">
                        <strong>Clopay Shipping</strong>
                        <span>Only fill what needs to appear on this label.</span>
                      </div>
                      <div className="job-print-grid compact">
                        <label>
                          <span>Header</span>
                          <input value={printForm.clopay_shipping_header} onChange={(event) => updatePrintField("clopay_shipping_header", event.target.value)} />
                        </label>
                        <label>
                          <span>Ship Date</span>
                          <input value={printForm.clopay_ship_date} onChange={(event) => updatePrintField("clopay_ship_date", event.target.value)} />
                        </label>
                        <label>
                          <span>Part Number</span>
                          <input value={printForm.clopay_part_number} onChange={(event) => updatePrintField("clopay_part_number", event.target.value)} />
                        </label>
                        <label>
                          <span>PO</span>
                          <input value={printForm.clopay_po} onChange={(event) => updatePrintField("clopay_po", event.target.value)} />
                        </label>
                        <label>
                          <span>PO Line</span>
                          <input value={printForm.clopay_po_line} onChange={(event) => updatePrintField("clopay_po_line", event.target.value)} />
                        </label>
                        <label>
                          <span>Quantity</span>
                          <input value={printForm.clopay_quantity} onChange={(event) => updatePrintField("clopay_quantity", event.target.value)} />
                        </label>
                        <label>
                          <span>UoM</span>
                          <input value={printForm.clopay_uom} onChange={(event) => updatePrintField("clopay_uom", event.target.value)} />
                        </label>
                      </div>
                    </section>
                  )}

                  {showCoaterPrintFields && (
                    <section>
                      <div className="job-print-section-head">
                        <strong>Material Tag</strong>
                        <span>These fields feed the coater roll-tag ZPL.</span>
                      </div>
                      <div className="job-print-grid compact">
                        <label>
                          <span>Operator</span>
                          <input value={printForm.operator} onChange={(event) => updatePrintField("operator", event.target.value)} />
                        </label>
                        <label>
                          <span>Material Part</span>
                          <input value={printForm.material_part_number} onChange={(event) => updatePrintField("material_part_number", event.target.value)} />
                        </label>
                        <label>
                          <span>Face</span>
                          <input value={printForm.face} onChange={(event) => updatePrintField("face", event.target.value)} />
                        </label>
                        <label>
                          <span>Liner</span>
                          <input value={printForm.liner} onChange={(event) => updatePrintField("liner", event.target.value)} />
                        </label>
                        <label>
                          <span>Adhesive</span>
                          <input value={printForm.adhesive} onChange={(event) => updatePrintField("adhesive", event.target.value)} />
                        </label>
                        <label>
                          <span>Adhesive Width</span>
                          <input value={printForm.adhesive_width} onChange={(event) => updatePrintField("adhesive_width", event.target.value)} />
                        </label>
                        <label>
                          <span>Length</span>
                          <input value={printForm.length} onChange={(event) => updatePrintField("length", event.target.value)} />
                        </label>
                        <label>
                          <span>Roll ID</span>
                          <input value={printForm.roll_id} onChange={(event) => updatePrintField("roll_id", event.target.value)} />
                        </label>
                        <label className="wide">
                          <span>Note</span>
                          <input value={printForm.note} onChange={(event) => updatePrintField("note", event.target.value)} />
                        </label>
                      </div>
                    </section>
                  )}
                </div>
              )}

              <label className="job-print-rework">
                <span>Rework / Special Message</span>
                <textarea value={printForm.rework_message} onChange={(event) => updatePrintField("rework_message", event.target.value)} rows={2} />
              </label>

              {!selectedPrintPress?.printer_ip && (
                <div className="job-print-warning">
                  <AlertTriangle size={16} />
                  <span>Select a press with a printer IP. Add printer setup on the Presses page.</span>
                </div>
              )}
              {printLabelError && <div className="job-print-warning error"><AlertTriangle size={16} /><span>{printLabelError}</span></div>}
              {printNotice && <div className="job-print-success"><CheckCircle2 size={16} /><span>{printNotice}</span></div>}

              <div className="job-print-actions">
                <button className="ghost-btn" type="button" onClick={resetPrintForm}>
                  <RotateCcw size={15} /> Reset
                </button>
                <button className="primary-btn" type="submit" disabled={printingLabel || !selectedPrintPress?.printer_ip}>
                  <Send size={15} /> {printingLabel ? "Queueing..." : "Queue Print Job"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {activeTab === "history" && (
        <div className="job-panel-section">
          <div className="job-history-tabs" role="tablist" aria-label="History sections">
            {historyTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeHistoryTab === tab.key ? "active" : ""}
                onClick={() => setHistoryTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeHistoryTab === "orders" && (
            <>
              <section className="job-subsection">
                <div className="job-subsection-head">
                  <PackageCheck size={15} />
                  <strong>Jobs Ran</strong>
                  <span>{orderHistoryGroups.length} run{orderHistoryGroups.length === 1 ? "" : "s"}</span>
                </div>
                <div className="job-order-search-row">
                  <label>
                    <span>Search Job / PO</span>
                    <input
                      value={orderHistorySearch}
                      onChange={(event) => setOrderHistorySearch(event.target.value)}
                      placeholder="Order, schedule, or PO"
                    />
                  </label>
                </div>
                {orderHistoryGroups.length ? (
                  <div className="job-order-history-list">
                    {orderHistoryGroups.map((group) => (
                      <OrderHistoryGroupCard key={group.key} group={group} />
                    ))}
                  </div>
                ) : (
                  <p className="muted">No jobs ran match this search.</p>
                )}
              </section>
            </>
          )}

          {activeHistoryTab === "ticket" && (
            <section className="job-subsection">
              <div className="job-subsection-head">
                <History size={15} />
                <strong>Job Ticket Changes</strong>
                <span>{pendingChangeEvents.length} pending approval</span>
              </div>
              <JobTicketEventList
                events={ticketChangeEvents}
                emptyText="No job ticket changes have been recorded yet."
                canApproveChanges={canApproveChanges}
                currentUserName={currentUserName}
                approvingChangeId={approvingChangeId}
                onApproveChange={onApproveChange}
              />
            </section>
          )}

          {activeHistoryTab === "inventory" && (
            <>
              <section className="job-subsection">
                <div className="job-subsection-head">
                  <PackageCheck size={15} />
                  <strong>Receive Finished Inventory</strong>
                  <span>Scan Code 128 order number or enter manually</span>
                </div>
                <form className="job-inventory-receive-form" onSubmit={submitReceive}>
                  <label>
                    <span>Order Scan</span>
                    <input
                      value={receiveForm.order_number}
                      onChange={(event) => updateReceive("order_number", event.target.value)}
                      placeholder="ORD260527-0001"
                      inputMode="text"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span>Quantity</span>
                    <input type="number" min="0" step="0.001" required value={receiveForm.quantity} onChange={(event) => updateReceive("quantity", event.target.value)} />
                  </label>
                  <label>
                    <span>Location</span>
                    <input required value={receiveForm.location} onChange={(event) => updateReceive("location", event.target.value)} placeholder="Rack / shelf / staging" />
                  </label>
                  <label>
                    <span>Received By</span>
                    <input value={receiveForm.received_by} onChange={(event) => updateReceive("received_by", event.target.value)} placeholder="Name" />
                  </label>
                  <label>
                    <span>Unit</span>
                    <select value={receiveForm.unit} onChange={(event) => updateReceive("unit", event.target.value)}>
                      <option value="carton">Carton</option>
                      <option value="case">Case</option>
                      <option value="roll">Roll</option>
                      <option value="label">Label</option>
                      <option value="each">Each</option>
                    </select>
                  </label>
                  <div>
                    <button className="primary-btn" type="submit" disabled={inventoryReceiving}>{inventoryReceiving ? "Receiving..." : "Receive Stock"}</button>
                    {!receiveForm.order_number && <small>Without an order scan this will use the current job ticket.</small>}
                  </div>
                  {inventoryReceiveError && <p>{inventoryReceiveError}</p>}
                </form>
              </section>

              <section className="job-subsection">
                <div className="job-subsection-head">
                  <PackageCheck size={15} />
                  <strong>Finished Inventory By Location</strong>
                  <span>{formatNumber(finishedQuantity)} on hand</span>
                </div>
                {finishedByLocation.length ? (
                  <div className="job-finished-location-list">
                    {finishedByLocation.map((group) => (
                      <div key={group.location} className="job-finished-location-group">
                        <div className="job-finished-location-head">
                          <strong>{group.location}</strong>
                          <span>{formatNumber(group.total)} total / {group.rows.length} lot{group.rows.length === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No finished inventory is linked to this job yet.</p>
                )}
              </section>

              <section className="job-subsection">
                <div className="job-subsection-head">
                  <PackageCheck size={15} />
                  <strong>Inventory History</strong>
                  <span>{finishedUsageRows.length} event{finishedUsageRows.length === 1 ? "" : "s"}</span>
                </div>
                {finishedUsageRows.length ? (
                  <div className="job-inventory-list">
                    {finishedUsageRows.map((row) => (
                      <div key={row.id} className="job-inventory-row">
                        <strong>{row.reference || row.finished_inventory_name || labelize(row.usage_type)}</strong>
                        <span>{[row.used_date, labelize(row.usage_type), row.quantity ? `${formatNumber(row.quantity)} ${row.unit || row.finished_inventory_unit || "units"}` : ""].filter(Boolean).join(" / ")}</span>
                        <em>{row.finished_inventory_location_full_path || row.finished_inventory_location_name || row.notes || "No location"}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No inventory history has been recorded for this job yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {activeTab === "editor" && (
        <div className="job-panel-section job-editor-workspace">
          <section className="job-editor-hero">
            <div>
              <p className="eyebrow">Controlled Editor</p>
              <h3>{partNumber}</h3>
              <span>Every saved change is recorded in the job ticket history and routed for manager/admin approval.</span>
            </div>
            <div className="job-editor-hero-stats">
              <div>
                <strong>{editorPreviewChanges.length}</strong>
                <span>Unsaved change{editorPreviewChanges.length === 1 ? "" : "s"}</span>
              </div>
              <div className={pendingChangeEvents.length ? "needs-review" : "ready"}>
                <strong>{pendingChangeEvents.length}</strong>
                <span>Pending approval</span>
              </div>
            </div>
          </section>

          <div className="job-editor-layout">
            <aside className="job-editor-review-panel">
              <section>
                <div className="job-editor-review-head">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>Before You Save</strong>
                    <span>{editorPreviewChanges.length ? "These edits will be logged for approval." : "No fields have changed yet."}</span>
                  </div>
                </div>
                {editorPreviewChanges.length ? (
                  <div className="job-editor-preview-list">
                    {editorPreviewChanges.map((change) => (
                      <article key={change.key}>
                        <strong>{change.label}</strong>
                        <div>
                          <span>{change.from}</span>
                          <em>to</em>
                          <span>{change.to}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Change a field in the editor and it will appear here before saving.</p>
                )}
              </section>

              <section>
                <div className="job-editor-review-head">
                  <Clock3 size={15} />
                  <div>
                    <strong>Manager Approval</strong>
                    <span>{pendingChangeEvents.length ? `${pendingChangeEvents.length} saved change${pendingChangeEvents.length === 1 ? "" : "s"} need review.` : "No saved changes are waiting."}</span>
                  </div>
                </div>
                <JobTicketEventList
                  events={pendingChangeEvents.slice(0, 4)}
                  emptyText="No pending job ticket changes."
                  canApproveChanges={canApproveChanges}
                  currentUserName={currentUserName}
                  approvingChangeId={approvingChangeId}
                  onApproveChange={onApproveChange}
                />
              </section>
            </aside>

            <div className="job-editor-form-column">
              {renderEditorForm?.({ onCancel: () => setActiveTab("general"), onFormChange: setEditorDraft })}
            </div>
          </div>
        </div>
      )}

      {scheduleOpen && (
        <div className="job-schedule-dialog-overlay" role="dialog" aria-modal="true" aria-label="Schedule job">
          <div className="job-schedule-dialog">
            <header>
              <div>
                <p className="eyebrow">Schedule Job</p>
                <h3>{partNumber}</h3>
              </div>
              <button className="ghost-btn" type="button" onClick={() => setScheduleOpen(false)}>
                Close
              </button>
            </header>
            {renderScheduleForm?.({ onCancel: () => setScheduleOpen(false) })}
          </div>
        </div>
      )}
    </div>
  );
}
