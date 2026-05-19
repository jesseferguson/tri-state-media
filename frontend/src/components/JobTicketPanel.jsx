import { useMemo, useState } from "react";
import { CalendarPlus, Edit3, PackageCheck, Trash2 } from "lucide-react";
import RecipeOptionsView from "./RecipeOptionsView";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const tabs = [
  { key: "general", label: "General" },
  { key: "schedule", label: "Schedule" },
  { key: "editor", label: "Editor" },
  { key: "spec", label: "Spec" },
];

const chartRangeOptions = [
  { key: "all", label: "All" },
  { key: "last-quarter", label: "Last Quarter" },
  { key: "last-year", label: "Last Year" },
  { key: "ytd", label: "YTD" },
  { key: "30bd", label: "30 Days", featured: true },
  { key: "60bd", label: "60 Days", featured: true },
  { key: "90bd", label: "90 Days", featured: true },
];

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function dateInLastMonths(value, months = 3) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return date >= cutoff;
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

function formatNumber(value, suffix = "") {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "--";
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString()}${suffix}`;
}

function Stat({ label, value, bars, rangeLabel }) {
  return (
    <div className="job-stat">
      <div>
        <span>{label}</span>
        <strong>{value ?? "--"}</strong>
      </div>
      {bars && <MiniBarChart bars={bars} rangeLabel={rangeLabel} />}
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

function InfoRow({ label, value }) {
  return (
    <div className="job-info-row">
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function materialTitle(ticket) {
  return [
    ticket.material_spec_code,
    ticket.material_spec_name,
    ticket.material_spec_family,
    ticket.material_spec_gsm ? `${ticket.material_spec_gsm} GSM` : "",
    ticket.material_spec_liner_pounds ? `${ticket.material_spec_liner_pounds}#` : "",
  ].filter(Boolean).join(" / ");
}

function matchingMaterialInventory(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (sameId(row.material, ticket.material_spec)) return true;
    if (ticket.material_spec_code && row.material_code === ticket.material_spec_code) return true;
    if (ticket.material_spec_code && row.code === ticket.material_spec_code) return true;
    return false;
  });
}

function groupInventoryByWidth(rows) {
  return (rows ?? []).reduce((acc, row) => {
    const key = row.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
    if (!acc[key]) acc[key] = { rows: [], total: 0 };
    acc[key].rows.push(row);
    const qty = Number(row.length_feet ?? row.quantity ?? 0);
    if (Number.isFinite(qty) && !["depleted", "scrapped"].includes(row.status)) acc[key].total += qty;
    return acc;
  }, {});
}

function matchingFinishedRows(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function matchingRecipeOptions(ticket, rows) {
  return (rows ?? []).filter((row) => {
    if (ticket.recipe && sameId(row.recipe, ticket.recipe)) return true;
    if (ticket.recipe_name && row.recipe_name === ticket.recipe_name) return true;
    return false;
  });
}

function matchingBoxInventory(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.box, ticket.box));
}

function matchingSchedule(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function matchingOrders(ticket, rows) {
  return (rows ?? []).filter((row) => sameId(row.job_ticket, ticket.id) || row.job_ticket_number === ticket.ticket_number);
}

function scheduleQuantity(row) {
  return numeric(row.quantity_to_ship) + numeric(row.quantity_to_stock);
}

function dateValue(row) {
  return row.scheduled_date || row.order_date || row.due_date || row.run_date || "";
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
      const date = rawDate ? new Date(`${rawDate}T00:00:00`) : null;
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

export default function JobTicketPanel({ ticket, lookups, editing, deleting, onEdit, onDelete, onSchedule }) {
  const [activeTab, setActiveTab] = useState("general");
  const [chartRange, setChartRange] = useState("90bd");

  const materialInventory = useMemo(
    () => matchingMaterialInventory(ticket, lookups["raw-materials"]),
    [ticket, lookups]
  );

  const finishedRows = useMemo(
    () => matchingFinishedRows(ticket, lookups["finished-inventory"]),
    [ticket, lookups]
  );

  const recipeOptions = useMemo(
    () => matchingRecipeOptions(ticket, lookups["recipe-options"]),
    [ticket, lookups]
  );

  const scheduleRows = useMemo(
    () => matchingSchedule(ticket, lookups["production-schedule"]),
    [ticket, lookups]
  );

  const orderRows = useMemo(
    () => matchingOrders(ticket, lookups["customer-orders"]),
    [ticket, lookups]
  );

  const recentBoxAverage = useMemo(() => {
    const recent = finishedRows.filter((row) => row.status === "shipped" && dateInLastMonths(row.run_date, 3));
    const boxes = recent.reduce((sum, row) => sum + getBoxCount(row, ticket), 0);
    return boxes > 0 ? Math.round((boxes / 3) * 10) / 10 : null;
  }, [finishedRows, ticket]);

  const availableInventory = materialInventory.filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status));
  const inventoryByWidth = useMemo(() => groupInventoryByWidth(availableInventory), [availableInventory]);
  const availableFinished = finishedRows.filter((row) => row.is_active !== false && !["depleted", "scrapped", "shipped"].includes(row.status));
  const materialFeet = availableInventory.reduce((sum, row) => sum + numeric(row.length_feet ?? row.quantity), 0);
  const finishedQuantity = availableFinished.reduce((sum, row) => sum + numeric(row.quantity), 0);
  const scheduleTotal = scheduleRows.reduce((sum, row) => sum + scheduleQuantity(row), 0);
  const averageScheduled = scheduleRows.length ? scheduleTotal / scheduleRows.length : null;
  const selectedRangeLabel = chartRangeOptions.find((option) => option.key === chartRange)?.label || "90 Days";
  const scheduledBars = useMemo(
    () => monthlyBars(scheduleRows, dateValue, scheduleQuantity, chartRange),
    [chartRange, scheduleRows]
  );
  const shippedBars = useMemo(
    () => monthlyBars(
      finishedRows.filter((row) => row.status === "shipped"),
      (row) => row.run_date,
      (row) => getBoxCount(row, ticket) || numeric(row.quantity),
      chartRange
    ),
    [chartRange, finishedRows, ticket]
  );
  const recentSchedules = [...scheduleRows]
    .sort((a, b) => String(dateValue(b)).localeCompare(String(dateValue(a))))
    .slice(0, 6);
  const title = getRecordTitle(ticket);

  return (
    <>
      <div className="panel-head thin">
        <div>
          <p className="eyebrow">Job Packet</p>
          <h2>{title}</h2>
        </div>
      </div>

      <div className="job-tabs" role="tablist" aria-label="Job ticket sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="job-panel-section">
          <div className="job-chart-range">
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
          <div className="job-stat-grid focus">
            <Stat label="Material On Hand" value={`${availableInventory.length} rolls / ${formatNumber(materialFeet, " ft")}`} />
            <Stat label="Finished Stock" value={`${formatNumber(finishedQuantity)} units / ${availableFinished.length} lots`} />
            <Stat label="Avg Scheduled" value={averageScheduled ? formatNumber(averageScheduled) : "--"} bars={scheduledBars} rangeLabel={selectedRangeLabel} />
            <Stat label="Avg Shipped / Month" value={recentBoxAverage ?? "--"} bars={shippedBars} rangeLabel={selectedRangeLabel} />
          </div>

          <div className="job-info-list compact">
            <InfoRow label="TSM ID" value={ticket.product_code || ticket.customer_display} />
            <InfoRow label="Customer" value={ticket.customer_name} />
            <InfoRow label="Material" value={materialTitle(ticket)} />
          </div>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Material Inventory By Width</strong>
            </div>
            {Object.keys(inventoryByWidth).length ? (
              <div className="job-inventory-list">
                {Object.entries(inventoryByWidth).map(([width, group]) => (
                  <div key={width} className="job-inventory-row">
                    <strong>{width}</strong>
                    <span>{`${group.total.toLocaleString()} ft across ${group.rows.length} lots`}</span>
                    <em>{group.rows.map((row) => row.location_full_path || row.location_name).filter(Boolean).slice(0, 3).join(" / ") || "No location"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active inventory rolls are linked to this material family yet.</p>
            )}
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Finished Stock Inventory</strong>
            </div>
            {availableFinished.length ? (
              <div className="job-inventory-list">
                {availableFinished.slice(0, 8).map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{row.name || row.sku || row.job_ticket_number}</strong>
                    <span>{[row.quantity ? `${row.quantity} ${row.unit || "units"}` : "", row.run_date, labelize(row.status)].filter(Boolean).join(" / ")}</span>
                    <em>{row.location_full_path || row.location_name || row.notes || "No location"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No finished stock is linked to this job yet.</p>
            )}
          </section>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <CalendarPlus size={15} />
              <strong>Previous Schedule History</strong>
            </div>
            {recentSchedules.length ? (
              <div className="job-inventory-list">
                {recentSchedules.map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{[dateValue(row) || "No date", labelize(row.status), labelize(row.priority)].filter(Boolean).join(" / ")}</strong>
                    <span>{[row.customer_po ? `PO ${row.customer_po}` : "", scheduleQuantity(row) ? `${formatNumber(scheduleQuantity(row))} total` : ""].filter(Boolean).join(" / ")}</span>
                    <em>{row.notes || "No operator note"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No previous schedule records are linked to this job yet.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === "schedule" && (
        <div className="job-panel-section">
          <div className="job-editor-actions">
            <button className="primary-btn" type="button" onClick={onSchedule}>
              <CalendarPlus size={15} /> Schedule This Job
            </button>
          </div>

          {scheduleRows.length ? (
            <div className="job-inventory-list">
              {scheduleRows.map((row) => (
                <div key={row.id} className="job-inventory-row">
                  <strong>{[row.scheduled_date, labelize(row.priority), labelize(row.status)].filter(Boolean).join(" / ")}</strong>
                  <span>{[row.customer_po ? `PO ${row.customer_po}` : "", row.quantity_to_ship ? `${row.quantity_to_ship} ship` : "", row.quantity_to_stock ? `${row.quantity_to_stock} stock` : ""].filter(Boolean).join(" / ")}</span>
                  <em>{row.notes || "No operator note"}</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">This job is not actively scheduled yet.</p>
          )}

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Customer Order Pool</strong>
            </div>
            {orderRows.length ? (
              <div className="job-inventory-list">
                {orderRows.map((row) => (
                  <div key={row.id} className="job-inventory-row">
                    <strong>{[row.order_date, row.customer_name, row.customer_po ? `PO ${row.customer_po}` : ""].filter(Boolean).join(" / ")}</strong>
                    <span>{[row.quantity_to_ship ? `${row.quantity_to_ship} ship` : "", row.quantity_to_stock ? `${row.quantity_to_stock} stock` : "", labelize(row.status)].filter(Boolean).join(" / ")}</span>
                    <em>{row.operator_note || "No note"}</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No permanent customer order records exist for this job yet.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === "editor" && (
        <div className="job-panel-section">
          <div className="job-editor-actions">
            <button className="primary-btn" type="button" onClick={onEdit} disabled={editing}>
              <Edit3 size={15} /> Edit Job Ticket
            </button>
            <button className="danger-btn" type="button" onClick={onDelete} disabled={deleting}>
              <Trash2 size={15} /> Delete
            </button>
          </div>

          <div className="job-info-list">
            <InfoRow label="Ticket #" value={ticket.ticket_number} />
            <InfoRow label="Job Name" value={ticket.job_name} />
            <InfoRow label="Labels / Unit" value={ticket.labels_per_unit} />
            <InfoRow label="Units / Carton" value={ticket.units_per_carton} />
            <InfoRow label="Labels in Box" value={ticket.labels_per_carton} />
            <InfoRow label="Core Size" value={formatInches(ticket.core_size_inches)} />
            <InfoRow label="Wind" value={ticket.wind_direction ? `Wind ${ticket.wind_direction}` : ""} />
            <InfoRow label="Finishing Notes" value={ticket.finishing_notes} />
            <InfoRow label="Job Notes" value={ticket.job_notes} />
          </div>
        </div>
      )}

      {activeTab === "spec" && (
        <div className="job-panel-section">
          <div className="job-info-list">
            <InfoRow label="Tooling Recipe" value={ticket.recipe_name} />
            <InfoRow label="Operator Spec" value={`${formatInches(ticket.label_width_inches)} x ${formatInches(ticket.label_length_inches)} / ${formatInches(ticket.repeat_inches)} repeat / ${labelize(ticket.cutting_type)}`} />
            <InfoRow label="Finishing" value={[labelize(ticket.finishing_type), ticket.labels_per_unit ? `${ticket.labels_per_unit} labels/unit` : "", ticket.units_per_carton ? `${ticket.units_per_carton} units/carton` : "", ticket.labels_per_carton ? `${ticket.labels_per_carton} labels/box` : ""].filter(Boolean).join(" / ")} />
          </div>

          <section className="job-subsection">
            <div className="job-subsection-head">
              <PackageCheck size={15} />
              <strong>Recipe Tooling</strong>
            </div>
            {recipeOptions.length ? (
              <RecipeOptionsView rows={recipeOptions} />
            ) : (
              <p className="muted">Attach a tooling recipe to show operator tooling information here.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
