import { useMemo, useState } from "react";
import { CalendarPlus, FileText, History, Image as ImageIcon, PackageCheck } from "lucide-react";
import { PdfPreview, isPdfUrl } from "./FilePreview";
import { formatInches, labelize } from "../lib/format";

const tabs = [
  { key: "general", label: "General" },
  { key: "history", label: "History" },
  { key: "editor", label: "Editor" },
];

const historyTabs = [
  { key: "orders", label: "Orders" },
  { key: "ticket", label: "Job Ticket Changes" },
  { key: "inventory", label: "Inventory" },
];

const chartRangeOptions = [
  { key: "all", label: "All" },
  { key: "9mo", label: "9 Months" },
  { key: "3mo", label: "3 Months", featured: true },
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

function monthlyBars(rows, dateGetter, quantityGetter, rangeKey) {
  const start = rangeStart(rangeKey);
  const end = rangeEnd(rangeKey);
  const grouped = new Map();
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

function JobTicketEventList({ events, emptyText }) {
  if (!events.length) return <p className="muted">{emptyText}</p>;
  return (
    <div className="job-history-event-list">
      {events.map((event) => {
        const changes = eventChanges(event);
        return (
          <article key={event.id}>
            <div>
              <strong>{event.summary || labelize(event.event_type)}</strong>
              <span>{[eventDate(event.created_at), event.performed_by, labelize(event.event_type)].filter(Boolean).join(" / ")}</span>
            </div>
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
  return (
    <article className="job-order-history-card">
      <header>
        <div>
          <span>Order / PO</span>
          <strong>{group.orderNumbers.join(" / ") || "Schedule"}</strong>
          <em>{group.customerPo ? `PO ${group.customerPo}` : "No PO"}</em>
        </div>
        <div className="job-order-status-chip">
          <strong>{labelize(latestStatus || "open")}</strong>
          <span>{orderCount} order{orderCount === 1 ? "" : "s"} / {scheduleCount} schedule{scheduleCount === 1 ? "" : "s"}</span>
        </div>
      </header>

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
                  <em>{[schedule.operator ? `Operator ${schedule.operator}` : "", schedule.footage_report || schedule.notes].filter(Boolean).join(" / ") || "No footage report"}</em>
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
    </article>
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
  onQuoteJob,
  onReceiveFinishedInventory,
  renderEditorForm,
  renderScheduleForm,
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [historyTab, setHistoryTab] = useState("orders");
  const [chartRange, setChartRange] = useState("3mo");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [orderHistorySearch, setOrderHistorySearch] = useState("");
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
          <button className="job-schedule-action" type="button" onClick={() => setScheduleOpen(true)}>
            <CalendarPlus size={15} /> Schedule Job
          </button>
        )}
      </div>

      {activeTab === "general" && (
        <div className="job-panel-section">
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
              <section className="job-order-dashboard">
                <div className="job-order-card">
                  <span>Orders</span>
                  <strong>{customerOrders.length}</strong>
                </div>
                <div className="job-order-card">
                  <span>Schedules</span>
                  <strong>{scheduleRows.length}</strong>
                </div>
                <div className="job-order-card">
                  <span>Planned Total</span>
                  <strong>{formatNumber(scheduleTotal)}</strong>
                </div>
                <div className="job-order-card">
                  <span>Footage</span>
                  <strong>{formatNumber(orderHistoryGroups.reduce((sum, group) => {
                    const scheduleFootage = group.schedules.reduce((total, schedule) => total + numeric(schedule.actual_footage), 0);
                    if (scheduleFootage > 0) return sum + scheduleFootage;
                    return sum + group.orders.reduce((total, order) => total + numeric(order.actual_footage), 0);
                  }, 0), " ft")}</strong>
                </div>
              </section>

              <section className="job-subsection">
                <div className="job-subsection-head">
                  <PackageCheck size={15} />
                  <strong>Orders</strong>
                  <span>{orderHistoryGroups.length} group{orderHistoryGroups.length === 1 ? "" : "s"}</span>
                </div>
                <div className="job-order-search-row">
                  <label>
                    <span>Search Order / PO</span>
                    <input
                      value={orderHistorySearch}
                      onChange={(event) => setOrderHistorySearch(event.target.value)}
                      placeholder="Order number or PO"
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
                  <p className="muted">No order or PO records match this search.</p>
                )}
              </section>
            </>
          )}

          {activeHistoryTab === "ticket" && (
            <section className="job-subsection">
              <div className="job-subsection-head">
                <History size={15} />
                <strong>Job Ticket Changes</strong>
              </div>
              <JobTicketEventList events={ticketChangeEvents} emptyText="No job ticket changes have been recorded yet." />
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
        <div className="job-panel-section job-editor-form-only">
          {renderEditorForm?.({ onCancel: () => setActiveTab("general") })}
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
